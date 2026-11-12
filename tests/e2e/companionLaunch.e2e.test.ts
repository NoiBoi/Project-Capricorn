import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { _electron as electron, type ElectronApplication } from 'playwright-core';
import { expect, it } from 'vitest';
import { closeIsolatedApp } from './lifecycle';

it('launches the installed companion entry point paused in an isolated profile and executes a bounded evidence turn', async () => {
  const id = 'companion-launch-' + randomUUID();
  const dir = path.join(os.homedir(), 'Documents', 'Capri Buddy 2.0 Synthetic', id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({ firstRunComplete: true, ai: { provider: 'offline' }, privacy: { saveHistory: true }, dialogue: { localContext: true }, character: { startupIntro: false }, voice: { ttsEnabled: false }, behavior: { quietHours: { enabled: false } } }));
  const env: NodeJS.ProcessEnv = { ...process.env, CAPRI_RUNTIME: 'legacy', CAPRI_USER_DATA: 'must-not-use-this-profile', CAPRI_V2_PROFILE_ID: id, CAPRI_TEST: '1', CAPRI_OFFSCREEN: '1', CAPRI_NO_DEV_KEY: '1', CAPRI_V2_WINDOW_FOCUS: '0' };
  let app: ElectronApplication | undefined;
  try {
    const executablePath = process.env.CAPRI_EXE;
    if (executablePath) delete env.CAPRI_RUNTIME;
    app = await electron.launch({ ...(executablePath ? { executablePath } : {}), args: executablePath ? [] : [path.resolve(__dirname, '../..'), '--runtime2'], env });
    await expect.poll(() => app!.evaluate(() => !!(globalThis as any).__capri?.runtime2)).toBe(true);
    const initial = await app.evaluate(({ app }) => {
      const r = (globalThis as any).__capri.runtime2;
      return { profile: app.getPath('userData'), packaged: app.isPackaged, version: app.getVersion(), paused: r.daily.paused, collecting: r.collecting, usage: r.daily.status.usage, cognition: r.cognitive.options.cognition ?? 'companion' };
    });
    expect(initial).toMatchObject({ profile: dir, packaged: !!executablePath, paused: true, collecting: false, usage: { requests: 0 }, cognition: 'companion' });
    await app.evaluate(async () => {
      const g = globalThis as any, r = g.__capri.runtime2, loop = r.cognitive;
      clearInterval(loop.timer);
      await r.archive.appendConversation({ id: 'fixture-evidence', at: Date.now() - 1000, kind: 'user', text: 'The cooling manifold has four valves.' });
      await r.daily.configure({ ...r.daily.config, model: 'fixture' });
      await r.daily.start(); loop.environment(false);
      g.__companionInputs = [];
      // The real app, archive, capability executor and continuation run here;
      // only inference is a fixture. No account request or real desktop capture.
      loop.provider = { models: async () => [{ id: 'fixture', label: 'Fixture', contextTokens: 128000 }], shutdown() {}, infer: async (_m: unknown, input: any) => {
        g.__companionInputs.push(input);
        return g.__companionInputs.length === 1 ? { text: '', calls: [{ id: 'read-original', name: 'retrieve_evidence', arguments: JSON.stringify({ observationId: 'fixture-evidence' }) }] } : { text: 'Four valves on that manifold.', calls: [] };
      } };
      let pending = true;
      loop.ambientTrigger = () => { if (pending) { pending = false; return 'source-change'; } };
      loop.kick();
    });
    await expect.poll(() => app!.evaluate(() => ({ busy: (globalThis as any).__capri.runtime2.chatState.busy, calls: (globalThis as any).__companionInputs.length })) ).toEqual({ busy: false, calls: 2 });
    const result = await app.evaluate(async () => {
      const g = globalThis as any, r = g.__capri.runtime2;
      return { records: (await r.archive.conversation()).records, states: await r.archive.findState(), input: g.__companionInputs[1], history: await r.chatHistory() };
    });
    expect(result.states).toEqual([]);
    expect(result.input.tools.some((t: any) => t.name === 'retrieve_evidence')).toBe(false);
    expect(result.records).toContainEqual(expect.objectContaining({ kind: 'tool-result', requestId: 'read-original', receipt: expect.objectContaining({ outcome: 'completed' }) }));
    expect(result.history.at(-1)?.content).toBe('Four valves on that manifold.');
  } finally {
    await closeIsolatedApp(app);
    if (path.dirname(dir) !== path.join(os.homedir(), 'Documents', 'Capri Buddy 2.0 Synthetic')) throw Error('Unexpected test profile');
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});
