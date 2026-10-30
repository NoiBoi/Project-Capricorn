import type { SpeechOrigin, FeedbackKind } from '../core/performance';
// Typed IPC contract shared by main, preload and renderers.
import type { Mood, LifeEvent } from './personality';
import type { Settings, ToolName, Policy } from './settings';

export type ChatRole = 'user' | 'assistant' | 'system' | 'action';
export interface ChatMessage {
  id: string;
  role: ChatRole;
  content: string;
  ts: number;
  meta?: { speech?:SpeechOrigin; provider?: string; error?: string; interrupted?: boolean; actionStatus?: string; private?: boolean; contextSources?: string[] };
}

export interface MemoryRevision {
  at: number; messageId: string; evidence: string;
  before: { text: string; status: 'pending' | 'approved'; source: 'user' | 'model'; context?: MemoryItem['context']; learnedFrom?: MemoryItem['learnedFrom']; updatedAt?: number; archived?: boolean } | null;
}
export interface MemoryItem {
  id: string;
  text: string;
  createdAt: number;
  status: 'pending' | 'approved';
  source: 'user' | 'model';
  archived?: boolean;
  learnedFrom?: { messageId: string; evidence: string };
  revisions?: MemoryRevision[];
  updatedAt?: number;
  context?: { label: string; kind: 'fact' | 'preference' | 'interpretation'; asOf: string };
}
export interface Note { id: string; title: string; body: string; createdAt: number }
export interface Reminder { id: string; text: string; dueAt: number; kind: 'reminder' | 'timer'; fired: boolean }

export interface ActionRequest {
  id: string;
  tool: ToolName;
  args: Record<string, unknown>;
  summary: string; // human readable "what will happen"
  policy: Policy;
  tainted: boolean; // requested after untrusted content entered the turn
}
export interface ActionResult { id: string; ok: boolean; summary: string; data?: unknown }

/** Coarse status shown on the character + panel */
export type AssistantPhase = 'idle' | 'listening' | 'transcribing' | 'thinking' | 'speaking' | 'error' | 'offline';
export interface BubbleState { speech?:SpeechOrigin; text: string; phase: AssistantPhase; composer: boolean; side: 'left' | 'right'; tail?: { x: number; y: number }; startedAt?: number; delivery?: 'aside' | 'reply'; company?: string; previous?: {id:string;text:string;fading?:boolean}[]; maxHeight?:number; fading?:boolean }

/** Cues the main process sends to the character renderer */
export type CharacterCue =
  | { type: 'flourish'; kind: import('./theatrics').FlourishKind | null; side?: number }
  | { type: 'theatre'; kind: import('./theatrics').SceneKind | null; target?: { x: number; y: number }; stand?: boolean }
  | { type: 'cutin'; kind: 'grin' | 'laugh' | 'look' | 'eyes' | 'many'; preview?: boolean }
  | { type: 'userReturn'; from: 'idle' | 'sleep' }
  | { type: 'stayRest'; phase: 'sleep' | 'awake' | null }
  | { type: 'perchMotion'; phase: 'dangle' | 'stand' | null }
  | { type: 'devPreview'; preview: import('./developer').DevPreview | null }
  | { type: 'entrance' }
  | { type: 'activity'; kind: import('./activity').ActivityKind; side?: number }
  | { type: 'dragging'; active: boolean }
  | { type: 'attention'; point: { x: number; y: number } | null; seconds: number }
  | { type: 'life'; event: LifeEvent }
  | { type: 'phase'; phase: AssistantPhase }
  | { type: 'react'; performanceId?:number; reaction: 'happy' | 'surprised' | 'annoyed' | 'curious' | 'wave' | 'nod' }
  | { type: 'speak'; utteranceId: string; text: string }
  | { type: 'stopSpeech' }
  | { type: 'wake' }
  | { type: 'mic'; command: 'start' | 'stop' | 'cancel' }
  | { type: 'pause'; paused: boolean }
  | { type: 'interact'; enabled: boolean }
  | { type: 'presence'; idleSec: number; quiet: boolean; simulated?: 'idle' | 'sleep' }
  | { type: 'remark'; text: string }
  | { type: 'bubble'; text: string } // a line in her speech bubble, no gesture
  | { type: 'textTalk'; text: string }
  | { type: 'workPose'; pose: 'back' | 'crouch' | 'sit' | null } // while she works on the PC (null = back to normal)
  | { type: 'connection'; state: ConnectionStatus['state'] }
  | { type: 'teleport'; phase: 'out' | 'in'; id: number; effects: boolean; animation?: 'perch_glitch' }
  | { type: 'attachment'; mode: 'perch' | 'inverted' | 'moving' | null }
  | { type: 'dropHint'; edge: { x: number; y: number; width: number } | null }
  | { type: 'clip'; name: string }
  | { type: 'surface'; surface: 'taskbar' | 'window' | 'air' | 'edge_left' | 'edge_right' }
    | { type: 'poseSupport'; support: import('./secondaryBehavior').PoseSupport }
  | { type: 'pointer'; x: number; y: number }
  | { type: 'dash'; dir: -1 | 1 | 0 };

