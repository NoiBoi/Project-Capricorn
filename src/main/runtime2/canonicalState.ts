import { z } from 'zod';

const reference = z.string().min(1).max(256);
export const StateInput = z.object({
  id: reference,
  kind: z.enum(['semantic', 'episodic', 'user-fact', 'interest', 'investigation', 'intention', 'checkpoint']),
  text: z.string().min(1).max(4000),
  provenance: z.enum(['host-observation', 'user-statement', 'model-interpretation']),
  evidence: z.array(reference).max(16),
  status: z.enum(['active', 'retired', 'completed', 'abandoned']),
  dueAt: z.number().finite().nonnegative().nullable(),
  pinned: z.boolean().optional().describe('Keep a foundational active memory in rolling context. Maximum six pinned records.'),
  expectedRevision: z.number().int().nonnegative(),
}).strict().refine(value => value.kind !== 'checkpoint' ||
  (value.id === 'working-checkpoint' && value.text.length <= 1800 && value.provenance === 'model-interpretation'),
  'Use working-checkpoint, model-interpretation and at most 1800 characters for the short-term checkpoint.');
export type StateWrite = z.infer<typeof StateInput>;
export interface CanonicalState extends StateWrite { revision: number; createdAt: number; revisedAt: number; reviewedAt?: number; scheduledReviews?: number }
export const StateQuery = z.object({ offset: z.number().int().min(0).max(1000).default(0), search: z.string().max(256).optional(), kind: StateInput.shape.kind.optional(), status: StateInput.shape.status.optional(), limit: z.number().int().min(1).max(50).default(20) }).strict();
export type StateSearch = z.input<typeof StateQuery>;
export interface EvidenceBlob { id: string; mime: 'image/jpeg' | 'application/json'; bytes: number; sha256: string; createdAt: number }
export const EvidencePolicy = z.object({ maxBytes: z.number().int().min(1024).max(1024 * 1024 * 1024), maxAgeMs: z.number().int().min(0).max(365 * 86400000) }).strict();
export type EvidenceRetention = z.infer<typeof EvidencePolicy>;
export const DEFAULT_EVIDENCE_RETENTION: EvidenceRetention = { maxBytes: 128 * 1024 * 1024, maxAgeMs: 7 * 86400000 };
