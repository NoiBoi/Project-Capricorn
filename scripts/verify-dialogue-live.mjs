// Explicit live character check with synthetic prompts and an isolated profile.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { _electron as electron } from 'playwright-core';
const root = path.resolve(import.meta.dirname, '..');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'capri-dialogue-live-'));
const folder = path.resolve(root, '../../work/dialogue-check'); fs.mkdirSync(folder, { recursive: true });
fs.writeFileSync(path.join(profile, 'settings.json'), JSON.stringify({ firstRunComplete: true, ai: { provider: 'codex', requestTimeoutSec: 120 }, voice: { ttsEnabled: false }, teleport: { auto: false }, behavior: { idleRemarks: false } }));
const app = await electron.launch({ args: [root], env: { ...process.env, CAPRI_TEST: '1', CAPRI_OFFSCREEN: '1', CAPRI_USER_DATA: profile } });
const results = [];
try {
  const char = await app.firstWindow(); await char.waitForFunction(() => window.__capriDebug);
  for (const input of ['hey capri. what do you actually want, besides helping me?', 'you sound pretty pleased with yourself', 'honestly today sucked and I do not really want a pep talk', 'switching gears: what is 17 times 24?']) {
    const result = await app.evaluate(async (_, input) => {
      const a = globalThis.__capri; await a.convo.send(input); await a.convo.settle();
      const message = [...a.history.recent(4)].reverse().find(m => m.role === 'assistant');
      return { input, reply: message?.content, error: !!message?.meta?.error };
    }, input);
    results.push(result); console.log(JSON.stringify(result));
    fs.writeFileSync(path.join(folder, 'replies.json'), JSON.stringify(results, null, 2));
    if (result.error || !result.reply) throw new Error('Live dialogue failed.');
  }
} finally { await app.close(); }
