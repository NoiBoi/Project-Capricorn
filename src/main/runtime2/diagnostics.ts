import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { createInterface } from 'node:readline';
import { assertSyntheticProfile } from './selection';

export interface DiagnosticEvent { id: string; at: number; monotonicMs: number; type: string; cycleId?: string; requestId?: string; data: any }
/** Never receives HTTP headers or credentials. Preserve authorized content; strip credential-shaped fields. */
export function sanitizeDiagnostic(value: unknown): any {
  if (typeof value === 'string') return value.replace(/Bearer\s+[A-Za-z0-9._~+\/-]+=*/gi, 'Bearer [redacted]');
  if (Array.isArray(value)) return value.map(sanitizeDiagnostic);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k,v]) => [k, /^(authorization|cookie|set-cookie|password|access_?token|refresh_?token|id_?token|client_?secret|api_?key)$/i.test(k) ? '[redacted]' : sanitizeDiagnostic(v)]));
  return value;
}

/** Incrementally written local record. Bounded queue; recording errors never crash cognition. */
export class SessionRecorder {
  readonly root: string;
  private folder?: string;
  private enabled = false;
  private queue = Promise.resolve();
  private pendingBytes = 0;
  private bytes = 0;
  private maxBytes = 4 * 1024 ** 3;
  private images = new Set<string>();
  private error?: string;
  private metadata: Record<string, unknown> = {};
  private reportQueue: Promise<string | undefined> = Promise.resolve(undefined);
  private stopTask?: Promise<void>;
  constructor(profile: string) { this.root = path.join(profile, 'runtime2', 'diagnostics'); assertSyntheticProfile(this.root); }
  get status() { return { active: this.enabled, folder: this.folder, bytes: this.bytes, error: this.error, maxBytes: this.maxBytes }; }
  async start(metadata: Record<string, unknown>, maxBytes = this.maxBytes) {
    if (this.enabled) throw Error('A diagnostic session is already recording.');
    await this.stopTask?.catch(() => undefined);
    this.stopTask = undefined;
    await this.flush();
    await this.reportQueue.catch(() => undefined);
    this.maxBytes = maxBytes; this.error = undefined;
    this.images.clear();
    assertSyntheticProfile(this.root); await fs.promises.mkdir(this.root, { recursive: true });
    // Budget covers ALL retained sessions. Never silently delete a user's recording.
    const size = async (dir: string): Promise<number> => {
      let total = 0;
      for (const item of await fs.promises.readdir(dir, { withFileTypes: true })) {
        const file = path.join(dir, item.name); assertSyntheticProfile(file);
        total += item.isDirectory() ? await size(file) : (await fs.promises.stat(file)).size;
      } return total;
    };
    this.bytes = await size(this.root);
    if (this.bytes > maxBytes - 1024 * 1024) throw Error('Diagnostic disk budget is full. Move reviewed sessions out of the diagnostic folder or raise the budget.');
    this.folder = path.join(this.root, new Date().toISOString().replace(/[:.]/g,'-') + '-' + randomUUID().slice(0,8));
    await fs.promises.mkdir(path.join(this.folder, 'requests'), { recursive: true });
    await fs.promises.mkdir(path.join(this.folder, 'evidence'));
    this.metadata = { version: 1, id: path.basename(this.folder), startedAt: Date.now(), ...sanitizeDiagnostic(metadata) };
    this.enabled = true;
    this.event('session.start', metadata);
    await this.checkpoint();
    await this.report();
  }
  private write(relative: string, bytes: Buffer, append = false) {
    if (!this.enabled || !this.folder) return;
    // Leave headroom for the derived report, final metadata and redacted review copy.
    if (this.bytes + this.pendingBytes + bytes.length > this.maxBytes * .75 || this.pendingBytes + bytes.length > 32 * 1024 ** 2) {
      this.error = 'Recording stopped: disk budget or writer backlog limit reached. Existing files are recoverable.';
      this.enabled = false; return;
    }
    const folder = this.folder;
    this.pendingBytes += bytes.length;
    this.queue = this.queue.then(async () => {
      try {
        const file = path.join(folder, relative); assertSyntheticProfile(file);
        if (append) {
          const fd = await fs.promises.open(file, 'a');
          try { await fd.writeFile(bytes); await fd.sync(); } finally { await fd.close(); }
        } else {
          const temp = file + '.tmp'; assertSyntheticProfile(temp);
          const fd = await fs.promises.open(temp, 'w');
          try { await fd.writeFile(bytes); await fd.sync(); } finally { await fd.close(); }
          await fs.promises.rename(temp, file);
        }
        this.bytes += bytes.length;
      } catch (e) { this.error = 'Recording stopped: local write failed (' + ((e as NodeJS.ErrnoException).code ?? 'io_error') + '). Existing files are recoverable.'; this.enabled = false; }
      finally { this.pendingBytes -= bytes.length; }
    });
  }
  private externalize(value: unknown): any {
    if (typeof value === 'string' && /^data:image\/(jpeg|png);base64,/.test(value)) {
      const mime = value.slice(5, value.indexOf(';')), bytes = Buffer.from(value.slice(value.indexOf(',') + 1), 'base64');
      const hash = createHash('sha256').update(bytes).digest('hex'), reference = 'evidence/' + hash + (mime === 'image/jpeg' ? '.jpg' : '.png');
      if (!this.images.has(hash)) { this.write(reference, bytes); this.images.add(hash); }
      return { imageFile: reference, sha256: hash, mime, bytes: bytes.length, pixelsAttached: true };
    }
    if (Array.isArray(value)) return value.map(v => this.externalize(v));
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k,v]) => [k, this.externalize(v)]));
    return value;
  }
  event(type: string, data: unknown, links: { cycleId?: string; requestId?: string } = {}) {
    if (!this.enabled) return;
    const event: DiagnosticEvent = { id: randomUUID(), at: Date.now(), monotonicMs: performance.now(), type, ...links, data: this.externalize(sanitizeDiagnostic(data)) };
    this.write('events.jsonl', Buffer.from(JSON.stringify(event) + '\n'), true);
  }
  request(id: string, stage: string, data: unknown, cycleId?: string) {
    if (!this.enabled || !/^[a-zA-Z0-9_-]+$/.test(id)) return;
    const file = `requests/${id}-${stage}.json`;
    const value = this.externalize(sanitizeDiagnostic(data));
    const json = JSON.stringify(value, null, 2);
    this.write(file, Buffer.from(json));
    const escape = (v: string) => v.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
    const images: string[] = [];
    const visit = (v: any) => { if (!v || typeof v !== 'object') return; if (typeof v.imageFile === 'string') images.push(v.imageFile); Object.values(v).forEach(visit); }; visit(value);
    this.write(file + '.html', Buffer.from('<!doctype html><meta charset="utf-8"><title>Exact inference record</title><style>body{background:#10151e;color:#e6edf7;font:15px system-ui}pre{white-space:pre-wrap;overflow-wrap:anywhere}img{max-width:95%}</style><a href="../report.html">Session timeline</a><h1>' + escape(stage) + '</h1><p>Image bytes are stored separately. Their hash and file replace the data URL; all other request content is preserved except credential-shaped redactions.</p><pre>' + escape(json) + '</pre>' + [...new Set(images)].map(file => '<img alt="Retained image" src="../' + escape(file) + '">').join('')));
    this.event('request.' + stage, { file, inspector: file + '.html' }, { cycleId, requestId: id });
  }
  async flush() { await this.queue; }
  async checkpoint(counters?: unknown, final = false) {
    if (!this.folder || this.stopTask && !final) return;
    const value = { ...this.metadata, counters, recording: this.enabled, writerError: this.error, bytes: this.bytes };
    // Checkpoints and final reports need to remain writable after recording stops.
    const file = path.join(this.folder, 'session.json'); assertSyntheticProfile(file);
    this.queue = this.queue.then(async () => {
      try { assertSyntheticProfile(file + '.tmp'); await fs.promises.writeFile(file + '.tmp', JSON.stringify(value, null, 2)); await fs.promises.rename(file + '.tmp', file); }
      catch (e) { this.enabled = false; this.error = 'Recording stopped: metadata write failed (' + ((e as NodeJS.ErrnoException).code ?? 'io_error') + ').'; }
    });
    await this.queue;
  }
  stop(counters?: unknown, reason = 'user') {
    if (!this.folder) return Promise.resolve();
    return this.stopTask ??= this.finish(counters, reason);
  }
  private async finish(counters: unknown, reason: string) {
    this.event('session.stop', { reason, counters }); this.enabled = false;
    await this.flush(); this.metadata.endedAt ??= Date.now();
    await this.checkpoint(counters, true); await this.report();
  }
  report() {
    const next = this.reportQueue.catch(() => undefined).then(() => this.buildReport());
    this.reportQueue = next; return next;
  }
  private async buildReport() {
    await this.flush(); if (!this.folder) return;
    const file = path.join(this.folder, 'events.jsonl');
    const events: DiagnosticEvent[] = [];
    if (fs.existsSync(file)) {
      const lines = createInterface({ input: fs.createReadStream(file), crlfDelay: Infinity });
      for await (const line of lines) { try { const e = JSON.parse(line); if (e.type !== 'provider.stream') events.push(e); } catch { /* Recover complete lines after a crash. */ } }
    }
    const html = renderDiagnosticReport({ metadata: this.metadata, writer: this.status, events });
    if (this.bytes + Buffer.byteLength(html) > this.maxBytes) throw Error('Diagnostic budget has no room for the derived report. Original events and requests are preserved. Move older sessions or raise the disk budget.');
    const report = path.join(this.folder, 'report.html'); assertSyntheticProfile(report);
    await fs.promises.writeFile(report + '.tmp', html); await fs.promises.rename(report + '.tmp', report);
    return report;
  }
  async exportRedacted() {
    await this.flush(); if (!this.folder) throw Error('Start a diagnostic session first.');
    // Deliberate allowlist. No prompts, page text, titles, images, paths or account identity.
    const file = path.join(this.folder, 'shareable-redacted.json'); assertSyntheticProfile(file);
    assertSyntheticProfile(file + '.tmp');
    const fd = await fs.promises.open(file + '.tmp', 'w'); let size = 0, first = true;
    try {
      await fd.writeFile('{"scope":"Event types and timing only. Original detailed record remains local.","events":[');
      const lines = createInterface({ input: fs.createReadStream(path.join(this.folder, 'events.jsonl')), crlfDelay: Infinity });
      for await (const line of lines) {
        let e: DiagnosticEvent; try { e = JSON.parse(line); } catch { continue; }
        const entry = (first ? '' : ',') + JSON.stringify({ id: e.id, at: e.at, type: e.type, cycleId: e.cycleId, requestId: e.requestId });
        size += Buffer.byteLength(entry);
        if (this.bytes + size + 1024 > this.maxBytes) throw Error('Diagnostic disk budget has no room for the redacted export.');
        await fd.writeFile(entry); first = false;
      }
      await fd.writeFile(']}'); await fd.sync();
    } finally { await fd.close(); }
    await fs.promises.rename(file + '.tmp', file); return file;
  }
}

