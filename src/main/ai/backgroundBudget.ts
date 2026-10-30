import fs from 'node:fs';
import { writeJsonAtomic } from '../store/jsonFile';
type Purpose = 'ambient' | 'memory' | 'placement' | 'interaction';
const RULES: Record<Purpose, { limit: number; gap: number }> = {
  ambient: { limit: 6, gap: 30000 }, memory: { limit: 3, gap: 60000 },
  placement: { limit: 4, gap: 15000 }, interaction: { limit: 6, gap: 10000 },
};
/** Bounded optional requests. Direct replies never reserve from these lanes. */
export class BackgroundBudget {
  private attempts: { at: number; purpose: Purpose }[] = [];
  constructor(private file?: string, private now = () => Date.now(), private multiplier: () => number = () => 1) {
    if (file) try { const data = JSON.parse(fs.readFileSync(file, 'utf8')); if (Array.isArray(data)) this.attempts = data.filter(x => Number.isFinite(x.at) && Object.hasOwn(RULES, x.purpose)).slice(-256); } catch { /* fresh budget */ }
  }
  private factor() { const value = this.multiplier(); return Number.isFinite(value) ? Math.min(8, Math.max(1, Math.floor(value))) : 1; }
  private rule(purpose: Purpose) { const factor = this.factor(); return { limit: RULES[purpose].limit * factor, gap: Math.max(1000, RULES[purpose].gap / factor) }; }
  private live(at: number) { return this.attempts.filter(a => a.at > at - 600000 && a.at <= at); }
  private available(purpose: Purpose, at: number, engaged = false) {
    const live = this.live(at), lane = live.filter(a => a.purpose === purpose), rule = this.rule(purpose), last = lane.at(-1);
    return lane.length < rule.limit && (!last || engaged && purpose !== 'memory' || at - last.at >= rule.gap)
      && (purpose === 'placement' || purpose === 'interaction' || live.filter(a => a.purpose === 'ambient' || a.purpose === 'memory').length < 8 * this.factor());
  }
  canReserve(purpose: Purpose, engaged = false) { return this.available(purpose,this.now(),engaged); }
  reserve(purpose: Purpose, engaged = false) {
    const now = this.now(); this.attempts = this.live(now);
    if (!this.available(purpose, now, engaged)) return false;
    this.attempts.push({ at: now, purpose });
    if (this.file) try { writeJsonAtomic(this.file, this.attempts); } catch { /* in-process ceiling remains */ }
    return true;
  }
  snapshot() {
    const now = this.now(), attempts = this.live(now);
    return (Object.keys(RULES) as Purpose[]).map(purpose => {
      const times = [now, ...attempts.flatMap(a => [a.at + this.rule(purpose).gap, a.at + 600000])].filter(t => t >= now).sort((a,b) => a-b);
      return { purpose, used: attempts.filter(a => a.purpose === purpose).length, limit: this.rule(purpose).limit,
        retrySeconds: Math.ceil(((times.find(t => this.available(purpose, t)) ?? now + 600000) - now) / 1000) };
    });
  }
}
