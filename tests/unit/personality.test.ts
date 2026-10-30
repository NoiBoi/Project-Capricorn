import { describe, expect, it } from 'vitest';
import { Personality, MOOD_DELIVERY } from '../../src/shared/personality';
import { DEFAULT_SETTINGS } from '../../src/shared/settings';
import { speechRequest } from '../../src/main/voice/tts';
const calm = { pointer: null, phase: 'idle', sleeping: false, held: false };

describe('continuous personality', () => {
  it('escalates repeated pokes, remembers them briefly, and relaxes after pats', () => {
    const p = new Personality(() => 0.5);
    expect(p.event('poke')).toBe('curious'); p.update(1, calm);
    p.event('poke'); expect(p.event('poke')).toBe('annoyed');
    expect(p.update(5, calm).mood).toBe('annoyed');
    expect(p.event('pat')).toBe('playful'); expect(p.event('pat')).toBe('content');
    expect(p.update(8, calm).mood).toBe('content');
    expect(p.update(16, calm).mood).toBe('neutral');
    expect(p.event('poke')).toBe('curious');
  });
  it('notices after a delay, watches, plays, settles, and does not retrigger continuously', () => {
    const p = new Personality(() => 0.5), near = { ...calm, pointer: { x: 1, y: 0 } };
    expect(p.update(0.1, near).attention).toBe('rest');
    expect(p.update(0.15, near).attention).toBe('notice');
    expect(p.update(0.4, near).attention).toBe('watch');
    expect(p.update(0.2, near).look).toBe(1);
    expect(p.update(1.6, near).attention).toBe('play');
    expect(p.update(1.2, near).attention).toBe('settle');
    expect(p.update(1, near).attention).toBe('rest');
    expect(p.update(0.5, near).attention).toBe('rest');
  });
  it('suppresses fidgets while held, asleep, or thinking and keeps emotion through conversation', () => {
    const p = new Personality(() => 0);
    p.event('pat'); p.event('pat');
    expect(p.update(1, { ...calm, phase: 'thinking' })).toMatchObject({ mood: 'content', clip: null });
    expect(p.update(1, { ...calm, held: true })).toMatchObject({ attention: 'rest', clip: null });
    expect(p.update(1, { ...calm, sleeping: true })).toMatchObject({ mood: 'sleepy', clip: null });
    expect(p.update(30, { ...calm, phase: 'thinking' })).toMatchObject({ mood: 'focused', clip: null });
  });
  it('adds mood delivery within the API limit without changing the selected voice or speed', () => {
    const v = structuredClone(DEFAULT_SETTINGS.voice); v.openaiTts.instructions = 'x'.repeat(4000);
    const request = speechRequest('Hello.', v, 'annoyed');
    expect(request.voice).toBe('nova'); expect(request.speed).toBe(v.rate);
    expect(request.instructions!.length).toBeLessThanOrEqual(4096);
    expect(speechRequest('Hello.', DEFAULT_SETTINGS.voice, 'content').instructions).toContain(MOOD_DELIVERY.content);
  });
});
