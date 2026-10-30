import { NEUTRAL, type Params } from './params';
import type { AssistantPhase } from '../../shared/ipc';
import { applyClip, CLIPS, ClipInstance, clipByName, REACTION_CLIPS } from './clips';
import { POSTURES, posturesFor, type PostureName, type Surface } from './postures';

export type BehaviorState =
  | 'idle' | 'lookAround' | 'listening' | 'thinking' | 'speaking' | 'reacting'
  | 'sleeping' | 'distracted' | 'action' | 'returning';
export type Reaction = 'happy' | 'surprised' | 'annoyed' | 'curious' | 'wave' | 'nod';

export interface BehaviorInputs {
  phase: AssistantPhase;
  speechLevel: number; // 0..1 lip-sync envelope
  speaking: boolean;
  pointer: { x: number; y: number } | null; // -1..1 relative to head, null when away
  idleSec: number; // system-wide user idle time
  sleepAfterSec: number;
  quiet: boolean; // DND / quiet hours → calmer, no distractions
  intensity: number; // 0..1.5 user animation intensity
  surface?: Surface; // where she is on the desktop (taskbar ledge, a window's top edge, mid-air, screen edge)
  dashing?: number; // -1/1 while gliding sideways across the desktop, 0 otherwise
  held?: boolean; // being dragged by the user
  forceSleep?: boolean;
}

const DUR: Record<BehaviorState, [number, number]> = {
  idle: [6, 15], lookAround: [2, 4], distracted: [2.5, 4], reacting: [1.2, 1.8], action: [2.2, 2.6], returning: [1.4, 1.6],
  listening: [Infinity, Infinity], thinking: [Infinity, Infinity], speaking: [Infinity, Infinity], sleeping: [Infinity, Infinity],
};

/**
 * Behavior state machine. Decides *what* Capri is doing; the Animator decides *how*
 * it moves between poses (smoothly). Deterministic given the random source.
 */
export class Behavior {
  state: BehaviorState = 'idle';
  reaction: Reaction = 'happy';
  private t = 0; // time in state
  private dur = 8;
  private clock = 0;
  private lookTarget = { x: 0, y: 0 };
  private lookTimer = 0;
  private lookBack = false; // distracted look: turned fully away (back view)
  private idleTurn = 0; private idleTurnT = 0;
  readonly history: BehaviorState[] = [];
  /** Currently playing keyframed clip (gesture / emote / fidget), layered over the pose. */
  clip: ClipInstance | null = null;
  readonly clipHistory: string[] = [];
  private intensity = 1;
  /** Held whole-body posture (legs/hips/lean); chosen for where she is, changed every few minutes. */
  posture: PostureName = 'stand';
  private postureT = 0;
  private postureDur = 20;
  private surface: Surface = 'taskbar';
  readonly postureHistory: PostureName[] = [];
  constructor(private rand: () => number = Math.random) {}

  /** Switch posture now (also used by tests / emotes). */
  setPosture(name: PostureName) {
    if (name === this.posture) return;
    this.posture = name;
    this.postureT = 0;
    // she holds a pose for minutes, like the show's long held frames (N 1:49–1:54)
    this.postureDur = (60 + this.rand() * 180) * (this.surface === 'edge_left' || this.surface === 'edge_right' ? 0.25 : 1);
    this.postureHistory.push(name);
    if (this.postureHistory.length > 50) this.postureHistory.shift();
  }
  private pickPosture(): PostureName {
    const opts = posturesFor(this.surface).filter(([n]) => n !== this.posture || posturesFor(this.surface).length === 1);
    const total = opts.reduce((t, [, w]) => t + w, 0);
    let r = this.rand() * total;
    for (const [n, w] of opts) { r -= w; if (r <= 0) return n; }
    return opts[0]?.[0] ?? 'stand';
  }
  private updatePosture(dt: number, inp: BehaviorInputs) {
    const surface = inp.surface ?? 'taskbar';
    if (surface !== this.surface) {
      // moved somewhere new: stand up first (arrival pose), settle into a fitting posture a moment later
      this.surface = surface;
      const fits = POSTURES[this.posture].surfaces.includes(surface);
      if (surface === 'edge_left' || surface === 'edge_right') this.setPosture(surface === 'edge_left' ? 'peek_left' : 'peek_right');
      else if (!fits) { this.setPosture('stand'); this.postureDur = 4 + this.rand() * 4; }
    }
    if (inp.held) { if (this.posture !== 'stand') this.setPosture('stand'); this.postureDur = 3; return; }
    this.postureT += dt;
    if (this.state === 'sleeping') {
      // doze where she is: slumped on a ledge, or curled up in the air
      const want: PostureName = surface === 'taskbar' || surface === 'window' ? 'sit_edge' : surface === 'air' ? 'air_sit' : this.posture;
      if (this.posture !== want) this.setPosture(want);
      return;
    }
    const conversational = this.state === 'listening' || this.state === 'speaking' || this.state === 'thinking';
    if (this.postureT >= this.postureDur && !conversational && !this.clip) this.setPosture(this.pickPosture());
  }

