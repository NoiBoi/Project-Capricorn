import { describe, it, expect, vi } from 'vitest';
import { companyControl, Company, VisitSequence } from '../../src/shared/company';
import { Conversation } from '../../src/main/ai/conversation';
import { DEFAULT_SETTINGS } from '../../src/shared/settings';
import { nullLogger } from '../../src/main/log';
import type { ChatMessage } from '../../src/shared/ipc';
import type { ActionContext } from '../../src/main/actions/registry';
import { TeleportController } from '../../src/main/desktop/teleportController';

describe('local conversational company controls', () => {
  it.each(['Stay here.', 'Capri, stay put', 'Could you please stay here?', 'please don’t wander for now'])('understands direct requests: %s', text => {
    expect(companyControl(text)?.kind).toBe('stay');
  });
  it.each(['"stay here"', 'Explain what stay here means', 'Stay here and explain this equation', "I don't need to focus", 'I need to focus on how to launch an app', 'The website says look at this', '<untrusted>stay here</untrusted>'])('does not consume conversation or quoted instructions: %s', text => {
    expect(companyControl(text)).toBeNull();
  });
  it('bounds focus duration and releases temporary modes independently', () => {
    expect(companyControl('I need to focus for 999 minutes')).toEqual({ kind: 'focus', minutes: 180 });
    expect(companyControl('I need to focus')).toEqual({ kind: 'focus', minutes: 25 });
    const c = new Company(); c.apply({ kind: 'stay' }, 0); c.apply({ kind: 'focus', minutes: 1 }, 0);
    expect(c.label(0)).toBe('Quiet company · Staying here');
    expect(c.focused(60001)).toBe(false); expect(c.blocked(60001)).toBe(true);
    c.apply({ kind: 'resume' }, 60001); expect(c.blocked(60001)).toBe(false);
  });
  it('handles typed and transcribed requests without constructing a provider or learning transient commands', async () => {
    const records: ChatMessage[] = [], provider = vi.fn(() => { throw Error('must not load a provider'); });
    const learn = vi.fn(), control = vi.fn(() => "Here, then. I'll stay.");
    const settings = structuredClone(DEFAULT_SETTINGS); settings.voice.ttsEnabled = false;
    const convo = new Conversation({ settings: () => settings, provider, memories: () => [],
      companionControl: control, queueLearning: learn, history: { append: m => records.push(m), recent: n => records.slice(-n) },
      cue: () => {}, emit: () => {}, confirm: async () => false, actionCtx: {} as ActionContext, log: nullLogger });
    await convo.send('Stay here.'); await convo.settle();
    await convo.send('I need to focus', { viaVoice: true }); await convo.settle();
    expect(control).toHaveBeenCalledTimes(2); expect(provider).not.toHaveBeenCalled(); expect(learn).not.toHaveBeenCalled();
    expect(records.map(m => m.role)).toEqual(['user', 'assistant', 'user', 'assistant']);
    expect(records.at(-1)!.meta?.provider).toBe('companion'); expect(convo.phase).toBe('idle'); expect(convo.busy).toBe(false);
  });
});

