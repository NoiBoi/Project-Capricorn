import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { RelationshipStore, RetiredLines } from '../../src/main/store/relationship';
import { lineRetirementRequest } from '../../src/shared/relationship';
import { MemoryLearning } from '../../src/main/ai/memoryLearning';
import { MemoryStore, HistoryStore } from '../../src/main/store/dataStores';
import { DEFAULT_SETTINGS } from '../../src/shared/settings';
import { nullLogger } from '../../src/main/log';
import { tmpDir } from './helpers';
import { Conversation } from '../../src/main/ai/conversation';
import { makeCtx } from './ctx';
import { DialogueDirector } from '../../src/shared/dialogue';
import type { LLMMessage } from '../../src/main/ai/providers';
const source = (role: 'user' | 'assistant', evidence: string, at = Date.now()) => ({ role, evidence, at, messageId: role + '-message' });

describe('lasting tastes and project threads', () => {
  it('keeps Capri tastes separate, sourced and stable across restarts and rejects invented/user evidence', () => {
    const dir = tmpDir(), store = new RelationshipStore(dir, () => true, () => true);
    const c = { op: 'add' as const, topic: 'music', text: 'Prefers rough guitars.', evidence: 'I prefer rough guitars.' };
    expect(store.learnTaste(c, source('user', c.evidence), store.snapshot())).toBe(false);
    expect(store.learnTaste(c, source('assistant', 'I never said that.'), store.snapshot())).toBe(false);
    expect(store.learnTaste(c, source('assistant', c.evidence), store.snapshot())).toBe(true);
    const taste = store.snapshot().tastes[0];
    expect(store.learnTaste({ ...c, op: 'update', id: taste.id, text: 'Prefers smooth jazz.', evidence: 'I prefer smooth jazz.' }, source('assistant', 'I prefer smooth jazz.'), store.snapshot())).toBe(false);
    expect(store.learnTaste({ ...c, op: 'update', id: taste.id, text: 'Prefers smooth jazz.', evidence: 'I prefer smooth jazz now.' }, source('assistant', 'I prefer smooth jazz now.'), store.snapshot())).toBe(true);
    expect(new RelationshipStore(dir, () => true, () => true).context()).toContain('Prefers smooth jazz');
    expect(store.snapshot().threads).toEqual([]);
  });
  it('only commits learning against a current snapshot and keeps paused projects closed without explicit resumption', () => {
    const store = new RelationshipStore(tmpDir(), () => true, () => true);
    const p = store.setThread({ title: 'Ceramic fox', summary: 'Needs cobalt glaze.', status: 'active' });
    const old = store.snapshot(); store.status(p.id, 'paused');
    const change = { op: 'update' as const, id: p.id, title: p.title, summary: 'Designing its tail.', status: 'active' as const, evidence: 'The fox has a tail.' };
    expect(store.learnThread(change, source('user', change.evidence), old)).toBe(false);
    expect(store.learnThread(change, source('user', change.evidence), store.snapshot())).toBe(false);
    const resumed = { ...change, evidence: 'I am back to the ceramic fox.' };
    expect(store.learnThread(resumed, source('user', resumed.evidence), store.snapshot())).toBe(true);
    expect(store.learnThread({ ...change, status: 'done' }, source('user', change.evidence), store.snapshot())).toBe(false);
  });
  it('offers follow-ups only in receptive moments, records delivery rather than selection and spaces across restarts', () => {
    const dir = tmpDir(); let now = Date.now();
    const store = new RelationshipStore(dir, () => true, () => true, () => now);
    const p = store.setThread({ title: 'Ceramic fox', summary: 'Trying cobalt glaze.', status: 'active' });
    expect(store.candidate('', true)).toBeUndefined(); now += 49 * 3600000;
    expect(store.candidate('What is 17 times 24?', false)).toBeUndefined();
    expect(store.candidate('', true)?.id).toBe(p.id);
    store.context('', true); store.context('', true); expect(store.snapshot().threads[0].asksSinceUpdate).toBe(0);
    store.delivered('How is the ceramic fox going?');
    expect(store.candidate('', true)).toBeUndefined();
    now += 8 * 86400000;
    const restored = new RelationshipStore(dir, () => true, () => true, () => now);
    expect(restored.candidate('', true)?.id).toBe(p.id); restored.delivered('Any news about the ceramic fox?');
    now += 8 * 86400000; expect(restored.candidate('', true)).toBeUndefined();
    restored.setThread({ id: p.id, title: p.title, summary: 'The glaze finally worked.', status: 'active' });
    now += 49 * 3600000; expect(restored.candidate('', true)?.id).toBe(p.id);
    restored.status(p.id, 'done'); expect(restored.candidate('', true)).toBeUndefined();
  });
  it('obeys snoozes, privacy changes and memory being off', () => {
    const dir = tmpDir(); let now = Date.now(), enabled = true, persistent = true;
    const store = new RelationshipStore(dir, () => enabled, () => persistent, () => now);
    const p = store.setThread({ title: 'Ceramic fox', summary: 'Sculpting.', status: 'active' });
    store.status(p.id, 'active', 7); now += 3 * 86400000; expect(store.candidate('', true)).toBeUndefined();
    now += 5 * 86400000; expect(store.candidate('', true)).toBeDefined();
    enabled = false; expect(store.context('', true)).toBe('');
    persistent = false; store.privacyChanged(); expect(fs.existsSync(path.join(dir, 'relationship.json'))).toBe(false);
    expect(store.snapshot().threads).toEqual([]);
  });
  it('forgets a thread only from an explicit user request and does not turn stop-asking into a new active topic', () => {
    const store = new RelationshipStore(tmpDir(), () => true, () => true);
    const p = store.setThread({ title: 'Ceramic fox', summary: 'Sculpting.', status: 'active' });
    const change = { op: 'forget' as const, id: p.id, title: p.title, summary: p.summary, status: p.status, evidence: 'The ceramic fox is nice.' };
    expect(store.learnThread(change, source('user', change.evidence), store.snapshot())).toBe(false);
    const evidence = 'Please forget the ceramic fox project.';
    expect(store.learnThread({ ...change, evidence }, source('user', evidence), store.snapshot())).toBe(true);
    expect(store.snapshot().threads).toHaveLength(0);
  });
  it('learns all stores in one request with evidence from the correct speaker', async () => {
    const dir = tmpDir(), memory = new MemoryStore(dir), relationship = new RelationshipStore(dir, () => true, () => true);
    const settings = structuredClone(DEFAULT_SETTINGS); settings.memory.autoLearn = true; let calls = 0;
    const user = 'I am building a ceramic fox.', reply = 'I prefer rough guitars.';
    const provider = { name: 'mock', local: true, async *stream(messages: LLMMessage[]) {
      calls++; const input = JSON.parse(messages[1].content); expect(input.source_messages[0].delivered_assistant_reply).toBe(reply);
      yield JSON.stringify({ changes: [{ op: 'add', text: 'Building a ceramic fox.', kind: 'fact', evidence: user }], tastes: [{ op: 'add', topic: 'music', text: 'Prefers rough guitars.', evidence: reply }], threads: [{ op: 'add', title: 'Ceramic fox', summary: 'Building it.', status: 'active', evidence: user, followUpAt: null }] });
    }, async test() { return { ok: true, detail: '' }; }, async listModels() { return []; } };
    const learner = new MemoryLearning({ settings: () => settings, memory, relationship, provider: () => provider, log: nullLogger });
    await learner.learn(user, 'user-fox', new AbortController().signal, [{ text: user, messageId: 'user-fox', assistant: { text: reply, messageId: 'capri-guitars' } }]);
    expect(calls).toBe(1); expect(memory.approved()).toHaveLength(1);
    expect(relationship.snapshot().tastes[0].source.messageId).toBe('capri-guitars');
    expect(relationship.snapshot().threads[0].source.messageId).toBe('user-fox');
    expect(memory.approved()[0].text).not.toContain('guitars');
  });
});

