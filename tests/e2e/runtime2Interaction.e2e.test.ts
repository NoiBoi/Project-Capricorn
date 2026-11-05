import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {randomUUID} from 'node:crypto';
import {_electron as electron,type ElectronApplication} from 'playwright-core';
import {afterEach,expect,it} from 'vitest';
import {selectRuntime} from '../../src/main/runtime2/selection';
import {closeIsolatedApp} from './lifecycle';
const cleanups:(()=>unknown)[]=[];
afterEach(async()=>{for(const f of cleanups.splice(0).reverse())await f();});
async function fixture(){
  const env={...process.env,CAPRI_RUNTIME:'2',CAPRI_V2_DAILY:'1',CAPRI_V2_PROFILE_ID:'interaction-'+randomUUID(),CAPRI_TEST:'1',CAPRI_OFFSCREEN:'1',CAPRI_NO_DEV_KEY:'1',CAPRI_V2_WINDOW_FOCUS:'0'};
  const dir=selectRuntime(env,os.homedir()).profile!;fs.mkdirSync(dir,{recursive:true});
  cleanups.push(()=>{if(path.dirname(dir)!==path.join(os.homedir(),'Documents','Capri Buddy 2.0 Synthetic'))throw Error('Unexpected profile');fs.rmSync(dir,{recursive:true,force:true,maxRetries:5,retryDelay:100});});
  fs.writeFileSync(path.join(dir,'settings.json'),JSON.stringify({firstRunComplete:true,ai:{provider:'offline'},voice:{ttsEnabled:false,micPermission:true},character:{startupIntro:false,hideOnFullscreen:false},behavior:{quietHours:{enabled:false}},dialogue:{localContext:true},privacy:{saveHistory:true},actions:{policies:{read_screen:'allow',teleport:'allow'}},teleport:{auto:false,effects:false}}));
  const app:ElectronApplication=await electron.launch({args:[path.resolve(__dirname,'../..')],env});cleanups.push(()=>closeIsolatedApp(app));
  await expect.poll(()=>app.evaluate(()=>!!(globalThis as any).__capri?.runtime2)).toBe(true);
  const char=app.windows().find(w=>/character\.html/.test(w.url()))??await app.firstWindow();await char.waitForFunction(()=>!!(window as any).__capriDebug);
  // No microphone device, transcriber service, TTS service or model is used.
  await char.evaluate(()=>{const d=(window as any).__capriDebug;d.mic.start=async()=>{};d.mic.stop=async()=>null;d.speaker.enqueue=()=>{};});
  await app.evaluate(async()=>{
    const g=globalThis as any,a=g.__capri,r=a.runtime2,l=r.cognitive;
    clearInterval(l.timer);l.environment(false);l.ambientTrigger=()=>undefined;
    g.__inputs=[];g.__cues=[];g.__mode='silent';g.__sttCalls=0;g.__legacyLength=a.history.recent(200).length;
    const send=a.charWin.webContents.send.bind(a.charWin.webContents);a.charWin.webContents.send=(channel:string,payload:any)=>{if(channel==='cue')g.__cues.push(payload);return send(channel,payload);};
    g.__capriTranscribe=async()=>{g.__sttCalls++;if(g.__sttHold)return new Promise(resolve=>g.__finishStt=resolve);if(g.__sttError)throw Error('Synthetic transcription failure');return 'The same question';};
    l.provider={models:async()=>[{id:'synthetic',label:'Synthetic',contextTokens:128000}],shutdown(){},infer:async(_m:any,input:any,signal:AbortSignal)=>{
      g.__inputs.push(input);
      if(g.__mode==='hold')await new Promise<void>((resolve,reject)=>{g.__finishInfer=()=>resolve();signal.addEventListener('abort',()=>reject(Error('Canceled fixture inference')),{once:true});});
      return {text:'',calls:[]};
    }};
    r.daily.config.model='synthetic';await r.daily.recorder.start({fixture:'runtime2-interaction-preflight-no-network'});r.daily.resume();a.openLongTermChat();
  });
  await expect.poll(()=>app.windows().some(w=>/panel\.html/.test(w.url()))).toBe(true);
  const panel=app.windows().find(w=>/panel\.html/.test(w.url()))!;
  async function idle(){await expect.poll(()=>app.evaluate(()=>(globalThis as any).__capri.runtime2.chatState.busy)).toBe(false);}
  async function voiceStart(){await char.evaluate(()=>window.capri.invoke('voice:ptt','start'));return app.evaluate(()=>(globalThis as any).__capri.voiceInput.id);}
  async function audio(recordingId:number){await char.evaluate((recordingId)=>window.capri.invoke('char:audio',{wav:new Uint8Array(4000),durationMs:1000,recordingId}),recordingId);}
  async function wake(){await app.evaluate(()=>{const l=(globalThis as any).__capri.runtime2.cognitive;l.resumeAmbient();let pending=true;l.ambientTrigger=()=>pending?(pending=false,'source-change'):undefined;l.kick();});await idle();}
  async function events(){const folder=await app.evaluate(async()=>{const r=(globalThis as any).__capri.runtime2;await r.daily.recorder.flush();return r.daily.recorder.status.folder;});return fs.readFileSync(path.join(folder,'events.jsonl'),'utf8').trim().split('\n').map(line=>JSON.parse(line));}
  return {app,char,panel,idle,voiceStart,audio,wake,events};
}
it('delivers voice once through the active runtime, preempts generation, preserves phases and rejects canceled or stale recordings',async()=>{
  const f=await fixture();
  await f.panel.evaluate(()=>window.capri.invoke('chat:send',{text:'The same question'}));await f.idle();
  const id=await f.voiceStart();await expect.poll(()=>f.char.evaluate(()=>(window as any).__capriDebug.phase)).toBe('listening');
  await f.audio(id);await f.audio(id);await expect.poll(()=>f.app.evaluate(()=>(globalThis as any).__inputs.length)).toBe(2);await f.idle();
  const before=await f.app.evaluate(async()=>{const g=globalThis as any,a=g.__capri;return {history:await a.runtime2.chatHistory(),legacyUnchanged:a.history.recent(200).length===g.__legacyLength,stt:g.__sttCalls};});
  expect(before.legacyUnchanged).toBe(true);expect(before.stt).toBe(1);expect(before.history.filter((r:any)=>r.role==='user').map((r:any)=>[r.content,r.meta?.viaVoice??false])).toEqual([['The same question',false],['The same question',true]]);
  await f.app.evaluate(()=>{(globalThis as any).__mode='hold';});
  await f.panel.evaluate(()=>window.capri.invoke('chat:send',{text:'Hold this direct answer'}));await expect.poll(()=>f.app.evaluate(()=>!!(globalThis as any).__finishInfer)).toBe(true);
  await expect.poll(()=>f.char.evaluate(()=>(window as any).__capriDebug.phase)).toBe('thinking');
  const interruptedId=await f.voiceStart();await f.idle();await expect.poll(()=>f.char.evaluate(()=>(window as any).__capriDebug.phase)).toBe('listening');
  await f.char.evaluate(()=>window.capri.invoke('voice:ptt','cancel'));await f.audio(interruptedId);
  await expect.poll(()=>f.char.evaluate(()=>(window as any).__capriDebug.phase)).toBe('idle');
  await f.app.evaluate(()=>{const g=globalThis as any;g.__mode='silent';g.__sttHold=true;});
  const pendingId=await f.voiceStart();await f.audio(pendingId);await expect.poll(()=>f.app.evaluate(()=>!!(globalThis as any).__finishStt)).toBe(true);
  await expect.poll(()=>f.char.evaluate(()=>(window as any).__capriDebug.phase)).toBe('transcribing');
  await f.panel.evaluate(()=>window.capri.invoke('chat:stop'));await f.app.evaluate(()=>{const g=globalThis as any;g.__sttHold=false;g.__finishStt('Canceled transcript');});
  await f.idle();expect(await f.app.evaluate(async()=>({count:(globalThis as any).__inputs.length,users:(await (globalThis as any).__capri.runtime2.chatHistory()).filter((r:any)=>r.role==='user').length}))).toEqual({count:3,users:3});
  const lastId=await f.voiceStart();await f.app.evaluate(()=>{(globalThis as any).__sttError=true;});await f.audio(lastId);await expect.poll(()=>f.char.evaluate(()=>(window as any).__capriDebug.phase)).toBe('error');
  await f.app.evaluate(()=>{(globalThis as any).__sttError=false;});await f.panel.evaluate(()=>window.capri.invoke('chat:send',{text:'A successful new request'}));await f.idle();await expect.poll(()=>f.char.evaluate(()=>(window as any).__capriDebug.phase)).toBe('idle');
  const permissionId=await f.voiceStart();await f.panel.evaluate(()=>window.capri.invoke('settings:set',{voice:{micPermission:false}}));await f.audio(permissionId);expect(await f.app.evaluate(()=>(globalThis as any).__capri.voiceInput.recording)).toBe(false);
  const receipts=await f.events();expect(receipts.filter(e=>e.type==='user-message.admitted'&&e.data.origin==='voice')).toHaveLength(1);expect(receipts.filter(e=>e.type==='character.phase').map(e=>e.data.phase)).toEqual(expect.arrayContaining(['listening','transcribing','thinking','idle','error']));
});
it('coalesces real contact IPC into host context, preserves local reactions, supplies placement and selected interface events without per-event inference',async()=>{
  const f=await fixture();
  await f.app.evaluate(async()=>{const a=(globalThis as any).__capri;await a.runtime2.archive.putState({id:'opinion',kind:'interest',text:'The cobalt valve arrangement remains dubious.',provenance:'model-interpretation',evidence:[],status:'active',dueAt:null,expectedRevision:0});await a.runtime2.cognitive.refreshState();});
  for(const kind of ['pat','pat','poke','pat','poke'])await f.char.evaluate((kind)=>window.capri.invoke('char:interaction',kind as 'pat'|'poke'),kind);
  await expect.poll(()=>f.app.evaluate(async()=>{const a=(globalThis as any).__capri;return (await a.runtime2.recentObservations({limit:20})).filter((o:any)=>o.modality==='user-interaction'&&o.content.interaction.kind==='contact').length;})).toBe(1);
  expect(await f.app.evaluate(()=>({calls:(globalThis as any).__inputs.length,local:(globalThis as any).__cues.filter((c:any)=>c.type==='life'&&['pat','poke'].includes(c.event)).length}))).toEqual({calls:0,local:5});
  await f.wake();const contact=await f.app.evaluate(()=>{const i=(globalThis as any).__inputs[0];return {event:i.records.find((r:any)=>r.kind==='observation')?.observation,active:i.workingState.activeState};});
  expect(contact.event).toMatchObject({modality:'user-interaction',content:{interaction:{kind:'contact',pats:3,pokes:2}},provenance:{authority:'host'}});expect(contact.active).toEqual(expect.arrayContaining([expect.objectContaining({id:'opinion',status:'active'})]));
  await f.app.evaluate(({screen})=>{const g=globalThis as any,a=g.__capri,area=screen.getPrimaryDisplay().workArea;g.__capriWindowsOverride=[{handle:17n,rect:{x:area.x+100,y:area.y+380,width:800,height:300},eligible:true}];g.__capriWindowInfo={'17':{title:'Manual placement fixture',process:'fixture.exe'}};g.__capriForegroundHandle=17n;const w=g.__capriWindowsOverride[0];a.charWin.setBounds(a.placement(w).bounds);a.settleAfterDrop();});
  await expect.poll(()=>f.app.evaluate(async()=>{const a=(globalThis as any).__capri;return (await a.runtime2.recentObservations({limit:20})).filter((o:any)=>o.content.interaction?.kind==='placement').length;})).toBe(1);
  expect(await f.app.evaluate(async()=>{const a=(globalThis as any).__capri;return {pinned:a.runtime2.cognitive.host.body().pinned,movement:await a.runtime2.cognitive.host.move('taskbar',undefined,new AbortController().signal)};})).toMatchObject({pinned:true,movement:{ok:false,detail:'User-pinned position'}});
  await f.wake();expect(await f.app.evaluate(()=>JSON.stringify((globalThis as any).__inputs[1]))).toContain('Manual placement fixture');
  await f.panel.evaluate(async()=>{await window.capri.invoke('panel:viewed','character');await window.capri.invoke('panel:viewed','character');});
  await expect.poll(()=>f.app.evaluate(async()=>{const a=(globalThis as any).__capri;return (await a.runtime2.recentObservations({limit:20})).filter((o:any)=>o.content.interaction?.page==='character').length;})).toBe(1);
  await f.wake();expect(await f.app.evaluate(()=>JSON.stringify((globalThis as any).__inputs[2]))).toContain("Capri's own character page");
  await f.panel.evaluate(async()=>{await window.capri.invoke('settings:set',{character:{scale:.65}});await window.capri.invoke('settings:set',{character:{scale:.7}});});
  await expect.poll(()=>f.app.evaluate(async()=>{const a=(globalThis as any).__capri;return (await a.runtime2.recentObservations({limit:20})).filter((o:any)=>o.content.interaction?.changes).length;})).toBe(1);
  await f.wake();expect(await f.app.evaluate(()=>JSON.stringify((globalThis as any).__inputs[3]))).toContain('character scale: 0.7');
  const calls=await f.app.evaluate(()=>(globalThis as any).__inputs.length);await f.panel.evaluate(()=>window.capri.invoke('settings:set',{behavior:{doNotDisturb:true}}));await f.char.evaluate(()=>window.capri.invoke('char:interaction','pat'));await f.app.evaluate(()=>{(globalThis as any).__capri.flushRuntime2Contact();});expect(await f.app.evaluate(()=>(globalThis as any).__inputs.length)).toBe(calls);
  await f.panel.evaluate(()=>window.capri.invoke('settings:set',{privacy:{saveHistory:false}}));await f.app.evaluate(async()=>{await (globalThis as any).__capri.runtime2.whenSettled();});await f.char.evaluate(()=>window.capri.invoke('char:interaction','poke'));await f.app.evaluate(()=>{(globalThis as any).__capri.flushRuntime2Contact();});
  expect(await f.app.evaluate(async()=>{const a=(globalThis as any).__capri;return (await a.runtime2.recentObservations({limit:20})).filter((o:any)=>o.modality==='user-interaction').length;})).toBe(0);
});
it('dispatches supported speech phases, clears cancellation, and leaves an ambient thinking event unable to reveal dismissed dialogue',async()=>{
  const f=await fixture();
  await f.app.evaluate(()=>{const a=(globalThis as any).__capri;a.bubble.done({id:'old',role:'assistant',content:'Previously dismissed dialogue',ts:Date.now()},'aside');a.bubble.dismiss();a.runtime2.cognitive.options.emit('chat:phase',{phase:'thinking',delivery:'aside'});});
  expect(await f.app.evaluate(()=>({visible:(globalThis as any).__capri.bubble.hasVisibleText,cues:(globalThis as any).__cues.filter((c:any)=>c.type==='phase'&&c.phase==='thinking').length}))).toEqual({visible:false,cues:0});
  await f.panel.evaluate(()=>window.capri.invoke('settings:set',{voice:{ttsEnabled:true}}));
  await f.app.evaluate(()=>{const a=(globalThis as any).__capri;a.runtime2.cognitive.options.emit('runtime2:speak',{id:'fixture-speech',text:'Synthetic speech',ambient:false});});
  await f.char.evaluate(()=>window.capri.invoke('char:speechState',{utteranceId:'runtime2:fixture-speech',state:'start'}));await expect.poll(()=>f.char.evaluate(()=>(window as any).__capriDebug.phase)).toBe('speaking');
  await f.char.evaluate(()=>window.capri.invoke('char:speechState',{utteranceId:'runtime2:fixture-speech',state:'end'}));await expect.poll(()=>f.char.evaluate(()=>(window as any).__capriDebug.phase)).toBe('idle');
  const id=await f.voiceStart();await f.char.evaluate(()=>window.capri.invoke('char:speechState',{utteranceId:'runtime2:fixture-speech',state:'cancel'}));await expect.poll(()=>f.char.evaluate(()=>(window as any).__capriDebug.phase)).toBe('listening');
  await f.char.evaluate(()=>window.capri.invoke('voice:ptt','cancel'));await f.audio(id);await expect.poll(()=>f.char.evaluate(()=>(window as any).__capriDebug.phase)).toBe('idle');
  expect(await f.app.evaluate(()=>(globalThis as any).__inputs.length)).toBe(0);
});
it('keeps legacy voice routing on the legacy conversation when Runtime 2 is not selected',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'capri-legacy-voice-'));cleanups.push(()=>fs.rmSync(dir,{recursive:true,force:true,maxRetries:5,retryDelay:100}));
  fs.writeFileSync(path.join(dir,'settings.json'),JSON.stringify({firstRunComplete:true,ai:{provider:'offline'},voice:{micPermission:true,ttsEnabled:false},character:{startupIntro:false},memory:{autoLearn:false},teleport:{auto:false},behavior:{quietHours:{enabled:false},idleRemarks:false}}));
  const app=await electron.launch({args:[path.resolve(__dirname,'../..')],env:{...process.env,CAPRI_RUNTIME:'legacy',CAPRI_USER_DATA:dir,CAPRI_TEST:'1',CAPRI_OFFSCREEN:'1',CAPRI_NO_DEV_KEY:'1'}});cleanups.push(()=>closeIsolatedApp(app));
  await expect.poll(()=>app.evaluate(()=>!!(globalThis as any).__capri)).toBe(true);await expect.poll(()=>app.windows().some(w=>/character\.html/.test(w.url()))).toBe(true);const char=app.windows().find(w=>/character\.html/.test(w.url()))!;await char.waitForFunction(()=>!!(window as any).__capriDebug);
  await char.evaluate(()=>{const d=(window as any).__capriDebug;d.mic.start=async()=>{};d.mic.stop=async()=>null;});
  await app.evaluate(()=>{const g=globalThis as any;g.__legacyVoice=[];g.__capriTranscribe=async()=> 'Legacy voice message';g.__capri.convo.send=async(text:string,options:any)=>{g.__legacyVoice.push({text,options});return 'fixture';};});
  await char.evaluate(()=>window.capri.invoke('voice:ptt','start'));const id=await app.evaluate(()=>(globalThis as any).__capri.voiceInput.id);
  await char.evaluate(id=>window.capri.invoke('char:audio',{wav:new Uint8Array(4000),durationMs:1000,recordingId:id}),id);
  await expect.poll(()=>app.evaluate(()=>(globalThis as any).__legacyVoice)).toEqual([{text:'Legacy voice message',options:{viaVoice:true}}]);
  expect(await app.evaluate(()=>!!(globalThis as any).__capri.runtime2)).toBe(false);
});
