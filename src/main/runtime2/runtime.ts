import { randomUUID } from 'node:crypto';
import type { ActionContext } from '../actions/registry';
import { TypedCapabilityExecutor, type CapabilityDefinition } from '../../core/capabilities';
import type { ConversationItem, LogicalConversation, Observation, ToolRequest, ToolExecution } from './contracts';

/** Phase 1 is intentionally in-memory: no inference, archive, memory DB or scheduler. */
export class Runtime2 {
  private state: 'new' | 'active' | 'stopping' | 'stopped' = 'new';
  private conversation: LogicalConversation;
  private controller = new AbortController();
  private unsubscribe?: () => void;
  private pending = new Set<Promise<ToolExecution>>();
  private shutdownTask?: Promise<void>;
  constructor(private actions: Pick<ActionContext, 'executor'>, conversationId: string = randomUUID()) {
    if (!(actions.executor instanceof TypedCapabilityExecutor)) throw Error('Runtime 2 requires the existing capability executor.');
    this.conversation = { id: conversationId, items: [], evictedItems: 0 };
  }
  initialize(subscribe: (listener: (observation: Observation) => void) => () => void) {
    if (this.state !== 'new') throw Error('Runtime already initialized or stopped.');
    this.state = 'active';
    try { this.unsubscribe = subscribe(observation => {
      if (this.state !== 'active') return;
      this.append({ id: observation.id, at: observation.at, kind: 'observation', observation: structuredClone(observation) });
    }); } catch (error) { this.state = 'stopped'; this.controller.abort(); throw error; }
  }
  get status() { return this.state; }
  private append(item: ConversationItem) {
    this.conversation.items.push(item);
    // Bounded development buffer, explicitly not the future experience archive.
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
    this.shutdownTask = Promise.allSettled([...this.pending]).then(() => { this.state = 'stopped'; });
    return this.shutdownTask;
  }
}
