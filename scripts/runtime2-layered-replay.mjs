import { build, buildSync } from 'esbuild';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { setTimeout as delay } from 'node:timers/promises';

const file = process.argv[2];
// Optional exact local pre-change source snapshot, including uncommitted refinements.
const beforeRoot = process.argv[3] && path.resolve(process.argv[3]);
if (!file) throw Error('Pass the local daily-test events.jsonl file.');
const events = fs.readFileSync(file, 'utf8').trim().split('\n').map(line => JSON.parse(line));
const requests = events.filter(e => e.type === 'provider.result');
const points = new Set(requests.map(e => e.cycleId));
const historicalUsage = requests.reduce((usage, { data }) => {
  usage.results++;
  if (typeof data.usage?.cachedInputTokens === 'number') { usage.cachedInputTokens += data.usage.cachedInputTokens; usage.cacheReported++; }
  if (data.round > 0) usage.continuations++;
  if (!data.usage) usage.missing++;
  else {
    usage.inputTokens += data.usage.inputTokens;
    usage.outputTokens += data.usage.outputTokens;
  }
  return usage;
}, { inputTokens: 0, outputTokens: 0, missing: 0, results: 0, continuations: 0, cachedInputTokens: 0, cacheReported: 0 });
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'capri-layered-replay-'));
const profile = path.join(scratch, 'Capri Buddy 2.0 Synthetic', 'offline-replay');
const originalClock = Date.now;
let now = events[0].at;
const require = createRequire(import.meta.url);
let archive, loop;
try {
  const entries = ['runtime2/windowFocusArchiveWorker', 'runtime2/windowFocusArchive', 'runtime2/cognitiveLoop',
    'runtime2/attention', 'runtime2/context', '../core/capabilities'];
  buildSync({
    entryPoints: entries.map(entry => ({ in: path.join('src/main', entry) + '.ts', out: path.basename(entry) })),
    loader: { '.md': 'text' }, bundle: true, platform: 'node', format: 'cjs', outExtension: { '.js': '.cjs' }, outdir: scratch,
  });
  const { encodeInput, encodeTools } = require(path.join(scratch, 'context.cjs'));
  const { WindowFocusArchive } = require(path.join(scratch, 'windowFocusArchive.cjs'));
  const { CognitiveLoop } = require(path.join(scratch, 'cognitiveLoop.cjs'));
  const { AttentionController } = require(path.join(scratch, 'attention.cjs'));
  const { TypedCapabilityExecutor } = require(path.join(scratch, 'capabilities.cjs'));
  const baselineDir = path.join(scratch, 'baseline');
  await build({
    entryPoints: ['cognitiveLoop', 'attention', 'windowFocusArchiveWorker'].map(name => 'src/main/runtime2/' + name + '.ts'),
    outdir: baselineDir, outExtension: { '.js': '.cjs' },
    loader: { '.md': 'text' }, bundle: true, platform: 'node', format: 'cjs',
    plugins: [{ name: 'corrected-baseline', setup(builder) {
      builder.onLoad({ filter: /runtime2[\\/].*\.ts$/ }, args => {
        const relative = path.relative(process.cwd(), args.path).split(path.sep).join('/');
        const saved = beforeRoot && path.join(beforeRoot, relative);
        const contents = beforeRoot ? fs.readFileSync(fs.existsSync(saved) ? saved : args.path, 'utf8')
          : execFileSync('git', ['show', '5f3cef2:' + relative], { encoding: 'utf8' });
        return { contents, loader: 'ts', resolveDir: path.dirname(args.path) };
      });
    } }],
  });
  const baseline = require(path.join(baselineDir, 'cognitiveLoop.cjs')).CognitiveLoop;
  const BaselineAttention = require(path.join(baselineDir, 'attention.cjs')).AttentionController;
  const model = { id: 'offline', label: 'Offline', contextTokens: 128000 };
  Date.now = () => now;
  async function replay(Loop, tag, cognition) {
    const replayProfile = profile + '-' + tag;
    now = events[0].at;
    archive = new WindowFocusArchive(replayProfile, { workerPath: path.join(tag === 'baseline' ? baselineDir : scratch, 'windowFocusArchiveWorker.cjs'), now: () => now });
    await archive.initialize();
    const cpuStarted = process.cpuUsage(), wallStarted = performance.now();
    const sizes = [], wireSizes = [], evidence = [], rawObservations = [], windows = [];
    const recordedIds = new Set();
    const wireCategories = {};
    const size = value => Buffer.byteLength(JSON.stringify(value));
    const stablePrefixes = new Set();
    loop = new Loop(archive, { models: async () => [model], shutdown() {},
      async infer(_model, input) {
        sizes.push(Buffer.byteLength(JSON.stringify(input)));
        const wire = {
          input: encodeInput(input), tools: encodeTools(input), instructions: input.identity, model: model.id, stream: true, store: false,
        };
        const total = size(wire);
        wireSizes.push(total);
        stablePrefixes.add(JSON.stringify([wire.instructions, wire.tools]));
        const keys = {
          episode: ['episode'], coverage: ['sceneCoverage'], scene: ['scene', 'recentChanges'],
          repeatedReferences: ['omittedChangeEvidenceIds'], state: ['activeState', 'dueReviews'],
          executionReceipts: ['previousExecutionReceipts'], deltas: ['contentDeltas'],
        };
        const categories = { identity: size(wire.instructions), tools: size(wire.tools) };
        const working = input.workingState;
        const workingItem = state => ({ role: 'user', content: JSON.stringify({ type: 'host_working_state', workingState: state }) });
        for (const [category, names] of Object.entries(keys)) {
          const stripped = { ...working };
          for (const key of names) delete stripped[key];
          categories[category] = size(workingItem(working)) - size(workingItem(stripped));
        }
        const records = wire.input.slice(0, input.records.length);
        for (const [i, record] of input.records.entries()) {
          const category = record.kind === 'user' || record.kind === 'assistant' ? 'dialogue' : 'evidenceAndToolHistory';
          categories[category] = (categories[category] ?? 0) + size(records[i]) + 1;
        }
        categories.images = wire.input.slice(input.records.length + 1).reduce((sum, item) => sum + size(item) + 1, 0);
        categories.other = total - Object.values(categories).reduce((sum, value) => sum + value, 0);
        for (const [key, value] of Object.entries(categories)) wireCategories[key] = (wireCategories[key] ?? 0) + value;
        if (input.workingState.sceneCoverage) windows.push(input.workingState.sceneCoverage);
        const raw = input.records.filter(r => r.kind === 'observation').map(r => r.observationId);
        rawObservations.push(...raw);
        evidence.push(...raw, ...(input.workingState.scene?.facts ?? []).map(o => o.id),
          ...input.workingState.recentChanges.map(o => o.id));
        return { text: '', calls: [] };
      },
    }, new TypedCapabilityExecutor(), { model: model.id, cognition });
    await loop.initialize();
    clearInterval(loop.timer);
    let admit = false;
    loop.ambientTrigger = () => {
      if (!admit) return;
      admit = false;
      return 'batched-change';
    };
    for (const event of events) {
      now = event.at;
      if (event.type === 'observation') {
        await archive.write(event.data.observation);
        recordedIds.add(event.data.observation.id);
      }
      if (event.type === 'dialogue') await archive.appendConversation({
        id: event.id, at: event.at, kind: 'assistant', text: event.data.text,
      });
      if (event.type === 'cycle.start' && points.has(event.cycleId)) {
        admit = true;
        loop.kick();
        while (loop.state.busy) await delay(1);
        if (loop.state.phase === 'error') throw Error('Offline context replay failed');
      }
    }
    const recoverable = (await Promise.all([...recordedIds].map(id => archive.get(id)))).filter(Boolean).length;
    const finalScene = await archive.readScene();
    await loop.shutdown();
    await archive.close();
    const ordered = [...sizes].sort((a, b) => a - b);
    const orderedWire = [...wireSizes].sort((a, b) => a - b);
    const total = sizes.reduce((sum, bytes) => sum + bytes, 0);
    return { requests: sizes.length, totalAssembledUtf8Bytes: total, meanBytes: Math.round(total / sizes.length),
      p50Bytes: ordered[Math.ceil(0.5 * sizes.length) - 1], p95Bytes: ordered[Math.ceil(0.95 * sizes.length) - 1], evidenceReferences: evidence.length,
      uniqueEvidenceReferences: new Set(evidence).size, rawObservations: rawObservations.length,
      wireCategories, distinctInstructionToolPrefixes: stablePrefixes.size,
      encodedSiwcBodyBytes: wireSizes.reduce((sum, bytes) => sum + bytes, 0),
      encodedSiwcP50Bytes: orderedWire[Math.ceil(0.5 * wireSizes.length) - 1],
      encodedSiwcP95Bytes: orderedWire[Math.ceil(0.95 * wireSizes.length) - 1],
      roughInputTokensAtFourBytesPerToken: Math.round(wireSizes.reduce((sum, bytes) => sum + bytes, 0) / 4),
      recoverable, unacknowledgedAfterFinalCycle: finalScene.coverage?.recorded ?? null,
      windowEvents: windows.reduce((sum, window) => sum + window.recorded, 0),
      windowUnexpanded: windows.reduce((sum, window) => sum + window.unexpandedRetained, 0),
      replayWallMs: Math.round(performance.now() - wallStarted), cpuMicroseconds: process.cpuUsage(cpuStarted),
      sqliteBytes: fs.statSync(path.join(replayProfile, 'runtime2', 'experience.sqlite')).size };
  }
  const previous = await replay(baseline, 'baseline');
  const layered = await replay(CognitiveLoop, 'layered', 'layered');
  const lean = await replay(CognitiveLoop, 'lean', 'lean');
  const twoSpeed = await replay(CognitiveLoop, 'two-speed', 'two-speed');

  function schedule(Controller, events, start, end, synthetic = false) {
    const controller = new Controller(30000, 10000, () => now);
    const current = Controller === AttentionController;
    let first = Infinity, last = -Infinity, structural = false, index = 0;
    let count = 0, redundant = 0, direct = false, due = false;
    const pendingLabels = new Map();
    const detected = {};
    const causes = {}, redundantCauses = {};
    for (now = start; now <= end; now += 1000) {
      while (events[index]?.at <= now) {
        const { data, at } = events[index++];
        if (data.watch) {
          controller.adjust({ source: 'chrome', sourceIdentity: 'assignment', afterMs: 600000, durationMs: 1800000,
            inferenceIntervalMs: 10000, observationIntervalMs: 1000,
            ...(current ? { priority: 'high', conditions: ['material-change'] } : {}) });
          continue;
        }
        if (data.label) pendingLabels.set(data.label, at);
        if (data.direct) { direct = true; continue; }
        if (data.due) { due = true; continue; }
        if (current && data.conditions) controller.observe(data.source, data.identity, data.conditions, at);
        if (current && data.ordinaryCandidate === false && !data.material && !controller.matchedCondition) continue;
        first = Math.min(first, at);
        last = at;
        structural ||= current ? data.material : data.structural;

      }
      const sources = new Set(pendingLabels.has('watched-edit') ? ['chrome', 'assignment'] : []);
      const reason = direct ? 'user' : controller.reason(first < Infinity, structural, due, sources, first, last);
      if (!reason) continue;
      count++;
      causes[reason] = (causes[reason] ?? 0) + 1;
      if (!pendingLabels.size && reason !== 'attention-review') {
        redundant++;
        redundantCauses[reason] = (redundantCauses[reason] ?? 0) + 1;
      }
      for (const [label, at] of pendingLabels) detected[label] = now - at;
      pendingLabels.clear();
      controller.started(reason);
      if (reason === 'attention-review') controller.acknowledge(controller.reviewAt);
      if (current) controller.clearMatch();
      controller.complete(!direct);
      direct = due = structural = false;
      first = Infinity;
    }
    return { requests: count, requestsPerHour: count / ((end - start) / 3600000), causes,
      ...(synthetic ? { redundant, redundantCauses, labeledDetected: Object.keys(detected).length, delaysMs: detected, missed: [...pendingLabels.keys()] } : {}) };
  }

  const synthetic = [];
  function event(at, data) { synthetic.push({ at, data }); }
  const duration = 3 * 3600000;
  const idleFrom = 3600000, idleThrough = 4800000;
  const activeHours = (duration - (idleThrough - idleFrom)) / 3600000;
  for (let start = 60000; start < duration; start += 300000) {
    if (start >= idleFrom && start < idleThrough) continue; // Idle stretch.
    for (let tab = 0; tab < 10; tab++) event(start + tab * 1000, { structural: true, ordinaryCandidate: false, material: start === 60000 && tab === 0,
      ...(start === 60000 && tab === 0 ? { label: 'first-document' } : {}) });
    for (let media = 90000; media < 240000; media += 60000) event(start + media, { structural: false, material: false, ordinaryCandidate: false });
  }
  event(1200000, { watch: true });
  event(1210000, { structural: false, material: false, ordinaryCandidate: false, source: 'chrome', identity: 'other-tab', conditions: ['material-change'] });
  event(1240000, { structural: false, material: true, source: 'chrome', identity: 'assignment', conditions: ['material-change'], label: 'watched-edit' });
  for (let i = 0; i < 60; i++) event(2400000 + i * 1000, { structural: false, material: false, ordinaryCandidate: false });
  event(5400000, { due: true, label: 'investigation-due' });
  event(6600000, { structural: true, material: true, label: 'new-document' });
  event(8100000, { direct: true, label: 'user-interruption' });
  synthetic.sort((a, b) => a.at - b.at);

  const recorded = events.filter(e => e.type === 'scheduler.observation').map(e => ({
    ...e, data: { ...e.data, material: e.data.material ?? e.data.structural },
  }));
  // Older recordings contain structural flags, but no material/watch labels.
  const schedulerReplay = {
    historicalFlagsOnly: true,
    baseline: schedule(BaselineAttention, recorded, events[0].at, events.at(-1).at),
    updated: schedule(AttentionController, recorded, events[0].at, events.at(-1).at),
  };
  async function retrieval(tag) {
    const replayProfile = profile + '-retrieval-' + tag;
    archive = new WindowFocusArchive(replayProfile, {
      workerPath: path.join(tag === 'baseline' ? baselineDir : scratch, 'windowFocusArchiveWorker.cjs'), now: () => now,
    });
    await archive.initialize();
    const dataset = [
      ['original', 'manual', 'Sapphire coolant line uses three valves'],
      ['duplicate', 'manual', 'Sapphire coolant line uses three valves'],
      ['superseded', 'manual', 'The valve count for sapphire coolant was two'],
      ['replacement', 'ticket', 'Sapphire replacement valve approved'],
      ['noise', 'music', 'Sapphire Moon album'],
      ['history', 'notebook', 'Thermal pressure test recorded a leak'],
    ];
    for (const [i, [id, source, text]] of dataset.entries()) await archive.write({
      id, at: now - 10000 + i * 1000, source, sourceIdentity: source, modality: 'browser-page',
      content: { title: source, process: 'fixture', handle: null, text },
      provenance: { authority: 'host', collector: 'fixture', metadata: {} },
      loss: { truncated: false, missing: [] },
    });
    const queries = [
      ['exact', { search: 'sapphire coolant', source: 'manual' }, ['duplicate', 'superseded']],
      ['partial', { search: 'sapphire valve replacement authorization', source: 'ticket' }, ['replacement']],
      ['paraphrase', { search: 'cerulean refrigerant' }, ['duplicate', 'superseded']],
      ['historical', { search: 'thermal pressure', to: now - 4000 }, ['history']],
      ['before-correction', { search: 'sapphire coolant', source: 'manual', to: now - 9000 }, ['duplicate']],
    ];
    const results = [];
    for (const [label, query, relevant] of queries) {
      const t = performance.now();
      const { hits } = await archive.discover({ ...query, limit: 3 });
      const latencyMs = performance.now() - t;
      const ids = hits.map(h => h.observation.id);
      const matched = ids.filter(id => relevant.includes(id)).length;
      results.push({ label, ids, expected: relevant, recall: matched / relevant.length,
        precision: ids.length ? matched / ids.length : null, latencyMs });
    }
    await archive.close();
    return results;
  }
  console.log(JSON.stringify({
    syntheticAfternoon: { hours: 3, activeHoursExcludingExplicitIdleBlock: activeHours,
      ...Object.fromEntries([['baseline', BaselineAttention], ['updated', AttentionController]].map(([tag, controller]) => {
        const result = schedule(controller, synthetic, 0, duration, true);
        return [tag, { ...result, requestsPerActiveHour: result.requests / activeHours }];
      })) },
    fixedPointReplay: { baselineSource: beforeRoot ? 'Exact local pre-change snapshot' : 'Historical commit 5f3cef2', baseline: previous, layered, lean, twoSpeed, modelFixture: 'silence; context and scheduling mechanics only, NOT behavioral acceptance', continuations: 0, reportedTokens: null },
    supplementalSmallEdit: schedule(AttentionController, [...synthetic,
      { at: 2410000, data: { structural: false, material: false, ordinaryCandidate: true, label: 'small-document-edit' } },
    ].sort((a,b) => a.at - b.at), 0, duration, true),
    historicalUsage, schedulerReplay, retrieval: { baseline: await retrieval('baseline'), updated: await retrieval('updated') },
  }, null, 2));
} finally {
  Date.now = originalClock;
  await loop?.shutdown();
  await archive?.close();
  fs.rmSync(scratch, { recursive: true, force: true });
}
