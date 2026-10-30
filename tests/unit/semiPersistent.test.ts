import {expect,it} from 'vitest';
import {DialogueCognition} from '../../src/core/dialogueCognition';
const fixture=()=>{
 let now=1800000000000,retain=true;const values=new Map<string,unknown>();
 const store={load:<T>(id:string)=>structuredClone(values.get(id)) as T|undefined,save:(id:string,v:unknown)=>{values.set(id,structuredClone(v));},removeCheckpoint:(id:string)=>{values.delete(id);}};
 const make=()=>new DialogueCognition(store,()=>retain,()=>now);let d=make();
 return {get d(){return d;},store,values,advance:(ms:number)=>{now+=ms;},restart:()=>{d=make();},disable:()=>{retain=false;},say:(id:string,role:'user'|'assistant',content:string,meta={})=>{d.observe({id,role,content,ts:++now,meta});}};
};
it('preserves an actual position through unrelated speech, contact and restart, then closes it',()=>{
 const f=fixture();
 f.say('mount','user','Which mount design would you choose for reversing loads?');
 f.say('choice','assistant','The heavier mount. A sharp inside corner is a fatigue invitation.');
 f.say('dinner','user','Different topic: what would you put in an omelet for dinner?');
 f.say('food','assistant','I prefer mushrooms because they earn their space.');
 f.say('pat','assistant','Fine, another pat.',{speech:{kind:'generated-spontaneous'}});
 expect(f.d.context()).toContain('sharp inside corner');expect(f.d.snapshot().position?.text).toContain('mushrooms');
 f.restart();expect(f.d.context()).toContain('sharp inside corner');
 f.say('development','user','The heavier mount now has a polished fillet beside the fastener.');
 f.say('brief','assistant','Promising.');
 expect(f.d.snapshot().subjects?.find(s=>s.id==='mount')?.turns.some(t=>t.id==='brief')).toBe(true);
 f.say('revised','assistant','That fixes my corner objection. Check the surface finish before choosing the mount.');
 expect(f.d.context()).toContain('fixes my corner objection');
 f.say('closed','user','That settles it, the mount design is resolved.');
 expect(f.d.snapshot().subjects?.find(s=>s.id==='mount')?.status).toBe('resolved');
});
it('keeps source speech useful only in eligible volatile context and never feeds it to learning or restart',()=>{
 const f=fixture();f.say('u','user','Pick a dashboard color.');f.say('a','assistant','I prefer violet because the alerts use red.');
 const before=f.d.snapshot(),request=f.d.interpretationRequest();
 f.say('browser','assistant','I dislike the subscription-only tool because an offline license should survive its vendor.',{contextSources:['chrome'],speech:{kind:'generated-spontaneous'}});
 expect(f.d.context()).toContain('survive its vendor');expect(f.d.snapshot()).toEqual(before);
 expect(f.d.context(new Set(['chrome']))).not.toContain('survive its vendor');
 expect(f.d.contextDependencies()).toEqual(['chrome']);expect(f.d.contextDependencies(new Set(['chrome']))).toEqual([]);
 expect(JSON.stringify([...f.values])).not.toContain('survive its vendor');expect(f.d.interpretationRequest()).toEqual(request);
 f.d.invalidateContext('chrome');expect(f.d.context()).not.toContain('survive its vendor');expect(f.d.context()).toContain('violet');
 f.say('again','assistant','An offline license beats the subscription tool.',{contextSources:['chrome']});
 f.restart();expect(f.d.context()).not.toContain('offline license');
});
it('bounds subjects, expires waiting context, and drops all context when retention is disabled',()=>{
 const f=fixture();for(let n=0;n<20;n++)f.say('s'+n,'assistant','Distinct'+n+' unusual'+n+' object'+n,{speech:{kind:'generated-spontaneous'}});
 expect(f.d.snapshot().subjects?.length).toBeLessThanOrEqual(4);expect(f.d.context().length).toBeLessThan(4200);
 f.advance(49*3600000);expect(f.d.context()).not.toContain('"id":"s19"');
 f.disable();f.say('x','user','Hello');expect(f.d.context()).toBe('');expect(f.store.load('dialogue-cognition')).toBeUndefined();
});
it('does not save private, interrupted or failed source speech, or invent intermediate thoughts',()=>{
 const f=fixture();for(const meta of [{private:true},{interrupted:true},{error:'failed'}])f.say('bad','assistant','I love this secret.',{...meta,contextSources:['mail']});
 expect(f.d.context()).toBe('');f.say('a','assistant','I prefer the red mount.');const before=f.d.snapshot();f.advance(60000);f.d.context();expect(f.d.snapshot()).toEqual(before);
});
it('gives an explicitly unrelated turn its own prompt focus without erasing the waiting opinion',()=>{
 const f=fixture();f.say('vendor','assistant','I dislike subscriptions holding local designs hostage.',{contextSources:['chrome'],speech:{kind:'generated-spontaneous'}});
 f.say('tea','user','Unrelated: I am making tea.');
 expect(f.d.context(new Set(),'Unrelated: I am making tea.')).not.toContain('holding local designs');
 expect(f.d.context(new Set(),'An offline license for local designs is now offered.')).toContain('holding local designs');
 for(let n=0;n<10;n++)f.say('aside'+n,'assistant','Separate'+n+' unrelated'+n+' object'+n,{speech:{kind:'generated-spontaneous'}});
 expect(f.d.context(new Set(),'An offline license for local designs is now offered.')).toContain('holding local designs');
});
it('lets an unanswered aside end engagement without erasing its interest, then reopens on a user turn',()=>{
 const f=fixture();f.say('u','user','I am working on a curved bracket.');
 f.say('a','assistant','That curved bracket wants to escape.',{speech:{kind:'generated-spontaneous'}});
 expect(f.d.engagement()).toMatchObject({engaged:false,unansweredRemarks:1});
 f.restart();expect(f.d.engagement()).toMatchObject({engaged:false,unansweredRemarks:1});
 expect(f.d.context()).toContain('wants to escape');
 f.say('u2','user','Escape where?');expect(f.d.engagement()).toMatchObject({engaged:true,unansweredRemarks:0});
 f.say('a2','assistant','Somewhere with less paperwork.');expect(f.d.engagement().engaged).toBe(true);
 f.advance(90001);expect(f.d.engagement().engaged).toBe(true);expect(f.d.context()).toContain('wants to escape');
 f.say('ack','user','Fair enough.');expect(f.d.engagement().engaged).toBe(false);
});
it('projects source exclusions and revocation without leaking an unanswered private aside into engagement',()=>{
 const f=fixture();f.say('u','user','Show me a mug.');
 f.say('browser','assistant','That mug handle is ridiculous.',{contextSources:['chrome'],speech:{kind:'generated-spontaneous'}});
 expect(f.d.engagement().unansweredRemarks).toBe(1);
 expect(f.d.engagement(new Set(['chrome'])).unansweredRemarks).toBe(0);
 f.d.invalidateContext('chrome');expect(f.d.engagement().unansweredRemarks).toBe(0);
 f.say('private','assistant','Another aside.',{private:true,speech:{kind:'generated-spontaneous'}});
 expect(f.d.engagement().unansweredRemarks).toBe(0);
});
it('closes a recent exchange without deleting the expressed view',()=>{
 const f=fixture();f.say('u','user','Pick a bracket.');f.say('a','assistant','I prefer the curved bracket.');
 expect(f.d.engagement().engaged).toBe(true);
 f.say('close','user','That settles it.');expect(f.d.engagement().engaged).toBe(false);
 expect(f.d.context()).toContain('curved bracket');
});
it('treats a plain sign-off as disengagement while an engaged follow-up still counts',()=>{
 const f=fixture();f.say('u','user','What about the curved bracket?');f.say('a','assistant','I prefer the curved bracket.');
 f.say('occupied','user','I need to focus.');expect(f.d.engagement().engaged).toBe(false);
 expect(f.d.context()).toContain('curved bracket');
 f.say('followup','user','Thanks, but why the curved one?');expect(f.d.engagement().engaged).toBe(true);
});

it('keeps a longer pronoun follow-up with its exchange after silence, without creating aside questions',()=>{
 const f=fixture();f.say('mug','assistant','A mug handle long enough for a robbery.',{speech:{kind:'generated-spontaneous'}});
 f.advance(12*60000);f.say('reply','user','You could steal my coffee from the other side of the desk. Worth the risk?');
 expect(f.d.snapshot().subjects?.find(s=>s.id==='mug')?.turns.some(t=>t.id==='reply')).toBe(true);
 f.say('answer','assistant','Worth it.');f.say('aside','assistant','Another coffee robbery?',{speech:{kind:'generated-spontaneous'}});
 expect(f.d.engagement()).toMatchObject({engaged:false,purpose:'opening'});expect(f.d.snapshot().questions).toEqual([]);
});
