import { archiveWorkerPath } from '../helpers/runtime2Archive';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Worker, threadId } from 'node:worker_threads';
import { afterEach, expect, it } from 'vitest';
import { WindowFocusArchive, type ArchiveOptions } from '../../src/main/runtime2/windowFocusArchive';
import { selectRuntime } from '../../src/main/runtime2/selection';
import { WindowFocusSource } from '../../src/main/runtime2/windowFocus';
import { Runtime2 } from '../../src/main/runtime2/runtime';
import { TypedCapabilityExecutor } from '../../src/core/capabilities';
import type { Observation } from '../../src/main/runtime2/contracts';
const workerPath = archiveWorkerPath;
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });
function fixture() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'capri-archive-'));
  const profile = selectRuntime({ CAPRI_RUNTIME: '2' }, home).profile!;
  cleanups.push(async () => { fs.rmSync(home, { recursive: true, force: true }); });
  const create = (options: ArchiveOptions = {}) => {
    const archive = new WindowFocusArchive(profile, { workerPath, ...options });
    cleanups.push(() => archive.close()); return archive;
  };
  return { home, profile, create, file: path.join(profile, 'runtime2/experience.sqlite') };
}
function observation(id = 'one', at = 100): Observation {
  return { id, at, source: 'desktop:foreground', modality: 'window-metadata',
    content: { handle: '42', title: 'Original %_ title', process: 'EDITOR.exe', pid: 12 },
    original: { id: 'original', uri: 'evidence:original', observedAt: 99 },
    provenance: { authority: 'host', collector: 'win32.foreground', metadata: { evidence: 'metadata-only' } },
    loss: { truncated: true, missing: ['window-contents', 'window-title-may-be-truncated'] } };
}
// Fixture database preparation also runs in a real worker, never the test host.
async function databaseFixture(file: string, sql: string) {
  const worker = new Worker(`const {parentPort,workerData}=require('node:worker_threads'); const {DatabaseSync}=require('node:sqlite'); const db=new DatabaseSync(workerData.file); db.exec(workerData.sql); db.close(); parentPort.postMessage('done');`, { eval: true, workerData: { file, sql } });
  await new Promise<void>((resolve, reject) => { worker.once('message', () => resolve()); worker.once('error', reject); });
  await new Promise<void>(resolve => worker.once('exit', () => resolve()));
}
it('persists exact evidence across worker restarts and safely handles duplicate IDs', async () => {
  const { create } = fixture(), a = create(); await a.initialize();
  expect(a.health.threadId).not.toBe(threadId);
  const original = observation();
  expect(await a.write(original)).toEqual({ inserted: true });
  expect(await a.write(original)).toEqual({ inserted: false });
  await expect(a.write({ ...original, at: 101 })).rejects.toThrow('different evidence');
  await a.close();
  const b = create(); await b.initialize();
  expect(await b.get(original.id)).toEqual(original);
  expect(await b.get('absent')).toBeUndefined();
  expect(await b.stats()).toEqual({ count: 1, oldest: original, newest: original });
});
it('searches titles and processes literally, filters timestamps and bounds malformed requests', async () => {
  const a = fixture().create(); await a.initialize();
  await a.write(observation('a', 20)); await a.write({ ...observation('b', 30), content: { handle: null, title: 'Other', process: 'other.exe' } });
  expect((await a.recent({ search: 'editor' })).map(o => o.id)).toEqual(['a']);
  expect((await a.recent({ search: '%_' })).map(o => o.id)).toEqual(['a']);
  expect((await a.recent({ from: 21, to: 30 })).map(o => o.id)).toEqual(['b']);
  expect(await a.recent({ search: "' OR 1=1 --" })).toEqual([]);
  expect(await a.recent({ limit: 1 })).toHaveLength(1);
  for (const q of [[], { limit: null }, { limit: 101 }, { limit: 0 }, { limit: 1.5 }, { search: 'x'.repeat(257) }, { from: NaN }, { from: 4, to: 3 }, { extra: true }]) await expect(a.recent(q as any)).rejects.toThrow();
  await expect(a.get('')).rejects.toThrow();
  for (const o of [{}, { ...observation(), at: NaN }, { ...observation(), loss: { truncated: false, missing: [4] } }, { ...observation(), provenance: {} }]) await expect(a.write(o as any)).rejects.toThrow();
  expect(a.health.degraded).toBe(true);
});
it('enforces age by ingestion clock and count on commits and initialization', async () => {
  let now = 1000;
  const { create } = fixture();
  const options = { now: () => now, retention: { maxAgeMs: 100, maxRecords: 2 } };
  const a = create(options); await a.initialize();
  await a.write(observation('old-source', -999999));
  now = 1050; await a.write(observation('future-source', 999999999));
  expect((await a.stats()).count).toBe(2);
  now = 1101; await a.write(observation('new', 2));
  expect(await a.get('old-source')).toBeUndefined();
  expect(await a.get('future-source')).toBeDefined();
  now = 1102; await a.write(observation('newer', 3));
  expect(await a.get('future-source')).toBeUndefined();
  await a.close(); now = 1203;
  const b = create(options); await b.initialize(); expect((await b.stats()).count).toBe(0);
  await b.write(observation('x')); await b.write(observation('y')); await b.close();
  const c = create({ ...options, retention: { maxAgeMs: 100, maxRecords: 1 } }); await c.initialize();
  expect((await c.recent()).map(o => o.id)).toEqual(['y']);
});
it('restores only the latest 256 observations in chronological order', async () => {
  const a = fixture().create(); await a.initialize();
  // Keep writes below the bounded outstanding request count.
  await Promise.all(Array.from({ length: 270 }, (_, i) => a.write(observation(String(i), 270 - i))));
  const restored = await a.restore();
  expect(restored).toHaveLength(256); expect(restored.map(o => o.at)).toEqual(Array.from({ length: 256 }, (_, i) => i + 15));
  expect(await a.recent()).toHaveLength(100);
});
it('flushes writes before close, rejects late writes and shuts down idempotently', async () => {
  const { create } = fixture(), a = create(); await a.initialize();
  const writes = Array.from({ length: 50 }, (_, i) => a.write(observation(String(i))));
  const close = a.close(); expect(a.close()).toBe(close); await close; await Promise.all(writes);
  expect(a.health.pendingWrites).toBe(0); expect(a.health.state).toBe('closed');
  await expect(a.write(observation('late'))).rejects.toThrow();
  const b = create(); await b.initialize(); expect((await b.stats()).count).toBe(50);
});
it('reports overload without claiming persistence', async () => {
  const a = fixture().create({ maxPending: 1 }); await a.initialize();
  const first = a.write(observation('first'));
  await expect(a.write(observation('overflow'))).rejects.toThrow('queue is full'); await first;
  expect(a.health).toMatchObject({ degraded: true, failures: 1 });
  expect(await a.get('overflow')).toBeUndefined();
});
it('propagates missing worker, worker crashes and unresponsive worker timeouts', async () => {
  const f = fixture();
  const missing = f.create({ workerPath: path.join(f.home, 'missing.js') }); await expect(missing.initialize()).rejects.toThrow();
  const crashPath = path.join(f.home, 'crash.cjs');
  fs.writeFileSync(crashPath, `const {parentPort}=require('node:worker_threads'); parentPort.on('message', m => { if(m.op==='initialize') parentPort.postMessage({id:m.id,ok:true,value:{threadId:99}}); else process.exit(9); });`);
  const crash = f.create({ workerPath: crashPath }); await crash.initialize();
  const crashed = await Promise.allSettled([crash.recent(), crash.stats()]);
  expect(crashed.every(result => result.status === 'rejected' && result.reason.message.includes('exited unexpectedly'))).toBe(true);
  expect(crash.health.degraded).toBe(true);
  fs.writeFileSync(path.join(f.home, 'hang.cjs'), `require('node:worker_threads').parentPort.on('message',()=>{});`);
  const hang = f.create({ workerPath: path.join(f.home, 'hang.cjs'), timeoutMs: 100 });
  await expect(hang.initialize()).rejects.toThrow('timed out');
});
it('preserves corrupt and newer schema files, rejecting startup with actionable errors', async () => {
  const f = fixture(); fs.mkdirSync(path.dirname(f.file), { recursive: true });
  fs.writeFileSync(f.file, 'not sqlite'); const corrupt = fs.readFileSync(f.file);
  await expect(f.create().initialize()).rejects.toThrow('database preserved'); expect(fs.readFileSync(f.file)).toEqual(corrupt);
  fs.unlinkSync(f.file); await databaseFixture(f.file, 'PRAGMA user_version=99; CREATE TABLE future(value TEXT);');
  const newer = fs.readFileSync(f.file);
  await expect(f.create().initialize()).rejects.toThrow('upgrade Capri'); expect(fs.readFileSync(f.file)).toEqual(newer);
});
it('rejects non-synthetic paths and archive-directory junctions before opening a database', async () => {
  const f = fixture();
  const invalid = new WindowFocusArchive(path.join(f.home, 'legacy'), { workerPath }); cleanups.push(() => invalid.close());
  await expect(invalid.initialize()).rejects.toThrow('synthetic');
  fs.mkdirSync(f.profile, { recursive: true }); const legacy = path.join(f.home, 'legacy'); fs.mkdirSync(legacy);
  fs.symlinkSync(legacy, path.join(f.profile, 'runtime2'), 'junction');
  await expect(f.create().initialize()).rejects.toThrow('link'); expect(fs.readdirSync(legacy)).toEqual([]);
});
it('Runtime2 restarts with archive chronology, exposes failures and accepts no late writes', async () => {
  const f = fixture(), source = new WindowFocusSource();
  const create = (options: ArchiveOptions = {}) => {
    const r = new Runtime2({ executor: new TypedCapabilityExecutor() }, 'test', f.profile, { workerPath, ...options });
    cleanups.push(() => r.shutdown()); return r;
  };
  const a = create(); await a.initialize(listener => source.subscribe(listener));
  source.sample({ handle: null, title: 'first', process: 'editor' }, 20);
  source.sample({ handle: null, title: 'second', process: 'editor' }, 10);
  const snapshot = a.snapshot(); await a.shutdown();
  source.sample({ handle: null, title: 'late', process: '' });
  expect(a.snapshot()).toEqual(snapshot);
  const b = create({ maxPending: 1 }); await b.initialize(listener => source.subscribe(listener));
  expect(b.snapshot().items.map(o => o.at)).toEqual([10,20]);
  source.sample({ handle: null, title: 'third', process: '' }); source.sample({ handle: null, title: 'overflow', process: '' });
  await expect.poll(() => b.archiveHealth.failures).toBeGreaterThan(0);
  expect(b.archiveHealth.degraded).toBe(true);
  await b.shutdown();
  const c = create(); const init = c.initialize(listener => source.subscribe(listener)); const stop = c.shutdown(); await init; await stop;
  expect(c.status).toBe('stopped');
});

