import { z } from 'zod';
import { DIALOGUE_ACTIVITY_LEVELS } from './dialogueCadence';

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const httpUrl = z
  .string()
  .max(500)
  .refine((u) => {
    try {
      const p = new URL(u);
      return p.protocol === 'http:' || p.protocol === 'https:';
    } catch {
      return false;
    }
  }, 'must be an http(s) URL');

export const TOOL_NAMES = [
  'open_url',
  'launch_app',
  'search_files',
  'create_note',
  'list_notes',
  'set_reminder',
  'start_timer',
  'cancel_timer',
  'get_time',
  'remember',
  'teleport',
  'emote',
  'read_screen',
  'study_timer',
  'mischief',
  'use_computer',
] as const;
export type ToolName = (typeof TOOL_NAMES)[number];
export const Policy = z.enum(['allow', 'confirm', 'deny']);
export type Policy = z.infer<typeof Policy>;

export const SettingsSchema = z.object({
  capabilityBoost: z.object({ enabled: z.boolean(), previous: z.record(z.string(), z.union([z.boolean(), z.string()])) }).default({ enabled: false, previous: {} }),
  version: z.literal(1),
  firstRunComplete: z.boolean(),
  dialogue: z.object({ activityLevel: z.enum(DIALOGUE_ACTIVITY_LEVELS), localContext: z.boolean(), weatherCity: z.string().max(100), spotifyBanter: z.boolean(), contextPings: z.boolean() }),
  character: z.object({
    animation: z.enum(['auto', 'idle', 'perch', 'grin', 'sleep', 'glitch', 'dangle']),
    facing: z.enum(['cursor', 'original', 'left', 'right']),
    speechBubbles: z.boolean(),
    startupIntro: z.boolean(),
    personality: z.boolean(),
    scale: z.number().min(0.4).max(2.5),
    opacity: z.number().min(0.2).max(1),
    animationIntensity: z.number().min(0).max(1.5),
    fpsCap: z.number().int().min(15).max(144),
    glitchEffects: z.boolean(),
    secondaryPoses: z.boolean(),
    deepSleep: z.boolean(),
    theatricalMotion: z.boolean(),
    reactionCutins: z.boolean(),
    alwaysOnTop: z.boolean(),
    clickThrough: z.boolean(),
    hideOnFullscreen: z.boolean(),
    position: z
      .object({ x: z.number().int(), y: z.number().int(), displayId: z.number() })
      .nullable(),
  }),
  behavior: z.object({
    smallActivities: z.boolean(),
    cursorVisits: z.boolean(),
    newWindowVisits: z.boolean(),
    satelliteMoments: z.boolean(),
    windowPossession: z.boolean(),
    cursorLightning: z.boolean(),
    mode: z.enum(['normal', 'explore', 'sleep']),
    idleRemarks: z.boolean(),
    remarkIntervalMinutes: z.number().min(5).max(480), // legacy profile compatibility; initiative now follows desktop events
    proactiveVoice: z.boolean(), // idle remarks are silent bubbles unless this is on as well
    quietHours: z.object({ enabled: z.boolean(), start: hhmm, end: hhmm }),
    doNotDisturb: z.boolean(),
    sleepAfterMinutes: z.number().min(1).max(240),
    sitOnTextBoxes: z.boolean(), // while you type, she sits on the line you're typing on
    idlePeek: z.boolean(), // when you're away she peeks in from a screen edge
    mischief: z.boolean(), // harmless pranks now and then (screen glitch, borrowing the cursor, notes)
    mischiefIntervalMinutes: z.number().min(5).max(240),
    explore: z.boolean(), // while you're away she browses on her own (read only) and tells you what she found
    exploreAfterMinutes: z.number().min(2).max(120),
  }),
  ai: z.object({
    provider: z.enum(['codex', 'gemini', 'claude', 'offline', 'ollama', 'openai', 'anthropic']),
    codex: z.object({ chatModel: z.string().min(1).max(200), taskModel: z.string().max(200) }),
    gemini: z.object({ model: z.string().min(3).max(100), fallbackModel: z.string().max(100), thinkingLevel: z.enum(['minimal', 'low', 'medium', 'high']) }),
    ollama: z.object({ baseUrl: httpUrl, model: z.string().max(200) }),
    openai: z.object({ baseUrl: httpUrl, model: z.string().max(200) }),
    anthropic: z.object({ baseUrl: httpUrl, model: z.string().max(200) }),
    claude: z.object({ model: z.enum(['sonnet', 'opus', 'haiku']) }), // through the user's Claude account (Claude Code sign-in)
    temperature: z.number().min(0).max(2),
    maxTokens: z.number().int().min(32).max(8192),
    responseLength: z.enum(['short', 'medium', 'long']),
    historyTurns: z.number().int().min(0).max(100),
    requestTimeoutSec: z.number().int().min(5).max(600),
  }),
  voice: z.object({
    ttsEnabled: z.boolean(),
    ttsEngine: z.enum(['system', 'openai']),
    systemVoice: z.string().max(200),
    rate: z.number().min(0.5).max(2),
    pitch: z.number().min(0).max(2),
    volume: z.number().min(0).max(1),
    openaiTts: z.object({ baseUrl: httpUrl, model: z.string().max(100), voice: z.string().max(100), instructions: z.string().max(4000) }),
    sttEngine: z.enum(['windows', 'openai']),
    openaiStt: z.object({ baseUrl: httpUrl, model: z.string().max(100) }),
    micPermission: z.boolean(),
    wakeWord: z.boolean(),
    interactionLines: z.boolean(), // a short spoken line when you poke, pat or call her
  }),
  memory: z.object({ enabled: z.boolean(), autoLearn: z.boolean(), interactionProfile: z.boolean(), historyRetentionDays: z.number().int().min(0).max(3650), honcho: z.object({ enabled: z.boolean(), baseUrl: httpUrl.refine(value => { try { const u = new URL(value); return u.protocol === 'http:' && ['127.0.0.1','localhost','[::1]'].includes(u.hostname) && !u.username && !u.password && u.pathname === '/' && !u.search && !u.hash; } catch { return false; } }, 'must be a local Honcho URL'), launcher: z.string().max(1000) }) }),
  privacy: z.object({ saveHistory: z.boolean(), logLevel: z.enum(['debug', 'info', 'warn', 'error']) }),
  actions: z.object({
    policies: z.record(z.enum(TOOL_NAMES), Policy),
    approvedApps: z
      .array(z.object({ name: z.string().min(1).max(80), path: z.string().min(3).max(500) }))
      .max(100),
    searchRoots: z.array(z.string().min(3).max(500)).max(20),
  }),
  startup: z.object({ launchOnLogin: z.boolean() }),
  teleport: z.object({
    auto: z.boolean(), // only while the AI connection is live
    minMinutes: z.number().min(1).max(240),
    maxMinutes: z.number().min(1).max(480),
    effects: z.boolean(),
    avoidActiveWindow: z.boolean(),
  }),
  notifications: z.object({ reminders: z.boolean(), sound: z.boolean() }),
});

