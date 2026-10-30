/** Original lachydotmcg strips, with their original timing and cell dimensions. */
export const SPRITE_CLIPS = {
  idle: { frames: 16, fps: 8, width: 240 },
  blink: { frames: 4, fps: 8, width: 240 },
  blink_glitch: { frames: 4, fps: 8, width: 240 },
  grin: { frames: 16, fps: 8, width: 240 },
  glitch: { frames: 10, fps: 15, width: 240 },
  dangle: { frames: 24, fps: 10, width: 240 },
  sleep: { frames: 16, fps: 6, width: 240 },
  wake: { frames: 13, fps: 15, width: 240 },
  perch: { frames: 16, fps: 8, width: 384 },
  perch_blink: { frames: 4, fps: 8, width: 384 },
  perch_blink_glitch: { frames: 4, fps: 8, width: 384 },
  perch_glitch: { frames: 10, fps: 15, width: 384 },
  mouth: { frames: 5, fps: 12, width: 240 },
} as const;
export type SpriteClip = keyof typeof SPRITE_CLIPS;

export function spriteFrame(clip: SpriteClip, seconds: number, loop = true): number {
  const def = SPRITE_CLIPS[clip];
  const frame = Math.max(0, Math.floor(seconds * def.fps));
  return loop ? frame % def.frames : Math.min(def.frames - 1, frame);
}

export function spriteBase(input: { sleeping: boolean; dragging: boolean; ledge: boolean; speaking: boolean }): SpriteClip {
  if (input.dragging) return 'dangle';
  if (input.sleeping) return 'sleep';
  // Only the standing art has a matching jaw overlay. Speaking takes precedence over perching.
  if (input.speaking && !input.ledge) return 'idle';
  return input.ledge ? 'perch' : 'idle';
}

/** Sitting looks right in the original strip; the standing family looks left. */
export function spriteFacing(target: number, current = 1, clip: SpriteClip = 'idle'): number {
  if (Math.abs(target) < 0.18) return current;
  const source = clip.startsWith('perch') ? 1 : -1;
  return (target < 0 ? -1 : 1) * source;
}
