import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { TypedCapabilityExecutor, type CapabilityDefinition } from '../../src/core/capabilities';
import { prepareAction, runAction, type ActionContext } from '../../src/main/actions/registry';
import { LifeContext, ContextAssembler } from '../../src/main/life/context';
import { RelationshipStore } from '../../src/main/store/relationship';
import { DEFAULT_SETTINGS } from '../../src/shared/settings';
import type { LifeObservation } from '../../src/shared/lifeContext';

function checkpoints(){const saved=new Map<string,unknown>();return {saved,load:<T>(id:string)=>structuredClone(saved.get(id)) as T|undefined,save:<T>(id:string,value:T)=>{saved.set(id,structuredClone(value));},removeCheckpoint:(id:string)=>{saved.delete(id);}};}
const call={id:'one',capability:'fixture',fingerprint:'hash',dependencies:['chrome']};
const signal=()=>new AbortController().signal;
function definition(run=vi.fn(async()=>true)):CapabilityDefinition<string,boolean>{return {parse:x=>{if(typeof x!=='string')throw Error('Invalid input');return x;},permission:()=> 'allow',precondition:()=>true,execute:run,verify:(_x,r)=>r};}

describe('authoritative capability execution',()=>{
  it('verifies effects, rejects forged identity, and refuses replay after restart',async()=>{
    const store=checkpoints(),run=vi.fn(async()=>true),d=definition(run),gateway=new TypedCapabilityExecutor(store);
    expect((await gateway.execute(call,'input',d,signal())).receipt.outcome).toBe('completed');
    expect((await new TypedCapabilityExecutor(store).execute(call,'input',d,signal())).receipt.replayed).toBe(true);
    expect((await gateway.execute({...call,fingerprint:'different'},'different',d,signal())).receipt.outcome).toBe('denied');
    expect(run).toHaveBeenCalledTimes(1);
  });
  it('rechecks permissions even for a completed replay',async()=>{
    const gateway=new TypedCapabilityExecutor(),d=definition();await gateway.execute(call,'input',d,signal());d.permission=()=> 'deny';
    expect((await gateway.execute(call,'input',d,signal())).receipt.outcome).toBe('denied');
  });
  it('does not replay a journaled execution interrupted by process loss',async()=>{
    const store=checkpoints();store.save('capability-journal-v1',{version:1,entries:[call]});
    const run=vi.fn(async()=>true),r=await new TypedCapabilityExecutor(store).execute(call,'input',definition(run),signal());
    expect(r.receipt.outcome).toBe('unknown');expect(run).not.toHaveBeenCalled();
  });
  it('returns cancellation after partial execution without claiming rollback or success',async()=>{
    const controller=new AbortController(),gateway=new TypedCapabilityExecutor();
    const r=await gateway.execute(call,'input',definition(vi.fn(async()=>{controller.abort();return true;})),controller.signal);
    expect(r.receipt.outcome).toBe('cancelled');expect(r.result).toBeUndefined();expect(r.receipt.detail).toContain('may have occurred');
  });
  it('rejects a past deadline, bad input, missing approval and failed preconditions before effects',async()=>{
    const gateway=new TypedCapabilityExecutor(undefined,()=>100),run=vi.fn(async()=>true),d=definition(run);
    expect((await gateway.execute({...call,deadline:99},'input',d,signal())).receipt.outcome).toBe('cancelled');
    expect((await gateway.execute(call,2,d,signal())).receipt.outcome).toBe('failed');
    d.permission=()=> 'confirm';expect((await gateway.execute(call,'input',d,signal())).receipt.outcome).toBe('denied');
    d.permission=()=> 'allow';d.precondition=()=>false;expect((await gateway.execute(call,'input',d,signal())).receipt.outcome).toBe('failed');expect(run).not.toHaveBeenCalled();
  });
  it('keeps failure, provider outage and dispatch distinct from verified completion',async()=>{
    const gateway=new TypedCapabilityExecutor();
    expect((await gateway.execute(call,'input',definition(vi.fn(async()=>false)),signal())).receipt.outcome).toBe('failed');
    const outage=definition(vi.fn(async()=>{throw Error('Provider unavailable');}));
    expect((await gateway.execute({...call,id:'outage'},'input',outage,signal())).receipt.detail).toContain('Provider unavailable');
    const dispatched={...definition(),verify:()=> 'dispatched' as const};
    expect((await gateway.execute({...call,id:'queued'},'input',dispatched,signal())).receipt.outcome).toBe('dispatched');
  });
  it('does not persist private metadata when another request saves the shared journal',async()=>{
    const store=checkpoints(),gateway=new TypedCapabilityExecutor(store);let release!:(r:boolean)=>void;
    const privateWork=gateway.execute({...call,id:'private-secret',persist:false},'input',definition(vi.fn(()=>new Promise<boolean>(r=>release=r))),signal());
    await gateway.execute({...call,id:'ordinary'},'input',definition(),signal());
    expect(JSON.stringify([...store.saved])).not.toContain('private-secret');release(true);await privateWork;
  });
  it('aborts dependent work and never restores its revoked journal entry from a late result',async()=>{
    const store=checkpoints(),gateway=new TypedCapabilityExecutor(store);let release!:(r:boolean)=>void;
    const pending=gateway.execute(call,'input',definition(vi.fn(()=>new Promise<boolean>(r=>release=r))),signal());
    gateway.invalidate('chrome');release(true);expect((await pending).receipt.outcome).toBe('cancelled');
    expect(JSON.stringify([...store.saved])).not.toContain('chrome');
  });
  it('keeps error payloads out of the durable audit',async()=>{
    const store=checkpoints(),gateway=new TypedCapabilityExecutor(store);
    const r=await gateway.execute(call,'input',definition(vi.fn(async()=>{throw Error('sensitive fixture document');})),signal());
    expect(r.receipt.detail).toContain('sensitive fixture');expect(JSON.stringify([...store.saved])).not.toContain('sensitive fixture');
  });
  it('enforces policy inside the live registry adapter, including consequential computer use',async()=>{
    const settings=structuredClone(DEFAULT_SETTINGS),open=vi.fn(async()=>{}),computer=vi.fn(async()=>({ok:true,summary:'done',steps:1}));
    const ctx={settings:()=>settings,openExternal:open,useComputer:computer,now:Date.now} as unknown as ActionContext;
    const prepared=prepareAction({tool:'open_url',args:{url:'example.com'}},ctx,false);settings.actions.policies.open_url='deny';
    expect((await runAction({...prepared,policy:'allow'},ctx,true)).ok).toBe(false);expect(open).not.toHaveBeenCalled();
    settings.actions.policies.use_computer='allow';const pc=prepareAction({tool:'use_computer',args:{task:'Do the task'}},ctx,false);expect(pc.policy).toBe('confirm');
    expect((await runAction(pc,ctx,false)).receipt?.outcome).toBe('denied');expect(computer).not.toHaveBeenCalled();
    const result=await runAction(pc,ctx,true);expect(result.ok).toBe(false);expect(result.summary).toContain('unverified');
    expect(()=>prepareAction({tool:'__proto__'},ctx,false)).toThrow('Unknown tool');
  });
  it('fails closed instead of copying source-derived content into a legacy unpartitioned memory sink',async()=>{
    const settings=structuredClone(DEFAULT_SETTINGS),add=vi.fn();settings.actions.policies.remember='allow';
    const ctx={settings:()=>settings,memory:{add},now:Date.now} as unknown as ActionContext;
    const prepared=prepareAction({tool:'remember',args:{text:'A derived source claim'}},ctx,true);
    const result=await runAction(prepared,ctx,true,{dependencies:['chrome']});expect(result.ok).toBe(false);expect(result.summary).toContain('revocable attribution');expect(add).not.toHaveBeenCalled();
  });
});

