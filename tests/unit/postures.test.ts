import { describe, expect, it } from 'vitest';
import { POSTURES, posturesFor, type Surface } from '../../src/renderer/character/postures';
import { Behavior, type BehaviorInputs } from '../../src/renderer/character/behavior';
import { NEUTRAL, type Params } from '../../src/renderer/character/params';
import { prng } from '../../src/renderer/character/geometry';
import { chooseDestination, peekSpot, perchSpot, SEAT_RATIO } from '../../src/main/desktop/teleport';
import { TeleportController } from '../../src/main/desktop/teleportController';
import type { DisplayLike } from '../../src/main/desktop/displays';
import { DEFAULT_SETTINGS } from '../../src/shared/settings';
import { nullLogger } from '../../src/main/log';
import type { CharacterCue } from '../../src/shared/ipc';

const base: BehaviorInputs = { phase: 'idle', speechLevel: 0, speaking: false, pointer: null, idleSec: 0, sleepAfterSec: 600, quiet: false, intensity: 1, surface: 'taskbar' };
const run = (b: Behavior, secs: number, inp: Partial<BehaviorInputs> = {}, dt = 1 / 20) => { let p!: Params; for (let t = 0; t < secs; t += dt) p = b.update(dt, { ...base, ...inp }); return p; };

describe('posture library', () => {
  it('every posture uses real params, cites a source and fits at least one surface', () => {
    for (const p of Object.values(POSTURES)) {
      expect(p.source.length).toBeGreaterThan(3);
      expect(p.surfaces.length).toBeGreaterThan(0);
      for (const k of Object.keys(p.pose)) expect(k in NEUTRAL).toBe(true);
    }
  });
  it('every surface offers postures that are valid for it', () => {
    for (const s of ['taskbar', 'window', 'air', 'edge_left', 'edge_right'] as Surface[]) {
      for (const [name] of posturesFor(s)) expect(POSTURES[name].surfaces).toContain(s);
    }
  });
});

describe('posture behaviour', () => {
  it('holds a posture for minutes, then changes to one that fits where she is', () => {
    const b = new Behavior(prng(11));
    run(b, 20 * 60, { surface: 'taskbar' }, 0.5);
    expect(b.postureHistory.length).toBeGreaterThanOrEqual(4); // several changes in 20 min
    expect(b.postureHistory.length).toBeLessThan(25); // but not twitchy
    for (const n of b.postureHistory) expect(POSTURES[n].surfaces).toContain('taskbar');
    expect(b.postureHistory).toContain('sit_edge');
  });
  it('in mid-air she curls up / reclines instead of "sitting" on nothing', () => {
    const b = new Behavior(prng(12));
    run(b, 20 * 60, { surface: 'air' }, 0.5);
    expect(b.postureHistory).not.toContain('sit_edge');
    expect(b.postureHistory.some((n) => n === 'air_sit' || n === 'recline')).toBe(true);
  });
  it('a sitting posture really lowers her and bends the legs', () => {
    const b = new Behavior(prng(13));
    b.setPosture('sit_edge');
    const p = run(b, 0.2, { surface: 'taskbar' });
    expect(p.hipDrop).toBeGreaterThan(150);
    expect(Math.abs(p.thighL)).toBeGreaterThan(60);
  });
  it('peeks when placed at a screen edge; stands back up when moved somewhere that does not fit', () => {
    const b = new Behavior(prng(14));
    run(b, 0.2, { surface: 'edge_left' });
    expect(b.posture).toBe('peek_left');
    run(b, 0.2, { surface: 'air' });
    expect(b.posture).toBe('stand');
  });
  it('dozes slumped on a ledge, or curled up in the air', () => {
    const b = new Behavior(prng(15));
    run(b, 2, { idleSec: 900, surface: 'taskbar' });
    expect(b.state).toBe('sleeping');
    expect(b.posture).toBe('sit_edge');
    const c = new Behavior(prng(16));
    run(c, 2, { idleSec: 900, surface: 'air' });
    expect(c.posture).toBe('air_sit');
  });
  it('being dragged makes her stand; talking does not make her jump up', () => {
    const b = new Behavior(prng(17));
    b.setPosture('sit_edge');
    run(b, 0.3, { held: true });
    expect(b.posture).toBe('stand');
    b.setPosture('recline');
    run(b, 400, { phase: 'speaking', speaking: true, speechLevel: 0.5, surface: 'air' }, 0.5);
    expect(b.posture).toBe('recline');
  });
  it('state poses win over posture limbs (thinking hand-to-chin while sitting)', () => {
    const b = new Behavior(prng(18));
    b.setPosture('sit_edge');
    const p = run(b, 0.5, { phase: 'thinking' });
    expect(p.armLRaise).toBeCloseTo(0.55, 2);
    expect(p.hipDrop).toBeGreaterThan(150);
  });
  it('dashing streams the hair and leans into the motion', () => {
    const p = run(new Behavior(prng(19)), 0.2, { dashing: 1 });
    expect(p.hairStream).toBe(-1);
    expect(p.lean).toBeGreaterThan(0);
  });
});

