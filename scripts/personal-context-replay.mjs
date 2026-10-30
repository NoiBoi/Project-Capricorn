// Fixed synthetic replay of actual baseline/current helpers. This is a state/retrieval
// comparison, not a benchmark of a model's naturalness or an external memory service.
import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { HonchoComparison, loadHonchoSDK } from './honcho-comparison.mjs';
const root=path.resolve(import.meta.dirname,'..'), temp=fs.mkdtempSync(path.join(os.tmpdir(),'capri-personal-replay-'));
const require=createRequire(import.meta.url), baselineCommit='71ce364';
try {
  const baseline=execFileSync('git',['show',`${baselineCommit}:src/main/ai/promptContext.ts`],{cwd:root,encoding:'utf8',windowsHide:true});
  await build({stdin:{contents:baseline,loader:'ts',resolveDir:path.join(root,'src/main/ai')},outfile:path.join(temp,'baseline.cjs'),bundle:true,platform:'node',format:'cjs'});
  await build({stdin:{contents:"export {PersonalContext,PersonalChanges} from './src/main/store/personalContext'; export {RelationshipStore} from './src/main/store/relationship';",loader:'ts',resolveDir:root},outfile:path.join(temp,'current.cjs'),bundle:true,platform:'node',format:'cjs'});
  const old=require(path.join(temp,'baseline.cjs')),{PersonalContext,PersonalChanges,RelationshipStore}=require(path.join(temp,'current.cjs'));
  let now=Date.now()-30*60000, serial=0;
  const make=()=>{const dir=path.join(temp,`profile-${serial++}`);fs.mkdirSync(dir);return {store:new PersonalContext(dir,()=>true,()=>true,()=>true,()=>now),relationship:new RelationshipStore(dir,()=>true,()=>true,()=>now)};};
  const source=(text,id)=>({messageId:id,text,at:now});
  const results=[];
  const row=(name,query,history,h,expectation)=>results.push({name,query,expectation,history,
    baselineContext:old.recalledExchanges(history,query,new Set()),prototypeContext:h.store.context(query,h.relationship.snapshot().threads,true),candidate:h.store.candidate()??null});
  const history=(text,reply='All right.')=>[{id:'u',role:'user',content:text,ts:now},{id:'a',role:'assistant',content:reply,ts:now+1000}];
  {
    const h=make(),text='I will go to bed after this reply.',log=history(text,'Fine. Get some rest.');
    h.store.userMessage(source(text,'u'));now+=1000;h.store.replyDelivered('u','a');now+=6*60000;h.store.observePresence(0);
    assert.equal(h.store.candidate().condition.kind,'reply');
    row('Matching reply then continued PC input','What did I say about bedtime?',log,h,'One specific optional callback with a delivered-reply receipt; no assertion of a broken promise.');
    h.store.followUpDelivered(h.store.candidate().id);assert.equal(h.store.candidate(),undefined);
  }
  {
    const h=make(),text="I'm heading home.",log=history(text);
    h.store.userMessage(source(text,'u'));now+=15*60000;h.store.observePresence(600);h.store.observePresence(0);
    row('Fresh whereabouts plus actual return','I am back at the PC.',log,h,'May ask whether the user made it home, without claiming an arrival or unseen travel.');
    assert.equal(h.store.snapshot().situations[0].value,'heading home');
  }
  {
    const h=make(),text='I will sleep after I finish the ENGR 210 assignment.',log=history(text);
    const first=source(text,'u');now+=5*60000;const done=source('I finished the ENGR 210 assignment.','u2');
    h.store.learn(PersonalChanges.parse({commitments:[{op:'add',intention:'go to bed',condition:{kind:'topic',topic:'ENGR 210 assignment'},evidence:text}]}),[first,done],h.store.checkpoint());
    now+=6*60000;h.store.observePresence(0);assert.equal(h.store.candidate().status,'eligible');
    row('Named prerequisite reported finished','What was the plan after ENGR 210?',log.concat({id:'u2',role:'user',content:done.text,ts:done.at}),h,'Prerequisite completion makes sleep eligible; it does not mean sleep happened.');
  }
  {
    const h=make(),text='I will go to bed after this reply.',log=history(text);h.store.userMessage(source(text,'u'));now+=60000;
    const correction="I changed my mind about sleep. I'm staying up.";h.store.userMessage(source(correction,'u2'));h.store.observePresence(0);
    assert.equal(h.store.candidate(),undefined);
    row('Changed plan outranks the old intention','What was my sleep plan?',log.concat({id:'u2',role:'user',content:correction,ts:now}),h,'The intention is cancelled; no unsolicited callout about the obsolete plan.');
  }
  {
    const h=make(),text='I am working on ArborCalc.';h.relationship.setThread({title:'ArborCalc',summary:'Testing a narrower baseline.',status:'active',aliases:['the diffraction tool']});
    h.store.learn(PersonalChanges.parse({situations:[{key:'current_work',value:'working on ArborCalc',evidence:text,ttlMinutes:120}]}),[source(text,'u')],h.store.checkpoint());
    row('Current work connects to a canonical project','What is the current thread?',history(text),h,'Use the same ArborCalc project and its latest reported state, not a duplicate inferred from an app title.');
    assert.ok(results.at(-1).prototypeContext.includes('"subject":"ArborCalc"'));
  }
  {
    const h=make(),text='I will go to bed after this reply.';h.store.userMessage(source(text,'u'));h.store.replyDelivered('u','a');now+=25*3600000;h.store.observePresence(0);
    assert.equal(h.store.snapshot().commitments[0].status,'expired');assert.equal(h.store.candidate(),undefined);
    row('Expired intention is not an ongoing obligation','What happened to that sleep plan?',history(text),h,'Expiry is unknown outcome, with no revived callback after a restart.');
  }
  const report={scope:'Six synthetic fixed cases using actual baseline recall and prototype state/context helpers. No model quality scores are claimed.',baselineCommit,total:results.length,assertionsPassed:true,
    honcho:{status:'not_run',reason:'No Honcho backend is configured. The real SDK loopback contract test is separate from service-quality evidence.'},results};
  if(process.argv.includes('--honcho')) {
    if(!process.env.HONCHO_URL)throw new Error('Set HONCHO_URL explicitly for the synthetic comparison.');
    const {Honcho}=loadHonchoSDK(),adapter=new HonchoComparison(Honcho,{baseURL:process.env.HONCHO_URL,apiKey:process.env.HONCHO_API_KEY});
    try {
      await adapter.ingestSynthetic(results[0].history.map(m=>({synthetic:true,id:m.id,role:m.role,text:m.content,at:m.ts})));
      const ready=await adapter.ready();
      report.honcho=ready.ready ? {status:'complete',workspace:adapter.workspaceId,result:await adapter.recall(results[0].query)} : {status:'pending',queue:ready.status,reason:'Asynchronous derivation has not completed. No recall result was scored.'};
    } finally {await adapter.cleanup();}
  }
  fs.mkdirSync(path.join(root,'docs/personal-context'),{recursive:true});fs.writeFileSync(path.join(root,'docs/personal-context/replay.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify({total:report.total,assertionsPassed:report.assertionsPassed,honcho:report.honcho.status,scope:report.scope}));
} finally {fs.rmSync(temp,{recursive:true,force:true});}
