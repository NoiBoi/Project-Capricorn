// First-output live check. Synthetic project and isolated profile; no user windows or profile writes.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { _electron as electron } from 'playwright-core';
const root=path.resolve(import.meta.dirname,'..');
const out=path.resolve(process.argv[2]??path.join(root,'work/dialogue-development.json'));
fs.mkdirSync(path.dirname(out),{recursive:true});
const selected=JSON.parse(fs.readFileSync(path.join(process.env.APPDATA,'Capri Buddy/settings.json'),'utf8'));
if(selected.ai.provider!=='codex')throw Error('This bounded check uses the currently configured Codex provider.');
const profile=fs.mkdtempSync(path.join(os.tmpdir(),'capri-development-'));
fs.writeFileSync(path.join(profile,'settings.json'),JSON.stringify({firstRunComplete:true,ai:{provider:'codex',codex:selected.ai.codex,requestTimeoutSec:60},memory:{enabled:true,autoLearn:true},dialogue:{localContext:false},voice:{ttsEnabled:false},teleport:{auto:false,effects:false},behavior:{idleRemarks:false,explore:false,quietHours:{enabled:false}}}));
const report={profile,model:selected.ai.codex.chatModel,turns:[],learning:[],firstOutputsOnly:true};
let app;
const save=()=>fs.writeFileSync(out,JSON.stringify(report,null,2));
async function boot(){app=await electron.launch({...(process.env.CAPRI_EXE?{executablePath:process.env.CAPRI_EXE,args:[]}:{args:[root]}),env:{...process.env,CAPRI_TEST:'1',CAPRI_OFFSCREEN:'1',CAPRI_USER_DATA:profile,CAPRI_NO_DEV_KEY:'1'}});const char=await app.firstWindow();await char.waitForFunction(()=>!!window.__capriDebug);await app.evaluate(()=>{globalThis.__capriIdleOverride=0;});}
async function close(){if(!app)return;await app.evaluate(({app})=>app.quit()).catch(()=>{});await app.close().catch(()=>{});app=undefined;}
async function ask(text){
  const pair=await app.evaluate(async(_,text)=>{const a=globalThis.__capri;await a.convo.send(text);await a.convo.settle();a.memoryLearner.pause();const h=a.history.recent(2);return {user:h[0],assistant:h[1]};},text);
  report.turns.push({user:text,reply:pair.assistant?.content,error:pair.assistant?.meta?.error});save();
  if(!pair.assistant?.content||pair.assistant.meta?.error)throw Error('A live conversation failed. See first output in report.');return pair;
}
async function learn(pairs){
  const state=await app.evaluate(async(_,pairs)=>{const a=globalThis.__capri;const sources=pairs.map(p=>({text:p.user.content,messageId:p.user.id,at:p.user.ts,assistant:{text:p.assistant.content,messageId:p.assistant.id}}));await a.memoryLearner.learn(sources.map(s=>s.text).join('\n\n'),sources[0].messageId,new AbortController().signal,sources);a.memoryLearner.discard();return {relationship:a.relationship.snapshot(),result:a.memoryLearner.context};},pairs);
  report.learning.push(state);save();return state;
}
try{
  await boot();
  const project=await ask("I'm building a synthesizer named Glass Orchard. I also call this project Orchard. The oscillators are done; the filter is unfinished. Do you want its sound clean or nasty?");
  const taste=await ask("What sort of music do you actually like? Pick something you'd come back to, even when I'm listening to something else.");
  await learn([project,taste]);
  await app.evaluate(async()=>{const a=globalThis.__capri;a.conversationScene.record({id:'pat-fixture',role:'user',text:'[The user pats Capri.]',event:'pat',at:Date.now()});await a.generatedRemark('pat');});
  report.contact=await app.evaluate(()=>{const a=globalThis.__capri;return {outcome:a.lastDialogueOutcome,lines:a.scenes.recent(3).filter(x=>x.kind==='said').map(x=>x.text)};});save();
  const done=await ask("The filter is finished now. Glass Orchard is done. Don't ask me for progress on it.");
  await learn([done]);
  await app.evaluate(()=>{const a=globalThis.__capri;a.settings.update({memory:{autoLearn:false}});a.settings.flush();});
  await close();
  // Remove only synthetic transient context, so the next turn must use durable learning.
  for(const name of ['history.jsonl','conversation-scene.json','companion-scenes.json'])fs.rmSync(path.join(profile,name),{force:true});
  await boot();
  report.restored=await app.evaluate(()=>globalThis.__capri.relationship.snapshot());
  await ask('What music did you settle on, and what happened with Orchard?');
  report.checks={projectLearned:report.restored.threads.length>0,tasteLearned:report.restored.tastes.length>0,completionRetained:report.restored.threads.some(t=>['done','dismissed'].includes(t.status)&&/done|finished|completed/i.test(t.summary)),timelineRetained:report.restored.threads.some(t=>(t.developments?.length??0)>=2),aliasRetained:report.restored.threads.some(t=>t.aliases?.includes('Orchard'))};save();
  console.log(JSON.stringify({turns:report.turns,contact:report.contact,checks:report.checks},null,2));
  if(Object.values(report.checks).some(x=>!x))throw Error('Live learning needs review; the first results are retained.');
}catch(error){report.failure=String(error);save();throw error;}finally{await close();}
