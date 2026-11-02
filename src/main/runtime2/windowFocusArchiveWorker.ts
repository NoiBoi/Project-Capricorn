import { parentPort, threadId, isMainThread } from 'node:worker_threads';
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { assertSyntheticProfile } from './selection';
import { validateId, validateObservation, validateQuery, type ArchiveRequest, type ArchiveResponse, type RetentionPolicy, type ArchiveQuery } from './windowFocusArchiveContracts';
import type { Observation } from './contracts';
if (isMainThread || !parentPort) throw Error('Archive requires a worker thread');
let db: DatabaseSync | undefined;
let retention: RetentionPolicy;
function transaction<T>(run: () => T): T {
  db!.exec('BEGIN IMMEDIATE');
  try { const result = run(); db!.exec('COMMIT'); return result; }
  catch (error) { db!.exec('ROLLBACK'); throw error; }
}
function prune(now: number) {
  db!.prepare('DELETE FROM observations WHERE ingested_at < ?').run(now - retention.maxAgeMs);
  db!.prepare('DELETE FROM observations WHERE id IN (SELECT id FROM observations ORDER BY ingested_at DESC, rowid DESC LIMIT -1 OFFSET ?)').run(retention.maxRecords);
}
function read(row: Record<string, unknown> | undefined): Observation | undefined { return row ? JSON.parse(row.payload as string) : undefined; }
function recent(query: ArchiveQuery, max = 100) {
  const q = validateQuery(query, max);
  return db!.prepare(`SELECT payload FROM observations WHERE (? IS NULL OR observed_at >= ?) AND (? IS NULL OR observed_at <= ?)
    AND (? IS NULL OR instr(lower(title), lower(?)) > 0 OR instr(lower(process), lower(?)) > 0)
    ORDER BY observed_at DESC, id DESC LIMIT ?`).all(q.from ?? null, q.from ?? null, q.to ?? null, q.to ?? null, q.search ?? null, q.search ?? null, q.search ?? null, q.limit).map(row => read(row)!);
}
function dispatch(request: ArchiveRequest): unknown {
  if (request.op === 'initialize') {
    if (db) throw Error('Archive already initialized');
    const { profile, retention: policy, now } = request.input;
    if (path.basename(path.dirname(path.resolve(profile))) !== 'Capri Buddy 2.0 Synthetic' || !/^[a-zA-Z0-9_-]{1,80}$/.test(path.basename(profile))) throw Error('Archive requires an isolated synthetic profile');
    const dir = path.join(profile, 'runtime2');
    const file = path.join(dir, 'experience.sqlite');
    // Inspect the link itself even when its target is missing. Only ENOENT
    // permits SQLite to create a database; all other inspection errors fail closed.
    try {
      const stat = fs.lstatSync(file);
      if (stat.isSymbolicLink()) throw Error('Archive database cannot be a symbolic link.');
      if (!stat.isFile()) throw Error('Archive database must be a regular file.');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    assertSyntheticProfile(file);
    if (!Number.isFinite(policy.maxAgeMs) || policy.maxAgeMs < 0 || !Number.isSafeInteger(policy.maxRecords) || policy.maxRecords < 1) throw Error('Invalid archive retention');
    retention = policy;
    fs.mkdirSync(dir, { recursive: true });
    try {
      db = new DatabaseSync(file);
      const check = db.prepare('PRAGMA integrity_check').all();
      if (check.length !== 1 || check[0].integrity_check !== 'ok') throw Error('Integrity check failed');
      const version = Number(db.prepare('PRAGMA user_version').get()!.user_version);
      if (version > 1) throw Error('Newer unsupported archive schema; upgrade Capri');
      // Match the legacy store's Windows-conscious durability without sharing its DB.
      db.exec('PRAGMA busy_timeout=5000; PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL; PRAGMA secure_delete=ON;');
      transaction(() => {
        if (version === 0) db!.exec(`CREATE TABLE observations (id TEXT PRIMARY KEY NOT NULL, observed_at REAL NOT NULL, ingested_at REAL NOT NULL, source TEXT NOT NULL, process TEXT NOT NULL, title TEXT NOT NULL, payload TEXT NOT NULL);
          CREATE INDEX observations_at ON observations(observed_at); CREATE INDEX observations_ingested ON observations(ingested_at); CREATE INDEX observations_process ON observations(process); PRAGMA user_version=1;`);
        prune(now ?? Date.now());
      });
      return { threadId };
    } catch (error) {
      db?.close(); db = undefined;
      throw Error(`Experience archive initialization failed; database preserved. Restore a verified backup or upgrade Capri. ${String(error)}`);
    }
  }
  if (!db) throw Error('Archive is not ready');
  switch (request.op) {
    case 'write': {
      const o = request.input.observation, json = validateObservation(o);
      return transaction(() => {
        const existing = db!.prepare('SELECT payload FROM observations WHERE id=?').get(o.id);
        if (existing && existing.payload !== json) throw Error('Observation ID already contains different evidence');
        const inserted = !existing, now = request.input.now ?? Date.now();
        if (inserted) db!.prepare('INSERT INTO observations VALUES (?,?,?,?,?,?,?)').run(o.id, o.at, now, o.source, o.content.process, o.content.title, json);
        prune(now);
        return { inserted };
      });
    }
    case 'recent': return recent(request.input);
    case 'restore': return recent({ limit: 256 }, 256).reverse();
    case 'get': validateId(request.input.id); return read(db.prepare('SELECT payload FROM observations WHERE id=?').get(request.input.id));
    case 'stats': return { count: Number(db.prepare('SELECT count(*) AS count FROM observations').get()!.count), oldest: read(db.prepare('SELECT payload FROM observations ORDER BY observed_at, id LIMIT 1').get()), newest: recent({ limit: 1 })[0] };
    case 'close': db.close(); db = undefined; return null;
  }
}
parentPort.on('message', (request: ArchiveRequest) => {
  let response: ArchiveResponse;
  try { response = { id: request.id, ok: true, value: dispatch(request) as Extract<ArchiveResponse, { ok: true }>['value'] }; }
  catch (error) { response = { id: request.id, ok: false, error: error instanceof Error ? error.message : String(error) }; }
  parentPort!.postMessage(response);
  if (request.op === 'close' || (request.op === 'initialize' && !response.ok)) parentPort!.close();
});
