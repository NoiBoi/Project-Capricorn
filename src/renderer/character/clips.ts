import type { Params } from './params';

/**
 * Keyframed animation clips layered over the behavior pose.
 * `source` is honest provenance: 'frame#N' = pose matched to an official frame
 * (reference/SOURCES.md), 'interpretation' = authored for this app.
 */
type Pose = Partial<Params>;
export interface Clip {
  name: string;
  duration: number; // seconds at speed 1
  keys: { t: number; pose: Pose }[]; // t in 0..1, sorted
  tags: ('idle' | 'subtle' | 'reaction' | 'gesture' | 'emote')[];
  mirror?: boolean; // may be played left/right flipped
  /** 'snap' = Trigger-style limited animation: fast move (15% of a segment), then hold (N 1:49-1:54) */
  ease?: 'smooth' | 'snap';
  source: 'frame#1' | 'frame#3' | 'clip:N1:51' | 'clip:N2:06' | 'clip:N2:14' | 'clip:N2:34' | 'clip:B0:13' | 'clip:B2:33' | 'clip:B2:48' | 'clip:B3:03' | 'interpretation';
}

const k = (t: number, pose: Pose) => ({ t, pose });
/** n+1 alternating keys from `from` to 0.9 (keeps key times sorted after a lead-in key). */
const osc = (n: number, amp: number, key: keyof Params, extra: Pose = {}, from = 0.1) =>
  Array.from({ length: n + 1 }, (_, i) => k(from + ((0.9 - from) * i) / n, { ...extra, [key]: i % 2 ? -amp : amp }));

