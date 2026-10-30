import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import http from 'node:http';
import {_electron as electron,type ElectronApplication} from 'playwright-core';
import {afterEach,expect,it} from 'vitest';import {closeIsolatedApp} from './lifecycle';
let app:ElectronApplication|undefined,server:http.Server|undefined;const dirs:string[]=[];
afterEach(async()=>{await closeIsolatedApp(app);app=undefined;server?.closeAllConnections();if(server)await new Promise<void>(r=>server!.close(()=>r()));server=undefined;for(const d of dirs.splice(0))fs.rmSync(d,{recursive:true,force:true,maxRetries:5,retryDelay:100});});
async function boot(online=false,nativeFocus=false){
  const requests:any[]=[];server=http.createServer((req,res)=>{if(req.url?.endsWith('/models')){res.end('{"data":[{"id":"fixture"}]}');return;}let raw='';req.on('data',c=>raw+=c);req.on('end',()=>{const body=JSON.parse(raw);requests.push(body);let event='';try{event=JSON.parse(body.messages.at(-1).content).event;}catch{}
    const text=event?JSON.stringify({interpretation:'A specific continuation of the shared subject.',interest:null,action:'speak',line:event==='song'?'That track knows how to make a bad bargain sound tempting.':event==='pat'?'I still want the sharper red. You can keep doing that, though.':'You get that corner. I am keeping my opinion.',gesture:'nod',reason:'Respond to the actual exchange.'}):'That is my code. I get an opinion about the change.';
    setTimeout(()=>{if(!res.destroyed){res.writeHead(200,{'content-type':'text/event-stream'});res.end('data: '+JSON.stringify({choices:[{delta:{content:text}}]})+'\n\ndata: [DONE]\n\n');}},250);});});
  await new Promise<void>(r=>server!.listen(0,'127.0.0.1',r));const dir=fs.mkdtempSync(path.join(os.tmpdir(),'capri-visits-'));dirs.push(dir);
  fs.writeFileSync(path.join(dir,'settings.json'),JSON.stringify({firstRunComplete:true,character:{scale:.6,startupIntro:false,hideOnFullscreen:false},ai:online?{provider:'openai',openai:{baseUrl:`http://127.0.0.1:${(server.address() as any).port}/v1`,model:'fixture'}}:{provider:'offline'},voice:{ttsEnabled:false,interactionLines:online},memory:{autoLearn:false},dialogue:{localContext:true,contextPings:false},behavior:{smallActivities:false,idleRemarks:online,explore:false,quietHours:{enabled:false}},teleport:{auto:false,effects:false}}));
  app=await electron.launch({...(process.env.CAPRI_EXE?{executablePath:process.env.CAPRI_EXE,args:[]}:{args:[path.resolve(__dirname,'../..')]}),env:{...process.env,CAPRI_TEST:'1',CAPRI_OFFSCREEN:nativeFocus?'0':'1',CAPRI_USER_DATA:dir,CAPRI_NO_DEV_KEY:'1'}});
  const char=await app.firstWindow();await char.waitForFunction(()=>!!(window as any).__capriDebug);
  await app.evaluate(({screen})=>{const g=globalThis as any,a=g.__capri,area=screen.getPrimaryDisplay().workArea;g.__capriIdleOverride=0;g.__capriForegroundHandle=17n;g.__capriWindowInfo={'17':{title:'Capri code in Codex',process:'fixture.exe'}};g.__capriDesktopOverride=g.__capriWindowInfo['17'];g.__capriWindowsOverride=[{handle:17n,rect:{x:area.x+70,y:area.y+100,width:Math.min(950,area.width-140),height:Math.min(650,area.height-180)}}];const b=a.charWin.getBounds();a.charWin.setBounds({...b,x:area.x+160,y:area.y+180});});
  await new Promise(r=>setTimeout(r,1200));
  return {a:app,char,requests};
}
it('honors timed stays, sleeps in place, wakes and delivers exactly one near-end warning',async()=>{
  const {a,char}=await boot();
  const reply=await a.evaluate(async()=>{const a=(globalThis as any).__capri;await a.convo.send('stay here for 5 minutes');await a.convo.settle();return a.history.recent(1)[0];});
  expect(reply.content).toContain('5 minutes');expect(reply.meta.provider).toBe('companion');
  await a.evaluate(()=>{const a=(globalThis as any).__capri;a.agency.intentions.find((i:any)=>i.skill==='hold_position').startAt=Date.now()-150000;a.presenceTick();});
  await expect.poll(()=>char.evaluate(()=>(window as any).__capriDebug.behavior.state)).toBe('sleeping');
  const pos=await a.evaluate(()=>{const a=(globalThis as any).__capri;return a.charWin.getBounds();});
  await a.evaluate(()=>{const a=(globalThis as any).__capri;const i=a.agency.intentions.find((i:any)=>i.skill==='hold_position');i.startAt=Date.now()-245000;i.deadline=Date.now()+55000;a.presenceTick();a.presenceTick();});
  await expect.poll(()=>char.evaluate(()=>(window as any).__capriDebug.behavior.state)).not.toBe('sleeping');
  const result=await a.evaluate(()=>{const a=(globalThis as any).__capri;return {bounds:a.charWin.getBounds(),lines:a.scenes.recent().filter((s:any)=>s.kind==='said'&&s.text.includes('minute left')),staying:a.company.staying};});
  expect(result.lines).toHaveLength(1);expect(result.bounds).toEqual(pos);expect(result.staying).toBe(true);
});
it('moves to a named window locally and enforces its avoidance until released',async()=>{
  const {a}=await boot();
  const result=await a.evaluate(async()=>{const g=globalThis as any,a=g.__capri;await a.convo.send('teleport to the Capri code in Codex window');await a.convo.settle();const arrival=a.history.recent(1)[0];const attached=a.attentionHandle;const avoided=await a.applyCompanyControl({kind:'avoid',target:'this window'});const blocked=await a.applyCompanyControl({kind:'move_window',target:'this window',motion:'teleport'});const denied=a.company.avoiding('17');await a.applyCompanyControl({kind:'allow_window',target:'this window'});return {arrival,attached,avoided,blocked,denied,allowed:!a.company.avoiding('17')};});
  expect(result.arrival.meta.provider).toBe('companion');expect(result.arrival.content).toContain('mine');expect(result.attached).toBe(17n);
  expect(result.denied).toBe(true);expect(result.blocked).toContain('keeping clear');expect(result.allowed).toBe(true);
});
it('blocks cursor visits over a video and makes video curiosity a brief edge visit with departure',async()=>{
  const {a}=await boot();
  const result=await a.evaluate(async()=>{const g=globalThis as any,a=g.__capri,w=g.__capriWindowsOverride[0];g.__capriWindowInfo['17']={title:'A lesson - YouTube',process:'chrome.exe'};g.__capriCuriosityCursor={x:w.rect.x+w.rect.width/2,y:w.rect.y+w.rect.height/2};const before=a.charWin.getBounds();const cursor=await a.curiosityDetour('',undefined,undefined,true);const unchanged=JSON.stringify(before)===JSON.stringify(a.charWin.getBounds());const native=a.charWin.setBounds.bind(a.charWin),positions:any[]=[];a.charWin.setBounds=(r:any,...rest:any[])=>{positions.push({...r});return native(r,...rest);};let done;try{done=await a.exploreTick(0,new AbortController().signal,new a.outings.constructor(()=>0),17n,true);}finally{a.charWin.setBounds=native;}return {before,cursor,unchanged,done,positions,window:w.rect,scenes:a.scenes.recent()};});
  expect(result.cursor).toBe(false);expect(result.unchanged).toBe(true);expect(result.done,JSON.stringify(result)).toBe(true);expect(result.positions.length).toBeGreaterThan(0);
  const w=result.window,center={x:w.x+w.width*.25,y:w.y+w.height*.12,width:w.width*.50,height:w.height*.78};
  for(const p of result.positions){const b={x:p.x+p.width*.02,y:p.y+p.height*.10,width:p.width*.96,height:p.height*.78};expect(b.x<center.x+center.width&&b.x+b.width>center.x&&b.y<center.y+center.height&&b.y+b.height>center.y).toBe(false);}
  expect(result.scenes.some((s:any)=>s.text.includes('moved clear to give the window back'))).toBe(true);
});
it('delivers an instant pat line and then a generated continuation with the lasting guide',async()=>{
  const {a,requests}=await boot(true);
  const first=await a.evaluate(()=>{const a=(globalThis as any).__capri;a.conversationScene.record({id:'u',role:'user',text:'I prefer blue.',at:Date.now()});a.conversationScene.record({id:'a',role:'assistant',text:'I vote for sharper red.',at:Date.now()});const native=Math.random;Math.random=()=>.1;try{a.interaction('pat');return a.scenes.recent().filter((s:any)=>s.kind==='said').map((s:any)=>s.text);}finally{Math.random=native;}});
  expect(first).toHaveLength(1);expect(requests).toHaveLength(0);
  await expect.poll(()=>a.evaluate(()=>(globalThis as any).__capri.scenes.recent().filter((s:any)=>s.kind==='said').length)).toBe(2);
  expect(requests[0].messages[0].content).toContain('LASTING CAPRI GUIDE');expect(requests[0].messages[0].content).toContain('sharper red');
  expect(requests[0].messages.at(-1).content).toContain('immediate authored contact reaction');
  const logged=await a.evaluate(()=>(globalThis as any).__capri.history.recent(10).filter((m:any)=>m.role==='assistant'));
  expect(logged).toHaveLength(2);expect(logged[0].content).toBe(first[0]);expect(logged[1].content).toContain('sharper red');
});
it('recognizes a user move inside the same window and immediately remarks on making room',async()=>{
  const {a}=await boot(true);
  const result=await a.evaluate(()=>{const g=globalThis as any,a=g.__capri,v=g.__capriVisits,b=a.charWin.getBounds();v.recordDragOrigin();a.charWin.setBounds({...b,x:b.x+140,y:b.y+30});const native=Math.random;Math.random=()=>.99;try{a.settleAfterDrop();return {lines:a.scenes.recent().filter((s:any)=>s.kind==='said'),actions:a.scenes.recent().filter((s:any)=>s.kind==='action')};}finally{Math.random=native;}});
  expect(result.actions.some((s:any)=>s.text.includes('same window'))).toBe(true);expect(result.lines).toHaveLength(1);
  expect(result.lines[0].text).toMatch(/here|screen|corner|window|pixels|seat|scoot|area|bit|frame/);
});
it('can choose a direct lower-window lounge, follows that edge, and loses it safely when the window closes',async()=>{
  const {a,char}=await boot();
  const result=await a.evaluate(async()=>{const g=globalThis as any,a=g.__capri,d=new a.outings.constructor(()=>.99);const done=await a.exploreTick(0,new AbortController().signal,d,17n);return {done,anchor:g.__capriVisits.lowerAnchor,scenes:a.scenes.recent()};});
  expect(result.done).toBe(true);expect(result.anchor?.handle).toBe(17n);expect(result.scenes.some((s:any)=>s.text.includes('lower edge'))).toBe(true);
  await expect.poll(()=>char.evaluate(()=>(window as any).__capriDebug.model.secondaryRendererState.pose)).toBe('recline');
  const moved=await a.evaluate(()=>{const g=globalThis as any,a=g.__capri,b=a.charWin.getBounds();g.__capriWindowsOverride[0].rect.y+=15;a.perchTick();return a.charWin.getBounds().y-b.y;});expect(moved).toBe(15);
  expect(await a.evaluate(()=>{const g=globalThis as any;g.__capriWindowsOverride=[];g.__capri.perchTick();return g.__capriVisits.lowerAnchor;})).toBeNull();
});
it('occasionally teleports beside the pointer, follows a moved pointer, and returns home',async()=>{
  const {a}=await boot();
  await a.evaluate(()=>{const g=globalThis as any,a=g.__capri,b=a.charWin.getBounds();g.__home=b;g.__savedRandom=Math.random;Math.random=()=>.1;g.__capriCuriosityCursor={x:b.x+380,y:b.y+70};g.__cursorRun=a.curiosityDetour('',undefined,undefined,true);});
  await expect.poll(()=>a.evaluate(()=>(globalThis as any).__capri.curiosityActive)).toBe(true);
  await new Promise(r=>setTimeout(r,1300));
  const before=await a.evaluate(()=>{const g=globalThis as any,b=g.__capri.charWin.getBounds();g.__capriCuriosityCursor={x:g.__capriCuriosityCursor.x-180,y:g.__capriCuriosityCursor.y+100};return b;});
  await new Promise(r=>setTimeout(r,2500));
  const during=await a.evaluate(()=>(globalThis as any).__capri.charWin.getBounds());expect(Math.hypot(during.x-before.x,during.y-before.y)).toBeGreaterThan(30);
  const result=await a.evaluate(async()=>{const g=globalThis as any;const done=await g.__cursorRun;Math.random=g.__savedRandom;return {done,home:g.__home,end:g.__capri.charWin.getBounds(),scenes:g.__capri.scenes.recent()};});
  expect(result.done).toBe(true);expect(result.end.x).toBe(result.home.x);expect(result.end.y).toBe(result.home.y);expect(result.scenes.some((s:any)=>s.text.includes('Followed beside'))).toBe(true);
});
it('moves to the active monitor taskbar on a contextual cue and yields to sleep',async()=>{
  const {a}=await boot();const result=await a.evaluate(async({screen})=>{const g=globalThis as any,a=g.__capri;const done=await g.__capriVisits.taskbarVisit('clock',17n);const area=screen.getDisplayMatching(g.__capriWindowsOverride[0].rect).workArea,b=a.charWin.getBounds();a.settings.update({behavior:{mode:'sleep'}});return {done,b,area,blocked:await g.__capriVisits.taskbarVisit('battery',17n),scenes:a.scenes.recent()};});
  expect(result.done).toBe(true);expect(result.b.x).toBeGreaterThan(result.area.x+result.area.width*.5);expect(result.blocked).toBe(false);expect(result.scenes.some((s:any)=>s.text.includes('clock'))).toBe(true);
});
it('a newly opened window receives a prompt physical visit despite an older exploration rest',async()=>{
  const {a}=await boot();
  await new Promise(r=>setTimeout(r,12500));
  await a.evaluate(()=>{const g=globalThis as any,a=g.__capri,v=g.__capriVisits;g.__capriAutoVisits=true;v.physicalCues.taskbar(`clock:${new Date().toLocaleDateString('en-CA')}`,false);a.settings.update({behavior:{smallActivities:true,newWindowVisits:true,cursorVisits:false}});a.presenceTick();a.outings.restore({version:1,restUntil:Date.now()+600000,completed:1,recentGoals:[],visits:[],outing:null},Date.now());const rect={...g.__capriWindowsOverride[0].rect};g.__capriWindowInfo['19']={title:'Fresh app window',process:'fixture.exe'};g.__capriWindowsOverride=[{handle:19n,rect}];g.__capriForegroundHandle=19n;g.__capriDesktopOverride=g.__capriWindowInfo['19'];a.presenceTick();});
  await new Promise(r=>setTimeout(r,2400));await a.evaluate(()=>(globalThis as any).__capri.presenceTick());
  await expect.poll(()=>a.evaluate(()=>{const a=(globalThis as any).__capri;return a.tourStage==='arriving'||a.tourStage==='roaming'||a.tourStage==='perching'||a.scenes.recent().some((s:any)=>s.text.includes('Finished')||s.text.includes('lower edge'));})).toBe(true);
  expect(await a.evaluate(()=>(globalThis as any).__capri.nextWindowVisit)).toBeGreaterThan(Date.now());
});
it('reacts to a stable new song without a screenshot and includes self, taste and universe guidance',async()=>{
  const {a,requests}=await boot(true);
  await a.evaluate(async()=>{const g=globalThis as any,a=g.__capri;g.__capriSpotifyTrack={title:'I Really Want to Stay at Your House',artist:'Rosa Walton',key:'known-song'};await a.generatedRemark('song','New track began.',{song:g.__capriSpotifyTrack});});
  expect(requests).toHaveLength(1);const text=requests[0].messages[0].content;
  expect(text).toContain('David/Lucy');expect(text).toContain('SELF AND VALUES');expect(text).toContain('No automatic glowing review');
  expect(requests[0].messages.at(-1).content).toContain('Windows Spotify media session');
});
it.each(['idle','sleep'] as const)('delivers %s-return text with speech off and no model connection',async from=>{
  const {a}=await boot();const result=await a.evaluate(async(_e,from)=>{const a=(globalThis as any).__capri;a.settings.update({voice:{ttsEnabled:false,interactionLines:true}});await a.returnToCursor(from);return {text:a.bubble.state.text,scenes:a.scenes.recent(),mode:a.settings.get().behavior.mode};},from);
  expect(result.text.length).toBeGreaterThan(0);expect(result.scenes.some((s:any)=>s.kind==='said')).toBe(true);expect(result.mode).toBe('normal');
  expect(result.text).not.toMatch(/where were you|missed you so much|working while/);
});
it('uses YouTube creator and title without a screenshot and avoids re-commenting on the same video',async()=>{
  const {a,requests}=await boot(true);
  await a.evaluate(async()=>{const g=globalThis as any,a=g.__capri;g.__capriWindowInfo['17']={title:'Building a tiny engine - YouTube',process:'chrome.exe'};g.__capriDesktopOverride=g.__capriWindowInfo['17'];g.__capriYouTubeMetadata={title:'Building a tiny engine',channel:'Known Maker',source:'Windows media metadata'};Object.defineProperty(g,'__capriObservationOverride',{get(){throw Error('A creator/title comment should not capture a screenshot.');},configurable:true});await a.generatedRemark('inspect','New YouTube subject.',{target:17n});});
  expect(requests).toHaveLength(1);const payload=JSON.parse(requests[0].messages.at(-1).content);expect(payload.input.context.youtube.channel).toBe('Known Maker');expect(payload.input.observation.evidence).toBe('metadata');
  const second=await a.evaluate(async()=>{const a=(globalThis as any).__capri,native=Date.now;Date.now=()=>native()+100000;try{await a.generatedRemark('inspect','Same video.',{target:17n});return a.lastDialogueOutcome;}finally{Date.now=native;}});
  expect(requests).toHaveLength(1);expect(second).toContain('same semantic subject');
});
it('reacts to actual settings and developer navigation without repeating every tab, and respects quiet',async()=>{
  const {a,char}=await boot();
  await a.evaluate(()=>{(globalThis as any).__capri.settings.update({voice:{interactionLines:true}});});
  const opened=a.waitForEvent('window');await char.evaluate(()=>window.capri.invoke('panel:open','settings'));const panel=await opened;
  await expect.poll(()=>a.evaluate(()=>(globalThis as any).__capri.scenes.recent().filter((s:any)=>s.kind==='said').length)).toBe(1);
  await panel.evaluate(()=>window.capri.invoke('panel:viewed','voice'));
  expect(await a.evaluate(()=>(globalThis as any).__capri.scenes.recent().filter((s:any)=>s.kind==='said').length)).toBe(1);
  await a.evaluate(()=>{(globalThis as any).__capri.settings.update({behavior:{doNotDisturb:true}});});
  await panel.evaluate(()=>window.capri.invoke('panel:viewed','developer'));
  expect(await a.evaluate(()=>(globalThis as any).__capri.scenes.recent().filter((s:any)=>s.kind==='said').length)).toBe(1);
  await new Promise(r=>setTimeout(r,3000));await a.evaluate(()=>{(globalThis as any).__capri.settings.update({behavior:{doNotDisturb:false}});});
  await panel.evaluate(()=>window.capri.invoke('panel:viewed','developer'));
  expect(await a.evaluate(()=>(globalThis as any).__capri.scenes.recent().filter((s:any)=>s.kind==='said').length)).toBe(2);
});
it('stacks real dialogue panels, expands long text without a scrollbar, and preserves hover',async()=>{
  const {a}=await boot();const opened=a.waitForEvent('window');await a.evaluate(()=>{const b=(globalThis as any).__capri.bubble;b.remark('First little thought.');b.remark('Second little thought.');});
  const page=await opened;await page.waitForURL('**/bubble.html');
  await expect.poll(()=>page.locator('.earlier').count()).toBe(1);expect(await page.locator('#message').textContent()).toBe('Second little thought.');
  expect(await page.locator('#tail').count()).toBe(0);
  await a.evaluate(()=>{(globalThis as any).__capri.bubble.remark('A longer thought with specific details and room to breathe. '.repeat(22));});
  await expect.poll(()=>a.evaluate(()=>(globalThis as any).__capri.bubble.window.getBounds().width)).toBeGreaterThan(340);
  await expect.poll(()=>page.evaluate(()=>{const m=document.getElementById('message')!,s=document.getElementById('stack')!;return {scroll:getComputedStyle(m).overflowY,fits:s.getBoundingClientRect().bottom<=innerHeight};})).toEqual({scroll:'visible',fits:true});
  if(process.env.CAPRI_QA_IMAGE)await page.screenshot({path:process.env.CAPRI_QA_IMAGE});
  await page.evaluate(()=>window.capri.invoke('bubble:hover',true));
  await a.evaluate(()=>{const g=globalThis as any;g.__bubbleClock=Date.now;const base=Date.now();Date.now=()=>base+120000;});
  expect(await a.evaluate(()=>(globalThis as any).__capri.bubble.hasVisibleText)).toBe(true);
  await a.evaluate(()=>{const g=globalThis as any;Date.now=g.__bubbleClock;});await page.evaluate(()=>window.capri.invoke('bubble:hover',false));
});
it('clears an upside-down attachment before the first inspection flight movement',async()=>{
  const {a,char}=await boot();await a.evaluate(()=>{(globalThis as any).__capri.teleporter.d.cue({type:'attachment',mode:'inverted'});});
  await expect.poll(()=>char.evaluate(()=>(window as any).__capriDebug.attachment)).toBe('inverted');
  await a.evaluate(()=>{const g=globalThis as any,a=g.__capri,b=a.charWin.getBounds();g.__flight=a.teleporter.flyTo({...b,x:b.x+160,kind:'spot'},{silent:true});});
  await expect.poll(()=>char.evaluate(()=>(window as any).__capriDebug.attachment)).toBeNull();
  await a.evaluate(async()=>{await (globalThis as any).__flight;});
});
it.each(['jump','teleport'] as const)('clears an old inverted renderer attachment on %s arrival',async route=>{
  const {a,char}=await boot();
  await a.evaluate(()=>{(globalThis as any).__capri.teleporter.d.cue({type:'attachment',mode:'inverted'});});
  await expect.poll(()=>char.evaluate(()=>(window as any).__capriDebug.attachment)).toBe('inverted');
  await a.evaluate(async(_e,route)=>{const a=(globalThis as any).__capri;if(route==='jump'){const b=a.charWin.getBounds();await a.teleporter.jumpTo({...b,x:b.x+75,kind:'spot'});}else await a.teleporter.go('random','manual');},route);
  await expect.poll(()=>char.evaluate(()=>(window as any).__capriDebug.attachment)).toBeNull();
  expect(await a.evaluate(()=>(globalThis as any).__capri.perchMode)).toBe('perch');
});
it('chooses a local lying rest without inventing a battery or requesting a model',async()=>{
  const {a,char,requests}=await boot();
  expect(await a.evaluate(async()=>await (globalThis as any).__capriVisits.taskbarVisit('rest',17n))).toBe(true);
  await expect.poll(()=>char.evaluate(()=>(window as any).__capriDebug.model.secondaryRendererState.pose)).toBe('recline');
  const actions=await a.evaluate(()=>(globalThis as any).__capri.scenes.recent().filter((s:any)=>s.kind==='action').map((s:any)=>s.text));
  expect(actions.at(-1)).toContain('rate limited');expect(actions.at(-1)).not.toContain('battery');expect(requests).toHaveLength(0);
});
it('keeps hidden Spotify out of unrelated chat while retaining direct music answers and the submind guide',async()=>{
  const {a,requests}=await boot(true);
  await a.evaluate(async()=>{const g=globalThis as any,a=g.__capri;g.__capriSpotifyTrack={title:'I Really Want to Stay at Your House',artist:'Rosa Walton',key:'song'};await a.convo.send('What should we fix in your code?');await a.convo.settle();});
  expect(requests[0].messages[0].content).not.toContain('CURRENT MUSIC (');expect(requests[0].messages[0].content).toContain('SUBMIND IDENTITY');
  await a.evaluate(async()=>{const a=(globalThis as any).__capri;await a.convo.send('What do you think about the song?');await a.convo.settle();});
  expect(requests.at(-1).messages[0].content).toContain('CURRENT MUSIC (');
});
it('activates the native reply window and accepts typing after a shortcut-style summon',async()=>{
  const {a}=await boot(false,true);
  const opened=a.waitForEvent('window');await a.evaluate(()=>{(globalThis as any).__capri.bubble.open();});const page=await opened;await page.waitForURL('**/bubble.html');
  await a.evaluate(async({BrowserWindow})=>{const g=globalThis as any;g.__priorWindow=new BrowserWindow({width:300,height:200,show:true});await g.__priorWindow.loadURL('about:blank');g.__priorWindow.focus();});
  await expect.poll(()=>a.evaluate(()=>(globalThis as any).__priorWindow.isFocused())).toBe(true);
  await page.waitForTimeout(350); // A delayed activation must not steal focus back after switching away.
  expect(await a.evaluate(()=>(globalThis as any).__priorWindow.isFocused())).toBe(true);
  await a.evaluate(()=>{(globalThis as any).__capri.bubble.open();});
  await expect.poll(()=>a.evaluate(()=>(globalThis as any).__capri.bubble.nativeActive)).toBe(true);
  await expect.poll(()=>page.evaluate(()=>document.activeElement?.id)).toBe('input');
  await page.keyboard.type('keyboard focus works');expect(await page.locator('#input').inputValue()).toBe('keyboard focus works');
  await page.keyboard.press('Escape');
  await expect.poll(()=>a.evaluate(()=>(globalThis as any).__priorWindow.isFocused())).toBe(true);
  expect(await a.evaluate(()=>(globalThis as any).__capri.bubble.hasVisibleText)).toBe(false);
});
it.each(['pat','poke'] as const)('generates contextual third and fifth %s reactions even in a rapid burst',async kind=>{
  const {a,requests}=await boot(true);
  await a.evaluate((_e,kind)=>{const a=(globalThis as any).__capri;a.conversationScene.record({id:'opinion',role:'assistant',text:'I am still voting for sharper red.',at:Date.now()});for(let i=0;i<3;i++)a.interaction(kind);},kind);
  await expect.poll(()=>requests.some(r=>JSON.stringify(r).includes('3 consecutive times')),{timeout:10000}).toBe(true);
  await new Promise(r=>setTimeout(r,400));
  await a.evaluate((_e,kind)=>{const a=(globalThis as any).__capri;a.interaction(kind);a.interaction(kind);},kind);
  await expect.poll(()=>requests.some(r=>JSON.stringify(r).includes('5 consecutive times')),{timeout:10000}).toBe(true);
  const last=requests.findLast(r=>JSON.stringify(r).includes('5 consecutive times'));
  expect(JSON.stringify(last)).toContain('sharper red');expect(JSON.stringify(last)).toContain(kind==='pat'?'petted':'poked');
});
