import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { LifeObservation } from '../../shared/lifeContext';
import { assertWorld, reconcileWorld, type WorldAssertion, type WorldFact, type EvidenceStatus } from '../../core/worldModel';
export type { WorldFact, EvidenceStatus } from '../../core/worldModel';

export const PageSection = z.object({ kind:z.enum(['heading','paragraph','list','table','code']), level:z.number().int().min(0).max(6).default(0), path:z.string().max(300).default(''), text:z.string().max(3000) }).strict();
export const PageSnapshot = z.object({ source:z.literal('chrome'), url:z.string().max(2000), revision:z.number(), at:z.number(), expiresAt:z.number(), hash:z.string().max(64), sections:z.array(PageSection).max(80) }).strict();
export type SemanticSection = z.infer<typeof PageSection>;
export const semanticHash = (value:unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0,24);
// Formatting and DOM bookkeeping are not developments. Preserve code whitespace.
export function normalizedSections(sections:SemanticSection[]) {
  let remaining=48000;
  return sections.slice(0,80).map(s=>{const text=(s.kind==='code'?s.text.trim():s.text.replace(/\s+/g,' ').trim()).slice(0,remaining);remaining-=text.length;return {...s,text};}).filter(s=>s.text);
}
export function relevantSections(sections:SemanticSection[],query:string,budget=1800) {
  const stop=new Set(['the','and','for','from','this','that','with','are','was','what','does','page','reference','docs','document','http','https','com']);
  const terms=[...new Set(query.toLowerCase().replace(/https?:\/\/\S+/g,' ').match(/[\p{L}\p{N}_]{3,}/gu)??[])].filter(t=>!stop.has(t)).slice(0,32);
  if(!terms.length)return [];
  const ranked=sections.map((s,index)=>({s,index,score:terms.reduce((n,t)=>n+Number((s.path+' '+s.text).toLowerCase().includes(t)),0)})).filter(x=>x.score>0).sort((a,b)=>b.score-a.score||a.index-b.index);
  let left=budget;return ranked.slice(0,4).map(({s})=>{const text=s.text.slice(0,Math.max(0,left-100));left-=text.length+100;return {...s,text};}).filter(s=>s.text);
}
function details(e:LifeObservation):Record<string,any>{try{const d=JSON.parse(e.detail);return d&&typeof d==='object'?d:{};}catch{return {};}}
export function eventDeadline(e:LifeObservation){const d=details(e),value=d.startAt??d.due;const at=typeof value==='number'?value:typeof value==='string'?Date.parse(value):NaN;return Number.isFinite(at)?at:undefined;}
/** Typed projections never promote an open page, filename, or third-party notice into an outcome. */
function observedFacts(events:LifeObservation[],now:number):WorldFact[]{
  const facts:WorldFact[]=[];
  for(const e of events){
    if(e.operation==='delete'||e.expiresAt<=now)continue;
    const d=details(e);let kind:WorldFact['kind']='session',value=e.summary,status:EvidenceStatus=e.quality==='user-statement'?'user-reported':e.quality==='observed'?'authoritative':'tentative';
    if(e.type.startsWith('academic-')){kind='assignment';value=e.quality==='user-statement'?`User-reported ${d.status??e.type.replace('academic-','')}: ${e.summary}`:`Source notice: ${e.summary}. Submission status unknown.`;if(e.quality!=='user-statement')status='unknown';if(['academic-submitted','academic-not-submitted','academic-graded'].includes(e.type)&&e.quality==='observed'){status='authoritative';value=`Source record reports ${e.type.slice(9)}: ${e.summary}`;}}
    else if(e.type==='calendar-scheduled'){kind='meeting';value=`Scheduled: ${e.summary}. Attendance unknown.`;}
    else if(/file-|git-state|development-session/.test(e.type)){kind=e.type.startsWith('file-')?'document':'project';value=`Observed project activity: ${e.summary}. Geometry and success unknown.`;}
    else if(/location|place|geofence/.test(e.type)){kind='place';value=`Phone location report: ${e.summary}. User activity unknown.`;}
    else if(/claim|communication|request|recruiting|message/.test(e.type)){kind='communication';status=e.quality==='user-statement'?'user-reported':'tentative';value=`Source communication: ${e.summary}`;}
    else if(e.type==='displayed-page'){status='unknown';value=`Displayed page: ${e.summary}. Reading, submission and watching duration unknown.`;}
    else if(e.type==='browser-playback'){value=`Observed playback state: ${d.state??'unknown'}. Sampled playhead is not accumulated watching duration.`;}
    else if(e.type==='user-commitment'){kind='commitment';status=e.quality==='user-statement'?'user-reported':'tentative';}
    else if(e.type==='project-status'){kind='project';status=e.quality==='user-statement'?'user-reported':'tentative';value=`Reported project state: ${e.summary}`;}
    facts.push({id:e.source+':'+e.recordId,kind,status,value,at:e.occurredAt,expiresAt:e.expiresAt,deadline:eventDeadline(e),entities:e.entities,evidence:[{source:e.source,recordId:e.recordId,revision:e.revision,quality:e.quality}]});
  }
  return facts.slice(0,64);
}
export function worldAssertion(e:LifeObservation,dependencies:string[]=[]):WorldAssertion {
  const fact=observedFacts([e],e.occurredAt)[0];
  if(!fact)throw Error('Deleted or expired evidence cannot assert world state.');
  const d=details(e),assignment=fact.kind==='assignment'&&typeof d.course==='string'&&typeof d.assignment==='string';
  const entity=assignment?'assignment:'+semanticHash([d.course.toLowerCase().trim(),d.assignment.toLowerCase().trim()]):e.type==='project-status'&&e.entities.length===1?'project:'+e.entities[0]:fact.kind+':'+semanticHash([e.source,e.recordId]);
  let predicate='observation',asserted=e.summary;
  if(assignment){predicate=['academic-submitted','academic-not-submitted','academic-graded'].includes(e.type)?'submission':'deadline';asserted=predicate==='submission'?(e.type==='academic-graded'?'submitted':e.type==='academic-not-submitted'?'not-submitted':'submitted'):'unknown';}
  else if(/file-|git-state|development-session/.test(e.type)){predicate='association';asserted='observed';}
  else if(e.type==='user-commitment'){predicate='commitment';asserted=typeof d.status==='string'?d.status:'open';}
  else if(e.type==='project-status'){predicate='status';asserted=typeof d.status==='string'?d.status:'unknown';}
  return {id:semanticHash([e.source,e.recordId,e.revision]),entity,kind:fact.kind,predicate,asserted,source:e.source,recordId:e.recordId,revision:e.revision,at:e.occurredAt,expiresAt:e.expiresAt,status:fact.status,confidence:fact.status==='authoritative'?1:fact.status==='user-reported'?.9:fact.status==='unknown'?0:.4,value:fact.value,entities:fact.entities,dependencies:[...new Set([...(e.source==='user'?[]:[e.source]),...dependencies])],retain:e.permissions.retain,correction:e.operation==='correct',deadline:fact.deadline,quality:e.quality};
}
export function worldFacts(events:LifeObservation[],now:number):WorldFact[]{
  let records:WorldAssertion[]=[];
  for(const e of events)if(e.operation!=='delete'&&e.expiresAt>now)records=assertWorld(records,worldAssertion(e));
  return reconcileWorld(records,now).slice(0,64);
}
export function investigation(input:{permitted:boolean;available:boolean;novel:boolean;usefulness:number;cost:number;remaining:number;unavailable:boolean}){
  if(!input.permitted)return {action:'silent' as const,reason:'permission'};
  if(!input.available)return {action:'defer' as const,reason:'source unavailable'};
  if(!input.novel||input.usefulness<.55)return {action:'silent' as const,reason:'saturated or low relevance'};
  if(input.unavailable)return {action:'defer' as const,reason:'social availability'};
  if(input.cost>input.remaining)return {action:'defer' as const,reason:'budget'};
  return {action:'investigate' as const,reason:'bounded relevant evidence'};
}
