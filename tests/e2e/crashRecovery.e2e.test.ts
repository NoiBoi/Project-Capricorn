import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {_electron as electron,type ElectronApplication} from 'playwright-core';
import {expect,it} from 'vitest';
import {closeIsolatedApp} from './lifecycle';

it.skipIf(process.platform!=='win32')('recovers committed identity, history and absolute timer state after an actual main-process crash',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'capri-crash-recovery-'));let app:ElectronApplication|undefined;
 fs.writeFileSync(path.join(dir,'settings.json'),JSON.stringify({firstRunComplete:true,ai:{provider:'offline'},memory:{enabled:true,autoLearn:false},character:{startupIntro:false,hideOnFullscreen:false},voice:{ttsEnabled:false},behavior:{idleRemarks:false,explore:false,smallActivities:false,quietHours:{enabled:false}},teleport:{auto:false}}));
 fs.writeFileSync(path.join(dir,'memory.json'),JSON.stringify([{id:'fixture',text:'Synthetic crash preservation fact.',status:'approved',source:'user',createdAt:Date.now()}]));
 const boot=async()=>{app=await electron.launch({...process.env.CAPRI_EXE?{executablePath:process.env.CAPRI_EXE,args:[]}:{args:[path.resolve(__dirname,'../..')]},env:{...process.env,CAPRI_TEST:'1',CAPRI_OFFSCREEN:'1',CAPRI_NO_DEV_KEY:'1',CAPRI_USER_DATA:dir}});await(await app.firstWindow()).waitForFunction(()=>!!(window as any).__capriDebug);return app;};
 try{
  const a=await boot();const before=await a.evaluate(async()=>{const c=(globalThis as any).__capri;const i=await c.agency.submit('timer',{text:'Synthetic crash timer'},{id:'crash-timer',durationMs:600000});c.history.append({id:'crash-history',role:'user',content:'Synthetic committed history.',ts:Date.now()});c.cognitiveStore.save('crash-fixture',{committed:true});return {main:process.pid,deadline:i.deadline};});
  execFileSync('taskkill',['/PID',String(before.main),'/T','/F'],{windowsHide:true,stdio:'ignore'});
  await new Promise(r=>setTimeout(r,1000));app=undefined;
  const b=await boot();const after=await b.evaluate(()=>{const c=(globalThis as any).__capri;c.agency.tick();c.cognitiveStore.integrity();return {committed:c.cognitiveStore.load('crash-fixture'),approved:c.memory.approved().length,history:c.history.recent().some((m:any)=>m.id==='crash-history'),timer:c.agency.get('crash-timer')};});
  expect(after.committed).toEqual({committed:true});expect(after.approved).toBe(1);expect(after.history).toBe(true);expect(after.timer.deadline).toBe(before.deadline);expect(after.timer.state).toBe('active');
 }finally{
  await closeIsolatedApp(app);
  fs.rmSync(dir,{recursive:true,force:true,maxRetries:8,retryDelay:250});
 }
},90000);
