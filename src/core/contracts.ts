/** Domain contracts. No host, renderer, transport or provider imports belong here. */
export interface Evidence { id: string; source: string; revision: number; at: number; expiresAt?: number; kind: 'user' | 'observation' | 'derived'; dependencies: string[] }
export interface DomainEvent<T = unknown> { id: string; type: string; at: number; evidence: Evidence[]; value: T }
export interface ContextPacket { text: string; evidence: Evidence[]; messages?: { role: 'system' | 'user' | 'assistant'; content: string }[] }
export interface ContextRetrieval { retrieve(query: string, signal: AbortSignal): Promise<ContextPacket> }
export interface IdentityMemory { retrieve(query: string): ContextPacket; invalidate(source: string): void }
export type Intention = import('./agency').DurableIntention;
export interface CognitiveState { revision: number; intentions: Intention[]; attention: string[] }
export interface ModelSession { id: string; revision: number; dependencies: string[] }
export interface ModelSessions { respond(session: ModelSession, context: ContextPacket, signal: AbortSignal): AsyncIterable<string>; invalidate(source: string): void }
export type CapabilityRequest = import('./capabilities').CapabilityCall;
export interface ExecutionReceipt { id: string; requestId: string; at: number; outcome: import('./capabilities').CapabilityOutcome; detail: string; dependencies: string[] }
export type CapabilityExecutor = import('./capabilities').TypedCapabilityExecutor;
export interface Clock { now(): number }
export interface Scheduler extends Clock { schedule(deadline: number, run: () => void): () => void }
export interface Permissions { revision: number; allows(source: string, use: 'collect' | 'context' | 'retain' | 'learn'): boolean; revoke(source: string): void }
export interface ExpressionOutput { express(expression: { text?: string; gesture?: string; receipt?: ExecutionReceipt }, signal: AbortSignal): Promise<boolean> }
export type RecordKind = 'observation' | 'world' | 'cognitive' | 'intention' | 'receipt' | 'session' | 'memory' | 'attention' | 'checkpoint';
export interface StateRecord { kind: RecordKind; id: string; revision: number; at: number; value: unknown; dependencies: string[] }
export interface StatePersistence {
  transaction<T>(run: () => T): T;
  put(record: StateRecord): boolean;
  get(kind: RecordKind, id: string): StateRecord | undefined;
  remove(kind: RecordKind, id: string): void;
  invalidate(source: string): string[];
}
export interface Checkpoints { load<T>(id: string): T | undefined; save<T>(id: string, value: T): void; removeCheckpoint(id: string): void }
