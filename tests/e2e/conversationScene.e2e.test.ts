import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { _electron as electron, type ElectronApplication } from 'playwright-core';
import { afterEach, describe, expect, it } from 'vitest';
const root = path.resolve(__dirname, '../..');
let app: ElectronApplication | undefined, server: http.Server | undefined;
const dirs: string[] = [];
afterEach(async () => { if (app) await app.close().catch(() => {}); app = undefined; server?.closeAllConnections(); if (server) await new Promise<void>(r => server!.close(() => r())); server = undefined; for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); });
async function model(quiet = false) {
  const requests: { messages: { role: string; content: string }[] }[] = [];
  server = http.createServer((req, res) => {
    if (req.url?.endsWith('/models')) { res.end(JSON.stringify({ data: [{ id: 'test' }] })); return; }
    let raw = ''; req.on('data', c => raw += c); req.on('end', () => {
      const body = JSON.parse(raw); requests.push(body);
      const last = body.messages.at(-1)?.content ?? '';
      const content = /"event":"pat"/.test(last) ? quiet ? '<quiet/>' : 'I still vote for red. You can pat me and disagree.'
        : /"event":"poke"/.test(last) ? 'Yes. Quiet company means quiet company.'
        : /new subject/i.test(last) ? 'All right. I can stay here quietly.' : 'I vote for red glaze. Why blue?';
      res.writeHead(200, { 'content-type': 'text/event-stream' }); res.end('data: ' + JSON.stringify({ choices: [{ delta: { content } }] }) + '\n\ndata: [DONE]\n\n');
    });
  });
  await new Promise<void>(r => server!.listen(0, '127.0.0.1', r));
  return { requests, url: `http://127.0.0.1:${(server.address() as { port: number }).port}/v1` };
}
async function launch(dir: string) {
  app = await electron.launch({ ...(process.env.CAPRI_EXE ? { executablePath: process.env.CAPRI_EXE, args: [] } : { args: [root] }), env: { ...process.env, CAPRI_TEST: '1', CAPRI_OFFSCREEN: '1', CAPRI_USER_DATA: dir, CAPRI_NO_DEV_KEY: '1' } });
  await app.firstWindow();
  for (let i = 0; i < 100; i++) { if (await app.evaluate(() => !!(globalThis as any).__capri)) { const char=app.windows().find(w=>w.url().includes('character.html'))!; await char.waitForFunction(()=>!!(window as any).__capriDebug); await app.evaluate(()=>{const g=globalThis as any;g.__capriIdleOverride=0;g.__capriDesktopOverride={title:'Conversation fixture',process:'fixture.exe'};}); return app; } await new Promise(r => setTimeout(r, 100)); }
  throw Error('No app state');
}
function profile(url: string) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'capri-current-exchange-')); dirs.push(dir);
  fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({ firstRunComplete: true, ai: { provider: 'openai', openai: { baseUrl: url, model: 'test' } }, memory: { autoLearn: false }, voice: { ttsEnabled: false }, dialogue: { localContext: false }, behavior: { quietHours: { enabled: false }, explore: false, idleRemarks: false }, teleport: { auto: false } })); return dir;
}
describe('multi-turn chat and physical interaction', () => {
  it('carries a disagreement through a generated pat, user correction and restart without an assigned acting angle', async () => {
    const m = await model(), dir = profile(m.url), a = await launch(dir);
    await a.evaluate(async () => { const a = (globalThis as any).__capri; await a.convo.send('I choose blue glaze for the fox. What do you think?'); await a.convo.settle(); await a.generatedRemark('pat'); });
    const touch = m.requests.find(r => /"event":"pat"/.test(r.messages.at(-1)!.content));
    expect(touch,await a.evaluate(()=>(globalThis as any).__capri.lastDialogueOutcome)).toBeDefined(); expect(touch!.messages[0].content).toContain('I vote for red glaze. Why blue?');
    expect(touch!.messages[0].content).toContain('CURRENT SHARED EXCHANGE'); expect(touch!.messages.at(-1)!.content).not.toContain('Lightly dodge');
    expect(await a.evaluate(() => (globalThis as any).__capri.bubble.state.text)).toContain('still vote for red');
    await a.evaluate(async () => { const a = (globalThis as any).__capri; await a.convo.send('New subject. I want quiet company, no more glaze argument.'); await a.convo.settle(); });
    await a.close(); app = undefined;
    const b = await launch(dir);
    const ctx = await b.evaluate(() => (globalThis as any).__capri.conversationScene.context('poke'));
    expect(ctx).toContain('quiet company'); expect(ctx).toContain('All right. I can stay here quietly.');
    expect(ctx).toContain('Latest user corrections and topic changes outrank');
    const char = b.windows().find(w => w.url().includes('character.html'))!;
    await char.evaluate(() => (window as any).capri.invoke('panel:open', 'memory'));
    let panel = b.windows().find(w => w.url().includes('panel.html'));
    for (let i = 0; !panel && i < 100; i++) { await new Promise(r => setTimeout(r, 100)); panel = b.windows().find(w => w.url().includes('panel.html')); }
    if (!panel) throw Error('No memory panel');
    if (process.env.CAPRI_SCENE_SCREENSHOT) {
      await panel.getByRole('button', { name: 'Clear current exchange', exact: true }).waitFor();
      await panel.screenshot({ path: process.env.CAPRI_SCENE_SCREENSHOT });
    }
    await panel.getByRole('button', { name: 'Clear current exchange', exact: true }).click();
    expect(await b.evaluate(() => (globalThis as any).__capri.conversationScene.snapshot().entries.length)).toBe(0);
  });
  it('honors a generated quiet touch instead of replacing it with a reward line', async () => {
    const m = await model(true), a = await launch(profile(m.url));
    const result = await a.evaluate(async () => { const a = (globalThis as any).__capri; a.conversationScene.record({ id: 'quiet', role: 'user', text: 'I just want quiet company.', at: Date.now() }); a.bubble.dismiss(); await a.generatedRemark('pat'); return { outcome: a.lastDialogueOutcome, scenes: a.scenes.recent() }; });
    expect(m.requests,result.outcome).toHaveLength(1); expect(result.outcome).toContain('chose quiet');
    expect(result.scenes.filter((s: any) => s.kind === 'said')).toHaveLength(0);
  });
});
