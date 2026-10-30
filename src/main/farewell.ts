export class Farewell {
  active = false;
  constructor(private d: { visible(): boolean; prepare(): void; generate(signal: AbortSignal): Promise<string>; fallback(): string; show(text: string): void; depart(): Promise<void>; finish(): void }) {}
  async start() {
    if (this.active) return;
    this.active = true;
    const ctrl = new AbortController();
    let finished = false;
    const finish = () => { if (finished) return; finished = true; ctrl.abort(); this.d.finish(); };
    const watchdog = setTimeout(finish, 8500);
    try {
      this.d.prepare();
      if (!this.d.visible()) return;
      let text = '';
      const deadline = setTimeout(() => ctrl.abort(), 4500);
      try {
        text = await Promise.race([
          this.d.generate(ctrl.signal),
          new Promise<string>(resolve => ctrl.signal.addEventListener('abort', () => resolve(''), { once: true })),
        ]);
      } catch { /* unavailable generation uses local variation */ }
      finally { clearTimeout(deadline); }
      if (finished) return;
      text = cleanFarewell(text) || this.d.fallback();
      this.d.show(text);
      await new Promise(resolve => setTimeout(resolve, Math.min(2300, Math.max(1500, text.length * 27))));
      if (!finished) await this.d.depart();
    } finally { clearTimeout(watchdog); finish(); }
  }
}
export function cleanFarewell(text: string) {
  if (/<action>|<quiet\s*\/>/i.test(text)) return '';
  return text.replace(/<[^>]*>/g, '').replace(/^[\s"“]+|[\s"”]+$/g, '').replace(/\s+/g, ' ').trim().slice(0, 180);
}
