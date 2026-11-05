import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { archiveWorkerPath } from '../helpers/runtime2Archive';
import { WindowFocusArchive } from '../../src/main/runtime2/windowFocusArchive';
import { selectRuntime } from '../../src/main/runtime2/selection';
import { CognitiveLoop } from '../../src/main/runtime2/cognitiveLoop';
import { TypedCapabilityExecutor } from '../../src/core/capabilities';
import { AttentionController } from '../../src/main/runtime2/attention';
import { Perception, type DesktopHost } from '../../src/main/runtime2/perception';
import { ChromePage, ChromeBridge } from '../../src/main/life/chrome';
import { LifeContext } from '../../src/main/life/context';
import type { CognitiveProvider, ModelInput } from '../../src/main/runtime2/cognitiveContracts';
import type { StateWrite } from '../../src/main/runtime2/canonicalState';
const cleanup: (() => Promise<unknown> | void)[] = [];
afterEach(async () => { for (const fn of cleanup.splice(0).reverse()) await fn(); });
async function fixture() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'capri-integrated-'));
  cleanup.push(() => fs.rmSync(home, { recursive: true, force: true }));
  const profile = selectRuntime({ CAPRI_RUNTIME: '2' }, home).profile!;
  const create = async (maxBytes = 128 * 1024 * 1024) => { const a = new WindowFocusArchive(profile, { workerPath: archiveWorkerPath, evidenceRetention: { maxAgeMs: 86400000, maxBytes } }); cleanup.push(() => a.close()); await a.initialize(); return a; };
  const archive = await create();
  let permitted = true;
  const host: DesktopHost = {
    windows: () => [{ handle: '42', pid: 7, process: 'synthetic.exe', title: 'Synthetic paint' }], active: () => '42',
    allowed: () => permitted,
    capture: vi.fn(async () => ({ jpegBase64: Buffer.from('synthetic-JPEG-only-a-storage-fixture').toString('base64'), region: { x: 0, y: 0, width: 200, height: 100 } })),
    move: vi.fn(async () => ({ ok: false, detail: 'Synthetic host cannot land here' })), body: () => ({ moving: false }),
  };
  return { archive, create, profile, host, deny: () => { permitted = false; } };
}
const model = { id: 'synthetic', label: 'Fixture', contextTokens: 128000, supportsImages: true };
it('allows an explicitly raised daily scheduler ceiling while preserving minimum spacing',()=>{
  let now=100000;const attention=new AttentionController(10000,10000,()=>now,1000);
  for(let i=0;i<121;i++){expect(attention.ready(true,true,false)).toBe(true);attention.started();expect(attention.ready(true,true,false)).toBe(false);now+=10000;}
});
const page = () => ChromePage.parse({ recordId: 'active-page', revision: Date.now(), occurredAt: Date.now(), url: 'https://example.org/article', title: 'Synthetic reactor', headings: ['Cooling'], mode: 'semantic', sections: [{ kind: 'paragraph', path: 'main', text: 'The sapphire reactor uses three coolant loops.' }], incognito: false, focused: true, visible: true });

it('automatically captures a textless browser page and supplies original pixels to the first model request', async()=>{
  const {archive,host}=await fixture();
  host.windows=()=>[{handle:'42',pid:7,process:'chrome.exe',title:'Synthetic reactor - Google Chrome',url:'https://example.org/article'}];
  const inputs:ModelInput[]=[];
  const loop=new CognitiveLoop(archive,{models:async()=>[model],shutdown(){},infer:async(_m,input)=>{inputs.push(input);return{text:'',calls:[]};}},new TypedCapabilityExecutor(),{model:model.id,host,ambientMs:60000});
  cleanup.push(()=>loop.shutdown());await loop.initialize();
  await loop.perception!.page({...page(),sections:[]},'extension');
  const observations=await archive.recent({limit:10});const visual=observations.find(o=>o.modality==='screenshot')!;
  expect(visual.related).toEqual([observations.find(o=>o.modality==='browser-page')!.id]);
  await loop.send('What is visible?');await idle(loop);
  expect(inputs[0].images).toEqual([{observationId:visual.id,capturedAt:visual.at,dataUrl:'data:image/jpeg;base64,'+Buffer.from('synthetic-JPEG-only-a-storage-fixture').toString('base64')}]);
  await loop.perception!.page({...page(),sections:[]},'extension');expect(host.capture).toHaveBeenCalledTimes(1);
  expect(await loop.perception!.currentImages('ambient',AbortSignal.timeout(1000))).toEqual([]);
  loop.perception!.clear();expect(await loop.perception!.currentImages('ambient',AbortSignal.timeout(1000))).toHaveLength(0);host.allowed=()=>false;expect(await loop.perception!.currentImages('ambient',AbortSignal.timeout(1000))).toEqual([]);
});

it('does not capture readable pages or mismatched windows and tolerates a failed automatic visual fallback',async()=>{
  const {archive,host}=await fixture();const perception=new Perception(archive,host,()=>{});
  await perception.page(page(),'extension');expect(host.capture).not.toHaveBeenCalled();
  await perception.page({...page(),sections:[]},'extension');expect(host.capture).not.toHaveBeenCalled();
  host.windows=()=>[{handle:'42',pid:7,process:'chrome.exe',title:'Synthetic reactor - Google Chrome',url:'https://example.org/article'}];
  host.capture=vi.fn(async()=>{throw Error('Target is covered');});perception.clear();
  await expect(perception.page({...page(),sections:[]},'extension')).resolves.toBeUndefined();
  expect(host.capture).toHaveBeenCalledTimes(1);expect(perception.current('direct').filter(o=>o.modality==='screenshot')).toEqual([]);
});

