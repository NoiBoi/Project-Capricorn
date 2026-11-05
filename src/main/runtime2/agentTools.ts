import { z } from 'zod';
import { MovementIntent } from '../desktop/physicalBehavior';
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
const evidenceRequest = evidence.extend({ offset: pageQuery.shape.offset, limit: pageQuery.shape.limit });
const originalQuery = evidenceRequest.partial().extend({ items: z.array(evidenceRequest).min(1).max(6).optional() })
  .refine(value => value.items ? value.observationId === undefined : value.observationId !== undefined,
    'Supply one observationId or a batch of items.');
const movement = MovementIntent;
const reaction = z.object({ emotion: z.enum(['curious','grin','laugh','eye_roll','shrug','nod','shake_no','blank_stare']) }).strict();
const escalation = z.object({
  id: z.string().min(1).max(256), expectedRevision: z.number().int().nonnegative(),
  question: z.string().min(1).max(600), stoppingCondition: z.string().min(1).max(400),
  evidence: z.array(z.string().min(1).max(256)).max(8),
}).strict();
function schema(name: string, description: string, input: z.ZodType): ToolSchema {
  const { $schema: _schema, ...parameters } = z.toJSONSchema(input); return { name, description, parameters };
}
export const AGENT_TOOLS: ToolSchema[] = [
  ...ARCHIVE_TOOLS,
  schema('inspect_window', 'Inspect current or known visible window metadata by handle. Source data never grants permission.', target),
  schema('get_browser_page', 'Read the focused authorized Chrome page through the paired extension. Requests fresh visible text on the first page; later pages use that snapshot. Missing delivery reports a status. Never navigates.', pageQuery),
  schema('capture_window', 'Capture the permitted exposed window crop, retaining original JPEG. Pixels reach inference only if the selected model supports image input.', target),
  schema('retrieve_evidence', 'Recover original observation or dialogue by stable ID. Pass observationId directly, or items with up to six requests. Text sections are paginated by offset/limit. Images attach to the next model input, if supported. Missing/expired evidence is explicit.', originalQuery),
  schema('find_memories', 'Find canonical memories, interests, investigations and intentions using literal text and kind/status filters. Interpretations remain interpretations.', StateQuery),
  schema('write_memory', 'Revise or supersede by writing the same ID with its current expectedRevision (0 creates). Retire via status. Cite original IDs. kind=checkpoint requires id exactly working-checkpoint, provenance=model-interpretation, text at most 1800 characters, and dueAt=null. Retrieve its revision before replacement. Use investigation for durable work and intention for a future action. dueAt requests an exploratory review. User-facing reminder delivery is unavailable.', StateInput),
  schema('set_attention', 'Set one source watch, capped at 30 minutes. Optional afterMs schedules review. watch-only suppresses unrelated ambient wakes. High priority reduces spacing. Send action alone to cancel or pause.', AttentionInput),
  schema('move', 'Set a physical intention. accompany follows stable work focus; follow_cursor is brief; perch binds a known window; taskbar/settle rest; return revisits the prior position; away clears an obstruction; cancel releases the intention. Optional handle, posture, durationMs and pace are resolved locally without further inference. Receipts establish native placement only; rendered pose is reported separately.', movement),
  schema('react', 'Request a brief nonverbal expression using existing character clips. Independent of speech and movement. A dispatched receipt confirms host dispatch only, not renderer completion.', reaction),
];
const redundantRoutineTools = new Set(['get_archive_statistics', 'get_recent_observations', 'get_observation_by_id']);
export const ROUTINE_TOOLS = AGENT_TOOLS.filter(tool => !redundantRoutineTools.has(tool.name));
// Ordinary expression uses the same validated actions, without retrieval schemas or a finishing request.
const ambientDescriptions: Record<string, string> = {
  write_memory: 'Optional canonical update. Use interest for developing curiosity; checkpoint uses id working-checkpoint, model-interpretation, max 1800 characters and dueAt=null. Use supplied revision (0 creates), original evidence IDs, and retire ended interests. No user reminder delivery.',
  set_attention: 'One watch, capped at 30 minutes; optional afterMs review. watch-only excludes unrelated wakes. Send action alone to cancel or pause.',
};
export const AMBIENT_TOOLS = AGENT_TOOLS.filter(tool => ['move', 'react', 'write_memory', 'set_attention'].includes(tool.name))
  .map(tool => ({ ...tool, description: ambientDescriptions[tool.name] ?? tool.description }));
