import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { BehaviorCore, type Expression } from '../../scripts/behaviorHarness';
import { scenarios, START, fact, hold, ask, nod } from '../../src/main/behaviorExperiment/scenarios';
import { ConversationScene } from '../../src/main/store/conversationScene';
import { expressionSink } from '../../src/main/behaviorExperiment/expression';
import type { LLMProvider } from '../../src/main/ai/providers';

const dirs: string[] = [];
afterEach(() => { vi.useRealTimers(); for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true }); });
function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'capri-behavior-test-')); dirs.push(dir);
  let now = START, answer: unknown = hold, calls = 0, enabled = true, accept = true;
  const expressions: Expression[] = [], prompts: string[] = [];
  const provider: LLMProvider = { name: 'mock', local: true, async *stream(messages) {
    calls++; prompts.push(messages[1].content); yield JSON.stringify(answer);
  }, async test() { return { ok: true, detail: '' }; }, async listModels() { return []; } };
  const scene = new ConversationScene(dir, () => enabled, () => true, () => now);
  const make = () => new BehaviorCore({ directory: dir, provider, scene, memories: () => [], now: () => now,
    allowed: () => enabled, express(e) { if (accept) expressions.push(e); return accept; } });
  return { dir, provider, scene, make, expressions, prompts, get calls() { return calls; },
    advance(ms: number) { now += ms; }, setAnswer(value: unknown) { answer = value; }, disable() { enabled = false; }, rejectDelivery() { accept = false; } };
}

describe('bounded behavior experiment', () => {
  it('expresses one decision through existing cues and rejects an invalid movement target', () => {
    const cue = vi.fn(), present = vi.fn(() => true), glance = vi.fn(() => true);
    const sink = expressionSink({ cue, present, glance, validTarget: target => target === 'window-42' });
    expect(sink({ action: 'silent', line: '', gesture: 'none' })).toBe(false);
    expect(sink({ action: 'speak', line: ask.line, gesture: 'curious', target: 'window-42' })).toBe(true);
    expect(present).toHaveBeenCalledWith(ask.line);
    expect(cue).toHaveBeenCalledWith({ type: 'react', reaction: 'curious' });
    expect(sink({ action: 'investigate', line: '', gesture: 'curious', target: 'gone' })).toBe(false);
    expect(glance).not.toHaveBeenCalled();
    expect(sink({ action: 'investigate', line: '', gesture: 'curious', target: 'window-42' })).toBe(true);
    expect(glance).toHaveBeenCalledWith('window-42');
  });
  const expected = [ ['defer', 'defer', 'speak'], ['defer', 'gesture', 'speak'], ['defer', 'speak', 'silent'],
    ['silent', 'silent', 'silent', 'silent'], ['defer', 'speak'], ['defer', 'silent'] ];
  scenarios.forEach((scenario, i) => it(scenario.name, async () => {
    const s = setup(); let core = s.make(); const actions: string[] = [];
    for (const step of scenario.steps) {
      s.advance(step.after); s.setAnswer(step.answer);
      if (step.restart) core = s.make();
      actions.push((await core.dispatch(step.event)).action);
    }
    expect(actions).toEqual(expected[i]);
    expect(s.calls).toBe(scenario.steps.filter(x => x.answer).length);
  }));
  it('keeps an unspoken interpretation and cited interest; passes both to later contact', async () => {
    const s = setup(), core = s.make();
    await core.dispatch({ kind: 'observe', observation: fact() });
    expect(s.expressions).toHaveLength(0);
    expect(core.snapshot().journal[0].interpretation).toBe(hold.interpretation);
    s.setAnswer(nod);
    await core.dispatch({ kind: 'interact', id: 'touch', text: '[pat]', contact: 'pat' });
    expect(JSON.parse(s.prompts[1]).situation.interests[0].topic).toBe('the violet swatch');
    expect(core.snapshot().interests).toHaveLength(1);
  });
  it('rejects fabricated evidence, malformed decisions and action markup without retry', async () => {
    for (const bad of [{ ...hold, interest: { ...hold.interest!, quote: 'not in the evidence' } }, { action: 'speak' },
      { ...ask, line: '<action>{"tool":"open"}</action>' }]) {
      const s = setup(), core = s.make(); s.setAnswer(bad);
      expect((await core.dispatch({ kind: 'observe', observation: fact() })).action).toBe('silent');
      expect(s.expressions).toHaveLength(0); expect(core.snapshot().interests).toHaveLength(0); expect(s.calls).toBe(1);
    }
  });
  it('direct input cancels an in-flight interpretation even if the provider ignores cancellation', async () => {
    const s = setup(); let release!: () => void, entered!: () => void;
    const ready = new Promise<void>(r => { entered = r; });
    s.provider.stream = async function* () { entered(); await new Promise<void>(r => { release = r; }); yield JSON.stringify(ask); };
    const core = s.make(); const pending = core.dispatch({ kind: 'observe', observation: fact() });
    await ready;
    await core.dispatch({ kind: 'interact', id: 'quiet', text: 'Quiet, please.', control: 'quiet' });
    release(); await pending;
    expect(s.expressions).toHaveLength(0); expect(core.snapshot().interests).toHaveLength(0);
    expect(core.snapshot().quiet).toBe(true);
  });
  it('enforces a host deadline without another event or provider cooperation', async () => {
    vi.useFakeTimers(); const s = setup();
    s.provider.stream = async function* () { await new Promise(() => {}); yield ''; };
    const pending = s.make().dispatch({ kind: 'observe', observation: fact() });
    await vi.advanceTimersByTimeAsync(18001);
    expect((await pending).action).toBe('silent'); expect(s.expressions).toHaveLength(0);
  });
  it('shares the existing ambient budget and does not make requests on repeated opportunity pulses', async () => {
    const s = setup(), core = s.make(); await core.dispatch({ kind: 'observe', observation: fact() });
    for (let i = 0; i < 100; i++) await core.dispatch({ kind: 'opportunity' });
    expect(s.calls).toBe(1);
    s.advance(61000); await core.dispatch({ kind: 'opportunity' });
    s.advance(61000); await core.dispatch({ kind: 'opportunity' });
    s.advance(61000); await core.dispatch({ kind: 'opportunity' });
    expect(s.calls).toBe(2);
    const restarted = s.make(); s.advance(61000); await restarted.dispatch({ kind: 'opportunity' });
    expect(s.calls).toBe(2);
  });
  it('records speech as delivered only when the host accepts it', async () => {
    const s = setup(), core = s.make(); s.setAnswer(ask); s.rejectDelivery();
    await core.dispatch({ kind: 'observe', observation: fact() });
    expect(s.scene.snapshot().entries).toHaveLength(0);
    expect(core.snapshot().journal[0].delivered).toBe(false);
  });
  it('drops stale/future observations, preserves context while suppressed and supports explicit clearing', async () => {
    const s = setup(), core = s.make();
    await core.dispatch({ kind: 'observe', observation: fact('stale', 'Old content', START - 16 * 60000) });
    await core.dispatch({ kind: 'observe', observation: fact('future', 'Future content', START + 1) });
    expect(s.calls).toBe(0);
    await core.dispatch({ kind: 'observe', observation: fact() });
    s.disable(); await core.dispatch({ kind: 'opportunity' });
    expect(core.snapshot().facts).toHaveLength(1);
    core.clear();
    expect(core.snapshot().facts).toHaveLength(0);
    expect(fs.existsSync(path.join(s.dir, 'behavior-state.json'))).toBe(false);
  });
});