it('supplies retained pixels to ambient inference after focus metadata and leaving Chrome',async()=>{
  const {archive,host}=await fixture();host.windows=()=>[{handle:'42',pid:7,process:'chrome.exe',title:'Synthetic reactor - Google Chrome',url:'https://example.org/article'}];
  const inputs:ModelInput[]=[];
  const loop=new CognitiveLoop(archive,{models:async()=>[model],shutdown(){},infer:async(_m,input)=>{inputs.push(input);return{text:'',calls:[]};}},new TypedCapabilityExecutor(),{model:model.id,host,ambientMs:20});
  cleanup.push(()=>loop.shutdown());loop.environment(true);await loop.initialize();
  await loop.perception!.page({...page(),sections:[]},'extension');
  const visual=(await archive.recent({limit:10})).find(o=>o.modality==='screenshot')!;
  await loop.perception!.observe({id:'focus-after-capture',at:Date.now(),source:'desktop:foreground',sourceIdentity:visual.sourceIdentity,modality:'window-metadata',content:{handle:'42',process:'chrome.exe',title:'Synthetic reactor - Google Chrome'},provenance:{authority:'host',collector:'fixture',metadata:{}},loss:{truncated:false,missing:[]}});
  expect(await loop.perception!.currentImages('ambient',AbortSignal.timeout(1000))).toHaveLength(1);
  await loop.perception!.page({...page(),operation:'delete'},'extension');
  loop.environment(false);loop.notifyObservation(true);
  await expect.poll(()=>inputs.length).toBeGreaterThan(0);await idle(loop);
  expect(inputs[0].images?.[0].observationId).toBe(visual.id);
});

it('restores current semantic evidence when returning to an unchanged tab and distinguishes same-URL tabs', async () => {
  const { archive, host } = await fixture(); const perception = new Perception(archive, host, () => {});
  const a = page(), b = { ...page(), recordId: 'second-tab', title: 'Second tab' };
  await perception.page(a, 'extension'); const original = perception.current('direct')[0];
  await perception.page(b, 'extension'); const second = perception.current('direct')[0];
  expect(second.sourceIdentity).not.toBe(original.sourceIdentity);
  await perception.page({ ...a, revision: a.revision + 1 }, 'extension');
  const returned = perception.current('direct')[0]; expect(returned.content.sections).toEqual(a.sections); expect(returned.sourceIdentity).toBe(original.sourceIdentity);
  expect(returned.provenance.metadata.pageRecordId).toBe(a.recordId);
  expect(returned.id).toBe(original.id);
  const scene = await archive.readScene();
  expect(scene.coverage.recorded).toBe(3);
  expect(scene.recent.filter(o => o.source === 'chrome:activation')).toMatchObject([{ related: [original.id] }]);
});
const state = (id = 'cooling'): StateWrite => ({ id, kind: 'investigation', text: 'Revisit the three coolant loops.', provenance: 'model-interpretation', evidence: [], status: 'active', dueAt: Date.now() + 1000, expectedRevision: 0 });
const call = (id: string, name: string, args: unknown) => ({ id, name, arguments: JSON.stringify(args) });
async function idle(loop: CognitiveLoop) { await expect.poll(() => loop.state.busy).toBe(false); }

it('integrates original browser text, sequential inspection, memory, attention, a restart, due review and original recovery', async () => {
  const { archive, create, host } = await fixture();
  const inputs: ModelInput[] = []; let round = 0;
  const provider: CognitiveProvider = { models: async () => [model], shutdown() {}, infer: async (_m, input) => {
    inputs.push(input); round++;
    if (round === 1) return { text: '', calls: [call('page-read', 'get_browser_page', {})] };
    if (round === 2) {
      const result = input.records.findLast(r => r.kind === 'tool-result');
      expect(result).toMatchObject({ result: { observations: [{ content: { sections: [{ text: 'The sapphire reactor uses three coolant loops.' }] } }] } });
      const observed = (result as any).result.observations[0];
      return { text: '', calls: [call('memory-save', 'write_memory', { ...state(), evidence: [observed.id] }), call('attention-save', 'set_attention', { afterMs: 60000, durationMs: 120000, inferenceIntervalMs: 60000, observationIntervalMs: 5000, source: 'chrome' })] };
    }
    return { text: '', calls: [] };
  } };
  const loop = new CognitiveLoop(archive, provider, new TypedCapabilityExecutor(), { model: model.id, ambientMs: 60000, host });
  cleanup.push(() => loop.shutdown()); await loop.initialize(); await loop.perception!.page(page()); await loop.send('Look into the reactor.'); await idle(loop);
  const saved = await archive.findState({}); expect(saved).toHaveLength(1); expect(saved[0]).toMatchObject({ kind: 'investigation', revision: 1, evidence: [expect.any(String)] });
  expect(inputs).toHaveLength(3); expect(loop.attention.snapshot()).toMatchObject({ source: 'chrome', inferenceIntervalMs: 60000 });
  const originalId = saved[0].evidence[0]; const before = await archive.get(originalId);
  expect(before?.content.sections?.[0].text).toContain('three coolant');
  expect((await archive.conversation()).records.filter(r => r.kind === 'tool-result').every(r => r.kind === 'tool-result' && r.receipt.outcome === 'completed')).toBe(true);
  const scheduled = loop.attention.durableState();
  await loop.shutdown(); await archive.close(); const next = await create();
  expect(await next.readAttention()).toEqual(scheduled);
  await next.writeAttention({ ...scheduled, nextReviewAt: Date.now() - 1 });
  expect(await next.get(originalId)).toEqual(before); expect(await next.findState({})).toEqual(saved);
  // Make the saved absolute review deadline due, as elapsed wall time would after a restart.
  await next.putState({ ...state(), evidence: [originalId], dueAt: Date.now() - 1, expectedRevision: 1 });
  const subsequent: ModelInput[] = [];
  const resumed: CognitiveProvider = { models: async () => [model], shutdown() {}, infer: async (_m, input) => {
    subsequent.push(input);
    return subsequent.length === 1 ? { text: '', calls: [call('recover-original', 'retrieve_evidence', { observationId: originalId })] } : { text: 'Three loops, from that earlier reactor page.', calls: [] };
  } };
  const restarted = new CognitiveLoop(next, resumed, new TypedCapabilityExecutor(), { model: model.id, ambientMs: 30, host });
  cleanup.push(() => restarted.shutdown()); await restarted.initialize();
  await expect.poll(() => subsequent.length).toBe(2); await idle(restarted);
  expect(JSON.stringify(subsequent[0].workingState)).toContain('dueReviews'); expect(JSON.stringify(subsequent[0].workingState)).toContain('Revisit the three coolant loops');
  const recovered = subsequent[1].records.findLast(r => r.kind === 'tool-result');
  expect(recovered).toMatchObject({ requestId: 'recover-original', receipt: { outcome: 'completed' }, result: { original: { sections: [{ text: 'The sapphire reactor uses three coolant loops.' }] } } });
  expect((await next.findState({}))[0].reviewedAt).toBeGreaterThan(0);
  expect((await next.readAttention())?.nextReviewAt).toBeUndefined();
});

