import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn,type ChildProcess,execFileSync } from 'node:child_process';
import { _electron as electron,type ElectronApplication } from 'playwright-core';
import { expect,it } from 'vitest';
import { closeIsolatedApp } from './lifecycle';

it('executes the acceptance command offline with native arrival, quiet ownership, recovery, cancellation and timers',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'capri-agency-runtime-'));let app:ElectronApplication|undefined;
  fs.writeFileSync(path.join(dir,'settings.json'),JSON.stringify({firstRunComplete:true,ai:{provider:'offline'},character:{startupIntro:false,hideOnFullscreen:false},voice:{ttsEnabled:false},behavior:{smallActivities:false,idleRemarks:false,explore:false,quietHours:{enabled:false}},teleport:{auto:false,effects:false}}));
  async function boot(){app=await electron.launch({...process.env.CAPRI_EXE?{executablePath:process.env.CAPRI_EXE,args:[]}:{args:[path.resolve(__dirname,'../..')]},env:{...process.env,CAPRI_TEST:'1',CAPRI_OFFSCREEN:'1',CAPRI_NO_DEV_KEY:'1',CAPRI_USER_DATA:dir}});const page=await app.firstWindow();await page.waitForFunction(()=>!!(window as any).__capriDebug);return app;}
  try{
    const first=await boot();
    const arrival=await first.evaluate(async()=>{
      const g=globalThis as any,a=g.__capri;
      g.__capriIdleOverride=0;g.__capriWindowsOverride=[{handle:8001n,rect:{x:160,y:200,width:1000,height:550},eligible:true}];g.__capriWindowInfo={'8001':{title:'Codex',process:'Codex.exe'}};
      await a.convo.send('go lay in the codex window for 30 min while i finish my hw. i need to lock in');await a.convo.settle();
      const i=a.agency.active('stay_at_window')[0],b=a.charWin.getBounds();
      return {state:i?.state,deadline:i?.deadline,quiet:a.company.focused(),held:a.company.staying,receipt:i?.receipts.at(-1),bounds:{x:b.x,y:b.y},reply:a.history.recent(1)[0].content,auto:a.teleporter.status().armed};
    });
    expect(arrival.state).toBe('active');expect(arrival.held).toBe(true);expect(arrival.quiet).toBe(true);expect(arrival.receipt?.verified).toBe(true);expect(arrival.bounds).toEqual(arrival.receipt?.position);expect(arrival.auto).toBe(false);expect(arrival.reply).toContain('settled on Codex');
    await first.evaluate(({powerMonitor})=>{powerMonitor.emit('suspend');});
    expect(await first.evaluate(()=>(globalThis as any).__capri.agency.active('stay_at_window')[0]?.state)).toBe('recovering');
    await first.evaluate(({powerMonitor})=>{powerMonitor.emit('resume');});
    await expect.poll(()=>first.evaluate(()=>(globalThis as any).__capri.agency.active('stay_at_window')[0]?.state)).toBe('active');
    const moved=await first.evaluate(async()=>{
      const g=globalThis as any,a=g.__capri;g.__capriWindowsOverride[0].rect={x:240,y:230,width:900,height:500};a.maintainAgency();a.agency.tick();
      for(let n=0;n<100&&a.agency.active('stay_at_window')[0]?.state!=='active';n++)await new Promise(r=>setTimeout(r,50));
      return {state:a.agency.active('stay_at_window')[0]?.state,bounds:a.charWin.getBounds(),deadline:a.agency.active('stay_at_window')[0]?.deadline};
    });
    expect(moved.state).toBe('active');expect(moved.deadline).toBe(arrival.deadline);expect(moved.bounds.x).not.toBe(arrival.bounds.x);
    const failed=await first.evaluate(async()=>{
      const g=globalThis as any,a=g.__capri;g.__capriWindowsOverride=[];a.maintainAgency();a.agency.tick();
      for(let n=0;n<120&&a.agency.active('stay_at_window').length;n++)await new Promise(r=>setTimeout(r,50));
      return {held:a.company.staying,state:a.agency.list().find((i:any)=>i.skill==='stay_at_window').state,reply:a.history.recent(1)[0].content};
    });
    expect(failed.held).toBe(false);expect(failed.state).toBe('failed');expect(failed.reply).toMatch(/exact window|exposed edge/);
    const retry=await first.evaluate(async()=>{
      const g=globalThis as any,a=g.__capri;g.__capriWindowsOverride=[{handle:8001n,rect:{x:160,y:200,width:1000,height:550},eligible:true}];
      const i=a.agency.list().find((i:any)=>i.skill==='stay_at_window');await a.agency.retry(i.id);return a.agency.get(i.id).state;
    });expect(retry).toBe('active');
    const override=await first.evaluate(async()=>{
      const a=(globalThis as any).__capri;await a.applyCompanyControl({kind:'stay',minutes:5});return {old:a.agency.list().find((i:any)=>i.skill==='stay_at_window').state,hold:a.agency.active('hold_position')[0]?.state};
    });expect(override).toEqual({old:'cancelled',hold:'active'});
    await first.evaluate(async()=>{const a=(globalThis as any).__capri;await a.applyCompanyControl({kind:'cancel_intentions'});await a.convo.send('set a 5 minute timer');await a.convo.settle();});
    const before=await first.evaluate(()=>{const a=(globalThis as any).__capri;return {timer:a.reminders.active().find((r:any)=>r.id.startsWith('intent:')),checkpoint:a.cognitiveStore.load('agency-v1')};});
    expect(before.timer).toBeDefined();expect(before.checkpoint.snapshots).toBeDefined();
    await closeIsolatedApp(app);app=undefined;const second=await boot();
    const restored=await second.evaluate(async()=>{const a=(globalThis as any).__capri;for(let n=0;n<40&&!a.agency.active('timer').some((i:any)=>i.state==='active');n++)await new Promise(r=>setTimeout(r,25));return {timers:a.reminders.active(),intentions:a.agency.list()};});
    expect(restored.timers.filter((r:any)=>r.id===before.timer.id)).toHaveLength(1);expect(restored.timers.find((r:any)=>r.id===before.timer.id).dueAt).toBe(before.timer.dueAt);
    expect(restored.intentions.find((i:any)=>i.skill==='timer').state).toBe('active');
  }finally{await closeIsolatedApp(app);fs.rmSync(dir,{recursive:true,force:true});}
},60000);

