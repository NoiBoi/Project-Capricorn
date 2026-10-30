import { describe, expect, it } from 'vitest';
import { EnvironmentalCuriosity } from '../../src/shared/curiosity';
import { inspectionReading } from '../../src/main/desktop/inspection';

const allowed = { blocked: false, mayInspect: true };
function dwell(c: EnvironmentalCuriosity, key: string, start: number, duration = 32000) {
  for (let t = start; t <= start + duration; t += 2000) c.observe(key, t);
}
describe('environmental judgment over desktop events', () => {
  it('selects an underexplored exposed background, keeps engaged attention, and ignores video frame novelty',()=>{
    const c=new EnvironmentalCuriosity(),windows=[{id:'1',key:'chat',label:'ChatGPT'},{id:'2',key:'social',label:'Discord'},{id:'3',key:'video',label:'YouTube',video:true}];
    c.syncWindows(windows,1000);dwell(c,'chat',1000,20000);
    c.record('chat',{facts:['same answer'],interpretation:'',curiosity:''},21000,'chat-image',{basis:'visual',label:'ChatGPT'});
    expect(c.choose(22000,{...allowed,windows,engaged:true}).action).toBe('quiet');
    expect(c.choose(22000,{...allowed,windows}).target?.key).toBe('social');
    c.record('social',{facts:['visible stream tiles'],interpretation:'',curiosity:''},22000,'discord-image',{basis:'visual',label:'Discord'});
    expect(c.choose(23000,{...allowed,windows}).action).toBe('quiet');
    expect(c.choose(113000,{...allowed,windows}).target?.key).toBe('video');
    c.record('video',{facts:['creator and title'],interpretation:'',curiosity:''},113000,undefined,{basis:'metadata',label:'YouTube'});
    expect(c.choose(204000,{...allowed,windows}).action).toBe('quiet');
    expect(c.history('Discord',204000)[0]).toMatchObject({window:'Discord',status:'recently inspected',basis:'visual'});
    c.syncWindows([...windows,{id:'4',key:'editor',label:'Editor'}],204000);
    expect(c.history('Editor',204000)[0]).toMatchObject({status:'metadata detected; contents not inspected'});
  });
  it('suppresses minor visual noise while admitting meaningful changes, and distinguishes stale receipts',()=>{
    const c=new EnvironmentalCuriosity();c.record('a',{facts:['old paragraph'],interpretation:'',curiosity:''},1000,'a',{basis:'visual',signature:'8888888888888888',label:'ChatGPT'});
    expect(c.unchanged('a','new-jpeg',2000,'8888988888888888')).toBe(true);
    expect(c.unchanged('a','new-jpeg',3000,'ffffffffffffffff')).toBe(false);
    c.dropInterests();expect(c.history('ChatGPT',901001)[0].status).toContain('stale');
    c.clear();expect(c.history('ChatGPT',901001)).toEqual([]);
  });
  it('seeds startup without invented openings, then notices a new window and inspects after six settled seconds', () => {
    const c = new EnvironmentalCuriosity();
    expect(c.syncWindows([{ id: 'old', key: 'a' }], 0)).toEqual([]);
    expect(c.syncWindows([{ id: 'old', key: 'a' }, { id: 'new', key: 'b' }], 1000)).toEqual([{ id: 'new', key: 'b', kind: 'opened' }]);
    dwell(c, 'b', 1000, 4000); expect(c.choose(5000, allowed).action).toBe('look');
    c.observe('b', 7000); expect(c.choose(7000, allowed)).toMatchObject({ action: 'inspect', reason: expect.stringContaining('newly opened') });
    for (let t=9000;t<120000;t+=2000) { c.observe('b',t); expect(c.choose(t,allowed).action).toBe('quiet'); }
  });
  it('learns background metadata without inventing a document change and bounds rapid loading-title churn', () => {
    const c = new EnvironmentalCuriosity(); c.syncWindows([{id:'1'}],0);
    expect(c.syncWindows([{id:'1',key:'initial title'}],1000)).toEqual([]);
    for(let i=0;i<5;i++) { c.syncWindows([{id:'1',key:'title'+i}],i*2000+2000); c.observe('title'+i,i*2000+2000); expect(c.choose(i*2000+2000,allowed).action).toBe('quiet'); }
    dwell(c,'title4',12000,20000); expect(c.choose(32000,allowed).action).toBe('look');
    expect(c.choose(32000,allowed).action).toBe('inspect');
  });
  it('compares only previously accepted visual fingerprints', () => {
    const c = new EnvironmentalCuriosity(); expect(c.unchanged('a','same')).toBe(false);
    c.record('a',{facts:['A loop.'],interpretation:'Maybe a route.',curiosity:''},1000,'same');
    expect(c.unchanged('a','same')).toBe(true); expect(c.unchanged('a','changed')).toBe(false);
    c.clear(); expect(c.unchanged('a','same')).toBe(false);
  });
  it('looks, selectively inspects, then stays quiet during a long ordinary work session', () => {
    const c = new EnvironmentalCuriosity(); dwell(c, 'a', 0);
    expect(c.choose(32000, allowed).action).toBe('look');
    expect(c.choose(32000, allowed).action).toBe('inspect');
    c.record('a', { facts: ['A disconnected green loop.'], interpretation: 'Maybe a route.', curiosity: 'Where does the loose end go?' }, 32000, 'same');
    for (let t = 34000; t < 3600000; t += 2000) {
      c.observe('a', t); const choice = c.choose(t, allowed);
      if (choice.action === 'inspect') expect(c.unchanged('a', 'same', t)).toBe(true);
      else expect(choice.action).toBe('quiet');
    }
    expect(c.context('a', 3600000)?.evidence).toBeUndefined();
    expect(c.priority('a', 3600000)).toBe(0);
  });
  it('treats rapid ordinary app switching as unsettled, rather than twelve new interests', () => {
    const c = new EnvironmentalCuriosity();
    for (let t = 0; t < 60000; t += 2000) {
      c.observe(String(t % 6000), t); expect(c.choose(t, allowed).action).toBe('quiet');
    }
    expect(c.context('0', 60000)).toBeUndefined();
  });
  it('recognizes a return but only investigates to check for changed evidence', () => {
    const c = new EnvironmentalCuriosity(); dwell(c, 'diagram', 0);
    c.choose(32000, allowed); c.choose(32000, allowed);
    c.record('diagram', { facts: ['A loop ends outside the border.'], interpretation: 'Might be a deliberate escape route.', curiosity: 'Does the outside end reconnect?' }, 32000);
    dwell(c, 'other', 40000); c.observe(null, 80000);
    dwell(c, 'diagram', 640000);
    expect(c.context('diagram', 672000)).toMatchObject({ familiarity: 'returned to previously observed metadata', hypothesis: 'Might be a deliberate escape route.', evidence: { ageSeconds: 640 } });
    expect(c.choose(672000, allowed).action).toBe('look');
    expect(c.choose(672000, allowed)).toMatchObject({ action: 'inspect', reason: expect.stringContaining('changed') });
  });
  it('preserves interest through touch but never spends an inspection while blocked or quiet', () => {
    const c = new EnvironmentalCuriosity(); dwell(c, 'a', 0);
    expect(c.choose(32000, { ...allowed, blocked: true }).action).toBe('quiet');
    expect(c.choose(32000, allowed).action).toBe('look');
    expect(c.choose(32000, { ...allowed, mayInspect: false }).action).toBe('quiet');
    expect(c.choose(32000, allowed).action).toBe('inspect');
    c.record('a', { facts: [], interpretation: '', curiosity: 'A small unresolved detail.' }, 32000);
    expect(c.choose(32000, { ...allowed, blocked: true }).action).toBe('quiet');
    expect(c.context('a', 32000)?.openCuriosity).toBe('A small unresolved detail.');
    c.clear(); expect(c.context('a', 32000)).toBeUndefined();
  });
  it('retries an unavailable first look, bounds failures, and resets on an external return', () => {
    const c = new EnvironmentalCuriosity(); dwell(c, 'a', 0);
    c.choose(32000, allowed); expect(c.choose(32000, allowed).action).toBe('inspect'); c.failed('a', 32000);
    dwell(c, 'a', 34000, 30000); expect(c.choose(64000, allowed).action).toBe('inspect'); c.failed('a', 64000);
    dwell(c, 'a', 66000, 60000); expect(c.choose(126000, allowed).action).toBe('inspect'); c.failed('a', 126000);
    dwell(c, 'a', 128000, 120000); expect(c.choose(248000, allowed).action).toBe('quiet');
    dwell(c, 'a', 400000, 20000); expect(c.choose(420000, allowed).action).toBe('look'); expect(c.choose(420000, allowed).action).toBe('inspect');
  });
  it('checks a changed same-title view without turning unchanged images into model events', () => {
    const c = new EnvironmentalCuriosity(); dwell(c, 'a', 0); c.choose(32000, allowed); c.choose(32000, allowed);
    c.record('a', {facts:['A branch.'], interpretation:'Maybe a route.', curiosity:'Where does it go?'}, 32000, 'first');
    dwell(c, 'a', 34000, 120000); expect(c.choose(154000, allowed).action).toBe('inspect');
    expect(c.unchanged('a','first',154000)).toBe(true);
    dwell(c,'a',156000,60000); expect(c.choose(216000,allowed).action).toBe('quiet');
    dwell(c,'a',218000,60000); expect(c.choose(278000,allowed).action).toBe('inspect'); expect(c.unchanged('a','second',278000)).toBe(false);
  });
  it('expires absent subjects and never implies unseen user intent from metadata', () => {
    const c = new EnvironmentalCuriosity(); dwell(c, 'opaque-key', 0);
    expect(c.context('opaque-key', 32000)).toEqual({ familiarity: 'seen this session', evidence: undefined, hypothesis: undefined, openCuriosity: undefined });
    c.observe(null, 3 * 3600000); expect(c.context('opaque-key', 3 * 3600000)).toBeUndefined();
  });
  it('bounds and separates model visual facts, hypotheses and unresolved interests', () => {
    const reading = inspectionReading(JSON.stringify({ facts: ['green loop', 4, 'x'.repeat(1000), 'end', 'extra'], interpretation: 'Maybe a map.', curiosity: 'Does it connect?' }));
    expect(reading.facts).toHaveLength(3); expect(reading.facts[1]).toHaveLength(160);
    expect(reading.interpretation).toBe('Maybe a map.');
    expect(inspectionReading('not JSON').facts).toEqual([]);
    expect(inspectionReading('null').curiosity).toBe('');
  });
});
