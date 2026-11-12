import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { archiveWorkerPath } from '../helpers/runtime2Archive';
import { WindowFocusArchive } from '../../src/main/runtime2/windowFocusArchive';
import { CognitiveLoop, type CognitionMode } from '../../src/main/runtime2/cognitiveLoop';
import { TypedCapabilityExecutor } from '../../src/core/capabilities';
import type { CognitiveProvider, ModelInput } from '../../src/main/runtime2/cognitiveContracts';
import type { DesktopHost } from '../../src/main/runtime2/perception';
import { recallDialogue, recallQuery } from '../../src/main/runtime2/dialogueRecall';

const cleanup: (() => unknown)[] = [];
afterEach(async () => { for (const fn of cleanup.splice(0).reverse()) await fn(); vi.restoreAllMocks(); });
const call = (id: string, name: string, args: unknown = {}) => ({ id, name, arguments: JSON.stringify(args) });
async function fixture(infer: CognitiveProvider['infer'], cognition?: CognitionMode) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'capri-companion-'));
  cleanup.push(() => fs.rmSync(root, { recursive: true, force: true }));
  const archive = new WindowFocusArchive(path.join(root, 'Capri Buddy 2.0 Synthetic', 'companion'), { workerPath: archiveWorkerPath });
  await archive.initialize(); cleanup.push(() => archive.close());
  const clock = { now: Date.now() }; vi.spyOn(Date, 'now').mockImplementation(() => clock.now);
  const host: DesktopHost = { windows: () => [], active: () => null, allowed: () => true, body: () => ({}), capture: async () => undefined, move: async () => ({ ok: true, detail: 'fixture' }) };
  const inputs: ModelInput[] = [];
  const events: { channel: string; payload: any }[] = [];
  const loop = new CognitiveLoop(archive, { models: async () => [{ id: 'fixture', label: 'Fixture', contextTokens: 128000 }], shutdown() {}, infer: async (...args) => { inputs.push(args[1]); return infer(...args); } }, new TypedCapabilityExecutor(), { cognition, host, model: 'fixture', ambientMs: 10000, emit: (channel, payload) => events.push({ channel, payload }) });
  await loop.initialize(); clearInterval((loop as any).timer); cleanup.push(() => loop.shutdown());
  async function idle() { await expect.poll(() => loop.state.busy).toBe(false); }
  async function event() { loop.notifyObservation(true, 'screen', 'reactor'); clock.now += 40000; (loop as any).tick(); await idle(); }
  await archive.appendConversation({ id: 'reactor-history', at: clock.now - 10000, kind: 'user', text: 'The sapphire reactor has three coolant loops.' });
  return { archive, loop, inputs, events, clock, host, idle, event };
}

it('reads original evidence in ordinary company, then finishes without a durable investigation or action follow-up', async () => {
  let n = 0;
  const f = await fixture(async () => ++n === 1 ? { text: '', calls: [call('read', 'retrieve_evidence', { observationId: 'reactor-history' })] }
    : { text: 'Three loops, then.', calls: [call('react', 'react', { emotion: 'curious' })] });
  await f.event();
  expect(f.inputs).toHaveLength(2);
  expect(f.inputs[0].tools.map(t => t.name)).toContain('retrieve_evidence');
  expect(f.inputs[1].tools.map(t => t.name)).not.toContain('retrieve_evidence');
  expect(f.inputs[1].records).toContainEqual(expect.objectContaining({ kind: 'tool-result', requestId: 'read', result: expect.objectContaining({ dialogue: expect.objectContaining({ text: 'The sapphire reactor has three coolant loops.' }) }) }));
  expect(await f.archive.findState()).toEqual([]);
  expect(f.events.filter(e => e.channel === 'runtime2:speak').map(e => e.payload.text)).toEqual(['Three loops, then.']);
});

