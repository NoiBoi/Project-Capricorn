import { describe, expect, it } from 'vitest';
import { ActivityDirector, activityLine, activityMotion } from '../../src/shared/activity';
import { nextExploreDelay } from '../../src/main/desktop/exploration';
const input = { blocked: false, subject: 'Notes', idleSec: 0 };
describe('local activity scenes', () => {
  it('waits for a stable subject, follows through, settles, then rests', () => {
    const a = new ActivityDirector(); a.tick(0, input);
    expect(a.tick(2000, input)).toBeNull(); expect(a.tick(4000, input)).toMatchObject({ kind: 'notice', subject: 'Notes' });
    expect(a.tick(8000, input)?.kind).toBe('lean'); expect(a.tick(14000, input)?.kind).toBe('settle');
    expect(a.tick(18000, input)).toBeNull(); expect(a.phase).toBe('rest'); expect(a.tick(19000, input)).toBeNull();
  });
  it('resumes an interrupted activity and recognizes an actual return to a subject', () => {
    const a = new ActivityDirector(); a.tick(0, input); a.tick(4000, input);
    expect(a.tick(5000, { ...input, blocked: true })).toBeNull();
    expect(a.tick(9000, input)).toMatchObject({ kind: 'lean', resumed: true });
    a.tick(10000, { ...input, subject: 'Music' }); a.tick(14000, { ...input, subject: 'Music' });
    a.tick(15000, input); const beat = a.tick(19000, input)!;
    expect(beat.returning).toBe(true); expect(activityLine(beat)).not.toContain('Notes');
  });
  it('responds to returning input without requiring cursor movement', () => {
    const a = new ActivityDirector(); a.tick(0, { ...input, idleSec: 120, blocked: true });
    expect(a.tick(1000, input)?.kind).toBe('return');
    expect(a.tick(2000, input)?.kind).not.toBe('return');
  });
  it('keeps activity motion bounded and returns to the original transform', () => {
    for (const kind of ['notice', 'lean', 'stretch', 'settle', 'return', 'putdown'] as const) {
      const middle = activityMotion(kind, 1.25, -1), end = activityMotion(kind, 10, -1);
      expect(Math.abs(middle.x)).toBeLessThanOrEqual(.025); expect(Math.abs(middle.turn)).toBeLessThanOrEqual(.045);
      expect(end.x).toBeCloseTo(0); expect(end.y).toBeCloseTo(0); expect(end.scaleY).toBeCloseTo(1);
    }
  });
  it('has varied complete quiet scenes even without screen context, and never repeats the last routine', () => {
    const a = new ActivityDirector(() => 0), starts: string[] = [], kinds = new Set<string>();
    let wasRest = true;
    for (let now = 0; now < 360000; now += 1000) {
      const beat = a.tick(now, {...input, subject:''});
      if (beat) { kinds.add(beat.kind); if (wasRest) starts.push(beat.kind); }
      wasRest = a.phase === 'rest';
    }
    expect(starts.length).toBeGreaterThan(4); expect(starts.every((s,i)=>!i||s!==starts[i-1])).toBe(true);
    expect(kinds.has('settle')).toBe(true); expect(kinds.size).toBeGreaterThanOrEqual(5);
    for (const kind of ['peek','balance','fidget','sway','float'] as const) {
      const end=activityMotion(kind,10); expect(end.x).toBeCloseTo(0); expect(end.y).toBeCloseTo(0); expect(end.turn).toBeCloseTo(0);
    }
  });
  it('adds activity frequency in Explore without speeding up the physical glide', () => {
    expect(nextExploreDelay(() => 0, 'explore')).toBe(30000); expect(nextExploreDelay(() => 1, 'explore')).toBe(45000);
    expect(nextExploreDelay(() => 0, 'normal')).toBe(50000);
  });
});
