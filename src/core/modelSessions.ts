/** Provider-neutral lifecycle. Provider history is a cache of application records. */
export type SessionScope = 'primary' | 'project' | 'background' | 'private' | 'source';
export interface SessionUsage { input: number; cached: number; output: number; context: number; latencyMs: number }
export interface SessionHandle { id: string; provider: string; model: string; scope: SessionScope; dependencies: string[]; turns: number; createdAt?: number; usage?: SessionUsage }
export interface SessionStart { model: string; instructions: string; scope: SessionScope; dependencies: string[] }
export interface SessionInput { text: string; state: string; signal: AbortSignal; timeoutMs: number }
export interface PersistentSessions {
  capabilities(): Promise<ReadonlySet<string>>;
  start(options: SessionStart): Promise<SessionHandle>;
  resume(handle: SessionHandle, instructions: string): Promise<void>;
  fork(handle: SessionHandle): Promise<SessionHandle>;
  respond(handle: SessionHandle, input: SessionInput): AsyncIterable<string>;
  compact(handle: SessionHandle): Promise<void>;
  invalidate(handle: SessionHandle): Promise<'deleted' | 'invalidated'>;
  close(): void;
}
