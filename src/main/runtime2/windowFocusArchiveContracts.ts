import type { Observation } from './contracts';
export const DEFAULT_RETENTION = { maxAgeMs: 30 * 86400000, maxRecords: 50_000 };
export interface RetentionPolicy { maxAgeMs: number; maxRecords: number }
export interface ArchiveQuery { limit?: number; search?: string; from?: number; to?: number }
export interface ArchiveStats { count: number; oldest?: Observation; newest?: Observation }
export interface Operations {
  initialize: { input: { profile: string; retention: RetentionPolicy; now?: number }; output: { threadId: number } };
  write: { input: { observation: Observation; now?: number }; output: { inserted: boolean } };
  recent: { input: ArchiveQuery; output: Observation[] };
  restore: { input: Record<string, never>; output: Observation[] };
  get: { input: { id: string }; output: Observation | undefined };
  stats: { input: Record<string, never>; output: ArchiveStats };
  close: { input: Record<string, never>; output: null };
}
export type ArchiveRequest = { [K in keyof Operations]: { id: number; op: K; input: Operations[K]['input'] } }[keyof Operations];
export type ArchiveResponse = { id: number } & ({ ok: true; value: Operations[keyof Operations]['output'] } | { ok: false; error: string });
export function validateQuery(q: ArchiveQuery, max = 100) {
  if (!q || typeof q !== 'object' || Array.isArray(q) || Object.getPrototypeOf(q) !== Object.prototype || Object.keys(q).some(k => !['limit','search','from','to'].includes(k))) throw Error('Invalid archive query');
  const limit = q.limit === undefined ? max : q.limit;
  if (!Number.isInteger(limit) || limit < 1 || limit > max) throw Error(`Archive limit must be 1..${max}`);
  if (q.search !== undefined && (typeof q.search !== 'string' || q.search.length > 256)) throw Error('Invalid archive search (maximum 256 characters)');
  for (const at of [q.from,q.to]) if (at !== undefined && (typeof at !== 'number' || !Number.isFinite(at))) throw Error('Invalid archive timestamp');
  if (q.from !== undefined && q.to !== undefined && q.from > q.to) throw Error('Invalid archive timestamp range');
  return { ...q, limit };
}
export function validateId(id: string) { if (typeof id !== 'string' || !id.length || id.length > 256) throw Error('Invalid observation ID'); }
export function validateObservation(o: Observation) {
  validateId(o?.id);
  if (typeof o.at !== 'number' || !Number.isFinite(o.at) || typeof o.source !== 'string' || !o.source.length || o.source.length > 256 || o.modality !== 'window-metadata' ||
    !o.content || !(o.content.handle === null || typeof o.content.handle === 'string') || typeof o.content.title !== 'string' || typeof o.content.process !== 'string' ||
    (o.content.pid !== undefined && (!Number.isSafeInteger(o.content.pid) || o.content.pid < 0)) ||
    o.provenance?.authority !== 'host' || o.provenance.collector !== 'win32.foreground' || !o.provenance.metadata || typeof o.provenance.metadata !== 'object' || Array.isArray(o.provenance.metadata) || Object.values(o.provenance.metadata).some(v => typeof v !== 'string') ||
    typeof o.loss?.truncated !== 'boolean' || !Array.isArray(o.loss.missing) || o.loss.missing.some(v => typeof v !== 'string') ||
    (o.original !== undefined && (!o.original || typeof o.original.id !== 'string' || typeof o.original.observedAt !== 'number' || !Number.isFinite(o.original.observedAt) || (o.original.uri !== undefined && typeof o.original.uri !== 'string')))) throw Error('Invalid window-focus observation');
  const json = JSON.stringify(o, (_key, v) => {
    if (v === undefined || typeof v === 'function' || typeof v === 'symbol' || (typeof v === 'number' && !Number.isFinite(v))) throw Error('Observation must be lossless JSON');
    return v;
  });
  if (json.length > 128 * 1024) throw Error('Observation exceeds archive size limit');
  return json;
}
