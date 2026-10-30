// Synthetic live check: uses the selected Codex provider, never the user's Capri profile.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { _electron as electron } from 'playwright-core';
const root = path.resolve(import.meta.dirname, '..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'capri-relationship-live-'));
const reportFile = process.env.CAPRI_RELATIONSHIP_REPORT || path.resolve(root, '../../work/relationship-live.json');
fs.mkdirSync(path.dirname(reportFile), { recursive: true });
fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({ firstRunComplete: true, ai: { provider: 'codex', requestTimeoutSec: 120 }, memory: { enabled: true, autoLearn: true }, dialogue: { localContext: false }, voice: { ttsEnabled: false }, behavior: { idleRemarks: false, explore: false }, teleport: { auto: false } }));
const start = async () => {
  const instance = await electron.launch({ ...(process.env.CAPRI_EXE ? { executablePath: process.env.CAPRI_EXE, args: [] } : { args: [root] }), env: { ...process.env, CAPRI_TEST: '1', CAPRI_OFFSCREEN: '1', CAPRI_USER_DATA: dir, CAPRI_NO_DEV_KEY: '1' } });
  await instance.firstWindow();
  for (let i = 0; i < 100; i++) { if (await instance.evaluate(() => !!globalThis.__capri)) return instance; await new Promise(r => setTimeout(r, 100)); }
  throw Error('App startup failed');
};
const report = { turns: [], profile: dir };
let app = await start();
async function ask(text) {
  const reply = await app.evaluate(async (_, text) => { const a = globalThis.__capri; await a.convo.send(text); await a.convo.settle(); return a.history.recent(1)[0]; }, text);
  if (reply.meta?.error || !reply.content) throw Error('Live reply failed');
  report.turns.push({ user: text, reply: reply.content }); fs.writeFileSync(reportFile, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ user: text, reply: reply.content })); return reply;
}
try {
  await ask('I am working on a ceramic fox sculpture named Cobalt. Its tail is finished, but I still need to choose a glaze.');
  await ask('What music do you prefer for yourself? Give me one genuine character preference, phrased as I prefer, rather than guessing my taste.');
  await app.evaluate(() => globalThis.__capri.memoryLearner.schedule(0));
  const until = Date.now() + 90000;
  while (Date.now() < until) {
    const state = await app.evaluate(() => globalThis.__capri.relationship.snapshot());
    if (state.tastes.length && state.threads.length) { report.learned = state; break; }
    await new Promise(r => setTimeout(r, 1000));
  }
  if (!report.learned?.tastes.length || !report.learned?.threads.some(p => /fox|cobalt/i.test(p.title))) throw Error('The combined live extraction did not learn taste and project');
  report.userFacts = await app.evaluate(() => globalThis.__capri.memory.approved().map(m => m.text));
  await app.evaluate(() => { const a = globalThis.__capri; a.settings.update({ memory: { autoLearn: false } }); a.settings.flush(); const p = a.relationship.snapshot().threads[0]; a.relationship.setThread({ ...p, nextAskAt: Date.now() - 1000 }, p.source); });
} finally { await app.close(); }
// Remove this synthetic chat file to distinguish durable taste recall from the live chat window.
fs.rmSync(path.join(dir, 'history.jsonl'), { force: true });
app = await start();
try {
  report.afterRestart = await app.evaluate(() => globalThis.__capri.relationship.snapshot());
  await ask('What music did you decide you prefer?');
  await ask('hey');
  report.afterFollowUp = await app.evaluate(() => globalThis.__capri.relationship.snapshot());
  report.persisted = report.afterRestart.tastes[0].id === report.learned.tastes[0].id;
  if (!report.persisted) throw Error('Taste did not persist');
  fs.writeFileSync(reportFile, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ persistedTaste: true, threadCount: report.afterRestart.threads.length, asksSinceUpdate: report.afterFollowUp.threads[0].asksSinceUpdate }));
} finally { await app.close(); }