it('restores a stay against the same real external window after a full Capri restart',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'capri-agency-restart-'));let app:ElectronApplication|undefined,helper:ChildProcess|undefined;
  fs.writeFileSync(path.join(dir,'settings.json'),JSON.stringify({firstRunComplete:true,ai:{provider:'offline'},character:{startupIntro:false,hideOnFullscreen:false},voice:{ttsEnabled:false},behavior:{smallActivities:false,idleRemarks:false,quietHours:{enabled:false}},teleport:{auto:false,effects:false}}));
  async function boot(){app=await electron.launch({...process.env.CAPRI_EXE?{executablePath:process.env.CAPRI_EXE,args:[]}:{args:[path.resolve(__dirname,'../..')]},env:{...process.env,CAPRI_TEST:'1',CAPRI_OFFSCREEN:'1',CAPRI_NO_DEV_KEY:'1',CAPRI_USER_DATA:dir}});await (await app.firstWindow()).waitForFunction(()=>!!(window as any).__capriDebug);return app;}
  try{
    const first=await boot(),ready=path.join(dir,'helper-ready');
    const script=path.join(dir,'native-fixture.cjs');
    fs.writeFileSync(script,`const {app,BrowserWindow,screen}=require('electron');const fs=require('node:fs');app.setPath('userData',${JSON.stringify(path.join(dir,'helper-profile'))});let w;app.whenReady().then(async()=>{const a=screen.getPrimaryDisplay().workArea;w=new BrowserWindow({x:a.x,y:a.y,width:a.width,height:a.height,show:false,title:'Capri Persistent Native Fixture'});await w.loadURL('data:text/html,<title>Capri Persistent Native Fixture</title>');w.setAlwaysOnTop(true,'screen-saver');w.showInactive();fs.writeFileSync(${JSON.stringify(ready)},'ready');});`);
    const env:NodeJS.ProcessEnv={...process.env,CAPRI_USER_DATA:path.join(dir,'helper-profile')};delete env.ELECTRON_RUN_AS_NODE;const fixtureExe=path.resolve(__dirname,'../../node_modules/electron/dist/electron.exe');helper=spawn(fixtureExe,[script],{env,windowsHide:true,stdio:'ignore'});
    await expect.poll(()=>fs.existsSync(ready),{timeout:15000}).toBe(true);await new Promise(r=>setTimeout(r,300));
    const before=await first.evaluate(async()=>{const a=(globalThis as any).__capri;const reply=await a.applyCompanyControl({kind:'stay',target:'Capri Persistent Native Fixture',minutes:30,posture:'lie',quiet:true});const i=a.agency.active('stay_at_window')[0];if(!i)throw Error(reply);return i;});
    expect(before?.state).toBe('active');
    await first.evaluate(()=>{const g=globalThis as any,a=g.__capri;a.agency.beginHandling();g.__capriVisits.recordDragOrigin();const b=a.charWin.getBounds();a.charWin.setBounds({...b,x:b.x+50});a.settleAfterDrop();});
    await expect.poll(()=>first.evaluate(()=>(globalThis as any).__capri.agency.handling()),{timeout:5000}).toBe(false);
    const manual=await first.evaluate(()=>{const a=(globalThis as any).__capri;return {i:a.agency.active('stay_at_window')[0],b:a.charWin.getBounds()};});
    expect(manual.i.receipts.at(-1).detail).toContain('Accepted user resting');
    await closeIsolatedApp(app);app=undefined;
    const second=await boot();await expect.poll(()=>second.evaluate(()=>{const a=(globalThis as any).__capri;return a.agency.active('stay_at_window')[0]?.state;}),{timeout:10000}).toBe('active');
    const after=await second.evaluate(()=>{const a=(globalThis as any).__capri;return {i:a.agency.active('stay_at_window')[0],quiet:a.company.focused(),bounds:a.charWin.getBounds()};});
    expect(after.i.id).toBe(before.id);expect(after.i.deadline).toBe(before.deadline);expect(after.i.input.target.pid).toBe(before.input.target.pid);expect(after.quiet).toBe(true);expect(after.i.receipts.length).toBeGreaterThan(before.receipts.length);
    expect(after.i.input.anchor).toEqual(manual.i.input.anchor);expect(Math.abs(after.bounds.x-manual.b.x)).toBeLessThanOrEqual(3);
  }finally{
    await closeIsolatedApp(app);
    if(helper?.pid&&helper.exitCode===null){try{execFileSync('taskkill',['/PID',String(helper.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});}catch{}}
    fs.rmSync(dir,{recursive:true,force:true,maxRetries:5,retryDelay:100});
  }
},60000);

