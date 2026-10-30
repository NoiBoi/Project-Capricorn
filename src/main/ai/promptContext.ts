import type { ChatMessage, MemoryItem } from '../../shared/ipc';
import { identityMemories } from '../../shared/userIdentity';
import { localRelevance } from '../../shared/recall';
const tokens = (text: string) => new Set(text.toLowerCase().match(/[a-z]{3,}/g) ?? []);
/** Filter legacy off-the-record pairs as well as newly flagged private messages, without rewriting history. */
export function publicHistory(history: ChatMessage[]) {
  let privateTurn = false;
  return history.filter(m => {
    if (m.role === 'user') privateTurn = !!m.meta?.private || /\b(off the record|don['’]?t (?:save|remember) (?:this|anything)|do not (?:save|remember) (?:this|anything))\b/i.test(m.content);
    return !privateTurn && !m.meta?.private && !m.meta?.contextSources?.length;
  });
}
const RELATED = [
  ['exam', 'exams', 'test', 'tests', 'midterm', 'finals', 'studying', 'study'],
  ['job', 'jobs', 'intern', 'internship', 'internships', 'application', 'applications', 'resume', 'interview'],
  ['project', 'projects', 'building', 'build', 'working'],
  ['music', 'song', 'songs', 'track', 'tracks', 'playlist'],
  ['pat', 'pats', 'pet', 'petting', 'headpat', 'headpats', 'affection'],
];
const relatedTokens = (text: string) => {
  const set = tokens(text);
  for (const group of RELATED) if (group.some(w => set.has(w))) for (const w of group) set.add(w);
  return set;
};
/** Storage stays complete. Select a bounded working set; broad recall explicitly loads the full profile. */
export function selectMemories(memories: MemoryItem[], query?: string) {
  const approved = memories.filter(m => m.status === 'approved' && !m.archived);
  if (!query || /\b(?:who am i|what (?:do you )?(?:know|remember) about me|my (?:profile|memories)|everything.*(?:remember|know))\b/i.test(query)) return approved;
  const q = relatedTokens(query);
  const ranked = approved.map((m, i) => {
    const overlap = [...tokens(m.text)].filter(t => q.has(t) && !STOP.has(t)).length;
    const identity = /\b(name|called|student|university|purdue)\b/i.test(m.text) ? 2 : 0;
    const preference = m.context?.kind === 'preference' || /\b(prefers?|dislikes?|likes?)\b/i.test(m.text) ? 1 : 0;
    return { m, i, score: overlap * 4 + identity + preference };
  }).sort((a, b) => b.score - a.score || b.i - a.i);
  const selected: MemoryItem[] = identityMemories(approved).filter(m => m.text.length <= 700).slice(0, 3);
  let chars = selected.reduce((n, m) => n + m.text.length, 0);
  for (const item of ranked) {
    if (selected.includes(item.m)) continue;
    if (selected.length >= 12) break;
    if (chars + item.m.text.length > 4200) continue;
    if (item.score <= 0 && selected.length >= 3) break;
    selected.push(item.m); chars += item.m.text.length;
  }
  return selected.sort((a, b) => approved.indexOf(a) - approved.indexOf(b));
}
/** Drop complete oldest turns, never silently truncate the newest request or saved memories. */
export function recentContext<T extends { role: string; content: string }>(messages: T[], budget = 12000) {
  let selected = [...messages], chars = selected.reduce((n, m) => n + m.content.length, 0);
  while (chars > budget && selected.length > 2) {
    chars -= selected.shift()!.content.length;
    while (selected.length && selected[0].role !== 'user') chars -= selected.shift()!.content.length;
  }
  return selected;
}

const STOP = new Set('the and for are was has had can our its not but about after again also been before could did does doing from have just know like more remember said some that them then there these they thing this those told want were what when where which with would your you capri really think hello thanks thank please should okay one now'.split(' '));
const recallWords = (text: string) => [...tokens(text)].filter(w => !STOP.has(w));
/** Search saved exchanges locally. Exact quotations keep recalled claims attributable and dated. */
export function recalledExchanges(history: ChatMessage[], query: string, recentIds: Set<string>, budget = 3000) {
  history = publicHistory(history);
  const words = recallWords(query), broad = /\b(?:what (?:did|were) we|where (?:did|were) we|last (?:conversation|time)|talk(?:ed|ing) about|left off)\b/i.test(query);
  const ownWords = /\b(?:you|your|capri)\b/i.test(query);
  const frequency = new Map<string, number>();
  for (const m of history) {
    const present = tokens(m.content);
    for (const w of words) if (present.has(w)) frequency.set(w, (frequency.get(w) ?? 0) + 1);
  }
  const pairs: { user: ChatMessage; reply?: ChatMessage; score: number }[] = [];
  for (let i = 0; i < history.length; i++) {
    const user = history[i];
    if (user.role !== 'user' || !Number.isFinite(user.ts) || Math.abs(user.ts) > 8640000000000000 || user.meta?.error || user.meta?.interrupted || recentIds.has(user.id)) continue;
    const next = history[i + 1], reply = next?.role === 'assistant' && !next.meta?.error && !next.meta?.interrupted ? next : undefined;
    if (reply && recentIds.has(reply.id)) continue;
    const userWords = new Set(recallWords(user.content)), replyWords = new Set(recallWords(reply?.content ?? ''));
    const matches = words.filter(w => userWords.has(w) || replyWords.has(w));
    const lexical = words.reduce((sum, w) => sum + (userWords.has(w) ? 3 : replyWords.has(w) ? 1 : 0), 0);
    const hybrid = words.length >= 2 && matches.length === 0 ? localRelevance(query, user.content.slice(0,900) + ' ' + (reply?.content.slice(0,600) ?? '')) : { concept: 0 };
    const score = lexical + hybrid.concept;
    const distinctive = matches.length === 1 && matches[0].length >= 5 && (frequency.get(matches[0]) ?? 0) <= 4 && (userWords.has(matches[0]) || ownWords && replyWords.has(matches[0]));
    if ((matches.length >= 2 && score >= (ownWords ? 2 : 4)) || distinctive || broad || words.length >= 2 && hybrid.concept > 0 && matches.length === 0) pairs.push({ user, reply, score });
  }
  const ranked = pairs.sort((a, b) => b.score - a.score || b.user.ts - a.user.ts);
  const selected: { at: string; user: string; capri?: string }[] = []; let chars = 0;
  for (const pair of ranked) {
    if (selected.length >= 3) break;
    const user = pair.user.content.slice(0, 900), capri = pair.reply?.content.slice(0, 600);
    if (chars + user.length + (capri?.length ?? 0) > budget) continue;
    selected.push({ at: new Date(pair.user.ts).toISOString(), user, ...(capri ? { capri } : {}) }); chars += user.length + (capri?.length ?? 0);
  }
  return selected.sort((a, b) => a.at.localeCompare(b.at));
}

export function memoryQuery(current: string, recent: { role: string; content: string }[]) {
  // Short follow-ups inherit their topic; explicit broad profile recall still loads the full profile.
  if (/\b(?:who am i|what (?:do you )?(?:know|remember) about me|my (?:profile|memories)|everything.*(?:remember|know))\b/i.test(current)) return current;
  if (recallWords(current).length >= 2) return current;
  return [current, ...recent.filter(x => x.role === 'user').slice(-2).map(x => x.content.slice(0, 350))].join('\n');
}

/** On a real re-entry, offer the last substantive shared thread as dated evidence.
 * This does not manufacture an unresolved task or imply offline thought/activity. */
export function continuityThread(history: ChatMessage[], current: string, recentIds: Set<string>, now = Date.now()) {
  if (!/^\s*(?:(?:hi|hey|hello|yo)(?: capri)?[!. ,]*|(?:i'?m |im )?back[!. ]*|what(?:'s| is) up\??)\s*$/i.test(current)) return [];
  const prior = history.filter(m => !recentIds.has(m.id) && !m.meta?.error && !m.meta?.interrupted && m.ts <= now && now - m.ts >= 4 * 3600000 && now - m.ts <= 90 * 86400000);
  for (let i = prior.length - 1; i >= 0; i--) {
    const m = prior[i];
    if (m.role !== 'user' || m.content.length < 35 || recallWords(m.content).length < 5 || /\b(off the record|don't (?:save|remember)|do not (?:save|remember))\b/i.test(m.content)) continue;
    const next = prior[i + 1];
    return [{ at: new Date(m.ts).toISOString(), user: m.content.slice(0, 900), ...(next?.role === 'assistant' ? { capri: next.content.slice(0, 600) } : {}) }];
  }
  return [];
}
