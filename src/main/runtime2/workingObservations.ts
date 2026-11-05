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
  const { revision, changedSections, ...content } = o.content;
  return createHash('sha256').update(JSON.stringify(content)).digest('hex');
}

export function workingObservations(
  journal: ConversationRecord[], live: Observation[], cursor: number, previous: ReadonlyMap<string, string>,
) {
  const candidates = new Map<string, ObservationRecord>();
  for (const record of journal) {
    if (record.kind === 'observation' && record.observation) candidates.set(record.observationId, record);
  }
  for (const o of live) {
    const record = candidates.get(o.id);
    candidates.set(o.id, record ? { ...record, observation: o } : { id: o.id, sequence: 0, at: o.at, kind: 'observation', observationId: o.id, observation: o });
  }

  const ordered = [...candidates.values()].sort((a, b) => b.at - a.at || b.sequence - a.sequence);
  const liveIds = new Set(live.map(o => o.id));
  const latest = new Map<string, ObservationRecord>();
  const changes = [];
  const changeHashes = new Set<string>();
  for (const record of ordered) {
    const o = record.observation!;
    const slot = observationSlot(o);
    // A saved browser snapshot does not establish that its tab is still visible.
    const stateSlot = o.modality === 'browser-page' ? 'visible-browser' : slot;
    if (!latest.has(stateSlot) && (liveIds.has(o.id) || o.modality !== 'browser-page' && !o.disclosure?.expiresAt)) {
      latest.set(stateSlot, record);
      continue;
    }
    if (record.sequence <= cursor || changes.length >= 8) continue;
    const hash = observationHash(o);
    const current = latest.get(stateSlot)?.observation;
    if (current && observationSlot(current) === slot && observationHash(current) === hash) continue;
    const key = slot + ':' + hash;
    if (changeHashes.has(key)) continue;
    changeHashes.add(key);
    changes.push({ id: o.id, at: o.at, source: o.source, sourceIdentity: o.sourceIdentity, modality: o.modality, title: o.content.title.slice(0, 160) });
  }

  const priority = (r: ObservationRecord) => {
    const o = r.observation!;
    return o.source === 'desktop:foreground' || o.modality === 'browser-page' || o.modality === 'application-text' ? 0 : 1;
  };
  const chosen = [...latest.values()].sort((a, b) => priority(a) - priority(b)).slice(0, 6);
  const hashes = new Map(chosen.map(r => [observationSlot(r.observation!), observationHash(r.observation!)]));
  const repeatedIds = new Set(chosen.filter(r => hashes.get(observationSlot(r.observation!)) === previous.get(observationSlot(r.observation!))).map(r => r.id));
  return {
    chosen, changes: changes.reverse(), hashes, repeatedIds,
    omitted: candidates.size - chosen.length - changes.length,
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
