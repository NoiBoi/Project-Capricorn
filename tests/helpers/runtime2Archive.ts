import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildSync } from 'esbuild';
import { afterAll } from 'vitest';
// Unit tests exercise current worker source even on a fresh checkout without dist/.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'capri-archive-worker-'));
export const archiveWorkerPath = path.join(dir, 'worker.cjs');
buildSync({ entryPoints: [path.resolve('src/main/runtime2/windowFocusArchiveWorker.ts')], outfile: archiveWorkerPath, bundle: true, platform: 'node', format: 'cjs', target: 'es2023' });
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));
