import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { _electron as electron, type ElectronApplication } from 'playwright-core';
import { afterEach, expect, it } from 'vitest';
import { closeIsolatedApp } from './lifecycle';
let app:ElectronApplication|undefined, server:http.Server|undefined;
const dirs:string[]=[], root=path.resolve(__dirname,'../..');
afterEach(async()=>{await closeIsolatedApp(app);app=undefined;server?.closeAllConnections();if(server)await new Promise<void>(r=>server!.close(()=>r()));server=undefined;for(const dir of dirs.splice(0))fs.rmSync(dir,{recursive:true,force:true,maxRetries:5,retryDelay:100});});
async function boot(dir?:string){
  const requests:any[]=[];
  server=http.createServer((req,res)=>{if(req.url?.endsWith('/models')){res.end('{"data":[{"id":"fixture"}]}');return;}let raw='';req.on('data',c=>raw+=c);req.on('end',()=>{const body=JSON.parse(raw);requests.push(body);const decision=body.messages[0].content.includes('Choose one desktop-companion decision');const text=decision?JSON.stringify({interpretation:'A current approved documentation detail relates to the selected project.',interest:null,action:'speak',line:'That API split gives ArborCalc some breathing room.',gesture:'none',reason:'Specific opinion about supplied evidence.'}):'The displayed ArborCalc documentation covers fitting constraints. That is evidence of an open page, not a completed implementation.';setTimeout(()=>{if(res.destroyed)return;res.writeHead(200,{'content-type':'text/event-stream'});res.end('data: '+JSON.stringify({choices:[{delta:{content:text}}]})+'\n\ndata: [DONE]\n\n');},decision?1000:20);});});
  await new Promise<void>(r=>server!.listen(0,'127.0.0.1',r));
  if(!dir){dir=fs.mkdtempSync(path.join(os.tmpdir(),'capri-life-e2e-'));dirs.push(dir);fs.writeFileSync(path.join(dir,'settings.json'),JSON.stringify({firstRunComplete:true,character:{startupIntro:false,hideOnFullscreen:false},ai:{provider:'openai',openai:{baseUrl:`http://127.0.0.1:${(server.address() as any).port}/v1`,model:'fixture'}},memory:{autoLearn:false},dialogue:{localContext:true,contextPings:false,spotifyBanter:false},voice:{ttsEnabled:false,interactionLines:true},behavior:{smallActivities:false,idleRemarks:false,explore:false,quietHours:{enabled:false}},teleport:{auto:false,effects:false}}));}
  app=await electron.launch({...(process.env.CAPRI_EXE?{executablePath:process.env.CAPRI_EXE,args:[]}:{args:[root]}),env:{...process.env,CAPRI_TEST:'1',CAPRI_OFFSCREEN:'1',CAPRI_NO_DEV_KEY:'1',CAPRI_USER_DATA:dir}});
  const char=await app.firstWindow();await char.waitForFunction(()=>!!(window as any).__capriDebug);
  await app.evaluate(()=>{(globalThis as any).__capriIdleOverride=0;(globalThis as any).__capriDesktopOverride={title:'Fixture editor',process:'fixture.exe'};});
  return{app,dir,requests,char};
}
async function evidence(a:ElectronApplication){await a.evaluate(()=>{const a=(globalThis as any).__capri;const source=a.life.ledger.source('chrome');a.life.configure({...source,sites:['https://docs.example.com'],permissions:{collect:true,live:true,retain:true,content:false,learn:false}});a.life.ledger.associate({id:'arbor',name:'ArborCalc',aliases:['Arbor numerical tools','docs.example.com'],evidence:'Explicit test-user aliases',certainty:'explicit'});const at=Date.now();a.life.ledger.ingest({source:'chrome',recordId:'active-page',revision:at,type:'displayed-page',occurredAt:at,receivedAt:at,expiresAt:at+90000,entities:['arbor'],quality:'observed',permissions:source.permissions={collect:true,live:true,retain:true,content:false,learn:false},summary:'ArborCalc documentation',detail:'API headings: fitting constraints and bounded parameter domains.',operation:'upsert',importance:.7});});}
it('shows controls and evidence, shares semantic context in chat, then revokes every automatic recall path while retaining Chat',async()=>{
  const {app:a,requests,char}=await boot();await evidence(a);
  await char.evaluate(()=>(window as any).capri.invoke('panel:open','connections'));
  await expect.poll(()=>a.windows().some(w=>w.url().includes('panel.html'))).toBe(true);
  const panel=a.windows().find(w=>w.url().includes('panel.html'))!;
  await expect.poll(()=>panel.getByRole('heading',{name:'Connections / Life Context'}).count()).toBe(1);
  expect(await panel.getByRole('switch',{name:'Chrome: Collect observations'}).isChecked()).toBe(true);
  expect(await panel.getByText('ArborCalc documentation',{exact:true}).count()).toBeGreaterThan(0);
  expect(await panel.locator('.scroll').evaluate(el=>el.scrollHeight>el.clientHeight)).toBe(true);
  if(process.env.CAPRI_LIFE_SCREENSHOT)await panel.screenshot({path:process.env.CAPRI_LIFE_SCREENSHOT});
  await a.evaluate(async()=>{const a=(globalThis as any).__capri;await a.convo.send('What is displayed for Arbor numerical tools?');await a.convo.settle();});
  const chat=requests.find(r=>!r.messages[0].content.includes('Choose one desktop-companion decision'));
  expect(chat.messages[0].content).toContain('LIFE CONTEXT EVIDENCE');expect(chat.messages[0].content).toContain('fitting constraints');expect(chat.messages[0].content).toContain('LASTING CAPRI GUIDE');
  expect(await a.evaluate(()=>(globalThis as any).__capri.history.recent(1)[0].meta.contextSources)).toEqual(['chrome']);
  await panel.locator('section.group').filter({has:panel.getByText('Chrome',{exact:true})}).getByRole('button',{name:'Disconnect and forget',exact:true}).click();
  expect(await a.evaluate(()=>(globalThis as any).__capri.life.ledger.current())).toEqual([]);
  const retained = await a.evaluate(()=>(globalThis as any).__capri.conversationScene.snapshot().entries);
  expect(retained.map((e:any)=>e.role)).toEqual(['user']);
  expect(retained[0].text).toBe('What is displayed for Arbor numerical tools?');
  await a.evaluate(async()=>{const a=(globalThis as any).__capri;await a.convo.send('Hello again.');await a.convo.settle();});
  expect(requests.at(-1).messages[0].content).not.toContain('LIFE CONTEXT EVIDENCE');
  expect(JSON.stringify(requests.at(-1).messages)).not.toContain('API headings: fitting constraints');
  expect(await a.evaluate(()=>(globalThis as any).__capri.history.recent(1)[0].meta.contextSources)).toEqual([]);
  expect(await a.evaluate(()=>(globalThis as any).__capri.history.recent(10).some((m:any)=>m.meta?.contextSources?.includes('chrome')))).toBe(true);
});
it('uses the existing ambient lane, cancels its pending output for direct chat, and never learns source-derived dialogue',async()=>{
  const{app:a,requests}=await boot();await evidence(a);
  await a.evaluate(()=>{const a=(globalThis as any).__capri;a.presenceTick();a.behavior.resumeInitiative();if(!a.cognitiveRuntime.claim('behavior'))throw Error('Fixture requires cognitive attention');void a.behavior.dispatch({kind:'trigger',event:'life_context',detail:'Consider the supplied bounded API detail, or remain silent.',direct:false,context:{evidence:a.life.ledger.current()[0]}});});
  await expect.poll(()=>requests.some(r=>r.messages[0].content.includes('Choose one desktop-companion decision'))).toBe(true);
  await a.evaluate(async()=>{const a=(globalThis as any).__capri;await a.convo.send('Stop that thought. Answer me directly.');await a.convo.settle();});
  await new Promise(r=>setTimeout(r,1200));
  expect(await a.evaluate(()=>(globalThis as any).__capri.history.recent(20).some((m:any)=>m.content==='That API split gives ArborCalc some breathing room.'))).toBe(false);
  expect(requests.find(r=>r.messages[0].content.includes('Choose one desktop-companion decision')).messages[0].content).toContain('LIFE CONTEXT EVIDENCE');
  expect(await a.evaluate(()=>(globalThis as any).__capri.life.ledger.current().length)).toBe(1);
});
it('runs an actual project watcher and exposes health, deletion and privacy controls in Electron',async()=>{
  const{app:a,dir}=await boot();const project=path.join(dir,'ArborCalc');fs.mkdirSync(project);fs.writeFileSync(path.join(project,'core.ts'),'const seed = 1;');
  const sourceId=await a.evaluate((_,folder)=>{const a=(globalThis as any).__capri;a.life.addProject(folder);return a.life.ledger.view().sources.find((s:any)=>s.kind==='project').id;},project);
  await expect.poll(()=>a.evaluate((_,id)=>(globalThis as any).__capri.life.ledger.view().health[id]?.state,sourceId)).toBe('healthy');
  fs.writeFileSync(path.join(project,'core.ts'),'const secretDocument = "not approved for content access";');
  await expect.poll(()=>a.evaluate((_,id)=>(globalThis as any).__capri.life.ledger.view().events.some((e:any)=>e.source===id&&e.type==='file-modified'),sourceId)).toBe(true);
  expect(JSON.stringify(await a.evaluate(()=>(globalThis as any).__capri.life.ledger.view().events))).not.toContain('secretDocument');
  await a.evaluate((_,id)=>{const a=(globalThis as any).__capri;a.life.configure({...a.life.ledger.source(id),paused:true});},sourceId);
  fs.writeFileSync(path.join(project,'later.ts'),'unobserved');await new Promise(r=>setTimeout(r,1200));
  expect(await a.evaluate((_,id)=>(globalThis as any).__capri.life.ledger.view().events.some((e:any)=>e.source===id),sourceId)).toBe(false);
});
it('runs the actual extension extractor in Chromium DOM and excludes form, hidden, editable and password content',async()=>{
  const{app:a}=await boot();const source=fs.readFileSync(path.join(root,'extensions/chrome/capture.js'),'utf8').replace('export function capture','function capture');
  const result=await a.evaluate(async({BrowserWindow},code)=>{
    const w=new BrowserWindow({show:false,webPreferences:{offscreen:true,nodeIntegration:false,contextIsolation:true}});
    try{
      await w.loadURL('data:text/html,'+encodeURIComponent('<title>ArborCalc docs</title><main><h1>API reference<span hidden>hidden secret</span></h1><p>Safe public explanation.</p><form>form secret<input value="input secret"></form><p contenteditable="true">editable secret</p><p hidden>hidden paragraph secret</p></main>'));
      const visible=await w.webContents.executeJavaScript("Object.defineProperty(document,'visibilityState',{value:'visible',configurable:true});"+code+";capture('excerpt')");
      const blocked=await w.webContents.executeJavaScript("document.body.insertAdjacentHTML('beforeend','<input type=password>');"+code+";capture('excerpt')");
      return{visible,blocked};
    }finally{w.close();}
  },source);
  expect(result.visible.headings).toEqual(['API reference']);expect(result.visible.excerpt).toContain('Safe public explanation');
  for(const secret of ['hidden secret','form secret','input secret','editable secret','hidden paragraph secret'])expect(JSON.stringify(result.visible)).not.toContain(secret);
  expect(result.blocked).toBeNull();
});
it('selects a fresh opportunity in presence arbitration and consumes only its delivered callback',async()=>{
  const{app:a,requests}=await boot();await evidence(a);
  await a.evaluate(()=>{const a=(globalThis as any).__capri;a.life.ledger.now=()=>Date.now()+21000;a.settings.update({behavior:{idleRemarks:true}});a.behavior.resumeInitiative();a.presenceTick();});
  await expect.poll(()=>requests.some(r=>r.messages[0].content.includes('Choose one desktop-companion decision'))).toBe(true);
  await expect.poll(()=>a.evaluate(()=>(globalThis as any).__capri.life.ledger.view().candidates.at(-1)?.status),{timeout:15000}).toBe('delivered');
  await a.evaluate(()=>{const a=(globalThis as any).__capri;const e=a.life.ledger.current()[0];a.life.ledger.ingest({...e,revision:e.revision+1,receivedAt:Date.now(),occurredAt:Date.now()});a.behavior.resumeInitiative();a.presenceTick();});
  expect(requests.filter(r=>r.messages[0].content.includes('Choose one desktop-companion decision'))).toHaveLength(1);
});
it('supplies bounded approved sections to an actual optional semantic-development model request',async()=>{
 const {app:a,requests}=await boot();
 await a.evaluate(()=>{const a=(globalThis as any).__capri,life=a.life.ledger,at=Date.now();a.life.configure({...life.source('chrome'),sites:['https://docs.example.com'],permissions:{collect:true,live:true,proactive:true,retain:true,content:true,learn:false}});
 a.life.chrome.accept({recordId:'active-page',revision:at,occurredAt:at,url:'https://docs.example.com/beam',title:'Beam reference',headings:[],mode:'semantic',sections:[{kind:'paragraph',level:0,path:'',text:'The pin joint reaction is 12 N.'},{kind:'code',level:0,path:'',text:'bounded example '.repeat(180)+'UNSUPPLIED_DOCUMENT_TAIL'}],incognito:false,focused:true,visible:true});life.now=()=>Date.now()+21000;a.settings.update({behavior:{idleRemarks:true}});a.behavior.resumeInitiative();a.presenceTick();});
 await expect.poll(()=>requests.some(r=>r.messages[1]?.content.includes('semanticSections')),{timeout:15000}).toBe(true);
 const request=requests.find(r=>r.messages[1]?.content.includes('semanticSections')),payload=JSON.parse(request.messages[1].content);expect(payload.input.context.semanticSections[0].text).toContain('12 N');expect(payload.input.context.semanticSections.reduce((n:number,s:any)=>n+s.text.length,0)).toBeLessThanOrEqual(1200);expect(JSON.stringify(payload)).not.toContain('UNSUPPLIED_DOCUMENT_TAIL');
 await expect.poll(()=>a.evaluate(()=>(globalThis as any).__capri.life.ledger.view().candidates.at(-1)?.status),{timeout:15000}).toBe('delivered');
});
it('autosaves typed website setup before Apply and flushes ordinary setting input on immediate panel close',async()=>{
  const{app:a,char,dir}=await boot();await char.evaluate(()=>(window as any).capri.invoke('panel:open','connections'));
  await expect.poll(()=>a.windows().some(w=>w.url().includes('panel.html'))).toBe(true);let panel=a.windows().find(w=>w.url().includes('panel.html'))!;
  const sites='https://github.com\nhttps://developer.chrome.com';await panel.getByRole('textbox',{name:'Chrome allowed sites',exact:true}).fill(sites);
  await expect.poll(()=>JSON.parse(fs.readFileSync(path.join(dir,'life-setup-drafts.json'),'utf8')).chrome.sites).toBe(sites);
  expect(await a.evaluate(()=>(globalThis as any).__capri.life.ledger.source('chrome').sites)).toEqual([]);
  await panel.getByRole('tab',{name:'Model',exact:true}).click();
  await panel.getByRole('tab',{name:'Connections',exact:true}).click();await expect.poll(()=>panel.getByRole('textbox',{name:'Chrome allowed sites',exact:true}).inputValue()).toBe(sites);
  await panel.getByRole('tab',{name:'Model',exact:true}).click();
  await panel.getByRole('textbox',{name:'Base URL',exact:true}).fill('http://127.0.0.1:54321/v1');
  // Close before the normal 600ms debounce: titlebar close must flush the latest value.
  await panel.getByRole('button',{name:'Close',exact:true}).first().click();
  await expect.poll(()=>JSON.parse(fs.readFileSync(path.join(dir,'settings.json'),'utf8')).ai.openai.baseUrl).toBe('http://127.0.0.1:54321/v1');
  await char.evaluate(()=>(window as any).capri.invoke('panel:open','connections'));
  await expect.poll(()=>a.windows().some(w=>w.url().includes('panel.html'))).toBe(true);panel=a.windows().find(w=>w.url().includes('panel.html'))!;
  await expect.poll(()=>panel.getByRole('textbox',{name:'Chrome allowed sites',exact:true}).inputValue()).toBe(sites);
});
