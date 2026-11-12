import path from 'node:path';
import fs from 'node:fs';

/** An explicit installed-app entry point; cloud work still starts paused. */
export function runtimeEnvironment(env: NodeJS.ProcessEnv, argv: string[]) {
  return argv.includes('--runtime2') ? { ...env, CAPRI_RUNTIME: '2', CAPRI_V2_DAILY: '1', CAPRI_V2_PROFILE_ID: env.CAPRI_V2_PROFILE_ID ?? 'daily-test' } : env;
}

/** Resolve before any store or Electron session opens. Never adopt a legacy profile. */
export function selectRuntime(env: NodeJS.ProcessEnv, home: string, packaged = false) {
  const mode = env.CAPRI_RUNTIME ?? 'legacy';
  if (mode !== 'legacy' && mode !== '2') throw Error('CAPRI_RUNTIME must be legacy or 2.');
  if (mode === 'legacy') return { mode, profile: undefined } as const;
  if (packaged && env.CAPRI_V2_DAILY !== '1') throw Error('Packaged Runtime 2 requires the paused daily-session controls. Launch with --runtime2.');
  const id = env.CAPRI_V2_PROFILE_ID ?? 'phase1';
  if (!/^[a-zA-Z0-9_-]{1,80}$/.test(id)) throw Error('Invalid synthetic profile identifier.');
  // Deliberately ignore CAPRI_USER_DATA in this mode: it can name a real profile.
  const profile = path.join(home, 'Documents', 'Capri Buddy 2.0 Synthetic', id);
  return { mode, profile } as const;
}

export function assertSyntheticProfile(profile: string) {
  // A junction/symlink must not redirect synthetic writes into the real profile.
  for (let p = path.resolve(profile); ; p = path.dirname(p)) {
    try { if (fs.lstatSync(p).isSymbolicLink()) throw Error('Synthetic profile cannot traverse a link.'); }
    catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }
    if (path.dirname(p) === p) break;
  }
}
