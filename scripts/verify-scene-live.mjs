import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { _electron as electron } from 'playwright-core';
const root = path.resolve(import.meta.dirname, '..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'capri-scene-live-'));
const out = process.env.CAPRI_SCENE_REPORT || path.resolve(root, '../../work/scene-live.json');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({ firstRunComplete: true, ai: { provider: 'codex', requestTimeoutSec: 90 }, memory: { autoLearn: true }, dialogue: { localContext: false, contextPings: false }, behavior: { idleRemarks: false, explore: false, quietHours: { enabled: false } }, voice: { ttsEnabled: false }, teleport: { auto: false } }));
const start = async () => {
  const a = await electron.launch({ ...(process.env.CAPRI_EXE ? { executablePath: process.env.CAPRI_EXE, args: [] } : { args: [root] }), env: { ...process.env, CAPRI_TEST: '1', CAPRI_OFFSCREEN: '1', CAPRI_USER_DATA: dir, CAPRI_NO_DEV_KEY: '1' } });
  await a.firstWindow();
  for (let i = 0; i < 100; i++) { if (await a.evaluate(() => !!globalThis.__capri)) return a; await new Promise(r => setTimeout(r, 100)); }
  throw Error('Startup failed');
};
let app = await start(); const results = [];
const record = result => { results.push(result); fs.writeFileSync(out, JSON.stringify({ results, profile: dir }, null, 2)); console.log(JSON.stringify(result)); };
const chat = async text => {
  const r = await app.evaluate(async (_, text) => { const a = globalThis.__capri; await a.convo.send(text); await a.convo.settle(); const m = a.history.recent(1)[0]; return { input: text, reply: m.content, error: m.meta?.error }; }, text);
  record(r); if (r.error) throw Error('Live chat failed');
};
const touch = async event => record(await app.evaluate(async (_, event) => { const a = globalThis.__capri; const before = a.scenes.recent().at(-1)?.at; await a.generatedRemark(event); const after = a.scenes.recent().at(-1); return { event, reply: after?.kind === 'said' && after.at !== before ? after.text : null, outcome: a.lastDialogueOutcome }; }, event));
try {
  await chat('I am choosing glaze for a ceramic fox with a crooked tail. I like pale blue, but what color do you actually want? Pick your own favorite and tell me why.');
  await chat('Pale blue still looks better. You sound far too confident about this.');
  await touch('pat');
  await chat('Was that enough to change your vote?');
  await chat('New subject. Today was exhausting. I just want quiet company for a minute, no pep talk.');
  await new Promise(r => setTimeout(r, 10500));
  await touch('poke');
  await chat('Thanks. What is seventeen times twenty-four?');
  // Use the real extractor once, explicitly, before verifying persisted state.
  await app.evaluate(() => globalThis.__capri.memoryLearner.schedule(0));
  const until = Date.now() + 85000;
  let reading;
  while (Date.now() < until) { reading = await app.evaluate(() => globalThis.__capri.conversationScene.snapshot().reading); if (reading || !fs.existsSync(path.join(dir, 'memory-learning-queue.json'))) break; await new Promise(r => setTimeout(r, 1000)); }
  record({ extractedScene: reading ?? null });
} finally { await app.close(); }
app = await start();
try {
  const scene = await app.evaluate(() => globalThis.__capri.conversationScene.snapshot());
  record({ persistedTurns: scene.entries.length, reading: scene.reading ?? null });
  if (!scene.entries.some(e => e.text.includes('exhausting'))) throw Error('Exchange lost across restart');
} finally { await app.close(); }
