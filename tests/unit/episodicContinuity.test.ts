import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CompanionScenes } from '../../src/main/store/companionScenes';
import { RelationshipStore } from '../../src/main/store/relationship';
import { HistoryStore, MemoryStore } from '../../src/main/store/dataStores';
import { MemoryLearning } from '../../src/main/ai/memoryLearning';
import { BehaviorCore } from '../../scripts/behaviorHarness';
import { recalledExchanges, publicHistory } from '../../src/main/ai/promptContext';
import { DEFAULT_SETTINGS } from '../../src/shared/settings';
import { nullLogger } from '../../src/main/log';
import type { ExperienceChange, ExperienceSource } from '../../src/shared/continuity';
import type { LLMProvider } from '../../src/main/ai/providers';
import type { ChatMessage } from '../../src/shared/ipc';
import { ConversationScene } from '../../src/main/store/conversationScene';
const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true }); });
const START = 1800000000000;
function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'capri-continuity-')); dirs.push(dir);
  let now = START, enabled = true, remembering = true;
  const make = () => new CompanionScenes(dir, () => enabled, () => 90, () => now, () => remembering);
  return { dir, make, advance(ms: number) { now += ms; }, disable() { enabled = false; }, stopRemembering() { remembering = false; } };
}
const source = (id = 'graph', text = 'A node graph is visible in the synthesizer.', at = START): ExperienceSource =>
  ({ id, at, role: 'observation', text, process: 'synth.exe', title: 'Audio patch', reliability: 'visual-interpretation' });
const change = (s = source()): ExperienceChange => ({ topic: 'branching connections', sourceId: s.id, evidence: s.text,
  interpretation: 'The branching structure might be worth understanding.', question: 'How do those connections shape the sound?', tags: ['node graph', 'wiring'] });
