import { afterEach, expect, it, vi } from 'vitest';
vi.mock('electron', () => ({ app: { isReady: () => true }, safeStorage: {}, shell: {} }));
import { SiwcProvider, encodeInput, siwcConnection } from '../../src/main/runtime2/siwcProvider';
import { streamResponse } from '../../src/vendor/siwc-local/responses';
import { listModels } from '../../src/vendor/siwc-local/models';
import { ChatGPTError } from '../../src/vendor/siwc-local/errors';
import type { ChatGPTClient } from '../../src/vendor/siwc-local/types';
import { ARCHIVE_TOOLS } from '../../src/main/runtime2/archiveTools';
const signal = () => AbortSignal.timeout(2000);
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
function sse(events: unknown[]) { return new Response(events.map(e => 'data: ' + JSON.stringify(e) + '\n\n').join(''), { headers: { 'content-type': 'text/event-stream', 'x-request-id': 'req_synthetic' } }); }
function completed(output: unknown[] = []) { return { type: 'response.completed', response: { output, usage: { input_tokens: 42, output_tokens: 3 } } }; }
it('discovers account models from the official catalog without inventing context capacities', async () => {
  const fetch = vi.fn(async (_url: string) => Response.json({ models: [
    { slug: 'available', display_name: 'Available', visibility: 'list', context_window: 128000 },
    { slug: 'no-capacity', display_name: 'Capacity missing', visibility: 'list' },
    { slug: 'hidden', display_name: 'Hidden', visibility: 'hide' },
  ] })); vi.stubGlobal('fetch', fetch);
  expect(await listModels('synthetic-token', signal())).toEqual([{ slug: 'available', displayName: 'Available', contextWindow: 128000 }, { slug: 'no-capacity', displayName: 'Capacity missing' }]);
  expect(fetch.mock.calls[0][0]).toBe('https://api.openai.com/v1/models');
});
it('streams the documented Responses route with tools, local history, usage and completed call arguments', async () => {
  let body: any;
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
    expect(url).toBe('https://api.openai.com/v1/responses'); body = JSON.parse(init.body as string);
    return sse([{ type: 'response.output_text.delta', delta: 'Hi' }, completed([{ type: 'function_call', call_id: 'call1', name: 'get_archive_statistics', namespace: 'capri_archive', arguments: '{}' }])]);
  }));
  const delta = vi.fn();
  const result = await streamResponse('synthetic-token', { model: 'available', input: [{ role: 'user', content: 'hello' }], instructions: 'Identity', tools: [{ type: 'namespace', name: 'capri_archive', description: 'archive', tools: [] }], onDelta: delta }, signal());
  expect(body).toMatchObject({ store: false, stream: true, model: 'available', instructions: 'Identity', input: [{ role: 'user', content: 'hello' }] });
  for (const unsupported of ['previous_response_id','conversation','max_output_tokens','temperature','metadata']) expect(body).not.toHaveProperty(unsupported);
  expect(delta).toHaveBeenCalledWith('Hi'); expect(result).toMatchObject({ text: 'Hi', calls: [{ id: 'call1', arguments: '{}', namespace: 'capri_archive' }], usage: { inputTokens: 42, outputTokens: 3 }, requestId: 'req_synthetic' });
});
it('accepts a completed silent response and rejects interrupted or incomplete streams', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => sse([completed()])));
  expect(await streamResponse('synthetic', { model: 'a', input: [] }, signal())).toMatchObject({ text: '', calls: [] });
  vi.stubGlobal('fetch', vi.fn(async () => sse([{ type: 'response.output_text.delta', delta: 'partial' }])));
  await expect(streamResponse('synthetic', { model: 'a', input: [] }, signal())).rejects.toMatchObject({ code: 'stream_interrupted' });
  vi.stubGlobal('fetch', vi.fn(async () => sse([{ type: 'response.incomplete', response: {} }])));
  await expect(streamResponse('synthetic', { model: 'a', input: [] }, signal())).rejects.toMatchObject({ code: 'response_incomplete' });
});
it('recovers completed streamed items when SIWC returns an empty final output array', async () => {
  const call = { type: 'function_call', id: 'fc1', call_id: 'call1', name: 'find_memories', namespace: 'capri_archive', arguments: '{}' };
  const message = { type: 'message', id: 'm1', content: [{ type: 'output_text', text: 'Recovered reply' }] };
  vi.stubGlobal('fetch', vi.fn(async () => sse([
    { type: 'response.output_item.done', output_index: 0, item: call },
    { type: 'response.output_item.done', output_index: 1, item: message }, completed(),
  ])));
  expect(await streamResponse('synthetic', { model: 'a', input: [] }, signal())).toMatchObject({ text: 'Recovered reply', calls: [{ id: 'call1', name: 'find_memories' }] });
  vi.stubGlobal('fetch', vi.fn(async () => sse([{ type: 'response.output_item.done', output_index: 0, item: call }, completed([call])])));
  expect((await streamResponse('synthetic', { model: 'a', input: [] }, signal())).calls).toHaveLength(1);
  vi.stubGlobal('fetch', vi.fn(async () => sse([{ type: 'response.output_item.done', output_index: 0, item: call }])));
  await expect(streamResponse('synthetic', { model: 'a', input: [] }, signal())).rejects.toMatchObject({ code: 'stream_interrupted' });
});
it('preserves structured sharing-limit diagnostics without exposing arbitrary response text', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => sse([{ type: 'response.failed', response: { error: { code: 'subscription_sharing_usage_limit_exceeded', message: 'private prompt' } } }])));
  await expect(streamResponse('synthetic', { model: 'a', input: [] }, signal())).rejects.toMatchObject({ code: 'subscription_sharing_usage_limit_exceeded' });
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ error: { code: 'invalid_token', message: 'private token text' } }, { status: 401 })));
  try { await streamResponse('synthetic', { model: 'a', input: [] }, signal()); throw Error('unexpected success'); }
  catch (error) { expect(error).toBeInstanceOf(ChatGPTError); expect((error as ChatGPTError).message).not.toContain('private token'); expect((error as ChatGPTError).status).toBe(401); }
});
it('honors cancellation and never accepts a completed event after abort', async () => {
  const controller = new AbortController();
  vi.stubGlobal('fetch', vi.fn(async () => { controller.abort(); return sse([completed()]); }));
  await expect(streamResponse('synthetic', { model: 'a', input: [] }, controller.signal)).rejects.toMatchObject({ code: 'cancelled' });
});
it('provider enforces sign-in and sharing permission before model discovery', async () => {
  const client = { getSession: vi.fn(async () => ({ status: 'connected', sharing: false })), listModels: vi.fn() } as unknown as ChatGPTClient;
  await expect(new SiwcProvider(client).models(signal())).rejects.toThrow('authorize ChatGPT plan'); expect(client.listModels).not.toHaveBeenCalled();
});
it('provider encodes native call IDs and results and only exposes namespaced archive tools', async () => {
  const client = { streamResponse: vi.fn(async () => ({ text: '', calls: [] })) } as unknown as ChatGPTClient;
  const input = { identity: 'Capri', tools: ARCHIVE_TOOLS, records: [
    { id: 'c', sequence: 1, at: 1, kind: 'tool-call' as const, requestId: 'real-id', name: 'get_archive_statistics', arguments: '{}' },
    { id: 'r', sequence: 2, at: 2, kind: 'tool-result' as const, requestId: 'real-id', receipt: { id: 'real-id', at: 2, capability: 'read', outcome: 'completed' as const, detail: 'ok', dependencies: [] }, result: { count: 3 } },
  ] };
  const encoded = encodeInput(input); expect(encoded[0]).toMatchObject({ type: 'function_call', call_id: 'real-id', namespace: 'capri_archive' }); expect(encoded[1]).toMatchObject({ type: 'function_call_output', call_id: 'real-id' });
  await new SiwcProvider(client).infer({ id: 'available', label: 'a', contextTokens: 128000 }, input, signal(), () => {});
  expect(client.streamResponse).toHaveBeenCalledWith(expect.objectContaining({ tools: [expect.objectContaining({ type: 'namespace', name: 'capri_archive', tools: expect.arrayContaining([expect.objectContaining({ name: 'get_recent_observations' })]) })] }));
});

