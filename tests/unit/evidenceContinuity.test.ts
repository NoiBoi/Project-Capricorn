import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { archiveWorkerPath } from '../helpers/runtime2Archive';
import { WindowFocusArchive } from '../../src/main/runtime2/windowFocusArchive';
import { CognitiveLoop, type LoopOptions } from '../../src/main/runtime2/cognitiveLoop';
import { TypedCapabilityExecutor } from '../../src/core/capabilities';
import { DailySession, requestTextMeasure } from '../../src/main/runtime2/dailySession';
import { approximateTokens, encodeInput, encodeTools } from '../../src/main/runtime2/context';
import { selectAmbientDialogue } from '../../src/main/runtime2/dialogueSelection';
import { selectSemanticEvidence } from '../../src/main/runtime2/evidenceSelection';
import type { CognitiveProvider, ModelInput } from '../../src/main/runtime2/cognitiveContracts';
import type { Observation } from '../../src/main/runtime2/contracts';
import type { DesktopHost } from '../../src/main/runtime2/perception';

const cleanup: (()=>unknown)[] = [];
afterEach(async()=>{for(const f of cleanup.splice(0).reverse()) await f(); vi.restoreAllMocks();});
const model = {id:'fixture',label:'Fixture',contextTokens:128000,supportsImages:true};
const call = (id:string,name:string,args:unknown)=>({id,name,arguments:JSON.stringify(args)});
const investigate = (evidence:string[]=[])=>call('begin','investigate',{id:'question',expectedRevision:0,question:'Explain the cobalt valve anomaly.',stoppingCondition:'Explain from supplied evidence, or report uncertainty.',evidence});
const state = (id:string,kind='interest',evidence:string[]=[])=>({id,kind,text:'Cobalt valve question',provenance:'model-interpretation',evidence,status:'active',dueAt:null,expectedRevision:0});
function page(id:string,text='DISTINCTIVE_DETAIL_X: cobalt valve threshold is 739 kPa.'):Observation {
  return {id,at:Date.now(),source:'chrome',sourceIdentity:id,modality:'browser-page',
    disclosure:{source:'chrome',retain:true,expiresAt:Date.now()+90000,retainUntil:Date.now()+3600000},
    content:{handle:'42',title:'Cobalt valve',process:'chrome.exe',text,url:'https://example.org/'+id},
    provenance:{authority:'host',collector:'fixture',metadata:{}},loss:{truncated:false,missing:[]}};
}
async function fixture(infer:CognitiveProvider['infer'],options:LoopOptions={}) {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'capri-continuity-'));
  cleanup.push(()=>fs.rmSync(root,{recursive:true,force:true}));
  const profile=path.join(root,'Capri Buddy 2.0 Synthetic','continuity');
  const archive=new WindowFocusArchive(profile,{workerPath:archiveWorkerPath});
  await archive.initialize(); cleanup.push(()=>archive.close());
  const daily=new DailySession(profile,false); await daily.recorder.start({fixture:'evidence-continuity'}); cleanup.push(()=>daily.recorder.stop());
  const host:DesktopHost={windows:()=>[{handle:'42',title:'Cobalt valve',process:'chrome.exe'}],active:()=> '42',allowed:()=>true,
    capture:async()=>undefined,move:async()=>({ok:true,detail:'fixture'}),body:()=>({})};
  const inputs:ModelInput[]=[];
  const loop=new CognitiveLoop(archive,{models:async()=>[model],shutdown(){},infer:async(...args)=>{inputs.push(structuredClone(args[1]));return infer(...args);}},new TypedCapabilityExecutor(),{model:model.id,host,daily,...options});
  cleanup.push(()=>loop.shutdown()); await loop.initialize(); clearInterval((loop as any).timer);
  async function wake() {let pending=true;(loop as any).ambientTrigger=()=>pending?(pending=false,'source-change'):undefined; await (loop as any).drain(); expect(loop.state.phase).toBe('idle');}
  async function image(id='visual-Y') {
    const blob=await archive.putEvidence(Buffer.from('deterministic-image-'+id),'image/jpeg');
    const o:Observation={...page(id),modality:'screenshot',source:'screen',disclosure:{source:'screen',retain:true,retainUntil:Date.now()+3600000},original:{id:blob.id,observedAt:Date.now()},content:{title:'Valve diagram',handle:'42',process:'chrome.exe',evidenceId:blob.id}};
    await loop.perception!.observe(o);return o;
  }
  async function events() {await daily.recorder.flush();return fs.readFileSync(path.join(daily.recorder.status.folder!,'events.jsonl'),'utf8').trim().split('\n').map(s=>JSON.parse(s));}
  return {archive,host,loop,inputs,wake,image,events};
}
it('carries initiating text and one original image into deep inference without reacquisition or repeated automatic image submission',async()=>{
  let round=0;
  const f=await fixture(async()=>++round===1?{text:'',calls:[investigate(['A','visual-Y'])]}:round===2?{text:'',calls:[call('continue','set_attention',{afterMs:30000})]}:{text:'',calls:[]});
  await f.loop.perception!.observe(page('A'));const visual=await f.image();await f.wake();
  expect(f.inputs).toHaveLength(3);
  expect(f.inputs.map(i=>i.images?.map(o=>o.observationId)??[])).toEqual([['visual-Y'],['visual-Y'],[]]);
  expect(f.inputs[1].images?.[0].capturedAt).toBe(visual.at);
  for(const input of f.inputs) {
    expect(JSON.stringify(encodeInput(input))).toContain('DISTINCTIVE_DETAIL_X');
    expect(input.records.filter(r=>r.kind==='observation'&&r.observationId==='A')).toHaveLength(1);
  }
  expect((f.inputs[1].workingState as any).route).toBe('deep');
  expect((f.inputs[2].workingState as any).initiatingVisualEvidence).toMatchObject([{id:'visual-Y',representation:'reference'}]);
  expect((await f.archive.conversation()).records.some(r=>r.kind==='tool-call'&&r.name==='retrieve_evidence')).toBe(false);
  const receipts=(await f.events()).filter(e=>e.type==='evidence.selection');
  expect(receipts[1].data).toMatchObject({initiatingEvidence:['A'],initiatingImages:['visual-Y'],imageIds:['visual-Y'],selected:[{id:'A',representation:'full'}]});
});
it.each(['permission','revoked','expiry'] as const)('withholds initiating semantic and visual evidence after %s between rounds',async change=>{
  let n=0;
  const f=await fixture(async()=>{
    if(++n>1)return {text:'',calls:[]};
    if(change==='permission')f.host.allowed=(_op,o)=>!o;
    if(change==='revoked'){await f.archive.forgetSource('chrome');await f.archive.forgetSource('screen');}
    if(change==='expiry')vi.spyOn(Date,'now').mockReturnValue(Date.now()+7200000);
    return {text:'',calls:[investigate()]};
  });
  await f.loop.perception!.observe(page('A'));await f.image();await f.wake();
  expect(f.inputs).toHaveLength(2);
  expect(JSON.stringify(encodeInput(f.inputs[1]))).not.toContain('DISTINCTIVE_DETAIL_X');
  expect(f.inputs[1].images??[]).toEqual([]);
  expect((f.inputs[1].workingState as any).initiatingVisualEvidence??[]).toEqual([]);
});
it('expands a briefly visited page from the archive as historical evidence after the actual browser focus path removes it',async()=>{
  const f=await fixture(async()=>({text:'',calls:[]}));
  async function visit(id:string,title:string,text:string) {
    await f.loop.perception!.page({recordId:id,operation:'upsert',mode:'semantic',url:'https://example.org/'+id,title,occurredAt:Date.now(),revision:1,sections:[{kind:'paragraph',level:0,path:'body',text}]} as any);
  }
  await visit('A','Cobalt valve','DISTINCTIVE_DETAIL_X: threshold is 739 kPa.');
  await visit('B','Unrelated current page','This is page B.');
  expect(f.loop.perception!.current('ambient').filter(o=>o.modality==='browser-page')).toHaveLength(1);
  await f.wake();
  const selected=f.inputs[0].records.filter(r=>r.kind==='observation');
  expect(selected).toHaveLength(2);
  expect(selected.find(r=>JSON.stringify(r).includes('DISTINCTIVE_DETAIL_X'))).toMatchObject({evidenceContext:'historical',observation:{content:{title:'Cobalt valve'}}});
  expect(selected.find(r=>JSON.stringify(r).includes('This is page B.'))).toMatchObject({evidenceContext:'current'});
  const measure=requestTextMeasure({input:encodeInput(f.inputs[0])});
  const withoutHistorical=requestTextMeasure({input:encodeInput({...f.inputs[0],records:f.inputs[0].records.filter(r=>r.kind!=='observation'||r.evidenceContext!=='historical')})});
  console.log('FOCUS_MEASURE',JSON.stringify({historicalExcerptAddedEstimatedTokens:measure.approximateTextTokens-withoutHistorical.approximateTextTokens,expandedRecords:selected.length}));
  const ids=selected.map(r=>r.id);const read=vi.spyOn(f.archive,'get');await f.wake();
  expect(f.inputs[1].records.filter(r=>r.kind==='observation').map(r=>r.id)).toEqual([ids.find(id=>selected.find(r=>r.id===id)?.evidenceContext==='current')]);
  expect(read.mock.calls.some(([id])=>id===ids.find(id=>selected.find(r=>r.id===id)?.evidenceContext==='historical'))).toBe(false);
});
it('ranks relevance and unhandled material changes over unrelated stale pages, and avoids duplicate text',async()=>{
  const stale=page('stale','STALE_UNRELATED');const fresh=page('fresh','FRESH');const relevant=page('relevant','RELEVANT');
  const read=vi.fn(async(o:Observation)=>o);
  const result=await selectSemanticEvidence({candidates:[stale,fresh,relevant],changed:new Set(['fresh']),relevant:new Set(['relevant']),current:()=>false,permitted:()=>true,resolve:read});
  expect(result.records.map(r=>r.id)).toEqual(['relevant','fresh']);expect(read).toHaveBeenCalledTimes(2);
  const duplicate=await selectSemanticEvidence({candidates:[fresh,{...fresh,id:'duplicate'}],changed:new Set(['fresh','duplicate']),relevant:new Set(),current:()=>false,permitted:()=>true,resolve:read});
  expect(duplicate.records).toHaveLength(1);expect(duplicate.decisions.some(d=>d.reason==='duplicate-content')).toBe(true);
});
it('never expands unauthorized or expired originals during focus selection',async()=>{
  const expired=page('expired');expired.disclosure!.retainUntil=Date.now()-1;
  const denied=page('denied');const allowed=page('allowed','ALLOWED');
  const resolve=vi.fn(async(o:Observation)=>o);
  const selected=await selectSemanticEvidence({candidates:[expired,denied,allowed],changed:new Set(['expired','denied','allowed']),relevant:new Set(),current:()=>false,
    permitted:o=>(o.disclosure!.retainUntil!>Date.now()&&o.id!=='denied'),resolve});
  expect(selected.records.map(r=>r.id)).toEqual(['allowed']);expect(resolve).toHaveBeenCalledTimes(1);
  expect(selected.decisions).toEqual(expect.arrayContaining([expect.objectContaining({id:'expired',reason:'retention-expired'}),expect.objectContaining({id:'denied',reason:'permission'})]));
});
it('recovers an autonomous opinion without user anchors after interruptions and when its subject returns',async()=>{
  const f=await fixture(async()=>({text:'',calls:[]}));
  await f.archive.appendConversation({id:'opinion',at:Date.now()-10000,kind:'assistant',text:'I distrust that cobalt valve layout.'});
  expect((await f.archive.dialogueExchange('opinion')).map(r=>r.id)).toEqual(['opinion']);
  for(let n=0;n<40;n++)await f.archive.appendConversation({id:'other-'+n,at:Date.now()-9000+n,kind:n%2?'assistant':'user',text:'Unrelated interruption '+n});
  await f.loop.perception!.observe(page('A'));await f.wake();
  expect(f.inputs[0].records.find(r=>r.id==='opinion')).toMatchObject({kind:'assistant',text:'I distrust that cobalt valve layout.'});
  const dialogue=f.inputs[0].records.filter(r=>r.kind==='user'||r.kind==='assistant');
  expect(dialogue.map(r=>r.sequence)).toEqual(dialogue.map(r=>r.sequence).sort((a,b)=>a-b));
  expect(Buffer.byteLength(JSON.stringify(dialogue))).toBeLessThan(4600);
  expect(await f.archive.findState()).toEqual([]);
  expect((f.inputs[0].workingState as any).conversationPolicy).toContain('An unrelated subject needs no callback');
  f.host.windows=()=>[{handle:'42',title:'Cooking noodles',process:'chrome.exe'}];
  await f.wake();
  expect(f.inputs[1].records.some(r=>r.id==='opinion')).toBe(false);
  expect((await f.archive.conversation(100,true)).records).toHaveLength(41);
});
it('retains recent assistant-only journal records directly and excludes explicitly retired dialogue even on a search hit',async()=>{
  const f=await fixture(async()=>({text:'',calls:[]}));
  await f.archive.appendConversation({id:'aside',at:Date.now(),kind:'assistant',text:'Cobalt valves make me suspicious.'});
  const recent=(await f.archive.conversation(10,true)).records;
  expect((await selectAmbientDialogue(f.archive,recent,0,[],[],new Set())).map(r=>r.id)).toEqual(['aside']);
  expect(await selectAmbientDialogue(f.archive,recent,0,['Cobalt valves'],['aside'],new Set(['aside']))).toEqual([]);
  f.host.allowed=op=>op!=='conversation';await f.wake();
  expect(f.inputs[0].records.some(r=>r.kind==='assistant')).toBe(false);
});
it('recovers a relevant expressed view even when its surrounding user-anchored exchange exceeds recovery limits',async()=>{
  const f=await fixture(async()=>({text:'',calls:[]}));
  await f.archive.appendConversation({id:'anchor',at:Date.now()-1000,kind:'user',text:'A long conversation follows.'});
  await f.archive.appendConversation({id:'taste',at:Date.now()-999,kind:'assistant',text:'The cobalt valve layout is reckless.'});
  for(let n=0;n<70;n++)await f.archive.appendConversation({id:'aside-'+n,at:Date.now()-900+n,kind:'assistant',text:'Another distinct aside '+n});
  const selected=await selectAmbientDialogue(f.archive,(await f.archive.conversation(12,true)).records,0,['Cobalt valve'],[],new Set());
  expect(selected.find(r=>r.id==='taste')).toMatchObject({kind:'assistant',text:'The cobalt valve layout is reckless.'});
  expect(selected.length).toBeLessThanOrEqual(12);
});
it.each(['completed','abandoned','retired'] as const)('keeps %s investigations and their checkpoint inactive on both ambient and deep routes',async status=>{
  let n=0;const f=await fixture(async()=>++n===1?{text:'',calls:[investigate()]}:{text:'',calls:[]});
  await f.archive.appendConversation({id:'old-instruction',at:Date.now()-1000,kind:'user',text:'EXCLUSIVE_OLD_WATCH must continue forever.'});
  await f.archive.putState({...state('old','investigation',['old-instruction']),status} as any);
  await f.archive.putState({...state('working-checkpoint','checkpoint',['old-instruction']),text:'STALE_CHECKPOINT follow old watch.'} as any);
  await f.loop.perception!.observe(page('A'));await f.wake();
  expect(f.inputs).toHaveLength(2);
  for(const input of f.inputs) {
    expect(JSON.stringify(input)).not.toContain('EXCLUSIVE_OLD_WATCH');expect(JSON.stringify(input)).not.toContain('STALE_CHECKPOINT');
    expect((input.workingState as any).completedTasks).toMatchObject([{id:'old',status}]);
    expect((input.workingState as any).activeState.some((s:any)=>s.id==='old')).toBe(false);
  }
});
it('removes duplicate initiating excerpts when a tool already supplies that observation, and rechecks the result after revocation',async()=>{
  let n=0;const f=await fixture(async()=>{
    if(++n===1)return {text:'',calls:[investigate()]};
    if(n===2)return {text:'',calls:[call('get','retrieve_evidence',{observationId:'A'})]};
    if(n===3){f.host.allowed=(_op,o)=>o?.id!=='A';return {text:'',calls:[call('wait','set_attention',{afterMs:30000})]};}
    return {text:'',calls:[]};
  });
  await f.loop.perception!.observe(page('A'));await f.wake();
  expect(f.inputs[2].records.filter(r=>r.kind==='observation'&&r.id==='A')).toHaveLength(0);
  expect(JSON.stringify(f.inputs[2]).match(/DISTINCTIVE_DETAIL_X/g)).toHaveLength(1);
  expect(JSON.stringify(f.inputs[3])).not.toContain('DISTINCTIVE_DETAIL_X');
  expect(f.inputs[3].records.find(r=>r.kind==='tool-result'&&r.requestId==='get')).toMatchObject({receipt:{outcome:'denied'},result:{withheld:expect.any(String)}});
});
it('keeps a bounded initiating excerpt when the larger tool exchange cannot fit the context budget',async()=>{
  let n=0;const f=await fixture(async()=>++n===1?{text:'',calls:[investigate()]}:n===2?{text:'',calls:[call('large','retrieve_evidence',{observationId:'A'})]}:{text:'',calls:[]},{contextBudget:38000});
  await f.loop.perception!.observe(page('A','DISTINCTIVE_DETAIL_X '+ 'large payload '.repeat(6000)));await f.wake();
  expect(f.inputs).toHaveLength(3);
  expect(f.inputs[2].records.some(r=>r.kind==='tool-result'&&r.requestId==='large')).toBe(false);
  expect(f.inputs[2].records.find(r=>r.kind==='observation'&&r.id==='A')).toBeDefined();
  expect(JSON.stringify(f.inputs[2])).toContain('DISTINCTIVE_DETAIL_X');
  const receipts=(await f.events()).filter(e=>e.type==='evidence.selection');
  expect(receipts[2].data.decisions).toContainEqual({id:'A',representation:'excerpt',reason:'tool-result-trimmed'});
});
it('bounds large excerpts, measures overhead, trims near capacity, and retains the existing six-request ceiling',async()=>{
  let n=0;const f=await fixture(async()=>++n===1?{text:'',calls:[investigate(['A','visual-Z'])]}:n===6?{text:'',calls:[]}:{text:'',calls:[call('round-'+n,'set_attention',{afterMs:30000})]});
  const o=page('A','重'.repeat(12000));o.content.sections=[{kind:'paragraph',level:0,path:'body',text:o.content.text!}];
  await f.loop.perception!.observe(o);await f.image();await f.image('visual-Z');await f.wake();
  expect(f.inputs).toHaveLength(6);expect(f.inputs.at(-1)!.tools).toEqual([]);
  expect(f.inputs.map(i=>i.images?.length??0)).toEqual([2,1,0,0,0,0]);
  expect(f.inputs[1].images?.map(i=>i.observationId)).toEqual(['visual-Z']);
  const record=f.inputs[0].records.find(r=>r.kind==='observation')!;
  expect(Buffer.byteLength(JSON.stringify(record))).toBeLessThan(7000);
  expect(record).toMatchObject({observationId:'A',observation:{loss:{truncated:true}}});
  const measure=requestTextMeasure({instructions:f.inputs[0].identity,input:encodeInput(f.inputs[0]),tools:encodeTools(f.inputs[0])});
  const without=requestTextMeasure({instructions:f.inputs[0].identity,input:encodeInput({...f.inputs[0],records:f.inputs[0].records.filter(r=>r.kind!=='observation')}),tools:encodeTools(f.inputs[0])});
  expect(measure.approximateTextTokens-without.approximateTextTokens).toBeLessThan(1900);
  // Reassemble the same request immediately below its evidence group's admission threshold.
  const {assembleContext}=await import('../../src/main/runtime2/context');
  const input=f.inputs[0];const fixed=approximateTokens({identity:input.identity,tools:input.tools,workingState:input.workingState});
  const trimmed=assembleContext(input.records,model,input.tools,fixed+100,8192,input.workingState,input.identity);
  expect(trimmed.records).toEqual([]);
  expect(approximateTokens({identity:trimmed.identity,tools:trimmed.tools,workingState:trimmed.workingState})).toBeLessThan(fixed+100);
  console.log('CONTINUITY_MEASURE',JSON.stringify({withEvidence:measure,withoutEvidence:without,addedEstimatedTextTokens:measure.approximateTextTokens-without.approximateTextTokens,requests:f.inputs.length,imageSubmissions:f.inputs.reduce((sum,i)=>sum+(i.images?.length??0),0),
    perRound:f.inputs.map((i,round)=>({round,...requestTextMeasure({instructions:i.identity,input:encodeInput(i),tools:encodeTools(i)})}))}));
});
