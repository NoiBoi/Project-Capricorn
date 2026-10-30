import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { _electron as electron, type ElectronApplication } from 'playwright-core';
import { expect,it } from 'vitest';
import { closeIsolatedApp } from './lifecycle';

it('wires conversational cognition into real chat, persists it and clears private/source/forgotten state',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'capri-dialogue-runtime-'));let app:ElectronApplication|undefined;
  fs.writeFileSync(path.join(dir,'settings.json'),JSON.stringify({firstRunComplete:true,ai:{provider:'offline'},memory:{enabled:true,autoLearn:false},character:{startupIntro:false},voice:{ttsEnabled:false},behavior:{idleRemarks:false,explore:false,smallActivities:false,quietHours:{enabled:false}},teleport:{auto:false}}));
  const boot=async()=>{app=await electron.launch({...process.env.CAPRI_EXE?{executablePath:process.env.CAPRI_EXE,args:[]}:{args:[path.resolve(__dirname,'../..')]},env:{...process.env,CAPRI_TEST:'1',CAPRI_OFFSCREEN:'1',CAPRI_NO_DEV_KEY:'1',CAPRI_USER_DATA:dir}});await (await app.firstWindow()).waitForFunction(()=>!!(window as any).__capriDebug);return app;};
  try{
    const first=await boot();
    const state=await first.evaluate(async()=>{
      const a=(globalThis as any).__capri;
      await a.convo.send('We are discussing our synthetic Glass Finch dashboard project.');await a.convo.settle();
      await a.convo.send('Actually the dashboard warning color is already reserved.');await a.convo.settle();
      const before=a.dialogueCognition.snapshot();
      await a.convo.send('Off the record: synthetic private fixture text.');await a.convo.settle();
      const after=a.dialogueCognition.snapshot();
      return {direction:before.direction,privateExcluded:JSON.stringify(before)===JSON.stringify(after),sessions:a.modelSessions.snapshot().sessions.length};
    });
    expect(state).toEqual({direction:expect.stringContaining('Reconsider'),privateExcluded:true,sessions:0});
    await closeIsolatedApp(app);app=undefined;
    const second=await boot();
    const recovered=await second.evaluate(async()=>{
      const a=(globalThis as any).__capri;const before=a.dialogueCognition.snapshot();
      const source=a.life.ledger.source('chrome');a.life.configure({...source,permissions:{collect:true,live:true,retain:true,content:false,learn:false}});a.life.forget('chrome');
      return {subject:before.subject,cleared:a.dialogueCognition.snapshot().updatedAt===0,privateOnDisk:JSON.stringify(a.history.recallHistory()).includes('synthetic private fixture text')};
    });
    expect(recovered).toEqual({subject:expect.stringContaining('reserved'),cleared:true,privateOnDisk:false});
  }finally{await closeIsolatedApp(app);fs.rmSync(dir,{recursive:true,force:true,maxRetries:8,retryDelay:250});}
});
