import { z } from 'zod';
const ReviewInput = z.object({
  afterMs: z.number().int().min(1000).max(86400000),
  durationMs: z.number().int().min(1000).max(3600000),
  inferenceIntervalMs: z.number().int().min(1000).max(3600000),
  observationIntervalMs: z.number().int().min(250).max(60000),
  source: z.enum(['all', 'screen', 'chrome']),
  sourceIdentity: z.string().min(1).max(256).optional().describe('Wake for changes to this exact observed source identity during monitoring.'),
}).strict();
export const AttentionInput = ReviewInput.partial().extend({ action: z.enum(['cancel', 'pause']).optional() }).strict()
  .refine(input => input.action ? Object.keys(input).length === 1 : ReviewInput.safeParse(input).success,
    'Supply all review fields, or an action to cancel or pause.');
export interface AttentionState {
  request?: z.infer<typeof ReviewInput> & { expiresAt: number };
  nextReviewAt?: number;
  paused: boolean;
}

type Trigger = 'commitment-due' | 'attention-review' | 'source-change' | 'monitored-change' | 'batched-change';

/** One clock for ambient inference. Collection and direct messages run independently. */
export class AttentionController {
  private request?: z.infer<typeof ReviewInput> & { expiresAt: number };
  private nextReviewAt?: number;
  private lastInference = -Infinity;
  private history: number[] = [];
  private sampled = new Map<string, number>();
  private silent = 0;
  private paused = false;
  constructor(private baseMs = 30000, private minInferenceMs = 10000, private now = Date.now, private maxCyclesPerHour = 120) {}
  configure(baseMs: number, maxCyclesPerHour: number) {
    this.baseMs = baseMs;
    this.maxCyclesPerHour = maxCyclesPerHour;
  }
  adjust(value: unknown) {
    const input = AttentionInput.parse(value), now = this.now();
    if (input.action) {
      this.request = undefined;
      this.nextReviewAt = undefined;
      this.paused = input.action === 'pause';
      return { paused: this.paused, reviewAt: null };
    }
    const review = ReviewInput.parse(input);
    this.paused = false;
    this.nextReviewAt = now + Math.max(this.minInferenceMs, review.afterMs);
    const durationMs = Math.min(15 * 60000, review.durationMs);
    this.request = { ...review, observationIntervalMs: Math.max(500, review.observationIntervalMs), inferenceIntervalMs: Math.max(this.minInferenceMs, review.inferenceIntervalMs), durationMs, expiresAt: now + durationMs };
    return this.snapshot();
  }
  private active() { if (this.request && this.request.expiresAt <= this.now()) this.request = undefined; return this.request; }
  snapshot() {
    const request = this.active();
    if (this.paused) return { paused: true, reviewAt: null };
    return request || this.nextReviewAt !== undefined ? { ...request, reviewAt: this.nextReviewAt ?? null } : null;
  }
  get reviewAt() { return this.nextReviewAt ?? null; }
  durableState(): AttentionState { return { request: this.active(), nextReviewAt: this.nextReviewAt, paused: this.paused }; }
  restore(state: AttentionState) {
    this.request = state.request;
    this.nextReviewAt = state.nextReviewAt;
    this.paused = state.paused;
  }
  acknowledge(reviewAt: number | null) {
    if (reviewAt === null || reviewAt !== this.nextReviewAt) return false;
    this.nextReviewAt = undefined;
    return true;
  }
  complete(silent: boolean) { this.silent = silent ? Math.min(3, this.silent + 1) : 0; }
  reason(pending: boolean, structural: boolean, due: boolean, sources: ReadonlySet<string> = new Set(), pendingSince = -Infinity, lastChange = pendingSince): Trigger | undefined {
    const now = this.now(), request = this.active();
    const elapsed = now - this.lastInference;
    this.history = this.history.filter(at => now - at < 3600000);
    if (this.history.length >= this.maxCyclesPerHour || elapsed < this.minInferenceMs) return;
    if (due) return 'commitment-due';
    if (this.nextReviewAt !== undefined && now >= this.nextReviewAt) return 'attention-review';
    if (this.paused || !pending || now - pendingSince < Math.min(3000, this.minInferenceMs / 2)) return;
    const monitored = request && (request.sourceIdentity ? sources.has(request.sourceIdentity) : request.source === 'all' || sources.has(request.source));
    // Wait for a short lull, with a maximum delay for continuous activity.
    if (!monitored && now - lastChange < Math.min(3000, this.minInferenceMs / 2) &&
        now - pendingSince < Math.min(12000, this.minInferenceMs * 2)) return;
    if (monitored && elapsed >= request.inferenceIntervalMs) return 'monitored-change';
    const backoff = 2 ** this.silent;
    const structuralSpacing = Math.max(this.minInferenceMs, Math.min(this.baseMs, 30000) * Math.min(2, backoff));
    if (structural && elapsed >= structuralSpacing) return 'source-change';
    if (monitored) return;
    if (elapsed >= this.baseMs * backoff) return 'batched-change';
  }
  ready(pending: boolean, structural: boolean, due: boolean) { return !!this.reason(pending, structural, due); }
  started(trigger?: Trigger | 'user') {
    const now = this.now(); this.lastInference = now; this.history.push(now);
    if (trigger === undefined && this.nextReviewAt !== undefined && now >= this.nextReviewAt) this.acknowledge(this.nextReviewAt);
  }
  sample(source: 'screen' | 'chrome') {
    const now = this.now(), request = this.active();
    const interval = request && (request.source === 'all' || request.source === source) ? request.observationIntervalMs : 1000;
    if (now - (this.sampled.get(source) ?? -Infinity) < interval) return false;
    this.sampled.set(source, now); return true;
  }
}
