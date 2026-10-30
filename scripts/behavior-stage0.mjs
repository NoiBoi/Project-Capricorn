import { build } from 'esbuild';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'capri-stage0-build-'));
const out = path.join(temp, 'replay.cjs');
await build({ entryPoints: [process.argv.includes('--live') ? 'scripts/behavior-stage0-live.ts' : 'scripts/behavior-stage0.ts'], outfile: out,
  bundle: true, loader:{'.md':'text'}, platform: 'node', format: 'cjs', target: 'node22' });
const result = spawnSync(process.execPath, [out, ...process.argv.slice(2).filter(x => x !== '--live')], { stdio: 'inherit', windowsHide: true });
process.exitCode = result.status ?? 1;
