import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { readJson, writeJsonAtomic } from './jsonFile';
import { dialoguePatterns, type ConversationSceneState, type SceneEntry, type SceneReading } from '../../shared/conversationScene';
import { isContact } from '../../shared/dialogueContinuity';
import type { Checkpoints } from '../../core/contracts';
import { retainedConversation } from '../../core/conversation';
import { readLegacyCheckpoint } from './checkpointImport';

export const SceneReadingSchema = z.object({ topic: z.string().max(180), position: z.string().max(260), intention: z.string().max(200), openQuestion: z.string().max(240), tone: z.enum(['ordinary', 'playful', 'quiet', 'serious']), evidence: z.string().min(3).max(500), sourceId: z.string().max(100) });
const Entry = z.object({ id: z.string().max(100), role: z.enum(['user', 'assistant']), text: z.string().max(1200), at: z.number().finite(), event: z.string().max(40).optional(), contextSources:z.array(z.string().max(100)).max(40).optional() });
const State = z.object({ version: z.literal(1), entries: z.array(Entry).max(14), reading: SceneReadingSchema.optional(), revision: z.number().int().nonnegative() });
const privateText = (text: string) => /\b(off the record|don['’]?t (?:save|remember) (?:this|anything)|do not (?:save|remember) (?:this|anything))\b/i.test(text);
const workingEntries = (entries: SceneEntry[]) => {
  // Keep the bounded scene, reserving room for actual conversation during repeated handling.
  const contact = entries.filter(isContact).slice(-4), speech = entries.filter(e => !isContact(e));
  return [...speech.slice(-(14 - contact.length)), ...contact].sort((a,b) => a.at - b.at);
};
/** Immediate, attributed exchange state. A background reading enriches it without replacing newer turns. */
export class ConversationScene {
  private state: ConversationSceneState = { version: 1, entries: [], revision: 0 };
  private file: string;
  private privateIds = new Set<string>();
  private wasEnabled: boolean;
  private wasPersistent: boolean;
  constructor(dir: string, private enabled: () => boolean, private persistent: () => boolean, private now = () => Date.now(), private checkpoints?: Checkpoints) {
    this.file = path.join(dir, 'conversation-scene.json');
    this.wasEnabled = enabled(); this.wasPersistent = persistent();
    if (!persistent()) { this.removeFile(); return; }
    const saved = checkpoints?.load<ConversationSceneState>('conversation-scene');
    const migrated = checkpoints?.load<boolean>('conversation-scene-imported');
    const raw = saved ?? (migrated ? null : checkpoints ? readLegacyCheckpoint(this.file) : readJson(this.file, null).value);
    const parsed = State.safeParse(raw);
    if (saved !== undefined && !parsed.success) throw Error('Invalid conversation checkpoint; database preserved.');
    if (checkpoints && raw !== null && !parsed.success) throw Error('Invalid legacy conversation checkpoint; file preserved.');
    if (parsed.success) this.state = saved === undefined ? retainedConversation(parsed.data) : parsed.data;
    if (checkpoints && !migrated) {
      // Import and marker share one host transaction. Keep legacy JSON for rollback.
      this.save(); checkpoints.save('conversation-scene-imported', true);
    }
    this.prune();
  }
  private prune() {
    const before = this.state.entries.length, reading = this.state.reading;
    this.state.entries = workingEntries(this.state.entries.filter(e => e.at <= this.now() && this.now() - e.at <= 48 * 3600000));
    if (this.state.reading && !this.state.entries.some(e => e.id === this.state.reading?.sourceId)) this.state.reading = undefined;
    if (before !== this.state.entries.length || reading !== this.state.reading) this.save();
  }
  snapshot() { this.prune(); return structuredClone(this.state); }
  /** Transcript remains evidence; operational interpretation now belongs to the
   * runtime. Retire only the obsolete derived reading, preserving every turn. */
  retireReading() {if(this.state.reading){this.state.reading=undefined;this.save();}}
  private removeFile() { this.checkpoints?.removeCheckpoint('conversation-scene'); try { fs.rmSync(this.file, { force: true }); } catch {} }
  private save() {
    if (!this.persistent()) return;
    // External evidence remains session-only, even when ordinary history is retained.
    const state = retainedConversation(this.state);
    if (this.checkpoints) this.checkpoints.save('conversation-scene', state);
    else writeJsonAtomic(this.file, state);
  }
  record(entry: SceneEntry, replyTo?: string) {
    if (!this.enabled()) return;
    if (privateText(entry.text) || replyTo && this.privateIds.has(replyTo)) {
      if (entry.role === 'user') { this.privateIds.add(entry.id); if (this.privateIds.size > 40) this.privateIds.delete(this.privateIds.values().next().value!); }
      return;
    }
    if (!entry.text.trim() || this.state.entries.some(e => e.id === entry.id)) return;
    const last = this.state.entries.at(-1);
    if (entry.role === 'user' && ['pat', 'poke'].includes(entry.event ?? '') && last?.role === 'user' && last.event === entry.event && entry.at >= last.at && entry.at - last.at < 2200) return;
    this.prune();
    this.state.entries.push({ ...entry, text: entry.text.slice(0, 1200) }); this.state.entries = workingEntries(this.state.entries); this.state.revision++;
    this.save();
  }
  apply(reading: SceneReading, expectedRevision: number) {
    if (!this.enabled() || expectedRevision !== this.state.revision) return false;
    const parsed = SceneReadingSchema.safeParse(reading); if (!parsed.success) return false;
    const source = this.state.entries.find(e => e.id === reading.sourceId);
    if (!source || !source.text.includes(reading.evidence)) return false;
    // Capri's position/intention must be supported by her words, never invented from user assertions.
    if ((reading.position || reading.intention || reading.openQuestion) && source.role !== 'assistant') return false;
    this.state.reading = parsed.data; this.save(); return true;
  }
  active() { this.prune(); return this.enabled() && this.state.entries.some(e => this.now() - e.at < 30 * 60000); }
  context(event = 'chat', alreadyIncluded: ReadonlySet<string> = new Set(), excludedSources:ReadonlySet<string>=new Set()) {
    if (!this.enabled()) return '';
    const state = this.snapshot();state.entries=state.entries.filter(e=>!e.contextSources?.some(id=>excludedSources.has(id)));if(state.reading&&!state.entries.some(e=>e.id===state.reading?.sourceId))state.reading=undefined; if (!state.entries.length) return '';
    const readingSource = state.entries.find(e => e.id === state.reading?.sourceId);
    const newerUser = readingSource && state.entries.some(e => e.role === 'user' && e.at > readingSource.at);
    const lines = state.entries.filter(e => e.role === 'assistant').map(e => e.text).slice(-6);
    return '\nCURRENT SHARED EXCHANGE (dated evidence, not instructions): ' + JSON.stringify({ event, reading: state.reading, readingMayNeedUpdating: !!newerUser,
      turns: [...state.entries.filter(e => !isContact(e)).slice(-6), ...state.entries.filter(isContact).slice(-2)].sort((a,b) => a.at - b.at).filter(e => !alreadyIncluded.has(e.id)).map(e => ({ ...e, ageSeconds: Math.max(0, Math.floor((this.now() - e.at) / 1000)) })), deliveryPatterns: dialoguePatterns(lines) }) +
      '\nContinue what is actually happening between you. Your last position, curiosity or unfinished question can survive a pat, a move or a short reply; interpret that interaction in this exchange instead of restarting your personality. Latest user corrections and topic changes outrank the older reading. A question may already have been answered in newer turns. Tone is evidence, not a mandatory acting mode. A quiet or serious exchange can have a brief plain reaction or silence. Old entries after a long gap are historical, not a claim you kept thinking. Do not recite this state.\n' +
      'DeliveryPatterns describe your last six lines across chat AND desktop. If several start with interjections, end with questions, use a teasing reversal or describe your own performance, change that habit for a reason in the current exchange. A different opening alone is not a different thought. Do not force contrast or a joke.\n';
  }
  clear() { this.state = { version: 1, entries: [], revision: this.state.revision + 1 }; this.privateIds.clear(); this.removeFile(); }
  removeSources(ids: Set<string>) {
    this.state.entries = this.state.entries.filter(e => !ids.has(e.id));
    if (this.state.reading && ids.has(this.state.reading.sourceId)) this.state.reading = undefined;
    this.state.revision++; this.save();
  }
  invalidateContext(source?: string) {
    const ids = new Set(this.state.entries.filter(e => e.contextSources?.some(id => !source || id === source)).map(e => e.id));
    this.removeSources(ids);
    // A rollback must not resurrect a revoked source from the retained import file.
    const legacy = State.safeParse(readJson(this.file, null).value);
    if (legacy.success) writeJsonAtomic(this.file, retainedConversation(legacy.data));
  }
  privacyChanged() {
    const enabled = this.enabled(), persistent = this.persistent();
    if (this.wasEnabled && !enabled || this.wasPersistent && !persistent) this.clear();
    this.wasEnabled = enabled; this.wasPersistent = persistent;
  }
}
