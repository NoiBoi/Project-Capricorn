import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { _electron as electron, type ElectronApplication } from 'playwright-core';
import { afterEach, describe, expect, it } from 'vitest';
const root = path.resolve(__dirname, '../..');
let app: ElectronApplication | undefined, server: http.Server | undefined;
const dirs: string[] = [];
afterEach(async () => {
  if (app) await app.close().catch(() => {}); app = undefined;
  server?.closeAllConnections(); if (server) await new Promise<void>(r => server!.close(() => r())); server = undefined;
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive:true,force:true,maxRetries:10,retryDelay:100 });
});
async function model() {
  const requests: any[] = [];
  server = http.createServer((req,res) => {
    if (req.url?.endsWith('/models')) { res.end(JSON.stringify({data:[{id:'test'}]})); return; }
    let raw=''; req.on('data',c=>raw+=c); req.on('end',()=>{
      const body=JSON.parse(raw); requests.push(body);
      let text='The earlier graph curiosity stays quiet now.';
      if (body.messages[0].content.includes('Choose one desktop-companion decision')) {
        const content=body.messages.at(-1).content;
        const input=JSON.parse(Array.isArray(content)?content.find((p:any)=>p.type==='text').text:content), source=input.input.observation;
        const known=body.messages[0].content.includes('SHARED EXPERIENCES')||!source;
        text=JSON.stringify(known ? { interpretation:'The earlier branching graph makes this visit familiar.',interest:null,action:'speak',line:'I recognize this corner. Those branching connections caught my eye.',gesture:'curious',reason:'Recognize the earlier experience without repeating its question.' }
          : { interpretation:'The routing looks worth understanding later.',interest:{topic:'node wiring',intention:'Understand how the connections route signals.',sourceId:source.id,quote:source.detail},action:'defer',line:'',gesture:'none',reason:'Keep a grounded curiosity without interrupting.',
            ...(Array.isArray(content)?{facts:['A green connection ends outside its enclosure.'],curiosity:'Where does the outside connection lead?',points:[{x:.5,y:.4,label:'outside connection'}]}:{}) });
      } else if (body.messages[0].content.includes('Extract durable personal memory')) text=JSON.stringify({changes:[],tastes:[],threads:[],episodes:[]});
      res.writeHead(200,{'content-type':'text/event-stream'});res.end('data: '+JSON.stringify({choices:[{delta:{content:text}}]})+'\n\ndata: [DONE]\n\n');
    });
  });
  await new Promise<void>(r=>server!.listen(0,'127.0.0.1',r));
  return {requests,url:`http://127.0.0.1:${(server.address() as {port:number}).port}/v1`};
}
function profile(url?:string,model?:string) {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'capri-stage2-'));dirs.push(dir);
  fs.writeFileSync(path.join(dir,'settings.json'),JSON.stringify({firstRunComplete:true,character:{hideOnFullscreen:false},
    ai:url?{provider:'openai',openai:{baseUrl:url,model:'test'}}:{provider:'codex',codex:{chatModel:model},requestTimeoutSec:30},
    actions:{policies:{read_screen:'allow'}},memory:{autoLearn:true},voice:{ttsEnabled:false},dialogue:{localContext:true},
    behavior:{quietHours:{enabled:false},explore:false,idleRemarks:false,smallActivities:false},teleport:{auto:false}}));return dir;
}
async function launch(dir:string,handle='888') {
  app=await electron.launch({...(process.env.CAPRI_EXE?{executablePath:process.env.CAPRI_EXE,args:[]}:{args:[root]}),env:{...process.env,CAPRI_TEST:'1',CAPRI_OFFSCREEN:'1',CAPRI_USER_DATA:dir,CAPRI_NO_DEV_KEY:'1'}});
  await app.firstWindow();for(let i=0;i<100;i++){if(await app.evaluate(()=>!!(globalThis as any).__capri))break;await new Promise(r=>setTimeout(r,100));}
  await app.evaluate((_e,h)=>{const g=globalThis as any;g.__capriIdleOverride=0;g.__capriDesktopOverride={title:'Routing laboratory',process:'synth.exe'};g.__capriForegroundHandle=BigInt(h);g.__capriWindowInfo={[h]:{title:'Routing laboratory',process:'synth.exe'}};g.__capriWindowsOverride=[{handle:BigInt(h),rect:{x:100,y:180,width:900,height:600}}];},handle);
  return app;
}
describe('episodic continuity in the integrated companion',()=>{
  it('links quiet visual evidence, episodic memory, direct chat and touch across restart',async()=>{
    const m=await model(),dir=profile(m.url);let a=await launch(dir);
    const first=await a.evaluate(async()=>{
      const g=globalThis as any,a=g.__capri,rect={x:100,y:180,width:900,height:600};
      g.__capriObservationOverride={jpegBase64:'fixture',region:rect,window:rect};
      await a.generatedRemark('inspect','A selective view of the routing diagram.',{target:888n});
      a.memoryLearner.discard();
      return {episodes:a.scenes.experiences(),said:a.scenes.recent().filter((s:any)=>s.kind==='said'),points:a.lastInspection.points};
    });
    expect(m.requests).toHaveLength(1);expect(first.said).toEqual([]);expect(first.points).toHaveLength(1);
    expect(first.episodes).toHaveLength(1);expect(first.episodes[0].sources[0].reliability).toBe('visual-interpretation');
    await a.evaluate(async()=>{const a=(globalThis as any).__capri;await a.convo.send('What caught your attention in the routing diagram?');await a.convo.settle();a.memoryLearner.discard();});
    expect(m.requests[1].messages[0].content).toContain('Where does the outside connection lead?');
    expect(m.requests[1].messages[0].content).toContain('SHARED EXPERIENCES');
    await a.close();app=undefined;
    const saved=JSON.parse(fs.readFileSync(path.join(dir,'companion-scenes.json'),'utf8'));
    expect(saved.version).toBe(2);expect(saved.episodes).toHaveLength(1);
    a=await launch(dir,'999');
    await a.evaluate(()=>{Math.random=()=>.99;(globalThis as any).__capri.interaction('pat');});
    await expect.poll(()=>m.requests.length).toBe(3);
    await expect.poll(()=>a!.evaluate(()=>!(globalThis as any).__capri.behavior.busy)).toBe(true);
    expect(m.requests[2].messages[0].content).toContain('node wiring');
    expect(m.requests[2].messages[0].content).toContain('visual-interpretation');
    const episodes=await a.evaluate(()=>(globalThis as any).__capri.scenes.experiences());
    expect(episodes[0].want.expiresAt).toBe(first.episodes[0].want.expiresAt);
  });
  it('recognizes a prior curiosity with a new window handle after restart and exposes its evidence in Memory',async()=>{
    const m=await model(),dir=profile(m.url);let a=await launch(dir);
    await a.evaluate(async()=>{await (globalThis as any).__capri.generatedRemark('placed_window','',{target:888n});});
    expect(await a.evaluate(()=>(globalThis as any).__capri.scenes.experiences().length)).toBe(1);
    await a.close();app=undefined;
    const budget=path.join(dir,'background-budget.json');
    if(fs.existsSync(budget))fs.writeFileSync(budget,JSON.stringify(JSON.parse(fs.readFileSync(budget,'utf8')).map((r:any)=>({...r,at:r.at-16000}))));
    a=await launch(dir,'999');
    await a.evaluate(()=>{Math.random=()=>.99;(globalThis as any).__capri.interaction('pat');});
    await expect.poll(()=>m.requests.some(r=>r.messages.at(-1).content.includes('"event":"pat"'))).toBe(true);
    await expect.poll(()=>a.evaluate(()=>!(globalThis as any).__capri.behavior.busy)).toBe(true);
    const touch=m.requests.find(r=>r.messages.at(-1).content.includes('"event":"pat"'));
    expect(touch.messages[0].content).toContain('node wiring');
    await a.evaluate(async()=>{await (globalThis as any).__capri.generatedRemark('placed_window','',{target:999n});});
    const latest=m.requests.filter(r=>r.messages[0].content.includes('Choose one desktop')).at(-1);
    expect(latest.messages[0].content).toContain('SHARED EXPERIENCES');
    expect(latest.messages[0].content).toContain('Window metadata only');
    const char=a.windows().find(w=>w.url().includes('character.html'))!;
    await char.evaluate(()=>window.capri.invoke('panel:open','memory'));
    let panel=a.windows().find(w=>w.url().includes('panel.html'));
    for(let i=0;!panel&&i<60;i++){await new Promise(r=>setTimeout(r,100));panel=a.windows().find(w=>w.url().includes('panel.html'));}
    if(!panel)throw Error('No memory panel');
    await expect.poll(()=>panel!.getByText('Shared experiences',{exact:true}).count()).toBe(1);
    if(process.env.CAPRI_STAGE2_SCREENSHOT){await panel.getByText('Shared experiences',{exact:true}).scrollIntoViewIfNeeded();await panel.screenshot({path:process.env.CAPRI_STAGE2_SCREENSHOT});}
    await panel.getByRole('button',{name:'Drop interest',exact:true}).click();
    expect(await a.evaluate(()=>(globalThis as any).__capri.scenes.experiences()[0].want.status)).toBe('dismissed');
    await panel.getByRole('button',{name:'Forget experience',exact:true}).click();
    expect(await a.evaluate(()=>(globalThis as any).__capri.scenes.experiences().length)).toBe(0);
  });
  it('a private exchange is not saved, reflected into episodes or recalled after restart',async()=>{
    const m=await model(),dir=profile(m.url),a=await launch(dir);
    await a.evaluate(async()=>{const a=(globalThis as any).__capri;await a.convo.send('Off the record: the private node project is called Juniper.');await a.convo.settle();a.memoryLearner.discard();});
    const history=fs.existsSync(path.join(dir,'history.jsonl'))?fs.readFileSync(path.join(dir,'history.jsonl'),'utf8'):'';
    expect(history).not.toContain('Juniper');expect(await a.evaluate(()=>(globalThis as any).__capri.scenes.experiences().length)).toBe(0);
    await a.close();app=undefined;const b=await launch(dir);
    await b.evaluate(async()=>{const a=(globalThis as any).__capri;await a.convo.send('What was that private project called?');await a.convo.settle();a.memoryLearner.discard();});
    expect(JSON.stringify(m.requests.at(-1).messages)).not.toContain('Juniper');
  });
  it.runIf(process.env.CAPRI_STAGE2_ISOLATED_LIVE==='1')('isolates real episodic recall from recent chat with one generation',async()=>{
    const file=path.join(root,'docs/stage2/live-results.json'),prior=JSON.parse(fs.readFileSync(file,'utf8'));
    const config=JSON.parse(fs.readFileSync(path.join(process.env.APPDATA!,'Capri Buddy','settings.json'),'utf8'));
    expect(config.ai.provider).toBe('codex');const a=await launch(profile(undefined,config.ai.codex.chatModel));
    const result=await a.evaluate(async(_e,captured)=>{
      const a=(globalThis as any).__capri;a.settings.update({ai:{historyTurns:0}});a.conversationScene.clear();
      a.scenes.remember({topic:captured.topic,sourceId:captured.sources[0].id,evidence:captured.sources[0].text,interpretation:captured.readings[0].text,tags:captured.tags},captured.sources);
      await a.convo.send('Which hue were you leaning toward last time?');await a.convo.settle();a.memoryLearner.discard();
      return {historyTurns:a.settings.get().ai.historyTurns,exchange:a.conversationScene.snapshot(),episodes:a.scenes.experiences()};
    },prior.first.episodes[0]);
    prior.isolatedRecall={scope:'One additional generation; no earlier chat/history supplied, only a captured public episodic opinion.',result};fs.writeFileSync(file,JSON.stringify(prior,null,2));
    expect(result.exchange.entries).toHaveLength(2);expect(result.exchange.entries.at(-1).text.toLowerCase()).toContain('violet');
  });
  it.runIf(process.env.CAPRI_STAGE2_LIVE==='1')('checks actual opinion continuity across restart with three generations',async()=>{
    const settings=JSON.parse(fs.readFileSync(path.join(process.env.APPDATA!,'Capri Buddy','settings.json'),'utf8'));expect(settings.ai.provider).toBe('codex');
    const dir=profile(undefined,settings.ai.codex.chatModel);let a=await launch(dir);
    const first=await a.evaluate(async()=>{
      const a=(globalThis as any).__capri;await a.convo.send('I am comparing muted green and vivid violet. Which do you prefer for a small color study?');await a.convo.settle();a.memoryLearner.discard();
      const e=a.conversationScene.snapshot().entries.filter((e:any)=>e.role==='assistant').at(-1);
      const source={id:e.id,at:e.at,role:'assistant',reliability:'delivered',text:e.text};
      a.scenes.remember({topic:'Color preference',sourceId:e.id,evidence:e.text,interpretation:'Capri expressed this color preference.',tags:['palette','hue']},[source]);return {line:e.text,episodes:a.scenes.experiences()};
    });
    await a.close();app=undefined;a=await launch(dir,'999');
    const later=await a.evaluate(async()=>{const a=(globalThis as any).__capri;await a.convo.send('Which hue did you side with earlier, and why?');await a.convo.settle();a.memoryLearner.discard();const before=a.conversationScene.snapshot();await a.generatedRemark('pat');return{before,after:a.conversationScene.snapshot(),episodes:a.scenes.experiences(),outcome:a.lastDialogueOutcome};});
    fs.mkdirSync(path.join(root,'docs/stage2'),{recursive:true});fs.writeFileSync(path.join(root,'docs/stage2/live-results.json'),JSON.stringify({model:settings.ai.codex.chatModel,scope:'Three generation opportunities; a selected actual delivered opinion was promoted locally using its exact quote. This checks recall, not spontaneous episode selection.',first,later},null,2));
    expect(first.episodes).toHaveLength(1);expect(later.episodes).toHaveLength(1);
  });
});