it('passes actual native function-call history through the SDK validator to the next HTTP request', async () => {
  let sent: any;
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => { sent = JSON.parse(init.body as string); return sse([completed()]); }));
  const input = [
    { type: 'function_call' as const, call_id: 'original-id', name: 'get_archive_statistics', namespace: 'capri_archive', arguments: '{}' },
    { type: 'function_call_output' as const, call_id: 'original-id', output: '{"receipt":{"outcome":"completed"},"result":{"count":3}}' },
  ];
  await expect(streamResponse('synthetic', { model: 'a', input }, signal())).resolves.toMatchObject({ calls: [] });
  expect(sent.input).toEqual(input);
});
it('rejects malformed native call/output items before a request is sent', async () => {
  const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
  await expect(streamResponse('synthetic', { model: 'a', input: [{ type: 'function_call_output', output: '{}' }] as any }, signal())).rejects.toMatchObject({ code: 'invalid_request' });
  expect(fetch).not.toHaveBeenCalled();
});

it('reports SIWC authentication independently of legacy offline settings and request errors', () => {
  expect(siwcConnection({ status: 'connected', sharing: true }, 'catalog-model')).toMatchObject({ state: 'connected', provider: 'ChatGPT (SIWC)', model: 'catalog-model' });
  expect(siwcConnection({ status: 'connected', sharing: false })).toMatchObject({ state: 'disconnected', detail: expect.stringContaining('enable ChatGPT plan') });
  expect(siwcConnection({ status: 'reauth_required', sharing: false }).state).toBe('error');
});

