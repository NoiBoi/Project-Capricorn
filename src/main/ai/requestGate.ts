import { ProviderError } from './providerError';

export type RequestPurpose = 'reply' | 'memory' | 'ambient';

/** One CLI at a time. Background work yields to an explicit user request. */
export class RequestGate {
  until = 0;
  private tail: Promise<unknown> = Promise.resolve();
  private pending = 0;
  private active: { purpose: RequestPurpose; ctrl: AbortController } | null = null;
  onCooldown?: (until: number) => void;

  limit(ms: number) {
    this.until = Math.max(this.until, Date.now() + ms);
    this.onCooldown?.(this.until);
  }

  async run<T>(purpose: RequestPurpose, signal: AbortSignal, task: (signal: AbortSignal) => Promise<T>): Promise<T> {
    const check = () => {
      if (signal.aborted) throw new ProviderError('Stopped.', 'aborted');
      if (Date.now() < this.until) throw new ProviderError('Codex usage is unavailable for this signed-in account. Generated replies use the same Codex allowance; local controls still work.', 'rate_limit', 429, this.until - Date.now());
    };
    check();
    if (purpose !== 'reply' && this.pending) throw new ProviderError('Background request deferred.', 'aborted');
    if (purpose === 'reply' && this.active?.purpose !== 'reply') this.active?.ctrl.abort();
    const previous = this.tail;
    let release!: () => void;
    this.tail = new Promise<void>(resolve => { release = resolve; });
    this.pending++;
    try {
      await previous;
      check(); // A preceding request may have discovered a rate limit.
      const ctrl = new AbortController();
      const abort = () => ctrl.abort();
      signal.addEventListener('abort', abort, { once: true });
      this.active = { purpose, ctrl };
      try { return await task(ctrl.signal); }
      finally { signal.removeEventListener('abort', abort); this.active = null; }
    } finally { this.pending--; release(); }
  }
}
