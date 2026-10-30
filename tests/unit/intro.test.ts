import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { introPosition, INTRO_MS, INTRO_FRAMES } from '../../src/shared/intro';
describe('screen-grab greeting', () => {
  it.each([[1920, 1080], [2560, 1440], [1080, 1920], [3440, 1440]])('lands at the pet on a %sx%s display', (w, h) => {
    const to = { x: 240, y: 600, size: 85 };
    const initial = introPosition(w, h, to, 1000), final = introPosition(w, h, to, INTRO_MS);
    expect(initial.progress).toBe(0); expect(final.x).toBe(to.x); expect(final.y).toBe(to.y);
    expect(final.scale * 430).toBeCloseTo(to.size);
    expect(initial.scale).toBeGreaterThan(final.scale);
    const left = initial.x - 830 * initial.scale, top = initial.y - 330 * initial.scaleY;
    expect(left).toBeGreaterThanOrEqual(0); expect(top).toBeGreaterThanOrEqual(0);
    expect(left).toBeCloseTo(0); expect(left + 1672 * initial.scale).toBeCloseTo(w);
    expect(top + 941 * initial.scaleY).toBeLessThanOrEqual(h);
    expect(final.scaleY).toBe(final.scale);
  });
  it('uses a stationary, bounded portrait for reduced motion', () => {
    const to = { x: 300, y: 700, size: 90 };
    const a = introPosition(1920, 1080, to, 100, true), b = introPosition(1920, 1080, to, 1000, true);
    expect(a).toEqual(b); expect(a.scale * 941).toBeLessThanOrEqual(1080 * .6);
  });
  it('ships every animation cel and the Windows icon with provenance', () => {
    const root = path.resolve(__dirname, '../../assets/capri/mochiiwuff');
    for (const frame of INTRO_FRAMES) expect(fs.readFileSync(path.join(root, `intro-${frame}.webp`)).subarray(8, 12).toString()).toBe('WEBP');
    expect(fs.existsSync(path.join(root, 'icon.ico'))).toBe(true);
    expect(fs.readFileSync(path.join(root, 'SOURCES.md'), 'utf8')).toContain('intro');
  });
});
