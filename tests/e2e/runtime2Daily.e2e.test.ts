import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { _electron as electron, type ElectronApplication } from 'playwright-core';
import { expect, it } from 'vitest';
import { selectRuntime } from '../../src/main/runtime2/selection';
import { closeIsolatedApp } from './lifecycle';

it('operates daily-test controls in the existing panel, inspects an offline report, and restarts paused with persistent memory', async () => {
  const env = { ...process.env, CAPRI_RUNTIME: '2', CAPRI_V2_DAILY: '1', CAPRI_V2_PROFILE_ID: 'daily-fixture-' + randomUUID(), CAPRI_TEST: '1', CAPRI_OFFSCREEN: '1', CAPRI_NO_DEV_KEY: '1', CAPRI_V2_WINDOW_FOCUS: '0' };
  const dir = selectRuntime(env, os.homedir()).profile!;
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({ firstRunComplete: true, ai: { provider: 'offline' }, character: { startupIntro: false }, voice: { ttsEnabled: true } }));
  let app: ElectronApplication | undefined;
  try {
    app = await electron.launch({ args: [path.resolve(__dirname, '../..')], env });
    await expect.poll(() => app!.windows().some(w => /panel\.html/.test(w.url())), { timeout: 10000 }).toBe(true);
    const panel = app.windows().find(w => /panel\.html/.test(w.url()))!;
    await expect.poll(() => panel.getByText('Runtime 2 daily test', { exact: true }).isVisible()).toBe(true);
    const initial = await panel.evaluate(() => (window as any).capri.invoke('runtime2:daily-status'));
    expect(initial).toMatchObject({ paused: true, recording: { active: false }, usage: { requests: 0 }, readiness: { archive: { state: 'ready' }, chrome: { paired: false } } });
    await panel.getByRole('button', { name: 'Enable desktop context and movement', exact: true }).click();
    await expect.poll(() => panel.getByRole('status').allTextContents()).toContainEqual(expect.stringContaining('Desktop context'));
    await app.evaluate(() => {
      const runtime = (globalThis as any).__capri.runtime2;
      const provider = runtime.cognitive.provider;
      provider.client.getSession = async () => ({ status: 'connected', sharing: true });
      provider.client.listModels = async () => [{ slug: 'fixture-chat', displayName: 'Fixture chat', contextWindow: 128000 }];
      let count = 0;
      provider.client.streamResponse = async (options: any) => {
        count++; options.beforeRequest?.({ model: options.model, input: options.input, instructions: options.instructions, tools: options.tools, store: false, stream: true });
        if (count === 1) {
          const user = options.input.filter((r: any) => r.role === 'user' && typeof r.content === 'string').map((r: any) => JSON.parse(r.content)).findLast((r: any) => r.type === 'user_message');
          const result = { text: '', calls: [{ id: 'daily-memory', name: 'write_memory', arguments: JSON.stringify({ id: 'fixture-memory', kind: 'intention', text: 'Review fixture equations', evidence: [user.id], provenance: 'user-statement', status: 'active', dueAt: null, expectedRevision: 0 }) }], usage: { inputTokens: 12, outputTokens: 4 } };
          options.onProtocolEvent?.({ type: 'response.output_item.done', item: result.calls[0] }); return result;
        }
        options.onDelta?.('Saved the fixture intention.'); return { text: 'Saved the fixture intention.', calls: [], usage: { inputTokens: 18, outputTokens: 5 } };
      };
    });
    await panel.getByRole('button', { name: 'Load account models', exact: true }).click();
    await expect.poll(() => panel.getByRole('combobox', { name: 'Daily-test model' }).inputValue()).toBe('fixture-chat');
    await panel.getByRole('button', { name: 'Save settings', exact: true }).click();
    await expect.poll(() => panel.getByRole('status').allTextContents()).toContainEqual(expect.stringContaining('Saved.'));
    await panel.getByRole('button', { name: 'Start diagnostic session', exact: true }).click();
    await expect.poll(() => panel.evaluate(() => (window as any).capri.invoke('runtime2:daily-status'))).toMatchObject({ paused: false, recording: { active: true } });
    await panel.getByRole('textbox', { name: 'Message', exact: true }).fill('Remember to review the fixture equations.');
    await panel.getByRole('button', { name: 'Send', exact: true }).click();
    await expect.poll(() => panel.locator('.messages').innerText()).toContain('Saved the fixture intention.');
    const voiceFolder=(await panel.evaluate(()=>(window as any).capri.invoke('runtime2:daily-status'))).recording.folder;
    await expect.poll(()=>fs.readFileSync(path.join(voiceFolder,'events.jsonl'),'utf8').includes('speech.end'),{timeout:20000}).toBe(true);
    expect(fs.readFileSync(path.join(voiceFolder,'events.jsonl'),'utf8')).toContain('speech.start');
    expect(await panel.getByRole('button',{name:'Mute Capri',exact:true}).isEnabled()).toBe(true);
    await panel.getByRole('button', { name: 'Pause', exact: true }).click();
    await expect.poll(() => panel.evaluate(() => (window as any).capri.invoke('runtime2:daily-status'))).toMatchObject({ paused: true, usage: { requests: 2, inputTokens: 30, outputTokens: 9 } });
    await panel.getByRole('button', { name: 'Resume', exact: true }).click();
    await panel.getByRole('button', { name: 'Stop session', exact: true }).click();
    const stopped = await panel.evaluate(() => (window as any).capri.invoke('runtime2:daily-status'));
    await expect.poll(() => panel.evaluate(() => (window as any).capri.invoke('runtime2:daily-status'))).toMatchObject({ paused: true, recording: { active: false } });
    const folder = stopped.recording.folder;
    await expect.poll(() => fs.existsSync(path.join(folder, 'report.html'))).toBe(true);
    await expect.poll(() => fs.readFileSync(path.join(folder, 'report.html'), 'utf8').includes('session.stop')).toBe(true);
    const report = await app.evaluate(async ({ BrowserWindow }, url) => { const w = new BrowserWindow({ show: false, webPreferences: { sandbox: true } }); await w.loadURL(url); return w.webContents.id; }, pathToFileURL(path.join(folder, 'report.html')).href);
    const viewer = app.windows().find(w => /report\.html/.test(w.url()))!;
    const errors: string[] = []; viewer.on('pageerror', error => errors.push(error.message));
    await expect.poll(() => viewer.locator('#timeline article').count()).toBeGreaterThan(0);
    if (process.env.CAPRI_DAILY_TEST_OUTPUT) await viewer.screenshot({ path: path.join(path.resolve(process.env.CAPRI_DAILY_TEST_OUTPUT), 'controlled-session-report.png') });
    expect(await viewer.locator('#summary').textContent()).toContain('networkRequests');
    await viewer.locator('#filter').fill('request.wire');
    const details = viewer.locator('#timeline details').first(); await details.locator('summary').click();
    await details.getByRole('link', { name: 'Open exact inference record and images' }).click();
    await expect.poll(() => viewer.locator('pre').innerText()).toContain('Remember to review the fixture equations.');
    expect(errors).toEqual([]);
    await app.evaluate(({ webContents }, id) => webContents.fromId(id)?.close(), report);
    await closeIsolatedApp(app); app = undefined;
    app = await electron.launch({ args: [path.resolve(__dirname, '../..')], env });
    await expect.poll(() => app!.evaluate(() => !!(globalThis as any).__capri?.runtime2)).toBe(true);
    const restored = await app.evaluate(async () => { const r = (globalThis as any).__capri.runtime2; return { memories: await r.archive.findState({}), history: await r.chatHistory(), collecting: r.collecting }; });
    expect(restored.collecting).toBe(false); expect(restored.memories).toMatchObject([{ id: 'fixture-memory', revision: 1 }]); expect(restored.history).toHaveLength(2);
    if (process.env.CAPRI_DAILY_TEST_OUTPUT) {
      const output = path.resolve(process.env.CAPRI_DAILY_TEST_OUTPUT); fs.mkdirSync(output, { recursive: true });
      fs.cpSync(folder, path.join(output, 'controlled-session'), { recursive: true });
    }
  } finally {
    await closeIsolatedApp(app);
    if (path.dirname(dir) !== path.join(os.homedir(), 'Documents', 'Capri Buddy 2.0 Synthetic')) throw Error('Unexpected fixture profile');
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