it('retains image originals off-journal, deduplicates captures, checks integrity and exposes missing evidence', async () => {
  const { archive, host, profile } = await fixture(); const perception = new Perception(archive, host, () => {});
  const first = await perception.inspect(undefined, true, 'direct', AbortSignal.timeout(1000));
  const second = await perception.inspect('42', true, 'direct', AbortSignal.timeout(1000)); expect(second.id).toBe(first.id);
  const blob = await archive.getEvidence(first.original!.id); expect(Buffer.from(blob!.data).toString()).toContain('synthetic-JPEG');
  expect(JSON.stringify(await archive.conversation())).not.toContain('synthetic-JPEG');
  const file = path.join(profile, 'runtime2/evidence', first.original!.id); fs.writeFileSync(file, 'corruption');
  await expect(archive.getEvidence(first.original!.id)).rejects.toThrow('integrity'); fs.unlinkSync(file);
  expect(await archive.getEvidence(first.original!.id)).toBeNull();
  await expect(archive.getEvidence('../outside')).rejects.toThrow('Invalid evidence');
});

it('clamps attention, expires bursts, honors structural wakeups, and limits hourly ambient traffic', () => {
  let now = 100000; const attention = new AttentionController(30000, 10000, () => now);
  const accepted = attention.adjust({ afterMs: 1000, durationMs: 3600000, inferenceIntervalMs: 1000, observationIntervalMs: 250, source: 'screen' });
  expect(accepted).toMatchObject({ inferenceIntervalMs: 10000, durationMs: 1800000 }); attention.started();
  now += 1000; expect(attention.ready(true, true, true)).toBe(false); now += 9000; expect(attention.ready(false, false, true)).toBe(true);
  for (let i = 0; i < 119; i++) { attention.started(); now += 10000; }
  expect(attention.ready(true, true, true)).toBe(false); now += 3600000; expect(attention.snapshot()).toBeNull(); expect(attention.ready(true, false, false)).toBe(true);
});

it('validates state provenance and corrections, and removes revoked evidence including binary files', async () => {
  const { archive, host, deny, profile } = await fixture(); const perception = new Perception(archive, host, () => {});
  await expect(archive.putState({ ...state(), provenance: 'user-statement' })).rejects.toThrow('User provenance');
  const saved = await archive.putState(state()); await expect(archive.putState(state())).rejects.toThrow('revision conflict');
  expect(await archive.putState({ ...state(), expectedRevision: saved.revision, status: 'completed' })).toMatchObject({ status: 'completed', revision: 2 });
  const capture = await perception.inspect('42', true, 'direct', AbortSignal.timeout(1000)); deny();
  await expect(perception.inspect('42', true, 'direct', AbortSignal.timeout(1000))).rejects.toThrow('denied');
  await archive.forgetSource('screen'); expect(await archive.get(capture.id)).toBeUndefined(); expect(await archive.findState({})).toEqual([]);
  expect(fs.readdirSync(path.join(profile,'runtime2/evidence'))).toEqual([]);
});

it('keeps Chrome authorization and sensitive-site checks before the raw Runtime 2 feed', async () => {
  const { profile } = await fixture(); const ledger = new LifeContext(profile); const sink = vi.fn(() => true);
  const bridge = new ChromeBridge(ledger, () => ({ token: '', extensionId: '' })); bridge.setRawSink(sink);
  expect(bridge.accept(page())).toBe(false);
  ledger.configure({ id: 'chrome', kind: 'chrome', name: 'Chrome', permissions: { collect: true, live: false, proactive: false, retain: true, content: true, learn: false }, sites: ['https://example.org'], retentionDays: 7, paused: false });
  expect(bridge.accept({ ...page(), url: 'https://example.org/login' })).toBe(false);
  expect(bridge.accept(page())).toBe(true); expect(sink).toHaveBeenCalledOnce(); expect(ledger.latest()).toEqual([]);
  ledger.flush();
});

