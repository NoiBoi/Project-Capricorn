import { z } from 'zod';
export const WatchCondition = z.enum(['activated', 'content-changed', 'inactive', 'observation', 'material-change']);
export type WatchCondition = z.infer<typeof WatchCondition>;
const ReviewInput = z.object({
  afterMs: z.number().int().min(1000).max(86400000).optional(),
  durationMs: z.number().int().min(1000).max(3600000),
  inferenceIntervalMs: z.number().int().min(1000).max(3600000),
  observationIntervalMs: z.number().int().min(250).max(60000),
  source: z.enum(['all', 'screen', 'chrome']),
  conditions: z.array(WatchCondition).min(1).max(5).optional(),
  ambient: z.enum(['normal', 'watch-only']).optional(),
  reviewIfUnchanged: z.boolean().optional().describe('Skip the deadline if a matching condition was already handled.'),
  priority: z.enum(['ordinary', 'high']).optional(),
  sourceIdentity: z.string().min(1).max(256).optional().describe('Wake for changes to this exact observed source identity during monitoring.'),
}).strict();
export const AttentionInput = ReviewInput.partial().extend({ action: z.enum(['cancel', 'pause']).optional() }).strict()
  .refine(input => input.action ? Object.keys(input).length === 1 : ReviewInput.safeParse(input).success,
    'Supply source, duration and both intervals, or an action to cancel or pause.');
export interface AttentionState {
  request?: z.infer<typeof ReviewInput> & { expiresAt: number; startedAt?: number };
  nextReviewAt?: number;
  paused: boolean;
}

type Trigger = 'commitment-due' | 'attention-review' | 'source-change' | 'monitored-change' | 'batched-change';

