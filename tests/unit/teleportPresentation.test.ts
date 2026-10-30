import { describe, it, expect } from 'vitest';
import { beamBounds } from '../../src/renderer/character/teleportFx';

describe('localized transport filament', () => {
  it.each([1, 1.25, 1.5, 2])('centers on the visible body at display scale %s', dpr => {
    // The seated silhouette can sit noticeably off the native window midpoint.
    const box = { x: 73 * dpr, y: 135 * dpr, w: 142 * dpr, h: 214 * dpr };
    const beam = beamBounds(box, dpr);
    expect(beam.x + beam.w / 2).toBeCloseTo(box.x + box.w / 2);
    expect(beam.w / dpr).toBeLessThanOrEqual(7);
    expect(beam.y / dpr).toBe(127); expect(beam.h / dpr).toBe(230);
    expect(beam.y).toBeGreaterThan(0); // It starts near her body, not the top of the display.
  });
});
