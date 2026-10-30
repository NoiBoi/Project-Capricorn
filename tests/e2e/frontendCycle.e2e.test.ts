import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { _electron as electron, type ElectronApplication } from 'playwright-core';
import { afterEach, expect, it } from 'vitest';
import { closeIsolatedApp } from './lifecycle';
let app: ElectronApplication | undefined, dir: string;
afterEach(async () => { await closeIsolatedApp(app); app = undefined; if (dir) fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); });
async function boot() {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'capri-frontend-'));
  fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({ firstRunComplete: true, ai: { provider: 'offline' }, character: { startupIntro: false }, voice: { ttsEnabled: false, interactionLines: false }, behavior: { smallActivities: false }, teleport: { auto: false } }));
  app = await electron.launch({ ...(process.env.CAPRI_EXE ? { executablePath: process.env.CAPRI_EXE, args: [] } : { args: [path.resolve(__dirname, '../..')] }), env: { ...process.env, CAPRI_TEST: '1', CAPRI_OFFSCREEN: '1', CAPRI_USER_DATA: dir, CAPRI_NO_DEV_KEY: '1' } });
  const char = await app.firstWindow(); await char.waitForFunction(() => !!(window as any).__capriDebug);
  const opened = app.waitForEvent('window'); await char.evaluate(() => window.capri.invoke('panel:open', 'settings')); const panel = await opened;
  await panel.waitForSelector('.settings-grid'); return { a: app, char, panel };
}
it('navigates settings suggestions by keyboard and keeps developer tools in their own window', async () => {
  const { a, panel } = await boot();
  if (process.env.CAPRI_QA_DIR) { fs.mkdirSync(process.env.CAPRI_QA_DIR,{recursive:true}); await panel.screenshot({path:path.join(process.env.CAPRI_QA_DIR,'settings.png')}); }
  const errors: string[] = []; panel.on('pageerror', error => errors.push(error.message));
  const search = panel.getByRole('combobox', { name: 'Search settings' });
  await search.fill('quiet hours');
  await expect.poll(() => panel.getByRole('option').count()).toBeGreaterThan(0);
  await search.press('ArrowDown'); await search.press('Enter');
  await expect.poll(() => panel.locator('h1').textContent()).toBe('Attention & quiet');
  await expect.poll(() => panel.getByRole('switch', { name: 'Quiet hours', exact: true }).evaluate(el => el.closest('.field')!.classList.contains('search-hit'))).toBe(true);
  const opened = a.waitForEvent('window'); await panel.getByRole('button', { name: 'Developer tools ↗' }).click(); const dev = await opened;
  await dev.waitForSelector('#dev-state .dev-card');
  if (process.env.CAPRI_QA_DIR) await dev.screenshot({path:path.join(process.env.CAPRI_QA_DIR,'developer.png')});
  expect(await a.evaluate(() => { const a = (globalThis as any).__capri; return a.panelWin.id !== a.developerWin.id; })).toBe(true);
  const devSearch = dev.getByRole('combobox', { name: 'Search diagnostics & tests' });
  await devSearch.fill('recent decisions'); await devSearch.press('Enter');
  expect(await dev.locator('.dev-pane:not([hidden])').textContent()).toContain('Recent decisions');
  await devSearch.fill('cursor visit'); await devSearch.press('Enter');
  expect(await dev.getByRole('button', { name: 'Cursor visit and return', exact: true }).isVisible()).toBe(true);
  await dev.getByRole('button', { name: 'Pause live view' }).click();
  expect(await dev.getByRole('button', { name: 'Resume live view' }).isVisible()).toBe(true);
  const closed = dev.waitForEvent('close'); await dev.keyboard.press('Escape').catch(error => { if (!dev.isClosed()) throw error; }); await closed;
  expect(await panel.locator('h1').textContent()).toBe('Attention & quiet');
  expect(errors).toEqual([]);
});
it('settles after a small window adjustment and releases a closed target', async () => {
  const { a, char } = await boot();
  await a.evaluate(({ screen }) => {
    const g = globalThis as any, area = screen.getPrimaryDisplay().workArea;
    const rect = { x: area.x + 50, y: area.y + 480, width: 950, height: 400 };
    g.__capriWindowsOverride = [{ handle: 17n, rect }]; g.__capriFgOverride = rect;
    g.__capriWindowInfo = { '17': { title: 'A test document', process: 'fixture.exe' } };
  });
  expect((await char.evaluate(() => window.capri.invoke('teleport:now', 'perch'))).ok).toBe(true);
  const before = await a.evaluate(() => (globalThis as any).__capri.charWin.getBounds());
  await a.evaluate(() => { const g = globalThis as any; const w = g.__capriWindowsOverride[0]; g.__capriWindowsOverride = [{ ...w, rect: { ...w.rect, x: w.rect.x + 24, y: w.rect.y + 12 } }]; g.__capri.perchTick(); });
  await expect.poll(() => a.evaluate(() => (globalThis as any).__capri.charWin.getBounds().y), { timeout: 5000 }).toBe(before.y + 12);
  await expect.poll(() => a.evaluate(() => (globalThis as any).__capri.teleporter.active), { timeout: 5000 }).toBe(false);
  const after = await a.evaluate(() => { const a = (globalThis as any).__capri; return { bounds: a.charWin.getBounds(), moving: a.teleporter.active }; });
  expect(after.bounds.x - before.x).toBeCloseTo(24, 0); expect(after.bounds.y - before.y).toBeCloseTo(12, 0); expect(after.moving).toBe(false);
  await a.evaluate(() => { const g = globalThis as any; g.__capriWindowsOverride = []; g.__capri.perchTick(); });
  await expect.poll(() => char.evaluate(() => (window as any).__capriDebug.attachment)).not.toBe('perch');
});
it('keeps capability changes off until requested and restores existing choices', async () => {
  const { a, panel } = await boot();
  expect(await panel.getByRole('switch', { name: 'More capable Capri' }).isChecked()).toBe(false);
  const before = await a.evaluate(() => (globalThis as any).__capri.settings.get());
  await panel.getByRole('switch', { name: 'More capable Capri' }).check();
  await expect.poll(() => a.evaluate(() => (globalThis as any).__capri.settings.get().actions.policies.read_screen)).toBe('allow');
  await panel.getByRole('switch', { name: 'More capable Capri' }).uncheck();
  await expect.poll(() => a.evaluate(() => (globalThis as any).__capri.settings.get())).toEqual(before);
  expect(await a.evaluate(() => (globalThis as any).__capri.memory.approved().length)).toBe(0);
});
