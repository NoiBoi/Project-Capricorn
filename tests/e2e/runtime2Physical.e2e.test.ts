import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {_electron as electron,type ElectronApplication} from 'playwright-core';
import {expect,it} from 'vitest';
import {selectRuntime} from '../../src/main/runtime2/selection';
import {closeIsolatedApp} from './lifecycle';

it('executes local intentions in the real renderer with supported poses, window recovery, reactions and user preemption',async()=>{
  const env={...process.env,CAPRI_RUNTIME:'2',CAPRI_V2_PROFILE_ID:'physical-'+randomUUID(),CAPRI_TEST:'1',CAPRI_OFFSCREEN:'1',CAPRI_NO_DEV_KEY:'1',CAPRI_V2_MODEL:'synthetic',CAPRI_V2_WINDOW_FOCUS:'0'};
  const dir=selectRuntime(env,os.homedir()).profile!;
  const output=process.env.CAPRI_PHYSICAL_OUTPUT;
  fs.mkdirSync(dir,{recursive:true});
  fs.writeFileSync(path.join(dir,'settings.json'),JSON.stringify({firstRunComplete:true,ai:{provider:'offline'},character:{scale:.6,startupIntro:false,hideOnFullscreen:false},voice:{ttsEnabled:false},behavior:{quietHours:{enabled:false},smallActivities:true},actions:{policies:{teleport:'allow'}},teleport:{auto:false,effects:false}}));
  let app:ElectronApplication|undefined;
  try {
    app=await electron.launch({args:[path.resolve(__dirname,'../..')],env});
    const char=await app.firstWindow();await char.waitForFunction(()=>!!(window as any).__capriDebug);
    await app.evaluate(({screen})=>{
      const g=globalThis as any,a=g.__capri,area=screen.getPrimaryDisplay().workArea;
      g.__capriIdleOverride=0;g.__capriWindowHeld=false;g.__capriForegroundHandle=17n;
      g.__capriWindowInfo={'17':{title:'Embodiment fixture',process:'fixture.exe',pid:17}};
      g.__capriWindowsOverride=[{handle:17n,rect:{x:area.x+100,y:area.y+380,width:850,height:350},eligible:true}];
      g.__physicalCalls=0;
      a.runtime2.cognitive.provider={models:async()=>[{id:'synthetic',label:'Synthetic',contextTokens:128000}],shutdown(){},infer:async()=>{g.__physicalCalls++;throw Error('Movement must not invoke inference');}};
    });
    const move=async(target:string,posture='auto',handle?:string)=>app!.evaluate(async(_,{target,posture,handle})=>{
      const a=(globalThis as any).__capri;
      return a.runtime2.cognitive.host.move(target,handle,new AbortController().signal,{target,handle,posture,pace:'gentle'});
    },{target,posture,handle});
    const observations:any[]=[];
    for(const posture of ['sit','stand','lie']) {
      const result=await move('taskbar',posture);expect(result.ok).toBe(true);
      await expect.poll(()=>char.evaluate(()=>({pose:(window as any).__capriDebug.behavior.posture,surface:(window as any).__capriDebug.surface}))).toEqual({pose:posture==='lie'?'recline':posture==='sit'?'sit_edge':'stand',surface:'taskbar'});
      if(posture==='lie')await expect.poll(()=>char.evaluate(()=>(window as any).__capriDebug.model.secondaryRendererState.pose)).toBe('recline');
      const state=await app.evaluate(()=>{const a=(globalThis as any).__capri;return {bounds:a.charWin.getBounds(),body:a.runtime2.cognitive.host.body()};});
      observations.push({posture,result,state});
      if(output){fs.mkdirSync(output,{recursive:true});await char.screenshot({path:path.join(output,posture+'.png')});}
    }
    expect((await move('perch','sit','17')).ok).toBe(true);
    const before=await app.evaluate(()=>{const a=(globalThis as any).__capri;return a.charWin.getBounds();});
    await app.evaluate(()=>{const g=globalThis as any;g.__capriWindowsOverride[0].rect.x+=75;g.__capri.perchTick();});
    await expect.poll(()=>app!.evaluate(()=>{const a=(globalThis as any).__capri;return a.charWin.getBounds().x;}),{timeout:10000}).toBeGreaterThan(before.x+50);
    observations.push({windowMoved:await app.evaluate(()=>{const a=(globalThis as any).__capri;return a.runtime2.cognitive.host.body();})});
    if(output)await char.screenshot({path:path.join(output,'perch.png')});
    await expect.poll(()=>app!.evaluate(()=>(globalThis as any).__capri.runtime2.cognitive.host.body().moving),{timeout:10000}).toBe(false);
    const reaction=await app.evaluate(async()=>{const a=(globalThis as any).__capri;return a.runtime2.cognitive.host.react('curious',new AbortController().signal);});
    expect(reaction.ok).toBe(true);
    await expect.poll(()=>app!.evaluate(()=>{const a=(globalThis as any).__capri;return a.runtime2.cognitive.host.body().reaction?.status;}),{timeout:5000}).toBe('completed');
    observations.push({reaction:await app.evaluate(()=>{const a=(globalThis as any).__capri;return a.runtime2.cognitive.host.body().reaction;})});
    await app.evaluate(()=>{const a=(globalThis as any).__capri;a.interaction('pat');});
    expect(await app.evaluate(()=>(globalThis as any).__capri.physicalBehavior.snapshot().intention)).toBeNull();
    await app.evaluate(()=>{
      const g=globalThis as any,a=g.__capri,b=a.charWin.getBounds();
      const prepare=a.teleporter.d.prepareFlight;g.__originalPrepare=prepare;
      a.teleporter.d.prepareFlight=async(how:any)=>{await prepare(how);await new Promise<void>(resolve=>{g.__releasePrepare=resolve;});};
      g.__pendingPhysical=a.runtime2.cognitive.host.move('left',undefined,new AbortController().signal,{target:'left',posture:'auto',pace:'gentle'}).catch(()=>({ok:false,detail:'Aborted'}));
      g.__capriDragInput={down:true,point:{x:b.x+100,y:b.y+120}};
    });
    await char.evaluate(()=>window.capri.invoke('char:drag','start'));
    await expect.poll(()=>app!.evaluate(()=>!!(globalThis as any).__releasePrepare)).toBe(true);
    await app.evaluate(()=>{const g=globalThis as any;g.__capriDragInput.point.x+=30;g.__releasePrepare();g.__capri.teleporter.d.prepareFlight=g.__originalPrepare;});
    await expect.poll(()=>app!.evaluate(async()=>!(await (globalThis as any).__pendingPhysical).ok)).toBe(true);
    expect(await app.evaluate(()=>(globalThis as any).__capri.physicalBehavior.snapshot().intention)).toBeNull();
    await app.evaluate(()=>{(globalThis as any).__capriDragInput.down=false;});
    await expect.poll(()=>char.evaluate(()=>(window as any).__capriDebug.dragging)).toBe(false);
    await app.evaluate(()=>{const g=globalThis as any;g.__capriWindowsOverride=[];g.__capri.perchTick();});
    await expect.poll(()=>app!.evaluate(()=>(globalThis as any).__capri.runtime2.cognitive.host.body().perchedWindow)).toBeNull();
    const calls=await app.evaluate(()=>(globalThis as any).__physicalCalls);expect(calls).toBe(0);
    if(output)fs.writeFileSync(path.join(output,'renderer-receipts.json'),JSON.stringify({observations,inferenceCalls:calls},null,2));
  } finally {
    await closeIsolatedApp(app);
    if(path.dirname(dir)!==path.join(os.homedir(),'Documents','Capri Buddy 2.0 Synthetic'))throw Error('Unexpected synthetic profile');
    fs.rmSync(dir,{recursive:true,force:true,maxRetries:5,retryDelay:100});
  }
});
