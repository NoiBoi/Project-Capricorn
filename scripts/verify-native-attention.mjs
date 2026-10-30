// One genuine automatic opportunity from a newly created native fixture window.
// The native inventory is real; attention and the image are restricted to this fixture.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { _electron as electron } from 'playwright-core';
const root=path.resolve(import.meta.dirname,'..'), out=path.resolve(process.argv[2]);
fs.mkdirSync(out,{recursive:true});
const actual=JSON.parse(fs.readFileSync(path.join(process.env.APPDATA,'Capri Buddy/settings.json'),'utf8'));
if(actual.ai.provider!=='codex')throw Error('This bounded check uses the configured Codex provider.');
const profile=fs.mkdtempSync(path.join(os.tmpdir(),'capri-native-attention-'));
fs.writeFileSync(path.join(profile,'settings.json'),JSON.stringify({firstRunComplete:true,character:{startupIntro:false,hideOnFullscreen:false},
  ai:{provider:'codex',codex:actual.ai.codex},voice:{ttsEnabled:false},memory:{autoLearn:true},dialogue:{localContext:false,contextPings:false,weatherCity:''},
  behavior:{smallActivities:true,idleRemarks:false,explore:false,quietHours:{enabled:false}},actions:{policies:{read_screen:'allow'}},teleport:{auto:false}}));
const fixtureMain=path.join(out,'fixture.cjs');
fs.writeFileSync(fixtureMain,`const {app,BrowserWindow}=require('electron');app.setPath('userData',process.env.CAPRI_FIXTURE_PROFILE);app.whenReady().then(async()=>{global.fixture=new BrowserWindow({x:100,y:100,width:840,height:620,title:'Capri route verification',autoHideMenuBar:true});global.fixtureCreatedAt=Date.now();await fixture.loadURL('data:text/html;charset=utf-8,'+encodeURIComponent('<title>Capri route verification</title><body style="margin:0;background:#141121;color:#ddd;font:22px sans-serif"><h2 style="padding:24px">Route experiment</h2><svg width="800" height="440"><rect x="180" y="35" width="430" height="300" fill="none" stroke="#888" stroke-width="3"/><path d="M250 110H540V260H250V110M540 180H700" fill="none" stroke="#30ed90" stroke-width="12"/><circle cx="700" cy="180" r="16" fill="#fb498f"/><text x="185" y="395" fill="#ccc">One branch ends outside the enclosure.</text></svg></body>'));fixture.show();fixture.focus();});app.on('window-all-closed',()=>app.quit());`);
let app, fixture;
try{
  app=await electron.launch({executablePath:process.env.CAPRI_EXE,args:[],env:{...process.env,CAPRI_TEST:'1',CAPRI_OFFSCREEN:'1',CAPRI_USER_DATA:profile,CAPRI_NO_DEV_KEY:'1'}});
  const char=await app.firstWindow();await char.waitForFunction(()=>window.__capriDebug);
  await app.evaluate(()=>{const g=globalThis,a=g.__capri;g.__capriIdleOverride=0;g.__capriForegroundHandle=0n;g.__capriWindowInfo=new Proxy({}, {get:()=>({title:'Uninspected external window',process:'other.exe'})});g.__capriDesktopOverride={title:'Capri route verification',process:'electron.exe'};a.settings.update({dialogue:{localContext:true}});a.presenceTick();});
  const launchAt=Date.now();
  fixture=await electron.launch({args:[fixtureMain],env:{...process.env,CAPRI_FIXTURE_PROFILE:path.join(out,'fixture-profile')}});
  await fixture.firstWindow();
  const openedAt=await fixture.evaluate(()=>globalThis.fixtureCreatedAt);
  const handle=await fixture.evaluate(()=>globalThis.fixture.getNativeWindowHandle().readBigUInt64LE(0).toString());
  await app.evaluate(async({desktopCapturer},{handle})=>{
    const g=globalThis,a=g.__capri;
    const deadline=Date.now()+5000;let window;
    while(Date.now()<deadline&&!window){window=a.desktopWindows().find(w=>String(w.handle)===handle);if(!window)await new Promise(r=>setTimeout(r,100));}
    if(!window)throw Error('The real fixture window was not enumerated.');
    const sources=await desktopCapturer.getSources({types:['window'],thumbnailSize:{width:960,height:640}});
    const source=sources.find(s=>s.id.split(':')[1]===handle);
    if(!source||source.thumbnail.isEmpty())throw Error('The real fixture thumbnail was unavailable.');
    g.__capriObservationOverride={jpegBase64:source.thumbnail.toJPEG(65).toString('base64'),region:window.rect,window:window.rect};
    g.__capriForegroundHandle=BigInt(handle);g.__capriWindowInfo=new Proxy({[handle]:{title:'Capri route verification',process:'electron.exe'}},{get:(target,key)=>target[key]??{title:'Uninspected external window',process:'other.exe'}});
    g.__nativeCues=[];const send=a.charWin.webContents.send.bind(a.charWin.webContents);a.charWin.webContents.send=(channel,...args)=>{if(channel==='cue'&&['life','activity'].includes(args[0]?.type))g.__nativeCues.push({at:Date.now(),cue:args[0]});return send(channel,...args);};
    a.settings.update({behavior:{idleRemarks:true}});a.presenceTick();
  },{handle});
  const deadline=Date.now()+35000;let result;
  while(Date.now()<deadline){
    result=await app.evaluate(()=>{const g=globalThis,a=g.__capri;return{outcome:a.lastDialogueOutcome,busy:a.behavior.busy,mind:a.behavior.snapshot(),environment:a.environmentalCuriosity.snapshot(Date.now()),episodes:a.scenes.experiences(),points:a.lastInspection?.points.length??0,cues:g.__nativeCues};});
    if(!result.busy && result.mind.journal.length && result.environment.subjects.some(s=>s.reading?.evidence))break;
    await new Promise(r=>setTimeout(r,500));
  }
  const finishedAt=Date.now();
  await app.evaluate(()=>{const a=globalThis.__capri;a.settings.update({behavior:{idleRemarks:false}});a.memoryLearner.discard();});
  const usage=fs.readFileSync(path.join(profile,'logs/capri.log'),'utf8').trim().split('\n').map(x=>{try{return JSON.parse(x)}catch{return{}}}).filter(x=>x.msg==='codex request').map(x=>x.data);
  const output={version:'0.2.50',scope:'One native fixture window; real window enumeration and captured fixture thumbnail; attention metadata pinned to fixture; no manual generatedRemark call; isolated profile; TTS off.',launchAt,openedAt,completedWithinMs:finishedAt-openedAt,noticedWithinMs:result.cues.find(c=>c.cue.type==='life'&&c.cue.event==='window')?.at-openedAt,providerRequests:usage,result};
  fs.writeFileSync(path.join(out,'result.json'),JSON.stringify(output,null,2));
  console.log(JSON.stringify({completedWithinMs:output.completedWithinMs,noticedWithinMs:output.noticedWithinMs,requests:usage.length,outcome:result.outcome,readings:result.environment.subjects.filter(s=>s.reading?.evidence).length,points:result.points,episodes:result.episodes.length},null,2));
  if(!result.environment.subjects.some(s=>s.reading?.evidence)||usage.length!==1)throw Error('The bounded automatic native-window check did not complete as intended.');
}finally{await fixture?.close().catch(()=>{});await app?.close().catch(()=>{});}