export function renderDiagnosticReport(data: unknown) {
  const json = JSON.stringify(data).replace(/</g,'\\u003c').replace(/\u2028/g,'\\u2028').replace(/\u2029/g,'\\u2029');
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src 'self' file: data:"><title>Capri session report</title><style>body{font:15px system-ui;background:#10151e;color:#e6edf7;margin:28px}button,input,select{font:inherit;padding:8px;background:#233247;color:inherit;border:1px solid #668}header{background:#10151e;padding:12px}article{border-top:1px solid #456;padding:10px}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#192333;padding:14px}img{max-width:96%;max-height:520px}small{color:#9cbbd7}a{color:#86ccff}</style><header><h1>Capri diagnostic session</h1><p id="totals"></p><details><summary>Session summary and counters</summary><div id="summary"></div></details><p>Local, private record. Only exposed outputs and host decisions are recorded. Images may contain sensitive content.</p><input id="filter" placeholder="Filter event type, cycle or investigation ID"><select id="cycles"><option value="">All cycles</option></select><button id="reload">Reload report</button></header><main id="timeline"></main><script>
const data=${json}; const events=data.events; const el=id=>document.getElementById(id);const counts={};events.forEach(e=>counts[e.type]=(counts[e.type]||0)+1);
const outputs=events.filter(e=>e.type==='provider.result');const usage=outputs.reduce((s,e)=>{s.input+=e.data.usage?.inputTokens||0;s.output+=e.data.usage?.outputTokens||0;if(e.data.usage?.cachedInputTokens!=null)s.cachedInput=(s.cachedInput??0)+e.data.usage.cachedInputTokens;return s},{input:0,output:0,cachedInput:null});
const tools=events.filter(e=>e.type==='tool.end');const silent=outputs.filter(e=>e.data.outcome==='silent').length;const utterances=events.filter(e=>e.type==='dialogue').length;const cycles=events.filter(e=>e.type==='cycle.start');const intervals=cycles.slice(1).map((e,i)=>e.at-cycles[i].at);const avg=intervals.length?Math.round(intervals.reduce((a,b)=>a+b,0)/intervals.length/1000):0;const failedTools=tools.filter(e=>e.data.execution.receipt.outcome!=='completed'||e.data.execution.result?.error);const repeatedFailures={};failedTools.forEach(e=>{const key=e.data.name+' '+e.data.arguments;repeatedFailures[key]=(repeatedFailures[key]||0)+1});let silentRun=0,maxSilentRun=0;outputs.filter(e=>e.data.outcome!=='tool-continuation').forEach(e=>{silentRun=e.data.outcome==='silent'?silentRun+1:0;maxSilentRun=Math.max(maxSilentRun,silentRun)});const spoken=events.filter(e=>e.type==='dialogue').map(e=>e.data.text);const noAction=cycles.filter(c=>!events.some(e=>e.cycleId===c.cycleId&&(e.type==='dialogue'||e.type==='tool.end'&&['move','write_memory','set_attention'].includes(e.data.name)&&e.data.execution.receipt.outcome==='completed'&&!e.data.execution.result?.error))).length;
el('summary').textContent=JSON.stringify({session:data.metadata,writer:data.writer,cycles:cycles.length,networkRequests:counts['provider.request']||0,failedRequests:counts['provider.error']||0,tokens:usage,tokenTotalsIncomplete:outputs.some(e=>!e.data.usage),toolCalls:tools.length,memoryWrites:tools.filter(e=>e.data.name==='write_memory').map(e=>e.data.execution.receipt.outcome),movements:tools.filter(e=>e.data.name==='move').length,attentionChanges:tools.filter(e=>e.data.name==='set_attention').length,silentCompletions:silent,silentUsage:outputs.filter(e=>e.data.outcome==='silent').reduce((s,e)=>{s.input+=e.data.usage?.inputTokens||0;s.output+=e.data.usage?.outputTokens||0;s.missing+=e.data.usage?0:1;return s},{input:0,output:0,missing:0}),utterances,unsolicitedUtterances:events.filter(e=>e.type==='dialogue'&&e.data.ambient).length,averageCycleIntervalSeconds:avg,cyclesWithoutExternalAction:noAction,maxConsecutiveSilentCompletions:maxSilentRun,repeatedUtterances:spoken.length-new Set(spoken).size,repeatedFailedToolCalls:Object.fromEntries(Object.entries(repeatedFailures).filter(([,n])=>n>1)),successfulMemoryWrites:tools.filter(e=>e.data.name==='write_memory'&&e.data.execution.receipt.outcome==='completed').length,deniedMemoryWrites:tools.filter(e=>e.data.name==='write_memory'&&e.data.execution.receipt.outcome==='denied').length,suppressedCalls:counts['tool.denied']||0,suppressedRequests:counts['provider.denied']||0},null,2);el('summary').style.whiteSpace='pre-wrap';el('totals').textContent=(data.metadata.controlledFixture?'CONTROLLED FIXTURE. Counts may represent mocked transport, not live cloud usage. ':'')+cycles.length+' cycles · '+(counts['provider.request']||0)+' network requests · '+usage.input+' input / '+usage.output+' output tokens';
for(const id of new Set(events.map(e=>e.cycleId).filter(Boolean))){const o=document.createElement('option');o.value=id;o.textContent=id;el('cycles').append(o)}
function inspect(value,parent){const pre=document.createElement('pre');pre.textContent=JSON.stringify(value,null,2);parent.append(pre);const visit=v=>{if(!v||typeof v!=='object')return;if(typeof v.imageFile==='string'&&v.imageFile.startsWith('evidence/')&&/^[a-f0-9]+[.](jpg|png)$/.test(v.imageFile.slice(9))){const image=document.createElement('img');image.src=v.imageFile;image.alt='Retained visual evidence';parent.append(image)}Object.values(v).forEach(visit)};visit(value)}
function draw(){el('timeline').replaceChildren();const q=el('filter').value.toLowerCase(),cycle=el('cycles').value;for(const e of events){if(cycle&&e.cycleId!==cycle)continue;if(q&&!JSON.stringify([e.type,e.cycleId,e.requestId,e.data.investigationIds,e.data.revision?.id]).toLowerCase().includes(q))continue;const a=document.createElement('article'),d=document.createElement('details'),s=document.createElement('summary');s.textContent=new Date(e.at).toLocaleTimeString()+' · '+e.type+' · '+(e.requestId||e.cycleId||'');d.append(s);d.addEventListener('toggle',()=>{if(!d.open||d.dataset.loaded)return;d.dataset.loaded='1';inspect(e,d);if(e.data.inspector){const link=document.createElement('a');link.href=e.data.inspector;link.textContent='Open exact inference record and images';d.append(link)}});a.append(d);el('timeline').append(a)}}el('filter').oninput=draw;el('cycles').onchange=draw;el('reload').onclick=()=>location.reload();draw();</script></html>`;
}
