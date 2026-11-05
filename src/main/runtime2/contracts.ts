import type { CapabilityCall, CapabilityReceipt } from '../../core/capabilities';

export interface EvidenceReference { id: string; uri?: string; observedAt: number }
export interface Observation {
  id: string;
  at: number;
  source: string;
  modality: 'window-metadata' | 'browser-page' | 'screenshot' | 'application-text' | 'accessibility';
  sourceIdentity?: string;
  related?: string[];
  disclosure?: { source: 'screen' | 'chrome'; url?: string; retain: boolean; expiresAt?: number; retainUntil?: number };
  original?: EvidenceReference;
  content: { handle: string | null; title: string; process: string; pid?: number; url?: string; text?: string; sections?: { kind: string; level: number; path: string; text: string }[]; evidenceId?: string; revision?: number; changedSections?: number[]; playback?: { state: 'playing' | 'paused' | 'ended'; duration: number | null } };
  provenance: { authority: 'host'; collector: string; metadata: Record<string, string> };
  loss: { truncated: boolean; missing: string[] };
}
export type ConversationItem = { id: string; at: number } & (
  | { kind: 'user' | 'assistant'; text: string }
  | { kind: 'observation'; observation: Observation }
  | { kind: 'tool-result'; requestId: string; receipt: CapabilityReceipt; result?: unknown }
);
/** Application-owned chronology, with no provider session identifiers. */
export interface LogicalConversation { id: string; items: ConversationItem[]; evictedItems: number }
export interface MemoryRecord {
  id: string; text: string; createdAt: number; revisedAt: number;
  provenance: 'user-statement' | 'model-interpretation';
  evidence: EvidenceReference[]; status: 'active' | 'retired';
}
export interface Intention {
  id: string; text: string; createdAt: number; dueAt: number; expiresAt: number;
  status: 'scheduled' | 'completed' | 'cancelled' | 'expired'; completedAt?: number;
  evidence: EvidenceReference[];
}
/** Host clamps requests to its own permissions and resource bounds; no scheduler yet. */
export interface AttentionRequest {
  id: string; requestedAt: number; nextReview: { at: number } | { afterMs: number };
  durationMs: number; expiresAt: number;
  observationIntervalMs?: number; inferenceIntervalMs?: number;
  wakeOn?: ('user' | 'observation' | 'tool-result' | 'intention-due')[];
}
export interface AttentionBounds { minObservationIntervalMs: number; minInferenceIntervalMs: number; maxDurationMs: number }
/** Reuses the native executor's identity, permission and replay contracts. */
export interface ToolRequest { call: CapabilityCall; arguments: unknown }
export interface ToolExecution { requestId: string; receipt: CapabilityReceipt; result?: unknown }
