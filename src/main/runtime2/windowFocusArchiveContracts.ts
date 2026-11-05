import type { CanonicalState, StateWrite, StateSearch, EvidenceBlob, EvidenceRetention } from './canonicalState';
import type { ConversationPage, RecordInput } from './cognitiveContracts';
import type { Observation } from './contracts';
import type { AttentionState } from './attention';
export const DEFAULT_RETENTION = { maxAgeMs: 30 * 86400000, maxRecords: 50_000 };
export interface RetentionPolicy { maxAgeMs: number; maxRecords: number }
export interface ArchiveQuery { limit?: number; search?: string; from?: number; to?: number }
export interface DialogueEvidence { id: string; at: number; kind: 'user' | 'assistant'; text: string }
export interface DiscoveryQuery extends ArchiveQuery {
  offset?: number; source?: string; modality?: Observation['modality'] | 'dialogue'; relatedId?: string;
}
export interface ArchiveStats { count: number; oldest?: Observation; newest?: Observation }
export interface Operations {
  discover: { input: DiscoveryQuery; output: { hits: ({ observation: Observation; score: number | null; contentHash: string } | { dialogue: DialogueEvidence; score: number | null })[]; nextOffset: number | null; ranking: string } };
  latestSource: { input: { slot: string }; output: Observation | undefined };
  readScene: { input: Record<string, never>; output: { cursor: number; version: number; latest: Observation[]; changes: Observation[]; recent: Observation[] } };
  acknowledgeScene: { input: { version: number }; output: null };
  getDialogue: { input: { id: string }; output: DialogueEvidence | null };
  hasDialogue: { input: { id: string }; output: boolean };
  readAttention: { input: Record<string, never>; output: AttentionState | null };
  writeAttention: { input: AttentionState; output: null };
  scheduledState: { input: Record<string, never>; output: CanonicalState[] };
  maintain: { input: Record<string, never>; output: null };
  putState: { input: StateWrite; output: CanonicalState };
  findState: { input: StateSearch; output: CanonicalState[] };
  reviewState: { input: { ids: string[]; at: number }; output: null };
  putEvidence: { input: { data: Uint8Array; mime: EvidenceBlob['mime']; expiresAt?: number }; output: EvidenceBlob };
  getEvidence: { input: { id: string }; output: { metadata: EvidenceBlob; data: Uint8Array } | null };
  forgetSource: { input: { source: 'chrome' | 'screen' }; output: null };
  conversation: { input: { limit: number; dialogueOnly?: boolean; observations?: "only" | "exclude" }; output: ConversationPage };
  appendConversation: { input: RecordInput; output: { sequence: number } };
  clearConversation: { input: Record<string, never>; output: null };
  initialize: { input: { profile: string; retention: RetentionPolicy; evidenceRetention?: EvidenceRetention; now?: number }; output: { threadId: number } };
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
export function validateDiscovery(input: DiscoveryQuery) {
  const { offset = 0, source, modality, relatedId, ...query } = input;
  if (!Number.isInteger(offset) || offset < 0 || offset > 10000) throw Error('Invalid search offset');
  for (const filter of [source, modality, relatedId]) if (filter !== undefined) validateId(filter);
  return { ...validateQuery(query, 50), offset, source, modality, relatedId };
}
export function validateId(id: string) { if (typeof id !== 'string' || !id.length || id.length > 256) throw Error('Invalid observation ID'); }
export function validateObservation(o: Observation) {
  validateId(o?.id);
  if (typeof o.at !== 'number' || !Number.isFinite(o.at) || typeof o.source !== 'string' || !o.source.length || o.source.length > 256 || !['window-metadata','browser-page','screenshot','application-text','accessibility'].includes(o.modality) ||
    !o.content || !(o.content.handle === null || typeof o.content.handle === 'string') || typeof o.content.title !== 'string' || typeof o.content.process !== 'string' ||
    (o.content.pid !== undefined && (!Number.isSafeInteger(o.content.pid) || o.content.pid < 0)) ||
    o.provenance?.authority !== 'host' || typeof o.provenance.collector !== 'string' || !o.provenance.collector || !o.provenance.metadata || typeof o.provenance.metadata !== 'object' || Array.isArray(o.provenance.metadata) || Object.values(o.provenance.metadata).some(v => typeof v !== 'string') ||
    typeof o.loss?.truncated !== 'boolean' || !Array.isArray(o.loss.missing) || o.loss.missing.some(v => typeof v !== 'string') ||
    (o.original !== undefined && (!o.original || typeof o.original.id !== 'string' || typeof o.original.observedAt !== 'number' || !Number.isFinite(o.original.observedAt) || (o.original.uri !== undefined && typeof o.original.uri !== 'string')))) throw Error('Invalid window-focus observation');
  const json = JSON.stringify(o, (_key, v) => {
    if (v === undefined || typeof v === 'function' || typeof v === 'symbol' || (typeof v === 'number' && !Number.isFinite(v))) throw Error('Observation must be lossless JSON');
    return v;
  });
  if (json.length > 512 * 1024) throw Error('Observation exceeds archive size limit');
  return json;
}
