// Bounded actual Electron session: three genuine calls, synthetic desktop content,
// real renderer/IPC, isolated persistence, restart, local provider failure/recovery.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { createHash } from 'node:crypto';
import { _electron as electron } from 'playwright-core';
const root = path.resolve(import.meta.dirname, '..');
const folder = path.resolve(process.argv[2] ?? path.join(root, 'work/integrated-session'));
fs.mkdirSync(folder, { recursive: true });
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'capri-integrated-'));
const actual = JSON.parse(fs.readFileSync(path.join(process.env.APPDATA, 'Capri Buddy/settings.json'), 'utf8'));
if (actual.ai.provider !== 'codex') throw Error('This live check requires the configured Codex provider.');
fs.writeFileSync(path.join(profile, 'settings.json'), JSON.stringify({ firstRunComplete: true, actions: { policies: { read_screen: 'allow' } },
  character: { hideOnFullscreen: false },
  ai: { provider: 'codex', codex: actual.ai.codex, requestTimeoutSec: 60 },
  memory: { autoLearn: false }, voice: { ttsEnabled: true, ttsEngine: 'windows', volume: 0, interactionLines: true },
  teleport: { auto: false, effects: false }, dialogue: { contextPings: false },
  behavior: { idleRemarks: false, explore: false, quietHours: { enabled: false } } }));
