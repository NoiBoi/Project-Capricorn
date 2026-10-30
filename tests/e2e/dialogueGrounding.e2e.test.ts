import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { _electron as electron, type ElectronApplication } from 'playwright-core';
import { afterEach, expect, it } from 'vitest';
import { closeIsolatedApp } from './lifecycle';
const root=path.resolve(__dirname,'../..');
let app:ElectronApplication|undefined,server:http.Server|undefined;
const dirs:string[]=[];
afterEach(async()=>{await closeIsolatedApp(app);app=undefined;server?.closeAllConnections();if(server)await new Promise<void>(r=>server!.close(()=>r()));server=undefined;for(const dir of dirs.splice(0))fs.rmSync(dir,{recursive:true,force:true,maxRetries:5,retryDelay:100});});
it('supplies the same actual body and dated topic history to chat and physical reactions across restart',async()=>{
  const requests:any[]=[];
  server=http.createServer((req,res)=>{
    if(req.url?.endsWith('/models')){res.end(JSON.stringify({data:[{id:'fixture'}]}));return;}
    let raw='';req.on('data',c=>raw+=c);req.on('end',()=>{
      const body=JSON.parse(raw);requests.push(body);
      const content=body.messages.at(-1).content;
      const line=typeof content==='string'&&content.includes('"event":"pat"')?JSON.stringify({interpretation:'Contact during the baseline discussion.',interest:null,action:'speak',line:'Mm. I still vote for the narrow baseline.',gesture:'nod',reason:'A familiar reaction to contact.'}):'The narrower baseline is still my choice.';
      res.writeHead(200,{'content-type':'text/event-stream'});res.end('data: '+JSON.stringify({choices:[{delta:{content:line}}]})+'\n\ndata: [DONE]\n\n');
    });
  });
  await new Promise<void>(r=>server!.listen(0,'127.0.0.1',r));
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'capri-grounding-'));dirs.push(dir);
  const url=`http://127.0.0.1:${(server.address() as any).port}/v1`;
  fs.writeFileSync(path.join(dir,'settings.json'),JSON.stringify({firstRunComplete:true,ai:{provider:'openai',historyTurns:1,openai:{baseUrl:url,model:'fixture'}},memory:{autoLearn:false},dialogue:{localContext:false},voice:{ttsEnabled:false},behavior:{idleRemarks:false,explore:false,quietHours:{enabled:false}},teleport:{auto:false}}));
  async function boot(){
    app=await electron.launch({...(process.env.CAPRI_EXE?{executablePath:process.env.CAPRI_EXE,args:[]}:{args:[root]}),env:{...process.env,CAPRI_TEST:'1',CAPRI_OFFSCREEN:'1',CAPRI_USER_DATA:dir,CAPRI_NO_DEV_KEY:'1'}});
    const char=await app.firstWindow();await char.waitForFunction(()=>!!(window as any).__capriDebug);
    await app.evaluate(()=>{const g=globalThis as any;g.__capriIdleOverride=0;g.__capriDesktopOverride={title:'Test',process:'fixture.exe'};});
    return app;
  }
  const a=await boot();
  await a.evaluate(async()=>{
    const a=(globalThis as any).__capri,at=Date.now()-7*86400000;
    a.history.append({id:'old-u',role:'user',content:'MAXCalc baseline comparison: I am trying a narrow baseline around the small peak.',ts:at});
    a.history.append({id:'old-a',role:'assistant',content:'I vote for the narrower baseline because the small peak matters.',ts:at+1});
    a.history.append({id:'other-u',role:'user',content:'Hello.',ts:at+2});
    a.history.append({id:'other-a',role:'assistant',content:'Hi.',ts:at+3});
    a.conversationScene.record({id:'topic',role:'user',text:'Back to MAXCalc baseline comparison.',event:'chat',at:Date.now()});
    await a.generatedRemark('pat');
  });
  const pat=requests.find(r=>r.messages.at(-1).content.includes('"event":"pat"'));
  expect(pat).toBeDefined();expect(pat.messages[0].content).toContain('CURRENT BODY');
  expect(pat.messages[0].content).toContain('"held":false');expect(pat.messages[0].content).toContain('RELEVANT EARLIER EXCHANGES');
  expect(pat.messages[0].content).toContain('small peak matters');
  await closeIsolatedApp(app);app=undefined;
  const b=await boot();await b.evaluate(async()=>{const a=(globalThis as any).__capri;await a.convo.send('What was your MAXCalc baseline choice?');await a.convo.settle();});
  const chat=requests.at(-1);expect(chat.messages[0].content).toContain('CURRENT BODY');expect(chat.messages[0].content).toContain('LASTING RAPPORT');
  expect(chat.messages[0].content).toContain('small peak matters');
  const char=b.windows().find(w=>w.url().includes('character.html'))!;
  await char.evaluate(()=>(window as any).capri.invoke('panel:open','character'));
  await expect.poll(()=>b.windows().some(w=>w.url().includes('panel.html'))).toBe(true);
  const panel=b.windows().find(w=>w.url().includes('panel.html'))!;
  const activity=panel.getByRole('combobox',{name:'Conversation activity',exact:true});
  await activity.waitFor({timeout:15000});
  await expect.poll(()=>activity.inputValue()).toBe('lively');
  const before=await panel.evaluate(()=>(window as any).capri.invoke('dev:get'));
  expect(before.gates.budgets.find((p:any)=>p.purpose==='ambient').limit).toBe(24);
  await activity.selectOption('relaxed');
  await expect.poll(()=>b.evaluate(()=>(globalThis as any).__capri.settings.get().dialogue.activityLevel)).toBe('relaxed');
  const after=await panel.evaluate(()=>(window as any).capri.invoke('dev:get'));
  expect(after.gates.budgets.find((p:any)=>p.purpose==='ambient').limit).toBe(6);
  await panel.getByRole('combobox',{name:'Conversation activity',exact:true}).selectOption('lively');
  if(process.env.CAPRI_ACTIVITY_SCREENSHOT){await panel.getByRole('combobox',{name:'Conversation activity',exact:true}).scrollIntoViewIfNeeded();await panel.screenshot({path:process.env.CAPRI_ACTIVITY_SCREENSHOT});}
});