it('returns failed physical receipts and supplies actual image input only to image-capable models', async () => {
  const { archive, host } = await fixture(); const inputs: ModelInput[] = [];
  const p: CognitiveProvider = { models: async () => [model], shutdown() {}, infer: async (_m, input) => { inputs.push(input); return inputs.length === 1 ? { text: '', calls: [call('capture','capture_window',{}), call('movement','move',{ target: 'corner' })] } : { text: '', calls: [] }; } };
  const loop = new CognitiveLoop(archive,p,new TypedCapabilityExecutor(),{ model: model.id, host }); cleanup.push(() => loop.shutdown()); await loop.initialize(); await loop.send('Inspect and choose a position'); await idle(loop);
  expect(inputs[1].images).toHaveLength(1); expect(inputs[1].images![0].dataUrl).toMatch(/^data:image\/jpeg;base64,/);
  expect(inputs[1].records.find(r => r.kind === 'tool-result' && r.requestId === 'movement')).toMatchObject({ receipt: { outcome: 'failed' }, result: { ok: false } });
});

it('bounds binary storage, removes crash orphans and expires source evidence during maintenance', async () => {
  const { archive, create, profile } = await fixture(); await archive.close(); const small = await create(1024);
  const first = await small.putEvidence(Buffer.alloc(700, 1), 'image/jpeg');
  const second = await small.putEvidence(Buffer.alloc(700, 2), 'image/jpeg');
  expect(await small.getEvidence(first.id)).toBeNull(); expect(await small.getEvidence(second.id)).not.toBeNull();
  const dir = path.join(profile, 'runtime2/evidence'), orphan = path.join(dir, 'a'.repeat(64)); fs.writeFileSync(orphan, 'crash orphan');
  await small.maintain(); expect(fs.existsSync(orphan)).toBe(false);
  const expiring = await small.putEvidence(Buffer.alloc(100,3), 'image/jpeg', Date.now()+100);
  await expect.poll(async () => { await small.maintain(); return small.getEvidence(expiring.id); }).toBeNull();
});

it('does not lose an old scheduled review behind a full recent-memory context window', async () => {
  const { archive } = await fixture();
  await archive.putState({ ...state('old-review'), dueAt: Date.now()+60000 });
  for (let i=0; i<55; i++) await archive.putState({ ...state('recent-'+i), kind: 'semantic', dueAt: null });
  expect((await archive.findState({ status: 'active', limit: 50 })).some(s => s.id === 'old-review')).toBe(false);
  expect(await archive.scheduledState()).toMatchObject([{ id: 'old-review' }]);
});

it('paginates long original pages and keeps duplicate raw evidence out of the journal', async () => {
  const { archive, host } = await fixture(); const inputs: ModelInput[] = []; let round=0;
  const p: CognitiveProvider = { models: async () => [model], shutdown() {}, infer: async (_m,input) => { inputs.push(input); return ++round===1 ? { text: '', calls: [call('read-long','get_browser_page',{offset:4,limit:4})] } : { text: '', calls: [] }; } };
  const loop = new CognitiveLoop(archive,p,new TypedCapabilityExecutor(),{model:model.id,host}); cleanup.push(()=>loop.shutdown()); await loop.initialize();
  await loop.perception!.page({ ...page(), sections: Array.from({length:80},(_,i)=>({ kind:'paragraph' as const, level:0,path:String(i),text:`section ${i} `+'x'.repeat(2990) })) });
  await loop.send('Inspect the next sections'); await idle(loop);
  const returned=inputs[1].records.findLast(r=>r.kind==='tool-result') as any;
  expect(returned.result.observations[0].content.sections).toHaveLength(4); expect(returned.result.observations[0].page.nextOffset).toBe(8);
  const stored=(await archive.conversation()).records.findLast(r=>r.kind==='tool-result') as any;
  expect(stored.result.evidenceReferences).toHaveLength(1); expect(JSON.stringify(stored)).not.toContain('section 4 ');
});

it('does not resurrect a page deleted while its original evidence was being stored', async () => {
  const { archive, host } = await fixture(); const perception = new Perception(archive, host, () => {});
  const original = archive.putEvidence.bind(archive); let release!: () => void;
  const spy = vi.spyOn(archive, 'putEvidence').mockImplementation(async (...args) => { await new Promise<void>(resolve => { release = resolve; }); return original(...args); });
  const pending = perception.page(page()); await expect.poll(() => !!release).toBe(true);
  await perception.page({ ...page(), operation: 'delete' }); release(); await pending;
  expect(perception.current('direct')).toEqual([]); spy.mockRestore();
  await perception.page(page()); expect(perception.current('direct')).toHaveLength(1);
});

