/** Session-only continuity. Window metadata is data, never instructions or permanent memory. */
export interface Encounter { title: string; process: string; visits: number; returning: boolean; interrupted: string | null; awaySeconds: number }
export class Encounters {
  private visits = new Map<string, { count: number; at: number }>();
  private last: { key: string; title: string; at: number } | null = null;
  current: Encounter | null = null;
  visit(window: { title: string; process: string } | null, now: number): Encounter | null {
    const key = window ? JSON.stringify([window.process.toLowerCase(), window.title]) : '';
    const previous = this.last;
    const known = this.visits.get(key);
    const returning = !!key && !!known && previous?.key !== key && now - known.at < 4 * 3600000;
    this.current = window ? { ...window, visits: (known?.count ?? 0) + (previous?.key === key ? 0 : 1), returning,
      interrupted: previous && previous.key !== key && now - previous.at < 8000 ? previous.title : null,
      awaySeconds: known ? Math.max(0, Math.floor((now - known.at) / 1000)) : 0 } : null;
    if (key && this.current) {
      this.visits.delete(key); this.visits.set(key, { count: this.current.visits, at: now });
      if (this.visits.size > 32) this.visits.delete(this.visits.keys().next().value!);
      this.last = { key, title: window!.title, at: now };
    } else this.last = null;
    return this.current;
  }
}

export type LookPoint = { x: number; y: number };
/** Smooth gaze shared by the pose and sprite facing. A real interaction can interrupt watching. */
export class AttentionRig {
  private target: LookPoint | null = null;
  private remaining = 0;
  private settled = 0;
  private look = { x: 0, y: 0 };
  mode: 'rest' | 'window' | 'user' = 'rest';
  watch(point: LookPoint, seconds: number) {
    if (!this.target || this.remaining <= 0) this.settled = 0;
    this.target = { x: Math.max(-1.2, Math.min(1.2, point.x)), y: Math.max(-1, Math.min(1, point.y)) };
    this.remaining = Math.min(30, Math.max(0, seconds));
  }
  clear() { this.target = null; this.remaining = 0; this.mode = 'rest'; }
  update(dt: number, input: { pointer: LookPoint | null; engaged: boolean; held: boolean; sleeping: boolean }): LookPoint | null {
    this.remaining = Math.max(0, this.remaining - dt); this.settled += dt;
    if (input.held || input.sleeping) { this.clear(); return null; }
    const close = input.pointer && Math.hypot(input.pointer.x, input.pointer.y) < 1.5;
    this.mode = input.engaged || close ? 'user' : this.target && this.remaining > 0 ? 'window' : 'rest';
    const point = this.mode === 'window' ? this.settled < 0.32 ? null : this.target : this.mode === 'user' ? input.pointer ?? { x: 0, y: 0 } : null;
    const rate = this.mode === 'user' ? 1 : 1 - Math.exp(-dt * 6);
    this.look.x += ((point?.x ?? 0) - this.look.x) * rate;
    this.look.y += ((point?.y ?? 0) - this.look.y) * rate;
    return this.mode === 'rest' && Math.hypot(this.look.x, this.look.y) < 0.02 ? null : { ...this.look };
  }
}

export function placementLine(encounter: Encounter | null, fallback: string): string {
  if (!encounter) return fallback;
  if (encounter.returning) return 'Oh, this spot again. I remember.';
  if (encounter.interrupted) return 'Oh, we are moving again. All right, let me settle.';
  return fallback;
}
