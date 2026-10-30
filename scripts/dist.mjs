// Builds the Windows installer. NSIS cannot open include files whose full path
// exceeds 260 chars, so deep project folders are mapped to a temporary drive letter
// (subst) for the duration of the build and unmapped afterwards.
import { execSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
// Never clear an isolated test copy while Electron is still loading its resources.
if (process.platform === 'win32') {
  const stageExe = path.join(root, 'release-staged', 'win-unpacked', 'Capri Buddy.exe').replace(/'/g, "''");
  const busy = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `$capriStageExe='${stageExe}'; if (@(Get-Process -Name 'Capri Buddy' -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $capriStageExe }).Count) { exit 17 }; exit 0`], { windowsHide: true });
  if (busy.status === 17) throw new Error('Close isolated Capri test instances before packaging release-staged.');
  if (busy.status !== 0) throw new Error('Could not verify that the staging application is stopped.');
}
const run = (cmd, cwd) => execSync(cmd, { cwd, stdio: 'inherit', env: process.env });

run('node scripts/build.mjs --prod', root);
run('node scripts/licenses.mjs', root);

let cwd = root;
let drive = null;
if (process.platform === 'win32' && root.length > 80) {
  const substs = execSync('subst', { encoding: 'utf8' });
  drive = 'PQRSTUVWXY'.split('').map((l) => `${l}:`).find((d) => !fs.existsSync(`${d}\\`) && !substs.includes(`${d}\\`));
  if (!drive) throw new Error('No free drive letter for subst');
  run(`subst ${drive} "${root}"`, root);
  cwd = `${drive}\\`;
  console.log(`[dist] long path → building via ${drive}`);
}
try {
  // The unpacked application may be running from release/win-unpacked. Never
  // replace its renderer/preload files while it can still open another window.
  run('npx electron-builder --win nsis --publish never --config.directories.output=release-staged', cwd);
} finally {
  if (drive) run(`subst ${drive} /D`, root);
}
const out = path.join(root, 'release');
fs.mkdirSync(out, { recursive: true });
const staged = path.join(root, 'release-staged');
const version = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;
const currentArtifacts = new Set([`Capri-Setup-${version}.exe`, `Capri-Setup-${version}.exe.blockmap`, 'latest.yml', 'builder-debug.yml']);
for (const f of fs.readdirSync(staged).filter(x => currentArtifacts.has(x))) {
  fs.copyFileSync(path.join(staged, f), path.join(out, f));
}
for (const f of fs.readdirSync(out).filter((x) => x.endsWith('.exe'))) {
  console.log(`[dist] ${f}  ${(fs.statSync(path.join(out, f)).size / 1048576).toFixed(1)} MB`);
}
