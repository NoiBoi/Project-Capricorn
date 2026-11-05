import { selectAmbientDialogue } from './dialogueSelection';
import { episodeSummary } from './archiveTools';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { TypedCapabilityExecutor } from '../../core/capabilities';
import type { AssistantPhase, ChatMessage } from '../../shared/ipc';
import type { WindowFocusArchive } from './windowFocusArchive';
import type { CognitiveProvider, RecordInput } from './cognitiveContracts';
import { approximateTokens, assembleContext, selectModel, ambientState, AMBIENT_INSTRUCTIONS, IDENTITY } from './context';
import { AGENT_TOOLS, ROUTINE_TOOLS, AMBIENT_TOOLS, ESCALATE_TOOL, agentTool } from './agentTools';
import { AttentionController, type WatchCondition } from './attention';
import { Perception, type DesktopHost } from './perception';
import type { CanonicalState } from './canonicalState';
import type { DailySession } from './dailySession';
import { contentDelta, excerptObservation, observationSlot, sceneFact } from './workingObservations';
export type CognitionMode = 'layered' | 'lean' | 'two-speed';
export interface LoopOptions { cognition?: CognitionMode; model?: string; contextBudget?: number; ambientMs?: number; timeoutMs?: number; host?: DesktopHost; daily?: DailySession; emit?: (channel: string, payload: unknown) => void }
export class CognitiveLoop {
  private controller = new AbortController();
  private current?: AbortController;
  private timer?: ReturnType<typeof setInterval>;
  private running?: Promise<void>;
  private pendingUser = false;
  private ambientInFlight = false;
  private environmentPaused = false;
  private environmentAbort = false;
  private pendingAmbient = false;
  private queuedUsers = 0;
  readonly attention: AttentionController;
  readonly perception?: Perception;
  private canonical: CanonicalState[] = [];
  private structural = false;
  private unavailableReviews = new Set<string>();
  private pendingSince = Infinity;
  private lastChange = -Infinity;
  private pendingSources = new Set<string>();
  private previousCompletion: 'silent' | 'dialogue' | 'tool-continuation' | 'failure' | null = null;
  private closed = false;
  private paused = false;
  private phaseValue: AssistantPhase = 'idle';
  private conversationId = '';
  private inferenceReceipts: { at: number; model: string; requestId?: string; usage?: { inputTokens: number; outputTokens: number } }[] = [];
  private lastWakeDecision = '';
  private normalBaselineAt?: number;
  private baselineState(s: CanonicalState) { return this.normalBaselineAt !== undefined && s.revisedAt <= this.normalBaselineAt && ['checkpoint','investigation','intention'].includes(s.kind); }
  constructor(private archive: WindowFocusArchive, private provider: CognitiveProvider, private executor: TypedCapabilityExecutor, private options: LoopOptions = {}) {
    if (options.cognition && !['layered', 'lean', 'two-speed'].includes(options.cognition)) throw Error('Invalid cognitive comparison mode.');
    this.attention = new AttentionController(this.interval, Math.min(this.interval, 10000), Date.now, options.daily?.config.requestsPerHour ?? 120, options.cognition === 'layered');
    if (options.host) this.perception = new Perception(archive, options.host, (structural, source, identity, conditions, at, ordinaryCandidate) => this.notifyObservation(structural, source, identity, conditions, at, ordinaryCandidate), options.daily?.recorder);
    for (const value of [options.contextBudget, options.ambientMs, options.timeoutMs]) if (value !== undefined && (!Number.isSafeInteger(value) || value < 1)) throw Error('Invalid cognitive loop resource limit.');
  }
  private async reconcile() {
    const page = await this.archive.conversation(2000, false, "exclude"); if (this.closed) return; this.conversationId = page.id;
    // An interrupted call is evidence of an unknown result, never fabricated success.
    for (const call of page.records.filter(r => r.kind === 'tool-call')) {
      if (call.kind !== 'tool-call' || page.records.some(r => r.kind === 'tool-result' && r.requestId === call.requestId)) continue;
      await this.save({ id: randomUUID(), at: Date.now(), kind: 'tool-result', requestId: call.requestId,
        receipt: { id: call.requestId, at: Date.now(), capability: call.name, outcome: 'unknown', detail: 'A previous cycle ended before a result was recorded; no success is established.', dependencies: ['runtime2:archive'] } });
    }
  }
  async initialize() {
    await this.reconcile();
    await this.refreshState();
    const savedAttention = await this.archive.readAttention();
    if (savedAttention) this.attention.restore(savedAttention);
    this.options.daily?.recorder.event('state.restored', { conversationId: this.conversationId, canonical: this.stateRevisions(), attention: this.attention.snapshot(), cognition: this.options.cognition ?? 'two-speed' });
    const scene = await this.archive.readScene();
    if (scene.coverage.recorded) {
      this.notifyObservation();
      const watchStartedAt = this.attention.watchStartedAt;
      if (watchStartedAt !== undefined) {
        let after = scene.cursor;
        while (after < scene.version && !this.attention.matchedCondition) {
          const page = await this.archive.sceneEvents({ after, through: scene.version, limit: 50, watchStartedAt });
          for (const { observation, conditions } of page.events) {
            if (!observation || !conditions || (observation.disclosure?.retainUntil ?? Infinity) <= Date.now() ||
                this.host && !this.host.allowed('disclose', observation, 'ambient')) continue;
            this.attention.observe(observation.disclosure?.source ?? 'screen', observation.sourceIdentity, conditions, observation.at);
          }
          if (page.nextAfter === null) break;
          after = page.nextAfter;
        }
      }
    }
    this.timer = setInterval(() => { void this.tick(); }, Math.min(this.interval, 1000));
    this.timer.unref();
  }
  async refreshState() { const [recent, scheduled] = await Promise.all([this.archive.findState({ status: 'active', limit: 50 }), this.archive.scheduledState()]); this.canonical = [...new Map([...scheduled, ...recent].map(s => [s.id,s])).values()]; }
  private async permittedState(mode: 'direct' | 'ambient', candidates = this.canonical) {
    const current = candidates.filter(s => (s.expiresAt ?? Infinity) > Date.now() && !(mode === 'ambient' && this.baselineState(s)));
    if (!this.options.host) return current;
    if (!this.options.host.allowed('state')) return [];
    const evidence = new Map<string, import('./contracts').Observation | undefined>();
    const result: CanonicalState[] = [];
    for (const state of current) {
      let allowed = true;
      for (const id of state.evidence) {
        if (!evidence.has(id)) evidence.set(id, await this.archive.get(id));
        const observation = evidence.get(id);
        if (observation ? (observation.disclosure?.retainUntil ?? Infinity) <= Date.now() || !this.options.host.allowed('disclose', observation, mode) : !await this.archive.hasDialogue(id)) { allowed = false; break; }
      }
      if (allowed) { result.push(state); this.unavailableReviews.delete(state.id); } else if (mode === 'ambient') this.unavailableReviews.add(state.id);
    }
    return result;
  }
  private stateRevisions() {
    return this.canonical.map(({ id, kind, status, revision, dueAt, scheduledReviews }) =>
      ({ id, kind, status, revision, dueAt, scheduledReviews }));
  }
  private permittedResult(value: unknown, mode: 'direct' | 'ambient', depth = 0): boolean {
    if (!this.options.host || !value || typeof value !== 'object') return true;
    if (depth > 20) return false;
    if ('dialogue' in value && !this.options.host.allowed('conversation')) return false;
    if ('modality' in value && 'provenance' in value) {
      const observation = value as import('./contracts').Observation;
      return (observation.disclosure?.retainUntil ?? Infinity) > Date.now() && this.options.host.allowed('disclose', observation, mode);
    }
    return Object.values(value).every(item => this.permittedResult(item, mode, depth + 1));
  }
  private workingState(allowed = this.canonical, maxBytes = 18000, due: CanonicalState[] = []) {
    const selected = new Map(allowed.filter(s => s.kind === 'checkpoint' || s.pinned).map(s => [s.id, s]));
    for (const state of due) {
      if (!selected.has(state.id)) selected.set(state.id, { ...state, text: state.text.slice(0, 1000) });
    }
    let bytes = Buffer.byteLength(JSON.stringify([...selected.values()]));
    const investigation = allowed.find(s => s.kind === 'investigation' && !selected.has(s.id));
    for (const state of investigation ? [investigation, ...allowed] : allowed) {
      if (selected.has(state.id)) continue;
      const size = Buffer.byteLength(JSON.stringify(state));
      if (bytes + size > maxBytes) continue;
      bytes += size;
      selected.set(state.id, state);
    }
    return [...selected.values()];
  }
  private due() { if (this.options.host && !this.options.host.allowed('state')) return []; const now = Date.now(); return this.canonical.filter(s => !this.baselineState(s) && !this.unavailableReviews.has(s.id) && s.dueAt !== null && s.dueAt <= now && (s.reviewedAt ?? -Infinity) < s.dueAt); }
  private ambientTrigger() {
    if (this.options.host && !this.options.host.allowed("disclose", undefined, "ambient")) return;
    if (this.options.daily && !this.options.daily.ambientReady()) return;
    this.attention.configure(this.options.daily?.ambientInterval ?? this.interval, this.options.daily?.config.requestsPerHour ?? 120);
    return this.attention.reason(this.pendingAmbient, this.structural, this.due().length > 0, this.pendingSources, this.pendingSince, this.lastChange);
  }
  private tick() {
    if (this.closed || this.running) return;
    const browser = this.host?.browserStatus?.() as { status?: string } | undefined;
    if (browser?.status) this.attention.sourceAvailability('chrome', browser.status === 'paired-authorized');
    const trigger = this.ambientTrigger();
    const reason = this.options.daily?.paused || this.paused ? 'paused' : this.environmentPaused ? 'environment-paused'
      : trigger ?? (this.pendingAmbient ? 'waiting-for-attention-or-budget' : 'waiting-for-change-or-deadline');
    if (reason !== this.lastWakeDecision) {
      this.lastWakeDecision = reason;
      this.options.daily?.recorder.event('scheduler.decision', { reason, attention: this.attention.snapshot(),
        nextReviewAt: this.attention.reviewAt, pendingSources: [...this.pendingSources], due: this.due().map(s => s.id) });
    }
    if (!this.paused && !this.environmentPaused && (this.pendingUser || trigger)) this.kick();
  }
  private get interval() { return this.options.daily?.config.ambientMs ?? this.options.ambientMs ?? 30_000; }
  private emit(channel: string, payload: unknown) { if (!this.closed) { try { this.options.emit?.(channel, payload); } catch { /* Presentation cannot interrupt durable chronology. */ } } }
  private phase(phase: AssistantPhase, detail?: string) { if (this.closed) return; this.phaseValue = phase; this.emit('chat:phase', { phase, detail, delivery: this.ambientInFlight ? 'aside' : 'reply' }); }
  get host() { return this.options.host; }
  get state() { return { phase: this.phaseValue, busy: !!this.running, inferences: structuredClone(this.inferenceReceipts) }; }
  get id() { return this.conversationId; }
  async diagnosticBaseline(clean = false) {
    const page = await this.archive.conversation(1, true);
    await this.refreshState();
    const restored = { conversationId: page.id, hasPriorDialogue: page.records.length > 0, attention: this.attention.snapshot(), canonical: this.stateRevisions(), cognition: this.options.cognition ?? 'two-speed' };
    if (clean) {
      // Explicit diagnostic option, only call while quiescent. No durable state is removed.
      this.attention.restore({ paused: false });
      this.consumeObservations();
    }
    this.normalBaselineAt = clean ? Date.now() : undefined;
    return { restored, cleanNormalAttention: clean, attention: this.attention.snapshot(), ambientTaskBoundary: this.normalBaselineAt, policy: 'Clean evaluation hides inherited task state and dialogue from ambient context only; history and canonical records remain recoverable. Direct conversation retains access.' };
  }
  notifyObservation(structural = false, source = 'screen', identity?: string, conditions: readonly WatchCondition[] = [], at?: number, ordinaryCandidate = true) {
    if (this.closed) return;
    this.attention.observe(source, identity, conditions, at);
    this.options.daily?.recorder.event('scheduler.observation', { source, identity, conditions, structural, ordinaryCandidate, coalesced: this.pendingAmbient, running: !!this.running });
    this.unavailableReviews.clear();
    if (!structural && !ordinaryCandidate && !this.attention.matchedCondition) return;
    if (!this.pendingAmbient) this.pendingSince = Date.now();
    this.lastChange = Date.now();
    this.pendingAmbient = true;
    this.pendingSources.add(source === 'chrome' ? 'chrome' : 'screen');
    if (identity && this.pendingSources.size < 128) this.pendingSources.add(identity);
    this.structural ||= structural;
  }
  private consumeObservations() {
    this.pendingAmbient = this.structural = false;
    this.pendingSince = Infinity;
    this.pendingSources.clear();
    this.attention.clearMatch();
  }
  private save(record: RecordInput) { if (this.closed) return Promise.reject(Error('Runtime is stopped.')); return this.archive.appendConversation(record); }
  async history(limit = 200): Promise<ChatMessage[]> {
    const page = await this.archive.conversation(Math.min(2000, limit), true);
    return page.records.filter(r => r.kind === 'user' || r.kind === 'assistant').slice(-limit).map(r => ({ id: r.id, role: r.kind as 'user' | 'assistant', content: 'text' in r ? r.text : '', ts: r.at, meta: { provider: 'siwc' } }));
  }
  async send(text: string) {
    if (this.options.daily?.paused) throw Error('Daily-test is paused. Start or resume the diagnostic session in Chat.');
    this.emit('runtime2:stopSpeech', {});
    if (this.options.host && !this.options.host.allowed('conversation')) throw Error('Runtime 2 durable conversation is disabled by history privacy controls.');
    if (this.closed || !text.trim() || text.length > 20_000) throw Error('Invalid user message or stopped runtime.');
    if (this.queuedUsers >= 32) throw Error('Conversation queue is full; wait for the current response.');
    this.queuedUsers++;
    const message: ChatMessage = { id: randomUUID(), role: 'user', content: text, ts: Date.now() };
    try {
      await this.save({ id: message.id, at: message.ts, kind: 'user', text });
      if (this.closed) return message.id;
      this.emit('chat:message', { message }); if (this.ambientInFlight) this.current?.abort(); this.pendingUser = true; this.paused = false; this.kick();
      return message.id;
    } finally { this.queuedUsers--; }
  }
  resumeAmbient() { if (!this.closed) { this.paused = false; } }
  resume() { if (!this.closed) { this.paused = false; this.pendingUser = true; this.kick(); } }
  environment(paused: boolean) { this.environmentPaused = paused; if (paused) { this.environmentAbort = true; this.current?.abort(); } }
  async quiesce() { this.stop(); await this.running; }
  stop() { this.emit('runtime2:stopSpeech', {}); this.pendingUser = false; this.paused = true; this.consumeObservations(); this.current?.abort(); }
  private kick() {
    if (this.closed || this.running) return;
    this.running = this.drain().finally(() => {
      this.running = undefined;
      if (!this.closed && this.pendingUser && !this.paused) this.kick();
    });
  }
  private async drain() {
    while (!this.closed && !this.paused && !this.environmentPaused && !this.options.daily?.paused) {
      const trigger = this.pendingUser ? 'user' : this.ambientTrigger();
      if (!trigger) break;
      const ambient = trigger !== 'user'; this.ambientInFlight = ambient; this.environmentAbort = false;
      this.pendingUser = false;
      const triggerSources = [...this.pendingSources];
      const observationAt = Number.isFinite(this.pendingSince) ? this.pendingSince : undefined;
      const matchedCondition = this.attention.matchedCondition;
      const nextReviewAt = this.attention.reviewAt;
      const satisfiedFallback = Boolean(matchedCondition && this.attention.reviewIsFallback);
      this.attention.started(trigger, this.pendingSources);
      this.current = new AbortController();
      const signal = AbortSignal.any([this.controller.signal, this.current.signal, AbortSignal.timeout(this.options.timeoutMs ?? 180_000)]);
      this.phase('thinking');
      const cycleStarted = Date.now(), due = this.due().slice(0,10);
      const investigationIds = due.filter(s => s.kind === 'investigation').map(s => s.id);
      const cycleId = randomUUID(), recorder = this.options.daily?.recorder;
      this.options.daily?.cycle(cycleId, ambient);
      recorder?.event('cycle.start', { trigger, triggerSources, matchedCondition, ambient, priorCompletion: this.previousCompletion, nextReviewAt, timeSinceLastInferenceMs: this.inferenceReceipts.length ? cycleStarted - this.inferenceReceipts.at(-1)!.at : null, attention: { requested: this.attention.snapshot(), baseIntervalMs: this.interval, hostAmbientMinimumMs: Math.min(this.interval, 10000) }, due: due.map(s => ({ id: s.id, dueAt: s.dueAt })), canonical: this.stateRevisions(), body: this.options.host?.body(), usage: this.options.daily?.status.usage }, { cycleId });
      const suppliedReviews = new Set<string>();
      const actualResults = new Map<string, { result: unknown; round: number; evidence: string[] }>();
      const images: { observationId: string; dataUrl: string }[] = [];
      const failedCaptures = new Set<string>();
      const cognition = this.options.cognition ?? 'two-speed';
      let deep = !ambient || (cognition === 'two-speed' && due.some(s => s.kind === 'investigation'));
      let partial = ''; let responseId = randomUUID();
      try {
        await this.reconcile(); signal.throwIfAborted();
        if (this.options.host && !this.options.host.allowed('disclose', undefined, ambient ? 'ambient' : 'direct')) throw Error('Cloud disclosure is currently paused');
        const models = await this.provider.models(signal); signal.throwIfAborted();
        const model = selectModel(models, this.options.daily?.config.model || this.options.model);
        // Five executable tool rounds plus one outcome-aware finishing response.
        // Removing tools on the final request works without provider-specific controls.
        for (let round = 0; round < 6; round++) {
          this.consumeObservations();
          const lean = ambient && cognition !== 'layered' && !deep;
          const cognitiveMode = !ambient ? 'direct' : round > 0 ? 'investigation' : due.length || trigger === 'attention-review' ? 'scheduled' : 'routine';
          const [page, dialogue, scene] = await Promise.all([
            this.archive.conversation(round > 0 ? 160 : 32, false, 'exclude'),
            this.archive.conversation(cognitiveMode === 'routine' ? 24 : 60, true),
            this.archive.readScene(),
          ]);
          signal.throwIfAborted();
          page.records = [...new Map([...dialogue.records, ...page.records].map(record => [record.id, record])).values()].sort((a, b) => a.sequence - b.sequence);
          const priorReceipts = page.records.flatMap(r => r.kind === 'tool-result' && !actualResults.has(r.requestId)
            ? [{ capability: r.receipt.capability, at: r.at, outcome: r.receipt.outcome, detail: r.receipt.detail }] : []).slice(-4);
          const completedAfter = this.normalBaselineAt ?? 0;
          const retiredDialogue = new Set<string>();
          let endedTasks: {id:string;status:string;evidence:string[]}[] = [];
          if (lean) {
            const ended = await Promise.all(['completed', 'abandoned'].map(status => this.archive.findState({ kind: 'investigation', status: status as 'completed' | 'abandoned', limit: 50 })));
            endedTasks=(await this.permittedState('ambient',ended.flat())).map(({id,status,evidence})=>({id,status,evidence}));
            for(const state of endedTasks)for(const id of state.evidence)retiredDialogue.add(id);
            const states = await this.permittedState('ambient');
            const active = this.options.host?.active();
            const subjects = this.options.host?.windows().filter(w=>w.handle===active).map(w=>w.title) ?? [];
            const ongoing=states.filter(s=>s.status==='active'&&['interest','intention','investigation','checkpoint'].includes(s.kind)&&!(s.kind==='checkpoint'&&s.evidence.some(id=>retiredDialogue.has(id))));
            page.records = await selectAmbientDialogue(this.archive,page.records,completedAfter,subjects,
              ongoing.flatMap(s=>s.evidence),new Set(ended.flat().flatMap(s=>s.evidence)));
          }
          const mode = ambient ? 'ambient' : 'direct';
          if (this.options.host && !this.options.host.allowed('disclose', undefined, mode)) throw Error('Cloud disclosure is currently paused');
          const live = this.perception?.current(mode) ?? [];
          const liveSlots = new Map(live.map(o => [observationSlot(o), o]));
          const bySlot = new Map(scene.latest.map(o => [observationSlot(o), o]));
          for (const o of live) bySlot.set(observationSlot(o), o);
          const permitted = (o: import('./contracts').Observation) =>
            (o.disclosure?.retainUntil ?? Infinity) > Date.now() && (!this.options.host || this.options.host.allowed('disclose', o, mode));
          const now = Date.now(), active = this.options.host?.active();
          const isCurrent = (o: import('./contracts').Observation) =>
            active != null && liveSlots.get(observationSlot(o))?.id === o.id && o.content.handle === active;
          const sceneFacts = [...bySlot.values()].filter(permitted)
            .sort((a,b) => Number(isCurrent(b)) - Number(isCurrent(a)) || b.at - a.at)
            .slice(0, lean ? 4 : cognitiveMode === 'routine' ? 6 : 12).map(o => sceneFact(o, isCurrent(o), now));
          const changes = [...new Map([...scene.recent, ...scene.changes].filter(permitted).map(o => [o.id, o])).values()];
          const changedIds = new Set(changes.map(o => o.id));
          const facts = sceneFacts.map(fact => changedIds.has(fact.id) ? { ...fact, changed: true } : fact);
          const describedIds = new Set(facts.map(o => o.id));
          const otherChanges = changes.filter(o => !describedIds.has(o.id));
          const recentChanges = otherChanges.slice(0, lean ? 4 : 8).map(o => sceneFact(o, isCurrent(o), now));
          const omittedChanges = otherChanges.slice(recentChanges.length).map(o => o.id);
          if (round === 0 && model.supportsImages && this.perception) {
            images.push(...await this.perception.currentImages(mode, signal, changes));
          }
          // Direct questions get a one-request fast path to newly changed visible text.
          const immediate = round === 0 ? (!ambient ? live.filter(o => o.modality === 'browser-page' && isCurrent(o) && permitted(o)).slice(0, 1)
            : lean ? [...new Map([...live, ...changes, ...bySlot.values()].filter(o => ['browser-page','application-text','accessibility'].includes(o.modality) && permitted(o)).map(o => [o.id, o])).values()]
              .sort((a,b) => Number(isCurrent(b)) - Number(isCurrent(a)) || Number(changedIds.has(b.id)) - Number(changedIds.has(a.id)) || b.at - a.at).slice(0,2) : []) : [];
          const history = page.records.filter(r => r.kind === 'tool-call' || r.kind === 'tool-result'
            ? actualResults.has(r.requestId)
            : lean || cognitiveMode !== 'routine' || dialogue.records.some(d => d.id === r.id));
          const presented = history.map(original => {
            if (original.kind !== 'tool-result') return original;
            const entry = actualResults.get(original.requestId);
            const result = entry?.result;
            if (!this.permittedResult(result, mode)) return { ...original, result: { withheld: 'Evidence disclosure is currently denied.' }, receipt: { ...original.receipt, outcome: 'denied' as const } };
            // The first continuation receives the complete result. Older large payloads
            // remain recoverable by ID when the investigation moves to later rounds.
            if (entry && entry.round + 2 < round && entry.evidence.length && approximateTokens(result) > 12000) {
              return { ...original, result: { earlierEvidenceIds: entry.evidence, detail: 'Previously supplied; retrieve again for full details.' } };
            }
            return { ...original, result };
          });
          for (const o of immediate) presented.push(excerptObservation({
            id: o.id, kind: 'observation', observationId: o.id, sequence: 0, at: o.at, observation: o,
          }));
          const metadataIds = new Set([...facts.filter(o => changedIds.has(o.id)), ...recentChanges].map(o => o.id));
          const sceneCoverage = scene.coverage.recorded ? {
            after: scene.coverage.after, through: scene.coverage.through, recorded: scene.coverage.recorded,
            firstAt: scene.coverage.firstAt, lastAt: scene.coverage.lastAt,
            expiredOrDeleted: scene.coverage.recorded - scene.coverage.retained,
            full: 0, metadataOrExcerpt: metadataIds.size,
            unexpandedRetained: scene.coverage.retained - metadataIds.size,
            recovery: 'read_activity(after, through) expands this window.',
          } : undefined;
          const summary = scene.episode ? await episodeSummary(this.archive, scene.episode, permitted, now) : undefined;
          const episode = summary && (!lean && cognitiveMode !== 'routine' ? summary : {
            id: summary.id, through: summary.through, startedAt: summary.startedAt, lastActivityAt: summary.lastActivityAt,
            observations: summary.observations, status: summary.status, sampledSources: summary.sources,
          });
          const contentDeltas = [];
          if (ambient) {
            for (const candidate of changes.filter(o => metadataIds.has(o.id) && o.modality === 'browser-page' && o.related?.length).slice(0, 4)) {
              const [current, previous] = await Promise.all([this.archive.get(candidate.id), this.archive.get(candidate.related![0])]);
              if (!current || !previous || !permitted(current) || !permitted(previous)) continue;
              const delta = contentDelta(previous, current);
              if (delta) contentDeltas.push(delta);
              if (contentDeltas.length === 2) break;
            }
          }
          const allowedState = await this.permittedState(mode); signal.throwIfAborted();
          const suppliedDue = due.filter(s => allowedState.some(a => a.id === s.id));
          for (const state of suppliedDue) suppliedReviews.add(state.id);
          const tools = round === 5 ? [] : lean ? [...AMBIENT_TOOLS, ...(cognition === 'two-speed' ? [ESCALATE_TOOL] : [])] : cognitiveMode === 'routine' ? ROUTINE_TOOLS : AGENT_TOOLS;
          const input = assembleContext(presented, model, tools, this.options.contextBudget, 8192 + images.length * 8192, {
            toolBudget: { remainingExecutableRounds: Math.max(0, 5 - round), remainingRequests: 6 - round, mode,
              instruction: lean ? 'Ordinary speech and actions finish in this request. No finishing inference follows. Escalate explicitly only when deeper work is warranted.' : round === 5 ? 'No tool executions remain. Answer the direct user question from actual outcomes when possible; disclose unresolved work. Ambient silence remains valid. Never claim a denied action succeeded.' : 'Use remaining tool rounds to retrieve evidence and complete justified state updates before the finishing response. Stop when the investigation stopping condition is met; complete or abandon its canonical record. Keep progress in the checkpoint or investigation for a later boundary.' },
            cognitiveMode, cognition, route: lean ? 'ambient' : 'deep', wakeCause: trigger,
            ...(matchedCondition && round === 0 ? { matchedCondition } : {}),
            scene: { version: scene.version, facts },
            recentChanges, sceneCoverage, episode, ...(contentDeltas.length ? { contentDeltas } : {}),
            previousExecutionReceipts: lean ? priorReceipts : page.records.flatMap(r => r.kind === 'tool-result' && !actualResults.has(r.requestId)
              ? [{ capability: r.receipt.capability, at: r.at, outcome: r.receipt.outcome }] : []).slice(-8),
            foregroundHandle: this.options.host?.active() ?? null,
            browser: this.options.host?.browserStatus?.() ?? { status: 'unavailable' },
            sessionLimits: this.options.daily ? { config: this.options.daily.config, usage: this.options.daily.status.usage, policy: 'Host enforces these ceilings for every HTTP attempt, including continuations. Token ceiling stops subsequent admissions after reported usage reaches it; exact remaining account quota is unknown.' } : null,
            now: Date.now(), body: this.options.host?.body() ?? null, attention: this.attention.snapshot(), activeState: lean ? ambientState(allowedState.filter(s => s.kind !== 'checkpoint' || s.revisedAt > completedAfter && !s.evidence.some(id=>retiredDialogue.has(id))), new Set([...facts.map(o => o.id), ...immediate.map(o => o.id)]), suppliedDue) : this.workingState(allowedState, cognitiveMode === 'routine' ? 6000 : 18000, suppliedDue), dueReviews: suppliedDue.map(s => s.id),
            completedTasks: endedTasks.slice(0,6),
            conversationPolicy: 'Selected historical exchanges supply context, not reissued instructions. Completed or abandoned task instructions are inactive. Current user instructions win. Relevant history has no time expiry; expand older dialogue through archive search and retrieve_evidence.',
            evidenceRecovery: 'Search or fetch known IDs. Promote useful discoveries to working-checkpoint or canonical memory when warranted.',
          }, lean ? IDENTITY + AMBIENT_INSTRUCTIONS : IDENTITY);
          if (sceneCoverage) {
            for (const record of input.records) {
              if (record.kind !== 'observation' || !changedIds.has(record.observationId)) continue;
              const original = immediate.find(o => o.id === record.observationId);
              if (!original) continue;
              const bucket = metadataIds.has(record.observationId) ? 'metadataOrExcerpt' : 'unexpandedRetained';
              if (original === record.observation) {
                sceneCoverage.full++;
                sceneCoverage[bucket]--;
              } else if (bucket === 'unexpandedRetained') {
                sceneCoverage.metadataOrExcerpt++;
                sceneCoverage.unexpandedRetained--;
              }
            }
          }
          if (images.length) {
            input.images = images.splice(0,2);
            for (const image of input.images) {
              const observation = await this.archive.get(image.observationId);
              if (!observation || this.options.host && !this.options.host.allowed('disclose', observation, mode)) throw Error('Image permission or evidence reference unavailable');
              image.capturedAt = observation.at;
            }
          }
          partial = ''; responseId = randomUUID();
          const networkId = randomUUID(); this.options.daily?.requestIdentity(networkId);
          if (recorder?.status.active) {
            const available = (await this.archive.stats()).count;
            signal.throwIfAborted();
            recorder.event('context.selection', {
              sceneCoverage, episodeId: episode?.id, cognitiveMode, trigger, sceneVersion: scene.version, previousSceneVersion: scene.cursor,
              sceneEvidenceIds: facts.map(o => o.id), changedEvidenceIds: [...facts.filter(o => changedIds.has(o.id)).map(o => o.id), ...recentChanges.map(o => o.id)],
              omittedChangeIds: omittedChanges,
              availableObservations: available,
              checkpoints: allowedState.filter(s => s.kind === 'checkpoint' || s.kind === 'investigation').map(s => ({ id: s.id, revision: s.revision })),
              categoryUtf8Bytes: {
                identity: Buffer.byteLength(input.identity), toolSchemas: approximateTokens(input.tools) - 32,
                dialogue: approximateTokens(input.records.filter(r => r.kind === 'user' || r.kind === 'assistant')) - 32,
                evidenceAndToolResults: approximateTokens(input.records.filter(r => r.kind === 'observation' || r.kind === 'tool-result')) - 32,
                executionReceipts: approximateTokens(input.records.flatMap(r => r.kind === 'tool-result' ? [r.receipt] : [])) - 32,
                scene: approximateTokens({ facts, recentChanges, sceneCoverage }) - 32,
                episode: episode ? approximateTokens(episode) - 32 : 0,
                checkpoint: approximateTokens(allowedState.filter(s => s.kind === 'checkpoint')) - 32,
                foundational: approximateTokens(allowedState.filter(s => s.pinned && s.kind !== 'checkpoint')) - 32,
                imageBase64: (input.images ?? []).reduce((sum, image) => sum + Buffer.byteLength(image.dataUrl), 0),
              },
            }, { cycleId, requestId: networkId });
          }
          recorder?.request(networkId, 'assembled', { model, input, contextBudget: this.options.contextBudget, round, omittedRecordIds: presented.filter(r => !input.records.some(i => i.id === r.id)).map(r => r.id) }, cycleId);
          const requestStarted = Date.now();
          const result = await this.provider.infer(model, input, signal, delta => {
            if (this.closed || signal.aborted) return;
            partial += delta; this.emit('chat:delta', { messageId: responseId, delta, delivery: ambient ? 'aside' : 'reply' });
          });
          signal.throwIfAborted();
          this.perception?.acknowledgeImages(input.images ?? []);
          recorder?.request(networkId, 'output', result, cycleId);
          this.previousCompletion = result.calls.length ? 'tool-continuation' : result.text ? 'dialogue' : 'silent';
          if (!result.calls.length && ambient) this.attention.complete(this.previousCompletion === 'silent');
          else if (result.text || result.calls.length) this.attention.complete(false);
          signal.throwIfAborted();
          if (scene.version > scene.cursor) {
            await this.archive.acknowledgeScene(scene.version);
            recorder?.event('scene.acknowledged', { ...sceneCoverage, laterObservationNotified: this.pendingAmbient }, { cycleId, requestId: networkId });
          }
          recorder?.event('provider.result', { ...result, round, cognitiveMode, cognition, route: lean ? 'ambient' : 'deep', investigationIds, latencyMs: Date.now() - requestStarted, observationToDecisionMs: observationAt === undefined ? null : Date.now() - observationAt, outcome: this.previousCompletion, model }, { cycleId, requestId: networkId });
          this.inferenceReceipts.push({ at: Date.now(), model: model.id, requestId: result.requestId, usage: result.usage });
          if (this.inferenceReceipts.length > 32) this.inferenceReceipts.shift();
          signal.throwIfAborted();
          if (round === 0 && nextReviewAt !== null && (nextReviewAt <= cycleStarted || satisfiedFallback)) {
            const previousAttention = this.attention.durableState();
            if (this.attention.acknowledge(nextReviewAt)) {
              try { await this.archive.writeAttention(this.attention.durableState()); }
              catch (error) { this.attention.restore(previousAttention); throw error; }
            }
          }
          if (result.text) {
            recorder?.event('dialogue', { text: result.text, ambient, responseId }, { cycleId, requestId: networkId });
            if (!result.calls.length) await this.save({ id: responseId, at: Date.now(), kind: 'assistant', text: result.text, inference: { model: model.id, requestId: result.requestId, usage: result.usage } });
            this.emit('chat:done', { message: { id: responseId, role: 'assistant', content: result.text, ts: Date.now(), meta: { provider: 'siwc' } }, delivery: ambient ? 'aside' : 'reply' });
            if (!result.calls.length) this.emit('runtime2:speak', { id: responseId, text: result.text, ambient });
          }
          partial = '';
          if (!result.calls.length) break;
          if (result.calls.length > 8) throw Error('Tool round limit reached.');
          const used = new Set(page.records.filter(r => r.kind === 'tool-call').map(r => r.kind === 'tool-call' ? r.requestId : ''));
          for (const call of result.calls) {
            if (!call.id || call.id.length > 256 || used.has(call.id)) throw Error('Duplicate or invalid tool request ID.');
            used.add(call.id);
          }
          // Persist the provider's output order before executing any effects.
          const ordered = result.outputOrder?.length ? result.outputOrder : [...(result.text ? [{ type: 'text' as const, text: result.text }] : []), ...result.calls.map(call => ({ type: 'call' as const, callId: call.id }))];
          for (const item of ordered) {
            const inference = { model: model.id, requestId: result.requestId, usage: result.usage };
            if (item.type === 'text') await this.save({ id: randomUUID(), at: Date.now(), kind: 'assistant', text: item.text, inference });
            else {
              const call = result.calls.find(call => call.id === item.callId)!;
              await this.save({ id: randomUUID(), at: Date.now(), kind: 'tool-call', requestId: call.id, name: call.name, arguments: call.arguments, inference });
            }
          }
          for (const call of result.calls) {
            signal.throwIfAborted();
            const toolStarted = Date.now();
            recorder?.event('tool.start', { ...call, round, body: this.options.host?.body(), canonical: this.stateRevisions() }, { cycleId, requestId: networkId });
            if (round === 5 || !tools.some(tool => tool.name === call.name)) {
              actualResults.set(call.id, { result: undefined, round, evidence: [] });
              recorder?.event('tool.denied', { ...call, reason: round === 5 ? 'tool-budget-exhaustion' : 'tool-not-offered', persisted: true }, { cycleId, requestId: networkId });
              await this.save({ id: randomUUID(), at: Date.now(), kind: 'tool-result', requestId: call.id, receipt: { id: call.id, at: Date.now(), capability: call.name, outcome: 'denied', detail: 'Tool is unavailable for this request.', dependencies: ['runtime2:archive'] } });
              continue;
            }
            const definition = agentTool(this.archive, { perception: this.perception, attention: this.attention, failedCaptures, refreshState: () => this.refreshState(), mode: ambient ? 'ambient' : 'direct', model, attach: (observationId, dataUrl) => { if (images.length >= 2) return false; images.push({ observationId, dataUrl }); return true; } }, call.name);
            // Parsing is performed inside the existing capability executor so invalid calls earn real failed receipts.
            const execution = await this.executor.execute({ id: call.id, capability: 'runtime2.agent.' + call.name, fingerprint: call.arguments,
              dependencies: ['runtime2:archive'], deadline: Date.now() + 10_000, persist: false }, call.arguments, {
                ...definition, parse: value => {
                  if (typeof value !== 'string' || value.length > 32768) throw Error('Invalid tool arguments');
                  try { return definition.parse(JSON.parse(value)); }
                  catch (error) {
                    if (error instanceof z.ZodError) {
                      throw Error('Invalid tool arguments. ' + error.issues.map(issue => issue.message).join(' ').slice(0, 700));
                    }
                    throw Error('Invalid archive tool arguments.');
                  }
                },
              }, signal);
            recorder?.event('tool.end', { ...call, execution, durationMs: Date.now() - toolStarted, body: this.options.host?.body(), canonical: this.stateRevisions(), attention: this.attention.snapshot() }, { cycleId, requestId: networkId });
            if (call.name === 'investigate' && execution.receipt.outcome === 'completed') {
              const id = (execution.result as { id?: string })?.id;
              if (id && !investigationIds.includes(id)) investigationIds.push(id);
            }
            const references: { observationId: string; modality: string; originalId?: string }[] = [];
            const collect = (value: unknown, depth = 0) => {
              if (!value || typeof value !== 'object' || depth > 20) return;
              if ('dialogue' in value && value.dialogue && typeof value.dialogue === 'object' && 'id' in value.dialogue) {
                references.push({ observationId: String(value.dialogue.id), modality: 'dialogue' }); return;
              }
              if ('modality' in value && 'id' in value && 'provenance' in value) { const o = value as import('./contracts').Observation; references.push({ observationId: o.id, modality: o.modality, ...(o.original ? { originalId: o.original.id } : {}) }); return; }
              for (const item of Object.values(value)) collect(item, depth + 1);
            };
            collect(execution.result);
            actualResults.set(call.id, { result: execution.result, round, evidence: references.map(r => r.observationId) });
            if (references.length || call.name === 'search_observations' || call.name === 'write_memory') recorder?.event('investigation.step', {
              tool: call.name, outcome: execution.receipt.outcome, investigationIds, references,
              ...(call.name === 'write_memory' ? { revision: execution.result } : {}),
            }, { cycleId, requestId: networkId });
            await this.save({ id: randomUUID(), at: Date.now(), kind: 'tool-result', requestId: call.id, ...execution,
              ...(call.name === 'read_activity' ? { result: { detail: 'Activity chronology is resolved from the archive on demand.' } } : references.length ? { result: { evidenceReferences: references, detail: 'Original results were supplied during execution. Recover original content with retrieve_evidence; duplicate rich content is not retained in the journal.' } } : {}) });
            signal.throwIfAborted();
          }
          if (lean) {
            // A complete small decision needs execution receipts, not another cloud response.
            // Only an offered, successfully persisted model escalation may open the deep loop.
            const escalation = result.calls.find(call => call.name === 'investigate');
            const page = escalation ? await this.archive.conversation(32, false, 'exclude') : undefined;
            deep = !!escalation && !!page?.records.some(r => r.kind === 'tool-result' && r.requestId === escalation.id && r.receipt.outcome === 'completed');
            recorder?.event('ambient.completed', { escalated: deep, actions: result.calls.map(call => call.name), text: result.text, finishingInference: false }, { cycleId, requestId: networkId });
            if (result.text) this.emit('runtime2:speak', { id: responseId, text: result.text, ambient: true });
            if (!deep) break;
          }
          if (round === 5) throw Error('Tool round limit reached.');
          if (ambient && this.pendingUser) break;
        }
        await this.archive.reviewState([...suppliedReviews], cycleStarted); await this.refreshState();
        recorder?.event('cycle.end', { durationMs: Date.now() - cycleStarted, suppliedReviews: [...suppliedReviews], canonical: this.stateRevisions(), attention: this.attention.snapshot() }, { cycleId });
        this.phase('idle');
      } catch (error) {
        const failure = error as { code?: string; status?: number };
        const outcome = signal.aborted ? 'canceled' : failure?.code === 'response_incomplete' || failure?.code === 'stream_interrupted' ? 'incomplete' : failure?.code === 'invalid_stream' || failure?.code === 'invalid_tool_call' ? 'adapter-failure' : error instanceof Error && error.message === 'Tool round limit reached.' ? 'tool-budget-exhaustion' : 'failure';
        recorder?.event('provider.error', { outcome, code: failure?.code, status: failure?.status, detail: safeFailure(error), durationMs: Date.now() - cycleStarted }, { cycleId });
        if (!this.closed && partial) this.emit('chat:done', { message: { id: responseId, role: 'assistant', content: partial, ts: Date.now(), meta: { provider: 'siwc', interrupted: true } }, delivery: ambient ? 'aside' : 'reply' });
        if (!this.closed) {
          this.notifyObservation();
          this.previousCompletion = 'failure';
          this.paused = !this.pendingUser && !this.environmentAbort;
          this.phase(signal.aborted ? 'idle' : 'error', signal.aborted ? 'Response cancelled or timed out. Saved conversation is preserved.' : safeFailure(error));
        }
      } finally { this.current = undefined; this.ambientInFlight = false; }
      if (ambient && !this.pendingUser) break;
    }
  }
  async clear() { this.stop(); await this.running; if (!this.closed) { await this.archive.clearConversation(); this.phase('idle'); } }
  async shutdown() {
    if (this.closed) return;
    this.closed = true; this.controller.abort(); this.current?.abort(); clearInterval(this.timer); this.provider.shutdown(); this.perception?.clear();
    await this.running;
  }
}

