export interface RelationshipSource { messageId: string; evidence: string; role: 'user' | 'assistant'; at: number; preferenceQuestion?: string }
export interface CapriTaste { id: string; topic: string; text: string; updatedAt: number; source: RelationshipSource; support?: RelationshipSource[]; changes?: { text: string; source: RelationshipSource }[] }
export type ThreadStatus = 'active' | 'paused' | 'done' | 'dismissed';
export interface ProjectThread {
  id: string; title: string; summary: string; status: ThreadStatus; updatedAt: number;
  nextAskAt: number; lastAskedAt?: number; asksSinceUpdate: number; source: RelationshipSource;
  aliases?: string[];
  developments?: { summary: string; status: ThreadStatus; source: RelationshipSource }[];
}
export interface RelationshipState { version: 1; tastes: CapriTaste[]; threads: ProjectThread[]; lastFollowUpAt?: number }
export interface RetiredLine { lineId?: string; id: string; text: string; at: number }
export const normalizedLine = (text: string) => text.normalize('NFKC').toLowerCase().replace(/['’]/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
export function lineRetirementRequest(text: string): { latest: boolean; line?: string } | null {
  const t = text.trim().replace(/[.!]+$/, '');
  if (/^(?:please[, ]+)?(?:don['’]?t|do not|never) (?:say|use|repeat) (?:that|this|it|that line|this line)(?: (?:line|phrase))? again(?: please)?$/i.test(t)
    || /^(?:please[, ]+)?stop saying (?:that|this|that line|this line)(?: please)?$/i.test(t)) return { latest: true };
  const quote = /^(?:please[, ]+)?(?:(?:don['’]?t|do not|never) (?:say|use|repeat)\s+["“']([\s\S]{1,1000})["”'](?: again)?|stop saying\s+["“']([\s\S]{1,1000})["”'])(?: please)?$/i.exec(t);
  return quote ? { latest: false, line: quote[1] ?? quote[2] } : null;
}
