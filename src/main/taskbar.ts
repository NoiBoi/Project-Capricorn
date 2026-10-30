import type { BrowserWindow } from 'electron';
import { createTaskbarWindow, reveal } from './windows';
import type { Logger } from './log';
export type TaskbarCommand = 'open' | 'chat' | 'minimize' | 'intro' | 'settings' | 'quit' | 'normal' | 'explore' | 'sleep';
export class TaskbarControls {
  window: BrowserWindow;
  private disposing = false;
  constructor(preload: string, log: Logger, private d: { minimize(): void; restore(): void; command(c: TaskbarCommand): void }) {
    const win = this.window = createTaskbarWindow(preload, log);
    win.once('ready-to-show', () => this.park());
    // Native window controls affect this panel only; pet actions are explicit buttons.
    win.on('close', event => { if (!this.disposing) { event.preventDefault(); this.park(); } });
  }
  park() { if (this.window.isDestroyed() || this.window.isMinimized()) return; reveal(this.window); this.window.minimize(); }
  show() { if (this.window.isDestroyed()) return; if (this.window.isMinimized()) this.window.restore(); reveal(this.window, true); }
  command(c: TaskbarCommand) {
    if (c === 'minimize') { this.d.minimize(); return; }
    this.d.command(c);
    if (c === 'open' || c === 'chat' || c === 'intro' || c === 'settings') this.park();
  }
  close() { this.disposing = true; if (!this.window.isDestroyed()) this.window.destroy(); }
}
