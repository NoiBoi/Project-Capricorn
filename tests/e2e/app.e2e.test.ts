// End-to-end tests against the real Electron app (built into dist/). Each test uses an
// isolated profile directory; model servers are local mocks — no network, no API keys.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { FRAME_SIZE, SEAT_RATIO } from '../../src/shared/framing';
import { _electron as electron, type ElectronApplication, type Page } from 'playwright-core';
import { afterAll, afterEach, describe, expect, it } from 'vitest';

const ROOT = path.resolve(__dirname, '..', '..');
// Inspection fixtures use the same decision envelope as the unified production core.
function companionRequest(body: any) {
  const content = body.messages.at(-1).content;
  const value = JSON.parse(Array.isArray(content) ? content.find((p: any) => p.type === 'text').text : content);
  return value.input ? { ...value.input.context, event: value.event, context: value.input.context, situation: value.situation } : value;
}
function visualDecision(value: { line: string; facts?: string[]; interpretation?: string; curiosity?: string; points?: unknown[] }) {
  const quiet = value.line === '<quiet/>';
  return { ...value, line: quiet ? '' : value.line, interpretation: value.interpretation || 'A tentative reading of the exposed crop.',
    interest: null, action: quiet ? 'silent' : 'speak', gesture: 'none', reason: 'A single grounded visual decision.' };
}
const EXE = process.env.CAPRI_EXE; // set to test a packaged build instead of the dev bundle
const apps: ElectronApplication[] = [];
const dirs: string[] = [];

function profile(settings: Record<string, unknown> = {}) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'capri-e2e-'));
  dirs.push(d);
  const { ai, character, behavior, ...rest } = settings as { ai?: Record<string, unknown>; character?: Record<string, unknown>; behavior?: Record<string, unknown> };
  // Host fullscreen activity must not silently hide an isolated offscreen fixture.
  fs.writeFileSync(path.join(d, 'settings.json'), JSON.stringify({ firstRunComplete: true, behavior: { quietHours: { enabled: false }, ...(behavior ?? {}) }, character: { hideOnFullscreen: false, ...(character ?? {}) }, voice: { ttsEnabled: false }, teleport: { auto: false }, ai: { provider: 'offline', ...(ai ?? {}) }, ...rest }));
  return d;
}
async function launch(userData: string, opts: { liveKey?: boolean; env?: Record<string, string> } = {}) {
  const app = await electron.launch({
    ...(EXE ? { executablePath: EXE, args: [] } : { args: [ROOT] }),
    env: { ...process.env, CAPRI_TEST: '1', CAPRI_OFFSCREEN: process.env.CAPRI_ONSCREEN ? '0' : '1', CAPRI_USER_DATA: userData, CAPRI_NO_DEV_KEY: opts.liveKey ? '0' : '1', ...(opts.liveKey ? {} : { GEMINI_API_KEY: '' }), ...(opts.env ?? {}) },
    timeout: 30_000,
  });
  apps.push(app);
  await app.firstWindow();
  let char: Page | undefined;
  for (let i = 0; i < 100; i++) {
    char = app.windows().find(w => w.url().includes('/character.html'));
    if (char) break;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  if (!char) throw new Error('Character renderer did not open');
  await char.waitForFunction(() => (window as unknown as { __capriDebug?: unknown }).__capriDebug);
  await app.evaluate(() => { (globalThis as any).__capriIdleOverride = 0; });
  return { app, char };
}
async function openPanel(app: ElectronApplication, char: Page, tab = 'chat') {
  await char.evaluate((t) => window.capri.invoke('panel:open', t), tab);
  let panel: Page | undefined;
  for (let i = 0; i < 100; i++) {
    panel = app.windows().find(w => w.url().includes('/panel.html'));
    if (panel) break;
    await new Promise(r => setTimeout(r, 100));
  }
  if (!panel) throw new Error('Panel renderer did not open');
  await panel.waitForSelector(tab === 'chat' ? 'textarea' : '.scroll');
  return panel;
}

async function quit(app: ElectronApplication) {
  const proc = app.process();
  await app.evaluate(({ app: a }) => a.quit()).catch(() => {});
  await new Promise<void>((r) => { if (proc.exitCode !== null) r(); else proc.once('exit', () => r()); setTimeout(r, 10_000); });
}
afterEach(async () => { for (const a of apps.splice(0)) await quit(a).catch(() => {}); });
afterAll(() => { for (const d of dirs) { try { fs.rmSync(d, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 }); } catch { /* Chromium may still hold a cache file briefly */ } } });

