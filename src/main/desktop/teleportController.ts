import type { Settings } from '../../shared/settings';
import type { CharacterCue } from '../../shared/ipc';
import type { Logger } from '../log';
import type { DisplayLike, Rect } from './displays';
import { chooseDestination, type Destination, type TeleportTarget } from './teleport';
import { traversalPlan, traversalPoint } from './spatial';

export interface TeleportDeps {
  settings(): Settings;
  bounds(): Rect | null; // character window bounds, null if no window
  move(r: Rect, how?: 'teleport' | 'glide'): void; // actually reposition the native window
  displays(): DisplayLike[];
  cursor(): { x: number; y: number };
  activeWindow(): Rect | null; // DIP rect of the foreground app
  canOccupy?(r: Rect): boolean;
  cursorProtected?(): boolean;
  cue(c: CharacterCue): void;
  aiConnected(): boolean;
  /** Production automatic travel requires a cognitive execution lease. */
  automaticAdmission?(): boolean;
  automaticSchedule?(): {nextAt:number;ready:boolean};
  /** Reason autonomous behaviour must not run right now, or null. */
  blocked(): string | null;
  userIdleSec(): number;
  /** After every move: lets the app work out where she now stands (taskbar / window / air / edge). */
  moved?(d: Destination, how: 'teleport' | 'glide'): void;
  /** Release supported poses before the first flight frame. */
  prepareFlight?(how?: 'teleport' | 'glide'): Promise<void>;
  arrived?(d: Destination, reason: 'manual' | 'auto' | 'ai' | 'direct'): void;
  log: Logger;
}

/**
 * Real desktop teleport: departure FX at the old spot → native window moves → arrival FX.
 * Each FX phase is acknowledged by the renderer (with a timeout so a stalled renderer
 * can never strand her mid-teleport).
 */
export class TeleportController {
  private seq = 0;
  private revision = 0;
  cancel() { this.revision++; }
  private waiting = new Map<string, () => void>();
  private busy = false;
  last: string | null = null;
  count = 0;
  lastBlocked: string | null = null;

  constructor(private d: TeleportDeps) {}

  get active() { return this.busy; }
  private automaticBlock() {
    if(!this.d.settings().teleport.auto)return 'automatic teleport is off';
    if(!this.d.aiConnected())return 'AI is not connected';
    if(this.d.userIdleSec()>300)return 'user is away';
    const reason = this.d.blocked();
    // The exploration owner may still request automatic travel itself.
    if(reason&&reason!=='window exploration handles autonomous movement')return reason;
    return this.d.automaticAdmission?.() === false?'cognitive runtime has not admitted automatic movement':null;
  }

  /** Renderer finished a phase. */
  ack(id: number, phase: 'out' | 'in') { this.waiting.get(`${id}:${phase}`)?.(); }

  private waitAck(id: number, phase: 'out' | 'in', ms: number) {
    return new Promise<boolean>((resolve) => {
      const key = `${id}:${phase}`;
      const t = setTimeout(() => { this.waiting.delete(key); resolve(false); }, ms);
      this.waiting.set(key, () => { clearTimeout(t); this.waiting.delete(key); resolve(true); });
    });
  }

  /** Fly straight to a spot (computer control: she follows what she's working on). Skips if she's mid-move. */
  /** Teleport (glitch out, reappear) to an exact spot: she follows what she's working on. Skips if busy. */
  async jumpTo(dest: Destination | (() => Destination | null), animation?: 'perch_glitch', cancelled?: () => boolean, canOccupy = this.d.canOccupy) {
    if (this.busy) return false;
    this.busy = true;
    const revision = this.revision;
    const id = ++this.seq, fx = this.d.settings().teleport.effects;
    try {
      const departure = this.waitAck(id, 'out', fx ? 1500 : 400);
      this.d.cue({ type: 'teleport', phase: 'out', id, effects: fx, animation });
      await departure;
      let target: Destination | undefined;
      if (revision === this.revision && !cancelled?.()) {
        target = (typeof dest === 'function' ? dest() : dest) ?? undefined;
        if (target && canOccupy?.(target) === false) target = undefined;
        if (target) { await this.d.prepareFlight?.('teleport'); if(revision!==this.revision||cancelled?.())target=undefined; }
        // Resolve moving supports after pose release as well as after departure FX.
        if (target && typeof dest === 'function') target = dest() ?? undefined;
        if (target && canOccupy?.(target) === false) target = undefined;
        if (target) { this.d.move(target, 'teleport'); this.d.moved?.(target, 'teleport'); }
      }
      const arrival = this.waitAck(id, 'in', fx ? 1800 : 400);
      this.d.cue({ type: 'teleport', phase: 'in', id, effects: fx, animation });
      await arrival;
      if (target) this.d.arrived?.(target, 'direct');
      return !!target;
    } finally { this.busy = false; }
  }

