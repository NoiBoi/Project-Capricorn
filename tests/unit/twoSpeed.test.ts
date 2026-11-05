import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { archiveWorkerPath } from '../helpers/runtime2Archive';
import { WindowFocusArchive } from '../../src/main/runtime2/windowFocusArchive';
import { CognitiveLoop, type LoopOptions } from '../../src/main/runtime2/cognitiveLoop';
import { TypedCapabilityExecutor } from '../../src/core/capabilities';
import { AttentionController } from '../../src/main/runtime2/attention';
import { ambientDialogue, ambientState, encodeInput, encodeTools } from '../../src/main/runtime2/context';
import { selectAmbientDialogue } from '../../src/main/runtime2/dialogueSelection';
import { requestTextMeasure } from '../../src/main/runtime2/dailySession';
import { cognitiveEfficiency } from '../../src/main/runtime2/diagnostics';
import type { CognitiveProvider, ConversationRecord, ModelInput } from '../../src/main/runtime2/cognitiveContracts';
import type { CanonicalState } from '../../src/main/runtime2/canonicalState';
import type { Observation } from '../../src/main/runtime2/contracts';
import type { DesktopHost } from '../../src/main/runtime2/perception';
const cleanups: (() => Promise<unknown> | void)[] = [];
it('recovers whole project exchanges after hours and intervening unrelated dialogue without expiring unresolved context',async()=>{
  const {archive,wake,inputs,host}=await fixture(async()=>({text:'',calls:[]}));
  const at=Date.now()-8*3600000;
  await archive.appendConversation({id:'project-user',at,kind:'user',text:'Project Zephyr coolant layout is unresolved. Keep its valve question in mind.'});
  await archive.appendConversation({id:'project-answer',at:at+1,kind:'assistant',text:'The shared pressure valve needs checking.'});
  for(let n=0;n<20;n++){
    await archive.appendConversation({id:'other-u'+n,at:at+100+n*2,kind:'user',text:'Unrelated ordinary exchange '+n});
    await archive.appendConversation({id:'other-a'+n,at:at+101+n*2,kind:'assistant',text:'Another answer '+n});
  }
  const recent=(await archive.conversation(12,true)).records;
  const selected=await selectAmbientDialogue(archive,recent,0,['Project Zephyr'],[],new Set());
  expect(selected.filter(r=>r.id.startsWith('project-')).map(r=>r.id)).toEqual(['project-user','project-answer']);
  expect(JSON.stringify(selected).length).toBeLessThan(5000);
  expect(ambientDialogue(selected,0,Date.now()+365*86400000)).toEqual(selected);
  host.windows=()=>[{handle:'42',title:'Project Zephyr',process:'fixture.exe'}];
  await wake(observation());
  expect(inputs[0].records.filter(r=>r.id.startsWith('project-')).map(r=>r.id)).toEqual(['project-user','project-answer']);
});
afterEach(async () => { for (const clean of cleanups.splice(0).reverse()) await clean(); });
const model = { id: 'fixture', label: 'Fixture', contextTokens: 128000 };
const call = (id: string, name: string, args: unknown) => ({ id, name, arguments: JSON.stringify(args) });
const memory = (id: string, kind = 'interest', text = 'Curious how the coolant loops interact.') => ({ id, kind, text, provenance: 'model-interpretation', evidence: [], status: 'active', dueAt: null, expectedRevision: 0 });
function observation(id = 'reactor-page', text = 'The reactor routes sapphire coolant through three independent loops.'): Observation {
  return { id, at: Date.now(), source: 'chrome', sourceIdentity: 'reactor', modality: 'browser-page',
    content: { title: 'Reactor design', text, process: 'chrome.exe', handle: '42', url: 'https://example.org/reactor' },
    provenance: { authority: 'host', collector: 'fixture', metadata: {} }, loss: { truncated: false, missing: [] } };
}
async function fixture(infer: CognitiveProvider['infer'], options: LoopOptions = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'capri-two-speed-'));
  cleanups.push(() => fs.rmSync(root, { recursive: true, force: true }));
  const profile = path.join(root, 'Capri Buddy 2.0 Synthetic', 'two-speed');
  const archive = new WindowFocusArchive(profile, { workerPath: archiveWorkerPath });
  cleanups.push(() => archive.close()); await archive.initialize();
  const host: DesktopHost = { windows: () => [{ handle: '42', title: 'Reactor design', process: 'chrome.exe' }], active: () => '42', allowed: () => true,
    capture: async () => undefined, move: vi.fn(async () => ({ ok: true, detail: 'Verified fixture landing' })),
    react: vi.fn(async () => ({ ok: true, detail: 'Dispatched fixture clip' })), body: () => ({ moving: false }) };
  const inputs: ModelInput[] = [], emitted: { channel: string; payload: any }[] = [];
  const loop = new CognitiveLoop(archive, { models: async () => [model], shutdown() {}, infer: async (...args) => { inputs.push(args[1]); return infer(...args); } }, new TypedCapabilityExecutor(),
    { model: model.id, ambientMs: 20, host, emit: (channel,payload) => emitted.push({ channel,payload }), ...options });
  cleanups.push(() => loop.shutdown()); await loop.initialize();
  clearInterval((loop as any).timer);
  async function wake(o?: Observation) {
    if (o) await loop.perception!.observe(o);
    else loop.notifyObservation(true);
    // Fixed replay admission bypasses wall-clock pacing only, never tool execution or permissions.
    let pending = true;
    (loop as any).ambientTrigger = () => { if (pending) { pending = false; return 'source-change'; } };
    (loop as any).kick();
    await expect.poll(() => loop.state.busy).toBe(false);
    expect(loop.state.phase).toBe('idle');
  }
  return { archive, loop, inputs, host, emitted, wake, root: profile };
}
it('supplies actual current content for one-request grounded expression without tools or a memory prerequisite', async () => {
  const { wake, inputs, emitted, archive } = await fixture(async (_m, input) => {
    expect(JSON.stringify(encodeInput(input))).toContain('three independent loops');
    expect(input.tools.map(t => t.name)).toEqual(['write_memory','set_attention','move','react','investigate']);
    return { text: 'Three loops. Sensible paranoia.', calls: [] };
  });
  await wake(observation());
  expect(inputs).toHaveLength(1);
  expect(emitted.filter(e => e.channel === 'runtime2:speak')).toHaveLength(1);
  expect(await archive.findState({})).toEqual([]);
  const measure = requestTextMeasure({ instructions: inputs[0].identity, input: encodeInput(inputs[0]), tools: encodeTools(inputs[0]) });
  expect(measure.approximateTextTokens).toBeLessThan(5000);
});
it('finishes dialogue, a persistent semantic movement intention and a nonverbal reaction in one two-speed inference',async()=>{
  const {wake,inputs,host,archive,emitted}=await fixture(async()=>({text:'That valve has my attention.',calls:[
    call('accompany','move',{target:'accompany',posture:'sit',durationMs:120000}),call('ack','react',{emotion:'nod'})]}));
  await wake(observation());expect(inputs).toHaveLength(1);
  expect(host.move).toHaveBeenCalledWith('accompany',undefined,expect.any(AbortSignal),{target:'accompany',posture:'sit',durationMs:120000,pace:'gentle'});
  expect(host.react).toHaveBeenCalledWith('nod',expect.any(AbortSignal));
  expect(emitted.some(e=>e.channel==='runtime2:speak')).toBe(true);
  expect((await archive.conversation()).records.flatMap(r=>r.kind==='tool-result'?[r.receipt.outcome]:[])).toEqual(['completed','dispatched']);
});
it('retains silent curiosity and a checkpoint, moves and reacts with independent receipts, then connects later evidence', async () => {
  let round = 0;
  const { wake, inputs, archive, host, loop, root } = await fixture(async (_m,input) => {
    if (++round === 1) return { text: '', calls: [call('interest','write_memory',memory('coolant')), call('checkpoint','write_memory',memory('working-checkpoint','checkpoint','Noticed separate coolant loops; unresolved interaction.')), call('move','move',{target:'perch',handle:'42'}),call('react','react',{emotion:'curious'})] };
    expect(JSON.stringify(input.workingState)).toContain('unresolved interaction');
    expect(JSON.stringify(input.workingState)).toContain('coolant');
    return { text: 'That shared valve connects the loops after all.', calls: [] };
  });
  await wake(observation()); expect(inputs).toHaveLength(1);
  expect(host.move).toHaveBeenCalledOnce(); expect(host.react).toHaveBeenCalledOnce();
  const receipts = (await archive.conversation()).records.flatMap(r => r.kind === 'tool-result' ? [r.receipt.outcome] : []);
  expect(receipts).toEqual(['completed','completed','completed','dispatched']);
  await wake(observation('later','The three loops share a pressure relief valve.'));
  expect(inputs).toHaveLength(2);
  await loop.shutdown(); await archive.close();
  const reopened = new WindowFocusArchive(root, {workerPath:archiveWorkerPath});
  cleanups.push(() => reopened.close()); await reopened.initialize();
  expect(await reopened.findState({kind:'interest'})).toMatchObject([{id:'coolant',revision:1}]);
  expect(await reopened.findState({kind:'checkpoint'})).toMatchObject([{id:'working-checkpoint',text:expect.stringContaining('unresolved interaction')}]);
});
it('escalates only by a successful model decision, keeping its question and stopping condition in the same journal', async () => {
  let round = 0;
  const { wake, archive, inputs } = await fixture(async (_m,input) => {
    if (++round === 1) return { text: '', calls: [call('escalate','investigate',{id:'loop-question',expectedRevision:0,question:'Does the valve couple the loops?',stoppingCondition:'Recover the valve specification or report it missing.',evidence:['reactor-page']})] };
    if (round === 2) {
      expect((input.workingState as any).route).toBe('deep');
      expect(input.tools.some(t => t.name === 'retrieve_evidence')).toBe(true);
      expect(JSON.stringify(input)).toContain('Recover the valve specification');
      return { text: '', calls: [call('retrieve','retrieve_evidence',{observationId:'reactor-page'})] };
    }
    return { text: 'The supplied specification leaves the valve unresolved.', calls: [] };
  });
  await wake(observation()); expect(inputs).toHaveLength(3);
  expect(await archive.findState({kind:'investigation'})).toMatchObject([{id:'loop-question',revision:1,provenance:'model-interpretation'}]);
  expect((await archive.conversation()).records.some(r => r.kind === 'tool-result' && r.requestId === 'retrieve' && r.receipt.outcome === 'completed')).toBe(true);
});
it('does not escalate on denied state permission or accept an unoffered retrieval shortcut', async () => {
  const { wake, archive, inputs, host } = await fixture(async () => ({ text: '', calls: [call('denied','investigate',{id:'x',expectedRevision:0,question:'Why?',stoppingCondition:'One source.',evidence:[]}),call('shortcut','retrieve_evidence',{observationId:'reactor-page'})] }));
  host.allowed = operation => operation !== 'state';
  await wake(observation()); expect(inputs).toHaveLength(1);
  expect((await archive.conversation()).records.flatMap(r => r.kind === 'tool-result' ? [r.receipt.outcome] : [])).toEqual(['denied','denied']);
});
it('offers no escalation in lean comparison mode and retains tool continuations in layered mode', async () => {
  const lean = await fixture(async (_m,input) => { expect(input.tools.some(t => t.name === 'investigate')).toBe(false); return {text:'',calls:[]}; }, { cognition:'lean' });
  await lean.wake(observation()); expect(lean.inputs).toHaveLength(1);
  let count = 0;
  const layered = await fixture(async () => ++count === 1 ? {text:'',calls:[call('state','write_memory',memory('layered-interest'))]} : {text:'',calls:[]}, {cognition:'layered'});
  await layered.wake(observation()); expect(layered.inputs).toHaveLength(2);
});
it('records failed movements without a finishing request or an invented successful landing', async () => {
  const { wake, inputs, archive, host, emitted } = await fixture(async () => ({text:'',calls:[call('bad-landing','move',{target:'perch',handle:'42'})]}));
  host.move = async () => ({ok:false,detail:'Target closed'});
  await wake(observation()); expect(inputs).toHaveLength(1);
  expect((await archive.conversation()).records.at(-1)).toMatchObject({kind:'tool-result',receipt:{outcome:'failed'},result:{detail:'Target closed'}});
  expect(emitted.some(e => e.channel === 'runtime2:speak')).toBe(false);
});
it('prioritizes direct input during an ambient action and preserves its cancelled receipt', async () => {
  let inference = 0, moving = false;
  const { wake, loop, archive, host } = await fixture(async () => ++inference === 1
    ? {text:'',calls:[call('interrupted-move','move',{target:'corner'})]}
    : {text:'Here.',calls:[]});
  host.move = async (_target,_handle,signal) => {
    moving = true;
    await new Promise<void>(resolve => signal.addEventListener('abort', () => resolve(), {once:true}));
    return {ok:false,detail:'Stopped during movement.'};
  };
  const pending = wake(observation());
  await expect.poll(() => moving).toBe(true);
  await loop.send('Answer me first.'); await pending;
  expect(inference).toBe(2);
  expect((await archive.conversation()).records.find(r => r.kind === 'tool-result' && r.requestId === 'interrupted-move')).toMatchObject({receipt:{outcome:'cancelled'}});
});
it('restores a model-escalated investigation and resumes its due review with the original evidence after restart', async () => {
  let rounds = 0;
  const original = await fixture(async () => ++rounds === 1 ? {text:'',calls:[call('begin','investigate',{id:'persistent-question',expectedRevision:0,question:'What connects the coolant loops?',stoppingCondition:'Read the valve specification or report absence.',evidence:['reactor-page']})]} : {text:'',calls:[]});
  await original.wake(observation());
  const state = (await original.archive.findState({kind:'investigation'}))[0];
  const {revision,createdAt:_created,revisedAt:_revised,reviewedAt:_reviewed,scheduledReviews:_scheduled,...write} = state;
  await original.archive.putState({...write,dueAt:Date.now()-1,expectedRevision:revision});
  await original.loop.shutdown(); await original.archive.close();
  const archive = new WindowFocusArchive(original.root,{workerPath:archiveWorkerPath}); cleanups.push(() => archive.close()); await archive.initialize();
  const inputs: ModelInput[] = [];
  const resumed = new CognitiveLoop(archive,{models:async()=>[model],shutdown(){},infer:async(_m,input)=>{
    inputs.push(input);
    return inputs.length === 1 ? {text:'',calls:[call('recover','retrieve_evidence',{observationId:'reactor-page'})]} : {text:'The retained specification has three independent loops.',calls:[]};
  }},new TypedCapabilityExecutor(),{model:model.id,ambientMs:20,host:original.host});
  cleanups.push(() => resumed.shutdown()); await resumed.initialize(); clearInterval((resumed as any).timer); (resumed as any).kick();
  await expect.poll(() => resumed.state.busy).toBe(false);
  expect(inputs).toHaveLength(2); expect((inputs[0].workingState as any).route).toBe('deep');
  expect(JSON.stringify(inputs[0])).toContain('Read the valve specification');
  expect(JSON.stringify(inputs[1])).toContain('three independent loops');
});
it('keeps completed task dialogue recoverable while excluding it and its stale checkpoint from ambient context', async () => {
  const { wake, archive, inputs } = await fixture(async () => ({text:'',calls:[]}));
  await archive.appendConversation({id:'old-calibration',at:Date.now()-1000,kind:'user',text:'Exclusive calibration watch.'});
  await archive.putState({...memory('old-task','investigation','Calibration finished.'),evidence:['old-calibration'],status:'completed'} as any);
  await archive.putState({...memory('working-checkpoint','checkpoint','Earlier calibration instructions.'),evidence:['old-calibration']} as any);
  // Explicit shared provenance retires this task checkpoint without expiring unrelated exchanges.
  await archive.putState({...memory('old-task','investigation','Calibration finished.'),evidence:['old-calibration'],status:'completed',expectedRevision:1} as any);
  await (wake as any)(observation());
  expect(JSON.stringify(inputs[0])).not.toContain('Exclusive calibration watch.');
  expect(JSON.stringify(inputs[0])).not.toContain('Earlier calibration instructions.');
  expect(await archive.getDialogue('old-calibration')).toMatchObject({text:'Exclusive calibration watch.'});
});
it('supports a clean normal-attention baseline without deleting inherited dialogue, task state or durable watches', async () => {
  const { loop, archive, wake, inputs } = await fixture(async () => ({text:'',calls:[]}));
  await archive.putState({...memory('inherited','investigation'),dueAt:Date.now()-1} as any);
  loop.attention.adjust({source:'chrome',durationMs:60000,inferenceIntervalMs:10000,observationIntervalMs:1000,ambient:'watch-only'});
  await archive.writeAttention(loop.attention.durableState());
  const baseline = await loop.diagnosticBaseline(true);
  expect(baseline.restored.attention).toMatchObject({ambient:'watch-only'}); expect(loop.attention.snapshot()).toBeNull();
  await wake(observation()); expect((inputs[0].workingState as any).route).toBe('ambient');
  expect(JSON.stringify((inputs[0].workingState as any).activeState)).not.toContain('inherited');
  expect(await archive.findState({})).toHaveLength(1); expect(await archive.readAttention()).toMatchObject({request:{ambient:'watch-only'}});
});
it('scopes silence to prior sources and bounds recovery for an unavailable exclusive watch', () => {
  let now = 100000;
  const attention = new AttentionController(30000,10000,()=>now);
  attention.started('source-change',new Set(['chrome','old'])); attention.complete(true); now += 30000;
  expect(attention.reason(true,false,false,new Set(['chrome','old']))).toBeUndefined();
  expect(attention.reason(true,false,false,new Set(['chrome','new']))).toBe('batched-change');
  attention.adjust({source:'chrome',sourceIdentity:'watched',durationMs:180000,inferenceIntervalMs:10000,observationIntervalMs:1000,ambient:'watch-only'});
  attention.sourceAvailability('chrome',false); now += 120000; attention.sourceAvailability('chrome',false);
  expect(attention.reason(false,false,false)).toBe('attention-review');
  attention.acknowledge(attention.reviewAt); attention.started('attention-review');
  expect(attention.reason(true,true,false)).toBeUndefined();
  now += 60001; expect(attention.snapshot()).toBeNull();
  expect(attention.reason(true,true,false)).toBe('source-change');
});
it('preserves coherent exchanges and relevant interests while measuring actual encoded text separately from images', () => {
  const records: ConversationRecord[] = [
    {id:'u',kind:'user',text:'A useful recent question',at:100,sequence:1}, {id:'a',kind:'assistant',text:'Its answer',at:101,sequence:2},
  ];
  expect(ambientDialogue(records,0,200)).toEqual(records);
  expect(ambientDialogue(records,101,200)).toEqual([]);
  const state = (id:string, revisedAt:number, evidence:string[]) => ({...memory(id),revision:1,createdAt:1,revisedAt,evidence}) as CanonicalState;
  const selected = ambientState([state('recent',10,[]),state('relevant',1,['page'])],new Set(['page']),[]);
  expect(selected[0].id).toBe('relevant');
  const measurement = requestTextMeasure({input:[{type:'input_image',image_url:'data:image/jpeg;base64,'+'a'.repeat(100000)}],instructions:'Character instructions'});
  expect(measurement.attachedImages).toBe(1); expect(measurement.textUtf8Bytes).toBeLessThan(300); expect(measurement.imageTokens).toBeNull();
  expect(cognitiveEfficiency([]).humanScoringRequired).toContain('unnecessary silence');
});
