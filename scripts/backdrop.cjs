// A clean stand-in desktop for recordings: one image over the primary display's work area, below every
// other window, never focused, not in the taskbar. Hides the real desktop icons. Run with the project's
// Electron:  electron scripts/backdrop.cjs <image>   — create <image>.stop to close it.
const { app, BrowserWindow, screen } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const image = path.resolve(process.argv[process.argv.length - 1]);
app.whenReady().then(async () => {
  const { workArea } = screen.getPrimaryDisplay();
  const page = path.join(os.tmpdir(), `capri-backdrop-${process.pid}.html`);
  fs.writeFileSync(page, `<!doctype html><meta charset="utf-8"><style>html,body{margin:0;height:100%;background:#000 url("${image.replace(/\\/g, '/')}") center/cover no-repeat}body::after{content:'';position:fixed;inset:0;background:rgba(6,4,10,.35)}</style>`);
  const win = new BrowserWindow({
    ...workArea, frame: false, focusable: false, skipTaskbar: true, resizable: false, movable: false,
    show: false, hasShadow: false, webPreferences: { backgroundThrottling: false },
  });
  await win.loadFile(page);
  win.showInactive();
  win.moveTop(); // above the minimised desktop; everything opened later goes above it
  process.stdout.write('BACKDROP_READY\n');
  const stop = image + '.stop';
  fs.rmSync(stop, { force: true });
  setInterval(() => { if (fs.existsSync(stop)) { fs.rmSync(stop, { force: true }); fs.rmSync(page, { force: true }); app.exit(0); } }, 150);
});
