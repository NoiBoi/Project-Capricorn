// Modified for Project Capricorn. Local changes are licensed under the accompanying DevKit Noncommercial License. See UPSTREAM.md.
// Capricorn adaptation, November 2, 2026: structured tools and model capacity; see UPSTREAM.md.
import OpenAI from "openai";
import { apiError, ChatGPTError, isObject } from "./errors.js";
import type { StreamResponseOptions, StreamResult } from "./types.js";

export async function streamResponse(
  accessToken: string,
  options: StreamResponseOptions,
  signal: AbortSignal,
): Promise<StreamResult> {
  const input = typeof options.input === "string" ? [{ role: "user" as const, content: options.input }] : options.input;
  if (!Array.isArray(input) || input.some(item => {
    if (!isObject(item)) return true;
    if (item.type === 'function_call') return typeof item.call_id !== 'string' || !item.call_id || typeof item.name !== 'string' || !item.name || typeof item.arguments !== 'string';
    if (item.type === 'function_call_output') return typeof item.call_id !== 'string' || !item.call_id || typeof item.output !== 'string';
    if (!['user', 'assistant', 'developer'].includes(String(item.role))) return true;
    if (typeof item.content === 'string') return false;
    if (item.role !== 'user' || !Array.isArray(item.content) || !item.content.length || item.content.length > 8) return true;
    return item.content.some(part => !isObject(part) || (part.type === 'input_text' ? typeof part.text !== 'string' : part.type === 'input_image' ? typeof part.image_url !== 'string' || !/^data:image\/(jpeg|png);base64,[A-Za-z0-9+/]+={0,2}$/.test(part.image_url) || part.image_url.length > 3000000 || !['auto','low','high'].includes(String(part.detail)) : true));
  })) {
    throw new ChatGPTError('invalid_request', 'Use text/image messages or native function calls and their matching outputs. Put system guidance in instructions.');
  }

  // The DevKit supplies the selected ChatGPT account's refreshed OAuth token.
  // Leave org/project unset; they are not placeholders for a Platform API account.
  const client = new OpenAI({
    apiKey: accessToken,
    baseURL: "https://api.openai.com/v1",
    organization: null,
    project: null,
    // Keep the SDK's default without inheriting OPENAI_LOG=debug, which can log clipboard text.
    logLevel: "warn",
    // Report ChatGPT sharing-limit errors immediately instead of retrying HTTP 429s.
    maxRetries: 0,
    // A redirect can forward the clipboard body to another origin.
    fetchOptions: { redirect: "error" },
    // Also prevent OPENAI_CUSTOM_HEADERS from replacing this account's credentials or tenant.
    defaultHeaders: {
      authorization: `Bearer ${accessToken}`,
      "openai-organization": null,
      "openai-project": null,
    },
  });
  // The SDK's timeout ends at headers; keep the existing deadline on the body too.
  const requestSignal = AbortSignal.any([signal, AbortSignal.timeout(180_000)]);
  let response: Response | undefined;
  try {
    const body = {
      model: options.model,
      input,
      ...(options.tools ? { tools: options.tools } : {}),
      ...(options.instructions !== undefined ? { instructions: options.instructions } : {}),
      store: false as const,
      stream: true as const,
    };
    requestSignal.throwIfAborted();
    try { options.beforeRequest?.(body); }
    catch (error) {
      const code = isObject(error) && typeof error.code === 'string' && /^[a-z_]+$/.test(error.code) ? error.code : 'host_admission_denied';
      throw new ChatGPTError(code, 'Cloud request denied by host session controls. Review daily-test usage and recording status.');
    }
    const result = await client.responses.create(body, { signal: requestSignal, headers: { accept: "text/event-stream" } }).withResponse();
    response = result.response;
    const contentType = response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
    // The direct route can return valid SSE without Content-Type. In that case,
    // validate the events below and still require response.completed for success.
    if (!response.body || (contentType && contentType !== "text/event-stream")) {
      await response.body?.cancel();
      throw new ChatGPTError("invalid_stream", "ChatGPT did not return the expected response stream.", true, response.status);
    }

    let completed = false;
    let text = "";
    const completedItems = new Map<number, Record<string, unknown>>();
    let final: StreamResult = { text, calls: [] };
    for await (const event of result.data) {
      requestSignal.throwIfAborted();
      if (!isObject(event)) continue;
      options.onProtocolEvent?.(event);
      if (event.type === "response.output_text.delta" && typeof event.delta === "string") {
        text += event.delta;
        if (text.length > 16 * 1024 * 1024) throw new ChatGPTError("response_too_large", "The response was too large. Try a smaller request.");
        options.onDelta?.(event.delta);
      } else if (event.type === 'response.output_item.done' && isObject(event.item)) {
        if (!Number.isSafeInteger(event.output_index) || event.output_index < 0 || event.output_index > 64) throw new ChatGPTError('invalid_stream', 'Invalid completed output index.');
        const previous = completedItems.get(event.output_index);
        if (previous && JSON.stringify(previous) !== JSON.stringify(event.item)) throw new ChatGPTError('invalid_stream', 'Conflicting completed output index.');
        completedItems.set(event.output_index, event.item);
      } else if (event.type === "response.failed" || event.type === "error") {
        const detail = event.type === "response.failed" ? event.response : event;
        throw apiError(detail, response.status, result.request_id);
      } else if (event.type === "response.incomplete") {
        throw new ChatGPTError("response_incomplete", "ChatGPT stopped before completing the response. You can keep the partial text or try again.", true);
      } else if (event.type === "response.completed") {
        // Some SIWC streams deliver completed items only in output_item.done.
        // Do not mistake an empty final output array for model-chosen silence.
        for (const [index, item] of (event.response.output ?? []).entries()) {
          if (item.type === 'function_call' && item.status !== undefined && item.status !== 'completed') throw new ChatGPTError('invalid_tool_call', 'Function call did not complete.');
          const previous = completedItems.get(index);
          if (previous && (previous.type !== item.type || previous.id !== item.id || item.type === 'function_call' && (previous.call_id !== item.call_id || previous.name !== item.name || previous.arguments !== item.arguments || previous.namespace !== item.namespace))) throw new ChatGPTError('invalid_tool_call', 'Conflicting completed output items.');
          if (!previous) completedItems.set(index, item as unknown as Record<string, unknown>);
        }
        const output = [...completedItems].sort(([a], [b]) => a - b).map(([, item]) => item);
        const calls: StreamResult['calls'] = [];
        const outputOrder: NonNullable<StreamResult['outputOrder']> = [];
        const messages = new Set<string>();
        for (const item of output) {
          if (item.type === 'message' && Array.isArray(item.content) && !messages.has(String(item.id))) {
            messages.add(String(item.id));
            const value = item.content.filter(part => isObject(part) && part.type === 'output_text' && typeof part.text === 'string').map(part => part.text).join('');
            if (value) outputOrder.push({ type: 'text', text: value });
          }
          if (item.type !== 'function_call') continue;
          if (item.status !== undefined && item.status !== 'completed') throw new ChatGPTError('invalid_tool_call', 'Function call did not complete.');
          const previous = calls.find(call => call.id === item.call_id);
          if (previous) {
            if (previous.name !== item.name || previous.arguments !== item.arguments || previous.namespace !== item.namespace) throw new ChatGPTError('invalid_tool_call', 'Conflicting completed tool calls.');
            continue;
          }
          if (typeof item.call_id !== 'string' || !item.call_id || typeof item.name !== 'string' || !item.name || typeof item.arguments !== 'string' || item.arguments.length > 32_768 || calls.length >= 8) throw new ChatGPTError('invalid_tool_call', 'Invalid or excessive tool calls.');
          calls.push({ id: item.call_id, name: item.name, arguments: item.arguments, ...('namespace' in item && typeof item.namespace === 'string' ? { namespace: item.namespace } : {}) });
          outputOrder.push({ type: 'call', callId: item.call_id });
        }
        if (!text) {
          const messages = new Map<string, string>();
          for (const item of output) if (item.type === 'message' && Array.isArray(item.content)) {
            const value = item.content.filter(part => isObject(part) && part.type === 'output_text' && typeof part.text === 'string').map(part => part.text).join('');
            messages.set(String(item.id), value);
          }
          text = [...messages.values()].join('');
          if (text.length > 16 * 1024 * 1024) throw new ChatGPTError('response_too_large', 'The response was too large. Try a smaller request.');
          if (text) options.onDelta?.(text);
        }
        if (text && !outputOrder.some(item => item.type === 'text')) outputOrder.unshift({ type: 'text', text });
        final = { text, calls, outputOrder, requestId: result.request_id ?? undefined, ...(event.response.usage ? { usage: { inputTokens: event.response.usage.input_tokens, outputTokens: event.response.usage.output_tokens, ...(event.response.usage.input_tokens_details ? { cachedInputTokens: event.response.usage.input_tokens_details.cached_tokens } : {}) } } : {}) };
        completed = true;
        break;
      }
    }
    // The SDK may finish iteration on an aborted connection without throwing.
    requestSignal.throwIfAborted();
    if (!completed) throw new ChatGPTError("stream_interrupted", "The response ended before completion. You can keep the partial text or try again.", true);
    return final;
  } catch (error) {
    if (signal.aborted) throw new ChatGPTError("cancelled", "The response was cancelled.");
    if (error instanceof ChatGPTError) throw error;
    // SDK errors can contain submitted text. Only expose our sanitized diagnostics,
    // including errors the SDK raises while decoding an SSE 'error' event.
    if (error instanceof OpenAI.APIError && !(error instanceof OpenAI.APIConnectionError) && !(error instanceof OpenAI.APIUserAbortError)) {
      // The SDK also unwraps the string in an OAuth { error: "code" } response.
      const detail = typeof error.error === "string" ? { error: error.error } : error.error;
      throw apiError(detail, error.status ?? response?.status, error.requestID ?? response?.headers.get("x-request-id"));
    }
    if (!response) throw new ChatGPTError("network_error", "Could not reach ChatGPT. Check your connection and try again.", true);
    if (error instanceof SyntaxError) throw new ChatGPTError("invalid_stream", "The response stream contained an invalid event. Try again.", true);
    throw new ChatGPTError("stream_interrupted", "The connection was interrupted. You can keep the partial text or try again.", true);
  }
}