  /** Start a clip by name. Returns false if unknown. */
  playClip(name: string, state: 'action' | 'reacting' = 'action'): boolean {
    const c = clipByName(name);
    if (!c) return false;
    this.clip = ClipInstance.random(c, this.rand, this.intensity);
    this.clipHistory.push(c.name);
    if (this.clipHistory.length > 50) this.clipHistory.shift();
    this.enter(state);
    this.dur = this.clip.duration;
    return true;
  }
  private pickIdleClip(quiet: boolean): string {
    const pool = CLIPS.filter((c) => c.tags.includes('idle') && (!quiet || c.tags.includes('subtle')));
    // avoid repeating the last two
    const fresh = pool.filter((c) => !this.clipHistory.slice(-2).includes(c.name));
    const from = fresh.length ? fresh : pool;
    return from[Math.floor(this.rand() * from.length)].name;
  }

  private enter(s: BehaviorState) {
    if (s === this.state && s !== 'reacting' && s !== 'action') return;
    this.state = s;
    this.t = 0;
    const [a, b] = DUR[s];
    this.dur = Number.isFinite(a) ? a + this.rand() * (b - a) : Infinity;
    this.lookTimer = 0;
    this.history.push(s);
    if (this.history.length > 50) this.history.shift();
  }

  react(r: Reaction) {
    if (this.state === 'sleeping') { this.enter('returning'); return; }
    this.reaction = r;
    const pool = REACTION_CLIPS[r];
    const name = pool[Math.floor(this.rand() * pool.length)];
    if (!this.playClip(name, r === 'wave' ? 'action' : 'reacting')) this.enter(r === 'wave' ? 'action' : 'reacting');
  }
  wake() { if (this.state === 'sleeping') this.enter('returning'); }

  private lastDt = 1 / 60;
  update(dt: number, inp: BehaviorInputs): Params {
    if (inp.forceSleep && !inp.held) { this.clip = null; this.enter('sleeping'); }
    this.lastDt = dt;
    this.intensity = inp.intensity;
    this.t += dt;
    this.clock += dt;
    this.transition(inp);
    this.updatePosture(dt, inp);
    let p = this.pose(inp);
    p = this.applyPosture(p, inp);
    if (this.clip) {
      p = applyClip(p, this.clip.sample(dt), this.clip.weight);
      if (this.clip.done) this.clip = null;
    }
    return p;
  }

  private transition(inp: BehaviorInputs) {
    if (inp.forceSleep && !inp.held) return;
    const s = this.state;
    // conversation phases take priority over ambient behavior
    if (inp.phase === 'listening' || inp.phase === 'transcribing') { if (s !== 'listening') { this.clip = null; this.enter('listening'); } return; }
    if (inp.speaking || inp.phase === 'speaking') { if (s !== 'speaking' && s !== 'action') this.enter('speaking'); return; }
    if (inp.phase === 'thinking') { if (s !== 'thinking' && s !== 'reacting') { if (s !== 'action') this.clip = null; this.enter('thinking'); } return; }
    if (s === 'listening' || s === 'thinking' || s === 'speaking') {
      if (inp.phase === 'error') { this.reaction = 'annoyed'; this.enter('reacting'); }
      else this.enter('idle');
      return;
    }
    if (s === 'sleeping') { if (inp.idleSec < 5 || inp.pointer) { this.clip = null; this.enter('returning'); } return; }
    if (inp.idleSec >= inp.sleepAfterSec && (s === 'idle' || s === 'lookAround')) { this.enter('sleeping'); return; }
    if (this.t < this.dur) return;
    if (s === 'idle') {
      const r = this.rand();
      const distractChance = inp.quiet ? 0 : 0.18 * Math.min(1, inp.intensity);
      // ambient variety: look around, get distracted, or play an idle fidget clip
      if (r < distractChance) this.enter('distracted');
      else if (r < distractChance + 0.4 * Math.min(1, inp.intensity + 0.3)) this.playClip(this.pickIdleClip(inp.quiet));
      else this.enter('lookAround');
    } else this.enter('idle');
  }

