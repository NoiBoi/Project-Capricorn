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
    ai: { provider: 'offline' }, memory: { enabled: false, autoLearn: true }, dialogue: { localContext: false },
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
      let learningCalls = 0;
      a.memoryLearner.d.provider = () => { learningCalls++; throw Error('Legacy learner called'); };
      a.memoryLearner.enqueue('My preference is synthetic.', 'synthetic-message');
      await a.memoryLearner.learn('My preference is synthetic.', 'synthetic-message', new AbortController().signal);
      a.memoryLearner.schedule(0);
      const ambient = await a.behavior.dispatch({ kind: 'interact' });
      // A real native handle when available; an empty foreground is also a host observation.
      g.__capriForegroundHandle = a.desktopWindows()[0]?.handle ?? 0n;
      a.presenceTick();
      const beforeStop = a.runtime2.snapshot();
      await a.runtime2.shutdown();
      a.windowFocusSource.sample({ handle: 'late', title: 'late', process: 'late' });
      a.presenceTick();
      return { mode: a.runtimeSelection.mode, dir: host.getPath('userData'), sessionDir: host.getPath('sessionData'),
        chatBlocked, learningCalls, ambient: ambient.delivered, historyUnchanged: a.history.recent(100).length === legacyHistoryBefore,
        conversation: beforeStop, stopped: a.runtime2.status, unchanged: JSON.stringify(a.runtime2.snapshot()) === JSON.stringify(beforeStop),
        character: !!a.charWin && !a.charWin.isDestroyed(),
      };
    });
    expect(result).toMatchObject({ mode: '2', dir, sessionDir: dir, chatBlocked: true, learningCalls: 0,
      ambient: false, historyUnchanged: true, stopped: 'stopped', unchanged: true, character: true });
    expect(result.conversation.items.some((item: { kind: string }) => item.kind === 'observation')).toBe(true);
    expect(fs.existsSync(path.join(dir, 'profile-source.json'))).toBe(false);
    expect(fs.existsSync(path.join(dir, 'memory-learning-queue.json'))).toBe(false);
  } finally {
    await closeIsolatedApp(app);
    // This exact, generated synthetic profile is owned by this test.
    if (path.dirname(dir) !== path.join(os.homedir(), 'Documents', 'Capri Buddy 2.0 Synthetic')) throw Error('Unexpected test profile path.');
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
