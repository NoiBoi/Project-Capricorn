import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { _electron as electron, type ElectronApplication } from 'playwright-core';
import { expect,it } from 'vitest';
import { closeIsolatedApp } from './lifecycle';

it('uses one live executor and reconciles world corrections and source revocation across SQLite restart',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'capri-capability-migration-'));let app:ElectronApplication|undefined;
  fs.writeFileSync(path.join(dir,'settings.json'),JSON.stringify({firstRunComplete:true,ai:{provider:'offline'},memory:{enabled:true,autoLearn:false},character:{startupIntro:false,hideOnFullscreen:false},voice:{ttsEnabled:false},behavior:{smallActivities:false,idleRemarks:false,explore:false,quietHours:{enabled:false}},teleport:{auto:false,effects:false}}));
  async function boot(){app=await electron.launch({...process.env.CAPRI_EXE?{executablePath:process.env.CAPRI_EXE,args:[]}:{args:[path.resolve(__dirname,'../..')]},env:{...process.env,CAPRI_TEST:'1',CAPRI_OFFSCREEN:'1',CAPRI_NO_DEV_KEY:'1',CAPRI_USER_DATA:dir}});await (await app.firstWindow()).waitForFunction(()=>!!(window as any).__capriDebug);return app;}
  try{
    const first=await boot();
    const actions=await first.evaluate(async()=>{
      const a=(globalThis as any).__capri,ctx=a.convo.d.actionCtx;
      const original=a.convo.d.provider;let calls=0;
      a.convo.d.provider=()=>({name:'fixture',local:true,async *stream(){yield calls++===0?'<action>{"tool":"create_note","args":{"title":"Fixture note","body":"Verified local effect"}}</action>':'Saved the note.';}});
      try{await a.convo.send('Create a note called Fixture note with body Verified local effect');await a.convo.settle();}finally{a.convo.d.provider=original;}
      const entries=a.cognitiveStore.load('capability-journal-v1').entries;
      const note=entries.find((e:any)=>e.capability==='create_note');let replayRuns=0;
      const replay=await ctx.executor.execute({...note,dependencies:note.dependencies},null,{parse:()=>null,permission:()=> 'allow',precondition:()=>true,execute:async()=>{replayRuns++;},verify:()=>true},new AbortController().signal);
      return {shared:ctx.executor===a.agency.executor.gateway,notes:a.notes.list().length,outcome:note.receipt.outcome,replayed:replay.receipt.replayed,replayRuns,reply:a.history.recent(1)[0].content};
    });
    expect(actions).toEqual({shared:true,notes:1,outcome:'completed',replayed:true,replayRuns:0,reply:'Saved the note.'});
    const world=await first.evaluate(async()=>{
      const a=(globalThis as any).__capri,life=a.life.ledger,at=Date.now(),permissions={collect:true,live:true,proactive:true,retain:true,content:true,learn:false};
      life.configure({id:'academic',kind:'gradescope',name:'Synthetic coursework',permissions,retentionDays:30});
      life.ingest({source:'academic',recordId:'fixture-hw',revision:1,type:'academic-due',occurredAt:at,receivedAt:at,expiresAt:at+86400000,entities:[],quality:'observed',permissions,summary:'Homework 7 due',detail:JSON.stringify({course:'ME239',assignment:'Homework 7',status:'due',due:at+3600000}),operation:'upsert',importance:.8});
      await a.convo.send('I submitted Homework 7.');await a.convo.settle();
      const submitted=life.world().find((f:any)=>f.asserted==='submitted');
      a.relationship.setThread({title:'Research',summary:'Ongoing work',status:'active'});
      await a.convo.send('Research is done.');await a.convo.settle();
      return {submitted:submitted.status,dependencies:life.assertionHistory().find((x:any)=>x.source==='user'&&x.predicate==='submission').dependencies,project:a.relationship.snapshot().threads[0].status,projectWorld:life.world().find((f:any)=>f.predicate==='status').asserted};
    });
    expect(world).toEqual({submitted:'user-reported',dependencies:['academic'],project:'done',projectWorld:'done'});
    await closeIsolatedApp(app);app=undefined;const second=await boot();
    const revoked=await second.evaluate(()=>{
      const a=(globalThis as any).__capri,life=a.life.ledger;a.cognitiveStore.integrity();
      const before=life.world().some((f:any)=>f.asserted==='submitted');a.life.forget('academic');
      return {before,submission:life.world().some((f:any)=>f.predicate==='submission'),retained:life.assertionHistory().some((x:any)=>x.dependencies.includes('academic')),authored:a.history.recent(20).some((m:any)=>m.role==='user'&&m.content==='I submitted Homework 7.'),project:life.world().find((f:any)=>f.predicate==='status')?.asserted};
    });
    expect(revoked).toEqual({before:true,submission:false,retained:false,authored:true,project:'done'});
    await closeIsolatedApp(app);app=undefined;const third=await boot();
    expect(await third.evaluate(()=>{const a=(globalThis as any).__capri;return {submission:a.life.ledger.world().some((f:any)=>f.predicate==='submission'),notes:a.notes.list().length,project:a.relationship.snapshot().threads[0].status};})).toEqual({submission:false,notes:1,project:'done'});
  }finally{await closeIsolatedApp(app);fs.rmSync(dir,{recursive:true,force:true,maxRetries:5,retryDelay:100});}
},60000);
