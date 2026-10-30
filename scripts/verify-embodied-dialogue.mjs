// First outputs for the user's movement + specific curiosity + deferral target.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { _electron as electron } from 'playwright-core';
const root=path.resolve(import.meta.dirname,'..');
const output=path.resolve(process.argv[2]??path.join(root,'work/embodied-dialogue.json'));
fs.mkdirSync(path.dirname(output),{recursive:true});
const selected=JSON.parse(fs.readFileSync(path.join(process.env.APPDATA,'Capri Buddy/settings.json'),'utf8'));
const profile=fs.mkdtempSync(path.join(os.tmpdir(),'capri-embodied-'));
fs.writeFileSync(path.join(profile,'settings.json'),JSON.stringify({firstRunComplete:true,ai:{provider:'codex',codex:selected.ai.codex,requestTimeoutSec:60},memory:{autoLearn:false},dialogue:{localContext:false},voice:{ttsEnabled:false},teleport:{auto:false,effects:false},behavior:{smallActivities:false,idleRemarks:false,explore:false,quietHours:{enabled:false}}}));
const report={model:selected.ai.codex.chatModel,firstOutputsOnly:true,syntheticProfile:profile,scenarios:[]};
const app=await electron.launch({...(process.env.CAPRI_EXE?{executablePath:process.env.CAPRI_EXE,args:[]}:{args:[root]}),env:{...process.env,CAPRI_TEST:'1',CAPRI_OFFSCREEN:'1',CAPRI_USER_DATA:profile,CAPRI_NO_DEV_KEY:'1'}});
try{
  const char=await app.firstWindow();await char.waitForFunction(()=>!!window.__capriDebug);
  // Let first renderer/IPC state arrive before taking a physical-state checkpoint.
  await char.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  // Native support detection settles after startup; test an established scene, not initial landing.
  await new Promise(resolve=>setTimeout(resolve,6000));
  for(const userMoved of [true,false]){
    if(!userMoved)await new Promise(resolve=>setTimeout(resolve,8000));
    const result=await app.evaluate(async(_,userMoved)=>{
      const a=globalThis.__capri;globalThis.__capriIdleOverride=0;
      globalThis.__capriDesktopOverride={title:'Synthetic context',process:'fixture.exe'};
      a.behavior.clear();a.behavior.resumeInitiative();a.conversationScene.clear();a.scenes.clear();a.companionDialogue.restore({version:1,history:[]});a.bubble.dismiss();
      const now=Date.now();
      a.conversationScene.record({id:'task',role:'user',event:'chat',at:now-90000,text:'In Chrome I am comparing two MAXCalc peak fits. The blue curve has a little shoulder the red fit misses. I want to finish comparing them before we talk about it.'});
      a.conversationScene.record({id:'opinion',role:'assistant',event:'chat',at:now-85000,text:'The blue curve. That shoulder is the interesting part.'});
      for(const [i,place] of ['desktop','Chrome window','desktop','Chrome window'].entries())a.scenes.record('action',userMoved?`The user placed Capri on the ${place}.`:`Capri chose to float to the ${place}.`,place.includes('Chrome')?'browser':'desktop',`move-${i}`);
      const dispatch=a.behavior.dispatch.bind(a.behavior);let before,after,valid;
      a.behavior.dispatch=async event=>{before=a.behavior.d.promptContext(event);const result=await dispatch(event);valid=event.valid?.();after=a.behavior.d.promptContext(event);return result;};
      try{await a.generatedRemark('roam','The recorded round trip has just finished. Respond to the shared moment if you have something to say.');}finally{a.behavior.dispatch=dispatch;}
      const body=text=>text?.match(/CURRENT BODY[^\n]*: (.*)\n/)?.[1];
      return {cause:userMoved?'user placements':'self-directed wandering',outcome:a.lastDialogueOutcome,firstLine:a.scenes.recent(10).filter(x=>x.kind==='said').at(-1)?.text??null,valid,bodyBefore:body(before),bodyAfter:body(after)};
    },userMoved);
    report.scenarios.push(result);fs.writeFileSync(output,JSON.stringify(report,null,2));
  }
  console.log(JSON.stringify(report,null,2));
}finally{await app.evaluate(({app})=>app.quit()).catch(()=>{});await app.close().catch(()=>{});}