export type Settings = z.infer<typeof SettingsSchema>;

export const DEFAULT_POLICIES: Record<ToolName, Policy> = {
  open_url: 'confirm',
  launch_app: 'confirm',
  search_files: 'allow',
  create_note: 'allow',
  list_notes: 'allow',
  set_reminder: 'allow',
  start_timer: 'allow',
  cancel_timer: 'allow',
  get_time: 'allow',
  remember: 'confirm',
  teleport: 'allow',
  emote: 'allow',
  read_screen: 'confirm', // reads the text in your active window: ask every time
  study_timer: 'allow',
  mischief: 'allow',
  use_computer: 'confirm', // she takes over the mouse and keyboard for a task: ask every time
};

export const CAPRI_VOICE_DELIVERY = 'Speak in a playful, mischievous, confident feminine voice with a light raspy edge. Keep the delivery intimate and conversational, with dry teasing, a smile in the voice, and brief expressive bursts of excitement. Use crisp consonants, natural pauses, and varied intonation at an easy conversational pace. Let sincere moments sound softer and warmer. Avoid a polished announcer delivery, exaggerated squeakiness, or constant shouting. Read only the supplied dialogue; do not add words, stage directions, or sound effects.';

export const DEFAULT_SETTINGS: Settings = {
  capabilityBoost: { enabled: false, previous: {} },
  version: 1,
  firstRunComplete: false,
  dialogue: { activityLevel: 'lively', localContext: true, weatherCity: '', spotifyBanter: true, contextPings: true },
  character: {
    animation: 'auto',
    facing: 'cursor',
    speechBubbles: true,
    startupIntro: true,
    personality: true,
    scale: 1,
    opacity: 1,
    animationIntensity: 1,
    fpsCap: 60,
    glitchEffects: true,
    secondaryPoses: true,
    deepSleep: false,
    theatricalMotion: true,
    reactionCutins: true,
    alwaysOnTop: true,
    clickThrough: false,
    hideOnFullscreen: true,
    position: null,
  },
  behavior: {
    smallActivities: true,
    cursorVisits: true,
    newWindowVisits: true,
    satelliteMoments: false,
    windowPossession: false,
    cursorLightning: true,
    mode: 'normal',
    idleRemarks: false,
    remarkIntervalMinutes: 10,
    proactiveVoice: false,
    quietHours: { enabled: true, start: '22:00', end: '08:00' },
    doNotDisturb: false,
    sleepAfterMinutes: 10,
    sitOnTextBoxes: true,
    idlePeek: true,
    mischief: false,
    mischiefIntervalMinutes: 30,
    explore: false,
    exploreAfterMinutes: 5,
  },
  ai: {
    provider: 'gemini',
    gemini: { model: 'gemini-3.5-flash-lite', fallbackModel: 'gemini-3.1-flash-lite', thinkingLevel: 'minimal' },
    ollama: { baseUrl: 'http://127.0.0.1:11434', model: 'llama3.2' },
    openai: { baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
    anthropic: { baseUrl: 'https://api.anthropic.com', model: 'claude-haiku-5-5' },
    claude: { model: 'sonnet' },
    codex: { chatModel: 'gpt-6-luna', taskModel: '' },
    temperature: 0.8,
    maxTokens: 500,
    responseLength: 'short',
    historyTurns: 20,
    requestTimeoutSec: 60,
  },
  voice: {
    ttsEnabled: true,
    ttsEngine: 'system',
    systemVoice: '',
    rate: 1.05,
    pitch: 1.2,
    volume: 0.9,
    openaiTts: { baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini-tts', voice: 'nova', instructions: CAPRI_VOICE_DELIVERY },
    sttEngine: 'windows',
    openaiStt: { baseUrl: 'https://api.openai.com/v1', model: 'whisper-1' },
    micPermission: false,
    wakeWord: false,
    interactionLines: true,
  },
  memory: { enabled: true, autoLearn: false, interactionProfile: true, historyRetentionDays: 90, honcho: { enabled: false, baseUrl: 'http://127.0.0.1:8008', launcher: '' } },
  privacy: { saveHistory: true, logLevel: 'info' },
  actions: { policies: { ...DEFAULT_POLICIES }, approvedApps: [], searchRoots: [] },
  startup: { launchOnLogin: false },
  teleport: { auto: true, minMinutes: 4, maxMinutes: 15, effects: true, avoidActiveWindow: true },
  notifications: { reminders: true, sound: true },
};

type AnyObj = Record<string, unknown>;
const isObj = (v: unknown): v is AnyObj => typeof v === 'object' && v !== null && !Array.isArray(v);

export function deepMerge<T>(base: T, patch: unknown): T {
  if (!isObj(base) || !isObj(patch)) return (patch === undefined ? base : patch) as T;
  const out: AnyObj = { ...base };
  for (const [k, v] of Object.entries(patch)) {
    if (k === '__proto__' || k === 'constructor' || k === 'prototype') continue;
    const b = (base as AnyObj)[k];
    out[k] = isObj(b) && isObj(v) ? deepMerge(b, v) : v;
  }
  return out as T;
}

function getPath(o: unknown, path: PropertyKey[]): unknown {
  return path.reduce<unknown>((acc, k) => (isObj(acc) ? acc[k as string] : undefined), o);
}
function setPath(o: AnyObj, path: PropertyKey[], value: unknown) {
  let cur: AnyObj = o;
  for (let i = 0; i < path.length - 1; i++) {
    const next = cur[path[i] as string];
    if (!isObj(next)) return;
    cur = next;
  }
  cur[path[path.length - 1] as string] = structuredClone(value);
}

/**
 * Merge arbitrary (possibly corrupt or outdated) input onto defaults and repair any
 * field that fails validation by resetting it to its default. Never throws.
 */
export function normalizeSettings(raw: unknown): { settings: Settings; repaired: string[] } {
  const merged = deepMerge(structuredClone(DEFAULT_SETTINGS), isObj(raw) ? raw : {}) as AnyObj;
  merged.version = 1;
  // ensure every tool has a policy (new tools added in upgrades)
  const acts = merged.actions as AnyObj | undefined;
  if (isObj(acts)) acts.policies = { ...DEFAULT_POLICIES, ...(isObj(acts.policies) ? acts.policies : {}) };
  const repaired: string[] = [];
  for (let attempt = 0; attempt < 50; attempt++) {
    const res = SettingsSchema.safeParse(merged);
    if (res.success) return { settings: res.data, repaired };
    for (const issue of res.error.issues) {
      const path = [...issue.path];
      // walk up until we find a path that exists in defaults
      while (path.length && getPath(DEFAULT_SETTINGS, path) === undefined) path.pop();
      if (!path.length) return { settings: structuredClone(DEFAULT_SETTINGS), repaired: ['*'] };
      repaired.push(path.join('.'));
      setPath(merged, path, getPath(DEFAULT_SETTINGS, path));
    }
  }
  return { settings: structuredClone(DEFAULT_SETTINGS), repaired: ['*'] };
}
