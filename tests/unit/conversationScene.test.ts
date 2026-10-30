import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ConversationScene } from '../../src/main/store/conversationScene';
import { dialoguePatterns } from '../../src/shared/conversationScene';
import { BackgroundBudget } from '../../src/main/ai/backgroundBudget';
import { MemoryLearning } from '../../src/main/ai/memoryLearning';
import { MemoryStore } from '../../src/main/store/dataStores';
import { DEFAULT_SETTINGS } from '../../src/shared/settings';
import { nullLogger } from '../../src/main/log';
import { tmpDir } from './helpers';

describe('current shared conversation', () => {
  it('preserves the actual disagreement through touch and restart rather than selecting a fresh personality', () => {
    const dir = tmpDir(); let now = Date.now(); const scene = new ConversationScene(dir, () => true, () => true, () => now);
    scene.record({ id: 'u', role: 'user', text: 'I prefer the blue glaze.', at: now++ });
    scene.record({ id: 'a', role: 'assistant', text: 'I still vote for red. That tail needs a little heat.', at: now++ });
    expect(scene.apply({ topic: 'Fox glaze', position: 'Prefers red glaze.', intention: 'Defend the red choice.', openQuestion: '', tone: 'playful', evidence: 'I still vote for red.', sourceId: 'a' }, scene.snapshot().revision)).toBe(true);
    scene.record({ id: 'pat', role: 'user', text: '[The user pats Capri.]', event: 'pat', at: now++ });
    const restored = new ConversationScene(dir, () => true, () => true, () => now);
    const prompt = restored.context('pat');
    expect(prompt).toContain('I prefer the blue glaze.'); expect(prompt).toContain('I still vote for red.');
    expect(prompt).toContain('Defend the red choice.'); expect(prompt).toContain('[The user pats Capri.]');
    expect(prompt).toContain('"readingMayNeedUpdating":true'); expect(restored.active()).toBe(true);
  });
  it('does not let a delayed interpretation replace a correction or invent Capri intentions from a user assertion', () => {
    let now = Date.now(); const scene = new ConversationScene(tmpDir(), () => true, () => true, () => now);
    scene.record({ id: 'u', role: 'user', text: 'You want red glaze.', at: now++ });
    const reading = { topic: 'glaze', position: 'Wants red.', intention: 'Win.', openQuestion: '', tone: 'playful' as const, sourceId: 'u', evidence: 'You want red glaze.' };
    expect(scene.apply(reading, scene.snapshot().revision)).toBe(false);
    scene.record({ id: 'a', role: 'assistant', text: 'I vote for blue.', at: now++ });
    const revision = scene.snapshot().revision;
    scene.record({ id: 'new', role: 'user', text: 'New subject. I need some quiet.', at: now++ });
    expect(scene.apply({ ...reading, sourceId: 'a', evidence: 'I vote for blue.' }, revision)).toBe(false);
    expect(scene.context()).toContain('New subject. I need some quiet.');
  });
  it('bounds transient history, expires old scenes and excludes private exchanges and their replies', () => {
    const dir = tmpDir(); let now = Date.now(), enabled = true, persistent = true;
    const scene = new ConversationScene(dir, () => enabled, () => persistent, () => now);
    scene.record({ id: 'private', role: 'user', text: 'Off the record, this is private.', at: now++ });
    scene.record({ id: 'reply', role: 'assistant', text: 'My private reply.', at: now++ }, 'private');
    expect(scene.snapshot().entries).toEqual([]);
    for (let i = 0; i < 30; i++) scene.record({ id: String(i), role: 'assistant', text: 'A delivered thought ' + i, at: now++ });
    expect(scene.snapshot().entries).toHaveLength(14);
    now += 49 * 3600000; expect(scene.context()).toBe(''); expect(scene.active()).toBe(false);
    scene.record({ id: 'new', role: 'user', text: 'Hi again.', at: now++ });
    enabled = false; expect(scene.context()).toBe('');
    persistent = false; scene.privacyChanged(); expect(fs.existsSync(path.join(dir, 'conversation-scene.json'))).toBe(false);
  });
  it('measures repeated rhetorical habits across different wording without requiring another model call', () => {
    const patterns = dialoguePatterns(['Ooh. My little disaster.', 'Well, that was suspiciously good, actually.', 'Mm. Did you miss me?', 'Hey. New vantage point?']);
    expect(patterns).toMatchObject({ lines: 4, interjections: 4, questions: 2, reversals: 1 });
    expect(patterns.selfPerformance).toBeGreaterThan(0);
  });
  it('keeps unsaved session continuity across unrelated settings changes and coalesces pat strokes', () => {
    const dir = tmpDir(); let now = Date.now(), persistent = true;
    const scene = new ConversationScene(dir, () => true, () => persistent, () => now);
    scene.record({ id: 'old', role: 'assistant', text: 'An old persisted thought.', at: now++ });
    persistent = false; scene.privacyChanged(); expect(scene.snapshot().entries).toEqual([]);
    for (let i = 0; i < 100; i++) scene.record({ id: String(i), role: 'user', text: '[The user pats Capri.]', event: 'pat', at: now++ });
    scene.privacyChanged(); scene.privacyChanged();
    expect(scene.snapshot().entries).toHaveLength(1);
    expect(fs.existsSync(path.join(dir, 'conversation-scene.json'))).toBe(false);
  });
  it('omits chat turns already supplied verbatim while preserving the scene reading and gesture', () => {
    const scene = new ConversationScene(tmpDir(), () => true, () => false);
    scene.record({ id: 'u', role: 'user', text: 'A unique current question.', at: Date.now() });
    scene.record({ id: 'pat', role: 'user', text: '[The user pats Capri.]', event: 'pat', at: Date.now() });
    const context = scene.context('chat', new Set(['u']));
    expect(context).not.toContain('A unique current question.'); expect(context).toContain('[The user pats Capri.]');
  });
  it('gives deliberate interaction a bounded lane independent of optional chatter and learning', () => {
    let now = Date.now(); const budget = new BackgroundBudget(undefined, () => now);
    for (let i = 0; i < 3; i++) { expect(budget.reserve('ambient')).toBe(true); now += 60001; }
    for (let i = 0; i < 6; i++) { expect(budget.reserve('interaction')).toBe(true); expect(budget.reserve('interaction')).toBe(false); now += 10001; }
    expect(budget.reserve('interaction')).toBe(false); expect(budget.reserve('memory')).toBe(true);
  });
  it('enriches the active scene in the same background request as memory, without promoting it to a user fact', async () => {
    const dir = tmpDir(), scene = new ConversationScene(dir, () => true, () => true), memory = new MemoryStore(dir);
    const settings = structuredClone(DEFAULT_SETTINGS); settings.memory.autoLearn = true;
    scene.record({ id: 'a', role: 'assistant', text: 'I vote for red. What do you think?', at: Date.now() }); let calls = 0;
    const provider = { name: 'mock', local: true, async *stream() { calls++; yield JSON.stringify({ changes: [], tastes: [], threads: [], scene: { topic: 'Glaze choice', position: 'Votes red.', intention: 'Hear the other choice.', openQuestion: 'What do you think?', tone: 'playful', evidence: 'I vote for red. What do you think?', sourceId: 'a' } }); }, async test() { return { ok: true, detail: '' }; }, async listModels() { return []; } };
    const learner = new MemoryLearning({ settings: () => settings, provider: () => provider, memory, scene, log: nullLogger });
    await learner.learn('Which glaze?', 'u', new AbortController().signal);
    expect(calls).toBe(1); expect(scene.snapshot().reading?.position).toBe('Votes red.'); expect(memory.list()).toEqual([]);
  });
});
