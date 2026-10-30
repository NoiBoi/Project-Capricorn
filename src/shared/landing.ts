import type { PoseSupport } from './secondaryBehavior';
/** A fall has a recovery beat before she chooses a supported resting posture. */
export class LandingRest {
  private at: number | null = null;
  private standMs = 0;
  private sitMs = 0;
  private cycle = -1;
  private reclining = false;
  constructor(private random = Math.random) {}
  start(now: number) {
    this.at = now;
    this.standMs = 6000 + this.random() * 4000;
    this.sitMs = 25000 + this.random() * 20000;
    this.cycle = -1;
  }
  cancel() { this.at = null; this.cycle = -1; }
  holding(now: number) { return this.at !== null && now < this.at + this.standMs + this.sitMs + 20000; }
  phase(now: number, support: PoseSupport): 'stand' | 'sit' | 'lie' | undefined {
    if (this.at === null) return undefined;
    if (!support.sit || support.kind === 'none' || support.tight) { this.cancel(); return undefined; }
    const age = Math.max(0, now - this.at);
    if (age < this.standMs) return 'stand';
    if (age < this.standMs + this.sitMs) return 'sit';
    const settled = age - this.standMs - this.sitMs;
    const cycle = Math.floor(settled / 150000);
    if (cycle !== this.cycle) { this.cycle = cycle; this.reclining = this.random() < .45; }
    return support.lie && this.reclining && settled % 150000 < 60000 ? 'lie' : 'sit';
  }
}