describe('perch / peek / glide placement', () => {
  const d: DisplayLike = { id: 1, bounds: { x: 0, y: 0, width: 1536, height: 864 }, workArea: { x: 0, y: 0, width: 1536, height: 816 }, scaleFactor: 1.25 };
  const size = { width: 300, height: 520 };
  it('perch puts her seat exactly on the window’s top edge, inside the window’s width', () => {
    const win = { x: 200, y: 560, width: 900, height: 250 };
    const r = perchSpot(win, size, [d], { x: 0, y: 0 }, () => 0.5)!;
    expect(r.kind).toBe('perch');
    expect(Math.abs(r.y + r.height * SEAT_RATIO - win.y)).toBeLessThanOrEqual(1);
    expect(r.x).toBeGreaterThanOrEqual(win.x);
    expect(r.x + r.width).toBeLessThanOrEqual(win.x + win.width);
  });
  it('no perch on maximised or narrow windows', () => {
    expect(perchSpot({ x: 0, y: 0, width: 1536, height: 816 }, size, [d], { x: 0, y: 0 }, () => 0.5)).toBeNull();
    expect(perchSpot({ x: 100, y: 560, width: 200, height: 200 }, size, [d], { x: 0, y: 0 }, () => 0.5)).toBeNull();
    expect(chooseDestination('perch', { displays: [d], current: { x: 1212, y: 296, ...size }, cursor: { x: 0, y: 0 }, avoid: null })).toBeNull();
  });
  it('peek leaves her partly off-screen but well visible', () => {
    const l = peekSpot(d, size, 'left'), r = peekSpot(d, size, 'right');
    expect(l.x).toBeLessThan(0);
    expect(l.x + l.width).toBeGreaterThan(150);
    expect(r.x + r.width).toBeGreaterThan(1536);
    expect(r.x).toBeLessThan(1536 - 150);
  });
  it('glide moves the window through intermediate positions with the dash cue on and off', async () => {
    let bounds = { x: 1212, y: 296, width: 300, height: 520 };
    const xs: number[] = [];
    const cues: CharacterCue[] = [];
    const s = structuredClone(DEFAULT_SETTINGS);
    const tc = new TeleportController({
      settings: () => s, bounds: () => bounds, move: (r) => { bounds = r; xs.push(r.x); }, displays: () => [d],
      cursor: () => ({ x: 10, y: 10 }), activeWindow: () => null, cue: (c) => cues.push(c),
      aiConnected: () => true, blocked: () => null, userIdleSec: () => 0, log: nullLogger,
    });
    const r = await tc.go('left', 'manual', 'glide');
    expect(r.ok).toBe(true);
    expect(xs.length).toBeGreaterThan(10);
    expect(new Set(xs).size).toBeGreaterThan(5); // smooth slide, not a jump
    expect(cues.filter((c) => c.type === 'dash').map((c) => (c as { dir: number }).dir)).toEqual([-1, 0]);
  });
});
