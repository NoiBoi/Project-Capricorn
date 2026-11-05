import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { _electron as electron, type ElectronApplication } from 'playwright-core';
import { expect, it } from 'vitest';
import { selectRuntime } from '../../src/main/runtime2/selection';
import { closeIsolatedApp } from './lifecycle';
it('routes the existing chat UI through a mocked cognitive provider, real native observations and durable tools across restart', async () => {
  const env = { ...process.env, CAPRI_RUNTIME: '2', CAPRI_V2_PROFILE_ID: 'cognitive-' + randomUUID(), CAPRI_TEST: '1', CAPRI_OFFSCREEN: '1', CAPRI_NO_DEV_KEY: '1', CAPRI_V2_MODEL: 'synthetic-chat', CAPRI_V2_AMBIENT_MS: '60000' };
  const dir = selectRuntime(env, os.homedir()).profile!;
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({ firstRunComplete: true, ai: { provider: 'offline' }, memory: { enabled: false }, voice: { ttsEnabled: false }, character: { startupIntro: false }, actions: { policies: { read_screen: 'allow' } } }));
  // Synthetic credentials exercise the real SDK storage and Windows encryption;
  // the inference provider is replaced below before any test request is sent.
  const authFile = path.join(dir, 'runtime2', 'siwc', 'chatgpt-auth.json');
  fs.mkdirSync(path.dirname(authFile), { recursive: true });
  fs.writeFileSync(authFile, JSON.stringify({ version: 2, activeProfileId: 'synthetic', pendingRegistrations: [], profiles: [{
    version: 1, id: 'synthetic', label: 'Synthetic encryption test', clientId: 'synthetic_client', status: 'connected',
    scopes: ['chatgpt.tokens.use.direct'], savedAt: new Date().toISOString(),
    credentials: { accessToken: 'synthetic-encryption-test-value', expiresAt: Date.now() + 3600000 },
  }] }));
  let app: ElectronApplication | undefined;
  try {
    app = await electron.launch({ args: [path.resolve(__dirname, '../..')], env });
    await expect.poll(() => app!.evaluate(() => !!(globalThis as any).__capri?.runtime2)).toBe(true);
    await app.evaluate(() => {
      const g = globalThis as any; const a = g.__capri;
      g.__cognitiveInputs = []; g.__legacyBefore = a.history.recent(200).length;
      a.runtime2.cognitive.provider = {
        models: async () => [{ id: 'synthetic-chat', label: 'Synthetic test provider', contextTokens: 128000 }],
        infer: async (_model: unknown, input: any, _signal: unknown, delta: (s: string) => void) => {
          g.__cognitiveInputs.push(input);
          if (g.__cognitiveInputs.length === 1) return { text: '', calls: [{ id: 'native-retrieval', name: 'get_recent_observations', arguments: '{}' }] };
          delta('I noticed '); delta('the window.'); return { text: 'I noticed the window.', calls: [] };
        }, shutdown: () => {},
      };
      g.__capriWindowsOverride = [{ handle: 777n, rect: { x: 100, y: 180, width: 700, height: 500 } }];
      g.__capriWindowInfo = { '777': { title: 'Synthetic cognitive fixture', process: 'fixture.exe' } };
      g.__capriForegroundHandle = 777n;
      a.presenceTick(); a.openLongTermChat();
    });
    await expect.poll(() => app!.windows().some(w => /panel\.html/.test(w.url()))).toBe(true);
    const panel = app.windows().find(w => /panel\.html/.test(w.url()))!;
    expect(await panel.evaluate(() => (window as any).capri.invoke('runtime2:session'))).toMatchObject({ status: 'connected', sharing: true, account: 'Synthetic encryption test' });
    expect(await panel.evaluate(() => (window as any).capri.invoke('connection:get'))).toMatchObject({ state: 'connected', provider: 'ChatGPT (SIWC)' });
    await expect.poll(() => panel.locator('#connChip').innerText()).toContain('Online');
    expect(fs.readFileSync(authFile, 'utf8')).not.toContain('synthetic-encryption-test-value');
    await panel.locator('textarea[aria-label="Message"]').fill('What have you noticed?');
    await panel.locator('button[aria-label="Send"]').click();
    await expect.poll(async () => ({ text: await panel.locator('.messages').innerText(), status: await panel.locator('.status').innerText(), debug: await app!.evaluate(() => ({ state: (globalThis as any).__capri.runtime2.chatState, calls: (globalThis as any).__cognitiveInputs.length })) }), { timeout: 5000 }).toMatchObject({ text: expect.stringContaining('I noticed the window.') });
    const before = await app.evaluate(async () => {
      const g = globalThis as any; const a = g.__capri;
      const page = await a.runtime2.archive.conversation();
      return { page, inputs: g.__cognitiveInputs, legacyUnchanged: g.__legacyBefore === a.history.recent(200).length };
    });
    expect(before.legacyUnchanged).toBe(true);
    expect(before.inputs).toHaveLength(2);
    expect(before.inputs[0].records.some((r: any) => r.kind === 'observation' && r.observation.provenance.collector === 'win32.foreground')).toBe(true);
    expect(before.inputs[1].records.some((r: any) => r.kind === 'tool-result' && r.requestId === 'native-retrieval' && r.receipt.outcome === 'completed' && r.result.observations.length > 0)).toBe(true);
    await closeIsolatedApp(app); app = undefined;
    app = await electron.launch({ args: [path.resolve(__dirname, '../..')], env: { ...env, CAPRI_V2_WINDOW_FOCUS: '0' } });
    await expect.poll(() => app!.evaluate(() => !!(globalThis as any).__capri?.runtime2)).toBe(true);
    const after = await app.evaluate(async () => { const a = (globalThis as any).__capri; return { page: await a.runtime2.archive.conversation(), history: await a.runtime2.chatHistory() }; });
    await app.evaluate(() => (globalThis as any).__capri.openLongTermChat());
    await expect.poll(() => app!.windows().some(w => /panel\.html/.test(w.url()))).toBe(true);
    const restartedPanel = app.windows().find(w => /panel\.html/.test(w.url()))!;
    await expect.poll(() => restartedPanel.evaluate(() => (window as any).capri.invoke('runtime2:session'))).toMatchObject({ status: 'connected', sharing: true, account: 'Synthetic encryption test' });
    expect(after.page).toEqual(before.page);
    expect(after.history.map((m: any) => m.content)).toEqual(['What have you noticed?', 'I noticed the window.']);
  } finally {
    await closeIsolatedApp(app);
    if (path.dirname(dir) !== path.join(os.homedir(), 'Documents', 'Capri Buddy 2.0 Synthetic')) throw Error('Unexpected test profile');
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
