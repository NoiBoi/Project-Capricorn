/** Episodic provenance, not a second user profile. No window handles or images are retained. */
export interface ExperienceSource {
  id: string; at: number; role: 'observation' | 'user' | 'assistant'; text: string;
  reliability: 'metadata' | 'visual-interpretation' | 'statement' | 'delivered';
  process?: string; title?: string;
}
export interface SharedExperience {
  id: string; topic: string; sources: ExperienceSource[]; tags: string[];
  readings: { text: string; sourceId: string; at: number }[];
  response?: ExperienceSource; question: string; updatedAt: number;
  status: 'current' | 'corrected' | 'superseded';
  want?: { text: string; sourceId: string; expiresAt: number; status: 'open' | 'resolved' | 'dismissed' | 'expired'; askedAt?: number };
}
export interface ExperienceChange {
  id?: string; topic: string; sourceId: string; evidence: string;
  interpretation: string; question?: string; tags?: string[];
  status?: 'current' | 'resolved';
}