export const CLIPS: Clip[] = [
  // ---- grounded in official frames
  { name: 'tilt_grin', duration: 2.6, source: 'frame#3', ease: 'snap', tags: ['emote', 'reaction'], mirror: true, keys: [
    k(0, {}), k(0.25, { headRoll: 0.35, headPitch: 0.3, headYaw: 0.25, eyeWide: 0.6, mouthOpen: 0.55, mouthSmile: 0.9, gazeY: 0.2 }),
    k(0.75, { headRoll: 0.38, headPitch: 0.32, headYaw: 0.25, eyeWide: 0.6, mouthOpen: 0.5, mouthSmile: 1 }), k(1, {}) ] },
  { name: 'front_stare', duration: 2.2, source: 'frame#1', tags: ['idle', 'subtle'], keys: [
    k(0, {}), k(0.2, { headYaw: 0, headPitch: 0, gazeX: 0, gazeY: 0, eyeWide: 0.4, mouthSmile: 0.4 }), k(0.8, { headYaw: 0, gazeX: 0, gazeY: 0, eyeWide: 0.45, mouthSmile: 0.45 }), k(1, {}) ] },

  // ---- observed in the Netflix clip (see docs/ANIMATION_CATALOG.md)
  { name: 'reveal_spread', duration: 2.8, source: 'clip:N1:51', ease: 'snap', tags: ['emote', 'gesture'], keys: [
    k(0, {}), k(0.12, { armSpread: 1, headPitch: -0.12, eyeWide: 0.35, mouthSmile: 0.8, mouthOpen: 0.2, float: 0.8, hairWind: 0.8 }),
    k(0.8, { armSpread: 1, headPitch: -0.1, eyeWide: 0.3, mouthSmile: 0.85, float: 0.8 }), k(1, {})] },
  { name: 'menace', duration: 2.2, source: 'clip:N2:06', ease: 'snap', tags: ['emote', 'reaction'], mirror: true, keys: [
    k(0, {}), k(0.15, { squint: 0.95, headPitch: 0.25, headRoll: 0.08, mouthSmile: 0.9, mouthOpen: 0.25, gazeY: -0.2 }),
    k(0.8, { squint: 0.95, headPitch: 0.25, mouthSmile: 0.9, mouthOpen: 0.25 }), k(1, {})] },
  { name: 'many_eyes', duration: 1.8, source: 'clip:N2:14', tags: ['emote', 'reaction'], keys: [
    k(0, {}), k(0.3, { manyEyes: 1, eyeWide: 0.6, glitch: 0.3, maskGlow: 0.7 }), k(0.7, { manyEyes: 1, eyeWide: 0.5 }), k(1, {})] },
  { name: 'loom', duration: 2.6, source: 'clip:N2:34', ease: 'snap', tags: ['emote'], keys: [
    k(0, {}), k(0.2, { float: 1, bodyY: -8, headPitch: 0.35, eyeWide: 0.7, mouthSmile: 0.9, armSpread: 0.45, armLRaise: 0.3, armRRaise: 0.3 }),
    k(0.8, { float: 1, bodyY: -8, headPitch: 0.38, eyeWide: 0.7, mouthSmile: 0.95 }), k(1, {})] },

  // ---- from the "Capri is a baddie" compilation of Netflix footage (B = Nli_SZ-DBco)
  { name: 'smug', duration: 2.4, source: 'clip:B2:33', ease: 'snap', tags: ['emote', 'reaction'], mirror: true, keys: [
    k(0, {}), k(0.15, { happyEyes: 1, mouthSmile: 1, headRoll: 0.18, headPitch: -0.08 }), k(0.85, { happyEyes: 1, mouthSmile: 1, headRoll: 0.2 }), k(1, {})] },
  { name: 'blank_stare', duration: 1.8, source: 'clip:B0:13', ease: 'snap', tags: ['emote', 'reaction'], keys: [
    k(0, {}), k(0.12, { blankEyes: 1, eyeWide: 0.7, mouthOpen: 0.2, mouthSmile: 0, headPitch: -0.05 }), k(0.85, { blankEyes: 1, eyeWide: 0.7 }), k(1, {})] },
  { name: 'reach_claw', duration: 2.0, source: 'clip:B2:48', ease: 'snap', tags: ['gesture', 'emote'], mirror: true, keys: [
    k(0, {}), k(0.18, { armRRaise: 0.62, armRWave: 0.6, clawScale: 2, eyeWide: 0.5, mouthSmile: 0.9, mouthOpen: 0.3, headPitch: 0.1 }),
    k(0.8, { armRRaise: 0.62, armRWave: 0.5, clawScale: 2.1, eyeWide: 0.5, mouthSmile: 0.9 }), k(1, {})] },
  { name: 'maniac_grin', duration: 2.0, source: 'clip:B3:03', ease: 'snap', tags: ['emote', 'reaction'], mirror: true, keys: [
    k(0, {}), k(0.12, { mouthOpen: 0.85, mouthSmile: 1, eyeWide: 0.9, headRoll: 0.25, headPitch: 0.2, glitch: 0.2 }), k(0.85, { mouthOpen: 0.8, mouthSmile: 1, eyeWide: 0.85, headRoll: 0.28 }), k(1, {})] },

  // ---- idle fidgets (interpretation)
  { name: 'glance_side', duration: 1.8, source: 'interpretation', tags: ['idle', 'subtle'], mirror: true, keys: [k(0, {}), k(0.2, { gazeX: 0.9 }), k(0.45, { gazeX: 0.9, headYaw: 0.3 }), k(1, {})] },
  { name: 'glance_up', duration: 1.6, source: 'interpretation', tags: ['idle', 'subtle'], keys: [k(0, {}), k(0.3, { gazeY: -0.8, headPitch: -0.15 }), k(1, {})] },
  { name: 'peek_down', duration: 2, source: 'interpretation', tags: ['idle', 'subtle'], mirror: true, keys: [k(0, {}), k(0.3, { gazeY: 0.9, gazeX: 0.3, headPitch: 0.35 }), k(0.7, { gazeY: 0.9, gazeX: 0.4, headPitch: 0.35 }), k(1, {})] },
  { name: 'over_shoulder', duration: 2.4, source: 'interpretation', tags: ['idle'], mirror: true, keys: [k(0, {}), k(0.3, { headYaw: 1, gazeX: 1, bodyRot: 0.05, hairWind: 0.6 }), k(0.65, { headYaw: 1, gazeX: 1 }), k(1, {})] },
  { name: 'slow_blink', duration: 1.2, source: 'interpretation', tags: ['idle', 'subtle'], keys: [k(0, {}), k(0.4, { blinkL: 1, blinkR: 1 }), k(0.6, { blinkL: 1, blinkR: 1 }), k(1, {})] },
  { name: 'double_take', duration: 1.6, source: 'interpretation', tags: ['idle', 'reaction'], mirror: true, keys: [k(0, {}), k(0.15, { headYaw: 0.6, gazeX: 0.8 }), k(0.3, { headYaw: 0, gazeX: 0 }), k(0.45, { headYaw: 0.75, gazeX: 1, eyeWide: 0.9 }), k(0.8, { headYaw: 0.7, eyeWide: 0.8 }), k(1, {})] },
  { name: 'hair_flick', duration: 1.4, source: 'interpretation', tags: ['idle', 'emote'], mirror: true, keys: [k(0, {}), k(0.2, { headRoll: -0.25, hairWind: 1 }), k(0.4, { headRoll: 0.2, hairWind: 1, squint: 0.3, mouthSmile: 0.7 }), k(1, {})] },
  { name: 'head_bob', duration: 2.4, source: 'interpretation', tags: ['idle'], keys: [k(0, {}), ...osc(6, 0.18, 'headPitch', { mouthSmile: 0.6 }), k(1, {})] },
  { name: 'sway_hum', duration: 3.2, source: 'interpretation', tags: ['idle'], keys: [k(0, {}), ...osc(4, 0.12, 'headRoll', { squint: 0.4, mouthSmile: 0.6 }), k(1, {})] },
  { name: 'stretch', duration: 2.6, source: 'interpretation', tags: ['idle'], keys: [k(0, {}), k(0.35, { armLRaise: 1, armRRaise: 1, headPitch: -0.3, squint: 0.6, mouthOpen: 0.3, float: 0.7 }), k(0.65, { armLRaise: 1, armRRaise: 1, headPitch: -0.3, squint: 0.6 }), k(1, {})] },
  { name: 'yawn', duration: 2.4, source: 'interpretation', tags: ['idle'], keys: [k(0, {}), k(0.3, { mouthOpen: 0.9, mouthSmile: 0, squint: 0.8, headPitch: -0.2, armLRaise: 0.4 }), k(0.6, { mouthOpen: 0.95, squint: 0.9 }), k(1, {})] },
  { name: 'sigh', duration: 2, source: 'interpretation', tags: ['idle', 'subtle'], keys: [k(0, {}), k(0.35, { breathe: 1, headPitch: -0.1 }), k(0.7, { breathe: 0, headPitch: 0.15, squint: 0.3, mouthSmile: 0.1 }), k(1, {})] },
  { name: 'float_up', duration: 2.4, source: 'interpretation', tags: ['idle'], keys: [k(0, {}), k(0.4, { float: 1, hairWind: 0.5 }), k(0.7, { float: 1 }), k(1, {})] },
  { name: 'shiver_glitch', duration: 1, source: 'interpretation', tags: ['idle', 'emote'], keys: [k(0, {}), k(0.2, { glitch: 0.9, eyeWide: 0.5 }), k(0.5, { glitch: 0.6 }), k(1, {})] },
  { name: 'chin_tap', duration: 2.6, source: 'interpretation', tags: ['idle', 'gesture'], keys: [k(0, {}), ...osc(5, 0.06, 'headRoll', { armLRaise: 0.55, gazeX: -0.5, gazeY: -0.5, squint: 0.3 }), k(1, {})] },
  { name: 'proud_pose', duration: 2.4, source: 'interpretation', tags: ['emote'], mirror: true, keys: [k(0, {}), k(0.3, { headPitch: -0.35, headRoll: 0.15, squint: 0.55, mouthSmile: 1, float: 0.8, hairWind: 0.7 }), k(0.75, { headPitch: -0.3, squint: 0.5, mouthSmile: 1 }), k(1, {})] }, // "beautiful me"

  // ---- gestures
  { name: 'wave_small', duration: 1.8, source: 'interpretation', tags: ['gesture', 'reaction'], keys: [k(0, {}), k(0.2, { armRRaise: 0.85, mouthSmile: 0.8 }), ...osc(4, 0.6, 'armRWave', { armRRaise: 0.85, mouthSmile: 0.8 }, 0.3), k(1, {})] },
  { name: 'wave_big', duration: 2.4, source: 'interpretation', tags: ['gesture', 'reaction'], keys: [k(0, {}), k(0.15, { armRRaise: 1, mouthSmile: 1, squint: 0.4, headRoll: 0.1 }), ...osc(6, 1, 'armRWave', { armRRaise: 1, mouthSmile: 1, squint: 0.4 }, 0.25), k(1, {})] },
  { name: 'shrug', duration: 1.6, source: 'interpretation', tags: ['gesture', 'reaction'], keys: [k(0, {}), k(0.35, { armLRaise: 0.3, armRRaise: 0.3, headRoll: 0.18, mouthSmile: -0.1, breathe: 1 }), k(0.65, { armLRaise: 0.3, armRRaise: 0.3, headRoll: 0.18 }), k(1, {})] },
  { name: 'nod_slow', duration: 1.4, source: 'interpretation', tags: ['gesture', 'reaction'], keys: [k(0, {}), k(0.25, { headPitch: 0.35 }), k(0.5, { headPitch: -0.05 }), k(0.75, { headPitch: 0.3 }), k(1, {})] },
  { name: 'shake_no', duration: 1.4, source: 'interpretation', tags: ['gesture', 'reaction'], keys: [k(0, {}), ...osc(4, 0.45, 'headYaw', { mouthSmile: -0.2 }), k(1, {})] },
  { name: 'point_up', duration: 1.8, source: 'interpretation', tags: ['gesture'], keys: [k(0, {}), k(0.25, { armRRaise: 0.8, armRWave: -0.4, gazeY: -0.6, eyeWide: 0.4 }), k(0.75, { armRRaise: 0.8, armRWave: -0.4 }), k(1, {})] },

  // ---- reactions / emotes
  { name: 'giggle', duration: 1.6, source: 'interpretation', tags: ['reaction', 'emote'], keys: [k(0, {}), ...osc(5, 4, 'bodyY', { squint: 0.8, mouthOpen: 0.45, mouthSmile: 1 }), k(1, {})] },
  { name: 'surprise_flinch', duration: 1.4, source: 'interpretation', tags: ['reaction'], keys: [k(0, {}), k(0.1, { eyeWide: 1, mouthOpen: 0.7, mouthSmile: 0, headPitch: -0.25, hairWind: 1, glitch: 0.6, float: 0.9, manyEyes: 0.7 }), k(0.6, { eyeWide: 0.8, mouthOpen: 0.4 }), k(1, {})] },
  { name: 'eye_roll', duration: 1.6, source: 'interpretation', tags: ['reaction', 'emote'], keys: [k(0, {}), k(0.2, { gazeX: -0.7, gazeY: -0.7, squint: 0.3 }), k(0.45, { gazeX: 0, gazeY: -1, squint: 0.3 }), k(0.7, { gazeX: 0.7, gazeY: -0.6, mouthSmile: -0.4, headRoll: -0.1 }), k(1, {})] },
  { name: 'pout', duration: 1.8, source: 'interpretation', tags: ['reaction', 'emote'], mirror: true, keys: [k(0, {}), k(0.3, { mouthSmile: -0.8, squint: 0.5, headRoll: -0.15, headYaw: 0.4, gazeX: 0.6 }), k(0.75, { mouthSmile: -0.8, squint: 0.5 }), k(1, {})] },
  { name: 'curious_lean', duration: 1.8, source: 'interpretation', tags: ['reaction'], mirror: true, keys: [k(0, {}), k(0.3, { headRoll: 0.25, bodyRot: 0.06, eyeWide: 0.5, mouthSmile: 0.3 }), k(0.8, { headRoll: 0.25, bodyRot: 0.05, eyeWide: 0.45 }), k(1, {})] },
  { name: 'wink', duration: 1.2, source: 'interpretation', tags: ['emote', 'reaction'], mirror: true, keys: [k(0, {}), k(0.3, { blinkL: 1, squint: 0.3, mouthSmile: 1, headRoll: 0.12 }), k(0.6, { blinkL: 1, mouthSmile: 1 }), k(1, {})] },
  { name: 'tease', duration: 2.2, source: 'interpretation', tags: ['emote'], mirror: true, keys: [k(0, {}), k(0.25, { headRoll: 0.3, headPitch: 0.2, squint: 0.6, mouthSmile: 1, mouthOpen: 0.25, gazeX: 0.3 }), k(0.5, { blinkL: 1, headRoll: 0.3, mouthSmile: 1 }), k(0.7, { headRoll: 0.28, squint: 0.5 }), k(1, {})] },
  { name: 'cheer', duration: 1.8, source: 'interpretation', tags: ['emote', 'reaction'], keys: [k(0, {}), k(0.25, { armLRaise: 1, armRRaise: 1, mouthOpen: 0.6, mouthSmile: 1, squint: 0.6, float: 1 }), ...osc(3, 0.3, 'armRWave', { armLRaise: 1, armRRaise: 1, mouthSmile: 1, float: 1 }, 0.35), k(1, {})] },
  { name: 'facepalm', duration: 2, source: 'interpretation', tags: ['emote', 'reaction'], keys: [k(0, {}), k(0.3, { armLRaise: 0.62, headPitch: 0.4, blinkL: 1, blinkR: 1, mouthSmile: -0.4 }), k(0.75, { armLRaise: 0.62, headPitch: 0.4, blinkL: 1, blinkR: 1 }), k(1, {})] },
  { name: 'drowsy_nod', duration: 3, source: 'interpretation', tags: ['idle'], keys: [k(0, {}), k(0.3, { headPitch: 0.5, squint: 0.8, sleep: 0.5 }), k(0.45, { headPitch: -0.1, eyeWide: 0.5, sleep: 0 }), k(1, {})] },
];

