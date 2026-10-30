import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {_electron as electron,type ElectronApplication} from 'playwright-core';
import {expect,it} from 'vitest';
import {closeIsolatedApp} from './lifecycle';
it('unifies delivered desktop speech with dialogue, filters sources, and restores only retained subjects',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'capri-semi-persistent-'));let app:ElectronApplication|undefined;
 fs.writeFileSync(path.join(dir,'settings.json'),JSON.stringify({firstRunComplete:true,ai:{provider:'offline'},memory:{enabled:true,autoLearn:false,honcho:{enabled:false}},character:{startupIntro:false,hideOnFullscreen:false},voice:{ttsEnabled:false},behavior:{smallActivities:false,idleRemarks:false,explore:false,quietHours:{enabled:false}},teleport:{auto:false,effects:false}}));
 const boot=async()=>{app=await electron.launch({...process.env.CAPRI_EXE?{executablePath:process.env.CAPRI_EXE,args:[]}:{args:[path.resolve(__dirname,'../..')]},env:{...process.env,CAPRI_TEST:'1',CAPRI_OFFSCREEN:'1',CAPRI_NO_DEV_KEY:'1',CAPRI_USER_DATA:dir}});await(await app.firstWindow()).waitForFunction(()=>!!(window as any).__capriDebug);return app;};
 try{
  const a=await boot();const first=await a.evaluate(()=>{
   const c=(globalThis as any).__capri;
   c.cognitiveRuntime.observeMessage({id:'u',role:'user',content:'Which mount should we use for reversing loads?',ts:Date.now()});
   c.presentRemark('I prefer the heavier mount because its generous fillet reduces stress concentration.',true,false,undefined,'interaction',undefined,undefined,[],{kind:'generated-direct'});
   c.cognitiveRuntime.observeMessage({id:'dinner',role:'user',content:'Different topic: what should go in an omelet?',ts:Date.now()+1});
   c.presentRemark('Mushrooms and cheddar.',true,false,undefined,'interaction',undefined,undefined,[],{kind:'generated-direct'});
   c.presentRemark('I dislike the subscription tool holding local designs hostage.',true,false,undefined,'interaction',undefined,undefined,['chrome'],{kind:'generated-spontaneous'});
   return {context:c.dialogueCognition.context(),excluded:c.dialogueCognition.context(new Set(['chrome'])),shared:c.sharedSceneContext(),saved:c.cognitiveStore.load('dialogue-cognition')};
  });
  expect(first.context).toContain('generous fillet');expect(first.context).toContain('holding local designs hostage');expect(first.shared).toContain('holding local designs hostage');expect(first.excluded).not.toContain('holding local designs hostage');expect(JSON.stringify(first.saved)).not.toContain('holding local designs hostage');
  await closeIsolatedApp(app);app=undefined;const b=await boot();const restored=await b.evaluate(()=>{const c=(globalThis as any).__capri;const context=c.dialogueCognition.context();c.dialogueCognition.clear();return {context,cleared:c.dialogueCognition.context()};});
  expect(restored.context).toContain('generous fillet');expect(restored.context).not.toContain('holding local designs hostage');expect(restored.cleared).toBe('');
 }finally{await closeIsolatedApp(app);fs.rmSync(dir,{recursive:true,force:true,maxRetries:8,retryDelay:250});}
},45000);