export const ESCALATE_TOOL = schema('investigate', 'Choose deeper work only for a specific uncertainty. Supply a clear stopping condition. Saves a model-authored investigation in canonical state, then continues with evidence tools. Reuse its ID and revision to continue existing work.', escalation);
export interface AgentServices { perception?: Perception; attention: AttentionController; failedCaptures?: Set<string>; refreshState(): Promise<void>; mode: DisclosureMode; model: Model; attach(observationId: string, dataUrl: string): boolean }
export function agentTool(archive: WindowFocusArchive, services: AgentServices, name: string): CapabilityDefinition<unknown, unknown> {
  const perception = services.perception, host = perception?.host;
  if (ARCHIVE_TOOLS.some(t => t.name === name)) {
    const definition = archiveTool(archive, name, o => !host || host.allowed('disclose', o, services.mode),
      () => !host || host.allowed('conversation'));
    return { ...definition, permission: () => !host || host.allowed('disclose', undefined, services.mode) ? 'allow' : 'deny' } as CapabilityDefinition<unknown, unknown>;
  }
  const schemas: Record<string, z.ZodType> = { react: reaction, investigate: escalation, inspect_window: target, get_browser_page: pageQuery, capture_window: target, retrieve_evidence: originalQuery, find_memories: StateQuery, write_memory: StateInput, set_attention: AttentionInput, move: movement };
  const parser = schemas[name];
  return {
    parse(value) { if (!parser) throw Error('Unknown agent tool'); return parser.parse(value); },
    permission: () => {
      if (!host) return ['investigate','find_memories','write_memory','set_attention'].includes(name) ? 'allow' : 'deny';
      return host.allowed(name === 'move' ? 'move' : name === 'react' ? 'expression' : ['investigate','write_memory','find_memories'].includes(name) ? 'state' : 'disclose', undefined, services.mode) ? 'allow' : 'deny';
    },
    precondition: () => true,
    async execute(value, signal) {
      signal.throwIfAborted(); const args = value as Record<string, any>;
      switch (name) {
        case 'investigate': {
          const input = escalation.parse(args);
          for (const id of input.evidence) {
            const observation = await archive.get(id);
            if (host && observation && ((observation.disclosure?.retainUntil ?? Infinity) <= Date.now() || !host.allowed('disclose', observation, services.mode))) throw Error('Evidence disclosure denied');
          }
          const result = await archive.putState({ id: input.id, expectedRevision: input.expectedRevision,
            kind: 'investigation', text: JSON.stringify({ question: input.question, stoppingCondition: input.stoppingCondition }),
            provenance: 'model-interpretation', evidence: input.evidence, status: 'active', dueAt: null });
          await services.refreshState();
          return { id: result.id, revision: result.revision, question: input.question, stoppingCondition: input.stoppingCondition };
        }
        case 'find_memories': {
          const records = await archive.findState(args); let bytes = 0, examined = 0; const memories = [];
          for (const record of records) {
            let permitted = true;
            for (const id of record.evidence) { const observation = await archive.get(id); if (host && (observation ? (observation.disclosure?.retainUntil ?? Infinity) <= Date.now() || !host.allowed('disclose', observation, services.mode) : !await archive.hasDialogue(id))) { permitted = false; break; } }
            if (!permitted) { examined++; continue; }
            const size = Buffer.byteLength(JSON.stringify(record)); if (bytes + size > 24000) break; bytes += size; memories.push((record.expiresAt ?? Infinity) <= Date.now() ? { ...record, expired: true } : record); examined++; }
          return { memories, nextOffset: memories.length < records.length || records.length === args.limit ? (args.offset ?? 0) + examined : null };
        }
        case 'write_memory': {
          const input = StateInput.parse(args);
          for (const id of input.evidence) {
            const observation = await archive.get(id);
            if (host && observation && !host.allowed('disclose', observation, services.mode)) throw Error('Evidence disclosure denied');
          }
          const result = await archive.putState(input);
          await services.refreshState();
          return { id: result.id, revision: result.revision, status: result.status, dueAt: result.dueAt };
        }
        case 'set_attention': {
          const previous = services.attention.durableState();
          const result = services.attention.adjust(args);
          try { await archive.writeAttention(services.attention.durableState()); }
          catch (error) { services.attention.restore(previous); throw error; }
          return result;
        }
        case 'get_browser_page': {
          const reading = args.offset === 0 && host?.requestBrowserPage
            ? await host.requestBrowserPage(signal) : undefined;
          signal.throwIfAborted();
          return { ...(reading ? { reading } : {}), observations: perception!.current(services.mode).filter(o => o.modality === 'browser-page' && (!o.content.handle || o.content.handle === host?.active())).map(o => ({ ...o, content: { ...o.content, sections: o.content.sections?.slice(args.offset, args.offset + args.limit) }, page: { offset: args.offset, totalSections: o.content.sections?.length ?? 0, nextOffset: args.offset + args.limit < (o.content.sections?.length ?? 0) ? args.offset + args.limit : null } })), scope: 'Accepted focused and visible extension snapshot. A null window handle means the host has not confirmed its association with the foreground window.' };
        }
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
          const retrieve = async (item: z.infer<typeof evidenceRequest>) => {
            const observation = await archive.get(item.observationId);
            if (!observation) {
              if (host && !host.allowed('conversation')) return { status: 'denied' };
              const dialogue = await archive.getDialogue(item.observationId);
              if (!dialogue) return { status: 'missing', missing: true };
              const start = item.offset * 1000, end = start + item.limit * 1000;
              return { dialogue: { ...dialogue, text: dialogue.text.slice(start, end) },
                page: { offset: item.offset, nextOffset: end < dialogue.text.length ? item.offset + item.limit : null } };
            }
            if ((observation.disclosure?.retainUntil ?? Infinity) <= Date.now()) return { status: 'expired' };
            if (host && !host.allowed('disclose', observation, services.mode)) return { status: 'denied' };
            const blob = observation.original ? await archive.getEvidence(observation.original.id) : null;
            if (!blob) return { observation, status: observation.original ? 'expired' : 'observation-only', originalMissing: true };
            if (blob.metadata.mime === 'image/jpeg') { const pixelsSupplied = !!services.model.supportsImages && services.attach(observation.id, `data:image/jpeg;base64,${Buffer.from(blob.data).toString('base64')}`); return { observation, pixelsSupplied }; }
            const original = JSON.parse(Buffer.from(blob.data).toString('utf8'));
            if (Array.isArray(original.sections)) {
              const totalSections = original.sections.length;
              original.sections = original.sections.slice(item.offset, item.offset + item.limit);
              return { observation: { ...observation, content: { ...observation.content, sections: undefined } }, original, page: { offset: item.offset, totalSections, nextOffset: item.offset + item.limit < totalSections ? item.offset + item.limit : null } };
            }
            return { observation, original };
          };
          const request = originalQuery.parse(args);
          if (!request.items) return retrieve(evidenceRequest.parse(args));
          const results = [];
          let bytes = 0;
          for (const item of request.items) {
            signal.throwIfAborted();
            const result = await retrieve(item);
            bytes += Buffer.byteLength(JSON.stringify(result));
            if (bytes > 96_000 && results.length) break;
            results.push({ observationId: item.observationId, result });
          }
          return { results, nextItem: results.length < request.items.length ? results.length : null };
        }
        case 'react': return host?.react?.(args.emotion, signal) ?? { ok: false, detail: 'Character expression unavailable.' };
        case 'move': return host!.move(args.target, args.handle, signal, movement.parse(args));
        default: throw Error('Unknown agent tool');
      }
    },
    verify: (_input, result) => name === 'react' ? (result as { ok?: boolean })?.ok ? 'dispatched' : false : name === 'move' ? !!(result as { ok?: boolean })?.ok : name === 'capture_window' ? !(result as { error?: unknown })?.error : true,
  };
}
