// Import an explicitly supplied profile into Capri's existing local memory store.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { _electron as electron } from 'playwright-core';
const root = path.resolve(import.meta.dirname, '..');
const input = process.argv.slice(2).find(a => a !== '--live');
if (!input || !process.argv.includes('--live')) throw new Error('Pass the profile JSON path and --live. Close Capri first.');
const data = JSON.parse(fs.readFileSync(path.resolve(input), 'utf8'));
const userData = path.join(process.env.APPDATA, 'Capri Buddy');
const launch = profile => electron.launch({ args: [root], env: { ...process.env, CAPRI_TEST: '1', CAPRI_OFFSCREEN: '1', CAPRI_USER_DATA: profile } });
let app = await launch(userData);
let expected;
try {
  const char = await app.firstWindow(); await char.waitForFunction(() => window.__capriDebug);
  const result = await app.evaluate((_, data) => {
    const a = globalThis.__capri;
    const result = a.memory.importProfile(data.entries, data.label, data.asOf);
    a.settings.update({ memory: { enabled: true } }); a.settings.flush();
    return { ...result, total: a.memory.list().length, approved: a.memory.approved().length };
  }, data);
  expected = result.approved; console.log(JSON.stringify({ import: result }));
} finally { await app.close(); }
app = await launch(userData);
try {
  const char = await app.firstWindow(); await char.waitForFunction(() => window.__capriDebug);
  const persisted = await app.evaluate(() => globalThis.__capri.memory.approved().length);
  if (persisted !== expected) throw new Error('Profile did not persist across restart.');
  console.log(JSON.stringify({ persistedAfterRestart: persisted }));
  const next = app.waitForEvent('window'); await char.evaluate(() => window.capri.invoke('panel:open', 'memory'));
  const panel = await next; await panel.waitForSelector('.item');
  const folder = path.resolve(root, '../../work/profile-import'); fs.mkdirSync(folder, { recursive: true });
  await panel.screenshot({ path: path.join(folder, 'memory-ui.png') });
} finally { await app.close(); }
// Real-model verification uses an isolated conversation, with no changes to the user's chat history.
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'capri-profile-live-'));
fs.copyFileSync(path.join(userData, 'memory.json'), path.join(profile, 'memory.json'));
fs.writeFileSync(path.join(profile, 'settings.json'), JSON.stringify({ firstRunComplete: true, ai: { provider: 'codex', requestTimeoutSec: 120 }, voice: { ttsEnabled: false }, teleport: { auto: false }, behavior: { idleRemarks: false } }));
app = await launch(profile);
try {
  const char = await app.firstWindow(); await char.waitForFunction(() => window.__capriDebug);
  const results = [];
  for (const input of ['Without guessing: what is my name, what am I studying and where, and what would make you good company for me? Keep it brief.', 'Do you know my exact birthdate?']) {
    const result = await app.evaluate(async (_, text) => {
      const a = globalThis.__capri; await a.convo.send(text); await a.convo.settle();
      const m = [...a.history.recent(4)].reverse().find(m => m.role === 'assistant');
      return { reply: m?.content, error: !!m?.meta?.error };
    }, input);
    if (!result.reply || result.error) throw new Error('Profile dialogue check failed.');
    results.push({ input, ...result }); console.log(JSON.stringify(result));
    fs.writeFileSync(path.resolve(root, '../../work/profile-import/live-check.json'), JSON.stringify(results, null, 2));
  }
  if (!/Matthew/.test(results[0].reply) || !/Purdue/.test(results[0].reply) || !/mechanical/i.test(results[0].reply)) throw new Error('Identity recall check failed.');
} finally { await app.close(); }