  /** Target pose for the current state. */
  private pose(inp: BehaviorInputs): Params {
    const p: Params = { ...NEUTRAL };
    const k = Math.max(0, inp.intensity);
    const c = this.clock;
    // ambient life present in every state: breathing, float bob, sway
    p.breathe = 0.5 + 0.5 * Math.sin(c * 1.6);
    p.bodyY = Math.sin(c * 1.1) * 3 * k;
    p.bodyX = Math.sin(c * 0.37) * 2 * k;
    p.bodyRot = Math.sin(c * 0.29) * 0.015 * k;
    p.headRoll = Math.sin(c * 0.45 + 1) * 0.03 * k;
    p.hip = Math.sin(c * 0.21) * 0.5 * k;
    p.hairWind = 0.25 * k;
    p.maskGlow = 0.25 + 0.05 * Math.sin(c * 2);

    // the whole body turns toward what she looks at, not just the eyes
    const lookAt = (x: number, y: number) => { p.gazeX = x; p.gazeY = y; p.headYaw = x * 0.45; p.headPitch = y * 0.35; p.turn = clamp(x * 0.55, -1, 1); };
    if (inp.pointer && this.state !== 'sleeping') lookAt(clamp(inp.pointer.x, -1, 1), clamp(inp.pointer.y, -1, 1));

    switch (this.state) {
      case 'idle':
        // she holds a 3/4 or side-on stance for a while, then snaps to another (held frames, EFGpu 2:45)
        this.idleTurnT -= this.lastDt;
        if (this.idleTurnT <= 0) { const r = this.rand(); this.idleTurn = r < 0.3 ? 0 : (this.rand() < 0.5 ? -1 : 1) * (r < 0.75 ? 0.5 : 1); this.idleTurnT = 3 + this.rand() * 6; }
        if (!inp.pointer) { lookAt(Math.sin(c * 0.23) * 0.12 + this.idleTurn * 0.4, Math.sin(c * 0.31) * 0.08); p.turn = this.idleTurn; }
        break;
      case 'lookAround':
      case 'distracted': {
        this.lookTimer -= this.lastDt;
        if (this.lookTimer <= 0 || this.t < 0.02) {
          const far = this.state === 'distracted';
          this.lookTarget = { x: (this.rand() * 2 - 1) * (far ? 1 : 0.7), y: (this.rand() * 2 - 1) * (far ? 0.5 : 0.35) };
          if (far) this.lookTarget.x = Math.sign(this.lookTarget.x || 1) * Math.max(0.7, Math.abs(this.lookTarget.x));
          this.lookBack = far && this.rand() < 0.35;
          this.lookTimer = far ? 2 : 0.8 + this.rand();
        }
        if (!inp.pointer) lookAt(this.lookTarget.x, this.lookTarget.y);
        if (!inp.pointer) p.turn = clamp(this.lookTarget.x * (this.state === 'distracted' ? 1.4 : 1), -1, 1);
        if (this.state === 'distracted') { p.headYaw *= 1.6; p.hairWind = 0.6 * k; p.mouthSmile = 0.1; p.eyeWide = 0.3; if (this.lookBack && !inp.pointer) { p.back = 1; p.turn *= 0.3; } }
        break;
      }
      case 'listening':
        lookAt(inp.pointer?.x ?? 0, 0.1);
        p.headRoll = 0.12; p.bodyRot = 0.03; p.eyeWide = 0.35; p.mouthSmile = 0.25;
        p.ringPulse = 0.6 + 0.4 * Math.sin(c * 6); p.maskGlow = 0.5; p.float = 0.55;
        break;
      case 'thinking':
        lookAt(-0.55, -0.55);
        p.squint = 0.35; p.mouthSmile = 0.0; p.armLRaise = 0.55; p.headRoll = -0.08;
        p.maskGlow = 0.45 + 0.35 * (0.5 + 0.5 * Math.sin(c * 5)); p.glitch = 0.08 * k;
        break;
      case 'speaking': {
        const lvl = inp.speechLevel;
        if (!inp.pointer) lookAt(Math.sin(c * 0.7) * 0.2, 0.05);
        p.mouthOpen = lvl;
        p.mouthSmile = 0.45;
        p.headPitch += -lvl * 0.15 * k; // nod on stressed syllables
        p.headRoll += Math.sin(c * 2.3) * 0.05 * k;
        p.maskGlow = 0.35 + lvl * 0.5;
        p.armRRaise = 0.18 + 0.12 * Math.sin(c * 1.3) * k; // conversational hand
        p.float = 0.5;
        break;
      }
      case 'reacting':
        if (this.clip) break; // the reaction clip drives the pose
        switch (this.reaction) {
          case 'happy': p.squint = 0.6; p.mouthSmile = 1; p.mouthOpen = 0.35; p.float = 0.8; p.bodyY -= 6 * Math.sin(Math.min(1, this.t * 3) * Math.PI) * k; break;
          case 'surprised': p.eyeWide = 1; p.mouthOpen = 0.6; p.mouthSmile = 0; p.hairWind = 1 * k; p.glitch = 0.5 * k; break;
          case 'annoyed': p.squint = 0.7; p.mouthSmile = -0.6; p.headRoll = -0.15; lookAt(0.6, 0.2); p.glitch = 0.3 * k; break;
          case 'curious': p.headRoll = 0.2; p.eyeWide = 0.4; lookAt(0, 0.05); p.mouthSmile = 0.3; break;
          case 'nod': p.headPitch = Math.sin(this.t * 10) * 0.4; break;
          default: break;
        }
        break;
      case 'action': // gestures/emotes come from clips; fallback is a wave
        if (this.clip) { if (!inp.pointer) lookAt(0, 0.05); break; }
        p.armRRaise = 1; p.armRWave = Math.sin(this.t * 9); p.mouthSmile = 0.9; p.squint = 0.4; p.headRoll = 0.1; lookAt(0, 0.05);
        break;
      case 'sleeping':
        p.sleep = 1; p.blinkL = 1; p.blinkR = 1; p.headPitch = 0.6; p.headRoll = 0.18; p.float = 0.1; p.mouthSmile = 0.1;
        p.gazeX = 0; p.gazeY = 0.5; p.headYaw = 0;
        p.breathe = 0.5 + 0.5 * Math.sin(c * 0.8); p.bodyY = 6 + Math.sin(c * 0.8) * 2; p.maskGlow = 0.08; p.hairWind = 0.05;
        break;
      case 'returning': // stretch & shake off sleep
        p.armLRaise = 0.9 * Math.sin(Math.min(1, this.t / 1.4) * Math.PI); p.armRRaise = p.armLRaise; p.eyeWide = 0.2;
        p.mouthOpen = 0.4 * Math.sin(Math.min(1, this.t / 1.2) * Math.PI); p.glitch = 0.2 * k; p.headRoll = 0.1;
        break;
    }
    if (inp.quiet && this.state !== 'speaking') { p.hairWind *= 0.5; p.glitch *= 0.3; }
    return p;
  }

