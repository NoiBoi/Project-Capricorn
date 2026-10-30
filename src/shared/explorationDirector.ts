import type { DialogueSurface } from './dialogueContext';
export type ExplorationGoal = 'music corner' | 'social corner' | 'something unfamiliar' | 'a small circuit' | 'somewhere to settle';
export interface ExplorationPlace { key: string; surface?: DialogueSurface; favorite?: number; interest?: number; interestAt?: number }
export interface ExplorationState {
  version: 1; restUntil: number; completed: number; recentGoals: ExplorationGoal[];
  visits: { key: string; at: number; count: number }[];
  outing: { goal: ExplorationGoal; left: number; visited: string[]; started: number } | null;
}
const GOALS: ExplorationGoal[] = ['music corner', 'social corner', 'something unfamiliar', 'a small circuit', 'somewhere to settle'];
const unit = (r: () => number) => Math.max(0, Math.min(.999999, r()));

/** A bounded local outing, not an agent task. No screen reading, model work or system actions. */
export class ExplorationDirector {
  private state: ExplorationState = { version: 1, restUntil: 0, completed: 0, recentGoals: [], visits: [], outing: null };
  private previousManner = '';
  private failures = new Map<string, number>();
  constructor(private random = Math.random, private save?: (s: ExplorationState) => void) {}
  configure(save: (s: ExplorationState) => void) { this.save = save; }
  snapshot(): ExplorationState { return structuredClone(this.state); }
  restore(raw: unknown, now: number) {
    const s = raw as ExplorationState | null;
    if (s?.version !== 1 || !Array.isArray(s.visits) || !Array.isArray(s.recentGoals)) return;
    const keyOK = (k: unknown): k is string => typeof k === 'string' && /^[a-zA-Z0-9_-]{1,80}$/.test(k);
    const outing = s.outing;
    this.state = { version: 1, restUntil: Number.isFinite(s.restUntil) ? Math.max(0, Math.min(s.restUntil, now + 12 * 60000)) : 0,
      completed: Number.isInteger(s.completed) ? Math.max(0, Math.min(100000, s.completed)) : 0,
      recentGoals: s.recentGoals.filter(g => GOALS.includes(g)).slice(-3),
      visits: s.visits.filter(v => v && keyOK(v.key) && Number.isFinite(v.at) && v.at <= now && now - v.at < 24 * 3600000 && Number.isInteger(v.count) && v.count > 0).slice(-32),
      outing: outing && GOALS.includes(outing.goal) && Number.isFinite(outing.started) && outing.started <= now && now - outing.started < 2 * 3600000 && Number.isInteger(outing.left) && outing.left > 0 && outing.left <= 3 && Array.isArray(outing.visited)
        ? { ...outing, visited: outing.visited.filter(keyOK).slice(-3) } : null };
  }
  private persist() { try { this.save?.(this.snapshot()); } catch { /* continuity remains in memory */ } }
  choose(places: ExplorationPlace[], now: number, options: { newlyOpened?: boolean } = {}) {
    if (now < this.state.restUntil && !options.newlyOpened) return null;
    if (options.newlyOpened) this.state.outing = null;
    if (this.state.outing && now - this.state.outing.started >= 2 * 3600000) this.state.outing = null;
    let candidates = places.filter(p => !this.state.outing?.visited.includes(p.key) && now >= (this.failures.get(p.key) ?? 0)
      && !this.state.visits.some(v => v.key === p.key && now - v.at < 10 * 60000 && !((p.interest ?? 0) > 0 && (p.interestAt ?? 0) > v.at)));
    if (!candidates.length) {
      // A circuit ends if its remaining places close or are already covered by its visits.
      if (this.state.outing?.visited.length) { this.state.completed++; this.state.outing = null; }
      this.rest(now, 2 + unit(this.random) * 2); return null;
    }
    if (!this.state.outing) {
      const possible: ExplorationGoal[] = ['something unfamiliar', 'a small circuit', 'somewhere to settle'];
      if (candidates.some(p => p.surface === 'spotify')) possible.push('music corner');
      if (candidates.some(p => p.surface === 'discord')) possible.push('social corner');
      const fresh = possible.filter(g => !this.state.recentGoals.slice(-2).includes(g));
      const goals = fresh.length ? fresh : possible;
      const goal = goals[Math.floor(unit(this.random) * goals.length)];
      const left = goal === 'music corner' || goal === 'social corner' || goal === 'somewhere to settle' ? 1 : Math.min(candidates.length, 1 + Math.floor(unit(this.random) * 3));
      this.state.outing = { goal, left, visited: [], started: now };
      this.state.recentGoals.push(goal); this.state.recentGoals = this.state.recentGoals.slice(-3);
    }
    let goal = this.state.outing.goal;
    const fits = candidates.filter(p => goal === 'music corner' ? p.surface === 'spotify' : goal === 'social corner' ? p.surface === 'discord' : true);
    if (fits.length) candidates = fits;
    else { this.state.outing.goal = goal = 'something unfamiliar'; }
    const score = (p: ExplorationPlace) => {
      const seen = this.state.visits.find(v => v.key === p.key);
      return (seen ? Math.min(15, (now - seen.at) / 60000) / (1 + seen.count) : 25)
        + Math.max(0, Math.min(12, p.interest ?? 0))
        + (p.interestAt===undefined?4:0) // Modest preference for a place never inspected; no rotation quota.
        + (goal === 'somewhere to settle' ? Math.min(10, p.favorite ?? 0) : 0);
    };
    candidates.sort((a, b) => score(b) - score(a));
    const place = candidates[Math.floor(unit(this.random) * Math.min(2, candidates.length))];
    const manners = goal === 'somewhere to settle' ? ['settle', 'lounge'] as const
      : (place.interest ?? 0) > 0 ? ['inspect', 'settle', 'settle', 'lounge'] as const : ['peek', 'drift', 'survey', 'settle', 'settle', 'settle', 'lounge'] as const;
    const freshManners = manners.filter(m => m !== this.previousManner);
    const choices = freshManners.length ? freshManners : manners;
    const manner = choices[Math.floor(unit(this.random) * choices.length)];
    this.previousManner = manner;
    this.persist();
    return { key: place.key, goal, manner, hops: manner === 'settle' || manner === 'lounge' || manner === 'peek' ? 1 : manner === 'survey' ? 3 : 2,
      pauseMs: 900 + unit(this.random) * 1800 };
  }
  complete(key: string, now: number) {
    const outing = this.state.outing;
    if (!outing) return 60000;
    const prior = this.state.visits.find(v => v.key === key);
    this.state.visits = this.state.visits.filter(v => v.key !== key);
    this.state.visits.push({ key, at: now, count: Math.min(1000, (prior?.count ?? 0) + 1) }); this.state.visits = this.state.visits.slice(-32);
    outing.visited.push(key); outing.left--;
    let restMs: number;
    if (outing.left <= 0) {
      this.state.completed++;
      const long = outing.goal === 'somewhere to settle' || this.state.completed % 3 === 0 || unit(this.random) < .2;
      restMs = (long ? 8 + unit(this.random) * 4 : 2 + unit(this.random) * 4) * 60000;
      this.state.outing = null;
    } else restMs = (40 + unit(this.random) * 50) * 1000;
    this.state.restUntil = now + restMs; this.persist(); return restMs;
  }
  interrupt(key: string, now: number) {
    this.failures.set(key, now + 60000);
    if (this.failures.size > 32) this.failures.delete(this.failures.keys().next().value!);
    this.state.restUntil = Math.max(this.state.restUntil, now + 45000); this.persist();
  }
  private rest(now: number, minutes: number) { this.state.restUntil = now + minutes * 60000; this.persist(); }
}
