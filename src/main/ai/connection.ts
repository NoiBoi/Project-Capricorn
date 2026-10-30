import { EventEmitter } from 'node:events';
import type { ConnectionStatus } from '../../shared/ipc';
import { ProviderError, type LLMProvider } from './providers';
import type { Logger } from '../log';

/**
 * Tracks whether the AI is actually reachable. State only becomes "connected" after a
 * real authenticated API check or a successful reply — never assumed.
 */
export class ConnectionMonitor extends EventEmitter {
  status: ConnectionStatus = { state: 'disconnected', provider: 'none', detail: 'Not checked yet', checkedAt: 0 };
  private timer: NodeJS.Timeout | null = null;
  private checking: Promise<void> | null = null;
  private gen = 0;

  constructor(private make: () => LLMProvider, private keySource: () => ConnectionStatus['keySource'], private log: Logger, private intervalMs = 5 * 60_000) { super(); }

  private set(patch: Partial<ConnectionStatus>) {
    const next = { ...this.status, ...patch, checkedAt: Date.now(), keySource: this.keySource() };
    const changed = next.state !== this.status.state || next.detail !== this.status.detail || next.model !== this.status.model;
    this.status = next;
    if (changed) { this.log.info('connection', { state: next.state, provider: next.provider, model: next.model }); this.emit('changed', next); }
  }

  get connected() { return this.status.state === 'connected'; }

  start() {
    void this.check('startup');
    this.timer = setInterval(() => void this.check('periodic'), this.intervalMs);
    this.timer.unref?.();
  }
  stop() { if (this.timer) clearInterval(this.timer); this.timer = null; }

  /** Re-test now (provider/key changed, network back, user pressed Test). */
  check(reason: string): Promise<void> {
    const gen = ++this.gen;
    const p = this.make();
    if (p.name === 'offline') {
      this.set({ state: 'disconnected', provider: 'offline', model: undefined, usingFallback: false, detail: 'No AI model — offline command mode' });
      return Promise.resolve();
    }
    this.set({ state: 'connecting', provider: p.name, detail: `Connecting (${reason})…` });
    this.checking = p.test().then((r) => {
      if (gen !== this.gen) return; // superseded by a newer check
      if (r.ok) this.set({ state: 'connected', detail: r.detail, latencyMs: r.latencyMs, usingFallback: false });
      else this.set({ state: /reach|network|timed out|ENOTFOUND|fetch failed/i.test(r.detail) ? 'disconnected' : 'error', detail: r.detail });
    }).catch((e) => { if (gen === this.gen) this.set({ state: 'error', detail: String((e as Error).message).slice(0, 200) }); });
    return this.checking;
  }

  /** A real reply streamed successfully. */
  reportSuccess(provider: string, model?: string, usingFallback = false) {
    this.set({ state: 'connected', provider, model, usingFallback, detail: usingFallback ? `Connected via fallback model ${model}` : `Connected${model ? ` · ${model}` : ''}` });
  }
  /** A request failed: network → disconnected; auth/config/model → error; transient → keep state, note it. */
  reportFailure(e: unknown) {
    if (!(e instanceof ProviderError)) { this.set({ state: 'error', detail: String((e as Error)?.message ?? e).slice(0, 200) }); return; }
    if (e.kind === 'aborted') return;
    ++this.gen; // An older login check cannot overwrite a failed real request.
    if (e.kind === 'network' || e.kind === 'timeout') this.set({ state: 'disconnected', detail: e.message });
    else if (e.kind === 'auth' || e.kind === 'config' || e.kind === 'model' || e.kind === 'bad_request') this.set({ state: 'error', detail: e.message });
    else if (e.kind === 'rate_limit') this.set({ state: 'error', detail: `${e.message}${e.retryAfterMs ? ` Retry in about ${Math.ceil(e.retryAfterMs / 1000)} seconds.` : ''}` });
    else this.set({ detail: e.message });
  }
}
