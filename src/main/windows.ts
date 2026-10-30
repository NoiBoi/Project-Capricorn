import { FRAME_SIZE } from '../shared/framing';
import path from 'node:path';
import { app, BrowserWindow, screen, shell, type Rectangle } from 'electron';
import type { Settings } from '../shared/settings';
import { clampToDisplays, restorePosition, type DisplayLike } from './desktop/displays';
import { leftButtonDown } from './desktop/win32';
import type { Logger } from './log';

/** Test-only: render windows off-screen so automated runs never appear on the user's desktop. */
export const OFFSCREEN = process.env.CAPRI_TEST === '1' && process.env.CAPRI_OFFSCREEN === '1';

/** Show a window — in off-screen test mode only mark it logically shown (rendering continues off-screen). */
export function reveal(win: BrowserWindow, focus = false) {
  (win as unknown as { capriShown: boolean }).capriShown = true;
  if (OFFSCREEN) return;
  if (focus) win.show(); else win.showInactive();
}
export function conceal(win: BrowserWindow) {
  (win as unknown as { capriShown: boolean }).capriShown = false;
  win.hide();
}
export const shown = (win: BrowserWindow | null | undefined) => !!win && !win.isDestroyed() && (OFFSCREEN ? (win as unknown as { capriShown?: boolean }).capriShown === true : win.isVisible());
const RENDERER_DIR = path.join(__dirname, '..', 'renderer');

/** Window size: the model's own framing (every pose and effect fits), times the user's scale. */
export function characterSize(scale: number) {
  // capture harness only: oversize the window for high-resolution trailer close-ups
  if (process.env.CAPRI_TEST === '1' && process.env.CAPRI_CAPTURE_SCALE) scale = Number(process.env.CAPRI_CAPTURE_SCALE) || scale;
  return { width: Math.round(FRAME_SIZE.width * scale), height: Math.round(FRAME_SIZE.height * scale) };
}

export function displaysNow(): DisplayLike[] {
  return screen.getAllDisplays().map((d) => ({ id: d.id, workArea: d.workArea, bounds: d.bounds, scaleFactor: d.scaleFactor }));
}

/** Common hardening for every window we create. */
function harden(win: BrowserWindow, log: Logger) {
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith('file://')) { e.preventDefault(); log.warn('blocked navigation', { url }); }
  });
  win.webContents.on('will-attach-webview', (e) => e.preventDefault());
}

export function createCharacterWindow(s: Settings, preload: string, log: Logger): BrowserWindow {
  const size = characterSize(s.character.scale);
  const pos = restorePosition(s.character.position, size, displaysNow(), screen.getPrimaryDisplay().id);
  const win = new BrowserWindow({
    ...pos,
    transparent: true,
    backgroundColor: '#00000000',
    frame: false,
    resizable: false,
    movable: true,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    hasShadow: false,
    skipTaskbar: true,
    focusable: false, // never steals keyboard focus
    show: false,
    title: 'Capri',
    icon: capriIconPath(),
    alwaysOnTop: s.character.alwaysOnTop,
    webPreferences: {
      offscreen: OFFSCREEN,
      preload,
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      spellcheck: false,
      backgroundThrottling: false,
    },
  });
  if (s.character.alwaysOnTop) win.setAlwaysOnTop(true, 'floating');
  win.setIgnoreMouseEvents(true, { forward: true });
  win.setOpacity(s.character.opacity);
  harden(win, log);
  void win.loadFile(path.join(RENDERER_DIR, 'character.html'));
  return win;
}

