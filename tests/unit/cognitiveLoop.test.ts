import { Worker } from 'node:worker_threads';
import { archiveWorkerPath } from '../helpers/runtime2Archive';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { WindowFocusArchive } from '../../src/main/runtime2/windowFocusArchive';
import { CognitiveLoop, safeFailure } from '../../src/main/runtime2/cognitiveLoop';
import { TypedCapabilityExecutor } from '../../src/core/capabilities';
import { WindowFocusSource } from '../../src/main/runtime2/windowFocus';
import { Runtime2 } from '../../src/main/runtime2/runtime';
import { selectRuntime } from '../../src/main/runtime2/selection';
import { assembleContext, approximateTokens, IDENTITY, selectModel } from '../../src/main/runtime2/context';
import { ARCHIVE_TOOLS } from '../../src/main/runtime2/archiveTools';
import type { CognitiveProvider, ModelInput, ProviderResult, ConversationRecord } from '../../src/main/runtime2/cognitiveContracts';
const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => { for (const f of cleanup.splice(0).reverse()) await f(); vi.restoreAllMocks(); });
const model = { id: 'account-chat-model', label: 'Conversational', contextTokens: 128_000 };
function provider(infer: CognitiveProvider['infer'] = async () => ({ text: '', calls: [] })): CognitiveProvider { return { models: vi.fn(async () => [model]), infer: vi.fn(infer), shutdown: vi.fn() }; }
async function fixture(p = provider(), options = {}) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'capri-cognition-'));
  cleanup.push(async () => fs.rmSync(home, { recursive: true, force: true }));
  const profile = selectRuntime({ CAPRI_RUNTIME: '2' }, home).profile!;
  const create = async () => { const a = new WindowFocusArchive(profile, { workerPath: archiveWorkerPath }); cleanup.push(() => a.close()); await a.initialize(); return a; };
  const a = await create(); const events: { channel: string; payload: any }[] = [];
  const loop = new CognitiveLoop(a, p, new TypedCapabilityExecutor(), { model: model.id, ambientMs: 30, emit: (channel, payload) => events.push({ channel, payload }), ...options });
  cleanup.push(() => loop.shutdown()); await loop.initialize();
  return { a, create, loop, events, profile };
}
async function idle(loop: CognitiveLoop) { await expect.poll(() => loop.state.busy).toBe(false); }
it('persists dialogue, stable identity and exact chronology across worker restart', async () => {
  const p = provider(async (_m, _i, _s, delta) => { delta('Hello'); return { text: 'Hello', calls: [] }; });
  const { a, create, loop, events } = await fixture(p);
  const id = loop.id; const userId = await loop.send('Who are you?'); await idle(loop);
  expect(events.some(e => e.channel === 'chat:delta' && e.payload.delta === 'Hello')).toBe(true);
  const page = await a.conversation();
  expect(page.records.map(r => r.kind)).toEqual(['user','assistant']);
  expect(page.records[0].id).toBe(userId); expect(page.records.map(r => r.sequence)).toEqual([1,2]);
  await loop.shutdown(); await a.close(); const b = await create();
  expect(await b.conversation()).toEqual(page); expect((await b.conversation()).id).toBe(id);
});
it('passes a real source observation to inference and executes sequential archive retrieval with actual receipts', async () => {
  const inputs: ModelInput[] = []; let round = 0;
  const p = provider(async (_m, input) => {
    inputs.push(input); round++;
    if (round === 1) return { text: '', calls: [{ id: 'call-recent', name: 'get_recent_observations', arguments: '{}' }] };
    if (round === 2) return { text: '', calls: [{ id: 'call-search', name: 'search_observations', arguments: '{"search":"editor"}' }] };
    return { text: 'Your editor caught my eye.', calls: [] };
  });
  const { a, loop, create } = await fixture(p, { ambientMs: 60_000 });
  const source = new WindowFocusSource(); let observed: any;
  source.subscribe(o => { observed = o; }); source.sample({ handle: '5', title: 'Original evidence', process: 'editor.exe', pid: 42 }, 100);
  await a.write(observed); loop.notifyObservation();
  await loop.send('What did you notice?'); await idle(loop);
  expect(inputs[0].records.find(r => r.kind === 'observation')).toMatchObject({ observationId: observed.id, observation: observed });
  expect(inputs[0].identity).toContain('CAPRI:');
  expect(inputs[1].records.find(r => r.kind === 'tool-result')).toMatchObject({ requestId: 'call-recent', receipt: { outcome: 'completed' }, result: { observations: [observed] } });
  expect(inputs[2].records.filter(r => r.kind === 'tool-result')).toHaveLength(2);
  const page = await a.conversation(); await loop.shutdown(); await a.close(); const b = await create(); expect(await b.conversation()).toEqual(page);
});
it('coalesces observations, allows silence, and preserves arrivals during a single-flight request', async () => {
  let release!: (r: ProviderResult) => void; let active = 0; let max = 0; let calls = 0;
  const p = provider(async () => { calls++; active++; max = Math.max(max, active); if (calls === 1) await new Promise<ProviderResult>(resolve => { release = resolve; }); active--; return { text: '', calls: [] }; });
  const { loop, events } = await fixture(p);
  loop.notifyObservation(); loop.notifyObservation(); loop.notifyObservation();
  await expect.poll(() => calls).toBe(1);
  loop.notifyObservation(); await loop.send('Immediate follow-up');
  expect(calls).toBe(1); release({ text: '', calls: [] });
  await expect.poll(() => calls).toBe(2); await idle(loop);
  expect(max).toBe(1); expect(events.some(e => e.channel === 'chat:done')).toBe(false);
});
it('direct messages bypass the ambient delay and provider failures preserve them', async () => {
  const p = provider(async () => { throw { code: 'subscription_sharing_usage_limit_exceeded', status: 429, requestId: 'req_test', message: 'secret should not appear' }; });
  const { a, loop, events } = await fixture(p, { ambientMs: 60_000 });
  await loop.send('Keep this'); await idle(loop);
  expect(p.infer).toHaveBeenCalledTimes(1);
  expect((await a.conversation()).records).toMatchObject([{ kind: 'user', text: 'Keep this' }]);
  const failure = events.find(e => e.payload.phase === 'error')!.payload.detail;
  expect(failure).toContain('subscription_sharing_usage_limit_exceeded'); expect(failure).toContain('429'); expect(failure).not.toContain('secret');
});
it('records failed argument validation and unknown tools as actual failed receipts', async () => {
  let calls = 0;
  const p = provider(async () => ++calls === 1 ? { text: '', calls: [
    { id: 'bad1', name: 'search_observations', arguments: '{"limit":9999}' },
    { id: 'bad2', name: 'shell', arguments: '{}' },
  ] } : { text: '', calls: [] });
  const { a, loop } = await fixture(p);
  await loop.send('Investigate'); await idle(loop);
  const results = (await a.conversation()).records.filter(r => r.kind === 'tool-result');
  expect(results).toHaveLength(2); expect(results.every(r => r.kind === 'tool-result' && r.receipt.outcome === 'failed')).toBe(true);
});
it('bounds sequential tool rounds and records a denied receipt for calls beyond the limit', async () => {
  let calls = 0; const p = provider(async () => ({ text: '', calls: [{ id: 'bounded' + ++calls, name: 'get_archive_statistics', arguments: '{}' }] }));
  const { a, loop } = await fixture(p); await loop.send('Investigate'); await idle(loop);
  expect(calls).toBe(6);
  const results = (await a.conversation()).records.filter(r => r.kind === 'tool-result');
  expect(results).toHaveLength(6); expect(results.slice(0,5).every(r => r.kind === 'tool-result' && r.receipt.outcome === 'completed')).toBe(true); expect(results.at(-1)).toMatchObject({ receipt: { outcome: 'denied' } });
});
it('cancels on shutdown without late assistant mutations or lost user messages', async () => {
  let entered = false;
  const p = provider(async (_m, _i, signal) => { entered = true; await new Promise<void>(resolve => signal.addEventListener('abort', () => resolve(), { once: true })); return { text: 'late text', calls: [] }; });
  const { a, loop, events } = await fixture(p); await loop.send('Persist before failure'); await expect.poll(() => entered).toBe(true);
  await loop.shutdown(); const count = events.length;
  expect((await a.conversation()).records.map(r => r.kind)).toEqual(['user']); expect(events).toHaveLength(count); expect(p.shutdown).toHaveBeenCalledOnce();
});
it('recovers interrupted tool calls with unknown receipts instead of invented success', async () => {
  const { a, loop } = await fixture(); await loop.shutdown();
  await a.appendConversation({ id: 'unfinished', at: 1, kind: 'tool-call', requestId: 'old-call', name: 'get_archive_statistics', arguments: '{}' });
  const next = new CognitiveLoop(a, provider(), new TypedCapabilityExecutor(), { model: model.id }); cleanup.push(() => next.shutdown()); await next.initialize();
  expect((await a.conversation()).records.at(-1)).toMatchObject({ kind: 'tool-result', requestId: 'old-call', receipt: { outcome: 'unknown' } });
});
it('Runtime2 connects its collector only after archive initialization and triggers the cognitive loop', async () => {
  const p = provider(); const { loop, a, profile } = await fixture(); await loop.shutdown(); await a.close();
  const source = new WindowFocusSource(); const runtime = new Runtime2({ executor: new TypedCapabilityExecutor() }, 'test', profile, { workerPath: archiveWorkerPath }, { provider: p, options: { model: model.id, ambientMs: 20 } });
  cleanup.push(() => runtime.shutdown()); await runtime.initialize(listener => source.subscribe(listener));
  source.sample({ handle: '1', title: 'Source to model', process: 'native.exe' }, Date.now());
  await expect.poll(() => vi.mocked(p.infer).mock.calls.length).toBe(1);
  expect(vi.mocked(p.infer).mock.calls[0][1].records.some(r => r.kind === 'observation' && r.observation?.content.title === 'Source to model')).toBe(true);
});
it('keeps identity pinned, trims whole tool groups, and enforces context capacity and output headroom', () => {
  const fixed = approximateTokens({ identity: IDENTITY, tools: ARCHIVE_TOOLS });
  const records: ConversationRecord[] = [
    { id: 'old', at: 1, sequence: 1, kind: 'assistant', text: 'x'.repeat(20_000) },
    { id: 'call', at: 2, sequence: 2, kind: 'tool-call', requestId: 'c', name: 'get_archive_statistics', arguments: '{}' },
    { id: 'result', at: 3, sequence: 3, kind: 'tool-result', requestId: 'c', receipt: { id: 'c', at: 3, capability: 'read', outcome: 'completed', detail: 'ok', dependencies: [] }, result: { count: 1 } },
    { id: 'user', at: 4, sequence: 4, kind: 'user', text: 'Hello' },
  ];
  const input = assembleContext(records, { ...model, contextTokens: fixed + 8192 + 1000 }, ARCHIVE_TOOLS);
  expect(input.identity).toBe(IDENTITY); expect(input.records.map(r => r.id)).toEqual(['call','result','user']);
  expect(records).toHaveLength(4);
  expect(() => assembleContext(records, { ...model, contextTokens: undefined }, ARCHIVE_TOOLS)).toThrow('verified');
  expect(() => assembleContext(records, model, ARCHIVE_TOOLS, fixed - 1)).toThrow('pinned identity');
});
it('validates model selection against the actual catalog and excludes specialized models', () => {
  expect(selectModel([model], model.id)).toEqual(model);
  expect(() => selectModel([model])).toThrow('CAPRI_V2_MODEL');
  expect(() => selectModel([model], 'unavailable')).toThrow('not available');
  expect(() => selectModel([{ ...model, id: 'gpt-codex' }], 'gpt-codex')).toThrow('general-purpose');
  expect(safeFailure(Error('Bearer private-token'))).not.toContain('private-token');
});

