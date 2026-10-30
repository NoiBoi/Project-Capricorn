import { z } from 'zod';

export const EvidenceStatus=z.enum(['authoritative','user-reported','corroborated','tentative','unknown','conflicting']);
export type EvidenceStatus=z.infer<typeof EvidenceStatus>;
export const WorldKind=z.enum(['person','assignment','meeting','project','document','place','activity','communication','session','commitment']);
export const WorldAssertion=z.object({
  id:z.string(), entity:z.string(), kind:WorldKind, predicate:z.string(), asserted:z.string(),
  source:z.string(), recordId:z.string(), revision:z.number().int().nonnegative(),
  at:z.number().finite(), expiresAt:z.number().finite(), status:EvidenceStatus,
  confidence:z.number().min(0).max(1), value:z.string(), entities:z.array(z.string()),
  dependencies:z.array(z.string()), supersededBy:z.string().optional(), correction:z.boolean(),
  retain:z.boolean().default(false),
  deadline:z.number().optional(), quality:z.enum(['observed','user-statement','model-interpretation','uncertain-association']),
});
export type WorldAssertion=z.infer<typeof WorldAssertion>;
export interface WorldEntity { id:string; kind:z.infer<typeof WorldKind>; name:string; aliases:string[]; source?:string }
export interface WorldFact {
  id:string; kind:z.infer<typeof WorldKind>; status:EvidenceStatus; value:string; at:number; expiresAt:number;
  deadline?:number; entities:string[];
  evidence:{source:string;recordId:string;revision:number;quality:WorldAssertion['quality']}[];
  entity?:string; predicate?:string; asserted?:string; contradictions?:string[];
}

/** Immutable assertion identity; corrections supersede only their own source
 * record. Independent claims survive and may disagree. Unknown is never a
 * negative assertion. Expiry removes authority without inventing an outcome. */
export function assertWorld(records:WorldAssertion[],incoming:WorldAssertion) {
  if(records.some(a=>a.id===incoming.id))return records;
  const newer=records.find(a=>a.source===incoming.source&&a.recordId===incoming.recordId&&a.revision>incoming.revision);
  const next={...incoming,...newer?{supersededBy:newer.id}:{}};
  return [...records.map(a=>a.source===incoming.source&&a.recordId===incoming.recordId&&a.revision<incoming.revision?{...a,supersededBy:incoming.id}:a),next].slice(-2000);
}
export function reconcileWorld(records:WorldAssertion[],now:number):WorldFact[] {
  const current=records.filter(a=>!a.supersededBy&&a.expiresAt>now&&a.at<=now);
  return current.map(a=>{
    const peers=current.filter(b=>b.entity===a.entity&&b.predicate===a.predicate);
    const known=peers.filter(b=>b.status!=='unknown'&&b.asserted!=='unknown');
    const contradictions=known.filter(b=>a.asserted!=='unknown'&&b.asserted!==a.asserted).map(b=>b.id);
    const agreeing=known.filter(b=>b.asserted===a.asserted);
    const status:EvidenceStatus=contradictions.length?'conflicting':a.status==='authoritative'||a.status==='user-reported'||a.status==='unknown'?a.status:new Set(agreeing.map(b=>b.source)).size>1?'corroborated':a.status;
    return {id:a.source+':'+a.recordId,entity:a.entity,predicate:a.predicate,asserted:a.asserted,kind:a.kind,status,value:a.value,at:a.at,expiresAt:a.expiresAt,deadline:a.deadline,entities:a.entities,contradictions,
      evidence:peers.map(b=>({source:b.source,recordId:b.recordId,revision:b.revision,quality:b.quality}))};
  });
}
