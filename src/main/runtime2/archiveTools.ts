import type { Observation } from './contracts';
import type { ToolSchema } from './cognitiveContracts';
import { validateId, validateQuery } from './windowFocusArchiveContracts';
import type { WindowFocusArchive } from './windowFocusArchive';
import type { CapabilityDefinition } from '../../core/capabilities';
const query = { type: 'object', properties: { limit: { type: 'integer', minimum: 1, maximum: 100 }, search: { type: 'string', maxLength: 256 }, from: { type: 'number' }, to: { type: 'number' } }, additionalProperties: false };
export const ARCHIVE_TOOLS: ToolSchema[] = [
  { name: 'get_recent_observations', description: 'Read recent original observations, newest first; optional time range. Maximum 100.', parameters: query },
  { name: 'search_observations', description: 'Search original observation payloads literally, including browser text; optional time range. Maximum 100.', parameters: { ...query, required: ['search'] } },
  { name: 'get_observation_by_id', description: 'Read one original observation by stable ID. A missing result means absent or expired under retention.', parameters: { type: 'object', properties: { id: { type: 'string', minLength: 1, maxLength: 256 } }, required: ['id'], additionalProperties: false } },
  { name: 'get_archive_statistics', description: 'Read archive record count and oldest/newest original evidence.', parameters: { type: 'object', properties: {}, additionalProperties: false } },
];
function preview(o: Observation) {
  if (!o.content.sections?.length) return o;
  let left = 4000;
  return { ...o, content: { ...o.content, sections: o.content.sections.flatMap(section => { if (left <= 0) return []; const text = section.text.slice(0,left); left -= text.length; return [{ ...section, text }]; }) }, loss: { truncated: true, missing: [...o.loss.missing,'tool-excerpt-use-retrieve_evidence-for-original-sections'] } };
}
export function archiveTool(archive: WindowFocusArchive, name: string): CapabilityDefinition<Record<string, unknown>, unknown> {
  return {
    parse(value) {
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('Tool arguments must be an object.');
      const args = value as Record<string, unknown>;
      if (name === 'get_recent_observations' || name === 'search_observations') {
        if (name === 'search_observations' && (typeof args.search !== 'string' || !args.search.trim())) throw Error('Search text is required.');
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
      if (name === 'get_recent_observations' || name === 'search_observations') {
        const observations = await archive.recent(args);
        const bounded = []; let bytes = 0;
        for (const original of observations) { const o = preview(original); const size = Buffer.byteLength(JSON.stringify(o)); if (bytes + size > 256_000) break; bytes += size; bounded.push(o); }
        result = { observations: bounded, truncated: bounded.length < observations.length };
      } else if (name === 'get_observation_by_id') { const observation = await archive.get(args.id as string); result = observation ? preview(observation) : null; }
      else { const stats = await archive.stats(); result = { ...stats, oldest: stats.oldest ? preview(stats.oldest) : undefined, newest: stats.newest ? preview(stats.newest) : undefined }; }
      signal.throwIfAborted(); return result;
    },
    verify: () => true,
  };
}