  async flyTo(dest: Destination, options: { gentle?: boolean; cancelled?: () => boolean; canOccupy?: (r: Rect) => boolean; silent?: boolean; curve?: number; pace?: number; hop?: boolean } = {}) {
    if (this.busy) return false;
    this.busy = true;
    const revision=this.revision;
    try { const complete = await this.glide(dest, {...options,cancelled:()=>revision!==this.revision||!!options.cancelled?.()}); if (complete) { this.d.moved?.(dest, 'glide'); if (!options.silent) this.d.arrived?.(dest, 'direct'); } return complete; } finally { this.busy = false; }
  }

  /** Glide across the desktop (B 4:03 dash): the window slides, hair streams behind her. */
  private async glide(dest: Destination, options: { gentle?: boolean; cancelled?: () => boolean; canOccupy?: (r: Rect) => boolean; curve?: number; pace?: number; hop?: boolean } = {}): Promise<boolean> {
    if(options.cancelled?.())return false;
    await this.d.prepareFlight?.('glide');
    if(options.cancelled?.())return false;
    const cur = this.d.bounds();
    if (!cur) return false;
    const dx = dest.x - cur.x, dy = dest.y - cur.y;
    const distance = Math.hypot(dx, dy);
    if (distance < 2) return true;
    const safe = (r: Rect) => this.d.canOccupy?.(r) !== false && options.canOccupy?.(r) !== false;
    const plan = traversalPlan(cur, dest, this.d.displays(), safe, options.hop);
    if (!plan) return false;
    const length = plan.points.reduce((n, p, i) => n + Math.hypot(p.x - (plan.points[i - 1] ?? cur).x, p.y - (plan.points[i - 1] ?? cur).y), 0);
    const dur = (plan.kind === 'hop' ? Math.max(400, length / .55) : options.gentle ? Math.min(3800, Math.max(800, length / .32)) : Math.min(2400, Math.max(520, length / .72))) * Math.max(.6, Math.min(1.6, options.pace ?? 1));
    this.d.cue({ type: 'dash', dir: dx < 0 ? -1 : 1 });
    const t0 = Date.now();
    const complete = await new Promise<boolean>((resolve) => {
      const step = () => {
        if (options.cancelled?.()) { clearInterval(timer); resolve(false); return; }
        const u = Math.min(1, (Date.now() - t0) / dur);
        // Minimum-jerk timing: zero velocity AND acceleration at takeoff and contact.
        const e = u * u * u * (10 + u * (-15 + 6 * u));
        const point = traversalPoint(cur, plan, e);
        const step = { ...dest, x: Math.round(point.x), y: Math.round(point.y) };
        if (!safe(step)) { clearInterval(timer); resolve(false); return; }
        this.d.move(step, 'glide');
        if (u >= 1) { clearInterval(timer); resolve(true); }
      };
      const timer = setInterval(step, 16);
    });
    this.d.cue({ type: 'dash', dir: 0 });
    return complete;
  }

