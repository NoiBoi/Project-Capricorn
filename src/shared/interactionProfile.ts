export const PROFILE_CATEGORIES = ['notes', 'code', 'music', 'art', 'video', 'browser', 'other'] as const;
export type ProfileCategory = typeof PROFILE_CATEGORIES[number];
export type ProfileTouch = 'pat' | 'poke' | 'chat';
export interface ProfileDay {
  day: string;
  seconds: Partial<Record<ProfileCategory, number>>;
  interactions: Partial<Record<ProfileTouch, number>>;
}
export interface InteractionProfileSummary {
  daysObserved: number;
  since?: string;
  recentDays: number;
  activity: { category: ProfileCategory; minutes: number; recentMinutes: number }[];
  interactions: Record<ProfileTouch, number>;
  recentInteractions: Record<ProfileTouch, number>;
}