it('does not attach pixels when the selected model lacks verified image input', async () => {
  const { archive, host } = await fixture(); const inputs: ModelInput[] = [];
  const p: CognitiveProvider = { models: async () => [{ ...model, supportsImages: false }], shutdown() {}, infer: async (_m,input) => { inputs.push(input); return inputs.length===1 ? { text:'',calls:[call('metadata-only','capture_window',{})] } : { text:'',calls:[] }; } };
  const loop = new CognitiveLoop(archive,p,new TypedCapabilityExecutor(),{model:model.id,host}); cleanup.push(()=>loop.shutdown()); await loop.initialize(); await loop.send('Inspect the fixture'); await idle(loop);
  expect(inputs[1].images).toBeUndefined();
  expect(inputs[1].records.findLast(r=>r.kind==='tool-result')).toMatchObject({result:{pixelsSupplied:false}});
});

it('executes a fifth-round memory write, returns its receipt to a sixth finishing request and restores it independently of model choice', async () => {
  const { archive, create, host } = await fixture(); const inputs: ModelInput[] = [];
  const p: CognitiveProvider = { models: async () => [model], shutdown() {}, infer: async (_m,input) => {
    inputs.push(input); const round = inputs.length;
    if (round < 5) return { text: '', calls: [call('read-'+round, 'get_archive_statistics', {})] };
    if (round === 5) return { text: '', calls: [call('fifth-save','write_memory',state('fifth'))], requestId: 'req_fifth', usage: { inputTokens: 100, outputTokens: 20 } };
    expect(input.tools).toEqual([]);
    expect(JSON.stringify(input.workingState)).toContain('"remainingExecutableRounds":0');
    expect(input.records.findLast(r=>r.kind==='tool-result')).toMatchObject({ requestId:'fifth-save',receipt:{outcome:'completed'},result:{id:'fifth',revision:1} });
    return { text: 'Saved the investigation.', calls: [] };
  } };
  const loop = new CognitiveLoop(archive,p,new TypedCapabilityExecutor(),{model:model.id,host,ambientMs:60000});
  cleanup.push(()=>loop.shutdown()); await loop.initialize(); await loop.send('Investigate and save a review.'); await idle(loop);
  expect(inputs).toHaveLength(6); expect(loop.state.inferences[4]).toMatchObject({requestId:'req_fifth',usage:{inputTokens:100,outputTokens:20}});
  const records = (await archive.conversation()).records;
  expect(records.find(r=>r.kind==='tool-call' && r.requestId==='fifth-save')).toMatchObject({inference:{requestId:'req_fifth',usage:{inputTokens:100,outputTokens:20}}});
  await loop.shutdown(); await archive.close(); const next=await create();
  expect(await next.findState({})).toMatchObject([{id:'fifth',revision:1}]);
  expect((await next.conversation()).records).toEqual(records);
});
it('reports structured native capture failures and leaves the receipt failed', async () => {
  const {archive,host}=await fixture(); host.capture=async()=>{throw {name:'NotAllowedError',message:'User gesture is required',code:0};};
  const inputs: ModelInput[]=[];
  const p: CognitiveProvider={models:async()=>[model],shutdown(){},infer:async(_m,input)=>{inputs.push(input);return inputs.length===1?{text:'',calls:[call('denied-capture','capture_window',{})]}:{text:'Capture was unavailable.',calls:[]};}};
  const loop=new CognitiveLoop(archive,p,new TypedCapabilityExecutor(),{model:model.id,host});cleanup.push(()=>loop.shutdown());await loop.initialize();await loop.send('Inspect');await idle(loop);
  expect(inputs[1].records.findLast(r=>r.kind==='tool-result')).toMatchObject({receipt:{outcome:'failed'},result:{error:{code:'window_capture_failed',name:'NotAllowedError',message:'User gesture is required'},pixelsSupplied:false}});
  expect(inputs[1].images).toBeUndefined();
});
it('distinguishes unpaired, paired-authorized, source-disallowed and controlled browser intake without exposing credentials', async () => {
  const {profile,archive,host}=await fixture();const ledger=new LifeContext(profile);
  const bridge=new ChromeBridge(ledger,()=>({token:'s'.repeat(32),extensionId:'a'.repeat(32)}),0);cleanup.push(()=>bridge.stop());
  expect(bridge.preflight().status).toBe('source-disallowed');
  ledger.configure({id:'chrome',kind:'chrome',name:'Test',permissions:{collect:true,live:true,proactive:true,retain:true,content:true,learn:false},sites:['https://example.org'],retentionDays:7,paused:false});
  expect(bridge.preflight().status).toBe('unavailable-or-unpaired');await bridge.start();
  expect(bridge.preflight('https://example.org/article').status).toBe('paired-authorized');
  expect(bridge.preflight('https://example.org/login').status).toBe('source-disallowed');expect(bridge.preflight('https://other.example/article').status).toBe('source-disallowed');
  const perception=new Perception(archive,host,()=>{});bridge.setRawSink(async (p,intake)=>{await perception.page(p,intake);return true;});
  expect(await bridge.accept(page())).toBe(true);expect(bridge.preflight().lastIntake).toBe('controlled-test');
  expect(perception.current('direct')[0].provenance).toMatchObject({collector:'controlled-test',metadata:{evidence:'controlled-test-intake'}});
  expect(JSON.stringify(bridge.preflight())).not.toContain('ssss');ledger.flush();
});


