import { build, buildSync } from 'esbuild';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { setTimeout as delay } from 'node:timers/promises';

const file = process.argv[2];
if (!file) throw Error('Pass the local daily-test events.jsonl file.');
const events = fs.readFileSync(file, 'utf8').trim().split('\n').map(line => JSON.parse(line));
const requests = events.filter(e => e.type === 'provider.result');
const points = new Set(requests.map(e => e.cycleId));
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'capri-layered-replay-'));
const profile = path.join(scratch, 'Capri Buddy 2.0 Synthetic', 'offline-replay');
const originalClock = Date.now;
let now = events[0].at;
const require = createRequire(import.meta.url);
let archive, loop;
try {
  const entries = ['runtime2/windowFocusArchiveWorker', 'runtime2/windowFocusArchive', 'runtime2/cognitiveLoop',
    'runtime2/attention', '../core/capabilities'];
  buildSync({
    entryPoints: entries.map(entry => ({ in: path.join('src/main', entry) + '.ts', out: path.basename(entry) })),
    loader: { '.md': 'text' }, bundle: true, platform: 'node', format: 'cjs', outExtension: { '.js': '.cjs' }, outdir: scratch,
  });
  const { WindowFocusArchive } = require(path.join(scratch, 'windowFocusArchive.cjs'));
  const { CognitiveLoop } = require(path.join(scratch, 'cognitiveLoop.cjs'));
  const { AttentionController } = require(path.join(scratch, 'attention.cjs'));
  const { TypedCapabilityExecutor } = require(path.join(scratch, 'capabilities.cjs'));
  const baselinePath = path.join(scratch, 'baseline.cjs');
  await build({
    entryPoints: ['src/main/runtime2/cognitiveLoop.ts'], outfile: baselinePath,
    loader: { '.md': 'text' }, bundle: true, platform: 'node', format: 'cjs',
    plugins: [{ name: 'corrected-baseline', setup(builder) {
      builder.onLoad({ filter: /runtime2[\\/].*\.ts$/ }, args => {
        const relative = path.relative(process.cwd(), args.path).split(path.sep).join('/');
        const contents = execFileSync('git', ['show', '496aa2f:' + relative], { encoding: 'utf8' });
        return { contents, loader: 'ts', resolveDir: path.dirname(args.path) };
      });
    } }],
  });
  const baseline = require(baselinePath).CognitiveLoop;
  const model = { id: 'offline', label: 'Offline', contextTokens: 128000 };
  Date.now = () => now;
  async function replay(Loop, tag) {
    const replayProfile = profile + '-' + tag;
    now = events[0].at;
    archive = new WindowFocusArchive(replayProfile, { workerPath: path.join(scratch, 'windowFocusArchiveWorker.cjs'), now: () => now });
    await archive.initialize();
    const cpuStarted = process.cpuUsage(), wallStarted = performance.now();
    const sizes = [], evidence = [], rawObservations = [];
    loop = new Loop(archive, { models: async () => [model], shutdown() {},
      async infer(_model, input) {
        sizes.push(Buffer.byteLength(JSON.stringify(input)));
        const raw = input.records.filter(r => r.kind === 'observation').map(r => r.observationId);
        rawObservations.push(...raw);
        evidence.push(...raw, ...(input.workingState.scene?.facts ?? []).map(o => o.id),
          ...input.workingState.recentChanges.map(o => o.id));
        return { text: '', calls: [] };
      },
    }, new TypedCapabilityExecutor(), { model: model.id });
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
      if (event.type === 'observation') await archive.write(event.data.observation);
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
    await loop.shutdown();
    await archive.close();
    const ordered = [...sizes].sort((a, b) => a - b);
    const total = sizes.reduce((sum, bytes) => sum + bytes, 0);
    return { requests: sizes.length, totalAssembledUtf8Bytes: total, meanBytes: Math.round(total / sizes.length),
      p95Bytes: ordered[Math.ceil(0.95 * sizes.length) - 1], evidenceReferences: evidence.length,
      uniqueEvidenceReferences: new Set(evidence).size, rawObservations: rawObservations.length,
      replayWallMs: Math.round(performance.now() - wallStarted), cpuMicroseconds: process.cpuUsage(cpuStarted),
      sqliteBytes: fs.statSync(path.join(replayProfile, 'runtime2', 'experience.sqlite')).size };
  }
  const corrected = await replay(baseline, 'corrected');
  const layered = await replay(CognitiveLoop, 'layered');
  function schedule(stabilize, silent) {
    const controller = new AttentionController(30_000, 10_000, () => now);
    const observations = events.filter(e => e.type === 'scheduler.observation');
    let first = Infinity, latest = -Infinity, structural = false, count = 0, index = 0;
    for (now = events[0].at; now <= events.at(-1).at; now += 1000) {
      while (observations[index]?.at <= now) {
        const event = observations[index++];
        first = Math.min(first, event.at);
        latest = event.at;
        structural ||= event.data.structural;
      }
      const reason = controller.reason(first < Infinity, structural, false, new Set(), first, stabilize ? latest : -Infinity);
      if (reason) {
        count++;
        controller.started(reason);
        controller.complete(silent);
        first = Infinity;
        structural = false;
      }
    }
    return count;
  }
  function simulateAfternoon() {
    const controller = new AttentionController(30_000, 10_000, () => now);
    const hours = 3, end = hours * 3600000;
    const events = new Map();
    for (let start = 60_000; start < end; start += 300_000) {
      for (let switchAt = 0; switchAt < 10_000; switchAt += 1000) events.set(start + switchAt, true);
      for (let mediaAt = 90_000; mediaAt < 240_000; mediaAt += 60_000) events.set(start + mediaAt, false);
    }
    let first = Infinity, last = -Infinity, structural = false;
    let requests = 0, eligibleBursts = 0, respondedBursts = 0, firstMaterial = Infinity, longestDelayMs = 0;
    for (now = 0; now < end; now += 1000) {
      if (events.has(now)) {
        first = Math.min(first, now); last = now;
        if (events.get(now)) {
          structural = true;
          firstMaterial = Math.min(firstMaterial, now);
          if ((now - 60_000) % 300_000 === 0) eligibleBursts++;
        }
      }
      const reason = controller.reason(first < Infinity, structural, false, new Set(), first, last);
      if (!reason) continue;
      requests++;
      if (firstMaterial < Infinity) {
        respondedBursts++;
        longestDelayMs = Math.max(longestDelayMs, now - firstMaterial);
      }
      controller.started(reason);
      controller.complete(true);
      first = firstMaterial = Infinity;
      structural = false;
    }
    return { hours, requests, requestsPerHour: requests / hours, eligibleBursts, respondedBursts, longestDelayMs };
  }
  console.log(JSON.stringify({
    syntheticAfternoon: simulateAfternoon(),
    fixedPointReplay: { corrected, layered, modelFixture: 'silence', continuations: 0 },
    schedulerReplay: { baselineWithoutBackoff: schedule(false, false), stabilizedWithoutBackoff: schedule(true, false),
      baselineAllSilent: schedule(false, true), stabilizedAllSilent: schedule(true, true) },
  }, null, 2));
} finally {
  Date.now = originalClock;
  await loop?.shutdown();
  await archive?.close();
  fs.rmSync(scratch, { recursive: true, force: true });
}
