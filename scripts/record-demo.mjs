// Records the trailer's raw footage: the real app on the real Windows desktop, driven the way a user
// would drive it (real mouse moves and clicks, typing in the real panel, live Gemini replies, a real
// window move, a real app launch). Nothing is staged inside the app: it runs without CAPRI_TEST.
//   node scripts/record-demo.mjs
// Output: trailer/public/demo/desktop.mp4 (full screen, constant 30 fps) and marks.json (event times in
// seconds on the video clock, plus `layout`: her window and the panel at each beat, in video pixels).
// Needs the local Gemini key in .env.local (loaded by the app itself; this script never reads it).
// Minimises every window for the take and restores them afterwards.
import { _electron as electron } from 'playwright-core';
import { spawn, execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const out = path.join(root, 'trailer', 'public', 'demo');
const ffmpeg = path.join(root, 'trailer', 'node_modules', '@remotion', 'compositor-win32-x64-msvc', 'ffmpeg.exe');
fs.mkdirSync(out, { recursive: true });
const CALC = 'C:\\Windows\\System32\\calc.exe';

// --- real input (physical pixels) -------------------------------------------------------------
const koffi = createRequire(import.meta.url)('koffi');
const user32 = koffi.load('user32.dll');
user32.func('bool __stdcall SetProcessDpiAwarenessContext(intptr_t ctx)')(-4); // per-monitor v2
const SetCursorPos = user32.func('bool __stdcall SetCursorPos(int x, int y)');
const mouse_event = user32.func('void __stdcall mouse_event(uint32 f, uint32 dx, uint32 dy, uint32 d, uintptr_t e)');
const POINT = koffi.struct('REC_POINT', { x: 'long', y: 'long' });
const GetCursorPos = user32.func('bool __stdcall GetCursorPos(_Out_ REC_POINT* p)');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
async function moveTo(x, y, ms = 700) {
  const p = {}; GetCursorPos(p);
  const n = Math.max(2, Math.round(ms / 12));
  for (let i = 1; i <= n; i++) { const k = ease(i / n); SetCursorPos(Math.round(p.x + (x - p.x) * k), Math.round(p.y + (y - p.y) * k)); await sleep(12); }
}
const click = async () => { mouse_event(0x2, 0, 0, 0, 0); await sleep(60); mouse_event(0x4, 0, 0, 0, 0); };
const dblclick = async () => { await click(); await sleep(90); await click(); };

// --- desktop ------------------------------------------------------------------------------
const ps = (cmd) => execFileSync('powershell', ['-NoProfile', '-Command', cmd], { encoding: 'utf8' }).trim();
const calcRunning = () => ps("(Get-Process CalculatorApp -ErrorAction SilentlyContinue | Measure-Object).Count") !== '0';
const hadCalc = calcRunning();
ps('(New-Object -ComObject Shell.Application).MinimizeAll()');
await sleep(1200);

// --- profile: Gemini, Calculator approved but still "ask first", no voice ----------------------
const ud = fs.mkdtempSync(path.join(os.tmpdir(), 'capri-demo-'));
fs.writeFileSync(path.join(ud, 'settings.json'), JSON.stringify({
  firstRunComplete: true,
  ai: { provider: 'gemini' },
  voice: { ttsEnabled: false },
  teleport: { auto: false },
  actions: { approvedApps: [{ name: 'Calculator', path: CALC }] },
}));

// --- recorder: Chromium desktop capture (GDI grabbing only manages ~12 fps at 1080p) ------------
const video = path.join(out, 'desktop.mp4');
const webm = path.join(out, 'desktop.webm');
const rec = spawn(createRequire(import.meta.url)('electron'), [path.join(root, 'scripts', 'screen-recorder.cjs'), webm], { stdio: ['ignore', 'pipe', 'inherit'] });
let t0 = 0;
rec.stdout.on('data', (b) => { const m = /REC_START (\d+)/.exec(String(b)); if (m) t0 = +m[1]; });
while (!t0) await sleep(20);
const marks = {};
const layout = {}; // where her window and the panel are at each beat, in video pixels (for the trailer camera)
const mark = (name) => { marks[name] = +((Date.now() - t0) / 1000).toFixed(2); console.log(`${marks[name].toFixed(2).padStart(6)}s  ${name}`); };
mark('desktop');
await sleep(1500);

let app;
try {
  // she arrives
  app = await electron.launch({ args: [root], env: { ...process.env, CAPRI_USER_DATA: ud, CAPRI_TEST: '', CAPRI_OFFSCREEN: '' } });
  const char = await app.firstWindow();
  await char.waitForLoadState('domcontentloaded');
  mark('launch');
  const scale = await app.evaluate(({ screen }) => screen.getPrimaryDisplay().scaleFactor);
  const bounds = (which) => app.evaluate(({ BrowserWindow }, w) => {
    const win = BrowserWindow.getAllWindows().find((x) => x.webContents.getURL().includes(w));
    return win ? win.getContentBounds() : null;
  }, which);
  const px = (v) => Math.round(v * scale);
  const rect = (r) => (r ? [px(r.x), px(r.y), px(r.width), px(r.height)] : null);
  const where = async (name) => { layout[name] = { her: rect(await bounds('character.html')), panel: rect(await bounds('panel.html')) }; };
  await sleep(5000);

  // cursor: she tracks it, then a double-click opens the chat
  const b = await bounds('character.html');
  const cx = px(b.x + b.width * 0.5), cy = px(b.y + b.height * 0.42);
  mark('cursor');
  await where('cursor');
  await moveTo(px(b.x - 260), px(b.y + 40), 900); await sleep(700);
  await moveTo(px(b.x + b.width + 120), px(b.y - 80), 1200); await sleep(700);
  await moveTo(cx, cy, 800); await sleep(500);
  mark('open');
  const panelP = app.waitForEvent('window');
  await dblclick();
  const panel = await Promise.race([panelP, sleep(2500).then(async () => { await char.evaluate(() => window.capri.invoke('char:click')); return panelP; })]);
  await panel.waitForSelector('textarea');
  await sleep(700);

  const pb = () => bounds('panel.html');
  async function say(text) {
    const box = await panel.locator('textarea').boundingBox(); const p = await pb();
    await moveTo(px(p.x + box.x + box.width / 2), px(p.y + box.y + box.height / 2), 600);
    await click(); await sleep(250);
    const before = await panel.locator('.msg.assistant').count();
    await panel.locator('textarea').pressSequentially(text, { delay: 38 });
    await sleep(250);
    await panel.press('textarea', 'Enter');
    await panel.waitForFunction((n) => document.querySelectorAll('.msg.assistant:not(.cursor)').length > n || !!document.querySelector('.confirm'), before, { timeout: 60_000 });
  }
  const settled = () => panel.waitForSelector('#phaseChip[data-phase="idle"]', { state: 'attached', timeout: 60_000 });

  // a real conversation
  mark('chat');
  await where('chat');
  await say('hey capri. what are you doing on my desktop?');
  await settled();
  await sleep(2600);

  // teleport on request: the window really moves
  const before = await bounds('character.html');
  mark('ask_move');
  await say('come sit on the left side of my screen');
  for (let i = 0; i < 100; i++) { const now = await bounds('character.html'); if (now.x !== before.x || now.y !== before.y) break; await sleep(100); }
  mark('moved');
  await settled();
  await where('moved');
  await sleep(3000);

  // a real desktop action, through the permission prompt
  mark('ask_app');
  await say('open the calculator for me');
  await panel.waitForSelector('.confirm', { timeout: 60_000 });
  await sleep(900);
  {
    const box = await panel.locator('.confirm button', { hasText: 'Allow' }).boundingBox(); const p = await pb();
    await moveTo(px(p.x + box.x + box.width / 2), px(p.y + box.y + box.height / 2), 700);
    await sleep(250); await click();
  }
  mark('allow');
  for (let i = 0; i < 80 && !calcRunning(); i++) await sleep(150);
  mark('app_open');
  await sleep(3500);
  if (!hadCalc) ps('Stop-Process -Name CalculatorApp -ErrorAction SilentlyContinue');
  await sleep(600);

  // back to idle
  {
    const p = await pb();
    await panel.evaluate(() => document.getElementById('closeBtn').click());
    await moveTo(px(p.x + p.width + 200), px(p.y + 300), 900);
  }
  mark('idle');
  await where('idle');
  await sleep(7000);
  mark('end');
} catch (e) {
  // the app's own log says why (it never contains the key)
  for (const f of fs.existsSync(path.join(ud, 'logs')) ? fs.readdirSync(path.join(ud, 'logs')) : []) {
    console.log(fs.readFileSync(path.join(ud, 'logs', f), 'utf8').split('\n').slice(-40).join('\n'));
  }
  throw e;
} finally {
  await app?.close().catch(() => {});
  fs.writeFileSync(webm + '.stop', '');
  await new Promise((r) => rec.on('close', r));
  ps('(New-Object -ComObject Shell.Application).UndoMinimizeAll()');
  fs.rmSync(ud, { recursive: true, force: true });
}
// MediaRecorder writes variable-rate WebM (frames only when the screen changes): resample to a
// constant 30 fps on the same clock so the marks line up with the edit
execFileSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-i', webm, '-fps_mode', 'cfr', '-r', '30', '-c:v', 'libx264', '-preset', 'slow', '-crf', '14', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', video]);
fs.rmSync(webm, { force: true });
fs.writeFileSync(path.join(out, 'marks.json'), JSON.stringify({ ...marks, layout }, null, 2) + '\n');
console.log('wrote', path.relative(root, video), 'and marks.json');
