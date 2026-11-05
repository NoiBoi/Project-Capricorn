import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { _electron as electron, type ElectronApplication } from 'playwright-core';
import { expect, it } from 'vitest';
import { selectRuntime } from '../../src/main/runtime2/selection';
import { closeIsolatedApp } from './lifecycle';

it('boots the isolated runtime in the existing Electron shell and blocks legacy cognition', async () => {
  const id = `test-${randomUUID()}`;
  const env = { ...process.env, CAPRI_RUNTIME: '2', CAPRI_V2_PROFILE_ID: id, CAPRI_TEST: '1', CAPRI_OFFSCREEN: '1', CAPRI_NO_DEV_KEY: '1' };
  const dir = selectRuntime(env, os.homedir()).profile!;
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({ firstRunComplete: true,
    ai: { provider: 'offline' }, memory: { enabled: false, autoLearn: true }, dialogue: { localContext: true },
    actions: { policies: { read_screen: 'allow' } }, character: { startupIntro: false },
    voice: { ttsEnabled: false }, teleport: { auto: false, effects: false },
  }));
  let app: ElectronApplication | undefined;
  try {
    app = await electron.launch({ args: [path.resolve(__dirname, '../..')], env });
    await expect.poll(() => app!.evaluate(() => !!(globalThis as any).__capri?.runtime2)).toBe(true);
    const result = await app.evaluate(async ({ app: host }) => {
      const g = globalThis as any, a = g.__capri;
      const legacyHistoryBefore = a.history.recent(100).length;
      let chatBlocked = false;
      try { await a.convo.send('Remember this and move to another window.'); } catch { chatBlocked = true; }
      // Even explicitly enabled legacy learning cannot become a second owner.
      a.settings.update({ memory: { enabled: true, autoLearn: true } });
      await a.runtime2.whenSettled();
      let learningCalls = 0;
      a.memoryLearner.d.provider = () => { learningCalls++; throw Error('Legacy learner called'); };
      a.memoryLearner.enqueue('My preference is synthetic.', 'synthetic-message');
      await a.memoryLearner.learn('My preference is synthetic.', 'synthetic-message', new AbortController().signal);
      a.memoryLearner.schedule(0);
      const ambient = await a.behavior.dispatch({ kind: 'interact' });
      // A real native handle when available; an empty foreground is also a host observation.
      g.__capriWindowsOverride = [{ handle: 777n, rect: { x: 100, y: 180, width: 700, height: 500 } }];
      g.__capriWindowInfo = { '777': { title: 'Synthetic archive fixture', process: 'fixture.exe' } };
      g.__capriForegroundHandle = 777n;
      a.presenceTick();
      a.windowFocusSource.sample({ handle: 'synthetic', title: 'Phase 2 restart evidence', process: 'archive-test.exe' }, 12345);
      const beforeStop = a.runtime2.snapshot();
      const evidenceId = beforeStop.items.at(-1).id;
      await a.runtime2.shutdown();
      a.windowFocusSource.sample({ handle: 'late', title: 'late', process: 'late' });
      a.presenceTick();
      return { mode: a.runtimeSelection.mode, dir: host.getPath('userData'), sessionDir: host.getPath('sessionData'),
        chatBlocked, learningCalls, ambient: ambient.delivered, historyUnchanged: a.history.recent(100).length === legacyHistoryBefore,
        evidenceId, archiveHealth: a.runtime2.archiveHealth, conversation: beforeStop, stopped: a.runtime2.status, unchanged: JSON.stringify(a.runtime2.snapshot()) === JSON.stringify(beforeStop),
        character: !!a.charWin && !a.charWin.isDestroyed(),
      };
    });
    expect(result).toMatchObject({ mode: '2', dir, sessionDir: dir, chatBlocked: true, learningCalls: 0,
      ambient: false, historyUnchanged: true, stopped: 'stopped', unchanged: true, character: true });
    expect(result.conversation.items.some((item: { kind: string }) => item.kind === 'observation')).toBe(true);
    expect(result.archiveHealth).toMatchObject({ state: 'closed', degraded: false, pendingWrites: 0 });
    expect(result.archiveHealth.threadId).toBeGreaterThan(0);
    expect(fs.existsSync(path.join(dir, 'runtime2', 'experience.sqlite'))).toBe(true);
    await closeIsolatedApp(app); app = undefined;
    // Launch the source checkout again with the same synthetic profile, collector disabled.
    app = await electron.launch({ args: [path.resolve(__dirname, '../..')], env: { ...env, CAPRI_V2_WINDOW_FOCUS: '0', CAPRI_USER_DATA: path.join(dir, 'must-not-adopt') } });
    await expect.poll(() => app!.evaluate(() => !!(globalThis as any).__capri?.runtime2)).toBe(true);
    const restarted = await app.evaluate(async (_host, id) => {
      const a = (globalThis as any).__capri;
      const snapshot = a.runtime2.snapshot();
      const found = await a.runtime2.observationById(id);
      const searched = await a.runtime2.recentObservations({ search: 'archive-test.exe', from: 12345, to: 12345 });
      const stats = await a.runtime2.archiveStatistics();
      const beforeTick = JSON.stringify(snapshot);
      a.presenceTick();
      return { found, searched, stats, items: snapshot.items, unchanged: beforeTick === JSON.stringify(a.runtime2.snapshot()), dir: _host.app.getPath('userData'), health: a.runtime2.archiveHealth };
    }, result.evidenceId);
    expect(restarted.dir).toBe(dir);
    expect(restarted.health).toMatchObject({ state: 'ready', degraded: false });
    expect(restarted.found).toEqual(result.conversation.items.find((item: { id: string }) => item.id === result.evidenceId)!.observation);
    expect(restarted.searched.some((o: { id: string }) => o.id === result.evidenceId)).toBe(true);
    expect(restarted.stats.count).toBeGreaterThan(0);
    expect(restarted.items.every((o: { kind: string }) => o.kind === 'observation')).toBe(true);
    expect(restarted.items.map((o: { at: number }) => o.at)).toEqual(restarted.items.map((o: { at: number }) => o.at).sort((a: number, b: number) => a - b));
    expect(restarted.unchanged).toBe(true);
    expect(fs.existsSync(path.join(dir, 'profile-source.json'))).toBe(false);
    expect(fs.existsSync(path.join(dir, 'memory-learning-queue.json'))).toBe(false);
  } finally {
    await closeIsolatedApp(app);
    // This exact, generated synthetic profile is owned by this test.
    if (path.dirname(dir) !== path.join(os.homedir(), 'Documents', 'Capri Buddy 2.0 Synthetic')) throw Error('Unexpected test profile path.');
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
