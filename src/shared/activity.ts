import { companionDialogue } from './dialogue';
export type ActivityKind = 'notice' | 'lean' | 'stretch' | 'settle' | 'return' | 'pickup' | 'putdown' | 'peek' | 'balance' | 'fidget' | 'sway' | 'float';
export interface ActivityBeat { kind: ActivityKind; subject: string; returning: boolean; resumed: boolean }
/** Small local scenes have a subject, follow-through and a rest; interruptions retain session continuity. */
export class ActivityDirector {
  phase: 'rest' | 'notice' | 'engage' | 'settle' = 'rest';
  subject = '';
  private due = 0;
  private pending = '';
  private stableSince = 0;
  private suspended = false;
  private lastIdle = 0;
  private visits = new Map<string, number>();
  private previous = -1;
  private sequence: ActivityKind[] = [];
  constructor(private random = Math.random) {}
  private rest(now: number) { this.phase = 'rest'; this.due = now + 22000 + this.random() * 42000; }
  tick(now: number, input: { blocked: boolean; subject: string; idleSec: number }): ActivityBeat | null {
    const cameBack = this.lastIdle >= 60 && input.idleSec < 3; this.lastIdle = input.idleSec;
    if (input.blocked) { if (this.phase !== 'rest') this.suspended = true; return null; }
    if (!input.subject && this.subject) { this.subject = ''; this.sequence = []; this.suspended = false; this.phase = 'rest'; this.due = now + 3000; }
    if (cameBack) { this.phase = 'notice'; this.due = now + 3500; return { kind: 'return', subject: this.subject, returning: true, resumed: false }; }
    if (input.subject !== this.pending) { this.pending = input.subject; this.stableSince = now; }
    if (input.subject && input.subject !== this.subject && now - this.stableSince >= 3500) {
      const returning = this.visits.has(input.subject); this.subject = input.subject;
      this.visits.delete(this.subject); this.visits.set(this.subject, now);
      if (this.visits.size > 32) this.visits.delete(this.visits.keys().next().value!);
      this.phase = 'notice'; this.sequence = []; this.due = now + 4000; this.suspended = false;
      return { kind: 'notice', subject: this.subject, returning, resumed: false };
    }
    if (this.suspended) { this.suspended = false; this.sequence = []; this.phase = 'engage'; this.due = now + 5500; return { kind: 'lean', subject: this.subject, returning: true, resumed: true }; }
    if (now < this.due) return null;
    if (this.sequence.length) {
      const kind = this.sequence.shift()!;
      if (!this.sequence.length) this.rest(now);
      else this.due = now + 3500 + this.random() * 4500;
      return { kind, subject: this.subject, returning: false, resumed: false };
    }
    if (this.phase === 'notice') { this.phase = 'engage'; this.due = now + 6000; return { kind: 'lean', subject: this.subject, returning: false, resumed: false }; }
    if (this.phase === 'engage') { this.phase = 'settle'; this.due = now + 4000; return { kind: 'settle', subject: this.subject, returning: false, resumed: false }; }
    if (this.phase === 'settle') { this.rest(now); return null; }
    // A little scene has anticipation and a finish. Do not repeat the previous routine.
    const scenes: ActivityKind[][] = this.subject
      ? [['peek', 'lean', 'settle'], ['balance', 'fidget', 'settle'], ['stretch', 'sway', 'settle'], ['float', 'peek', 'settle']]
      : [['stretch', 'sway', 'settle'], ['balance', 'fidget', 'settle'], ['float', 'sway', 'settle']];
    const choices = scenes.map((_, i) => i).filter(i => i !== this.previous);
    this.previous = choices[Math.min(choices.length - 1, Math.floor(this.random() * choices.length))];
    this.sequence = [...scenes[this.previous]];
    this.phase = 'engage'; this.due = now + 3500 + this.random() * 4500;
    return { kind: this.sequence.shift()!, subject: this.subject, returning: false, resumed: false };
  }
}
/** Bounded whole-body acting, applied through the same transform as the art and hit mask. */
export function activityMotion(kind: ActivityKind, age: number, side = 1) {
  const duration = kind === 'float' || kind === 'sway' ? 4.5 : kind === 'fidget' ? 3.5 : kind === 'stretch' ? 3 : 2.5;
  const u = Math.max(0, Math.min(1, age / duration)), e = Math.sin(u * Math.PI) ** 2;
  const wave = Math.sin(u * Math.PI * 2) * e;
  if (kind === 'peek') return { x: side * .035 * e, y: -.008 * e, turn: side * .06 * e, scaleX: 1, scaleY: 1 };
  if (kind === 'balance') return { x: side * .018 * wave, y: -.008 * e, turn: side * .045 * wave, scaleX: 1, scaleY: 1 };
  if (kind === 'fidget') return { x: 0, y: .006 * Math.sin(u * Math.PI * 4) * e, turn: side * .016 * wave, scaleX: 1 + .012 * e, scaleY: 1 - .012 * e };
  if (kind === 'sway') return { x: side * .018 * wave, y: 0, turn: side * .025 * wave, scaleX: 1, scaleY: 1 };
  if (kind === 'float') return { x: side * .022 * wave, y: -.028 * e, turn: -side * .025 * wave, scaleX: 1, scaleY: 1 };
  return { x: kind === 'lean' || kind === 'notice' ? side * .025 * e : 0,
    y: kind === 'return' ? -.018 * e : kind === 'settle' || kind === 'putdown' ? .008 * e : 0,
    turn: kind === 'lean' ? side * .045 * e : kind === 'notice' ? side * .025 * e : 0,
    scaleX: kind === 'stretch' ? 1 - .025 * e : 1,
    scaleY: kind === 'stretch' ? 1 + .045 * e : 1 };
}
export function activityLine(beat: ActivityBeat) {
  const event = beat.kind === 'return' ? 'return' : beat.resumed ? 'resume' : beat.kind === 'notice' && beat.subject ? 'notice' : null;
  return event ? companionDialogue.choose({ event, returning: beat.returning }) : '';
}
