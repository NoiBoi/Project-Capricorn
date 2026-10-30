/** Supplied evidence is a dependency, not a claim that the model cited it.
 * Without trustworthy attribution, never promote a possibly derived reply. */
export class RequestEvidence {
  private sources = new Set<string>();
  reset() { this.sources.clear(); }
  include(sources: Iterable<string>) { for (const source of sources) this.sources.add(source); }
  snapshot() { return [...this.sources].sort(); }
  get derived() { return this.sources.size > 0; }
}

/** Revocation cancels pending output before removing dependent current state.
 * Legacy caches without dependency IDs may be cleared by the host adapter. */
export function revokeDependencies(source: string | undefined, host: {
  cancel(): void; invalidate(source?: string): void;
}) { host.cancel(); host.invalidate(source); }
