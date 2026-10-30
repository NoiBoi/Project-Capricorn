/** Standalone replay. All persistent records are synthetic and isolated from Electron userData. */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { BehaviorCore, type Decision, type Expression } from './behaviorHarness';
import { START, scenarios } from '../src/main/behaviorExperiment/scenarios';
import { ConversationScene } from '../src/main/store/conversationScene';
import { expressionSink } from '../src/main/behaviorExperiment/expression';
import { DialogueDirector } from '../src/shared/dialogue';
import type { LLMProvider } from '../src/main/ai/providers';

async function main() {
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'capri-stage0-replay-'));
const results = [];
for (const scenario of scenarios) {
  let now = START, calls = 0, answer: Decision | undefined;
  const expressions: Expression[] = [], prompts: unknown[] = [], cues: unknown[] = [];
  const sink = expressionSink({ cue(c) { cues.push(c); }, present(text) { cues.push({ type: 'remark', text }); return true; },
    validTarget: target => target === 'window-42', glance(target) { cues.push({ harmlessGlance: target }); return true; } });
  const directory = path.join(root, String(results.length));
  const scene = () => new ConversationScene(directory, () => true, () => true, () => now);
  const provider: LLMProvider = { name: 'deterministic-fixture', local: true,
    async *stream(messages) { calls++; prompts.push(messages); if (!answer) throw new Error('Unexpected model request'); yield JSON.stringify(answer); },
    async test() { return { ok: true, detail: 'fixture' }; }, async listModels() { return []; } };
  const make = () => new BehaviorCore({ directory, provider, scene: scene(), now: () => now, memories: () => [],
    express(e) { expressions.push(e); return sink(e); } });
  let core = make();
  const trace = [], baseline = new DialogueDirector(() => .5, () => now);
  for (const step of scenario.steps) {
    now += step.after; answer = step.answer;
    if (step.restart) core = make();
    const before = calls, start = performance.now();
    const decision = await core.dispatch(step.event);
    // Actual local director, not a fabricated baseline transcript. This is ONLY its local lane.
    const localLine = step.event.kind === 'interact' && step.event.contact
      ? baseline.choose({ event: step.event.contact }, { required: true })
      : step.event.kind === 'opportunity' ? baseline.choose({ event: 'perch' }) : '';
    trace.push({ event: step.event, result: decision, calls: calls - before, elapsedMs: +(performance.now() - start).toFixed(3),
      interests: core.snapshot().interests, baselineLocalLane: localLine });
  }
  results.push({ name: scenario.name, calls, expressions, cues, trace, finalState: core.snapshot(), prompts });
}
const output = process.argv[2] ?? 'docs/stage0/replay-results.json';
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, JSON.stringify({ generatedAt: new Date().toISOString(), mode: 'deterministic mock; dialogue quality not measured', results }, null, 2));
console.log(JSON.stringify(results.map(({ name, calls, trace }) => ({ name, calls, actions: trace.map(t => t.result.action) })), null, 2));
console.log(`Saved ${output}. Synthetic state directory: ${root}`);
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
