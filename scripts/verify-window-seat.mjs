// Explicit native-window check. Two temporary test windows appear briefly; no other apps are controlled.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { _electron as electron } from 'playwright-core';
const root = path.resolve(import.meta.dirname, '..');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'capri-native-seat-'));
fs.writeFileSync(path.join(profile, 'settings.json'), JSON.stringify({ firstRunComplete: true, character: { scale: 0.55, glitchEffects: false }, ai: { provider: 'offline' }, voice: { ttsEnabled: false }, teleport: { auto: false } }));
const app = await electron.launch({ args: [root], env: { ...process.env, CAPRI_TEST: '1', CAPRI_OFFSCREEN: '1', CAPRI_USER_DATA: profile } });
try {
  const char = await app.firstWindow(); await char.waitForFunction(() => window.__capriDebug);
  const start = await app.evaluate(async ({ BrowserWindow, screen }) => {
    const a = globalThis.__capri, wa = screen.getPrimaryDisplay().workArea;
    const fixture = new BrowserWindow({ x: wa.x + 180, y: wa.y + 420, width: 700, height: 300, title: 'Capri window-seat check', show: false });
    await fixture.loadURL('data:text/html,<body style="background:%231b2233;color:white;font:20px sans-serif">Capri window-seat check</body>');
    fixture.showInactive(); globalThis.__seatFixture = fixture;
    const r = fixture.getBounds(), b = a.charWin.getBounds();
    // The contact ratio comes from the app's renderer framing (~71.2% of its window height).
    a.charWin.setBounds({ ...b, x: r.x + 220 - b.width / 2, y: Math.round(r.y - b.height * 0.7119789480593283 + 12) });
    a.settleAfterDrop();
    return { pet: a.charWin.getBounds(), target: fixture.getBounds() };
  });
  const second = await app.evaluate(async ({ BrowserWindow, screen }) => {
    const wa = screen.getPrimaryDisplay().workArea;
    const w = new BrowserWindow({ x: wa.x + 1000, y: wa.y + 180, width: 350, height: 220, title: 'Capri focus-change check', show: false });
    await w.loadURL('data:text/html,<body style="background:%2322331b;color:white">Focus changed; Capri should stay attached.</body>');
    w.show(); return w.id;
  });
  await new Promise((r) => setTimeout(r, 350));
  const afterFocus = await app.evaluate(() => globalThis.__capri.charWin.getBounds());
  await app.evaluate(() => { const f = globalThis.__seatFixture, b = f.getBounds(); f.setBounds({ ...b, x: b.x + 140, y: b.y + 80, width: b.width + 80 }); });
  await new Promise((r) => setTimeout(r, 2200));
  const afterMove = await app.evaluate(() => ({ pet: globalThis.__capri.charWin.getBounds(), target: globalThis.__seatFixture.getBounds() }));
  const seatError = (v) => Math.abs(v.pet.y + v.pet.height * 0.7119789480593283 - v.target.y);
  const top = await app.evaluate(({ screen }) => screen.getPrimaryDisplay().workArea.y);
  await app.evaluate((_, top) => { const f = globalThis.__seatFixture; f.setPosition(f.getBounds().x, top + 12); }, top);
  await char.waitForFunction(() => window.__capriDebug.model.activeClip === 'dangle', undefined, { timeout: 6500 });
  const hanging = await app.evaluate(() => ({ pet: globalThis.__capri.charWin.getBounds(), target: globalThis.__seatFixture.getBounds() }));
  const hungBelowEdge = Math.abs(hanging.pet.y + hanging.pet.height * 0.08 - hanging.target.y) < 5;
  const capture = path.resolve(root, '../../work/seat-check'); fs.mkdirSync(capture, { recursive: true });
  await char.screenshot({ path: path.join(capture, 'hanging.png'), omitBackground: true });
  const report = { hungBelowEdge, nativeWindow: true, snapped: seatError(start) < 5, stayedAfterFocus: Math.abs(start.pet.y - afterFocus.y) < 3, followedMove: seatError(afterMove) < 5 && afterMove.pet.x > start.pet.x + 80, secondWindow: second };
  console.log(JSON.stringify(report));
  if (!report.snapped || !report.stayedAfterFocus || !report.followedMove || !report.hungBelowEdge) throw new Error('Native seat check failed');
} finally { await app.close(); }
