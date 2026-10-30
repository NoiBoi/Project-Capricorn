// Art-iteration harness: launches the app (isolated profile), forces poses and saves
// transparent screenshots of the character window. Usage: node scripts/preview.mjs [outDir]
import { _electron as electron } from 'playwright-core';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const outDir = path.resolve(process.argv[2] ?? path.join(root, 'docs', 'previews'));
fs.mkdirSync(outDir, { recursive: true });
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'capri-preview-'));
fs.writeFileSync(path.join(userData, 'settings.json'), JSON.stringify({ firstRunComplete: true, character: { scale: 1.6, glitchEffects: false } }));

const app = await electron.launch({ args: [root], env: { ...process.env, CAPRI_TEST: '1', CAPRI_OFFSCREEN: process.env.CAPRI_ONSCREEN ? '0' : '1', CAPRI_USER_DATA: userData } });
const page = await app.firstWindow();
await page.waitForFunction(() => window.__capriDebug);
const poses = {
  neutral: {},
  blink: { blinkL: 1, blinkR: 1 },
  talk: { mouthOpen: 0.8, mouthSmile: 0.5, maskGlow: 0.8 },
  happy: { squint: 0.6, mouthSmile: 1, mouthOpen: 0.35 },
  look_left: { headYaw: -0.8, gazeX: -1, headRoll: -0.1 },
  look_right_up: { headYaw: 0.7, gazeX: 1, gazeY: -0.6, headPitch: -0.4, headRoll: 0.12 },
  thinking: { gazeX: -0.6, gazeY: -0.6, headYaw: -0.3, squint: 0.35, armLRaise: 0.55, mouthSmile: 0 },
  wave: { armRRaise: 1, armRWave: 0.5, mouthSmile: 0.9, squint: 0.4 },
  surprised: { eyeWide: 1, mouthOpen: 0.6, mouthSmile: 0 },
  sleep: { sleep: 1, blinkL: 1, blinkR: 1, headPitch: 0.6, headRoll: 0.18 },
  reveal: { armSpread: 1, eyeWide: 0.3, mouthSmile: 0.85, mouthOpen: 0.25, headPitch: -0.1 },
  menace: { squint: 0.95, headPitch: 0.25, mouthSmile: 0.9, mouthOpen: 0.3 },
  many_eyes: { manyEyes: 1, eyeWide: 0.5 },
};
for (const [name, pose] of Object.entries(poses)) {
  await page.evaluate((p) => window.__capriDebug.force({ sleep: 0, blinkL: 0, blinkR: 0, glitch: 0, ...p }), pose);
  await page.waitForTimeout(1200);
  await page.screenshot({ path: path.join(outDir, `${name}.png`), omitBackground: true });
}
await app.close();
fs.rmSync(userData, { recursive: true, force: true });
console.log('saved', Object.keys(poses).length, 'previews to', outDir);
