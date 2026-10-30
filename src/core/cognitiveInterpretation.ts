import { z } from 'zod';

const Citation = z.object({ sourceId:z.string().min(1).max(100), quote:z.string().min(3).max(450) }).strict();
export const ThoughtChange = z.object({
  topic:z.string().min(3).max(100), kind:z.enum(['position','reason','question','intention','criticism','experience']),
  status:z.enum(['active','revised','resolved','abandoned']), evidence:Citation,
  /** A reason is a separately attributed delivered quote, never an invented rationale. */
  reason:Citation.nullable(),
}).strict();
export const ThoughtChanges = z.array(ThoughtChange).max(4);
export interface ThoughtEvidence { id:string; role:'user'|'assistant'; text:string; at:number }
export interface CharacterThought {
  topic:string; kind:z.infer<typeof ThoughtChange>['kind']; status:z.infer<typeof ThoughtChange>['status'];
  evidence:ThoughtEvidence; reason?:ThoughtEvidence; previous?:ThoughtEvidence; at:number;
}
export const COGNITIVE_EXTRACTION = `When cognitive_request is non-null, optionally return cognition:[] in this SAME extraction response, maximum four important transitions. Otherwise return []. No extra model call is requested.
Each item: {topic:short stable subject,kind:position|reason|question|intention|criticism|experience,status:active|revised|resolved|abandoned,evidence:{sourceId,quote},reason:null|{sourceId,quote}}. Both citations MUST be exact substrings of cognitive_request.evidence. Position, reason, question and intention require Capri's delivered assistant words; criticism requires a user complaint. Preserve her actual language instead of manufacturing a personality summary. A reason must actually be given in assistant speech, never supplied by you. Use revised for a genuine changed view on the same topic, resolved/abandoned for explicitly finished thoughts. Do not infer relationship depth, emotion, biography, preferences from user statements, or intentions from actions she has not confirmed. Learned stable tastes and shared episodes keep their existing stores; this is bounded operational thought with attributed evidence. Do not duplicate tastes/episodes here. Latest corrections and closed subjects win. Empty arrays are often correct.`;

export function groundedChanges(raw:unknown, evidence:ThoughtEvidence[], now:number):CharacterThought[] {
  const parsed=ThoughtChanges.safeParse(raw);if(!parsed.success)return [];
  const cite=(c:z.infer<typeof Citation>)=>{
    const source=evidence.find(e=>e.id===c.sourceId&&e.text.includes(c.quote)&&e.at<=now);
    return source?{...source,text:c.quote}:undefined;
  };
  return parsed.data.flatMap(c=>{
    const source=cite(c.evidence),reason=c.reason?cite(c.reason):undefined;
    if(!source||c.reason&&!reason)return [];
    const userClosure=['question','intention'].includes(c.kind)&&['resolved','abandoned'].includes(c.status);
    if(['position','reason','question','intention'].includes(c.kind)&&source.role!=='assistant'&&!userClosure)return [];
    if(c.kind==='criticism'&&source.role!=='user'||reason&&reason.role!=='assistant')return [];
    return [{topic:c.topic,kind:c.kind,status:c.status,evidence:source,reason,at:now}];
  });
}
