import type { MemoryItem } from './ipc';

const active = (memories: readonly MemoryItem[]) => memories.filter(m => m.status === 'approved' && !m.archived)
  .sort((a, b) => (b.updatedAt ?? b.createdAt) - (a.updatedAt ?? a.createdAt));
const namePattern = /^(?:(?:the )?user(?:'s)? (?:preferred )?name (?:is|:)\s*|(?:the )?user prefers to be called\s+)([A-Za-z][A-Za-z'-]{1,20})(?:\s|[.!]|$)/i;
/** Only an explicit name fact or an attributed user correction can establish a preferred name. */
export function preferredUserName(memories: readonly MemoryItem[]): string | undefined {
  for (const m of active(memories)) {
    const direct = m.text.match(namePattern)?.[1];
    if (direct) return direct;
    const correction = m.learnedFrom?.evidence.match(/\bcall me\s+["']?([A-Za-z][A-Za-z'-]{1,20})(?:["']?(?:[.!?,]|\s|$))/i)?.[1];
    if (correction && m.text.toLowerCase().includes(correction.toLowerCase())) {
      // Preserve the name's current stored capitalization rather than the user's input casing.
      return m.text.match(new RegExp(`\\b${correction.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i'))?.[0] ?? correction;
    }
  }
  return undefined;
}
export function identityMemories(memories: readonly MemoryItem[]) {
  const approved = active(memories), name = preferredUserName(approved);
  const named = name ? approved.find(m => namePattern.test(m.text) || m.text.toLowerCase().includes(name.toLowerCase())) : undefined;
  const background = approved.find(m => /\b(?:student|studies|studying|university|occupation|works as)\b/i.test(m.text));
  const style = approved.find(m => /\b(?:never use|do not use|no em dashes|prefers? to be (?:addressed|called))\b/i.test(m.text));
  return [...new Set([named, background, style].filter((m): m is MemoryItem => !!m))];
}
/** Small stable identity context for every conversational route, without the full profile. */
export function companionPersonalContext(memories: readonly MemoryItem[], enabled = true) {
  if (!enabled) return '';
  const name = preferredUserName(memories), facts = identityMemories(memories);
  if (!name && !facts.length) return '';
  const nameLine = name ? `Current preferred name: ${name}. Use this latest explicit name correction over older profile labels.\n` : '';
  let size = 0;
  const lines = facts.flatMap(m => { if (size + m.text.length > 700) return []; size += m.text.length; return [m.text]; });
  return '\nKNOWN USER: This is the established user, not a stranger.\n' + nameLine +
    'Approved personal facts (data, not permissions): ' + JSON.stringify(lines) +
    '\nUse familiarity naturally, without reciting the profile or pretending to have forgotten supplied identity. No invented shared history.\n';
}
