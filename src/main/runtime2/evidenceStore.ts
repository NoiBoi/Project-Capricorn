import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { assertSyntheticProfile } from './selection';
import { EvidencePolicy, type EvidenceBlob, type EvidenceRetention } from './canonicalState';

/** Used exclusively by the archive worker. Files are content addressed, never model supplied paths. */
export class EvidenceStore {
  private dir: string;
  private policy: EvidenceRetention;
  constructor(private db: DatabaseSync, dir: string, policy: EvidenceRetention) {
    this.policy = EvidencePolicy.parse(policy); this.dir = path.join(dir, 'evidence');
    assertSyntheticProfile(this.dir); fs.mkdirSync(this.dir, { recursive: true });
  }
  private file(id: string) {
    if (!/^[a-f0-9]{64}$/.test(id)) throw Error('Invalid evidence ID');
    const file = path.join(this.dir, id); assertSyntheticProfile(file);
    try { if (!fs.lstatSync(file).isFile()) throw Error('Evidence must be a regular file'); }
    catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }
    return file;
  }
  prune(now = Date.now()) {
    const rows = this.db.prepare('SELECT id, bytes, created_at, expires_at FROM evidence ORDER BY created_at DESC, id DESC').all();
    let used = 0;
    for (const row of rows) {
      if (Number(row.expires_at) > now && Number(row.created_at) >= now - this.policy.maxAgeMs && used + Number(row.bytes) <= this.policy.maxBytes) { used += Number(row.bytes); continue; }
      this.db.prepare('DELETE FROM evidence WHERE id=?').run(row.id);
      fs.rmSync(this.file(String(row.id)), { force: true });
    }
    const known = new Set(this.db.prepare('SELECT id FROM evidence').all().map(r => String(r.id)));
    for (const name of fs.readdirSync(this.dir)) if (/^[a-f0-9]{64}(?:\.tmp)?$/.test(name) && !known.has(name)) {
      const file = path.join(this.dir, name); assertSyntheticProfile(file); fs.rmSync(file, { force: true });
    }
  }
  put(data: Uint8Array, mime: EvidenceBlob['mime'], expiresAt?: number): EvidenceBlob {
    if (!(data instanceof Uint8Array) || !data.length || data.length > Math.min(this.policy.maxBytes, 2 * 1024 * 1024) || !['image/jpeg','application/json'].includes(mime)) throw Error('Invalid or oversized evidence');
    if (expiresAt !== undefined && (!Number.isFinite(expiresAt) || expiresAt <= Date.now())) throw Error('Evidence expiry has elapsed');
    this.prune();
    const id = createHash('sha256').update(data).digest('hex'), file = this.file(id), now = Date.now();
    if (!fs.existsSync(file)) {
      const temp = file + '.tmp'; assertSyntheticProfile(temp);
      const fd = fs.openSync(temp, 'wx'); try { fs.writeFileSync(fd, data); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
      fs.renameSync(temp, file);
    }
    this.db.prepare('INSERT INTO evidence VALUES (?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET expires_at=min(expires_at,excluded.expires_at)').run(id, mime, data.length, now, Math.min(now + this.policy.maxAgeMs, expiresAt ?? Infinity));
    this.prune(now);
    const row = this.db.prepare('SELECT created_at FROM evidence WHERE id=?').get(id);
    if (!row) throw Error('Evidence exceeded retention limits');
    return { id, mime, bytes: data.length, sha256: id, createdAt: Number(row.created_at) };
  }
  get(id: string) {
    this.prune(); const file = this.file(id);
    const row = this.db.prepare('SELECT * FROM evidence WHERE id=?').get(id); if (!row) return null;
    let data: Buffer; try { data = fs.readFileSync(file); }
    catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null; throw e; }
    if (data.length !== row.bytes || createHash('sha256').update(data).digest('hex') !== id) throw Error('Evidence integrity mismatch');
    const metadata: EvidenceBlob = { id, mime: row.mime as EvidenceBlob['mime'], bytes: data.length, sha256: id, createdAt: Number(row.created_at) };
    return { metadata, data };
  }
}
