import { describe, expect, it } from 'vitest';
import { placementInterest } from '../../src/shared/placementInterest';
import { CursorReturn } from '../../src/shared/cursorReturn';
describe('selective placement and cursor return', () => {
  const ordinary = { title: 'Untitled - Notepad', visits: 3, returning: false, awaySeconds: 0, inverted: false };
  it('considers meaningful new windows and unusual perches but not repeated ordinary placement interesting', () => {
    expect(placementInterest(ordinary, () => .5).react).toBe(false);
    expect(placementInterest({ ...ordinary, title: 'Engineering homework.pdf', visits: 1 }, () => .5).interesting).toBe(true);
    expect(placementInterest({ ...ordinary, title: 'Engineering homework.pdf', visits: 3 }, () => .5).react).toBe(false);
    expect(placementInterest({ ...ordinary, inverted: true }, () => .5).react).toBe(true);
    expect(placementInterest(ordinary, () => .049).react).toBe(true); expect(placementInterest(ordinary, () => .05).react).toBe(false);
  });
  it('teleports only after real inactivity, once per return, with a five-minute cooldown', () => {
    const r = new CursorReturn(); r.observe(20, 1000); expect(r.move(1001, false)).toBe(false);
    r.observe(100, 10000); expect(r.move(10001, false)).toBe(true); expect(r.move(10002, false)).toBe(false);
    r.observe(100, 20000); expect(r.move(20001, false)).toBe(false);
    r.observe(100, 320000); expect(r.move(320001, false)).toBe(true);
  });
  it('defers a brief blocked return but expires it instead of queueing it indefinitely', () => {
    const r = new CursorReturn(); r.observe(100, 1000); expect(r.move(2000, true)).toBe(false); expect(r.move(3000, false)).toBe(true);
    r.observe(100, 10000); r.observe(0, 11000); r.observe(0, 17000); expect(r.move(18000, false)).toBe(false);
  });
});
