import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { _electron as electron, type ElectronApplication } from 'playwright-core';
import { afterEach, expect, it } from 'vitest';
import { closeIsolatedApp } from './lifecycle';
let app: ElectronApplication | undefined, server: http.Server | undefined, dir: string;
afterEach(async () => {
  if (app) await app.evaluate(async () => { const a = (globalThis as any).__capri; a.settings.update({ memory: { honcho: { enabled: false } } }); await a.honcho.privacyChanged(); }).catch(() => {});
  await closeIsolatedApp(app); app = undefined; server?.closeAllConnections();
  if (server) await new Promise<void>(r => server!.close(() => r())); server = undefined;
  if (dir) fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});
it.skipIf(process.env.CAPRI_REAL_HONCHO !== '1')('uses real local Honcho derivation in packaged chat and ambient prompts, exposes the reading, excludes a private turn, and deletes on privacy disable', async () => {
  const requests: any[] = [];
  server = http.createServer((req,res) => {
    if (req.url?.endsWith('/models')) { res.end('{"data":[{"id":"fixture"}]}'); return; }
    let raw = ''; req.on('data', c => raw += c); req.on('end', () => { const body = JSON.parse(raw); requests.push(body);
      const text = body.messages[0].content.includes('Choose one desktop-companion decision') ? JSON.stringify({interpretation:'Connect the supplied memory to this exchange.',interest:null,action:'speak',line:'That report deadline is still Friday.',gesture:'nod',reason:'Use actual supplied fixture context.'}) : 'Fixture acknowledged.';
      res.writeHead(200, {'content-type':'text/event-stream'}); res.end('data: '+JSON.stringify({choices:[{delta:{content:text}}]})+'\n\ndata: [DONE]\n\n');
    });
  });
  await new Promise<void>(r => server!.listen(0,'127.0.0.1',r));
  dir = fs.mkdtempSync(path.join(os.tmpdir(),'capri-real-honcho-'));
  fs.writeFileSync(path.join(dir,'settings.json'),JSON.stringify({ firstRunComplete:true, character:{startupIntro:false,hideOnFullscreen:false},
    ai:{provider:'openai',openai:{baseUrl:`http://127.0.0.1:${(server.address() as any).port}/v1`,model:'fixture'}},
    memory:{autoLearn:true,honcho:{enabled:true}},dialogue:{localContext:true,contextPings:false,spotifyBanter:false},voice:{ttsEnabled:false},
    behavior:{smallActivities:false,idleRemarks:false,explore:false,quietHours:{enabled:false}},teleport:{auto:false,effects:false} }));
  const at = Date.now()-60000;
  fs.writeFileSync(path.join(dir,'history.jsonl'), [{id:'fixture-u',role:'user',content:'For this synthetic test, my fictional ENGR 210 lab report is due Friday. My fictional project ArborCalc still needs its exporter fixed.',ts:at},{id:'fixture-a',role:'assistant',content:'I prefer violet interfaces because the contrast against gray is sharper.',ts:at+1000}].map(m => JSON.stringify(m)).join('\n')+'\n');
  app = await electron.launch({ ...(process.env.CAPRI_EXE ? {executablePath:process.env.CAPRI_EXE,args:[]} : {args:[path.resolve(__dirname,'../..')]}), env:{...process.env,CAPRI_TEST:'1',CAPRI_OFFSCREEN:'1',CAPRI_NO_DEV_KEY:'1',CAPRI_USER_DATA:dir} });
  const char = await app.firstWindow(); await char.waitForFunction(() => !!(window as any).__capriDebug);
  await expect.poll(async () => { await app!.evaluate(async () => { await (globalThis as any).__capri.honcho.refresh(); }); return app!.evaluate(() => (globalThis as any).__capri.honcho.status().userProfile); }, {timeout:150000,interval:4000}).toMatch(/ENGR|ArborCalc|report/i);
  const reading = await app.evaluate(() => (globalThis as any).__capri.honcho.status());
  await app.evaluate(async () => { const a=(globalThis as any).__capri; await a.convo.send('What class report did I mention?'); await a.convo.settle(); a.memoryLearner.discard(); });
  const chat = requests.find(r => r.messages.at(-1).content === 'What class report did I mention?');
  expect(chat.messages[0].content).toContain('HONCHO LONG-TERM UNDERSTANDING'); expect(chat.messages[0].content).toMatch(/ENGR|report/i);
  expect(chat.messages[0].content).toContain('LONG-TERM UNDERSTANDING: A supplied Honcho reading');
  await char.evaluate(() => (window as any).capri.invoke('panel:open','memory'));
  await expect.poll(() => app!.windows().some(w => w.url().includes('panel.html'))).toBe(true);
  const panel = app.windows().find(w => w.url().includes('panel.html'))!;
  await expect.poll(() => panel.getByText('Long-term understanding',{exact:true}).count()).toBe(1);
  expect(await panel.getByText('Understanding of you',{exact:true}).count()).toBe(1);
  await app.evaluate(async () => { const a=(globalThis as any).__capri; await a.convo.send('Off the record: secret synthetic orchid.'); await a.convo.settle(); a.memoryLearner.discard(); await a.honcho.refresh(); });
  expect(requests.find(r => r.messages.at(-1).content.includes('secret synthetic orchid')).messages[0].content).not.toContain('HONCHO LONG-TERM UNDERSTANDING');
  // Use the actual ambient prompt assembly. Model response is a fixture; Honcho's
  // profile above is genuinely derived by the local service and existing Codex model.
  const ambient = await app.evaluate(() => { const a=(globalThis as any).__capri; return a.behavior.d.promptContext({kind:'trigger',direct:false,context:{personalSubject:'ENGR 210 report'}}); });
  expect(ambient).toContain('HONCHO LONG-TERM UNDERSTANDING');
  if (process.env.CAPRI_HONCHO_RESULT) fs.writeFileSync(process.env.CAPRI_HONCHO_RESULT,JSON.stringify({ synthetic:true, realHoncho:true, packaged:!!process.env.CAPRI_EXE, reading, chatPromptIncluded:true, ambientPromptIncluded:true, privateTurnExcluded:true },null,2));
  await app.evaluate(async () => { const a=(globalThis as any).__capri; a.settings.update({privacy:{saveHistory:false}}); await a.honcho.privacyChanged(); });
  expect(await app.evaluate(() => (globalThis as any).__capri.honcho.context())).toBe('');
  const saved = JSON.parse(fs.readFileSync(path.join(dir,'honcho-memory.json'),'utf8'));
  expect(saved.pendingDeletes).toEqual([]); expect(saved.workspace).toBe('');
},180000);
