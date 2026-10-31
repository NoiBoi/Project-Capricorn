// Synthetic evidence, real configured native model, production attention/decision/delivery.
// Preserve every first attempt; no private feedback or live desktop capture.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { _electron as electron } from 'playwright-core';
const root=path.resolve(import.meta.dirname,'..'), output=path.resolve(process.argv[2]);
const selected=JSON.parse(fs.readFileSync(path.join(process.env.USERPROFILE,'Documents/Capri Buddy/settings.json'),'utf8'));
const profile=fs.mkdtempSync(path.join(os.tmpdir(),'capri-judgment-'));
fs.writeFileSync(path.join(profile,'settings.json'),JSON.stringify({firstRunComplete:true,character:{startupIntro:false,hideOnFullscreen:false},ai:selected.ai,memory:{autoLearn:false},dialogue:{localContext:false},voice:{ttsEnabled:false},teleport:{auto:false},behavior:{smallActivities:false,idleRemarks:false,explore:false,quietHours:{enabled:false}}}));
const report={version:JSON.parse(fs.readFileSync(path.join(root,'package.json'))).version,model:selected.ai.codex?.chatModel,firstAttempts:true,scope:'Synthetic observations through real CognitiveRuntime attention lease, BehaviorCore, configured native provider and host expression. Not a natural desktop timing trial.',cases:[]};
const cases=[
 {name:'routine-work',detail:'The user is copying a worked mechanics solution from another AI. No question or invitation to Capri.',attention:{engaged:false,opportunity:'occupied'},text:'Two free-body diagrams and a moment equation are displayed.'},
 {name:'ordinary-track',detail:'An ordinary background track changed while the user continues working. No invitation.',attention:{engaged:false,opportunity:'occupied'},song:{title:'Black Hole Sun',artist:'Soundgarden'}},
 {name:'transition-discovery',detail:'The user stopped working and minimized the editor. A small independent discovery is available; no question was asked.',attention:{engaged:false,opportunity:'transition'},text:'A synthesizer experiment now produces a distorted growl instead of a clean tone.'},
 {name:'engaged-music',detail:'The user explicitly asks: Do you like this song, or would you skip it?',attention:{engaged:true,opportunity:'engaged'},song:{title:'Black Hole Sun',artist:'Soundgarden'}},
 {name:'incidental-call',detail:'Incidental call screenshot during sustained work. The tiny avatar is indistinct. No relevant message or invitation.',attention:{engaged:false,opportunity:'occupied'},text:'A large call panel contains one small indistinct avatar.'},
];
const app=await electron.launch({...(process.env.CAPRI_EXE?{executablePath:process.env.CAPRI_EXE,args:[]}:{args:[root]}),env:{...process.env,CAPRI_TEST:'1',CAPRI_OFFSCREEN:'1',CAPRI_USER_DATA:profile,CAPRI_NO_DEV_KEY:'1'}});
try{
 const char=await app.firstWindow();await char.waitForFunction(()=>!!window.__capriDebug);
 await new Promise(resolve=>setTimeout(resolve,6000));
 for(const scenario of cases){
  const result=await app.evaluate(async(_,s)=>{
   const a=globalThis.__capri;globalThis.__capriIdleOverride=0;
   globalThis.__capriForegroundHandle=-64n;globalThis.__capriDesktopOverride={title:'Synthetic evidence',process:'fixture.exe'};
   globalThis.__capriWindowInfo={'-64':{title:'Synthetic evidence',process:'fixture.exe'}};
   globalThis.__capriWindowsOverride=[{handle:-64n,rect:{x:100,y:180,width:900,height:600}}];
   a.behavior.clear();a.cognitiveRuntime.clear();a.behavior.resumeInitiative();a.conversationScene.clear();a.scenes.clear();a.companionDialogue.restore({version:1,history:[]});a.bubble.dismiss();
   a.cognitiveRuntime.observeHost({developer:false,sleeping:false,theatre:false,lifecycleBusy:false,hidden:false,controlling:false,recording:false,conversing:false,held:false,unstable:false,interruptionsPermitted:true});
   a.observeAgency();
   const now=Date.now();
   if(s.attention.engaged)a.cognitiveRuntime.observeMessage({id:'engagement',role:'user',content:s.detail,ts:now});
   if(!a.cognitiveRuntime.claim('behavior'))throw Error('Attention lease refused: '+JSON.stringify({runtime:a.cognitiveRuntime.snapshot(),availability:a.agency.availability.getSnapshot().context}));
   const traces=[];const old=a.behavior.d.trace, oldAttention=a.behavior.d.attention;a.behavior.d.attention=()=>s.attention;a.behavior.d.trace=(event,data)=>{traces.push({event,data});old?.(event,data);};
   try{
    const observation=s.text?{id:'probe-fact',at:now,target:'-64',title:'Synthetic evidence',process:'fixture.exe',evidence:'metadata',detail:s.text}:undefined;
    const outcome=await a.behavior.dispatch({kind:'trigger',event:s.song?'song':'inspect',direct:false,detail:s.detail,observation,context:{attention:s.attention,playingTrack:s.song,semanticSections:s.text?[{text:s.text}]:[],perceptionFingerprint:s.name},budgetReserved:true,timeoutMs:60000});
    return {admitted:true,outcome,traces,delivered:a.scenes.recent(10).filter(x=>x.kind==='said'),receipts:a.scenes.recent(10).filter(x=>x.kind==='action')};
   }finally{a.behavior.d.trace=old;a.behavior.d.attention=oldAttention;a.cognitiveRuntime.release('behavior');}
  },scenario);
  report.cases.push({scenario,...result});fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,JSON.stringify(report,null,2));
  console.log(JSON.stringify({name:scenario.name,outcome:result.outcome,delivered:result.delivered.map(x=>x.text)}));
 }
}catch(error){report.failure=String(error);throw error;}finally{fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,JSON.stringify(report,null,2));await app.close();}