it('migrates an actual Phase 2 schema without changing original observations and rejects reused tool IDs durably', async () => {
  const { a, loop, create, profile } = await fixture(); await loop.shutdown();
  const source = new WindowFocusSource(); let original: any;
  source.subscribe(o => { original = o; }); source.sample({ handle: '42', title: 'Phase 2 evidence', process: 'editor.exe' }, 100);
  original.id = 'x'.repeat(256);
  await a.write(original); await a.close();
  // Remove only Phase 3 tables in a worker, recreating the Phase 2 on-disk schema.
  const worker = new Worker(`const {workerData}=require('node:worker_threads'); const {DatabaseSync}=require('node:sqlite'); const db=new DatabaseSync(workerData); db.exec('DROP TABLE conversation_records; DROP TABLE logical_conversation; PRAGMA user_version=1;'); db.close();`, { eval: true, workerData: path.join(profile, 'runtime2', 'experience.sqlite') });
  await new Promise<void>((resolve,reject) => { worker.once('exit', code => code === 0 ? resolve() : reject(Error('Fixture worker failed'))); worker.once('error',reject); });
  const b = await create(); expect(await b.get(original.id)).toEqual(original);
  expect((await b.conversation()).records).toMatchObject([{ kind: 'observation', observationId: original.id, observation: original }]);
  await b.appendConversation({ id: 'first-call', at: 1, kind: 'tool-call', requestId: 'stable-call', name: 'get_archive_statistics', arguments: '{}' });
  await expect(b.appendConversation({ id: 'replay-call', at: 2, kind: 'tool-call', requestId: 'stable-call', name: 'get_archive_statistics', arguments: '{}' })).rejects.toThrow();
  await b.appendConversation({ id: 'user', at: 2, kind: 'user', text: 'Keep dialogue visible' });
  expect((await b.conversation(1, true)).records).toMatchObject([{ kind: 'user', text: 'Keep dialogue visible' }]);
});

