// Renders the app icon from the character rig itself (no external art), then writes
// build/icon.png (256) and a multi-size build/icon.ico. Usage: npm run icons
import { _electron as electron } from 'playwright-core';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const outDir = path.join(root, 'build');
fs.mkdirSync(outDir, { recursive: true });
const ud = fs.mkdtempSync(path.join(os.tmpdir(), 'capri-icon-'));
fs.writeFileSync(path.join(ud, 'settings.json'), JSON.stringify({ firstRunComplete: true, character: { scale: 2.5, glitchEffects: false } }));
const app = await electron.launch({ args: [root], env: { ...process.env, CAPRI_TEST: '1', CAPRI_OFFSCREEN: process.env.CAPRI_ONSCREEN ? '0' : '1', CAPRI_USER_DATA: ud } });
const page = await app.firstWindow();
await page.waitForFunction(() => window.__capriDebug);
await page.evaluate(() => window.__capriDebug.force({ sleep: 0, blinkL: 0, blinkR: 0, glitch: 0, headYaw: 0, headRoll: 0.08, gazeX: 0, gazeY: 0, mouthSmile: 0.7, bodyX: 0, bodyY: 0, float: 0.4, hip: 0, breathe: 0 }));
await page.waitForTimeout(1500);
const vw = await page.evaluate(() => innerWidth);
const s = vw / 340; // rig units → css px
const head = { x: 170 * s, y: (314 - 144) * s }; // hip y + head offset
const half = 62 * s;
const png = await page.screenshot({ omitBackground: true, clip: { x: head.x - half, y: head.y - half * 1.05, width: half * 2, height: half * 2 } });
const sizes = [16, 24, 32, 48, 64, 128, 256];
const pngs = await app.evaluate(({ nativeImage }, { b64, sizes }) => {
  const img = nativeImage.createFromBuffer(Buffer.from(b64, 'base64'));
  return sizes.map((n) => img.resize({ width: n, height: n, quality: 'best' }).toPNG().toString('base64'));
}, { b64: png.toString('base64'), sizes });
await app.close();
const bufs = pngs.map((b) => Buffer.from(b, 'base64'));
fs.writeFileSync(path.join(outDir, 'icon.png'), bufs.at(-1));
// ICO container with embedded PNGs (supported since Windows Vista)
const header = Buffer.alloc(6); header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(bufs.length, 4);
let offset = 6 + 16 * bufs.length;
const dir = bufs.map((b, i) => {
  const e = Buffer.alloc(16); const n = sizes[i];
  e.writeUInt8(n >= 256 ? 0 : n, 0); e.writeUInt8(n >= 256 ? 0 : n, 1); e.writeUInt16LE(1, 4); e.writeUInt16LE(32, 6);
  e.writeUInt32LE(b.length, 8); e.writeUInt32LE(offset, 12); offset += b.length; return e;
});
fs.writeFileSync(path.join(outDir, 'icon.ico'), Buffer.concat([header, ...dir, ...bufs]));
try { fs.rmSync(ud, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 }); } catch { /* */ }
console.log('wrote build/icon.png and build/icon.ico', sizes.join(','));
