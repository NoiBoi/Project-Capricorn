/** Logical look direction, independent of the art strip's original facing. */
export class FacingDelay {
  private current = 0;
  private candidate = 0;
  private since = 0;
  private changed = -Infinity;
  update(x: number, now: number, frozen = false, reclining = false) {
    if (frozen || Math.abs(x) < .18) { this.candidate = 0; return this.current; }
    const next = Math.sign(x);
    if (next === this.current) { this.candidate = 0; return this.current; }
    if (this.candidate !== next) { this.candidate = next; this.since = now; }
    if (now - this.since >= (reclining ? 280 : 140) && now - this.changed >= (reclining ? 900 : 380)) { this.current = next; this.changed = now; this.candidate = 0; }
    return this.current;
  }
}