export interface ConnectionStatus {
  state: 'connecting' | 'connected' | 'disconnected' | 'error';
  provider: string;
  model?: string;
  usingFallback?: boolean;
  detail: string;
  checkedAt: number;
  latencyMs?: number;
  keySource?: 'secure-store' | 'environment' | 'none';
}

export interface Diagnostics {
  perception?: {snapshots:number;snapshotCharacters:number;pending:number;saturated:number;backgroundModelsOnIngest:number};
  agency?: { availability:string; attention:string|null; physical:{owner:string|null;state:string}; reconciledAt:number; intentions:{id:string;skill:string;state:string;deadline?:number;receipts:number}[] };
  version: string;
  electron: string;
  chrome: string;
  platform: string;
  userData: string;
  gpu: { status: Record<string, string>; info?: unknown };
  safeStorage: boolean;
  fullscreenWatcher: 'active' | 'unavailable' | 'disabled';
  speechRecognizer: { available: boolean; detail: string };
  provider: { name: string; ok: boolean; detail: string; latencyMs?: number };
  connection: ConnectionStatus;
  teleport: { auto: boolean; armed: boolean; nextInSec: number | null; last: string | null; count: number; blockedReason: string | null };
  settingsRepaired: string[];
  shortcuts: Record<string, string>;
  lastCrash: string | null;
  perf: { startupMs: number; mainRssMB: number; processes: { type: string; cpu: number; memMB: number }[]; fps?: number };
  displays: { id: number; bounds: { x: number; y: number; width: number; height: number }; scaleFactor: number; primary: boolean }[];
}

export interface PanelEvents {
  'chat:delta': { messageId: string; delta: string };
  'chat:done': { message: ChatMessage };
  'chat:message': { message: ChatMessage };
  'chat:phase': { phase: AssistantPhase; detail?: string };
  'action:confirm': ActionRequest;
  'action:result': ActionResult;
  'memory:changed': null;
  'settings:changed': Settings;
  'reminder:fired': Reminder;
  'transcript': { text: string; final: boolean };
  'panel:tab': string;
  'connection:status': ConnectionStatus;
}

export interface CharacterEvents {
  'cue': CharacterCue;
  'settings:changed': Settings;
}

