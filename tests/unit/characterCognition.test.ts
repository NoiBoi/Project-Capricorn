import {expect,it} from 'vitest';
import {DialogueCognition} from '../../src/core/dialogueCognition';
import {CognitiveRuntime} from '../../src/core/cognitiveRuntime';
import {PerformanceDirector} from '../../src/core/performance';
import {MemoryLearning} from '../../src/main/ai/memoryLearning';
import {MemoryStore} from '../../src/main/store/dataStores';
import {DEFAULT_SETTINGS} from '../../src/shared/settings';
import {nullLogger} from '../../src/main/log';
import {tmpDir} from './helpers';

function fixture(){
  let now=1000,retain=true;const values=new Map<string,unknown>();
  const store={load:<T>(k:string)=>structuredClone(values.get(k)) as T|undefined,save:<T>(k:string,v:T)=>{values.set(k,structuredClone(v));},removeCheckpoint:(k:string)=>{values.delete(k);}};
  const c=new DialogueCognition(store,()=>retain,()=>now);
  const say=(role:'user'|'assistant',id:string,content:string)=>{now++;c.observe({id,role,content,ts:now});};
  say('user','u','Pick a dashboard color and explain why.');say('assistant','a','Violet. Red belongs on the warnings, because those need to stand out.');
  const change={topic:'dashboard color',kind:'position',status:'active',evidence:{sourceId:'a',quote:'Violet.'},reason:{sourceId:'a',quote:'Red belongs on the warnings, because those need to stand out.'}};
  return {c,store,say,change,get now(){return now;},disable(){retain=false;}};
}
it('interprets a meaningful non-regex position with its delivered reason and survives restart',()=>{
  const f=fixture(),request=f.c.interpretationRequest()!;expect(request).toBeTruthy();
  expect(f.c.snapshot().position).toBeUndefined();expect(f.c.applyInterpretation([f.change],request)).toBe(true);
  const restored=new DialogueCognition(f.store,()=>true,()=>f.now);expect(restored.snapshot().thoughts?.[0].reason?.text).toContain('stand out');expect(restored.snapshot().position?.text).toBe('Violet.');expect(restored.interpretationRequest()).toBeUndefined();
});
it.each(['invented quote','user authorship','invented reason','unknown source'])('rejects unsupported cognitive updates: %s',mode=>{
  const f=fixture(),c=structuredClone(f.change);
  if(mode==='invented quote')c.evidence.quote='I have always loved violet.';
  if(mode==='user authorship')c.evidence={sourceId:'u',quote:'Pick a dashboard color'};
  if(mode==='invented reason')c.reason.quote='It reminds me of our childhood.';
  if(mode==='unknown source')c.evidence.sourceId='not-delivered';
  expect(f.c.applyInterpretation([c],f.c.interpretationRequest()!)).toBe(false);expect(f.c.snapshot().thoughts??[]).toEqual([]);
});
it('keeps a changed view and its previous attributed position without adding personal memory',()=>{
  const f=fixture();f.c.applyInterpretation([f.change],f.c.interpretationRequest()!);
  f.say('user','u2','Actually the alerts also use violet. Reconsider.');f.say('assistant','a2','Blue, then. Violet would hide those alerts.');
  f.c.applyInterpretation([{...f.change,status:'revised',evidence:{sourceId:'a2',quote:'Blue, then.'},reason:{sourceId:'a2',quote:'Violet would hide those alerts.'}}],f.c.interpretationRequest()!);
  const t=f.c.snapshot().thoughts![0];expect(t.previous?.text).toBe('Violet.');expect(t.reason?.text).toContain('hide');expect(t.status).toBe('revised');
});
it('rejects delayed and forged interpretation snapshots after a correction or privacy reset',()=>{
  const f=fixture(),r=f.c.interpretationRequest()!;f.say('user','stop','Stop talking about dashboard color.');expect(f.c.applyInterpretation([f.change],r)).toBe(false);
  const r2=f.c.interpretationRequest()!;r2.evidence[1].text='Invented.';expect(f.c.applyInterpretation([f.change],r2)).toBe(false);
  f.c.clear();expect(f.c.applyInterpretation([f.change],r)).toBe(false);expect(f.c.snapshot().thoughts).toBeUndefined();
});
it('does not revive closed topics through a later learning result and honors disabled retention',()=>{
  const f=fixture();f.say('user','stop','Stop commenting on dashboard color.');expect(f.c.applyInterpretation([f.change],f.c.interpretationRequest()!)).toBe(false);expect(f.c.snapshot().thoughts??[]).toEqual([]);
  f.disable();expect(f.c.interpretationRequest()).toBeUndefined();f.c.observe({id:'x',role:'assistant',content:'Because.',ts:f.now});expect(f.store.load('dialogue-cognition')).toBeUndefined();
});
it('excludes interrupted, private and source-derived speech from durable character evidence',()=>{
  const f=fixture(),before=f.c.snapshot();for(const meta of [{private:true},{interrupted:true},{error:'failed'},{contextSources:['mail']}])f.c.observe({id:'excluded',role:'assistant',content:'I prefer this because it is perfect.',ts:f.now,meta});expect(f.c.snapshot()).toEqual(before);
});
it('keeps normal conversation free of extra interpretation requests and omits the extraction buffer from prompt context',()=>{
  const f=fixture();f.c.applyInterpretation([],f.c.interpretationRequest()!);expect(f.c.interpretationRequest()).toBeUndefined();f.say('user','hello','Thanks.');f.say('assistant','reply','Sure.');expect(f.c.interpretationRequest()).toBeUndefined();expect(f.c.context()).not.toContain('"evidence":[');
});
it('piggybacks cognitive interpretation on the existing memory call and never retries a normal reply',async()=>{
  const f=fixture(),settings=structuredClone(DEFAULT_SETTINGS);settings.memory.autoLearn=true;let calls=0,input:any;
  const memory=new MemoryStore(tmpDir());
  const learner=new MemoryLearning({settings:()=>settings,memory,cognition:f.c,log:nullLogger,provider:()=>({name:'mock',local:true,async *stream(messages){calls++;input=JSON.parse(messages[1].content);yield JSON.stringify({changes:[],cognition:[f.change]});},async test(){return {ok:true,detail:''};},async listModels(){return [];}})});
  await learner.learn('Pick a dashboard color and explain why.','u',new AbortController().signal);
  expect(calls).toBe(1);expect(input.cognitive_request.revision).toBe(2);expect(f.c.snapshot().thoughts).toHaveLength(1);expect(memory.approved()).toEqual([]);
});
it('does not mistake unavailable interpretation for an adopted thought',async()=>{
  const f=fixture(),settings=structuredClone(DEFAULT_SETTINGS);settings.memory.autoLearn=true;
  const learner=new MemoryLearning({settings:()=>settings,memory:new MemoryStore(tmpDir()),cognition:f.c,log:nullLogger,provider:()=>({name:'mock',local:true,async *stream(){throw Error('provider unavailable');yield '';},async test(){return {ok:false,detail:''};},async listModels(){return [];}})});
  await learner.learn('What do you prefer?','u',new AbortController().signal);expect(f.c.snapshot().thoughts??[]).toEqual([]);expect(f.c.interpretationRequest()).toBeTruthy();
});
it('one topic closure leaves unrelated deferred communication eligible',()=>{
  const f=fixture(),r=new CognitiveRuntime(f.store,()=>true,()=>f.now);
  const mail={id:'mail',subject:'advisor',source:'mail',revision:1,at:f.now,expiresAt:f.now+60000,priority:80,action:'reason' as const,event:'life_context'};
  r.offer(mail);r.observeMessage({id:'stop',role:'user',content:'Stop commenting on dashboard color.',ts:f.now});expect(r.snapshot().subjects.find(s=>s.id==='advisor')?.phase).toBe('introduced');expect(r.decide()?.opportunity.id).toBe('mail');
});
it.each(['failed','interrupted','dispatched','completed'] as const)('only verified action completion permits a subsequent reaction: %s',async status=>{
  const d=new PerformanceDirector();let valid=true,reactions=0;
  const result=await d.perform(async()=>{if(status==='interrupted')valid=false;return status==='completed'?true:status==='failed'?false:undefined;},()=>valid,async()=>{reactions++;});
  expect(result.action).toBe(status);expect(reactions).toBe(status==='completed'?1:0);
});
it('allows a quiet stationary expression but suppresses game/call presentation',()=>{
  const d=new PerformanceDirector(),i={direct:false,quiet:true,available:true,held:false,moving:false,line:'A remark.',origin:{kind:'generated-spontaneous' as const},reaction:'curious' as const,availableReactions:['curious' as const]};
  expect(d.plan(i)).toMatchObject({reaction:'curious',beats:[{kind:'expression',reaction:'curious'}]});expect(d.plan(i).speech).toBeUndefined();expect(d.plan({...i,available:false}).beats).toEqual([]);
});

