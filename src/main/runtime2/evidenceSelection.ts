import type { Observation } from './contracts';
import type { ConversationRecord } from './cognitiveContracts';
import { excerptObservation, observedText } from './workingObservations';

export type EvidenceDecision = { id: string; representation: string; reason: string };
/** Selection only: originals stay in the archive; the cycle retains at most two IDs. */
export async function selectSemanticEvidence(options: {
  candidates: Observation[]; changed: Set<string>; relevant: Set<string>;
  current: (o: Observation) => boolean; permitted: (o: Observation) => boolean;
  resolve: (o: Observation) => Promise<Observation | undefined>;
}) {
  const { changed, relevant, current, permitted, resolve } = options;
  const decisions: EvidenceDecision[] = [];
  const candidates = [...new Map(options.candidates.map(o => [o.id, o])).values()]
    .filter(o => ['browser-page', 'application-text', 'accessibility'].includes(o.modality))
    .sort((a,b) => Number(relevant.has(b.id)) - Number(relevant.has(a.id)) ||
      Number(current(b)) - Number(current(a)) || Number(changed.has(b.id)) - Number(changed.has(a.id)) ||
      Number(!!b.related?.length) - Number(!!a.related?.length) || b.at - a.at);
  const selected: ConversationRecord[] = [], texts = new Set<string>();
  let reads = 0;
  for (const candidate of candidates) {
    if (!permitted(candidate)) { decisions.push({ id: candidate.id, representation: 'omitted', reason: (candidate.disclosure?.retainUntil ?? Infinity) <= Date.now() ? 'retention-expired' : 'permission' }); continue; }
    if (!current(candidate) && !changed.has(candidate.id) && !relevant.has(candidate.id)) {
      decisions.push({ id: candidate.id, representation: 'metadata', reason: 'not-current-unhandled-or-relevant' }); continue;
    }
    if (selected.length >= 2 || reads >= 4) { decisions.push({ id: candidate.id, representation: 'metadata', reason: 'selection-budget' }); continue; }
    reads++;
    const original = await resolve(candidate);
    if (!original || !permitted(original)) { decisions.push({ id: candidate.id, representation: 'omitted', reason: !original ? 'archive-unavailable' : (original.disclosure?.retainUntil ?? Infinity) <= Date.now() ? 'retention-expired' : 'permission' }); continue; }
    const text = observedText(original);
    if (!text.trim() || texts.has(text)) { decisions.push({ id: candidate.id, representation: 'metadata', reason: text.trim() ? 'duplicate-content' : 'no-semantic-content' }); continue; }
    const record = excerptObservation({ id: original.id, kind: 'observation', observationId: original.id, sequence: 0,
      at: original.at, observation: original, evidenceContext: current(original) ? 'current' : 'historical' });
    if (Buffer.byteLength(JSON.stringify(record)) > 8000) {
      decisions.push({id:original.id,representation:'metadata',reason:'excerpt-byte-budget'}); continue;
    }
    texts.add(text);
    selected.push(record);
    decisions.push({ id: original.id, representation: record.observation === original ? 'full' : 'excerpt', reason: relevant.has(original.id) ? 'relevant' : current(original) ? 'current' : 'unhandled-change' });
  }
  return { records: selected, decisions, archiveReads: reads };
}
