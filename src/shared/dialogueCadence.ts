export const DIALOGUE_ACTIVITY_LEVELS = ['relaxed', 'balanced', 'lively', 'very_lively'] as const;
export type DialogueActivityLevel = typeof DIALOGUE_ACTIVITY_LEVELS[number];
export const DIALOGUE_ACTIVITY: Record<DialogueActivityLevel, { multiplier: number; gapMs: number; maxPerFiveMinutes: number }> = {
  relaxed: { multiplier: 1, gapMs: 45000, maxPerFiveMinutes: 3 },
  balanced: { multiplier: 2, gapMs: 25000, maxPerFiveMinutes: 6 },
  lively: { multiplier: 4, gapMs: 15000, maxPerFiveMinutes: 10 },
  very_lively: { multiplier: 8, gapMs: 8000, maxPerFiveMinutes: 16 },
};