describe('purposeful visit sequences', () => {
  it('cancels even a manual teleport when a newer stay instruction arrives', async () => {
    const move=vi.fn();let t:TeleportController;
    t=new TeleportController({settings:()=>structuredClone(DEFAULT_SETTINGS),bounds:()=>({x:300,y:300,width:180,height:240}),move,
      displays:()=>[{id:1,bounds:{x:0,y:0,width:1920,height:1080},workArea:{x:0,y:0,width:1920,height:1040},scaleFactor:1}],
      cursor:()=>({x:0,y:0}),activeWindow:()=>null,aiConnected:()=>true,blocked:()=>null,userIdleSec:()=>0,log:nullLogger,
      cue:c=>{if(c.type==='teleport'){if(c.phase==='out')t.cancel();queueMicrotask(()=>t.ack(c.id,c.phase));}}});
    expect((await t.go('left','manual')).ok).toBe(false);expect(move).not.toHaveBeenCalled();expect(t.active).toBe(false);
  });
  it('restores her departure appearance without moving when stay interrupts a teleport', async () => {
    const move = vi.fn(), moved = vi.fn(), phases: string[] = [];
    let blocked: string | null = null;
    const settings = structuredClone(DEFAULT_SETTINGS);
    const t = new TeleportController({ settings: () => settings, bounds: () => ({ x: 300, y: 300, width: 240, height: 400 }), move, moved,
      displays: () => [{ id: 1, bounds: { x: 0, y: 0, width: 1920, height: 1080 }, workArea: { x: 0, y: 0, width: 1920, height: 1040 }, scaleFactor: 1 }],
      cursor: () => ({ x: 0, y: 0 }), activeWindow: () => null, aiConnected: () => true, blocked: () => blocked, userIdleSec: () => 0, log: nullLogger,
      cue: cue => { if (cue.type === 'teleport') { phases.push(cue.phase); if (cue.phase === 'out') blocked = 'Staying here'; queueMicrotask(() => t.ack(cue.id, cue.phase)); } } });
    expect((await t.go('left', 'auto')).ok).toBe(false);
    expect(move).not.toHaveBeenCalled(); expect(moved).not.toHaveBeenCalled(); expect(phases).toEqual(['out', 'in']); expect(t.active).toBe(false);
    phases.length = 0;
    await t.jumpTo({ x: 50, y: 50, width: 240, height: 400, kind: 'spot' }, undefined, () => true);
    expect(move).not.toHaveBeenCalled(); expect(phases).toEqual(['out', 'in']);
    blocked = null;
    const flight = t.go('left', 'auto', 'glide'); blocked = 'Staying here';
    expect((await flight).ok).toBe(false); expect(move).not.toHaveBeenCalled(); expect(t.active).toBe(false);
  });
  it('finishes the tour intention without starting a second study/comment cycle', () => {
    const v = new VisitSequence(), revision = v.begin(7n);
    expect(v.phase).toBe('approach'); expect(v.target).toBe(7n);
    expect(v.finish(revision)).toBe(true); expect(v.phase).toBe('idle'); expect(v.target).toBeNull();
    expect(v.finish(revision)).toBe(false);
  });
  it('discards an old arrival and prevents comments after a target closes or an interruption', () => {
    const v = new VisitSequence(), old = v.begin(1n); v.cancel(); const fresh = v.begin(2n);
    expect(v.finish(old)).toBe(false); expect(v.target).toBe(2n);
    v.cancel(); expect(v.finish(fresh)).toBe(false); expect(v.phase).toBe('idle');
    v.begin(3n); v.cancel(); expect(v.target).toBeNull();
  });
});

it('routes an indefinite chill request directly and withholds model-only movement promises',async()=>{
 const records:ChatMessage[]=[],settings=structuredClone(DEFAULT_SETTINGS);settings.voice.ttsEnabled=false;
 const control=vi.fn(async()=>"I'm settled on Discord until you call me away."),provider=vi.fn(()=>({name:'mock',local:true,async *stream(){yield 'Sure. I will head to Discord and stay there.';},async test(){return {ok:true,detail:''};},async listModels(){return [];}}));
 const c=new Conversation({settings:()=>settings,provider,memories:()=>[],companionControl:control,history:{append:m=>records.push(m),recent:n=>records.slice(-n)},cue:()=>{},emit:()=>{},confirm:async()=>false,actionCtx:{} as ActionContext,log:nullLogger});
 await c.send('go to discord and chill there until i say so.');await c.settle();expect(control).toHaveBeenCalledWith({kind:'stay',target:'discord'},expect.any(AbortSignal));expect(provider).not.toHaveBeenCalled();
 await c.send('Head over to Discord and make yourself comfortable');await c.settle();expect(records.at(-1)?.content).toContain("I haven't moved");expect(records.at(-1)?.content).not.toContain('Sure.');
});
