import { describe, expect, it } from 'vitest';
import { mouthShape } from '../../src/renderer/character/face';
import { CLIPS } from '../../src/renderer/character/clips';

const face = (o: Partial<Parameters<typeof mouthShape>[0]>) => mouthShape({ mouthOpen: 0, mouthSmile: 0.35, happyEyes: 0, squint: 0, eyeWide: 0, ...o });

describe('her mouth follows the expression (not always a zigzag)', () => {
  it('rest, smug and cross are zigzags; happy, talking and surprised are the white fang; only the maniac grin shows teeth', () => {
    expect(face({})).toBe('neutral');
    expect(face({ mouthSmile: 0.8, squint: 0.4 })).toBe('smirk');
    expect(face({ mouthSmile: -0.8 })).toBe('frown');
    expect(face({ happyEyes: 1, mouthSmile: 1 })).toBe('fang');
    expect(face({ mouthOpen: 0.45, mouthSmile: 0.45 })).toBe('fang');
    expect(face({ mouthOpen: 0.7, mouthSmile: 0, eyeWide: 1 })).toBe('fang');
    expect(face({ mouthOpen: 0.85, mouthSmile: 1, eyeWide: 0.9 })).toBe('teeth');
  });
  it('across the clip library at least four different mouths appear', () => {
    const seen = new Set<string>();
    for (const c of CLIPS) for (const k of c.keys) seen.add(face(k.pose as never));
    expect(seen.size).toBeGreaterThanOrEqual(4);
  });
});
