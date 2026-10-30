import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {_electron as electron,type ElectronApplication} from 'playwright-core';
import {expect,it} from 'vitest';
import {closeIsolatedApp} from './lifecycle';
it('runs perception through the real SQLite checkpoint, availability actor and session context across restart',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'capri-stage4-native-'));let app:ElectronApplication|undefined;
 fs.writeFileSync(path.join(dir,'settings.json'),JSON.stringify({firstRunComplete:true,character:{startupIntro:false,hideOnFullscreen:false},ai:{provider:'offline'},memory:{autoLearn:false},voice:{ttsEnabled:false,interactionLines:false},dialogue:{localContext:true,contextPings:false,spotifyBanter:false},behavior:{smallActivities:false,idleRemarks:false,explore:false,quietHours:{enabled:false}},teleport:{auto:false,effects:false}}));
 const boot=async()=>{app=await electron.launch({...process.env.CAPRI_EXE?{executablePath:process.env.CAPRI_EXE,args:[]}:{args:[path.resolve(__dirname,'../..')]},env:{...process.env,CAPRI_TEST:'1',CAPRI_OFFSCREEN:'1',CAPRI_NO_DEV_KEY:'1',CAPRI_USER_DATA:dir}});await (await app.firstWindow()).waitForFunction(()=>!!(window as any).__capriDebug);return app;};
 try{
  const first=await boot();const admitted=await first.evaluate(()=>{
   const a=(globalThis as any).__capri,life=a.life.ledger,at=Date.now();(globalThis as any).__capriIdleOverride=0;
   for(const id of ['chrome','gmail-0','discord-bot'])life.configure({...life.source(id),...(id==='chrome'?{sites:['https://docs.example.com']}:{}),permissions:{collect:true,live:true,proactive:true,retain:true,content:true,learn:false}});
   a.life.chrome.accept({recordId:'active-page',revision:at,occurredAt:at,url:'https://docs.example.com/research',title:'Research notes',headings:['Reaction forces'],sections:[{kind:'paragraph',level:0,path:'Reaction forces',text:'The new reaction force is 12 N.'}],mode:'semantic',incognito:false,focused:true,visible:true});
   const event={source:'gmail-0',recordId:'review',revision:at,type:'request-claim',occurredAt:at,receivedAt:at,expiresAt:at+86400000,entities:[],quality:'observed',permissions:life.source('gmail-0').permissions,summary:'Research review request',detail:'Source communication claim only.',operation:'upsert',importance:.7};life.ingest(event);
   life.ingest({...event,source:'discord-bot',recordId:'voice-membership',type:'discord-guild-voice',summary:'Configured user is connected to an authorized guild voice channel',expiresAt:at+120000,importance:0});a.observeAgency();
   const candidate=life.view().candidates.find((c:any)=>c.source==='gmail-0');life.flush();
   return {mode:a.agency.availability.getSnapshot().context.mode,attempts:candidate.attempts,status:candidate.status,reason:candidate.reason,sections:life.readPage('reaction force').length,diagnostics:life.diagnostics(),spoken:a.speakCount};
  });
  expect(admitted.mode).toBe('game_call');expect(admitted.attempts).toBe(0);expect(admitted.status).toBe('deferred');expect(admitted.reason).toContain('game_call');expect(admitted.sections).toBe(1);expect(admitted.diagnostics.backgroundModelsOnIngest).toBe(0);expect(admitted.spoken).toBe(0);
  await closeIsolatedApp(app);app=undefined;
  const second=await boot();const recovered=await second.evaluate(()=>{const a=(globalThis as any).__capri,life=a.life.ledger;a.cognitiveStore.integrity();const before={sections:life.readPage('reaction force').length,queued:life.view().candidates.filter((c:any)=>c.source==='gmail-0').length,context:a.life.assembler.assemble('reaction force')};
   const voice=life.current().find((e:any)=>e.type==='discord-guild-voice');if(voice)life.ingest({...voice,revision:voice.revision+1,operation:'delete'});(globalThis as any).__capriIdleOverride=0;a.observeAgency();const mode=a.agency.availability.getSnapshot().context.mode;life.forget('chrome');life.forget('gmail-0');return{before,mode,after:life.diagnostics(),context:a.life.assembler.assemble('reaction force'),sources:a.life.assembler.suppliedSources};});
  expect(recovered.before.sections).toBe(1);expect(recovered.before.queued).toBe(1);expect(recovered.before.context).toContain('12 N');expect(recovered.mode).toBe('available');expect(recovered.after.snapshots).toBe(0);expect(recovered.after.pending).toBe(0);expect(recovered.context).not.toContain('12 N');expect(recovered.sources).toEqual([]);
 }finally{await closeIsolatedApp(app);fs.rmSync(dir,{recursive:true,force:true,maxRetries:5,retryDelay:100});}
});
