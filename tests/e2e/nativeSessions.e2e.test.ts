import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { _electron as electron, type ElectronApplication } from 'playwright-core';
import { expect,it } from 'vitest';
import { closeIsolatedApp } from './lifecycle';

it.skipIf(process.env.CAPRI_LIVE_SESSIONS!=='1')('continues actual native model history across a packaged application process restart',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'capri-native-dialogue-'));let app:ElectronApplication|undefined;
  fs.writeFileSync(path.join(dir,'settings.json'),JSON.stringify({firstRunComplete:true,ai:{provider:'codex',requestTimeoutSec:120,codex:{chatModel:'gpt-6-luna'}},memory:{enabled:true,autoLearn:false},character:{startupIntro:false},voice:{ttsEnabled:false},behavior:{idleRemarks:false,explore:false,smallActivities:false,quietHours:{enabled:false}},teleport:{auto:false}}));
  const boot=async()=>{app=await electron.launch({...process.env.CAPRI_EXE?{executablePath:process.env.CAPRI_EXE,args:[]}:{args:[path.resolve(__dirname,'../..')]},env:{...process.env,CAPRI_TEST:'1',CAPRI_OFFSCREEN:'1',CAPRI_NO_DEV_KEY:'1',CAPRI_USER_DATA:dir}});await (await app.firstWindow()).waitForFunction(()=>!!(window as any).__capriDebug);return app;};
  try{
    const first=await boot();const before=await first.evaluate(async()=>{
      const a=(globalThis as any).__capri;await a.convo.send('In this synthetic test our fictional project code word is cormorant. Acknowledge with one short sentence.');await a.convo.settle();
      return {sessions:a.modelSessions.snapshot().sessions,reply:a.history.recent(1)[0]};
    });
    expect(before.reply.meta.error).toBeUndefined();expect(before.sessions).toHaveLength(1);expect(before.sessions[0].inFlight).toBe(false);
    await closeIsolatedApp(app);app=undefined;
    const second=await boot();const after=await second.evaluate(async()=>{
      const a=(globalThis as any).__capri;await a.convo.send('What was our fictional project code word? One short sentence.');await a.convo.settle();
      const sessions=a.modelSessions.snapshot().sessions,reply=a.history.recent(1)[0];
      const deleted=sessions.length?await a.modelSessions.backend.invalidate(sessions[0].handle):'missing';
      a.modelSessions.clear();return {sessions,reply,deleted};
    });
    console.log('SYNTHETIC_NATIVE_FIRST_ATTEMPTS',JSON.stringify({first:before.reply.content,continued:after.reply.content,usage:after.sessions[0]?.handle.usage}));
    expect(after.reply.meta.error).toBeUndefined();expect(after.reply.content).toMatch(/cormorant/i);
    expect(after.sessions[0].handle.id).toBe(before.sessions[0].handle.id);expect(after.sessions[0].handle.turns).toBe(2);expect(after.deleted).toBe('deleted');
  }finally{await closeIsolatedApp(app);fs.rmSync(dir,{recursive:true,force:true,maxRetries:8,retryDelay:250});}
},180000);

it.skipIf(process.env.CAPRI_LIVE_SESSIONS!=='1')('transmits evidence beyond the preview of a large native application context',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'capri-native-evidence-'));let app:ElectronApplication|undefined;
 fs.writeFileSync(path.join(dir,'settings.json'),JSON.stringify({firstRunComplete:true,ai:{provider:'offline'},memory:{autoLearn:false},character:{startupIntro:false},voice:{ttsEnabled:false},behavior:{idleRemarks:false,explore:false,smallActivities:false},teleport:{auto:false}}));
 try{
  app=await electron.launch({...process.env.CAPRI_EXE?{executablePath:process.env.CAPRI_EXE,args:[]}:{args:[path.resolve(__dirname,'../..')]},env:{...process.env,CAPRI_TEST:'1',CAPRI_OFFSCREEN:'1',CAPRI_NO_DEV_KEY:'1',CAPRI_USER_DATA:dir}});
  await(await app.firstWindow()).waitForFunction(()=>!!(window as any).__capriDebug);
  const result=await app.evaluate(async()=>{
   const backend=(globalThis as any).__capri.modelSessions.backend;
   const h=await backend.start({scope:'source',model:'gpt-6-luna',instructions:'Answer from the supplied synthetic application evidence. Do not use tools.',dependencies:['owntracks']});
   let reply='';try{
    const state=JSON.stringify({olderObservations:'Unrelated historical window metadata. '.repeat(450),phone:{place:'Zinnia Observatory',status:'corroborated phone proximity',fresh:true}});
    for await(const text of backend.respond(h,{text:'What place does the synthetic phone evidence name?',state,signal:new AbortController().signal,timeoutMs:60000}))reply+=text;
    return{reply,usage:h.usage};
   }finally{await backend.invalidate(h);}
  });
  console.log('SYNTHETIC_LARGE_CONTEXT_FIRST_ATTEMPT',JSON.stringify(result));expect(result.reply).toMatch(/Zinnia Observatory/i);
 }finally{await closeIsolatedApp(app);fs.rmSync(dir,{recursive:true,force:true,maxRetries:8,retryDelay:250});}
},120000);
