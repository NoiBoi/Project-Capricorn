// Explicit live check: one synthetic conversation using the signed-in Codex account.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { _electron as electron } from 'playwright-core';
const root = path.resolve(import.meta.dirname, '..');
const out = path.resolve(root, '../../work/bubble-check'); fs.mkdirSync(out, { recursive: true });
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'capri-bubble-live-'));
fs.writeFileSync(path.join(profile, 'settings.json'), JSON.stringify({ firstRunComplete: true, character: { scale: 0.55, glitchEffects: false }, ai: { provider: 'codex', requestTimeoutSec: 120 }, voice: { ttsEnabled: false }, memory: { enabled: true, autoLearn: true }, teleport: { auto: false } }));
const app = await electron.launch({ ...(process.env.CAPRI_EXE ? { executablePath: process.env.CAPRI_EXE, args: [] } : { args: [root] }), env: { ...process.env, CAPRI_TEST: '1', CAPRI_OFFSCREEN: '1', CAPRI_USER_DATA: profile } });
try {
  const char = await app.firstWindow(); await char.waitForFunction(() => window.__capriDebug);
  const next = app.waitForEvent('window'); await char.evaluate(() => window.capri.invoke('bubble:open'));
  const bubble = await next; await bubble.waitForSelector('#input');
  await bubble.fill('#input', 'Say one short, playful line to greet me from your new desktop speech bubble. No actions.'); await bubble.press('#input', 'Enter');
  await bubble.waitForFunction(() => document.getElementById('status').textContent === 'CAPRI' && document.getElementById('message').textContent.length > 10 && !document.getElementById('message').classList.contains('waiting'), undefined, { timeout: 120000 });
  await bubble.waitForTimeout(500);
  await bubble.screenshot({ path: path.join(out, 'bubble.png'), omitBackground: true });
  await char.screenshot({ path: path.join(out, 'character.png'), omitBackground: true });
  console.log(JSON.stringify({ reply: await bubble.locator('#message').innerText(), windows: await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map(w => w.getTitle())) }));
} finally { await app.close(); }