it('enforces two evidence reads and one continuation even if the model asks for more', async () => {
  let n = 0;
  const f = await fixture(async () => ({ text: '', calls: ++n === 1
    ? [call('one', 'retrieve_evidence', { observationId: 'reactor-history' }), call('two', 'find_memories'), call('three', 'find_memories')]
    : [call('four', 'retrieve_evidence', { observationId: 'reactor-history' })] }));
  await f.event(); expect(f.inputs).toHaveLength(2);
  const results = (await f.archive.conversation()).records.filter(r => r.kind === 'tool-result');
  expect(results.map(r => r.kind === 'tool-result' && [r.requestId, r.receipt.outcome])).toEqual([['one', 'completed'], ['two', 'completed'], ['three', 'denied'], ['four', 'denied']]);
});

it('supplies a failed read outcome without retrying or requiring a memory write', async () => {
  let n = 0;
  const f = await fixture(async () => ++n === 1 ? { text: '', calls: [call('missing', 'retrieve_evidence', { observationId: 'missing-history' })] } : { text: '', calls: [] });
  await f.event(); expect(f.inputs).toHaveLength(2);
  expect(JSON.stringify(f.inputs[1])).toContain('missing-history');
  expect(await f.archive.findState()).toEqual([]);
});

it('keeps action-only decisions to one request and retains two-speed as an explicit comparison mode', async () => {
  const f = await fixture(async () => ({ text: '', calls: [call('attend', 'set_attention', { action: 'cancel' })] }), 'two-speed');
  await f.event(); expect(f.inputs).toHaveLength(1);
  expect(f.inputs[0].tools.some(t => t.name === 'retrieve_evidence')).toBe(false);
  expect(f.inputs[0].tools.some(t => t.name === 'investigate')).toBe(true);
});

it('allows a successful explicit investigation after the small read and supplies full tools', async () => {
  let n = 0;
  const f = await fixture(async () => {
    n++;
    if (n === 1) return { text: '', calls: [call('read', 'retrieve_evidence', { observationId: 'reactor-history' })] };
    if (n === 2) return { text: '', calls: [call('deeper', 'investigate', { id: 'reactor-question', expectedRevision: 0, question: 'Why three loops?', stoppingCondition: 'Find the design reason or stop if unavailable.', evidence: ['reactor-history'] })] };
    return { text: '', calls: [] };
  });
  await f.event(); expect(f.inputs).toHaveLength(3);
  expect(f.inputs[2].tools.some(t => t.name === 'read_activity')).toBe(true);
  expect(await f.archive.findState({ kind: 'investigation' })).toMatchObject([{ id: 'reactor-question', status: 'active' }]);
});

it('does not open a deep loop for a rejected investigation', async () => {
  const f = await fixture(async () => ({ text: '', calls: [call('invalid', 'investigate', { id: 'bad' })] }));
  await f.event(); expect(f.inputs).toHaveLength(1); expect(await f.archive.findState()).toEqual([]);
});

it('blocks optional wakes while speech is queued/playing, ignores stale end events, and spaces after playback', async () => {
  const f = await fixture(async () => ({ text: '', calls: [] }));
  f.loop.speech('old', 'queued'); f.loop.speech('new', 'queued'); f.loop.speech('old', 'end');
  await f.event(); expect(f.inputs).toHaveLength(0);
  f.loop.speech('new', 'start'); await f.event(); expect(f.inputs).toHaveLength(0);
  f.loop.speech('new', 'end'); (f.loop as any).tick(); await f.idle(); expect(f.inputs).toHaveLength(0);
  f.clock.now += 3000; (f.loop as any).tick(); await f.idle(); expect(f.inputs).toHaveLength(1);
});

it('recovers from missing playback events and gives direct input priority over queued speech', async () => {
  const f = await fixture(async () => ({ text: '', calls: [] }));
  f.loop.speech('lost', 'queued'); await f.event(); expect(f.inputs).toHaveLength(0);
  await f.loop.send('A direct question'); await f.idle(); expect(f.inputs).toHaveLength(1);
  f.clock.now += 120000; (f.loop as any).tick(); await f.idle();
  f.clock.now += 3000; await f.event(); expect(f.inputs).toHaveLength(2);
});

