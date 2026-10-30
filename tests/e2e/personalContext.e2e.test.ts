import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { _electron as electron, type ElectronApplication } from 'playwright-core';
import { afterEach, expect, it } from 'vitest';
import { closeIsolatedApp } from './lifecycle';
let app: ElectronApplication | undefined, server: http.Server | undefined;
const dirs: string[] = [], root = path.resolve(__dirname, '../..');
afterEach(async () => {
  await closeIsolatedApp(app); app = undefined; server?.closeAllConnections();
  if (server) await new Promise<void>(r => server!.close(() => r())); server = undefined;
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});
async function fixture(followUpDelay = 0) {
  const requests: any[] = [];
  server = http.createServer((req,res) => {
    if (req.url?.endsWith('/models')) { res.end('{"data":[{"id":"fixture"}]}'); return; }
    let raw = ''; req.on('data', c => raw += c); req.on('end', () => {
      const body = JSON.parse(raw); requests.push(body);
      const system = body.messages[0].content;
      const text = system.includes('Choose one desktop-companion decision')
        ? JSON.stringify({ interpretation:'Use the sourced current subject and eligible opportunity.', interest:null, action:'speak', line:system.includes('"title":"ArborCalc"') ? 'Any news on the comparison?' : "Weren't you going to bed after that?", gesture:'nod', reason:'One grounded callback to the eligible user intention.' })
        : system.includes('Extract durable personal memory') ? JSON.stringify({changes:[],situations:[],commitments:[]}) : 'Fine. Get some rest.';
      setTimeout(() => { if (res.destroyed) return; res.writeHead(200,{'content-type':'text/event-stream'});
        res.end('data: '+JSON.stringify({choices:[{delta:{content:text}}]})+'\n\ndata: [DONE]\n\n');
      },system.includes('Choose one desktop-companion decision') ? followUpDelay : 0);
    });
  });
  await new Promise<void>(r => server!.listen(0,'127.0.0.1',r));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(),'capri-personal-')); dirs.push(dir);
  fs.writeFileSync(path.join(dir,'settings.json'),JSON.stringify({firstRunComplete:true,character:{startupIntro:false,hideOnFullscreen:false},
    ai:{provider:'openai',openai:{baseUrl:`http://127.0.0.1:${(server.address() as any).port}/v1`,model:'fixture'}},
    memory:{autoLearn:true},dialogue:{localContext:true,contextPings:false,spotifyBanter:false},voice:{ttsEnabled:false,interactionLines:true},
    behavior:{smallActivities:false,idleRemarks:false,explore:false,quietHours:{enabled:false}},teleport:{auto:false,effects:false}}));
  return {dir,requests};
}
async function boot(dir: string) {
  app = await electron.launch({...(process.env.CAPRI_EXE ? {executablePath:process.env.CAPRI_EXE,args:[]} : {args:[root]}),
    env:{...process.env,CAPRI_TEST:'1',CAPRI_OFFSCREEN:'1',CAPRI_NO_DEV_KEY:'1',CAPRI_USER_DATA:dir}});
  const char = await app.firstWindow(); await char.waitForFunction(() => !!(window as any).__capriDebug);
  await app.evaluate(() => { const g = globalThis as any; g.__capriIdleOverride = 0; g.__capriDesktopOverride = {title:'Synthetic fixture',process:'fixture.exe'}; });
  return app;
}
it('carries an actual after-reply intention through restart into the existing autonomous lane and records only its delivered callback', async () => {
  const {dir,requests} = await fixture(1000); let a = await boot(dir);
  await a.evaluate(async () => { const a = (globalThis as any).__capri; await a.convo.send('I will go to bed after this reply.'); await a.convo.settle(); a.memoryLearner.discard(); });
  expect(await a.evaluate(() => (globalThis as any).__capri.personalContext.snapshot().commitments[0].status)).toBe('eligible');
  await closeIsolatedApp(app); app = undefined;
  // Replay six elapsed minutes without waiting or claiming an observed real-user outcome.
  const file = path.join(dir,'personal-context.json'), saved = JSON.parse(fs.readFileSync(file,'utf8'));
  saved.commitments[0].eligibleAt -= 6 * 60000; fs.writeFileSync(file,JSON.stringify(saved));
  a = await boot(dir);
  await a.evaluate(() => { const a = (globalThis as any).__capri; a.settings.update({behavior:{idleRemarks:true}}); a.presenceTick(); });
  await expect.poll(() => requests.filter(r => JSON.stringify(r.messages.at(-1)).includes('personal_followup')).length).toBe(1);
  const char = a.windows().find(w => w.url().includes('character.html'))!;
  await char.evaluate(() => (window as any).capri.invoke('char:poseRenderer',{pose:'recline',shader:false,reduced:false,motion:1}));
  await expect.poll(() => a.evaluate(() => (globalThis as any).__capri.personalContext.snapshot().commitments[0].status)).toBe('mentioned');
  const request = requests.find(r => JSON.stringify(r.messages.at(-1)).includes('personal_followup'));
  expect(request.messages[0].content).toContain('WORKING USER CONTEXT');
  expect(request.messages[0].content).toContain('Matching assistant reply was delivered');
  expect(request.messages[0].content).toContain('LASTING CAPRI GUIDE');
  expect(request.messages[0].content).toContain('without narrating your current pose');
  expect(JSON.stringify(request)).not.toContain('image_url');
  await a.evaluate(() => { const a = (globalThis as any).__capri; a.presenceTick(); a.presenceTick(); });
  expect(requests.filter(r => JSON.stringify(r.messages.at(-1)).includes('personal_followup'))).toHaveLength(1);
  expect(fs.readFileSync(path.join(dir,'history.jsonl'),'utf8')).toContain("Weren't you going to bed after that?");
});
it('exposes source evidence and stop/forget controls in Memory, and clears the new store with saved-history privacy', async () => {
  const {dir} = await fixture(), a = await boot(dir);
  await a.evaluate(async () => { const a = (globalThis as any).__capri; await a.convo.send('I will go to bed after this reply.'); await a.convo.settle(); a.memoryLearner.discard(); });
  const char = a.windows().find(w => w.url().includes('character.html'))!;
  await char.evaluate(() => (window as any).capri.invoke('panel:open','memory'));
  await expect.poll(() => a.windows().some(w => w.url().includes('panel.html'))).toBe(true);
  const panel = a.windows().find(w => w.url().includes('panel.html'))!;
  await expect.poll(() => panel.getByText('Working understanding',{exact:true}).count()).toBe(1);
  expect(await panel.getByText('You said: “I will go to bed after this reply.”',{exact:false}).count()).toBe(1);
  if (process.env.CAPRI_PERSONAL_SCREENSHOT) { await panel.getByText('Working understanding',{exact:true}).scrollIntoViewIfNeeded(); await panel.screenshot({path:process.env.CAPRI_PERSONAL_SCREENSHOT}); }
  await panel.getByRole('button',{name:'Stop follow-ups',exact:true}).click();
  expect(await a.evaluate(() => (globalThis as any).__capri.personalContext.snapshot().commitments[0].status)).toBe('cancelled');
  await panel.getByRole('button',{name:'Forget intention',exact:true}).click();
  expect(await a.evaluate(() => (globalThis as any).__capri.personalContext.snapshot().commitments)).toEqual([]);
  await a.evaluate(async () => { const a = (globalThis as any).__capri; await a.convo.send('Off the record: I will go to bed after this reply.'); await a.convo.settle(); a.memoryLearner.discard(); });
  expect(JSON.stringify(await a.evaluate(() => (globalThis as any).__capri.personalContext.snapshot()))).not.toContain('Off the record');
  await a.evaluate(() => { const a = (globalThis as any).__capri; a.settings.update({privacy:{saveHistory:false}}); a.settings.flush(); });
  expect(fs.existsSync(path.join(dir,'personal-context.json'))).toBe(false);
});
it('selects a named project spontaneously and records its delivered check-in even when the line uses a pronoun', async () => {
  const {dir,requests} = await fixture(), a = await boot(dir);
  await a.evaluate(() => {
    const a = (globalThis as any).__capri;
    a.relationship.setThread({title:'ArborCalc',summary:'Comparing a narrower baseline.',status:'active',nextAskAt:Date.now()-1000});
    a.settings.update({behavior:{idleRemarks:true}}); a.presenceTick();
  });
  await expect.poll(() => requests.some(r => JSON.stringify(r.messages.at(-1)).includes('personal_followup'))).toBe(true);
  await expect.poll(() => a.evaluate(() => (globalThis as any).__capri.relationship.snapshot().threads[0].asksSinceUpdate)).toBe(1);
  const prompt = requests.find(r => JSON.stringify(r.messages.at(-1)).includes('personal_followup')).messages[0].content;
  expect(prompt).toContain('"title":"ArborCalc"'); expect(prompt).toContain('"followUp":{"id":');
  const thread = await a.evaluate(() => (globalThis as any).__capri.relationship.snapshot().threads[0]);
  expect(thread.nextAskAt).toBeGreaterThan(Date.now()+6*86400000);
});
it.each(['direct chat','sleep','focus'] as const)('cancels a pending personal follow-up for %s', async interruption => {
  const {dir,requests} = await fixture(1000), a = await boot(dir);
  await a.evaluate(() => {
    const a = (globalThis as any).__capri;
    a.personalContext.userMessage({text:'I will go to bed after this reply.',messageId:'old-plan',at:Date.now()-10*60000});
    a.personalContext.replyDelivered('old-plan','old-reply',Date.now()-9*60000);
    a.settings.update({behavior:{idleRemarks:true}}); a.presenceTick();
  });
  await expect.poll(() => requests.some(r => JSON.stringify(r.messages.at(-1)).includes('personal_followup'))).toBe(true);
  await a.evaluate(async(_e,interruption) => {
    const a = (globalThis as any).__capri;
    if (interruption === 'direct chat') { await a.convo.send("I changed my mind about sleep. I'm staying up."); await a.convo.settle(); a.memoryLearner.discard(); }
    else a.applyCompanyControl(interruption === 'sleep' ? {kind:'sleep'} : {kind:'focus',minutes:10});
  },interruption);
  await expect.poll(() => a.evaluate(() => !(globalThis as any).__capri.behavior.busy)).toBe(true);
  const state = await a.evaluate(() => { const a = (globalThis as any).__capri; return {commitment:a.personalContext.snapshot().commitments[0],lines:a.scenes.recent().filter((s:any)=>s.kind==='said').map((s:any)=>s.text)}; });
  expect(state.lines).not.toContain("Weren't you going to bed after that?");
  expect(state.commitment.status).toBe(interruption === 'direct chat' ? 'cancelled' : 'eligible');
});
