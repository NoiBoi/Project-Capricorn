import { screen, type BrowserWindow, type Rectangle } from 'electron';
import { createIntroWindow, reveal } from './windows';
import type { IntroState } from '../shared/intro';
import type { Logger } from './log';

/** A bounded visual greeting, independent of character readiness or AI availability. */
export class Opening {
  window: BrowserWindow | null = null;
  active = false;
  private seq = 0;
  private timer: NodeJS.Timeout | null = null;
  constructor(private d: { preload: string; log: Logger; greeting?(): string; begin(): void; end(landed: boolean): void }) {}
  play(pet: Rectangle, still = false, effects = true) {
    this.cancel(); const id = ++this.seq;
    const display = screen.getDisplayMatching(pet).workArea;
    this.active = true; this.d.begin();
    const win = this.window = createIntroWindow(display, this.d.preload, this.d.log);
    win.webContents.once('did-finish-load', () => {
      if (id !== this.seq || !this.active || win.isDestroyed()) return;
      // Windows can constrain the initial size or adjust it when crossing DPI boundaries.
      win.setBounds(display);
      const viewport = win.getContentBounds();
      const state: IntroState = { id, still, effects, greeting: this.d.greeting?.() ?? 'hey, you.', to: { x: pet.x + pet.width / 2 - viewport.x, y: pet.y + pet.height * .34 - viewport.y, size: pet.width * .25 } };
      reveal(win); win.webContents.send('intro:play', state);
    });
    win.webContents.once('render-process-gone', () => this.finish(id, false));
    win.webContents.once('did-fail-load', () => this.finish(id, false));
    win.once('unresponsive', () => this.finish(id, false));
    win.once('closed', () => this.finish(id, false));
    this.timer = setTimeout(() => this.finish(id, false), 7500);
    this.timer.unref?.();
  }
  finish(id: number, landed = true) {
    if (id !== this.seq || !this.active) return;
    this.active = false; if (this.timer) clearTimeout(this.timer); this.timer = null;
    const win = this.window; this.window = null;
    if (win && !win.isDestroyed()) win.destroy();
    this.d.end(landed);
  }
  cancel() { this.finish(this.seq, false); }
}
