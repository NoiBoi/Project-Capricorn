import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { PersonalContext, PersonalChanges } from '../../src/main/store/personalContext';
import { MemoryLearning } from '../../src/main/ai/memoryLearning';
import { MemoryStore } from '../../src/main/store/dataStores';
import { RelationshipStore } from '../../src/main/store/relationship';
import { DEFAULT_SETTINGS } from '../../src/shared/settings';
import { nullLogger } from '../../src/main/log';
import { tmpDir } from './helpers';
import type { PersonalSource } from '../../src/shared/personalContext';
const MINUTE = 60000;
function harness() {
  const dir = tmpDir(); let now = 1800000000000, enabled = true, persistent = true, auto = true;
  const make = () => new PersonalContext(dir, () => enabled, () => persistent, () => auto, () => now);
  let store = make();
  const source = (text: string, messageId = 'user-1'): PersonalSource => ({ text, messageId, at: now });
  return { dir, get store() { return store; }, source, advance(ms: number) { now += ms; },
    restart() { store = make(); }, privacy() { persistent = false; store.privacyChanged(); }, disable() { enabled = false; }, noLearn() { auto = false; } };
}
const bedtime = 'I will go to bed after this reply.';
describe('working understanding and event-conditioned intentions', () => {
  it('waits for the matching delivered reply, survives restart, and produces one callout candidate after continued input', () => {
    const h = harness(); h.store.userMessage(h.source(bedtime));
    expect(h.store.snapshot().commitments[0].status).toBe('waiting');
    h.store.replyDelivered('other-user','other-reply'); h.advance(6 * MINUTE); h.store.observePresence(0);
    expect(h.store.candidate()).toBeUndefined();
    h.store.replyDelivered('user-1','actual-reply');
    h.store.delivered('You said you were going to bed after this. Good night.');
    expect(h.store.snapshot().commitments[0].status).toBe('eligible');
    h.restart(); expect(h.store.candidate()).toBeUndefined();
    h.advance(6 * MINUTE); h.store.observePresence(0);
    expect(h.store.candidate()?.source.messageId).toBe('user-1');
    h.store.delivered("Weren't you going to bed after that?");
    expect(h.store.snapshot().commitments[0].status).toBe('mentioned');
    h.restart(); h.advance(35 * MINUTE); h.store.observePresence(0);
    expect(h.store.opportunity()).toBeUndefined();
    expect(h.store.context('sleep')).toContain('Specific callback was actually delivered');
  });
  it('does not turn inactivity, a restarted app, a screenshot or a generic completion into a fulfilled condition', () => {
    const h = harness(), text = 'I will sleep after I finish the ME 239 assignment.';
    h.store.learn(PersonalChanges.parse({ commitments: [{ op:'add', intention:'go to bed', condition:{kind:'topic',topic:'ME 239 assignment'}, evidence:text }] }),[h.source(text)],h.store.checkpoint());
    h.advance(10 * MINUTE); h.store.userMessage(h.source('I finished the Capri patch.','u2')); h.store.observePresence(0);
    expect(h.store.candidate()).toBeUndefined(); h.restart(); h.store.observePresence(0);
    expect(h.store.snapshot().returned).toBeUndefined();
    h.advance(MINUTE); h.store.userMessage(h.source('I finished the ME 239 assignment.','u3'));
    expect(h.store.snapshot().commitments[0]).toMatchObject({ status:'eligible', transitions:expect.arrayContaining([expect.objectContaining({sourceId:'u3'})]) });
    h.advance(6 * MINUTE); h.store.observePresence(600); expect(h.store.candidate()).toBeUndefined();
    h.store.observePresence(0); expect(h.store.candidate()).toBeDefined();
  });
  it('stores replacement situations with valid intervals and links an explicit work report to the same project', () => {
    const h = harness(); h.store.userMessage(h.source("I'm heading home."));
    h.advance(20 * MINUTE); h.store.observePresence(600); h.store.observePresence(0);
    const context = h.store.context(); expect(context).toContain('heading home'); expect(context).toContain('input-idle');
    expect(context).not.toContain('"value":"at home"');
    h.advance(MINUTE); h.store.userMessage(h.source('I just got home.','u2'));
    const situations = h.store.snapshot().situations;
    expect(situations[0].validTo).toBe(situations[1].validFrom);
    expect(h.store.context()).not.toContain('"value":"heading home"');
    expect(h.store.context('Where was I before getting home?')).toContain('historical user report; not current location');
    const report = h.source('I am working on MAXCalc.','u3');
    h.store.learn(PersonalChanges.parse({situations:[{key:'current_work',value:'working on MAXCalc',evidence:report.text,ttlMinutes:120}]}),[report],h.store.checkpoint());
    const thread = { id:'maxcalc',title:'MAXCalc',summary:'User reports debugging the baseline.',status:'active' as const,updatedAt:report.at,nextAskAt:report.at,asksSinceUpdate:0,source:{role:'user' as const,messageId:'project-u',at:report.at,evidence:'debugging the baseline'} };
    expect(h.store.context('What now?',[thread])).toContain('"connectedSubjects":[{"id":"maxcalc"');
    h.advance(121 * MINUTE); expect(h.store.context()).not.toContain('"value":"working on MAXCalc"');
  });
  it('cancels explicit changed plans, respects dismiss/forget during extraction, and never resurrects an old intention', () => {
    const h = harness(); h.store.userMessage(h.source(bedtime)); const old = h.store.snapshot().commitments[0];
    h.advance(MINUTE); h.store.userMessage(h.source("I changed my mind about sleep. I'm staying up.",'u2'));
    expect(h.store.snapshot().commitments[0].status).toBe('cancelled');
    h.store.learn(PersonalChanges.parse({commitments:[{op:'add',intention:'go to bed',condition:{kind:'reply'},evidence:bedtime}]}),[{...old.source,text:bedtime}],h.store.checkpoint());
    expect(h.store.snapshot().commitments).toHaveLength(1);
    const checkpoint = h.store.checkpoint(); h.store.manage(old.id,'forget');
    h.store.learn(PersonalChanges.parse({commitments:[{op:'add',intention:'go to bed',condition:{kind:'reply'},evidence:bedtime}]}),[{...old.source,text:bedtime}],checkpoint);
    expect(h.store.snapshot().commitments).toEqual([]);
  });
  it('keeps private exchanges, hypotheticals, quoted examples, invented evidence and secrets out', () => {
    const h = harness();
    for (const text of ['Off the record: '+bedtime,'Imagine I will go to bed after this reply.','Example: "'+bedtime+'"']) h.store.userMessage(h.source(text));
    h.store.userMessage(h.source('Hello.','public'));
    h.store.learn(PersonalChanges.parse({situations:[{key:'whereabouts',value:'at home',evidence:'I got home',ttlMinutes:120}]}),[h.source('I went to class.')],h.store.checkpoint());
    expect(h.store.snapshot().situations).toEqual([]); expect(h.store.snapshot().commitments).toEqual([]);
    h.store.userMessage(h.source(bedtime)); h.store.userMessage(h.source('Off the record: I am home.','private'));
    expect(h.store.context('sleep')).toBe(''); h.store.observePresence(0); expect(h.store.candidate()).toBeUndefined();
    h.privacy(); expect(fs.existsSync(path.join(h.dir,'personal-context.json'))).toBe(false);
  });
  it('expires intentions without guessing an outcome and limits silent reconsideration', () => {
    const h = harness(); h.store.userMessage(h.source(bedtime)); h.store.replyDelivered('user-1','reply');
    h.advance(6 * MINUTE); h.store.observePresence(0); const first = h.store.opportunity()!;
    h.store.considered(first.key); expect(h.store.opportunity()).toBeUndefined();
    h.advance(31 * MINUTE); h.store.observePresence(0); expect(h.store.opportunity()?.key).toBe(first.key);
    h.store.considered(first.key); h.advance(31 * MINUTE); h.store.observePresence(0); expect(h.store.opportunity()).toBeUndefined();
    h.advance(24 * 60 * MINUTE); expect(h.store.snapshot().commitments[0].status).toBe('expired');
  });
  it('uses source time for a timed intention and never creates one with a fabricated past timestamp', () => {
    const h = harness(), report = h.source('I will go to bed in 20 minutes.');
    const change = {op:'add',intention:'go to bed',condition:{kind:'time',dueAt:new Date(report.at+20*MINUTE).toISOString()},evidence:report.text};
    h.store.learn(PersonalChanges.parse({commitments:[change]}),[report],h.store.checkpoint()); h.advance(21 * MINUTE);
    expect(h.store.snapshot().commitments[0].status).toBe('eligible');
    const other = h.source('I will go to bed in 30 minutes.','u2');
    h.store.learn(PersonalChanges.parse({commitments:[{...change,evidence:other.text,condition:{kind:'time',dueAt:new Date(report.at-MINUTE).toISOString()}}]}),[other],h.store.checkpoint());
    expect(h.store.snapshot().commitments).toHaveLength(1);
  });
  it('does not capture intentions when automatic learning is off and hides all context when memory is off', () => {
    const h = harness(); h.noLearn(); h.store.userMessage(h.source(bedtime)); expect(h.store.snapshot().commitments).toEqual([]);
    h.disable(); expect(h.store.context()).toBe('');
  });
  it('retains an actual opinion reason through restart without accepting a user-invented preference', () => {
    const dir = tmpDir(), now = Date.now(), make = () => new RelationshipStore(dir,()=>true,()=>true);
    let store = make(); const quote = 'I prefer vivid violet because it stands out against the grey.';
    store.learnTaste({op:'add',topic:'color',text:'Prefers vivid violet.',evidence:quote},{role:'assistant',messageId:'delivered-opinion',evidence:quote,at:now},store.snapshot());
    store = make(); expect(store.context('What color and why?')).toContain('because it stands out against the grey');
    expect(store.learnTaste({op:'add',topic:'music',text:'Prefers jazz.',evidence:'I prefer jazz.'},{role:'user',messageId:'claim',evidence:'I prefer jazz.',at:now},store.snapshot())).toBe(false);
    expect(store.snapshot().tastes).toHaveLength(1);
  });
  it('processes broader intentions in the existing single learning call and applies a captured matching reply receipt', async () => {
    const settings = structuredClone(DEFAULT_SETTINGS); settings.memory.autoLearn = true;
    const dir = tmpDir(), store = new PersonalContext(dir,()=>true,()=>true,()=>true);
    const at = Date.now(), text = 'I will sleep after I finish the ME 239 assignment.';
    const provider = {name:'fixture',local:true,async test(){return {ok:true,detail:''};},async listModels(){return [];},async *stream(){yield JSON.stringify({changes:[],commitments:[{op:'add',intention:'go to bed',condition:{kind:'topic',topic:'ME 239 assignment'},evidence:text}]});}};
    const learner = new MemoryLearning({settings:()=>settings,provider:()=>provider,memory:new MemoryStore(dir),log:nullLogger,personalContext:store});
    await learner.learn(text,'user-1',new AbortController().signal,[{text,messageId:'user-1',at}]);
    expect(store.snapshot().commitments[0].condition.topic).toBe('ME 239 assignment');
    expect(learner.context).toContain('0 durable memory changes');
  });
});