it('keeps an earlier long utterance busy when a later queued utterance expires', async () => {
  const f = await fixture(async () => ({ text: '', calls: [] }));
  f.loop.speech('long', 'queued'); f.loop.speech('long', 'start'); f.loop.speech('later', 'queued');
  f.clock.now += 121000; await f.event(); expect(f.inputs).toHaveLength(0);
  f.loop.speech('long', 'end'); f.clock.now += 3000; (f.loop as any).tick(); await f.idle(); expect(f.inputs).toHaveLength(1);
});

it('automatically recalls attributed original dialogue outside direct recent context without another model call', async () => {
  const f = await fixture(async () => ({ text: '', calls: [] }));
  await f.archive.appendConversation({ id: 'old-view', at: f.clock.now - 9000, kind: 'assistant', text: 'I dislike the sapphire reactor layout.' });
  for (let i = 0; i < 70; i++) await f.archive.appendConversation({ id: 'noise-' + i, at: f.clock.now - 8000 + i, kind: i % 2 ? 'assistant' : 'user', text: 'An unrelated weather discussion.' });
  await f.loop.send('What did we say about the sapphire reactor?'); await f.idle();
  expect(f.inputs).toHaveLength(1);
  expect(f.inputs[0].workingState).toMatchObject({ recalledDialogue: [expect.objectContaining({ id: 'reactor-history', kind: 'user' }), expect.objectContaining({ id: 'old-view', kind: 'assistant' })] });
  expect((f.inputs[0].workingState as any).recallPolicy).toContain('Earlier assistant claims do not prove user facts');
  expect(f.inputs[0].records.some(r => r.id === 'old-view')).toBe(false);
});

it('excludes already supplied dialogue and removes recall if conversation disclosure is revoked during a read', async () => {
  const f = await fixture(async () => ({ text: '', calls: [] }));
  await f.archive.appendConversation({ id: 'new-query', at: f.clock.now, kind: 'user', text: 'Sapphire reactor' });
  const recent = (await f.archive.conversation(1, true)).records;
  let allowed = true;
  const exchange = f.archive.dialogueExchange.bind(f.archive);
  vi.spyOn(f.archive, 'dialogueExchange').mockImplementation(async id => { const result = await exchange(id); allowed = false; return result; });
  expect(await recallDialogue(f.archive, recent, new AbortController().signal, () => allowed)).toEqual([]);
  expect(await recallDialogue(f.archive, recent, new AbortController().signal, () => false)).toEqual([]);
});

it('bounds recovered exchanges without truncating original quotes and keeps queries literal', async () => {
  const f = await fixture(async () => ({ text: '', calls: [] }));
  await f.archive.appendConversation({ id: 'oversize', at: f.clock.now - 100, kind: 'user', text: 'Sapphire reactor ' + 'x'.repeat(5000) });
  await f.archive.appendConversation({ id: 'query', at: f.clock.now, kind: 'user', text: 'Sapphire reactor' });
  const recalled = await recallDialogue(f.archive, (await f.archive.conversation(1, true)).records, new AbortController().signal, () => true);
  expect(Buffer.byteLength(JSON.stringify(recalled))).toBeLessThanOrEqual(3500);
  expect(recalled.some(r => r.id === 'oversize')).toBe(false);
  expect(recallQuery('What did we say about the sapphire reactor?')).toContain('sapphire reactor');
});

it('keeps optional recall failures from blocking a direct reply while preserving cancellation', async () => {
  const f = await fixture(async () => ({ text: 'A current answer.', calls: [] }));
  vi.spyOn(f.archive, 'discover').mockRejectedValue(Error('Optional index unavailable'));
  await f.loop.send('Sapphire reactor?'); await f.idle();
  expect(f.inputs).toHaveLength(1); expect(f.loop.state.phase).toBe('idle');
  const controller = new AbortController(); controller.abort();
  await expect(recallDialogue(f.archive, f.inputs[0].records, controller.signal, () => true)).rejects.toThrow();
});