it('settles worker exceptions and a stuck shutdown without leaving pending requests', async () => {
  const f = fixture();
  const file = path.join(f.home, 'fault.cjs');
  fs.writeFileSync(file, `const {parentPort}=require('node:worker_threads'); parentPort.on('message', m => { if(m.op==='initialize') parentPort.postMessage({id:m.id,ok:true,value:{threadId:99}}); else throw Error('worker database fault'); });`);
  const a = f.create({ workerPath: file }); await a.initialize();
  const results = await Promise.allSettled([a.recent(), a.stats()]);
  expect(results.every(result => result.status === 'rejected' && result.reason.message.includes('worker database fault'))).toBe(true);
  await a.close(); expect(a.health.degraded).toBe(true);
  const stuck = path.join(f.home, 'stuck.cjs');
  fs.writeFileSync(stuck, `const {parentPort}=require('node:worker_threads'); parentPort.on('message', m => parentPort.postMessage({id:m.id,ok:true,value:m.op==='initialize'?{threadId:99}:null}));`);
  const b = f.create({ workerPath: stuck }); await b.initialize(); await b.close();
  expect(b.health).toMatchObject({ state: 'closed', degraded: true, lastError: 'Archive worker did not exit after close' });
});
it('Runtime2 does not subscribe when database initialization fails', async () => {
  const f = fixture(); fs.mkdirSync(path.dirname(f.file), { recursive: true }); fs.writeFileSync(f.file, 'corrupt');
  const r = new Runtime2({ executor: new TypedCapabilityExecutor() }, 'test', f.profile, { workerPath });
  cleanups.push(() => r.shutdown());
  let subscribed = false;
  await expect(r.initialize(() => { subscribed = true; return () => {}; })).rejects.toThrow('database preserved');
  expect(subscribed).toBe(false); expect(r.status).toBe('stopped'); expect(r.archiveHealth.degraded).toBe(true);
});

