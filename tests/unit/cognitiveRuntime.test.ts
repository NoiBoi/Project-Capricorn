import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CognitiveRuntime, type Opportunity } from '../../src/core/cognitiveRuntime';
import { AgencyRuntime, SkillExecutor, type AvailabilityEvidence, type Skill } from '../../src/core/agency';
import { CognitiveSqlite } from '../../src/main/store/cognitiveSqlite';
import { BehaviorCore } from '../../src/main/behavior/core';
import { ConversationScene } from '../../src/main/store/conversationScene';
import type { PresenceSample } from '../../src/core/presencePolicy';

const cleanup: (()=>void)[]=[];
afterEach(()=>{for(const close of cleanup.splice(0).reverse())close();});
function fixture(){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'capri-cognition-'));
  let at=1800000000000;
  const store=new CognitiveSqlite(path.join(dir,'runtime.sqlite'),()=>at);
  const skills:Skill[]=['hold_position','quiet','commitment'].map(name=>({name:name as Skill['name'],parse:v=>v as {},permissions:[],plan:[],idempotency:'keyed',maxAttempts:1,recovery:'revalidate',precondition:()=>true,execute:async()=>({id:'receipt:'+at,at,verified:true,detail:'Verified fixture effect'}),verify:()=>true}));
  const agency=new AgencyRuntime(store,new SkillExecutor(skills,()=>true),()=>at);
  let runtime=new CognitiveRuntime(store,()=>true,()=>at);runtime.attachAgency(agency);
  const available:AvailabilityEvidence={suspended:false,quiet:false,focused:false,idleSeconds:0,gameOrCall:false,leisure:false,sources:['fixture-native']};
  agency.observe(available);
  cleanup.push(()=>{agency.stop();store.close();fs.rmSync(dir,{recursive:true,force:true});});
  const opportunity=(id='article',revision=1,priority=40):Opportunity=>({id,subject:id,source:'chrome',at,expiresAt:at+600000,revision,priority,action:'reason',event:'inspect'});
  const sample=():PresenceSample=>({at,idleSec:0,sleepAfter:600,date:'2026-10-29',hour:12,windows:[],contextCue:'',lowBattery:false,rest:false,teleport:{auto:false,minMs:60000,maxMs:60000},enabled:{context:true,speech:true,activities:false,movement:false,newWindows:false,cursor:false,inspect:true,theatre:false,possession:false,cursorNear:false,satellite:false},busy:false,movementBusy:false,pointerProtected:false,candidates:[]});
  return {dir,store,agency,opportunity,sample,get runtime(){return runtime;},get at(){return at;},advance(ms:number){at+=ms;},availability(value:Partial<AvailabilityEvidence>){agency.observe({...available,...value});},restart(){runtime=new CognitiveRuntime(store,()=>true,()=>at);runtime.attachAgency(agency);return runtime;}};
}

