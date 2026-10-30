import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { _electron as electron, type ElectronApplication } from 'playwright-core';
import { afterEach, describe, expect, it } from 'vitest';
import { SEAT_RATIO } from '../../src/shared/framing';
import { closeIsolatedApp } from './lifecycle';
const root=path.resolve(__dirname,'../..');
let app:ElectronApplication|undefined, server:http.Server|undefined;
const dirs:string[]=[];
afterEach(async()=>{await closeIsolatedApp(app);app=undefined;server?.closeAllConnections();if(server)await new Promise<void>(r=>server!.close(()=>r()));server=undefined;
  for(const dir of dirs.splice(0)) {
    if(!path.resolve(dir).startsWith(path.join(os.tmpdir(),'capri-adaptive-')))throw Error('Unexpected test-profile cleanup path');
    try{fs.rmSync(dir,{recursive:true,force:true,maxRetries:3,retryDelay:100});}catch(error){if(!['EBUSY','EPERM','ENOTEMPTY'].includes((error as NodeJS.ErrnoException).code??''))throw error;}
  }
});
async function boot(options:{active?:boolean;delay?:number;interested?:boolean}={}) {
  const requests:any[]=[];
  server=http.createServer((req,res)=>{
    if(req.url?.endsWith('/models')){res.end(JSON.stringify({data:[{id:'fixture'}]}));return;}
    let raw='';req.on('data',c=>raw+=c);req.on('end',()=>{
      const body=JSON.parse(raw), content=body.messages.at(-1).content;
      const payload=JSON.parse(Array.isArray(content)?content.find((p:any)=>p.type==='text').text:content);requests.push(payload);
      const text=JSON.stringify({interpretation:'A branch extends beyond the enclosure.',interest:options.interested&&payload.event==='inspect'?{topic:'the branch',intention:'Offer a view on the branch when the conversation has room.',sourceId:payload.input.observation.id,quote:payload.input.observation.detail}:null,action:'speak',line:payload.event==='roam' ? 'I am keeping this spot. You can negotiate later.' : 'That branch leaves the enclosure. I wonder whether that boundary is meant to contain it.',gesture:'curious',reason:'A specific new visible detail.',facts:['A branch extends beyond the enclosure.'],curiosity:'Is the boundary meant to contain the branch?',points:[{x:.5,y:.5,label:'branch'}]});
      setTimeout(()=>{if(!res.destroyed){res.writeHead(200,{'content-type':'text/event-stream'});res.end('data: '+JSON.stringify({choices:[{delta:{content:text}}]})+'\n\ndata: [DONE]\n\n');}},options.delay??5);
    });
  });
  await new Promise<void>(r=>server!.listen(0,'127.0.0.1',r));
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'capri-adaptive-'));dirs.push(dir);
  fs.writeFileSync(path.join(dir,'settings.json'),JSON.stringify({firstRunComplete:true,character:{startupIntro:false,hideOnFullscreen:false},
    ai:{provider:'openai',openai:{baseUrl:`http://127.0.0.1:${(server.address() as any).port}/v1`,model:'fixture'}},voice:{ttsEnabled:false},memory:{autoLearn:false},
    actions:{policies:{read_screen:'allow'}},dialogue:{localContext:true,contextPings:false},behavior:{explore:false,smallActivities:!!options.active,idleRemarks:true,remarkIntervalMinutes:480,quietHours:{enabled:false}},teleport:{auto:false,effects:false}}));
  app=await electron.launch({...process.env.CAPRI_EXE?{executablePath:process.env.CAPRI_EXE,args:[]}:{args:[root]},env:{...process.env,CAPRI_TEST:'1',CAPRI_OFFSCREEN:'1',CAPRI_USER_DATA:dir,CAPRI_NO_DEV_KEY:'1'}});
  const char=await app.firstWindow();await char.waitForFunction(()=>!!window.__capriDebug);
  await app.evaluate(()=>{const g=globalThis as any,rect={x:100,y:150,width:700,height:500};g.__capriIdleOverride=0;g.__capriForegroundHandle=777n;g.__capriWindowInfo={'777':{title:'Route diagram',process:'fixture.exe'}};g.__capriDesktopOverride=g.__capriWindowInfo['777'];g.__capriWindowsOverride=[{handle:777n,rect}];g.__capriObservationOverride={jpegBase64:'same-image',region:rect,window:rect};});
  return {a:app,char,requests};
}
describe('adaptive desktop attention',()=>{
  it('does not cancel a direct contextual interaction on an unrelated settings write with desktop context off',async()=>{
    const {a,requests}=await boot({delay:500});
    await a.evaluate(()=>{const g=globalThis as any,a=g.__capri;a.settings.update({dialogue:{localContext:false}});a.conversationScene.record({id:'route',role:'user',text:'We are discussing a branch outside an enclosure.',at:Date.now(),event:'chat'});g.__pending=a.generatedRemark('pat');});
    await expect.poll(()=>requests.length).toBe(1);
    await a.evaluate(()=>{(globalThis as any).__capri.settings.update({voice:{volume:.4}});});
    const result=await a.evaluate(async()=>await (globalThis as any).__pending);
    expect(result).toMatchObject({action:'speak',delivered:true});
  });
  it.each(['deny','confirm'] as const)('does not capture or call the model automatically when screen reading is %s',async policy=>{
    const {a,requests}=await boot();
    const outcome=await a.evaluate(async(_e,policy)=>{const g=globalThis as any,a=g.__capri;a.settings.update({actions:{policies:{read_screen:policy}}});
      Object.defineProperty(g,'__capriObservationOverride',{get(){throw new Error('An unauthorized preview was attempted');},configurable:true});
      await a.generatedRemark('inspect','A new window.',{target:777n});return a.lastDialogueOutcome;},policy);
    expect(requests).toHaveLength(0);expect(outcome).toContain('no exposed visual preview');
  });
  it.each(['permission','remarks','provider'] as const)('cancels an in-flight optional decision after changing %s',async change=>{
    const {a,requests}=await boot({delay:800});
    await a.evaluate(()=>{const g=globalThis as any;g.__pending=g.__capri.generatedRemark('inspect','Observe the current view.',{target:777n});});
    await expect.poll(()=>requests.length).toBe(1);
    await a.evaluate((_e,change)=>{const a=(globalThis as any).__capri;
      if(change==='permission')a.settings.update({actions:{policies:{read_screen:'deny'}}});
      else if(change==='remarks')a.settings.update({behavior:{idleRemarks:false}});
      else a.settings.update({ai:{openai:{model:'different-model'}}});
    },change);
    await a.evaluate(async()=>{await (globalThis as any).__pending;});
    expect(await a.evaluate(()=>(globalThis as any).__capri.bubble.state.text)).not.toContain('That branch');
    expect(await a.evaluate(()=>(globalThis as any).__capri.lastInspection)).toBeNull();
  });
  it('honors a durable stay when a new exposed window appears',async()=>{
    const {a,requests}=await boot({active:true});
    await a.evaluate(async({screen},seat)=>{const g=globalThis as any,a=g.__capri,b=a.charWin.getBounds(),area=screen.getPrimaryDisplay().workArea;
      a.settings.update({voice:{interactionLines:false}});a.charWin.setBounds({...b,x:area.x+50,y:Math.round(area.y+area.height-b.height*seat)});a.settleAfterDrop();
      a.conversationScene.record({id:'touch-fixture',role:'user',text:'[The user pats Capri.]',at:Date.now(),event:'pat'});await a.applyCompanyControl({kind:'stay'});
      g.__capriWindowsOverride=[];g.__capriForegroundHandle=0n;a.presenceTick();
      a.settings.update({voice:{interactionLines:true}});
      g.__openNotice=false;const send=a.charWin.webContents.send.bind(a.charWin.webContents);a.charWin.webContents.send=(channel:string,...args:any[])=>{if(channel==='cue'&&args[0]?.type==='life'&&args[0]?.event==='window')g.__openNotice=true;return send(channel,...args);};
      const rect={x:100,y:150,width:700,height:500};g.__capriWindowsOverride=[{handle:777n,rect}];g.__capriForegroundHandle=777n;a.presenceTick();
    },SEAT_RATIO);
    expect(await a.evaluate(()=>(globalThis as any).__openNotice)).toBe(false);expect(requests).toHaveLength(0);
    await new Promise(r=>setTimeout(r,1500));expect(requests).toHaveLength(0);

    await expect.poll(()=>a.evaluate(()=>(globalThis as any).__capri.behavior.busy)).toBe(false);
    expect(await a.evaluate(()=>(globalThis as any).__capri.conversationScene.active())).toBe(true);
    expect(await a.evaluate(()=>(globalThis as any).__capri.company.staying)).toBe(true);
    expect(await a.evaluate(()=>(globalThis as any).__capri.lastInspection?.points.length)).toBeUndefined();
  });
  it('allows a spontaneous spoken screenshot reaction when the speaking lane is clear',async()=>{
    const {a,requests}=await boot();
    const result=await a.evaluate(async()=>{const a=(globalThis as any).__capri;const decision=await a.generatedRemark('inspect','A new view.',{target:777n});return {decision,text:a.bubble.state.text,points:a.lastInspection?.points.length};});
    expect(requests[0].delivery.speechAllowed).toBe(true);expect(result.decision).toMatchObject({action:'speak',delivered:true});expect(result.text).toContain('That branch');expect(result.points).toBe(1);
  });
  it.each(['pat','poke','pickup','putdown','placed_window'] as const)('allows a relevant spoken %s reaction even after a recent aside',async event=>{
    const {a,requests}=await boot();
    const result=await a.evaluate(async(_e,event)=>{const a=(globalThis as any).__capri;a.presentRemark('I was keeping that corner.',true,false,{event:'notice'});return a.generatedRemark(event,'A direct physical interaction interrupts her current thought.',{target:777n});},event);
    expect(requests).toHaveLength(1);expect(requests[0].delivery.speechAllowed).toBe(true);expect(result).toMatchObject({action:'speak',delivered:true});
  });
  it('retains an unsolicited thought while speech is crowded, then gives it a real opportunity',async()=>{
    const {a,requests}=await boot({interested:true});
    await a.evaluate(()=>{(globalThis as any).__capri.settings.update({dialogue:{activityLevel:'relaxed'}});});
    await a.evaluate(async()=>{const a=(globalThis as any).__capri;a.presentRemark('I am keeping this corner for a bit.',true,false,{event:'notice'});await a.generatedRemark('inspect','A new view.',{target:777n});});
    expect(requests).toHaveLength(1);
    const waiting=await a.evaluate(()=>{const a=(globalThis as any).__capri,native=Date.now;Date.now=()=>native()+31000;try{a.presenceTick();return a.behavior.opportunityReady();}finally{Date.now=native;}});
    expect(waiting).toBe(true);expect(requests).toHaveLength(1);
    await a.evaluate(async()=>{const a=(globalThis as any).__capri,native=Date.now;Date.now=()=>native()+46000;try{a.presenceTick();while(a.behavior.busy)await new Promise(r=>setTimeout(r,10));}finally{Date.now=native;}});
    expect(requests).toHaveLength(2);expect(requests[1].event).toBe('opportunity');expect(requests[1].delivery.speechAllowed).toBe(true);
  });
  it('can initiate from its own physical experience without collecting another screenshot',async()=>{
    const {a,requests}=await boot();
    const result=await a.evaluate(async()=>{const g=globalThis as any,a=g.__capri;Object.defineProperty(g,'__capriObservationOverride',{get(){throw Error('Self-directed thought must not collect a screenshot');},configurable:true});
      return a.generatedRemark('roam','Completed a floating visit and chose a spot to keep. Consider your own preference.');});
    expect(requests).toHaveLength(1);expect(requests[0].input.observation).toBeUndefined();expect(requests[0].delivery.speechAllowed).toBe(true);expect(result).toMatchObject({action:'speak',delivered:true});
  });
  it('preserves visual understanding while recent speech produces a gesture instead of another aside',async()=>{
    const {a,requests}=await boot();
    const result=await a.evaluate(async()=>{const a=(globalThis as any).__capri;a.presentRemark('I am settling here for a moment.',true,false,{event:'notice'});const before=a.bubble.state.text;
      const decision=await a.generatedRemark('inspect','A genuinely new visual detail.',{target:777n});return {decision,before,after:a.bubble.state.text,points:a.lastInspection?.points.length,spoken:a.scenes.recent().filter((s:any)=>s.kind==='said').length};});
    expect(requests).toHaveLength(1);expect(requests[0].delivery.speechAllowed).toBe(false);
    expect(result.decision).toMatchObject({action:'gesture',line:''});expect(result.after).toBe(result.before);expect(result.points).toBe(1);expect(result.spoken).toBe(1);
  });
  it('does not request the model again for an unchanged accepted exposed image',async()=>{
    const {a,requests}=await boot();
    await a.evaluate(async()=>{const a=(globalThis as any).__capri;await a.generatedRemark('inspect','Initial observation.',{target:777n});});
    expect(requests).toHaveLength(1);
    const outcome=await a.evaluate(async()=>{const g=globalThis as any,a=g.__capri,native=Date.now;Date.now=()=>native()+31000;try{await a.generatedRemark('inspect','Return to the same view.',{target:777n});return a.lastDialogueOutcome;}finally{Date.now=native;}});
    expect(requests).toHaveLength(1);expect(outcome).toContain('same semantic subject');
  });
  it('does not revive an investigated semantic subject merely because pixels changed',async()=>{
    const {a,requests}=await boot();
    const result=await a.evaluate(async()=>{const g=globalThis as any,a=g.__capri,native=Date.now;let offset=0;Date.now=()=>native()+offset;
      try {
        await a.generatedRemark('inspect','Initial look.',{target:777n});
        offset=31000; await a.generatedRemark('inspect','Unchanged view.',{target:777n});
        g.__capriObservationOverride.jpegBase64='changed-image';
        await a.generatedRemark('inspect','A changed view under the same title.',{target:777n});
        return a.behavior.snapshot().facts.filter((f:any)=>f.evidence==='visual');
      } finally {Date.now=native;}
    });
    expect(requests).toHaveLength(1);expect(result).toHaveLength(1);
  });
  it('does not spend optional request allowance when an exposed capture is temporarily unavailable',async()=>{
    const {a,requests}=await boot();
    await a.evaluate(async()=>{const g=globalThis as any,a=g.__capri,preview=g.__capriObservationOverride;
      g.__capriObservationOverride=null;await a.generatedRemark('inspect','Unavailable exposed crop.',{target:777n});
      g.__capriObservationOverride=preview;await a.generatedRemark('inspect','The crop is available now.',{target:777n});
    });
    expect(requests).toHaveLength(1);
  });
  it('cancels optional old-window speech when focus changes even if the old window remains exposed',async()=>{
    const {a,requests}=await boot({delay:800});
    await a.evaluate(()=>{const g=globalThis as any;g.__pending=g.__capri.generatedRemark('inspect','Check the current window.',{target:777n});});
    await expect.poll(()=>requests.length).toBe(1);
    await a.evaluate(()=>{const g=globalThis as any;g.__capriWindowsOverride.push({handle:888n,rect:{x:850,y:150,width:600,height:500}});g.__capriWindowInfo['888']={title:'Different work',process:'fixture.exe'};g.__capriForegroundHandle=888n;g.__capri.presenceTick();});
    await a.evaluate(async()=>{await (globalThis as any).__pending;});
    expect(await a.evaluate(()=>(globalThis as any).__capri.bubble.state.text)).not.toContain('That branch');
    expect(await a.evaluate(()=>(globalThis as any).__capri.behavior.busy)).toBe(false);
  });
});