it('enumerates and places on an actual unfocused native window without metadata overrides',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'capri-agency-native-'));let app:ElectronApplication|undefined;
  fs.writeFileSync(path.join(dir,'settings.json'),JSON.stringify({firstRunComplete:true,ai:{provider:'offline'},character:{startupIntro:false,hideOnFullscreen:false},voice:{ttsEnabled:false},behavior:{smallActivities:false,idleRemarks:false,quietHours:{enabled:false}},teleport:{auto:false,effects:false}}));
  try{
    app=await electron.launch({...process.env.CAPRI_EXE?{executablePath:process.env.CAPRI_EXE,args:[]}:{args:[path.resolve(__dirname,'../..')]},env:{...process.env,CAPRI_TEST:'1',CAPRI_OFFSCREEN:'1',CAPRI_NO_DEV_KEY:'1',CAPRI_USER_DATA:dir}});
    await (await app.firstWindow()).waitForFunction(()=>!!(window as any).__capriDebug);
    const result=await app.evaluate(async({BrowserWindow,screen})=>{
      const a=(globalThis as any).__capri,area=screen.getPrimaryDisplay().workArea;
      const target=new BrowserWindow({x:area.x,y:area.y,width:area.width,height:area.height,show:false,title:'Capri Agency Native Fixture',webPreferences:{sandbox:true}});
      try{
        await target.loadURL('data:text/html,<title>Capri Agency Native Fixture</title><p>Isolated native window fixture</p>');target.setAlwaysOnTop(true,'screen-saver');target.showInactive();await new Promise(r=>setTimeout(r,300));
        const resolved=a.agencyHost.resolve('Capri Agency Native Fixture');
        await a.convo.send('go to Capri Agency Native Fixture and chill there until i say so.');await a.convo.settle();
        const reply=a.history.recent(1)[0].content;
        const i=a.agency.active('stay_at_window')[0],initial={resolved,reply,state:i?.state,receipt:i?.receipts.at(-1),bounds:a.charWin.getBounds(),debug:{native:target.getBounds(),windows:a.desktopWindows().map((w:any)=>({handle:String(w.handle),rect:w.rect,eligible:w.eligible})),displays:screen.getAllDisplays().map(d=>({bounds:d.bounds,workArea:d.workArea,scale:d.scaleFactor}))}};
        if(i?.state==='active'){
          for(const display of screen.getAllDisplays()) {
            const d=display.workArea;target.setBounds({x:d.x,y:d.y,width:d.width,height:d.height});await new Promise(r=>setTimeout(r,300));a.maintainAgency();a.agency.tick();
            for(let n=0;n<100&&a.agency.active('stay_at_window')[0]?.state!=='active';n++)await new Promise(r=>setTimeout(r,25));
            if(a.agency.active('stay_at_window')[0]?.state!=='active')throw Error('Native monitor transition failed: '+JSON.stringify({display:{id:display.id,bounds:display.bounds,scale:display.scaleFactor},intentions:a.agency.list(),native:target.getBounds(),bounds:a.charWin.getBounds(),windows:a.desktopWindows().map((w:any)=>({handle:String(w.handle),rect:w.rect}))}));
          }
        }
        return initial;
      }finally{target.destroy();}
    });
    expect(result.resolved.pid).toBeGreaterThan(0);expect(result.state,JSON.stringify(result)).toBe('active');expect(result.receipt.verified).toBe(true);expect(result.bounds.x).toBe(result.receipt.position.x);expect(result.bounds.y).toBe(result.receipt.position.y);
  }finally{await closeIsolatedApp(app);fs.rmSync(dir,{recursive:true,force:true});}
},60000);