it('creates a genuinely missing database normally', async () => {
  const f = fixture();
  expect(fs.existsSync(f.file)).toBe(false);
  const a = f.create(); await a.initialize();
  expect(fs.lstatSync(f.file).isFile()).toBe(true);
  expect((await a.stats()).count).toBe(0);
});
it('rejects a directory at the database path before opening SQLite', async () => {
  const f = fixture(); fs.mkdirSync(f.file, { recursive: true });
  await expect(f.create().initialize()).rejects.toThrow('regular file');
  expect(fs.readdirSync(f.file)).toEqual([]);
});
it('rejects a real dangling database symlink without creating its external target', async (context) => {
  const f = fixture(); fs.mkdirSync(path.dirname(f.file), { recursive: true });
  const outside = path.join(f.home, 'outside.sqlite');
  try { fs.symlinkSync(outside, f.file, 'file'); }
  catch (error) {
    if (process.platform === 'win32' && ['EPERM', 'EACCES'].includes((error as NodeJS.ErrnoException).code ?? '')) {
      context.skip('Windows permissions prevent creating a real file symlink; end-to-end dangling-link test not executed.');
      return;
    }
    throw error;
  }
  expect(fs.lstatSync(f.file).isSymbolicLink()).toBe(true);
  expect(fs.existsSync(f.file)).toBe(false);
  await expect(f.create().initialize()).rejects.toThrow('symbolic link');
  expect(fs.existsSync(outside)).toBe(false);
});
it('fails closed on unexpected database-path inspection errors', async () => {
  const f = fixture();
  const failingWorker = path.join(f.home, 'inspection-error.cjs');
  fs.writeFileSync(failingWorker, `const fs=require('node:fs'); const original=fs.lstatSync; fs.lstatSync=function(file,...args){if(String(file).endsWith('experience.sqlite')){const error=Error('inspection denied'); error.code='EACCES'; throw error;} return original.call(this,file,...args);}; require(${JSON.stringify(workerPath)});`);
  await expect(f.create({ workerPath: failingWorker }).initialize()).rejects.toThrow('inspection denied');
  expect(fs.existsSync(f.file)).toBe(false);
});

it('rejects a mocked dangling database link before SQLite opens (supplement only)', async () => {
  const f = fixture();
  const linkWorker = path.join(f.home, 'mock-link.cjs');
  fs.writeFileSync(linkWorker, `const fs=require('node:fs'); const original=fs.lstatSync; fs.lstatSync=function(file,...args){if(String(file).endsWith('experience.sqlite')) return {isSymbolicLink:()=>true,isFile:()=>false}; return original.call(this,file,...args);}; require(${JSON.stringify(workerPath)});`);
  await expect(f.create({ workerPath: linkWorker }).initialize()).rejects.toThrow('symbolic link');
  expect(fs.existsSync(f.file)).toBe(false);
});
