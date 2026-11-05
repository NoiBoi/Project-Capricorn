import type { StateWrite, StateSearch, EvidenceBlob, EvidenceRetention } from './canonicalState';
import type { RecordInput } from './cognitiveContracts';
import path from 'node:path';
import { Worker } from 'node:worker_threads';
import type { Observation } from './contracts';
import { DEFAULT_RETENTION, validateId, validateObservation, validateQuery, type ArchiveQuery, type ArchiveResponse, type Operations, type RetentionPolicy } from './windowFocusArchiveContracts';

export interface ArchiveOptions {
  retention?: RetentionPolicy;
  evidenceRetention?: EvidenceRetention;
  /** Injectable ingestion clock and worker path for deterministic integration tests. */
  now?: () => number;
  workerPath?: string;
  maxPending?: number;
  timeoutMs?: number;
}
export class WindowFocusArchive {
  private worker?: Worker;
  private sequence = 0;
  private pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout>; settled: Promise<unknown> }>();
  private state: 'new' | 'starting' | 'ready' | 'failed' | 'closing' | 'closed' = 'new';
  private failures = 0;
  private lastError?: string;
  private writes = 0;
  private closeTask?: Promise<void>;
  private exited?: Promise<void>;
  private workerThreadId?: number;
  constructor(private profile: string, private options: ArchiveOptions = {}) {}
  get health() { return { state: this.state, degraded: this.failures > 0 || this.state === 'failed', failures: this.failures, lastError: this.lastError, pendingWrites: this.writes, threadId: this.workerThreadId }; }
  private recordFailure(error: unknown) { this.failures++; this.lastError = error instanceof Error ? error.message : String(error); }
  private fail(error: Error) {
    if (this.state !== 'failed') this.recordFailure(error);
    this.state = 'failed';
    for (const entry of this.pending.values()) { clearTimeout(entry.timer); entry.reject(error); }
    this.pending.clear();
    void this.worker?.terminate();
  }
  async initialize() {
    if (this.state !== 'new') throw Error('Archive already initialized or closed');
    this.state = 'starting';
    try {
      this.worker = new Worker(this.options.workerPath ?? path.join(__dirname, 'runtime2', 'windowFocusArchiveWorker.js'));
      this.exited = new Promise(resolve => this.worker!.once('exit', () => resolve()));
      this.worker.on('error', error => this.fail(error instanceof Error ? error : Error(String(error))));
      this.worker.on('exit', code => {
        if (this.pending.size || (code !== 0 && this.state === 'closing') || (this.state !== 'closing' && this.state !== 'closed' && this.state !== 'failed')) this.fail(Error(`Archive worker exited unexpectedly (${code})`));
      });
      this.worker.on('message', (message: ArchiveResponse) => {
        const entry = this.pending.get(message.id);
        if (!entry) return;
        clearTimeout(entry.timer); this.pending.delete(message.id);
        if (message.ok) entry.resolve(message.value); else entry.reject(Error(message.error));
      });
      const ready = await this.request('initialize', { profile: this.profile, retention: this.options.retention ?? DEFAULT_RETENTION, evidenceRetention: this.options.evidenceRetention, now: this.options.now?.() });
      this.workerThreadId = ready.threadId;
      if (this.state === 'starting') this.state = 'ready';
    } catch (error) { this.fail(error instanceof Error ? error : Error(String(error))); await this.exited; throw error; }
  }
  private request<K extends keyof Operations>(op: K, input: Operations[K]['input']): Promise<Operations[K]['output']> {
    if (!this.worker || this.state === 'failed' || this.state === 'closed') return Promise.reject(Error('Archive is unavailable'));
    if (this.pending.size >= (this.options.maxPending ?? 512)) return Promise.reject(Error('Archive request queue is full'));
    const id = ++this.sequence;
    let resolve!: (value: unknown) => void, reject!: (error: Error) => void;
    const task = new Promise<unknown>((yes, no) => { resolve = yes; reject = no; });
    const timer = setTimeout(() => this.fail(Error(`Archive ${op} timed out; persistence is unconfirmed`)), this.options.timeoutMs ?? 15000);
    this.pending.set(id, { resolve, reject, timer, settled: task });
    try { this.worker.postMessage({ id, op, input }); }
    catch (error) { clearTimeout(timer); this.pending.delete(id); reject(error instanceof Error ? error : Error(String(error))); }
    return task as Promise<Operations[K]['output']>;
  }
  async write(observation: Observation) {
    this.writes++;
    try {
      if (this.state !== 'ready') throw Error('Archive is not accepting writes');
      validateObservation(observation);
      return await this.request('write', { observation, now: this.options.now?.() });
    } catch (error) { this.recordFailure(error); throw error; }
    finally { this.writes--; }
  }
  private ready() { if (this.state !== 'ready') throw Error('Archive is not ready'); }
  async recent(query: ArchiveQuery = {}) { this.ready(); return this.request('recent', validateQuery(query)); }
  async get(id: string) { this.ready(); validateId(id); return this.request('get', { id }); }
  async stats() { this.ready(); return this.request('stats', {}); }
  /** Internal bootstrap path; public retrieval remains limited to 100 records. */
  async restore() { this.ready(); return this.request('restore', {}); }
  async conversation(limit = 2000, dialogueOnly = false, observations?: "only" | "exclude") { this.ready(); return this.request('conversation', { limit, dialogueOnly, observations }); }
  async appendConversation(record: RecordInput) { this.ready(); return this.request('appendConversation', record); }
  async maintain() { this.ready(); try { return await this.request('maintain', {}); } catch (error) { this.recordFailure(error); throw error; } }
  async putState(input: StateWrite) { this.ready(); return this.request('putState', input); }
  async readAttention() { this.ready(); return this.request('readAttention', {}); }
  async writeAttention(input: Operations['writeAttention']['input']) { this.ready(); return this.request('writeAttention', input); }
  async scheduledState() { this.ready(); return this.request('scheduledState', {}); }
  async findState(input: StateSearch = {}) { this.ready(); return this.request('findState', input); }
  async reviewState(ids: string[], at: number) { this.ready(); return this.request('reviewState', { ids, at }); }
  async putEvidence(data: Uint8Array, mime: EvidenceBlob['mime'], expiresAt?: number) { this.ready(); return this.request('putEvidence', { data, mime, expiresAt }); }
  async getEvidence(id: string) { this.ready(); validateId(id); return this.request('getEvidence', { id }); }
  async forgetSource(source: 'chrome' | 'screen') { this.ready(); return this.request('forgetSource', { source }); }
  async clearConversation() { this.ready(); return this.request('clearConversation', {}); }
  close(): Promise<void> {
    if (this.closeTask) return this.closeTask;
    const failed = this.state === 'failed';
    this.state = failed ? 'failed' : 'closing';
    this.closeTask = (async () => {
      await Promise.allSettled([...this.pending.values()].map(entry => entry.settled));
      try {
        if (this.worker && this.state !== 'failed') await this.request('close', {});
      } catch (error) { this.fail(error instanceof Error ? error : Error(String(error))); }
      finally {
        // Allow a clean natural exit; bound even a faulty worker's close ACK.
        if (this.worker) {
          const timer = setTimeout(() => this.fail(Error('Archive worker did not exit after close')), 1000);
          try { await this.exited; } finally { clearTimeout(timer); }
        }
        this.state = 'closed';
      }
    })();
    return this.closeTask;
  }
}
