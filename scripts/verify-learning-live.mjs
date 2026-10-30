// Live automatic learning check with synthetic facts in an isolated profile.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { _electron as electron } from 'playwright-core';
const root = path.resolve(import.meta.dirname, '..');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'capri-learn-live-'));
fs.writeFileSync(path.join(profile, 'settings.json'), JSON.stringify({ firstRunComplete: true, ai: { provider: 'codex', requestTimeoutSec: 120 }, memory: { enabled: true, autoLearn: true }, voice: { ttsEnabled: false }, teleport: { auto: false } }));
const launch = () => electron.launch({ ...(process.env.CAPRI_EXE ? { executablePath: process.env.CAPRI_EXE, args: [] } : { args: [root] }), env: { ...process.env, CAPRI_TEST: '1', CAPRI_OFFSCREEN: '1', CAPRI_USER_DATA: profile } });
let app = await launch();
const folder = path.resolve(root, '../../work/learning-check'); fs.mkdirSync(folder, { recursive: true });
const reports = [];
try {
  const char = await app.firstWindow(); await char.waitForFunction(() => window.__capriDebug);
  for (const input of ['My favorite drink is jasmine tea. Remember that for our conversations.', 'That changed: my favorite drink is now oolong tea, not jasmine tea. Please update what you remember.']) {
    const result = await app.evaluate(async (_, input) => {
      const a = globalThis.__capri; await a.convo.send(input); await a.convo.settle();
      const m = [...a.history.recent(4)].reverse().find(m => m.role === 'assistant');
      return { input, reply: m?.content, error: !!m?.meta?.error, memories: a.memory.approved().map(m => ({ id: m.id, text: m.text, revisions: m.revisions?.length })) };
    }, input);
    console.log(JSON.stringify({ replyBeforeLearning: result }));
    const expected = /changed/.test(input) ? /oolong/i : /jasmine/i;
    const until = Date.now() + 90000;
    while (Date.now() < until) {
      result.memories = await app.evaluate(() => globalThis.__capri.memory.approved().map(m => ({ id: m.id, text: m.text, revisions: m.revisions?.length })));
      if (result.memories.some(m => expected.test(m.text))) break;
      await new Promise(r => setTimeout(r, 250));
    }
    reports.push(result); console.log(JSON.stringify(result)); fs.writeFileSync(path.join(folder, 'live-results.json'), JSON.stringify(reports, null, 2));
    if (result.error) throw new Error('Live conversation failed.');
  }
  const learned = reports[1].memories;
  if (!learned.some(m => /oolong/i.test(m.text)) || learned.length !== 1 || learned[0].id !== reports[0].memories[0]?.id) throw new Error('Live correction did not replace the fact.');
  const next = app.waitForEvent('window'); await char.evaluate(() => window.capri.invoke('panel:open', 'memory'));
  const panel = await next; await panel.waitForSelector('.item'); await panel.screenshot({ path: path.join(folder, 'memory-ui.png') });
} finally { await app.close(); }
app = await launch();
try {
  const char = await app.firstWindow(); await char.waitForFunction(() => window.__capriDebug);
  const persisted = await app.evaluate(() => globalThis.__capri.memory.approved().map(m => m.text));
  if (!persisted.some(t => /oolong/i.test(t))) throw new Error('Learned correction did not persist.');
  console.log(JSON.stringify({ persistedAfterRestart: true }));
} finally { await app.close(); }
