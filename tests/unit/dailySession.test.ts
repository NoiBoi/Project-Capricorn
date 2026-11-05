import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { archiveWorkerPath } from '../helpers/runtime2Archive';
vi.mock('electron', () => ({ app: {}, safeStorage: {}, shell: {} }));
import { DailySession } from '../../src/main/runtime2/dailySession';
import { SessionRecorder, renderDiagnosticReport } from '../../src/main/runtime2/diagnostics';
import { SiwcProvider } from '../../src/main/runtime2/siwcProvider';
import { streamResponse } from '../../src/vendor/siwc-local/responses';
import { CognitiveLoop } from '../../src/main/runtime2/cognitiveLoop';
import { WindowFocusArchive } from '../../src/main/runtime2/windowFocusArchive';
import { TypedCapabilityExecutor } from '../../src/core/capabilities';
import { selectRuntime } from '../../src/main/runtime2/selection';
import type { ChatGPTClient } from '../../src/vendor/siwc-local/types';
import type { DesktopHost } from '../../src/main/runtime2/perception';
import { Runtime2 } from '../../src/main/runtime2/runtime';
import { WindowFocusSource } from '../../src/main/runtime2/windowFocus';

const cleanup: (() => Promise<unknown> | void)[] = [];
afterEach(async () => { vi.unstubAllGlobals(); vi.restoreAllMocks(); for (const close of cleanup.splice(0).reverse()) await close(); });
function profile() { const home = fs.mkdtempSync(path.join(os.tmpdir(), 'capri-daily-')); cleanup.push(() => fs.rmSync(home, { recursive: true, force: true })); return selectRuntime({ CAPRI_RUNTIME: '2', CAPRI_V2_PROFILE_ID: 'daily-test' }, home).profile!; }
const model = { id: 'account-chat', label: 'Account Chat', contextTokens: 128000, supportsImages: true };
function events(recorder: SessionRecorder) { return fs.readFileSync(path.join(recorder.status.folder!, 'events.jsonl'), 'utf8').trim().split('\n').map(l => JSON.parse(l)); }