export function createPanelWindow(near: Rectangle, preload: string, log: Logger, tab?: string): BrowserWindow {
  const display = screen.getDisplayMatching(near).workArea;
  const size = { width: Math.min(tab === 'developer' ? 1060 : 880, display.width), height: Math.min(780, display.height) };
  // prefer the left side of the character, else the right
  let x = near.x - size.width - 8;
  if (x < display.x) x = near.x + near.width + 8;
  const y = Math.min(Math.max(display.y, near.y + near.height - size.height), display.y + display.height - size.height);
  const r = { x: Math.round(Math.max(display.x, Math.min(x, display.x + display.width - size.width))), y: Math.round(y), ...size };
  const win = new BrowserWindow({
    ...r,
    minWidth: Math.min(620, display.width),
    minHeight: Math.min(480, display.height),
    frame: true,
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#111017', symbolColor: '#f6f0fa', height: 48 },
    minimizable: true,
    maximizable: true,
    backgroundColor: '#111017',
    show: false,
    title: tab === 'developer' ? 'Capri - Developer' : 'Capri - Companion',
    icon: capriIconPath(),
    alwaysOnTop: false,
    webPreferences: { offscreen: OFFSCREEN, preload, contextIsolation: true, sandbox: true, nodeIntegration: false, spellcheck: true },
  });
  harden(win, log);
  void win.loadFile(path.join(RENDERER_DIR, 'panel.html'), tab ? { hash: tab } : undefined).catch(error => log.warn('panel load failed', { error }));
  win.once('ready-to-show', () => reveal(win, true));
  return win;
}

/** Interactive attached bubble; showInactive avoids stealing focus until a real user click. */
export function createBubbleWindow(preload: string, log: Logger): BrowserWindow {
  const win = new BrowserWindow({ width: 340, height: 170, frame: false, transparent: true, backgroundColor: '#00000000',
    resizable: false, minimizable: false, maximizable: false, fullscreenable: false, hasShadow: false,
    skipTaskbar: true, focusable: true, show: false, alwaysOnTop: true, title: 'Capri bubble',
    webPreferences: { offscreen: OFFSCREEN, preload, contextIsolation: true, sandbox: true, nodeIntegration: false, spellcheck: true, backgroundThrottling: false } });
  win.setAlwaysOnTop(true, 'floating');
  harden(win, log);
  void win.loadFile(path.join(RENDERER_DIR, 'bubble.html'));
  return win;
}

export const capriIconPath = () => app.isPackaged ? path.join(process.resourcesPath, 'icon.ico') : path.join(RENDERER_DIR, 'capri', 'mochiiwuff', 'icon.ico');
export function createTaskbarWindow(preload: string, log: Logger): BrowserWindow {
  const win = new BrowserWindow({ width: 420, height: 670, resizable: false, maximizable: false,
    show: false, title: 'Capri', icon: capriIconPath(), backgroundColor: '#14101c', autoHideMenuBar: true,
    webPreferences: { offscreen: OFFSCREEN, preload, contextIsolation: true, sandbox: true, nodeIntegration: false } });
  if (process.platform === 'win32') win.setAppDetails({ appId: 'dev.capri.buddy', appIconPath: capriIconPath(), appIconIndex: 0, relaunchDisplayName: 'Capri', ...(app.isPackaged ? { relaunchCommand: `"${process.execPath}" --open-capri` } : {}) });
  harden(win, log);
  void win.loadFile(path.join(RENDERER_DIR, 'taskbar.html')).catch(error => log.warn('taskbar controls failed to load', { error }));
  return win;
}

