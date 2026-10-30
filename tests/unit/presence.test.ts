import { describe, it, expect } from 'vitest';
import { AttentionRig, Encounters, placementLine } from '../../src/shared/presence';
import { Personality } from '../../src/shared/personality';

describe('embodied attention and session continuity', () => {
  const relaxed = { pointer: { x: -1, y: 0 }, engaged: false, held: false, sleeping: false };
  it('settles before watching the window but responds immediately to a nearby cursor', () => {
    const rig = new AttentionRig(); rig.watch({ x: 10, y: 2 }, 8);
    expect(rig.update(0.1, { ...relaxed, pointer: null })?.x).toBe(0);
    expect(rig.update(0.5, { ...relaxed, pointer: null })!.x).toBeGreaterThan(0.5);
    expect(rig.mode).toBe('window');
    expect(rig.update(0.5, { ...relaxed, engaged: true })!.x).toBeLessThan(-0.5);
    expect(rig.mode).toBe('user');
    expect(rig.update(0.1, { ...relaxed, held: true })).toBeNull();
    expect(rig.mode).toBe('rest');
  });
  it('does not restart settling when the same tracked window updates, and expires attention', () => {
    const rig = new AttentionRig(); rig.watch({ x: 1, y: 0 }, 2); rig.update(0.5, { ...relaxed, pointer: null });
    rig.watch({ x: 1.1, y: 0.1 }, 1.5);
    expect(rig.update(0.1, { ...relaxed, pointer: null })!.x).toBeGreaterThan(0.8);
    rig.update(2, { ...relaxed, pointer: null }); expect(rig.mode).toBe('rest');
  });
  it('records actual returns and interruptions without mixing renamed windows or permanent memory', () => {
    const visits = new Encounters(), a = { title: 'Homework', process: 'reader.exe' }, b = { title: 'Music', process: 'player.exe' };
    expect(visits.visit(a, 1000)).toMatchObject({ visits: 1, returning: false, interrupted: null });
    expect(visits.visit(b, 3000)).toMatchObject({ interrupted: 'Homework', returning: false });
    const back = visits.visit(a, 20000)!;
    expect(back).toMatchObject({ visits: 2, returning: true, interrupted: null, awaySeconds: 19 });
    expect(placementLine(back, 'Here.')).not.toContain('Homework'); expect(placementLine(back, 'Here.')).toContain('again');
    expect(visits.visit({ ...a, title: 'Different document' }, 30000)!.returning).toBe(false);
    expect(new Encounters().current).toBeNull();
    expect(visits.visit(a, 5 * 3600000)!.returning).toBe(false);
  });
  it('keeps warmth through a window visit and changes movement gradually', () => {
    const p = new Personality(() => 0.5), idle = { pointer: null, phase: 'idle', held: false, sleeping: false };
    p.event('pat'); p.event('pat'); const warm = p.update(5, idle);
    p.event('window'); expect(p.update(0.1, idle).mood).toBe('content');
    expect(warm.warmth).toBeGreaterThan(0.5); expect(warm.motion).toBeLessThan(0.85);
    const thinking = p.update(30, { ...idle, phase: 'thinking' });
    expect(thinking.mood).toBe('focused'); expect(thinking.clip).toBeNull();
    const neutral = new Personality(() => 0.5);
    expect(neutral.event('reply')).toBe('neutral');
    expect(neutral.update(2.5, idle).clip).toBeNull();
  });
});