it('records exact HTTP context, streamed calls, failed capture, persisted memory, attention and movement without cloud use', async () => {
  const dir = profile(), daily = new DailySession(dir);
  await daily.configure({ ...daily.config, model: model.id, maxRequests: 2 });
  const archive = new WindowFocusArchive(dir, { workerPath: archiveWorkerPath }); await archive.initialize(); cleanup.push(() => archive.close());
  let fetchCalls = 0, userId = ''; const wire: any[] = [];
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
    const body = JSON.parse(init.body as string); wire.push(body); fetchCalls++;
    if (fetchCalls === 1) {
      userId = JSON.parse(body.input.find((r: any) => r.role === 'user').content).id;
      const calls = [
        { call_id: 'capture-fail', name: 'capture_window', arguments: '{"handle":"42"}' },
        { call_id: 'capture-repeat', name: 'capture_window', arguments: '{"handle":"42"}' },
        { call_id: 'remember', name: 'write_memory', arguments: JSON.stringify({ id: 'homework-intention', kind: 'intention', text: 'Review the controlled engineering problem', provenance: 'user-statement', evidence: [userId], status: 'active', dueAt: Date.now() + 86400000, expectedRevision: 0 }) },
        { call_id: 'pace', name: 'set_attention', arguments: '{"afterMs":180000,"durationMs":300000,"inferenceIntervalMs":180000,"observationIntervalMs":5000,"source":"all"}' },
        { call_id: 'move', name: 'move', arguments: '{"target":"corner"}' },
      ];
      const stream = calls.map((c, i) => ({ type: 'response.output_item.done', output_index: i, item: { type: 'function_call', id: 'fc-' + i, ...c, namespace: 'capri_archive' } }));
      return new Response([...stream, { type: 'response.completed', response: { output: [], usage: { input_tokens: 70, output_tokens: 20, input_tokens_details: { cached_tokens: 10 } } } }].map(e => 'data: ' + JSON.stringify(e) + '\n\n').join(''), { headers: { 'content-type': 'text/event-stream' } });
    }
    return new Response('data: ' + JSON.stringify({ type: 'response.completed', response: { output: [], usage: { input_tokens: 80, output_tokens: 1 } } }) + '\n\n', { headers: { 'content-type': 'text/event-stream' } });
  }));
  const client = { getSession: async () => ({ status: 'connected', sharing: true }), listModels: async () => [{ slug: model.id, displayName: model.label, contextWindow: model.contextTokens, supportsImages: true }], streamResponse: (options: any) => streamResponse('fixture-token', options, options.signal), cancelSignIn() {} } as unknown as ChatGPTClient;
  const capture = vi.fn(async () => { throw Error('Target window has no permitted exposed capture region.'); });
  const host: DesktopHost = { windows: () => [{ handle: '42', pid: 1, title: 'Controlled fixture', process: 'fixture.exe' }], active: () => '42', allowed: () => true, capture, move: async () => ({ ok: true, detail: 'Position measured', actualBounds: { x: 10, y: 20 } }), body: () => ({ bounds: { x: 10, y: 20 } }) };
  const loop = new CognitiveLoop(archive, new SiwcProvider(client, daily), new TypedCapabilityExecutor(), { daily, host, ambientMs: 180000 });
  cleanup.push(() => loop.shutdown()); await loop.initialize();
  await expect(loop.send('Cannot send while paused')).rejects.toThrow('paused');
  await daily.start({ fixture: true, model });
  const original = 'Review the engineering fixture. ' + 'Exact authorized context. '.repeat(1000);
  // User input has a 20,000 character safety bound.
  await loop.send(original.slice(0, 18000)); await expect.poll(() => loop.state.busy).toBe(false);
  expect(fetchCalls).toBe(2); expect(capture).toHaveBeenCalledTimes(1);
  const state = await archive.findState({}); expect(state).toMatchObject([{ id: 'homework-intention', revision: 1 }]);
  const results = wire[1].input.filter((r: any) => r.type === 'function_call_output').map((r: any) => JSON.parse(r.output));
  expect(results[0].result.error.message).toContain('exposed capture region');
  expect(results[1].result.error.code).toBe('capture_retry_suppressed');
  expect(results[2]).toMatchObject({ receipt: { outcome: 'completed' }, result: { id: 'homework-intention', revision: 1 } });
  expect(daily.status.usage).toMatchObject({ requests: 2, inputTokens: 150, outputTokens: 21, tokenTotalsIncomplete: false });
  await loop.send('A third request must be denied'); await expect.poll(() => loop.state.busy).toBe(false); expect(fetchCalls).toBe(2);
  await loop.quiesce(); await daily.stop();
  const recorded = events(daily.recorder);
  expect(recorded.filter(e => e.type === 'provider.request')).toHaveLength(2);
  expect(recorded.find(e => e.type === 'provider.denied').data.reason).toBe('session_request_limit');
  expect(recorded.filter(e => e.type === 'tool.end')).toHaveLength(5);
  expect(recorded.some(e => e.type === 'provider.stream' && e.data.type === 'response.output_item.done')).toBe(true);
  expect(recorded.some(e => e.type === 'provider.result' && e.data.outcome === 'silent')).toBe(true);
  expect(recorded.find(e => e.type === 'provider.result').data.usage.cachedInputTokens).toBe(10);
  expect(recorded.filter(e => e.type === 'context.selection')).toHaveLength(3);
  expect(recorded.filter(e => e.type === 'provider.request').map(e => e.data.wireUtf8Bytes))
    .toEqual(wire.map(body => Buffer.byteLength(JSON.stringify(body))));
  expect(wire[0].instructions).toBe(wire[1].instructions);
  expect(wire[0].tools[0].tools.find((tool: any) => tool.name === 'set_attention').parameters.type).toBe('object');
  expect(wire[0].input.some((item: any) => item.role === 'user' && JSON.parse(item.content).type === 'host_working_state')).toBe(true);
  const effective = recorded.filter(e => e.type.startsWith('request.wire-'));
  expect(JSON.parse(fs.readFileSync(path.join(daily.recorder.status.folder!, effective[0].data.file), 'utf8'))).toEqual(wire[0]);
  const metadata = path.join(daily.recorder.status.folder!, 'session.json');
  const stopped = fs.readFileSync(metadata, 'utf8');
  await daily.recorder.stop({ requests: 0 }, 'shutdown');
  expect(fs.readFileSync(metadata, 'utf8')).toBe(stopped);
  const before = fs.readFileSync(path.join(daily.recorder.status.folder!, 'events.jsonl'), 'utf8');
  daily.recorder.event('outside', { private: 'must not persist' }); await daily.recorder.flush();
  expect(fs.readFileSync(path.join(daily.recorder.status.folder!, 'events.jsonl'), 'utf8')).toBe(before);
  const html = fs.readFileSync(path.join(daily.recorder.status.folder!, 'report.html'), 'utf8');
  expect(html).toContain('Open exact inference record'); new Function(html.match(/<script>([\s\S]*)<\/script>/)![1]);
  const exported = JSON.parse(fs.readFileSync(await daily.recorder.exportRedacted(), 'utf8'));
  expect(JSON.stringify(exported)).not.toContain('controlled engineering'); expect(exported.events.length).toBe(recorded.length);
  await loop.shutdown(); await archive.close();
  const restored = new WindowFocusArchive(dir, { workerPath: archiveWorkerPath }); cleanup.push(() => restored.close()); await restored.initialize(); expect(await restored.findState({})).toEqual(state);
  const restart = new DailySession(dir); expect(restart.config.model).toBe(model.id); expect(restart.paused).toBe(true); expect(restart.recorder.status.active).toBe(false);
});

