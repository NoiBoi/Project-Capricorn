// Full-screen recorder on Chromium's desktop capture (DXGI duplication: a steady 30 fps at 1080p,
// where GDI grabbing manages ~12). Run with the project's Electron:
//   electron scripts/screen-recorder.cjs <out.webm>
// Prints "REC_START <epoch ms>" once frames are flowing; create <out.webm>.stop to stop (Electron's
// main process can't read piped stdin on Windows).
const { app, BrowserWindow, desktopCapturer, ipcMain, screen } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const out = path.resolve(process.argv[process.argv.length - 1]);
app.disableHardwareAcceleration(); // the recorder's own window never draws anything
app.whenReady().then(async () => {
  fs.writeFileSync(out, Buffer.alloc(0));
  const { width, height } = screen.getPrimaryDisplay().size;
  const k = screen.getPrimaryDisplay().scaleFactor;
  const [src] = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 0, height: 0 } });
  const page = path.join(os.tmpdir(), `capri-rec-${process.pid}.html`);
  fs.writeFileSync(page, '<!doctype html><meta charset="utf-8">');
  const win = new BrowserWindow({ show: false, webPreferences: { nodeIntegration: true, contextIsolation: false, backgroundThrottling: false } });
  await win.loadFile(page);
  ipcMain.on('chunk', (_e, buf) => fs.appendFileSync(out, Buffer.from(buf)));
  ipcMain.on('started', (_e, t) => process.stdout.write(`REC_START ${t}\n`));
  ipcMain.on('done', () => { fs.rmSync(page, { force: true }); app.exit(0); });
  const stopFile = out + '.stop';
  fs.rmSync(stopFile, { force: true });
  const poll = setInterval(() => { if (fs.existsSync(stopFile)) { clearInterval(poll); fs.rmSync(stopFile, { force: true }); void win.webContents.executeJavaScript('window.__stop()'); } }, 100);
  await win.webContents.executeJavaScript(`(async () => {
    const { ipcRenderer } = require('electron');
    const stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { mandatory: {
      chromeMediaSource: 'desktop', chromeMediaSourceId: ${JSON.stringify(src.id)},
      minWidth: ${Math.round(width * k)}, maxWidth: ${Math.round(width * k)}, minHeight: ${Math.round(height * k)}, maxHeight: ${Math.round(height * k)},
      minFrameRate: 30, maxFrameRate: 30 } } });
    const rec = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp9', videoBitsPerSecond: 30_000_000 });
    let pending = Promise.resolve();
    rec.ondataavailable = (e) => { pending = pending.then(async () => ipcRenderer.send('chunk', new Uint8Array(await e.data.arrayBuffer()))); };
    rec.onstart = () => ipcRenderer.send('started', Date.now());
    rec.onstop = () => pending.then(() => ipcRenderer.send('done'));
    window.__stop = () => { rec.stop(); stream.getTracks().forEach((t) => t.stop()); };
    rec.start(1000);
  })()`);
});
