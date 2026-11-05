import type { Episode } from './windowFocusArchiveContracts';
import type { Observation } from './contracts';
import type { ToolSchema } from './cognitiveContracts';
import { validateDiscovery, validateId, validateQuery } from './windowFocusArchiveContracts';
import type { WindowFocusArchive } from './windowFocusArchive';
import type { CapabilityDefinition } from '../../core/capabilities';
const query = { type: 'object', properties: { limit: { type: 'integer', minimum: 1, maximum: 100 }, search: { type: 'string', maxLength: 256 }, from: { type: 'number' }, to: { type: 'number' } }, additionalProperties: false };
const discovery = { ...query, properties: { ...query.properties, limit: { type: 'integer', minimum: 1, maximum: 50 },
  offset: { type: 'integer', minimum: 0, maximum: 10000 },
  source: { type: 'string', description: 'Exact application, source identity or window handle' },
  modality: { type: 'string', description: 'Observation modality or dialogue for saved conversation' }, relatedId: { type: 'string' },
} };
const activity = { type: 'object', properties: {
  after: { type: 'integer', minimum: 0 }, through: { type: 'integer', minimum: 0 },
  source: discovery.properties.source, from: query.properties.from, to: query.properties.to, before: { type: 'integer', minimum: 1 },
}, additionalProperties: false };
export const ARCHIVE_TOOLS: ToolSchema[] = [
  { name: 'read_activity', description: 'List episodes by time/source. Expand a scene range or episode with after (episode id minus one) and through. Continue with nextAfter. IDs recover originals.', parameters: activity },
  { name: 'get_recent_observations', description: 'Read recent original observations, newest first; optional time range. Maximum 100.', parameters: query },
  { name: 'search_observations', description: 'Discover compact historical evidence by keywords, time, source, modality or related observation ID. Paginate with nextOffset and use retrieve_evidence for details.', parameters: discovery },
  { name: 'get_observation_by_id', description: 'Read one original observation by stable ID. A missing result means absent or expired under retention.', parameters: { type: 'object', properties: { id: { type: 'string', minLength: 1, maxLength: 256 } }, required: ['id'], additionalProperties: false } },
  { name: 'get_archive_statistics', description: 'Read authorized oldest and newest evidence when available.', parameters: { type: 'object', properties: {}, additionalProperties: false } },
];
function preview(o: Observation) {
  if (!o.content.sections?.length) return o;
  let left = 4000;
  return { ...o, content: { ...o.content, sections: o.content.sections.flatMap(section => { if (left <= 0) return []; const text = section.text.slice(0,left); left -= text.length; return [{ ...section, text }]; }) }, loss: { truncated: true, missing: [...o.loss.missing,'tool-excerpt-use-retrieve_evidence-for-original-sections'] } };
}
export async function episodeSummary(archive: WindowFocusArchive, episode: Episode,
  allowed: (observation: Observation) => boolean, now = Date.now(), source?: string) {
  const { events, nextAfter } = await archive.sceneEvents({ after: episode.id - 1, through: episode.endSequence, limit: 24, latest: true, source });
  const sample = events.flatMap(({ observation }) => observation && allowed(observation) ? [observation] : []);
  if (!sample.length) return undefined;
  return {
    ...episode, after: episode.id - 1, through: episode.endSequence,
    status: now - episode.lastActivityAt < 300000 && now - episode.startedAt < 1800000 ? 'active' : 'closed',
    sources: [...new Set(sample.map(o => o.sourceIdentity ?? o.source))].slice(0, 8),
    sample: sample.slice(0, 4).map(o => ({ id: o.id, at: o.at, handle: o.content.handle, version: o.content.revision ?? null })),
    sampledEvents: events.length, unavailableOrWithheldInSample: events.length - sample.length,
    sampleHasMore: nextAfter !== null, provenance: 'retained host observation chronology',
  };
}
export function archiveTool(archive: WindowFocusArchive, name: string, allowed: (o: Observation) => boolean = () => true, dialogueAllowed = () => true): CapabilityDefinition<Record<string, unknown>, unknown> {
  const canDisclose = (o: Observation) => (o.disclosure?.retainUntil ?? Infinity) > Date.now() && allowed(o);
  return {
    parse(value) {
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('Tool arguments must be an object.');
      const args = value as Record<string, unknown>;
      if (name === 'read_activity') {
        if (Object.keys(args).some(key => !(key in activity.properties))) throw Error('Unknown activity argument');
        if (args.after !== undefined || args.through !== undefined) {
          if (Object.keys(args).length !== 2 || !Number.isSafeInteger(args.after) || !Number.isSafeInteger(args.through) ||
              Number(args.after) < 0 || Number(args.through) < Number(args.after)) throw Error('Invalid activity range');
        }
        return args;
      }
      if (name === 'search_observations') return validateDiscovery({ limit: 12, ...args });
      if (name === 'get_recent_observations') {
        return validateQuery({ ...args, limit: args.limit === undefined ? 20 : args.limit } as any) as Record<string, unknown>;
      }
      if (name === 'get_observation_by_id') { if (Object.keys(args).some(k => k !== 'id')) throw Error('Unknown argument'); validateId(args.id as string); return args; }
      if (name !== 'get_archive_statistics' || Object.keys(args).length) throw Error('Unknown archive tool or arguments.');
      return args;
    },
    permission: () => 'allow', precondition: () => true,
    async execute(args, signal) {
      signal.throwIfAborted();
      let result: unknown;
      if (name === 'read_activity') {
        if (typeof args.after === 'number' && typeof args.through === 'number') {
          const page = await archive.sceneEvents({ after: args.after, through: args.through, limit: 24 });
          const events = page.events.flatMap(({ sequence, observation: o, conditions }) => o && canDisclose(o)
            ? [{ sequence, id: o.id, at: o.at, source: o.sourceIdentity ?? o.source, modality: o.modality, handle: o.content.handle, version: o.content.revision ?? null, related: o.related?.slice(0, 4), conditions, status: 'historical' }]
            : []);
          signal.throwIfAborted();
          return { events, unavailableOrWithheld: page.events.length - events.length, nextAfter: page.nextAfter };
        }
        const episodes = await archive.episodeList(args);
        const summaries = await Promise.all(episodes.map(episode => episodeSummary(archive, episode,
          canDisclose, Date.now(), typeof args.source === 'string' ? args.source : undefined)));
        signal.throwIfAborted();
        return { episodes: summaries.filter(Boolean), nextBefore: episodes.length === 12 ? episodes.at(-1)?.id : null };
      }
      if (name === 'search_observations') {
        if (args.modality === 'dialogue' && !dialogueAllowed()) return { status: 'denied' };
        const page = await archive.discover(args);
        const hits: unknown[] = [];
        for (const hit of page.hits) {
          if ('dialogue' in hit) { hits.push(hit); continue; }
          const { observation: o, score, tier } = hit;
          if (!canDisclose(o)) continue;
          const { title, process, handle, url, text } = o.content;
          hits.push({ score, tier, observation: { ...o, content: { title: title.slice(0, 160), process, handle, url, text } },
            validity: o.disclosure?.expiresAt && o.disclosure.expiresAt <= Date.now() ? 'stale' : 'historical',
            detail: o.original ? ['observation','original'] : ['observation'] });
        }
        result = { hits, nextOffset: page.nextOffset, ranking: page.ranking };
      } else if (name === 'get_recent_observations') {
        const observations = (await archive.recent(args)).filter(canDisclose);
        const bounded = []; let bytes = 0;
        for (const original of observations) { const o = preview(original); const size = Buffer.byteLength(JSON.stringify(o)); if (bytes + size > 256_000) break; bytes += size; bounded.push(o); }
        result = { observations: bounded, truncated: bounded.length < observations.length };
      } else if (name === 'get_observation_by_id') { const observation = await archive.get(args.id as string); result = observation ? canDisclose(observation) ? preview(observation) : { status: 'denied' } : null; }
      else { const stats = await archive.stats(); result = { oldest: stats.oldest && canDisclose(stats.oldest) ? preview(stats.oldest) : undefined, newest: stats.newest && canDisclose(stats.newest) ? preview(stats.newest) : undefined }; }
      signal.throwIfAborted(); return result;
    },
    verify: () => true,
  };
}