it('resolves an existing question from a user answer without manufacturing a new question',()=>{
  const f=fixture();f.say('assistant','q','Why keep the red warning?');
  f.c.applyInterpretation([{topic:'warning choice',kind:'question',status:'active',evidence:{sourceId:'q',quote:'Why keep the red warning?'},reason:null}],f.c.interpretationRequest()!);
  f.say('user','answer','Because it is the required safety color.');
  const resolved={topic:'warning choice',kind:'question',status:'resolved',evidence:{sourceId:'answer',quote:'Because it is the required safety color.'},reason:null};
  expect(f.c.applyInterpretation([resolved,{...resolved,topic:'invented question'}],f.c.interpretationRequest()!)).toBe(true);
  expect(f.c.snapshot().thoughts).toHaveLength(1);expect(f.c.snapshot().thoughts![0].status).toBe('resolved');
});
it('keeps volatile source reasoning in memory without persisting or reviving it',()=>{
  const f=fixture(),r=new CognitiveRuntime(f.store,()=>true,()=>f.now),value={facts:[{id:'source'}]};
  r.saveReasoning(value,false);expect(r.restoredReasoning()).toEqual(value);expect(new CognitiveRuntime(f.store,()=>true,()=>f.now).restoredReasoning()).toBeUndefined();
});
