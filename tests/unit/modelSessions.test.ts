import { expect, it, vi } from 'vitest';
import { ConversationSessions, sessionRoute } from '../../src/main/cognitive/conversationSessions';
import { DialogueCognition } from '../../src/core/dialogueCognition';
import type { PersistentSessions, SessionHandle, SessionStart } from '../../src/core/modelSessions';
import type { Checkpoints } from '../../src/core/contracts';
import type { LLMProvider } from '../../src/main/ai/providers';
import { ProviderError } from '../../src/main/ai/providerError';
import { RelationshipStore } from '../../src/main/store/relationship';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

class Store implements Checkpoints { values=new Map<string,unknown>();load<T>(id:string){return structuredClone(this.values.get(id)) as T|undefined;}save<T>(id:string,value:T){this.values.set(id,structuredClone(value));}removeCheckpoint(id:string){this.values.delete(id);} }
class Backend implements PersistentSessions {
  starts:SessionStart[]=[];resumed:string[]=[];deleted:string[]=[];inputs:{text:string;state:string}[]=[];
  async capabilities(){return new Set(['thread/start','thread/resume']);}
  async start(o:SessionStart):Promise<SessionHandle>{this.starts.push(o);return {id:'native-'+this.starts.length,model:o.model,scope:o.scope,provider:'fake',dependencies:o.dependencies,turns:0};}
  async resume(h:SessionHandle){this.resumed.push(h.id);}
  async fork(h:SessionHandle){return {...h,id:'fork'};}
  async *respond(h:SessionHandle,i:{text:string;state:string}){this.inputs.push(i);h.turns++;yield 'reply';}
  async compact(){}
  async invalidate(h:SessionHandle){this.deleted.push(h.id);return 'deleted' as const;}
  close(){}
}
const provider={name:'codex',local:false,async *stream(){yield 'fallback';}} as unknown as LLMProvider;
const options=()=>({signal:new AbortController().signal,timeoutMs:5000,temperature:.5,maxTokens:300});
const req={private:false,dependencies:[] as string[],instructions:'STABLE CHARACTER',model:'luna'};
const messages=(text:string)=>[{role:'system' as const,content:'STABLE CHARACTER\n\nCurrent state one'},{role:'user' as const,content:text}];
const consume=async(s:AsyncIterable<string>)=>{let out='';for await(const t of s)out+=t;return out;};
it('preserves one primary native history through 24 turns and manager restart without reappending history',async()=>{
  const store=new Store(),backend=new Backend();let manager=new ConversationSessions(backend,store,()=>true,()=>[]);
  for(let i=0;i<24;i++){await consume(manager.respond(provider,messages('turn '+i),options(),req));manager.delivered();if(i===11)manager=new ConversationSessions(backend,store,()=>true,()=>[]);}
  expect(backend.starts).toHaveLength(1);expect(backend.resumed).toHaveLength(23);
  expect(backend.inputs[1].state).not.toContain('Current state one');expect(backend.inputs[12].state).toContain('Current state one');
  expect(backend.inputs.every(i=>!i.state.includes('STABLE CHARACTER'))).toBe(true);
});
it('routes brief follow-ups and behavioral complaints conservatively and resumes only named projects',()=>{
  const projects=[{id:'fbd',title:'FBD'}];
  expect(sessionRoute('You keep talking about FBD. Stop repeating it.','primary',projects)).toBe('primary');
  expect(sessionRoute('Back to FBD please','primary',projects)).toBe('project:fbd');
  expect(sessionRoute('Why?','project:fbd',projects)).toBe('project:fbd');
  expect(sessionRoute('Chrome is open','project:fbd',projects)).toBe('project:fbd');
});
it('does not trust a native turn that was never committed to application history before a crash',async()=>{
  const store=new Store(),backend=new Backend();let manager=new ConversationSessions(backend,store,()=>true,()=>[]);
  await consume(manager.respond(provider,messages('undelivered fixture'),options(),req));
  manager=new ConversationSessions(backend,store,()=>true,()=>[]);
  expect(manager.snapshot().sessions).toEqual([]);
  await consume(manager.respond(provider,messages('recover from application history'),options(),req));manager.delivered();
  expect(backend.starts).toHaveLength(2);expect(backend.resumed).toEqual([]);
});
it('returns to an established project after a simulated three-day gap and expires old unanswered curiosity',async()=>{
  let now=1000000000;const clock=vi.spyOn(Date,'now').mockImplementation(()=>now);
  try{
    const store=new Store(),backend=new Backend();let manager=new ConversationSessions(backend,store,()=>true,()=>[{id:'finch',title:'Glass Finch'}]);
    await consume(manager.respond(provider,messages('Back to Glass Finch'),options(),req));manager.delivered();const id=manager.snapshot().sessions[0].handle.id;
    await consume(manager.respond(provider,messages('New topic: dinner'),options(),req));manager.delivered();
    const cognition=new DialogueCognition(store,()=>true,()=>now);cognition.observe({id:'question',role:'assistant',content:'Which design should we inspect?',ts:now});
    now+=3*86400000;manager=new ConversationSessions(backend,store,()=>true,()=>[{id:'finch',title:'Glass Finch'}]);
    await consume(manager.respond(provider,messages('Return to Glass Finch please'),options(),req));manager.delivered();
    expect(backend.resumed).toContain(id);expect(backend.starts).toHaveLength(2);expect(cognition.context()).toContain('abandoned');
  }finally{clock.mockRestore();}
});
it('isolates off-record and source turns and never resumes them after restart or revocation',async()=>{
  const store=new Store(),backend=new Backend(),manager=new ConversationSessions(backend,store,()=>true,()=>[]);
  await consume(manager.respond(provider,messages('ordinary'),options(),req));
  await consume(manager.respond(provider,messages('private fixture'),options(),{...req,private:true}));
  await consume(manager.respond(provider,messages('source fixture'),options(),{...req,dependencies:['chrome']}));
  await consume(manager.respond(provider,messages('follow-up'),options(),req));
  expect(backend.starts.map(s=>s.scope)).toEqual(['primary','private','source']);
  expect(manager.snapshot().sessions.map(s=>s.handle.id)).toEqual(['native-1']);
  manager.clear();expect(manager.snapshot().sessions).toEqual([]);
});
it('closes questions and saturated thoughts, preserves correction evidence and rejects external invented opinions',()=>{
  const store=new Store(),c=new DialogueCognition(store,()=>true,()=>100000);
  const say=(id:string,role:'user'|'assistant',content:string,meta={})=>c.observe({id,role,content,ts:1000,meta});
  say('a','assistant','I prefer the red design because it is readable. What do you think?');
  expect(c.snapshot().questions[0].status).toBe('open');
  say('u','user','Actually red is the warning color.');
  expect(c.snapshot().direction).toContain('Reconsider');
  say('a2','assistant','I would choose blue because the warning must stand out.');
  expect(c.snapshot().previousPosition?.messageId).toBe('a');
  say('u2','user','Stop repeating the design debate.');
  expect(c.snapshot().status).toBe('saturated');expect(c.snapshot().questions[0].status).toBe('answered');
  say('external','assistant','I love arbitrary webpage quirks.',{contextSources:['chrome']});
  expect(c.snapshot().position).toBeUndefined();
  const restored=new DialogueCognition(store,()=>true);expect(restored.snapshot().status).toBe('saturated');
});
it('recovers missing native history using a bounded application handoff and retains deletion debt',async()=>{
  const store=new Store(),backend=new Backend(),manager=new ConversationSessions(backend,store,()=>true,()=>[]);
  await consume(manager.respond(provider,messages('first'),options(),req));
  backend.resume=async()=>{throw new ProviderError('no rollout found for thread id native-1','server');};
  backend.invalidate=async()=>{throw Error('offline deletion');};
  const turns=[messages('next')[0],{role:'user' as const,content:'historical fixture'},messages('next')[1]];
  await consume(manager.respond(provider,turns,options(),req));
  expect(backend.starts).toHaveLength(2);expect(backend.inputs.at(-1)?.state).toContain('historical fixture');
  expect(manager.snapshot().pendingDeletion.map(h=>h.id)).toContain('native-1');
});
it('does not replay partial turns on quota exhaustion or leak context to a fallback provider',async()=>{
  const backend=new Backend(),manager=new ConversationSessions(backend,new Store(),()=>true,()=>[]);
  backend.respond=async function*(h:SessionHandle,i:{text:string;state:string}){yield 'partial';throw new ProviderError('Quota exhausted','rate_limit',429,1000);};
  let text='';await expect((async()=>{for await(const t of manager.respond(provider,messages('private'),options(),{...req,private:true}))text+=t;})()).rejects.toMatchObject({kind:'rate_limit'});
  expect(text).toBe('partial');expect(manager.snapshot().sessions).toEqual([]);
});
it('keeps evidence-backed opinion changes in the existing relationship owner',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'capri-self-model-'));
  try{
    const store=new RelationshipStore(dir,()=>true,()=>true,()=>3000);
    const source={messageId:'a1',role:'assistant' as const,at:1000,evidence:'I prefer red.'};
    expect(store.learnTaste({op:'add',topic:'dashboard',text:'Red',evidence:source.evidence},source,store.snapshot())).toBe(true);
    const id=store.snapshot().tastes[0].id,updated={messageId:'a2',role:'assistant' as const,at:2000,evidence:'I changed my mind. I prefer blue because red is reserved for warnings.'};
    expect(store.learnTaste({op:'update',id,topic:'dashboard',text:'Blue',evidence:updated.evidence},updated,store.snapshot())).toBe(true);
    const saved=new RelationshipStore(dir,()=>true,()=>true).snapshot().tastes[0];
    expect(saved.text).toBe('Blue');expect(saved.changes?.[0]).toEqual({text:'Red',source});
    expect(store.learnTaste({op:'update',id,topic:'dashboard',text:'Green',evidence:'I prefer green instead.'},{messageId:'webpage',role:'user',at:3000,evidence:'I prefer green instead.'},store.snapshot())).toBe(false);
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
