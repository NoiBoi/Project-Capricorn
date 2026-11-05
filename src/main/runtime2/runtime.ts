import { CognitiveLoop, type LoopOptions } from './cognitiveLoop';
import type { ChromePage } from '../life/chrome';
import type { z } from 'zod';
import type { CognitiveProvider } from './cognitiveContracts';
import { WindowFocusArchive, type ArchiveOptions } from './windowFocusArchive';
import type { ArchiveQuery } from './windowFocusArchiveContracts';
import { randomUUID } from 'node:crypto';
import type { ActionContext } from '../actions/registry';
import { TypedCapabilityExecutor, type CapabilityDefinition } from '../../core/capabilities';
import type { ConversationItem, LogicalConversation, Observation, ToolRequest, ToolExecution } from './contracts';
import { interactionObservation } from './interactionContext';

/** Isolated observation archive with optional provider-independent cognition. */
export class Runtime2 {
  private state: 'new' | 'initializing' | 'active' | 'stopping' | 'stopped' = 'new';
  private conversation: LogicalConversation;
  private controller = new AbortController();
  private unsubscribe?: () => void;
  private revocation: Promise<void> = Promise.resolve();
  private revoking = false;
  private pendingSources = new Set<Promise<unknown>>();
  private pending = new Set<Promise<ToolExecution>>();
  private shutdownTask?: Promise<void>;
  private archive: WindowFocusArchive;
  private cognitive?: CognitiveLoop;
  private maintenance?: ReturnType<typeof setInterval>;
  private initialization?: Promise<void>;
  private observationPaused = false;
  private daily?: LoopOptions['daily'];
  private diagnosticCapture?: AbortController;
  constructor(private actions: Pick<ActionContext, 'executor'>, conversationId: string, profile: string, archiveOptions: ArchiveOptions = {}, cognition?: { provider: CognitiveProvider; options?: LoopOptions }) {
    if (!(actions.executor instanceof TypedCapabilityExecutor)) throw Error('Runtime 2 requires the existing capability executor.');
    this.archive = new WindowFocusArchive(profile, archiveOptions);
    this.daily = cognition?.options?.daily;
    if (cognition) this.cognitive = new CognitiveLoop(this.archive, cognition.provider, actions.executor!, cognition.options);
    this.conversation = { id: conversationId, items: [], evictedItems: 0 };
  }
  initialize(subscribe: (listener: (observation: Observation) => void) => () => void): Promise<void> {
    if (this.state !== 'new') throw Error('Runtime already initialized or stopped.');
    this.state = 'initializing';
    this.initialization = (async () => {
      try {
        await this.archive.initialize();
        const observations = await this.archive.restore();
        if (this.state !== 'initializing') return;
        await this.cognitive?.initialize();
        if (this.state !== 'initializing') return;
        if (this.cognitive) this.conversation.id = this.cognitive.id;
        for (const observation of observations) this.append({ id: observation.id, at: observation.at, kind: 'observation', observation });
        this.state = 'active';
        this.maintenance = setInterval(() => { void this.archive.maintain().catch(() => {}); }, 60000); this.maintenance.unref();
        this.unsubscribe = subscribe(observation => {
          if (this.state !== 'active' || this.revoking || this.observationPaused || this.daily?.paused) return;
          const copy = structuredClone(observation);
          if (this.cognitive?.host && !this.cognitive?.host!.allowed('collect', copy)) return;
          this.append({ id: copy.id, at: copy.at, kind: 'observation', observation: copy });
          // write() snapshots into the worker message synchronously. Failures are
          // counted by the archive and remain visible through archiveHealth.
          this.daily?.activity();
          const perception = this.cognitive?.perception;
          void (perception ? perception.observe(copy) : this.archive.write(copy).then(result => {
            if (result.inserted && this.state === 'active') this.cognitive?.notifyObservation();
          })).catch(() => { this.daily?.recorder.event('observation.failed', { observationId: copy.id, source: copy.source }); });
        });
      } catch (error) {
        if (this.state !== 'stopping') this.state = 'stopped';
        this.controller.abort();
        await this.archive.close();
        throw error;
      }
    })();
    return this.initialization;
  }
  get attention() { return this.cognitive?.attention; }
  get perception() { return this.cognitive?.perception; }
  get collecting() { return this.state === 'active' && !this.revoking && !this.observationPaused && !this.daily?.paused; }
  async whenSettled() { let barrier: Promise<void>; do { barrier = this.revocation; await barrier; } while (barrier !== this.revocation); }
  async acceptPage(page: z.infer<typeof ChromePage>, intake: 'extension' | 'controlled-test' = 'controlled-test') {
    await this.whenSettled();
    if (!this.collecting || !this.cognitive?.perception) throw Error('Runtime is not accepting pages.');
    this.daily?.activity();
    const task = this.cognitive.perception.page(page, intake); this.pendingSources.add(task);
    void task.then(() => this.pendingSources.delete(task), () => this.pendingSources.delete(task)); return task;
  }
  revoke(source: 'screen' | 'chrome') {
    // Stop immediately; no in-flight protected results may be recorded after revocation.
    this.daily?.pause();
    void this.daily?.recorder.stop(this.daily.status.usage, 'privacy-revoked').catch(() => {});
    this.revoking = true;
    const stopped = this.cognitive?.quiesce(); this.cognitive?.perception?.clear(); this.conversation.items = [];
    const task = this.revocation.then(async () => {
      await stopped; await Promise.allSettled([...this.pendingSources]); await this.archive.forgetSource(source);
      this.cognitive?.attention.restore({ paused: false });
      if (this.cognitive?.host && !this.cognitive.host.allowed('conversation')) await this.archive.clearConversation();
      await this.cognitive?.refreshState();
    });
    this.revocation = task;
    void task.then(() => { if (this.revocation === task) { this.revoking = false; this.cognitive?.resumeAmbient(); } }, () => { /* Fail closed until storage/privacy recovery. */ });
    return task;
  }
  get chatState() { return this.cognitive?.state ?? { phase: 'idle' as const, busy: false }; }
  async send(text: string, options: {viaVoice?: boolean} = {}) { await this.whenSettled(); if (!this.cognitive || this.state !== 'active') throw Error('Runtime 2 conversation is unavailable.'); return this.cognitive.send(text,options); }
  async observeInteraction(event: import('./contracts').UserInteraction, target?: {handle:string;title:string}) {
    if (!this.collecting || !this.perception) return;
    const observation=interactionObservation(event,target);
    if (!this.cognitive?.host?.allowed('collect',observation) || !this.cognitive.host.allowed('retain',observation)) {
      this.daily?.recorder.event('interaction.admission',{kind:event.kind,accepted:false,reason:'privacy'}); return;
    }
    const task=this.perception.observe(observation);this.pendingSources.add(task);
    try {await task;this.daily?.recorder.event('interaction.admission',{kind:event.kind,accepted:true,observationId:observation.id});return observation.id;}
    finally {this.pendingSources.delete(task);}
  }
  chatHistory(limit = 200) { return this.cognitive?.history(limit) ?? Promise.resolve([]); }
  environment(paused: boolean) { this.cognitive?.environment(paused); }
  async pauseDaily() { this.observationPaused = true; this.daily?.pause(); this.diagnosticCapture?.abort(); await this.cognitive?.quiesce(); this.perception?.clear(); }
  async checkCapture(handle: string) {
    if (!this.collecting || !this.perception || this.diagnosticCapture) throw Error('Observation is paused or a capture check is already running.');
    const controller = this.diagnosticCapture = new AbortController();
    const task = this.perception.inspect(handle, true, 'direct', AbortSignal.any([controller.signal, AbortSignal.timeout(10000)]));
    this.pendingSources.add(task);
    try { return await task; } finally { this.pendingSources.delete(task); if (this.diagnosticCapture === controller) this.diagnosticCapture = undefined; }
  }
  resumeDaily() { this.daily?.resume(); this.observationPaused = false; this.cognitive?.resumeAmbient(); }
  async stopDaily() { await this.pauseDaily(); await Promise.allSettled([...this.pendingSources]); await this.daily?.stop(); }
  async startDaily(metadata: Record<string, unknown>) {
    await this.pauseDaily(); await Promise.allSettled([...this.pendingSources]);
    const baseline = await this.cognitive?.diagnosticBaseline(process.env.CAPRI_V2_NORMAL_ATTENTION === '1');
    await this.daily?.start({ ...metadata, baseline });
    this.daily?.recorder.event('state.restored', { ...baseline, state: await this.archive.findState({ limit: 50 }), scope: '50 most recent state records; operations and working context record subsequent changes' });
    this.observationPaused = false; this.cognitive?.resumeAmbient();
    return baseline;
  }
  stopChat() { this.cognitive?.stop(); }
  resumeChat() { this.cognitive?.resume(); }
  clearChat() { return this.cognitive?.clear(); }
  get archiveHealth() { return this.archive.health; }
  recentObservations(query: ArchiveQuery = {}) { return this.archive.recent(query); }
  observationById(id: string) { return this.archive.get(id); }
  archiveStatistics() { return this.archive.stats(); }
  get status() { return this.state; }
  private append(item: ConversationItem) {
    this.conversation.items.push(item);
    // The archive retains history independently of this working context window.
    if (this.conversation.items.length > 256) { this.conversation.items.shift(); this.conversation.evictedItems++; }
  }
  snapshot(): LogicalConversation { return structuredClone(this.conversation); }
  execute<I, O>(request: ToolRequest, definition: CapabilityDefinition<I, O>): Promise<ToolExecution> {
    if (this.state !== 'active') return Promise.reject(Error('Runtime is not active.'));
    const task = this.actions.executor!.execute(request.call, request.arguments, definition, this.controller.signal).then(value => {
      const execution: ToolExecution = { requestId: request.call.id, ...value };
      // The executor settles its own receipt; a stopped runtime never accepts late state writes.
      if (this.state === 'active') this.append({ id: randomUUID(), at: value.receipt.at, kind: 'tool-result', ...execution });
      return execution;
    });
    this.pending.add(task);
    void task.then(() => this.pending.delete(task), () => this.pending.delete(task));
    return task;
  }
  shutdown(): Promise<void> {
    if (this.shutdownTask) return this.shutdownTask;
    this.state = 'stopping'; clearInterval(this.maintenance);
    this.controller.abort();
    this.unsubscribe?.(); this.unsubscribe = undefined;
    this.shutdownTask = (async () => {
      await this.initialization?.catch(() => {});
      await this.revocation.catch(() => {});
      await this.cognitive?.shutdown();
      await Promise.allSettled([...this.pendingSources]);
      await Promise.allSettled([...this.pending]);
      await this.daily?.stop('shutdown').catch(() => {});
      await this.archive.close();
      this.state = 'stopped';
    })();
    return this.shutdownTask;
  }
}
