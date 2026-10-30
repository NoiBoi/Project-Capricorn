import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { _electron as electron, type ElectronApplication } from 'playwright-core';
import { expect,it } from 'vitest';
import { closeIsolatedApp } from './lifecycle';

it('keeps a natural twenty-minute window intention through same/cross-window handling, recreation and accelerated expiry',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'capri-reliable-'));let app:ElectronApplication|undefined;
 fs.writeFileSync(path.join(dir,'settings.json'),JSON.stringify({firstRunComplete:true,ai:{provider:'offline'},memory:{autoLearn:false},character:{startupIntro:false,hideOnFullscreen:false},voice:{ttsEnabled:false},behavior:{smallActivities:false,idleRemarks:false,explore:false,quietHours:{enabled:false}},teleport:{auto:false,effects:false}}));
 try{
  app=await electron.launch({...process.env.CAPRI_EXE?{executablePath:process.env.CAPRI_EXE,args:[]}:{args:[path.resolve(__dirname,'../..')]},env:{...process.env,CAPRI_TEST:'1',CAPRI_OFFSCREEN:'1',CAPRI_NO_DEV_KEY:'1',CAPRI_USER_DATA:dir}});
  const page=await app.firstWindow();await page.waitForFunction(()=>!!(window as any).__capriDebug);
  const before=await app.evaluate(async()=>{
   const g=globalThis as any,a=g.__capri;g.__capriIdleOverride=0;
   g.__capriWindowsOverride=[{handle:42001n,rect:{x:120,y:220,width:1000,height:550},eligible:true}];g.__capriWindowInfo={'42001':{title:'Discord',process:'Discord.exe',pid:42}};
   await a.convo.send('Move to Discord and perch or lie down for 20 minutes, your choice');await a.convo.settle();
   const i=a.agency.active('stay_at_window')[0];if(!i)throw Error(a.history.recent(1)[0].content);
   return {i,bounds:a.charWin.getBounds(),reply:a.history.recent(1)[0].content};
  });
  expect(before.i.state).toBe('active');expect(before.reply).toContain('settled on Discord');expect(before.i.deadline-before.i.startAt).toBe(1200000);
  async function carryTo(point:{x:number;y:number},release=true){
   await app!.evaluate(()=>{const g=globalThis as any,b=g.__capri.charWin.getBounds();g.__capriDragInput={down:true,point:{x:b.x+100,y:b.y+100}};});
   await page.evaluate(()=>window.capri.invoke('char:drag','start'));
   await app!.evaluate((_e,p)=>{(globalThis as any).__capriDragInput.point={x:p.x+100,y:p.y+100};},point);
   await page.waitForTimeout(100);
   if(release){await app!.evaluate(()=>{(globalThis as any).__capriDragInput.down=false;});await page.evaluate(()=>window.capri.invoke('char:drag','end'));}
  }
  await carryTo({x:before.bounds.x+75,y:before.bounds.y});
  await page.waitForTimeout(2200);
  const same=await app.evaluate(()=>{const a=(globalThis as any).__capri;return {i:a.agency.active('stay_at_window')[0],b:a.charWin.getBounds()};});
  expect(same.i.state).toBe('active');expect(same.b.x).toBe(before.bounds.x+75);expect(same.i.input.position.x).toBe(same.b.x);expect(same.i.deadline).toBe(before.i.deadline);
  const other=await app.evaluate(()=>{const g=globalThis as any,a=g.__capri,w={handle:42003n,rect:{x:1400,y:300,width:900,height:550},eligible:true};g.__capriWindowsOverride.push(w);g.__capriWindowInfo['42003']={title:'Other Window',process:'Notepad.exe',pid:44};return a.placement(w).bounds;});
  await carryTo(other,false);
  await app.evaluate(()=>{const a=(globalThis as any).__capri;a.maintainAgency();a.agency.tick();});
  expect(await app.evaluate(()=>(globalThis as any).__capri.charWin.getBounds().x)).toBe(other.x);
  await app.evaluate(()=>{(globalThis as any).__capriDragInput.down=false;});await page.evaluate(()=>window.capri.invoke('char:drag','end'));
  await expect.poll(()=>app!.evaluate(()=>{const a=(globalThis as any).__capri;return a.agency.active('stay_at_window')[0]?.receipts.at(-1)?.detail;}),{timeout:8000}).toMatch(/arrival/);
  expect(await app.evaluate(()=>{const a=(globalThis as any).__capri;return a.charWin.getBounds().x;})).not.toBe(other.x);
  const recreated=await app.evaluate(async()=>{
   const g=globalThis as any,a=g.__capri;g.__capriWindowsOverride[0].handle=42002n;g.__capriWindowInfo['42002']={title:'Discord',process:'Discord.exe',pid:43};a.maintainAgency();a.agency.tick();
   for(let n=0;n<100&&a.agency.active('stay_at_window')[0]?.state!=='active';n++)await new Promise(r=>setTimeout(r,30));
   const i=a.agency.active('stay_at_window')[0];const sleep=a.company.stayState(i.startAt+121000),near=a.company.stayState(i.deadline-30000);
   a.agency.now=()=>i.deadline+1;a.agency.tick();return {target:i.input.target,state:a.agency.get(i.id).state,sleep,near};
  });
  expect(recreated.target.handle).toBe('42002');expect(recreated.state).toBe('completed');expect(recreated.sleep.phase).toBe('sleep');expect(recreated.near.phase).toBe('awake');expect(recreated.near.reminderDue).toBe(true);
  const indefinite=await app.evaluate(async()=>{
   const a=(globalThis as any).__capri;a.agency.now=Date.now;
   await a.convo.send('go to discord and chill there until i say so.');await a.convo.settle();
   const i=a.agency.active('stay_at_window')[0];
   return {state:i?.state,deadline:i?.deadline,receipt:i?.receipts.at(-1),reply:a.history.recent(1)[0]};
  });
  expect(indefinite.state).toBe('active');expect(indefinite.deadline).toBeUndefined();expect(indefinite.receipt.verified).toBe(true);expect(indefinite.reply.meta.provider).toBe('companion');expect(indefinite.reply.content).toContain('settled on Discord');
 }finally{await closeIsolatedApp(app);fs.rmSync(dir,{recursive:true,force:true,maxRetries:5,retryDelay:100});}
},45000);
