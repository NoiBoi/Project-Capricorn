import { createHash } from 'node:crypto';
import type { ConversationRecord } from './cognitiveContracts';
import type { Observation } from './contracts';

type ObservationRecord = Extract<ConversationRecord, { kind: 'observation' }>;

export function observationSlot(o: Observation) {
  // Foreground focus is one changing stream. Other streams retain their own identity.
  return o.source === 'desktop:foreground' ? o.source : o.modality + ':' + (o.sourceIdentity ?? o.source);
}

export function structuralChange(previous: Observation | undefined, observation: Observation) {
  if (observation.modality === 'browser-page') return previous?.content.url !== observation.content.url;
  return observation.source === 'desktop:foreground' && previous?.content.process !== observation.content.process;
}

export function observationHash(o: Observation) {
  const { revision, changedSections, evidenceId, ...content } = o.content;
  if (o.modality === 'screenshot') return evidenceId ?? o.id;
  return createHash('sha256').update(JSON.stringify(content)).digest('hex');
}

export function sceneFact(o: Observation, current: boolean, now: number) {
  const { title, process, handle, url, revision, playback } = o.content;
  const staleAfter = o.disclosure?.expiresAt ?? o.at + 5 * 60_000;
  return {
    id: o.id, at: o.at, source: o.sourceIdentity ?? o.source, modality: o.modality,
    title: title.slice(0, 160), process, handle, url: url?.slice(0, 500), revision, playback,
    validity: current && o.modality !== 'screenshot' ? 'current' : now >= staleAfter ? 'stale' : 'last-known',
    authority: o.provenance.authority,
  };
}

export function excerptObservation(record: ObservationRecord): ObservationRecord {
  const o = record.observation!;
  if (!o.content.sections && (o.content.text?.length ?? 0) <= 3000) return record;
  let left = 3000;
  const changed = new Set(o.content.changedSections);
  const indexed = o.content.sections?.map((section, index) => ({ section, index }));
  const relevant = indexed?.filter(({ index }) => index === 0 || changed.has(index));
  const first = (relevant?.length ?? 0) > 1 ? relevant : indexed;
  const sections = first?.slice(0, 12).flatMap(({ section }) => {
    if (left <= 0) return [];
    const text = section.text.slice(0, left);
    left -= text.length;
    return [{ ...section, path: section.path.slice(0, 160), text }];
  });
  return { ...record, observation: { ...o, content: { ...o.content, ...(o.content.text === undefined ? {} : { text: o.content.text.slice(0, 3000) }), ...(sections ? { sections } : {}) },
    loss: { truncated: true, missing: [...o.loss.missing, 'working-excerpt-retrieve-original-by-id'] } } };
}
