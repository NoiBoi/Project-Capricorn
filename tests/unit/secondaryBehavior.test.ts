import { describe, expect, it } from 'vitest';
import { SecondaryBehavior, type SecondaryInput } from '../../src/shared/secondaryBehavior';
import { restSupport } from '../../src/main/desktop/restSupport';
import { SEAT_RATIO } from '../../src/shared/framing';
const base: SecondaryInput = { enabled: true, blocked: false, support: { sit: true, lie: true, kind: 'window_top' }, inverted: false, hovering: false, inspectingBelow: false, patting: false };
const step = (behavior: SecondaryBehavior, seconds: number, input: SecondaryInput) => { let out = behavior.update(0, input); for (let t = 0; t < seconds; t += .1) out = behavior.update(.1, input); return out; };
describe('purposeful secondary poses', () => {
  it('stays lying below a low ceiling rather than cycling back to a clipped sitting pose', () => {
    const input = { ...base, support: { ...base.support, tight: true } };
    expect(step(new SecondaryBehavior(), 90, input)).toMatchObject({ pose: 'recline', reason: 'low ceiling' });
    expect(step(new SecondaryBehavior(), 10, { ...input, patting: true }).pose).toBe('recline');
  });
  it('requires four seconds of rubbing on an upright window and always closes the eyes', () => {
    const b = new SecondaryBehavior(), rub = { ...base, patting: true };
    expect(step(b, 3.5, rub).pose).toBeNull();
    expect(step(b, .7, rub)).toMatchObject({ pose: 'sit_closed', closed: true });
    expect(step(b, .1, base).pose).toBeNull();
    expect(step(b, 2, rub).pose).toBeNull();
  });
  it('never uses front sitting for hover, inspection, idle or rubbing in air', () => {
    for (const input of [base, { ...base, hovering: true }, { ...base, inspectingBelow: true },
      { ...base, patting: true, inverted: true },
      { ...base, patting: true, support: { sit: false, lie: false, kind: 'none' as const } },
      { ...base, patting: true, support: { sit: true, lie: true, kind: 'taskbar' as const } }]) {
      expect(step(new SecondaryBehavior(), 10, input).pose).not.toBe('sit_closed');
    }
  });
  it('sits first on lower ledges, stands with grounded feet, then lies and returns to sitting', () => {
    for (const kind of ['taskbar', 'window_bottom'] as const) {
      const b = new SecondaryBehavior(), rest = { ...base, hovering: true, support: { sit: true, lie: true, kind } };
      expect(b.update(.1, rest).pose).toBeNull();
      expect(step(b, 40, rest)).toMatchObject({pose:null,standing:true});
      expect(step(b, 30, rest).pose).toBe('recline');
      expect(step(b, 60, rest).pose).toBeNull();
      expect(b.update(.1, { ...base, support: { sit: false, lie: false, kind: 'none' } }).pose).toBeNull();
    }
  });
  it('clears rubbing and resting on movement, disabled poses or loss of support', () => {
    for (const change of [{ blocked: true }, { enabled: false }]) {
      const b = new SecondaryBehavior(); step(b, 5, { ...base, patting: true });
      expect(b.update(.1, { ...base, ...change }).pose).toBeNull();
      expect(step(b, 2, { ...base, patting: true }).pose).toBeNull();
    }
    expect(step(new SecondaryBehavior(), 25, base).pose).toBeNull();
  });
});
describe('upright reclining support', () => {
  const area = { x: 0, y: 0, width: 1600, height: 1000 }, pet = { x: 500, y: 400 - 400 * SEAT_RATIO, width: 300, height: 400 };
  const window = { x: 100, y: 400, width: 1200, height: 500 };
  it('allows a clear window top with room above and rejects inverted perches', () => {
    expect(restSupport(pet, area, { rect: window, inverted: false }, [], () => true).lie).toBe(true);
    expect(restSupport(pet, area, { rect: window, inverted: true }, [], () => true).lie).toBe(false);
    expect(restSupport(pet, area, { rect: window, inverted: false }, [], () => false).lie).toBe(false);
  });
  it('supports the taskbar and bottom of a window but no imaginary mid-air floor', () => {
    expect(restSupport({ ...pet, y: 1000 - pet.height * SEAT_RATIO }, area, null, [], () => true)).toMatchObject({ lie: true, kind: 'taskbar' });
    expect(restSupport({ ...pet, y: 900 - pet.height * SEAT_RATIO }, area, null, [window], () => true)).toMatchObject({ lie: true, kind: 'window_bottom' });
    expect(restSupport(pet, area, null, [], () => true)).toMatchObject({ lie: false, kind: 'none' });
  });
});
