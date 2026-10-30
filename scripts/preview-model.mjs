// Renders Capri through the app's own renderer (off-screen, deterministic clock) in every pose and the
// main expressions/effects, and writes a contact sheet for review: node scripts/preview-model.mjs [outDir]
// Each frame is also checked for clipping: no opaque pixel may touch the window edge.
import { _electron as electron } from 'playwright-core';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';

const out = process.argv[2] ?? 'docs/previews/model';
fs.mkdirSync(out, { recursive: true });
const ud = fs.mkdtempSync(path.join(os.tmpdir(), 'capri-model-'));
fs.writeFileSync(path.join(ud, 'settings.json'), JSON.stringify({ firstRunComplete: true, ai: { provider: 'offline' }, voice: { ttsEnabled: false }, teleport: { auto: false }, character: { glitchEffects: true } }));
const app = await electron.launch({ args: [process.cwd()], env: { ...process.env, CAPRI_TEST: '1', CAPRI_OFFSCREEN: '1', CAPRI_NO_DEV_KEY: '1', CAPRI_USER_DATA: ud } });
const page = await app.firstWindow();
await page.waitForFunction(() => window.__capriDebug?.model);
await page.evaluate(() => window.__capriDebug.manual(true));

// [name, setup code, steps, forced params]
const SHOTS = [
  ['sit_window', "d.setSurface('window'); d.behavior.setPosture('sit_edge')", 40, {}],
  ['lie_taskbar', "d.setSurface('taskbar'); d.behavior.setPosture('recline')", 40, {}],
  ['float_air', "d.setSurface('air'); d.behavior.setPosture('air_sit')", 40, {}],
  ['sit_air', "d.setSurface('air'); d.behavior.setPosture('stand')", 40, {}],
  ['look_left', "d.setSurface('window'); d.behavior.setPosture('sit_edge')", 30, { gazeX: -0.9, headYaw: -0.6 }],
  ['turned', "d.setSurface('window'); d.behavior.setPosture('sit_edge')", 30, { turn: 1, gazeX: 0.8 }],
  ['blink', "d.setSurface('window')", 10, { blinkL: 1, blinkR: 1 }],
  ['menace', "d.setSurface('window')", 20, { squint: 0.9, mouthSmile: 0.6 }],
  ['grin_talk', "d.setSurface('window')", 20, { mouthOpen: 0.8, mouthSmile: 1, eyeWide: 0.4 }],
  ['happy', "d.setSurface('window')", 20, { happyEyes: 1, mouthSmile: 1 }],
  ['back_taskbar', "d.setSurface('taskbar'); d.behavior.setPosture('stand')", 40, { back: 1 }],
  ['talk', "d.setSurface('window')", 20, { mouthOpen: 0.45, mouthSmile: 0.45 }],
  ['maniac', "d.setSurface('window')", 20, { mouthOpen: 0.85, mouthSmile: 1, eyeWide: 0.9 }],
  ['smug', "d.setSurface('window')", 20, { mouthSmile: 0.8, squint: 0.4 }],
  ['pout', "d.setSurface('window')", 20, { mouthSmile: -0.8, squint: 0.5 }],
  ['surprised', "d.setSurface('window')", 20, { mouthOpen: 0.7, mouthSmile: 0, eyeWide: 1 }],
  ['many_eyes', "d.setSurface('window')", 20, { manyEyes: 1, eyeWide: 0.6 }],
  ['blank', "d.setSurface('window')", 20, { blankEyes: 1, eyeWide: 0.6 }],
  ['sleep', "d.setSurface('taskbar'); d.behavior.setPosture('recline')", 20, { sleep: 1 }],
  ['hair_stream', "d.setSurface('air'); d.behavior.setPosture('air_sit')", 20, { hairStream: 1, hairWind: 1 }],
  ['glitch_slice', "d.setSurface('window'); d.behavior.setPosture('sit_edge'); d.model.glitchNow('slice', 1)", 2, {}],
  ['glitch_shatter', "d.model.glitchNow('shatter', 1)", 4, {}],
  ['glitch_ghost', "d.model.glitchNow('ghost', 1)", 2, {}],
  ['teleport_out', "d.teleportFx('out')", 6, {}],
];
const report = [];
for (const [name, code, steps, force] of SHOTS) {
  const r = await page.evaluate(({ code, steps, force }) => {
    const d = window.__capriDebug;
    d.force(Object.keys(force).length ? { glitch: 0, ...force } : null);
    eval(code);
    d.step(1 / 30, steps);
    const c = document.getElementById('stage');
    const px = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let edge = 0;
    for (let x = 0; x < c.width; x++) { if (px[(x) * 4 + 3] > 30) edge++; if (px[((c.height - 1) * c.width + x) * 4 + 3] > 30) edge++; }
    for (let y = 0; y < c.height; y++) { if (px[(y * c.width) * 4 + 3] > 30) edge++; if (px[(y * c.width + c.width - 1) * 4 + 3] > 30) edge++; }
    return { img: d.grab(undefined, 1, 'image/png'), edge, pose: d.pose, size: [c.width, c.height] };
  }, { code, steps, force });
  fs.writeFileSync(path.join(out, `${name}.png`), Buffer.from(r.img.split(',')[1], 'base64'));
  report.push({ name, pose: r.pose, edgePixels: r.edge });
  console.log(`${name.padEnd(15)} pose=${r.pose.padEnd(7)} edge-pixels=${r.edge}  canvas=${r.size.join('x')}`);
}
fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 1));
await app.close();
