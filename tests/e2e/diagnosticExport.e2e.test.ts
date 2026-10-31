import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {_electron as electron,type ElectronApplication} from 'playwright-core';
import {expect,it} from 'vitest';
import {closeIsolatedApp} from './lifecycle';

it('exports live evidence and model inputs locally, redacts secrets, handles cancel, and displays the running version',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'capri-diagnostic-e2e-'));
  let app:ElectronApplication|undefined,requests=0;
  const model=http.createServer((req,res)=>{
    if(req.url?.endsWith('/models')){res.end('{"data":[{"id":"fixture"}]}');return;}
    req.resume();req.on('end',()=>{requests++;res.writeHead(200,{'content-type':'text/event-stream'});res.end('data: '+JSON.stringify({choices:[{delta:{content:'The fixture evidence is available.'}}]})+'\n\ndata: [DONE]\n\n');});
  });
  await new Promise<void>(resolve=>model.listen(0,'127.0.0.1',resolve));
  fs.writeFileSync(path.join(dir,'settings.json'),JSON.stringify({firstRunComplete:true,character:{startupIntro:false,hideOnFullscreen:false},ai:{provider:'openai',openai:{baseUrl:`http://127.0.0.1:${(model.address() as any).port}/v1`,model:'fixture'}},memory:{autoLearn:false},dialogue:{localContext:true,contextPings:false,spotifyBanter:false},voice:{ttsEnabled:false},behavior:{smallActivities:false,idleRemarks:false,explore:false,quietHours:{enabled:false}},teleport:{auto:false,effects:false}}));
  try{
    app=await electron.launch({...process.env.CAPRI_EXE?{executablePath:process.env.CAPRI_EXE,args:[]}:{args:[path.resolve(__dirname,'../..')]},env:{...process.env,CAPRI_TEST:'1',CAPRI_OFFSCREEN:'1',CAPRI_NO_DEV_KEY:'1',CAPRI_USER_DATA:dir}});
    const a=app,char=await a.firstWindow();await char.waitForFunction(()=>!!(window as any).__capriDebug);
    await a.evaluate(async()=>{const a=(globalThis as any).__capri;a.secrets.set('openai','diagnostic-fixture-secret');a.memory.add('Diagnostic fixture memory','user');await a.convo.send('What evidence do you have for this diagnostic fixture?');await a.convo.settle();});
    await char.evaluate(()=>(window as any).capri.invoke('panel:open','settings'));
    await expect.poll(()=>a.windows().some(w=>w.url().includes('panel.html'))).toBe(true);
    const panel=a.windows().find(w=>w.url().includes('panel.html'))!;
    await panel.getByRole('heading',{name:'Settings',exact:true}).waitFor();
    const version=await panel.evaluate(()=>(window as any).capri.invoke('app:version'));
    expect(await panel.getByTestId('app-version').textContent()).toContain(version.version);
    const file=path.join(dir,'export.json');
    await a.evaluate(({dialog},file)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:file});},file);
    const before=requests;
    await panel.getByRole('button',{name:'Export diagnostic snapshot',exact:true}).click();
    await expect.poll(()=>fs.existsSync(file)).toBe(true);
    const raw=fs.readFileSync(file,'utf8'),snapshot=JSON.parse(raw);
    expect(snapshot.sections.runtime.version).toBe(version.version);
    expect(snapshot.errors).toEqual({});
    expect(snapshot.sections.connectionInventory.find((c:any)=>c.id==='calendar').status).toBe('not connected');
    expect(snapshot.sections.connectionInventory.some((c:any)=>c.id==='teams-1')).toBe(true);
    expect(snapshot.sections.recentModelTraces.entries.some((e:any)=>e.lane==='direct-chat'&&e.event==='model-input')).toBe(true);
    expect(raw).toContain('Diagnostic fixture memory');expect(raw).not.toContain('diagnostic-fixture-secret');
    expect(snapshot.sections.cognitiveRecords.length).toBeGreaterThan(0);
    expect(requests).toBe(before);
    await a.evaluate(({dialog})=>{dialog.showSaveDialog=async()=>({canceled:true,filePath:''});});
    expect(await panel.evaluate(()=>(window as any).capri.invoke('diagnostics:export'))).toBeNull();
    await panel.getByRole('button',{name:'Developer tools ↗',exact:true}).click();
    await expect.poll(()=>a.windows().some(w=>w.url().endsWith('#developer'))).toBe(true);
    const dev=a.windows().find(w=>w.url().endsWith('#developer'))!;
    await dev.getByRole('heading',{name:'Developer tools',exact:true}).waitFor();
    expect(await dev.getByTestId('app-version').textContent()).toContain(version.version);
    expect(await dev.getByRole('button',{name:'Export diagnostic snapshot',exact:true}).count()).toBe(1);
    if(process.env.CAPRI_DIAGNOSTIC_SCREENSHOT){await panel.screenshot({path:process.env.CAPRI_DIAGNOSTIC_SCREENSHOT});await dev.screenshot({path:process.env.CAPRI_DIAGNOSTIC_SCREENSHOT.replace('.png','-dev.png')});}
    await a.evaluate(async()=>{const a=(globalThis as any).__capri;await a.convo.send('off the record: private diagnostic fixture');await a.convo.settle();});
    const trace=await a.evaluate(()=>(globalThis as any).__capri.buildDiagnosticSnapshot().sections.recentModelTraces);
    expect(trace.entries).toEqual([]);
  }finally{await closeIsolatedApp(app);await new Promise<void>(resolve=>model.close(()=>resolve()));fs.rmSync(dir,{recursive:true,force:true});}
},120000);
