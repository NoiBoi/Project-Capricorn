import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { _electron as electron, type ElectronApplication } from 'playwright-core';
import { expect, it } from 'vitest';
import { selectRuntime } from '../../src/main/runtime2/selection';
import { closeIsolatedApp } from './lifecycle';

it('runs the integrated agent through Electron with fixture pixels, native movement, original evidence and restart continuity', async () => {
  const env = { ...process.env, CAPRI_RUNTIME: '2', CAPRI_V2_PROFILE_ID: 'integrated-' + randomUUID(), CAPRI_TEST: '1', CAPRI_OFFSCREEN: '1', CAPRI_NO_DEV_KEY: '1', CAPRI_V2_MODEL: 'synthetic', CAPRI_V2_AMBIENT_MS: '60000', CAPRI_V2_WINDOW_FOCUS: '0' };
  const dir = selectRuntime(env, os.homedir()).profile!;
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({ firstRunComplete: true, ai: { provider: 'offline' }, memory: { enabled: true, autoLearn: false }, privacy: { saveHistory: true }, dialogue: { localContext: true }, actions: { policies: { read_screen: 'allow', teleport: 'allow' } }, voice: { ttsEnabled: false }, behavior: { quietHours: { enabled:false } }, character: { startupIntro: false }, teleport: { auto: false, effects: false } }));
  let app: ElectronApplication | undefined;
  try {
    app = await electron.launch({ args: [path.resolve(__dirname, '../..')], env });
    await expect.poll(() => app!.evaluate(() => !!(globalThis as any).__capri?.runtime2)).toBe(true);
    await app.evaluate(async ({ BrowserWindow }) => {
      const g = globalThis as any, a = g.__capri;
      g.__capriIdleOverride = 0;
      g.__capriWindowsOverride = [{ handle: 777n, rect: { x: 100, y: 200, width: 700, height: 500 }, eligible: true }];
      g.__capriWindowInfo = { '777': { title: 'Synthetic paint', process: 'fixture.exe', pid: 7 } }; g.__capriForegroundHandle = 777n;
      // Render an actual controlled document. Never collect images of personal windows.
      const fixture = new BrowserWindow({ show: false, width: 300, height: 200, webPreferences: { offscreen: true, sandbox: true } });
      await fixture.loadURL('data:text/html,<body style="background:navy;color:white"><h1>SAPPHIRE</h1><p>Three coolant loops</p></body>');
      const image = await fixture.webContents.capturePage();
      g.__capriObservationOverride = { jpegBase64: image.toJPEG(80).toString('base64'), region: { x: 100, y: 200, width: 300, height: 200 } }; fixture.destroy();
      g.__inputs = []; g.__beforeBounds = a.charWin.getBounds();
      a.life.ledger.configure({ id: 'chrome', kind: 'chrome', name: 'Chrome', permissions: { collect: true, live: true, proactive: true, retain: true, content: true, learn: false }, sites: ['https://example.org'], retentionDays: 7, paused: false });
      a.runtime2.cognitive.provider = { models: async () => [{ id: 'synthetic', label: 'Synthetic', contextTokens: 128000, supportsImages: true }], shutdown() {}, infer: async (_m: unknown, input: any) => {
        g.__inputs.push(input); const n = g.__inputs.length;
        const call = (id: string, name: string, args: unknown) => ({ id, name, arguments: JSON.stringify(args) });
        if (n === 1) return { text: '', calls: [call('browser','get_browser_page',{}),call('pixels','capture_window',{ handle: '777' })] };
        if (n === 2) {
          const o = input.workingState.scene.facts.find((o: any) => o.modality === 'browser-page');
          return { text: '', calls: [call('save','write_memory',{ id: 'reactor', kind: 'investigation', text: 'Revisit the sapphire reactor coolant loops', provenance: 'host-observation', evidence: [o.id], status: 'active', dueAt: Date.now()+60000, expectedRevision: 0 }),call('attention','set_attention',{ afterMs: 60000, durationMs: 120000, inferenceIntervalMs: 60000, observationIntervalMs: 5000, source: 'screen' }),call('body','move',{ target: 'right' })] };
        }
        if (n === 4) return { text: '', calls: [call('perch','move',{ target: 'perch', handle: '777' })] };
        if (n === 6) return { text: '', calls: [call('closed','move',{ target: 'perch', handle: '777' })] };
        return { text: '', calls: [] };
      } };
      await a.runtime2.acceptPage({ recordId: 'active-page', revision: Date.now(), occurredAt: Date.now(), url: 'https://example.org/reactor', title: 'Reactor', headings: [], mode: 'semantic', sections: [{ kind: 'paragraph', level: 0, path: 'main', text: 'The sapphire reactor has three coolant loops.' }], description: '', selection: '', excerpt: '', incognito: false, focused: true, visible: true, operation: 'upsert' });
      await a.runtime2.send('Investigate the synthetic reactor, and position yourself if useful.');
    });
    await expect.poll(() => app!.evaluate(() => ({ busy: (globalThis as any).__capri.runtime2.chatState.busy, calls: (globalThis as any).__inputs.length })), { timeout: 10000 }).toEqual({ busy: false, calls: 3 });
    const result = await app.evaluate(async () => {
      const g = globalThis as any, a = g.__capri;
      return { records: (await a.runtime2.archive.conversation()).records, state: await a.runtime2.archive.findState({}), images: g.__inputs[1].images, before: g.__beforeBounds, after: a.charWin.getBounds(), attention: a.runtime2.attention.snapshot() };
    });
    expect(result.images).toHaveLength(1); expect(result.images[0].dataUrl).toMatch(/^data:image\/jpeg;base64,/);
    expect(result.records.find((r: any) => r.kind === 'tool-result' && r.requestId === 'body')).toMatchObject({ receipt: { outcome: 'completed' }, result: { ok: true } });
    expect(result.after).not.toEqual(result.before); expect(result.state).toMatchObject([{ id: 'reactor', evidence: [expect.any(String)], dueAt: expect.any(Number) }]);
    expect(result.attention).toMatchObject({ observationIntervalMs: 5000 });
    await app.evaluate(async () => { const a=(globalThis as any).__capri; await a.runtime2.send('Perch on the synthetic fixture.'); });
    await expect.poll(() => app!.evaluate(() => ({busy:(globalThis as any).__capri.runtime2.chatState.busy,calls:(globalThis as any).__inputs.length})),{timeout:10000}).toEqual({busy:false,calls:5});
    const perched=await app.evaluate(async()=>{const a=(globalThis as any).__capri;return{record:(await a.runtime2.archive.conversation()).records.find((r:any)=>r.kind==='tool-result'&&r.requestId==='perch'),body:a.runtime2.cognitive.host.body()};});
    expect(perched.record).toMatchObject({receipt:{outcome:'completed'},result:{ok:true}}); expect(perched.body.perchedWindow).toBe('777');
    await app.evaluate(async()=>{const g=globalThis as any;g.__capriWindowsOverride=[];await g.__capri.runtime2.send('The fixture closed; try only that same target.');});
    await expect.poll(() => app!.evaluate(() => ({busy:(globalThis as any).__capri.runtime2.chatState.busy,calls:(globalThis as any).__inputs.length})),{timeout:10000}).toEqual({busy:false,calls:7});
    const closed=await app.evaluate(async()=>{const a=(globalThis as any).__capri;return(await a.runtime2.archive.conversation()).records.find((r:any)=>r.kind==='tool-result'&&r.requestId==='closed');});
    expect(closed).toMatchObject({receipt:{outcome:expect.stringMatching(/^(failed|denied)$/)}});
    if(closed.result && 'ok' in closed.result)expect(closed.result.ok).toBe(false);
    await expect.poll(() => app!.evaluate(() => (globalThis as any).__capri.runtime2.cognitive.host.allowed('move')), {timeout:10000}).toBe(true);
    await app.evaluate(async () => {
      const g = globalThis as any, loop = g.__capri.runtime2.cognitive;
      let admitted = false;
      loop.ambientTrigger = () => { if (!admitted) { admitted = true; return 'source-change'; } };
      loop.provider.infer = async (_m: unknown, input: any) => {
        g.__inputs.push(input);
        return {text:'A little room over here.',calls:[{id:'ambient-reaction',name:'react',arguments:JSON.stringify({emotion:'curious'})},{id:'ambient-body',name:'move',arguments:JSON.stringify({target:'corner'})}]};
      };
      loop.kick();
    });
    await expect.poll(() => app!.evaluate(() => ({busy:(globalThis as any).__capri.runtime2.chatState.busy,calls:(globalThis as any).__inputs.length})),{timeout:10000}).toEqual({busy:false,calls:8});
    const ambient = await app.evaluate(async () => {
      const g = globalThis as any;
      return { route:g.__inputs[7].workingState.route, records:(await g.__capri.runtime2.archive.conversation()).records.filter((r:any)=>r.kind==='tool-result'&&r.requestId.startsWith('ambient-')) };
    });
    expect(ambient.route).toBe('ambient');
    expect(ambient.records).toMatchObject([{requestId:'ambient-reaction',receipt:{outcome:'dispatched'}},{requestId:'ambient-body',receipt:{outcome:'completed'}}]);
    await closeIsolatedApp(app); app = undefined;
    app = await electron.launch({ args: [path.resolve(__dirname, '../..')], env });
    await expect.poll(() => app!.evaluate(() => !!(globalThis as any).__capri?.runtime2)).toBe(true);
    const restarted = await app.evaluate(async () => { const a = (globalThis as any).__capri; const state = await a.runtime2.archive.findState({}); return { state, observation: await a.runtime2.observationById(state[0].evidence[0]) }; });
    expect(restarted.state).toEqual(result.state); expect(restarted.observation.content.sections[0].text).toContain('three coolant loops');
  } finally {
    await closeIsolatedApp(app);
    if (path.dirname(dir) !== path.join(os.homedir(), 'Documents', 'Capri Buddy 2.0 Synthetic')) throw Error('Unexpected synthetic profile');
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
