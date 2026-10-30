import { describe, expect, it } from 'vitest';
import { FacingDelay } from '../../src/shared/facing';
describe('delayed cursor facing', () => {
  it('waits longer to reverse while lying without slowing ordinary sitting', () => {
    const f = new FacingDelay(); f.update(1, 0, false, true);
    expect(f.update(1, 280, false, true)).toBe(1);
    f.update(-1, 300, false, true);
    expect(f.update(-1, 900, false, true)).toBe(1);
    expect(f.update(-1, 1180, false, true)).toBe(-1);
    f.update(1, 1200);
    expect(f.update(1, 1560)).toBe(1);
  });
  it('requires a stable direction and enforces a turn cooldown', () => {
    const f = new FacingDelay(); expect(f.update(1, 0)).toBe(0); expect(f.update(1, 140)).toBe(1);
    expect(f.update(-1, 180)).toBe(1); expect(f.update(-1, 400)).toBe(1); expect(f.update(-1, 520)).toBe(-1);
  });
  it('does not flicker during head rubbing or a head-pat facing hold', () => {
    const f = new FacingDelay(); f.update(1, 0); f.update(1, 150);
    for (let t = 200; t < 2000; t += 50) expect(f.update(t % 100 ? 1 : -1, t)).toBe(1);
    for (let t = 2100; t < 4000; t += 100) expect(f.update(-1, t, true)).toBe(1);
    expect(f.update(-1, 4100)).toBe(1); expect(f.update(-1, 4250)).toBe(-1);
  });
});
