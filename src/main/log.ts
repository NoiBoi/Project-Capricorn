import fs from 'node:fs';
import path from 'node:path';

export type Level = 'debug' | 'info' | 'warn' | 'error';
const ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const SENSITIVE_KEY = /(api[-_]?key|authorization|token|password|secret|cookie|x-api-key|x-goog-api-key)/i;
const SECRET_PATTERNS: [RegExp, string][] = [
  [/\bsk-[A-Za-z0-9_\-]{8,}/g, 'sk-[REDACTED]'],
  [/\bAIza[0-9A-Za-z_\-]{20,}/g, '[REDACTED-GOOGLE-KEY]'],
  [/\bAQ\.[0-9A-Za-z_\-]{20,}/g, '[REDACTED-GOOGLE-KEY]'],
  [/\bBearer\s+[A-Za-z0-9._\-]{8,}/gi, 'Bearer [REDACTED]'],
  [/\b(x-api-key|api[_-]?key)=([^&\s]+)/gi, '$1=[REDACTED]'],
];
const CONTENT_KEYS = /^(content|text|prompt|transcript|body|delta)$/i;

/** Redact secrets everywhere and user content (chat text, transcripts) unless debug-level content logging. */
export function redact(value: unknown, depth = 0): unknown {
  if (depth > 6) return '[depth]';
  if (typeof value === 'string') {
    let s = value;
    for (const [re, rep] of SECRET_PATTERNS) s = s.replace(re, rep);
    return s.length > 2000 ? s.slice(0, 2000) + '…' : s;
  }
  if (Array.isArray(value)) return value.slice(0, 50).map((v) => redact(v, depth + 1));
  if (value instanceof Error) return { name: value.name, message: redact(value.message), stack: value.stack?.split('\n').slice(0, 6).join('\n') };
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      if (SENSITIVE_KEY.test(k)) out[k] = '[REDACTED]';
      else if (CONTENT_KEYS.test(k) && typeof v === 'string') out[k] = `[${v.length} chars]`;
      else out[k] = redact(v, depth + 1);
    }
    return out;
  }
  return value;
}

export class Logger {
  private file: string;
  private level: Level;
  private written = 0;
  constructor(
    dir: string,
    level: Level = 'info',
    private maxBytes = 2 * 1024 * 1024,
    private keep = 3,
    private echo = false,
  ) {
    fs.mkdirSync(dir, { recursive: true });
    this.file = path.join(dir, 'capri.log');
    this.level = level;
    try { this.written = fs.statSync(this.file).size; } catch { this.written = 0; }
  }
  setLevel(l: Level) { this.level = l; }
  get path() { return this.file; }

  log(level: Level, msg: string, data?: Record<string, unknown>) {
    if (ORDER[level] < ORDER[this.level]) return;
    const line = JSON.stringify({ t: new Date().toISOString(), level, msg: redact(msg), ...(data ? { data: redact(data) } : {}) }) + '\n';
    if (this.echo) process.stdout.write(line);
    try {
      if (this.written + line.length > this.maxBytes) this.rotate();
      fs.appendFileSync(this.file, line);
      this.written += Buffer.byteLength(line);
    } catch { /* logging must never crash the app */ }
  }
  debug(m: string, d?: Record<string, unknown>) { this.log('debug', m, d); }
  info(m: string, d?: Record<string, unknown>) { this.log('info', m, d); }
  warn(m: string, d?: Record<string, unknown>) { this.log('warn', m, d); }
  error(m: string, d?: Record<string, unknown>) { this.log('error', m, d); }

  private rotate() {
    for (let i = this.keep - 1; i >= 1; i--) {
      const src = `${this.file}.${i}`;
      if (fs.existsSync(src)) fs.renameSync(src, `${this.file}.${i + 1}`);
    }
    if (fs.existsSync(`${this.file}.${this.keep}`)) fs.rmSync(`${this.file}.${this.keep}`);
    if (fs.existsSync(this.file)) fs.renameSync(this.file, `${this.file}.1`);
    this.written = 0;
  }

  /** Last n lines, reaching into rotated files when the current one is short. */
  tail(n: number): string[] {
    const want = Math.max(1, Math.min(n, 2000));
    let out: string[] = [];
    for (const f of [this.file, `${this.file}.1`]) {
      try {
        const lines = fs.readFileSync(f, 'utf8').trimEnd().split('\n').filter(Boolean);
        out = [...lines, ...out];
      } catch { /* missing */ }
      if (out.length >= want) break;
    }
    return out.slice(-want);
  }
}

/** A no-op-ish logger usable before the app paths exist and in tests. */
export const nullLogger = { debug() {}, info() {}, warn() {}, error() {} } as unknown as Logger;
