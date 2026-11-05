import { StateInput, StateQuery, DEFAULT_EVIDENCE_RETENTION, type CanonicalState } from './canonicalState';
import { EvidenceStore } from './evidenceStore';
import { randomUUID, createHash } from 'node:crypto';
import type { RecordInput } from './cognitiveContracts';
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
let evidence: EvidenceStore;
let journalBytes = 0, journalRecords = 0;
function measureJournal() {
  const row = db!.prepare('SELECT count(*) AS n, coalesce(sum(length(cast(payload AS BLOB))),0) AS bytes FROM conversation_records').get()!;
  journalBytes = Number(row.bytes); journalRecords = Number(row.n);
}
function transaction<T>(run: () => T): T {
  db!.exec('BEGIN IMMEDIATE');
  try { const result = run(); db!.exec('COMMIT'); return result; }
  catch (error) { db!.exec('ROLLBACK'); throw error; }
}
function prune(now: number) {
  db!.prepare("DELETE FROM observations WHERE ingested_at < ? OR json_extract(payload, '$.disclosure.retainUntil') < ?").run(now - retention.maxAgeMs, now);
  db!.prepare('DELETE FROM observations WHERE id IN (SELECT id FROM observations ORDER BY ingested_at DESC, rowid DESC LIMIT -1 OFFSET ?)').run(retention.maxRecords);
}
function read(row: Record<string, unknown> | undefined): Observation | undefined { return row ? JSON.parse(row.payload as string) : undefined; }
function recent(query: ArchiveQuery, max = 100) {
  const q = validateQuery(query, max);
  return db!.prepare(`SELECT payload FROM observations WHERE (? IS NULL OR observed_at >= ?) AND (? IS NULL OR observed_at <= ?)
    AND (? IS NULL OR instr(lower(title), lower(?)) > 0 OR instr(lower(process), lower(?)) > 0 OR instr(lower(payload), lower(?)) > 0)
    ORDER BY observed_at DESC, id DESC LIMIT ?`).all(q.from ?? null, q.from ?? null, q.to ?? null, q.to ?? null, q.search ?? null, q.search ?? null, q.search ?? null, q.search ?? null, q.limit).map(row => read(row)!);
}
function appendRecord(record: RecordInput) {
  validateId(record.id);
  if (!Number.isFinite(record.at) || !['user','assistant','observation','tool-call','tool-result'].includes(record.kind)) throw Error('Invalid conversation record');
  if ((record.kind === 'user' || record.kind === 'assistant') && (typeof record.text !== 'string' || record.text.length > 1_000_000)) throw Error('Invalid dialogue');
  if (record.kind === 'observation') validateId(record.observationId);
  if (record.kind === 'tool-call' || record.kind === 'tool-result') validateId(record.requestId);
  if (record.kind === 'tool-call' && (typeof record.name !== 'string' || typeof record.arguments !== 'string' || record.arguments.length > 32768)) throw Error('Invalid tool call');
  const json = JSON.stringify(record);
  if (json.length > 2_000_000) throw Error('Conversation record is too large');
  const existing = db!.prepare('SELECT sequence, payload FROM conversation_records WHERE id=?').get(record.id);
  if (existing) {
    if (existing.payload !== json) throw Error('Conversation record ID conflict');
    return { sequence: Number(existing.sequence) };
  }
  const size = Buffer.byteLength(json);
  // Preserve continuity and evidence rather than silently deleting old dialogue or orphaning calls.
  // At the lifetime ceiling, stop accepting writes until the user reviews/clears history.
  if (journalRecords >= 200000 || journalBytes + size > 256 * 1024 ** 2) throw Error('Conversation lifetime storage ceiling reached (200000 records / 256 MiB). Review diagnostics and clear chat before continuing. Memories and original evidence are preserved.');
  const inserted = db!.prepare('INSERT INTO conversation_records(id, payload, observation_id, request_id) VALUES (?,?,?,?)').run(record.id, json, record.kind === 'observation' ? record.observationId : null, record.kind === 'tool-call' ? record.requestId : null);
  journalRecords++; journalBytes += size;
  return { sequence: Number(inserted.lastInsertRowid) };
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
      if (version > 4) throw Error('Newer unsupported archive schema; upgrade Capri');
      // Match the legacy store's Windows-conscious durability without sharing its DB.
      db.exec('PRAGMA busy_timeout=5000; PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL; PRAGMA secure_delete=ON;');
      transaction(() => {
        if (version === 0) db!.exec(`CREATE TABLE observations (id TEXT PRIMARY KEY NOT NULL, observed_at REAL NOT NULL, ingested_at REAL NOT NULL, source TEXT NOT NULL, process TEXT NOT NULL, title TEXT NOT NULL, payload TEXT NOT NULL);
          CREATE INDEX observations_at ON observations(observed_at); CREATE INDEX observations_ingested ON observations(ingested_at); CREATE INDEX observations_process ON observations(process); PRAGMA user_version=1;`);
        if (version < 2) {
          db!.exec('CREATE TABLE logical_conversation (id TEXT NOT NULL); CREATE TABLE conversation_records (sequence INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT UNIQUE NOT NULL, payload TEXT NOT NULL, observation_id TEXT, request_id TEXT); CREATE UNIQUE INDEX conversation_tool_requests ON conversation_records(request_id) WHERE request_id IS NOT NULL; PRAGMA user_version=2;');
          db!.prepare('INSERT INTO logical_conversation VALUES (?)').run(randomUUID());
          for (const row of db!.prepare('SELECT payload FROM observations ORDER BY observed_at, id').all()) {
            const observation = read(row)!;
            appendRecord({ id: 'observation:' + createHash('sha256').update(observation.id).digest('hex'), at: observation.at, kind: 'observation', observationId: observation.id });
          }
        }
        if (version < 3) db!.exec(`CREATE TABLE IF NOT EXISTS canonical_state (id TEXT PRIMARY KEY, kind TEXT NOT NULL, status TEXT NOT NULL, text TEXT NOT NULL, payload TEXT NOT NULL);
          CREATE TABLE IF NOT EXISTS evidence (id TEXT PRIMARY KEY, mime TEXT NOT NULL, bytes INTEGER NOT NULL, created_at REAL NOT NULL, expires_at REAL NOT NULL); PRAGMA user_version=3;`);
        if (version < 4) db!.exec('ALTER TABLE logical_conversation ADD COLUMN attention TEXT; PRAGMA user_version=4;');
        prune(now ?? Date.now());
      });
      evidence = new EvidenceStore(db, dir, request.input.evidenceRetention ?? DEFAULT_EVIDENCE_RETENTION);
      measureJournal();
      evidence.prune();
      return { threadId };
    } catch (error) {
      db?.close(); db = undefined;
      throw Error(`Experience archive initialization failed; database preserved. Restore a verified backup or upgrade Capri. ${String(error)}`);
    }
  }
  if (!db) throw Error('Archive is not ready');
  switch (request.op) {
    case 'putState': return transaction(() => {
      const input = StateInput.parse(request.input), now = Date.now();
      const row = db!.prepare('SELECT payload FROM canonical_state WHERE id=?').get(input.id);
      const old: CanonicalState | undefined = row ? JSON.parse(String(row.payload)) : undefined;
      if ((old?.revision ?? 0) !== input.expectedRevision) throw Error('State revision conflict; retrieve current state before correcting it');
      if (!old && Number(db!.prepare('SELECT count(*) AS n FROM canonical_state').get()!.n) >= 1000) throw Error('Canonical state limit reached');
      if (input.dueAt !== null && (!['intention','investigation','interest'].includes(input.kind) || input.dueAt > now + 365 * 86400000)) throw Error('Invalid future review');
      for (const id of input.evidence) if (!db!.prepare('SELECT id FROM observations WHERE id=?').get(id) && !db!.prepare('SELECT id FROM conversation_records WHERE id=?').get(id)) throw Error('Evidence reference is missing');
      if (input.provenance === 'host-observation' && (!input.evidence.length || input.evidence.some(id => !db!.prepare('SELECT id FROM observations WHERE id=?').get(id)))) throw Error('Host provenance requires original observations');
      if (input.provenance === 'user-statement' && (!input.evidence.length || input.evidence.some(id => !db!.prepare("SELECT id FROM conversation_records WHERE id=? AND json_extract(payload, '$.kind')='user'").get(id)))) throw Error('User provenance requires original user messages');
      const value: CanonicalState = { ...input, revision: (old?.revision ?? 0) + 1, createdAt: old?.createdAt ?? now, revisedAt: now,
        ...(old?.dueAt === input.dueAt && old?.reviewedAt ? { reviewedAt: old.reviewedAt } : {}) };
      db!.prepare('INSERT INTO canonical_state VALUES (?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET kind=excluded.kind,status=excluded.status,text=excluded.text,payload=excluded.payload').run(value.id, value.kind, value.status, value.text, JSON.stringify(value));
      return value;
    });
    case 'readAttention': {
      const saved = db.prepare('SELECT attention FROM logical_conversation').get()?.attention;
      return typeof saved === 'string' ? JSON.parse(saved) : null;
    }
    case 'writeAttention':
      db.prepare('UPDATE logical_conversation SET attention=?').run(JSON.stringify(request.input));
      return null;
    case 'scheduledState': return db.prepare(`SELECT payload FROM canonical_state WHERE status='active' AND json_extract(payload, '$.dueAt') IS NOT NULL AND COALESCE(json_extract(payload, '$.reviewedAt'),-1)<json_extract(payload, '$.dueAt') ORDER BY json_extract(payload, '$.dueAt'), id LIMIT 50`).all().map(r => JSON.parse(String(r.payload)));
    case 'findState': {
      const q = StateQuery.parse(request.input);
      return db.prepare(`SELECT payload FROM canonical_state WHERE (? IS NULL OR kind=?) AND (? IS NULL OR status=?) AND (? IS NULL OR instr(lower(text),lower(?))>0) ORDER BY CASE WHEN json_extract(payload, '$.dueAt') IS NOT NULL AND json_extract(payload, '$.dueAt')<=unixepoch('subsec')*1000 AND COALESCE(json_extract(payload, '$.reviewedAt'),-1)<json_extract(payload, '$.dueAt') THEN 0 ELSE 1 END, json_extract(payload, '$.revisedAt') DESC, id LIMIT ? OFFSET ?`).all(q.kind ?? null,q.kind ?? null,q.status ?? null,q.status ?? null,q.search ?? null,q.search ?? null,q.limit,q.offset).map(r => JSON.parse(String(r.payload)));
    }
    case 'reviewState': return transaction(() => {
      if (!Array.isArray(request.input.ids) || request.input.ids.length > 50 || !Number.isFinite(request.input.at)) throw Error('Invalid review acknowledgement');
      for (const id of request.input.ids) { validateId(id); const row = db!.prepare('SELECT payload FROM canonical_state WHERE id=?').get(id); if (!row) continue;
        const state: CanonicalState = JSON.parse(String(row.payload));
        if (state.dueAt !== null && state.dueAt <= request.input.at) db!.prepare('UPDATE canonical_state SET payload=? WHERE id=?').run(JSON.stringify({ ...state, reviewedAt: request.input.at }), id);
      } return null;
    });
    case 'maintain': prune(Date.now()); evidence.prune(); return null;
    case 'putEvidence': return evidence.put(request.input.data, request.input.mime, request.input.expiresAt);
    case 'getEvidence': return evidence.get(request.input.id);
    case 'forgetSource': { transaction(() => {
      const source = request.input.source; if (!['chrome','screen'].includes(source)) throw Error('Invalid source');
      // Retrieved evidence can be embedded in tool results and interpretation. Preserve direct user statements,
      // purge derived state and tool history rather than retaining revoked content through a back door.
      db!.exec("DELETE FROM conversation_records WHERE json_extract(payload, '$.kind') != 'user'; DELETE FROM canonical_state;");
      db!.prepare("DELETE FROM observations WHERE json_extract(payload, '$.disclosure.source')=? OR ?='screen'").run(source,source);
      db!.exec('DELETE FROM evidence');
      return null;
    }); measureJournal(); evidence.prune(); return null; }
    case 'write': {
      const o = request.input.observation, json = validateObservation(o);
      return transaction(() => {
        const existing = db!.prepare('SELECT payload FROM observations WHERE id=?').get(o.id);
        if (existing && existing.payload !== json) throw Error('Observation ID already contains different evidence');
        const inserted = !existing, now = request.input.now ?? Date.now();
        if (inserted) db!.prepare('INSERT INTO observations VALUES (?,?,?,?,?,?,?)').run(o.id, o.at, now, o.source, o.content.process, o.content.title, json);
        if (inserted) appendRecord({ id: 'observation:' + createHash('sha256').update(o.id).digest('hex'), at: o.at, kind: 'observation', observationId: o.id });
        prune(now);
        return { inserted };
      });
    }
    case 'conversation': {
      if (!Number.isInteger(request.input.limit) || request.input.limit < 1 || request.input.limit > 2000) throw Error('Invalid conversation limit');
      const rows = db.prepare(`SELECT c.sequence, c.payload, o.payload AS observation FROM conversation_records c LEFT JOIN observations o ON o.id=c.observation_id WHERE (? = 0 OR json_extract(c.payload, '$.kind') IN ('user','assistant')) AND (? = 'all' OR (? = 'only' AND o.id IS NOT NULL) OR (? = 'exclude' AND c.observation_id IS NULL)) ORDER BY c.sequence DESC LIMIT ?`).all(request.input.dialogueOnly ? 1 : 0, request.input.observations ?? 'all', request.input.observations ?? 'all', request.input.observations ?? 'all', request.input.limit).reverse();
      return { id: db.prepare('SELECT id FROM logical_conversation').get()!.id, records: rows.map(row => ({ ...JSON.parse(row.payload as string), sequence: Number(row.sequence), ...(row.observation ? { observation: JSON.parse(row.observation as string) } : {}) })) };
    }
    case 'appendConversation': return transaction(() => appendRecord(request.input));
    case 'clearConversation': db.exec('DELETE FROM conversation_records'); measureJournal(); return null;
    case 'recent': return recent(request.input);
    case 'restore': return recent({ limit: 256 }, 256).reverse();
    case 'get': validateId(request.input.id); return read(db.prepare('SELECT payload FROM observations WHERE id=?').get(request.input.id));
    case 'stats': return { count: Number(db.prepare('SELECT count(*) AS count FROM observations').get()!.count), oldest: read(db.prepare('SELECT payload FROM observations ORDER BY observed_at, id LIMIT 1').get()), newest: recent({ limit: 1 })[0] };
    case 'close': evidence.prune(); db.close(); db = undefined; return null;
  }
}
parentPort.on('message', (request: ArchiveRequest) => {
  let response: ArchiveResponse;
  try { response = { id: request.id, ok: true, value: dispatch(request) as Extract<ArchiveResponse, { ok: true }>['value'] }; }
  catch (error) { response = { id: request.id, ok: false, error: error instanceof Error ? error.message : String(error) }; }
  parentPort!.postMessage(response);
  if (request.op === 'close' || (request.op === 'initialize' && !response.ok)) parentPort!.close();
});
