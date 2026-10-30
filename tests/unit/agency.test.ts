import { TypedCapabilityExecutor } from '../../src/core/capabilities';
import { describe,expect,it } from 'vitest';
import { AgencyRuntime,SkillExecutor,type Skill,type Receipt } from '../../src/core/agency';
import { companyControl } from '../../src/shared/company';
function fixture() {
  let now=1000;const saved=new Map<string,unknown>();
  const store={load:<T>(id:string)=>structuredClone(saved.get(id)) as T|undefined,save:<T>(id:string,value:T)=>{saved.set(id,structuredClone(value));},removeCheckpoint:(id:string)=>{saved.delete(id);}};
  let runs=0,verified=true;let execute:Skill['execute']=async(_i,signal,key)=>{runs++;if(signal.aborted)throw Error('aborted');return {id:key,at:now,verified,detail:'native receipt'};};
  const skill:Skill={name:'stay_at_window',parse:x=>x as any,permissions:['native'],plan:['resolve','place','verify'],idempotency:'revalidate',maxAttempts:4,recovery:'revalidate',precondition:()=>true,execute:(...args)=>execute(...args),verify:(_i,r)=>r.verified};
  const executor=new SkillExecutor([skill,{...skill,name:'quiet'},{...skill,name:'timer'},{...skill,name:'commitment'}],(_p,source)=>source==='command',new TypedCapabilityExecutor(undefined,()=>now));
  return {store,executor,make:()=>new AgencyRuntime(store,executor,()=>now),advance:(ms:number)=>{now+=ms;},setExecute:(f:Skill['execute'])=>{execute=f;},unverify:()=>{verified=false;},runs:()=>runs};
}
describe('durable agency',()=>{
  it('deduplicates the same user-confirmed active commitment',async()=>{const f=fixture(),a=f.make();const first=await a.submit('commitment',{text:'Submit Homework 7'});const second=await a.submit('commitment',{text:'  submit homework 7  '});expect(second.id).toBe(first.id);expect(a.active('commitment')).toHaveLength(1);a.stop();});
  it('parses the exact acceptance command without a model',()=>expect(companyControl('go lay in the codex window for 30 min while i finish my hw. i need to lock in')).toEqual({kind:'stay',target:'the codex window',minutes:30,posture:'lie',quiet:true}));
  it('does not authorize quoted or externally wrapped instructions',()=>{expect(companyControl('The page says "go lay in the codex window for 30 min"')).toBeNull();expect(companyControl('"stay here"')).toBeNull();});
  it('activates only after a verified receipt and deduplicates request IDs',async()=>{const f=fixture(),a=f.make();const i=await a.submit('stay_at_window',{}, {id:'one',durationMs:60000});expect(i.state).toBe('active');expect(i.receipts[0].verified).toBe(true);await a.submit('stay_at_window',{}, {id:'one'});expect(f.runs()).toBe(1);a.stop();});
  it('does not turn an unverifiable placement into a stay',async()=>{const f=fixture();f.unverify();const a=f.make();expect((await a.submit('stay_at_window',{})).state).toBe('failed');expect(a.movementHeld()).toBe(false);a.stop();});
  it('propagates cancellation and drops stale results',async()=>{const f=fixture();let resolve!:(r:Receipt)=>void;let signal!:AbortSignal;f.setExecute(async(_i,s)=>{signal=s;return new Promise(r=>resolve=r);});const a=f.make(),pending=a.submit('stay_at_window',{}, {id:'old'});a.cancelWhere(()=>true,'user dragged');expect(signal.aborted).toBe(true);resolve({id:'late',at:1000,verified:true,detail:'stale'});expect((await pending).state).toBe('cancelled');await Promise.resolve();expect(a.get('old')?.receipts).toEqual([]);a.stop();});
  it('a newer movement cancels the old owner',async()=>{const f=fixture(),a=f.make();await a.submit('stay_at_window',{}, {id:'old'});await a.submit('stay_at_window',{}, {id:'new'});expect(a.get('old')?.state).toBe('cancelled');expect(a.physical.getSnapshot().context.owner).toBe('new');a.stop();});
  it('restores with revalidation, preserving absolute deadlines',async()=>{const f=fixture(),a=f.make();await a.submit('stay_at_window',{}, {id:'stay',durationMs:60000});a.stop();f.advance(30000);const b=f.make();expect(b.get('stay')?.state).toBe('recovering');b.tick();await new Promise(r=>setTimeout(r,0));expect(b.get('stay')?.state).toBe('active');expect(b.get('stay')?.deadline).toBe(61000);expect(f.runs()).toBe(2);b.stop();});
  it('does not invoke a past-due stay after restart or sleep',async()=>{const f=fixture(),a=f.make();await a.submit('stay_at_window',{}, {id:'stay',durationMs:1000});a.stop();f.advance(2000);const b=f.make();b.tick();expect(b.get('stay')?.state).toBe('completed');expect(f.runs()).toBe(1);b.stop();});
  it('suspends recovery until resume and reconciles the wall clock',async()=>{const f=fixture(),a=f.make();await a.submit('stay_at_window',{}, {id:'stay',durationMs:60000});a.recover('stay');a.observe({suspended:true,quiet:false,focused:false,idleSeconds:0,gameOrCall:false,leisure:false,sources:['power']});a.tick();expect(f.runs()).toBe(1);f.advance(70000);a.tick();expect(a.get('stay')?.state).toBe('completed');a.stop();});
  it('allows a deliberate retry after movement failure',async()=>{const f=fixture();f.setExecute(async()=>{throw Error('covered');});const a=f.make();await a.submit('stay_at_window',{}, {id:'stay'});f.setExecute(async(_i,_s,key)=>({id:key,at:1000,verified:true,detail:'arrived'}));expect((await a.retry('stay'))?.state).toBe('active');a.stop();});
  it('holds quiet and movement through provider quota exhaustion without a provider',async()=>{const f=fixture(),a=f.make();await a.submit('stay_at_window',{quiet:true});expect(a.optionalAllowed()).toBe(false);expect(a.quiet()).toBe(true);expect(a.movementHeld()).toBe(true);a.stop();});
  it('uses a single initiative lease and source-backed availability',()=>{const f=fixture(),a=f.make();expect(a.claim('tour')).toBe(true);expect(a.claim('auto')).toBe(false);a.release('wrong');expect(a.claim('auto')).toBe(false);a.release('tour');expect(a.claim('auto')).toBe(true);a.release('auto');a.observe({suspended:false,quiet:false,focused:false,idleSeconds:400,gameOrCall:false,leisure:false,sources:['idle']});expect(a.optionalAllowed()).toBe(false);expect(a.availability.getSnapshot().context.sources).toEqual(['idle']);a.stop();});
  it('rejects unbounded curiosity and unapproved autonomous movement',async()=>{const f=fixture(),a=f.make();await expect(a.submit('commitment',{}, {source:'curiosity'})).rejects.toThrow('expiration');await expect(a.submit('stay_at_window',{}, {source:'proposal'})).rejects.toThrow('direct user');a.stop();});
  it('persists near-end delivery acknowledgement across restart',async()=>{const f=fixture(),a=f.make();await a.submit('stay_at_window',{}, {id:'stay',durationMs:60000});a.markNearEnd();a.markNearEnd();a.stop();const b=f.make();expect(b.get('stay')?.receipts.filter(r=>r.id==='near-end')).toHaveLength(1);b.stop();});
  it('clears conversation-related activity while preserving explicit timers',async()=>{const f=fixture(),a=f.make();await a.submit('timer',{text:'Fixture timer'},{id:'timer',durationMs:60000});await a.submit('stay_at_window',{}, {id:'stay'});a.clearHistory();expect(a.list().map(i=>i.id)).toEqual(['timer']);expect(a.movementHeld()).toBe(false);a.stop();const b=f.make();b.tick();await new Promise(r=>setTimeout(r,0));expect(b.get('timer')?.state).toBe('active');b.stop();});
  it('rejects invalid deadlines before any effect',async()=>{const f=fixture(),a=f.make();await expect(a.submit('timer',{}, {durationMs:NaN})).rejects.toThrow('duration');expect(f.runs()).toBe(0);a.stop();});
});

