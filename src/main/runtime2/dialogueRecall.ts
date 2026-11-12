import type { ConversationRecord } from './cognitiveContracts';
import type { WindowFocusArchive } from './windowFocusArchive';

const STOP = new Set(['about', 'after', 'again', 'and', 'are', 'can', 'could', 'did', 'does', 'for', 'from', 'had', 'has', 'have', 'how', 'not', 'our', 'please', 'recall', 'remember', 'say', 'that', 'the', 'them', 'then', 'there', 'these', 'they', 'this', 'was', 'were', 'what', 'when', 'where', 'which', 'who', 'why', 'will', 'with', 'would', 'you', 'your']);
export function recallQuery(text: string) {
  return [...new Set((text.slice(0, 4000).match(/[\p{L}\p{N}_-]{3,}/gu) ?? [])
    .map(w => w.toLowerCase()).filter(w => !STOP.has(w)))].slice(0, 12).join(' ').slice(0, 256);
}

/** Read from the existing journal, with no model, embedding service or side store.
 * Whole exchanges retain attribution. Recent context is excluded, and a hard
 * byte budget bounds even very long originals. Re-run on each continuation so
 * a conversation revocation cannot leave an authorized cached payload behind.
 */
export async function recallDialogue(archive: WindowFocusArchive, recent: ConversationRecord[], signal: AbortSignal,
  allowed: () => boolean, boundary = 0) {
  try { return await readDialogue(archive, recent, signal, allowed, boundary); }
  catch { signal.throwIfAborted(); return []; } // Optional recall cannot take down the current conversation.
}

async function readDialogue(archive: WindowFocusArchive, recent: ConversationRecord[], signal: AbortSignal,
  allowed: () => boolean, boundary: number) {
  signal.throwIfAborted();
  const latest = recent.findLast(r => r.kind === 'user');
  const query = latest?.kind === 'user' ? recallQuery(latest.text) : '';
  if (!query || !allowed()) return [];
  const visible = new Set(recent.map(r => r.id));
  const result = await archive.discover({ modality: 'dialogue', search: query, limit: 6 });
  signal.throwIfAborted();
  const recalled = new Map<string, { id: string; kind: 'user' | 'assistant'; at: number; text: string }>();
  let bytes = 2, exchanges = 0;
  for (const hit of result.hits) {
    if (!('dialogue' in hit) || visible.has(hit.dialogue.id) || hit.dialogue.at <= boundary || hit.dialogue.at >= latest!.at) continue;
    const exchange = await archive.dialogueExchange(hit.dialogue.id);
    signal.throwIfAborted();
    if (!allowed()) return [];
    const records = exchange.flatMap(r => (r.kind === 'user' || r.kind === 'assistant') && r.at > boundary && r.at < latest!.at && !visible.has(r.id) && !recalled.has(r.id)
      ? [{ id: r.id, kind: r.kind, at: r.at, text: r.text }] : []);
    const size = Buffer.byteLength(JSON.stringify(records), 'utf8');
    if (!records.length || bytes + size > 3500) continue;
    records.forEach(r => recalled.set(r.id, r)); bytes += size;
    if (++exchanges === 3) break;
  }
  return allowed() ? [...recalled.values()].sort((a, b) => a.at - b.at) : [];
}
