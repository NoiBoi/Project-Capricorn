import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {afterEach,expect,it,vi} from 'vitest';
import {archiveWorkerPath} from '../helpers/runtime2Archive';
import {WindowFocusArchive} from '../../src/main/runtime2/windowFocusArchive';
import {CognitiveLoop,recoverableAmbientFailure} from '../../src/main/runtime2/cognitiveLoop';
import {TypedCapabilityExecutor} from '../../src/core/capabilities';
import {interactionObservation} from '../../src/main/runtime2/interactionContext';
import {encodeInput} from '../../src/main/runtime2/context';
import {MicRecorder} from '../../src/renderer/character/audio';
import type {CognitiveProvider,ModelInput} from '../../src/main/runtime2/cognitiveContracts';
import type {DesktopHost} from '../../src/main/runtime2/perception';
const cleanups:(()=>unknown)[]=[];
afterEach(async()=>{for(const f of cleanups.splice(0).reverse())await f();vi.restoreAllMocks();vi.unstubAllGlobals();});
async function fixture(infer:CognitiveProvider['infer']) {
  const clock={now:Date.now()};vi.spyOn(Date,'now').mockImplementation(()=>clock.now);
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'capri-interaction-'));cleanups.push(()=>fs.rmSync(root,{recursive:true,force:true}));
  const archive=new WindowFocusArchive(path.join(root,'Capri Buddy 2.0 Synthetic','interaction'),{workerPath:archiveWorkerPath});await archive.initialize();cleanups.push(()=>archive.close());
  const host:DesktopHost={windows:()=>[],active:()=>null,allowed:()=>true,body:()=>({}),capture:async()=>undefined,move:async()=>({ok:true,detail:'fixture'})};
  const inputs:ModelInput[]=[];
  const loop=new CognitiveLoop(archive,{models:async()=>[{id:'fixture',label:'Fixture',contextTokens:128000}],shutdown(){},infer:async(...args)=>{inputs.push(args[1]);return infer(...args);}},new TypedCapabilityExecutor(),{host,model:'fixture',ambientMs:10000});
  await loop.initialize();clearInterval((loop as any).timer);cleanups.push(()=>loop.shutdown());
  async function idle(){await expect.poll(()=>loop.state.busy).toBe(false);}
  async function event(source='new-source'){loop.notifyObservation(true,'screen',source);clock.now+=40000;(loop as any).tick();await idle();}
  return {archive,loop,host,inputs,clock,event,idle};
}
it('routes typed and voice records through the same input, preserving only appropriate voice metadata',async()=>{
  const f=await fixture(async()=>({text:'',calls:[]}));
  await f.loop.send('The same question');await f.idle();await f.loop.send('The same question',{viaVoice:true});await f.idle();
  const users=(await f.archive.conversation(10,true)).records.filter(r=>r.kind==='user');
  expect(users.map(r=>'text' in r?r.text:'')).toEqual(['The same question','The same question']);
  expect(users[0]).not.toHaveProperty('viaVoice');expect(users[1]).toHaveProperty('viaVoice',true);
  expect(JSON.stringify(encodeInput(f.inputs[1]))).toContain('viaVoice');
  expect((await f.loop.history()).filter(r=>r.role==='user').map(r=>r.meta?.viaVoice)).toEqual([undefined,true]);
});
it('supplies accurate host contact to direct cognition without fabricated dialogue or memory writes',async()=>{
  const f=await fixture(async()=>({text:'',calls:[]}));
  const event=interactionObservation({kind:'contact',startedAt:f.clock.now-900,endedAt:f.clock.now,pats:4,pokes:1},undefined,f.clock.now);
  await f.loop.perception!.observe(event);await f.loop.send('Continue the valve discussion');await f.idle();
  expect(f.inputs[0].records.find(r=>r.kind==='observation')).toMatchObject({evidenceContext:'historical',observation:{modality:'user-interaction',provenance:{authority:'host'},content:{interaction:{kind:'contact',pats:4,pokes:1}}}});
  expect((await f.archive.conversation(10,true)).records.map(r=>r.kind)).toEqual(['user']);expect(await f.archive.findState()).toEqual([]);
});
it('withholds contact when disclosure is revoked before direct context assembly',async()=>{
  const f=await fixture(async()=>({text:'',calls:[]}));await f.loop.perception!.observe(interactionObservation({kind:'contact',startedAt:f.clock.now,endedAt:f.clock.now,pats:1,pokes:0}));
  f.host.allowed=(_op,o)=>!o;await f.loop.send('Question');await f.idle();
  expect(f.inputs[0].records.some(r=>r.kind==='observation')).toBe(false);
});
it('supplies new contact arriving during direct work on the next continuation without retiring the ongoing interest',async()=>{
  let n=0;const f=await fixture(async()=>{
    if(++n===1){await f.loop.perception!.observe(interactionObservation({kind:'contact',startedAt:f.clock.now,endedAt:f.clock.now,pats:3,pokes:0}));return {text:'',calls:[{id:'attend',name:'set_attention',arguments:JSON.stringify({action:'cancel'})}]};}
    return {text:'',calls:[]};
  });
  await f.archive.putState({id:'taste',kind:'interest',text:'The valve layout remains dubious.',provenance:'model-interpretation',evidence:[],status:'active',dueAt:null,expectedRevision:0});await f.loop.refreshState();
  await f.loop.send('Consider the valve');await f.idle();
  expect(f.inputs).toHaveLength(2);expect(JSON.stringify(f.inputs[1])).toContain('Actual user contact');expect((await f.archive.findState({kind:'interest'})).map(s=>s.id)).toEqual(['taste']);
});
it('requires a new eligible observation after a recoverable ambient failure and then resumes through the existing admission',async()=>{
  let n=0;const f=await fixture(async()=>{if(++n===1)throw Object.assign(Error('Temporary connection failure'),{status:503});return {text:'',calls:[]};});
  await f.event('first');expect(f.loop.state.phase).toBe('error');
  f.clock.now+=100000;(f.loop as any).tick();await f.idle();expect(f.inputs).toHaveLength(1);
  await f.event('later');expect(f.inputs).toHaveLength(2);expect(f.loop.state.phase).toBe('idle');
});
it('recovers a context assembly failure after capacity is corrected and a new event arrives',async()=>{
  const f=await fixture(async()=>({text:'',calls:[]}));(f.loop as any).options.contextBudget=100;await f.event();
  expect(f.loop.state.phase).toBe('error');expect(f.inputs).toHaveLength(0);
  (f.loop as any).options.contextBudget=100000;await f.event('later');expect(f.inputs).toHaveLength(1);expect(f.loop.state.phase).toBe('idle');
});
it('keeps ambient disclosure controls effective while retaining an eligible event for later admission',async()=>{
  const f=await fixture(async()=>({text:'',calls:[]}));f.host.allowed=(operation,o,mode)=>!(operation==='disclose'&&!o&&mode==='ambient');await f.event();expect(f.inputs).toHaveLength(0);
  f.host.allowed=()=>true;f.clock.now+=40000;(f.loop as any).tick();await f.idle();expect(f.inputs).toHaveLength(1);
});
it.each([Object.assign(Error('Budget exhausted'),{code:'session_request_limit'}),Object.assign(Error('Plan limit reached'),{code:'subscription_sharing_usage_limit_exceeded',status:429}),Object.assign(Error('No permission'),{status:403}),Error('Cloud disclosure is currently paused')])('keeps budget and permission failures paused after later observations',async error=>{
  const f=await fixture(async()=>{throw error;});await f.event();await f.event('later');expect(f.inputs).toHaveLength(1);
});
it('preserves an explicit stop during in-flight work after cancellation and later events',async()=>{
  let began=false;const f=await fixture(async(_m,_i,signal)=>{began=true;await new Promise<void>((_yes,no)=>signal.addEventListener('abort',()=>no(Error('cancelled')),{once:true}));return {text:'',calls:[]};});
  const pending=f.event();await expect.poll(()=>began).toBe(true);f.loop.stop();await pending;await f.event('later');expect(f.inputs).toHaveLength(1);expect(f.loop.state.phase).toBe('idle');
});
it('does not bypass an explicit attention pause or a watch-only source constraint for contact',async()=>{
  const f=await fixture(async()=>({text:'',calls:[]}));f.loop.attention.adjust({action:'pause'});
  await f.loop.perception!.observe(interactionObservation({kind:'contact',startedAt:f.clock.now,endedAt:f.clock.now,pats:2,pokes:0}));f.clock.now+=40000;(f.loop as any).tick();await f.idle();expect(f.inputs).toHaveLength(0);
  f.loop.attention.adjust({source:'chrome',sourceIdentity:'watched',ambient:'watch-only',durationMs:600000,inferenceIntervalMs:10000,observationIntervalMs:1000});await f.event('user-interaction:contact');expect(f.inputs).toHaveLength(0);
});
it('rejects unbounded contact counts and intervals, and records placement as user-originated facts',()=>{
  expect(()=>interactionObservation({kind:'contact',startedAt:1,endedAt:2,pats:101,pokes:0})).toThrow();
  expect(()=>interactionObservation({kind:'contact',startedAt:1,endedAt:20000,pats:1,pokes:0})).toThrow();
  const o=interactionObservation({kind:'placement',fromHandle:'17',movedAside:true,surface:'window',interrupted:true},{handle:'42',title:'Valve design'});
  expect(o).toMatchObject({modality:'user-interaction',content:{handle:'42',interaction:{kind:'placement',interrupted:true}},provenance:{metadata:{origin:'user'}}});
});
it('releases a microphone stream that arrives after recording cancellation without opening audio processing',async()=>{
  let release!:(s:any)=>void;const stop=vi.fn();vi.stubGlobal('navigator',{mediaDevices:{getUserMedia:()=>new Promise(r=>release=r)}});
  const mic=new MicRecorder(),pending=mic.start(false,()=>{});await mic.stop(true);release({getTracks:()=>[{stop}]});await pending;
  expect(stop).toHaveBeenCalledOnce();expect(mic.active).toBe(false);
});
it('classifies context capacity failures as recoverable events, while retaining hard control failures',()=>{
  expect(recoverableAmbientFailure(Error('Context budget cannot hold pinned identity and tools.'))).toBe(true);
  expect(recoverableAmbientFailure(Error('Tool round limit reached.'))).toBe(false);
  expect(recoverableAmbientFailure(Object.assign(Error('missing credentials'),{status:401}))).toBe(false);
});
