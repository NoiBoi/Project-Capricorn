/** Attributed working context. Durable profile facts and Capri's tastes keep their existing stores. */
export interface PersonalSource { messageId: string; text: string; at: number }
export type SituationKey = 'whereabouts' | 'current_work';
export interface Situation {
  id: string; key: SituationKey; value: string; source: PersonalSource;
  validFrom: number; validTo?: number; expiresAt: number;
}
export type CommitmentStatus = 'waiting' | 'eligible' | 'mentioned' | 'completed' | 'cancelled' | 'expired';
export interface CommitmentCondition { kind: 'reply' | 'topic' | 'time'; topic?: string; at?: number }
export interface Commitment {
  id: string; intention: string; condition: CommitmentCondition; source: PersonalSource;
  status: CommitmentStatus; expiresAt: number; eligibleAt?: number;
  consideredAt?: number; attempts: number; mentionedAt?: number;
  transitions: { status: CommitmentStatus; at: number; reason: string; sourceId?: string }[];
}
export interface PersonalContextState { version: 1; revision: number; situations: Situation[]; commitments: Commitment[] }
export interface PersonalContextView extends PersonalContextState {
  returned?: { at: number; awaySeconds: number; evidence: 'input-idle' };
}