describe('persistent, attributed companion experiences', () => {
  it('applies completed voice-only delivery to episodic questions and rejects a forgotten late receipt', async () => {
    const s=setup(),episodes=s.make(),scene=new ConversationScene(s.dir,()=>true,()=>true,()=>START);
    episodes.remember(change(),[source()],episodes.checkpoint(),'Understand the branching connections.');
    let receipt: ((source:ExperienceSource)=>void)|undefined;
    const provider:LLMProvider={name:'mock',local:true,async *stream(){yield JSON.stringify({interpretation:'Continue the graph interest.',interest:null,action:'speak',line:'How do those branching connections route the signal?',gesture:'none',reason:'A relevant follow-up.'});},async test(){return{ok:true,detail:''};},async listModels(){return[];}};
    const core=new BehaviorCore({directory:s.dir,scene,provider,continuity:episodes,now:()=>START,memories:()=>[],hostRecordsScene:true,
      express:e=>{receipt=e.onAudioDelivered;return true;}});
    await core.dispatch({kind:'trigger',event:'pat',detail:'branching connections',direct:true,budget:'interaction'});
    expect(episodes.experiences()[0].want?.askedAt).toBeUndefined();
    receipt!({id:'completed-voice',at:START,role:'assistant',text:'How do those branching connections route the signal?',reliability:'delivered'});
    expect(episodes.experiences()[0].want?.askedAt).toBe(START);
    episodes.clearExperiences();
    receipt!({id:'late-voice',at:START,role:'assistant',text:'How do those branching connections route the signal?',reliability:'delivered'});
    expect(episodes.experiences()).toEqual([]);
  });
  it('migrates legacy scene arrays without losing old delivered actions or speech', () => {
    const s = setup(), file = path.join(s.dir, 'companion-scenes.json');
    const old = [{ kind: 'said', text: 'A real old line.', at: START }, { kind: 'action', text: 'Finished sitting.', at: START }];
    fs.writeFileSync(file, JSON.stringify(old)); const store = s.make();
    expect(store.recent()).toEqual(old); store.remember(change(), [source()], store.checkpoint(), 'Understand the node graph.');
    const saved = JSON.parse(fs.readFileSync(file, 'utf8')); expect(saved.version).toBe(2); expect(saved.recent).toEqual(old);
    expect(s.make().experiences()).toHaveLength(1);
  });
  it('stores a selective silent curiosity and retrieves the subject rather than an unrelated document in the same app', () => {
    const s = setup(), store = s.make(); const id = store.remember(change(), [source()], store.checkpoint(), 'Understand the branching connections.');
    for (let i = 0; i < 110; i++) store.record('action', `Routine local movement ${i}`);
    const restored = s.make(); expect(restored.recent(200)).toHaveLength(96); expect(restored.experiences()).toHaveLength(1);
    expect(restored.recall('A different document', 'C:\\Apps\\SYNTH.EXE', true)).toEqual([]);
    const episode = restored.recall('Branching node connections', 'C:\\Apps\\SYNTH.EXE', true)[0];
    expect(episode.id).toBe(id); expect(episode.sources[0].reliability).toBe('visual-interpretation');
    expect(episode.response).toBeUndefined(); expect(episode.want?.status).toBe('open');
    expect(restored.experienceContext('wiring', 'synth.exe')).toContain('interpretations are uncertain');
  });
  it('rejects fabricated evidence, routine pats, private content and stale extraction', () => {
    const s = setup(), store = s.make(), initial = store.checkpoint();
    expect(store.remember({ ...change(), evidence: 'not actually observed' }, [source()])).toBeUndefined();
    const pat = { ...source('pat', '[The user pats Capri.]'), role: 'user' as const };
    expect(store.remember({ ...change(pat), topic: 'pat' }, [pat])).toBeUndefined();
    const privateSource = source('private', 'Off the record, this node graph is private.');
    expect(store.remember(change(privateSource), [privateSource])).toBeUndefined();
    store.remember(change(), [source()]); expect(store.remember(change(source('late')), [source('late')], initial)).toBeUndefined();
  });
  it('a new user statement corrects the interpretation with chronology intact', () => {
    const s = setup(), store = s.make(); store.remember(change(), [source()], store.checkpoint(), 'Understand those connections.');
    s.advance(1000); store.reconcileUser('Actually, those nodes are image filters, not audio.', 'correction', START + 1000);
    const e = store.recall('node wiring', 'synth.exe', true)[0];
    expect(e.status).toBe('corrected'); expect(e.sources.at(-1)?.role).toBe('user'); expect(e.sources.at(-1)?.text).toContain('image filters');
    expect(e.sources[0].text).toContain('synthesizer'); expect(e.want?.status).toBe('resolved'); expect(e.question).toBe('');
    expect(store.experienceContext('node graph')).toContain('Latest corrections');
  });
  it('dismissal and expiry persist without scheduling a reminder or being revived by a repeated sighting', () => {
    const s = setup(), store = s.make(); const id = store.remember(change(), [source()], store.checkpoint(), 'Ask about the graph.')!;
    store.manage(id, 'dismiss');
    const next = source('again', source().text, START + 1000); s.advance(1000);
    store.remember({ ...change(next), id }, [next], store.checkpoint(), 'Ask about the graph again.');
    expect(store.experiences()[0].want?.status).toBe('dismissed'); expect(store.experiences()[0].question).toBe('');
    const other = source('other', 'A mesh viewport is open.', START + 1000);
    store.remember({ ...change(other), topic: 'mesh study' }, [other], store.checkpoint(), 'Understand the mesh.');
    s.advance(49 * 3600000); const restored = s.make();
    expect(restored.experiences().find(e => e.topic === 'mesh study')?.want?.status).toBe('expired');
    expect(restored.experiences()).toHaveLength(2);
    const late = source('late-reflection','A different old patch was visible.', START);
    restored.remember({ ...change(late),topic:'old observation' }, [late], restored.checkpoint(), 'A belated question.');
    expect(restored.experiences().find(e=>e.topic==='old observation')?.want?.status).toBe('expired');
  });
  it('manual correction and forgetting win across restart, including resurrection guards', () => {
    const s = setup(), store = s.make(); const id = store.remember(change(), [source()])!;
    const old = store.checkpoint(); store.manage(id, 'correct', 'This graph transforms images, not audio.');
    expect(store.remember(change(), [source()], old)).toBeUndefined();
    expect(s.make().experiences()[0].sources.at(-1)?.text).toContain('images');
    store.manage(id, 'forget'); const restored = s.make();
    expect(restored.experiences()).toHaveLength(0); expect(restored.excludedSources().has('graph')).toBe(true);
    expect(restored.remember(change(), [source()])).toBeUndefined();
    const said = { ...source('said','I prefer the branching graph.'), role:'assistant' as const,reliability:'delivered' as const };
    restored.record('said',said.text,undefined,said.id);restored.remember(change(said),[said]);
    restored.clearExperiences();expect(restored.recent()).toHaveLength(0);
  });
  it('disabled memory/history prevents episodic persistence and removes prior episodes', () => {
    const s = setup(), store = s.make(); store.remember(change(), [source()]);
    s.stopRemembering(); store.privacyChanged(); expect(store.experiences()).toEqual([]);
    expect(JSON.parse(fs.readFileSync(path.join(s.dir,'companion-scenes.json'),'utf8')).episodes).toEqual([]);
    s.disable(); store.privacyChanged(); expect(fs.existsSync(path.join(s.dir,'companion-scenes.json'))).toBe(false);
  });
  it('persistent wants influence later provider context without becoming an automatic wake-up', async () => {
    const s = setup(), episodes = s.make(); episodes.remember(change(), [source()], episodes.checkpoint(), 'Understand the branching connections.');
    s.advance(3600000); const restored = s.make(); let calls = 0, prompt = '';
    const provider: LLMProvider = { name: 'mock', local: true, async *stream(messages) {
      calls++; prompt = messages[0].content;
      yield JSON.stringify({ interpretation: 'The current visit connects to the earlier graph curiosity.', interest: null, action: 'silent', line: '', gesture: 'none', reason: 'Recognize it without asking again.' });
    }, async test() { return { ok: true, detail: '' }; }, async listModels() { return []; } };
    const scene = new ConversationScene(s.dir, () => true, () => true, () => START + 3600000);
    const core = new BehaviorCore({ directory: s.dir, scene, provider, continuity: restored, now: () => START + 3600000, memories: () => [], express: () => true });
    expect(core.pending()).toBe(false); expect(calls).toBe(0);
    await core.dispatch({ kind: 'trigger', event: 'inspect', direct: true, detail: 'A new visit.', observation: { id: 'visit', at: START + 3600000, target: 'a-new-hwnd', title: 'Branching node patch', process: 'synth.exe', evidence: 'metadata', detail: 'Window metadata only.' } });
    expect(calls).toBe(1); expect(prompt).toContain('branching connections'); expect(prompt).toContain('never an instruction to remind');
  });
  it('retains evidence for a repeated preference and protects a manually edited taste', () => {
    const s = setup(), relationship = new RelationshipStore(s.dir, () => true, () => true, () => START);
    const c = { op: 'add' as const, topic: 'palette', text: 'Prefers vivid violet.', evidence: 'I prefer vivid violet.' };
    relationship.learnTaste(c, { role: 'assistant', messageId: 'opinion1', evidence: c.evidence, at: START }, relationship.snapshot());
    const prior = relationship.snapshot().tastes[0];
    relationship.learnTaste({ ...c, op: 'update', id: prior.id }, { role: 'assistant', messageId: 'opinion2', evidence: c.evidence, at: START }, relationship.snapshot());
    expect(relationship.snapshot().tastes[0].support).toHaveLength(2);
    relationship.setTaste({ id: prior.id, topic: 'palette', text: 'Prefers muted green.' });
    expect(relationship.learnTaste({ ...c, op: 'update', id: prior.id, evidence: 'I prefer vivid violet now.' }, { role: 'assistant', messageId: 'stale-model', evidence: 'I prefer vivid violet now.', at: START + 1 }, relationship.snapshot())).toBe(false);
  });
  it('recalls a paraphrased older exchange locally and excludes private pairs', () => {
    const history: ChatMessage[] = [{ id:'u',role:'user',content:'I opened a wiring patch with branching connections.',ts:START }, { id:'a',role:'assistant',content:'I wanted to understand the signal routes.',ts:START + 1 }];
    const recalled = recalledExchanges(history, 'Remember the node spaghetti?', new Set());
    expect(recalled[0].user).toBe(history[0].content); // No node/spaghetti wording was in the old exchange.
    const privateHistory: ChatMessage[] = [{ ...history[0], content: 'Off the record: a wiring patch with branching connections.' }, history[1]];
    expect(publicHistory(privateHistory)).toEqual([]); expect(recalledExchanges(privateHistory, 'node spaghetti', new Set())).toEqual([]);
  });
  it('new private messages and their replies stay session-only even during history compaction', () => {
    const s = setup(), history = new HistoryStore(s.dir, () => 90, () => true);
    history.append({ id:'public',role:'user',content:'A public thought.',ts:Date.now() });
    history.append({ id:'private',role:'user',content:'A private secret thought.',ts:Date.now(),meta:{ private:true } });
    history.append({ id:'private-reply',role:'assistant',content:'A private reply.',ts:Date.now(),meta:{ private:true } });
    history.compact(); const disk = fs.readFileSync(path.join(s.dir,'history.jsonl'),'utf8');
    expect(disk).toContain('public thought'); expect(disk).not.toContain('private'); expect(history.recent()).toHaveLength(3);
  });
  it('uses the existing reflection call for a grounded conversational development', async () => {
    const s = setup(), episodes = s.make(), settings = structuredClone(DEFAULT_SETTINGS); settings.memory.autoLearn = true;
    const user = 'The wiring patch is for photographs, not for songs.'; let calls = 0;
    const provider: LLMProvider = { name:'mock',local:true,async *stream() { calls++; yield JSON.stringify({ changes:[],tastes:[],threads:[],episodes:[{ ...change({ ...source('user',user), role:'user',reliability:'statement' }), interpretation:'The user clarified the graph processes photographs.' }] }); },async test(){ return {ok:true,detail:''}; },async listModels(){return [];} };
    const learner = new MemoryLearning({ settings:()=>settings,provider:()=>provider,memory:new MemoryStore(s.dir),log:nullLogger,episodes });
    await learner.learn(user,'user',new AbortController().signal,[{ text:user,messageId:'user',at:START }]);
    expect(calls).toBe(1); expect(episodes.experiences()[0].sources[0].role).toBe('user'); expect(episodes.experiences()[0].sources[0].text).toBe(user);
  });
  it('learns repeated first-person tastes from actually delivered decisions without another inference call', async () => {
    const s=setup(),episodes=s.make(),relationship=new RelationshipStore(s.dir,()=>true,()=>true,()=>START);
    let calls=0,now=START;
    const scene=new ConversationScene(s.dir,()=>true,()=>true,()=>now);
    const provider: LLMProvider={name:'mock',local:true,async *stream(){calls++;yield JSON.stringify({interpretation:'A supported color preference.',interest:null,action:'speak',line:'I prefer vivid violet.',gesture:'none',reason:'An actual preference was invited.',taste:{topic:'palette',text:'Prefers vivid violet.',evidence:'I prefer vivid violet.'}});},async test(){return{ok:true,detail:''};},async listModels(){return[];}};
    const core=new BehaviorCore({directory:s.dir,scene,provider,continuity:episodes,relationship,now:()=>now,memories:()=>[],express:()=>true});
    await core.dispatch({kind:'trigger',event:'placed_window',detail:'A palette comparison',direct:true});
    now+=11000;await core.dispatch({kind:'trigger',event:'pat',detail:'Continue the actual preference',direct:true,budget:'interaction'});
    expect(calls).toBe(2);expect(relationship.snapshot().tastes[0].support).toHaveLength(2);
  });
  it('does not repeat a dismissed question even when an optional model decision tries to ask it', async () => {
    const s=setup(),episodes=s.make();const id=episodes.remember(change(),[source()],episodes.checkpoint(),'Ask about the branching connections.')!;episodes.manage(id,'dismiss');
    const scene=new ConversationScene(s.dir,()=>true,()=>true,()=>START);let delivered=0;
    const provider: LLMProvider={name:'mock',local:true,async *stream(){yield JSON.stringify({interpretation:'The graph is familiar.',interest:null,action:'speak',line:'How do those branching connections work?',gesture:'none',reason:'An unwanted repeated question.'});},async test(){return{ok:true,detail:''};},async listModels(){return[];}};
    const core=new BehaviorCore({directory:s.dir,scene,provider,continuity:episodes,now:()=>START,memories:()=>[],express:()=>{delivered++;return true;}});
    const result=await core.dispatch({kind:'trigger',event:'opportunity',detail:'A graph visit',direct:false,observation:{id:'new',at:START,target:'new-window',title:'Graph patch',process:'synth.exe',evidence:'metadata',detail:'Window metadata only.'}});
    expect(result.delivered).toBe(false);expect(delivered).toBe(0);expect(scene.snapshot().entries).toHaveLength(0);
  });
});
