import { describe, expect, it } from 'vitest';
import { bubbleTail } from '../../src/shared/bubbleGeometry';
import { openingGreeting } from '../../src/shared/openingGreeting';
describe('bubble pointer and local opening', () => {
  it.each([{ x: -30, y: 60 }, { x: 380, y: 60 }, { x: 170, y: -90 }, { x: 170, y: 390 }])('points toward the face at %j', target => {
    const points = bubbleTail({ x: 14, y: 14, width: 310, height: 140 }, target, { width: 340, height: 180 }).split(' ').map(p => p.split(',').map(Number));
    expect(points).toHaveLength(3); expect(points.flat().every(Number.isFinite)).toBe(true);
    const base = [(points[0][0] + points[2][0]) / 2, (points[0][1] + points[2][1]) / 2], tip = points[1];
    expect((tip[0] - base[0]) * (target.y - base[1]) - (tip[1] - base[1]) * (target.x - base[0])).toBeCloseTo(0);
    expect(tip[0]).toBeGreaterThanOrEqual(2); expect(tip[0]).toBeLessThanOrEqual(337);
    expect(tip[1]).toBeGreaterThanOrEqual(2); expect(tip[1]).toBeLessThanOrEqual(177);
  });
  it('omits a pointer when the face lies behind the plate', () => {
    expect(bubbleTail({ x: 14, y: 14, width: 310, height: 140 }, { x: 100, y: 50 }, { width: 340, height: 180 })).toBe('');
  });
  it('varies greetings without repeating the previous load or inventing a name', () => {
    const first = openingGreeting(9, [], '', () => 0);
    expect(first.length).toBeGreaterThan(0); expect(openingGreeting(9, [], first, () => 0)).not.toBe(first);
    const named = Array.from({ length: 12 }, () => openingGreeting(22, ["The user's preferred name is Alex."], '', () => .999));
    expect(named.some(line => line.includes('Alex'))).toBe(true);
    expect(openingGreeting(22, ['Alex is a classmate.'], '', () => .999)).not.toContain('Alex');
  });
});