it('keeps the latest tab state and original recovery IDs without replaying old full snapshots or pixels', async () => {
  const { archive, host } = await fixture();
  host.windows = () => [{ handle: '42', pid: 7, process: 'chrome.exe', title: 'Synthetic reactor - Google Chrome' }];
  const inputs: ModelInput[] = [];
  const loop = new CognitiveLoop(archive, {
    models: async () => [model], shutdown() {},
    infer: async (_model, input) => { inputs.push(input); return { text: '', calls: [] }; },
  }, new TypedCapabilityExecutor(), { model: model.id, ambientMs: 60000, host });
  cleanup.push(() => loop.shutdown()); await loop.initialize();
  const initial = page();
  await loop.perception!.page(initial);
  const original = structuredClone(loop.perception!.current('direct')[0]);
  await loop.perception!.page({ ...initial, revision: initial.revision + 1 });
  expect((await archive.stats()).count).toBe(1);
  const next = { ...initial, revision: initial.revision + 2, occurredAt: initial.occurredAt + 2,
    sections: [{ ...initial.sections[0], text: 'The latest page has four loops.' }] };
  await loop.perception!.page(next);
  expect(loop.perception!.current('direct')[0].sourceIdentity).toBe(original.sourceIdentity);
  await loop.perception!.inspect(undefined, true, 'direct', AbortSignal.timeout(1000));
  await loop.send('Compare the page states.'); await idle(loop);
  expect(inputs[0].records.filter(r => r.kind === 'observation' && r.observation?.modality === 'browser-page')).toHaveLength(1);
  expect(inputs[0].workingState).toMatchObject({ recentChanges: expect.arrayContaining([expect.objectContaining({ id: original.id })]) });
  expect(inputs[0].images).toHaveLength(1);
  await loop.send('Continue the comparison.'); await idle(loop);
  expect(inputs[1].workingState).toMatchObject({ recentChanges: [] });
  expect(inputs[1].images).toBeUndefined();
  expect(await archive.get(original.id)).toEqual(original);
});

it('batches focus and media, backs off after silence, and reviews stable activity only when requested', () => {
  let now = 100_000;
  const attention = new AttentionController(30_000, 10_000, () => now);
  const started = now;
  expect(attention.reason(true, true, false, new Set(['screen']), started)).toBeUndefined();
  now += 3_000;
  expect(attention.reason(true, true, false, new Set(['screen']), started)).toBe('source-change');
  attention.started('source-change', new Set(['screen', 'old-source'])); attention.complete(true);
  now += 30_000;
  expect(attention.reason(true, false, false, new Set(['screen','old-source']))).toBeUndefined();
  expect(attention.reason(true, true, false, new Set(['screen','new-source']))).toBe('source-change');
  expect(attention.reason(true, false, false, new Set(['screen','new-source']))).toBe('batched-change');
  now += 600_000;
  expect(attention.reason(false, false, false)).toBeUndefined();
  expect(attention.reason(true, true, false)).toBe('source-change');
  attention.started('source-change');
  attention.adjust({ afterMs: 90_000, durationMs: 30_000, inferenceIntervalMs: 10_000, observationIntervalMs: 500, source: 'chrome', sourceIdentity: 'watched', priority: 'high', conditions: ['material-change'], ambient: 'watch-only' });
  now += 10_000;
  expect(attention.reason(true, false, false, new Set(['screen']))).toBeUndefined();
  expect(attention.reason(true, true, false)).toBeUndefined();
  attention.observe('chrome', 'other', ['material-change']);
  attention.observe('chrome', 'watched', ['content-changed']);
  expect(attention.reason(true, false, false)).toBeUndefined();
  const restarted = new AttentionController(30_000, 10_000, () => now);
  restarted.restore(attention.durableState());
  restarted.observe('chrome', 'watched', ['material-change']);
  expect(restarted.reason(true, false, false)).toBe('monitored-change');
  expect(restarted.matchedCondition).toMatchObject({ condition: 'material-change', source: 'watched' });
  now += 80_000;
  expect(attention.reason(false, false, false)).toBe('attention-review');
  restarted.observe('chrome', 'watched', ['material-change']);
  expect(restarted.matchedCondition).toBeUndefined();
  attention.adjust({ action: 'pause' });
  expect(attention.reason(true, true, false)).toBeUndefined();
  expect(attention.reason(false, false, true)).toBe('commitment-due');
  attention.adjust({ action: 'cancel' });
  expect(attention.reason(true, true, false)).toBe('source-change');
});

it('keeps unacknowledged scene versions across restart and does not acknowledge a racing write', async () => {
  const { archive, host, create } = await fixture();
  const perception = new Perception(archive, host, () => {});
  await perception.page(page());
  const first = await archive.readScene();
  expect(first.version).toBeGreaterThan(first.cursor);
  await perception.page({ ...page(), recordId: 'second', title: 'Second document' });
  await archive.acknowledgeScene(first.version);
  await archive.close();
  const restored = await create();
  const scene = await restored.readScene();
  expect(scene.cursor).toBe(first.version);
  expect(scene.changes).toMatchObject([{ content: { title: 'Second document' } }]);
  expect(scene.latest).toHaveLength(2);
});