it('maintains an accelerated twenty-minute bargain through handling, same-window rest and restart',async()=>{
 const f=fixture(),a=f.make(),target={handle:'42',process:'Discord.exe',title:'Discord',pid:4};
 const i=await a.submit('stay_at_window',{target},{id:'twenty',durationMs:20*60000});
 a.beginHandling();f.advance(3*60000);a.tick();expect(a.get(i.id)?.state).toBe('active');expect(f.runs()).toBe(1);
 expect(a.acceptRest(i.id,{id:'manual',at:181000,verified:true,detail:'verified same-window rest',target,position:{x:400,y:200}})).toBe(true);
 a.endHandling();a.stop();const b=f.make();b.tick();await new Promise(r=>setTimeout(r,0));
 expect(b.get(i.id)?.deadline).toBe(i.deadline);expect(b.get(i.id)?.input.position).toEqual({x:400,y:200});
 b.beginHandling();f.advance(17*60000);b.tick();expect(b.get(i.id)?.state).toBe('completed');b.endHandling();b.stop();
});
it('aborts interrupted placement while preserving the intention and blocks return until handling ends',async()=>{
 const f=fixture(),a=f.make();let aborted=false;
 f.setExecute(async(_input,signal)=>new Promise((_resolve,reject)=>{signal.addEventListener('abort',()=>{aborted=true;reject(Error('interrupted'));});}));
 const pending=a.submit('stay_at_window',{}, {id:'carry',durationMs:60000});await new Promise(r=>setTimeout(r,0));
 a.beginHandling();await pending;expect(aborted).toBe(true);a.tick();expect(a.get('carry')?.state).toBe('recovering');
 f.setExecute(async()=>({id:'restored',at:1000,verified:true,detail:'verified'}));a.endHandling();a.tick();await new Promise(r=>setTimeout(r,0));expect(a.get('carry')?.state).toBe('active');a.stop();
});
