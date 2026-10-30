import { describe, expect, it, vi } from 'vitest';
import { MemoryLearning, parseLearning } from '../../src/main/ai/memoryLearning';
import { MemoryStore } from '../../src/main/store/dataStores';
import { DEFAULT_SETTINGS } from '../../src/shared/settings';
import { nullLogger } from '../../src/main/log';
import { tmpDir } from './helpers';
import type { LLMMessage, GenOptions } from '../../src/main/ai/providers';
const change = (text = 'Enjoys road cycling', evidence = 'I enjoy road cycling') => ({ op: 'add', text, evidence, kind: 'preference' });
function harness(reply: (messages: LLMMessage[], options: GenOptions) => Promise<string> | string) {
  const settings = structuredClone(DEFAULT_SETTINGS); settings.memory.autoLearn = true;
  const memory = new MemoryStore(tmpDir());
  const stream = vi.fn(async function* (messages: LLMMessage[], options: GenOptions) { yield await reply(messages, options); });
  const provider = { name: 'mock', local: true, stream, async test() { return { ok: true, detail: '' }; }, async listModels() { return []; } };
  const learner = new MemoryLearning({ settings: () => settings, provider: () => provider, memory, log: nullLogger });
  return { learner, memory, settings, stream };
}
describe('automatic conversational memory', () => {
  it('adds explicit facts, corrects the original entry and can undo across restart', async () => {
    let operation: object = change();
    const h = harness(() => JSON.stringify({ changes: [operation] }));
    await h.learner.learn('I enjoy road cycling', 'message1', new AbortController().signal);
    const first = structuredClone(h.memory.list()[0]); expect(first.learnedFrom?.messageId).toBe('message1');
    operation = { op: 'update', id: first.id, text: 'Now prefers trail running', kind: 'preference', evidence: 'I prefer trail running now' };
    await h.learner.learn('I prefer trail running now', 'message2', new AbortController().signal);
    expect(h.memory.approved()).toHaveLength(1); expect(h.memory.approved()[0].text).toBe('Now prefers trail running');
    h.memory.undo(first.id); expect(h.memory.approved()[0].text).toBe(first.text);
    expect(h.memory.approved()[0].learnedFrom).toEqual(first.learnedFrom);
  });
  it('forgets explicitly, excludes the old fact and can restore it', async () => {
    const h = harness(messages => { const id = JSON.parse(messages[1].content).existing_memories[0].id; return JSON.stringify({ changes: [{ op: 'forget', id, text: '', kind: 'fact', evidence: 'Forget my old school' }] }); });
    const old = h.memory.add('Attends old school', 'user');
    await h.learner.learn('Forget my old school', 'm', new AbortController().signal);
    expect(h.memory.approved()).toEqual([]); expect(h.memory.list()[0].archived).toBe(true);
    h.memory.undo(old.id); expect(h.memory.approved()[0].text).toBe(old.text);
  });
  it('does not learn when disabled, off the record, cancelled or given an unsupported evidence quote', async () => {
    const h = harness(() => JSON.stringify({ changes: [change()] }));
    h.settings.memory.autoLearn = false; await h.learner.learn('I enjoy road cycling', 'm', new AbortController().signal);
    h.settings.memory.autoLearn = true; await h.learner.learn("Off the record, I enjoy road cycling", 'm', new AbortController().signal);
    await h.learner.learn('I enjoy road cycling', 'm', AbortSignal.abort());
    expect(h.stream).not.toHaveBeenCalled();
    await h.learner.learn('A different sentence', 'm', new AbortController().signal); expect(h.memory.list()).toEqual([]);
  });
  it('preserves manual edits and forget-all made during a pending extraction', async () => {
    let release!: (s: string) => void;
    const h = harness(() => new Promise<string>(r => release = r));
    const old = h.memory.add('Old fact', 'user');
    const pending = h.learner.learn('Here is my new fact', 'm', new AbortController().signal);
    h.memory.clear(); release(JSON.stringify({ changes: [{ op: 'update', id: old.id, text: 'New fact', evidence: 'new fact', kind: 'fact' }, change('Another fact', 'new fact')] }));
    await pending; expect(h.memory.list()).toEqual([]);
  });
  it('rejects invalid JSON, tool output, credentials and fabricated forget evidence', async () => {
    expect(() => parseLearning('<action>{}</action>', 'Hi')).toThrow();
    expect(parseLearning(JSON.stringify({ changes: [change('API key is sk-test123', 'my API key')] }), 'my API key')).toEqual([]);
    expect(parseLearning(JSON.stringify({ changes: [{ ...change(), op: 'forget' }] }), 'I enjoy road cycling')).toEqual([]);
    const h = harness(() => '{broken'); await h.learner.learn('I enjoy road cycling', 'm', new AbortController().signal); expect(h.memory.list()).toEqual([]);
  });
  it('does not allow an add operation to overwrite an existing id', () => {
    const h = harness(() => ''); const old = h.memory.add('Old fact', 'user');
    expect(h.memory.learn({ op: 'add', id: old.id, text: 'Wrong', kind: 'fact', evidence: 'Wrong' }, 'm', structuredClone(h.memory.list()))).toBe(false);
    expect(h.memory.approved()[0].text).toBe('Old fact');
  });
  it('persists automatic revisions and undo through reloads', () => {
    const dir = tmpDir(); let memory = new MemoryStore(dir);
    memory.importProfile([{ text: 'Lives in Austin', kind: 'fact' }], 'Original profile', '2026-10-26');
    const original = memory.list()[0], snapshot = structuredClone(memory.list());
    expect(memory.learn({ op: 'update', id: original.id, text: 'Lives in Boston', kind: 'fact', evidence: 'I moved to Boston' }, 'message', snapshot)).toBe(true);
    memory = new MemoryStore(dir); expect(memory.approved()[0].text).toBe('Lives in Boston');
    memory.undo(original.id); memory = new MemoryStore(dir);
    expect(memory.approved()[0]).toMatchObject({ text: 'Lives in Austin', context: { label: 'Original profile' } });
    expect(memory.approved()[0].learnedFrom).toBeUndefined();
  });

});
