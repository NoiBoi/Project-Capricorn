import { recallTerms } from './recall';

/** Evidence identities change on capture; the subject of a curiosity need not. */
export function sameInterestSubject(a: string, b: string) {
  const x = recallTerms(a), y = recallTerms(b);
  if (!x.size || !y.size) return false;
  const shared = [...x].filter(w => y.has(w)).length;
  return shared === x.size && shared === y.size || shared >= 2 && shared / Math.max(x.size, y.size) >= .67;
}

const CONTACT = new Set(['pat', 'poke', 'pickup']);
export function isContact(entry: { role: string; event?: string }) { return entry.role === 'user' && CONTACT.has(entry.event ?? ''); }

/** One retrieval topic, with the actual event first and old contact kept out of task recall. */
export function dialogueQuery(current: string, entries: { role: string; text: string; event?: string }[]) {
  const latest = entries.filter(e => e.role === 'user' && !isContact(e)).at(-1)?.text ?? '';
  // A meaningful new subject must not inherit an unrelated old one.
  return recallTerms(current).size >= 3 ? current.slice(0, 1000) : [current, latest.slice(0, 450)].filter(Boolean).join('\n');
}

/** Recognize a repeated declaration of unresolved curiosity, rather than new information. */
export function repeatedUnresolvedThought(line: string, previous: readonly string[]) {
  const unresolved = (s: string) => /\b(still|remain\w*|keep\w*|not (?:letting|giving)|won['’]?t (?:let|give)|can['’]?t (?:read|tell)|wonder\w*|curious|mystery|unresolved|want to (?:know|read|crack|figure))\b/i.test(s);
  if (!unresolved(line) || /\b(turns out|now I (?:see|know|can read)|I (?:figured|worked) (?:it|them) out|means? that|because|instead I|giving up|leave it|move on|their secrets)\b/i.test(line)) return false;
  const noise = recallTerms('still remain keep wondering curious mystery tiny little know want figure read tell say thing look');
  const terms = (s: string) => new Set([...recallTerms(s)].filter(w => !noise.has(w)));
  const a = terms(line);
  return previous.some(old => {
    if (!unresolved(old)) return false;
    const b = terms(old), shared = [...a].filter(w => b.has(w)).length;
    return shared >= 2 && shared / Math.min(a.size, b.size) >= .5;
  });
}
