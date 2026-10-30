// Synthetic first-output check of knowledgeable music, self-reference and pat continuation.
import fs from 'node:fs';import path from 'node:path';import os from 'node:os';import {_electron as electron} from 'playwright-core';
const root=path.resolve(import.meta.dirname,'..'),out=path.resolve(process.argv[2]);fs.mkdirSync(path.dirname(out),{recursive:true});
const selected=JSON.parse(fs.readFileSync(path.join(process.env.APPDATA,'Capri Buddy/settings.json'),'utf8'));
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'capri-voice-guide-'));
fs.writeFileSync(path.join(dir,'settings.json'),JSON.stringify({firstRunComplete:true,ai:{provider:'codex',codex:selected.ai.codex,requestTimeoutSec:60},voice:{ttsEnabled:false},memory:{autoLearn:false},dialogue:{localContext:true,contextPings:false},character:{startupIntro:false},behavior:{smallActivities:false,explore:false,idleRemarks:false,quietHours:{enabled:false}},teleport:{auto:false,effects:false}}));
const app=await electron.launch({...(process.env.CAPRI_EXE?{executablePath:process.env.CAPRI_EXE,args:[]}:{args:[root]}),env:{...process.env,CAPRI_TEST:'1',CAPRI_OFFSCREEN:'1',CAPRI_USER_DATA:dir,CAPRI_NO_DEV_KEY:'1'}});
const report={model:selected.ai.codex.chatModel,syntheticProfile:dir,firstOutputsOnly:true,turns:[]};const save=()=>fs.writeFileSync(out,JSON.stringify(report,null,2));
try{
  const char=await app.firstWindow();await char.waitForFunction(()=>!!window.__capriDebug);await new Promise(r=>setTimeout(r,1200));
  await app.evaluate(({screen})=>{const g=globalThis,area=screen.getPrimaryDisplay().workArea;g.__capriIdleOverride=0;g.__capriForegroundHandle=17n;g.__capriWindowInfo={'17':{title:'Spotify',process:'Spotify.exe'}};g.__capriDesktopOverride=g.__capriWindowInfo['17'];g.__capriWindowsOverride=[{handle:17n,rect:{x:area.x+50,y:area.y+80,width:Math.min(950,area.width-100),height:Math.min(650,area.height-160)}}];g.__capriSpotifyTrack={title:'I Really Want to Stay at Your House',artist:'Rosa Walton, Hallie Coggins',key:'known-song'};g.__capri.presenceTick();});
  for(const text of ['What do you think of this song?',"I'm editing Capri's movement code in Codex. I could make you sit still all day. Thoughts?",'No, fixed in place forever. Fewer bugs that way.']){
    const answer=await app.evaluate(async(_,text)=>{const a=globalThis.__capri;await a.convo.send(text);await a.convo.settle();return a.history.recent(1)[0];},text);
    report.turns.push({user:text,reply:answer.content,error:answer.meta?.error});save();if(answer.meta?.error)throw Error('Provider failed; see first output.');
  }
  const immediate=await app.evaluate(()=>{const a=globalThis.__capri,native=Math.random;Math.random=()=>.1;try{a.interaction('pat');return a.scenes.recent(3).filter(x=>x.kind==='said').map(x=>x.text);}finally{Math.random=native;}});
  report.instantPat=immediate;save();
  await app.evaluate(async()=>{const a=globalThis.__capri,until=Date.now()+18000;while(a.behavior.busy&&Date.now()<until)await new Promise(r=>setTimeout(r,100));});
  report.pat=await app.evaluate(()=>{const a=globalThis.__capri;return {outcome:a.lastDialogueOutcome,delivered:a.scenes.recent(5).filter(x=>x.kind==='said').map(x=>x.text)};});save();console.log(JSON.stringify(report,null,2));
}finally{await app.evaluate(({app})=>app.quit()).catch(()=>{});await app.close().catch(()=>{});}