export const REACTION_CLIPS: Record<'happy' | 'surprised' | 'annoyed' | 'curious' | 'wave' | 'nod', string[]> = {
  happy: ['giggle', 'tilt_grin', 'wink', 'cheer', 'reveal_spread', 'smug', 'maniac_grin'],
  surprised: ['surprise_flinch', 'double_take', 'many_eyes', 'blank_stare'],
  annoyed: ['eye_roll', 'pout', 'facepalm', 'shake_no', 'menace'],
  curious: ['curious_lean', 'tilt_grin'],
  wave: ['wave_big', 'wave_small'],
  nod: ['nod_slow'],
};

const MIRROR_KEYS = new Set<keyof Params>(['headYaw', 'gazeX', 'headRoll', 'bodyRot', 'bodyX', 'armRWave']);

/** One playback of a clip with per-play variation (speed, amplitude, mirroring). */
export class ClipInstance {
  t = 0;
  readonly duration: number;
  constructor(readonly clip: Clip, private amp = 1, speed = 1, private mirrored = false) {
    this.duration = clip.duration / speed;
  }
  static random(clip: Clip, rand: () => number, intensity = 1) {
    return new ClipInstance(clip, (0.8 + rand() * 0.4) * Math.min(1.2, Math.max(0.3, intensity)), 0.85 + rand() * 0.3, !!clip.mirror && rand() < 0.5);
  }
  get done() { return this.t >= this.duration; }
  /** Fade weight for blending the clip in/out of the base pose. */
  get weight() { const u = this.t / this.duration; return Math.min(1, u / 0.12, (1 - u) / 0.12); }

