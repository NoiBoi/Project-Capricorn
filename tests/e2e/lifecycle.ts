import type { ElectronApplication } from 'playwright-core';
import { execFileSync } from 'node:child_process';

/** Every caller owns a synthetic profile. Never terminate another Capri process. */
export async function closeIsolatedApp(app: ElectronApplication | undefined, knownChild?: ReturnType<ElectronApplication['process']>) {
  if (!app) return;
  const child = knownChild ?? app.process();
  // The launcher wrapper can exit while the actual Electron main process lives.
  const nativePid = await Promise.race([app.evaluate(() => process.pid).catch(() => undefined), new Promise<undefined>(resolve => setTimeout(() => resolve(undefined), 1000))]);
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([app.evaluate(({ app: electronApp }) => electronApp.quit()).catch(() => {}), new Promise<void>(resolve => { timer = setTimeout(resolve, 5000); })]);
  } finally { clearTimeout(timer); }
  // app.quit() can acknowledge before Chromium flushes Local State (including
  // the OS-encrypted credential key). Allow the owned child to exit normally.
  if (child.exitCode === null && child.signalCode === null) {
    try {
      await Promise.race([new Promise<void>(resolve => child.once('exit', () => resolve())), new Promise<void>(resolve => { timer = setTimeout(resolve, 5000); })]);
    } finally { clearTimeout(timer); }
  }
  if (child.exitCode === null && child.signalCode === null) {
    // Playwright launches through cmd.exe on Windows. Killing only that wrapper
    // leaves its Electron child alive and holding the synthetic profile open.
    if (process.platform === 'win32' && child.pid) {
      try { execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }); }
      catch { /* The owned process may have exited during shutdown. */ }
    } else child.kill();
    try {
      await Promise.race([new Promise<void>(resolve => child.once('exit', () => resolve())), new Promise<void>(resolve => { timer = setTimeout(resolve, 5000); })]);
    } finally { clearTimeout(timer); }
  }
  if (process.platform === 'win32' && nativePid && nativePid !== process.pid) {
    try {
      process.kill(nativePid, 0);
      execFileSync('taskkill', ['/PID', String(nativePid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
    } catch { /* This exact owned main process has already exited. */ }
  }
}
