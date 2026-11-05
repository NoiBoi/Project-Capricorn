import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { assertSyntheticProfile } from './selection';
import { SessionRecorder } from './diagnostics';

export const DailyConfig = z.object({
  model: z.string().max(200).default(''),
  maxRequests: z.number().int().min(1).max(10000).default(100),
  requestsPerHour: z.number().int().min(1).max(1000).default(30),
  ambientMs: z.number().int().min(10000).max(3600000).default(180000),
  maxTokens: z.number().int().min(1).max(1000000000).default(2000000),
  diskBudgetMB: z.number().int().min(64).max(102400).default(4096),
  inactivityPacing: z.boolean().default(true),
}).strict();
export type DailySettings = z.infer<typeof DailyConfig>;
/** Request admission lives at the HTTP boundary, including authenticated retries. */
export class DailySession {
  readonly recorder: SessionRecorder;
  config: DailySettings;
  private file: string;
  private ledger: string;
  private ledgerError?: string;
  private pausedValue: boolean;
  private times: number[] = [];
  private requests = 0;
  private inputTokens = 0;
  private outputTokens = 0;
  private missingUsage = 0;
  private startedAt?: number;
  private activityAt = Date.now();
  private lastAmbient = 0;
  private cycles = 0;
  private requestCycle?: string;
  private requestId?: string;
  constructor(readonly profile: string, readonly required = true) {
    this.file = path.join(profile, 'runtime2', 'daily-settings.json'); assertSyntheticProfile(this.file);
    this.ledger = path.join(profile, 'runtime2', 'daily-usage.json'); assertSyntheticProfile(this.ledger);
    this.config = DailyConfig.parse({}); this.pausedValue = required;
    try { this.config = DailyConfig.parse(JSON.parse(fs.readFileSync(this.file, 'utf8'))); } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') this.pausedValue = true; }
    try { const value = z.object({ times: z.array(z.number().finite()).max(10000) }).strict().parse(JSON.parse(fs.readFileSync(this.ledger, 'utf8'))); this.times = value.times.filter(t => t > Date.now() - 3600000); }
    catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') this.ledgerError = 'Usage ledger is unreadable; cloud inference is disabled until local storage is repaired.'; }
    this.recorder = new SessionRecorder(profile);
  }
  async configure(value: unknown) {
    if (!this.pausedValue) throw Error('Pause before changing session settings.');
    const config = DailyConfig.parse(value); assertSyntheticProfile(this.file);
    await fs.promises.mkdir(path.dirname(this.file), { recursive: true });
    await fs.promises.writeFile(this.file + '.tmp', JSON.stringify(config, null, 2)); await fs.promises.rename(this.file + '.tmp', this.file);
    this.config = config;
  }
  get paused() { return this.pausedValue; }
  get status() { return { profile: this.profile, paused: this.paused, startedAt: this.startedAt, config: this.config, ledgerError: this.ledgerError, usage: { requests: this.requests, requestsLastHour: this.times.filter(t => t > Date.now() - 3600000).length, inputTokens: this.inputTokens, outputTokens: this.outputTokens, tokenTotalsIncomplete: this.missingUsage > 0, missingUsage: this.missingUsage, cycles: this.cycles }, recording: this.recorder.status }; }
  async start(metadata: Record<string, unknown>) {
    if (this.recorder.status.active) throw Error('Stop the current session first.');
    if (!this.config.model) throw Error('Load the account catalog and select a model first.');
    this.pausedValue = true;
    await this.recorder.start({ ...metadata, config: this.config, profile: path.basename(this.profile) }, this.config.diskBudgetMB * 1024 ** 2);
    this.requests = 0; this.inputTokens = 0; this.outputTokens = 0; this.missingUsage = 0; this.cycles = 0;
    // The rolling hourly window deliberately survives stop/start within this process.
    this.startedAt = Date.now(); this.activityAt = Date.now(); this.lastAmbient = Date.now(); this.pausedValue = false;
  }
  pause() { this.pausedValue = true; this.recorder.event('control.pause', {}); }
  resume() { if (this.required && !this.recorder.status.active) throw Error('Start a diagnostic session before resuming.'); this.pausedValue = false; this.recorder.event('control.resume', {}); }
  async stop(reason = 'user') { this.pause(); await this.recorder.stop(this.status.usage, reason); }
  activity() { this.activityAt = Date.now(); }
  get ambientInterval() {
    return this.config.ambientMs * (this.config.inactivityPacing && Date.now() - this.activityAt > 10 * 60000 ? 3 : 1);
  }
  ambientReady() {
    return !this.paused && !this.ledgerError && this.requests < this.config.maxRequests &&
      this.inputTokens + this.outputTokens < this.config.maxTokens &&
      this.times.filter(t => Date.now() - t < 3600000).length < this.config.requestsPerHour &&
      Date.now() - this.lastAmbient >= 10000;
  }
  cycle(id: string, ambient: boolean) { this.requestCycle = id; this.cycles++; if (ambient) this.lastAmbient = Date.now(); }
  requestIdentity(id: string) { this.requestId = id; }
  admit(body: unknown) {
    this.times = this.times.filter(t => t > Date.now() - 3600000);
    const reason = this.ledgerError ? 'usage_ledger_unavailable' : this.paused ? 'paused' : this.required && !this.recorder.status.active ? 'recording_inactive' : this.requests >= this.config.maxRequests ? 'session_request_limit' : this.times.length >= this.config.requestsPerHour ? 'hourly_request_limit' : this.inputTokens + this.outputTokens >= this.config.maxTokens ? 'reported_token_limit' : undefined;
    if (reason) { this.recorder.event('provider.denied', { reason }, { cycleId: this.requestCycle, requestId: this.requestId }); throw Object.assign(Error('Cloud request denied: ' + reason + '. Check daily-test controls.'), { code: reason }); }
    this.requests++; this.missingUsage++; this.times.push(Date.now());
    try {
      assertSyntheticProfile(this.ledger); assertSyntheticProfile(this.ledger + '.tmp');
      const fd = fs.openSync(this.ledger + '.tmp', 'w');
      try { fs.writeFileSync(fd, JSON.stringify({ times: this.times })); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
      fs.renameSync(this.ledger + '.tmp', this.ledger);
    } catch { this.pausedValue = true; this.ledgerError = 'Usage ledger write failed; no new inference was sent.'; throw Error(this.ledgerError); }
    const wire = body as { model?: string; instructions?: string; tools?: unknown } | null;
    const instructionToolFingerprint = createHash('sha256')
      .update(JSON.stringify([wire?.model, wire?.instructions, wire?.tools])).digest('hex');
    this.recorder.event('provider.request', {
      number: this.requests, wireUtf8Bytes: Buffer.byteLength(JSON.stringify(body)), instructionToolFingerprint,
      ...requestTextMeasure(body),
    }, { cycleId: this.requestCycle, requestId: this.requestId });
    this.recorder.request(this.requestId!, 'wire-' + this.requests, body, this.requestCycle);
  }
  protocol(event: unknown) { this.recorder.event('provider.stream', event, { cycleId: this.requestCycle, requestId: this.requestId }); }
  usage(usage?: { inputTokens: number; outputTokens: number }) {
    if (usage) { this.inputTokens += usage.inputTokens; this.outputTokens += usage.outputTokens; this.missingUsage = Math.max(0, this.missingUsage - 1); }
    void this.recorder.checkpoint(this.status.usage).catch(() => {});
  }
}

/** Measure effective serialized input; image tokens are never estimated from base64 length. */
export function requestTextMeasure(body: unknown) {
  let images = 0;
  const textOnly = JSON.stringify(body, (key, value) => {
    if (key === 'image_url') { images++; return '[image omitted from text estimate]'; }
    return value;
  });
  const textUtf8Bytes = Buffer.byteLength(textOnly);
  return { textUtf8Bytes, approximateTextTokens: Math.ceil(textUtf8Bytes / 4), approximation: 'UTF-8 bytes/4, not a provider tokenizer', attachedImages: images, imageTokens: images ? null : 0 };
}