/** invoke() channels from either renderer to main */
export interface InvokeMap {
  'life:draft': [{id:string;draft:import('./lifeContext').LifeDraft},void];
  'life:stage3': [void, import('./communications').Stage3View];
  'life:stage3Setup': [import('./communications').Stage3Settings, import('./communications').Stage3View];
  'life:accountAuth': [string,void];
  'life:accountChoices': [string,import('./communications').Stage3View];
  'life:accountSync': [string,void];
  'life:botKey': [string,void];
  'life:academic': [import('zod').infer<typeof import('./communications').AcademicImport>,number];
  'life:academicFile': [void,number];
  'life:forgetEntity': [string,void];
  'life:exclude': [{source:string;recordId:string},void];
  'life:stage2': [void, import('./lifeContext').Stage2View];
  'life:stage2Setup': [import('./lifeContext').Stage2Settings, import('./lifeContext').Stage2View];
  'life:stage2Key': [{key:'googleClient'|'googleClientSecret'|'lastfmKey';value:string},void];
  'life:googleAuth': [void,void];
  'life:calendars': [void,import('./lifeContext').Stage2View];
  'life:sync': [string,void];
  'life:locationKey': [void,{username:string;password:string;persistent:boolean}];
  'life:get': [void, import('./lifeContext').LifeView];
  'life:configure': [import('./lifeContext').LifeSourceConfig, import('./lifeContext').LifeView];
  'life:addProject': [void, import('./lifeContext').LifeView];
  'life:pair': [string, {token:string;port:number;persistent:boolean}];
  'life:forget': [{id:string;remove?:boolean}, void];
  'life:clear': [void, void];
  'life:associate': [import('./lifeContext').LifeEntityRecord, void];
  'life:candidate': [{id:string}, void];
  'life:correct': [{source:string;recordId:string;summary:string}, void];
  'dev:absence': ['idle' | 'sleep' | 'return' | 'clear', import('./developer').DevSnapshot];
  'bubble:reply': [void, void];
  'dev:get': [void, import('./developer').DevSnapshot];
  'dev:run': [import('./developer').DevCommand, import('./developer').DevState];
  'dev:stop': [void, import('./developer').DevState];
  'intro:done': [number, void];
  'theatre:ready': [undefined, void];
  'theatre:done': [number, void];
  'taskbar:command': ['open' | 'chat' | 'minimize' | 'intro' | 'settings' | 'quit' | 'normal' | 'explore' | 'sleep', void];
  'taskbar:mode': [void, 'normal' | 'explore' | 'sleep'];
  'settings:get': [void, Settings];
  'settings:set': [Partial<Settings> | Record<string, unknown>, { settings: Settings; repaired: string[] }];
  'settings:reset': [void, Settings];
  'settings:capabilities': [boolean, { settings: Settings; repaired: string[] }];
  'secrets:status': [void, Record<string, boolean>];
  'secrets:set': [{ key: string; value: string }, boolean];
  'secrets:delete': [string, boolean];
  'chat:send': [{ text: string; viaVoice?: boolean }, { messageId: string }];
  'chat:stop': [void, void];
  'chat:state': [void, { phase: AssistantPhase; busy: boolean }];
  'chat:history': [{ limit?: number }, ChatMessage[]];
  'chat:clear': [void, void];
  'memory:list': [void, MemoryItem[]];
  'memory:add': [string, MemoryItem];
  'memory:undo': [string, void];
  'memory:update': [{ id: string; text: string }, MemoryItem];
  'memory:approve': [string, void];
  'memory:delete': [string, void];
  'memory:clear': [void, void];
  'memory:patterns': [void, import('./interactionProfile').InteractionProfileSummary];
  'memory:clearPatterns': [void, void];
  'personal:get': [void, import('./personalContext').PersonalContextView];
  'honcho:status': [void, import('../main/ai/honchoMemory').HonchoStatus];
  'honcho:sync': [void, import('../main/ai/honchoMemory').HonchoStatus];
  'honcho:rebuild': [void, import('../main/ai/honchoMemory').HonchoStatus];
  'personal:manage': [{ id: string; action: 'complete' | 'dismiss' | 'forget' }, void];
  'personal:clear': [void, void];
  'relationship:get': [void, { state: import('./relationship').RelationshipState; retired: import('./relationship').RetiredLine[] }];
  'relationship:taste': [{ id?: string; topic: string; text: string }, import('./relationship').CapriTaste];
  'relationship:thread': [{ id?: string; title: string; summary: string; status: import('./relationship').ThreadStatus }, import('./relationship').ProjectThread];
  'relationship:status': [{ id: string; status: import('./relationship').ThreadStatus; snoozeDays?: number }, void];
  'relationship:remove': [{ kind: 'taste' | 'thread'; id: string }, void];
  'dialogue:feedback': [{messageId:string;kind:FeedbackKind}, void];
  'dialogue:retire': [string, import('./relationship').RetiredLine];
  'dialogue:restore': [string, void];
  'dialogue:scene': [void, import('./conversationScene').ConversationSceneState];
  'dialogue:clearScene': [void, void];
  'continuity:get': [void, import('./continuity').SharedExperience[]];
  'continuity:manage': [{ id: string; action: 'resolve' | 'dismiss' | 'forget' | 'correct'; text?: string }, void];
  'continuity:clear': [void, void];
  'notes:list': [void, Note[]];
  'notes:delete': [string, void];
  'reminders:list': [void, Reminder[]];
  'reminders:cancel': [string, void];
  'action:respond': [{ id: string; approved: boolean; remember?: boolean }, void];
  'provider:test': [void, { ok: boolean; detail: string; latencyMs?: number }];
  'provider:models': [void, string[]];
  'claude:status': [void, { installed: boolean; loggedIn: boolean; account?: string; detail: string }];
  'claude:signin': [void, { ok: boolean; detail?: string }];
  'claude:code': [string, { installed: boolean; loggedIn: boolean; account?: string; detail: string }];
  'claude:signout': [void, void];
  'diagnostics:get': [void, Diagnostics];
  'logs:tail': [number, string[]];
  'app:openDataFolder': [void, void];
  'app:resetAll': [void, void];
  'app:quit': [void, void];
  'app:restart': [void, void];
  'apps:pick': [void, { name: string; path: string } | null];
  'folders:pick': [void, string | null];
  'panel:open': [string | void, void];
  'panel:close': [void, void];
  'panel:ready': [void, void];
  'panel:viewed': [string, void];
  'voice:ptt': ['start' | 'stop' | 'cancel', void];
  // character renderer → main
  'char:hit': [boolean, void];
  'char:anchor': [{ x: number; y: number; hand?: { x:number; y:number }; body?: { x: number; y: number; width: number; height: number } }, void];
  'char:drag': ['start' | 'end', void];
  'char:click': [void, void];
  'char:menu': [void, void];
  'char:speechState': [{ utteranceId: string; state: 'start' | 'end' | 'error' | 'cancel' }, void];
  'char:audio': [{ wav: Uint8Array; durationMs: number }, void];
  'char:micError': [string, void];
  'char:performance': [{id:number;status:'completed'|'interrupted'},void];
  'char:poseRenderer': [import('./developer').PoseRendererState, void];
  'char:fps': [number, void];
  'char:ready': [void, void];
  'char:personality': [{ mood: Mood; event?: LifeEvent }, void];
  'char:interaction': ['pat' | 'poke', void];
  'bubble:open': [void, void];
  'bubble:close': [void, void];
  'bubble:get': [void, BubbleState];
  'bubble:escape': [void,void];
  'bubble:hover': [boolean,void];
  'bubble:draft': [boolean,void];
  'bubble:resize': [number, void];
  'tts:fetch': [string | { text: string; mood: Mood }, Uint8Array];
  'connection:get': [void, ConnectionStatus];
  'teleport:now': [string | void, { ok: boolean; detail: string }];
  'char:teleport': [{ id: number; phase: 'out' | 'in' }, void];
  'connection:check': [void, ConnectionStatus];
}
export type InvokeChannel = keyof InvokeMap;
export const INVOKE_CHANNELS: InvokeChannel[] = [
  'life:draft', 'life:stage3', 'life:stage3Setup', 'life:accountAuth', 'life:accountChoices', 'life:accountSync', 'life:botKey', 'life:academic', 'life:academicFile', 'life:exclude', 'life:forgetEntity', 'life:stage2', 'life:stage2Setup', 'life:stage2Key', 'life:googleAuth', 'life:calendars', 'life:sync', 'life:locationKey', 'life:get', 'life:configure', 'life:addProject', 'life:pair', 'life:forget', 'life:clear', 'life:associate', 'life:candidate', 'life:correct',
  'dev:absence',
  'bubble:reply',
  'dev:get', 'dev:run', 'dev:stop',
  'theatre:ready', 'theatre:done', 'intro:done', 'taskbar:command', 'taskbar:mode',
  'settings:get', 'settings:set', 'settings:reset', 'settings:capabilities', 'secrets:status', 'secrets:set', 'secrets:delete',
  'chat:send', 'chat:stop', 'chat:state', 'chat:history', 'chat:clear', 'memory:list', 'memory:add', 'memory:approve',
  'memory:undo', 'memory:update', 'memory:delete', 'memory:clear', 'memory:patterns', 'memory:clearPatterns', 'notes:list', 'notes:delete', 'reminders:list', 'reminders:cancel',
  'relationship:get', 'relationship:taste', 'relationship:thread', 'relationship:status', 'relationship:remove', 'dialogue:retire', 'dialogue:restore', 'dialogue:feedback',
  'dialogue:scene', 'dialogue:clearScene',
  'personal:get', 'personal:manage', 'personal:clear',
  'honcho:status', 'honcho:sync', 'honcho:rebuild',
  'continuity:get', 'continuity:manage', 'continuity:clear',
  'action:respond', 'provider:test', 'provider:models', 'claude:status', 'claude:signin', 'claude:code', 'claude:signout', 'diagnostics:get', 'logs:tail', 'app:openDataFolder',
  'app:resetAll', 'app:quit', 'app:restart', 'apps:pick', 'folders:pick', 'panel:open', 'panel:close', 'panel:ready', 'panel:viewed',
  'voice:ptt', 'char:hit', 'char:anchor', 'char:drag', 'char:click', 'char:menu', 'char:speechState', 'char:audio',
  'char:micError', 'char:performance', 'char:poseRenderer', 'char:fps', 'char:ready', 'tts:fetch', 'connection:get', 'connection:check', 'teleport:now', 'char:teleport',
  'char:personality', 'char:interaction', 'bubble:open', 'bubble:close', 'bubble:get', 'bubble:resize', 'bubble:escape', 'bubble:hover', 'bubble:draft',
];
export const EVENT_CHANNELS = [
  'theatre:play', 'theatre:update',
  'trail:play',
  'companion:mode',
  'intro:play',
  'chat:delta', 'chat:done', 'chat:message', 'chat:phase', 'action:confirm', 'action:result', 'memory:changed',
  'settings:changed', 'reminder:fired', 'transcript', 'panel:tab', 'cue', 'connection:status',
  'bubble:state',
  'bubble:focus',
] as const;

export const SECRET_KEYS = ['gemini', 'openai', 'anthropic', 'openaiVoice', 'lifeBridge', 'googleClient', 'googleClientSecret', 'googleRefresh', 'lastfmKey', 'owntracksBasic','lifeOAuth0','lifeOAuth1','lifeOAuth2','lifeOAuth3','lifeOAuth4','lifeOAuth5','discordBot'] as const;
export type SecretKey = (typeof SECRET_KEYS)[number];
