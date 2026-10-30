// Three real-provider opportunities plus restart, synthetic content, isolated profile. No user windows or saved data.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { _electron as electron } from 'playwright-core';
const root = path.resolve(import.meta.dirname, '..');
const folder = path.resolve(process.argv[2] ?? path.join(root, 'work/stage3-live'));
fs.mkdirSync(folder, { recursive: true });
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'capri-environment-live-'));
const actual = JSON.parse(fs.readFileSync(path.join(process.env.APPDATA, 'Capri Buddy/settings.json'), 'utf8'));
if (actual.ai.provider !== 'codex') throw new Error('This bounded live check requires the configured Codex provider.');
fs.writeFileSync(path.join(profile, 'settings.json'), JSON.stringify({ firstRunComplete: true, actions: { policies: { read_screen: 'allow' } },
  character: { hideOnFullscreen: false },
  ai: { provider: 'codex', codex: actual.ai.codex, requestTimeoutSec: 60 }, memory: { autoLearn: true },
  voice: { ttsEnabled: false }, teleport: { auto: false }, behavior: { idleRemarks: false, explore: false, quietHours: { enabled: false } } }));
let app = await electron.launch({ ...(process.env.CAPRI_EXE ? { executablePath: process.env.CAPRI_EXE, args: [] } : { args: [root] }), env: { ...process.env, CAPRI_TEST: '1', CAPRI_OFFSCREEN: '1', CAPRI_USER_DATA: profile, CAPRI_NO_DEV_KEY: '1' } });
const results = [];
const key = createHash('sha256').update(JSON.stringify(['experiment.exe', 'Synthetic loop experiment'])).digest('hex').slice(0, 24);
try {
  const char = await app.firstWindow(); await char.waitForFunction(() => window.__capriDebug);
  const image = await app.evaluate(async ({ BrowserWindow }) => {
    const fixture = new BrowserWindow({ show: false, width: 800, height: 600, webPreferences: { offscreen: true } });
    try {
      await fixture.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(`<body style="margin:0;background:#141121;color:#ddd;font:22px sans-serif"><h2 style="padding:24px">Route experiment</h2><svg width="800" height="440"><rect x="180" y="35" width="430" height="300" fill="none" stroke="#666" stroke-width="3"/><path d="M250 110H540V260H250V110M540 180H700" fill="none" stroke="#30ed90" stroke-width="12"/><circle cx="700" cy="180" r="16" fill="#fb498f"/><text x="185" y="395" fill="#ccc">One branch ends outside the enclosure.</text></svg></body>`));
      return (await fixture.webContents.capturePage()).toJPEG(75).toString('base64');
    } finally { fixture.destroy(); }
  });
  results.push(await app.evaluate(async (_, { image, key }) => {
    const g = globalThis, a = g.__capri, rect = { x: 100, y: 100, width: 800, height: 600 };
    g.__capriIdleOverride = 0; g.__capriForegroundHandle = -64n;
    g.__capriDesktopOverride = { title: 'Synthetic loop experiment', process: 'experiment.exe' };
    g.__capriWindowInfo = { '-64': { ...g.__capriDesktopOverride } };
    g.__capriWindowsOverride = [{ handle: -64n, rect }];
    g.__capriObservationOverride = { jpegBase64: image, region: rect, window: rect };
    await a.generatedRemark('inspect', 'A sustained unfamiliar view. Notice one real detail, or stay quiet.', { target: -64n });
    return { scenario: 'unfamiliar visible content', outcome: a.lastDialogueOutcome, delivered: a.scenes.recent(4).filter(x => x.kind === 'said'), reading: a.environmentalCuriosity.context(key, Date.now()), points: a.lastInspection?.points.length ?? 0, episodes: a.scenes.experiences(), diagnostics: a.behavior.diagnostics() };
  }, { image, key }));
  fs.writeFileSync(path.join(folder, 'live-results.json'), JSON.stringify(results, null, 2));
  results.push(await app.evaluate(async () => {
    const a = globalThis.__capri;
    await a.generatedRemark('pat', 'The user gives Capri a brief head pat while she is interested in the diagram.');
    return { scenario: 'affection during curiosity', outcome: a.lastDialogueOutcome, delivered: a.scenes.recent(2).filter(x => x.kind === 'said') };
  }));
  results.push(await app.evaluate(async () => {
    const a = globalThis.__capri;
    await a.convo.send('Back to that diagram. I think the branch outside the box is a mistake. What do you think? Also, what is 17 times 24?');
    await a.convo.settle(); const reply = a.history.recent(1)[0];
    return { scenario: 'return to shared subject and technical reasoning', reply: reply?.content, error: !!reply?.meta?.error };
  }));
  const episodeIds = await app.evaluate(() => { const a = globalThis.__capri; a.memoryLearner.discard(); return a.scenes.experiences().map(e => e.id); });
  await app.close();
  app = await electron.launch({ ...(process.env.CAPRI_EXE ? { executablePath: process.env.CAPRI_EXE, args: [] } : { args: [root] }), env: { ...process.env, CAPRI_TEST: '1', CAPRI_OFFSCREEN: '1', CAPRI_USER_DATA: profile, CAPRI_NO_DEV_KEY: '1' } });
  const restarted = await app.firstWindow(); await restarted.waitForFunction(() => window.__capriDebug);
  const afterRestart = await app.evaluate(() => globalThis.__capri.scenes.experiences());
  results.push({scenario:'episodic continuity across restart', before:episodeIds, after:afterRestart.map(e=>e.id), preserved:episodeIds.length > 0 && episodeIds.every(id=>afterRestart.some(e=>e.id===id))});
  fs.writeFileSync(path.join(folder, 'live-results.json'), JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results, null, 2));
  if (!results[0].reading || results[2].error || !results[3].preserved) throw new Error('Live inspection or conversation unavailable; inspect the report.');
} finally { await app.close(); }