  /** Sample the clip; returns params to blend over the base pose. */
  sample(dt: number): Pose {
    this.t += dt;
    const u = Math.min(1, this.t / this.duration);
    const keys = this.clip.keys;
    let i = 0;
    while (i < keys.length - 2 && keys[i + 1].t < u) i++;
    const a = keys[i], b = keys[Math.min(i + 1, keys.length - 1)];
    const span = b.t - a.t || 1;
    const x = Math.min(1, Math.max(0, (u - a.t) / span));
    const xe = this.clip.ease === 'snap' ? Math.min(1, x / 0.15) : x;
    const s = xe * xe * (3 - 2 * xe); // smoothstep between keys (snap: fast move, then hold)
    const out: Pose = {};
    const names = new Set([...Object.keys(a.pose), ...Object.keys(b.pose)]) as Set<keyof Params>;
    for (const n of names) {
      const va = a.pose[n], vb = b.pose[n];
      // a param missing on one side fades to/from "no influence" via the weight below
      let v = va !== undefined && vb !== undefined ? va + (vb - va) * s : (va ?? vb)!;
      const presence = va !== undefined && vb !== undefined ? 1 : va !== undefined ? 1 - s : s;
      const isEye = n === 'blinkL' || n === 'blinkR';
      if (!isEye && n !== 'sleep') v *= this.amp;
      if (this.mirrored && MIRROR_KEYS.has(n)) v = -v;
      out[n] = v;
      (out as Record<string, number>)[`__w_${n}`] = presence;
    }
    if (this.mirrored && ('blinkL' in out || 'blinkR' in out)) {
      const l = out.blinkL, r = out.blinkR;
      out.blinkL = r; out.blinkR = l;
      const wl = (out as Record<string, number>).__w_blinkL, wr = (out as Record<string, number>).__w_blinkR;
      (out as Record<string, number>).__w_blinkL = wr; (out as Record<string, number>).__w_blinkR = wl;
    }
    return out;
  }
}

/** Blend a sampled clip pose over a base pose (weights handle fade in/out per param). */
export function applyClip(base: Params, clipPose: Pose, weight: number): Params {
  const out = { ...base };
  for (const [key, v] of Object.entries(clipPose)) {
    if (key.startsWith('__w_') || v === undefined) continue;
    const n = key as keyof Params;
    const w = weight * ((clipPose as Record<string, number>)[`__w_${n}`] ?? 1);
    out[n] = base[n] + (v - base[n]) * w;
  }
  return out;
}

export const clipByName = (n: string) => CLIPS.find((c) => c.name === n);
