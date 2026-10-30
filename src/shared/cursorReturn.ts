export class CursorReturn {
  private armed = false;
  private wokeAt = 0;
  private next = 0;
  observe(idleSec: number, now: number, armAfter = 90) {
    if (idleSec >= armAfter) { this.armed = true; this.wokeAt = 0; }
    else if (this.armed && idleSec < 3) { if (!this.wokeAt) this.wokeAt = now; else if (now - this.wokeAt > 5000) this.armed = false; }
    return this.armed && idleSec < 3;
  }
  move(now: number, blocked: boolean) {
    if (!this.armed) return false;
    if (blocked) return false;
    this.armed = false;
    if (now < this.next) return false;
    this.next = now + 300000; return true;
  }
  cancel() { this.armed = false; this.wokeAt = 0; }
}
