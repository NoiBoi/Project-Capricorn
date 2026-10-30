// Renders review stills at given seconds into out/stills (quarter or half scale).
import { bundle } from "@remotion/bundler";
import { renderStill, selectComposition } from "@remotion/renderer";
import path from "node:path";
import fs from "node:fs";
const root = path.resolve(import.meta.dirname, "..");
const times = process.argv.slice(2).map(Number);
// Remotion's bundled browser path exceeds MAX_PATH in deep folders; point REMOTION_CHROME at a copy.
const tmpChrome = path.join(process.env.TEMP ?? "", "rchrome", "chrome-headless-shell.exe");
const browserExecutable = process.env.REMOTION_CHROME ?? (fs.existsSync(tmpChrome) ? tmpChrome : null);
const scale = Number(process.env.SCALE ?? 0.4);
const serveUrl = await bundle({ entryPoint: path.join(root, "src/index.ts"), publicDir: path.join(root, "public") });
const composition = await selectComposition({ serveUrl, id: "CapriTrailer", browserExecutable });
fs.mkdirSync(path.join(root, "out/stills"), { recursive: true });
for (const t of times) {
  const frame = Math.round(t * 30);
  const output = path.join(root, `out/stills/${String(t.toFixed(2)).padStart(6, "0")}.jpg`);
  await renderStill({ serveUrl, composition, frame, output, scale, imageFormat: "jpeg", jpegQuality: 80, chromiumOptions: { gl: "angle" }, browserExecutable });
  console.log("ok", t);
}