/** Never expose arbitrary exceptions, request bodies, or authentication values. */
export function safeFailure(error: unknown) {
  const value = error as { code?: unknown; status?: unknown; requestId?: unknown; message?: unknown };
  const code = typeof value?.code === 'string' && /^[a-z_]{1,80}$/.test(value.code) ? value.code : undefined;
  const status = Number.isInteger(value?.status) && Number(value.status) >= 100 && Number(value.status) <= 599 ? value.status : undefined;
  const request = typeof value?.requestId === 'string' && /^req_[a-zA-Z0-9_-]{1,100}$/.test(value.requestId) ? value.requestId : undefined;
  const known = typeof value?.message === 'string' && /^(Cloud request denied by host session controls|Conversation lifetime storage ceiling reached|Set CAPRI_V2_MODEL |CAPRI_V2_MODEL is not available|Runtime 2 requires a general-purpose|Selected model has no verified|Context budget cannot hold|Latest user message exceeds|Sign in with ChatGPT and authorize|Tool round limit reached)/.test(value.message) ? value.message : 'ChatGPT request stopped. Check sign-in and ChatGPT usage, then retry.';
  return known + (code || status || request ? ' [' + [code, status, request].filter(Boolean).join('; ') + ']' : '') + ' Saved conversation is preserved.';
}