it('uses ranked compact discovery and batches known originals, then invalidates revoked results', async () => {
  const { archive, host } = await fixture();
  const inputs: ModelInput[] = [];
  let originalId = '';
  const provider: CognitiveProvider = { models: async () => [model], shutdown() {}, infer: async (_m, input) => {
    inputs.push(input);
    if (inputs.length === 1) return { text: '', calls: [
      call('discover', 'search_observations', { search: 'sapphire coolant', modality: 'browser-page' }),
      call('batch', 'retrieve_evidence', { items: [{ observationId: originalId }, { observationId: 'absent' }] }),
    ] };
    return { text: '', calls: [] };
  } };
  const loop = new CognitiveLoop(archive, provider, new TypedCapabilityExecutor(), { model: model.id, host, ambientMs: 60_000 });
  cleanup.push(() => loop.shutdown());
  await loop.initialize();
  await loop.perception!.page(page());
  originalId = loop.perception!.current('direct')[0].id;
  await loop.send('Find the older reactor evidence.');
  await idle(loop);
  expect(inputs[1].records.find(r => r.kind === 'tool-result' && r.requestId === 'discover')).toMatchObject({
    result: { ranking: 'phrase then all terms then partial; BM25 ascending within tier', hits: [{ observation: { id: originalId } }] },
  });
  expect(inputs[1].records.find(r => r.kind === 'tool-result' && r.requestId === 'batch')).toMatchObject({
    result: { results: [{ observationId: originalId, result: { original: { sections: [{ text: expect.stringContaining('sapphire') }] } } },
      { observationId: 'absent', result: { status: 'missing' } }] },
  });
  expect((await archive.discover({ search: 'cerulean refrigerant' })).hits).toEqual([]);
  await archive.appendConversation({ id: 'older-dialogue', at: Date.now() - 86400000, kind: 'assistant', text: 'The thermal exchanger was inspected.' });
  expect((await archive.discover({ search: 'thermal exchanger', modality: 'dialogue' })).hits).toMatchObject([
    { dialogue: { id: 'older-dialogue' } },
  ]);
  expect((await archive.discover({ search: 'thermal exchanger schedule', modality: 'dialogue' })).hits).toMatchObject([
    { dialogue: { id: 'older-dialogue' }, tier: 2 },
  ]);
  await archive.forgetSource('chrome');
  expect((await archive.discover({ search: 'thermal exchanger', modality: 'dialogue' })).hits).toEqual([]);
  expect((await archive.discover({ search: 'sapphire' })).hits).toEqual([]);
  expect(await archive.get(originalId)).toBeUndefined();
});

it('persists checkpoint revisions and bounds durable investigation scheduling', async () => {
  const { archive, create } = await fixture();
  const input: StateWrite = { ...state('working-checkpoint'), kind: 'checkpoint', dueAt: null };
  await archive.putState(input);
  await archive.putState({ ...input, expectedRevision: 1, text: 'Corrected working hypothesis' });
  await archive.close();
  const restored = await create();
  expect(await restored.findState({ kind: 'checkpoint' })).toMatchObject([{ text: 'Corrected working hypothesis', revision: 2 }]);
  await expect(restored.putState({ ...input, expectedRevision: 1 })).rejects.toThrow('revision conflict');
  const dueAt = Date.now() + 60_000;
  for (let revision = 0; revision < 4; revision++) {
    await restored.putState({ ...state(), dueAt: dueAt + revision, expectedRevision: revision });
  }
  await expect(restored.putState({ ...state(), dueAt: dueAt + 5, expectedRevision: 4 })).rejects.toThrow('budget exhausted');
});

it('covers hundreds of transitions, expired evidence, and a write during inference', async () => {
  const { archive, create } = await fixture();
  const now = Date.now();
  const observation = (i: number) => ({
    id: 'burst-' + i, at: now + i, source: 'chrome', sourceIdentity: 'tab-' + i % 3,
    modality: 'browser-page' as const,
    content: { handle: '42', process: 'chrome.exe', title: 'Version ' + i },
    disclosure: { source: 'chrome' as const, retain: true, retainUntil: i === 1 ? now - 1 : now + 60000 },
    provenance: { authority: 'host' as const, collector: 'fixture', metadata: {} },
    loss: { truncated: false, missing: [] },
  });
  for (let i = 0; i < 300; i++) await archive.write(observation(i));
  const initial = await archive.readScene();
  expect(initial.coverage).toMatchObject({ recorded: 300, retained: 299, after: 0 });
  expect(initial.recent).toHaveLength(24);
  await archive.close();
  const restored = await create();
  const before = await restored.readScene();
  expect(before.coverage).toEqual(initial.coverage);

  const loop = new CognitiveLoop(restored, { models: async () => [model], shutdown() {}, async infer(_model, input) {
    expect(input.workingState).toMatchObject({
      sceneCoverage: { through: initial.version, recorded: 300, expiredOrDeleted: 1, full: 0, metadataOrExcerpt: 11, unexpandedRetained: 288 },
      episode: { through: initial.version, observations: 300, sampleHasMore: true },
    });
    await restored.write(observation(300));
    return { calls: [], text: '' };
  } }, new TypedCapabilityExecutor(), { model: model.id, ambientMs: 60000 });
  cleanup.push(() => loop.shutdown());
  await loop.initialize();
  await loop.send('Check the activity.');
  await idle(loop);
  expect(loop.state.phase).toBe('idle');
  expect((await restored.readScene()).coverage).toMatchObject({ after: initial.version, recorded: 1, retained: 1 });
  let after = 0, count = 0, missing = 0;
  while (after < initial.version) {
    const page = await restored.sceneEvents({ after, through: initial.version, limit: 23 });
    count += page.events.length;
    missing += page.events.filter(e => !e.observation).length;
    if (page.nextAfter === null) break;
    after = page.nextAfter;
  }
  expect([count, missing]).toEqual([300, 1]);
  await restored.forgetSource('chrome');
  expect(await restored.episodeList()).toEqual([]);
  expect((await restored.sceneEvents({ after: 0, through: initial.version, limit: 23 })).events).toEqual([]);
  expect(await restored.get('burst-0')).toBeUndefined();
});

