import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { _electron as electron, type ElectronApplication } from 'playwright-core';
import { expect, it, vi } from 'vitest';
vi.mock('electron', () => ({ app: {}, safeStorage: {}, shell: {} }));
import { encodeInput } from '../../src/main/runtime2/siwcProvider';
import { streamResponse } from '../../src/vendor/siwc-local/responses';
import { selectRuntime } from '../../src/main/runtime2/selection';
import { closeIsolatedApp } from './lifecycle';

it('captures an external controlled native window through production, sends JPEG pixels and restores evidence/state after restart', async () => {
  const env = { ...process.env, CAPRI_RUNTIME: '2', CAPRI_V2_PROFILE_ID: 'native-retest-' + randomUUID(), CAPRI_TEST: '1', CAPRI_OFFSCREEN: '1', CAPRI_NATIVE_OBSERVATION: '1', CAPRI_NO_DEV_KEY: '1', CAPRI_V2_MODEL: 'synthetic', CAPRI_V2_AMBIENT_MS: '3600000', CAPRI_V2_WINDOW_FOCUS: '0' };
  const profile = selectRuntime(env, os.homedir()).profile!;
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'capri-external-fixture-'));
  const entry = path.join(scratch, 'fixture.cjs');
  fs.writeFileSync(entry, `const {app,BrowserWindow}=require('electron');app.setPath('userData',${JSON.stringify(path.join(scratch, 'profile'))});app.whenReady().then(async()=>{globalThis.fixture=new BrowserWindow({width:860,height:620,x:80,y:80,show:true,webPreferences:{sandbox:true}});await fixture.loadURL('data:text/html,<title>Capri controlled native retest</title><body style="background:navy;color:white;font:30px Arial"><h1>LANTERN 5842</h1><svg width="700" height="300"><polygon points="100,20 40,145 160,145" fill="cyan"/><rect x="260" y="40" width="100" height="100" fill="orange"/><circle cx="540" cy="90" r="55" fill="violet"/></svg></body>');});`);
  fs.mkdirSync(profile, { recursive: true });
  fs.writeFileSync(path.join(profile, 'settings.json'), JSON.stringify({ firstRunComplete: true, ai: { provider: 'offline' }, memory: { enabled: true, autoLearn: false }, privacy: { saveHistory: true }, dialogue: { localContext: true }, actions: { policies: { read_screen: 'allow', teleport: 'deny' } }, voice: { ttsEnabled: false }, character: { startupIntro: false }, teleport: { auto: false } }));
  let fixture: ElectronApplication | undefined, app: ElectronApplication | undefined;
  try {
    fixture = await electron.launch({ args: [entry] }); await fixture.firstWindow();
    const handle = await fixture.evaluate(() => { const b = (globalThis as any).fixture.getNativeWindowHandle(); return String(b.length === 8 ? b.readBigUInt64LE() : BigInt(b.readUInt32LE())); });
    app = await electron.launch({ args: [path.resolve(__dirname, '../..')], env });
    await expect.poll(() => app!.evaluate(() => !!(globalThis as any).__capri?.runtime2)).toBe(true);
    await fixture.evaluate(() => { const w = (globalThis as any).fixture; w.setAlwaysOnTop(true, 'screen-saver'); w.show(); w.moveTop(); w.focus(); });
    await app.evaluate(async (_, handle) => {
      const g = globalThis as any, a = g.__capri, loop = a.runtime2.cognitive;
      // Mock only inference. Keep native window enumeration, permissions and capture intact.
      g.__inputs = [];
      loop.provider = { models: async () => [{ id: 'synthetic', label: 'Synthetic', contextTokens: 128000, supportsImages: true }], shutdown() {}, infer: async (_m: unknown, input: any) => {
        g.__inputs.push(input); const n = g.__inputs.length;
        const call = (id: string, name: string, args: unknown) => ({ id, name, arguments: JSON.stringify(args) });
        if (n === 1) return { text: '', calls: [call('native-capture', 'capture_window', { handle })] };
        if (n === 2) {
          const observation = input.records.find((r: any) => r.kind === 'tool-result' && r.requestId === 'native-capture').result.observation;
          if (!observation) return { text: 'Capture failed', calls: [] };
          return { text: '', calls: ['investigation','intention'].map(kind => call('save-' + kind, 'write_memory', { id: 'native-' + kind, kind, text: 'Review the controlled graphic evidence', provenance: 'host-observation', evidence: [observation.id], status: 'active', dueAt: Date.now() + 86400000, expectedRevision: 0 })) };
        }
        return { text: 'The controlled capture and both records are saved.', calls: [] };
      } };
      await a.runtime2.send('Inspect the controlled window and save its evidence for review.');
    }, handle);
    await expect.poll(() => app!.evaluate(() => (globalThis as any).__capri.runtime2.chatState.busy), { timeout: 20000 }).toBe(false);
    const result = await app.evaluate(async () => {
      const g = globalThis as any, a = g.__capri;
      const records = (await a.runtime2.archive.conversation()).records;
      return { records, state: await a.runtime2.archive.findState({}), inputs: g.__inputs };
    });
    const captured = result.records.find((r: any) => r.kind === 'tool-result' && r.requestId === 'native-capture');
    const diagnostic = await app.evaluate(async ({ desktopCapturer }, handle) => {
      const sources = await desktopCapturer.getSources({ types: ['window'], thumbnailSize: { width: 960, height: 640 } });
      const s = sources.find(s => s.id.split(':')[1] === handle);
      const a = (globalThis as any).__capri;
      return { source: s ? { id: s.id, empty: s.thumbnail.isEmpty(), size: s.thumbnail.getSize() } : null, target: a.runtime2.cognitive.host.windows().find((w: any) => w.handle === handle), rect: a.desktopWindows().find((w: any) => String(w.handle) === handle)?.rect };
    }, handle);
    expect(captured, JSON.stringify({ captured, diagnostic })).toMatchObject({ receipt: { outcome: 'completed' } });
    expect(result.inputs[1].images).toHaveLength(1);
    const image = result.inputs[1].images[0];
    expect(Buffer.from(image.dataUrl.split(',')[1], 'base64').subarray(0, 3).toString('hex')).toBe('ffd8ff');
    // Exercise the real encoding and SDK serialization, replacing only HTTP transport.
    let wire: any;
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
      wire = JSON.parse(init.body as string);
      return new Response('data: ' + JSON.stringify({ type: 'response.completed', response: { output: [] } }) + '\n\n', { headers: { 'content-type': 'text/event-stream' } });
    }));
    await streamResponse('synthetic-no-credential', { model: 'synthetic', input: encodeInput(result.inputs[1]) }, AbortSignal.timeout(2000));
    const wireImage = wire.input.flatMap((r: any) => Array.isArray(r.content) ? r.content : []).find((p: any) => p.type === 'input_image');
    expect(wireImage.image_url).toBe(image.dataUrl);
    vi.unstubAllGlobals();
    expect(result.state).toHaveLength(2);
    expect(result.records.filter((r: any) => r.kind === 'tool-result' && r.requestId.startsWith('save-')).every((r: any) => r.receipt.outcome === 'completed')).toBe(true);
    expect(result.records.at(-1)).toMatchObject({ kind: 'assistant', text: 'The controlled capture and both records are saved.' });
    await closeIsolatedApp(app); app = undefined;
    app = await electron.launch({ args: [path.resolve(__dirname, '../..')], env });
    await expect.poll(() => app!.evaluate(() => !!(globalThis as any).__capri?.runtime2)).toBe(true);
    const restored = await app.evaluate(async (_, id) => {
      const a = (globalThis as any).__capri, archive = a.runtime2.archive;
      const observation = await archive.get(id), blob = await archive.getEvidence(observation.original.id);
      const loop = a.runtime2.cognitive; (globalThis as any).__restoredInputs = [];
      loop.provider = { models: async () => [{ id: 'synthetic', label: 'Synthetic', contextTokens: 128000, supportsImages: true }], shutdown() {}, infer: async (_m: unknown, input: any) => {
        const inputs = (globalThis as any).__restoredInputs; inputs.push(input);
        return inputs.length === 1 ? { text: '', calls: [{ id: 'recover-native', name: 'retrieve_evidence', arguments: JSON.stringify({ observationId: id }) }] } : { text: 'Recovered the original image and review records.', calls: [] };
      } };
      await a.runtime2.send('Recover the earlier graphic evidence and review records.');
      return { state: await archive.findState({}), data: Buffer.from(blob.data).toString('base64') };
    }, image.observationId);
    expect(restored.state).toEqual(result.state); expect(restored.data).toBe(image.dataUrl.split(',')[1]);
    await expect.poll(() => app!.evaluate(() => (globalThis as any).__capri.runtime2.chatState.busy)).toBe(false);
    const resumed = await app.evaluate(() => (globalThis as any).__restoredInputs);
    expect(resumed[0].identity).toContain('native-intention');
    expect(resumed[1].images[0].dataUrl).toBe(image.dataUrl);
    if (process.env.CAPRI_RETEST_OUTPUT) {
      const output = path.resolve(process.env.CAPRI_RETEST_OUTPUT); fs.mkdirSync(output, { recursive: true });
      fs.writeFileSync(path.join(output, 'native-capture.jpg'), Buffer.from(restored.data, 'base64'));
      fs.writeFileSync(path.join(output, 'native-receipts.json'), JSON.stringify({ mockedInference: true, externalNativeFixture: true, productionCapture: true, sdkHttpBoundaryPixelsMatched: true, restoredImageMatched: true, records: result.records, state: result.state, restoredState: restored.state }, null, 2));
    }
  } finally {
    vi.unstubAllGlobals();
    await closeIsolatedApp(app); await closeIsolatedApp(fixture);
    if (path.dirname(profile) !== path.join(os.homedir(), 'Documents', 'Capri Buddy 2.0 Synthetic')) throw Error('Unexpected synthetic profile');
    fs.rmSync(profile, { recursive: true, force: true }); fs.rmSync(scratch, { recursive: true, force: true });
  }
});