  async go(target: TeleportTarget, reason: 'manual' | 'auto' | 'ai', how: 'teleport' | 'glide' | 'either' = 'teleport'): Promise<{ ok: boolean; detail: string; to?: Rect }> {
    if(reason==='auto'){const blocked=this.automaticBlock();if(blocked)return {ok:false,detail:blocked};}
    if (this.busy) return { ok: false, detail: 'Already teleporting' };
    if (target === 'near_cursor' && this.d.cursorProtected?.()) return {ok:false,detail:'Keeping clear of the video or avoided window under the pointer.'};
    const cur = this.d.bounds();
    if (!cur) return { ok: false, detail: 'Character is not on screen' };
    const s = this.d.settings();
    const context = {
      displays: this.d.displays(), current: cur, cursor: this.d.cursor(),
      avoid: target === 'perch' || s.teleport.avoidActiveWindow ? this.d.activeWindow() : null,
    };
    let dest = chooseDestination(target, context);
    for (let attempt = 0; dest && this.d.canOccupy?.(dest) === false && attempt < 16; attempt++) dest = chooseDestination(target, context);
    if (dest && this.d.canOccupy?.(dest) === false) dest = null;
    if (!dest) return { ok: false, detail: target === 'perch' ? 'No window to sit on (needs a non-maximised window with room above it)' : 'No free spot to teleport to' };
    this.busy = true;
    const revision = this.revision;
    // Local travel keeps visible continuity; distant/cross-monitor travel teleports.
    const near = Math.hypot(dest.x - cur.x, dest.y - cur.y) < 900 && this.d.displays().some((x) => x.workArea.x <= cur.x + cur.width / 2 && cur.x + cur.width / 2 < x.workArea.x + x.workArea.width && x.workArea.x <= dest.x + dest.width / 2 && dest.x + dest.width / 2 < x.workArea.x + x.workArea.width);
    if (dest.kind !== 'perch' && (how === 'glide' || (how === 'either' && near))) {
      try {
        const completed = await this.glide(dest, { cancelled: () => revision !== this.revision || reason === 'auto' && !!this.automaticBlock() });
        if (!completed) return { ok: false, detail: this.automaticBlock() ?? 'Automatic movement interrupted.' };
        this.count++;
        this.last = `${new Date().toLocaleTimeString()} (${reason}, glide ${target}) → ${dest.x},${dest.y}`;
        this.d.moved?.(dest, 'glide');
        this.d.arrived?.(dest, reason);
        this.d.log.info('glide', { reason, target, kind: dest.kind });
        return { ok: true, detail: `Glided (${target.replace('_', ' ')})`, to: dest };
      } finally { this.busy = false; }
    }
    const id = ++this.seq;
    const fx = s.teleport.effects;
    try {
      const departure = this.waitAck(id, 'out', fx ? 1500 : 400);
      this.d.cue({ type: 'teleport', phase: 'out', id, effects: fx });
      const outOk = await departure;
      const blocked = (revision !== this.revision ? 'Movement cancelled by a newer instruction.' : null) ?? (reason === 'auto' ? this.automaticBlock() : null) ?? (this.d.canOccupy?.(dest) === false ? 'That spot is in a protected window area.' : null);
      if (blocked) {
        // Restore her at the departure point when a new request interrupts automatic travel.
        const restored = this.waitAck(id, 'in', fx ? 1800 : 400);
        this.d.cue({ type: 'teleport', phase: 'in', id, effects: fx });
        await restored;
        return { ok: false, detail: blocked };
      }
      await this.d.prepareFlight?.('teleport');
      if(revision!==this.revision || reason==='auto' && this.automaticBlock()) {
        const restored=this.waitAck(id,'in',fx?1800:400);this.d.cue({type:'teleport',phase:'in',id,effects:fx});await restored;
        return {ok:false,detail:'Movement cancelled by a newer instruction.'};
      }
      this.d.move(dest, 'teleport');
      this.d.moved?.(dest, 'teleport');
      const arrival = this.waitAck(id, 'in', fx ? 1800 : 400);
      this.d.cue({ type: 'teleport', phase: 'in', id, effects: fx });
      const inOk = await arrival;
      this.d.arrived?.(dest, reason);
      this.count++;
      this.last = `${new Date().toLocaleTimeString()} (${reason}, ${target}) → ${dest.x},${dest.y}`;
      this.d.log.info('teleport', { reason, target, x: dest.x, y: dest.y, outOk, inOk });
      return { ok: true, detail: `Teleported (${target.replace('_', ' ')})`, to: dest };
    } finally {
      this.busy = false;
    }
  }

  /** Exposed for tests. Returns the reason it didn't teleport, or null if it did. */
  async autoTick(): Promise<string | null> {
    const result=await this.go('auto','auto','either');this.lastBlocked=result.ok?null:result.detail;
    if(this.lastBlocked)this.d.log.debug('auto teleport skipped',{reason:this.lastBlocked});
    return this.lastBlocked;
  }

  status() {
    const s = this.d.settings().teleport;
    return {
      auto: s.auto,
      armed: !!this.d.automaticSchedule?.().ready && this.d.aiConnected(),
      nextInSec: this.d.automaticSchedule?.().nextAt ? Math.max(0,Math.round((this.d.automaticSchedule().nextAt-Date.now())/1000)):null,
      last: this.last,
      count: this.count,
      blockedReason: !this.d.aiConnected() ? 'AI is not connected' : this.lastBlocked,
    };
  }
}
