import { StateInput, StateQuery, DEFAULT_EVIDENCE_RETENTION, type CanonicalState } from './canonicalState';
import { EvidenceStore } from './evidenceStore';
import { randomUUID, createHash } from 'node:crypto';
import type { RecordInput } from './cognitiveContracts';
import { parentPort, threadId, isMainThread } from 'node:worker_threads';
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { assertSyntheticProfile } from './selection';
import { validateDiscovery, validateId, validateObservation, validateQuery, type ArchiveRequest, type ArchiveResponse, type RetentionPolicy, type ArchiveQuery, type DiscoveryQuery } from './windowFocusArchiveContracts';
import { observationHash, observationSlot } from './workingObservations';
import type { Observation } from './contracts';
if (isMainThread || !parentPort) throw Error('Archive requires a worker thread');
let db: DatabaseSync | undefined;
let retention: RetentionPolicy;
let evidence: EvidenceStore;
let fts = false;
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
  db!.prepare("DELETE FROM observations WHERE ingested_at < ? OR json_extract(payload, '$.disclosure.retainUntil') <= ?").run(now - retention.maxAgeMs, now);
  db!.prepare('DELETE FROM observations WHERE id IN (SELECT id FROM observations ORDER BY ingested_at DESC, rowid DESC LIMIT -1 OFFSET ?)').run(retention.maxRecords);
}
function read(row: Record<string, unknown> | undefined): Observation | undefined { return row ? JSON.parse(row.payload as string) : undefined; }
function recent(query: ArchiveQuery, max = 100) {
  const q = validateQuery(query, max);
  return db!.prepare(`SELECT payload FROM observations WHERE (? IS NULL OR observed_at >= ?) AND (? IS NULL OR observed_at <= ?)
    AND (? IS NULL OR instr(lower(title), lower(?)) > 0 OR instr(lower(process), lower(?)) > 0 OR instr(lower(payload), lower(?)) > 0)
    ORDER BY observed_at DESC, id DESC LIMIT ?`).all(q.from ?? null, q.from ?? null, q.to ?? null, q.to ?? null, q.search ?? null, q.search ?? null, q.search ?? null, q.search ?? null, q.limit).map(row => read(row)!);
}
function initializeSearch() {
  try { db!.exec('CREATE VIRTUAL TABLE temp.capri_fts_probe USING fts5(text); DROP TABLE temp.capri_fts_probe;'); }
  catch (error) {
    if (!String(error).includes('no such module: fts5')) throw error;
    db!.exec('DROP TRIGGER IF EXISTS observation_search_insert; DROP TRIGGER IF EXISTS observation_search_delete; DROP TRIGGER IF EXISTS dialogue_search_insert; DROP TRIGGER IF EXISTS dialogue_search_delete;');
    return;
  }
  fts = true;
  initializeDialogueSearch();
  if (db!.prepare("SELECT 1 FROM sqlite_master WHERE name='observation_search_insert'").get()) return;
  // A database opened on a build without FTS may have continued accepting writes.
  db!.exec('DROP TABLE IF EXISTS observation_search;');
  const text = (payload: string) => `coalesce(json_extract(${payload}, '$.content.text'), '') || ' ' ||
    coalesce((SELECT group_concat(json_extract(value, '$.text'), ' ') FROM json_each(${payload}, '$.content.sections')), '')`;
  db!.exec(`CREATE VIRTUAL TABLE observation_search USING fts5(title, process, body);
    INSERT INTO observation_search(rowid,title,process,body) SELECT rowid,title,process,${text('payload')} FROM observations;
    CREATE TRIGGER observation_search_insert AFTER INSERT ON observations BEGIN
      INSERT INTO observation_search(rowid,title,process,body) VALUES(new.rowid,new.title,new.process,${text('new.payload')});
    END;
    CREATE TRIGGER observation_search_delete AFTER DELETE ON observations BEGIN
      DELETE FROM observation_search WHERE rowid=old.rowid;
    END;`);
}
function initializeDialogueSearch() {
  if (db!.prepare("SELECT 1 FROM sqlite_master WHERE name='dialogue_search_insert'").get()) return;
  db!.exec(`DROP TABLE IF EXISTS dialogue_search;
    CREATE VIRTUAL TABLE dialogue_search USING fts5(text);
    INSERT INTO dialogue_search(rowid,text)
      SELECT sequence,json_extract(payload,'$.text') FROM conversation_records
      WHERE json_extract(payload,'$.kind') IN ('user','assistant');
    CREATE TRIGGER dialogue_search_insert AFTER INSERT ON conversation_records
      WHEN json_extract(new.payload,'$.kind') IN ('user','assistant') BEGIN
      INSERT INTO dialogue_search(rowid,text) VALUES(new.sequence,json_extract(new.payload,'$.text'));
    END;
    CREATE TRIGGER dialogue_search_delete AFTER DELETE ON conversation_records
      WHEN json_extract(old.payload,'$.kind') IN ('user','assistant') BEGIN
      DELETE FROM dialogue_search WHERE rowid=old.sequence;
    END;`);
}
function discover(input: DiscoveryQuery) {
  const q = validateDiscovery(input);
  const terms = (q.search?.match(/[\p{L}\p{N}_]+/gu) ?? []).slice(0, 24);
  const ranked = fts && terms.length > 0;
  const words = [...new Set(terms.map(term => '"' + term.toLowerCase() + '"'))];
  const match = words.join(' AND ');
  const phrase = '"' + terms.join(' ') + '"';
  const relaxed = words.join(' OR ');
  const ranking = ranked ? 'phrase then all terms then partial; BM25 ascending within tier' : q.search ? 'bounded-literal' : 'chronological';
  const branches = ranked && words.length > 1
    ? [{ tier: 0, match: phrase }, { tier: 1, match }, { tier: 2, match: relaxed }]
    : [{ tier: 0, match }];
  if (q.modality === 'dialogue') {
    const sql = `SELECT c.sequence, ${ranked ? 'bm25(dialogue_search)' : 'NULL'} AS score
      FROM ${ranked ? 'dialogue_search JOIN conversation_records c ON c.sequence=dialogue_search.rowid'
        : '(SELECT * FROM conversation_records WHERE observation_id IS NULL ORDER BY sequence DESC LIMIT 4096) c'}
      WHERE ${ranked ? 'dialogue_search MATCH ?' : "(? IS NULL OR instr(lower(json_extract(c.payload,'$.text')),lower(?))>0)"}
        AND json_extract(c.payload,'$.kind') IN ('user','assistant')
        AND json_extract(c.payload,'$.at') BETWEEN ? AND ?
        AND (? IS NULL OR c.id=?)
      `;
    const rows = db!.prepare(`WITH candidates AS MATERIALIZED (
        ${branches.map(({ tier }) => 'SELECT ' + tier + ' AS tier, matches.* FROM (' + sql + ') matches').join(' UNION ALL ')}
      ), best AS (
        SELECT *, row_number() OVER (PARTITION BY sequence ORDER BY tier, score) AS duplicate FROM candidates
      ), ordered AS (
        SELECT *, row_number() OVER (PARTITION BY tier ORDER BY score, sequence DESC) AS tier_position
        FROM best WHERE duplicate=1
      ), page AS (
        SELECT sequence, tier, score FROM ordered
        WHERE tier<2 OR (tier_position<=24 AND (SELECT count(*) FROM ordered WHERE tier<2)<12)
        ORDER BY tier, score, sequence DESC LIMIT ? OFFSET ?
      )
      SELECT c.payload, page.tier, page.score FROM page JOIN conversation_records c ON c.sequence=page.sequence
      ORDER BY page.tier, page.score, page.sequence DESC`).all(
        ...branches.flatMap(branch => [...(ranked ? [branch.match] : [q.search ?? null,q.search ?? null]),
          q.from ?? -Number.MAX_VALUE, q.to ?? Number.MAX_VALUE, q.relatedId ?? null, q.relatedId ?? null]), q.limit + 1, q.offset);
    return { hits: rows.slice(0,q.limit).map(row => {
      const { id, kind, at, text } = JSON.parse(String(row.payload));
      return { dialogue: { id, kind, at, text: text.slice(0,280) }, score: row.score, tier: Number(row.tier) };
    }), nextOffset: rows.length > q.limit && q.offset + q.limit <= 10000 ? q.offset + q.limit : null,
      ranking };
  }
  const sql = `SELECT o.id, o.observed_at, evidence_key(o.payload) AS evidence_key, ${ranked ? "bm25(observation_search,3,2,1) AS score, snippet(observation_search,-1,'','','...',20) AS snippet" : 'NULL AS score, NULL AS snippet'}
    FROM ${ranked ? 'observation_search JOIN observations o ON o.rowid=observation_search.rowid'
      : q.search ? '(SELECT * FROM observations ORDER BY observed_at DESC LIMIT 4096) o' : 'observations o'}
    WHERE ${ranked ? 'observation_search MATCH ?' : '(? IS NULL OR instr(lower(o.payload),lower(?))>0)'}
      AND o.observed_at BETWEEN ? AND ?
      AND (? IS NULL OR o.source=? OR o.process=? OR json_extract(o.payload,'$.sourceIdentity')=? OR json_extract(o.payload,'$.content.handle')=?)
      AND (? IS NULL OR json_extract(o.payload,'$.modality')=?)
      AND (? IS NULL OR o.id=? OR EXISTS(SELECT 1 FROM json_each(o.payload,'$.related') WHERE value=?))
    `;
  const source = q.source ?? null, modality = q.modality ?? null, related = q.relatedId ?? null;
  const filters = [q.from ?? -Number.MAX_VALUE, q.to ?? Number.MAX_VALUE, source, source, source, source, source,
    modality, modality, related, related, related];
  // Apply pagination after choosing one representative per source/content pair.
  // Bound partial results across the query, independently of page size.
  const rows = db!.prepare(`WITH candidates AS MATERIALIZED (
      ${branches.map(({ tier }) => 'SELECT ' + tier + ' AS tier, matches.* FROM (' + sql + ') matches').join(' UNION ALL ')}
    ), unique_hits AS (
      SELECT *, row_number() OVER (PARTITION BY evidence_key ORDER BY tier, score, observed_at DESC, id DESC) AS duplicate
      FROM candidates
    ), ordered AS (
      SELECT *, row_number() OVER (PARTITION BY tier ORDER BY score, observed_at DESC, id DESC) AS tier_position
      FROM unique_hits WHERE duplicate=1
    )
    , page AS (
      SELECT id, tier, score, snippet, observed_at FROM ordered
      WHERE tier<2 OR (tier_position<=24 AND (SELECT count(*) FROM ordered WHERE tier<2)<12)
      ORDER BY tier, score, observed_at DESC, id DESC LIMIT ? OFFSET ?
    )
    SELECT o.payload, page.tier, page.score, page.snippet FROM page JOIN observations o ON o.id=page.id
    ORDER BY page.tier, page.score, page.observed_at DESC, page.id DESC`).all(
      ...branches.flatMap(branch => [...(ranked ? [branch.match] : [q.search ?? null,q.search ?? null]), ...filters]),
      q.limit + 1, q.offset);
  return { hits: rows.slice(0,q.limit).map(row => {
      const original = read(row)!;
      const { text, sections, ...metadata } = original.content;
      const snippet = typeof row.snippet === 'string' ? row.snippet : '';
      const preview = (snippet || text?.trim() || sections?.find(section => section.text.trim())?.text || metadata.title).slice(0,280);
      return { observation: { ...original, content: { ...metadata, text: preview } },
        score: row.score, tier: Number(row.tier), contentHash: observationHash(original) };
    }),
    nextOffset: rows.length > q.limit && q.offset + q.limit <= 10000 ? q.offset + q.limit : null,
    ranking };
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
function rememberScene(o: Observation, sequence: number) {
  db!.prepare(`INSERT INTO scene_sources VALUES (?,?,?,?,?) ON CONFLICT(slot) DO UPDATE SET
    observation_id=excluded.observation_id, hash=excluded.hash, sequence=excluded.sequence,
    changed_sequence=CASE WHEN scene_sources.hash=excluded.hash THEN scene_sources.changed_sequence ELSE excluded.sequence END`)
    .run(observationSlot(o), o.id, observationHash(o), sequence, sequence);
  db!.prepare('DELETE FROM scene_sources WHERE slot IN (SELECT slot FROM scene_sources ORDER BY sequence DESC LIMIT -1 OFFSET 96)').run();
}
function rememberEpisode(sequence: number, at: number) {
  const previous = db!.prepare('SELECT id,started_at,last_activity_at FROM activity_episodes ORDER BY id DESC LIMIT 1').get();
  if (previous && at - Number(previous.last_activity_at) <= 5 * 60_000 && at - Number(previous.started_at) < 30 * 60_000) {
    db!.prepare('UPDATE activity_episodes SET end_sequence=?, last_activity_at=max(last_activity_at,?), observations=observations+1 WHERE id=?')
      .run(sequence, at, previous.id!);
  } else db!.prepare('INSERT INTO activity_episodes VALUES(?,?,?,?,1)').run(sequence, sequence, at, at);
}
function pruneEpisodes() {
  db!.exec(`DELETE FROM activity_episodes AS episode WHERE NOT EXISTS (
    SELECT 1 FROM conversation_records c JOIN observations o ON o.id=c.observation_id
    WHERE c.sequence BETWEEN episode.id AND episode.end_sequence
  )`);
}
// Fetch only factual state for Layer 0. Large bodies remain in the archive.
const sceneProjection = `json_remove(o.payload, '$.content.sections', '$.content.text', '$.content.changedSections') AS payload`;
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
      if (version > 6) throw Error('Newer unsupported archive schema; upgrade Capri');
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
        if (version < 5) {
          db!.exec(`ALTER TABLE logical_conversation ADD COLUMN scene_cursor INTEGER NOT NULL DEFAULT 0;
            CREATE INDEX conversation_observations ON conversation_records(sequence) WHERE observation_id IS NOT NULL;
            CREATE TABLE scene_sources (slot TEXT PRIMARY KEY, observation_id TEXT NOT NULL, hash TEXT NOT NULL, sequence INTEGER NOT NULL, changed_sequence INTEGER NOT NULL);
            CREATE TRIGGER scene_delete AFTER DELETE ON observations BEGIN DELETE FROM scene_sources WHERE observation_id=old.id; END;
            UPDATE logical_conversation SET scene_cursor=(SELECT coalesce(max(sequence),0) FROM conversation_records);
            PRAGMA user_version=5;`);
          const rows = db!.prepare('SELECT c.sequence, o.payload FROM conversation_records c JOIN observations o ON o.id=c.observation_id ORDER BY c.sequence DESC LIMIT 256').all().reverse();
          for (const row of rows) rememberScene(read(row)!, Number(row.sequence));
        }
        if (version < 6) {
          db!.exec(`CREATE TABLE activity_episodes (
          id INTEGER PRIMARY KEY, end_sequence INTEGER NOT NULL, started_at REAL NOT NULL,
          last_activity_at REAL NOT NULL, observations INTEGER NOT NULL);
          PRAGMA user_version=6;`);
          const recent = db!.prepare(`SELECT c.sequence,o.ingested_at FROM conversation_records c
            JOIN observations o ON o.id=c.observation_id ORDER BY c.sequence DESC LIMIT 512`).all().reverse();
          for (const row of recent) rememberEpisode(Number(row.sequence), Number(row.ingested_at));
        }
        db!.function('evidence_key', { deterministic: true }, payload => {
        const o: Observation = JSON.parse(String(payload));
        return JSON.stringify([o.modality, o.sourceIdentity ?? o.source, observationHash(o)]);
      });
      initializeSearch();
        prune(now ?? Date.now());
        pruneEpisodes();
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
      if (input.pinned && input.status === 'active' && !(old?.pinned && old.status === 'active') &&
          Number(db!.prepare("SELECT count(*) AS n FROM canonical_state WHERE status='active' AND json_extract(payload,'$.pinned')=1").get()!.n) >= 6) throw Error('Foundational memory limit reached');
      if (input.expiresAt !== undefined && (input.kind !== 'checkpoint' || input.expiresAt <= now || input.expiresAt > now + 365 * 86400000)) throw Error('Invalid checkpoint expiration');
      if (input.episodeId !== undefined && (!['checkpoint', 'investigation'].includes(input.kind) ||
          !db!.prepare('SELECT id FROM activity_episodes WHERE id=?').get(input.episodeId))) throw Error('Unknown activity episode');
      if (input.dueAt !== null && (!['intention','investigation','interest'].includes(input.kind) || input.dueAt > now + 365 * 86400000)) throw Error('Invalid future review');
      for (const id of input.evidence) if (!db!.prepare('SELECT id FROM observations WHERE id=?').get(id) && !db!.prepare('SELECT id FROM conversation_records WHERE id=?').get(id)) throw Error('Evidence reference is missing');
      if (input.provenance === 'host-observation' && (!input.evidence.length || input.evidence.some(id => !db!.prepare('SELECT id FROM observations WHERE id=?').get(id)))) throw Error('Host provenance requires original observations');
      if (input.provenance === 'user-statement' && (!input.evidence.length || input.evidence.some(id => !db!.prepare("SELECT id FROM conversation_records WHERE id=? AND json_extract(payload, '$.kind')='user'").get(id)))) throw Error('User provenance requires original user messages');
      const schedulesInvestigation = input.kind === 'investigation' && input.status === 'active' && input.dueAt !== null && old?.dueAt !== input.dueAt;
      const scheduledReviews = (old?.scheduledReviews ?? 0) + Number(schedulesInvestigation);
      if (schedulesInvestigation && scheduledReviews > 4) throw Error('Investigation review budget exhausted; complete, retire or continue on direct request');
      const value: CanonicalState = { ...input, revision: (old?.revision ?? 0) + 1, createdAt: old?.createdAt ?? now, revisedAt: now,
        ...(scheduledReviews ? { scheduledReviews } : {}),
        ...(old?.dueAt === input.dueAt && old?.reviewedAt ? { reviewedAt: old.reviewedAt } : {}) };
      db!.prepare('INSERT INTO canonical_state VALUES (?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET kind=excluded.kind,status=excluded.status,text=excluded.text,payload=excluded.payload').run(value.id, value.kind, value.status, value.text, JSON.stringify(value));
      return value;
    });
    case 'discover': return discover(request.input);
    case 'latestSource': return read(db.prepare('SELECT o.payload FROM scene_sources s JOIN observations o ON o.id=s.observation_id WHERE s.slot=?').get(request.input.slot));
    case 'episodeList': {
      const { source, before, now, ...times } = request.input;
      prune(now ?? Date.now());
      validateQuery(times);
      if (source !== undefined) validateId(source);
      if (before !== undefined && (!Number.isSafeInteger(before) || before < 1)) throw Error('Invalid episode cursor');
      return db.prepare(`SELECT e.id,e.end_sequence AS endSequence,e.started_at AS startedAt,e.last_activity_at AS lastActivityAt,e.observations
        FROM activity_episodes e WHERE e.id<? AND e.started_at<=? AND e.last_activity_at>=?
        AND (? IS NULL OR EXISTS(SELECT 1 FROM conversation_records c JOIN observations o ON o.id=c.observation_id
          WHERE c.sequence BETWEEN e.id AND e.end_sequence AND (o.source=? OR o.process=? OR json_extract(o.payload,'$.sourceIdentity')=? OR json_extract(o.payload,'$.content.handle')=?)))
        ORDER BY e.id DESC LIMIT 12`).all(before ?? Number.MAX_SAFE_INTEGER, times.to ?? Number.MAX_VALUE, times.from ?? -Number.MAX_VALUE,
          source ?? null, source ?? null, source ?? null, source ?? null, source ?? null);
    }
    case 'sceneEvents': {
      const { after, through, limit, latest, source, now = Date.now(), watchStartedAt } = request.input;
      if (source !== undefined) validateId(source);
      if (![after, through, limit].every(Number.isSafeInteger) || after < 0 || through < after || limit < 1 || limit > 50) throw Error('Invalid event range');
      const rows = db.prepare(`SELECT c.sequence,json_extract(c.payload,'$.conditions') AS conditions,${sceneProjection} FROM conversation_records c LEFT JOIN observations o ON o.id=c.observation_id
        AND o.ingested_at>=? AND coalesce(json_extract(o.payload,'$.disclosure.retainUntil'),?)>?
        WHERE c.observation_id IS NOT NULL AND c.sequence>? AND c.sequence<=?
        AND (? IS NULL OR o.source=? OR o.process=? OR json_extract(o.payload,'$.sourceIdentity')=? OR json_extract(o.payload,'$.content.handle')=?)
        AND (? IS NULL OR (o.observed_at>=? AND json_extract(c.payload,'$.conditions') IS NOT NULL))
        ORDER BY c.sequence ${latest ? 'DESC' : 'ASC'} LIMIT ?`).all(now - retention.maxAgeMs, Number.MAX_VALUE, now, after, through, ...Array(5).fill(source ?? null), watchStartedAt ?? null, watchStartedAt ?? null, limit + 1);
      return { events: rows.slice(0, limit).map(row => ({ sequence: Number(row.sequence), observation: row.payload ? read(row) : undefined, conditions: row.conditions ? JSON.parse(String(row.conditions)) : undefined })),
        nextAfter: rows.length > limit ? Number(rows[limit - 1].sequence) : null };
    }
    case 'readScene': {
      prune(request.input.now ?? Date.now());
      const cursor = Number(db.prepare('SELECT scene_cursor FROM logical_conversation').get()!.scene_cursor);
      const rows = db.prepare(`SELECT s.sequence,s.changed_sequence,${sceneProjection} FROM scene_sources s
        JOIN observations o ON o.id=s.observation_id ORDER BY s.sequence DESC`).all();
      const window = db.prepare(`SELECT count(*) AS recorded,count(o.id) AS retained,max(c.sequence) AS last,
        min(json_extract(c.payload,'$.at')) AS firstAt,max(json_extract(c.payload,'$.at')) AS lastAt
        FROM conversation_records c LEFT JOIN observations o ON o.id=c.observation_id
        WHERE c.observation_id IS NOT NULL AND c.sequence>?`).get(cursor)!;
      const version = Math.max(cursor, Number(window.last));
      return {
        coverage: { after: cursor, through: version, recorded: Number(window.recorded), retained: Number(window.retained),
          firstAt: window.firstAt, lastAt: window.lastAt },
        episode: db.prepare(`SELECT id,end_sequence AS endSequence,started_at AS startedAt,last_activity_at AS lastActivityAt,observations
          FROM activity_episodes ORDER BY id DESC LIMIT 1`).get(),
        recent: db.prepare(`SELECT ${sceneProjection} FROM
          (SELECT sequence,observation_id FROM conversation_records WHERE sequence>? AND observation_id IS NOT NULL ORDER BY sequence DESC LIMIT 24) c
          JOIN observations o ON o.id=c.observation_id ORDER BY c.sequence DESC`).all(cursor).map(row => read(row)!),
        cursor, version,
        latest: rows.map(r => read(r)!),
        changes: rows.filter(r => Number(r.changed_sequence) > cursor && Number(r.sequence) <= version).map(r => read(r)!),
      };
    }
    case 'acknowledgeScene':
      if (!Number.isSafeInteger(request.input.version) || request.input.version < 0) throw Error('Invalid scene cursor');
      if (!db.prepare('SELECT 1 FROM conversation_records WHERE sequence=? AND observation_id IS NOT NULL').get(request.input.version)) {
        const cursor = Number(db.prepare('SELECT scene_cursor FROM logical_conversation').get()!.scene_cursor);
        if (request.input.version > cursor) throw Error('Scene cursor is outside the observation journal');
      }
      db.prepare('UPDATE logical_conversation SET scene_cursor=max(scene_cursor,?)').run(request.input.version);
      return null;
    case 'dialogueExchange': {
      validateId(request.input.id);
      const hit=db.prepare("SELECT sequence FROM conversation_records WHERE id=? AND json_extract(payload,'$.kind') IN ('user','assistant')").get(request.input.id);
      if(!hit)return [];
      const start=db.prepare("SELECT max(sequence) AS n FROM conversation_records WHERE sequence<=? AND json_extract(payload,'$.kind')='user'").get(Number(hit.sequence))?.n;
      if(start==null)return [];
      const end=db.prepare("SELECT min(sequence) AS n FROM conversation_records WHERE sequence>? AND json_extract(payload,'$.kind')='user'").get(Number(start))?.n;
      const rows=db.prepare("SELECT sequence,payload FROM conversation_records WHERE sequence>=? AND sequence<? AND json_extract(payload,'$.kind') IN ('user','assistant') ORDER BY sequence LIMIT 65").all(Number(start),end==null?Number.MAX_SAFE_INTEGER:Number(end));
      // Oversized exchanges remain explicitly retrievable; never supply a clipped exchange as complete.
      if(rows.length>64||rows.reduce((n,r)=>n+Buffer.byteLength(String(r.payload)),0)>24000)return [];
      return rows.map(r=>({...JSON.parse(String(r.payload)),sequence:Number(r.sequence)}));
    }
    case 'getDialogue': {
      const row = db.prepare("SELECT payload FROM conversation_records WHERE id=? AND json_extract(payload, '$.kind') IN ('user','assistant')").get(request.input.id);
      if (!row) return null;
      const { id, at, kind, text } = JSON.parse(String(row.payload));
      return { id, at, kind, text };
    }
    case 'hasDialogue':
      return !!db.prepare("SELECT 1 FROM conversation_records WHERE id=? AND json_extract(payload, '$.kind') IN ('user','assistant')").get(request.input.id);
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
      return db.prepare(`SELECT payload FROM canonical_state WHERE (? IS NULL OR kind=?) AND (? IS NULL OR status=?) AND (? IS NULL OR instr(lower(text),lower(?))>0) ORDER BY coalesce(json_extract(payload, '$.pinned'),0) DESC, CASE WHEN json_extract(payload, '$.dueAt') IS NOT NULL AND json_extract(payload, '$.dueAt')<=unixepoch('subsec')*1000 AND COALESCE(json_extract(payload, '$.reviewedAt'),-1)<json_extract(payload, '$.dueAt') THEN 0 ELSE 1 END, json_extract(payload, '$.revisedAt') DESC, id LIMIT ? OFFSET ?`).all(q.kind ?? null,q.kind ?? null,q.status ?? null,q.status ?? null,q.search ?? null,q.search ?? null,q.limit,q.offset).map(r => JSON.parse(String(r.payload)));
    }
    case 'reviewState': return transaction(() => {
      if (!Array.isArray(request.input.ids) || request.input.ids.length > 50 || !Number.isFinite(request.input.at)) throw Error('Invalid review acknowledgement');
      for (const id of request.input.ids) { validateId(id); const row = db!.prepare('SELECT payload FROM canonical_state WHERE id=?').get(id); if (!row) continue;
        const state: CanonicalState = JSON.parse(String(row.payload));
        if (state.dueAt !== null && state.dueAt <= request.input.at) db!.prepare('UPDATE canonical_state SET payload=? WHERE id=?').run(JSON.stringify({ ...state, reviewedAt: request.input.at }), id);
      } return null;
    });
    case 'maintain': prune(Date.now()); pruneEpisodes(); evidence.prune(); return null;
    case 'putEvidence': return evidence.put(request.input.data, request.input.mime, request.input.expiresAt);
    case 'getEvidence': return evidence.get(request.input.id);
    case 'forgetSource': { transaction(() => {
      const source = request.input.source; if (!['chrome','screen'].includes(source)) throw Error('Invalid source');
      // Retrieved evidence can be embedded in tool results and interpretation. Preserve direct user statements,
      // purge derived state and tool history rather than retaining revoked content through a back door.
      db!.exec("DELETE FROM conversation_records WHERE json_extract(payload, '$.kind') != 'user'; DELETE FROM canonical_state; DELETE FROM activity_episodes; UPDATE logical_conversation SET attention=NULL;");
      db!.prepare("DELETE FROM observations WHERE json_extract(payload, '$.disclosure.source')=? OR ?='screen' OR lower(process) IN ('chrome','chrome.exe')").run(source,source);
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
        if (inserted) {
          const { sequence } = appendRecord({ id: 'observation:' + createHash('sha256').update(o.id).digest('hex'), at: o.at, kind: 'observation', observationId: o.id, conditions: request.input.conditions });
          rememberScene(o, sequence);
          rememberEpisode(sequence, now);
        }
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
    case 'clearConversation': db.exec('DELETE FROM conversation_records; DELETE FROM activity_episodes'); measureJournal(); return null;
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
