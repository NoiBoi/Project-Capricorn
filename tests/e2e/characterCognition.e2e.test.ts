import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import type {AddressInfo} from 'node:net';
import {_electron as electron,type ElectronApplication} from 'playwright-core';
import {expect,it} from 'vitest';
import {closeIsolatedApp} from './lifecycle';

it('uses delivered chat evidence for selective interpretation, stable retirement and unified presentation across restart',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'capri-character-'));let app:ElectronApplication|undefined,calls=0;
  const server=http.createServer((req,res)=>{let raw='';req.on('data',c=>raw+=c);req.on('end',()=>{
    if(req.url?.endsWith('/models')){res.end(JSON.stringify({data:[{id:'fixture'}]}));return;}
    calls++;const body=JSON.parse(raw);let input:any;try{input=JSON.parse(body.messages.at(-1).content);}catch{}
    let answer:string;
    if(input?.cognitive_request){const source=input.cognitive_request.evidence.filter((e:any)=>e.role==='assistant').at(-1);const blue=source.text.startsWith('Blue');answer=JSON.stringify({changes:[],cognition:[{topic:'dashboard color',kind:'position',status:blue?'revised':'active',evidence:{sourceId:source.id,quote:blue?'Blue, then.':'Violet.'},reason:{sourceId:source.id,quote:blue?'Violet would hide those alerts.':'Red belongs on the warnings, because those need to stand out.'}}]});}
    else answer=body.messages.at(-1).content.includes('Actually')?'Blue, then. Violet would hide those alerts.':'Violet. Red belongs on the warnings, because those need to stand out.';
    res.writeHead(200,{'content-type':'text/event-stream'});res.end(`data: ${JSON.stringify({choices:[{delta:{content:answer}}]})}\n\ndata: [DONE]\n\n`);
  });});await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
  fs.writeFileSync(path.join(dir,'settings.json'),JSON.stringify({firstRunComplete:true,ai:{provider:'openai',openai:{baseUrl:`http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`,model:'fixture'}},memory:{enabled:true,autoLearn:false},character:{startupIntro:false,hideOnFullscreen:false},voice:{ttsEnabled:false},behavior:{idleRemarks:false,explore:false,smallActivities:false,quietHours:{enabled:false}},teleport:{auto:false}}));
  const boot=async()=>{app=await electron.launch({...process.env.CAPRI_EXE?{executablePath:process.env.CAPRI_EXE,args:[]}:{args:[path.resolve(__dirname,'../..')]},env:{...process.env,CAPRI_TEST:'1',CAPRI_OFFSCREEN:'1',CAPRI_NO_DEV_KEY:'1',CAPRI_USER_DATA:dir}});await(await app.firstWindow()).waitForFunction(()=>!!(window as any).__capriDebug);return app;};
  try{
    const a=await boot();
    const turn=async(text:string)=>a.evaluate(async(_e,text)=>{const c=(globalThis as any).__capri;await c.convo.send(text);await c.convo.settle();c.memoryLearner.pause();const reply=c.history.recent(1)[0];c.settings.update({memory:{autoLearn:true}});await c.memoryLearner.learn(text,'fixture-user',new AbortController().signal);c.settings.update({memory:{autoLearn:false}});return {reply,state:c.dialogueCognition.snapshot(),sameDialogue:c.cognitiveRuntime.dialogue===c.dialogueCognition,samePerformance:c.cognitiveRuntime.performance===c.performanceDirector,legacyScheduler:typeof c.teleporter.startAuto,approved:c.memory.approved().length};},text);
    const first=await turn('Pick a dashboard color and explain why.');expect(first.state.position.text).toBe('Violet.');expect(first.sameDialogue&&first.samePerformance).toBe(true);expect(first.legacyScheduler).toBe('undefined');expect(first.approved).toBe(0);
    const second=await turn('Actually the alerts also use violet. Reconsider.');expect(second.state.thoughts[0]).toMatchObject({status:'revised',previous:{text:'Violet.'},reason:{text:'Violet would hide those alerts.'}});expect(calls).toBe(4);
    const speech=await a.evaluate(()=>{const c=(globalThis as any).__capri,line=c.companionDialogue.choose({event:'pat'},{required:true,remember:false});c.presentRemark(line,true,false,{event:'pat'},'interaction',undefined,undefined,[],{kind:'generated-direct'});return c.history.recent(1)[0];});
    expect(speech.meta.speech.kind).toBe('generated-direct');
    const char=(await a.firstWindow());await char.evaluate(()=>window.capri.invoke('panel:open','chat'));let panel=a.windows().find(w=>w.url().includes('/panel.html'));for(let i=0;!panel&&i<50;i++){await new Promise(r=>setTimeout(r,50));panel=a.windows().find(w=>w.url().includes('/panel.html'));}if(!panel)throw Error('Panel did not open');await panel.waitForSelector('textarea');await expect(panel.evaluate(line=>window.capri.invoke('dialogue:retire',line),speech.content)).rejects.toThrow();
    await panel.evaluate(id=>window.capri.invoke('dialogue:feedback',{messageId:id,kind:'generic'}),speech.id);
    const failed=await a.evaluate(async()=>{const c=(globalThis as any).__capri;let continued=false;const receipt=await c.performanceDirector.perform(async()=>false,()=>true,async()=>{continued=true;});return {receipt,continued};});expect(failed).toMatchObject({receipt:{action:'failed',continued:false},continued:false});
    await closeIsolatedApp(app);app=undefined;const b=await boot();const restored=await b.evaluate(()=>{const c=(globalThis as any).__capri;return {state:c.dialogueCognition.snapshot(),feedback:c.cognitiveStore.load('performance-feedback')};});expect(restored.state.thoughts[0].previous.text).toBe('Violet.');expect(restored.feedback[0].kind).toBe('generic');
    expect(fs.existsSync(path.join(dir,'behavior-state.json'))).toBe(false);
  }finally{await closeIsolatedApp(app);server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));fs.rmSync(dir,{recursive:true,force:true,maxRetries:8,retryDelay:250});}
},90000);
