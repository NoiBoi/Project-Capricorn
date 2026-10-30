import { z } from 'zod';

export const LifePermissions = z.object({ collect: z.boolean(), live: z.boolean(), proactive:z.boolean().optional(), retain: z.boolean(), content: z.boolean(), learn: z.boolean().default(false) }).strict();
export const Stage2Config = z.object({
  calendars: z.array(z.string().min(1).max(256)).max(12).default([]),
  lastfmUser: z.string().max(100).regex(/^[\w.-]*$/).default(''),
  device: z.string().max(80).regex(/^[\w-]*$/).default(''),
  places: z.array(z.object({id:z.string().regex(/^[\w-]{1,60}$/), name:z.string().min(1).max(80),lat:z.number().min(-90).max(90),lon:z.number().min(-180).max(180),radius:z.number().min(50).max(5000),entities:z.array(z.string().max(100)).max(8).default([])}).strict()).max(30).default([]),
}).strict();
export type Stage2Settings = z.infer<typeof Stage2Config>;
export interface Stage2View { config:Stage2Settings; calendars:{id:string;name:string}[]; credentials:Record<string,boolean>; receiver:string; spotifyScrobbling:string; recentTracks:{artist:string;title:string;at:number}[]; learning:Record<string,{state:string;detail:string}> }
export const LifeSource = z.object({ id: z.string().min(1).max(100), kind: z.enum(['chrome', 'project', 'calendar', 'music', 'location', 'mail', 'teams', 'gradescope', 'discord']), name: z.string().min(1).max(100), paused: z.boolean().default(false), permissions: LifePermissions, sites: z.array(z.string().max(200)).max(40).default([]), folder: z.string().max(1000).optional(), entityId: z.string().max(100).optional(), retentionDays: z.number().int().min(1).max(30).default(7) }).strict();
export const LifeEvent = z.object({ source: z.string().min(1).max(100), recordId: z.string().min(1).max(200), revision: z.number().int().nonnegative(), type: z.string().min(1).max(60), occurredAt: z.number().finite().nonnegative(), receivedAt: z.number().finite().nonnegative(), expiresAt: z.number().finite().nonnegative(), entities: z.array(z.string().max(100)).max(8), quality: z.enum(['observed', 'user-statement', 'model-interpretation', 'uncertain-association']), permissions: LifePermissions, summary: z.string().max(1200), detail: z.string().max(2500).default(''), operation: z.enum(['upsert', 'correct', 'delete']).default('upsert'), importance: z.number().min(0).max(1).default(.3) }).strict();
export const LifeEntity = z.object({ kind:z.enum(['person','assignment','meeting','project','document','place','activity','communication','session','commitment']).optional(), id: z.string().min(1).max(100), name: z.string().min(1).max(100), aliases: z.array(z.string().min(2).max(200)).max(20), evidence: z.string().min(1).max(300), source: z.string().max(100).optional(), certainty: z.enum(['explicit', 'source-backed', 'uncertain']).default('explicit') }).strict();
export type LifeSourceConfig = z.infer<typeof LifeSource>;
export type LifeObservation = z.infer<typeof LifeEvent>;
export type LifeEntityRecord = z.infer<typeof LifeEntity>;
export const LifeSetupDraft = z.object({ sites: z.string().max(10000).optional(), name: z.string().max(100).optional(), retentionDays: z.string().max(4).optional(), aliases: z.string().max(5000).optional(), extensionId: z.string().max(64).optional() }).strict();
export type LifeDraft = z.infer<typeof LifeSetupDraft>;
export type CandidateStatus = 'pending' | 'deferred' | 'delivered' | 'dismissed' | 'expired' | 'superseded';
export interface LifeCandidate { id: string; source: string; recordId: string; revision: number; status: CandidateStatus; at: number; expiresAt: number; nextAt: number; attempts: number; reason: string; importance:number; novelty:number; deadline?:number; related:string[]; phase:'noticed'|'investigated'|'discussed'|'concluded'|'dismissed'|'resolved'|'exhausted'; acknowledgedAt?:number }
export interface SourceHealth { state: 'disconnected' | 'paused' | 'waiting' | 'syncing' | 'healthy' | 'error' | 'degraded' | 'unsupported'; detail: string; lastSync?: number; lastFailure?: number }
export interface LifeView { sources: LifeSourceConfig[]; entities: LifeEntityRecord[]; drafts: Record<string, LifeDraft>; events: LifeObservation[]; current: LifeObservation[]; proactiveCurrent:LifeObservation[]; candidates: LifeCandidate[]; health: Record<string, SourceHealth>; bridge: { state: string; port: number; extensionId: string }; learning: string }
export interface LifeAdapter { start(): void | Promise<void>; stop(): void; }
export const disconnectedChrome = (): LifeSourceConfig => ({ id: 'chrome', kind: 'chrome', name: 'Chrome', paused: false, permissions: { collect: false, live: false, retain: false, content: false, learn: false }, sites: [], retentionDays: 7 });
/** No credentials, query strings, fragments, authentication or financial pages. */
export function safePage(raw: string): string | null {
  try { const u = new URL(raw); if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password || /(^|[./_-])(login|signin|sign-in|auth|oauth|password|checkout|payment|billing|bank|account|inbox|mail|messages|medical|health)([./_-]|$)/i.test(u.hostname + u.pathname)) return null; return u.origin + u.pathname; } catch { return null; }
}
export function cleanEvidence(text: string, max = 1200) { return text.replace(/[\u0000-\u001f]/g, ' ').replace(/\b(?:sk-[\w-]+|gh[pousr]_[\w]+|Bearer\s+\S+|(?:password|secret|token|api[_ -]?key)\s*[:=]\s*\S+)\b/gi, '[redacted]').replace(/\b(?:\d[ -]?){13,19}\b/g, '[redacted]').trim().slice(0, max); }
