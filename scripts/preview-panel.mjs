// Screenshots every panel view (off-screen) for design review: node scripts/preview-panel.mjs [outDir]
import { _electron as electron } from 'playwright-core';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
const out = process.argv[2] ?? 'docs/previews/panel';
fs.mkdirSync(out, { recursive: true });
const ud = fs.mkdtempSync(path.join(os.tmpdir(), 'capri-panel-'));
fs.writeFileSync(path.join(ud, 'settings.json'), JSON.stringify({ firstRunComplete: true, ai: { provider: 'offline' }, voice: { ttsEnabled: false }, teleport: { auto: false } }));
const t = Date.now();
fs.writeFileSync(path.join(ud, 'history.jsonl'), [
  { id: 'u1', role: 'user', content: 'hey. who are you?', ts: t - 60000 },
  { id: 'a1', role: 'assistant', content: 'Capri. A few thousand psyches in a trench coat, living on your desktop. You can call me whatever you like, but I answer to Capri.', ts: t - 58000 },
  { id: 'u2', role: 'user', content: 'note: buy coffee', ts: t - 30000 },
  { id: 'x1', role: 'action', content: 'Saved note “buy coffee”', ts: t - 29000, meta: { actionStatus: 'done' } },
  { id: 'a2', role: 'assistant', content: 'Noted, choom. Coffee is non-negotiable.', ts: t - 28000 },
].map((m) => JSON.stringify(m)).join('\n') + '\n');
const app = await electron.launch({ args: [process.cwd()], env: { ...process.env, CAPRI_TEST: '1', CAPRI_OFFSCREEN: '1', CAPRI_NO_DEV_KEY: '1', CAPRI_USER_DATA: ud } });
const char = await app.firstWindow();
await char.waitForFunction(() => window.__capriDebug);
const wait = app.waitForEvent('window');
await char.evaluate(() => window.capri.invoke('panel:open', 'chat'));
const panel = await wait;
await panel.waitForSelector('textarea');
for (const tab of ['chat', 'model', 'voice', 'character', 'memory', 'privacy', 'system']) {
  await panel.evaluate((x) => window.capri.invoke('panel:open', x), tab);
  await panel.waitForTimeout(tab === 'chat' ? 400 : 900);
  await panel.screenshot({ path: path.join(out, `${tab}.png`) });
  console.log('shot', tab);
}
await app.close();
