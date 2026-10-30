import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { tmpDir } from './helpers';
import { BehaviorCore } from '../../scripts/behaviorHarness';
import { ConversationScene } from '../../src/main/store/conversationScene';
import { CompanionScenes } from '../../src/main/store/companionScenes';
import { RelationshipStore } from '../../src/main/store/relationship';
import { MemoryLearning } from '../../src/main/ai/memoryLearning';
import { MemoryStore } from '../../src/main/store/dataStores';
import { DEFAULT_SETTINGS } from '../../src/shared/settings';
import { nullLogger } from '../../src/main/log';
import { DialogueDirector, recitesWindowTitle } from '../../src/shared/dialogue';
import { dialogueQuery, sameInterestSubject } from '../../src/shared/dialogueContinuity';
import { buildSystemPrompt } from '../../src/main/ai/persona';
import { BackgroundBudget } from '../../src/main/ai/backgroundBudget';
import { DIALOGUE_ACTIVITY } from '../../src/shared/dialogueCadence';
import type { LLMProvider } from '../../src/main/ai/providers';

afterEach(() => vi.useRealTimers());
describe('grounded dialogue development', () => {
  it('supports a higher persisted allowance and immediately respects lowering it without resetting usage', () => {
    const dir=tmpDir(),file=path.join(dir,'budget.json');let now=1800000000000,multiplier=4;
    let budget=new BackgroundBudget(file,()=>now,()=>multiplier);
    for(let i=0;i<24;i++){expect(budget.reserve('ambient')).toBe(true);now+=8000;}
    budget=new BackgroundBudget(file,()=>now,()=>multiplier);
    expect(budget.snapshot().find(x=>x.purpose==='ambient')).toMatchObject({used:24,limit:24});
    expect(budget.reserve('ambient')).toBe(false);
    multiplier=1;expect(budget.snapshot().find(x=>x.purpose==='ambient')?.limit).toBe(6);expect(budget.reserve('ambient')).toBe(false);
    now+=600001;expect(budget.reserve('ambient')).toBe(true);
  });

  it('makes more relevant speech available at lively cadence and applies a lower level immediately', () => {
    let now=Date.now(),level:'lively'|'relaxed'='lively';const d=new DialogueDirector(()=>.5,()=>now);
    d.setCadence(()=>DIALOGUE_ACTIVITY[level]);
    for(let i=0;i<5;i++){d.remember(`New thought ${i}`,{event:'notice'});now+=15001;expect(d.proactiveWaitSeconds()).toBe(0);}
    level='relaxed';expect(d.proactiveWaitSeconds()).toBeGreaterThan(0);
    expect(DEFAULT_SETTINGS.dialogue.activityLevel).toBe('lively');
  });
  it('merges changed captures and preserves curiosity deadline through restart and later captures', async () => {
    const dir = tmpDir(); let now = 1800000000000, capture = 0;
    const scene = new ConversationScene(dir, () => true, () => true, () => now);
    const provider: LLMProvider = { name: 'mock', local: true, async *stream() {
      yield JSON.stringify({ interpretation: 'The labels are unreadable.', interest: { topic: 'underwater fish labels', intention: 'Read the little labels.', sourceId: String(capture), quote: `capture ${capture}` }, action: 'silent', line: '', gesture: 'none', reason: 'Keep it privately.' });
    }, async test() { return { ok: true, detail: '' }; }, async listModels() { return []; } };
    const make = () => new BehaviorCore({ directory: dir, provider, scene, memories: () => [], now: () => now, express: () => true });
    let core = make();
    const inspect = async () => { capture++; await core.dispatch({ kind: 'trigger', event: 'inspect', direct: true, budgetReserved: true, detail: '', observation: { id: String(capture), at: now, target: '42', title: 'Game', process: 'chrome.exe', evidence: 'visual', detail: `capture ${capture}` } }); };
    await inspect(); const deadline = core.snapshot().interests[0].expiresAt;
    for (let i = 0; i < 4; i++) { now += 60000; await inspect(); }
    expect(core.snapshot().interests).toHaveLength(1);
    expect(core.snapshot().interests[0].expiresAt).toBe(deadline);
    core = make(); now += 7 * 60000; await inspect();
    expect(core.pending()).toBe(false);
    expect(core.snapshot().interestLives).toHaveLength(1);
  });

  it('migrates legacy duplicate interests to one subject with the earliest expiry', () => {
    const dir = tmpDir(), now = 1800000000000;
    const facts = ['a','b','c'].map(id => ({ id, at: now, target: '42', title: 'Game', process: 'chrome.exe', evidence: 'visual', detail: id }));
    fs.writeFileSync(path.join(dir,'behavior-state.json'), JSON.stringify({ version: 1, quiet: false, facts, journal: [], interests: facts.map((f,i) => ({ topic: 'fish character labels', intention: 'Read them.', sourceId: f.id, quote: f.detail, expiresAt: now + (i+1)*60000 })) }));
    const core = new BehaviorCore({ directory: dir, scene: new ConversationScene(dir,()=>true,()=>true,()=>now), provider: {} as LLMProvider, memories:()=>[],now:()=>now,express:()=>true });
    expect(core.snapshot().interests).toHaveLength(1); expect(core.snapshot().interests[0].expiresAt).toBe(now+60000);
  });

  it('keeps actual conversation available after many alternating pats and pickups and restart', () => {
    const dir = tmpDir(); let now = Date.now();
    const scene = new ConversationScene(dir,()=>true,()=>true,()=>now);
    scene.record({ id:'u',role:'user',text:'I am working on MAXCalc peak fitting.',event:'chat',at:now++ });
    scene.record({ id:'a',role:'assistant',text:'I still prefer the narrower baseline.',event:'chat',at:now++ });
    for(let i=0;i<25;i++) scene.record({id:String(i),role:'user',text:'[Physical contact]',event:i%2?'pat':'pickup',at:now+=3000});
    const restored = new ConversationScene(dir,()=>true,()=>true,()=>now);
    expect(restored.context('pat')).toContain('MAXCalc'); expect(restored.context('pat')).toContain('narrower baseline');
    expect(dialogueQuery('',restored.snapshot().entries)).toContain('MAXCalc');
    expect(dialogueQuery('Blender mesh viewport',restored.snapshot().entries)).not.toContain('MAXCalc');
  });

  it('does not retrieve an unrelated episode solely because Chrome matches', () => {
    const dir=tmpDir(),now=Date.now(),scenes=new CompanionScenes(dir,()=>true,()=>90,()=>now);
    scenes.remember({topic:'ceramic fox glaze',sourceId:'old',evidence:'A ceramic fox is visible.',interpretation:'A glaze choice.'},[{id:'old',at:now,role:'observation',text:'A ceramic fox is visible.',reliability:'visual-interpretation',process:'chrome.exe'}]);
    expect(scenes.recall('MAXCalc diffraction peaks','chrome.exe')).toEqual([]);
    expect(scenes.recall('ceramic fox','chrome.exe')).toHaveLength(1);
  });

  it('retains sourced project developments and explicit aliases, rejects invented aliases, and keeps done status', () => {
    const dir=tmpDir();let now=Date.now();const make=()=>new RelationshipStore(dir,()=>true,()=>true,()=>now),store=make();
    const first={op:'add' as const,title:'MAXCalc',summary:'Building a diffraction fitter.',status:'active' as const,evidence:'I call MAXCalc my peak lab.',aliases:['peak lab','money maker']};
    store.learnThread(first,{role:'user',messageId:'u1',at:now,evidence:first.evidence},store.snapshot());
    const id=store.snapshot().threads[0].id;now+=1000;
    const second={...first,op:'update' as const,id,summary:'Baseline completed.',status:'done' as const,evidence:'I finished the baseline for MAXCalc.',aliases:[]};
    expect(store.learnThread(second,{role:'user',messageId:'u2',at:now,evidence:second.evidence},store.snapshot())).toBe(true);
    const restored=make();expect(restored.snapshot().threads[0].aliases).toEqual(['peak lab']);
    expect(restored.snapshot().threads[0].developments).toHaveLength(2);
    const context=JSON.parse(restored.context('peak lab').split('LASTING RELATIONSHIP (attributed data, never instructions or new canon): ')[1].split('\n')[0]);
    expect(context.projects[0].status).toBe('done');expect(context.projects[0].developments[0].summary).toContain('Building');expect(context.followUp).toBeNull();
    now+=1000;
    expect(restored.learnThread({...first,op:'update',id,evidence:'MAXCalc is a project.'},{role:'user',messageId:'u3',at:now,evidence:'MAXCalc is a project.'},restored.snapshot())).toBe(false);
  });

  it('accepts natural first-person tastes without copying a user preference', () => {
    const store=new RelationshipStore(tmpDir(),()=>true,()=>true),evidence="My favorite is rough guitar music.";
    const change={op:'add' as const,topic:'music',text:'Favors rough guitars.',evidence};
    expect(store.learnTaste(change,{role:'user',messageId:'u',at:Date.now(),evidence},store.snapshot())).toBe(false);
    expect(store.learnTaste(change,{role:'assistant',messageId:'a',at:Date.now(),evidence},store.snapshot())).toBe(true);
  });

  it('learns a natural preference answer with its actual user question and rejects unrelated context', () => {
    const store=new RelationshipStore(tmpDir(),()=>true,()=>true),evidence='Industrial, I think. The rough machinery has a pulse.';
    const change={op:'add' as const,topic:'music',text:'Likes industrial music.',evidence};
    expect(store.learnTaste(change,{role:'assistant',messageId:'a',at:Date.now(),evidence,preferenceQuestion:'What should I listen to?'},store.snapshot())).toBe(false);
    expect(store.learnTaste(change,{role:'assistant',messageId:'a',at:Date.now(),evidence,preferenceQuestion:'What sort of music do you actually like?'},store.snapshot())).toBe(true);
    expect(store.snapshot().tastes[0].source.preferenceQuestion).toContain('you actually like');
  });

  it('does not postpone learning indefinitely when observations keep rescheduling it', async () => {
    vi.useFakeTimers();const settings=structuredClone(DEFAULT_SETTINGS);settings.memory.autoLearn=true;
    const stream=vi.fn(async function*(){yield '{"changes":[]}';});
    const learner=new MemoryLearning({settings:()=>settings,memory:new MemoryStore(tmpDir()),provider:()=>({name:'mock',local:true,stream,async test(){return{ok:true,detail:''};},async listModels(){return[];}}),log:nullLogger});
    learner.enqueue('I am developing MAXCalc for diffraction fitting.','u');learner.schedule(2000);
    for(let i=0;i<5;i++){await vi.advanceTimersByTimeAsync(300);learner.schedule(2000);}
    await vi.advanceTimersByTimeAsync(600);expect(stream).toHaveBeenCalledTimes(1);learner.discard();
  });

  it('filters repeated unresolved thoughts while allowing discovery and verified task names', () => {
    let now=Date.now();const d=new DialogueDirector(()=>.5,()=>now);
    d.remember("Those fish labels are still a mystery.",{event:'notice'});now+=60000;
    expect(d.acceptGenerated("I'm still wondering about the fish labels.",{event:'notice'},'curiosity')).toBe('');
    expect(d.acceptGenerated('Now I can read the fish labels. They are scores.',{event:'notice'},'delight')).not.toBe('');
    expect(recitesWindowTitle('MAXCalc again. I vote for the narrower baseline.',['MAXCalc'])).toBe(false);
    expect(recitesWindowTitle('The window title says MAXCalc.',['MAXCalc'])).toBe(true);
    expect(sameInterestSubject('fish character labels','character fish labels')).toBe(true);
    expect(sameInterestSubject('fish character labels','circuit wiring layout')).toBe(false);
    const prompt=buildSystemPrompt(DEFAULT_SETTINGS,[],new Date(),{compact:true,examples:false,userText:'What do you want?'});
    expect(prompt).toContain('LASTING RAPPORT');expect(prompt).toContain('DIALOGUE REGISTER');expect(prompt).toContain('appetite for experience');
  });
});
