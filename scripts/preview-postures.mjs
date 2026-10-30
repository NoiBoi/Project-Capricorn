import { _electron as electron } from 'playwright-core';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
const out = process.argv[2]; fs.mkdirSync(out, { recursive: true });
const ud = fs.mkdtempSync(path.join(os.tmpdir(), 'capri-post-'));
fs.writeFileSync(path.join(ud, 'settings.json'), JSON.stringify({ firstRunComplete: true, ai: { provider: 'offline' }, voice: { ttsEnabled: false }, character: { glitchEffects: false }, teleport: { auto: false } }));
const app = await electron.launch({ args: [process.cwd()], env: { ...process.env, CAPRI_TEST: '1', CAPRI_OFFSCREEN: '1', CAPRI_NO_DEV_KEY: '1', CAPRI_USER_DATA: ud } });
const page = await app.firstWindow();
await page.waitForFunction(() => window.__capriDebug);
const names = await page.evaluate(() => Object.keys(window.__capriDebug.postures));
for (const n of names) {
  await page.evaluate(() => window.__capriDebug.behavior.setPosture('stand'));
  await page.evaluate((n) => window.__capriDebug.force({ sleep: 0, blinkL: 0, blinkR: 0, glitch: 0, ...window.__capriDebug.postures[n].pose }), n);
  await page.waitForTimeout(1500);
  await page.screenshot({ path: path.join(out, `post_${n}.png`), omitBackground: true });
}
for (const [n, p] of Object.entries({ happy_arcs: { happyEyes: 1, mouthSmile: 1, headRoll: 0.15 }, blank: { blankEyes: 1, eyeWide: 0.6, mouthOpen: 0.3, mouthSmile: 0 }, reach: { armRRaise: 0.62, armRWave: 0.6, clawScale: 1.9, eyeWide: 0.4, mouthSmile: 0.9 }, dash: { hairStream: 1, lean: 0.15, thighL: 20, kneeL: 40, thighR: -10, kneeR: 50 }, three_quarter: { turn: 0.5, gazeX: 0.5 }, profile_right: { turn: 1, gazeX: 0.8 }, profile_left: { turn: -1, gazeX: -0.8, thighL: 8, kneeL: 20 }, back: { back: 1, turn: 0.2 } })) {
  await page.evaluate(() => { window.__capriDebug.setSurface('air'); window.__capriDebug.behavior.setPosture('stand'); });
  await page.evaluate((p) => window.__capriDebug.force({ sleep: 0, blinkL: 0, blinkR: 0, glitch: 0, ...p }), p);
  await page.waitForTimeout(1500);
  await page.screenshot({ path: path.join(out, `post_${n}.png`), omitBackground: true });
}
await app.close();
