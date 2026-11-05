import { randomUUID } from 'node:crypto';
import type { TypedCapabilityExecutor } from '../../core/capabilities';
import type { AssistantPhase, ChatMessage } from '../../shared/ipc';
import type { WindowFocusArchive } from './windowFocusArchive';
import type { CognitiveProvider, RecordInput } from './cognitiveContracts';
import { approximateTokens, assembleContext, selectModel } from './context';
import { AGENT_TOOLS, agentTool } from './agentTools';
import { AttentionController } from './attention';
import { Perception, type DesktopHost } from './perception';
import type { CanonicalState } from './canonicalState';
import type { DailySession } from './dailySession';
import { excerptObservation, observationHash, observationSlot, workingObservations } from './workingObservations';
export interface LoopOptions { model?: string; contextBudget?: number; ambientMs?: number; timeoutMs?: number; host?: DesktopHost; daily?: DailySession; emit?: (channel: string, payload: unknown) => void }
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
  private pendingSources = new Set<string>();
  private observationCursor = 0;
  private previousObservations = new Map<string, string>();
  private recentImageHashes = new Set<string>();
  private previousCompletion: 'silent' | 'dialogue' | 'tool-continuation' | 'failure' | null = null;
  private investigationResults = new Map<string, { result: unknown; expiresAt: number }>();
  private closed = false;
  private paused = false;
  private phaseValue: AssistantPhase = 'idle';
  private conversationId = '';
  private inferenceReceipts: { at: number; model: string; requestId?: string; usage?: { inputTokens: number; outputTokens: number } }[] = [];
  private lastWakeDecision = '';
  constructor(private archive: WindowFocusArchive, private provider: CognitiveProvider, private executor: TypedCapabilityExecutor, private options: LoopOptions = {}) {
    this.attention = new AttentionController(this.interval, Math.min(this.interval, 10000), Date.now, options.daily?.config.requestsPerHour ?? 120);
    if (options.host) this.perception = new Perception(archive, options.host, (structural, source) => this.notifyObservation(structural, source), options.daily?.recorder);
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
    this.options.daily?.recorder.event('state.restored', { conversationId: this.conversationId, canonical: this.canonical });
    this.timer = setInterval(() => { void this.tick(); }, Math.min(this.interval, 1000));
    this.timer.unref();
  }
  async refreshState() { const [recent, scheduled] = await Promise.all([this.archive.findState({ status: 'active', limit: 50 }), this.archive.scheduledState()]); this.canonical = [...new Map([...scheduled, ...recent].map(s => [s.id,s])).values()]; }
  private async permittedState(mode: 'direct' | 'ambient') {
    if (!this.options.host) return this.canonical;
    if (!this.options.host.allowed('state')) return [];
    const evidence = new Map<string, import('./contracts').Observation | undefined>();
    const result: CanonicalState[] = [];
    for (const state of this.canonical) {
      let allowed = true;
      for (const id of state.evidence) {
        if (!evidence.has(id)) evidence.set(id, await this.archive.get(id));
        const observation = evidence.get(id);
        if (observation && !this.options.host.allowed('disclose', observation, mode)) { allowed = false; break; }
      }
      if (allowed) { result.push(state); this.unavailableReviews.delete(state.id); } else if (mode === 'ambient') this.unavailableReviews.add(state.id);
    }
    return result;
  }
  private permittedResult(value: unknown, mode: 'direct' | 'ambient', depth = 0): boolean {
    if (!this.options.host || !value || typeof value !== 'object') return true;
    if (depth > 20) return false;
    if ('modality' in value && 'provenance' in value) return this.options.host.allowed('disclose', value as import('./contracts').Observation, mode);
    return Object.values(value).every(item => this.permittedResult(item, mode, depth + 1));
  }
  private workingState(allowed = this.canonical) {
    const selected: CanonicalState[] = []; let bytes = 0;
    for (const state of [...this.due().filter(s => allowed.some(a => a.id === s.id)), ...allowed]) { if (selected.some(s => s.id === state.id)) continue; const size = Buffer.byteLength(JSON.stringify(state)); if (bytes + size > 18000) continue; bytes += size; selected.push(state); }
    return selected;
  }
  private due() { if (this.options.host && !this.options.host.allowed('state')) return []; const now = Date.now(); return this.canonical.filter(s => !this.unavailableReviews.has(s.id) && s.dueAt !== null && s.dueAt <= now && (s.reviewedAt ?? -Infinity) < s.dueAt); }
  private ambientTrigger() {
    if (this.options.host && !this.options.host.allowed("disclose", undefined, "ambient")) return;
    if (this.options.daily && !this.options.daily.ambientReady()) return;
    this.attention.configure(this.options.daily?.ambientInterval ?? this.interval, this.options.daily?.config.requestsPerHour ?? 120);
    return this.attention.reason(this.pendingAmbient, this.structural, this.due().length > 0, this.pendingSources, this.pendingSince);
  }
  private tick() {
    if (this.closed || this.running) return;
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
  private phase(phase: AssistantPhase, detail?: string) { if (this.closed) return; this.phaseValue = phase; this.emit('chat:phase', { phase, detail }); }
  get host() { return this.options.host; }
  get state() { return { phase: this.phaseValue, busy: !!this.running, inferences: structuredClone(this.inferenceReceipts) }; }
  get id() { return this.conversationId; }
  notifyObservation(structural = false, source = 'screen') {
    if (this.closed) return;
    this.options.daily?.recorder.event('scheduler.observation', { source, structural, coalesced: this.pendingAmbient, running: !!this.running });
    if (!this.pendingAmbient) this.pendingSince = Date.now();
    this.pendingAmbient = true;
    this.unavailableReviews.clear();
    this.pendingSources.add(source === 'chrome' ? 'chrome' : 'screen');
    this.structural ||= structural;
  }
  private consumeObservations() {
    this.pendingAmbient = this.structural = false;
    this.pendingSince = Infinity;
    this.pendingSources.clear();
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
  stop() { this.emit('runtime2:stopSpeech', {}); this.pendingUser = false; this.paused = true; this.consumeObservations(); this.investigationResults.clear(); this.current?.abort(); }
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
      const nextReviewAt = this.attention.reviewAt;
      this.attention.started(trigger);
      this.current = new AbortController();
      const signal = AbortSignal.any([this.controller.signal, this.current.signal, AbortSignal.timeout(this.options.timeoutMs ?? 180_000)]);
      this.phase('thinking');
      const cycleStarted = Date.now(), due = this.due().slice(0,10);
      const cycleId = randomUUID(), recorder = this.options.daily?.recorder;
      this.options.daily?.cycle(cycleId, ambient);
      recorder?.event('cycle.start', { trigger, triggerSources, ambient, priorCompletion: this.previousCompletion, nextReviewAt, timeSinceLastInferenceMs: this.inferenceReceipts.length ? cycleStarted - this.inferenceReceipts.at(-1)!.at : null, attention: { requested: this.attention.snapshot(), baseIntervalMs: this.interval, hostAmbientMinimumMs: Math.min(this.interval, 10000) }, due, canonical: this.canonical, body: this.options.host?.body(), usage: this.options.daily?.status.usage }, { cycleId });
      const suppliedReviews = new Set<string>();
      const actualResults = new Map<string, unknown>();
      for (const [id, value] of this.investigationResults) {
        if (value.expiresAt > Date.now()) actualResults.set(id, value.result);
        else this.investigationResults.delete(id);
      }
      const images: { observationId: string; dataUrl: string }[] = [];
      const failedCaptures = new Set<string>();
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
          const [page, dialogue, journal] = await Promise.all([
            this.archive.conversation(160, false, 'exclude'), this.archive.conversation(80, true), this.archive.conversation(96, false, 'only'),
          ]);
          signal.throwIfAborted();
          page.records = [...new Map([...dialogue.records, ...page.records].map(record => [record.id, record])).values()].sort((a, b) => a.sequence - b.sequence);
          const mode = ambient ? 'ambient' : 'direct';
          if (this.options.host && !this.options.host.allowed('disclose', undefined, mode)) throw Error('Cloud disclosure is currently paused');
          const permitted = journal.records.filter(r => r.kind === 'observation' && r.observation &&
            (!this.options.host || this.options.host.allowed('disclose', r.observation, mode)));
          const working = workingObservations(permitted, this.perception?.current(mode) ?? [], this.observationCursor, this.previousObservations);
          if (round === 0 && model.supportsImages && this.perception) {
            const candidates = working.chosen.flatMap(r => r.observation && !this.recentImageHashes.has(r.observation.content.evidenceId ?? r.observationId) ? [r.observation] : []);
            images.push(...await this.perception.currentImages(mode, signal, candidates));
          }
          const recentCalls = new Set(page.records.filter(r => r.kind === 'tool-call').slice(-8).map(r => r.requestId));
          const history = page.records.filter(r => (r.kind !== 'tool-call' && r.kind !== 'tool-result') ||
            recentCalls.has(r.requestId) || actualResults.has(r.requestId));
          const presented = [...history.map(original => {
            const r = original.kind === 'tool-result' && actualResults.has(original.requestId) ? { ...original, result: actualResults.get(original.requestId) } : original;
            if (r.kind === 'tool-result' && !this.permittedResult(r.result, mode)) return { ...r, result: { withheld: 'Evidence disclosure is currently denied.' }, receipt: { ...r.receipt, outcome: 'denied' as const } };
            return r;
          }), ...working.chosen.map(excerptObservation).reverse()];
          const allowedState = await this.permittedState(mode); signal.throwIfAborted();
          const suppliedDue = due.filter(s => allowedState.some(a => a.id === s.id));
          for (const state of suppliedDue) suppliedReviews.add(state.id);
          const input = assembleContext(presented, model, round === 5 ? [] : AGENT_TOOLS, this.options.contextBudget, 8192 + images.length * 8192, {
            toolBudget: { remainingExecutableRounds: Math.max(0, 5 - round), remainingRequests: 6 - round, mode,
              instruction: round === 5 ? 'No tool executions remain. Answer the direct user question from actual outcomes when possible; disclose unresolved work. Ambient silence remains valid. Never claim a denied action succeeded.' : 'Use remaining tool rounds to retrieve evidence and complete justified state updates before the finishing response.' },
            recentChanges: working.changes,
            foregroundHandle: this.options.host?.active() ?? null,
            observationScope: "Observations are timestamped evidence. An earlier snapshot may no longer describe a visible window. Recent changes are references to original records.",
            browser: this.options.host?.browserStatus?.() ?? { status: 'unavailable' },
            sessionLimits: this.options.daily ? { config: this.options.daily.config, usage: this.options.daily.status.usage, policy: 'Host enforces these ceilings for every HTTP attempt, including continuations. Token ceiling stops subsequent admissions after reported usage reaches it; exact remaining account quota is unknown.' } : null,
            now: Date.now(), body: this.options.host?.body() ?? null, attention: this.attention.snapshot(), activeState: this.workingState(allowedState), dueReviews: suppliedDue.map(s => ({ id: s.id, text: s.text.slice(0,1000), dueAt: s.dueAt, revision: s.revision })),
            evidenceRecovery: 'Original older chronology is retained in the archive. Retrieve by ID or literal search; omitted context is not a semantic summary.',
          });
          const imageHashes: string[] = [];
          if (images.length) {
            input.images = images.splice(0,2);
            for (const image of input.images) {
              const observation = await this.archive.get(image.observationId);
              if (!observation || this.options.host && !this.options.host.allowed('disclose', observation, mode)) throw Error('Image permission or evidence reference unavailable');
              imageHashes.push(observation.content.evidenceId ?? image.observationId);
            }
          }
          partial = ''; responseId = randomUUID();
          const networkId = randomUUID(); this.options.daily?.requestIdentity(networkId);
          if (recorder?.status.active) {
            const available = (await this.archive.stats()).count;
            signal.throwIfAborted();
            const observations = input.records.filter(r => r.kind === 'observation');
            const ids = new Set(input.records.map(r => r.id));
            const repeated = observations.filter(r => working.repeatedIds.has(r.id)).length;
            const times = [...observations.map(r => r.at), ...working.changes.map(r => r.at)];
            recorder.event('context.metrics', {
              estimatedBytesByCategory: {
                identity: approximateTokens(input.identity), tools: approximateTokens(input.tools),
                dialogue: approximateTokens(input.records.filter(r => r.kind === 'user' || r.kind === 'assistant')),
                toolHistory: approximateTokens(input.records.filter(r => r.kind === 'tool-call' || r.kind === 'tool-result')),
                observations: approximateTokens(observations), workingState: approximateTokens(input.workingState),
                attachedImagePayload: input.images?.reduce((sum, image) => sum + image.dataUrl.length, 0) ?? 0,
              },
              newObservations: observations.length - repeated + working.changes.length,
              repeatedObservations: repeated,
              observationKeys: working.chosen.filter(r => ids.has(r.id)).map(r => ({
                id: r.observationId, hash: observationHash(r.observation!),
                repeated: working.repeatedIds.has(r.id),
              })),
              observationRange: times.length ? [Math.min(...times), Math.max(...times)] : null,
              omittedRecords: working.omitted + page.records.length - history.length + presented.filter(r => !ids.has(r.id)).length,
              originalRecordsAvailable: available,
            }, { cycleId, requestId: networkId });
          }
          recorder?.request(networkId, 'assembled', { model, input, contextBudget: this.options.contextBudget, round, omittedRecordIds: presented.filter(r => !input.records.some(i => i.id === r.id)).map(r => r.id) }, cycleId);
          const requestStarted = Date.now();
          const result = await this.provider.infer(model, input, signal, delta => {
            if (this.closed || signal.aborted) return;
            partial += delta; this.emit('chat:delta', { messageId: responseId, delta });
          });
          recorder?.request(networkId, 'output', result, cycleId);
          this.previousCompletion = result.calls.length ? 'tool-continuation' : result.text ? 'dialogue' : 'silent';
          if (!result.calls.length && ambient) this.attention.complete(this.previousCompletion === 'silent');
          else if (result.text || result.calls.length) this.attention.complete(false);
          this.observationCursor = Math.max(this.observationCursor, ...journal.records.map(r => r.sequence));
          this.previousObservations = new Map([...working.hashes].filter(([slot]) => input.records.some(r => r.kind === "observation" && r.observation && observationSlot(r.observation) === slot)));
          for (const hash of imageHashes) this.recentImageHashes.add(hash);
          while (this.recentImageHashes.size > 128) this.recentImageHashes.delete(this.recentImageHashes.values().next().value!);
          recorder?.event('provider.result', { ...result, latencyMs: Date.now() - requestStarted, outcome: this.previousCompletion, model }, { cycleId, requestId: networkId });
          this.inferenceReceipts.push({ at: Date.now(), model: model.id, requestId: result.requestId, usage: result.usage });
          if (this.inferenceReceipts.length > 32) this.inferenceReceipts.shift();
          signal.throwIfAborted();
          if (round === 0 && nextReviewAt !== null && nextReviewAt <= cycleStarted) {
            const previousAttention = this.attention.durableState();
            if (this.attention.acknowledge(nextReviewAt)) {
              try { await this.archive.writeAttention(this.attention.durableState()); }
              catch (error) { this.attention.restore(previousAttention); throw error; }
            }
          }
          if (result.text) {
            recorder?.event('dialogue', { text: result.text, ambient, responseId }, { cycleId, requestId: networkId });
            if (!result.calls.length) await this.save({ id: responseId, at: Date.now(), kind: 'assistant', text: result.text, inference: { model: model.id, requestId: result.requestId, usage: result.usage } });
            this.emit('chat:done', { message: { id: responseId, role: 'assistant', content: result.text, ts: Date.now(), meta: { provider: 'siwc' } } });
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
            recorder?.event('tool.start', { ...call, round, body: this.options.host?.body(), canonical: this.canonical }, { cycleId, requestId: networkId });
            if (round === 5) {
              recorder?.event('tool.denied', { ...call, reason: 'tool-budget-exhaustion', persisted: false }, { cycleId, requestId: networkId });
              await this.save({ id: randomUUID(), at: Date.now(), kind: 'tool-result', requestId: call.id, receipt: { id: call.id, at: Date.now(), capability: call.name, outcome: 'denied', detail: 'Tool round limit reached; not executed.', dependencies: ['runtime2:archive'] } });
              continue;
            }
            const definition = agentTool(this.archive, { perception: this.perception, attention: this.attention, failedCaptures, refreshState: () => this.refreshState(), mode: ambient ? 'ambient' : 'direct', model, attach: (observationId, dataUrl) => { if (images.length >= 2) return false; images.push({ observationId, dataUrl }); return true; } }, call.name);
            // Parsing is performed inside the existing capability executor so invalid calls earn real failed receipts.
            const execution = await this.executor.execute({ id: call.id, capability: 'runtime2.agent.' + call.name, fingerprint: call.arguments,
              dependencies: ['runtime2:archive'], deadline: Date.now() + 10_000, persist: false }, call.arguments, {
                ...definition, parse: value => { if (typeof value !== 'string' || value.length > 32768) throw Error('Invalid tool arguments'); try { return definition.parse(JSON.parse(value)); } catch { throw Error('Invalid archive tool arguments.'); } },
              }, signal);
            recorder?.event('tool.end', { ...call, execution, durationMs: Date.now() - toolStarted, body: this.options.host?.body(), canonical: this.canonical, attention: this.attention.snapshot() }, { cycleId, requestId: networkId });
            signal.throwIfAborted();
            actualResults.set(call.id, execution.result);
            const references: { observationId: string; modality: string; originalId?: string }[] = [];
            const collect = (value: unknown, depth = 0) => {
              if (!value || typeof value !== 'object' || depth > 20) return;
              if ('modality' in value && 'id' in value && value.modality !== 'window-metadata') { const o = value as import('./contracts').Observation; references.push({ observationId: o.id, modality: o.modality, ...(o.original ? { originalId: o.original.id } : {}) }); return; }
              for (const item of Object.values(value)) collect(item, depth + 1);
            };
            collect(execution.result);
            if (references.length && approximateTokens(execution.result) <= 32_000) {
              this.investigationResults.set(call.id, { result: execution.result, expiresAt: Date.now() + 15 * 60000 });
              while (this.investigationResults.size > 6) this.investigationResults.delete(this.investigationResults.keys().next().value!);
            }
            await this.save({ id: randomUUID(), at: Date.now(), kind: 'tool-result', requestId: call.id, ...execution,
              ...(references.length ? { result: { evidenceReferences: references, detail: 'Original results were supplied during execution. Recover original content with retrieve_evidence; duplicate rich content is not retained in the journal.' } } : {}) });
          }
          if (round === 5) throw Error('Tool round limit reached.');
          if (ambient && this.pendingUser) break;
        }
        await this.archive.reviewState([...suppliedReviews], cycleStarted); await this.refreshState();
        recorder?.event('cycle.end', { durationMs: Date.now() - cycleStarted, suppliedReviews: [...suppliedReviews], canonical: this.canonical, attention: this.attention.snapshot() }, { cycleId });
        this.phase('idle');
      } catch (error) {
        const failure = error as { code?: string; status?: number };
        const outcome = signal.aborted ? 'canceled' : failure?.code === 'response_incomplete' || failure?.code === 'stream_interrupted' ? 'incomplete' : failure?.code === 'invalid_stream' || failure?.code === 'invalid_tool_call' ? 'adapter-failure' : error instanceof Error && error.message === 'Tool round limit reached.' ? 'tool-budget-exhaustion' : 'failure';
        recorder?.event('provider.error', { outcome, code: failure?.code, status: failure?.status, detail: safeFailure(error), durationMs: Date.now() - cycleStarted }, { cycleId });
        if (!this.closed && partial) this.emit('chat:done', { message: { id: responseId, role: 'assistant', content: partial, ts: Date.now(), meta: { provider: 'siwc', interrupted: true } } });
        if (!this.closed) {
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
