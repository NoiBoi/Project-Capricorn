// Performance measurement: startup, idle/active/hidden CPU, memory and fps.
// Usage: node scripts/perf.mjs [path-to-Capri.exe]   (defaults to the dev bundle)
import { _electron as electron } from 'playwright-core';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const exe = process.argv[2];
const ud = fs.mkdtempSync(path.join(os.tmpdir(), 'capri-perf-'));
fs.writeFileSync(path.join(ud, 'settings.json'), JSON.stringify({ firstRunComplete: true, character: { hideOnFullscreen: false }, voice: { ttsEnabled: false } }));
const t0 = Date.now();
const app = await electron.launch({ ...(exe ? { executablePath: exe, args: [] } : { args: [path.resolve(import.meta.dirname, '..')] }), env: { ...process.env, CAPRI_TEST: '1', CAPRI_OFFSCREEN: process.env.CAPRI_ONSCREEN ? '0' : '1', CAPRI_USER_DATA: ud } });
const char = await app.firstWindow();
await char.waitForFunction(() => window.__capriDebug);
const wall = Date.now() - t0;
const startupMs = await app.evaluate(() => globalThis.__capri.startupMs);

const sample = async (label, seconds, setup) => {
  await setup?.();
  await app.evaluate(({ app: a }) => a.getAppMetrics()); // prime CPU counters
  await char.waitForTimeout(seconds * 1000);
  const m = await app.evaluate(({ app: a }) => a.getAppMetrics().map((x) => ({ type: x.type, cpu: x.cpu.percentCPUUsage, mem: x.memory.workingSetSize })));
  const cpu = m.reduce((s, x) => s + x.cpu, 0);
  const mem = m.reduce((s, x) => s + x.mem, 0) / 1024;
  return { label, cpuPct: +cpu.toFixed(1), memMB: Math.round(mem), procs: m.length };
};

const rows = [];
rows.push(await sample('idle (after 5s settle)', 10, () => char.waitForTimeout(5000)));
rows.push(await sample('active (forced speaking, 60fps)', 10, () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((w) => !w.isFocusable()).webContents.send('cue', { type: 'phase', phase: 'speaking' }))));
rows.push(await sample('hidden (render paused)', 10, () => app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows().find((x) => !x.isFocusable()); w.webContents.send('cue', { type: 'phase', phase: 'idle' }); w.hide(); w.webContents.send('cue', { type: 'pause', paused: true }); })));
await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows().find((x) => !x.isFocusable()); if (process.env.CAPRI_ONSCREEN) w.showInactive(); w.webContents.send('cue', { type: 'pause', paused: false }); });
await char.waitForTimeout(6000);
const diagFps = await char.evaluate(async () => {
  // measure delivered frames directly over 3s
  const c = document.getElementById('stage'); const g = c.getContext('2d');
  let frames = 0; const orig = g.clearRect.bind(g); g.clearRect = (...a) => { frames++; return orig(...a); };
  await new Promise((r) => setTimeout(r, 3000)); g.clearRect = orig; return frames / 3;
});
await app.evaluate(({ app: a }) => a.quit());
const cores = os.cpus().length;
const report = {
  machine: `${os.cpus()[0].model.trim()} (${cores} threads), ${Math.round(os.totalmem() / 1073741824)} GB RAM, ${process.platform} ${os.release()}`,
  build: exe ? 'packaged' : 'dev bundle',
  startupToCharacterMs: startupMs, launchToReadyWallMs: wall, idleRenderFps: +diagFps.toFixed(1),
  note: 'cpuPct = sum over all Electron processes, % of ONE core (Chromium convention)',
  rows,
};
console.log(JSON.stringify(report, null, 2));
try { fs.rmSync(ud, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 }); } catch { /* Chromium may hold a cache file briefly */ }