export function createIntroWindow(bounds: Rectangle, preload: string, log: Logger): BrowserWindow {
  const win = new BrowserWindow({ ...bounds, frame: false, transparent: true, backgroundColor: '#00000000',
    resizable: false, movable: false, minimizable: false, maximizable: false, fullscreenable: false,
    hasShadow: false, skipTaskbar: true, focusable: false, show: false, alwaysOnTop: true, title: 'Capri opening',
    webPreferences: { offscreen: OFFSCREEN, preload, contextIsolation: true, sandbox: true, nodeIntegration: false, backgroundThrottling: false } });
  win.setAlwaysOnTop(true, 'floating'); win.setIgnoreMouseEvents(true);
  harden(win, log);
  void win.loadFile(path.join(RENDERER_DIR, 'intro.html')).catch(error => log.warn('opening failed to load', { error }));
  return win;
}
export function createTheatreWindow(bounds: Rectangle, preload: string, log: Logger): BrowserWindow {
  const win = new BrowserWindow({ ...bounds, frame: false, transparent: true, backgroundColor: '#00000000', show: false, focusable: false, skipTaskbar: true, hasShadow: false, resizable: false, movable: false, minimizable: false, maximizable: false, fullscreenable: false, title: 'Capri scene', webPreferences: { offscreen: OFFSCREEN, preload, contextIsolation: true, sandbox: true, nodeIntegration: false, backgroundThrottling: false } });
  win.setAlwaysOnTop(true, 'floating'); win.setIgnoreMouseEvents(true); harden(win, log);
  void win.loadFile(path.join(RENDERER_DIR, 'theatre.html')).catch(error => log.debug('scene unavailable', { error })); return win;
}
export function createTrailWindow(bounds: Rectangle, preload: string, log: Logger): BrowserWindow {
  const win = new BrowserWindow({ ...bounds, frame: false, transparent: true, backgroundColor: '#00000000', show: false, focusable: false, skipTaskbar: true, hasShadow: false, resizable: false, movable: false, minimizable: false, fullscreenable: false, webPreferences: { offscreen: OFFSCREEN, preload, contextIsolation: true, sandbox: true, nodeIntegration: false, backgroundThrottling: false } });
  win.setAlwaysOnTop(true, 'floating'); win.setIgnoreMouseEvents(true); harden(win, log);
  void win.loadFile(path.join(RENDERER_DIR, 'trail.html')).catch(error => log.debug('teleport trail unavailable', { error })); return win;
}

/**
 * Drag the character window with the cursor. Main-process driven (works with
 * focusable:false and across monitors with different DPI). Ends on mouseup or,
 * as a safety net, when the physical button is released outside the window.
 */
export class DragController {
  private timer: NodeJS.Timeout | null = null;
  private offset = { x: 0, y: 0 };
  private start = { x: 0, y: 0 };
  moved = false;
  /** Release velocity in DIP/s (from the last ~100 ms of the drag), for throwing her. */
  velocity = { x: 0, y: 0 };
  private samples: { t: number; x: number; y: number }[] = [];
  constructor(private win: () => BrowserWindow | null, private size: () => { width: number; height: number }, private onEnd: (moved: boolean) => void, private onLift?: () => void,
    private input={cursor:()=>screen.getCursorScreenPoint(),down:()=>leftButtonDown()}) {}
  begin() {
    const w = this.win();
    if (!w || this.timer) return;
    const c = this.input.cursor();
    const [wx, wy] = w.getPosition();
    this.offset = { x: c.x - wx, y: c.y - wy };
    this.start = c;
    this.moved = false;
    this.samples = [];
    this.velocity = { x: 0, y: 0 };
    this.timer = setInterval(() => this.step(), 16);
  }
  private step() {
    const w = this.win();
    if (!w || w.isDestroyed()) return this.end();
    if (this.input.down() === false) return this.end();
    const c = this.input.cursor();
    const now = Date.now();
    this.samples.push({ t: now, x: c.x, y: c.y });
    while (this.samples.length > 2 && now - this.samples[0].t > 110) this.samples.shift();
    if (!this.moved && Math.hypot(c.x - this.start.x, c.y - this.start.y) < 4) return;
    if (!this.moved) this.onLift?.();
    this.moved = true;
    w.setBounds({ x: c.x - this.offset.x, y: c.y - this.offset.y, ...this.size() }); // fixed size: never read back
  }
  end() {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
    const a = this.samples[0], b = this.samples[this.samples.length - 1];
    const dt = a && b ? (b.t - a.t) / 1000 : 0;
    this.velocity = dt > 0.02 ? { x: (b.x - a.x) / dt, y: (b.y - a.y) / dt } : { x: 0, y: 0 };
    const w = this.win();
    if (w && !w.isDestroyed() && this.moved) {
      const b = w.getBounds();
      w.setBounds(clampToDisplays({ x: b.x, y: b.y, ...this.size() }, displaysNow()));
    }
    this.onEnd(this.moved);
  }
  get active() { return !!this.timer; }
}
