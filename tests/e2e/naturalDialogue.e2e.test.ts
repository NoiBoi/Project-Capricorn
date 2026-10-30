import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {_electron as electron,type ElectronApplication} from 'playwright-core';
import {it,expect} from 'vitest';
import {closeIsolatedApp} from './lifecycle';
it('keeps routine contact physical and admits one contextual thought without a paired catalog line',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'capri-natural-'));let app:ElectronApplication|undefined;
 fs.writeFileSync(path.join(dir,'settings.json'),JSON.stringify({firstRunComplete:true,character:{startupIntro:false,hideOnFullscreen:false},ai:{provider:'ollama'},voice:{ttsEnabled:false,interactionLines:true},memory:{autoLearn:false,honcho:{enabled:false}},behavior:{smallActivities:false,idleRemarks:false,explore:false,quietHours:{enabled:false}},teleport:{auto:false,effects:false}}));
 try{
  app=await electron.launch({...process.env.CAPRI_EXE?{executablePath:process.env.CAPRI_EXE,args:[]}:{args:[path.resolve(__dirname,'../..')]},env:{...process.env,CAPRI_TEST:'1',CAPRI_OFFSCREEN:'1',CAPRI_NO_DEV_KEY:'1',CAPRI_USER_DATA:dir}});
  const char=await app.firstWindow();await char.waitForFunction(()=>!!(window as any).__capriDebug);
  await app.evaluate(()=>{
   const g=globalThis as any,a=g.__capri;g.__capriIdleOverride=0;g.__naturalCalls=0;g.__physical=0;
   const send=a.charWin.webContents.send.bind(a.charWin.webContents);a.charWin.webContents.send=(channel:string,...args:any[])=>{if(args[0]?.type==='life')g.__physical++;return send(channel,...args);};
   a.behavior.d.provider={name:'mock',local:true,async *stream(){g.__naturalCalls++;if(g.__naturalCalls===3)await new Promise(r=>setTimeout(r,1500));yield JSON.stringify({interpretation:'The panel relates to the ongoing movement discussion.',interest:null,action:'speak',line:g.__naturalCalls===1?'I was starting to settle here. Keep going, though.':g.__naturalCalls===3?'You keep moving the seat just as I get comfortable. Leave me this corner for a minute.':'I prefer room to move. That corner leaves the page clear.',gesture:'nod',reason:'A concrete preference about the movement under discussion.'});}};
   a.interaction('pat');a.pickupReaction();a.reactToOwnPanel('settings');
  });
  await char.waitForTimeout(1100);
  expect(await app.evaluate(()=>({calls:(globalThis as any).__naturalCalls,physical:(globalThis as any).__physical,lines:(globalThis as any).__capri.scenes.recent().filter((s:any)=>s.kind==='said').length}))).toMatchObject({calls:0,lines:0});
  await app.evaluate(()=>{const a=(globalThis as any).__capri;a.interaction('poke');a.interaction('pat');});
  await char.waitForTimeout(1300);
  expect(await app.evaluate(()=>(globalThis as any).__naturalCalls)).toBe(1);
  await app.evaluate(async()=>{
   const g=globalThis as any,a=g.__capri;a.cognitiveRuntime.observeMessage({id:'engaged',role:'user',content:'Keep the new movement but leave enough room for my work.',ts:Date.now()});a.observeAgency();
   await a.generatedRemark('own_panel','The user opened the movement settings during this exchange. No setting changed.');
   await a.generatedRemark('own_panel','The user navigated the same panel.');
  });
  expect(await app.evaluate(()=>({calls:(globalThis as any).__naturalCalls,lines:(globalThis as any).__capri.history.recent(10).filter((s:any)=>s.role==='assistant').map((s:any)=>s.meta?.speech?.kind)}))).toEqual({calls:2,lines:['generated-spontaneous','generated-spontaneous']});
  await app.evaluate(async()=>{const a=(globalThis as any).__capri;a.settings.update({behavior:{doNotDisturb:true}});await a.generatedRemark('pat');a.reactToOwnPanel('developer');});
  expect(await app.evaluate(()=>(globalThis as any).__naturalCalls)).toBe(2);
  await app.evaluate(()=>{
    const g=globalThis as any,a=g.__capri;a.settings.update({behavior:{doNotDisturb:false}});a.cognitiveRuntime.clear();
    g.__capriWindowsOverride=[{handle:17n,rect:{x:100,y:380,width:900,height:600}}];g.__capriWindowInfo={'17':{title:'Placement fixture',process:'fixture.exe'}};
    const w=g.__capriWindowsOverride[0];a.charWin.setBounds(a.placement(w).bounds);a.settleAfterDrop();
    g.__capriVisits.recordDragOrigin();const b=a.charWin.getBounds();a.charWin.setBounds({...b,x:b.x+65});a.settleAfterDrop();
  });
  await char.waitForTimeout(1300); await app.evaluate(()=>(globalThis as any).__capri.presenceTick()); await char.waitForTimeout(1800);
  expect(await app.evaluate(()=>(globalThis as any).__naturalCalls)).toBe(3); // One final decision for the settled relocation burst, without prior chat.
  await expect.poll(()=>app!.evaluate(()=>(globalThis as any).__capri.lastDialogueOutcome),{timeout:5000}).toContain('putdown: speak');
  expect(await app.evaluate(()=>(globalThis as any).__capri.dialogueCognition.context())).toContain('Leave me this corner');
 }finally{await closeIsolatedApp(app);fs.rmSync(dir,{recursive:true,force:true,maxRetries:8,retryDelay:100});}
});