it('encodes attached original pixels and passes them through the real SDK validator to HTTP', async () => {
  let sent: any;
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => { sent = JSON.parse(init.body as string); return sse([completed()]); }));
  const input = { identity: 'Capri', tools: [], records: [], images: [{ observationId: 'original-pixels', dataUrl: 'data:image/jpeg;base64,YWJj' }] };
  const encoded = encodeInput(input);
  await streamResponse('synthetic', { model: 'a', input: encoded }, signal());
  expect(sent.input).toMatchObject([{ role: 'user', content: [{ type: 'input_text', text: expect.stringContaining('original-pixels') }, { type: 'input_image', image_url: 'data:image/jpeg;base64,YWJj', detail: 'auto' }] }]);
});

it('rejects conflicting, unfinished and interrupted completed-item calls without executing them', async () => {
  const call = { type: 'function_call', id: 'fc', call_id: 'one', name: 'find_memories', arguments: '{}', status: 'completed' };
  const done = (item: unknown, output_index = 0) => ({ type: 'response.output_item.done', output_index, item });
  for (const events of [
    [done(call), done({ ...call, arguments: '{"search":"different"}' }), completed()],
    [done(call), completed([{ ...call, arguments: '{"search":"different"}' }])],
    [done({ ...call, status: 'incomplete' }), completed()],
    [done({ ...call, status: 'in_progress' }), completed()],
    [done(call), { type: 'response.incomplete', response: {} }],
  ]) {
    vi.stubGlobal('fetch', vi.fn(async () => sse(events)));
    await expect(streamResponse('synthetic', { model: 'a', input: [] }, signal())).rejects.toBeInstanceOf(ChatGPTError);
  }
});
it('orders completed items by output index, deduplicates calls and retains metadata with diagnostics absent', async () => {
  const a = { type: 'function_call', id: 'fc-a', call_id: 'a', name: 'find_memories', arguments: '{}' };
  const b = { ...a, id: 'fc-b', call_id: 'b' };
  const message = { type: 'message', id: 'msg', content: [{ type: 'output_text', text: 'After the calls.' }] };
  vi.stubGlobal('fetch', vi.fn(async () => sse([
    { type: 'response.output_item.done', output_index: 2, item: message },
    { type: 'response.output_item.done', output_index: 1, item: b },
    { type: 'response.output_item.done', output_index: 0, item: a },
    completed([a,b,message]),
  ])));
  const result = await streamResponse('synthetic', { model: 'a', input: [] }, signal());
  expect(result.calls.map(c => c.id)).toEqual(['a','b']);
  expect(result.outputOrder).toEqual([{ type: 'call', callId: 'a' }, { type: 'call', callId: 'b' }, { type: 'text', text: 'After the calls.' }]);
  expect(result).toMatchObject({ requestId: 'req_synthetic', usage: { inputTokens: 42, outputTokens: 3 } });
});
it('sends no callable namespace during the reserved finishing response', async () => {
  let body: any;
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => { body = JSON.parse(init.body as string); return sse([completed()]); }));
  const client = { streamResponse: (options: any) => streamResponse('synthetic', options, signal()) } as ChatGPTClient;
  await new SiwcProvider(client).infer({ id: 'a', label: 'a' }, { identity: 'Finish', tools: [], records: [] }, signal(), () => {});
  expect(body.tools).toEqual([]);
});
