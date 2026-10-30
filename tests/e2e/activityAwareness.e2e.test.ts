import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {_electron as electron,type ElectronApplication} from 'playwright-core';
import {expect,it} from 'vitest';
import {closeIsolatedApp} from './lifecycle';
import {noonDay} from '../../src/shared/activityPatterns';
it('shares compact local routines with source provenance, exposes opt-in controls, and forgets derived context on clear/disable/restart',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'capri-activity-'));let app:ElectronApplication|undefined;
 fs.writeFileSync(path.join(dir,'settings.json'),JSON.stringify({firstRunComplete:true,privacy:{activityAwareness:{enabled:true,retentionDays:60}},ai:{provider:'offline'},memory:{enabled:true,autoLearn:false,honcho:{enabled:false}},character:{startupIntro:false,hideOnFullscreen:false},voice:{ttsEnabled:false},behavior:{smallActivities:false,idleRemarks:false,explore:false,quietHours:{enabled:false}},teleport:{auto:false,effects:false}}));
 fs.writeFileSync(path.join(dir,'activity-usage.json'),JSON.stringify({version:1,days:Array.from({length:30},(_,n)=>({day:noonDay(Date.now(),-n-1),first:540,last:960,endConfirmed:true,active:18000,idle:5000,observed:32400,hours:Array.from({length:24},(_,h)=>h<4?1800:0),sessions:[],breaks:[]}))}));
 const boot=async()=>{app=await electron.launch({...process.env.CAPRI_EXE?{executablePath:process.env.CAPRI_EXE,args:[]}:{args:[path.resolve(__dirname,'../..')]},env:{...process.env,CAPRI_TEST:'1',CAPRI_OFFSCREEN:'1',CAPRI_NO_DEV_KEY:'1',CAPRI_USER_DATA:dir}});await(await app.firstWindow({timeout:12000})).waitForFunction(()=>!!(window as any).__capriDebug);return app;};
 try{
  const a=await boot();const initial=await a.evaluate(()=>{const c=(globalThis as any).__capri;const messages=c.convo.buildMessages('What are my late-night PC habits?');return {prompt:messages[0].content,sources:c.convo.d.contextSources(),summary:c.interactionProfile.activitySummary()};});
  expect(initial.summary.month.days).toBe(30);expect(initial.prompt).toContain('OBSERVED PC ROUTINE');expect(initial.prompt).toContain('04:00');expect(initial.prompt).not.toContain('"hours":[');expect(initial.sources).toContain('activity-patterns');
  await a.evaluate(()=>{const c=(globalThis as any).__capri;c.presentRemark('You have an unusually late observed computer rhythm.',true,false,undefined,'interaction',undefined,undefined,['activity-patterns'],{kind:'generated-direct'});});
  const char=await a.firstWindow();await char.evaluate(()=>window.capri.invoke('panel:open','privacy'));await expect.poll(()=>a.windows().some(w=>w.url().includes('panel.html'))).toBe(true);const panel=a.windows().find(w=>w.url().includes('panel.html'))!;panel.setDefaultTimeout(10000);
  await expect.poll(()=>panel.getByRole('switch',{name:'Remember computer activity patterns'}).count(),{timeout:15000}).toBe(1);
  expect(await panel.getByRole('switch',{name:'Remember computer activity patterns'}).isChecked()).toBe(true);
  await panel.getByRole('button',{name:'Clear activity history',exact:true}).click();
  const cleared=await a.evaluate(()=>{const c=(globalThis as any).__capri;return {summary:c.interactionProfile.activitySummary(),prompt:c.convo.buildMessages('my routine')[0].content,scene:c.conversationScene.snapshot()};});
  expect(cleared.summary.daysObserved).toBe(0);expect(cleared.prompt).not.toContain('OBSERVED PC ROUTINE');expect(JSON.stringify(cleared.scene)).not.toContain('unusually late observed');
  await panel.getByRole('switch',{name:'Remember computer activity patterns'}).uncheck();
  await expect.poll(()=>a.evaluate(()=>(globalThis as any).__capri.settings.get().privacy.activityAwareness.enabled)).toBe(false);
  expect(fs.existsSync(path.join(dir,'activity-usage.json'))).toBe(false);
  await closeIsolatedApp(app);app=undefined;const b=await boot();expect(await b.evaluate(()=>(globalThis as any).__capri.convo.buildMessages('my late-night routine')[0].content)).not.toContain('OBSERVED PC ROUTINE');
 }finally{await closeIsolatedApp(app);fs.rmSync(dir,{recursive:true,force:true,maxRetries:8,retryDelay:250});}
},45000);