it('ranks exact evidence before partial evidence and deduplicates across pages', async () => {
  const { archive } = await fixture();
  const now = Date.now();
  for (const [i, text] of ['sapphire coolant loop', 'sapphire coolant loop', 'sapphire replacement valve', 'coolant comes after sapphire'].entries()) {
    await archive.write({
      id: 'lexical-' + i, at: now + i, source: 'chrome', sourceIdentity: 'manual', modality: 'browser-page',
      content: { handle: null, process: 'chrome.exe', title: 'Manual', text },
      provenance: { authority: 'host', collector: 'fixture', metadata: {} }, loss: { truncated: false, missing: [] },
    });
  }
  const query = { search: 'sapphire coolant', limit: 1, source: 'manual' };
  const pages = await Promise.all([0, 1, 2, 3].map(offset => archive.discover({ ...query, offset })));
  expect(pages.map(page => page.hits.map(hit => 'observation' in hit && [hit.observation.id, hit.tier])))
    .toEqual([[['lexical-1', 0]], [['lexical-3', 1]], [['lexical-2', 2]], []]);
  expect((await archive.discover({ ...query, to: now })).hits).toMatchObject([{ observation: { id: 'lexical-0' } }]);
  expect((await archive.discover({ ...query, search: 'cerulean refrigerant' })).hits).toEqual([]);
});

it('restores a watch and recovers a matched event that was journaled before acknowledgment', async () => {
  const { archive, create } = await fixture();
  const controller = new AttentionController(60000, 10);
  controller.adjust({ source: 'chrome', sourceIdentity: 'watched', durationMs: 60000, inferenceIntervalMs: 10_000,
    observationIntervalMs: 1000, conditions: ['content-changed'], priority: 'high', afterMs: 30000, reviewIfUnchanged: true });
  await archive.writeAttention(controller.durableState());
  await archive.write({
    id: 'watch-recovery', at: Date.now(), source: 'chrome', sourceIdentity: 'watched', modality: 'browser-page',
    disclosure: { source: 'chrome', retain: true },
    content: { title: 'Changed document', process: 'chrome.exe', handle: null },
    provenance: { authority: 'host', collector: 'fixture', metadata: {} }, loss: { truncated: false, missing: [] },
  }, ['content-changed']);
  await archive.close();
  const restored = await create();
  const inputs: ModelInput[] = [];
  const loop = new CognitiveLoop(restored, { models: async () => [model], shutdown() {}, async infer(_model, input) {
    inputs.push(input);
    return { text: '', calls: [] };
  } }, new TypedCapabilityExecutor(), { model: model.id, ambientMs: 20 });
  cleanup.push(() => loop.shutdown());
  await loop.initialize();
  await expect.poll(() => inputs.length).toBe(1);
  await idle(loop);
  expect(inputs[0].workingState).toMatchObject({
    matchedCondition: { source: 'watched', condition: 'content-changed' },
    sceneCoverage: { recorded: 1, full: 0, metadataOrExcerpt: 1 },
  });
  expect((await restored.readScene()).coverage.recorded).toBe(0);
  expect((await restored.readAttention())?.nextReviewAt).toBeUndefined();
});

it('supplies bounded before and after excerpts for permitted browser changes', async () => {
  const { archive, host } = await fixture();
  const inputs: ModelInput[] = [];
  const loop = new CognitiveLoop(archive, { models: async () => [model], shutdown() {}, async infer(_model, input) {
    inputs.push(input);
    return { text: '', calls: [] };
  } }, new TypedCapabilityExecutor(), { model: model.id, host, ambientMs: 20 });
  cleanup.push(() => loop.shutdown());
  await loop.initialize();
  const at = Date.now();
  const observation = (id: string, text: string, related: string[] = []) => ({
    id, at, related, source: 'chrome', sourceIdentity: 'delta-tab', modality: 'browser-page' as const,
    content: { handle: null, process: 'chrome.exe', title: 'Delta fixture', url: 'https://example.org/delta', text },
    provenance: { authority: 'host' as const, collector: 'fixture', metadata: {} },
    loss: { truncated: true, missing: ['hidden-text'] },
  });
  await archive.write(observation('delta-before', 'Valve setpoint 200 kPa'));
  await archive.write(observation('delta-after', 'Valve setpoint 350 kPa', ['delta-before']));
  loop.notifyObservation(false, 'chrome', 'delta-tab', ['observation'], at, false);
  expect(loop.attention.matchedCondition).toBeUndefined();
  loop.notifyObservation(true);
  await expect.poll(() => inputs.length).toBe(1);
  await idle(loop);
  expect(inputs[0].workingState).toMatchObject({ contentDeltas: [{
    before: { id: 'delta-before', at, excerpt: 'Valve setpoint 200 kPa', sourceTruncated: true, excerptClipped: false },
    after: { id: 'delta-after', at, excerpt: 'Valve setpoint 350 kPa', sourceTruncated: true, excerptClipped: false },
  }] });
  host.allowed = (_operation, observation) => observation?.id !== 'delta-after';
  await archive.write(observation('delta-later', 'Valve setpoint 400 kPa', ['delta-after']));
  loop.notifyObservation(true);
  await expect.poll(() => inputs.length).toBe(2);
  await idle(loop);
  expect(inputs[1].workingState).not.toHaveProperty('contentDeltas');
});