/** One clock for ambient inference. Collection and direct messages run independently. */
export class AttentionController {
  private request?: z.infer<typeof ReviewInput> & { expiresAt: number; startedAt?: number };
  private nextReviewAt?: number;
  private lastInference = -Infinity;
  private history: number[] = [];
  private sampled = new Map<string, number>();
  private silent = 0;
  private lastSources = new Set<string>();
  private silentSources = new Set<string>();
  private unavailableSince?: number;
  private recoveryReported = false;
  private watchMatch?: { condition: WatchCondition; source: string; at: number };
  get watchStartedAt() { const request = this.active(); return request ? request.startedAt ?? 0 : undefined; }
  get matchedCondition() { return this.watchMatch; }
  clearMatch() { this.watchMatch = undefined; }
  observe(source: string, identity: string | undefined, conditions: readonly WatchCondition[], at = this.now()) {
    const request = this.active();
    if (!request || at < (request.startedAt ?? 0) || (request.source !== 'all' && request.source !== source) ||
        (request.sourceIdentity && request.sourceIdentity !== identity)) return;
    const condition = (request.conditions ?? ['content-changed']).find(condition => conditions.includes(condition));
    if (condition && !this.watchMatch) this.watchMatch = { condition, source: identity ?? source, at };
  }
  private paused = false;
  constructor(private baseMs = 30000, private minInferenceMs = 10000, private now = Date.now, private maxCyclesPerHour = 120, private layeredSilence = false) {}
  configure(baseMs: number, maxCyclesPerHour: number) {
    this.baseMs = baseMs;
    this.maxCyclesPerHour = maxCyclesPerHour;
  }
  adjust(value: unknown) {
    const input = AttentionInput.parse(value), now = this.now();
    this.clearMatch();
    this.unavailableSince = undefined; this.recoveryReported = false;
    if (input.action) {
      this.request = undefined;
      this.nextReviewAt = undefined;
      this.paused = input.action === 'pause';
      return { paused: this.paused, reviewAt: null };
    }
    const review = ReviewInput.parse(input);
    this.paused = false;
    this.nextReviewAt = review.afterMs === undefined ? undefined : now + Math.max(this.minInferenceMs, review.afterMs);
    const durationMs = Math.min(30 * 60000, review.durationMs);
    this.request = { ...review, observationIntervalMs: Math.max(500, review.observationIntervalMs), inferenceIntervalMs: Math.max(this.minInferenceMs, review.inferenceIntervalMs), durationMs, startedAt: now, expiresAt: now + durationMs };
    return this.snapshot();
  }
  private active() { if (this.request && this.request.expiresAt <= this.now()) { this.request = undefined; this.clearMatch(); } return this.request; }
  snapshot() {
    const request = this.active();
    if (this.paused) return { paused: true, reviewAt: null };
    return request || this.nextReviewAt !== undefined ? { ...request, reviewAt: this.nextReviewAt ?? null,
      ...(this.unavailableSince === undefined ? {} : { sourceUnavailableSince: this.unavailableSince, recovery: 'One recovery review after two minutes; watch expires at its original bounded deadline.' }) } : null;
  }
  sourceAvailability(source: 'chrome', available: boolean) {
    const request = this.active();
    if (!request || request.source !== source || request.ambient !== 'watch-only') return;
    if (available) { this.unavailableSince = undefined; this.recoveryReported = false; return; }
    this.unavailableSince ??= this.now();
    if (!this.recoveryReported && this.now() - this.unavailableSince >= 120000) {
      this.nextReviewAt = Math.min(this.nextReviewAt ?? Infinity, this.now());
      this.recoveryReported = true;
    }
  }
  get reviewAt() { return this.nextReviewAt ?? null; }
  get reviewIsFallback() { return this.active()?.reviewIfUnchanged === true; }
  durableState(): AttentionState { return { request: this.active(), nextReviewAt: this.nextReviewAt, paused: this.paused }; }
  restore(state: AttentionState) {
    this.clearMatch();
    this.unavailableSince = undefined; this.recoveryReported = false;
    this.request = state.request;
    this.nextReviewAt = state.nextReviewAt;
    this.paused = state.paused;
  }
  acknowledge(reviewAt: number | null) {
    if (reviewAt === null || reviewAt !== this.nextReviewAt) return false;
    this.nextReviewAt = undefined;
    return true;
  }
  complete(silent: boolean) {
    this.silent = silent ? Math.min(3, this.silent + 1) : 0;
    this.silentSources = silent ? new Set(this.lastSources) : new Set();
  }
  reason(pending: boolean, structural: boolean, due: boolean, _sources: ReadonlySet<string> = new Set(), pendingSince = -Infinity, lastChange = pendingSince): Trigger | undefined {
    const now = this.now(), request = this.active();
    const elapsed = now - this.lastInference;
    this.history = this.history.filter(at => now - at < 3600000);
    if (this.history.length >= this.maxCyclesPerHour || elapsed < this.minInferenceMs) return;
    if (due) return 'commitment-due';
    if (this.nextReviewAt !== undefined && now >= this.nextReviewAt) return 'attention-review';
    if (this.paused || !pending || now - pendingSince < Math.min(3000, this.minInferenceMs / 2)) return;
    const monitored = request && this.watchMatch;
    const watchSpacing = request?.priority === 'high' ? request.inferenceIntervalMs
      : Math.max(this.baseMs, request?.inferenceIntervalMs ?? 0);
    if (monitored && elapsed >= watchSpacing) return 'monitored-change';
    if (request?.ambient === 'watch-only') return;
    // Wait for a short lull, with a maximum delay for continuous activity.
    if (!monitored && now - lastChange < Math.min(3000, this.minInferenceMs / 2) &&
        now - pendingSince < Math.min(12000, this.minInferenceMs * 2)) return;
    if (structural && elapsed >= Math.max(this.minInferenceMs, Math.min(this.baseMs, 30000) * (this.layeredSilence && this.silent ? 2 : 1))) return 'source-change';
    const identities = [..._sources].filter(source => source !== 'screen' && source !== 'chrome');
    const sameSource = identities.length ? identities.every(source => this.silentSources.has(source))
      : [..._sources].length > 0 && [..._sources].every(source => this.silentSources.has(source));
    const spacing = this.layeredSilence
      ? this.silent ? Math.max(this.baseMs * 2 ** this.silent, 15 * 60000) : this.baseMs
      : this.silent && sameSource ? Math.max(this.baseMs, Math.min(5 * 60000, this.baseMs * 2 ** this.silent)) : this.baseMs;
    if (!monitored && elapsed >= spacing) return 'batched-change';
  }
  ready(pending: boolean, structural: boolean, due: boolean) { return !!this.reason(pending, structural, due); }
  started(trigger?: Trigger | 'user', sources: ReadonlySet<string> = new Set()) {
    this.lastSources = new Set(sources);
    const now = this.now(); this.lastInference = now; this.history.push(now);
    if (trigger === undefined && this.nextReviewAt !== undefined && now >= this.nextReviewAt) this.acknowledge(this.nextReviewAt);
  }
  sample(source: 'screen' | 'chrome') {
    const now = this.now(), request = this.active();
    const interval = request && !request.sourceIdentity && (request.source === 'all' || request.source === source) ? request.observationIntervalMs : 1000;
    if (now - (this.sampled.get(source) ?? -Infinity) < interval) return false;
    this.sampled.set(source, now); return true;
  }
}