describe('authoritative cognitive event sequences, real SQLite and XState',()=>{
  it('discards stale motion offers and resets automatic movement after user interaction',()=>{
    const f=fixture();f.runtime.offer({...f.opportunity('auto'),event:'native-auto',action:'move'});f.runtime.offer(f.opportunity('document'));
    f.runtime.preempt('pat',0);
    expect(f.runtime.snapshot().deferred.map(o=>o.id)).toEqual(['document']);
    expect(f.runtime.presence.teleportStatus(true).nextAt).toBe(0);
  });
  it('deduplicates identities and revisions, resolves and reopens only on new evidence',()=>{
    const f=fixture(),o=f.opportunity();
    expect(f.runtime.offer(o)).toBe(true);const effect=f.runtime.decide()!;f.runtime.settle(effect,'completed');
    for(let i=0;i<100;i++)expect(f.runtime.offer({...o,at:f.at})).toBe(false);
    expect(f.runtime.decide()).toBeUndefined();
    f.runtime.transition('article','resolved');expect(f.runtime.snapshot().subjects[0].phase).toBe('resolved');
    expect(f.runtime.offer(f.opportunity('article',2))).toBe(true);
    expect(f.runtime.snapshot().subjects[0].phase).toBe('revised');expect(f.runtime.decide()?.opportunity.revision).toBe(2);
  });
  it('observations update state without independently creating a speech or motion opportunity',()=>{
    const f=fixture(),o=f.opportunity();
    expect(f.runtime.ingest({id:o.id,type:'observation',at:o.at,value:o,evidence:[{id:'browser:42',source:'chrome',revision:1,at:o.at,kind:'observation',dependencies:[]}]})).toBe(true);
    expect(f.runtime.decide()).toBeUndefined();expect(f.runtime.deliveryAllowed()).toBe(false);
  });
  it('preempts in-flight optional work without deleting unrelated durable commitments',async()=>{
    const f=fixture();await f.agency.submit('commitment',{text:'Discuss the design later'},{id:'promise',source:'command'});
    f.runtime.offer(f.opportunity());const effect=f.runtime.decide()!;expect(f.runtime.claim('behavior')).toBe(true);
    f.runtime.preempt('direct:user:1');
    expect(f.runtime.validEffect(effect)).toBe(false);expect(f.runtime.deliveryAllowed()).toBe(false);
    expect(f.agency.active('commitment')).toHaveLength(1);expect(f.agency.attention.getSnapshot().context.owner).toBeNull();
    f.runtime.settle(effect,'completed','Late result must not become a conclusion');expect(f.runtime.snapshot().conclusions).toEqual([]);
  });
  it('honors active stay and quiet commitments for optional speech and movement',async()=>{
    const f=fixture();await f.agency.submit('hold_position',{}, {id:'stay',durationMs:60000});
    f.runtime.offer(f.opportunity());expect(f.runtime.decide()).toBeUndefined();expect(f.runtime.claim('local-move')).toBe(false);
    f.agency.complete('stay');await f.agency.submit('quiet',{}, {id:'focus',durationMs:60000});
    expect(f.runtime.decide()).toBeUndefined();f.agency.complete('focus');expect(f.runtime.decide()).toBeDefined();
  });
  it.each(['game','call','afk','suspended'] as const)('defers important evidence through %s unavailability and revisits it once',mode=>{
    const f=fixture();f.availability(mode==='afk'?{idleSeconds:400}:mode==='suspended'?{suspended:true}:{gameOrCall:true,sources:[mode]});
    f.runtime.offer({...f.opportunity('important'),important:true});expect(f.runtime.decide()).toBeUndefined();expect(f.runtime.claim('behavior')).toBe(false);
    f.advance(30000);f.availability({});const effect=f.runtime.decide()!;expect(effect.opportunity.id).toBe('important');f.runtime.settle(effect,'completed');expect(f.runtime.decide()).toBeUndefined();
  });
  it('arbitrates simultaneous optional opportunities without racing two model requests',()=>{
    const f=fixture();f.runtime.offer(f.opportunity('cursor',1,20));f.runtime.offer(f.opportunity('deadline',1,80));
    const first=f.runtime.decide()!;expect(first.opportunity.id).toBe('deadline');expect(f.runtime.decide()).toBeUndefined();expect(f.runtime.claim('cursor-visit')).toBe(false);
    f.runtime.settle(first,'completed');expect(f.runtime.decide()?.opportunity.id).toBe('cursor');
  });
  it('rejects a stale execution release after a newer interaction acquired the same attention name',()=>{
    const f=fixture();expect(f.runtime.claim('behavior')).toBe(true);const generation=f.runtime.executionRevision();
    f.runtime.preempt('direct',0);expect(f.runtime.claim('behavior')).toBe(true);
    expect(f.runtime.continuationValid(generation)).toBe(false);expect(f.runtime.continuationValid(f.runtime.executionRevision())).toBe(false);
    f.runtime.release('behavior',generation);expect(f.runtime.ownsAttention('behavior')).toBe(true);
    f.runtime.release('behavior');expect(f.runtime.ownsAttention('behavior')).toBe(false);
  });
  it('abandons queued topics when closed and reopens them only with a newer development',()=>{
    const f=fixture();f.runtime.offer(f.opportunity());f.runtime.transition('article','abandoned');
    expect(f.runtime.decide()).toBeUndefined();expect(f.runtime.offer(f.opportunity())).toBe(false);
    expect(f.runtime.offer({...f.opportunity('article',2),change:'development'})).toBe(true);expect(f.runtime.decide()?.opportunity.revision).toBe(2);
  });
  it('allows an admitted performance to finish while its own physical activity excludes competing initiative',()=>{
    const f=fixture(),host={developer:false,sleeping:false,theatre:false,lifecycleBusy:false,hidden:false,controlling:false,recording:false,conversing:false,held:false,unstable:false,interruptionsPermitted:true};
    f.runtime.observeHost(host);expect(f.runtime.claim('theatre')).toBe(true);
    f.runtime.observeHost({...host,theatre:true});expect(f.runtime.deliveryAllowed()).toBe(true);expect(f.runtime.claim('behavior')).toBe(false);
    f.runtime.preempt('pat');expect(f.runtime.deliveryAllowed()).toBe(false);
  });
  it('coordinates an admitted cursor continuation with speech availability without admitting unrelated output',()=>{
    const f=fixture(),input={direct:false,composer:false,pendingAudio:0,waitSeconds:30};
    expect(f.runtime.mayPresent(input)).toBe(false);expect(f.runtime.claim('cursor-visit')).toBe(true);
    expect(f.runtime.mayPresent(input)).toBe(true);expect(f.runtime.mayPresent({...input,composer:true})).toBe(false);expect(f.runtime.mayPresent({...input,pendingAudio:1})).toBe(false);
    f.runtime.release('cursor-visit');expect(f.runtime.mayPresent(input)).toBe(false);
  });
  it('rechecks current capability settings before selecting an already deferred opportunity',()=>{
    const f=fixture();f.runtime.offer(f.opportunity());const s=f.sample();
    expect(f.runtime.sample({...s,enabled:{...s.enabled,speech:false}})).toBeUndefined();expect(f.runtime.snapshot().deferred).toHaveLength(1);
    expect(f.runtime.sample(s)?.opportunity.id).toBe('article');
  });
  it('turns an approved native completion into another optional opportunity instead of directly requesting speech',()=>{
    const f=fixture();expect(f.runtime.physicalResult('clock')).toBe(false);
    f.runtime.offer({...f.opportunity('clock'),action:'move',event:'clock'});const motion=f.runtime.decide()!;
    expect(f.runtime.physicalResult('clock')).toBe(true);expect(f.runtime.decide()).toBeUndefined();
    f.runtime.settle(motion,'completed');expect(f.runtime.decide()?.opportunity).toMatchObject({action:'reason',event:'context',source:'native-execution'});
  });
  it('queues model-requested investigation as a later arbitrated effect rather than moving from the model callback',()=>{
    const f=fixture();expect(f.runtime.requestInvestigation('42','document')).toBe(false);
    f.runtime.offer(f.opportunity());const reasoning=f.runtime.decide()!;expect(f.runtime.claim('behavior')).toBe(true);
    f.runtime.cooldown(15000);expect(f.runtime.requestInvestigation('42','document')).toBe(true);
    f.runtime.release('behavior');f.runtime.settle(reasoning,'completed');expect(f.runtime.decide()).toBeUndefined();
    f.advance(15001);expect(f.runtime.decide()?.opportunity).toMatchObject({action:'move',event:'visit',target:'42',targetKey:'document'});
  });
  it('invalidates settled effects and ignores duplicate receipts when a newer revision owns the agenda',()=>{
    const f=fixture();f.runtime.offer(f.opportunity());const first=f.runtime.decide()!;f.runtime.offer(f.opportunity('article',2));expect(f.runtime.validEffect(first)).toBe(false);f.runtime.settle(first,'completed');
    expect(f.runtime.validEffect(first)).toBe(false);const second=f.runtime.decide()!;
    expect(second.id).not.toBe(first.id);f.runtime.settle(first,'failed','A stale receipt');
    expect(f.runtime.validEffect(second)).toBe(true);expect(f.runtime.snapshot().conclusions).not.toContain('A stale receipt');
  });
  it('preserves the migrated thirty-minute project consideration gap across restart, including a silent decision',()=>{
    const f=fixture(),project=(id:string)=>({...f.opportunity(id),event:'personal_followup'});
    f.runtime.offer(project('project:first'));f.runtime.offer(project('project:queued'));f.runtime.settle(f.runtime.decide()!,'completed');expect(f.runtime.decide()).toBeUndefined();f.advance(120000);f.restart();
    expect(f.runtime.offer(project('project:second'))).toBe(false);expect(f.runtime.decide()).toBeUndefined();
    f.advance(1800000);expect(f.runtime.offer(project('project:second'))).toBe(true);expect(f.runtime.decide()?.opportunity.id).toBe('project:second');
  });
  it('prevents a legacy optional model dispatch from bypassing runtime admission',async()=>{
    const f=fixture();let calls=0;
    const core=new BehaviorCore({directory:f.dir,cognition:f.runtime,scene:new ConversationScene(f.dir,()=>true,()=>true,()=>f.at),now:()=>f.at,memories:()=>[],provider:{name:'mock',local:true,async *stream(){calls++;yield '{}';},async test(){return {ok:true,detail:''};},async listModels(){return [];}},express:()=>true});
    const result=await core.dispatch({kind:'trigger',event:'context',detail:'Unadmitted legacy call',direct:false});
    expect(result.action).toBe('defer');expect(calls).toBe(0);
  });
  it('restores deferred state and deduplication but never replays an in-flight effect',()=>{
    const f=fixture();f.runtime.offer(f.opportunity('selected',1,80));f.runtime.offer(f.opportunity('deferred'));
    f.runtime.decide();f.restart();expect(f.runtime.deliveryAllowed()).toBe(false);expect(f.runtime.offer(f.opportunity('selected',1,80))).toBe(false);
    expect(f.runtime.decide()?.opportunity.id).toBe('deferred');expect(f.runtime.snapshot().subjects).toHaveLength(2);
  });
  it('returns from AFK once through the same agenda and never from an unchanged periodic sample',()=>{
    const f=fixture();const absent={...f.sample(),idleSec:400,enabled:{...f.sample().enabled,movement:true}};
    f.availability({idleSeconds:400});expect(f.runtime.sample(absent)).toBeUndefined();
    f.advance(5000);f.availability({});const returned={...f.sample(),enabled:{...f.sample().enabled,movement:true}};
    const effect=f.runtime.sample(returned)!;expect(effect.opportunity.event).toBe('return');f.runtime.settle(effect,'completed');
    for(let i=0;i<10;i++){f.advance(1000);expect(f.runtime.sample({...returned,at:f.at})).toBeUndefined();}
  });
  it('bounds ingestion and discards expired evidence rather than reporting it after a long absence',()=>{
    const f=fixture();f.availability({gameOrCall:true});for(let i=0;i<200;i++)f.runtime.offer(f.opportunity('event:'+i));
    expect(f.runtime.snapshot().deferred.length).toBeLessThanOrEqual(16);expect(f.runtime.snapshot().subjects.length).toBeLessThanOrEqual(32);
    f.advance(601000);f.availability({});expect(f.runtime.decide()).toBeUndefined();
  });
  it('shares real model decision state with direct dialogue and stays bounded when the model is unavailable',async()=>{
    const f=fixture();let calls=0,delivered=0;
    const core=new BehaviorCore({directory:f.dir,cognition:f.runtime,scene:new ConversationScene(f.dir,()=>true,()=>true,()=>f.at),now:()=>f.at,memories:()=>[],provider:{name:'mock',local:true,async *stream(){calls++;throw Error('provider unavailable');},async test(){return {ok:false,detail:'offline'};},async listModels(){return [];}},express:()=>{delivered++;return true;}});
    f.runtime.offer(f.opportunity());const effect=f.runtime.decide()!;expect(f.runtime.claim('behavior')).toBe(true);
    const result=await core.dispatch({kind:'trigger',event:'context',detail:'Real sourced opportunity',direct:false});
    expect(result.delivered).toBe(false);f.runtime.release('behavior');f.runtime.settle(effect,'failed');
    for(let i=0;i<30;i++){f.advance(1000);expect(f.runtime.decide()).toBeUndefined();}
    expect(calls).toBe(1);expect(delivered).toBe(0);
    const message={id:'user:1',role:'user' as const,content:'Actually, use the blue swatch.',ts:f.at};
    f.runtime.preempt(message.id);f.runtime.observeMessage(message);core.userInput(message.content,message.id);
    expect(f.runtime.snapshot().interaction).toBe(message.id);expect(f.runtime.snapshot().dialogue.changes.at(-1)?.messageId).toBe(message.id);
    expect(core.canInitiate()).toBe(true); // A completed direct exchange has no arbitrary cooldown.
    expect(f.runtime.reasoningState(core.snapshot())).toEqual(core.snapshot());
  });
  it('revokes source-derived opportunities and clears private history without removing explicit intentions',async()=>{
    const f=fixture();await f.agency.submit('commitment',{text:'A direct promise'},{id:'promise'});
    f.runtime.offer(f.opportunity());f.runtime.invalidate('chrome');expect(f.runtime.decide()).toBeUndefined();expect(f.runtime.snapshot().subjects).toEqual([]);
    f.runtime.clear();expect(f.store.load('cognitive-runtime-v1')).toBeUndefined();expect(f.agency.active('commitment')).toHaveLength(1);
  });
  it('admits one contextual contact or panel thought per user development, keeping routine actions physical',()=>{
    const f=fixture();
    for(const event of ['pat','poke','own_panel','pickup','putdown','placed_window','greeting','return','mute'])expect(f.runtime.admitDialogue(event)).toBe(false);
    f.runtime.observeMessage({id:'u1',role:'user',content:'I want to keep the new movement while changing when you speak.',ts:f.at});
    expect(f.runtime.admitDialogue('pat')).toBe(true);
    expect(f.runtime.admitDialogue('pat')).toBe(false);
    expect(f.runtime.admitDialogue('own_panel')).toBe(true);
    f.advance(1000);
    f.runtime.observeMessage({id:'a1',role:'assistant',content:'I prefer having room to move.',ts:f.at});
    expect(f.runtime.admitDialogue('own_panel')).toBe(false);
    f.advance(1000);
    f.runtime.observeMessage({id:'u2',role:'user',content:'Yes, keep that freedom of movement and let the words follow your thoughts.',ts:f.at});
    expect(f.runtime.admitDialogue('pat')).toBe(true);
    f.advance(601000);expect(f.runtime.admitDialogue('poke')).toBe(false);
  });
  it('allows fresh discussion without a speech timer while retaining attention, composer and audio ownership',()=>{
    const f=fixture();f.runtime.offer(f.opportunity());f.runtime.decide();expect(f.runtime.claim('behavior')).toBe(true);
    expect(f.runtime.mayPresent({direct:false,composer:false,pendingAudio:0,waitSeconds:120})).toBe(true);
    expect(f.runtime.mayPresent({direct:false,composer:true,pendingAudio:0,waitSeconds:0})).toBe(false);
    expect(f.runtime.mayPresent({direct:false,composer:false,pendingAudio:1,waitSeconds:0})).toBe(false);
    f.availability({quiet:true});expect(f.runtime.mayPresent({direct:false,composer:false,pendingAudio:0,waitSeconds:0})).toBe(false);
  });
  it('admits developing physical interaction without requiring a prior verbal conversation',()=>{
    const f=fixture();
    expect(f.runtime.admitDialogue('pat','pat',false,'bout1:3')).toBe(true);
    expect(f.runtime.admitDialogue('pat','pat',false,'bout1:3')).toBe(false);
    expect(f.runtime.admitDialogue('pat','pat',false,'bout1:6')).toBe(true);
    expect(f.runtime.admitDialogue('putdown','putdown',false,'same-window:2')).toBe(true);
    expect(f.runtime.admitDialogue('placed_window','placed_window',false,'new-window:3')).toBe(true);
  });
});