it('enforces hourly and reported-token ceilings, including continuation attempts, and marks missing usage', async () => {
  const daily = new DailySession(profile()); await daily.configure({ ...daily.config, model: model.id, requestsPerHour: 1, maxTokens: 10 }); await daily.start({ fixture: true });
  daily.requestIdentity('one'); daily.admit({ input: 'allowed' });
  expect(new DailySession(daily.profile).status.usage.requestsLastHour).toBe(1);
  expect(daily.status.usage.tokenTotalsIncomplete).toBe(true);
  expect(() => daily.admit({ input: 'denied' })).toThrow('hourly_request_limit');
  daily.usage({ inputTokens: 10, outputTokens: 1 }); expect(daily.status.usage.tokenTotalsIncomplete).toBe(false);
  daily.pause(); await daily.configure({ ...daily.config, requestsPerHour: 10 }); daily.resume();
  expect(() => daily.admit({ input: 'denied' })).toThrow('reported_token_limit');
  await daily.stop();
});

it('stops recording synchronously on privacy revocation and requires an explicit new session', async () => {
  const dir = profile(), daily = new DailySession(dir); await daily.configure({ ...daily.config, model: model.id });
  const host: DesktopHost = { windows: () => [], active: () => null, allowed: () => true, capture: async () => undefined, move: async () => ({ ok: false, detail: 'Fixture' }), body: () => null };
  const infer = vi.fn(async () => ({ text: '', calls: [] }));
  const runtime = new Runtime2({ executor: new TypedCapabilityExecutor() }, 'fixture', dir, { workerPath: archiveWorkerPath }, { provider: { models: async () => [model], infer, shutdown() {} }, options: { daily, host } });
  cleanup.push(() => runtime.shutdown()); const source = new WindowFocusSource(); await runtime.initialize(fn => source.subscribe(fn));
  await runtime.startDaily({ fixture: true }); source.sample({ handle: '1', title: 'Authorized fixture', process: 'fixture.exe' });
  await expect.poll(async () => (await runtime.archiveStatistics()).count).toBe(1);
  const revoked = runtime.revoke('screen');
  expect(daily.recorder.status.active).toBe(false); expect(daily.paused).toBe(true);
  await revoked; await daily.recorder.flush();
  const count = events(daily.recorder).length;
  source.sample({ handle: '2', title: 'Protected after revocation', process: 'fixture.exe' });
  await daily.recorder.flush(); expect(events(daily.recorder)).toHaveLength(count);
  expect(() => runtime.resumeDaily()).toThrow('Start a diagnostic session');
  expect(infer).not.toHaveBeenCalled();
});

it('externalizes image bytes, redacts credentials, remains offline-safe and stops on disk exhaustion', async () => {
  const recorder = new SessionRecorder(profile()); await recorder.start({ fixture: true }, 2 * 1024 ** 2);
  recorder.request('image', 'wire', { password: 'never persist', authorization: 'Bearer secret', input: [{ observationId: 'original', image: 'data:image/jpeg;base64,/9j/2Q==', text: '</script><script>unsafe()</script>' }] });
  await recorder.stop();
  const file = path.join(recorder.status.folder!, 'requests/image-wire.json');
  const text = fs.readFileSync(file, 'utf8'); expect(text).not.toContain('never persist'); expect(text).not.toContain('/9j/2Q=='); expect(text).toContain('imageFile');
  const image = JSON.parse(text).input[0].image; expect(fs.readFileSync(path.join(recorder.status.folder!, image.imageFile))).toEqual(Buffer.from('/9j/2Q==','base64'));
  expect(renderDiagnosticReport({ events: [], metadata: '</script><script>unsafe()</script>' })).not.toContain('</script><script>unsafe');
  await recorder.start({ fixture: true }, 2 * 1024 ** 2); recorder.event('large', { text: 'x'.repeat(3 * 1024 ** 2) });
  expect(recorder.status.active).toBe(false); expect(recorder.status.error).toContain('budget'); await recorder.stop();
});
