import { archiveWorkerPath } from '../helpers/runtime2Archive';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { selectRuntime, assertSyntheticProfile } from '../../src/main/runtime2/selection';
import { Runtime2 } from '../../src/main/runtime2/runtime';
import { WindowFocusSource } from '../../src/main/runtime2/windowFocus';
import { TypedCapabilityExecutor, type CapabilityDefinition } from '../../src/core/capabilities';

const focus = { handle: '42', title: 'Untrusted window title', process: 'editor.exe', pid: 12 };
const call = { id: 'move:1', capability: 'test.move', fingerprint: 'target:42', dependencies: ['desktop:foreground'] };
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0)) await cleanup(); });
async function fixture() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'capri-runtime2-'));
  const profile = selectRuntime({ CAPRI_RUNTIME: '2' }, home).profile!;
  const executor = new TypedCapabilityExecutor();
  const runtime = new Runtime2({ executor }, 'synthetic:primary', profile, { workerPath: archiveWorkerPath });
  const source = new WindowFocusSource();
  cleanups.push(async () => { await runtime.shutdown(); fs.rmSync(home, { recursive: true, force: true }); });
  await runtime.initialize(listener => source.subscribe(listener));
  return { runtime, source };
}

describe('runtime 2 foundation', () => {
  it('defaults to legacy and selects only an isolated development profile', () => {
    const home = path.join(os.tmpdir(), 'synthetic-home');
    expect(selectRuntime({}, home)).toEqual({ mode: 'legacy', profile: undefined });
    const selected = selectRuntime({ CAPRI_RUNTIME: '2', CAPRI_USER_DATA: 'real-profile' }, home);
    expect(selected).toEqual({ mode: '2', profile: path.join(home, 'Documents', 'Capri Buddy 2.0 Synthetic', 'phase1') });
    expect(() => selectRuntime({ CAPRI_RUNTIME: '2' }, home, true)).toThrow('development-only');
    expect(() => selectRuntime({ CAPRI_RUNTIME: 'typo' }, home)).toThrow();
    expect(() => selectRuntime({ CAPRI_RUNTIME: '2', CAPRI_V2_PROFILE_ID: '../Capri Buddy' }, home)).toThrow();
  });

  it('rejects junctions that could redirect synthetic writes', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'capri-v2-isolation-'));
    try {
      const target = path.join(dir, 'real'); fs.mkdirSync(target);
      const link = path.join(dir, 'synthetic'); fs.symlinkSync(target, link, 'junction');
      expect(() => assertSyntheticProfile(path.join(link, 'phase1'))).toThrow('link');
      fs.unlinkSync(link);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  it('keeps original metadata, timestamp and loss markers without semantic admission', async () => {
    const { runtime, source } = await fixture();
    source.sample(focus, 100); source.sample(focus, 200);
    const snapshot = runtime.snapshot();
    expect(snapshot.id).toBe('synthetic:primary');
    expect(snapshot.items).toHaveLength(1);
    expect(snapshot.items[0]).toMatchObject({ at: 100, kind: 'observation', observation: {
      source: 'desktop:foreground', content: focus,
      provenance: { authority: 'host', collector: 'win32.foreground' },
      loss: { truncated: false, missing: ['window-contents', 'original-payload-not-archived', 'process-full-path'] },
    } });
    snapshot.items.length = 0;
    expect(runtime.snapshot().items).toHaveLength(1);
    for (let i = 0; i < 260; i++) source.sample({ ...focus, title: String(i) }, 300 + i);
    expect(runtime.snapshot().items).toHaveLength(256);
    expect(runtime.snapshot().evictedItems).toBe(5);
    await runtime.shutdown();
  });

  it('reuses validation, permissions, outcome verification and replay barriers', async () => {
    const { runtime } = await fixture();
    const execute = vi.fn(async () => ({ placed: true }));
    const definition: CapabilityDefinition<string, { placed: boolean }> = {
      parse: value => { if (typeof value !== 'string') throw Error('invalid target'); return value; },
      permission: () => 'allow', precondition: () => true, execute, verify: (_, result) => result.placed,
    };
    expect((await runtime.execute({ call, arguments: 5 }, definition)).receipt).toMatchObject({ outcome: 'failed', detail: 'invalid target' });
    expect((await runtime.execute({ call, arguments: '42' }, { ...definition, permission: () => 'deny' })).receipt.outcome).toBe('denied');
    expect(execute).not.toHaveBeenCalled();
    expect((await runtime.execute({ call, arguments: '42' }, definition)).receipt.outcome).toBe('completed');
    expect((await runtime.execute({ call, arguments: '42' }, definition)).receipt.replayed).toBe(true);
    expect(execute).toHaveBeenCalledTimes(1);
    expect((await runtime.execute({ call: { ...call, id: 'unverified' }, arguments: '42' }, { ...definition, verify: () => 'unknown' })).receipt.outcome).toBe('unknown');
    expect(runtime.snapshot().items.every(item => item.kind === 'tool-result')).toBe(true);
    await runtime.shutdown();
  });

  it('reports collector truncation and unavailable metadata explicitly', async () => {
    const { runtime, source } = await fixture();
    source.sample({ ...focus, title: 'x'.repeat(1023), process: '' }, 100);
    expect(runtime.snapshot().items[0]).toMatchObject({ observation: { loss: {
      truncated: true, missing: expect.arrayContaining(['window-title-may-be-truncated', 'process-metadata-unavailable']),
    } } });
    source.sample({ handle: null, title: '', process: '' }, 200);
    expect(runtime.snapshot().items[1]).toMatchObject({ observation: { loss: {
      missing: expect.arrayContaining(['external-foreground-unavailable']),
    } } });
    await runtime.shutdown();
  });

  it('cancels and settles in-flight work without accepting late observations or results', async () => {
    const { runtime, source } = await fixture();
    let finish!: () => void;
    let signal!: AbortSignal;
    const task = runtime.execute({ call, arguments: '42' }, {
      parse: String, permission: () => 'allow', precondition: () => true,
      execute: async (_, abort) => { signal = abort; await new Promise<void>(resolve => { finish = resolve; }); return true; },
      verify: () => true,
    });
    const closing = runtime.shutdown();
    expect(runtime.shutdown()).toBe(closing);
    expect(signal.aborted).toBe(true);
    expect(runtime.status).toBe('stopping');
    source.sample(focus, 100);
    finish(); await closing;
    expect((await task).receipt.outcome).toBe('cancelled');
    expect(runtime.status).toBe('stopped');
    expect(runtime.snapshot().items).toHaveLength(0);
    await expect(runtime.execute({ call, arguments: '42' }, {} as CapabilityDefinition<unknown, unknown>)).rejects.toThrow('not active');
    expect(() => runtime.initialize(listener => source.subscribe(listener))).toThrow();
  });
});
