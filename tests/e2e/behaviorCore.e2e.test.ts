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
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});
async function mockModel() {
  const requests: any[] = []; let slow = false;
  server = http.createServer((req, res) => {
    if (req.url?.endsWith('/models')) { res.end(JSON.stringify({ data: [{ id: 'test' }] })); return; }
    let raw = ''; req.on('data', c => raw += c); req.on('end', () => {
      const body = JSON.parse(raw); requests.push(body);
      let text = 'All right. We can talk about the shape instead.';
      if (body.messages[0].content.includes('Choose one desktop-companion decision')) {
        const payload = JSON.parse(body.messages.at(-1).content), obs = payload.input.observation;
        text = JSON.stringify(payload.event === 'pat'
          ? { interpretation: 'Affection interrupts the current color curiosity.', interest: null, action: 'speak', line: 'Mm. I still want to know why you chose that color.', gesture: 'nod', reason: 'Continue the same thought through the pat.', interestDisposition: 'retain' }
          : { interpretation: 'A color study is open; a broad curiosity can wait.', interest: { topic: 'the color choice', intention: 'Ask about the choice when invited.', sourceId: obs.id, quote: obs.detail }, action: 'defer', line: '', gesture: 'none', reason: 'No reason to interrupt yet.' });
      }
      const send = () => { if (!res.destroyed) { res.writeHead(200, { 'content-type': 'text/event-stream' }); res.end('data: ' + JSON.stringify({ choices: [{ delta: { content: text } }] }) + '\n\ndata: [DONE]\n\n'); } };
      if (slow) setTimeout(send, 500); else send();
    });
  });
  await new Promise<void>(r => server!.listen(0, '127.0.0.1', r));
  return { requests, slow() { slow = true; }, url: `http://127.0.0.1:${(server.address() as { port: number }).port}/v1` };
}
function profile(url?: string, model?: string) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'capri-stage1-e2e-')); dirs.push(dir);
  fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({ firstRunComplete: true, character: { hideOnFullscreen: false },
    ai: url ? { provider: 'openai', openai: { baseUrl: url, model: 'test' } } : { provider: 'codex', codex: { chatModel: model }, requestTimeoutSec: 30 },
    memory: { autoLearn: false }, voice: { ttsEnabled: false }, dialogue: { localContext: true },
    behavior: { quietHours: { enabled: false }, explore: false, idleRemarks: false, smallActivities: false }, teleport: { auto: false } }));
  return dir;
}
async function launch(dir: string) {
  app = await electron.launch({ ...(process.env.CAPRI_EXE ? { executablePath: process.env.CAPRI_EXE, args: [] } : { args: [root] }), env: { ...process.env, CAPRI_TEST: '1', CAPRI_OFFSCREEN: '1', CAPRI_USER_DATA: dir, CAPRI_NO_DEV_KEY: '1' } });
  await app.firstWindow();
  for (let i = 0; i < 100; i++) { if (await app.evaluate(() => !!(globalThis as any).__capri)) break; await new Promise(r => setTimeout(r, 100)); }
  await app.evaluate(() => {
    const g = globalThis as any; g.__capriIdleOverride = 0; g.__capriDesktopOverride = { title: 'Color study', process: 'paint.exe' };
    g.__capriForegroundHandle = 777n; g.__capriWindowInfo = { '777': { title: 'Color study', process: 'paint.exe' } };
    g.__capriWindowsOverride = [{ handle: 777n, rect: { x: 100, y: 180, width: 900, height: 600 } }];
  });
  return app;
}
describe('unified core in Electron', () => {
  it('keeps a silent observation through restart, then actual touch continues it and chat supersedes it', async () => {
    const m = await mockModel(), dir = profile(m.url); let a = await launch(dir);
    await a.evaluate(async () => { const a = (globalThis as any).__capri; await a.generatedRemark('placed_window', '', { target: 777n }); });
    expect(await a.evaluate(() => (globalThis as any).__capri.behavior.pending())).toBe(true);
    expect(await a.evaluate(() => (globalThis as any).__capri.scenes.recent().filter((s: any) => s.kind === 'said').length)).toBe(0);
    await a.close(); app = undefined; a = await launch(dir);
    expect(await a.evaluate(() => (globalThis as any).__capri.behavior.pending())).toBe(true);
    m.slow();
    const immediate = await a.evaluate(() => {
      const g = globalThis as any, a = g.__capri;
      let physicalCue = false; const send = a.charWin.webContents.send.bind(a.charWin.webContents);
      a.charWin.webContents.send = (channel: string, ...args: any[]) => {
        if (channel === 'cue' && args[0]?.type === 'life' && args[0]?.event === 'pat') physicalCue = true;
        return send(channel, ...args);
      };
      const nativeRandom=Math.random;Math.random=()=>.99;try{a.interaction('pat');}finally{Math.random=nativeRandom;}return {physicalCue,deciding:a.behavior.busy};
    });
    expect(immediate.physicalCue).toBe(true); // Collection can begin asynchronously after the immediate local reaction.
    await expect.poll(() => a.evaluate(() => (globalThis as any).__capri.bubble.state.text)).toContain('still want to know');
    const pat = m.requests.find(r => r.messages.at(-1).content.includes('"event":"pat"'));
    expect(pat.messages.at(-1).content).toContain('the color choice');
    expect(await a.evaluate(() => (globalThis as any).__capri.conversationScene.snapshot().entries.filter((e: any) => e.text.includes('still want')).length)).toBe(1);
    await a.evaluate(async () => { const a = (globalThis as any).__capri; await a.convo.send('Actually, new subject. Forget the color; talk about the shape.'); await a.convo.settle(); });
    expect(await a.evaluate(() => (globalThis as any).__capri.behavior.pending())).toBe(false);
    expect(m.requests).toHaveLength(3);
  });
  it('discards a delayed observation after a user correction', async () => {
    const m = await mockModel(), a = await launch(profile(m.url)); m.slow();
    await a.evaluate(() => { const g = globalThis as any; g.__stage1Pending = g.__capri.generatedRemark('placed_window', '', { target: 777n }); });
    await expect.poll(() => m.requests.length).toBe(1);
    await a.evaluate(() => { const a = (globalThis as any).__capri; a.behavior.userInput('New subject, forget that.'); });
    await a.evaluate(async () => { await (globalThis as any).__stage1Pending; });
    expect(await a.evaluate(() => (globalThis as any).__capri.behavior.pending())).toBe(false);
    expect(await a.evaluate(() => (globalThis as any).__capri.scenes.recent().filter((s: any) => s.kind === 'said').length)).toBe(0);
  });
  it('respects DND and removes situational state when saved history is disabled', async () => {
    const m = await mockModel(), dir = profile(m.url), a = await launch(dir);
    await a.evaluate(async () => { const a = (globalThis as any).__capri; await a.generatedRemark('placed_window', '', { target: 777n }); a.settings.update({ behavior: { doNotDisturb: true } }); await a.generatedRemark('pat'); });
    expect(m.requests).toHaveLength(1);
    await a.evaluate(() => { (globalThis as any).__capri.settings.update({ privacy: { saveHistory: false } }); });
    expect(fs.existsSync(path.join(dir, 'behavior-state.json'))).toBe(false);
    expect(await a.evaluate(() => (globalThis as any).__capri.behavior.snapshot().facts.length)).toBe(0);
  });
  it('keeps authored offline acknowledgements and does not record a suppressed line', async () => {
    const m = await mockModel(), a = await launch(profile(m.url));
    const result = await a.evaluate(async () => {
      const a = (globalThis as any).__capri;
      a.settings.update({ ai: { provider: 'offline' } });
      await a.generatedRemark('greeting');
      const delivered = a.scenes.recent().filter((s: any) => s.kind === 'said');
      const prior = a.companionDialogue.snapshot().history.length;
      a.settings.update({ character: { speechBubbles: false }, voice: { ttsEnabled: false } });
      await a.generatedRemark('putdown');
      return { delivered, after: a.scenes.recent().filter((s: any) => s.kind === 'said'), prior, history: a.companionDialogue.snapshot().history.length };
    });
    expect(result.delivered).toHaveLength(1); expect(result.after).toHaveLength(1);
    expect(result.history).toBe(result.prior); expect(m.requests).toHaveLength(0);
  });
  it.runIf(process.env.CAPRI_STAGE1_LIVE === '1')('reviews three real generated interactions in the integrated application', async () => {
    const config = JSON.parse(fs.readFileSync(path.join(process.env.APPDATA!, 'Capri Buddy', 'settings.json'), 'utf8'));
    expect(config.ai.provider).toBe('codex');
    const a = await launch(profile(undefined, config.ai.codex.chatModel));
    const result = await a.evaluate(async () => {
      const a = (globalThis as any).__capri;
      a.behavior.notice({ id: 'live-fixture', at: Date.now(), target: '777', title: 'Color study', process: 'paint.exe', evidence: 'user', detail: 'The user says the two swatches are muted green and vivid violet.' });
      await a.convo.send('I am comparing muted green and vivid violet. Which would you pick?'); await a.convo.settle();
      const first = a.conversationScene.snapshot(); await a.generatedRemark('pat');
      const second = a.conversationScene.snapshot();
      await a.convo.send('Actually, forget the colors. I want quiet company for a bit.'); await a.convo.settle();
      return { first, second, final: a.conversationScene.snapshot(), situation: a.behavior.snapshot(), outcome: a.lastDialogueOutcome };
    });
    fs.mkdirSync(path.join(root, 'docs/stage1'), { recursive: true });
    fs.writeFileSync(path.join(root, 'docs/stage1/live-results.json'), JSON.stringify({ model: config.ai.codex.chatModel, scope: 'Three generation opportunities, isolated Electron profile, synthetic user-described observation, TTS off', result }, null, 2));
    expect(result.first.entries.some((e: any) => e.role === 'assistant')).toBe(true);
    expect(result.final.entries.at(-1).role).toBe('assistant');
  });
});
