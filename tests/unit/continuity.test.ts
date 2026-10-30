import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { CompanionScenes } from '../../src/main/store/companionScenes';
import { recalledExchanges, memoryQuery, continuityThread } from '../../src/main/ai/promptContext';
import type { ChatMessage } from '../../src/shared/ipc';

const dirs: string[] = [];
const dir = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'capri-scenes-')); dirs.push(d); return d; };
afterEach(() => { for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true }); });

describe('shared companion scene history', () => {
  it('persists exact delivered words and distinct completed actions across restarts', () => {
    const d = dir(); let now = 100000;
    const scene = new CompanionScenes(d, () => true, () => 7, () => now);
    scene.record('said', 'That bassline is trouble.', 'spotify'); now += 1000;
    scene.record('action', 'Finished floating beside the cursor.');
    const restored = new CompanionScenes(d, () => true, () => 7, () => now + 1000);
    expect(restored.context()).toMatchObject([{ kind: 'said', text: 'That bassline is trouble.', ageSeconds: 2 }, { kind: 'action', ageSeconds: 1 }]);
  });
  it('keeps the most recent spoken lines available even after many movement events', () => {
    let now = 100000; const scenes = new CompanionScenes(dir(), () => false, () => 7, () => now);
    scenes.record('said', 'I vote for the weird painting.');
    for (let i = 0; i < 20; i++) { now++; scenes.record('action', `Finished hop ${i}.`); }
    expect(scenes.context().filter(x => x.kind === 'said')[0].text).toContain('weird painting');
    expect(scenes.context().filter(x => x.kind === 'action')).toHaveLength(2);
  });
  it('bounds and validates storage, applies retention, and removes persistence when disabled', () => {
    const d = dir(); let enabled = true, now = 100000000;
    fs.writeFileSync(path.join(d, 'companion-scenes.json'), JSON.stringify([{ kind: 'said', text: 'Future lie', at: now + 1000 }, { kind: 'invented', text: 'bad', at: now }]));
    const scenes = new CompanionScenes(d, () => enabled, () => 1, () => now);
    expect(scenes.context()).toEqual([]);
    for (let i = 0; i < 120; i++) { now++; scenes.record('said', `Real line ${i}`); }
    expect(JSON.parse(fs.readFileSync(path.join(d, 'companion-scenes.json'), 'utf8')).recent).toHaveLength(96);
    now += 86400001; expect(scenes.context()).toEqual([]);
    scenes.record('said', 'New day'); enabled = false; scenes.privacyChanged();
    expect(fs.existsSync(path.join(d, 'companion-scenes.json'))).toBe(false);
    scenes.record('said', 'Session only'); expect(scenes.context()[0].text).toBe('Session only');
    scenes.privacyChanged(); expect(scenes.context()[0].text).toBe('Session only');
    expect(new CompanionScenes(d, () => false, () => 1, () => now).context()).toEqual([]);
  });
});

const msg = (id: string, role: 'user' | 'assistant', content: string, ts = 1000): ChatMessage => ({ id, role, content, ts });
describe('local conversation recall', () => {
  it('offers a dated prior topic on a return, never on unrelated turns or from private exchanges', () => {
    const now = Date.now(), at = now - 2 * 86400000;
    const history = [msg('a', 'user', 'I am building a ceramic kiln with a cobalt glazed fox.', at), msg('b', 'assistant', 'The fox gets the first seat.', at + 1000)];
    expect(continuityThread(history, 'Hey Capri!', new Set(), now)[0].user).toContain('ceramic kiln');
    expect(continuityThread(history, 'What is twelve times seven?', new Set(), now)).toEqual([]);
    expect(continuityThread(history, 'Hi', new Set(['a', 'b']), now)).toEqual([]);
    history[0].content = "Off the record, I am building a ceramic kiln with a cobalt glazed fox.";
    expect(continuityThread(history, 'Hi', new Set(), now)).toEqual([]);
  });
  it('recalls relevant dated exchanges without duplicating the live window or failed replies', () => {
    const history = [msg('1', 'user', 'The ceramic fox needs a cobalt glaze.'), msg('2', 'assistant', 'Cobalt. That fox deserves a dramatic entrance.'),
      msg('3', 'user', 'My favorite breakfast is toast.'), msg('4', 'assistant', 'Toast wins.'),
      msg('5', 'user', 'The ceramic fox cracked in the kiln.', 2000), { ...msg('6', 'assistant', 'HTTP error'), meta: { error: 'failed' } }];
    const found = recalledExchanges(history, 'What did you think about the cobalt ceramic fox?', new Set(['5', '6']));
    expect(found).toHaveLength(1); expect(found[0].capri).toContain('dramatic entrance'); expect(found[0].at).toBe(new Date(1000).toISOString());
    expect(JSON.stringify(found)).not.toContain('toast'); expect(JSON.stringify(found)).not.toContain('HTTP');
  });
  it('does not invent a topic match from one generic word and respects the quote budget', () => {
    const h = [msg('a', 'user', 'I think painting is nice.'), msg('b', 'assistant', 'Sure.')];
    expect(recalledExchanges(h, 'What do you think?', new Set())).toEqual([]);
    expect(recalledExchanges(h, 'What were we talking about?', new Set(), 10)).toEqual([]);
  });
  it('can retrieve a distinctive name from a short callback', () => {
    const h = [msg('a', 'user', 'I named the ceramic fox Cobalt.'), msg('b', 'assistant', 'Good name for a blue fox.')];
    expect(recalledExchanges(h, 'Cobalt?', new Set())[0].user).toContain('ceramic fox');
  });
  it('recalls Capri opinions as her reply rather than turning them into user preferences', () => {
    const h = [msg('a', 'user', 'What would you play?'), msg('b', 'assistant', 'I vote for guitars and distortion.')];
    const result = recalledExchanges(h, 'Your guitars and distortion phase?', new Set());
    expect(result[0].user).toBe('What would you play?'); expect(result[0].capri).toContain('guitars and distortion');
  });
  it('inherits a short follow-up topic for memory retrieval but preserves full profile queries', () => {
    expect(memoryQuery('Which shade?', [{ role: 'user', content: 'I am painting a ceramic fox.' }])).toContain('ceramic fox');
    expect(memoryQuery('What do you remember about me?', [{ role: 'user', content: 'ceramic fox' }])).toBe('What do you remember about me?');
  });
});
