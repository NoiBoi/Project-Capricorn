import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { Checkpoints, RecordKind, StatePersistence, StateRecord } from '../../core/contracts';

const VERSION = 2;
/** Bounded synchronous transactions. Values are JSON; callers must enforce retention.
 * The database lives outside ASAR, never in the installed application directory. */
export class CognitiveSqlite implements StatePersistence, Checkpoints {
  private db: DatabaseSync;
  private depth = 0;
  private closed = false;
  constructor(readonly file: string, private now = Date.now) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    this.db = new DatabaseSync(file);
    try {
      this.db.exec('PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON; PRAGMA secure_delete=ON;');
      this.integrity();
      const version = Number(this.db.prepare('PRAGMA user_version').get()!.user_version);
      if (version > VERSION) throw Error('Cognitive database is newer than this app; preserved for upgrade.');
      if (version && version < VERSION) this.backup(file + `.v${version}.${Date.now()}.backup`);
      this.transaction(() => {
        if (version < 1) this.db.exec(`CREATE TABLE records(kind TEXT NOT NULL, id TEXT NOT NULL, revision INTEGER NOT NULL, at REAL NOT NULL, value TEXT NOT NULL, PRIMARY KEY(kind,id)); PRAGMA user_version=1;`);
        if (version < 2) this.db.exec(`CREATE TABLE dependencies(kind TEXT NOT NULL,id TEXT NOT NULL,source TEXT NOT NULL,PRIMARY KEY(kind,id,source),FOREIGN KEY(kind,id) REFERENCES records(kind,id) ON DELETE CASCADE); CREATE INDEX dependency_source ON dependencies(source); PRAGMA user_version=2;`);
      });
      // DELETE journal + FULL synchronous avoids copying an incomplete WAL on Windows.
      this.db.exec('PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL;');
    } catch (error) { this.db.close(); throw error; }
  }
  integrity() {
    const rows = this.db.prepare('PRAGMA integrity_check').all();
    if (rows.length !== 1 || rows[0].integrity_check !== 'ok') throw Error('Cognitive database integrity failed; file preserved. Restore a verified backup explicitly.');
    if (this.db.prepare('PRAGMA foreign_key_check').all().length) throw Error('Cognitive dependency integrity failed; file preserved.');
  }
  transaction<T>(run: () => T): T {
    const name = `nested_${this.depth++}`, nested = this.depth > 1;
    try {
      this.db.exec(nested ? `SAVEPOINT ${name}` : 'BEGIN IMMEDIATE');
      try {
        const result = run();
        if (result && typeof (result as { then?: unknown }).then === 'function') throw Error('Transactions must be synchronous');
        this.db.exec(nested ? `RELEASE ${name}` : 'COMMIT'); return result;
      } catch (error) {
        this.db.exec(nested ? `ROLLBACK TO ${name}; RELEASE ${name}` : 'ROLLBACK'); throw error;
      }
    } finally { this.depth--; }
  }
  put(record: StateRecord) {
    if (!Number.isSafeInteger(record.revision) || record.revision < 0 || !Number.isFinite(record.at)) throw Error('Invalid state revision or timestamp');
    const value = JSON.stringify(record.value);
    if (value === undefined) throw Error('State must be JSON');
    return this.transaction(() => {
      const changed = this.db.prepare(`INSERT INTO records VALUES(?,?,?,?,?) ON CONFLICT(kind,id) DO UPDATE SET revision=excluded.revision,at=excluded.at,value=excluded.value WHERE excluded.revision>records.revision`).run(record.kind, record.id, record.revision, record.at, value).changes;
      if (!changed) return false;
      this.db.prepare('DELETE FROM dependencies WHERE kind=? AND id=?').run(record.kind, record.id);
      for (const source of new Set(record.dependencies)) this.db.prepare('INSERT INTO dependencies VALUES(?,?,?)').run(record.kind, record.id, source);
      return true;
    });
  }
  get(kind: RecordKind, id: string): StateRecord | undefined {
    const row = this.db.prepare('SELECT * FROM records WHERE kind=? AND id=?').get(kind, id);
    if (!row) return;
    const dependencies = this.db.prepare('SELECT source FROM dependencies WHERE kind=? AND id=? ORDER BY source').all(kind,id).map(r => String(r.source));
    return { kind, id, revision: Number(row.revision), at: Number(row.at), value: JSON.parse(String(row.value)), dependencies };
  }
  remove(kind: RecordKind, id: string) { this.db.prepare('DELETE FROM records WHERE kind=? AND id=?').run(kind,id); }
  invalidate(source: string) {
    return this.transaction(() => {
      const removed: string[] = [], pending = [source], seen = new Set<string>();
      while (pending.length) {
        const dependency = pending.pop()!; if (seen.has(dependency)) continue; seen.add(dependency);
        for (const row of this.db.prepare('SELECT kind,id FROM dependencies WHERE source=?').all(dependency)) {
          const id = String(row.id), kind = String(row.kind) as RecordKind;
          this.remove(kind,id); removed.push(`${kind}:${id}`); pending.push(`${kind}:${id}`);
        }
      }
      return removed;
    });
  }
  load<T>(id: string): T | undefined { return this.get('checkpoint',id)?.value as T | undefined; }
  save<T>(id: string, value: T) { this.put({ kind:'checkpoint',id,revision:(this.get('checkpoint',id)?.revision ?? -1)+1,at:this.now(),value,dependencies:[] }); }
  removeCheckpoint(id: string) { this.remove('checkpoint', id); }
  backup(target: string) {
    if (this.depth) throw Error('Cannot back up an active transaction');
    if (fs.existsSync(target)) throw Error('Backup already exists; preserved');
    this.db.prepare('VACUUM INTO ?').run(target);
    const copy = new DatabaseSync(target, { readOnly:true });
    try { if (copy.prepare('PRAGMA integrity_check').get()!.integrity_check !== 'ok') throw Error('Backup integrity failed'); } finally { copy.close(); }
  }
  close() { if (!this.closed) { this.db.close(); this.closed = true; } }
}
