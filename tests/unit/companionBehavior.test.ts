import { describe, expect, it, vi } from 'vitest';
vi.mock('electron', () => ({ screen: {}, BrowserWindow: class {}, shell: {} }));
import { contextualFallback } from '../../src/shared/desktopContext';
import { floatingVisit, nextExploreDelay } from '../../src/main/desktop/exploration';
import { bubblePosition } from '../../src/main/bubble';

describe('companion variety and exploration', () => {
  it('keeps lying dialogue clear of the body at all screen corners and on offset monitors', () => {
    for (const area of [{ x: 0, y: 0, width: 800, height: 600 }, { x: -1920, y: -900, width: 800, height: 600 }]) {
      for (const right of [false, true]) for (const bottom of [false, true]) for (const height of [76, 170, 360]) {
        const body = { x: area.x + (right ? 310 : 10), y: area.y + (bottom ? 410 : 10), width: 480, height: 180 };
        for (const face of [.28, .72]) {
          const p = bubblePosition(body, { width: 340, height }, area, false, { x: face, y: .73 }, body);
          expect(p.x).toBeGreaterThanOrEqual(area.x + 4); expect(p.y).toBeGreaterThanOrEqual(area.y + 4);
          expect(p.x + 340).toBeLessThanOrEqual(area.x + area.width - 4); expect(p.y + height).toBeLessThanOrEqual(area.y + area.height - 4);
          const overlap = p.x < body.x + body.width && p.x + 340 > body.x && p.y < body.y + body.height && p.y + height > body.y;
          expect(overlap).toBe(false);
        }
      }
    }
  });
  it('has six different touch reactions before reusing one', () => {
    const recent: string[] = [];
    for (let i = 0; i < 6; i++) recent.push(contextualFallback('pat', 12, '', recent));
    expect(new Set(recent).size).toBe(6);
    const reaction = contextualFallback('placed_window', 12, 'Homework notes');
    expect(reaction).toBe(''); // No made-up observation or title receipt when generation is unavailable.
  });
  it('slows visits and puts floating destinations inside the selected display', () => {
    expect(nextExploreDelay(() => 0)).toBe(50000);
    expect(nextExploreDelay(() => 1)).toBe(85000);
    const area = { x: -1920, y: -900, width: 1920, height: 1040 };
    const dest = floatingVisit({ x: 0, y: 0, width: 300, height: 400 }, { x: -3000, y: -2000, width: 500, height: 500 }, area, () => 0.5);
    expect(dest.x).toBeGreaterThanOrEqual(area.x); expect(dest.y).toBeGreaterThanOrEqual(area.y);
    expect(dest.x + dest.width).toBeLessThanOrEqual(area.x + area.width);
    expect(dest.y + dest.height).toBeLessThanOrEqual(area.y + area.height);
  });
  it('moves the speech bubble toward the inverted face while keeping it on-screen', () => {
    const pet = { x: 300, y: 40, width: 250, height: 400 }, size = { width: 340, height: 170 }, area = { x: 0, y: 0, width: 1920, height: 1080 };
    const upright = bubblePosition(pet, size, area), inverted = bubblePosition(pet, size, area, true);
    expect(inverted.y).toBeGreaterThan(upright.y + 100);
    expect(inverted.y + size.height).toBeLessThanOrEqual(area.height);
  });
});
