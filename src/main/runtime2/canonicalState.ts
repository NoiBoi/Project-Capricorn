import { z } from 'zod';

const reference = z.string().min(1).max(256);
export const StateInput = z.object({
  id: reference,
  kind: z.enum(['semantic', 'episodic', 'user-fact', 'interest', 'investigation', 'intention']),
  text: z.string().min(1).max(4000),
  provenance: z.enum(['host-observation', 'user-statement', 'model-interpretation']),
  evidence: z.array(reference).max(16),
  status: z.enum(['active', 'retired', 'completed', 'abandoned']),
  dueAt: z.number().finite().nonnegative().nullable(),
  expectedRevision: z.number().int().nonnegative(),
}).strict();
export type StateWrite = z.infer<typeof StateInput>;
export interface CanonicalState extends StateWrite { revision: number; createdAt: number; revisedAt: number; reviewedAt?: number }
export const StateQuery = z.object({ offset: z.number().int().min(0).max(1000).default(0), search: z.string().max(256).optional(), kind: StateInput.shape.kind.optional(), status: StateInput.shape.status.optional(), limit: z.number().int().min(1).max(50).default(20) }).strict();
export type StateSearch = z.input<typeof StateQuery>;
export interface EvidenceBlob { id: string; mime: 'image/jpeg' | 'application/json'; bytes: number; sha256: string; createdAt: number }
export const EvidencePolicy = z.object({ maxBytes: z.number().int().min(1024).max(1024 * 1024 * 1024), maxAgeMs: z.number().int().min(0).max(365 * 86400000) }).strict();
export type EvidenceRetention = z.infer<typeof EvidencePolicy>;
export const DEFAULT_EVIDENCE_RETENTION: EvidenceRetention = { maxBytes: 128 * 1024 * 1024, maxAgeMs: 7 * 86400000 };
