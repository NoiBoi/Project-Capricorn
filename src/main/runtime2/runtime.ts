import { WindowFocusArchive, type ArchiveOptions } from './windowFocusArchive';
import type { ArchiveQuery } from './windowFocusArchiveContracts';
import { randomUUID } from 'node:crypto';
import type { ActionContext } from '../actions/registry';
import { TypedCapabilityExecutor, type CapabilityDefinition } from '../../core/capabilities';
import type { ConversationItem, LogicalConversation, Observation, ToolRequest, ToolExecution } from './contracts';

/** Observation chronology backed by an isolated worker-owned archive; no cognition. */
export class Runtime2 {
  private state: 'new' | 'initializing' | 'active' | 'stopping' | 'stopped' = 'new';
  private conversation: LogicalConversation;
  private controller = new AbortController();
  private unsubscribe?: () => void;
  private pending = new Set<Promise<ToolExecution>>();
  private shutdownTask?: Promise<void>;
  private archive: WindowFocusArchive;
  private initialization?: Promise<void>;
  constructor(private actions: Pick<ActionContext, 'executor'>, conversationId: string, profile: string, archiveOptions: ArchiveOptions = {}) {
    if (!(actions.executor instanceof TypedCapabilityExecutor)) throw Error('Runtime 2 requires the existing capability executor.');
    this.archive = new WindowFocusArchive(profile, archiveOptions);
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
        for (const observation of observations) this.append({ id: observation.id, at: observation.at, kind: 'observation', observation });
        this.state = 'active';
        this.unsubscribe = subscribe(observation => {
          if (this.state !== 'active') return;
          const copy = structuredClone(observation);
          this.append({ id: copy.id, at: copy.at, kind: 'observation', observation: copy });
          // write() snapshots into the worker message synchronously. Failures are
          // counted by the archive and remain visible through archiveHealth.
          void this.archive.write(copy).catch(() => {});
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
    this.state = 'stopping';
    this.controller.abort();
    this.unsubscribe?.(); this.unsubscribe = undefined;
    this.shutdownTask = (async () => {
      await this.initialization?.catch(() => {});
      await Promise.allSettled([...this.pending]);
      await this.archive.close();
      this.state = 'stopped';
    })();
    return this.shutdownTask;
  }
}
