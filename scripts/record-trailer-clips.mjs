// Records the trailer's desktop footage: the real app on a clean stand-in desktop (a city still over the
// whole work area, every real window minimised, the taskbar cropped out in the edit). Each beat is a real
// feature run live — arrival, cursor tracking, a poke, expressions, a Gemini chat, a teleport on request,
// launching an approved app, a timer, the back view. Expressions and the back view are triggered through
// the app's debug hooks (CAPRI_TEST) so they land on cue; everything else is driven like a user would.
//   node scripts/record-trailer-clips.mjs
// Output: trailer/public/clips/desktop.mp4 + marks.json (beat times on the video clock and where her
// window and the panel were). Needs the local Gemini key in .env.local (the app loads it itself).
import { _electron as electron } from 'playwright-core';
import { spawn, execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const out = path.join(root, 'trailer', 'public', 'clips');
const ffmpeg = path.join(root, 'trailer', 'node_modules', '@remotion', 'compositor-win32-x64-msvc', 'ffmpeg.exe');
const electronBin = createRequire(import.meta.url)('electron');
fs.mkdirSync(out, { recursive: true });
const CALC = 'C:\\Windows\\System32\\calc.exe';

// --- real input (physical pixels) -------------------------------------------------------------
const koffi = createRequire(import.meta.url)('koffi');
const user32 = koffi.load('user32.dll');
user32.func('bool __stdcall SetProcessDpiAwarenessContext(intptr_t ctx)')(-4);
const SetCursorPos = user32.func('bool __stdcall SetCursorPos(int x, int y)');
const mouse_event = user32.func('void __stdcall mouse_event(uint32 f, uint32 dx, uint32 dy, uint32 d, uintptr_t e)');
const POINT = koffi.struct('CLIP_POINT', { x: 'long', y: 'long' });
const GetCursorPos = user32.func('bool __stdcall GetCursorPos(_Out_ CLIP_POINT* p)');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
async function moveTo(x, y, ms = 700) {
  const p = {}; GetCursorPos(p);
  const n = Math.max(2, Math.round(ms / 12));
  for (let i = 1; i <= n; i++) { const k = ease(i / n); SetCursorPos(Math.round(p.x + (x - p.x) * k), Math.round(p.y + (y - p.y) * k)); await sleep(12); }
}
const click = async () => { mouse_event(0x2, 0, 0, 0, 0); await sleep(60); mouse_event(0x4, 0, 0, 0, 0); };
const dblclick = async () => { await click(); await sleep(90); await click(); };

// --- clean stage ------------------------------------------------------------------------------
const ps = (cmd) => execFileSync('powershell', ['-NoProfile', '-Command', cmd + '; exit 0'], { encoding: 'utf8' }).trim();
const calcRunning = () => ps('(Get-Process CalculatorApp -ErrorAction SilentlyContinue | Measure-Object).Count') !== '0';
const hadCalc = calcRunning();
const wallpaper = path.join(out, 'wallpaper.jpg');
// a still from the licensed Pexels aerial (see trailer/ASSETS.md)
execFileSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-ss', '20', '-i', path.join(root, 'trailer', 'public', 'video', 'aerial_fog.mp4'), '-frames:v', '1', '-q:v', '2', wallpaper]);
ps('(New-Object -ComObject Shell.Application).MinimizeAll()');
await sleep(1200);
const backdrop = spawn(electronBin, [path.join(root, 'scripts', 'backdrop.cjs'), wallpaper], { stdio: ['ignore', 'pipe', 'inherit'] });
await new Promise((r) => backdrop.stdout.on('data', (b) => { if (String(b).includes('BACKDROP_READY')) r(); }));
await sleep(600);

const ud = fs.mkdtempSync(path.join(os.tmpdir(), 'capri-clips-'));
fs.writeFileSync(path.join(ud, 'settings.json'), JSON.stringify({
  firstRunComplete: true,
  ai: { provider: 'gemini' },
  voice: { ttsEnabled: false },
  teleport: { auto: false },
  behavior: { idleRemarks: false },
  // the borderless full-screen backdrop reads as a fullscreen app, which would (correctly) hide her
  character: { hideOnFullscreen: false },
  actions: { approvedApps: [{ name: 'Calculator', path: CALC }] },
}));

// --- recorder ---------------------------------------------------------------------------------
const webm = path.join(out, 'desktop.webm');
const rec = spawn(electronBin, [path.join(root, 'scripts', 'screen-recorder.cjs'), webm], { stdio: ['ignore', 'pipe', 'inherit'] });
let t0 = 0;
rec.stdout.on('data', (b) => { const m = /REC_START (\d+)/.exec(String(b)); if (m) t0 = +m[1]; });
while (!t0) await sleep(20);
const marks = {}, layout = {};
const mark = (name) => { marks[name] = +((Date.now() - t0) / 1000).toFixed(2); console.log(`${marks[name].toFixed(2).padStart(6)}s  ${name}`); };
await sleep(1200);

let app;
try {
  app = await electron.launch({ args: [root], env: { ...process.env, CAPRI_USER_DATA: ud, CAPRI_TEST: '1', CAPRI_OFFSCREEN: '' } });
  const char = await app.firstWindow();
  await char.waitForFunction(() => window.__capriDebug);
  mark('launch');
  const scale = await app.evaluate(({ screen }) => screen.getPrimaryDisplay().scaleFactor);
  const bounds = (which) => app.evaluate(({ BrowserWindow }, w) => {
    const win = BrowserWindow.getAllWindows().find((x) => x.webContents.getURL().includes(w));
    return win ? win.getContentBounds() : null;
  }, which);
  const px = (v) => Math.round(v * scale);
  const rect = (r) => (r ? [px(r.x), px(r.y), px(r.width), px(r.height)] : null);
  const where = async (name) => { layout[name] = { her: rect(await bounds('character.html')), panel: rect(await bounds('panel.html')) }; };
  const hook = (fn, arg) => app.evaluate(fn, arg);
  const dbg = (code) => char.evaluate(code);
  await sleep(2500);

  // she teleports in beside the cursor, in the middle of the screen
  await moveTo(px(700), px(330), 600);
  mark('arrive');
  await hook(() => globalThis.__capri.teleporter.go('near_cursor', 'manual'));
  await sleep(1800);
  await where('arrive');

  // she watches the cursor circle her
  const b = await bounds('character.html');
  const cx = px(b.x + b.width * 0.5), cy = px(b.y + b.height * 0.42);
  mark('watch');
  for (let i = 0; i <= 48; i++) { const a = (i / 48) * Math.PI * 2; SetCursorPos(Math.round(cx + Math.cos(a) * px(330)), Math.round(cy + Math.sin(a) * px(170))); await sleep(55); }
  await sleep(300);

  // a poke
  await moveTo(cx, cy, 500);
  mark('poke');
  await click();
  await sleep(1800);
  await moveTo(cx + px(420), cy - px(120), 500);

  // expressions, each one of her own clips
  mark('faces');
  for (const [clip, ms] of [['smug', 1700], ['maniac_grin', 2000], ['wink', 1300], ['many_eyes', 1900], ['tilt_grin', 1800]]) {
    await dbg((c) => window.__capriDebug.behavior.playClip(c), clip);
    await sleep(ms);
  }
  await where('faces');

  // a real conversation
  await moveTo(cx, cy, 600);
  const panelP = app.waitForEvent('window');
  await dblclick();
  const panel = await Promise.race([panelP, sleep(2500).then(async () => { await char.evaluate(() => window.capri.invoke('char:click')); return panelP; })]);
  await panel.waitForSelector('textarea');
  await sleep(600);
  const pb = () => bounds('panel.html');
  const settled = () => panel.waitForSelector('#phaseChip[data-phase="idle"]', { state: 'attached', timeout: 60_000 });
  async function say(text) {
    const box = await panel.locator('textarea').boundingBox(); const p = await pb();
    await moveTo(px(p.x + box.x + box.width / 2), px(p.y + box.y + box.height / 2), 500);
    await click(); await sleep(200);
    const before = await panel.locator('.msg.assistant').count();
    await panel.locator('textarea').pressSequentially(text, { delay: 36 });
    await sleep(200);
    await panel.press('textarea', 'Enter');
    await panel.waitForFunction((n) => document.querySelectorAll('.msg.assistant:not(.cursor)').length > n || !!document.querySelector('.confirm'), before, { timeout: 60_000 });
  }
  mark('chat');
  await where('chat');
  await say('hey capri. what can you do?');
  await settled();
  await sleep(2600);

  // teleport on request: the window crosses the screen
  const before = await bounds('character.html');
  mark('ask_move');
  await say('go sit on the left side of my screen');
  for (let i = 0; i < 100; i++) { const now = await bounds('character.html'); if (now.x !== before.x || now.y !== before.y) break; await sleep(100); }
  mark('moved');
  await settled();
  await sleep(2200);
  await where('moved');

  // launching an approved app, through the permission prompt
  mark('ask_app');
  await say('open the calculator for me');
  await panel.waitForSelector('.confirm', { timeout: 60_000 });
  await sleep(800);
  { const box = await panel.locator('.confirm button', { hasText: 'Allow' }).boundingBox(); const p = await pb();
    await moveTo(px(p.x + box.x + box.width / 2), px(p.y + box.y + box.height / 2), 600); await sleep(200); await click(); }
  mark('allow');
  for (let i = 0; i < 80 && !calcRunning(); i++) await sleep(150);
  await settled();
  await sleep(2500);
  if (!hadCalc) ps('Stop-Process -Name CalculatorApp -ErrorAction SilentlyContinue');
  await sleep(700);

  // a timer
  mark('ask_timer');
  await say('set a timer for 5 minutes');
  await settled();
  await sleep(2500);
  await where('timer');

  // panel away; she turns to look at the screen
  { const p = await pb(); void panel.evaluate(() => document.getElementById('closeBtn').click()).catch(() => {}); // the page closes under the call
    await moveTo(px(p.x + p.width + 220), px(p.y + 200), 700); }
  await sleep(1200);
  mark('back');
  await dbg(() => window.__capriDebug.force({ back: 1 }));
  await sleep(3000);
  await dbg(() => window.__capriDebug.force(null));
  await sleep(1500);
  await where('end');
  mark('end');
} catch (e) {
  for (const f of fs.existsSync(path.join(ud, 'logs')) ? fs.readdirSync(path.join(ud, 'logs')) : []) {
    console.log(fs.readFileSync(path.join(ud, 'logs', f), 'utf8').split('\n').slice(-30).join('\n'));
  }
  throw e;
} finally {
  await app?.close().catch(() => {});
  fs.writeFileSync(webm + '.stop', '');
  await new Promise((r) => rec.on('close', r));
  fs.writeFileSync(wallpaper + '.stop', '');
  await new Promise((r) => backdrop.on('close', r));
  ps('(New-Object -ComObject Shell.Application).UndoMinimizeAll()');
  fs.rmSync(ud, { recursive: true, force: true });
}
// MediaRecorder writes variable-rate WebM: resample to a constant 30 fps on the same clock
execFileSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-i', webm, '-fps_mode', 'cfr', '-r', '30', '-c:v', 'libx264', '-preset', 'slow', '-crf', '14', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', path.join(out, 'desktop.mp4')]);
fs.rmSync(webm, { force: true });
fs.writeFileSync(path.join(out, 'marks.json'), JSON.stringify({ ...marks, layout }, null, 2) + '\n');
console.log('wrote trailer/public/clips/desktop.mp4 and marks.json');
