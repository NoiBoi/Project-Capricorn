import fs from 'node:fs';
import path from 'node:path';
import { SECRET_KEYS, type SecretKey } from '../../shared/ipc';

/** Adapter over Electron safeStorage (DPAPI on Windows) so the store is testable. */
export interface Cipher {
  available(): boolean;
  encrypt(plain: string): Buffer;
  decrypt(data: Buffer): string;
}

/**
 * Credentials live only in an OS-encrypted blob. If OS encryption is unavailable the
 * secrets are kept in memory for this session only — never written in plaintext.
 */
export class SecretStore {
  private cache = new Map<SecretKey, string>();
  private file: string;
  constructor(dir: string, private cipher: Cipher) {
    this.file = path.join(dir, 'secrets.bin');
    this.load();
  }
  get persistent() { return this.cipher.available(); }

  private load() {
    if (!this.cipher.available() || !fs.existsSync(this.file)) return;
    try {
      const obj = JSON.parse(this.cipher.decrypt(fs.readFileSync(this.file))) as Record<string, string>;
      for (const k of SECRET_KEYS) if (typeof obj[k] === 'string') this.cache.set(k, obj[k]);
    } catch {
      // unreadable (e.g. copied from another Windows account) — set aside, user re-enters keys
      try { fs.renameSync(this.file, `${this.file}.unreadable-${Date.now()}`); } catch { /* ignore */ }
    }
  }
  private save() {
    if (!this.cipher.available()) return;
    const obj = Object.fromEntries(this.cache);
    const tmp = this.file + '.tmp';
    fs.writeFileSync(tmp, this.cipher.encrypt(JSON.stringify(obj)));
    fs.renameSync(tmp, this.file);
  }
  static isKey(k: unknown): k is SecretKey {
    return typeof k === 'string' && (SECRET_KEYS as readonly string[]).includes(k);
  }
  get(k: SecretKey) { return this.cache.get(k); }
  has(k: SecretKey) { return !!this.cache.get(k); }
  set(k: SecretKey, v: string) {
    const value = v.trim();
    if (!value || value.length > (k.startsWith('lifeOAuth')?32768:['googleRefresh','googleClientSecret'].includes(k)?8192:500) || /[\r\n]/.test(value)) throw new Error('Invalid credential format');
    this.cache.set(k, value);
    this.save();
  }
  delete(k: SecretKey) { this.cache.delete(k); this.save(); }
  clear() {
    this.cache.clear();
    try { fs.rmSync(this.file, { force: true }); } catch { /* ignore */ }
  }
  status(): Record<string, boolean> {
    return Object.fromEntries(SECRET_KEYS.map((k) => [k, this.has(k)]));
  }
}
