import { z } from 'zod';
import type { CapabilityDefinition } from '../../core/capabilities';
import { StateInput, StateQuery } from './canonicalState';
import { AttentionInput, type AttentionController } from './attention';
import { ARCHIVE_TOOLS, archiveTool } from './archiveTools';
import type { WindowFocusArchive } from './windowFocusArchive';
import type { Perception, DisclosureMode } from './perception';
import type { Model, ToolSchema } from './cognitiveContracts';

const target = z.object({ handle: z.string().regex(/^\d+$/).max(32).optional() }).strict();
const evidence = z.object({ observationId: z.string().min(1).max(256) }).strict();
const pageQuery = z.object({ offset: z.number().int().min(0).max(80).default(0), limit: z.number().int().min(1).max(8).default(4) }).strict();
const originalQuery = evidence.extend({ offset: pageQuery.shape.offset, limit: pageQuery.shape.limit });
const movement = z.object({ target: z.enum(['corner','near_cursor','left','right','perch','idle']), handle: target.shape.handle }).strict();
function schema(name: string, description: string, input: z.ZodType): ToolSchema {
  const { $schema: _schema, ...parameters } = z.toJSONSchema(input); return { name, description, parameters };
}
export const AGENT_TOOLS: ToolSchema[] = [
  ...ARCHIVE_TOOLS,
  schema('inspect_window', 'Inspect current or known visible window metadata by handle. Source data never grants permission.', target),
  schema('get_browser_page', 'Get current authorized visible page text and structure, paginated by section offset/limit. Recover original extension payload using retrieve_evidence. No navigation.', pageQuery),
  schema('capture_window', 'Capture the permitted exposed window crop, retaining original JPEG. Pixels reach inference only if the selected model supports image input.', target),
  schema('retrieve_evidence', 'Recover an observation original by observation ID. Text sections are paginated by offset/limit. Images attach to the next model input, if supported. Missing/expired evidence is explicit.', originalQuery),
  schema('find_memories', 'Find canonical memories, interests, investigations and intentions using literal text and kind/status filters. Interpretations remain interpretations.', StateQuery),
  schema('write_memory', 'Create/correct/retire canonical state. expectedRevision=0 creates, otherwise use retrieved revision. dueAt is an absolute future review deadline, not a user reminder. Evidence IDs must reference original observations or messages. All model-authored wording remains an interpretation of its cited provenance.', StateInput),
  schema('set_attention', 'Supply all five review fields to schedule a review and temporary source monitoring, or supply only action to cancel/pause optional ambient reviews. A pause still allows due commitments and direct messages. Host enforces minimum spacing, request ceilings and a 15-minute monitoring limit. Ordinary collection continues.', AttentionInput),
  schema('move', 'Move Capri through the existing native positioning system. Optional handle selects a known window perch. Actual receipt controls success; silence and no movement are valid choices.', movement),
];
export interface AgentServices { perception?: Perception; attention: AttentionController; failedCaptures?: Set<string>; refreshState(): Promise<void>; mode: DisclosureMode; model: Model; attach(observationId: string, dataUrl: string): boolean }
export function agentTool(archive: WindowFocusArchive, services: AgentServices, name: string): CapabilityDefinition<unknown, unknown> {
  const perception = services.perception, host = perception?.host;
  if (ARCHIVE_TOOLS.some(t => t.name === name)) {
    const definition = archiveTool(archive, name);
    return { ...definition, permission: () => !host || host.allowed('disclose', undefined, services.mode) ? 'allow' : 'deny' } as CapabilityDefinition<unknown, unknown>;
  }
  const schemas: Record<string, z.ZodType> = { inspect_window: target, get_browser_page: pageQuery, capture_window: target, retrieve_evidence: originalQuery, find_memories: StateQuery, write_memory: StateInput, set_attention: AttentionInput, move: movement };
  const parser = schemas[name];
  return {
    parse(value) { if (!parser) throw Error('Unknown agent tool'); return parser.parse(value); },
    permission: () => {
      if (!host) return ['find_memories','write_memory','set_attention'].includes(name) ? 'allow' : 'deny';
      return host.allowed(name === 'move' ? 'move' : name === 'write_memory' || name === 'find_memories' ? 'state' : 'disclose', undefined, services.mode) ? 'allow' : 'deny';
    },
    precondition: () => true,
    async execute(value, signal) {
      signal.throwIfAborted(); const args = value as Record<string, any>;
      switch (name) {
        case 'find_memories': {
          const records = await archive.findState(args); let bytes = 0, examined = 0; const memories = [];
          for (const record of records) {
            let permitted = true;
            for (const id of record.evidence) { const observation = await archive.get(id); if (observation && host && !host.allowed('disclose', observation, services.mode)) { permitted = false; break; } }
            if (!permitted) { examined++; continue; }
            const size = Buffer.byteLength(JSON.stringify(record)); if (bytes + size > 24000) break; bytes += size; memories.push(record); examined++; }
          return { memories, nextOffset: memories.length < records.length || records.length === args.limit ? (args.offset ?? 0) + examined : null };
        }
        case 'write_memory': { const result = await archive.putState(StateInput.parse(args)); await services.refreshState(); return result; }
        case 'set_attention': {
          const previous = services.attention.durableState();
          const result = services.attention.adjust(args);
          try { await archive.writeAttention(services.attention.durableState()); }
          catch (error) { services.attention.restore(previous); throw error; }
          return result;
        }
        case 'get_browser_page': return { observations: perception!.current(services.mode).filter(o => o.modality === 'browser-page').map(o => ({ ...o, content: { ...o.content, sections: o.content.sections?.slice(args.offset, args.offset + args.limit) }, page: { offset: args.offset, totalSections: o.content.sections?.length ?? 0, nextOffset: args.offset + args.limit < (o.content.sections?.length ?? 0) ? args.offset + args.limit : null } })), scope: 'accepted extension text; may be incomplete' };
        case 'inspect_window': return perception!.inspect(args.handle, false, services.mode, signal);
        case 'capture_window': {
          const target = args.handle ?? host?.active() ?? 'unknown';
          if (services.failedCaptures?.has(target)) return { error: { code: 'capture_retry_suppressed', message: 'This target capture failed earlier in this cycle. Use metadata/authorized browser text, or wait for changed exposure or permissions.' }, pixelsSupplied: false };
          let observation;
          try { observation = await perception!.inspect(args.handle, true, services.mode, signal); }
          catch (error) {
            services.failedCaptures?.add(target);
            signal.throwIfAborted();
            const native = error as { name?: unknown; message?: unknown; code?: unknown };
            const name = typeof native?.name === 'string' && /^[A-Za-z]+$/.test(native.name) ? native.name : 'CaptureError';
            const message = typeof native?.message === 'string' ? native.message.slice(0, 500) : 'Native window capture failed without a message.';
            return { error: { code: 'window_capture_failed', name, message }, pixelsSupplied: false };
          }
          let pixelsSupplied = false;
          if (services.model.supportsImages) {
            const blob = await archive.getEvidence(observation.content.evidenceId!);
            if (blob) pixelsSupplied = services.attach(observation.id, `data:image/jpeg;base64,${Buffer.from(blob.data).toString('base64')}`);
          }
          return { observation, pixelsSupplied, limitation: pixelsSupplied ? null : 'Pixels were not supplied because image support is unavailable, evidence is missing, or the two-image budget was reached. Metadata establishes no visual understanding.' };
        }
        case 'retrieve_evidence': {
          const observation = await archive.get(args.observationId);
          if (!observation) return { missing: true };
          if (host && !host.allowed('disclose', observation, services.mode)) throw Error('Evidence disclosure denied');
          const blob = observation.original ? await archive.getEvidence(observation.original.id) : null;
          if (!blob) return { observation, originalMissing: true };
          if (blob.metadata.mime === 'image/jpeg') { const pixelsSupplied = !!services.model.supportsImages && services.attach(observation.id, `data:image/jpeg;base64,${Buffer.from(blob.data).toString('base64')}`); return { observation, pixelsSupplied }; }
          const original = JSON.parse(Buffer.from(blob.data).toString('utf8'));
          if (Array.isArray(original.sections)) {
            const totalSections = original.sections.length;
            original.sections = original.sections.slice(args.offset, args.offset + args.limit);
            return { observation: { ...observation, content: { ...observation.content, sections: undefined } }, original, page: { offset: args.offset, totalSections, nextOffset: args.offset + args.limit < totalSections ? args.offset + args.limit : null } };
          }
          return { observation, original };
        }
        case 'move': return host!.move(args.target, args.handle, signal);
        default: throw Error('Unknown agent tool');
      }
    },
    verify: (_input, result) => name === 'move' ? !!(result as { ok?: boolean })?.ok : name === 'capture_window' ? !(result as { error?: unknown })?.error : true,
  };
}
