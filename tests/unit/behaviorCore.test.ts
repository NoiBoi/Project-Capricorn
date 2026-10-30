import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { BehaviorCore, type Decision, type Expression, type Trigger } from '../../scripts/behaviorHarness';
import { ConversationScene } from '../../src/main/store/conversationScene';
import { fact, hold, ask, START } from '../../src/main/behaviorExperiment/scenarios';
import type { LLMProvider } from '../../src/main/ai/providers';
const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true }); });
function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'capri-core-')); dirs.push(dir);
  let now = START, allowed = true, persistent = true, calls = 0, answer: unknown = hold, fail = false;
  const expressions: Expression[] = [], inputs: any[] = [];
  const provider: LLMProvider = { name: 'mock', local: true,
    async *stream(messages) { calls++; inputs.push(JSON.parse(messages[1].content)); if (fail) throw new Error('provider failed'); yield JSON.stringify(answer); },
    async test() { return { ok: true, detail: '' }; }, async listModels() { return []; } };
  const scene = new ConversationScene(dir, () => true, () => persistent, () => now);
  const make = (fallback = false) => new BehaviorCore({ directory: dir, scene, provider: () => provider, now: () => now, memories: () => [],
    allowed: () => allowed, persistent: () => persistent, hostRecordsScene: true,
    express(e) { expressions.push(e); return true; }, fallback: fallback ? () => ({ action: 'gesture', line: '', gesture: 'nod' }) : undefined });
  const trigger = (event = 'inspect'): Trigger => ({ kind: 'trigger', event, direct: true, detail: 'Test current situation', observation: fact() });
  return { dir, scene, provider, make, trigger, inputs, expressions, get calls() { return calls; },
    advance(ms: number) { now += ms; }, answer(x: unknown) { answer = x; }, suppress() { allowed = false; },
    noPersistence() { persistent = false; }, fail() { fail = true; } };
}
describe('integrated behavioral decision lifecycle', () => {
  it('saturates one semantic observation across changed capture hashes and restarts, and reopens on a content revision',async()=>{
    const s=setup();let core=s.make();const first={...s.trigger(),direct:false,context:{perceptionFingerprint:'content-v1'}};
    await core.dispatch(first);expect(s.calls).toBe(1);s.advance(60000);
    expect(core.perceptionSaturated(first.observation!.process,first.observation!.title,'content-v1')).toBe(true);
    const second={...first,observation:{...first.observation!,id:'another-capture',at:START+60000,detail:'Changed capture pixels, same document semantics.'}};
    expect((await core.dispatch(second)).action).toBe('silent');expect(s.calls).toBe(1);
    core=s.make();expect((await core.dispatch(second)).action).toBe('silent');expect(s.calls).toBe(1);
    await core.dispatch({...first,context:{perceptionFingerprint:'content-v2'}});expect(s.calls).toBe(2);
    s.advance(60000);await core.dispatch({...s.trigger('question'),context:{perceptionFingerprint:'content-v1'}});expect(s.calls).toBe(3);
  });
  it('retains visual understanding while converting crowded speech into a real nonverbal decision', async () => {
    const s=setup(); s.answer({ ...hold, action:'speak', line:'The violet swatch is the sharper choice.', gesture:'none' });
    const expressions: Expression[]=[];
    const core=new BehaviorCore({directory:s.dir,scene:s.scene,provider:s.provider,memories:()=>[],now:()=>START,maySpeak:()=>false,express:e=>{expressions.push(e);return true;}});
    const result=await core.dispatch(s.trigger());
    expect(result).toMatchObject({action:'gesture',line:'',delivered:true});
    expect(expressions[0]).toMatchObject({action:'gesture',gesture:'curious',line:''}); expect(core.pending()).toBe(true);
    expect(s.scene.snapshot().entries).toEqual([]);
  });
  it('accepts strict-schema null omissions and exposes a rejected decision without calling it quiet', async () => {
    const s = setup(), core = s.make();
    s.answer({ ...hold, interest: null, experience: null, taste: null, points: null, curiosity: null, facts: null, resolveExperience: null, interestDisposition: null });
    expect((await core.dispatch(s.trigger())).action).toBe(hold.action);
    expect(core.diagnostics().failure).toBeNull();
    s.answer({ ...hold, reason: undefined });
    const result = await core.dispatch({ ...s.trigger('pat'), budget: 'interaction', observation: undefined });
    expect(result.reason).toContain('Invalid decision fields: reason');
    expect(core.diagnostics().failure?.summary).toContain('reason');
    core.clear(); expect(core.diagnostics().failure).toBeNull();
  });
  it('passes explicit preview context to the same initiative policy without opening the background gate', async () => {
    const s = setup();
    const core = new BehaviorCore({ directory: s.dir, scene: s.scene, provider: s.provider, memories: () => [], now: () => START,
      allowed: e => e?.kind === 'trigger' && (e.context as { explicit?: boolean })?.explicit === true, express: () => true });
    const event = { ...s.trigger(), direct: false, context: { explicit: true } };
    expect(core.canInitiate()).toBe(false); expect(core.canInitiate(event)).toBe(true);
    expect((await core.dispatch(event)).action).toBe('defer'); expect(s.calls).toBe(1);
  });
  it('several observations inform one quiet interpretation and a later contact', async () => {
    const s = setup(), core = s.make();
    core.notice({ ...fact('music'), target: 'other', evidence: 'metadata', detail: 'A player is open; playback unknown.' });
    core.notice(fact()); expect(s.calls).toBe(0);
    await core.dispatch(s.trigger());
    expect(s.inputs[0].situation.facts).toHaveLength(2);
    expect(core.pending()).toBe(true); expect(s.expressions).toHaveLength(0);
    s.answer({ ...ask, interestDisposition: 'retain' });
    await core.dispatch({ ...s.trigger('pat'), observation: undefined, budget: 'interaction' });
    expect(s.inputs[1].situation.interests[0].topic).toContain('violet');
    expect(core.pending()).toBe(true);
    expect(s.scene.snapshot().entries).toHaveLength(0); // Host is the sole delivered-dialogue recorder.
  });
  it('a new capture ID for unchanged evidence refers to the canonical observation', async () => {
    const s = setup(), core = s.make(); core.notice(fact());
    await core.dispatch({ ...s.trigger(), observation: fact('new-capture') });
    expect(s.inputs[0].input.observation.id).toBe('color'); expect(core.pending()).toBe(true);
  });
  it('a changed document invalidates curiosity attached to the previous document', async () => {
    const s = setup(), core = s.make(); await core.dispatch(s.trigger());
    core.notice({ ...fact('new-document'), title: 'A different document' });
    expect(core.pending()).toBe(false); expect(core.snapshot().facts.some(f => f.id === 'color')).toBe(false);
  });
  it('chat retains an unfinished interest through an unrelated delivered answer', async () => {
    const s = setup(), core = s.make(); await core.dispatch(s.trigger());
    core.userInput('What caught your eye?'); expect(core.context()).toContain('violet');
    expect(core.canInitiate()).toBe(true);
    core.conversationDelivered(); expect(core.pending()).toBe(true);
    expect(core.snapshot().facts).toHaveLength(1);
  });
  it('explicit topic corrections invalidate old interpretations before generating a reply', async () => {
    const s = setup(), core = s.make(); await core.dispatch(s.trigger());
    core.userInput('Actually, new subject. Forget the palette.');
    expect(core.pending()).toBe(false); expect(core.snapshot().journal).toHaveLength(0);
  });
  it('offline and failed providers retain local gestures without inventing delivered speech', async () => {
    for (const offline of [true, false]) {
      const s = setup(), core = s.make(true);
      if (offline) Object.defineProperty(s.provider, 'name', { value: 'offline' }); else s.fail();
      const result = await core.dispatch(s.trigger('pat'));
      expect(result.action).toBe('gesture'); expect(s.calls).toBe(offline ? 0 : 1);
      expect(s.expressions[0].line).toBe(''); expect(s.scene.snapshot().entries).toHaveLength(0);
    }
  });
  it('privacy change removes persisted state and cancels a provider that ignores abort', async () => {
    const s = setup(), core = s.make(); await core.dispatch(s.trigger());
    let release!: () => void;
    s.provider.stream = async function* () { await new Promise<void>(r => { release = r; }); yield JSON.stringify(ask); };
    const pending = core.dispatch({ ...s.trigger('pat'), budget: 'interaction' });
    s.noPersistence(); core.privacyChanged(); release(); await pending;
    expect(core.snapshot().facts).toHaveLength(0); expect(s.expressions).toHaveLength(0);
    expect(fs.existsSync(path.join(s.dir, 'behavior-state.json'))).toBe(false);
  });
  it('off-the-record input cannot leak through contact or restart state', async () => {
    const s = setup(), core = s.make(); await core.dispatch(s.trigger());
    core.userInput('Off the record: this should not be saved.');
    expect(core.context()).toBe(''); await core.dispatch(s.trigger('pat'));
    expect(s.calls).toBe(1); expect(core.snapshot().facts).toHaveLength(0);
    expect(fs.existsSync(path.join(s.dir, 'behavior-state.json'))).toBe(false);
    core.userInput('Back to the public conversation.');
    expect(core.context()).not.toBe('');
  });
  it('late DND/visibility or target suppression cannot commit an interpretation or speech', async () => {
    for (const staleTarget of [true, false]) {
      const s = setup(), core = s.make(); let release!: () => void;
      s.provider.stream = async function* () { await new Promise<void>(r => { release = r; }); yield JSON.stringify(ask); };
      let valid = true; const pending = core.dispatch({ ...s.trigger(), valid: () => valid });
      if (staleTarget) valid = false; else s.suppress();
      release(); await pending; expect(s.expressions).toHaveLength(0); expect(core.pending()).toBe(false);
    }
  });
  it('point plans are accepted for a validated decision with a supplied image', async () => {
    const s = setup(), core = s.make(); const points: unknown[] = [];
    const decision: Decision = { ...hold, interest: null, action: 'investigate', gesture: 'curious' };
    s.answer({ ...decision, points: [{ x: .5, y: .4, label: 'visible swatch' }] });
    await core.dispatch({ ...s.trigger(), jpegBase64: 'fixture', points: p => points.push(...p) });
    expect(points).toHaveLength(1); expect(s.expressions[0].action).toBe('investigate');
  });
  it('a silent unified decision keeps visual readings and points without delivering speech', async () => {
    const s = setup(), core = s.make(), readings: unknown[] = [], points: unknown[] = [];
    s.answer({ ...hold, action: 'silent', facts: ['The green line leaves its enclosure.'], curiosity: 'Where does it reconnect?',
      points: [{ x: .5, y: .4, label: 'loose end' }, { x: 2, y: .5, label: 'invalid' }] });
    const result = await core.dispatch({ ...s.trigger(), jpegBase64: 'fixture', reading: r => readings.push(r), points: p => points.push(...p) });
    expect(result.action).toBe('silent'); expect(result.delivered).toBe(false); expect(s.expressions).toHaveLength(0);
    expect(readings).toMatchObject([{ facts: ['The green line leaves its enclosure.'], curiosity: 'Where does it reconnect?' }]);
    expect(points).toHaveLength(1); expect(core.pending()).toBe(true);
  });
  it('stale capture validation rejects environmental readings, points and persistent interests together', async () => {
    const s = setup(), core = s.make(), readings: unknown[] = [];
    s.answer({ ...hold, facts: ['A green branch.'], curiosity: 'Where does it go?', points: [{ x: .5, y: .4, label: 'branch' }] });
    await core.dispatch({ ...s.trigger(), jpegBase64: 'fixture', revalidate: async () => false, reading: r => readings.push(r), points: r => readings.push(r) });
    expect(readings).toEqual([]); expect(core.pending()).toBe(false); expect(s.expressions).toEqual([]);
  });
  it('metadata-only decisions cannot supply visual evidence or points', async () => {
    const s = setup(), core = s.make(), readings: unknown[] = [];
    s.answer({ ...hold, facts: ['An unsupported image claim.'], curiosity: 'An unseen detail.', points: [{ x: .5, y: .4, label: 'unseen' }] });
    await core.dispatch({ ...s.trigger(), reading: r => readings.push(r), points: r => readings.push(r) });
    expect(readings).toEqual([]);
  });
  it('an observation changed during final validation cannot record speech or a new interest', async () => {
    const s = setup(), core = s.make(); s.answer(ask);
    const result = await core.dispatch({ ...s.trigger(), revalidate: async () => false });
    expect(result.action).toBe('silent'); expect(s.expressions).toHaveLength(0); expect(core.pending()).toBe(false);
  });
  it('a cleared state cannot be recreated by a late media-validation callback', async () => {
    const s = setup(), core = s.make(); let release!: (value: boolean) => void;
    const validating = new Promise<boolean>(r => { release = r; });
    const pending = core.dispatch({ ...s.trigger(), revalidate: () => validating });
    await new Promise(r => setTimeout(r, 0)); core.clear(); release(false); await pending;
    expect(core.snapshot().journal).toHaveLength(0);
    expect(fs.existsSync(path.join(s.dir, 'behavior-state.json'))).toBe(false);
  });
  it('closed targets lose their interest and expired interpretations leave the working context', async () => {
    const s = setup(), core = s.make(); await core.dispatch(s.trigger());
    core.forgetTarget('window-42'); expect(core.pending()).toBe(false);
    s.advance(16 * 60000); expect(core.snapshot().journal).toHaveLength(0);
  });
  it('optional decisions use evidence and request budgets rather than a second speech cooldown', async () => {
    const s = setup(), core = s.make(); await core.dispatch({ ...s.trigger(), direct: false });
    expect(core.canInitiate()).toBe(true);
    await core.dispatch({ ...s.trigger('opportunity'), direct: false }); expect(s.calls).toBe(1);
    s.answer({ ...hold, interest: null, action: 'gesture', gesture: 'nod' });
    await core.dispatch({ ...s.trigger('pat'), observation: undefined, budget: 'interaction' });
    expect(s.calls).toBe(2);
  });
  it('local movement approval makes no model call and yields immediately to direct input', () => {
    const s = setup(), core = s.make(); expect(core.approveLocalMovement()).toBe(true);
    expect(s.calls).toBe(0); core.userInput('Stay with me.'); s.suppress(); expect(core.approveLocalMovement()).toBe(false);
  });
});
