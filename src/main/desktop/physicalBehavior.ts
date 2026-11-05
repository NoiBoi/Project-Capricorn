import { z } from 'zod';

/** Intent metadata only. Native bounds, support and renderer observations remain host-owned. */
export const MovementIntent = z.object({
  target: z.enum(['corner','near_cursor','left','right','perch','idle','accompany','follow_cursor','taskbar','return','settle','away','cancel']),
  handle: z.string().regex(/^\d+$/).max(32).optional(),
  posture: z.enum(['auto','sit','stand','lie','hover']).default('auto'),
  durationMs: z.number().int().min(1000).max(1800000).optional(),
  pace: z.enum(['gentle','normal']).default('gentle'),
}).strict();
export type PhysicalIntent = z.infer<typeof MovementIntent>;
export interface PhysicalOutcome { ok: boolean; detail: string; [key: string]: unknown }
export interface PhysicalEnvironment {
  blocked(): string | null;
  busy(): boolean;
  targetValid(handle: string): boolean;
  targetIdentity?(handle: string): string | undefined;
  watch?(handle: string): void;
  obstructed?(): boolean;
  active(): string | undefined;
  execute(intent: PhysicalIntent, signal: AbortSignal): Promise<PhysicalOutcome>;
  cancel(): void;
  posture(posture: PhysicalIntent['posture']): void;
  ambient(variation: number): void;
}
/** Runs from the existing presence heartbeat; owns no timers, pixels or native coordinates. */
export class PhysicalBehavior {
  private current?: { id: number; source: 'model' | 'local-safety'; intent: PhysicalIntent; until?: number; handle?: string; identity?: string; lastAt: number };
  private serial = 0;
  private flight?: AbortController;
  private nextAmbient = 0;
  private nextMove = 0;
  private focus?: string;
  private focusAt = 0;
  private variation = 0;
  last?: { id: number; outcome: string; detail: string };
  constructor(private host: PhysicalEnvironment, private now = Date.now, private random = Math.random) {}
  snapshot() { return { intention: this.current ? { id: this.current.id, source:this.current.source, ...this.current.intent, resolvedHandle: this.current.handle, expiresAt: this.current.until } : null, executing: !!this.flight, last: this.last, blocked: this.host.blocked() }; }
  cancel(detail = 'Cancelled by direct user interaction.') {
    const id = this.current?.id;
    if (this.flight) { this.flight.abort(); this.host.cancel(); }
    this.flight = undefined; this.current = undefined;
    if (id) this.last = { id, outcome: 'cancelled', detail };
  }
  async request(value: PhysicalIntent, signal: AbortSignal): Promise<PhysicalOutcome> {
    signal.throwIfAborted();
    if (value.target === 'cancel') { this.cancel('Model cancelled its physical intention.'); return { ok: true, detail: 'Intention cancelled.' }; }
    const blocked = this.host.blocked();
    if (blocked) { this.last = {id: ++this.serial, outcome:'denied',detail:blocked}; return { ok: false, detail: blocked }; }
    this.cancel('Superseded by a newer intention.');
    const handle = value.handle ?? (['perch','accompany'].includes(value.target) ? this.host.active() : undefined);
    if (handle && !this.host.targetValid(handle)) return { ok:false,detail:'Target window is unavailable.' };
    const duration = value.durationMs ?? (value.target === 'follow_cursor' ? 12000 : undefined);
    const entry = this.current = { id: ++this.serial, source:'model' as const, intent: value, handle, identity:handle?this.host.targetIdentity?.(handle):undefined, until: duration ? this.now()+duration : undefined, lastAt: 0 };
    return this.run(entry, signal);
  }
  private async run(entry: NonNullable<PhysicalBehavior['current']>, parent?: AbortSignal): Promise<PhysicalOutcome> {
    // Cancellation restores the existing executor's FX before replacement may start.
    for(let n=0;this.host.busy()&&n<80;n++) {
      if(parent?.aborted||this.current!==entry)return {ok:false,detail:'Movement cancelled before admission.'};
      await new Promise(resolve=>setTimeout(resolve,50));
    }
    if (this.host.busy()||this.host.blocked()||this.current!==entry) {
      if(this.current===entry)this.current=undefined;
      return {ok:false,detail:'Native movement is busy or constrained.'};
    }
    parent?.throwIfAborted();
    const controller = new AbortController(); this.flight = controller;
    const abort = () => { controller.abort(); this.host.cancel(); };
    parent?.addEventListener('abort', abort, {once:true});
    entry.lastAt = this.now(); this.nextMove = this.now()+8000;
    try {
      const result = await this.host.execute({...entry.intent,handle:entry.handle},controller.signal);
      if (controller.signal.aborted || this.current !== entry) return {ok:false,detail:'Movement cancelled; completion is unconfirmed.'};
      this.last = {id:entry.id,outcome:result.ok?'host-executed':'failed',detail:result.detail};
      if (result.ok) this.host.posture(entry.intent.posture);
      else this.current = undefined;
      return {...result,intentionId:entry.id};
    } catch(error) {
      if(this.current===entry){
        this.last={id:entry.id,outcome:controller.signal.aborted?'cancelled':'failed',detail:controller.signal.aborted?'Movement interrupted.':String(error)};
        this.current=undefined;
      }
      throw error;
    } finally {
      parent?.removeEventListener('abort',abort);
      if(this.flight===controller)this.flight=undefined;
    }
  }
  async tick() {
    const now=this.now(), active=this.host.active();
    if(active!==this.focus){this.focus=active;this.focusAt=now;if(active&&!this.host.blocked())this.host.watch?.(active);}
    const entry=this.current;
    if(entry?.until && now>=entry.until){this.cancel('Physical intention expired.');return;}
    if(entry?.handle&&!this.host.targetValid(entry.handle)){this.cancel('Dependent window disappeared or became invalid.');return;}
    if(entry?.handle&&entry.identity!==undefined&&entry.identity!==this.host.targetIdentity?.(entry.handle)){this.cancel('Window identity changed; the handle may have been recycled.');return;}
    if(this.host.blocked()) { if(this.flight)this.cancel('Physical constraints interrupted movement.'); return; }
    if(this.flight||this.host.busy())return;
    if(this.host.obstructed?.()&&now>=this.nextMove) {
      this.cancel('Physical validity takes priority over the old intention.');
      const recovery=this.current={id:++this.serial,source:'local-safety',intent:MovementIntent.parse({target:'away'}),lastAt:0};
      await this.run(recovery);return;
    }
    if(entry && now>=this.nextMove) {
      if(entry.intent.target==='follow_cursor') { await this.run(entry);return; }
      if(entry.intent.target==='accompany'&&active&&active!==entry.handle&&now-this.focusAt>=5000&&this.host.targetValid(active)) {
        entry.handle=active;entry.identity=this.host.targetIdentity?.(active);await this.run(entry);return;
      }
    }
    if(now>=this.nextAmbient) {
      // Bounded variation controls mechanics, never emotion or cognitive interests.
      this.variation=(this.variation+1+Math.floor(this.random()*2))%4;
      this.host.ambient(this.variation);
      this.nextAmbient=now+18000+this.random()*22000;
    }
  }
}