it('keeps ambient observations arriving during inference pending for the next opportunity', async () => {
  let release!: () => void; let calls = 0;
  const p = provider(async () => { if (++calls === 1) await new Promise<void>(resolve => { release = resolve; }); return { text: '', calls: [] }; });
  const { loop } = await fixture(p); loop.notifyObservation(); await expect.poll(() => calls).toBe(1);
  loop.notifyObservation(); loop.notifyObservation(); release();
  await expect.poll(() => calls).toBe(2); await idle(loop); expect(calls).toBe(2);
});
it('bounds a request with a timeout, preserving the user record', async () => {
  const p = provider(async (_m, _i, signal) => { await new Promise<void>(resolve => signal.addEventListener('abort', () => resolve(), { once: true })); signal.throwIfAborted(); return { text: '', calls: [] }; });
  const { a, loop, events } = await fixture(p, { timeoutMs: 50, ambientMs: 60000 });
  await loop.send('Keep me'); await idle(loop);
  expect((await a.conversation()).records).toMatchObject([{ kind: 'user', text: 'Keep me' }]);
  expect(events.some(e => e.payload.detail?.includes('timed out'))).toBe(true);
});

it('persists model output chronology before real tool outcomes', async () => {
  let n=0;const p=provider(async()=>++n===1?{text:'Inspecting.',calls:[{id:'ordered',name:'get_archive_statistics',arguments:'{}'}],outputOrder:[{type:'call',callId:'ordered'},{type:'text',text:'Inspecting.'}]}:{text:'Done.',calls:[]});
  const {a,loop}=await fixture(p);await loop.send('Inspect');await idle(loop);
  expect((await a.conversation()).records.map(r=>r.kind)).toEqual(['user','tool-call','assistant','tool-result','assistant']);
});