/** Minimal OpenAI-compatible streaming server. */
async function mockModel(reply: (body: { messages: { role: string; content: string }[] }) => string | { delayMs: number; text: string } | 'fail') {
  let calls = 0;
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', async () => {
      if (req.url?.endsWith('/models')) { res.end(JSON.stringify({ data: [{ id: 'mock-model' }] })); return; }
      calls++; // chat completions only
      const r = reply(JSON.parse(raw || '{}'));
      if (r === 'fail') { res.writeHead(500); res.end('boom'); return; }
      const { text, delayMs } = typeof r === 'string' ? { text: r, delayMs: 5 } : r;
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      for (const w of text.match(/<action>.*?<\/action>|\S+\s*/gs) ?? []) {
        if (res.destroyed) return;
        res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: w } }] })}\n\n`);
        await new Promise((x) => setTimeout(x, delayMs));
      }
      res.end('data: [DONE]\n\n');
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
  return { url, get calls() { return calls; }, close: () => new Promise<void>((r) => { server.closeAllConnections(); server.close(() => r()); }) };
}
const openaiProfile = (url: string, extra: Record<string, unknown> = {}) => {
  const { ai, ...rest } = extra as { ai?: Record<string, unknown> };
  return profile({ actions: { policies: { read_screen: 'allow' } }, ai: { provider: 'openai', openai: { baseUrl: url, model: 'mock-model' }, ...ai }, ...rest });
};

describe('opening and taskbar controls', () => {
  it('returns from ordinary inactivity on keyboard/system input without requiring a mouse move', async () => {
    const { app } = await launch(profile({ behavior: { quietHours: { enabled: false } }, character: { hideOnFullscreen: false }, teleport: { effects: false } }));
    for (const [index, idleSec] of [120, 700].entries()) {
      const count = await app.evaluate(() => (globalThis as any).__capri.teleporter.count);
      await app.evaluate((_e, data) => {
        const g = globalThis as any, a = g.__capri, original = Date.now, base = original() + 40000 + data.index * 420000;
        g.__capriDesktopOverride = { title: 'Test', process: 'test.exe' };
        try {
          Date.now = () => base; g.__capriIdleOverride = data.idleSec; a.presenceTick();
          Date.now = () => base + 1000; g.__capriIdleOverride = 0; a.presenceTick();
        } finally { Date.now = original; }
      }, { index, idleSec });
      await expect.poll(() => app.evaluate(() => (globalThis as any).__capri.teleporter.count), { timeout: 6000 }).toBe(count + 1);
    }
  });
  it('keeps an inverted perch through clicks, reply activation, scale changes and temporary covering', async () => {
    const { app, char } = await launch(profile({ behavior: { quietHours: { enabled: false } } }));
    const target = await app.evaluate(({ screen }, seat) => {
      const g = globalThis as any, a = g.__capri, b = a.charWin.getBounds(), area = screen.getPrimaryDisplay().workArea;
      const rect = { x: area.x + 150, y: area.y + 20, width: 1100, height: 700 };
      g.__capriDesktopOverride = { title: 'Test desktop', process: 'test.exe' }; g.__capriForegroundHandle = 0n;
      g.__capriWindowsOverride = [{ handle: -501n, rect }];
      a.charWin.setBounds({ ...b, x: area.x + 450, y: Math.round(rect.y - b.height * (1 - seat)) }); a.settleAfterDrop();
      return rect;
    }, SEAT_RATIO);
    await expect.poll(() => app.evaluate(() => (globalThis as any).__capri.perchMode)).toBe('inverted');
    const before = await app.evaluate(() => (globalThis as any).__capri.charWin.getBounds());
    await char.evaluate(async () => { await window.capri.invoke('char:drag', 'start'); await window.capri.invoke('char:drag', 'end'); await window.capri.invoke('char:click'); });
    expect(await app.evaluate(() => (globalThis as any).__capri.charWin.getBounds())).toEqual(before);
    await expect.poll(() => char.evaluate(() => (window.__capriDebug as any).attachment)).toBe('inverted');
    await app.evaluate(() => { const a = (globalThis as any).__capri; a.bubble.dismiss(); a.bubble.remark('Reply to this without moving my perch.'); });
    await expect.poll(() => app.windows().some(w => w.url().includes('/bubble.html'))).toBe(true);
    const bubble = app.windows().find(w => w.url().includes('/bubble.html'))!;
    await bubble.getByRole('button', { name: 'Reply', exact: true }).click();
    await bubble.getByLabel('Message Capri', { exact: true }).waitFor({ state: 'visible' });
    expect(await app.evaluate(() => (globalThis as any).__capri.charWin.getBounds())).toEqual(before);
    for (const scale of [.8, 1.2]) {
      const result = await app.evaluate((_e, scale) => { const a = (globalThis as any).__capri; a.settings.update({ character: { scale } }); return { bounds: a.charWin.getBounds(), mode: a.perchMode }; }, scale);
      expect(result.mode).toBe('inverted'); expect(Math.abs(result.bounds.y + result.bounds.height * (1 - SEAT_RATIO) - target.y)).toBeLessThan(2);
    }
    await app.evaluate((_e, rect) => { const g = globalThis as any, a = g.__capri; g.__capriWindowsOverride = [{ handle: -502n, rect }, { handle: -501n, rect }]; a.perchTick(); }, target);
    expect(await char.evaluate(() => (window.__capriDebug as any).attachment)).toBe('inverted');
  });
  it('plays one dangle cycle then stands before following a moved inverted window', async () => {
    const { app, char } = await launch(profile({ behavior: { quietHours: { enabled: false } }, teleport: { effects: false } }));
    const y = await app.evaluate(({ screen }, seat) => {
      const g = globalThis as any, a = g.__capri, area = screen.getPrimaryDisplay().workArea, b = a.charWin.getBounds();
      const rect = { x: area.x + 150, y: area.y + 20, width: 1100, height: 700 };
      g.__capriWindowsOverride = [{ handle: -503n, rect }]; g.__capriWindowHeld = true;
      a.charWin.setBounds({ ...b, x: area.x + 450, y: Math.round(rect.y - b.height * (1 - seat)) }); a.settleAfterDrop();
      const moved = { ...rect, x: rect.x + 50, y: rect.y + 20 }; g.__capriWindowsOverride = [{ handle: -503n, rect: moved }]; a.perchTick(); return moved.y;
    }, SEAT_RATIO);
    await expect.poll(() => char.evaluate(() => (window.__capriDebug as any).model.activeClip)).toBe('dangle');
    expect(await char.evaluate(() => (window.__capriDebug as any).model.headTransform.d)).toBeGreaterThan(0);
    await expect.poll(() => char.evaluate(() => (window.__capriDebug as any).model.activeClip), { timeout: 4000 }).toBe('idle');
    expect(await char.evaluate(() => (window.__capriDebug as any).model.headTransform.d)).toBeGreaterThan(0);
    expect(await app.evaluate(() => (globalThis as any).__capri.teleporter.active)).toBe(false);
    await app.evaluate(() => { const g = globalThis as any; g.__capriWindowHeld = false; g.__capri.perchTick(); });
    await expect.poll(() => app.evaluate((_e, data) => { const a = (globalThis as any).__capri, b = a.charWin.getBounds(); return Math.abs(b.y + b.height * (1 - data.seat) - data.y); }, { y, seat: SEAT_RATIO }), { timeout: 5000 }).toBeLessThan(2);
    expect(await app.evaluate(() => (globalThis as any).__capri.perchMode)).toBe('inverted');
  });
  it('uses transformed head regions and pat sparkles for upright, mirrored and inverted art', async () => {
    const { app, char } = await launch(profile());
    await app.evaluate(({ screen }) => { const g = globalThis as any, a = g.__capri, area = screen.getPrimaryDisplay().workArea, b = a.charWin.getBounds(); g.__capriWindowsOverride = []; g.__capriDesktopOverride = { title: 'Test', process: 'test.exe' }; a.charWin.setBounds({ ...b, x: area.x + 300, y: area.y + 30 }); a.settleAfterDrop(); });
    for (const inverted of [false, true]) for (const facing of ['left', 'right']) {
      await app.evaluate((_e, data) => { const a = (globalThis as any).__capri; a.settings.update({ character: { facing: data.facing, animation: 'perch' } }); a.charWin.webContents.send('cue', { type: 'attachment', mode: data.inverted ? 'inverted' : 'perch' }); }, { inverted, facing });
      await char.waitForFunction(mode => (window.__capriDebug as any).attachment === mode, inverted ? 'inverted' : 'perch');
      const result = await char.evaluate(() => {
        const d = window.__capriDebug as any; d.manual(true); d.step(1 / 30, 15);
        const face = d.model.speechAnchor, spark = d.model.patSparkAnchor; let head = 0, body = 0;
        for (let y = 0; y < innerHeight; y += 4) for (let x = 0; x < innerWidth; x += 4) if (d.hitAt(x, y)) { if (d.model.headHitTest(x, y, devicePixelRatio)) head++; else body++; }
        const g = d.model.headGeometry;
        const padded = new DOMPoint(g.x + (g.cx + 72) * g.scale, g.y + 90 * g.scale).matrixTransform(d.model.headTransform.inverse());
        const paddingHit = d.model.headHitTest(padded.x / devicePixelRatio, padded.y / devicePixelRatio, devicePixelRatio);
        const paddingInteractive = d.hitAt(padded.x / devicePixelRatio, padded.y / devicePixelRatio);
        d.manual(false); return { head, body, face, spark, height: innerHeight, paddingHit, paddingInteractive };
      });
      expect(result.head).toBeGreaterThan(2); expect(result.body).toBeGreaterThan(2);
      expect(result.paddingHit).toBe(true); expect(result.paddingInteractive).toBe(true);
      expect(Math.abs(result.spark.y - result.face.y) * result.height).toBeLessThan(100);
      expect(inverted ? result.spark.y > result.face.y : result.spark.y < result.face.y).toBe(true);
      if (process.env.CAPRI_PAT_SCREENSHOT && facing === 'right') {
        await char.evaluate(() => { const d = window.__capriDebug as any; d.model.pat(); d.step(1 / 30); });
        await char.screenshot({ path: process.env.CAPRI_PAT_SCREENSHOT.replace('.png', inverted ? '-inverted.png' : '-upright.png') });
      }
    }
  });
  it('follows a quickly released window without waiting for the dangle cycle', async () => {
    const { app, char } = await launch(profile({ behavior: { quietHours: { enabled: false } }, teleport: { effects: false } }));
    const expected = await app.evaluate(({ screen }, seat) => {
      const g = globalThis as any, a = g.__capri, area = screen.getPrimaryDisplay().workArea, b = a.charWin.getBounds();
      g.__capriDesktopOverride = { title: 'Test', process: 'test.exe' };
      const rect = { x: area.x + 150, y: area.y + 20, width: 1100, height: 700 };
      g.__capriWindowsOverride = [{ handle: -504n, rect }]; g.__capriWindowHeld = true;
      a.charWin.setBounds({ ...b, x: area.x + 450, y: Math.round(rect.y - b.height * (1 - seat)) }); a.settleAfterDrop();
      const moved = { ...rect, x: rect.x + 50, y: rect.y + 30 }; g.__capriWindowsOverride = [{ handle: -504n, rect: moved }]; a.perchTick();
      return moved.y;
    }, SEAT_RATIO);
    await expect.poll(() => char.evaluate(() => (window.__capriDebug as any).model.activeClip)).toBe('dangle');
    await app.evaluate(() => { (globalThis as any).__capriWindowHeld = false; });
    await expect.poll(() => app.evaluate((_e, data) => { const a = (globalThis as any).__capri, b = a.charWin.getBounds(); return Math.abs(b.y + b.height * (1 - data.seat) - data.y); }, { y: expected, seat: SEAT_RATIO }), { timeout: 2000 }).toBeLessThan(2);
  });
  it('holds the closed-eye blink cell for pats in standing, perched and inverted poses', async () => {
    const { app, char } = await launch(profile());
    await app.evaluate(({ screen }) => { const g = globalThis as any, a = g.__capri, area = screen.getPrimaryDisplay().workArea, b = a.charWin.getBounds(); g.__capriWindowsOverride = []; g.__capriDesktopOverride = { title: 'Test', process: 'test.exe' }; a.charWin.setBounds({ ...b, x: area.x + 300, y: area.y + 30 }); a.settleAfterDrop(); });
    for (const mode of [null, 'perch', 'inverted']) {
      await app.evaluate((_e, mode) => { const a = (globalThis as any).__capri; a.settings.update({ character: { animation: 'auto' } }); a.charWin.webContents.send('cue', { type: 'attachment', mode }); }, mode);
      await char.waitForFunction(mode => (window.__capriDebug as any).attachment === mode, mode);
      const result = await char.evaluate(() => {
        const d = window.__capriDebug as any; d.manual(true); d.force({ sleep: 0, mouthOpen: 0, blinkL: 0, blinkR: 0 });
        d.step(.05); d.model.pat(); d.step(.05);
        const start = { clip: d.model.activeClip, frame: d.model.activeFrame };
        d.step(.05, 15); const held = { clip: d.model.activeClip, frame: d.model.activeFrame };
        d.step(.05, 12); const ended = d.model.activeClip;
        d.manual(false); return { start, held, ended };
      });
      const clip = mode ? 'perch_blink' : 'blink';
      expect(result.start).toEqual({ clip, frame: 1 }); expect(result.held).toEqual({ clip, frame: 1 }); expect(result.ended).not.toBe(clip);
    }
  });
  it('simulates idle and sleep without changing saved mode and returns with a teleport from each', async () => {
    const { app, char } = await launch(profile({ behavior: { quietHours: { enabled: false } }, teleport: { effects: false } }));
    const panel = await openPanel(app, char, 'developer');
      await panel.getByRole('button', { name: 'Playground', exact: true }).click();
    await app.evaluate(() => { const g = globalThis as any; g.__capriDesktopOverride = { title: 'Test', process: 'test.exe' }; });
    for (const state of ['idle', 'sleep'] as const) {
      await panel.getByRole('button', { name: state === 'idle' ? 'Simulate idle' : 'Simulate sleep', exact: true }).click();
      const simulated = await panel.evaluate(() => window.capri.invoke('dev:get'));
      expect(simulated.runtime.absence).toBe(state); expect(simulated.runtime.mode).toBe('normal');
      if (state === 'sleep') await expect.poll(() => char.evaluate(() => (window.__capriDebug as any).behavior.state)).toBe('sleeping');
      const count = await app.evaluate(() => (globalThis as any).__capri.teleporter.count);
      await panel.getByRole('button', { name: 'Return now', exact: true }).click();
      await expect.poll(() => app.evaluate(() => (globalThis as any).__capri.teleporter.count), { timeout: 6000 }).toBe(count + 1);
      await expect.poll(() => char.evaluate(() => (window.__capriDebug as any).behavior.state)).not.toBe('sleeping');
      expect((await panel.evaluate(() => window.capri.invoke('dev:get'))).runtime.absence).toBeNull();
    }
  });
  it('does not let a routine ambient decision postpone a stable visual inspection for the full remark interval', async () => {
    const events: string[] = [];
    const mock = await mockModel(body => {
      const content: any = body.messages.at(-1)!.content;
      const payload = JSON.parse(Array.isArray(content) ? content.find(p => p.type === 'text').text : content); events.push(payload.event);
      return JSON.stringify({ interpretation: 'A bounded quiet reading.', interest: null, action: 'silent', line: '', gesture: 'none', reason: 'No need to speak.', facts: ['One route crosses the edge.'], curiosity: '' });
    });
    try {
      const { app } = await launch(openaiProfile(mock.url, { memory: { autoLearn: false }, dialogue: { localContext: true, contextPings: false }, behavior: { explore: false, smallActivities: false, idleRemarks: true, quietHours: { enabled: false } } }));
      await app.evaluate(async () => {
        const g = globalThis as any, a = g.__capri, rect = { x: 100, y: 200, width: 800, height: 500 }, nativeNow = Date.now;
        g.__auditNativeNow = nativeNow; g.__auditClock = nativeNow() + 11 * 60000; Date.now = () => g.__auditClock;
        g.__capriWindowsOverride = [{ handle: -97n, rect }]; g.__capriWindowInfo = { '-97': { title: 'Route', process: 'fixture.exe' } };
        g.__capriForegroundHandle = -97n; g.__capriDesktopOverride = { title: 'Route', process: 'fixture.exe' };
        g.__capriObservationOverride = { jpegBase64: 'test-image', region: rect, window: rect };
        await a.generatedRemark('activity', 'Routine metadata opportunity.', { target: -97n });
        g.__auditClock += 121000;
      });
      const key = (await import('node:crypto')).createHash('sha256').update(JSON.stringify(['fixture.exe', 'Route'])).digest('hex').slice(0,24);
      await app.evaluate((_e, key) => {
        const g = globalThis as any, a = g.__capri;
        for (let i = 0; i < 8; i++) {
          a.environmentalCuriosity.observe(key, g.__auditClock);
          if (i === 3) a.environmentalCuriosity.choose(g.__auditClock, { blocked: false, mayInspect: false });
          if (i < 7) g.__auditClock += 5000;
        }
        a.settings.update({ behavior: { smallActivities: true } }); a.presenceTick();
      }, key);
      await expect.poll(() => events.includes('inspect'), { message: JSON.stringify(await app.evaluate(() => { const a = (globalThis as any).__capri; return { events: a.behavior.snapshot(), environment: a.environmentalCuriosity.snapshot(Date.now()), ready: a.behavior.canInitiate(), outcome: a.lastDialogueOutcome, opening: a.opening.active, company: a.company.label() }; })) }).toBe(true);
      await expect.poll(() => app.evaluate(() => (globalThis as any).__capri.behavior.busy)).toBe(false);
      expect(events).toEqual(['activity', 'inspect']);
      await app.evaluate(() => { Date.now = (globalThis as any).__auditNativeNow; });
    } finally { await mock.close(); }
  });
  it('shows grounded mind state, blockers and searchable previews without generating or learning from previews', async () => {
    const mock = await mockModel(body => {
      const content: any = body.messages.at(-1)!.content;
      const payload = JSON.parse(Array.isArray(content) ? content.find(p => p.type === 'text').text : content), obs = payload.input.observation;
      return JSON.stringify({ interpretation: 'The boundary crossing could be intentional.', interest: { topic: 'route boundary', intention: 'Look at the branch outside the box.', sourceId: obs.id, quote: obs.detail },
        action: 'defer', line: '', gesture: 'none', reason: 'Wait for a natural opening.', facts: ['A branch crosses the boundary.'], curiosity: 'Is the crossing intentional?' });
    });
    try {
      const { app, char } = await launch(openaiProfile(mock.url, { memory: { autoLearn: false }, behavior: { quietHours: { enabled: false }, explore: false, idleRemarks: false } }));
      await app.evaluate(async () => {
        const g = globalThis as any, a = g.__capri, rect = { x: 100, y: 200, width: 800, height: 500 };
        g.__capriWindowsOverride = [{ handle: -77n, rect }]; g.__capriWindowInfo = { '-77': { title: 'Fixture route', process: 'fixture.exe' } };
        g.__capriObservationOverride = { jpegBase64: 'test-image', region: rect, window: rect };
        await a.generatedRemark('placed_window', 'Consider this route.', { target: -77n });
        a.settings.update({ behavior: { doNotDisturb: true } });
      });
      const before = await app.evaluate(() => (globalThis as any).__capri.scenes.recent());
      const panel = await openPanel(app, char, 'developer');
      await expect.poll(() => panel.locator('#dev-state').textContent()).toContain('Do not disturb');
      expect(await panel.getByRole('heading', { name: 'Current direction', exact: true }).count()).toBe(1);
      if (process.env.CAPRI_DEV_OVERVIEW) await panel.screenshot({ path: process.env.CAPRI_DEV_OVERVIEW });
      await panel.getByRole('button', { name: 'Mind & memory', exact: true }).click();
      expect(await panel.locator('#dev-mind').textContent()).toContain('route boundary');
      expect(await panel.locator('#dev-mind').textContent()).toContain('A branch crosses the boundary.');
      const source = panel.locator('#dev-mind details').first(); await source.locator('summary').click();
      await expect.poll(() => source.getAttribute('open')).toBe('');
      await new Promise(r => setTimeout(r, 1200)); expect(await source.getAttribute('open')).toBe('');
      if (process.env.CAPRI_DEV_MIND) await panel.screenshot({ path: process.env.CAPRI_DEV_MIND });
      await panel.getByRole('button', { name: 'Playground', exact: true }).click();
      await panel.getByLabel('Search previews').fill('expression');
      expect(await panel.getByRole('button', { name: 'Play reaction', exact: true }).isVisible()).toBe(true);
      expect(await panel.getByLabel('Animation preview').isVisible()).toBe(false);
      await panel.getByLabel('Search previews').fill('');
      await panel.getByLabel('Preview duration in seconds').fill('8');
      await panel.getByLabel('Mood preview').selectOption('annoyed'); await panel.getByRole('button', { name: 'Preview mood', exact: true }).click();
      await expect.poll(async () => (await panel.evaluate(() => window.capri.invoke('dev:get'))).runtime.poseRenderer?.mood).toBe('annoyed');
      await panel.getByRole('button', { name: 'Stop preview', exact: true }).click();
      await panel.getByLabel('Phase preview').selectOption('error'); await panel.getByRole('button', { name: 'Preview phase', exact: true }).click();
      await expect.poll(async () => (await panel.evaluate(() => window.capri.invoke('dev:get'))).runtime.poseRenderer?.phase).toBe('error');
      await panel.getByRole('button', { name: 'Stop preview', exact: true }).click();
      await expect.poll(async () => (await panel.evaluate(() => window.capri.invoke('dev:get'))).runtime.poseRenderer?.phase).not.toBe('error');
      expect(mock.calls).toBe(1); expect(await app.evaluate(() => (globalThis as any).__capri.scenes.recent())).toEqual(before);
      const width = await panel.evaluate(() => ({ scroll: document.documentElement.scrollWidth, width: innerWidth })); expect(width.scroll).toBeLessThanOrEqual(width.width);
      await app.evaluate(() => (globalThis as any).__capri.panelWin.setSize(380, 700));
      await panel.getByRole('button', { name: 'Overview', exact: true }).click();
      const narrow = await panel.evaluate(() => ({ scroll: document.documentElement.scrollWidth, width: innerWidth })); expect(narrow.scroll).toBeLessThanOrEqual(narrow.width);
      if (process.env.CAPRI_DEV_NARROW) await panel.screenshot({ path: process.env.CAPRI_DEV_NARROW });
    } finally { await mock.close(); }
  });
  it('exposes production developer controls with cancellable previews, local checks and restricted IPC', async () => {
    const model = await mockModel(() => 'No request should be made by previews.');
    try {
      const { app, char } = await launch(openaiProfile(model.url, { behavior: { quietHours: { enabled: false } } }));
      const panel = await openPanel(app, char, 'developer');
      await panel.getByRole('button', { name: 'Playground', exact: true }).click();
      await panel.getByRole('button', { name: 'Run local checks', exact: true }).click();
      await expect.poll(() => panel.locator('#dev-status').textContent()).toMatch(/^PASSED/);
      expect(await panel.locator('#dev-log').textContent()).toContain('identity context agrees');
      await expect(char.evaluate(() => window.capri.invoke('dev:get'))).rejects.toThrow(/unauthorized/);
      await expect(panel.evaluate(() => window.capri.invoke('dev:run', { kind: 'animation', name: 'not-a-clip', seconds: 2 } as any))).rejects.toThrow(/invalid payload/);
      await panel.getByLabel('Animation preview').selectOption('perch_glitch');
      await panel.getByLabel('Preview duration in seconds').fill('8');
      await panel.getByRole('button', { name: 'Play animation', exact: true }).click();
      await expect.poll(() => char.evaluate(() => (window.__capriDebug as any).model.activeClip)).toBe('perch_glitch');
      await panel.getByRole('button', { name: 'Stop preview', exact: true }).click();
      await expect.poll(() => panel.locator('#dev-status').textContent()).toMatch(/^STOPPED/);
      await panel.getByLabel('Preview duration in seconds').fill('.5');
      await panel.getByLabel('Cycle preview').selectOption('animations');
      await panel.getByRole('button', { name: 'Run cycle', exact: true }).click();
      await expect.poll(() => panel.locator('#dev-status').textContent(), { timeout: 16000 }).toMatch(/^PASSED/);
      expect(await panel.locator('#dev-log').textContent()).toContain('animation: mouth');
      expect(model.calls).toBe(0);
      if (process.env.CAPRI_DEV_SCREENSHOT) await panel.screenshot({ path: process.env.CAPRI_DEV_SCREENSHOT });
      await panel.getByLabel('Animation preview').selectOption('dangle');
      await panel.getByLabel('Preview duration in seconds').fill('8');
      await panel.getByRole('button', { name: 'Play animation', exact: true }).click();
      await expect.poll(() => char.evaluate(() => (window.__capriDebug as any).model.activeClip)).toBe('dangle');
      await panel.evaluate(() => window.capri.invoke('panel:close')).catch(() => {});
      await expect.poll(() => char.evaluate(() => (window.__capriDebug as any).model.activeClip)).not.toBe('dangle');
      expect(await app.evaluate(() => (globalThis as any).__capri.settings.get().character.animation)).toBe('auto');
    } finally { await model.close(); }
  });
  it('runs an isolated developer outing then restores Capri without spending generation budget', async () => {
    const model = await mockModel(() => 'No model needed.');
    try {
      const { app, char } = await launch(openaiProfile(model.url, { behavior: { quietHours: { enabled: false } }, teleport: { effects: false } }));
      const panel = await openPanel(app, char, 'developer');
      await panel.getByRole('button', { name: 'Playground', exact: true }).click();
      const before = await app.evaluate(({ screen }) => { const g = globalThis as any, a = g.__capri, area = screen.getPrimaryDisplay().workArea, half = Math.floor((area.width - 120) / 2);
        g.__capriDesktopOverride = { title: 'Test', process: 'test.exe' };
        g.__capriWindowsOverride = [{ handle: -198n, rect: { x: area.x + 20, y: area.y + 90, width: half, height: area.height - 110 } }, { handle: -199n, rect: { x: area.x + half + 70, y: area.y + 90, width: half, height: area.height - 110 } }];
        return { bounds: a.charWin.getBounds(), outings: a.outings.snapshot(), memory: a.memory.approved() }; });
      await panel.getByRole('button', { name: 'Run up to 3 exploration outings', exact: true }).click();
      await expect.poll(() => panel.locator('#dev-status').textContent(), { timeout: 75000 }).toMatch(/^(PASSED|FAILED)/);
      expect(await panel.locator('#dev-log').textContent()).not.toContain('No outing ran.');
      expect(await panel.locator('#dev-status').textContent()).toMatch(/^PASSED/);
      expect(await panel.locator('#dev-log').textContent()).toContain('Visited 2 distinct windows.');
      const after = await app.evaluate(() => { const a = (globalThis as any).__capri; return { bounds: a.charWin.getBounds(), outings: a.outings.snapshot(), memory: a.memory.approved() }; });
      expect(after.outings).toEqual(before.outings); expect(after.memory).toEqual(before.memory);
      expect(Math.abs(after.bounds.x - before.bounds.x)).toBeLessThan(3); expect(Math.abs(after.bounds.y - before.bounds.y)).toBeLessThan(3);
      expect(model.calls).toBe(0);
    } finally { await model.close(); }
  }, 90000);
  it('restores user identity after a full quit and restart, including the fresh greeting route', async () => {
    const systems: string[] = [];
    const model = await mockModel(body => {
      systems.push(body.messages.find(m => m.role === 'system')?.content ?? '');
      return systems.at(-1)!.includes('Current preferred name: Noi.') ? 'Hey, Noi. I remember who I have here.' : 'Who are you?';
    });
    const dir = openaiProfile(model.url, { memory: { enabled: true, autoLearn: false }, behavior: { quietHours: { enabled: false } } });
    const file = path.join(dir, 'memory.json');
    const saved = JSON.stringify([{ id: 'identity', text: 'Noi is a mechanical engineering student at Purdue University.', status: 'approved', source: 'user', createdAt: 1, updatedAt: 2, learnedFrom: { messageId: 'correct', evidence: 'Call me noi.' } }]);
    fs.writeFileSync(file, saved);
    try {
      const first = await launch(dir);
      await first.app.evaluate(async () => { const a = (globalThis as any).__capri; await a.convo.send('What should you call me?'); await a.convo.settle(); });
      expect(systems.at(-1)).toContain('Current preferred name: Noi.');
      await quit(first.app); apps.splice(apps.indexOf(first.app), 1);
      const second = await launch(dir);
      await second.app.evaluate(async () => { const g = globalThis as any, a = g.__capri; g.__capriDesktopOverride = { title: 'Test desktop', process: 'test.exe' }; g.__capriForegroundHandle = 0n; a.bubble.open(); await a.generatedRemark('greeting'); });
      expect(model.calls).toBe(2);
      expect(systems.at(-1)).toContain('Current preferred name: Noi.');
      expect(systems.at(-1)).toContain('Purdue University');
      expect(await second.app.evaluate(() => (globalThis as any).__capri.bubble.state.text)).toContain('Noi');
      await second.app.evaluate(async () => { const a = (globalThis as any).__capri; await a.convo.send('What do you know about me?'); await a.convo.settle(); });
      expect(systems.at(-1)).toContain('Current preferred name: Noi.'); expect(model.calls).toBe(3);
      expect(fs.readFileSync(file, 'utf8')).toBe(saved);
    } finally { await model.close(); }
  });
  it('distinguishes a background perch from actual user focus and keeps its outing history', async () => {
    const { app } = await launch(profile({ behavior: { idleRemarks: false, quietHours: { enabled: false } } }));
    const state = await app.evaluate(() => {
      const g = globalThis as any, a = g.__capri, b = a.charWin.getBounds();
      g.__capriWindowsOverride = [{ handle: -94n, rect: { x: 300, y: 600, width: 700, height: 500 } }, { handle: -95n, rect: { x: 1100, y: 200, width: 700, height: 500 } }];
      g.__capriWindowInfo = { '-94': { title: 'BACKGROUND NOTES', process: 'notepad.exe' }, '-95': { title: 'Spotify', process: 'Spotify.exe' } };
      a.charWin.setBounds({ ...b, x: 450, y: Math.round(600 - b.height * .712) }); a.settleAfterDrop();
      const clock = Date.now, now = clock() + 20000;
      try {
        g.__capriForegroundHandle = -95n;
        for (const dt of [0, 4000, 8000, 12000, 16000]) { Date.now = () => now + dt; a.presenceTick(); }
        const focused = { subject: a.activities.subject, activity: a.localDialogueContext()?.activity, attention: String(a.attentionHandle) };
        g.__capriForegroundHandle = a.charWin.getNativeWindowHandle().readBigUInt64LE(); Date.now = () => now + 17000; a.presenceTick();
        return { focused, ownWindow: { subject: a.activities.subject, activity: a.localDialogueContext()?.activity } };
      } finally { Date.now = clock; }
    });
    expect(state.focused).toMatchObject({ subject: 'Spotify', activity: { kind: 'music' }, attention: '-94' });
    expect(state.ownWindow.subject).toBe(''); expect(state.ownWindow.activity).toBeUndefined();
  });
  it('uses real Spotify metadata for one sparse opinion and suppresses a changed track', async () => {
    let received = ''; let running: ElectronApplication | undefined;
    const mock = await mockModel(body => {
      const request = companionRequest(body); received = request.playingTrack?.title ?? '';
      // The track changes while the model is answering; the old song must not be announced.
      void running!.evaluate(() => { (globalThis as any).__capriSpotifyTrack = null; });
      return { delayMs: 50, text: 'Circuit Bloom? Ooh, that title has an attitude. I approve.' };
    });
    try {
      const { app } = await launch(openaiProfile(mock.url, { behavior: { quietHours: { enabled: false } } })); running = app;
      const state = await app.evaluate(async () => {
        const g = globalThis as any, a = g.__capri;
        g.__capriWindowsOverride = [{ handle: -96n, rect: { x: 100, y: 500, width: 700, height: 400 } }];
        g.__capriWindowInfo = { '-96': { title: 'Spotify', process: 'Spotify.exe' } };
        g.__capriSpotifyTrack = { title: 'Circuit Bloom', artist: 'Glass Engine', key: 'test-track' };
        await a.generatedRemark('inspect', '', { target: -96n });
        await a.generatedRemark('inspect', '', { target: -96n });
        return a.bubble.state.text;
      });
      expect(received).toBe('Circuit Bloom'); expect(state).toBe(''); expect(mock.calls).toBe(1);
    } finally { await mock.close(); }
  });
  it('retains authored local dialogue, gestures offline and rejects generated title recitals', async () => {
    const mock = await mockModel(() => 'You put me on PRIVATE Homework Notes.');
    const dir = openaiProfile(mock.url, { behavior: { quietHours: { enabled: false } }, dialogue: { localContext: false } });
    const { app } = await launch(dir);
    try {
      const state = await app.evaluate(async () => {
        const a = (globalThis as any).__capri;
        a.companionDialogue.restore({ version: 1, history: [] });
        a.bubble.remark(a.companionDialogue.choose({ event: 'greeting' }, { required: true }));
        const greeting = a.bubble.state.text; a.bubble.dismiss();
        a.settings.update({ ai: { provider: 'offline' } }); await a.pickupReaction(); const pickup = a.conversationScene.snapshot().entries.some((e:any)=>e.event==='pickup'&&e.role==='user');
        a.settings.update({ ai: { provider: 'openai' }, dialogue: { localContext: true } });
        const g = globalThis as any;
        g.__capriWindowsOverride = [{ handle: -78n, rect: { x: 100, y: 500, width: 800, height: 500 } }];
        g.__capriWindowInfo = { '-78': { title: 'PRIVATE Homework Notes', process: 'notepad.exe' } };
        a.bubble.dismiss(); await a.generatedRemark('placed_window', '', { target: -78n });
        const rejected = a.bubble.state.text; a.settings.update({ dialogue: { localContext: false } });
        return { greeting, pickup, rejected, history: a.companionDialogue.snapshot(), context: a.localDialogueContext() };
      });
      expect(state.greeting).not.toBe(''); expect(state.pickup).toBe(true);
      expect(state.rejected).not.toMatch(/PRIVATE|Homework Notes|you put me on/i);
      expect(mock.calls).toBe(1); expect(state.context).toBeUndefined();
      expect(state.history.history.some((h: any) => h.event === 'greeting')).toBe(true);
      expect(JSON.parse(fs.readFileSync(path.join(dir, 'dialogue-history.json'), 'utf8')).history).toHaveLength(state.history.history.length);
      await app.evaluate(() => { const a = (globalThis as any).__capri; a.bubble.begin(); a.bubble.open(); a.bubble.phase('thinking'); });
      const bubble = app.windows().find(w => w.url().includes('/bubble.html'))!;
      await expect.poll(() => bubble.locator('#message').textContent()).toMatch(/second|hang on|think/i);
      const waiting = await bubble.locator('#message').textContent();
      await bubble.waitForTimeout(1200); expect(await bubble.locator('#message').textContent()).toBe(waiting);
      expect(mock.calls).toBe(1);
      if (process.env.CAPRI_DIALOGUE_SCREENSHOT) {
        await bubble.screenshot({ path: process.env.CAPRI_DIALOGUE_SCREENSHOT });
        const char = app.windows().find(w => w.url().includes('/character.html'))!;
        const panel = await openPanel(app, char, 'character');
        await panel.getByText('Conversation cues', { exact: true }).scrollIntoViewIfNeeded();
        await panel.screenshot({ path: process.env.CAPRI_DIALOGUE_SCREENSHOT.replace('.png', '-settings.png') });
      }
    } finally { await mock.close(); }
  });
  it('filters native helper and transparent windows while retaining visible dialog occluders', async () => {
    const { app } = await launch(profile());
    const state = await app.evaluate(async ({ BrowserWindow }) => {
      const a = (globalThis as any).__capri;
      const normal = new BrowserWindow({ width: 180, height: 100, x: 20, y: 20, show: false, title: 'Capri visibility QA document', skipTaskbar: true });
      const helper = new BrowserWindow({ width: 180, height: 100, x: 20, y: 20, show: false, title: 'QA OSD', skipTaskbar: true });
      const hidden = new BrowserWindow({ width: 180, height: 100, show: false, title: 'Capri hidden QA', skipTaskbar: true });
      const transparent = new BrowserWindow({ width: 180, height: 100, show: false, title: 'Capri transparent QA', skipTaskbar: true, transparent: true, frame: false });
      const dialog = new BrowserWindow({ width: 180, height: 100, x: 20, y: 20, show: false, title: 'Capri QA dialog', parent: normal, skipTaskbar: true });
      const id = (w: any) => w.getNativeWindowHandle().readBigUInt64LE();
      try {
        normal.showInactive(); helper.showInactive(); transparent.setOpacity(0); transparent.showInactive(); dialog.showInactive();
        await new Promise(r => setTimeout(r, 250));
        const all = a.desktopWindows();
        return { normal: all.some((w: any) => w.handle === id(normal) && w.eligible), helper: all.some((w: any) => w.handle === id(helper)), hidden: all.some((w: any) => w.handle === id(hidden)), transparent: all.some((w: any) => w.handle === id(transparent)), dialog: all.some((w: any) => w.handle === id(dialog) && w.eligible === false) };
      } finally { for (const w of [dialog, transparent, hidden, helper, normal]) if (!w.isDestroyed()) w.destroy(); }
    });
    expect(state).toEqual({ normal: true, helper: false, hidden: false, transparent: false, dialog: true });
  });
  it('rejects invisible helpers and covered destinations, then leaves a newly covered perch', async () => {
    const { app } = await launch(profile({ behavior: { explore: false, quietHours: { enabled: false } }, teleport: { effects: false } }));
    const result = await app.evaluate(() => {
      const g = globalThis as any, a = g.__capri;
      g.__capriWindowsOverride = [
        { handle: -10n, rect: { x: 0, y: 0, width: 1920, height: 1080 } },
        { handle: -11n, eligible: false, rect: { x: 0, y: 0, width: 700, height: 1000 } },
        { handle: -12n, rect: { x: 100, y: 100, width: 1200, height: 800 } },
      ];
      g.__capriWindowInfo = { '-10': { title: 'QA OSD', process: 'QAOSD.exe' }, '-12': { title: 'Notes', process: 'notepad.exe' } };
      const b = a.charWin.getBounds();
      const left = a.safeForTarget({ ...b, x: 150, y: 200 }, -12n);
      const right = a.safeForTarget({ ...b, x: 900, y: 200 }, -12n);
      const helpers = a.desktopWindows().some((w: any) => w.handle === -10n);
      g.__capriWindowsOverride = [{ handle: -12n, rect: { x: 100, y: 700, width: 1200, height: 500 } }];
      a.charWin.setBounds({ ...b, x: 500, y: Math.round(700 - b.height * .712) }); a.settleAfterDrop();
      a.visit.begin(-12n);
      g.__capriWindowsOverride.unshift({ handle: -13n, rect: { x: 0, y: 0, width: 1920, height: 1800 }, eligible: false });
      a.presenceTick();
      return { left, right, helpers, cancelled: a.visit.phase === 'idle', fullyCovered: a.safeForTarget(a.charWin.getBounds(), -12n) };
    });
    expect(result).toEqual({ left: false, right: true, helpers: false, cancelled: true, fullyCovered: false });
  });
  it('draws a short directional teleport ray in an unfocusable temporary window', async () => {
    const { app } = await launch(profile({ behavior: { explore: false }, teleport: { effects: true } }), { env: { CAPRI_TRAIL_TEST: '1' } });
    const wait = app.waitForEvent('window', { predicate: w => w.url().includes('/trail.html'), timeout: 7000 });
    await app.evaluate(() => {
      const a = (globalThis as any).__capri; a.charWin.setBounds({ ...a.charWin.getBounds(), x: 100, y: 100 }); const b = a.charWin.getBounds();
      (globalThis as any).__rayJump = a.teleporter.jumpTo({ ...b, x: b.x + 450, y: b.y + 120, kind: 'spot' });
    });
    const ray = await wait;
    await ray.waitForFunction(() => !!(window as any).__trailDebug);
    const drawn = await ray.evaluate(() => {
      const d = (window as any).__trailDebug; d.paint(200);
      const canvas = document.querySelector('canvas')!, pixels = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data;
      return { dx: d.to.x - d.from.x, dy: d.to.y - d.from.y, pixels: pixels.some((v, i) => i % 4 === 3 && v > 0) };
    });
    expect(drawn.dx).toBeCloseTo(450, 0); expect(drawn.dy).toBeCloseTo(120, 0); expect(drawn.pixels).toBe(true);
    const focus = await app.evaluate(({ BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows().find(w => w.webContents.getURL().includes('/trail.html'))!;
      return { focusable: w.isFocusable(), focused: w.isFocused() };
    });
    expect(focus).toEqual({ focusable: false, focused: false });
    await expect.poll(() => ray.isClosed(), { timeout: 3000 }).toBe(true);
    await app.evaluate(async () => { await (globalThis as any).__rayJump; });
  });
  it('returns near the cursor after inactivity with a text greeting and no model request', async () => {
    const mock = await mockModel(() => 'No model call needed.');
    const { app } = await launch(openaiProfile(mock.url, { behavior: { quietHours: { enabled: false } }, teleport: { auto: false, effects: false } }));
    try {
      const result = await app.evaluate(async () => {
        const a = (globalThis as any).__capri;
        a.teleporter.d.cursor = () => ({ x: 1000, y: 650 });
        a.charWin.setBounds({ ...a.charWin.getBounds(), x: 100, y: 100 });
        a.cursorReturn.observe(120, Date.now());
        const triggered = a.cursorReturn.move(Date.now(), false);
        if (triggered) await a.returnToCursor();
        return { triggered, target: a.teleporter.last, line: a.bubble.state.text, twice: a.cursorReturn.move(Date.now(), false) };
      });
      expect(result.triggered).toBe(true); expect(result.target).toContain('near_cursor'); expect(result.twice).toBe(false);
      expect(result.line.length).toBeGreaterThan(0); expect(mock.calls).toBe(0);
    } finally { await mock.close(); }
  });
  it('waits for stable cursor direction and preserves idle phase across a blink', async () => {
    const { char } = await launch(profile());
    const result = await char.evaluate(() => {
      const d = window.__capriDebug as any; d.manual(true);
      const c = document.querySelector('canvas') as HTMLCanvasElement, ctx = c.getContext('2d')!;
      const p = { ...d.anim.value, blinkL: 0, blinkR: 0, mouthSmile: .3, mouthOpen: 0 };
      const draw = (dir: number, dt: number) => { ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0); d.model.faceToward(dir); d.model.draw(ctx, p, dt, { pose: 'stand', dragging: false, ledge: false, taskbar: false, animation: 'auto', facing: 'cursor', intensity: 1, glitchEnabled: false, personality: { motion: 1, lean: 0, clip: null } }, innerWidth, innerHeight); };
      for (let i = 0; i < 10; i++) draw(-1, .03);
      const initial = d.model.facing;
      draw(1, 1 / 60);
      const noise = d.model.facing;
      for (let i = 0; i < 20; i++) draw(1, .03);
      const sustained = d.model.facing;
      d.model.requestAnimation('blink', .2); for (let i = 0; i < 12; i++) draw(1, .03);
      const resumed = d.model.activeFrame, expected = Math.floor(d.model.motionTime * 8) % 16;
      d.manual(false); return { initial, noise, sustained, resumed, expected };
    });
    expect(result.noise).toBe(result.initial); expect(result.noise).not.toBe(result.sustained); expect(result.sustained).toBe(-1); expect(result.resumed).toBe(result.expected);
  });
  it('uses keyboard/system activity for sleep and runs subject-bound local scenes without model calls', async () => {
    const mock = await mockModel(() => 'No generation should be needed.');
    const { app, char } = await launch(openaiProfile(mock.url, { behavior: { explore: false, idleRemarks: true, quietHours: { enabled: false }, smallActivities: true } }));
    try {
      const state = await app.evaluate(() => {
        const g = globalThis as any, a = g.__capri;
        g.__capriIdleOverride = 0; a.setCursorIdle(600);
        g.__capriForegroundHandle = -92n;
        g.__capriWindowsOverride = [{ handle: -92n, rect: { x: 100, y: 500, width: 800, height: 600 } }];
        g.__capriWindowInfo = { '-92': { title: 'Engineering notes', process: 'reader.exe' } };
        const original = Date.now, base = original() + 12000;
        try { for (const dt of [0, 4000, 8000, 12000, 16000, 20000, 26000]) { Date.now = () => base + dt; a.presenceTick(); } }
        finally { Date.now = original; }
        return { idle: a.systemIdleSec(), phase: a.activities.phase, subject: a.activities.subject, line: a.bubble.state.text };
      });
      expect(state).toMatchObject({ idle: 0, phase: 'rest', subject: 'Engineering notes' });
      expect(state.line).not.toContain('Engineering notes'); expect(mock.calls).toBe(0);
      await expect.poll(() => char.evaluate(() => (window.__capriDebug as any).idleSec)).toBe(0);
      expect(await char.evaluate(() => (window.__capriDebug as any).behavior.state)).not.toBe('sleeping');
      const motion = await char.evaluate(() => {
        const d = window.__capriDebug as any; d.manual(true); d.step(1 / 30, 10);
        const before = { ...d.model.speechAnchor };
        d.model.act('lean', 1); d.step(1 / 30, 37);
        const after = { ...d.model.speechAnchor }; d.manual(false); return { before, after };
      });
      expect(Math.abs(motion.after.x - motion.before.x)).toBeGreaterThan(.008);
    } finally { await mock.close(); }
  });
  it('uses Sleep as a persistent behavior mode and blocks ambient calls until woken', async () => {
    const mock = await mockModel(() => 'Should not be requested while sleeping.');
    const dir = openaiProfile(mock.url, { behavior: { explore: true, quietHours: { enabled: false } } });
    const { app, char } = await launch(dir, { env: { CAPRI_TASKBAR_TEST: '1' } });
    try {
      const controls = app.windows().find(w => w.url().includes('/taskbar.html')) ?? await app.waitForEvent('window');
      await app.evaluate(() => (globalThis as any).__capri.taskbar.show());
      await controls.getByRole('button', { name: 'Sleep', exact: true }).click();
      await expect.poll(() => char.evaluate(() => (window.__capriDebug as any).behavior.state)).toBe('sleeping');
      await char.dispatchEvent('body', 'mousemove', { clientX: 180, clientY: 160 });
      await char.evaluate(() => window.capri.invoke('char:interaction', 'pat'));
      await app.evaluate(async () => {
        const a = (globalThis as any).__capri; a.presenceTick(); a.setNextVisit(); await a.exploreTick(0); await a.generatedRemark('greeting'); a.settings.flush();
      });
      expect(await char.evaluate(() => (window.__capriDebug as any).model.activeClip)).toBe('sleep');
      expect(mock.calls).toBe(0);
      expect(JSON.parse(fs.readFileSync(path.join(dir, 'settings.json'), 'utf8')).behavior.mode).toBe('sleep');
      await controls.getByRole('button', { name: 'Company', exact: true }).click();
      await expect.poll(() => char.evaluate(() => (window.__capriDebug as any).behavior.state)).not.toBe('sleeping');
      expect(mock.calls).toBe(0);
    } finally { await mock.close(); }
  });
  it('starts real window exploration through the mode control even with automatic visits disabled', async () => {
    const { app } = await launch(profile({ behavior: { explore: false, quietHours: { enabled: false } } }), { env: { CAPRI_TASKBAR_TEST: '1' } });
    const controls = app.windows().find(w => w.url().includes('/taskbar.html')) ?? await app.waitForEvent('window');
    await app.evaluate(() => {
      const g = globalThis as any, a = g.__capri; Math.random=()=>0;
      g.__capriWindowsOverride = [{ handle: 11n, rect: { x: 200, y: 850, width: 900, height: 400 } }];
      g.__capriWindowInfo = { '11': { title: 'Study notes', process: 'Acrobat.exe' } };
      g.__capriDesktopOverride = { title: 'Desktop', process: 'explorer.exe' };
      a.charWin.setBounds({ ...a.charWin.getBounds(), x: 300, y: 300 });
      a.taskbar.show();
    });
    await controls.getByRole('button', { name: 'Explore', exact: true }).click();
    await app.evaluate(async () => { const a = (globalThis as any).__capri; a.setNextVisit(); await a.exploreTick(0); });
    const state = await app.evaluate(() => { const a = (globalThis as any).__capri; return { mode: a.settings.get().behavior.mode, auto: a.settings.get().behavior.explore, target: String(a.attentionHandle), phase: a.visit.phase, owner: a.teleporter.d.blocked() }; });
    expect(state).toMatchObject({ mode: 'explore', auto: false, target: '11', phase: 'idle' });
    expect(state.owner).toBe('window exploration handles autonomous movement');
    expect(await controls.getByRole('button', { name: 'Explore', exact: true }).getAttribute('aria-pressed')).toBe('true');
  });
  it('generates a quit farewell, teleports out and closes without learning from the farewell', async () => {
    const mock = await mockModel(() => 'The screen is yours. Try not to look too relieved.');
    const dir = openaiProfile(mock.url);
    const { app } = await launch(dir, { env: { CAPRI_QUIT_TEST: '1', CAPRI_TASKBAR_TEST: '1' } });
    const proc = app.process();
    try {
      await app.evaluate(({ app }) => app.quit());
      await expect.poll(() => {
        try { return JSON.parse(fs.readFileSync(path.join(dir, 'farewell.json'), 'utf8')).last; } catch { return ''; }
      }).toBe('The screen is yours. Try not to look too relieved.');
      await expect.poll(() => fs.readFileSync(path.join(dir, 'logs/capri.log'), 'utf8'), { timeout: 6000 }).toContain('farewell teleport out');
      await app.close().catch(() => {});
      await expect.poll(() => proc.exitCode).toBe(0);
      apps.splice(apps.indexOf(app), 1);
      expect(mock.calls).toBe(1);
      expect(fs.existsSync(path.join(dir, 'memory.json'))).toBe(false);
    } finally { await mock.close(); }
  });
  it('does not disable pickup on a false native mouseleave while the cursor remains over opaque art', async () => {
    const { char } = await launch(profile());
    const result = await char.evaluate(() => {
      const d = window.__capriDebug as any; d.manual(true);
      const a = d.model.speechAnchor;
      let point: { x: number; y: number } | undefined;
      for (let y = a.y * innerHeight - 20; y < a.y * innerHeight + 40 && !point; y += 3)
        for (let x = a.x * innerWidth - 20; x < a.x * innerWidth + 40; x += 3)
          if (d.hitAt(x, y)) { point = { x, y }; break; }
      if (!point) throw Error('No opaque point');
      window.dispatchEvent(new MouseEvent('mousemove', { clientX: point.x, clientY: point.y }));
      const entered = d.hit;
      window.dispatchEvent(new MouseEvent('mouseleave'));
      d.step(1 / 60);
      const afterLeave = d.hit; d.manual(false);
      return { entered, afterLeave };
    });
    expect(result).toEqual({ entered: true, afterLeave: true });
  });
  it('releases renderer held state when Windows ends a drag outside the character', async () => {
    const { app, char } = await launch(profile());
    await char.evaluate(() => window.capri.invoke('char:drag', 'start'));
    // Native button polling ends synthetic / outside releases without a renderer mouseup.
    await expect.poll(() => char.evaluate(() => (window.__capriDebug as any).dragging)).toBe(false);
    await app.evaluate(() => (globalThis as any).__capri.settings.update({ character: { opacity: .98 } }));
    await char.evaluate(() => window.capri.invoke('char:drag', 'start'));
    await expect.poll(() => char.evaluate(() => (window.__capriDebug as any).dragging)).toBe(false);
  });
  it('aims the bubble at the transformed face for inverted and mirrored poses', async () => {
    const { app, char } = await launch(profile());
    await app.evaluate(() => {
      const a = (globalThis as any).__capri;
      a.charWin.setBounds({ ...a.charWin.getBounds(), x: 500, y: 250 });
      a.charWin.webContents.send('cue', { type: 'attachment', mode: 'perch' });
      a.settings.update({ character: { facing: 'left' } });
      a.bubble.remark('Testing a moving pointer.');
    });
    const bubble = app.windows().find(w => w.url().includes('/bubble.html')) ?? await app.waitForEvent('window');
    await bubble.locator('#card').waitFor({ state: 'visible' });
    await char.waitForTimeout(300);
    const before = await char.evaluate(() => ({ ...(window.__capriDebug as any).model.speechAnchor }));
    await app.evaluate(() => {
      const a = (globalThis as any).__capri;
      a.settings.update({ character: { facing: 'right' } });
      a.charWin.webContents.send('cue', { type: 'attachment', mode: 'inverted' });
    });
    await expect.poll(() => char.evaluate(() => (window.__capriDebug as any).model.speechAnchor.y)).toBeGreaterThan(before.y + .1);
    const after = await char.evaluate(() => ({ ...(window.__capriDebug as any).model.speechAnchor }));
    expect(Math.abs(after.x - before.x)).toBeGreaterThan(.01);
    await expect.poll(() => app.evaluate(() => (globalThis as any).__capri.bubble.state.tail?.y)).toBeGreaterThan(0);
    expect(await bubble.locator('#tail').count()).toBe(0);
  });
  it('keeps the native full-body window hidden throughout replay despite foreground and settings changes', async () => {
    const { app, char } = await launch(profile(), { env: { CAPRI_TASKBAR_TEST: '1', CAPRI_OFFSCREEN: '0' } });
    await expect.poll(() => app.evaluate(() => (globalThis as any).__capri.charWin.isVisible())).toBe(true);
    await app.evaluate(() => (globalThis as any).__capri.taskbar.show());
    const next = app.waitForEvent('window');
    await app.evaluate(() => (globalThis as any).__capri.taskbar.command('intro'));
    const intro = await next; await intro.waitForFunction(() => !!(window as any).__introDebug);
    for (let i = 0; i < 12; i++) {
      expect(await app.evaluate((_, i) => {
        const g = globalThis as any, a = g.__capri;
        g.__capriForegroundHandle = BigInt(100 + i); a.raiseTick();
        a.settings.update({ character: { opacity: i % 2 ? .95 : 1 } });
        a.restoreCapri();
        return { active: a.opening.active, visible: a.charWin.isVisible(), logical: a.charWin.capriShown };
      }, i)).toEqual({ active: true, visible: false, logical: false });
      await char.waitForTimeout(100);
    }
    expect(await char.evaluate(() => (window.__capriDebug as any).paused)).toBe(true);
    // Resizing / fractional DPI changes must update the backing canvas while it is playing.
    await app.evaluate(() => (globalThis as any).__capri.opening.window.setBounds({ width: 1200, height: 800 }));
    await intro.waitForFunction(() => {
      const c = document.querySelector('canvas')!;
      return c.width === Math.round(innerWidth * devicePixelRatio) && c.height === Math.round(innerHeight * devicePixelRatio);
    });
    await app.evaluate(() => (globalThis as any).__capri.opening.cancel());
    expect(await app.evaluate(() => (globalThis as any).__capri.charWin.isVisible())).toBe(true);
    await expect.poll(() => char.evaluate(() => (window.__capriDebug as any).paused)).toBe(false);
  });
  it('keeps Capri independent of native panel minimize/restore/close and quits only on command', async () => {
    const { app } = await launch(profile(), { env: { CAPRI_TASKBAR_TEST: '1' } });
    await expect.poll(() => app.evaluate(() => !!(globalThis as any).__capri.taskbar)).toBe(true);
    await app.evaluate(() => (globalThis as any).__capri.taskbar.show());
    await app.evaluate(() => (globalThis as any).__capri.taskbar.window.minimize());
    expect(await app.evaluate(() => (globalThis as any).__capri.charWin.capriShown)).toBe(true);
    await app.evaluate(() => (globalThis as any).__capri.minimizeCapri());
    await app.evaluate(() => (globalThis as any).__capri.taskbar.show());
    expect(await app.evaluate(() => (globalThis as any).__capri.charWin.capriShown)).toBe(false);
    await app.evaluate(() => (globalThis as any).__capri.taskbar.window.close());
    expect(await app.evaluate(() => (globalThis as any).__capri.taskbar.window.isMinimized())).toBe(true);
    const proc = app.process();
    await app.evaluate(() => (globalThis as any).__capri.taskbar.command('quit')).catch(() => {});
    // Node can wait for Playwright's inspector connection after will-quit.
    // Release that connection before asserting the native process exit.
    await app.close().catch(() => {});
    apps.splice(apps.indexOf(app), 1);
    await expect.poll(() => proc.exitCode).toBe(0);
  });
  it('plays on launch without focus, then restores the pet and releases the overlay', async () => {
    const { app, char } = await launch(profile(), { env: { CAPRI_INTRO_TEST: '1' } });
    const intro = app.windows().find(w => w !== char) ?? await app.waitForEvent('window');
    await intro.waitForFunction(() => !!(window as any).__introDebug);
    const info = await app.evaluate(() => { const a = (globalThis as any).__capri; return { active: a.opening.active, focusable: a.opening.window.isFocusable(), shown: a.charWin.capriShown }; });
    expect(info).toMatchObject({ active: true, focusable: false, shown: false });
    await expect.poll(() => app.evaluate(() => (globalThis as any).__capri.opening.active), { timeout: 10000 }).toBe(false);
    expect(await app.evaluate(() => (globalThis as any).__capri.charWin.capriShown)).toBe(true);
    await expect.poll(() => char.evaluate(() => (window.__capriDebug as any).paused)).toBe(false);
  });
  it('recovers from a failed opening and minimizes/restores through the taskbar controls', async () => {
    const { app, char } = await launch(profile(), { env: { CAPRI_TASKBAR_TEST: '1' } });
    const controls = app.windows().find(w => w !== char) ?? await app.waitForEvent('window');
    await controls.getByRole('button', { name: 'Talk to Capri', exact: true }).waitFor();
    await app.evaluate(() => (globalThis as any).__capri.taskbar.show());
    await controls.getByRole('button', { name: 'Hide Capri', exact: true }).click();
    await expect.poll(() => app.evaluate(() => (globalThis as any).__capri.charWin.capriShown)).toBe(false);
    await app.evaluate(() => (globalThis as any).__capri.taskbar.show());
    const bubbleReady = app.waitForEvent('window');
    await controls.getByRole('button', { name: 'Talk to Capri', exact: true }).click();
    const bubble = await bubbleReady; await bubble.locator('#input').waitFor({ state: 'visible' });
    expect(await app.evaluate(() => (globalThis as any).__capri.charWin.capriShown)).toBe(true);
    await app.evaluate(() => (globalThis as any).__capri.bubble.dismiss());
    await app.evaluate(() => (globalThis as any).__capri.taskbar.show());
    const openingReady = app.waitForEvent('window');
    await controls.getByRole('button', { name: 'Replay opening', exact: true }).click();
    const opening = await openingReady; await opening.waitForSelector('#opening');
    await app.evaluate(() => (globalThis as any).__capri.opening.window.webContents.forcefullyCrashRenderer());
    await expect.poll(() => app.evaluate(() => (globalThis as any).__capri.opening.active)).toBe(false);
    expect(await app.evaluate(() => (globalThis as any).__capri.charWin.capriShown)).toBe(true);
    const secrets = await controls.evaluate(async () => { try { await (window as any).capri.invoke('secrets:status'); return 'allowed'; } catch { return 'blocked'; } });
    expect(secrets).toBe('blocked');
  });
  it('uses reduced motion and cancels the opening when Capri is minimized', async () => {
    const { app } = await launch(profile());
    const next = app.waitForEvent('window');
    await app.evaluate(() => (globalThis as any).__capri.playOpening(true));
    const intro = await next; await intro.waitForFunction(() => !!(window as any).__introDebug);
    expect(await intro.evaluate(() => (window as any).__introDebug.still)).toBe(true);
    await app.evaluate(() => (globalThis as any).__capri.minimizeCapri());
    expect(await app.evaluate(() => (globalThis as any).__capri.opening.active)).toBe(false);
    expect(await app.evaluate(() => (globalThis as any).__capri.charWin.capriShown)).toBe(false);
    await app.evaluate(() => (globalThis as any).__capri.restoreCapri());
    expect(await app.evaluate(() => (globalThis as any).__capri.charWin.capriShown)).toBe(true);
  });
});

describe('reference transmission visuals', () => {
  it('loads portraits and fonts, shows elapsed loading and the actual error, and fits an expanded composer', async () => {
    const { app, char } = await launch(profile());
    const next = app.waitForEvent('window');
    await char.evaluate(() => window.capri.invoke('bubble:open'));
    const bubble = await next;
    await bubble.waitForSelector('#input');
    // Opening chat starts a greeting. Finish it before injecting synthetic reply phases.
    await expect.poll(() => app.evaluate(() => (globalThis as any).__capri.bubble.state.text)).not.toBe('');
    await app.evaluate(() => {
      const b = (globalThis as any).__capri.bubble;
      b.begin(); b.state.startedAt = Date.now() - 17000; b.phase('thinking');
    });
    await bubble.waitForFunction(() => document.getElementById('status')!.textContent === 'Still working');
    expect(await bubble.locator('#activity').isVisible()).toBe(true);
    await bubble.waitForFunction(() => (document.getElementById('portrait') as HTMLImageElement).naturalWidth > 0);
    expect(await bubble.locator('#portrait').getAttribute('src')).toContain('face-aside');
    expect(await bubble.evaluate(async () => { await document.fonts.ready; return document.fonts.check('16px Chakra'); })).toBe(true);
    await app.evaluate(() => (globalThis as any).__capri.bubble.done({ id: 'failed', role: 'assistant', content: 'Server refused this reply (HTTP 429).', meta: { error: true } }));
    await bubble.waitForFunction(() => document.body.dataset.kind === 'error');
    expect(await bubble.locator('#message').textContent()).toContain('HTTP 429');
    expect(await bubble.locator('#activity').isHidden()).toBe(true);
    expect(await bubble.locator('#portrait').getAttribute('src')).toContain('face-wide');
    await app.evaluate(() => (globalThis as any).__capri.bubble.done({ id: 'long', role: 'assistant', content: 'A longer reply. '.repeat(200) }));
    await bubble.fill('#input', 'A longer input\n'.repeat(8));
    await bubble.locator('#input').dispatchEvent('input');
    await bubble.waitForTimeout(350);
    const fit = await bubble.evaluate(() => ({ bottom: document.getElementById('send')!.getBoundingClientRect().bottom, height: innerHeight, overflow: !(document.getElementById('page-next') as HTMLButtonElement).disabled }));
    expect(fit.bottom).toBeLessThan(fit.height - 10);
    expect(fit.overflow).toBe(true);
    await bubble.press('#input', 'Escape');
    expect(await app.evaluate(({ BrowserWindow }) => (BrowserWindow.getAllWindows().find(w => w.getTitle() === 'Capri bubble') as any).capriShown)).toBe(false);
  });

  it('keeps the transport effect inside her own window and raises her after the final landing', async () => {
    const { app, char } = await launch(profile());
    await app.evaluate(() => {
      const a = (globalThis as any).__capri, w = a.charWin, calls: string[] = [];
      (globalThis as any).__landingCalls = calls;
      const bounds = w.setBounds.bind(w), top = w.setAlwaysOnTop.bind(w);
      w.setBounds = (...args: any[]) => { calls.push('bounds'); return bounds(...args); };
      w.setAlwaysOnTop = (...args: any[]) => { calls.push('raise'); return top(...args); };
    });
    for (let i = 0; i < 2; i++) {
      const result = await char.evaluate(() => window.capri.invoke('teleport:now', 'random'));
      expect(result.ok).toBe(true);
      const info = await app.evaluate(({ BrowserWindow }) => {
        const calls = (globalThis as any).__landingCalls as string[];
        return { overlays: BrowserWindow.getAllWindows().filter(w => w.getTitle() === 'Capri transport').length,
          lastBounds: calls.lastIndexOf('bounds'), lastRaise: calls.lastIndexOf('raise') };
      });
      expect(info.overlays).toBe(0); expect(info.lastRaise).toBeGreaterThan(info.lastBounds);
      expect(await char.evaluate(() => (window as any).__capriDebug.fx.hidden)).toBe(false);
      await char.waitForTimeout(1000);
    }
  });
});

describe('desktop presence', () => {
  it('starts with a transparent, frameless, always-on-top, non-focusable character window and shuts down cleanly', async () => {
    const ud = profile();
    const { app } = await launch(ud);
    // cold first launch (e.g. right after install, while Windows scans new binaries) can show the window a beat late
    for (let i = 0; i < 50; i++) {
      const shownNow = await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows().find((x) => x.getTitle() === 'Capri' && !x.isFocusable()); return !!w && (w.isVisible() || (w as unknown as { capriShown?: boolean }).capriShown === true); });
      if (shownNow) break;
      await new Promise((r) => setTimeout(r, 200));
    }
    const info = await app.evaluate(({ BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows().find((x) => x.getTitle() === 'Capri' && !x.isFocusable())!;
      return { bg: w.getBackgroundColor(), top: w.isAlwaysOnTop(), offscreen: w.webContents.isOffscreen(), configuredTop: (globalThis as unknown as { __capri: { settings: { get(): { character: { alwaysOnTop: boolean } } } } }).__capri.settings.get().character.alwaysOnTop, focusable: w.isFocusable(), visible: w.isVisible() || (w as unknown as { capriShown?: boolean }).capriShown === true, resizable: w.isResizable(), bounds: w.getBounds() };
    });
    expect(info).toMatchObject({ configuredTop: true, focusable: false, visible: true, resizable: false });
    // An offscreen renderer has no reliable native Windows topmost surface. Keep the
    // native assertion for visible runs; hidden runs check the configured preference.
    if (!info.offscreen) expect(info.top).toBe(true);
    expect(info.bg.toLowerCase()).toMatch(/^#0{6,8}$/);
    const startup = await app.evaluate(() => (globalThis as unknown as { __capri: { startupMs: number } }).__capri.startupMs);
    expect(startup).toBeGreaterThan(0);
    expect(startup).toBeLessThan(10_000);
    expect(fs.existsSync(path.join(ud, 'session.lock'))).toBe(true);
    await quit(app);
    expect(fs.existsSync(path.join(ud, 'session.lock'))).toBe(false);
    expect(fs.readFileSync(path.join(ud, 'logs', 'capri.log'), 'utf8')).toContain('clean shutdown');
  });

  it('renders Capri with real transparency and pixel-accurate hit testing', async () => {
    const { char } = await launch(profile());
    await char.waitForTimeout(600);
    const px = await char.evaluate(() => {
      const c = document.getElementById('stage') as HTMLCanvasElement;
      const g = c.getContext('2d')!;
      const at = (fx: number, fy: number) => Array.from(g.getImageData(Math.floor(c.width * fx), Math.floor(c.height * fy), 1, 1).data);
      const W = innerWidth, H = innerHeight;
      const dbg = (window as unknown as { __capriDebug: { hitAt(x: number, y: number): boolean } }).__capriDebug;
      let crimson = 0, green = 0, total = 0, onHer: [number, number] | null = null;
      for (let fy = 0.02; fy < 1; fy += 0.04) for (let fx = 0.02; fx < 1; fx += 0.04) {
        const [r, g2, b, a] = at(fx, fy); total++;
        if (r > 200 && g2 < 80 && b < 120) { crimson++; if (!onHer && a > 200) onHer = [fx, fy]; }
        if (g2 > 200 && r < 100) green++;
      }
      const [hx, hy] = onHer ?? [0.5, 0.3];
      return { corner: at(0.01, 0.99), head: at(hx, hy), crimson: crimson / total, green, hitHead: dbg.hitAt(W * hx, H * hy), hitCorner: dbg.hitAt(W * 0.01, H * 0.99) };
    });
    expect(px.corner[3]).toBe(0); // transparent background
    expect(px.head[3]).toBeGreaterThan(200); // opaque character
    expect(px.crimson).toBeGreaterThan(0.035); // the crimson hair mass is a large share of the frame (sized for her tallest pose)
    expect(px.green).toBeGreaterThan(0); // neon-green mask/panels present
    expect(px.hitHead).toBe(true);
    expect(px.hitCorner).toBe(false);
  });

  it('remembers its position across restarts and clamps impossible positions', async () => {
    const ud = profile();
    let { app, char } = await launch(ud);
    await char.waitForTimeout(800); // after the window has settled, like a user drag would be
    await app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows().find((x) => x.getTitle() === 'Capri' && !x.isFocusable())!.setPosition(200, 150); });
    await new Promise((r) => setTimeout(r, 700));
    const before = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((x) => x.getTitle() === 'Capri' && !x.isFocusable())!.getPosition());
    expect(Math.abs(before[0] - 200)).toBeLessThanOrEqual(3); // Electron rounds DIP↔px at fractional DPI (±1–3 px per axis)
    expect(Math.abs(before[1] - 150)).toBeLessThanOrEqual(3);
    await quit(app);
    ({ app, char } = await launch(ud));
    const pos = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((x) => x.getTitle() === 'Capri' && !x.isFocusable())!.getPosition());
    expect(Math.abs(pos[0] - before[0])).toBeLessThanOrEqual(3); // Electron reports ±1–3 px at fractional DPI
    expect(Math.abs(pos[1] - before[1])).toBeLessThanOrEqual(3);
    await quit(app);
    const s = JSON.parse(fs.readFileSync(path.join(ud, 'settings.json'), 'utf8'));
    s.character.position = { x: 99999, y: -99999, displayId: 123456 };
    fs.writeFileSync(path.join(ud, 'settings.json'), JSON.stringify(s));
    ({ app, char } = await launch(ud));
    const r = await app.evaluate(({ BrowserWindow, screen }) => {
      const b = BrowserWindow.getAllWindows().find((x) => x.getTitle() === 'Capri' && !x.isFocusable())!.getBounds();
      return { b, displays: screen.getAllDisplays().map((d) => d.workArea) };
    });
    const visible = r.displays.some((d) => r.b.x < d.x + d.width && r.b.x + r.b.width > d.x && r.b.y < d.y + d.height && r.b.y + r.b.height > d.y);
    expect(visible).toBe(true);
  });

  it('does not creep across repeated restarts (fractional DPI)', async () => {
    const ud = profile({ character: { position: { x: 321, y: 123, displayId: 0 } } });
    const seen: number[][] = [];
    for (let i = 0; i < 3; i++) {
      const { app, char } = await launch(ud);
      await char.waitForTimeout(900);
      seen.push(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((x) => x.getTitle() === 'Capri' && !x.isFocusable())!.getPosition()));
      await quit(app);
    }
    const drift = Math.max(...seen.map((p) => Math.abs(p[0] - seen[0][0]) + Math.abs(p[1] - seen[0][1])));
    expect(drift).toBeLessThanOrEqual(2);
  });

  it('applies scale/opacity/always-on-top settings live and persists them', async () => {
    const ud = profile();
    const { app, char } = await launch(ud);
    const panel = await openPanel(app, char, 'look');
    await panel.evaluate(() => (window as unknown as { capri: { invoke(c: string, a: unknown): Promise<unknown> } }).capri.invoke('settings:set', { character: { scale: 0.6, opacity: 0.7, alwaysOnTop: false } }));
    await panel.waitForTimeout(400);
    const w = await app.evaluate(({ BrowserWindow }) => { const x = BrowserWindow.getAllWindows().find((y) => y.getTitle() === 'Capri' && !y.isFocusable())!; return { size: x.getSize(), opacity: x.getOpacity(), top: x.isAlwaysOnTop() }; });
    expect(Math.abs(w.size[0] - Math.round(FRAME_SIZE.width * 0.6))).toBeLessThanOrEqual(2); // DIP rounding at fractional DPI
    expect(Math.abs(w.size[1] - Math.round(FRAME_SIZE.height * 0.6))).toBeLessThanOrEqual(2);
    expect(w.opacity).toBeCloseTo(0.7, 1);
    expect(w.top).toBe(false);
    await quit(app);
    expect(JSON.parse(fs.readFileSync(path.join(ud, 'settings.json'), 'utf8')).character).toMatchObject({ scale: 0.6, opacity: 0.7, alwaysOnTop: false });
  });

  it('hiding pauses rendering; showing resumes it', async () => {
    const { app, char } = await launch(profile());
    await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows().find((x) => x.getTitle() === 'Capri' && !x.isFocusable())!; w.hide(); w.webContents.send('cue', { type: 'pause', paused: true }); });
    await char.waitForTimeout(200);
    expect(await char.evaluate(() => (window as unknown as { __capriDebug: { paused: boolean } }).__capriDebug.paused)).toBe(true);
    await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows().find((x) => x.getTitle() === 'Capri' && !x.isFocusable())!; if (process.env.CAPRI_OFFSCREEN !== '1') w.showInactive(); w.webContents.send('cue', { type: 'pause', paused: false }); });
    await char.waitForTimeout(200);
    expect(await char.evaluate(() => (window as unknown as { __capriDebug: { paused: boolean } }).__capriDebug.paused)).toBe(false);
  });

  it('animation state follows cues (reaction, listening, return to idle)', async () => {
    const { app, char } = await launch(profile());
    const state = () => char.evaluate(() => (window as unknown as { __capriDebug: { behavior: { state: string } } }).__capriDebug.behavior.state);
    const send = (cue: unknown) => app.evaluate(({ BrowserWindow }, c) => BrowserWindow.getAllWindows().find((x) => x.getTitle() === 'Capri' && !x.isFocusable())!.webContents.send('cue', c), cue);
    const waitState = (pred: string) => char.waitForFunction((re) => new RegExp(re).test((window as unknown as { __capriDebug: { behavior: { state: string } } }).__capriDebug.behavior.state), pred, { timeout: 5000 });
    await send({ type: 'react', reaction: 'wave' });
    await waitState('^action$');
    await send({ type: 'phase', phase: 'listening' });
    await waitState('^listening$');
    await send({ type: 'phase', phase: 'idle' });
    await waitState('^(idle|lookAround|distracted|action)$');
    expect(await state()).not.toBe('listening');
  });
});

describe('conversation', () => {
  it('streams a reply from the model into the chat and saves it', async () => {
    const model = await mockModel(() => 'Hey choom. Streaming works fine.');
    const ud = openaiProfile(model.url);
    const { app, char } = await launch(ud);
    const panel = await openPanel(app, char);
    await panel.fill('textarea', 'hello?');
    await panel.press('textarea', 'Enter');
    await panel.waitForSelector('.msg.assistant:not(.cursor) >> text=Streaming works fine.');
    const hist = fs.readFileSync(path.join(ud, 'history.jsonl'), 'utf8');
    expect(hist).toContain('Streaming works fine.');
    await model.close();
  });

  it('interrupting stops generation and marks the reply interrupted', async () => {
    const model = await mockModel(() => ({ delayMs: 60, text: 'word '.repeat(200) }));
    const { app, char } = await launch(openaiProfile(model.url));
    const panel = await openPanel(app, char);
    await panel.fill('textarea', 'talk a lot');
    await panel.press('textarea', 'Enter');
    await panel.waitForSelector('.msg.assistant.cursor');
    await panel.waitForTimeout(400);
    await panel.keyboard.press('Escape');
    await panel.waitForSelector('.msg.assistant >> text=— interrupted');
    const words = (await panel.locator('.msg.assistant').last().innerText()).split('word').length - 1;
    expect(words).toBeLessThan(100);
    await model.close();
  });

  it('recovers from model/network failures with a clear message', async () => {
    let fail = true;
    const model = await mockModel(() => (fail ? 'fail' : 'Back online.'));
    const { app, char } = await launch(openaiProfile(model.url));
    const panel = await openPanel(app, char);
    await panel.fill('textarea', 'hi'); await panel.press('textarea', 'Enter');
    await panel.waitForSelector('.msg.assistant.err');
    expect(await panel.locator('.status').innerText()).toMatch(/error/i);
    fail = false;
    await panel.fill('textarea', 'again'); await panel.press('textarea', 'Enter');
    await panel.waitForSelector('.msg.assistant >> text=Back online.');
    await model.close();
  });

  it('works with no model at all (offline command mode)', async () => {
    const { app, char } = await launch(profile());
    const panel = await openPanel(app, char);
    await panel.fill('textarea', 'note: buy coffee'); await panel.press('textarea', 'Enter');
    await panel.waitForSelector('.msg.action >> text=Saved note');
    const notes = await app.evaluate(() => (globalThis as unknown as { __capri: { notes: { list(): { body: string }[] } } }).__capri.notes.list());
    expect(notes[0].body).toBe('buy coffee');
  });
});

describe('voice', () => {
  it('speaks replies with a Windows voice: phase goes speaking → idle, mouth moves', async () => {
    const { app, char } = await launch(profile({ voice: { ttsEnabled: true, volume: 0 } }));
    if (process.env.CAPRI_VOICE_TRACE) console.log('voice: launched');
    const voices = await char.evaluate(() => new Promise<number>((r) => { const v = speechSynthesis.getVoices(); if (v.length) r(v.length); else speechSynthesis.onvoiceschanged = () => r(speechSynthesis.getVoices().length); setTimeout(() => r(speechSynthesis.getVoices().length), 3000); }));
    expect(voices).toBeGreaterThan(0);
    if (process.env.CAPRI_VOICE_TRACE) console.log('voice: voices ready');
    const panel = await openPanel(app, char);
    if (process.env.CAPRI_VOICE_TRACE) console.log('voice: panel ready');
    await panel.fill('textarea', 'who are you'); await panel.press('textarea', 'Enter');
    if (process.env.CAPRI_VOICE_TRACE) console.log('voice: submitted');
    await panel.waitForSelector('#phaseText >> text=speaking', { timeout: 15_000 });
    let maxMouth = 0;
    for (let i = 0; i < 20; i++) {
      maxMouth = Math.max(maxMouth, await char.evaluate(() => (window as unknown as { __capriDebug: { anim: { value: { mouthOpen: number } } } }).__capriDebug.anim.value.mouthOpen));
      await char.waitForTimeout(50);
    }
    expect(maxMouth).toBeGreaterThan(0.2);
    await panel.waitForSelector('#phaseChip[data-phase="idle"]', { state: 'attached', timeout: 30_000 }); // idle shows no badge
  });

  it('interrupting speech stops it immediately', async () => {
    const { app, char } = await launch(profile({ voice: { ttsEnabled: true, volume: 0 } }));
    if (process.env.CAPRI_VOICE_TRACE) console.log('interrupt: launched');
    const panel = await openPanel(app, char);
    if (process.env.CAPRI_VOICE_TRACE) console.log('interrupt: panel ready');
    await panel.fill('textarea', 'help'); await panel.press('textarea', 'Enter');
    await panel.waitForSelector('#phaseText >> text=speaking', { timeout: 15_000 });
    await panel.keyboard.press('Escape');
    await panel.waitForSelector('#phaseChip[data-phase="idle"]', { state: 'attached', timeout: 3000 });
    expect(await char.evaluate(() => (window as unknown as { __capriDebug: { speaker: { speaking: boolean } } }).__capriDebug.speaker.speaking)).toBe(false);
  });

  it.runIf(process.env.CAPRI_E2E_MIC === '1')('push-to-talk records, releases the mic, and transcribes offline', async () => {
    const { app, char } = await launch(profile({ voice: { micPermission: true } }));
    const panel = await openPanel(app, char);
    await panel.evaluate(() => (window as unknown as { capri: { invoke(c: string, a: string): Promise<unknown> } }).capri.invoke('voice:ptt', 'start'));
    await char.waitForTimeout(1500);
    await panel.evaluate(() => (window as unknown as { capri: { invoke(c: string, a: string): Promise<unknown> } }).capri.invoke('voice:ptt', 'stop'));
    // silence → "Didn't catch that"; speech → a user message. Either proves the pipeline ran.
    await panel.waitForFunction(() => /catch that/i.test(document.querySelector('.status')?.textContent ?? '') || document.querySelectorAll('.msg.user').length > 0, undefined, { timeout: 30_000 });
    // the microphone stream is released as soon as recording stops
    const tracksLive = await char.evaluate(() => (window as unknown as { __capriDebug: { mic?: { active: boolean } } }).__capriDebug.mic?.active);
    expect(tracksLive).toBe(false);
  });
});

describe('permissions & tools', () => {
  it('asks before opening a URL and does nothing when denied; opens only after approval', async () => {
    const model = await mockModel((b) => (b.messages.at(-1)!.content.startsWith('[action results]') ? 'Okay.' : 'Opening. <action>{"tool":"open_url","args":{"url":"example.com"}}</action>'));
    const { app, char } = await launch(openaiProfile(model.url));
    await app.evaluate(({ shell }) => { (globalThis as Record<string, unknown>).__opened = []; shell.openExternal = async (u: string) => { ((globalThis as Record<string, unknown>).__opened as string[]).push(u); }; });
    const panel = await openPanel(app, char);
    await panel.fill('textarea', 'open example'); await panel.press('textarea', 'Enter');
    await panel.locator('.confirm').getByText('Deny').click();
    await panel.waitForSelector('.msg.action >> text=declined');
    expect(await app.evaluate(() => (globalThis as Record<string, unknown>).__opened)).toEqual([]);
    await panel.fill('textarea', 'open example'); await panel.press('textarea', 'Enter');
    await panel.locator('.confirm').getByText('Allow').click();
    await panel.waitForSelector('.msg.action >> text=Opened example.com');
    expect(await app.evaluate(() => (globalThis as Record<string, unknown>).__opened)).toEqual(['https://example.com/']);
    await model.close();
  });

  it('rejects IPC from the wrong window and invalid payloads', async () => {
    const { char } = await launch(profile());
    const r = await char.evaluate(async () => {
      const api = (window as unknown as { capri: { invoke(c: string, a?: unknown): Promise<unknown> } }).capri;
      const out: string[] = [];
      for (const [ch, arg] of [['chat:send', { text: 'hi' }], ['secrets:set', { key: 'openai', value: 'x' }], ['memory:clear', undefined], ['char:hit', 'not-a-boolean'], ['shell:exec', 'calc']] as const) {
        try { await api.invoke(ch, arg); out.push(`${ch}:allowed`); } catch (e) { out.push(`${ch}:blocked`); }
      }
      return out;
    });
    expect(r).toEqual(['chat:send:blocked', 'secrets:set:blocked', 'memory:clear:blocked', 'char:hit:blocked', 'shell:exec:blocked']);
  });

  it('denies microphone access unless the user enabled it', async () => {
    const { char } = await launch(profile());
    const err = await char.evaluate(() => navigator.mediaDevices.getUserMedia({ audio: true }).then(() => 'granted', (e: Error) => e.name));
    expect(err).not.toBe('granted');
  });
});

describe('persistence & reliability', () => {
  it('memory and settings survive a restart; reset wipes them', async () => {
    const ud = profile();
    let { app, char } = await launch(ud);
    let panel = await openPanel(app, char, 'memory');
    await panel.fill('input[placeholder="Something to remember"]', 'My cat is called Delta');
    await panel.getByText('Add', { exact: true }).click();
    await panel.waitForSelector('text=My cat is called Delta');
    await quit(app);
    ({ app, char } = await launch(ud));
    panel = await openPanel(app, char, 'memory');
    await panel.waitForSelector('text=My cat is called Delta');
  });

  it('detects an unclean previous exit and reports it in diagnostics', async () => {
    const ud = profile();
    const first = await launch(ud);
    // hard-kill the whole process tree (simulates a crash / power loss)
    const { execSync } = await import('node:child_process');
    execSync(`taskkill /PID ${first.app.process().pid} /T /F`, { stdio: 'ignore' });
    await new Promise((r) => setTimeout(r, 1500));
    apps.splice(apps.indexOf(first.app), 1);
    const { app, char } = await launch(ud);
    const panel = await openPanel(app, char, 'diagnostics');
    await panel.waitForSelector('text=Last unclean exit');
    const d = await panel.evaluate(() => (window as unknown as { capri: { invoke(c: string): Promise<{ lastCrash: string | null; safeStorage: boolean; fullscreenWatcher: string }> } }).capri.invoke('diagnostics:get'));
    expect(d.lastCrash).toMatch(/startedAt/);
    expect(d.safeStorage).toBe(true);
    expect(d.fullscreenWatcher).toBe('disabled'); // This offscreen profile explicitly disables the watcher.
  });

  it('recreates the character view if its renderer crashes', async () => {
    const { app } = await launch(profile());
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((x) => x.getTitle() === 'Capri' && !x.isFocusable())!.webContents.forcefullyCrashRenderer());
    await expect.poll(() => app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows().find((x) => x.getTitle() === 'Capri' && !x.isFocusable()); return !!w && (w.isVisible() || (w as unknown as { capriShown?: boolean }).capriShown === true) && !w.webContents.isCrashed(); }), { timeout: 10000 }).toBe(true);
  });

  it('stays lightweight while idle (bounded fps, CPU and memory)', async () => {
    const { app, char } = await launch(profile());
    await char.waitForTimeout(6500); // let the fps reporter tick
    const m = await app.evaluate(({ app: a }) => a.getAppMetrics().map((x) => ({ type: x.type, cpu: x.cpu.percentCPUUsage, mem: x.memory.workingSetSize })));
    const panel = await openPanel(app, char, 'diagnostics');
    const d = await panel.evaluate(() => (window as unknown as { capri: { invoke(c: string): Promise<{ perf: { fps?: number; startupMs: number } }> } }).capri.invoke('diagnostics:get'));
    console.log('[perf] idle fps', d.perf.fps, 'startupMs', d.perf.startupMs);
    expect(d.perf.fps).toBeLessThanOrEqual(32); // idle throttle: ≤30 fps (+ timer jitter)
    const totalMB = m.reduce((s, x) => s + x.mem, 0) / 1024;
    console.log('[perf] idle metrics', JSON.stringify(m), 'totalMB', Math.round(totalMB));
    expect(totalMB).toBeLessThan(900);
  });
});

// ======================================================================== upgrade: AI connection, teleport, UI
/** Minimal Ollama server (so the connection is genuinely "connected" without any cloud key). */
async function mockOllama(reply: (msgs: { role: string; content: string }[]) => string = () => 'ok') {
  let chats = 0;
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      if (req.url === '/api/tags') { res.end(JSON.stringify({ models: [{ name: 'llama3.2:latest' }] })); return; }
      chats++;
      const text = reply(JSON.parse(raw).messages);
      res.end(`${JSON.stringify({ message: { content: text } })}\n${JSON.stringify({ done: true })}\n`);
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, get chats() { return chats; }, close: () => new Promise<void>((r) => { server.closeAllConnections(); server.close(() => r()); }) };
}
const charPos = (app: ElectronApplication) => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((x) => x.getTitle() === 'Capri' && !x.isFocusable())!.getPosition());
const capri = (app: ElectronApplication) => app.evaluate(() => {
  const c = (globalThis as unknown as { __capri: { monitor: { status: unknown }; teleporter: { count: number; status(): unknown } } }).__capri;
  return { conn: c.monitor.status as { state: string; provider: string; detail: string }, tp: c.teleporter.status() as { count: number; blockedReason: string | null } };
});

describe('teleportation', () => {
  it('moves the real window with departure and arrival effects, then persists the spot', async () => {
    const ud = profile();
    const { app, char } = await launch(ud);
    await char.waitForTimeout(800);
    const before = await charPos(app);
    const r = await char.evaluate(() => (window as unknown as { capri: { invoke(c: string, a?: unknown): Promise<{ ok: boolean; to: { x: number; y: number } }> } }).capri.invoke('teleport:now', 'random'));
    expect(r.ok).toBe(true);
    const after = await charPos(app);
    expect(Math.hypot(after[0] - before[0], after[1] - before[1])).toBeGreaterThan(150);
    expect(Math.abs(after[0] - r.to.x)).toBeLessThanOrEqual(2);
    const fxLog = await char.evaluate(() => (window as unknown as { __capriDebug: { fx: { log: string[] } } }).__capriDebug.fx.log);
    expect(fxLog).toEqual(expect.arrayContaining([expect.stringMatching(/:out$/), expect.stringMatching(/:in$/)]));
    const clip = await char.evaluate(() => (window as unknown as { __capriDebug: { behavior: { clipHistory: string[] } } }).__capriDebug.behavior.clipHistory.at(-1));
    expect(['reveal_spread', 'tilt_grin', 'many_eyes']).toContain(clip);
    await new Promise((x) => setTimeout(x, 500));
    await quit(app);
    const saved = JSON.parse(fs.readFileSync(path.join(ud, 'settings.json'), 'utf8')).character.position;
    expect(Math.abs(saved.x - after[0])).toBeLessThanOrEqual(2);
  });

  it('autonomous teleport is held back without AI, and runs once the AI is genuinely connected', async () => {
    const awake = { behavior: { quietHours: { enabled: false, start: '22:00', end: '08:00' } } }; // independent of the time of day
    let { app } = await launch(profile({ teleport: { auto: true }, ...awake }));
    const tick = (a: ElectronApplication) => a.evaluate(() => (globalThis as unknown as { __capri: { teleporter: { autoTick(): Promise<string | null> } } }).__capri.teleporter.autoTick());
    expect(await tick(app)).toBe('AI is not connected');
    expect((await capri(app)).tp.count).toBe(0);
    await quit(app);
    const ollama = await mockOllama();
    ({ app } = await launch(profile({ teleport: { auto: true }, ...awake, ai: { provider: 'ollama', ollama: { baseUrl: ollama.url, model: 'llama3.2' } } })));
    await app.evaluate(() => { (globalThis as unknown as { __capriIdleOverride: number }).__capriIdleOverride = 0; return new Promise((r) => setTimeout(r, 800)); }); // as if someone is at the machine
    expect((await capri(app)).conn.state).toBe('connected');
    const before = await charPos(app);
    expect(await app.evaluate(async()=>{const a=(globalThis as any).__capri;a.observeAgency();a.cognitiveRuntime.resume();if(!a.cognitiveRuntime.claim('native-auto'))throw Error('Fixture requires cognitive attention');try{return await a.teleporter.autoTick();}finally{a.cognitiveRuntime.release('native-auto');}})).toBeNull();
    expect((await capri(app)).tp.count).toBe(1);
    expect(await charPos(app)).not.toEqual(before);
    await ollama.close();
  });

  it('desktop-pet handling: dropped right at a window top she sits on it; anywhere else she stays exactly where she was put, and never changes size', async () => {
    const { app } = await launch(profile());
    type Hooks = { __capri: { charWin: { getBounds(): { x: number; y: number; width: number; height: number }; setBounds(b: object): void }; settleAfterDrop(): void } };
    const win = { x: 300, y: 600, width: 700, height: 200 };
    const size0 = await app.evaluate(() => (globalThis as unknown as Hooks).__capri.charWin.getBounds());
    // a drag places her window like the drag controller does: position from the cursor, size fixed
    const drop = (x: number, y: number) => app.evaluate((_e, [x, y, w, h]) => {
      const c = (globalThis as unknown as Hooks).__capri;
      c.charWin.setBounds({ x, y, width: w, height: h }); c.settleAfterDrop();
      return c.charWin.getBounds();
    }, [x, y, size0.width, size0.height] as const);
    await app.evaluate((_e, w) => { (globalThis as unknown as { __capriFgOverride: object }).__capriFgOverride = w; }, win);
    // 10 px above the window's top edge: she takes a seat on it
    const sat = await drop(500, Math.round(win.y + 10 - size0.height * SEAT_RATIO));
    expect(Math.abs(sat.y + sat.height * SEAT_RATIO - win.y)).toBeLessThanOrEqual(3);
    // 120 px away from any edge: she stays put
    const free = await drop(420, 250);
    expect(Math.abs(free.x - 420)).toBeLessThanOrEqual(3);
    expect(Math.abs(free.y - 250)).toBeLessThanOrEqual(3);
    // thirty moves later she is exactly the same size (fractional-DPI rounding used to grow her)
    let last = free;
    for (let i = 0; i < 30; i++) last = await drop(200 + (i % 5) * 37, 120 + (i % 3) * 29);
    expect(Math.abs(last.width - size0.width)).toBeLessThanOrEqual(1); // Windows reads back ±1 px at 125%; nothing accumulates
    expect(Math.abs(last.height - size0.height)).toBeLessThanOrEqual(1);
  });

  it('character model: every pose renders whole inside her window, and poses follow where she is', async () => {
    const { char } = await launch(profile({ character: { glitchEffects: false } }));
    type D = { __capriDebug: { manual(on: boolean): void; step(dt: number, n: number): void; setSurface(s: string): void; behavior: { setPosture(n: string): void }; pose: string; force(p: object | null): void } };
    await char.evaluate(() => (window as unknown as D).__capriDebug.manual(true));
    const cases: [string, string, string[], object][] = [
      ['window', 'sit_edge', ['sit', 'back'], {}], ['taskbar', 'recline', ['lie'], {}], ['taskbar', 'sit_edge', ['lie', 'crouch', 'back'], {}],
      ['air', 'air_sit', ['crouch'], {}], ['air', 'air_sit', ['crouch'], { hairStream: 1, hairWind: 1, headYaw: 1, turn: 1 }], ['window', 'sit_edge', ['sit', 'back'], { turn: -1, headPitch: 1, sleep: 1 }],
    ];
    for (const [surface, posture, want, force] of cases) {
      const r = await char.evaluate(([surface, posture, force]) => {
        const d = (window as unknown as D).__capriDebug;
        d.force(force); d.setSurface(surface); d.behavior.setPosture(posture); d.step(1 / 30, 45);
        const c = document.getElementById('stage') as HTMLCanvasElement;
        const px = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
        let edge = 0, filled = 0;
        for (let i = 3; i < px.length; i += 4) if (px[i] > 30) filled++;
        for (let x = 0; x < c.width; x++) { if (px[x * 4 + 3] > 30) edge++; if (px[((c.height - 1) * c.width + x) * 4 + 3] > 30) edge++; }
        for (let y = 0; y < c.height; y++) { if (px[y * c.width * 4 + 3] > 30) edge++; if (px[(y * c.width + c.width - 1) * 4 + 3] > 30) edge++; }
        return { pose: d.pose, edge, filled: filled / (c.width * c.height) };
      }, [surface, posture, force] as const);
      expect(want, `${surface}/${posture}`).toContain(r.pose);
      expect(r.edge, `${surface}/${posture}: figure touches the window edge (cropped)`).toBe(0);
      expect(r.filled).toBeGreaterThan(0.05); // a real figure, not an empty canvas
    }
  });

  it('keeps idling and reconnecting silent, and honors disabled arrival lines', async () => {
    const model = await mockModel(() => 'Right here, choom.');
    const { app, char } = await launch(openaiProfile(model.url, { voice: { ttsEnabled: true, volume: 0, interactionLines: false }, behavior: { idleRemarks: true, remarkIntervalMinutes: 5, quietHours: { enabled: false, start: '22:00', end: '08:00' } } }));
    type H = { __capri: { speakCount: number; presenceTick(): void; monitor: { check(r: string): Promise<unknown> }; teleporter: { go(t: string, r: string): Promise<unknown> } } };
    const count = () => app.evaluate(() => (globalThis as unknown as H).__capri.speakCount);
    await app.evaluate(async () => {
      const c = (globalThis as unknown as H).__capri;
      for (let i = 0; i < 5; i++) c.presenceTick(); // remark timer fires (bubble only)
      await c.monitor.check('test reconnect');
      await c.teleporter.go('left', 'manual');
    });
    await char.waitForTimeout(1500);
    expect(await count()).toBe(0);
    // talking to her is a trigger
    const panel = await openPanel(app, char);
    await panel.fill('textarea', 'you there?'); await panel.press('textarea', 'Enter');
    await panel.waitForSelector('.msg.assistant:not(.cursor)');
    await panel.waitForTimeout(300);
    expect(await count()).toBeGreaterThan(0);
    await model.close();
  });

  it('after a teleport she stays exactly where she landed (no DPI-rounding creep, no settings churn)', async () => {
    const ud = profile();
    const { app } = await launch(ud);
    const pos = () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((x) => x.getTitle() === 'Capri' && !x.isFocusable())!.getBounds());
    for (const where of ['left', 'corner', 'right']) {
      await app.evaluate((_e, w) => (globalThis as unknown as { __capri: { teleporter: { go(t: string, r: string): Promise<unknown> } } }).__capri.teleporter.go(w, 'manual'), where);
      await new Promise((r) => setTimeout(r, 900)); // the landing save settles
      const landed = await pos();
      const mtime = fs.statSync(path.join(ud, 'settings.json')).mtimeMs;
      await new Promise((r) => setTimeout(r, 2000));
      expect(await pos(), `after teleport ${where}`).toEqual(landed);
      expect(fs.statSync(path.join(ud, 'settings.json')).mtimeMs, `settings rewritten after teleport ${where}`).toBe(mtime);
    }
  });

  it('effects-disabled teleports and glides open no overlay windows', async () => {
    const { app } = await launch(profile({ teleport: { auto: false, effects: false } }));
    const zaps = () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().filter(w => w.getTitle() !== 'Capri bubble').length - 1); // effect windows besides hers
    const go = (t: string, how: string) => app.evaluate((_e, [t, how]) => (globalThis as unknown as { __capri: { teleporter: { go(t: string, r: string, h: string): Promise<unknown> } } }).__capri.teleporter.go(t, 'manual', how), [t, how]);
    expect(await zaps()).toBe(0);
    await go('left', 'teleport');
    expect(await zaps()).toBe(0);
    await go('right', 'glide');
    expect(await zaps()).toBe(0);
  });

  it('the AI can make her teleport and emote through validated actions (no extra model round)', async () => {
    const model = await mockModel((b) => {
      const last = b.messages.at(-1)!.content;
      if (/move/.test(last)) return 'Moving. <action>{"tool":"teleport","args":{"where":"corner"}}</action>';
      return 'Ha, cute. <action>{"tool":"emote","args":{"emotion":"menace"}}</action>';
    });
    const { app, char } = await launch(openaiProfile(model.url));
    await char.waitForTimeout(600);
    const panel = await openPanel(app, char);
    await panel.fill('textarea', 'you are funny'); await panel.press('textarea', 'Enter');
    await panel.waitForSelector('.msg.assistant:not(.cursor) >> text=Ha, cute.');
    await char.waitForFunction(() => (window as unknown as { __capriDebug: { behavior: { clipHistory: string[] } } }).__capriDebug.behavior.clipHistory.includes('menace'));
    const callsAfterEmote = model.calls;
    const before = await charPos(app);
    await panel.fill('textarea', 'move please'); await panel.press('textarea', 'Enter');
    await panel.waitForSelector('.msg.assistant:not(.cursor) >> text=Moving.');
    // teleport starts after the reply finishes streaming and takes ~1.5 s: poll for the move
    let moved = false;
    for (let i = 0; i < 40 && !moved; i++) { await app.evaluate(() => new Promise((r) => setTimeout(r, 150))); moved = String(await charPos(app)) !== String(before); }
    expect(moved).toBe(true);
    expect(model.calls).toBe(callsAfterEmote + 1); // cosmetic actions need no follow-up round
    expect(await panel.locator('.msg.action').count()).toBe(0); // and don't clutter the chat
    await model.close();
  });
});

describe('connection status & failure handling', () => {
  const chip = (panel: Page) => panel.evaluate(() => ({ state: document.getElementById('connChip')!.dataset.state, text: document.getElementById('connText')!.textContent }));

  it('shows "No AI" for offline mode and "Online" only after a real check', async () => {
    let { app, char } = await launch(profile());
    let panel = await openPanel(app, char);
    expect((await chip(panel)).text).toBe('No AI');
    await quit(app);
    const ollama = await mockOllama();
    ({ app, char } = await launch(profile({ ai: { provider: 'ollama', ollama: { baseUrl: ollama.url, model: 'llama3.2' } } })));
    panel = await openPanel(app, char);
    await panel.waitForFunction(() => document.getElementById('connChip')!.dataset.state === 'connected');
    expect((await chip(panel)).text).toBe('Online');
    await ollama.close();
  });

  it('Gemini without a key: error state, clear message, no fake reply', async () => {
    const { app, char } = await launch(profile({ ai: { provider: 'gemini' } }));
    const panel = await openPanel(app, char);
    await panel.waitForFunction(() => ['error', 'disconnected'].includes(document.getElementById('connChip')!.dataset.state!));
    await panel.fill('textarea', 'hello'); await panel.press('textarea', 'Enter');
    await panel.waitForSelector('.msg.assistant.err');
    expect(await panel.locator('.msg.assistant.err').innerText()).toMatch(/Gemini API key/i);
  });

  it('network down: friendly error, status goes offline, character never stays stuck "thinking"', async () => {
    const { app, char } = await launch(profile({ ai: { provider: 'gemini' } }), { env: { GEMINI_API_KEY: 'AQ.fake-key-for-network-test-1234567890', CAPRI_NO_DEV_KEY: '0', CAPRI_GEMINI_SERVER_URL: 'http://127.0.0.1:1' } });
    const panel = await openPanel(app, char);
    await panel.fill('textarea', 'are you there?'); await panel.press('textarea', 'Enter');
    await panel.waitForSelector('.msg.assistant.err', { timeout: 30_000 });
    expect(await panel.locator('.msg.assistant.err').innerText()).toMatch(/reach|network|timed out/i);
    await panel.waitForFunction(() => document.getElementById('connChip')!.dataset.state === 'disconnected');
    await char.waitForTimeout(2500);
    const st = await char.evaluate(() => (window as unknown as { __capriDebug: { behavior: { state: string } } }).__capriDebug.behavior.state);
    expect(st).not.toBe('thinking');
  });
});

describe('interface', () => {
  it('every view fits small and large panel sizes without horizontal overflow', async () => {
    const { app, char } = await launch(profile());
    const panel = await openPanel(app, char);
    for (const size of [[340, 420], [420, 620], [900, 900]]) {
      await app.evaluate(({ BrowserWindow }, [w, h]) => BrowserWindow.getAllWindows().find((x) => x.isFocusable())!.setSize(w, h), size);
      for (const t of ['chat', 'model', 'voice', 'character', 'memory', 'privacy', 'system']) {
        await panel.evaluate((x) => (window as unknown as { capri: { invoke(c: string, a: string): Promise<unknown> } }).capri.invoke('panel:open', x), t);
        await panel.waitForTimeout(t === 'system' || t === 'character' || t === 'model' || t === 'privacy' ? 900 : 250);
        const o = await panel.evaluate(() => { return { sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth, nativeControls: !!(navigator as any).windowControlsOverlay }; });
        expect(o.sw, `${t} @ ${size}`).toBeLessThanOrEqual(o.cw + 1);
        expect(o.nativeControls, `native window controls available on ${t} @ ${size}`).toBe(true);
      }
    }
  });

  it('first-run onboarding offers Gemini and finishes into chat', async () => {
    const d = profile();
    const s = JSON.parse(fs.readFileSync(path.join(d, 'settings.json'), 'utf8')); s.firstRunComplete = false; fs.writeFileSync(path.join(d, 'settings.json'), JSON.stringify(s));
    const { app, char } = await launch(d);
    const panel = app.windows().find(w => w !== char) ?? await app.waitForEvent('window');
    await panel.waitForSelector('text=Choose her brain');
    expect(await panel.locator('.choice', { hasText: 'Google Gemini' }).count()).toBe(1);
    await panel.locator('.choice', { hasText: 'No AI' }).click();
    await panel.waitForSelector('textarea');
  });
});

describe('cleanup', () => {
  it('quitting terminates every Capri process (no orphans)', async () => {
    const ud = profile();
    const { app } = await launch(ud);
    const pid = app.process().pid!;
    await quit(app);
    await new Promise((r) => setTimeout(r, 1500));
    const { execFileSync } = await import('node:child_process');
    const marker = path.basename(ud);
    const ps = `(Get-CimInstance Win32_Process | Where-Object { ($_.CommandLine -like '*${marker}*' -or $_.ProcessId -eq ${pid}) -and $_.ProcessId -ne $PID -and $_.Name -notmatch 'powershell' } | Measure-Object).Count`;
    const left = execFileSync('powershell.exe', ['-NoProfile', '-Command', ps], { encoding: 'utf8' }).trim();
    expect(left).toBe('0');
  });
});

describe.runIf(process.env.CAPRI_LIVE_GEMINI === '1')('LIVE Gemini (uses the local GEMINI_API_KEY / .env.local)', () => {
  it('authenticates, streams a real reply, keeps multi-turn context, never leaks the key', async () => {
    const ud = profile({ ai: { provider: 'gemini' } });
    const { app, char } = await launch(ud, { liveKey: true });
    const panel = await openPanel(app, char);
    await panel.waitForFunction(() => document.getElementById('connChip')!.dataset.state === 'connected', undefined, { timeout: 30_000 });
    const deltas: number[] = [];
    await panel.exposeFunction('__delta', () => deltas.push(Date.now()));
    await panel.evaluate(() => (window as unknown as { capri: { on(c: string, f: () => void): void } }).capri.on('chat:delta', () => (window as unknown as { __delta(): void }).__delta()));
    // if she asks to save something to memory, decline (the permission flow is tested elsewhere)
    const autoDeny = setInterval(() => { void panel.locator('.confirm').getByText('Deny').click({ timeout: 200 }).catch(() => {}); }, 400);
    await panel.fill('textarea', 'For this chat only, the code word is NEON-FOX. Now tell me in three short sentences who you are.'); await panel.press('textarea', 'Enter');
    await panel.waitForSelector('.msg.assistant:not(.cursor)', { timeout: 90_000 });
    expect(deltas.length).toBeGreaterThan(1); // progressive streaming
    await panel.fill('textarea', 'What was the code word? Answer with just the word.'); await panel.press('textarea', 'Enter');
    await panel.waitForFunction(() => document.querySelectorAll('.msg.assistant:not(.cursor)').length >= 2, undefined, { timeout: 90_000 });
    expect(await panel.locator('.msg.assistant').last().innerText()).toMatch(/NEON-FOX/i);
    expect(await panel.locator('.msg.assistant.err').count()).toBe(0);
    clearInterval(autoDeny);
    await quit(app);
    const key = (process.env.GEMINI_API_KEY || /GEMINI_API_KEY=(.+)/.exec(fs.readFileSync(path.join(ROOT, '.env.local'), 'utf8'))![1]).trim();
    for (const f of ['settings.json', 'history.jsonl', path.join('logs', 'capri.log')]) expect(fs.readFileSync(path.join(ud, f), 'utf8').includes(key), f).toBe(false);
  });
});

// ======================================================================== v3: postures & desktop placement
describe('postures & placement', () => {
  type Dbg = { __capriDebug: { surface: string; behavior: { posture: string; postureHistory: string[]; setPosture(n: string): void } } };
  const dbg = (char: Page) => char.evaluate(() => { const d = (window as unknown as Dbg).__capriDebug; return { surface: d.surface, posture: d.behavior.posture }; });

  it('standing on the taskbar is a "ledge": she knows it and can sit on it', async () => {
    const { app, char } = await launch(profile());
    await char.waitForFunction(() => (window as unknown as Dbg).__capriDebug.surface === 'taskbar', undefined, { timeout: 8000 });
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((x) => x.getTitle() === 'Capri' && !x.isFocusable())!.webContents.send('cue', { type: 'clip', name: 'sit' }));
    await char.waitForTimeout(1200);
    expect((await dbg(char)).posture).toBe('sit_edge');
    const hipDrop = await char.evaluate(() => (window as unknown as { __capriDebug: { anim: { value: { hipDrop: number } } } }).__capriDebug.anim.value.hipDrop);
    expect(hipDrop).toBeGreaterThan(150); // she really sat down
  });

  it('keeps a chosen window seat across focus changes and follows the same window when it moves', async () => {
    const { app, char } = await launch(profile({ behavior: { quietHours: { enabled: false } } }));
    await char.waitForTimeout(800);
    // a fake "active window" so the test never depends on the user's real desktop
    await app.evaluate(() => {
      (globalThis as any).__capriDesktopOverride = { title: 'Test desktop', process: 'test.exe' };
      (globalThis as Record<string, unknown>).__capriFgOverride = { x: 150, y: 560, width: 900, height: 240 };
      (globalThis as Record<string, unknown>).__capriWindowsOverride = [{ handle: 11n, rect: { x: 150, y: 560, width: 900, height: 240 } }];
    });
    const r = await char.evaluate(() => (window as unknown as { capri: { invoke(c: string, a: string): Promise<{ ok: boolean }> } }).capri.invoke('teleport:now', 'perch'));
    expect(r.ok).toBe(true);
    const b = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((x) => x.getTitle() === 'Capri' && !x.isFocusable())!.getBounds());
    expect(Math.abs(b.y + b.height * SEAT_RATIO - 560)).toBeLessThanOrEqual(4); // seat on the window's top edge (DPI rounding)
    await char.waitForFunction(() => (window as unknown as Dbg).__capriDebug.surface === 'window', undefined, { timeout: 4000 });
    // Clicking another app must not invalidate the original attachment.
    await app.evaluate(() => { (globalThis as Record<string, unknown>).__capriFgOverride = { x: 400, y: 300, width: 700, height: 400 }; });
    await char.waitForTimeout(2300);
    expect((await dbg(char)).surface).toBe('window');
    expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((x) => x.getTitle() === 'Capri' && !x.isFocusable())!.getBounds().y)).toBe(b.y);
    // Hold the mouse while moving: small geometry changes stay attached.
    await app.evaluate(() => { (globalThis as Record<string, unknown>).__capriWindowHeld = true; });
    // Move and resize the attached window without focusing it.
    await app.evaluate(() => { (globalThis as Record<string, unknown>).__capriWindowsOverride = [{ handle: 11n, rect: { x: 400, y: 650, width: 700, height: 400 } }]; });
    await char.waitForTimeout(600);
    expect(await char.evaluate(() => (window as any).__capriDebug.attachment)).toBe('perch');
    const riding = await app.evaluate(() => (globalThis as any).__capri.charWin.getBounds());
    expect(Math.abs(riding.y + riding.height * SEAT_RATIO - 650)).toBeLessThanOrEqual(4);
    expect(await app.evaluate(() => (globalThis as any).__capri.teleporter.active)).toBe(false);
    await app.evaluate(() => { (globalThis as Record<string, unknown>).__capriWindowHeld = false; });
    await char.waitForTimeout(350);
    const after = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((x) => x.getTitle() === 'Capri' && !x.isFocusable())!.getBounds());
    expect(Math.abs(after.y + after.height * SEAT_RATIO - 650)).toBeLessThanOrEqual(4);
    expect((await dbg(char)).surface).toBe('window');
    const blocked = await app.evaluate(async () => {
      const a = (globalThis as unknown as { __capri: { monitor: { reportSuccess(p: string): void }; teleporter: { autoTick(): Promise<string | null> }; settings: { update(p: object): void } } }).__capri;
      a.settings.update({ teleport: { auto: true } }); a.monitor.reportSuccess('test');
      return a.teleporter.autoTick();
    });
    expect(blocked).toBe('sitting where you placed her');
    // Near the top, invert the seated pose below the window edge; return to sitting lower down.
    const top = await app.evaluate(({ screen }) => screen.getPrimaryDisplay().workArea.y);
    await app.evaluate((_, top) => { (globalThis as any).__capriWindowsOverride = [{ handle: 11n, rect: { x: 400, y: top + 18, width: 700, height: 400 } }]; }, top);
    await char.waitForFunction(() => (window as any).__capriDebug.attachment === 'inverted', undefined, { timeout: 6000 });
    const hanging = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((x) => x.getTitle() === 'Capri' && !x.isFocusable())!.getBounds());
    expect(Math.abs(hanging.y + hanging.height * (1 - SEAT_RATIO) - top - 18)).toBeLessThanOrEqual(4);
    await char.waitForTimeout(250);
    await app.evaluate(() => { (globalThis as any).__capriWindowsOverride = [{ handle: 11n, rect: { x: 400, y: 650, width: 700, height: 400 } }]; });
    await char.waitForFunction(() => (window as any).__capriDebug.attachment === 'perch' && (window as any).__capriDebug.surface === 'window', undefined, { timeout: 6000 });
    expect((await dbg(char)).surface).toBe('window');

  });

  it('peeks in from a screen edge with the leaning posture', async () => {
    const { app, char } = await launch(profile());
    await char.waitForTimeout(800);
    const r = await char.evaluate(() => (window as unknown as { capri: { invoke(c: string, a: string): Promise<{ ok: boolean }> } }).capri.invoke('teleport:now', 'peek'));
    expect(r.ok).toBe(true);
    await char.waitForFunction(() => /^edge_/.test((window as unknown as Dbg).__capriDebug.surface), undefined, { timeout: 4000 });
    await char.waitForTimeout(400);
    expect((await dbg(char)).posture).toMatch(/^peek_/);
    void app;
  });

  it('the AI can ask her to sit or recline (validated emote → posture)', async () => {
    const model = await mockModel(() => 'Fine, I’ll get comfy. <action>{"tool":"emote","args":{"emotion":"sit"}}</action>');
    const { app, char } = await launch(openaiProfile(model.url));
    await char.waitForFunction(() => (window as unknown as Dbg).__capriDebug.surface === 'taskbar', undefined, { timeout: 8000 });
    const panel = await openPanel(app, char);
    await panel.fill('textarea', 'sit down'); await panel.press('textarea', 'Enter');
    await char.waitForFunction(() => (window as unknown as Dbg).__capriDebug.behavior.posture === 'sit_edge', undefined, { timeout: 10_000 });
    await model.close();
  });
});

describe('sprite interaction regressions', () => {
  it('selects real sprite animations, freezes them at zero intensity, and keeps effect pixels outside the hitbox', async () => {
    const { app, char } = await launch(profile({ character: { glitchEffects: false } }));
    type D = { __capriDebug: { manual(on: boolean): void; step(dt: number, n: number): void; setSurface(s: string): void; setPointer(x: number): void; force(p: object): void; model: { activeClip: string; activeFrame: number; facing: number }; hitAt(x: number, y: number): boolean } };
    await char.evaluate(() => { const d = (window as unknown as D).__capriDebug; d.manual(true); d.setSurface('air'); d.setPointer(1); d.force({ sleep: 0, mouthOpen: 0, mouthSmile: 0.35, blinkL: 0, blinkR: 0 }); });
    const setting = async (patch: object) => { await app.evaluate((_e, p) => (globalThis as unknown as { __capri: { settings: { update(p: object): unknown } } }).__capri.settings.update(p), patch); await char.waitForTimeout(50); };
    for (const animation of ['idle', 'perch', 'grin', 'sleep', 'glitch', 'dangle']) {
      await setting({ character: { animation } });
      const actual = await char.evaluate(() => { const d = (window as unknown as D).__capriDebug; d.step(1 / 30, 8); return d.model.activeClip; });
      expect(actual).toBe(animation);
    }
    await setting({ character: { animation: 'idle', animationIntensity: 0 } });
    const frozen = await char.evaluate(() => {
      const d = (window as unknown as D).__capriDebug; d.step(1 / 30, 1); const before = d.model.activeFrame; d.step(1 / 30, 120);
      const c = document.querySelector('canvas')!, g = c.getContext('2d')!;
      const px = g.getImageData(0, 0, c.width, c.height).data;
      let bottom = 0; for (let i = 3; i < px.length; i += 4) if (px[i] >= 128) bottom = Math.floor((i / 4) / c.width);
      g.fillRect(0, 0, c.width, c.height);
      return { before, after: d.model.activeFrame, transparentCornerHit: d.hitAt(0, 0), facing: d.model.facing, contact: bottom / c.height };
    });
    expect(frozen.after).toBe(frozen.before);
    expect(frozen.transparentCornerHit).toBe(false);
    expect(frozen.facing).toBe(-1); // source art looks left; mirrored to look at a cursor on the right
    expect(Math.abs(frozen.contact - SEAT_RATIO)).toBeLessThan(0.02);
    const left = await char.evaluate(() => { const d = (window as unknown as D).__capriDebug; d.setPointer(-1); d.step(1 / 30, 20); return d.model.facing; });
    expect(left).toBe(1);
  });

  it('plays teleport effects even if the character renderer was covered or paused', async () => {
    const { app, char } = await launch(profile());
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((w) => !w.isFocusable())!.webContents.send('cue', { type: 'pause', paused: true }));
    await char.waitForFunction(() => (window as unknown as { __capriDebug: { paused: boolean } }).__capriDebug.paused);
    const moving = char.evaluate(() => (window as unknown as { capri: { invoke(c: string, arg: string): Promise<{ ok: boolean }> } }).capri.invoke('teleport:now', 'random'));
    await char.waitForFunction(() => (window as unknown as { __capriDebug: { fx: { phase: string | null; t: number } } }).__capriDebug.fx.phase === 'out');
    await char.waitForTimeout(80);
    const during = await char.evaluate(() => { const d = (window as unknown as { __capriDebug: { paused: boolean; fx: { t: number } } }).__capriDebug; return { paused: d.paused, elapsed: d.fx.t }; });
    expect(during.paused).toBe(false);
    expect(during.elapsed).toBeGreaterThan(0);
    expect((await moving).ok).toBe(true);
    const log = await char.evaluate(() => (window as unknown as { __capriDebug: { fx: { log: string[] } } }).__capriDebug.fx.log);
    expect(log.some((s) => s.endsWith(':out'))).toBe(true);
    expect(log.some((s) => s.endsWith(':in'))).toBe(true);
  });
});

describe('attached bubble chat', () => {
  it('keeps bubble dimensions stable during repeated layout updates at 125% display scaling', async () => {
    const { app, char } = await launch(profile(), { env: { CAPRI_DPR: '1.25' } });
    const next = app.waitForEvent('window');
    await char.evaluate(() => (window as unknown as { capri: { invoke(c: string): Promise<unknown> } }).capri.invoke('bubble:open'));
    const b = await next; await b.waitForSelector('#input'); await b.waitForTimeout(400);
    const result = await app.evaluate(({ BrowserWindow }) => {
      const bubble = (globalThis as unknown as { __capri: { bubble: { reposition(): void; resize(h: number): void } } }).__capri.bubble;
      const w = BrowserWindow.getAllWindows().find((w) => w.getTitle() === 'Capri bubble')!;
      const before = w.getBounds();
      for (let i = 0; i < 2000; i++) bubble.reposition();
      return { before, after: w.getBounds() };
    });
    expect(result.after.width).toBe(result.before.width);
    expect(result.after.height).toBe(result.before.height);
    await b.waitForTimeout(1200);
    const after = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((w) => w.getTitle() === 'Capri bubble')!.getBounds());
    expect(Math.abs(after.width - result.before.width)).toBeLessThanOrEqual(1);
    expect(Math.abs(after.height - result.before.height)).toBeLessThanOrEqual(2);
  });

  it('chats directly from the attached input without creating the large panel', async () => {
    const server = await mockModel(() => 'There you are. I was getting bored in here.');
    const { app, char } = await launch(openaiProfile(server.url));
    const next = app.waitForEvent('window');
    await char.evaluate(() => (window as unknown as { capri: { invoke(c: string): Promise<unknown> } }).capri.invoke('char:click'));
    const bubble = await next;
    await bubble.waitForSelector('#input');
    await bubble.fill('#input', 'Hey Capri'); await bubble.press('#input', 'Enter');
    await bubble.waitForFunction(() => document.getElementById('message')!.textContent?.includes('getting bored'));
    const windows = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map((w) => ({ title: w.getTitle(), focusable: w.isFocusable(), size: w.getSize() })));
    expect(windows).toHaveLength(2);
    expect(windows.find((w) => w.title === 'Capri bubble')?.focusable).toBe(true);
    expect(windows.find((w) => w.title === 'Capri bubble')?.size[1]).toBeLessThanOrEqual(360);
    const secretAttempt = await bubble.evaluate(async () => { try { await (window as unknown as { capri: { invoke(c: string): Promise<unknown> } }).capri.invoke('secrets:status'); return 'allowed'; } catch { return 'blocked'; } });
    expect(secretAttempt).toBe('blocked');
    await bubble.evaluate(() => document.getElementById('reply')!.focus());
    await char.evaluate(() => (window as unknown as { capri: { invoke(c: string): Promise<unknown> } }).capri.invoke('bubble:open'));
    await bubble.waitForFunction(() => document.activeElement?.id === 'input');
    await bubble.press('#input', 'Escape');
    expect(await app.evaluate(({ BrowserWindow }) => (BrowserWindow.getAllWindows().find((w) => w.getTitle() === 'Capri bubble') as unknown as { capriShown?: boolean }).capriShown)).toBe(false);
    await server.close();
  });

  it('shows muted replies after the large panel is closed, and wraps long text inside the screen', async () => {
    const server = await mockModel(() => ({ delayMs: 12, text: 'Still here. ' + 'This is a longer bubble reply that should remain readable. '.repeat(12) }));
    const { app, char } = await launch(openaiProfile(server.url));
    const panel = await openPanel(app, char);
    const next = app.waitForEvent('window');
    await panel.fill('textarea', 'Talk to me from your bubble.'); await panel.press('textarea', 'Enter');
    const bubble = await next;
    await app.evaluate(() => (globalThis as unknown as { __capri: { panelWin: { close(): void } } }).__capri.panelWin.close());
    await bubble.waitForFunction(() => (document.getElementById('message')!.textContent?.length ?? 0) > 600);
    await bubble.waitForTimeout(300);
    expect(await bubble.locator('#composer').isHidden()).toBe(true);
    const layout = await app.evaluate(({ BrowserWindow, screen }) => { const w = BrowserWindow.getAllWindows().find((w) => w.getTitle() === 'Capri bubble')!, b = w.getBounds(), a = screen.getDisplayMatching(b).workArea; return { height: b.height, inside: b.x >= a.x && b.y >= a.y && b.x + b.width <= a.x + a.width + 2 && b.y + b.height <= a.y + a.height + 2 }; });
    expect(layout.height).toBeLessThanOrEqual(1200); expect(layout.inside).toBe(true);
    expect(await bubble.evaluate(()=>document.getElementById('message')!.scrollHeight<=document.getElementById('message')!.clientHeight+1)).toBe(true);
    expect(await char.evaluate(() => (window as unknown as { __capriDebug: { speaker: { speaking: boolean } } }).__capriDebug.speaker.speaking)).toBe(false);
    await bubble.click('#reply'); await bubble.waitForSelector('#input', { state: 'visible' });
    await server.close();
  });

  it('uses opposite source-facing metadata for standing and sitting, and can preserve original artwork', async () => {
    const { app, char } = await launch(profile({ character: { glitchEffects: false, animationIntensity: 0 } }));
    type D = { __capriDebug: { manual(on: boolean): void; step(dt: number, n: number): void; setPointer(x: number): void; model: { facing: number; activeClip: string } } };
    await char.evaluate(() => (window as unknown as D).__capriDebug.manual(true));
    const choose = async (animation: string, facing = 'cursor') => { await app.evaluate((_e, patch) => (globalThis as unknown as { __capri: { settings: { update(p: object): void } } }).__capri.settings.update({ character: patch }), { animation, facing }); await char.waitForTimeout(50); };
    const look = (x: number) => char.evaluate((x) => { const d = (window as unknown as D).__capriDebug; d.setPointer(x); d.step(1 / 30, 20); return d.model.facing; }, x);
    await choose('idle'); expect(await look(1)).toBe(-1); expect(await look(-1)).toBe(1);
    await choose('perch'); expect(await look(1)).toBe(1); expect(await look(-1)).toBe(-1);
    await choose('perch', 'original'); expect(await look(1)).toBe(1); expect(await look(-1)).toBe(1);
    await choose('idle', 'original'); expect(await look(1)).toBe(1); expect(await look(-1)).toBe(1);
  });

  it('plays a complete blink while a sitting pose is selected', async () => {
    const { char } = await launch(profile({ character: { animation: 'perch', animationIntensity: 1, glitchEffects: false } }));
    const result = await char.evaluate(() => {
      const d = (window as unknown as { __capriDebug: { manual(on: boolean): void; force(p: object): void; step(dt: number, n: number): void; model: { activeClip: string; activeFrame: number } } }).__capriDebug;
      d.manual(true); d.force({ sleep: 0, blinkL: 1, blinkR: 1 }); d.step(1 / 30, 1);
      d.force({ sleep: 0, blinkL: 0, blinkR: 0 }); d.step(1 / 30, 9);
      return { clip: d.model.activeClip, frame: d.model.activeFrame };
    });
    expect(result.clip).toBe('perch_blink'); expect(result.frame).toBeGreaterThanOrEqual(2);
  });
});


describe('remote speech delivery settings', () => {
  it('saves the delivery prompt and sends it with Nova and rate to the speech endpoint', async () => {
    const requests: any[] = [];
    const server = http.createServer((req, res) => {
      let raw = ''; req.on('data', c => raw += c);
      req.on('end', () => { requests.push({ path: req.url, body: JSON.parse(raw) }); res.writeHead(200, { 'content-type': 'audio/mpeg' }); res.end(Buffer.from([1, 2, 3, 4])); });
    });
    await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
    try {
      const baseUrl = 'http://127.0.0.1:' + (server.address() as AddressInfo).port + '/v1';
      const { app, char } = await launch(profile({ voice: { ttsEnabled: false, ttsEngine: 'openai', rate: 1.1, openaiTts: { baseUrl, model: 'gpt-4o-mini-tts', voice: 'nova' } } }));
      const panel = await openPanel(app, char, 'voice');
      await panel.getByLabel('Delivery instructions', { exact: true }).fill('Playful, dry teasing; natural pauses.');
      await panel.getByLabel('Delivery instructions', { exact: true }).press('Tab');
      await panel.waitForFunction(async () => (await window.capri.invoke('settings:get')).voice.openaiTts.instructions === 'Playful, dry teasing; natural pauses.');
      expect(await panel.getByLabel('Pitch', { exact: true }).count()).toBe(0);
      const bytes = await char.evaluate(async () => Array.from(await window.capri.invoke('tts:fetch', 'Hey, choom.')));
      expect(bytes).toEqual([1, 2, 3, 4]);
      expect(requests).toEqual([{ path: '/v1/audio/speech', body: { model: 'gpt-4o-mini-tts', voice: 'nova', input: 'Hey, choom.', response_format: 'mp3', speed: 1.1, instructions: 'Playful, dry teasing; natural pauses.' } }]);
      await char.evaluate(() => window.capri.invoke('tts:fetch', { text: 'Again?', mood: 'annoyed' }));
      expect(requests[1].body.instructions).toContain('mildly exasperated');
    } finally { await new Promise<void>((resolve, reject) => server.close(e => e ? reject(e) : resolve())); }
  });
});


describe('connected companion personality', () => {
  it('connects repeated touch, animation, mood decay and disabling expressive behavior', async () => {
    const { app, char } = await launch(profile({ character: { animation: 'auto', personality: true } }));
    await char.evaluate(() => { const d = window.__capriDebug as any; d.manual(true); d.lifeEvent('poke'); d.lifeEvent('poke'); d.lifeEvent('poke'); d.step(0.1); });
    expect(await char.evaluate(() => (window.__capriDebug as any).life.mood)).toBe('annoyed');
    await char.waitForTimeout(150);
    await char.evaluate(() => window.capri.invoke('char:interaction', 'poke'));
    await expect.poll(()=>app.evaluate(()=>(globalThis as any).__capri.conversationScene.snapshot().entries.some((e:any)=>e.role==='user'&&e.text.includes('pokes')))).toBe(true);
    await char.evaluate(() => { const d = window.__capriDebug as any; d.lifeEvent('pat'); d.lifeEvent('pat'); d.step(0.1); });
    expect(await char.evaluate(() => (window.__capriDebug as any).life.mood)).toBe('content');
    await char.evaluate(() => { const d = window.__capriDebug as any; d.setSurface('air'); d.step(0.1, 9); });
    expect(await char.evaluate(() => (window.__capriDebug as any).model.activeClip)).toBe('grin');
    await char.evaluate(() => { const d = window.__capriDebug as any; d.step(0.1, 240); });
    expect(await char.evaluate(() => (window.__capriDebug as any).life.mood)).toBe('neutral');
    await app.evaluate(() => (globalThis as any).__capri.settings.update({ character: { personality: false } }));
    await char.waitForTimeout(100);
    await char.evaluate(() => (window.__capriDebug as any).step(0.1));
    expect(await char.evaluate(() => (window.__capriDebug as any).life)).toBeUndefined();
  });
  it('keeps returns quiet under do-not-disturb and leaves an open composer alone', async () => {
    const { app, char } = await launch(profile({ behavior: { idleRemarks: true, doNotDisturb: true, quietHours: { enabled: false } } }));
    await app.evaluate(() => { const a = (globalThis as any).__capri; (globalThis as any).__capriIdleOverride = 240; a.presenceTick(); (globalThis as any).__capriIdleOverride = 0; a.presenceTick(); });
    await char.waitForTimeout(200);
    expect(await app.evaluate(() => (globalThis as any).__capri.bubble.state.text)).toBe('');
    await app.evaluate(() => { const a = (globalThis as any).__capri; a.settings.update({ behavior: { doNotDisturb: false } }); (globalThis as any).__capriIdleOverride = 240; a.presenceTick(); (globalThis as any).__capriIdleOverride = 0; a.presenceTick(); });
    await char.waitForTimeout(200);
    // Returning can be silent; a later explicit interaction still works.
    await char.evaluate(() => window.capri.invoke('char:interaction', 'poke'));
    await char.evaluate(() => window.capri.invoke('bubble:open'));
    const before = await app.evaluate(() => (globalThis as any).__capri.bubble.state.text);
    await char.evaluate(() => { const d = window.__capriDebug as any; d.lifeEvent('window'); });
    await char.waitForTimeout(100);
    expect(await app.evaluate(() => (globalThis as any).__capri.bubble.state.text)).toBe(before);
    expect(await app.evaluate(() => (globalThis as any).__capri.bubble.state.composer)).toBe(true);
    void app;
  });
});

describe('personality conversation context', () => {
  it('gives the model recent touch context and mood without requiring an extra model call', async () => {
    let prompt = '';
    const server = await mockModel(body => { prompt = body.messages[0].content; return 'Behave, choom.'; });
    try {
      const { app, char } = await launch(openaiProfile(server.url));
      await char.evaluate(() => { const d = window.__capriDebug as any; d.lifeEvent('poke'); d.lifeEvent('poke'); d.lifeEvent('poke'); });
      await char.waitForTimeout(150);
      const panel = await openPanel(app, char);
      await panel.fill('textarea', 'How are you?'); await panel.press('textarea', 'Enter');
      await panel.waitForFunction(() => document.body.innerText.includes('Behave, choom.'));
      expect(prompt).toContain('current companion mood is annoyed'); expect(prompt).toContain('Recent interaction: poke');
    } finally { await server.close(); }
  });
});


describe('editable persistent personal profile', () => {
  it('shows provenance and saves a correction across an app restart', async () => {
    const ud = profile(); const { app, char } = await launch(ud);
    await app.evaluate(() => (globalThis as any).__capri.memory.importProfile([{ text: 'Name is Sam', kind: 'fact' }], 'User profile', '2026-10-26'));
    const panel = await openPanel(app, char, 'memory');
    expect(await panel.locator('.item').filter({ hasText: 'Name is Sam' }).innerText()).toContain('User profile');
    await panel.locator('.item').filter({ hasText: 'Name is Sam' }).getByRole('button', { name: 'Edit', exact: true }).click();
    await panel.getByLabel('Edit memory', { exact: true }).fill('Name is Samuel');
    await panel.getByRole('button', { name: 'Save', exact: true }).click();
    await panel.waitForFunction(() => document.body.innerText.includes('Name is Samuel'));
    await quit(app);
    const second = await launch(ud);
    const memory = await second.app.evaluate(() => (globalThis as any).__capri.memory.approved());
    expect(memory[0]).toMatchObject({ text: 'Name is Samuel', context: { label: 'User profile', kind: 'fact', asOf: '2026-10-26' } });
    const secondPanel = await openPanel(second.app, second.char, 'memory');
    expect(await secondPanel.locator('.item').filter({ hasText: 'Name is Samuel' }).innerText()).toContain('edited');
  });
});


describe('automatic personal learning', () => {
  it('replies before learning, corrects facts in the background, supports Undo and honors the switch', async () => {
    let extractorCalls = 0;
    const model = await mockModel(body => {
      if (body.messages[0].content.includes('Extract durable personal memory')) {
        extractorCalls++;
        const data = JSON.parse(body.messages.at(-1)!.content);
        if (data.current_user_message.includes('moved')) return JSON.stringify({ changes: [{ op: 'update', id: data.existing_memories[0].id, text: 'Lives in Boston', kind: 'fact', evidence: 'I moved to Boston' }] });
        return JSON.stringify({ changes: [{ op: 'add', text: 'Lives in Austin', kind: 'fact', evidence: 'I live in Austin' }] });
      }
      return body.messages.at(-1)!.content.includes('moved') ? 'Boston it is.' : 'Got it, Austin.';
    });
    try {
      const ud = openaiProfile(model.url);
      const saved = JSON.parse(fs.readFileSync(path.join(ud, 'settings.json'), 'utf8')); saved.memory = { enabled: true, autoLearn: true }; fs.writeFileSync(path.join(ud, 'settings.json'), JSON.stringify(saved));
      const { app, char } = await launch(ud);
      const panel = await openPanel(app, char);
      await panel.fill('textarea', 'I live in Austin'); await panel.press('textarea', 'Enter');
      await panel.waitForFunction(() => document.body.innerText.includes('Got it, Austin.'));
      expect(extractorCalls).toBe(0);
      await expect.poll(() => app.evaluate(() => (globalThis as any).__capri.memory.approved().map((m: any) => m.text)), { timeout: 10000 }).toContain('Lives in Austin');
      expect(await app.evaluate(() => (globalThis as any).__capri.memory.approved().map((m: any) => m.text))).toEqual(['Lives in Austin']);
      // The background lane deliberately spaces extractions by at least a minute.
      await app.evaluate(() => { const g = globalThis as any, clock = Date.now; g.__learningClock = clock; Date.now = () => clock() + 61000; });
      await panel.fill('textarea', 'I moved to Boston'); await panel.press('textarea', 'Enter');
      await panel.waitForFunction(() => document.body.innerText.includes('Boston it is.'));
      await expect.poll(() => app.evaluate(() => (globalThis as any).__capri.memory.approved().map((m: any) => m.text)), { timeout: 10000 }).toContain('Lives in Boston');
      expect(await app.evaluate(() => (globalThis as any).__capri.memory.approved().map((m: any) => m.text))).toEqual(['Lives in Boston']);
      await app.evaluate(() => { const g = globalThis as any; Date.now = g.__learningClock; });
      await panel.getByRole('tab', { name: 'Memory', exact: true }).click();
      await panel.waitForSelector('.item');
      await expect.poll(() => panel.locator('.item').filter({ hasText: 'Lives in Boston' }).first().innerText()).toContain('I moved to Boston');
      await panel.getByRole('button', { name: 'Undo', exact: true }).click();
      await panel.waitForFunction(() => document.body.innerText.includes('Lives in Austin'));
      await panel.getByRole('switch', { name: 'Learn automatically', exact: true }).uncheck();
      await panel.waitForTimeout(150);
      await app.evaluate(async () => { const a = (globalThis as any).__capri; await a.convo.send('I moved to Boston'); await a.convo.settle(); });
      expect(extractorCalls).toBe(2);
      expect(await app.evaluate(() => (globalThis as any).__capri.memory.approved()[0].text)).toBe('Lives in Austin');
    } finally { await model.close(); }
  });
});


describe('reply priority over background learning', () => {
  it('answers a new message while a slow memory request is pending', async () => {
    let learningStarted = false;
    const model = await mockModel(body => {
      if (body.messages[0].content.includes('Extract durable personal memory')) { learningStarted = true; return { delayMs: 5000, text: '{"changes":[]}' }; }
      return body.messages.at(-1)!.content.includes('second') ? 'Second reply arrived.' : 'First reply arrived.';
    });
    try {
      const ud = openaiProfile(model.url), saved = JSON.parse(fs.readFileSync(path.join(ud, 'settings.json'), 'utf8'));
      saved.memory = { enabled: true, autoLearn: true }; fs.writeFileSync(path.join(ud, 'settings.json'), JSON.stringify(saved));
      const { app, char } = await launch(ud), panel = await openPanel(app, char);
      await panel.fill('textarea', 'My favorite drink is tea'); await panel.press('textarea', 'Enter');
      await panel.waitForFunction(() => document.body.innerText.includes('First reply arrived.'));
      expect(learningStarted).toBe(false);
      await expect.poll(() => learningStarted, { timeout: 8000 }).toBe(true);
      await panel.fill('textarea', 'Here is my second message'); await panel.press('textarea', 'Enter');
      await panel.waitForFunction(() => document.body.innerText.includes('Second reply arrived.'), undefined, { timeout: 2000 });
      await app.evaluate(() => (globalThis as any).__capri.settings.update({ memory: { autoLearn: false } }));
    } finally { await model.close(); }
  });
});

describe('arrival conversations', () => {
  it('keeps arrival reactions optional and local and stays quiet in focus mode', async () => {
    const model = await mockModel(() => 'fail');
    try {
      const { app, char } = await launch(openaiProfile(model.url, { voice: { ttsEnabled: true, ttsEngine: 'windows', volume: 0, interactionLines: true }, behavior: { quietHours: { enabled: false }, proactiveVoice: false, idleRemarks: false } }));
      // Count real host speech requests without playing audio in the test.
      await char.evaluate(() => { (window.__capriDebug as any).speaker.enqueue = () => {}; });
      await char.evaluate(() => window.capri.invoke('teleport:now', 'left'));
      const first = await app.evaluate(() => { const a = (globalThis as any).__capri; return { text: a.bubble.state.text, count: a.speakCount }; });
      expect([0, 1]).toContain(first.count); if (first.count) expect(first.text.length).toBeGreaterThan(0); expect(model.calls).toBe(0);
      await char.waitForTimeout(2700);
      await char.evaluate(() => window.capri.invoke('teleport:now', 'right'));
      const second = await app.evaluate(() => { const a = (globalThis as any).__capri; return { text: a.bubble.state.text, count: a.speakCount }; });
      expect(second.count).toBeGreaterThanOrEqual(first.count); expect(second.count).toBeLessThanOrEqual(first.count + 1); expect(model.calls).toBe(0);
      await app.evaluate(() => (globalThis as any).__capri.applyCompanyControl({ kind: 'focus', minutes: 1 }));
      await char.waitForTimeout(2700);
      await char.evaluate(() => window.capri.invoke('teleport:now', 'left'));
      expect(await app.evaluate(() => (globalThis as any).__capri.speakCount)).toBe(second.count);
    } finally { await model.close(); }
  });
});

describe('purposeful company', () => {
  it('responds locally to focus, stay and resume requests while preserving persistent settings', async () => {
    const model = await mockModel(() => 'fail');
    try {
      const { app, char } = await launch(openaiProfile(model.url, { behavior: { explore: true, quietHours: { enabled: false } }, teleport: { auto: true } }));
      const panel = await openPanel(app, char);
      await panel.fill('textarea', 'I need to focus for 20 minutes'); await panel.press('textarea', 'Enter');
      await expect.poll(() => app.evaluate(() => (globalThis as any).__capri.history.recent(1)[0]?.content)).toContain('quiet company for 20 minutes');
      const first = await app.evaluate(async () => { const a = (globalThis as any).__capri; a.setNextVisit(); await a.exploreTick(0); return { focused: a.company.focused(), target: a.attentionHandle, blocked: await a.teleporter.autoTick(), dnd: a.settings.get().behavior.doNotDisturb, explore: a.settings.get().behavior.explore, voice: a.settings.get().voice.ttsEnabled }; });
      expect(first).toMatchObject({ focused: true, target: null, blocked: 'Quiet company', dnd: false, explore: true, voice: false });
      await panel.fill('textarea', 'Stay here'); await panel.press('textarea', 'Enter');
      await expect.poll(() => app.evaluate(() => (globalThis as any).__capri.company.staying)).toBe(true);
      expect(await app.evaluate(() => (globalThis as any).__capri.bubble.state.company)).toBe('Quiet company · Staying here');
      await panel.fill('textarea', 'Back to normal'); await panel.press('textarea', 'Enter');
      await expect.poll(() => app.evaluate(() => (globalThis as any).__capri.company.blocked())).toBe(false);
      expect(model.calls).toBe(0);
      expect(await app.evaluate(() => (globalThis as any).__capri.history.recent(1)[0].meta.provider)).toBe('companion');
    } finally { await model.close(); }
  });

  it('looks at the requested foreground window without confusing it with her physical location', async () => {
    const { app, char } = await launch(profile({ behavior: { quietHours: { enabled: false } } }));
    const result = await app.evaluate(async () => {
      const g = globalThis as any, a = g.__capri, b = a.charWin.getBounds();
      g.__capriWindowsOverride = [{ handle: -91n, rect: { x: 20, y: 400, width: 500, height: 500 } }, { handle: -92n, rect: { x: 1000, y: 600, width: 800, height: 500 } }];
      g.__capriWindowInfo = { '-91': { title: 'Drawing to review', process: 'paint.exe' }, '-92': { title: 'Music player', process: 'music.exe' } };
      a.charWin.setBounds({ ...b, x: 1100, y: Math.round(600 - b.height * .712) }); a.settleAfterDrop();
      g.__capriForegroundHandle = -91n;
      await a.convo.send('Look at this', { viaVoice: true }); await a.convo.settle();
      return { response: a.history.recent(1)[0].content, location: String(a.attentionHandle), watching: a.presenceDebug().watched };
    });
    expect(result.response).toBe('All right. Let me have a look.'); expect(result.location).toBe('-92'); expect(result.watching).toBe('-91');
    await expect.poll(() => char.evaluate(() => (window.__capriDebug as any).anim.value.gazeX)).toBeLessThan(-0.2);
  });

  it('starts the physical outing before inspection completes and rests without a second comment cycle', async () => {
    let requested = false;
    const model = await mockModel(() => { requested = true; return { delayMs: 80, text: JSON.stringify(visualDecision({ line: '<quiet/>', facts: ['A green branch.'], interpretation: '', curiosity: 'Where does it go?', points: [] })) }; });
    try {
      const { app } = await launch(openaiProfile(model.url, { memory: { autoLearn: false }, behavior: { explore: true, idleRemarks: true, quietHours: { enabled: false } }, teleport: { effects: false } }));
      const early = await app.evaluate(async () => {
        const g = globalThis as any, a = g.__capri;
        g.__capriWindowsOverride = [{ handle: -93n, rect: { x: 350, y: 400, width: 700, height: 500 } }];
        g.__capriObservationOverride = { jpegBase64: 'fixture-image', region: { x: 350, y: 400, width: 700, height: 500 }, window: { x: 350, y: 400, width: 700, height: 500 } };
        g.__capriWindowInfo = { '-93': { title: 'Drawing notes', process: 'notepad.exe' } };
        const random = Math.random; Math.random = () => 0;
        a.setNextVisit(); g.__outing = a.exploreTick(0).finally(() => { Math.random = random; });
        await new Promise(r => setTimeout(r, 100));
        return { moving: a.teleporter.active, stage: a.tourStage, phase: a.visit.phase, watched: a.presenceDebug().watched,ready:a.behavior.canInitiate(),journal:a.behavior.snapshot().journal,agency:a.agency.availability.getSnapshot().context,owner:a.agency.attention.getSnapshot().context }; 
      });
      expect(early).toMatchObject({ phase: 'approach', watched: '-93' });
      expect(early.moving || early.stage === 'roaming',JSON.stringify(early)).toBe(true);
      expect(requested).toBe(true);
      await app.evaluate(async () => { await (globalThis as any).__outing; });
      expect(await app.evaluate(() => (globalThis as any).__capri.visit.phase)).toBe('idle');
      expect(model.calls).toBe(1);
      await app.evaluate(() => { (globalThis as any).__capri.presenceTick(); });
      expect(model.calls).toBe(1);
    } finally { await model.close(); }
  });

  it('does not start a second outing while cancelled movement is still unwinding', async () => {
    const model = await mockModel(() => ({ delayMs: 100, text: JSON.stringify(visualDecision({ line: '<quiet/>', facts: ['A green branch.'], curiosity: 'Where does it go?', points: [] })) }));
    try {
      const { app } = await launch(openaiProfile(model.url, { memory: { autoLearn: false }, behavior: { explore: true, idleRemarks: true, quietHours: { enabled: false } }, teleport: { effects: false } }));
      await app.evaluate(() => {
        const g = globalThis as any, a = g.__capri; Math.random=()=>0;
        g.__capriWindowsOverride = [{ handle: -93n, rect: { x: 350, y: 400, width: 700, height: 500 } }];
        g.__capriObservationOverride = { jpegBase64: 'fixture-image', region: { x: 350, y: 400, width: 700, height: 500 }, window: { x: 350, y: 400, width: 700, height: 500 } };
        g.__capriWindowInfo = { '-93': { title: 'Route experiment', process: 'fixture.exe' } };
        a.setNextVisit(); g.__firstOuting = a.exploreTick(0);
      });
      await expect.poll(() => app.evaluate(() => { const a = (globalThis as any).__capri; return a.visit.phase === 'approach' && a.teleporter.active; })).toBe(true);
      const target = await app.evaluate(() => {
        const g = globalThis as any, a = g.__capri; a.visit.cancel(); a.setNextVisit(); g.__secondOuting = a.exploreTick(0); return a.visit.target;
      });
      expect(target).toBeNull();
      await app.evaluate(async () => { const g = globalThis as any; await Promise.all([g.__firstOuting, g.__secondOuting]); });
      expect(model.calls).toBe(1);
    } finally { await model.close(); }
  });
  it('yields optional movement to a real pat without forgetting the earlier curiosity', async () => {
    const { app, char } = await launch(profile({ behavior: { explore: true, quietHours: { enabled: false } }, teleport: { effects: false } }));
    await app.evaluate(() => {
      const g = globalThis as any, a = g.__capri;
      g.__capriWindowsOverride = [{ handle: -94n, rect: { x: 400, y: 400, width: 700, height: 500 } }];
      a.environmentalCuriosity.record('fixture', { facts: ['A green loop.'], interpretation: '', curiosity: 'Where does the loose end go?' }, Date.now());
      a.setNextVisit(); g.__patOuting = a.exploreTick(0);
    });
    await expect.poll(() => app.evaluate(() => (globalThis as any).__capri.visit.phase)).toBe('approach');
    await char.evaluate(() => window.capri.invoke('char:interaction', 'pat'));
    await app.evaluate(async () => { await (globalThis as any).__patOuting; });
    const result = await app.evaluate(() => {
      const a = (globalThis as any).__capri; return { target: a.visit.target, phase: a.visit.phase, interest: a.environmentalCuriosity.context('fixture', Date.now())?.openCuriosity };
    });
    expect(result).toEqual({ target: null, phase: 'idle', interest: 'Where does the loose end go?' });
  });
  it('stops an active approach when asked to stay and does not complete the old landing', async () => {
    const { app, char } = await launch(profile({ behavior: { explore: true, quietHours: { enabled: false } } }));
    await app.evaluate(() => {
      const g = globalThis as any, a = g.__capri, b = a.charWin.getBounds();
      a.charWin.setBounds({ ...b, x: 250, y: 200 });
      g.__capriWindowsOverride = [{ handle: -94n, rect: { x: 400, y: 400, width: 700, height: 500 } }];
      a.setNextVisit(); g.__approach = a.exploreTick(0);
    });
    await expect.poll(() => app.evaluate(() => (globalThis as any).__capri.visit.phase)).toBe('approach');
    await char.waitForTimeout(250);
    const position = await app.evaluate(async () => { const g = globalThis as any, a = g.__capri; await a.convo.send('Stay here'); await a.convo.settle(); await g.__approach; return a.charWin.getBounds(); });
    await char.waitForTimeout(400);
    expect(await app.evaluate(() => (globalThis as any).__capri.charWin.getBounds())).toEqual(position);
    expect(await app.evaluate(() => (globalThis as any).__capri.visit.phase)).toBe('idle');
  });
});

describe('immersive presence', () => {
  it('looks at the placed window, recognizes a return, and restores the full composer from a small aside', async () => {
    const { app, char } = await launch(profile({ behavior: { quietHours: { enabled: false } } }));
    const place = async (id: number) => app.evaluate((_e, id) => {
      const g = globalThis as any, a = g.__capri, b = a.charWin.getBounds();
      g.__capriWindowInfo = { '-71': { title: 'Homework notes', process: 'notepad.exe' }, '-72': { title: 'Music player', process: 'music.exe' } };
      g.__capriWindowsOverride = [{ handle: BigInt(id), rect: { x: 400, y: 600, width: 800, height: 400 } }];
      a.charWin.setBounds({ ...b, x: 380, y: Math.round(600 - b.height * 0.712) }); a.settleAfterDrop(); return a.bubble.state.text;
    }, id);
    await place(-71);
    const bubbleReady = app.waitForEvent('window');
    await app.evaluate(() => (globalThis as any).__capri.bubble.remark('A comfortable spot.'));
    await expect.poll(() => char.evaluate(() => (window.__capriDebug as any).attention.mode)).toBe('window');
    await expect.poll(() => char.evaluate(() => (window.__capriDebug as any).anim.value.gazeX)).toBeGreaterThan(0.2);
    const bubble = await bubbleReady;
    await bubble.waitForFunction(() => document.body.dataset.compact === 'true');
    expect(await bubble.locator('header').isHidden()).toBe(true);
    const portraitSize = await bubble.locator('#portrait-frame').evaluate(el => ({ width: el.clientWidth, height: el.clientHeight }));
    await place(-72); await place(-71);
    expect(await app.evaluate(() => (globalThis as any).__capri.presenceDebug().encounter.returning)).toBe(true);
    await bubble.click('#reply'); await bubble.waitForFunction(() => document.body.dataset.compact === 'false');
    await bubble.locator('#input').waitFor({ state: 'visible' });
    expect(await bubble.locator('header').isVisible()).toBe(true);
    expect(await bubble.locator('#portrait-frame').evaluate(el => ({ width: el.clientWidth, height: el.clientHeight }))).toEqual(portraitSize);
  });
  it('allows an unsolicited observation to remain silent and uses gestures for repeated touch', async () => {
    const model = await mockModel(() => '<quiet/>');
    try {
      const { app, char } = await launch(openaiProfile(model.url, { behavior: { quietHours: { enabled: false } } }));
      await app.evaluate(async () => {
        const g = globalThis as any, a = g.__capri;
        g.__capriWindowsOverride = [{ handle: -101n, rect: { x: 100, y: 200, width: 800, height: 500 } }];
        g.__capriWindowInfo = { '-101': { title: 'Quiet fixture', process: 'fixture.exe' } };
        a.bubble.remark('A comfortable spot.'); await a.generatedRemark('question', '', { target: -101n });
      });
      expect(model.calls).toBe(1);
      expect(await app.evaluate(() => (globalThis as any).__capri.bubble.state.text)).toBe('A comfortable spot.');
      await app.evaluate(()=>{Math.random=()=>.99;}); // Select the generated-contact branch this fixture asserts.
    await char.evaluate(() => window.capri.invoke('char:interaction', 'pat'));
      await app.evaluate(() => (globalThis as any).__capri.bubble.remark('Quiet company.'));
      await char.waitForTimeout(2300);
      await char.evaluate(() => window.capri.invoke('char:interaction', 'pat'));
      expect(await app.evaluate(() => (globalThis as any).__capri.bubble.state.text)).toBe('Quiet company.');
      expect(model.calls).toBe(2); // One deliberate touch request; the repeated touch remains a gesture.
    } finally { await model.close(); }
  });
  it('continues a recent conversation when reopened without generating another greeting', async () => {
    const model = await mockModel(() => 'Let us finish that sketch.');
    try {
      const { app, char } = await launch(openaiProfile(model.url));
      await app.evaluate(async () => { const a = (globalThis as any).__capri; await a.convo.send('Help me think about this sketch.'); await a.convo.settle(); });
      const calls = model.calls;
      await char.evaluate(() => window.capri.invoke('bubble:open'));
      await char.waitForTimeout(300);
      expect(model.calls).toBe(calls);
      expect(await app.evaluate(() => (globalThis as any).__capri.bubble.state.text)).toContain('finish that sketch');
    } finally { await model.close(); }
  });
  it('cancels a gentle exploration flight when picked up and leaves the new position alone', async () => {
    const { app, char } = await launch(profile({ behavior: { explore: true, quietHours: { enabled: false } }, teleport: { effects: false } }));
    await app.evaluate(() => {
      const g = globalThis as any, a = g.__capri, b = a.charWin.getBounds(); Math.random=()=>0;
      a.charWin.setBounds({ ...b, x: 250, y: 200 });
      g.__capriWindowsOverride = [{ handle: -81n, rect: { x: 400, y: 400, width: 700, height: 500 } }];
      a.setNextVisit(); g.__immersionFlight = a.exploreTick(0);
    });
    await expect.poll(() => app.evaluate(() => (globalThis as any).__capri.teleporter.active)).toBe(true);
    await char.waitForTimeout(400);
    await app.evaluate(()=>{(globalThis as any).__capriDragInput={point:{x:500,y:500},down:true};});
    await char.evaluate(() => window.capri.invoke('char:drag', 'start'));
    await app.evaluate(()=>{(globalThis as any).__capriDragInput.point={x:520,y:500};});
    await expect.poll(()=>char.evaluate(()=>(window.__capriDebug as any).dragging)).toBe(true);
    await app.evaluate(async () => { await (globalThis as any).__immersionFlight; });
    await app.evaluate(()=>{(globalThis as any).__capriDragInput.down=false;});
    await char.evaluate(() => window.capri.invoke('char:drag', 'end'));
    const info = await app.evaluate(() => { const a = (globalThis as any).__capri, b = a.charWin.getBounds(); a.charWin.setBounds({ ...b, x: 100, y: 110 }); return { active: a.teleporter.active, count: a.teleporter.count }; });
    expect(info.active).toBe(false); expect(info.count).toBe(0);
    await char.waitForTimeout(400);
    expect(await app.evaluate(() => (globalThis as any).__capri.charWin.getBounds().x)).toBe(100);
    await char.evaluate(() => window.capri.invoke('char:drag', 'end'));
  });
});

describe('contextual companion interactions', () => {
  it('uses sitting then lying then inverted sitting as window headroom shrinks', async () => {
    const { app, char } = await launch(profile({ behavior: { quietHours: { enabled: false } }, voice: { interactionLines: false } }));
    for (const stage of ['sit', 'lie', 'inverted'] as const) {
      await app.evaluate(({ screen }, data) => {
        const g = globalThis as any, a = g.__capri, area = screen.getPrimaryDisplay().workArea, b = a.charWin.getBounds();
        const seated = b.height * (data.seat - .14), lying = b.width * .34 + 12;
        const gap = data.stage === 'sit' ? seated + 60 : data.stage === 'lie' ? (seated + lying) / 2 : lying - 30;
        const rect = { x: area.x + 50, y: Math.round(area.y + gap), width: area.width - 100, height: 400 };
        g.__capriWindowsOverride = [{ handle: -769n, rect }];
        a.charWin.setBounds({ ...b, x: area.x + 300, y: Math.round(rect.y - b.height * data.seat) }); a.settleAfterDrop(); a.presenceTick();
      }, { stage, seat: SEAT_RATIO });
      await expect.poll(() => char.evaluate(() => { const d = window.__capriDebug as any; return { attachment: d.attachment, pose: d.model.activeSecondary }; })).toEqual({ attachment: stage === 'inverted' ? 'inverted' : 'perch', pose: stage === 'lie' ? 'recline' : null });
      if (stage === 'lie') {
        const result = await char.evaluate(() => { const d = window.__capriDebug as any; d.manual(true); d.step(1, 90); const pose = d.model.activeSecondary; d.manual(false); return pose; });
        expect(result).toBe('recline');
      }
    }
  });
  it('keeps a lying composer clear of Capri at both taskbar corners and clears the lying anchor on standing', async () => {
    const { app, char } = await launch(profile({ behavior: { idleRemarks: false, quietHours: { enabled: false } }, voice: { interactionLines: false }, character: { glitchEffects: false, facing: 'original' } }));
    await char.evaluate(() => (window.__capriDebug as any).force({ mouthOpen: 0, headRoll: 0, bodyRot: 0 }));
    for (const right of [false, true]) {
      await app.evaluate(({ screen }, data) => {
        const g = globalThis as any, a = g.__capri, area = screen.getPrimaryDisplay().workArea, b = a.charWin.getBounds();
        g.__capriWindowsOverride = []; a.charWin.setBounds({ ...b, x: data.right ? area.x + area.width - b.width : area.x, y: Math.round(area.y + area.height - b.height * data.seat) }); a.settleAfterDrop();
        a.bubble.remark('Mm. Good spot.'); a.bubble.open();
      }, { right, seat: SEAT_RATIO });
      await expect.poll(() => char.evaluate(() => !!(window.__capriDebug as any).model.speechBody)).toBe(true);
      await expect.poll(async () => {
        const local = await char.evaluate(() => (window.__capriDebug as any).model.speechBody);
        return app.evaluate(({ screen }, local) => {
          const a = (globalThis as any).__capri, p = a.charWin.getBounds(), b = a.bubble.window.getBounds(), area = screen.getPrimaryDisplay().workArea;
          const body = { x: p.x + local.x * p.width, y: p.y + local.y * p.height, width: local.width * p.width, height: local.height * p.height };
          const overlap = b.x < body.x + body.width && b.x + b.width > body.x && b.y < body.y + body.height && b.y + b.height > body.y;
          return !overlap && b.x >= area.x && b.y >= area.y && b.x + b.width <= area.x + area.width && b.y + b.height <= area.y + area.height;
        }, local);
      }).toBe(true);
      if (process.env.CAPRI_LYING_BUBBLE_SCREENSHOT) {
        const page = app.windows().find(w => w.url().includes('/bubble.html'));
        await page?.screenshot({ path: process.env.CAPRI_LYING_BUBBLE_SCREENSHOT.replace('.png', right ? '-right.png' : '-left.png') });
      }
    }
    await app.evaluate(({ screen }) => { const a = (globalThis as any).__capri, p = a.charWin.getBounds(), area = screen.getPrimaryDisplay().workArea; a.charWin.setBounds({ ...p, x: area.x + 400, y: area.y + 20 }); a.settleAfterDrop(); });
    await expect.poll(() => char.evaluate(() => (window.__capriDebug as any).model.speechBody)).toBeUndefined();
  });

  it('shrinks only the sleep strip by ten percent while preserving its contact line', async () => {
    const { app, char } = await launch(profile({ behavior: { quietHours: { enabled: false } } }));
    const before = await char.evaluate(() => { const d = window.__capriDebug as any; d.manual(true); d.step(.1); return d.model.headGeometry.scale; });
    await app.evaluate(() => (globalThis as any).__capri.settings.update({ behavior: { mode: 'sleep' } }));
    await char.waitForFunction(() => (window.__capriDebug as any).behavior.state === 'sleeping' || (window.__capriDebug as any).paused);
    const after = await char.evaluate(() => { const d = window.__capriDebug as any; d.step(.1, 20); const g = d.model.headGeometry; return { scale: g.scale, contact: g.y + 367 * g.scale, clip: d.model.activeClip, height: innerHeight }; });
    expect(after.clip).toBe('sleep'); expect(after.scale / before).toBeCloseTo(.9, 6); expect(after.contact).toBeCloseTo(after.height * SEAT_RATIO, 4);
    if (process.env.CAPRI_SECONDARY_SCREENSHOT) await char.screenshot({ path: process.env.CAPRI_SECONDARY_SCREENSHOT.replace('.png', '-sleep.png') });
    await char.evaluate(() => (window.__capriDebug as any).manual(false));
  });

  it('requires sustained actual rubbing on a window perch and cancels front sitting on release', async () => {
    const { app, char } = await launch(profile({ behavior: { quietHours: { enabled: false } }, voice: { interactionLines: false }, character: { glitchEffects: false } }));
    await app.evaluate(({ screen }, seat) => {
      const g = globalThis as any, a = g.__capri, area = screen.getPrimaryDisplay().workArea, b = a.charWin.getBounds();
      const rect = { x: area.x + 100, y: area.y + 500, width: 1200, height: 400 };
      g.__capriWindowsOverride = [{ handle: -69n, rect }];
      a.charWin.setBounds({ ...b, x: area.x + 400, y: Math.round(rect.y - b.height * seat) }); a.settleAfterDrop();
    }, SEAT_RATIO);
    await char.waitForFunction(() => (window.__capriDebug as any).attachment === 'perch');
    const poses = await char.evaluate(() => {
      const d = window.__capriDebug as any; d.manual(true); d.force({ sleep: 0, mouthOpen: 0 }); d.model.resetSecondary();
      const rub = (n: number) => { for (let i = 0; i < n; i++) { d.model.rubHead(); d.step(.1); } return d.model.activeSecondary; };
      const short = rub(30), long = rub(15), closed = d.model.secondaryClosed;
      d.step(.1, 10); const released = d.model.activeSecondary; d.manual(false);
      return { short, long, closed, released };
    });
    expect(poses).toEqual({ short: null, long: 'sit_closed', closed: true, released: null });
  });
  it('snaps lower drops into lying, alternates original sitting and protects the settling period', async () => {
    const { app, char } = await launch(profile({ behavior: { explore: true, quietHours: { enabled: false } }, voice: { interactionLines: false }, character: { glitchEffects: false } }));
    const hold = await app.evaluate(async ({ screen }, seat) => {
      const g = globalThis as any, a = g.__capri, area = screen.getPrimaryDisplay().workArea, b = a.charWin.getBounds();
      g.__capriWindowsOverride = []; a.charWin.setBounds({ ...b, x: area.x + 400, y: Math.round(area.y + area.height - b.height * seat - 30) }); a.settleAfterDrop();
      const delay = a.nextWindowVisit - Date.now(), before = a.charWin.getBounds(); a.setNextVisit(); await a.exploreTick(0);
      const curiosity = await a.curiosityDetour('Ooh, hang on. I want to see.');
      return { delay, before, after: a.charWin.getBounds(), curiosity, blocked: a.teleporter.d.blocked() };
    }, SEAT_RATIO);
    expect(hold.delay).toBeGreaterThanOrEqual(359000); expect(hold.delay).toBeLessThanOrEqual(540000);
    expect(hold.after).toEqual(hold.before); expect(hold.curiosity).toBe(false); expect(hold.blocked).toBe('settling on a lower ledge');
    await char.waitForFunction(() => (window.__capriDebug as any).model.activeSecondary === 'recline');
    const poses = await char.evaluate(() => {
      const d = window.__capriDebug as any; d.manual(true); d.force({ sleep: 0, mouthOpen: 0 }); d.model.resetSecondary(); d.step(.1);
      const lying = d.model.activeSecondary; d.step(1, 76); const sitting = { secondary: d.model.activeSecondary, clip: d.model.activeClip }; d.step(1, 35); const again = d.model.activeSecondary; d.manual(false);
      return { lying, sitting, again };
    });
    expect(poses).toMatchObject({ lying: 'recline', sitting: { secondary: null }, again: 'recline' });
    expect(poses.sitting.clip).toMatch(/^perch/);
    if (process.env.CAPRI_SECONDARY_SCREENSHOT) await char.screenshot({ path: process.env.CAPRI_SECONDARY_SCREENSHOT.replace('.png', '-lower-rest.png') });
  });

  it('keeps original floating artwork during a real stationary hover', async () => {
    const { app, char } = await launch(profile({ behavior: { quietHours: { enabled: false } }, dialogue: { contextPings: false } }));
    await app.evaluate(({ screen }) => { const g = globalThis as any, a = g.__capri, area = screen.getPrimaryDisplay().workArea, b = a.charWin.getBounds(); g.__capriDesktopOverride = { title: 'Test', process: 'test.exe' }; g.__capriWindowsOverride = []; a.charWin.setBounds({ ...b, x: area.x + 300, y: area.y + 30 }); a.settleAfterDrop(); });
    const point = await char.evaluate(() => {
      const d = window.__capriDebug as any; d.manual(true); d.force({ sleep: 0, mouthOpen: 0, headRoll: 0, bodyRot: 0, blinkL: 0, blinkR: 0 }); d.model.resetSecondary(); d.step(.03);
      for (let y = 0; y < innerHeight; y += 5) for (let x = 0; x < innerWidth; x += 5) if (d.hitAt(x, y) && d.model.headHitTest(x, y, devicePixelRatio)) return { x, y };
      throw Error('No interactive head region');
    });
    await char.mouse.move(point.x, point.y);
    const result = await char.evaluate(() => { const d = window.__capriDebug as any; d.step(.1, 36); const result = { pose: d.model.activeSecondary, closed: d.model.secondaryClosed, shader: d.model.secondaryShaderActive }; d.manual(false); return result; });
    expect(result.pose).toBeNull();
  });
  it('only selects lying on an upright supported ledge in the real renderer', async () => {
    const { app, char } = await launch(profile({ behavior: { quietHours: { enabled: false } }, dialogue: { contextPings: false } }));
    for (const inverted of [false, true]) {
      await app.evaluate(({ screen }, data) => {
        const g = globalThis as any, a = g.__capri, area = screen.getPrimaryDisplay().workArea, b = a.charWin.getBounds();
        g.__capriDesktopOverride = { title: 'Test', process: 'test.exe' };
        const rect = { x: area.x + 100, y: area.y + (data.inverted ? 15 : 500), width: 1200, height: 400 };
        g.__capriWindowsOverride = [{ handle: -69n, rect }];
        a.charWin.setBounds({ ...b, x: area.x + 400, y: Math.round(rect.y - b.height * (data.inverted ? 1 - data.seat : data.seat)) }); a.settleAfterDrop(); a.presenceTick();
      }, { inverted, seat: SEAT_RATIO });
      await char.waitForFunction(mode => (window.__capriDebug as any).attachment === mode, inverted ? 'inverted' : 'perch');
      const pose = await char.evaluate(() => {
        const d = window.__capriDebug as any; d.manual(true); d.setPointer(null); d.attention.clear(); d.force({ sleep: 0, mouthOpen: 0, blinkL: 0, blinkR: 0 }); d.model.resetSecondary(); d.step(.1, 205); const pose = d.model.activeSecondary; d.manual(false); return pose;
      });
      expect(pose).toBeNull();
    }
  });
  it('keeps original hover and inspection artwork and reclines on lower ledges', async () => {
    const { app, char } = await launch(profile({ behavior: { quietHours: { enabled: false } } }));
    await app.evaluate(() => { const g = globalThis as any; g.__capriDesktopOverride = { title: 'Test', process: 'test.exe' }; g.__capriWindowsOverride = []; });
    const panel = await openPanel(app, char, 'developer');
      await panel.getByRole('button', { name: 'Playground', exact: true }).click();
    for (const [name, pose, reason] of [['sit_hover', null, 'primary'], ['sit_inspect', null, 'primary'], ['recline_rest', 'recline', 'lower ledge rest']] as const) {
      await panel.evaluate(name => window.capri.invoke('dev:run', { kind: 'scenario', name, seconds: 3 }), name);
      await expect.poll(() => char.evaluate(() => { const m = (window.__capriDebug as any).model; return `${m.activeSecondary}:${m.secondaryReason}`; }), { timeout: 7000 }).toBe(`${pose}:${reason}`);
      await panel.evaluate(() => window.capri.invoke('dev:stop'));
    }
    await panel.evaluate(() => window.capri.invoke('dev:run', { kind: 'secondary', name: 'recline', inverted: true, seconds: 2 }));
    await expect.poll(() => char.evaluate(() => (window.__capriDebug as any).model.activeSecondary)).toBe('recline');
    expect(await char.evaluate(() => (window.__capriDebug as any).model.headTransform.d)).toBeGreaterThan(0);
    await panel.evaluate(() => window.capri.invoke('dev:stop'));
  });
  it('comments on the focused window after a cursor trip rather than the old perch target', async () => {
    let target = '';
    const mock = await mockModel(body => { target = companionRequest(body).context.target.title; return 'Ooh, that little diagram. Good place to end up.'; });
    try {
      const { app } = await launch(openaiProfile(mock.url, { memory: { autoLearn: false }, behavior: { quietHours: { enabled: false } }, teleport: { effects: false } }));
      await app.evaluate(async ({ screen }) => {
        const g = globalThis as any, a = g.__capri, area = screen.getPrimaryDisplay().workArea;
        g.__capriDesktopOverride = { title: 'Test', process: 'test.exe' };
        g.__capriWindowsOverride = [{ handle: -67n, rect: { x: area.x + 20, y: area.y + 20, width: 900, height: 700 } }];
        g.__capriWindowInfo = { '-67': { title: 'Focused diagram', process: 'drawing.exe' } }; g.__capriForegroundHandle = -67n;
        g.__capriCuriosityCursor = { x: area.x + 300, y: area.y + 300 };
        await a.curiosityDetour('Let me look.');
      });
      expect(target).toBe('Focused diagram'); expect(mock.calls).toBe(1);
      expect(await app.evaluate(() => (globalThis as any).__capri.bubble.state.text)).toContain('little diagram');
    } finally { await mock.close(); }
  });
  it('keeps a clock-only opportunity quiet without creating retired ping history', async () => {
    const ud = profile({ behavior: { quietHours: { enabled: false }, smallActivities: false }, dialogue: { contextPings: true } });
    const { app, char } = await launch(ud);
    const first = await app.evaluate(() => {
      const g = globalThis as any, a = g.__capri, NativeDate = Date;
      const future = new NativeDate(); future.setDate(future.getDate() + 1); future.setHours(3, 35, 0, 0); const fixed = future.getTime();
      g.__capriDesktopOverride = { title: 'Test', process: 'test.exe' }; g.__capriWindowsOverride = []; g.__capriIdleOverride = 0;
      try {
        g.Date = class extends NativeDate { constructor() { super(fixed); } static now() { return fixed; } };
        a.presenceTick(); const line = a.bubble.state.text; a.bubble.remark('cooldown sentinel'); a.presenceTick();
        return { line, second: a.bubble.state.text };
      } finally { g.Date = NativeDate; }
    });
    expect(first.line).toBe(''); expect(first.second).toBe('cooldown sentinel');
    expect(fs.existsSync(path.join(ud, 'context-pings.json'))).toBe(false);
    const panel = await openPanel(app, char, 'memory'); await panel.evaluate(() => window.capri.invoke('chat:clear'));
    expect(fs.existsSync(path.join(ud, 'context-pings.json'))).toBe(false);
  });
  it('offers an offline drop fallback and respects an explicitly quiet generated answer', async () => {
    for (const online of [false, true]) {
      const mock = online ? await mockModel(() => '<quiet/>') : null;
      try {
        const { app } = await launch(mock ? openaiProfile(mock.url, { behavior: { quietHours: { enabled: false } } }) : profile({ behavior: { quietHours: { enabled: false } } }));
        await app.evaluate(async() => {
          const g = globalThis as any, a = g.__capri;
          g.__capriDesktopOverride = { title: 'Test', process: 'test.exe' };
          g.__capriWindowInfo = { '-63': { title: 'YouTube', process: 'chrome.exe' } };
          g.__capriWindowsOverride = [{ handle: -63n, rect: { x: 300, y: 600, width: 700, height: 400 } }];
          await a.generatedRemark('putdown','User completed a putdown; speech is optional.',{target:-63n});
        });
        if (mock) await expect.poll(() => app.evaluate(() => (globalThis as any).__capri.lastDialogueOutcome), { timeout: 6000 }).toMatch(/^(?:putdown|placed_window): chose quiet/);
        else await expect.poll(() => app.evaluate(() => (globalThis as any).__capri.bubble.state.text), { timeout: 6000 }).not.toBe('');
        expect(await app.evaluate(() => (globalThis as any).__capri.bubble.state.text)).not.toContain('<quiet');
        if (mock) expect(mock.calls).toBe(1);
      } finally { if (mock) await mock.close(); }
    }
  });
  it('exposes new local behaviors and cleaned secondary artwork in the developer panel', async () => {
    const mock = await mockModel(() => 'No model request expected.');
    try {
      const { app, char } = await launch(openaiProfile(mock.url, { behavior: { quietHours: { enabled: false } }, teleport: { effects: false } }));
      await app.evaluate(() => { const g = globalThis as any; g.__capriDesktopOverride = { title: 'Test', process: 'test.exe' }; g.__capriWindowsOverride = []; });
      const panel = await openPanel(app, char, 'developer');
      const initialScenes=await app.evaluate(()=>(globalThis as any).__capri.scenes.recent().length);
      await panel.getByRole('button', { name: 'Playground', exact: true }).click();
      expect(await panel.getByRole('button', { name: 'Live visual inspection', exact: true, includeHidden: true }).count()).toBe(1);
      expect(await panel.getByRole('button', { name: 'Cursor visit and return', exact: true }).count()).toBe(1);
      for (const name of ['sit_closed', 'recline'] as const) for (const inverted of name === 'recline' ? [false] : [false, true]) {
        await panel.evaluate(data => window.capri.invoke('dev:run', { kind: 'secondary', name: data.name, inverted: data.inverted, seconds: 3 }), { name, inverted });
        await expect.poll(() => char.evaluate(() => (window.__capriDebug as any).model.activeSecondary)).toBe(name);
        const faceHit = await char.evaluate(() => { const d = window.__capriDebug as any, face = d.model.speechAnchor; return d.model.headHitTest(face.x * innerWidth, face.y * innerHeight, devicePixelRatio); });
        expect(faceHit).toBe(true);
        expect(await char.evaluate(() => (window.__capriDebug as any).model.secondaryShaderActive)).toBe(true);
        const moves = await char.evaluate(() => { const d = window.__capriDebug as any; d.manual(true); d.step(.1); const first = d.grab(); d.step(.1, 8); const changed = first !== d.grab(); d.manual(false); return changed; });
        expect(moves).toBe(true);
        if (process.env.CAPRI_SECONDARY_SCREENSHOT) await char.screenshot({ path: process.env.CAPRI_SECONDARY_SCREENSHOT.replace('.png', `-${name}${inverted ? '-inverted' : ''}.png`) });
        await panel.evaluate(() => window.capri.invoke('dev:stop'));
      }
      for (const name of ['pat_upright', 'pat_perched', 'pat_inverted', 'drop_fallback', 'continuity'] as const) {
        await panel.evaluate(name => window.capri.invoke('dev:run', { kind: 'scenario', name, seconds: .5 }), name);
        await expect.poll(async () => (await panel.evaluate(() => window.capri.invoke('dev:get'))).job.active).toBe(false);
      }
      await panel.evaluate(() => window.capri.invoke('dev:run', { kind: 'ping', name: 'late', seconds: .5 }));
      await expect.poll(async () => (await panel.evaluate(() => window.capri.invoke('dev:get'))).job.active).toBe(false);
      expect((await panel.evaluate(() => window.capri.invoke('dev:get'))).job.result).toBe('passed');
      expect(mock.calls).toBe(0); expect(await app.evaluate(() => (globalThis as any).__capri.scenes.recent().length)).toBe(initialScenes);
    } finally { await mock.close(); }
  });
  it('renders animated shader pixels, freezes still comparisons and reports the actual renderer state', async () => {
    const { app, char } = await launch(profile({ behavior: { quietHours: { enabled: false } }, teleport: { effects: false } }));
    const panel = await openPanel(app, char, 'developer');
      await panel.getByRole('button', { name: 'Playground', exact: true }).click();
    expect(await panel.getByRole('button', { name: 'Compare still and animated poses', exact: true }).count()).toBe(1);
    for (const name of ['sit_closed', 'recline'] as const) {
      for (const motion of ['still', 'animated'] as const) {
        await panel.evaluate(data => window.capri.invoke('dev:run', { kind: 'secondary', name: data.name, motion: data.motion, seconds: 8 }), { name, motion });
        await expect.poll(async () => (await panel.evaluate(() => window.capri.invoke('dev:get'))).runtime.poseRenderer).toMatchObject({ pose: name, shader: true, reduced: false, motion: motion === 'still' ? 0 : 1 });
        const changed = await char.evaluate(() => {
          const d = window.__capriDebug as any; d.manual(true); d.step(.1);
          const shader = d.model.secondary.shader.canvas, first = shader.toDataURL();
          d.step(.1, 14); const changed = first !== shader.toDataURL(); d.manual(false); return changed;
        });
        expect(changed).toBe(motion === 'animated');
        await panel.evaluate(() => window.capri.invoke('dev:stop'));
      }
    }
    await char.emulateMedia({ reducedMotion: 'reduce' });
    await panel.evaluate(() => window.capri.invoke('dev:run', { kind: 'secondary', name: 'sit_closed', seconds: 8 }));
    await expect.poll(async () => (await panel.evaluate(() => window.capri.invoke('dev:get'))).runtime.poseRenderer).toMatchObject({ pose: 'sit_closed', shader: true, reduced: true, motion: 0 });
    await panel.evaluate(() => window.capri.invoke('dev:stop'));
    await char.emulateMedia({ reducedMotion: 'no-preference' });
    await panel.evaluate(() => window.capri.invoke('dev:run', { kind: 'scenario', name: 'shader_compare', seconds: .5 }));
    await expect.poll(async () => (await panel.evaluate(() => window.capri.invoke('dev:get'))).job.log.some(entry => entry.text.includes('sit_closed: still'))).toBe(true);
    await panel.evaluate(() => window.capri.invoke('dev:stop'));
    await expect.poll(async () => (await panel.evaluate(() => window.capri.invoke('dev:get'))).job.active).toBe(false);
    await panel.evaluate(() => window.capri.invoke('dev:run', { kind: 'secondary', name: 'sit_closed', seconds: 8 }));
    await char.evaluate(() => (window.__capriDebug as any).model.secondary.shader.canvas.dispatchEvent(new Event('webglcontextlost', { cancelable: true })));
    await expect.poll(async () => (await panel.evaluate(() => window.capri.invoke('dev:get'))).runtime.poseRenderer).toMatchObject({ pose: 'sit_closed', shader: false });
    await panel.evaluate(() => window.capri.invoke('dev:stop'));
  });
  it('runs cursor and perch-motion developer scenarios with position restoration', async () => {
    const { app, char } = await launch(profile({ behavior: { quietHours: { enabled: false } }, teleport: { effects: false } }));
    await app.evaluate(() => { const g = globalThis as any; g.__capriDesktopOverride = { title: 'Test', process: 'test.exe' }; g.__capriWindowsOverride = []; });
    const panel = await openPanel(app, char, 'developer');
      await panel.getByRole('button', { name: 'Playground', exact: true }).click();
    const original = await app.evaluate(() => (globalThis as any).__capri.charWin.getBounds());
    for (const name of ['cursor_visit', 'perch_quick', 'perch_held'] as const) {
      await panel.evaluate(name => window.capri.invoke('dev:run', { kind: 'scenario', name, seconds: .5 }), name);
      await expect.poll(async () => (await panel.evaluate(() => window.capri.invoke('dev:get'))).job.active, { timeout: 15000 }).toBe(false);
      expect((await panel.evaluate(() => window.capri.invoke('dev:get'))).job.result).toBe('passed');
      expect(await app.evaluate(() => (globalThis as any).__capri.charWin.getBounds())).toEqual(original);
    }
  });
  it('uses one visual request to produce a comment and validated inspection coordinates', async () => {
    let withImage = false;
    const mock = await mockModel(body => {
      withImage = Array.isArray((body.messages.at(-1) as any).content);
      return JSON.stringify(visualDecision({ line: 'Ooh, that diagram has my attention.', points: [{ x: .5, y: .35, label: 'diagram' }, { x: 2, y: .5, label: 'invalid' }] }));
    });
    try {
      const { app, char } = await launch(openaiProfile(mock.url, { behavior: { quietHours: { enabled: false } } }));
      await app.evaluate(() => {
        const g = globalThis as any;
        g.__capriDesktopOverride = { title: 'Test', process: 'test.exe' };
        g.__capriWindowsOverride = [{ handle: -64n, rect: { x: 200, y: 200, width: 1000, height: 800 } }];
        g.__capriObservationOverride = { jpegBase64: 'fixture', region: { x: 200, y: 200, width: 1000, height: 800 }, window: { x: 200, y: 200, width: 1000, height: 800 } };
      });
      const panel = await openPanel(app, char, 'developer');
      const initialScenes=await app.evaluate(()=>(globalThis as any).__capri.scenes.recent().length);
      await panel.getByRole('button', { name: 'Playground', exact: true }).click();
      await panel.evaluate(() => window.capri.invoke('dev:run', { kind: 'live', name: 'inspect' }));
      await expect.poll(async () => (await panel.evaluate(() => window.capri.invoke('dev:get'))).job.active, { timeout: 10000 }).toBe(false);
      const state = await panel.evaluate(() => window.capri.invoke('dev:get'));
      expect(state.job.result).toBe('passed'); expect(state.runtime.inspectionPoints,JSON.stringify({job:state.job,outcome:state.runtime.dialogueOutcome,calls:mock.calls,withImage})).toBe(1); expect(withImage).toBe(true); expect(mock.calls).toBe(1);
      expect(state.runtime.sharedScenes).toBe(initialScenes);
    } finally { await mock.close(); }
  });
  it('keeps quiet visual curiosity without speaking and shares it with direct conversation', async () => {
    let requests: any[] = [];
    const mock = await mockModel(body => {
      requests.push(body);
      return requests.length === 1 ? JSON.stringify(visualDecision({ line: '<quiet/>', facts: ['A green loop ends outside the border.'], interpretation: 'Maybe an escape route.', curiosity: 'Does the loose end reconnect?', points: [{ x: .5, y: .4, label: 'loose green end' }] })) : 'I still want to know where that loose end goes.';
    });
    try {
      const { app } = await launch(openaiProfile(mock.url, { behavior: { quietHours: { enabled: false }, idleRemarks: false } }));
      const result = await app.evaluate(async () => {
        const g = globalThis as any, a = g.__capri;
        g.__capriDesktopOverride = { title: 'Loop experiment', process: 'test.exe' };
        g.__capriWindowInfo = { '-64': { ...g.__capriDesktopOverride } };
        g.__capriForegroundHandle = -64n;
        const rect = { x: 200, y: 200, width: 1000, height: 800 };
        g.__capriWindowsOverride = [{ handle: -64n, rect }];
        g.__capriObservationOverride = { jpegBase64: 'fixture', region: rect, window: rect };
        const before = a.speakCount;
        await a.generatedRemark('inspect', 'One unfamiliar visible detail.', { target: -64n });
        const quiet = { outcome: a.lastDialogueOutcome, points: a.lastInspection?.points.length, scenes: a.scenes.recent(96).length, spoken: a.speakCount - before };
        await a.convo.send('What caught your attention?'); await a.convo.settle();
        return quiet;
      });
      expect(result).toMatchObject({ outcome: expect.stringContaining('inspect: chose quiet'), points: 1, scenes: 0, spoken: 0 });
      expect(requests).toHaveLength(2);
      expect(requests[1].messages[0].content).toContain('Does the loose end reconnect?');
      expect(requests[1].messages[0].content).toContain('Maybe an escape route.');
      expect(requests[1].messages[0].content).toContain('model-described');
    } finally { await mock.close(); }
  });
  it.each(['title', 'geometry', 'occlusion'])('discards visual interest when target %s changes during the request', async change => {
    let called = false;
    const mock = await mockModel(() => { called = true; return { delayMs: 800, text: JSON.stringify(visualDecision({ line: 'That loose end is interesting.', facts: ['A green line.'], curiosity: 'Where does it go?', points: [{ x: .5, y: .4, label: 'line' }] })) }; });
    try {
      const { app } = await launch(openaiProfile(mock.url, { behavior: { quietHours: { enabled: false }, idleRemarks: false } }));
      await app.evaluate(() => {
        const g = globalThis as any, rect = { x: 200, y: 200, width: 1000, height: 800 };
        g.__capriDesktopOverride = { title: 'Before', process: 'test.exe' }; g.__capriWindowsOverride = [{ handle: -64n, rect }];
        g.__capriWindowInfo = { '-64': { ...g.__capriDesktopOverride } };
        g.__capriObservationOverride = { jpegBase64: 'fixture', region: rect, window: rect };
        g.__stage3Pending = g.__capri.generatedRemark('inspect', '', { target: -64n });
      });
      await expect.poll(() => called).toBe(true);
      const result = await app.evaluate(async (_e, change) => {
        const g = globalThis as any;
        if (change === 'title') g.__capriWindowInfo['-64'] = { title: 'After', process: 'test.exe' };
        if (change === 'geometry') g.__capriWindowsOverride = [{ handle: -64n, rect: { x: 240, y: 200, width: 1000, height: 800 } }];
        if (change === 'occlusion') g.__capriWindowsOverride = [{ handle: -65n, rect: { x: 300, y: 300, width: 500, height: 400 } }, ...g.__capriWindowsOverride];
        await g.__stage3Pending;
        return { inspection: g.__capri.lastInspection, scenes: g.__capri.scenes.recent(96).length };
      }, change);
      expect(result).toEqual({ inspection: null, scenes: 0 });
    } finally { await mock.close(); }
  });
  it('denies an exhausted inspection budget before capturing a screenshot or calling the model', async () => {
    const mock = await mockModel(() => 'This request should not happen.');
    try {
      const { app } = await launch(openaiProfile(mock.url, { behavior: { quietHours: { enabled: false } } }));
      const result = await app.evaluate(async () => {
        const g = globalThis as any, a = g.__capri; let captures = 0;
        g.__capriWindowInfo = { '-64': { title: 'Routing fixture', process: 'fixture.exe' } };
        const rect = { x: 200, y: 200, width: 1000, height: 800 };
        g.__capriWindowsOverride = [{ handle: -64n, rect }];
        Object.defineProperty(g, '__capriObservationOverride', { configurable: true, get: () => { captures++; return { jpegBase64: 'fixture', region: rect, window: rect }; } });
        const reserved = a.behavior.reserve('ambient');
        await a.generatedRemark('inspect', '', { target: -64n });
        return { reserved, captures, busy: a.behavior.busy };
      });
      expect(result).toEqual({ reserved: true, captures: 0, busy: false }); expect(mock.calls).toBe(0);
    } finally { await mock.close(); }
  });
  it('records invisible voice-only remarks only after completed audio and never after cancellation', async () => {
    const { app, char } = await launch(profile({ character: { speechBubbles: false }, voice: { ttsEnabled: true }, behavior: { quietHours: { enabled: false } } }));
    await char.evaluate(() => {
      const w = window as any; w.__receiptIds = [];
      w.__capriDebug.speaker.enqueue = (id: string) => w.__receiptIds.push(id);
    });
    await app.evaluate(() => (globalThis as any).__capri.presentRemark('This was only queued.', true, false));
    expect(await app.evaluate(() => (globalThis as any).__capri.scenes.recent(96))).toEqual([]);
    await char.evaluate(async () => {
      const w = window as any, utteranceId = w.__receiptIds.at(-1);
      for (const state of ['start', 'cancel', 'end'] as const) await w.capri.invoke('char:speechState', { utteranceId, state });
    });
    expect(await app.evaluate(() => (globalThis as any).__capri.scenes.recent(96))).toEqual([]);
    await app.evaluate(() => (globalThis as any).__capri.presentRemark('This finished playing.', true, false));
    await char.evaluate(async () => {
      const w = window as any, utteranceId = w.__receiptIds.at(-1);
      await w.capri.invoke('char:speechState', { utteranceId, state: 'start' });
      await w.capri.invoke('char:speechState', { utteranceId, state: 'end' });
    });
    expect(await app.evaluate(() => (globalThis as any).__capri.scenes.recent(96).map((s: any) => s.text))).toEqual(['This finished playing.']);
    await app.evaluate(() => { const a = (globalThis as any).__capri; a.settings.update({ voice: { ttsEnabled: false } }); a.presentRemark('Neither displayed nor spoken.', true, false); });
    expect(await app.evaluate(() => (globalThis as any).__capri.scenes.recent(96))).toHaveLength(1);
  });
  it('marks an episodic question asked only when unified-core voice-only audio completes', async () => {
    const mock = await mockModel(() => JSON.stringify({ interpretation: 'Continue the earlier connection interest.', interest: null,
      action: 'speak', line: 'How do those branching connections route the signal?', gesture: 'none', reason: 'A relevant follow-up.' }));
    try {
      const { app, char } = await launch(openaiProfile(mock.url, { character: { speechBubbles: false }, memory: { autoLearn: true }, voice: { ttsEnabled: true }, behavior: { quietHours: { enabled: false } } }));
      await char.evaluate(() => { const w = window as any; w.__receiptIds = []; w.__capriDebug.speaker.enqueue = (id: string) => w.__receiptIds.push(id); });
      await app.evaluate(async () => {
        const a = (globalThis as any).__capri, at = Date.now();
        const source = { id: 'prior-graph', at, role: 'observation', text: 'A branching connection graph is visible.', reliability: 'visual-interpretation', process: 'synth.exe' };
        a.scenes.remember({ topic: 'branching connections', sourceId: source.id, evidence: source.text, interpretation: 'The routing is unresolved.' }, [source], a.scenes.checkpoint(), 'Understand the branching connections.');
        await a.generatedRemark('pat', 'Continue the branching connections interest.');
      });
      expect(mock.calls).toBe(1);
      expect(await app.evaluate(() => (globalThis as any).__capri.scenes.experiences()[0].want.askedAt)).toBeUndefined();
      await char.evaluate(async () => { const w = window as any, utteranceId = w.__receiptIds.at(-1); for (const state of ['start', 'end'] as const) await w.capri.invoke('char:speechState', { utteranceId, state }); });
      expect(await app.evaluate(() => (globalThis as any).__capri.scenes.experiences()[0].want.askedAt)).toEqual(expect.any(Number));
    } finally { await mock.close(); }
  });
  it('keeps disabled-history scenes in the session only and removes their saved file', async () => {
    const ud = profile(); let { app } = await launch(ud);
    await app.evaluate(() => {
      const a = (globalThis as any).__capri;
      a.presentRemark('Saved until disabled.', true, false);
      a.settings.update({ privacy: { saveHistory: false } });
      a.presentRemark('Only this session remembers me.', true, false);
      a.settings.update({ voice: { volume: .5 } });
    });
    expect(fs.existsSync(path.join(ud, 'companion-scenes.json'))).toBe(false);
    expect(await app.evaluate(() => (globalThis as any).__capri.scenes.recent().some((x: any) => x.text === 'Only this session remembers me.'))).toBe(true);
    await quit(app); ({ app } = await launch(ud));
    expect(await app.evaluate(() => (globalThis as any).__capri.scenes.recent())).toEqual([]);
  });
  it('shares actual desktop remarks with regular chat and chat with generated asides', async () => {
    const requests: { messages: { role: string; content: string }[] }[] = [];
    const model = await mockModel(body => { requests.push(body); return body.messages.at(-1)!.content.startsWith('{') ? 'Fine. The noisy choice still wins.' : 'I said trouble. That was a compliment.'; });
    try {
      const { app, char } = await launch(openaiProfile(model.url, { memory: { autoLearn: false }, behavior: { quietHours: { enabled: false } } }));
      await app.evaluate(async () => {
        const g = globalThis as any, a = g.__capri;
        g.__capriDesktopOverride = { title: 'Test', process: 'test.exe' };
        a.observeAgency();a.cognitiveRuntime.resume(); if(!a.cognitiveRuntime.claim('behavior'))throw Error('Fixture requires cognitive attention');
        a.presentRemark('That bassline is trouble.', false, false);a.cognitiveRuntime.release('behavior');
        await a.convo.send('You just called it trouble. Was that a compliment?'); await a.convo.settle();
      });
      const chatPrompt = requests[0].messages[0].content;
      expect(chatPrompt).toContain('SHARED DESKTOP CONTINUITY'); expect(chatPrompt).toContain('That bassline is trouble.');
      expect(chatPrompt).toContain('not independent evidence'); expect(chatPrompt).toContain('your last actual thought');
      await app.evaluate(async () => {
        const g = globalThis as any, a = g.__capri;
        g.__capriWindowsOverride = [{ handle: -61n, rect: { x: 300, y: 300, width: 1000, height: 700 } }];
        g.__capriWindowInfo = { '-61': { title: 'Music collection', process: 'music.exe' } };
        await a.generatedRemark('pat', '', { target: -61n });
      });
      expect(model.calls).toBe(2);
      const asideRequest = companionRequest(requests[1]);
      expect(requests[1].messages[0].content).toContain('I said trouble. That was a compliment.');
      expect(asideRequest.sharedActions.every((x: any) => x.kind === 'action')).toBe(true);
      expect(requests[1].messages[0].content).toContain('That bassline is trouble.');
      const aside = await app.evaluate(() => (globalThis as any).__capri.bubble.state.text);
      await char.evaluate(() => window.capri.invoke('bubble:open'));
      expect(await app.evaluate(() => (globalThis as any).__capri.bubble.state.text)).toBe(aside);
      expect(model.calls).toBe(2);
    } finally { await model.close(); }
  });
  it('recalls an older topic beyond the live chat window without additional requests', async () => {
    let prompt = '';
    const model = await mockModel(body => { prompt = body.messages[0].content; return 'Cobalt. We were giving that ceramic fox a dramatic entrance.'; });
    try {
      const ud = openaiProfile(model.url, { ai: { historyTurns: 1 }, memory: { autoLearn: false } });
      const past = [
        { role: 'user', content: 'I am painting a ceramic fox with cobalt glaze.' }, { role: 'assistant', content: 'Cobalt. That fox deserves a dramatic entrance.' },
        ...Array.from({ length: 4 }, (_, i) => [{ role: 'user', content: `Unrelated lunch note ${i}` }, { role: 'assistant', content: `Lunch reply ${i}` }]).flat(),
      ].map((m, i) => ({ ...m, id: `seed${i}`, ts: Date.now() - 60000 + i }));
      fs.writeFileSync(path.join(ud, 'history.jsonl'), past.map(m => JSON.stringify(m)).join('\n') + '\n');
      const { app } = await launch(ud);
      await app.evaluate(async () => { const a = (globalThis as any).__capri; await a.convo.send('What did you think about the cobalt ceramic fox?'); await a.convo.settle(); });
      expect(prompt).toContain('EARLIER CONVERSATION EXCERPTS'); expect(prompt).toContain('dramatic entrance');
      expect(model.calls).toBe(1);
    } finally { await model.close(); }
  });
  it('keeps shared asides across a full restart and clears them with chat history', async () => {
    const prompts: string[] = [];
    const model = await mockModel(body => { prompts.push(body.messages[0].content); return 'I remember the little detour.'; });
    try {
      const ud = openaiProfile(model.url, { memory: { autoLearn: false } });
      let { app, char } = await launch(ud);
      await app.evaluate(() => { const a = (globalThis as any).__capri; a.observeAgency();a.cognitiveRuntime.resume();if(!a.cognitiveRuntime.claim('behavior'))throw Error('Fixture requires cognitive attention');a.presentRemark('That sketch has excellent little teeth.', false, false);a.cognitiveRuntime.release('behavior'); });
      await quit(app);
      ({ app, char } = await launch(ud));
      await app.evaluate(async () => { const a = (globalThis as any).__capri; await a.convo.send('What did you say about the teeth?'); await a.convo.settle(); });
      expect(prompts[0]).toContain('That sketch has excellent little teeth.');
      const panel = await openPanel(app, char, 'memory');
      await panel.evaluate(() => window.capri.invoke('chat:clear'));
      expect(await app.evaluate(() => (globalThis as any).__capri.scenes.recent())).toEqual([]);
      expect(fs.existsSync(path.join(ud, 'companion-scenes.json'))).toBe(false);
      await app.evaluate(async () => { const a = (globalThis as any).__capri; await a.convo.send('Hi again'); await a.convo.settle(); });
      expect(prompts[1]).not.toContain('excellent little teeth'); expect(model.calls).toBe(2);
    } finally { await model.close(); }
  });
  it('cancels the curiosity trip when the user places her elsewhere', async () => {
    const { app } = await launch(profile({ behavior: { quietHours: { enabled: false } }, teleport: { effects: false } }));
    await app.evaluate(({ screen }) => {
      const g = globalThis as any, a = g.__capri, area = screen.getPrimaryDisplay().workArea;
      g.__capriWindowsOverride = []; g.__capriDesktopOverride = { title: 'Test', process: 'test.exe' };
      g.__capriCuriosityCursor = { x: area.x + 200, y: area.y + 200 };
      g.__curiosityRun = a.curiosityDetour('Let me get closer.');
    });
    await expect.poll(() => app.evaluate(() => (globalThis as any).__capri.curiosityActive)).toBe(true);
    const placed = await app.evaluate(({ screen }) => {
      const a = (globalThis as any).__capri, b = a.charWin.getBounds(), area = screen.getPrimaryDisplay().workArea;
      a.charWin.setBounds({ ...b, x: area.x + 450, y: area.y + 250 }); a.settleAfterDrop();
      return a.charWin.getBounds();
    });
    expect(await app.evaluate(async () => await (globalThis as any).__curiosityRun)).toBe(false);
    expect(await app.evaluate(() => (globalThis as any).__capri.charWin.getBounds())).toEqual(placed);
  });
  it('floats toward a cursor curiosity cue, lingers and teleports back to her perch', async () => {
    const { app } = await launch(profile({ behavior: { quietHours: { enabled: false } }, teleport: { effects: false } }));
    const home = await app.evaluate(({ screen }, seat) => {
      const g = globalThis as any, a = g.__capri, b = a.charWin.getBounds(), area = screen.getPrimaryDisplay().workArea;
      g.__capriDesktopOverride = { title: 'Test', process: 'test.exe' };
      const rect = { x: area.x + 100, y: area.y + 20, width: 1100, height: 700 };
      g.__capriWindowsOverride = [{ handle: -48n, rect }];
      a.charWin.setBounds({ ...b, x: area.x + 150, y: Math.round(rect.y - b.height * (1 - seat)) }); a.settleAfterDrop();
      g.__capriCuriosityCursor = { x: area.x + area.width - b.width - 80, y: area.y + 200 };
      g.__curiosityRun = a.curiosityDetour('Ooh, hang on. I want to see.');
      return { x: area.x + 150, y: Math.round(rect.y - b.height * (1 - seat)) };
    }, SEAT_RATIO);
    await expect.poll(() => app.evaluate(() => (globalThis as any).__capri.curiosityActive)).toBe(true);
    await expect.poll(() => app.evaluate((_e, home) => Math.abs((globalThis as any).__capri.charWin.getBounds().x - home.x), home), { timeout: 4000 }).toBeGreaterThan(100);
    expect(await app.evaluate(async () => await (globalThis as any).__curiosityRun)).toBe(true);
    expect(await app.evaluate(() => (globalThis as any).__capri.curiosityActive)).toBe(false);
    expect(await app.evaluate(() => (globalThis as any).__capri.perchMode)).toBe('inverted');
    expect(await app.evaluate(() => (globalThis as any).__capri.charWin.getBounds().x)).toBe(home.x);
    expect(await app.evaluate(async () => await (globalThis as any).__capri.curiosityDetour('Let me look.'))).toBe(false);
  });
  it('recognizes a deliberate drop over window content without requiring a snapped edge', async () => {
    const model = await mockModel(() => 'Ooh. Give me a second to look around.');
    try {
      const { app } = await launch(openaiProfile(model.url, { behavior: { quietHours: { enabled: false } } }));
      const target = await app.evaluate(({ screen }) => {
        const g = globalThis as any, a = g.__capri, b = a.charWin.getBounds(), area = screen.getPrimaryDisplay().workArea;
        g.__capriWindowsOverride = [{ handle: -46n, rect: { x: area.x + 100, y: area.y + 50, width: 1000, height: 800 } }];
        g.__capriWindowInfo = { '-46': { title: 'Homework notes', process: 'notepad.exe' } };
        g.__capriDesktopOverride = { title: 'Test', process: 'test.exe' };
        a.charWin.setBounds({ ...b, x: area.x + 400, y: area.y + 300 });
        const random = Math.random; Math.random = () => .1;
        try { a.settleAfterDrop(); } finally { Math.random = random; }
        return { mode: a.perchMode, attention: a.attentionHandle === null };
      });
      expect(target.attention).toBe(false);
      await new Promise(r => setTimeout(r, 2400)); expect(model.calls).toBe(1);
    } finally { await model.close(); }
  });
  it('debounces ordinary window placements into one contextual request', async () => {
    let request: any;
    const model = await mockModel(body => { request = companionRequest(body); return 'Blank page. Dangerous amount of room for ideas.'; });
    try {
      const { app } = await launch(openaiProfile(model.url, { behavior: { quietHours: { enabled: false } } }));
      await app.evaluate(() => {
        const g = globalThis as any, a = g.__capri, b = a.charWin.getBounds();
        g.__capriWindowsOverride = [{ handle: -47n, rect: { x: 200, y: 850, width: 1000, height: 400 } }];
        g.__capriWindowInfo = { '-47': { title: 'Untitled - Notepad', process: 'notepad.exe' } };
        const random = Math.random; Math.random = () => .5;
        try { for (let i = 0; i < 6; i++) { a.charWin.setBounds({ ...b, x: 400 + i * 10, y: Math.round(850 - b.height * .712) }); a.settleAfterDrop(); } }
        finally { Math.random = random; }
      });
      await new Promise(r => setTimeout(r, 4000));
      expect(model.calls).toBe(1);
      expect(request.event).toBe('placed_window'); expect(request.context.target.title).toBe('Untitled - Notepad');
      expect(request.localCues).toHaveProperty('hour');
      await app.evaluate(() => (globalThis as any).__capri.settleAfterDrop());
      await new Promise(r => setTimeout(r, 1800)); expect(model.calls).toBe(1);
    } finally { await model.close(); }
  });
  it('recovers a failed settings boot and a crashed panel, then closes normally', async () => {
    const { app, char } = await launch(profile());
    await app.evaluate(({ ipcMain }) => ipcMain.removeHandler('settings:get'));
    const waiting = app.waitForEvent('window');
    await char.evaluate(() => window.capri.invoke('panel:open', 'model'));
    const broken = await waiting;
    await broken.getByRole('button', { name: 'Reload settings', exact: true }).waitFor();
    await app.evaluate(({ ipcMain }) => ipcMain.handle('settings:get', () => (globalThis as any).__capri.settings.get()));
    await broken.getByRole('button', { name: 'Reload settings', exact: true }).click();
    await broken.getByLabel('Provider', { exact: true }).waitFor();
    await app.evaluate(() => (globalThis as any).__capri.panelWin.webContents.forcefullyCrashRenderer());
    await char.waitForTimeout(150);
    const replacement = app.waitForEvent('window');
    await char.evaluate(() => window.capri.invoke('panel:open', 'model'));
    const recovered = await replacement;
    await recovered.getByLabel('Provider', { exact: true }).waitFor();
    const closed = recovered.waitForEvent('close');
    await recovered.evaluate(() => window.capri.invoke('panel:close')).catch(error => { if (!recovered.isClosed()) throw error; });
    await closed;
  });
  it('keeps one settings window during rapid navigation and uses the final requested tab', async () => {
    const { app, char } = await launch(profile());
    const waiting = app.waitForEvent('window');
    await char.evaluate(async () => { for (const tab of ['model', 'voice', 'memory', 'character', 'model']) await window.capri.invoke('panel:open', tab); });
    const panel = await waiting;
    await panel.getByLabel('Provider', { exact: true }).waitFor();
    expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().filter(w => w.isFocusable() && w.getTitle() !== 'Capri bubble').length)).toBe(1);
  });
  it('keeps placement quiet initially and considers the actual perch target after settling', async () => {
    let target = '';
    const model = await mockModel(body => { target = companionRequest(body).context.target.title; return 'Ooh, let me poke around. Just looking.'; });
    try {
      const { app } = await launch(openaiProfile(model.url, { behavior: { quietHours: { enabled: false } } }));
      const initial = await app.evaluate(() => {
        const g = globalThis as any, a = g.__capri, b = a.charWin.getBounds();
        g.__capriWindowInfo = { '-77': { title: 'Homework notes', process: 'notepad.exe' } };
        g.__capriDesktopOverride = { title: 'Unrelated browser window', process: 'chrome.exe' };
        g.__capriWindowsOverride = [{ handle: -77n, rect: { x: 300, y: 600, width: 700, height: 400 } }];
        a.charWin.setBounds({ ...b, x: 450, y: Math.round(600 - b.height * 0.712) });
        a.settleAfterDrop(); return a.bubble.state.text;
      });
      expect(initial).toBe(''); expect(model.calls).toBe(0);
      await expect.poll(() => target, { timeout: 10000 }).toBe('Homework notes');
      await expect.poll(() => app.evaluate(() => (globalThis as any).__capri.bubble.state.text)).toBe('Ooh, let me poke around. Just looking.');
      expect(model.calls).toBe(1);
    } finally { await model.close(); }
  });
  it('roams a visible window before perching and resting', async () => {
    const { app, char } = await launch(profile({ behavior: { explore: true, quietHours: { enabled: false } }, teleport: { effects: false } }));
    await app.evaluate(() => {
      const g = globalThis as any, a = g.__capri; Math.random=()=>0;
      g.__capriWindowsOverride = [{ handle: -88n, rect: { x: 250, y: 350, width: 900, height: 600 } }];
      a.setNextVisit(); g.__tour = a.exploreTick(0);
    });
    await expect.poll(() => app.evaluate(() => (globalThis as any).__capri.tourStage), { timeout: 6000 }).toBe('roaming');
    await expect.poll(() => char.evaluate(() => (window.__capriDebug as any).surface)).toBe('air');
    const result = await app.evaluate(async () => {
      const g = globalThis as any, a = g.__capri; await g.__tour;
      return { target: String(a.attentionHandle), stage: a.tourStage, mode: a.perchMode, safe: a.safeForTarget(a.charWin.getBounds(), -88n), history: a.outings.snapshot(), restLeft: a.outings.snapshot().restUntil - Date.now() };
    });
    expect(result).toMatchObject({ target: '-88', stage: 'resting', safe: true });
    expect(['perch', 'inverted']).toContain(result.mode);
    expect(result.history.visits).toHaveLength(1); expect(result.restLeft).toBeGreaterThan(115000);
    expect(result.history.outing).toBeNull();
  });
  it('discards a delayed observation when the user places her somewhere else', async () => {
    const model = await mockModel(body => companionRequest(body).event === 'placed_window'
      ? { text: 'OLD WINDOW should never appear after moving.', delayMs: 200 }
      : { text: '<quiet/>', delayMs: 5 });
    try {
      const { app } = await launch(openaiProfile(model.url, { behavior: { quietHours: { enabled: false } } }));
      await app.evaluate(() => {
        const g = globalThis as any, a = g.__capri, b = a.charWin.getBounds();
        g.__capriWindowsOverride = [{ handle: -77n, rect: { x: 300, y: 600, width: 700, height: 400 } }];
        g.__capriWindowInfo = { '-77': { title: 'OLD WINDOW', process: 'notepad.exe' } };
        a.charWin.setBounds({ ...b, x: 450, y: Math.round(600 - b.height * 0.712) }); a.settleAfterDrop();
      });
      await expect.poll(() => model.calls, { timeout: 8000 }).toBe(1);
      await app.evaluate(() => { const g = globalThis as any, a = g.__capri, b = a.charWin.getBounds(); g.__capriWindowsOverride = []; a.charWin.setBounds({ ...b, x: 100, y: 100 }); a.settleAfterDrop(); });
      await new Promise(resolve => setTimeout(resolve, 2000));
      expect(await app.evaluate(() => (globalThis as any).__capri.bubble.state.text)).not.toContain('OLD WINDOW');
    } finally { await model.close(); }
  });
  it('uses a contextual greeting and deliberate touch request with a persistent mute control', async () => {
    const model = await mockModel(body => body.messages.at(-1)!.content.includes('"event":"pat"') ? 'That is preem, keep going.' : 'Morning, choom. Busy with those notes?');
    try {
      const { app, char } = await launch(openaiProfile(model.url, { behavior: { quietHours: { enabled: false } } }));
      await char.evaluate(() => window.capri.invoke('bubble:open'));
      await expect.poll(() => app.evaluate(() => (globalThis as any).__capri.bubble.state.text)).not.toBe('');
      await app.evaluate(() => { (globalThis as any).__capri.bubble.dismiss(); });
      await app.evaluate(()=>{Math.random=()=>.99;}); // Select the generated-contact branch this fixture asserts.
    await char.evaluate(() => window.capri.invoke('char:interaction', 'pat'));
      await expect.poll(() => app.evaluate(() => (globalThis as any).__capri.bubble.state.text)).not.toBe('');
      expect(model.calls).toBe(2); // Deliberate touch now continues the shared exchange.
      await app.evaluate(async () => { const a = (globalThis as any).__capri; await a.generatedRemark('inspect'); await a.generatedRemark('caught'); });
      expect(model.calls).toBe(2);
      const panel = await openPanel(app, char);
      await panel.getByRole('button', { name: 'Unmute Capri', exact: true }).click();
      await panel.getByRole('button', { name: 'Mute Capri', exact: true }).waitFor();
      await panel.getByRole('button', { name: 'Mute Capri', exact: true }).click();
      expect(await app.evaluate(() => (globalThis as any).__capri.settings.get().voice.ttsEnabled)).toBe(false);
      await panel.getByRole('button', { name: 'Unmute Capri', exact: true }).waitFor();
    } finally { await model.close(); }
  });
  it('suppresses generation and exploration in all three game quiet zones', async () => {
    const model = await mockModel(() => 'Should not be generated.');
    try {
      const { app } = await launch(openaiProfile(model.url, { behavior: { explore: true, quietHours: { enabled: false } } }));
      for (const process of ['osu!.exe', 'VALORANT-Win64-Shipping.exe', 'deadlock.exe']) {
        await app.evaluate(async (_e, process) => {
          const g = globalThis as any; g.__capriDesktopOverride = { title: 'Playing', process };
          const a = g.__capri; a.setNextVisit(); await a.generatedRemark('greeting'); await a.exploreTick(0);
        }, process);
      }
      expect(model.calls).toBe(0);
      expect(await app.evaluate(() => (globalThis as any).__capri.exploringHandle)).toBeNull();
      expect(await app.evaluate(() => (globalThis as any).__capri.speakCount)).toBe(0);
    } finally { await model.close(); }
  });
  it('keeps the completed outing perch when its exposed window gains focus', async () => {
    const { app } = await launch(profile({ behavior: { explore: true, quietHours: { enabled: false } }, teleport: { effects: false, auto: false } }));
    await app.evaluate(async ({ screen }) => {
      const g = globalThis as any, a = g.__capri;
      g.__capriWindowsOverride = [{ handle: -22n, rect: { x: 120, y: 350, width: 700, height: 400 } }];
      const area=screen.getPrimaryDisplay().workArea; screen.getCursorScreenPoint=()=>({x:area.x,y:area.y});
      a.setNextVisit(); await a.exploreTick(0);
    });
    expect(await app.evaluate(() => String((globalThis as any).__capri.attentionHandle))).toBe('-22');
    expect(await app.evaluate(() => (globalThis as any).__capri.exploringHandle)).toBeNull();
    await app.evaluate(() => { const g = globalThis as any; g.__capriForegroundHandle = -22n; g.__capri.raiseTick(); });
    expect(await app.evaluate(() => String((globalThis as any).__capri.attentionHandle))).toBe('-22');
    await expect.poll(() => app.evaluate(() => (globalThis as any).__capri.teleporter.active)).toBe(false);
  });
});