  /**
   * Layer the held posture under the state pose: offsets add; other values apply only where the
   * current state hasn't set its own (so "hand to chin" while thinking still wins over a posture).
   */
  private applyPosture(p: Params, inp: BehaviorInputs): Params {
    const pose = POSTURES[this.posture].pose;
    for (const [key, v] of Object.entries(pose) as [keyof Params, number][]) {
      if (ADDITIVE.has(key)) p[key] += v;
      else if (p[key] === NEUTRAL[key]) p[key] = v;
    }
    // gliding across the desktop: hair streams behind her, body leans into the motion, legs trail (B 4:03, 5:03)
    if (inp.dashing) {
      const d = inp.dashing;
      p.hairStream = -d; p.lean = d * 0.18; p.hipDrop = 0; p.bodyX += 0; p.float = 0.9;
      p.thighL = 18 * -d; p.kneeL = 46; p.thighR = 10 * -d; p.kneeR = 58; p.foreL = 1; p.foreR = 1;
      p.armSpread = 0.2; p.eyeWide = 0.2; p.mouthSmile = 0.9;
    }
    return p;
  }
}

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const ADDITIVE = new Set<keyof Params>(['bodyX', 'bodyY', 'bodyRot', 'headRoll', 'headPitch', 'hip', 'gazeX']);