const dirs:string[]=[];
afterEach(()=>{for(const dir of dirs.splice(0))fs.rmSync(dir,{recursive:true,force:true,maxRetries:3});});
function lifeFixture(){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'capri-world-migration-'));dirs.push(dir);const store=checkpoints();let at=1800000000000;
  const make=()=>new LifeContext(dir,()=>at,()=>{},()=>true,store);let life=make();
  const permissions={collect:true,live:true,proactive:true,retain:true,content:true,learn:false};
  life.configure({id:'academic',kind:'gradescope',name:'Fixture assignments',permissions,retentionDays:30});
  const event=(patch:Partial<LifeObservation>={}):LifeObservation=>({source:'academic',recordId:'hw7',revision:1,type:'academic-due',occurredAt:at,receivedAt:at,expiresAt:at+86400000,entities:[],quality:'observed',permissions,summary:'Homework 7 due',detail:JSON.stringify({course:'ME239',assignment:'Homework 7',status:'due',due:at+3600000}),operation:'upsert',importance:.8,...patch});
  return {dir,store,permissions,event,get life(){return life;},get at(){return at;},advance:(ms:number)=>{at+=ms;},restart:()=>{life.flush();life=make();return life;}};
}
describe('canonical world reconciliation in live Life Context',()=>{
  it('observes a deadline, asks once, records submission, and suppresses unchanged future reminders through restart',()=>{
    const f=lifeFixture();f.life.ingest(f.event());expect(f.life.world()[0].status).toBe('unknown');f.advance(21000);
    const candidate=f.life.candidate()!;expect(candidate).toBeDefined();f.life.offered(candidate.id);f.life.settle(candidate.id,'delivered','Asked about submission');
    f.life.userMessage('I submitted Homework 7.','user-answer',f.at);expect(f.life.userReports()[0].quality).toBe('user-statement');
    f.restart();f.advance(600001);f.life.maintain();expect(f.life.candidate()).toBeUndefined();
    f.life.ingest(f.event({revision:2}));expect(f.life.candidate()).toBeUndefined();
    expect(f.life.world().find(a=>a.asserted==='submitted')?.status).toBe('user-reported');
  });
  it('preserves conflicting independent sources and explicit correction history',()=>{
    const f=lifeFixture();f.life.ingest(f.event());f.life.userMessage('I submitted Homework 7.','answer',f.at);f.advance(1000);
    f.life.ingest(f.event({revision:2,type:'academic-not-submitted',detail:JSON.stringify({course:'ME239',assignment:'Homework 7',status:'not-submitted'})}));
    expect(f.life.world().filter(a=>a.predicate==='submission').every(a=>a.status==='conflicting')).toBe(true);
    expect(f.life.world().find(a=>a.asserted==='submitted')!.evidence.map(e=>e.source)).toContain('academic');
    f.advance(1000);f.life.userMessage("Actually I haven't submitted Homework 7.",'correction',f.at);
    expect(f.life.assertionHistory().some(a=>a.source==='user'&&a.asserted==='submitted'&&a.supersededBy)).toBe(true);
    expect(f.life.world().some(a=>a.asserted==='submitted')).toBe(false);
  });
  it('keeps the newest correction when two user statements share a timestamp',()=>{
    const f=lifeFixture();f.life.ingest(f.event());f.life.userMessage('I submitted Homework 7.','answer',f.at);
    f.life.userMessage("I haven't submitted Homework 7.",'correction',f.at);
    expect(f.life.world().some(a=>a.asserted==='not-submitted')).toBe(true);expect(f.life.world().some(a=>a.asserted==='submitted')).toBe(false);
  });
  it('reopens one deferred reminder after an explicit negative correction, without a recurring loop',()=>{
    const f=lifeFixture();f.life.ingest(f.event());f.advance(21000);const old=f.life.candidate()!;f.life.offered(old.id);f.life.settle(old.id,'delivered');
    f.life.userMessage('I submitted Homework 7.','answer',f.at);f.advance(1000);f.life.userMessage("Actually I haven't submitted Homework 7.",'correction',f.at);
    f.advance(300001);const reopened=f.life.candidate()!;expect(reopened).toBeDefined();expect(reopened.id).not.toBe(old.id);f.life.offered(reopened.id);f.life.settle(reopened.id,'delivered');
    f.restart();f.advance(600001);f.life.maintain();expect(f.life.candidate()).toBeUndefined();
  });
  it('retains a deferred communication across restart and separates delivery from acknowledgment',()=>{
    const f=lifeFixture();f.life.ingest(f.event({type:'request-claim',recordId:'message',summary:'Important fixture communication',detail:'Please review the research draft'}));f.advance(21000);
    f.life.deferAttention('User unavailable');expect(f.life.view().candidates[0].attempts).toBe(0);f.restart();
    const candidate=f.life.candidate()!;expect(candidate.status).toBe('deferred');f.life.offered(candidate.id);f.life.settle(candidate.id,'delivered','Delivered after availability returned');
    expect(f.life.view().candidates[0].acknowledgedAt).toBeUndefined();f.life.acknowledge(candidate.id);f.restart();expect(f.life.candidate()).toBeUndefined();expect(f.life.view().candidates[0].phase).toBe('resolved');
  });
  it('associates project files without inventing progress or geometric analysis',()=>{
    const f=lifeFixture();f.life.associate({id:'research',name:'Research',aliases:['Research'],evidence:'User configured project'});
    f.life.ingest(f.event({type:'file-changed',recordId:'cad',summary:'Research bracket-final.step'}));
    const fact=f.life.world()[0];expect(fact.entities).toContain('research');expect(fact.predicate).toBe('association');expect(fact.value).toContain('Geometry and success unknown');
  });
  it('carries derived report dependencies into model context and removes them through revocation and restart',()=>{
    const f=lifeFixture();f.life.ingest(f.event());f.life.userMessage('I submitted Homework 7.','answer',f.at);const assembler=new ContextAssembler(f.life);
    expect(assembler.assemble('Homework 7')).toContain('User-reported');expect(assembler.suppliedSources).toContain('academic');
    f.life.forget('academic');f.restart();expect(f.life.world()).toEqual([]);expect(f.life.assertionHistory()).toEqual([]);expect(new ContextAssembler(f.life).assemble('Homework 7')).not.toContain('Homework 7');
    expect(f.life.ingest(f.event({revision:99}))).toBe(false);
  });
  it('retains dependency attribution even if a final prompt budget truncates the assertion metadata',()=>{
    const f=lifeFixture();f.life.ingest(f.event());f.life.userMessage('I submitted Homework 7.','answer',f.at);const assembler=new ContextAssembler(f.life);
    assembler.assemble('Homework 7',{},100);expect(assembler.suppliedSources).toContain('academic');
  });
  it('does not persist an event or its world assertion when event-level retention is denied',()=>{
    const f=lifeFixture();f.life.ingest(f.event({permissions:{...f.permissions,retain:false}}));expect(f.life.world()).toHaveLength(1);
    f.life.userMessage('I submitted Homework 7.','answer',f.at);f.restart();expect(f.life.world()).toEqual([]);expect(f.life.userReports()).toEqual([]);
  });
  it('scrubs dependent reports and assertions from the legacy import path on revocation',()=>{
    const f=lifeFixture();f.life.ingest(f.event());f.life.userMessage('I submitted Homework 7.','answer',f.at);
    fs.writeFileSync(path.join(f.dir,'life-context.json'),JSON.stringify(f.store.load('life-context')));f.life.forget('academic');
    const legacy=JSON.parse(fs.readFileSync(path.join(f.dir,'life-context.json'),'utf8'));expect(legacy.reports).toEqual([]);expect(legacy.assertions).toEqual([]);
  });
  it('imports old evidence once and never resurrects a deleted record',()=>{
    const f=lifeFixture();f.life.ingest(f.event());const saved=f.store.load<any>('life-context');delete saved.assertions;f.store.save('life-context',saved);
    const imported=new LifeContext(f.dir,()=>f.at,()=>{},()=>true,f.store);expect(imported.world()).toHaveLength(1);
    imported.ingest(f.event({revision:2,operation:'delete'}));imported.flush();const restarted=new LifeContext(f.dir,()=>f.at,()=>{},()=>true,f.store);expect(restarted.world()).toEqual([]);expect(restarted.assertionHistory()).toEqual([]);
  });
  it('applies a named project correction immediately while retaining relationship developments',()=>{
    const f=lifeFixture(),relationship=new RelationshipStore(f.dir,()=>true,()=>true,()=>f.at);
    const thread=relationship.setThread({title:'Research',summary:'An ongoing project',status:'active'});f.advance(1000);
    expect(relationship.reconcileUserStatus({role:'user',messageId:'quote',evidence:'The page says Research is done.',at:f.at})).toEqual([]);
    const changed=relationship.reconcileUserStatus({role:'user',messageId:'correction',evidence:'Research is done.',at:f.at});expect(changed).toHaveLength(1);
    f.life.projectStatement(changed[0],'Research is done.','correction',f.at);f.restart();
    expect(f.life.world()[0]).toMatchObject({entity:'project:'+thread.id,status:'user-reported',asserted:'done'});expect(relationship.snapshot().threads[0].developments).toHaveLength(2);
  });
});