describe('retired dialogue', () => {
  it('understands direct feedback and explicit quoted phrases without treating ordinary discussion as a command', () => {
    expect(lineRetirementRequest("don't say that again")).toEqual({ latest: true });
    expect(lineRetirementRequest('Please do not say that line again.')).toEqual({ latest: true });
    expect(lineRetirementRequest('Stop saying "I approve."')).toEqual({ latest: false, line: 'I approve.' });
    expect(lineRetirementRequest('Why do people say "never say that again"?')).toBeNull();
  });
  it('migrates legacy generated retirement to diagnostics without phrase bans', () => {
    const dir=tmpDir(),text="This synthetic generated phrase was never in the authored bank.";
    fs.writeFileSync(path.join(dir,'retired-lines.json'),JSON.stringify([{id:'legacy',text,at:1}]));
    const store=new RetiredLines(dir);expect(store.list()).toEqual([]);expect(store.filterGenerated(text)).toBe(text);
    expect(store.blocks(text)).toBe(false);expect(store.context()).toBe('');
    expect(JSON.parse(fs.readFileSync(path.join(dir,'legacy-dialogue-feedback.json'),'utf8'))).toEqual([{id:'legacy',kind:'repetitive',at:1}]);
    expect(new RetiredLines(dir).filterGenerated(text)).toBe(text);
  });
  it('never re-enables a retired local line when recent-line exclusions are exhausted', () => {
    const retired = new RetiredLines(tmpDir());
    const director = new DialogueDirector(() => .5); director.setLineFilter(text => !retired.blocks(text));
    const line = director.choose({ event: 'pat' }, { required: true }); retired.retire(line);
    for (let i = 0; i < 80; i++) expect(director.choose({ event: 'pat' }, { required: true })).not.toBe(line);
    expect(retired.filterGenerated(line)).toBe(line);
  });
  it('does not rewrite generated speech after migrating a legacy phrase retirement', async () => {
    const dir = tmpDir();fs.writeFileSync(path.join(dir,'retired-lines.json'),JSON.stringify([{id:'legacy',text:'Your timing is suspiciously good.',at:1}]));const retired=new RetiredLines(dir);
    const { ctx, s } = makeCtx({}, dir); s.voice.ttsEnabled = true;
    const history = new HistoryStore(dir, () => 0, () => true), events: { ch: string; p: any }[] = [], said: string[] = []; let calls = 0;
    const provider = { name: 'mock', local: true, async *stream() { calls++; for (const char of calls === 1 ? 'Your timing is suspiciously good.' : 'I vote for the red one.') yield char; }, async test() { return { ok: true, detail: '' }; }, async listModels() { return []; } };
    const conversation = new Conversation({ settings: () => s, history, provider: () => provider, memories: () => [], actionCtx: ctx, emit: (ch, p) => events.push({ ch, p }), cue: c => { if (c.type === 'speak') said.push(c.text); }, confirm: async () => false, log: nullLogger, hasRetiredLines: () => true, filterReply: t => retired.filter(t) });
    await conversation.send('Which one?'); await conversation.settle();
    expect(calls).toBe(1); expect(history.recent(1)[0].content).toBe('Your timing is suspiciously good.');
    expect(events.filter(e => e.ch === 'chat:delta').map(e => e.p.delta).join('')).toBe('Your timing is suspiciously good.');
    expect(said.join(' ')).toContain('suspiciously');
  });
});
