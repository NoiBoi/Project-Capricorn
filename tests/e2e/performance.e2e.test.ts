import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { _electron as electron,type ElectronApplication } from 'playwright-core';
import {expect,it} from 'vitest';
import {closeIsolatedApp} from './lifecycle';
it('delivers provenance, authored retirement, generated feedback and quiet body policy across restart',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'capri-performance-'));let app:ElectronApplication|undefined;
 fs.writeFileSync(path.join(dir,'settings.json'),JSON.stringify({firstRunComplete:true,ai:{provider:'offline'},memory:{enabled:true,autoLearn:false},character:{startupIntro:false},voice:{ttsEnabled:false},behavior:{idleRemarks:false,explore:false,smallActivities:false,quietHours:{enabled:false}},teleport:{auto:false}}));
 const boot=async()=>{app=await electron.launch({...process.env.CAPRI_EXE?{executablePath:process.env.CAPRI_EXE,args:[]}:{args:[path.resolve(__dirname,'../..')]},env:{...process.env,CAPRI_TEST:'1',CAPRI_OFFSCREEN:'1',CAPRI_NO_DEV_KEY:'1',CAPRI_USER_DATA:dir}});await(await app.firstWindow()).waitForFunction(()=>!!(window as any).__capriDebug);return app;};
 try{
  const a=await boot();const result=await a.evaluate(async()=>{
   const c=(globalThis as any).__capri;const line=c.companionDialogue.choose({event:'pat'},{required:true,remember:false});c.presentRemark(line,true,false,{event:'pat'});
   const authored=c.history.recent(1)[0];const bubble=c.bubble.state.speech;c.retiredLines.retire(line);c.bubble.dismiss();
   const blocked=c.presentRemark(line,true,false,{event:'pat'});c.performanceFeedback.record('generic');
   await c.agency.submit('quiet',{quiet:true},{id:'quiet',durationMs:60000});c.bubble.dismiss();
   const arrival=c.presentRemark('I have arrived.',true,false,{event:'putdown'});
   c.agency.cancelWhere(()=>true,'explicit release');
   return {authored,bubble,blocked,arrival,feedback:c.cognitiveStore.load('performance-feedback')};
  });
  expect(result.authored.meta.speech.kind).toBe('authored');expect(result.bubble).toEqual(result.authored.meta.speech);expect(result.blocked).toBe(false);expect(result.arrival).toBe(false);expect(result.feedback[0]).toHaveProperty('kind','generic');
  const animationId=await a.evaluate(()=>{const c=(globalThis as any).__capri,id=c.performanceDirector.requestAnimation('nod');c.charWin.webContents.send('cue',{type:'react',reaction:'nod',performanceId:id});return id;});
  await expect.poll(()=>a.evaluate((_e,id)=>(globalThis as any).__capri.performanceDirector.animationState().find((x:any)=>x.id===id)?.status,animationId),{timeout:10000}).toBe('completed');
  const interruptedId=await a.evaluate(()=>{const c=(globalThis as any).__capri,id=c.performanceDirector.requestAnimation('curious');c.charWin.webContents.send('cue',{type:'react',reaction:'curious',performanceId:id});c.charWin.webContents.send('cue',{type:'pause',paused:true});return id;});
  await expect.poll(()=>a.evaluate((_e,id)=>(globalThis as any).__capri.performanceDirector.animationState().find((x:any)=>x.id===id)?.status,interruptedId)).toBe('interrupted');
  await closeIsolatedApp(app);app=undefined;const b=await boot();const restored=await b.evaluate(()=>{const c=(globalThis as any).__capri;return {retired:c.retiredLines.list(),feedback:c.cognitiveStore.load('performance-feedback'),message:c.history.recent(1)[0]};});expect(restored.retired[0].lineId).toBe(result.authored.meta.speech.lineId);expect(restored.feedback).toEqual(result.feedback);expect(restored.message.meta.speech).toEqual(result.authored.meta.speech);
 }finally{await closeIsolatedApp(app);fs.rmSync(dir,{recursive:true,force:true,maxRetries:8,retryDelay:250});}
},90000);
