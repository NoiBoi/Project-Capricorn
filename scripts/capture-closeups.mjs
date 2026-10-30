// Face close-ups for the trailer, from the app's own renderer: off-screen, deterministic (every
// frame advances exactly 1/30 s of the real animation system), cropped around her face, transparent PNGs,
// rendered at 7x so a full-screen close-up stays sharp.
//   node scripts/capture-closeups.mjs   ->  trailer/public/clips/faces/<shot>/<frame>.png + faces.json
import { _electron as electron } from 'playwright-core';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const out = path.join(root, 'trailer', 'public', 'clips', 'faces');
const FPS = 30;
// shot, frames, what to do on frame 0 (each one of her real clips / states)
const SHOTS = [
  ['smug', 52, "clip('smug')"],
  ['maniac', 60, "clip('maniac_grin')"],
  ['wink', 40, "clip('wink')"],
  ['many_eyes', 58, "clip('many_eyes')"],
  ['tilt_grin', 54, "clip('tilt_grin')"],
  ['talk', 60, "d.setPhase('speaking'); d.lips(true)"],
  ['happy', 48, "d.behavior.react('happy')"],
];

fs.mkdirSync(out, { recursive: true });
const ud = fs.mkdtempSync(path.join(os.tmpdir(), 'capri-faces-'));
fs.writeFileSync(path.join(ud, 'settings.json'), JSON.stringify({
  firstRunComplete: true, ai: { provider: 'offline' }, voice: { ttsEnabled: false }, teleport: { auto: false },
  character: { glitchEffects: true, animationIntensity: 1 },
}));
const app = await electron.launch({ args: [root], env: { ...process.env, CAPRI_TEST: '1', CAPRI_OFFSCREEN: '1', CAPRI_NO_DEV_KEY: '1', CAPRI_USER_DATA: ud, CAPRI_CAPTURE_SCALE: '7' } });
const page = await app.firstWindow();
await page.waitForFunction(() => window.__capriDebug);
await page.waitForTimeout(800);
await page.evaluate(() => {
  const d = window.__capriDebug;
  d.manual(true);
  window.__cap = {
    reset() { d.force(null); d.setPhase('idle'); d.lips(false); d.setPointer(0.05, 0.05); d.setSurface('window'); d.behavior.clip = null; d.behavior.state = 'idle'; d.behavior.setPosture('sit_edge'); },
    run(code) { const clip = (n) => d.behavior.playClip(n); void clip; eval(code); },
    // the face: centred on her two blue irises, found in the rendered frame; a 16:9 box around it
    faceBox() {
      const c = document.getElementById('stage'), g = c.getContext('2d'), { width: W, height: H } = c;
      const px = g.getImageData(0, 0, W, H).data;
      let sx = 0, sy = 0, n = 0;
      for (let y = 0; y < H; y += 2) for (let x = 0; x < W; x += 2) { const i = (y * W + x) * 4; if (px[i + 2] > 170 && px[i] < 90 && px[i + 1] > 60 && px[i + 1] < 170 && px[i + 3] > 200) { sx += x; sy += y; n++; } }
      const cx = sx / n, cy = sy / n, w = Math.round(W * 0.36), h = Math.round(w * 9 / 16);
      return { x: Math.min(W - w, Math.max(0, Math.round(cx - w / 2))), y: Math.min(H - h, Math.max(0, Math.round(cy - h * 0.42))), w, h };
    },
  };
});
const index = {};
for (const [name, frames, code] of SHOTS) {
  const dir = path.join(out, name);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  await page.evaluate(() => { window.__cap.reset(); window.__capriDebug.step(1 / 30, 45); }); // settle into the pose
  const box = await page.evaluate(() => window.__cap.faceBox());
  await page.evaluate((c) => window.__cap.run(c), code);
  for (let i = 0; i < frames; i++) {
    const url = await page.evaluate((b) => { window.__capriDebug.step(1 / 30); return window.__capriDebug.grab(b, 1, 'image/png'); }, box);
    fs.writeFileSync(path.join(dir, `${String(i).padStart(3, '0')}.png`), Buffer.from(url.split(',')[1], 'base64'));
  }
  index[name] = { frames, w: box.w, h: box.h };
  console.log(name, frames, 'frames', `${box.w}x${box.h}`);
}
fs.writeFileSync(path.join(out, 'faces.json'), JSON.stringify({ fps: FPS, shots: index }, null, 2) + '\n');
await app.close();
fs.rmSync(ud, { recursive: true, force: true });
