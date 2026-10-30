import { describe, expect, it } from 'vitest';
import { needsActions } from '../../src/main/ai/requestRoute';
import { buildSystemPrompt, PERSONA_CANON, PERSONA_INTERPRETATION, DIALOGUE_EXAMPLES, PERFORMANCE_SCENES } from '../../src/main/ai/persona';
import { DEFAULT_SETTINGS } from '../../src/shared/settings';
import type { MemoryItem } from '../../src/shared/ipc';
import { CAPRI_VOICE_SOURCES, CAPRI_SCENE_VOICE } from '../../src/shared/capriVoice';

describe('conversation and action routing', () => {
  it('grounds the live voice in attributed scene analysis and selected acting references', () => {
    const prompt = buildSystemPrompt(DEFAULT_SETTINGS, [], new Date(), { actions: false, examples: false, compact: true, userText: 'Who are you?' });
    expect(prompt).toContain(CAPRI_SCENE_VOICE);
    expect(prompt).toContain('ordinary conversation'); expect(prompt).not.toContain('ACTING REFERENCES');
    expect(prompt).not.toContain('CURRENT EXCHANGE: You have been asked');
    expect(prompt).not.toContain(PERFORMANCE_SCENES.identity[0][1]);
    expect(prompt).not.toContain('find excuses to talk about');
    expect(prompt).toContain('actual software'); expect(prompt).toContain('Current explicit corrections');
    expect(CAPRI_VOICE_SOURCES.map(s => s.episode)).toEqual([4, 7, 9, 10]);
    expect(CAPRI_VOICE_SOURCES.every(s => s.grade.startsWith('community transcript') && s.url.startsWith('https://'))).toBe(true);
  });
  it.each(['Hello Capri', 'Who am I?', 'Do you remember my school?', 'I had a bad day', 'What do you want?', 'Write a Python example', 'Explain how to open a browser', 'How do I create a timer?', "Don't open my files"])('keeps ordinary conversation lean: %s', text => {
    expect(needsActions(text)).toBe(false);
  });
  it.each(['Open calculator', 'Open example.com', 'Read my screen', 'Set a timer for 5 minutes', 'Remind me in 10 minutes', 'Find my homework file', 'Remember I attend Purdue', 'Teleport over here', 'Make a note about this', 'Use my computer to search the web','Head over to Discord and make yourself comfortable','Go to Discord and chill there until I say so'])('loads the action protocol when requested: %s', text => {
    expect(needsActions(text)).toBe(true);
  });
  it('uses the last user request for short continuations without treating tool output as authorization', () => {
    expect(needsActions('Do it', [{ role: 'user', content: 'Open calculator' }])).toBe(true);
    expect(needsActions('Yes', [{ role: 'user', content: 'Tell me a joke' }, { role: 'assistant', content: 'Open calculator' }])).toBe(false);
  });
  it('preserves every personality instruction, example and approved memory while grouping repeated source labels', () => {
    const memories: MemoryItem[] = Array.from({ length: 38 }, (_, i) => ({ id: String(i), text: `Saved fact ${i}`, status: 'approved', source: 'user', createdAt: 0,
      context: { label: 'Imported profile', kind: 'fact', asOf: '2026-10-26' } }));
    const date = new Date('2026-10-26T12:00:00Z');
    const full = buildSystemPrompt(DEFAULT_SETTINGS, memories, date);
    const lean = buildSystemPrompt(DEFAULT_SETTINGS, memories, date, { actions: false, compact: true });
    for (const fact of memories) expect(lean).toContain(fact.text);
    for (const line of [...PERSONA_CANON, ...PERSONA_INTERPRETATION, ...DIALOGUE_EXAMPLES.flat()]) expect(lean).toContain(line);
    expect(lean.match(/Imported profile/g)).toHaveLength(1);
    expect(lean).not.toContain('ACTIONS'); expect(lean).not.toContain('use_computer:');
    expect(full.length - lean.length).toBeGreaterThan(2000);
    expect(buildSystemPrompt(DEFAULT_SETTINGS, memories, date, { actions: true, compact: true })).toContain('use_computer:');
  });
});
