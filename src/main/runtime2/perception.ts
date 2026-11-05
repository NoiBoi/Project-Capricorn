import { createHash, randomUUID } from 'node:crypto';
import type { z } from 'zod';
import type { ChromePage } from '../life/chrome';
import type { Observation } from './contracts';
import type { WindowObservation } from '../desktop/inspection';
import type { WindowFocusArchive } from './windowFocusArchive';
import type { SessionRecorder } from './diagnostics';
import { observationHash, observationSlot, structuralChange } from './workingObservations';

export interface KnownWindow { handle: string; title: string; process: string; pid?: number; url?: string }
export type DisclosureMode = 'direct' | 'ambient';
export interface DesktopHost {
  windows(): KnownWindow[];
  active(): string | null;
  allowed(operation: 'collect' | 'disclose' | 'retain' | 'move' | 'state' | 'conversation', observation?: Observation, mode?: DisclosureMode): boolean;
  capture(handle: string, signal: AbortSignal): Promise<WindowObservation | undefined>;
  move(target: 'corner' | 'near_cursor' | 'left' | 'right' | 'perch' | 'idle', handle: string | undefined, signal: AbortSignal): Promise<{ ok: boolean; detail: string; [key: string]: unknown }>;
  body(): unknown;
  browserStatus?(): unknown;
  retentionDeadline?(observation: Observation): number;
}
export class Perception {
  private recent = new Map<string, Observation>();
  private pageGeneration = 0;
  private signatures = new Map<string, string>();
  private visualAbort = new AbortController();
  private visualAttempts = new Map<string, number>();
  constructor(private archive: WindowFocusArchive, readonly host: DesktopHost, private changed: (structural: boolean, source: string, identity?: string) => void, private recorder?: SessionRecorder) {}
  async observe(observation: Observation) { return this.retain(observation); }
  private async retain(observation: Observation, notify = true) {
    if (!this.host.allowed('collect', observation)) throw Error('Collection denied');
    const slot = observationSlot(observation);
    const previous = this.recent.get(slot);
    const changed = !previous || observationHash(previous) !== observationHash(observation);
    this.recent.delete(slot);
    this.recent.set(slot, observation);
    while (this.recent.size > 24) this.recent.delete(this.recent.keys().next().value!);
    if (this.host.allowed('retain', observation)) {
      const result = await this.archive.write(observation);
      this.recorder?.event('observation', { observation, retention: result });
    }
    if (notify && changed) this.changed(structuralChange(previous, observation), observation.source, observation.sourceIdentity);
    return observation;
  }
  browserForWindow(title: string) { return [...this.recent.values()].find(o => o.modality === 'browser-page' && (o.disclosure?.expiresAt ?? 0) > Date.now() && o.content.title === title.replace(/ - (?:Google Chrome|Chrome)$/i, '')); }
  current(mode: DisclosureMode) { return [...this.recent.values()].filter(o => (!o.disclosure?.expiresAt || o.disclosure.expiresAt > Date.now()) && this.host.allowed('disclose', o, mode)); }
  clear() { this.visualAbort.abort(); this.visualAbort = new AbortController(); this.visualAttempts.clear(); this.pageGeneration++; this.recent.clear(); this.signatures.clear(); }
  private async visualFallback(page: Observation, generation: number) {
    if (!['semantic','deep'].includes(page.provenance.metadata.mode) || page.content.text?.trim() || page.content.sections?.some(s => s.kind !== 'heading' && s.text.trim())) return;
    const key = page.sourceIdentity!;
    if (Date.now() - (this.visualAttempts.get(key) ?? 0) < 10000) return;
    const target = this.host.windows().find(w => w.handle === this.host.active() && /chrome/i.test(w.process) && w.title.replace(/ - (?:Google Chrome|Chrome)$/i,'') === page.content.title);
    if (!target || generation !== this.pageGeneration) return;
    this.visualAttempts.set(key, Date.now());
    while (this.visualAttempts.size > 24) this.visualAttempts.delete(this.visualAttempts.keys().next().value!);
    const signal = AbortSignal.any([this.visualAbort.signal, AbortSignal.timeout(10000)]);
    try {
      const visual = await this.inspect(target.handle, true, 'ambient', signal, [page.id], true);
      this.recorder?.event('visual.fallback', { pageId: page.id, observationId: visual.id, reason: 'No readable semantic body; visible-window image retained', pixelsAttached: false });
    } catch (e) {
      this.recorder?.event('visual.fallback.failed', { pageId: page.id, reason: e instanceof Error ? e.message : 'Native capture failed', canceled: signal.aborted });
    }
  }
  async currentImages(mode: DisclosureMode, signal: AbortSignal, candidates?: Observation[]) {
    // Retained experience survives focus loss. These are timestamped historical pixels,
    // not a claim that the captured page is still foreground or unchanged.
    const seen = new Set<string>();
    const visuals = (candidates ?? [...this.current(mode), ...await this.archive.recent({ limit: 100 })]).filter(o => o.modality === 'screenshot' && Date.now() - o.at < 10 * 60000 && this.host.allowed('disclose',o,mode)).sort((a,b)=>b.at-a.at).filter(o=>{const key=o.content.url ?? o.sourceIdentity ?? o.id;if(seen.has(key))return false;seen.add(key);return true;}).slice(0,2);
    const images: { observationId: string; dataUrl: string }[] = [];
    for (const o of visuals) {
      const blob = o.original && await this.archive.getEvidence(o.original.id); signal.throwIfAborted();
      if (blob && this.host.allowed('disclose', o, mode)) images.push({ observationId: o.id, dataUrl: `data:image/jpeg;base64,${Buffer.from(blob.data).toString('base64')}` });
    }
    return images;
  }
  async page(page: z.infer<typeof ChromePage>, intake: 'extension' | 'controlled-test' = 'controlled-test') {
    this.visualAbort.abort(); this.visualAbort = new AbortController();
    const generation = ++this.pageGeneration;
    if (page.operation === 'delete') { this.recorder?.event('source.delete', { source: 'chrome' }); this.clear(); return; }
    const key = 'chrome:' + createHash('sha256').update(page.recordId).digest('hex').slice(0,24);
    const slot = 'browser-page:' + key;
    const live = this.recent.get(slot);
    const old = live ?? await this.archive.latestSource(slot);
    if (generation !== this.pageGeneration) return;
    for (const [id, other] of this.recent) if (id !== 'browser-page:' + key && other.modality === 'browser-page') this.recent.delete(id);
    const playback = page.playback && { state: page.playback.state, duration: page.playback.duration };
    if (page.mode === 'metadata' && live && old?.content.url === page.url && old.content.title === page.title && JSON.stringify(old.content.playback) === JSON.stringify(playback)) { old.disclosure!.expiresAt = Date.now() + 90000; return; }
    const content = { handle: this.host.windows().find(w => w.handle === this.host.active() && /chrome/i.test(w.process))?.handle ?? null, process: 'chrome.exe', title: page.title, url: page.url, revision: page.revision,
      ...(playback ? { playback } : {}),
      text: page.mode === 'selection' ? page.selection : page.mode === 'excerpt' ? page.excerpt : '', sections: page.sections };
    const signature = createHash('sha256').update(JSON.stringify({ ...content, revision: 0, handle: null })).digest('hex');
    if (old && (old.disclosure?.retainUntil ?? Infinity) > Date.now()) {
      const { changedSections: _changed, ...oldContent } = old.content;
      const oldSignature = createHash('sha256').update(JSON.stringify({ ...oldContent, revision: 0, handle: null })).digest('hex');
      if (oldSignature === signature && this.host.allowed('collect', old)) {
        const refreshed = { ...old, content: { ...old.content, handle: content.handle },
          ...(old.disclosure ? { disclosure: { ...old.disclosure, expiresAt: Date.now() + 90000 } } : {}) };
        this.recent.set(slot, refreshed);
        this.recorder?.event('observation.deduplicated', { source: 'chrome', observationId: old.id });
        await this.visualFallback(refreshed, generation);
        return;
      }
    }
    const observation: Observation = { id: randomUUID(), at: page.occurredAt, source: 'chrome', sourceIdentity: key, modality: 'browser-page', content,
      disclosure: { source: 'chrome', url: page.url, retain: false, expiresAt: Date.now() + 90000 },
      provenance: { authority: 'host', collector: intake === 'extension' ? 'chrome.extension' : 'controlled-test', metadata: { mode: page.mode, pageRecordId: page.recordId, revision: String(page.revision), evidence: intake === 'extension' ? 'authorized-extension-payload' : 'controlled-test-intake' } },
      loss: { truncated: true, missing: ['full-dom', 'non-visible-content', 'extension-bounded-text', 'text-may-be-redacted'] },
      related: old ? [old.id] : [] };
    if (!this.host.allowed('collect', observation)) return;
    observation.disclosure!.retain = this.host.allowed('retain', observation);
    // Preserve the complete accepted extension payload. It is already bounded and privacy filtered at the bridge.
    if (observation.disclosure!.retain) { observation.disclosure!.retainUntil = this.host.retentionDeadline?.(observation) ?? Date.now() + 7 * 86400000; const blob = await this.archive.putEvidence(Buffer.from(JSON.stringify(page)), 'application/json', observation.disclosure!.retainUntil); observation.original = { id: blob.id, observedAt: page.occurredAt }; }
    if (generation !== this.pageGeneration) return;
    if (old?.content.url === page.url && old.content.sections) observation.content.changedSections = page.sections.flatMap((section, i) => JSON.stringify(section) !== JSON.stringify(old.content.sections?.[i]) ? [i] : []);
    await this.retain(observation);
    if (observation.disclosure!.retain) this.recorder?.event('observation.original', { observationId: observation.id, page });
    await this.visualFallback(observation, generation);
  }
  async inspect(handle: string | undefined, screenshot: boolean, mode: DisclosureMode, signal: AbortSignal, related: string[] = [], notify = false) {
    signal.throwIfAborted();
    const target = this.host.windows().find(w => w.handle === (handle ?? this.host.active()));
    if (!target) throw Error('No known visible target window');
    const observation: Observation = { id: randomUUID(), at: Date.now(), source: 'desktop', sourceIdentity: `window:${target.handle}:${target.pid ?? ''}`, related, modality: screenshot ? 'screenshot' : 'window-metadata', content: { ...target },
      disclosure: { source: /chrome/i.test(target.process) ? 'chrome' : 'screen', ...(target.url ? { url: target.url } : {}), retain: false }, provenance: { authority: 'host', collector: screenshot ? 'electron.window-exposed-crop' : 'win32.window', metadata: {} }, loss: { truncated: false, missing: screenshot ? ['occluded-regions', 'offscreen-content'] : ['window-contents'] } };
    if (!this.host.allowed('collect', observation) || !this.host.allowed('disclose', observation, mode)) throw Error('Window inspection denied');
    if (!screenshot) return this.retain(observation, false);
    const capture = await new Promise<WindowObservation | undefined>((resolve, reject) => {
      const abort = () => reject(Error('Capture cancelled'));
      signal.addEventListener('abort', abort, { once: true });
      this.host.capture(target.handle, signal).then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
      if (signal.aborted) abort();
    }); signal.throwIfAborted();
    if (!this.host.windows().some(w => w.handle === target.handle && w.pid === target.pid && w.title === target.title && w.process === target.process) || !this.host.allowed('collect', observation) || !this.host.allowed('disclose', observation, mode)) throw Error('Target changed or permission revoked during capture');
    if (!capture) throw Error('No permitted exposed window image available');
    if (!this.host.allowed('retain', observation)) throw Error('Visual evidence retention is disabled; no screenshot was archived or disclosed');
    const bytes = Buffer.from(capture.jpegBase64, 'base64');
    const signature = createHash('sha256').update(bytes).digest('hex');
    const previous = this.recent.get('screenshot:' + observation.sourceIdentity!);
    if (this.signatures.get(observation.sourceIdentity!) === signature && previous?.content.evidenceId && JSON.stringify(previous.related ?? []) === JSON.stringify(related) && await this.archive.getEvidence(previous.content.evidenceId)) return previous;
    const blob = await this.archive.putEvidence(bytes, 'image/jpeg', this.host.retentionDeadline?.(observation)); signal.throwIfAborted();
    observation.disclosure!.retainUntil = this.host.retentionDeadline?.(observation) ?? Date.now() + 7 * 86400000;
    observation.content.evidenceId = blob.id; observation.original = { id: blob.id, observedAt: observation.at }; observation.disclosure!.retain = true;
    observation.provenance.metadata = { crop: JSON.stringify(capture.region), window: JSON.stringify(capture.window ?? null), imageSize: JSON.stringify(capture.imageSize ?? null), encoding: 'jpeg', collectorMaximum: '960x640', interpretation: 'none' };
    const result = await this.retain(observation, notify);
    this.recorder?.event('evidence.image', { observationId: observation.id, capturedAt: observation.at, dataUrl: `data:image/jpeg;base64,${capture.jpegBase64}`, pixelsAttached: false, metadata: observation.provenance.metadata });
    this.signatures.set(observation.sourceIdentity!, signature); return result;
  }
}
