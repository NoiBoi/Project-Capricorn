import { screen, type BrowserWindow } from 'electron';
import { createTrailWindow, reveal } from './windows';
import type { Logger } from './log';
export class TeleportTrail {
  windows: BrowserWindow[] = [];
  constructor(private preload: string, private log: Logger) {}
  play(from: { x: number; y: number }, to: { x: number; y: number }) {
    this.close(); if (Math.hypot(to.x - from.x, to.y - from.y) < 45) return;
    for (const display of screen.getAllDisplays()) {
      const b = display.bounds;
      if (Math.max(from.x, to.x) < b.x || Math.min(from.x, to.x) > b.x + b.width || Math.max(from.y, to.y) < b.y || Math.min(from.y, to.y) > b.y + b.height) continue;
      const win = createTrailWindow(b, this.preload, this.log); this.windows.push(win);
      const dispose = () => { if (!win.isDestroyed()) win.destroy(); this.windows = this.windows.filter(w => w !== win); };
      const failsafe = setTimeout(dispose, 2200); failsafe.unref();
      win.webContents.once('did-finish-load', () => {
        if (win.isDestroyed()) return;
        clearTimeout(failsafe); reveal(win);
        win.webContents.send('trail:play', { from: { x: from.x - b.x, y: from.y - b.y }, to: { x: to.x - b.x, y: to.y - b.y } });
        const timer = setTimeout(dispose, 650); timer.unref();
      });
    }
  }
  close() { for (const w of this.windows) if (!w.isDestroyed()) w.destroy(); this.windows = []; }
}
