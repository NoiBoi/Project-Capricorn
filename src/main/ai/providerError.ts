export class ProviderError extends Error {
  constructor(message: string, readonly kind: 'auth' | 'rate_limit' | 'network' | 'timeout' | 'server' | 'bad_request' | 'aborted' | 'config' | 'model', readonly status?: number, readonly retryAfterMs?: number) {
    super(message);
  }
  get retryable() { return this.kind === 'rate_limit' || this.kind === 'server' || this.kind === 'network'; }
}

