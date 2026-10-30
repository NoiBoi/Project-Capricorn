// Verifies the packaged installer end to end:
//  1. silent per-user install into a throwaway folder
//  2. checks installed layout (asar, unpacked native module, licenses, uninstaller)
//  3. runs the e2e suite against the INSTALLED Capri.exe with a fresh profile
//  4. measures packaged performance
//  5. silent uninstall and checks removal
import { execFileSync, execSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const installer = path.join(root, 'release', `Capri-Setup-${pkg.version}.exe`);
if (!fs.existsSync(installer)) throw new Error(`Installer not found: ${installer} (run npm run dist)`);
const target = path.join(os.tmpdir(), `capri-verify-${Date.now()}`);
const exe = path.join(target, `${pkg.productName}.exe`);
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`); };

console.log(`[verify] installing to ${target}`);
const t0 = Date.now();
execFileSync(installer, ['/S', `/D=${target}`], { stdio: 'inherit' });
check('silent install completes', fs.existsSync(exe), `${((Date.now() - t0) / 1000).toFixed(1)} s`);
check('app.asar present', fs.existsSync(path.join(target, 'resources', 'app.asar')));
const unpacked = path.join(target, 'resources', 'app.asar.unpacked', 'node_modules');
const koffiNode = fs.existsSync(unpacked) && execSync(`dir /s /b "${unpacked}\\*.node"`, { encoding: 'utf8', shell: 'cmd.exe' }).trim();
check('native FFI module unpacked', !!koffiNode, koffiNode ? path.basename(path.dirname(koffiNode)) : 'missing');
check('third-party licenses shipped', fs.existsSync(path.join(target, 'resources', 'THIRD_PARTY_LICENSES.md')));
check('Chromium/Electron notices shipped', fs.existsSync(path.join(target, 'LICENSES.chromium.html')));
const uninstaller = fs.readdirSync(target).find((f) => /^Uninstall .*\.exe$/i.test(f));
check('uninstaller present', !!uninstaller, uninstaller);
// Avoid locale-dependent decimal formatting and shell-profile output.
const directoryBytes = (dir) => fs.readdirSync(dir, { withFileTypes: true }).reduce((sum, entry) => {
  const file = path.join(dir, entry.name);
  return sum + (entry.isDirectory() ? directoryBytes(file) : fs.statSync(file).size);
}, 0);
const sizeMB = directoryBytes(target) / 1048576;
check('installed size reported', sizeMB > 0, `${sizeMB.toFixed(0)} MB on disk`);

// secrets must never ship: scan every installed file (incl. app.asar) for the dev key and for .env files
const envFile = path.join(root, '.env.local');
const devKey = process.env.GEMINI_API_KEY || (fs.existsSync(envFile) ? /GEMINI_API_KEY=(.+)/.exec(fs.readFileSync(envFile, 'utf8'))?.[1]?.trim() : '');
let leaks = 0, scanned = 0;
const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const f = path.join(d, e.name); if (e.isDirectory()) walk(f); else { scanned++; if (/^\.env/i.test(e.name)) leaks++; if (devKey && fs.statSync(f).size < 400 * 1048576 && fs.readFileSync(f).includes(Buffer.from(devKey))) leaks++; } } };
walk(target);
const asarList = execSync(`npx --yes @electron/asar list "${path.join(target, 'resources', 'app.asar')}"`, { cwd: root, encoding: 'utf8' });
if (/\.env|secrets\.bin|settings\.json/i.test(asarList)) leaks++;
check('no API keys or .env files in the installed app', leaks === 0, `${scanned} files + asar listing scanned${devKey ? ', dev key searched byte-for-byte' : ' (no local key to search for)'}`);
check('installer does not bundle .env.local', !fs.readFileSync(installer).includes(Buffer.from('GEMINI_API_KEY=')));

console.log('[verify] running e2e suite against the installed executable');
const e2e = spawnSync('npx', ['vitest', 'run', 'tests/e2e', '--no-file-parallelism', '--testTimeout=60000', '--hookTimeout=60000', '--reporter=dot'], {
  cwd: root, env: { ...process.env, CAPRI_EXE: exe }, encoding: 'utf8', shell: true,
});
const summary = (e2e.stdout + e2e.stderr).split('\n').filter((l) => /Tests\s+\d|Test Files|FAIL|×/.test(l)).join(' | ');
check('e2e suite passes on packaged build', e2e.status === 0, summary.trim());

console.log('[verify] measuring packaged performance');
const perf = spawnSync('node', ['scripts/perf.mjs', exe], { cwd: root, encoding: 'utf8' });
const perfJson = perf.stdout.slice(perf.stdout.indexOf('{'), perf.stdout.lastIndexOf('}') + 1);
try { const p = JSON.parse(perfJson); check('packaged performance measured', true, `startup ${p.startupToCharacterMs} ms, idle ${p.rows[0].cpuPct}% CPU / ${p.rows[0].memMB} MB, ${p.idleRenderFps} fps idle`); fs.writeFileSync(path.join(root, 'docs', 'perf-packaged.json'), JSON.stringify(p, null, 2)); }
catch { check('packaged performance measured', false, perf.stderr.slice(0, 300)); }

console.log('[verify] uninstalling');
execFileSync(path.join(target, uninstaller), ['/S', `_?=${target}`], { stdio: 'inherit' });
await new Promise((r) => setTimeout(r, 2000));
check('uninstall removes the program', !fs.existsSync(exe));
try { fs.rmSync(target, { recursive: true, force: true }); } catch { /* uninstaller with _? leaves its own exe */ }

const failed = results.filter((r) => !r.ok);
fs.writeFileSync(path.join(root, 'docs', 'verify-package.json'), JSON.stringify({ date: new Date().toISOString(), installer: path.basename(installer), results }, null, 2));
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