let app, server;
const results = [];
const report = () => fs.writeFileSync(path.join(folder, 'session.json'), JSON.stringify(results, null, 2));
const key = createHash('sha256').update(JSON.stringify(['experiment.exe', 'Synthetic route experiment'])).digest('hex').slice(0, 24);
async function launch() {
  app = await electron.launch({ ...(process.env.CAPRI_EXE ? { executablePath: process.env.CAPRI_EXE, args: [] } : { args: [root] }),
    env: { ...process.env, CAPRI_TEST: '1', CAPRI_OFFSCREEN: '1', CAPRI_USER_DATA: profile, CAPRI_NO_DEV_KEY: '1' } });
  const char = app.windows().find(w => w.url().includes('character.html')) ?? await app.firstWindow();
  await char.waitForFunction(() => window.__capriDebug);
  await app.evaluate(() => { globalThis.__capriIdleOverride = 0; });
  await char.evaluate(() => {
    window.__sessionSpeech = [];
    const speaker = window.__capriDebug.speaker, report = speaker.report;
    speaker.report = (id, state) => { window.__sessionSpeech.push({ id, state, at: Date.now() }); report(id, state); };
    window.capri.on('cue', c => { if (c.type === 'life' && c.event === 'pat') window.__patAt = performance.now(); });
  });
  return char;
}
try {
  let char = await launch();
  results.push({ stage: 'launch', startupMs: await app.evaluate(() => globalThis.__capri.startupMs) });
  const image = await app.evaluate(async ({ BrowserWindow }) => {
    const fixture = new BrowserWindow({ show: false, width: 800, height: 600, webPreferences: { offscreen: true } });
    try {
      await fixture.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent('<body style="margin:0;background:#141121;color:#ddd;font:22px sans-serif"><h2 style="padding:24px">Route experiment</h2><svg width="800" height="440"><rect x="180" y="35" width="430" height="300" fill="none" stroke="#666" stroke-width="3"/><path d="M250 110H540V260H250V110M540 180H700" fill="none" stroke="#30ed90" stroke-width="12"/><circle cx="700" cy="180" r="16" fill="#fb498f"/><text x="185" y="395" fill="#ccc">One branch ends outside the enclosure.</text></svg></body>'));
      return (await fixture.webContents.capturePage()).toJPEG(75).toString('base64');
    } finally { fixture.destroy(); }
  });
  await app.evaluate((_, image) => {
    const g = globalThis, a = g.__capri, rect = { x: 100, y: 100, width: 800, height: 600 };
    g.__capriForegroundHandle = -64n; g.__capriDesktopOverride = { title: 'Synthetic route experiment', process: 'experiment.exe' };
    g.__capriWindowInfo = { '-64': { ...g.__capriDesktopOverride } }; g.__capriWindowsOverride = [{ handle: -64n, rect }];
    g.__capriObservationOverride = { jpegBase64: image, region: rect, window: rect };
    a.memory.add('Synthetic test preference: blue glaze.', 'user');
  }, image);
  results.push(await app.evaluate(async (_, key) => {
    const a = globalThis.__capri, start = Date.now();
    await a.generatedRemark('inspect', 'A sustained unfamiliar view. React to one real detail, or stay quiet.', { target: -64n });
    return { stage: 'visual initiative', elapsedMs: Date.now() - start, outcome: a.lastDialogueOutcome,
      reading: a.environmentalCuriosity.context(key, Date.now()), lines: a.scenes.recent().filter(x => x.kind === 'said') };
  }, key)); report();
  const replyStart = Date.now();
  await app.evaluate(async () => { await globalThis.__capri.convo.send('I think that branch outside the box is a mistake. Do you agree?'); });
  await char.evaluate(async () => {
    window.__patStart = performance.now(); await window.capri.invoke('char:interaction', 'pat');
  });
  await char.waitForFunction(() => !!window.__patAt);
  results.push({ stage: 'physical interaction during reply', gestureMs: await char.evaluate(() => window.__patAt - window.__patStart) });
  results.push(await app.evaluate(async () => {
    const a = globalThis.__capri; await a.convo.settle(); const reply = a.history.recent(1)[0];
    return { stage: 'user response', reply: reply.content, error: !!reply.meta?.error, busy: a.convo.busy };
  }));
  const audio = await char.evaluate(start => {
    const events = window.__sessionSpeech.filter(e => e.at >= start);
    return { firstAudioMs: events.find(e => e.state === 'start')?.at - start || null, errors: events.filter(e => e.state === 'error').length };
  }, replyStart);
  results.push({ stage: 'substitute Windows speech at zero volume', ...audio }); report();
  const before = await app.evaluate(({ app: a }) => ({ memoryMB: Math.round(process.memoryUsage().rss / 1048576), messages: globalThis.__capri.history.recent(100).length, processes: a.getAppMetrics().length }));
  await char.waitForTimeout(60000);
  const quiet = await app.evaluate((_, key) => {
    const a = globalThis.__capri; return { messages: a.history.recent(100).length, memoryMB: Math.round(process.memoryUsage().rss / 1048576), reading: a.environmentalCuriosity.context(key, Date.now()) };
  }, key);
  results.push({ stage: 'one real minute of quiet', before, after: quiet, noNewMessages: quiet.messages === before.messages });
  results.push(await app.evaluate(async (_, key) => {
    const a = globalThis.__capri, priority = a.environmentalCuriosity.priority(key, Date.now());
    a.settings.update({ ai: { provider: 'offline' }, behavior: { explore: true } });
    const random = Math.random; Math.random = () => 0;
    try { a.setNextVisit(); await a.exploreTick(0); }
    finally { Math.random = random; a.settings.update({ ai: { provider: 'codex' }, behavior: { explore: false } }); }
    return { stage: 'revisit the visual curiosity without another model call', priority, completedVisits: a.outings.snapshot().visits.length, visitPhase: a.visit.phase };
  }, key)); report();
  await app.close(); app = undefined; char = await launch();
  results.push(await app.evaluate(() => {
    const a = globalThis.__capri; return { stage: 'restart continuity', memory: a.memory.approved().map(x => x.text), history: a.history.recent(4).map(x => ({ role: x.role, content: x.content })), sceneEntries: a.conversationScene.snapshot().entries.length };
  }));
  results.push(await app.evaluate(async () => {
    const a = globalThis.__capri;
    await a.convo.send('Back to that route experiment. Would you keep the branch outside the enclosure, and why? Also, what is 17 times 24?'); await a.convo.settle();
    const reply = a.history.recent(1)[0]; return { stage: 'return to the earlier subject', reply: reply.content, error: !!reply.meta?.error };
  })); report();
  let fail = true, localCalls = 0;
  server = http.createServer((req, res) => {
    if (req.url.endsWith('/models')) { res.end('{"data":[{"id":"fixture"}]}'); return; }
    req.resume(); req.on('end', () => {
      localCalls++;
      if (fail) { res.writeHead(503); res.end('synthetic provider unavailable'); return; }
      res.writeHead(200, { 'content-type': 'text/event-stream' }); res.end('data: ' + JSON.stringify({ choices: [{ delta: { content: 'The connection is back.' } }] }) + '\n\ndata: [DONE]\n\n');
    });
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${server.address().port}/v1`;
  results.push(await app.evaluate(async (_, url) => {
    const a = globalThis.__capri; a.settings.update({ ai: { provider: 'openai', openai: { baseUrl: url, model: 'fixture' } } });
    await a.convo.send('A synthetic connection check.'); await a.convo.settle();
    return { stage: 'provider failure', error: !!a.history.recent(1)[0].meta?.error, busy: a.convo.busy, phase: a.convo.phase };
  }, url));
  fail = false;
  results.push(await app.evaluate(async () => {
    const a = globalThis.__capri; await a.convo.send('Try the synthetic connection again.'); await a.convo.settle();
    const reply = a.history.recent(1)[0]; return { stage: 'provider recovery', reply: reply.content, error: !!reply.meta?.error, busy: a.convo.busy };
  }));
  results.push(await app.evaluate(async () => {
    const a = globalThis.__capri; a.settings.update({ privacy: { saveHistory: false } });
    a.conversationScene.record({ id: 'private-session', role: 'user', text: 'Keep this in the current session only.', at: Date.now() });
    a.settings.update({ voice: { volume: .1 } }); a.applyCompanyControl({ kind: 'focus', minutes: 25 });
    await a.generatedRemark('inspect', 'Focus forbids this opportunity.');
    return { stage: 'privacy and focus', sessionRetained: a.conversationScene.snapshot().entries.some(e => e.id === 'private-session'), focused: a.company.focused(), busy: a.convo.busy };
  }));
  results.push({ stage: 'privacy files', historyExists: fs.existsSync(path.join(profile, 'history.jsonl')), sceneExists: fs.existsSync(path.join(profile, 'conversation-scene.json')), localFixtureCalls: localCalls, genuineApplicationRequests: 3 });
  await char.screenshot({ path: path.join(folder, 'character.png'), omitBackground: true }); report();
  console.log(JSON.stringify(results, null, 2));
  if (results.some(x => x.error && x.stage !== 'provider failure' || x.noNewMessages === false) || !results.find(x => x.stage === 'privacy and focus')?.sessionRetained || !results.find(x => x.stage === 'visual initiative')?.reading) throw Error('Integrated check needs review; see session report.');
} finally {
  await app?.close(); server?.closeAllConnections(); if (server) await new Promise(r => server.close(r));
}
