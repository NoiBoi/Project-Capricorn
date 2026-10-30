/**
 * Mouth-opening envelope. Two sources:
 *  - amplitude (WebAudio analyser) when we have the actual audio, or
 *  - synthetic syllable rhythm driven by TTS word-boundary events when the OS voice
 *    plays audio we can't tap (Windows speechSynthesis).
 */
export class LipSync {
  private level = 0;
  private boundaryKick = 0;
  private t = 0;
  private active = false;
  private amp: (() => number) | null = null;
  private seed = 0;

  start(amplitudeSource?: () => number) { this.active = true; this.amp = amplitudeSource ?? null; this.seed = Math.random() * 10; }
  stop() { this.active = false; this.amp = null; }
  /** Word boundary from TTS: a quick open-close pulse. */
  boundary(wordLength = 4) { this.boundaryKick = Math.min(1, 0.55 + wordLength * 0.05); }

  update(dt: number): number {
    this.t += dt;
    let target = 0;
    if (this.active) {
      if (this.amp) {
        target = Math.min(1, Math.max(0, (this.amp() - 0.02) * 6));
      } else {
        // ~5–7 syllables/s with irregularity so it doesn't look mechanical
        const syll = Math.abs(Math.sin(this.t * 13 + Math.sin(this.t * 3.1 + this.seed) * 1.8));
        target = 0.18 + 0.55 * syll * (0.7 + 0.3 * Math.sin(this.t * 1.7 + this.seed)) + this.boundaryKick * 0.35;
      }
    }
    this.boundaryKick = Math.max(0, this.boundaryKick - dt * 5);
    // fast attack, slower release
    const k = target > this.level ? 28 : 14;
    this.level += (target - this.level) * Math.min(1, k * dt);
    return this.level;
  }
}
