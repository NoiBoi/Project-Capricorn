// Explicit live smoke check: uses the user's signed-in Codex account for two requests.
// All windows stay offscreen, and computer actions are evaluated, never physically executed.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { _electron as electron } from 'playwright-core';

const root = path.resolve(import.meta.dirname, '..');
const qa = path.resolve(root, '../../work/functional-check');
fs.mkdirSync(qa, { recursive: true });
const profile = path.join(qa, `profile-${Date.now()}`);
fs.mkdirSync(profile);
fs.writeFileSync(path.join(profile, 'settings.json'), JSON.stringify({ firstRunComplete: true, ai: { provider: 'codex', requestTimeoutSec: 120 }, voice: { ttsEnabled: false }, teleport: { auto: false }, character: { glitchEffects: false } }));
const app = await electron.launch({ args: [root], env: { ...process.env, CAPRI_TEST: '1', CAPRI_OFFSCREEN: '1', CAPRI_USER_DATA: profile }, timeout: 30000 });
const report = {};
try {
  const char = await app.firstWindow();
  await char.waitForFunction(() => window.__capriDebug);
  const errors = [];
  char.on('pageerror', (e) => errors.push(e.message));
  report.artwork = await char.evaluate(() => ({ art: window.__capriDebug.model.artwork, strips: window.__capriDebug.model.images.size, clip: window.__capriDebug.model.activeClip }));
  await char.screenshot({ path: path.join(qa, 'character.png'), omitBackground: true });
  const panelWait = app.waitForEvent('window');
  await char.evaluate(() => window.capri.invoke('panel:open', 'chat'));
  const panel = await panelWait;
  await panel.waitForSelector('textarea');
  await panel.evaluate(() => window.capri.invoke('chat:send', { text: 'Hey Capri. Introduce yourself in one short sentence and tell me you are ready to hang out on my desktop. Do not perform any actions.' }));
  await app.evaluate(async () => { await globalThis.__capri.convo.settle(); });
  report.chat = await panel.evaluate(() => window.capri.invoke('chat:history', { limit: 2 }));
  if (!report.chat.some((m) => m.role === 'assistant' && !m.meta?.error && m.content.length > 5)) throw new Error('No real Codex reply');
  await panel.screenshot({ path: path.join(qa, 'chat.png') });
  // Exercise the original asset states through the actual rendering/behavior pipeline.
  report.states = await char.evaluate(() => {
    const d = window.__capriDebug;
    d.manual(true);
    const out = [];
    for (const [label, surface, force] of [['idle', 'air', { sleep: 0, mouthSmile: 0.35, blinkL: 0, blinkR: 0 }], ['perch', 'window', { sleep: 0, mouthSmile: 0.35, blinkL: 0, blinkR: 0 }], ['sleep', 'air', { sleep: 1 }]]) {
      d.setSurface(surface); d.force(force); d.step(1 / 30, 100);
      const canvas = document.querySelector('canvas');
      const px = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
      let alpha = 0; for (let i = 3; i < px.length; i += 4) if (px[i] > 40) alpha++;
      out.push({ label, clip: d.model.activeClip, pixels: alpha });
    }
    d.force(null); d.manual(false);
    return out;
  });
  if (report.states.some((s) => s.pixels < 1000)) throw new Error('A sprite state did not render');
  const bundle = path.join(qa, 'codex-check.mjs');
  await build({ entryPoints: [path.join(root, 'src/main/ai/codexAccount.ts')], outfile: bundle, bundle: true, format: 'esm', platform: 'node', packages: 'external' });
  // Resolve the project's external dependencies from its own node_modules.
  const localBundle = path.join(root, 'node_modules/.cache/capri-live-check.mjs');
  fs.mkdirSync(path.dirname(localBundle), { recursive: true }); fs.copyFileSync(bundle, localBundle);
  const { runCodex } = await import(pathToFileURL(localBundle).href);
  const jpeg = await app.evaluate(({ nativeImage }, file) => nativeImage.createFromPath(file).toJPEG(85).toString('base64'), path.join(qa, 'character.png'));
  const raw = await runCodex('You are checking a desktop companion screenshot. Look at the attached image. Return JSON only: {"actions":[{"action":"done","result":"a short description of the character colors visible"}]}. Do not use tools or execute any actions.', { signal: new AbortController().signal, timeoutMs: 120000, jpegBase64: jpeg });
  report.vision = JSON.parse(raw.replace(/^```(?:json)?\s*|\s*```$/g, '').trim());
  if (report.vision.actions?.[0]?.action !== 'done') throw new Error('Vision decision did not return valid actions');
  report.rendererErrors = errors;
  if (errors.length) throw new Error(errors.join('\n'));
  report.ok = true;
} finally {
  await app.close();
  fs.writeFileSync(path.join(qa, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}
