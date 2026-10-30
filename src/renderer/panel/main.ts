import { searchBox, type SearchItem } from './search';
import { SETTINGS_SEARCH } from './settingsSearch';
import {authoredLineId} from '../../shared/dialogue';
import type { ActionRequest, ActionResult, AssistantPhase, ChatMessage, ConnectionStatus, Diagnostics, MemoryItem, Note, Reminder } from '../../shared/ipc';
import { TOOL_NAMES, type Settings, type ToolName } from '../../shared/settings';
import type { CapriApi } from '../../preload/preload';
import { icon } from './icons';
import { DEV_ANIMATIONS, DEV_ACTIVITIES, DEV_INTERACTIONS, DEV_DIALOGUE, DEV_SCENARIOS, DEV_REACTIONS, DEV_PHASES, type DevCommand, type DevSnapshot } from '../../shared/developer';
import { SCENES, FLOURISHES } from '../../shared/theatrics';
import { SECONDARY_POSES } from '../character/secondarySprites';
import { PING_LINES, type PingKind } from '../../shared/contextPings';
import { MOODS, LIFE_EVENTS } from '../../shared/personality';

declare global { interface Window { capri: CapriApi } }
const api = window.capri;

// ---------------------------------------------------------------- tiny DOM helper (no innerHTML → no injection)
type Child = Node | string | null | undefined | false;
function h<K extends keyof HTMLElementTagNameMap>(tag: K, props: Record<string, unknown> = {}, ...kids: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v as EventListener);
    else if (k === 'class') el.className = String(v);
    else if (k in el && k !== 'list') (el as unknown as Record<string, unknown>)[k] = v;
    else el.setAttribute(k, String(v));
  }
  for (const c of kids) if (c !== null && c !== undefined && c !== false) el.append(c);
  return el;
}

// ---------------------------------------------------------------- state
let S: Settings;
let booted = false;
let secretStatus: Record<string, boolean> = {};
let phase: AssistantPhase = 'idle';
let phaseDetail = '';
let conn: ConnectionStatus | null = null;
const developerOnly = location.hash.slice(1) === 'developer';
document.body.classList.toggle('developer-window', developerOnly);
document.title = developerOnly ? 'Capri - Developer' : 'Capri - Companion';
let tab = location.hash.slice(1) || 'chat';
let searchTarget: SearchItem | undefined;
let revealDeveloperSearch: ((item: SearchItem) => void) | undefined;
const TABS: { id: string; label: string; icon: string }[] = [
  { id: 'chat', label: 'Chat', icon: 'chat' },
  { id: 'settings', label: 'Settings', icon: 'shield' },
  { id: 'model', label: 'Brain & replies', icon: 'model' },
  { id: 'attention', label: 'Attention & quiet', icon: 'pulse' },
  { id: 'voice', label: 'Voice & listening', icon: 'voice' },
  { id: 'character', label: 'Desktop character', icon: 'eye' },
  { id: 'memory', label: 'Memory', icon: 'memory' },
  { id: 'connections', label: 'Connections', icon: 'shield' },
  { id: 'privacy', label: 'Access & privacy', icon: 'shield' },
  { id: 'system', label: 'App & shortcuts', icon: 'pulse' },
  { id: 'developer', label: 'Developer', icon: 'model' },
];
// older entry points (tray menu, shortcuts, tests) still land somewhere sensible
const ALIASES: Record<string, string> = { look: 'character', move: 'character', behavior: 'character', permissions: 'privacy', diagnostics: 'system' };
const view = document.getElementById('view')!;

function setByPath(path: string, value: unknown): Record<string, unknown> {
  const keys = path.split('.');
  const patch: Record<string, unknown> = {};
  let cur = patch;
  keys.forEach((k, i) => { if (i === keys.length - 1) cur[k] = value; else { cur[k] = {}; cur = cur[k] as Record<string, unknown>; } });
  return patch;
}
const getByPath = (path: string): unknown => path.split('.').reduce<unknown>((o, k) => (o as Record<string, unknown>)?.[k], S);
async function save(path: string, value: unknown) {
  const r = await api.invoke('settings:set', setByPath(path, value));
  S = r.settings;
  if (r.repaired.length) toast(`Invalid value for ${r.repaired.join(', ')}; reset to default.`, true);
}
const timers: Record<string, number> = {};
const pendingSettings = new Map<string, unknown>();
async function flushSettings() { const items=[...pendingSettings];pendingSettings.clear();await Promise.all(items.map(([path,value])=>{clearTimeout(timers[path]);return save(path,value);})); }
window.addEventListener('blur',()=>{void flushSettings();});
window.addEventListener('beforeunload',()=>{void flushSettings();});
document.getElementById('closeBtn')?.addEventListener('click',e=>{e.preventDefault();e.stopImmediatePropagation();void flushSettings().then(()=>window.close());},true);
function saveDebounced(path: string, value: unknown, ms = 400) {
  pendingSettings.set(path,value);
  clearTimeout(timers[path]);
  timers[path] = window.setTimeout(() => {pendingSettings.delete(path);void save(path, value);}, ms);
}

// ---------------------------------------------------------------- components
const field = (label: string, control: Node, hint?: string, wide = false) =>
  h('div', { class: `field${wide ? ' wide' : ''}` }, h('label', {}, label), h('div', { class: 'control' }, control), hint ? h('div', { class: 'hint' }, hint) : null);
const toggle = (path: string, label: string, onChange?: (v: boolean) => void) =>
  h('input', { type: 'checkbox', class: 'switch', checked: !!getByPath(path), role: 'switch', 'aria-label': label, onchange: (e: Event) => { const v = (e.target as HTMLInputElement).checked; void save(path, v).then(() => onChange?.(v)); } });
const sw = (label: string, path: string, onChange?: (v: boolean) => void) => field(label, toggle(path, label, onChange));
function range(path: string, label: string, min: number, max: number, step: number, fmt = (v: number) => v.toFixed(2)) {
  const val = h('span', { class: 'val' }, fmt(Number(getByPath(path))));
  const input = h('input', { type: 'range', min, max, step, value: Number(getByPath(path)), 'aria-label': label,
    oninput: (e: Event) => { const v = Number((e.target as HTMLInputElement).value); val.textContent = fmt(v); saveDebounced(path, v, 120); } });
  return h('span', { class: 'row' }, input, val);
}
const select = (path: string, label: string, options: [string, string][], onChange?: (v: string) => void, coerce: (v: string) => unknown = (v) => v) => {
  const cur = String(getByPath(path));
  return h('select', { 'aria-label': label, onchange: (e: Event) => { const v = (e.target as HTMLSelectElement).value; void save(path, coerce(v)).then(() => onChange?.(v)); } },
    ...options.map(([v, l]) => h('option', { value: v, selected: v === cur }, l)));
};
const text = (path: string, label: string, placeholder = '', listId?: string) => {
  const el = h('input', { type: 'text', value: String(getByPath(path) ?? ''), placeholder, spellcheck: false, 'aria-label': label, oninput: (e: Event) => saveDebounced(path, (e.target as HTMLInputElement).value.trim(), 600) });
  if (listId) el.setAttribute('list', listId);
  return el;
};
const timeIn = (path: string, label: string) => h('input', { type: 'time', value: String(getByPath(path)), 'aria-label': label, onchange: (e: Event) => void save(path, (e.target as HTMLInputElement).value) });
const num = (path: string, label: string, min: number, max: number) => h('input', { type: 'number', min, max, value: Number(getByPath(path)), 'aria-label': label, onchange: (e: Event) => void save(path, Number((e.target as HTMLInputElement).value)) });
const group = (title: string, ...kids: Child[]) => h('section', { class: 'group' }, h('span', { class: 'label' }, title), ...kids);
const btn = (label: string, onclick: () => unknown, cls = '', ic?: string, title?: string) =>
  h('button', { class: `btn ${cls}`, onclick, title, type: 'button' }, ic ? icon(ic) : null, label);
const viewHead = (title: string) => h('div', { class: 'view-head' }, h('h1', {}, title));
const emptyLine = (t: string) => h('div', { class: 'empty-line' }, t);
const pct = (v: number) => `${Math.round(v * 100)}%`;

function toast(msg: string, err = false) {
  const t = h('div', { class: `toast${err ? ' err' : ''}`, role: 'status' }, msg);
  document.getElementById('toasts')!.append(t);
  setTimeout(() => t.remove(), 3800);
}

// ---------------------------------------------------------------- status (one indicator: connection, plus what she's doing when busy)
const phaseChip = document.getElementById('phaseChip')!;
const phaseText = document.getElementById('phaseText')!;
const connChip = document.getElementById('connChip')!;
const connText = document.getElementById('connText')!;
const PHASE_LABEL: Record<AssistantPhase, string> = { idle: 'ready', listening: 'listening', transcribing: 'transcribing', thinking: 'thinking', speaking: 'speaking', error: 'error', offline: 'offline' };
let statusEl: HTMLElement | null = null;
let stopBtn: HTMLButtonElement | null = null;
function renderPhase() {
  phaseChip.dataset.phase = phase;
  phaseText.textContent = PHASE_LABEL[phase];
  if (statusEl) {
    statusEl.textContent = phase === 'idle' ? phaseDetail : phaseDetail || `${PHASE_LABEL[phase]}…`;
    statusEl.className = `status${phase === 'error' ? ' err' : ''}`;
  }
  if (stopBtn) stopBtn.hidden = !(phase === 'thinking' || phase === 'speaking');
}
const CONN_LABEL: Record<ConnectionStatus['state'], string> = { connecting: 'Connecting', connected: 'Online', disconnected: 'Offline', error: 'Error' };
function renderConn() {
  if (!conn) return;
  connChip.dataset.state = conn.state;
  connText.textContent = conn.provider === 'offline' ? 'No AI' : /rate.limit/i.test(conn.detail) ? 'Rate limited' : CONN_LABEL[conn.state];
  connChip.title = `${conn.provider}${conn.model ? ` · ${conn.model}` : ''}: ${conn.detail}`;
}

// ---------------------------------------------------------------- navigation
function renderRail() {
  const rail = document.getElementById('rail')!;
  if (developerOnly) { rail.hidden = true; return; }
  rail.replaceChildren(h('div', { class: 'rail-label' }, 'COMPANION'), ...TABS.filter(t => t.id !== 'developer').map(t =>
    h('button', { role: 'tab', 'aria-selected': String(t.id === tab), 'aria-label': t.label, onclick: () => go(t.id) }, icon(t.icon), h('span', {}, t.label))),
    h('div', { class: 'grow' }), h('div', { class: 'rail-label' }, 'WORKSHOP'),
    btn('Developer tools ↗', () => api.invoke('panel:open', 'developer'), 'quiet'),
    h('p', { class: 'rail-note' }, 'Live diagnostics in a separate window.'));
}
function highlightResult(item: SearchItem) {
  const candidates = [...view.querySelectorAll<HTMLElement>('.field, .group > .label, .dev-card h2, .settings-tile, h1')];
  const target = candidates.find(el => (el.querySelector('label')?.textContent ?? el.textContent)?.trim() === item.label)
    ?? candidates.find(el => el.textContent?.toLowerCase().includes(item.label.toLowerCase()));
  if (!target) return;
  for (let parent = target.parentElement; parent; parent = parent.parentElement) if (parent instanceof HTMLDetailsElement) parent.open = true;
  target.scrollIntoView({ block: 'center', behavior: 'smooth' }); target.classList.add('search-hit');
  const control = target.querySelector<HTMLElement>('input, select, button, textarea');
  (control ?? target).focus({ preventScroll: true }); setTimeout(() => target.classList.remove('search-hit'), 2200);
}
let navigationRevision = 0;
let developerPoll: number | undefined;
function go(t: string) {
  void flushSettings();
  if (tab === 'developer' && t !== 'developer') void api.invoke('dev:stop').catch(() => {});
  if (developerPoll !== undefined) { clearInterval(developerPoll); developerPoll = undefined; }
  navigationRevision++;
  t = ALIASES[t] ?? t;
  if (t === 'developer' && !developerOnly) { void api.invoke('panel:open', 'developer'); return; }
  if (developerOnly) t = 'developer';
  if (t !== 'welcome' && !TABS.some((x) => x.id === t)) t = 'chat';
  tab = t;
  void api.invoke('panel:viewed', t).catch(() => {});
  renderRail();
  statusEl = null; stopBtn = null;
  view.replaceChildren();
  view.className = 'enter';
  const revision = navigationRevision;
  void Promise.resolve().then(async () => { await (RENDER[t] ?? renderChat)(); if (revision !== navigationRevision) return; if (searchTarget) { const item = searchTarget; searchTarget = undefined; if (developerOnly) revealDeveloperSearch?.(item); else highlightResult(item); } }).catch((error: unknown) => {
    if (revision !== navigationRevision) return;
    view.replaceChildren(viewHead(t === 'memory' ? 'Memory' : t), h('div', { class: 'scroll' },
      h('p', {}, 'Could not load this panel. Your saved data has not been deleted.'),
      h('p', { class: 'hint' }, error instanceof Error ? error.message : String(error)),
      btn('Retry', () => go(t), 'primary')));
  });
  setTimeout(() => (view.className = ''), 200);
}

// ---------------------------------------------------------------- chat
let messagesEl: HTMLElement;
let scroller: HTMLElement;
const streamBubbles = new Map<string, { el: HTMLElement; text: string }>();

function richText(content: string): Node[] {
  const out: Node[] = [];
  content.split(/```(?:[\w-]*)\n?([\s\S]*?)```/g).forEach((part, i) => {
    if (i % 2 === 1) { out.push(h('pre', {}, h('code', {}, part))); return; }
    part.split(/`([^`\n]+)`/g).forEach((seg, j) => out.push(j % 2 ? h('code', {}, seg) : document.createTextNode(seg)));
  });
  return out;
}
function msgEl(m: ChatMessage): HTMLElement {
  if (m.role === 'action') {
    const st = m.meta?.actionStatus ?? '';
    const cls = st === 'done' ? 'ok' : ['failed', 'blocked', 'rejected', 'declined'].includes(st) ? 'bad' : '';
    return h('div', { class: 'msg action' }, h('span', { class: `tag ${cls}` }, st || 'action'), h('span', {}, m.content));
  }
  const el = h('div', { class: `msg ${m.role}${m.meta?.error ? ' err' : ''}`, 'data-id': m.id },
    m.role === 'assistant' ? h('span', { class: 'who' }, 'Capri') : null, ...richText(m.content));
  if (m.meta?.interrupted) el.append(h('span', { class: 'meta' }, '— interrupted'));
  if (m.meta?.error && m.content !== m.meta.error) el.append(h('span', { class: 'meta' }, m.meta.error));
  if(m.role==='assistant'&&m.meta?.speech?.kind==='authored')el.append(btn('Retire line',async()=>{try{await api.invoke('dialogue:retire',m.meta!.speech!.kind==='authored'?m.meta!.speech!.lineId:'');toast('Authored line retired.');}catch(e){toast((e as Error).message,true);}},'quiet'));
  if(m.role==='assistant'&&m.meta?.speech?.kind.startsWith('generated')&&!m.meta?.private) {
    const feedback=h('div',{class:'row'});
    for(const [kind,label] of [['repetitive','Repetitive'],['generic','Too generic'],['character','Out of character'],['intrusive','Poor timing']] as const)feedback.append(btn(label,async()=>{try{await api.invoke('dialogue:feedback',{messageId:m.id,kind});feedback.remove();toast('Feedback saved locally.');}catch(e){toast((e as Error).message,true);}},'quiet'));
    el.append(h('details', { class: 'message-feedback' }, h('summary', {}, 'Give feedback'), feedback));
  }
  return el;
}
const atBottom = () => scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 60;
const scrollDown = (force = false) => { if (scroller && (force || atBottom())) scroller.scrollTop = scroller.scrollHeight; };

const pendingConfirm = new Map<string, ActionRequest>();
function confirmCard(req: ActionRequest): HTMLElement {
  const c = h('div', { class: 'confirm', 'data-confirm': req.id });
  const respond = async (approved: boolean) => {
    pendingConfirm.delete(req.id);
    c.remove(); // the main process logs the outcome as an action message
    await api.invoke('action:respond', { id: req.id, approved });
  };
  c.append(h('div', {}, req.summary));
  if (req.tainted) c.append(h('div', { class: 'why' }, 'Asked right after reading file names or notes. Check this is what you wanted.'));
  c.append(h('div', { class: 'row' }, btn('Allow', () => respond(true), 'primary', 'check'), btn('Deny', () => respond(false), '', 'close')));
  return c;
}
let chatReady = false;
function showConfirm(req: ActionRequest) {
  if (!chatReady || !messagesEl || messagesEl.querySelector(`[data-confirm="${CSS.escape(req.id)}"]`)) return;
  messagesEl.append(confirmCard(req));
  scrollDown(true);
}

let mic = false;
async function renderChat() {
  const revision = navigationRevision;
  chatReady = false;
  scroller = h('div', { class: 'scroll' });
  messagesEl = h('div', { class: 'messages', role: 'log', 'aria-live': 'polite' });
  scroller.append(messagesEl);
  const ta = h('textarea', { placeholder: 'Message Capri', rows: 1, 'aria-label': 'Message' });
  const send = async (value?: string) => {
    const v = (value ?? ta.value).trim();
    if (!v) return;
    ta.value = ''; autosize();
    try { await api.invoke('chat:send', { text: v }); } catch (e) { if (!ta.value) { ta.value = v; autosize(); } toast((e as Error).message, true); }
  };
  const autosize = () => { ta.style.height = 'auto'; ta.style.height = `${Math.min(140, Math.max(34, ta.scrollHeight + 2))}px`; };
  ta.addEventListener('input', autosize);
  ta.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); void send(); } });
  const micBtn = h('button', { class: 'btn icon-only', type: 'button', title: S.voice.micPermission ? 'Hold to talk (Ctrl+Alt+T)' : 'Microphone is off (Voice settings)', 'aria-label': 'Push to talk' }, icon('mic'));
  micBtn.disabled = !S.voice.micPermission;
  const micStart = () => { if (mic) return; mic = true; micBtn.classList.add('rec'); void api.invoke('voice:ptt', 'start'); };
  const micStop = () => { if (!mic) return; mic = false; micBtn.classList.remove('rec'); void api.invoke('voice:ptt', 'stop'); };
  micBtn.addEventListener('pointerdown', micStart);
  micBtn.addEventListener('pointerup', micStop);
  micBtn.addEventListener('pointerleave', micStop);
  micBtn.addEventListener('keydown', (e) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); mic ? micStop() : micStart(); } });
  stopBtn = h('button', { class: 'btn icon-only', type: 'button', title: 'Stop (Esc)', 'aria-label': 'Stop', onclick: () => api.invoke('chat:stop') }, icon('stop'));
  const muteBtn = h('button', { class: 'btn', type: 'button', 'aria-label': S.voice.ttsEnabled ? 'Mute Capri' : 'Unmute Capri', onclick: async () => { await save('voice.ttsEnabled', !S.voice.ttsEnabled); refreshMute(); } });
  const refreshMute = () => { muteBtn.textContent = S.voice.ttsEnabled ? 'Mute' : 'Unmute'; muteBtn.setAttribute('aria-label', S.voice.ttsEnabled ? 'Mute Capri' : 'Unmute Capri'); muteBtn.setAttribute('aria-pressed', String(!S.voice.ttsEnabled)); };
  refreshMute();
  const sendBtn = h('button', { class: 'btn primary icon-only', type: 'button', title: 'Send (Enter)', 'aria-label': 'Send', onclick: () => send() }, icon('send'));
  statusEl = h('div', { class: 'status' });
  view.append(h('div', { class: 'chat' }, scroller, statusEl, h('div', { class: 'composer' }, ta, micBtn, muteBtn, stopBtn, sendBtn)));

  const hist = await api.invoke('chat:history', { limit: 200 });
  if (revision !== navigationRevision || tab !== 'chat') return;
  if (!hist.length) {
    messagesEl.append(h('div', { class: 'empty' }, h('div', {}, 'Say something.'),
      h('div', { class: 'try' }, ...['Who are you?', 'Teleport', 'Timer 5 minutes'].map((q) => h('button', { type: 'button', onclick: () => send(q) }, q)))));
  }
  const shownIds = new Set(hist.map((m) => m.id));
  const early = [...messagesEl.children].filter((el) => !shownIds.has((el as HTMLElement).dataset.id ?? ''));
  messagesEl.replaceChildren(...hist.map(msgEl), ...early);
  for (const [id, b] of streamBubbles) if (!shownIds.has(id)) messagesEl.append(b.el);
  chatReady = true;
  for (const req of pendingConfirm.values()) showConfirm(req);
  renderPhase();
  scrollDown(true);
  ta.focus();
}

api.on('chat:message', (p) => {
  const { message } = p as { message: ChatMessage };
  if (tab !== 'chat' || !messagesEl) return;
  messagesEl.querySelector('.empty')?.remove();
  messagesEl.append(msgEl(message));
  scrollDown(message.role === 'user');
});
api.on('chat:delta', (p) => {
  const { messageId, delta } = p as { messageId: string; delta: string };
  if (tab !== 'chat' || !messagesEl) return;
  let b = streamBubbles.get(messageId);
  if (!b) {
    const el = h('div', { class: 'msg assistant cursor', 'data-id': messageId });
    messagesEl.append(el);
    b = { el, text: '' };
    streamBubbles.set(messageId, b);
  }
  b.text += delta;
  b.el.replaceChildren(h('span', { class: 'who' }, 'Capri'), b.text);
  scrollDown();
});
api.on('chat:done', (p) => {
  const { message } = p as { message: ChatMessage };
  const b = streamBubbles.get(message.id);
  streamBubbles.delete(message.id);
  if (tab !== 'chat' || !messagesEl) return;
  const fresh = msgEl(message);
  if (b) { if (message.content||message.meta?.interrupted) b.el.replaceWith(fresh); else b.el.remove(); }
  else if (message.content) messagesEl.append(fresh);
  scrollDown();
});
api.on('chat:phase', (p) => { const x = p as { phase: AssistantPhase; detail?: string }; phase = x.phase; phaseDetail = x.detail ?? ''; renderPhase(); });
api.on('connection:status', (c) => { conn = c as ConnectionStatus; renderConn(); if (tab === 'model') refreshConn(); });
api.on('action:confirm', (p) => {
  const req = p as ActionRequest;
  pendingConfirm.set(req.id, req);
  if (tab !== 'chat') go('chat'); else showConfirm(req);
  window.focus();
});
api.on('action:result', (p) => { const r = p as ActionResult; if (!r.ok) toast(r.summary, true); });
api.on('transcript', (p) => { const t = p as { text: string }; if (t.text) toast(`Heard: “${t.text}”`); });
api.on('reminder:fired', (p) => { const r = p as Reminder; toast(r.text); });
api.on('settings:changed', (s) => { S = s as Settings; if (tab === 'chat') { renderPhase(); const b = view.querySelector<HTMLButtonElement>('[aria-label="Mute Capri"], [aria-label="Unmute Capri"]'); if (b) { b.textContent = S.voice.ttsEnabled ? 'Mute' : 'Unmute'; b.setAttribute('aria-label', S.voice.ttsEnabled ? 'Mute Capri' : 'Unmute Capri'); b.setAttribute('aria-pressed', String(!S.voice.ttsEnabled)); } } });
api.on('panel:tab', (t) => { const target = ALIASES[String(t)] ?? String(t); if (!booted) tab = target; else if (target !== tab) go(target); else if(target==='chat')view.querySelector<HTMLTextAreaElement>('.composer textarea')?.focus(); });
api.on('memory:changed', () => { if (tab === 'memory') go('memory'); });

// ---------------------------------------------------------------- model
let connBody: HTMLElement | null = null;
function refreshConn() {
  if (!connBody || !conn) return;
  const tone = conn.state === 'connected' ? 'ok' : conn.state === 'error' ? 'bad' : conn.state === 'connecting' ? 'info' : '';
  connBody.replaceChildren(h('dl', { class: 'kv' },
    h('dt', {}, 'Status'), h('dd', {}, h('span', { class: `tag ${tone}` }, CONN_LABEL[conn.state])),
    conn.model ? h('dt', {}, 'Model') : null, conn.model ? h('dd', { class: 'mono' }, `${conn.model}${conn.usingFallback ? ' (fallback)' : ''}`) : null,
    conn.state !== 'connected' ? h('dt', {}, 'Detail') : null, conn.state !== 'connected' ? h('dd', {}, conn.detail) : null,
    conn.provider === 'gemini' ? h('dt', {}, 'API key') : null,
    conn.provider === 'gemini' ? h('dd', {}, conn.keySource === 'secure-store' ? 'Saved in Capri' : conn.keySource === 'environment' ? 'GEMINI_API_KEY' : 'Not set') : null,
    h('dt', {}, 'Checked'), h('dd', {}, conn.checkedAt ? new Date(conn.checkedAt).toLocaleTimeString() : '—')));
}
/** Claude through the user's own account: sign-in state, sign in / out, and the model. */
function claudeAccountFields() {
  const state = h('span', { class: 'sub' }, 'Checking…');
  const actions = h('span', { class: 'row' });
  const render = async () => {
    const s = await api.invoke('claude:status');
    state.textContent = !s.installed ? 'Install Claude Code (claude.com/code), then reopen this.' : s.loggedIn ? s.detail : 'Not signed in';
    actions.replaceChildren(
      !s.installed ? '' :
      s.loggedIn ? btn('Sign out', async () => { await api.invoke('claude:signout'); await render(); }, 'quiet') :
      btn('Sign in to Claude', async () => {
        state.textContent = 'Opening Claude sign-in…';
        const r = await api.invoke('claude:signin');
        if (!r.ok) { state.textContent = r.detail ?? 'Couldn’t start sign-in.'; return; }
        state.textContent = 'Sign in in your browser, then paste the code it shows you here.';
        const code = h('input', { type: 'text', placeholder: 'Paste code', autocomplete: 'off', spellcheck: false, 'aria-label': 'Claude sign-in code' }) as HTMLInputElement;
        const submit = btn('Connect', async () => {
          if (!code.value.trim()) { code.focus(); return; }
          state.textContent = 'Connecting…';
          const s = await api.invoke('claude:code', code.value.trim());
          if (s.loggedIn) { toast('Signed in to Claude'); go('model'); }
          else { state.textContent = s.detail === 'Not signed in.' ? 'That code didn’t work. Click Sign in to try again.' : s.detail; await render(); }
        }, 'primary');
        code.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit.click(); });
        actions.replaceChildren(code, submit);
        code.focus();
      }, 'primary'),
    );
  };
  void render();
  return h('div', {},
    field('Account', h('span', { class: 'row' }, state, actions)),
    field('Model', select('ai.claude.model', 'Claude model', [['sonnet', 'Sonnet'], ['opus', 'Opus'], ['haiku', 'Haiku']])));
}

async function renderModel() {
  const revision = navigationRevision;
  secretStatus = await api.invoke('secrets:status');
  if (revision !== navigationRevision) return;
  const state = await api.invoke('chat:state'); phase = state.phase;
  if (revision !== navigationRevision) return;
  conn = await api.invoke('connection:get');
  if (revision !== navigationRevision) return;
  const sc = h('div', { class: 'scroll' });
  const result = h('div', { class: 'sub' });
  const datalist = h('datalist', { id: 'models' });
  const keyField = (key: 'gemini' | 'openai' | 'anthropic', label: string) => {
    const input = h('input', { type: 'password', placeholder: secretStatus[key] ? 'Saved' : 'Paste key', autocomplete: 'off', spellcheck: false, 'aria-label': label });
    return field(label, h('span', { class: 'row' }, input,
      btn('Save', async () => { if (!input.value.trim()) return; try { await api.invoke('secrets:set', { key, value: input.value.trim() }); input.value = ''; toast('Key saved'); go('model'); } catch (e) { result.textContent = (e as Error).message; } }),
      secretStatus[key] ? btn('Remove', async () => { await api.invoke('secrets:delete', key); go(tab); }, 'danger') : null),
      secretStatus._persistent ? undefined : 'Encryption unavailable: kept for this session only.');
  };
  connBody = h('div', {});
  refreshConn();
  const prov = S.ai.provider;
  sc.append(
    group('Connection', connBody, h('div', { class: 'row' },
      btn('Check', async () => { conn = await api.invoke('connection:check'); renderConn(); refreshConn(); }, '', 'refresh'),
      btn('Test', async () => { result.textContent = 'Testing…'; const r = await api.invoke('provider:test'); result.textContent = `${r.ok ? 'OK' : 'Failed'}: ${r.detail}${r.latencyMs !== undefined ? ` · ${r.latencyMs} ms` : ''}`; const list = await api.invoke('provider:models'); datalist.replaceChildren(...list.map((m) => h('option', { value: m }))); })),
    result, datalist),
    group('Provider',
      field('Provider', select('ai.provider', 'Provider', [['codex', 'Codex (your account)'], ['claude', 'Claude (your account)'], ['gemini', 'Google Gemini'], ['ollama', 'Ollama'], ['openai', 'OpenAI-compatible'], ['anthropic', 'Anthropic'], ['offline', 'None (offline commands)']], () => go('model'))),
      prov === 'codex' ? h('p', { class: 'sub' }, 'Uses your installed Codex CLI and existing sign-in. Chat and computer tasks count toward Codex usage. Click Test to check sign-in.') : null,
      prov === 'codex' ? h('div', {},
        field('Conversation model', text('ai.codex.chatModel', 'Conversation model', 'gpt-6-luna')),
        field('Task model', text('ai.codex.taskModel', 'Task model', 'Codex default'))) : null,
      prov === 'gemini' ? h('div', {},
        field('Model', text('ai.gemini.model', 'Model', 'gemini-3.5-flash-lite', 'models')),
        field('Fallback', text('ai.gemini.fallbackModel', 'Fallback model', 'none', 'models')),
        field('Thinking', select('ai.gemini.thinkingLevel', 'Thinking', [['minimal', 'Minimal'], ['low', 'Low'], ['medium', 'Medium'], ['high', 'High']])),
        keyField('gemini', 'API key')) : null,
      prov === 'claude' ? claudeAccountFields() : null,
      prov === 'ollama' ? h('div', {}, field('Server', text('ai.ollama.baseUrl', 'Server URL')), field('Model', text('ai.ollama.model', 'Model', 'llama3.2', 'models'))) : null,
      prov === 'openai' ? h('div', {}, field('Base URL', text('ai.openai.baseUrl', 'Base URL')), field('Model', text('ai.openai.model', 'Model', 'gpt-4o-mini', 'models')), keyField('openai', 'API key')) : null,
      prov === 'anthropic' ? h('div', {}, field('Base URL', text('ai.anthropic.baseUrl', 'Base URL')), field('Model', text('ai.anthropic.model', 'Model', 'claude-haiku-5-5', 'models')), keyField('anthropic', 'API key')) : null,
    ),
    group('Replies',
      field('Length', select('ai.responseLength', 'Reply length', [['short', 'Short'], ['medium', 'Medium'], ['long', 'Long']])),
      prov !== 'gemini' ? field('Creativity', range('ai.temperature', 'Creativity', 0, 1.5, 0.05)) : null,
      field('Max tokens', num('ai.maxTokens', 'Max tokens', 32, 8192)),
      field('Context turns', num('ai.historyTurns', 'Context turns', 0, 100)),
      field('Timeout (s)', num('ai.requestTimeoutSec', 'Timeout', 5, 600))),
  );
  view.append(viewHead('Brain & replies'), sc);
}

// ---------------------------------------------------------------- voice
async function renderVoice() {
  const revision = navigationRevision;
  secretStatus = await api.invoke('secrets:status');
  if (revision !== navigationRevision) return;
  const sc = h('div', { class: 'scroll' });
  const voiceSel = h('select', { 'aria-label': 'Voice', onchange: (e: Event) => void save('voice.systemVoice', (e.target as HTMLSelectElement).value) });
  const fillVoices = () => {
    const vs = speechSynthesis.getVoices();
    voiceSel.replaceChildren(h('option', { value: '' }, 'Automatic'), ...vs.map((v) => h('option', { value: v.name, selected: v.name === S.voice.systemVoice }, v.name)));
  };
  fillVoices();
  speechSynthesis.onvoiceschanged = fillVoices;
  const testVoice = () => {
    const u = new SpeechSynthesisUtterance('Hey, choom.');
    const v = speechSynthesis.getVoices().find((x) => x.name === S.voice.systemVoice);
    if (v) u.voice = v;
    u.rate = S.voice.rate; u.pitch = S.voice.pitch; u.volume = S.voice.volume;
    speechSynthesis.cancel(); speechSynthesis.speak(u);
  };
  const keyIn = h('input', { type: 'password', placeholder: secretStatus.openaiVoice ? 'Saved' : 'Optional', autocomplete: 'off', 'aria-label': 'Voice API key' });
  sc.append(
    group('Microphone',
      sw('Allow microphone', 'voice.micPermission', () => go('voice')),
      field('Speech to text', select('voice.sttEngine', 'Speech to text', [['windows', 'Windows (on-device)'], ['openai', 'Whisper-compatible']], () => go('voice'))),
      S.voice.sttEngine === 'openai' ? h('div', {}, field('Endpoint', text('voice.openaiStt.baseUrl', 'Speech to text endpoint')), field('Model', text('voice.openaiStt.model', 'Speech to text model'))) : null,
      field('Wake word “Hey Capri”', toggle('voice.wakeWord', 'Wake word'), S.voice.micPermission ? undefined : 'Needs the microphone.'),
    ),
    group('Speech',
      sw('Speak replies', 'voice.ttsEnabled'),
      field('Engine', select('voice.ttsEngine', 'Speech engine', [['system', 'Windows voices'], ['openai', 'OpenAI-compatible']], () => go('voice'))),
      S.voice.ttsEngine === 'system' ? field('Voice', h('span', { class: 'row' }, voiceSel, btn('Test', testVoice))) : h('div', {},
        field('Endpoint', text('voice.openaiTts.baseUrl', 'Speech endpoint')), field('Model', text('voice.openaiTts.model', 'Speech model')), field('Voice', text('voice.openaiTts.voice', 'Voice name')),
        field('Delivery instructions', h('textarea', { rows: 6, maxLength: 4000, value: S.voice.openaiTts.instructions, 'aria-label': 'Delivery instructions', onchange: (e: Event) => void save('voice.openaiTts.instructions', (e.target as HTMLTextAreaElement).value) }), /^tts-1(?:-hd)?$/.test(S.voice.openaiTts.model) ? 'Choose gpt-4o-mini-tts to use delivery instructions.' : 'Describe tone, emotion, accent, and pacing.', true)),
      field('Rate', range('voice.rate', 'Rate', 0.5, 2, 0.05)),
      S.voice.ttsEngine === 'system' ? field('Pitch', range('voice.pitch', 'Pitch', 0, 2, 0.05)) : null,
      field('Volume', range('voice.volume', 'Volume', 0, 1, 0.05, pct)),
    ),
    (S.voice.ttsEngine === 'openai' || S.voice.sttEngine === 'openai') ? group('Voice API key',
      field('Key', h('span', { class: 'row' }, keyIn, btn('Save', async () => { if (keyIn.value.trim()) { await api.invoke('secrets:set', { key: 'openaiVoice', value: keyIn.value.trim() }); go('voice'); } }),
        secretStatus.openaiVoice ? btn('Remove', async () => { await api.invoke('secrets:delete', 'openaiVoice'); go('voice'); }, 'danger') : null))) : '',
  );
  view.append(viewHead('Voice & listening'), sc);
}

// ---------------------------------------------------------------- character: appearance, behavior, movement
async function renderCharacter() {
  const revision = navigationRevision;
  const d = await api.invoke('diagnostics:get');
  if (revision !== navigationRevision) return;
  const t = d.teleport;
  const sc = h('div', { class: 'scroll' });
  const tp = (where: string, label: string) => btn(label, async () => { const r = await api.invoke('teleport:now', where); if (!r.ok) toast(r.detail, true); }, '', 'teleport');
  sc.append(
    group('Behavior mode', field('Mode', select('behavior.mode', 'Behavior mode', [['normal', 'Company'], ['explore', 'Explore'], ['sleep', 'Sleep']])), sw('Everyday activities and cursor play', 'behavior.smallActivities'), h('div', { class: 'hint' }, 'Small local scenes fill the time between visits. Sleep pauses them. Explore visits windows without taking focus; talking wakes her. Keyboard activity keeps her awake too.')),
    group('Appearance',
      field('Size', range('character.scale', 'Size', 0.4, 2.5, 0.05, pct)),
      field('Opacity', range('character.opacity', 'Opacity', 0.2, 1, 0.05, pct)),
      field('Animation', range('character.animationIntensity', 'Animation intensity', 0, 1.5, 0.05, pct)),
      field('Pose / animation', select('character.animation', 'Pose / animation', [['auto', 'Automatic'], ['idle', 'Stand'], ['perch', 'Sit'], ['grin', 'Grin'], ['sleep', 'Sleep'], ['glitch', 'Glitch'], ['dangle', 'Hang']])),
      field('Facing', select('character.facing', 'Facing', [['cursor', 'Follow cursor'], ['original', 'Original artwork'], ['left', 'Left'], ['right', 'Right']])),
      sw('Speech bubbles', 'character.speechBubbles'),
      sw('Opening animation on launch', 'character.startupIntro'),
      field('Frame rate', select('character.fpsCap', 'Frame rate', [['15', '15 fps'], ['30', '30 fps'], ['60', '60 fps'], ['120', '120 fps']], undefined, Number)),
      sw('Expressive behavior', 'character.personality'),
      sw('Glitch effects', 'character.glitchEffects'),
      sw('Occasional alternate poses', 'character.secondaryPoses')),
    group('Little spectacles', sw('Expressive hops, looks and afterimages', 'character.theatricalMotion'), sw('Mask-only deep sleep', 'character.deepSleep'), sw('Reaction close-ups', 'character.reactionCutins'), sw('Rare satellite moments', 'behavior.satelliteMoments'), sw('Playful window possession', 'behavior.windowPossession'), sw('Harmless cursor lightning', 'behavior.cursorLightning'), h('p', { class: 'hint' }, 'Large moments are spaced out and pause for chat, quiet company, games and settled lounging. Reduced motion keeps the scenes calm. You can also play or stop a scene from the tray menu.')),
    group('On the desktop',
      sw('Always on top', 'character.alwaysOnTop'),
      field('Click-through', toggle('character.clickThrough', 'Click-through'), 'Ctrl+Alt+C to interact for 15 s.'),
      sw('Hide for fullscreen apps', 'character.hideOnFullscreen'),
      field('Position', btn('Reset', () => save('character.position', null)))),
    group('Movement',
      field('Teleport now', h('span', { class: 'row' }, tp('auto', 'Anywhere'), tp('near_cursor', 'To cursor'), tp('perch', 'On window')), undefined, true),
      field('Teleport on her own', toggle('teleport.auto', 'Teleport on her own'), t.auto ? (t.armed ? `Next in ${t.nextInSec !== null ? Math.max(1, Math.ceil(t.nextInSec / 60)) : '—'} min` : `Waiting: ${t.blockedReason ?? 'AI offline'}`) : undefined),
      field('Travel spacing (minutes)', h('span', { class: 'row' }, num('teleport.minMinutes', 'Minimum minutes', 1, 240), h('span', { class: 'sub' }, 'to'), num('teleport.maxMinutes', 'Maximum minutes', 1, 480))),
      sw('Avoid the active window', 'teleport.avoidActiveWindow'),
      sw('Teleport effects', 'teleport.effects')),
  );
  const advanced = [...sc.children].find(el => el.querySelector('.label')?.textContent === 'Little spectacles');
  if (advanced) { const details = h('details', { class: 'advanced-settings' }, h('summary', {}, 'Extra effects and occasional spectacles')); advanced.replaceWith(details); details.append(advanced); }
  view.append(viewHead('Desktop character'), sc);
}

function renderAttention() {
  const sc = h('div', { class: 'scroll' });
  sc.append(
    group('Conversation cues',
      sw('Occasional cursor visits and brief following', 'behavior.cursorVisits'),
      sw('Visit newly opened windows', 'behavior.newWindowVisits'),
      field('Conversation activity', select('dialogue.activityLevel', 'Conversation activity', [['relaxed', 'Relaxed (6 background requests / 10 min)'], ['balanced', 'Balanced (12 / 10 min)'], ['lively', 'Lively (24 / 10 min)'], ['very_lively', 'Very lively (48 / 10 min)']]), 'More room for reactions and observations, not a requirement to speak. Learning and direct interactions have separate allowances. Lower this if you hit provider limits; actual rate-limit errors still pause requests.'),
      sw('Notice local context', 'dialogue.localContext'),
      h('div', { class: 'hint' }, 'Window openings and settled changes can draw her attention. Visual previews also require Read screen to be allowed in Privacy; Ask first never authorizes an automatic capture.'),
      sw('Occasional contextual pings', 'dialogue.contextPings'),
      sw('React to new songs', 'dialogue.spotifyBanter'),
      h('div', { class: 'hint' }, 'A lightweight Windows media helper notices Spotify track changes about every 12 seconds. New songs can draw an opinion shaped by her tastes, with the shared activity allowance. No microphone, audio recording, or Spotify login. Pauses for quiet modes.'),
      h('div', { class: 'hint' }, 'Clock, battery and app activity can shape her remarks. YouTube reactions favor the creator and title; an unavailable creator stays unknown. Quiet and context controls still apply.'),
      field('Weather city (optional)', h('input', { type: 'text', value: S.dialogue.weatherCity, maxLength: 100, placeholder: 'City, state or country', 'aria-label': 'Weather city', onchange: (e: Event) => save('dialogue.weatherCity', (e.target as HTMLInputElement).value.trim()) }), 'Leave blank for no weather requests. A city enables Open-Meteo forecasts, cached for 30 minutes. Ambiguous names are skipped.'),
      h('a', { href: 'https://open-meteo.com/', target: '_blank', rel: 'noreferrer' }, 'Weather data by Open-Meteo')),
    group('Behavior',
      sw('Do not disturb', 'behavior.doNotDisturb'),
      field('Sleep after (minutes)', num('behavior.sleepAfterMinutes', 'Sleep after', 1, 240)),
      sw('Quiet hours', 'behavior.quietHours.enabled'),
      field('From', h('span', { class: 'row' }, timeIn('behavior.quietHours.start', 'Quiet hours start'), h('span', { class: 'sub' }, 'to'), timeIn('behavior.quietHours.end', 'Quiet hours end'))),
      sw('Spontaneous conversation', 'behavior.idleRemarks'),
      sw('Say remarks out loud', 'behavior.proactiveVoice'),
      S.behavior.idleRemarks ? h('p', { class: 'hint' }, 'Attention responds to new windows, settled document changes and unresolved curiosities. She can look without speaking; recent conversation, repetition and focus controls limit interruptions.') : null,
      sw('Explore background windows', 'behavior.explore'),
      h('div', { class: 'hint' }, 'Allows visits in Company mode too. Visits are paced over minutes and pause for games, sleep, quiet hours and conversation. Occasional observations share a limited background request budget.')),
  );
  view.append(viewHead('Attention & quiet'), sc);
}

// ---------------------------------------------------------------- memory
function relationshipSections(data: Awaited<ReturnType<typeof relationshipData>>) {
  const refresh = () => go('memory');
  const run = async (action: () => Promise<unknown>) => { try { await action(); refresh(); } catch (e) { toast((e as Error).message, true); } };
  const entryInput = (label: string, value = '', max = 300) => h('input', { type: 'text', value, maxLength: max, 'aria-label': label, placeholder: label, style: 'width:100%' });
  const tasteCard = (taste?: typeof data.state.tastes[number]) => {
    const topic = entryInput('Taste topic', taste?.topic, 70), preference = entryInput('Capri preference', taste?.text);
    const card = h('div', { class: 'item' });
    const edit = () => card.replaceChildren(h('div', { class: 'txt' }, topic, preference,
      h('div', { class: 'row' }, btn('Save taste', () => run(() => api.invoke('relationship:taste', { id: taste?.id, topic: topic.value, text: preference.value })), 'primary'), taste ? btn('Cancel', refresh, 'quiet') : null)));
    if (!taste) { edit(); return card; }
    card.append(h('div', { class: 'txt' }, taste.topic, h('div', { class: 'sub' }, taste.text),
      h('details', {}, h('summary', {}, taste.source.role === 'assistant' ? 'From Capri’s own words' : 'Set by you'), h('p', { class: 'hint' }, taste.source.evidence))),
      btn('Edit', edit, 'quiet'), btn('Delete', () => run(() => api.invoke('relationship:remove', { kind: 'taste', id: taste.id })), 'quiet'));
    return card;
  };
  const threadCard = (thread?: typeof data.state.threads[number]) => {
    const title = entryInput('Project name', thread?.title, 80), summary = entryInput('Current project status', thread?.summary);
    const card = h('div', { class: 'item', style: 'flex-wrap:wrap' });
    const edit = () => card.replaceChildren(h('div', { class: 'txt' }, title, summary, h('div', { class: 'row' },
      btn('Save project', () => run(() => api.invoke('relationship:thread', { id: thread?.id, title: title.value, summary: summary.value, status: thread?.status ?? 'active' })), 'primary'), thread ? btn('Cancel', refresh, 'quiet') : null)));
    if (!thread) { edit(); return card; }
    const status = (value: import('../../shared/relationship').ThreadStatus, snoozeDays?: number) => run(() => api.invoke('relationship:status', { id: thread.id, status: value, snoozeDays }));
    card.append(h('div', { class: 'txt', style: 'flex-basis:100%' }, thread.title, h('span', { class: 'tag' }, thread.status), h('div', { class: 'sub' }, thread.summary),
      h('details', {}, h('summary', {}, 'Source and follow-up'), h('p', { class: 'hint' }, thread.source.evidence), h('p', { class: 'hint' }, thread.status === 'active' ? `May come up naturally after ${new Date(thread.nextAskAt).toLocaleString()}. This is not a scheduled reminder.` : 'No unsolicited follow-ups.'))),
      btn('Edit', edit, 'quiet'),
      thread.status === 'active' ? btn('Pause', () => status('paused'), 'quiet') : btn('Resume', () => status('active'), 'quiet'),
      ...(thread.status === 'active' ? [btn('Snooze 7 days', () => status('active', 7), 'quiet')] : []),
      ...(thread.status !== 'done' ? [btn('Done', () => status('done'), 'quiet')] : []),
      ...(thread.status !== 'dismissed' ? [btn('Dismiss topic', () => status('dismissed'), 'quiet')] : []),
      btn('Delete', () => run(() => api.invoke('relationship:remove', { kind: 'thread', id: thread.id })), 'quiet'));
    return card;
  };
  const line = entryInput('Exact authored line', '', 1000);
  return [
    group('Capri’s tastes', h('p', { class: 'hint' }, 'Stable preferences from her own delivered replies, kept separately from facts about you. Automatic learning builds these; you can edit or add one here. Use in conversations controls whether they guide her replies. These stay saved until deleted or you Forget all.'),
      h('div', { class: 'list' }, ...data.state.tastes.map(tasteCard), tasteCard())),
    group('Ongoing projects', h('p', { class: 'hint' }, 'Keeps the latest state you actually reported. Occasional follow-ups fit into a greeting or relevant conversation. Paused, completed and dismissed topics stay quiet; two unanswered check-ins pause further questions until you update the project.'),
      h('div', { class: 'list' }, ...data.state.threads.map(threadCard), threadCard())),
    group('Retired lines', h('p', { class: 'hint' }, 'Retire an exact authored line here or from its bubble. Generated replies have feedback buttons in Chat. Older generated-line exclusions become repetition feedback, without banning phrases.'),
      h('div', { class: 'list' }, ...data.retired.map(item => h('div', { class: 'item' }, h('div', { class: 'txt' }, item.text), btn('Restore line', () => run(() => api.invoke('dialogue:restore', item.id)), 'quiet')))),
      line, btn('Retire line', () => run(() => api.invoke('dialogue:retire', authoredLineId(line.value)??'')), 'quiet')),
  ];
}
const relationshipData = () => api.invoke('relationship:get');
async function renderMemory() {
  const revision = navigationRevision;
  const [mem, notes, rems, patterns, lasting, scene, experiences, personal, honcho] = await Promise.all([api.invoke('memory:list'), api.invoke('notes:list').catch(() => []), api.invoke('reminders:list').catch(() => []), api.invoke('memory:patterns'), relationshipData(), api.invoke('dialogue:scene'), api.invoke('continuity:get'), api.invoke('personal:get'), api.invoke('honcho:status')]);
  if (revision !== navigationRevision) return;
  const sc = h('div', { class: 'scroll' });
  const add = h('input', { type: 'text', placeholder: 'Something to remember', maxLength: 300, 'aria-label': 'New memory', style: 'flex:1;width:auto' });
  const count = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
  const memItem = (m: MemoryItem) => {
    const source = m.archived ? 'Forgotten automatically · excluded from conversations' : m.context ? m.context.label + ' · ' + m.context.kind + ' · supplied ' + m.context.asOf : m.source === 'model' ? 'Suggested by Capri' : 'Added by you';
    const card = h('div', { class: 'item' },
      h('div', { class: 'txt' }, m.text, m.learnedFrom ? h('div', { class: 'sub' }, 'From you: “' + m.learnedFrom.evidence + '”') : null, h('div', { class: 'sub' }, source + (m.updatedAt ? ' · edited ' + new Date(m.updatedAt).toLocaleDateString() : ' · ' + new Date(m.createdAt).toLocaleDateString()))),
      m.status === 'pending' ? btn('Approve', () => api.invoke('memory:approve', m.id).then(() => go('memory')), 'primary') : null,
      m.revisions?.length && m.revisions.at(-1)?.at === m.updatedAt ? btn('Undo', () => api.invoke('memory:undo', m.id).then(() => go('memory')).catch(e => toast((e as Error).message, true)), 'quiet') : null,
      btn('Edit', () => {
        const editor = h('textarea', { value: m.text, maxLength: 300, rows: 4, 'aria-label': 'Edit memory', style: 'width:100%;height:100px;resize:vertical;padding:8px' });
        card.replaceChildren(h('div', { class: 'txt' }, editor,
          h('div', { class: 'row' }, btn('Save', async () => { try { await api.invoke('memory:update', { id: m.id, text: editor.value }); go('memory'); } catch (e) { toast((e as Error).message, true); } }, 'primary'), btn('Cancel', () => go('memory'), 'quiet'))));
        editor.focus();
      }, 'quiet'),
      btn('Delete', () => api.invoke('memory:delete', m.id).then(() => go('memory')), 'quiet'));
    return card;
  };
  sc.append(
    group('Long-term understanding',
      sw('Use local Honcho memory', 'memory.honcho.enabled'),
      h('p', { class: 'hint', role: 'status' }, `${honcho.state} · ${honcho.synced} saved sources · ${honcho.pending} pending`),
      h('p', { class: 'hint' }, honcho.detail),
      h('p', { class: 'hint' }, 'Learns from saved conversations and approved profile records. Requires Use in conversations, Learn automatically and saved history. Storage and embeddings stay on this PC; text reasoning uses your existing Codex account and allowance. Private exchanges are excluded. Chat keeps working if the service is unavailable.'),
      h('p', { class: 'hint' }, 'Forgetting or correcting saved context clears the old Honcho reading and rebuilds from the remaining approved profile and future conversations. Old chat is not replayed after that reset. Pending deletion is retried when the local server returns.'),
      honcho.userProfile ? h('details', {}, h('summary', {}, 'Understanding of you'), h('p', { style: 'white-space:pre-wrap' }, honcho.userProfile)) : null,
      honcho.capriProfile ? h('details', {}, h('summary', {}, 'Capri’s own perspective'), h('p', { style: 'white-space:pre-wrap' }, honcho.capriProfile)) : null,
      h('div', { class: 'row' }, btn('Sync now', async () => { await api.invoke('honcho:sync'); go('memory'); }, 'quiet'),
        btn('Rebuild from approved profile', async () => { if (confirm('Clear Honcho’s current reading and restart from your approved profile and future conversations?')) { await api.invoke('honcho:rebuild'); go('memory'); } }, 'quiet'))),
    group('Current exchange', h('p', { class: 'hint' }, 'Chat and desktop reactions share this short-lived context. It updates immediately; an optional background reading identifies her position or unfinished question. Earlier readings yield to new turns. Saved for at most 48 hours when memory and saved history are on.'),
      scene.reading ? h('dl', { class: 'kv' }, h('dt', {}, 'Subject'), h('dd', {}, scene.reading.topic), h('dt', {}, 'Her position'), h('dd', {}, scene.reading.position || 'Unspecified'), h('dt', {}, 'Intention'), h('dd', {}, scene.reading.intention || 'Unspecified'), h('dt', {}, 'Open question'), h('dd', {}, scene.reading.openQuestion || 'None recorded')) : h('p', { class: 'hint' }, scene.entries.length ? 'Using the actual recent exchange. No background reading yet.' : 'No active exchange yet.'),
      h('details', {}, h('summary', {}, 'Recent shared turns'), ...scene.entries.slice(-8).map(e => h('p', { class: 'hint' }, `${e.role === 'user' ? 'You' : 'Capri'}: ${e.text}`))),
      btn('Clear current exchange', async () => { await api.invoke('dialogue:clearScene'); go('memory'); }, 'quiet')),
    ...relationshipSections(lasting),
    group('Working understanding',
      h('p', { class: 'hint' }, 'Your recent reports and short intentions connect with the current exchange and named projects. A return to PC input does not prove where you were. These records follow saved-history controls, expire, and can be forgotten here.'),
      ...personal.situations.filter(s => !s.validTo && s.expiresAt > Date.now()).map(s => h('div', { class: 'item' },
        h('div', { class: 'txt' }, s.value, h('div', { class: 'sub' }, `You reported: “${s.source.text}” · ${new Date(s.source.at).toLocaleString()} · valid until ${new Date(s.expiresAt).toLocaleString()}`)),
        btn('Forget situation', async () => { await api.invoke('personal:manage', { id: s.id, action: 'forget' }); go('memory'); }, 'quiet'))),
      ...personal.commitments.slice(-10).reverse().map(c => h('div', { class: 'item', style: 'display:block' },
        h('div', { class: 'txt' }, c.intention,
          h('div', { class: 'sub' }, `${c.status} · ${c.condition.kind === 'reply' ? 'After the matching reply' : c.condition.kind === 'topic' ? 'After finishing ' + c.condition.topic : 'At ' + new Date(c.condition.at!).toLocaleString()}`),
          h('div', { class: 'hint' }, `You said: “${c.source.text}” · ${new Date(c.source.at).toLocaleString()}`),
          h('details', {}, h('summary', {}, 'What happened'), ...c.transitions.map(t => h('p', { class: 'hint' }, `${new Date(t.at).toLocaleString()}: ${t.status} · ${t.reason}`)))),
        h('div', { class: 'row' }, ...(['complete','dismiss','forget'] as const).map(action => btn(action === 'complete' ? 'Mark done' : action === 'dismiss' ? 'Stop follow-ups' : 'Forget intention', async () => { await api.invoke('personal:manage', { id: c.id, action }); go('memory'); }, 'quiet'))))),
      personal.situations.length || personal.commitments.length ? btn('Clear working understanding', async () => { await api.invoke('personal:clear'); go('memory'); }, 'quiet') : emptyLine('No recent situations or intentions yet.')),
    group('Shared experiences',
      h('p', { class: 'hint' }, 'Selected discoveries and shared developments. Interpretations stay tentative. Open interests expire without reminders.'),
      ...experiences.slice(-12).reverse().map(e => h('div', { class: 'item', style: 'display:block' },
        h('div', { class: 'txt' }, e.topic,
          h('div', { class: 'sub' }, e.status + ' · ' + new Date(e.updatedAt).toLocaleString()),
          h('div', {}, e.sources.at(-1)?.role === 'user' && e.status === 'corrected' ? e.sources.at(-1)!.text : e.readings.at(-1)?.text ?? ''),
          e.want ? h('div', { class: 'hint' }, `${e.want.status}: ${e.want.text} · expires ${new Date(e.want.expiresAt).toLocaleString()}`) : null,
          h('details', {}, h('summary', {}, 'Source evidence'), ...e.sources.map(source => h('p', { class: 'hint' }, `${source.role}, ${source.reliability}, ${new Date(source.at).toLocaleString()}: ${source.text}`)), e.response ? h('p', { class: 'hint' }, `Capri actually said: ${e.response.text}`) : null)),
        h('div', { class: 'row', style: 'flex-wrap:wrap;margin-top:8px' }, ...(['resolve','dismiss','forget'] as const).map(action => btn(action === 'resolve' ? 'Resolve' : action === 'dismiss' ? 'Drop interest' : 'Forget experience', async () => { await api.invoke('continuity:manage', { id: e.id, action }); go('memory'); }, 'quiet')),
          btn('Correct', async () => { const text = prompt('What should Capri remember instead?'); if (text?.trim()) { await api.invoke('continuity:manage', { id: e.id, action: 'correct', text }); go('memory'); } }, 'quiet')))),
      experiences.length ? btn('Clear shared experiences', async () => { await api.invoke('continuity:clear'); go('memory'); }, 'quiet') : emptyLine('No selected shared experiences yet.')),
    group('Long-term',
      h('p', { class: 'hint', role: 'status' }, `${mem.filter(m => m.status === 'approved' && !m.archived).length} active memories · ${mem.filter(m => !!m.context && !m.archived).length} with source information`),
      sw('Use in conversations', 'memory.enabled'),
      sw('Learn automatically', 'memory.autoLearn'),
      h('p', { class: 'hint' }, 'Learns facts and preferences you state, and replaces outdated details when you correct them. Runs after replies, with chat taking priority. Uses extra model requests. Review changes here or Undo them. Forgotten entries remain here until permanently deleted.'),
      h('div', { class: 'list' }, ...mem.map(memItem), mem.length ? null : emptyLine('Nothing yet.')),
      h('div', { class: 'row', style: 'margin:8px 0' }, add,
        btn('Add', async () => { if (add.value.trim()) { try { await api.invoke('memory:add', add.value.trim()); go('memory'); } catch (e) { toast((e as Error).message, true); } } }, '', 'plus'),
        mem.length ? btn('Forget all', async () => { if (confirm('Delete all memories?')) { await api.invoke('memory:clear'); go('memory'); } }, 'danger') : null)),
    group('Our patterns',
      sw('Remember interaction and app patterns', 'memory.interactionProfile'),
      h('p', { class: 'hint' }, 'Remembers daily interaction counts and active app categories while Capri is running. These totals help your chosen AI model respond. App categories also need Notice local context. No titles, message contents, screenshots or keystrokes enter this profile. Follows history retention. Turning this, memory or saved history off clears it.'),
      h('p', { class: 'hint', role: 'status' }, patterns.daysObserved ? `Observed on ${count(patterns.daysObserved, 'day')} since ${patterns.since}. ${count(patterns.interactions.pat, 'head pat')}, ${count(patterns.interactions.poke, 'poke')}, ${count(patterns.interactions.chat, 'chat message')}. Last 7 days: ${count(patterns.recentInteractions.pat, 'pat')}, ${count(patterns.recentInteractions.poke, 'poke')}, ${count(patterns.recentInteractions.chat, 'chat')}.` : 'Nothing observed yet. Patterns build as you spend time together.'),
      h('div', { class: 'list' }, ...patterns.activity.map(a => h('div', { class: 'item' }, h('div', { class: 'txt' }, a.category === 'art' ? 'Design and art apps' : a.category === 'notes' ? 'Notes and documents' : a.category === 'code' ? 'Coding apps' : a.category === 'other' ? 'Other apps' : a.category[0].toUpperCase() + a.category.slice(1), h('div', { class: 'sub' }, `${a.recentMinutes} minutes in the last 7 days · ${a.minutes} minutes total. Estimated active app time.`))))),
      btn('Clear observed patterns', async () => { await api.invoke('memory:clearPatterns'); go('memory'); }, 'quiet')),
    group('History',
      sw('Save conversations', 'privacy.saveHistory'),
      field('Keep for (days, 0 = always)', num('memory.historyRetentionDays', 'Keep history for days', 0, 3650)),
      field('Clear', btn('Clear history', async () => { if (confirm('Delete all conversation history?')) { await api.invoke('chat:clear'); toast('History cleared'); } }, 'danger', 'trash'))),
    group('Notes', h('div', { class: 'list' }, ...notes.map((n: Note) => h('div', { class: 'item' },
      h('div', { class: 'txt' }, n.title, h('div', { class: 'sub' }, n.body.slice(0, 200))),
      btn('Delete', () => api.invoke('notes:delete', n.id).then(() => go('memory')), 'quiet'))), notes.length ? null : emptyLine('No notes.'))),
    group('Timers and reminders', h('div', { class: 'list' }, ...rems.map((r: Reminder) => h('div', { class: 'item' },
      h('div', { class: 'txt' }, r.text, h('div', { class: 'sub' }, `${r.kind === 'timer' ? 'Timer' : 'Reminder'} · ${new Date(r.dueAt).toLocaleString()}`)),
      r.fired ? h('span', { class: 'tag ok' }, 'done') : btn('Cancel', () => api.invoke('reminders:cancel', r.id).then(() => go('memory')), 'quiet'))), rems.length ? null : emptyLine('None.'))),
  );
  view.append(viewHead('Memory'), sc);
}

// ---------------------------------------------------------------- privacy: permissions + data
const TOOL_INFO: Record<ToolName, string> = {
  open_url: 'Open web pages', launch_app: 'Launch approved apps', search_files: 'Search file names',
  create_note: 'Save notes', list_notes: 'Read notes', set_reminder: 'Set reminders', start_timer: 'Start timers', cancel_timer: 'Cancel timers',
  get_time: 'Check the time', remember: 'Remember facts', teleport: 'Teleport on request', emote: 'Expressions',
  read_screen: 'Read your screen', study_timer: 'Study timers', mischief: 'Pranks on request', use_computer: 'Use your computer',
};
async function renderPrivacy() {
  const d = await api.invoke('diagnostics:get');
  const sc = h('div', { class: 'scroll' });
  const pol = (t: ToolName) => select(`actions.policies.${t}`, TOOL_INFO[t], [['allow', 'Allow'], ['confirm', 'Ask first'], ['deny', 'Never']]);
  sc.append(
    group('What Capri may do', ...TOOL_NAMES.map((t) => field(TOOL_INFO[t], pol(t)))),
    group('Approved apps',
      h('div', { class: 'list' }, ...S.actions.approvedApps.map((a, i) => h('div', { class: 'item' }, h('div', { class: 'txt' }, a.name, h('div', { class: 'sub mono' }, a.path)),
        btn('Remove', () => save('actions.approvedApps', S.actions.approvedApps.filter((_, j) => j !== i)).then(() => go('privacy')), 'quiet'))),
        S.actions.approvedApps.length ? null : emptyLine('None.')),
      h('div', { class: 'row', style: 'margin:8px 0' }, btn('Add app', async () => {
        const a = await api.invoke('apps:pick');
        if (a) { await save('actions.approvedApps', [...S.actions.approvedApps, a]); go('privacy'); }
      }, '', 'plus'))),
    group('Search folders',
      h('div', { class: 'list' }, ...S.actions.searchRoots.map((r, i) => h('div', { class: 'item' }, h('div', { class: 'txt mono' }, r),
        btn('Remove', () => save('actions.searchRoots', S.actions.searchRoots.filter((_, j) => j !== i)).then(() => go('privacy')), 'quiet'))),
        S.actions.searchRoots.length ? null : emptyLine('None.')),
      h('div', { class: 'row', style: 'margin:8px 0' }, btn('Add folder', async () => {
        const f = await api.invoke('folders:pick');
        if (f && !S.actions.searchRoots.includes(f)) { await save('actions.searchRoots', [...S.actions.searchRoots, f]); go('privacy'); }
      }, '', 'folder'))),
    group('Your data',
      h('dl', { class: 'kv' },
        h('dt', {}, 'Location'), h('dd', { class: 'mono' }, d.userData),
        h('dt', {}, 'API keys'), h('dd', {}, d.safeStorage ? 'Encrypted (Windows DPAPI)' : 'Memory only'),
        h('dt', {}, 'Audio'), h('dd', {}, 'Never stored'),
        h('dt', {}, 'Telemetry'), h('dd', {}, 'None')),
      field('Log level', select('privacy.logLevel', 'Log level', [['error', 'Errors'], ['warn', 'Warnings'], ['info', 'Normal'], ['debug', 'Debug']])),
      h('div', { class: 'row', style: 'margin:8px 0' }, btn('Open folder', () => api.invoke('app:openDataFolder'), '', 'folder'),
        btn('Delete all data', async () => {
          if (confirm('Delete all Capri data (settings, keys, history, memory, notes)? This cannot be undone.') && confirm('Really delete everything?')) await api.invoke('app:resetAll');
        }, 'danger', 'trash'))),
  );
  view.append(viewHead('Access & privacy'), sc);
}

function capabilityControl() {
  const input = h('input', { type: 'checkbox', class: 'switch', role: 'switch', checked: S.capabilityBoost.enabled, 'aria-label': 'More capable Capri' });
  input.addEventListener('change', async () => {
    input.disabled = true;
    try { await flushSettings(); const result = await api.invoke('settings:capabilities', input.checked); S = result.settings; toast(input.checked ? 'Capability preferences enabled.' : 'Previous preferences restored.'); }
    catch (error) { input.checked = S.capabilityBoost.enabled; toast((error as Error).message, true); }
    finally { input.disabled = false; }
  });
  return group('More capable Capri', field('Enable capability preferences', input),
    h('p', { class: 'hint' }, 'Gives Capri greater access to your PC: automatic screen previews may be sent to your chosen AI provider, local desktop context, push-to-talk microphone access, saved conversation history and automatic memory learning. Also enables spontaneous conversation, spoken asides, cursor and background-window visits, and autonomous travel. Quiet hours and Do not disturb still apply.'),
    h('p', { class: 'hint' }, 'Turning this off restores only the preferences this switch changed. Choices already enabled stay enabled; later individual edits are kept. Learned memories remain saved. Conversation history follows your restored history-saving preference.'),
    h('details', {}, h('summary', {}, 'Scope and connection requirements'), h('p', { class: 'hint' }, 'Includes personality, bubbles, small activities, local context, contextual pings, song reactions, cursor visits, new-window visits, background-window outings, spontaneous dialogue, proactive voice, automatic travel, interaction lines, push-to-talk permission, memory, automatic learning, interaction profile, saved history and Allow screen reading. Does not enable always-listening wake words, computer control, pranks, or new accounts and folders. Configured integrations keep their own consent and setup. Speech requires your voice settings.')));
}
function renderSettings() {
  const descriptions: Record<string, string> = {
    character: 'Presence, movement and expression', attention: 'Curiosity, conversation, quiet hours and rest', voice: 'Speaking, voices and push-to-talk', model: 'AI connection and reply preferences',
    memory: 'What she remembers and how she learns', connections: 'Browser, projects and connected services', privacy: 'Desktop access, actions and your data', system: 'Startup, shortcuts and app health',
  };
  const sc = h('div', { class: 'scroll settings-home' }, h('p', { class: 'page-intro' }, 'Make room for a little company. Choose how Capri lives on your desktop.'),
    h('div', { class: 'settings-grid' }, ...['character','attention','voice','model','memory','connections','privacy','system'].map(id => {
      const item = TABS.find(t => t.id === id)!;
      return h('button', { class: 'settings-tile', onclick: () => go(id) }, icon(item.icon), h('strong', {}, item.label), h('span', {}, descriptions[id]));
    })), capabilityControl());
  view.append(viewHead('Settings'), sc);
}

// ---------------------------------------------------------------- system: startup, shortcuts, health, logs
async function renderSystem() {
  const revision = navigationRevision;
  const sc = h('div', { class: 'scroll' });
  view.append(viewHead('App & shortcuts'), sc);
  sc.append(
    group('Developer tools', btn('Open developer panel ↗', () => api.invoke('panel:open', 'developer')), h('p', { class: 'hint' }, 'Preview animations, run action cycles and inspect local behavior.')),
    group('Startup',
      sw('Launch at sign-in', 'startup.launchOnLogin'),
      sw('Reminder notifications', 'notifications.reminders'),
      sw('Notification sound', 'notifications.sound')),
    group('Shortcuts', ...([['Open chat', 'Ctrl+Alt+Space'], ['Push to talk', 'Ctrl+Alt+T'], ['Teleport', 'Ctrl+Alt+P'], ['Stop', 'Ctrl+Alt+X'], ['Hide / show', 'Ctrl+Alt+H'], ['Interact (click-through)', 'Ctrl+Alt+C']] as const)
      .map(([d, k]) => field(d, h('span', { class: 'kbd' }, k)))),
  );
  const health = group('Health', emptyLine('Checking…'));
  const logs = h('div', { class: 'logs' });
  sc.append(health, group('Logs', logs, h('div', { class: 'row', style: 'margin:8px 0' },
    btn('Refresh', () => loadLogs(), '', 'refresh'), btn('Copy', () => navigator.clipboard.writeText(logs.textContent ?? '').then(() => toast('Copied'))),
    btn('Restart', () => api.invoke('app:restart')), btn('Quit Capri', () => api.invoke('app:quit'), 'danger'))));
  const loadLogs = async () => { logs.textContent = (await api.invoke('logs:tail', 200)).join('\n'); logs.scrollTop = logs.scrollHeight; };
  let d: Diagnostics;
  try { d = await api.invoke('diagnostics:get'); } catch (e) { health.replaceChildren(h('span', { class: 'label' }, 'Health'), h('div', { class: 'err-text' }, (e as Error).message)); return; }
  if (revision !== navigationRevision) return;
  const ok = (b: boolean, t: string) => h('span', { class: `tag ${b ? 'ok' : 'bad'}` }, t);
  health.replaceChildren(h('span', { class: 'label' }, 'Health'), h('dl', { class: 'kv' },
    h('dt', {}, 'AI'), h('dd', {}, ok(d.connection.state === 'connected', `${CONN_LABEL[d.connection.state]}${d.connection.state === 'connected' ? '' : ` · ${d.connection.detail}`}`)),
    h('dt', {}, 'Speech recognizer'), h('dd', {}, ok(d.speechRecognizer.available, d.speechRecognizer.available ? 'Available' : d.speechRecognizer.detail)),
    h('dt', {}, 'Key storage'), h('dd', {}, ok(d.safeStorage, d.safeStorage ? 'Encrypted' : 'Memory only')),
    h('dt', {}, 'Fullscreen detection'), h('dd', {}, ok(d.fullscreenWatcher !== 'unavailable', d.fullscreenWatcher)),
    h('dt', {}, 'Frame rate'), h('dd', { class: 'mono' }, `${d.perf.fps ?? '—'} fps`),
    h('dt', {}, 'Startup'), h('dd', { class: 'mono' }, `${d.perf.startupMs} ms`),
    h('dt', {}, 'Memory'), h('dd', { class: 'mono' }, `${d.perf.processes.reduce((s, p) => s + p.memMB, 0)} MB`),
    h('dt', {}, 'Shortcuts'), h('dd', { class: 'mono' }, Object.entries(d.shortcuts).map(([k, v]) => `${k} ${v}`).join(' · ') || 'Off'),
    h('dt', {}, 'Last unclean exit'), h('dd', {}, d.lastCrash ?? 'None'),
    h('dt', {}, 'Version'), h('dd', { class: 'mono' }, `${d.version} · Electron ${d.electron}`),
    h('dt', {}, 'Displays'), h('dd', { class: 'mono' }, d.displays.map((x) => `${x.bounds.width}×${x.bounds.height} @${Math.round(x.scaleFactor * 100)}%`).join(', '))));
  void loadLogs();
}

// ---------------------------------------------------------------- developer panel
async function renderDeveloper() {
  const revision = navigationRevision;
  const header = viewHead('Developer tools'), sc = h('div', { class: 'scroll dev-scroll' }); view.append(header, sc);
  const status = h('p', { role: 'status', id: 'dev-status', class: 'dev-status' }, 'Connecting…');
  const log = h('pre', { class: 'logs', id: 'dev-log' });
  const state = h('div', { id: 'dev-state' }), mind = h('div', { id: 'dev-mind' });
  const decisionQuery = h('input', { type: 'search', placeholder: 'Filter event, action or reason…', 'aria-label': 'Filter decision history' });
  decisionQuery.addEventListener('input', () => renderDetailViews());
  const decisions = h('div', { class: 'dev-decisions' }), catalog = h('div', { class: 'dev-catalog' });
  const runButtons: HTMLButtonElement[] = [];
  const seconds = h('input', { type: 'number', min: .5, max: 8, step: .5, value: 2, 'aria-label': 'Preview duration in seconds' });
  const duration = () => Math.max(.5, Math.min(8, Number(seconds.value) || 2));
  const choice = (label: string, values: readonly string[]) => h('select', { 'aria-label': label }, ...values.map(v => h('option', { value: v }, v.replaceAll('_', ' '))));
  const clock = (at: number) => new Date(at).toLocaleTimeString();
  const wait = (n: number) => n > 0 ? n >= 60 ? `${Math.ceil(n / 60)} min` : `${n}s` : 'Ready';
  const card = (title: string, ...children: Child[]) => h('section', { class: 'dev-card' }, h('h2', {}, title), ...children);
  const line = (label: string, value: string) => h('div', { class: 'dev-kv' }, h('span', {}, label), h('strong', {}, value));
  const note = (text: string) => h('p', { class: 'hint' }, text);
  const evidence = (summary: string, items: string[]) => h('details', { class: 'dev-evidence' }, h('summary', {}, summary), ...items.map(t => h('p', {}, t)));
  const empty = (text: string) => h('p', { class: 'dev-empty' }, text);
  const fill = (element: HTMLElement, ...children: Child[]) => {
    const expanded = new Set(Array.from(element.querySelectorAll('details[open]')).map(e => e.querySelector('summary')?.textContent));
    element.replaceChildren(h('div', {}, ...children));
    for (const e of element.querySelectorAll('details')) if (expanded.has(e.querySelector('summary')?.textContent)) e.open = true;
  };
  let reading = false, paused = false;
  const pause = btn('Pause live view', () => { paused = !paused; pause.textContent = paused ? 'Resume live view' : 'Pause live view'; if (!paused) void refresh(); });
  header.append(h('div', { class: 'row' }, btn('Open companion ↗', () => api.invoke('panel:open', 'settings'), 'quiet'), pause));
  let renderDetailViews = () => {};
  const refresh = async () => {
    if (reading || paused || revision !== navigationRevision) return; reading = true;
    try {
      const d: DevSnapshot = await api.invoke('dev:get'); if (revision !== navigationRevision) return;
      status.textContent = `${d.job.result.toUpperCase()}${d.job.label ? ' · ' + d.job.label : ''} · ${d.job.step || 'No preview running. Live state refreshes every second.'}`;
      const { runtime: r, mind: m, gates: g } = d, last = m.situation.journal.at(-1), renderer = r.poseRenderer;
      const fresh = m.environment.subjects.find(s => s.current)?.reading;
      fill(state, 
        h('div', { class: 'dev-metrics' }, ...[
          ['Presence', `${r.visible ? 'Visible' : 'Hidden'} / ${r.mode}`], ['Expression', `${renderer?.mood ?? 'Unknown'} / ${renderer?.phase ?? r.phase}`],
          ['Attention', `${m.situation.interests.length} interests / ${m.episodes.filter(e => e.want?.status === 'open').length} open wants`],
          ['Provider', `${g.provider} / ${g.connection}`],
        ].map(([label, value]) => h('div', { class: 'dev-metric' }, h('span', {}, label), h('strong', {}, value)))),
        m.diagnostics.failure ? h('div', { class: 'dev-alert', role: 'note' }, `${clock(m.diagnostics.failure.at)} · ${m.diagnostics.failure.summary}. A successful connection does not establish a valid decision.`) : null,
        h('div', { class: 'dev-grid' },
          card('Current direction', h('p', { class: 'dev-lead' }, m.situation.interests.at(-1)?.intention ?? r.goal ?? 'Quiet company; no active curiosity.'),
            line('Last choice', last ? `${last.event} → ${last.action}` : 'No decision yet'), note(last?.reason ?? 'An event can produce silence, a gesture, movement or speech.'),
            line('Expression accepted', last?.delivered ? 'Yes' : 'No'), note('Accepted means the host accepted an expression. It is not proof that audio finished.')),
          card('What she is attending to', h('p', { class: 'dev-lead' }, m.situation.facts.at(-1)?.title ?? 'No admitted desktop observation'),
            note(fresh?.hypothesis ?? 'No fresh visual interpretation for the current subject.'),
            line('Stable foreground', `${m.environment.stableSeconds}s`), line('Window switches / minute', String(m.environment.switchesPerMinute)),
            fresh?.openCuriosity ? note(`Unresolved: ${fresh.openCuriosity}`) : null),
          card('Why she may be quiet', g.blockers.length ? h('ul', { class: 'dev-blockers' }, ...g.blockers.map(t => h('li', {}, t))) : note('No current host blocker. Timing, evidence and the model can still favor silence.'),
            line('Core initiative gate', g.initiativeReady ? 'Open' : 'Waiting'), line('After direct interaction', wait(m.diagnostics.retrySeconds)),
            line('Next selective inspection', wait(g.inspectionSeconds)), line('Unsolicited speech spacing', wait(g.speechSeconds)), line('Next movement window', wait(g.nextVisitSeconds)),
            note('These are earliest eligibility windows, not promises to speak or move.')),
          card('Body and continuity', line('Artwork', renderer?.pose ?? renderer?.clip ?? 'Waiting for renderer'), line('Pose motion', !renderer?.pose ? 'Primary sprite' : renderer.reduced ? 'Reduced motion' : renderer.shader && renderer.motion > 0 ? 'Shader active' : 'Still / fallback'),
            line('Visit / tour', `${r.visit} / ${r.tour}`), line('Moving', String(r.moving)), line('FPS', String(r.fps ?? 'Unknown')),
            line('Saved experiences', String(m.episodes.length)), line('Approved memories', String(r.approvedMemories)), line('Shared recent scenes', String(r.sharedScenes)))),
        card('Request allowance', note('Optional requests share a ceiling. Direct chat replies have their own priority. No requests are made by viewing this panel.'),
          ...g.budgets.map(b => line(b.purpose, `${b.used}/${b.limit} in 10 min · ${wait(b.retrySeconds)}`)),
          line('Decision pending', String(r.pendingRequest)), line('Desktop context / learning / history', [g.localContext, g.learning, g.saveHistory].map(v => v ? 'On' : 'Off').join(' / '))),
        card('Latest contextual outcome', h('p', {}, r.dialogueOutcome)),
      );
      renderDetailViews = () => {
      if (!panes.get('Mind & memory')!.hidden) fill(mind, 
        note('Inspect stored observations, attributed evidence and compact, tentative interpretations. This view does not generate an internal monologue. Preview actions do not create personal memories.'),
        card('Current interests', ...m.situation.interests.map(i => h('article', { class: 'dev-entry' }, h('h3', {}, i.topic), h('p', {}, i.intention), note(`Expires in ${wait(Math.max(0, Math.ceil((i.expiresAt - Date.now()) / 1000)))}`), evidence('Source evidence', [`${i.sourceId}: ${i.quote}`]))), m.situation.interests.length ? null : empty('No active short-lived interest.')),
        card('Observed evidence', ...m.situation.facts.slice().reverse().map(f => h('article', { class: 'dev-entry' }, h('h3', {}, f.title || f.process), note(`${clock(f.at)} · ${f.process} · ${f.evidence}`), h('p', {}, f.detail))), m.situation.facts.length ? null : empty('No admitted observations.')),
        card('Visual readings', ...m.environment.subjects.filter(s => s.reading?.evidence).map(s => h('article', { class: 'dev-entry' }, h('h3', {}, s.current ? 'Current subject' : `Earlier subject / ${s.ageSeconds}s ago`), note('Model interpretation of an exposed screenshot; not independently verified.'), h('p', {}, s.reading?.hypothesis ?? ''), ...((s.reading?.evidence?.facts ?? []).map(t => h('p', {}, t))), note(s.reading?.openCuriosity || 'No unresolved curiosity.'))), m.environment.subjects.some(s => s.reading?.evidence) ? null : empty('No fresh visual reading.')),
        card('Shared conversation', m.exchange.reading ? h('div', {}, line('Topic', m.exchange.reading.topic), line('Position', m.exchange.reading.position || 'None'), line('Intention', m.exchange.reading.intention || 'None'), line('Open question', m.exchange.reading.openQuestion || 'None')) : note('No attributed conversation summary.'),
          evidence(`${m.exchange.entries.length} recent exchange entries`, m.exchange.entries.map(e => `${clock(e.at)} · ${e.role}: ${e.text}`))),
        card('Remembered experiences and wants', ...m.episodes.slice().reverse().map(e => h('article', { class: 'dev-entry' }, h('h3', {}, e.topic), note(`${e.status} · ${clock(e.updatedAt)}${e.want ? ` · want ${e.want.status}` : ''}`), h('p', {}, e.readings.at(-1)?.text ?? ''), e.want ? h('p', {}, `${e.want.text}${e.want.askedAt ? ' (already asked)' : ''}`) : null,
          evidence(`${e.sources.length} attributed sources`, e.sources.map(s => `${s.role} / ${s.reliability}: ${s.text}`)))), m.episodes.length ? note('Correct, resolve, drop or forget an experience in Memory.') : empty('No episodic experience retained. Routine contact and window switches do not automatically create episodes.')),
        card('Character tastes', ...m.relationship.tastes.map(t => h('article', { class: 'dev-entry' }, h('h3', {}, t.topic), h('p', {}, t.text), evidence('Supporting quote', [t.source.evidence]))), m.relationship.tastes.length ? null : empty('No learned character taste.')),
        card('Ongoing projects', ...m.relationship.threads.map(t => h('article', { class: 'dev-entry' }, h('h3', {}, `${t.title} / ${t.status}`), h('p', {}, t.summary))), m.relationship.threads.length ? null : empty('No ongoing project thread.')),
      );
      if (!panes.get('Results')!.hidden) fill(decisions, ...m.situation.journal.slice().reverse().filter(j => `${j.event} ${j.action} ${j.reason} ${j.interpretation ?? ''}`.toLowerCase().includes(decisionQuery.value.toLowerCase())).map(j => h('article', { class: 'dev-entry' }, h('h3', {}, `${clock(j.at)} · ${j.event} → ${j.action}`), h('p', {}, j.reason), j.interpretation ? note(`Tentative interpretation: ${j.interpretation}`) : null, note(`Host accepted expression: ${j.delivered ? 'yes' : 'no'}`))), m.situation.journal.length ? null : empty('No recent decision journal.'));
      };
      renderDetailViews();
      log.textContent = d.job.log.map(entry => `${clock(entry.at)}  ${entry.text}`).join('\n') || 'Preview results appear here.';
      for (const b of runButtons) b.disabled = d.job.active;
      stop.disabled = !d.job.active;
    } catch (error) { status.textContent = String(error instanceof Error ? error.message : error); }
    finally { reading = false; }
  };
  const run = async (command: DevCommand) => { try { await api.invoke('dev:run', command); await refresh(); } catch (error) { toast(String(error instanceof Error ? error.message : error), true); } };
  const action = (label: string, command: () => DevCommand) => { const b = btn(label, () => void run(command())); runButtons.push(b); return b; };
  const stop = btn('Stop preview', () => void api.invoke('dev:stop').then(refresh), 'primary');
  const absence = (label: string, state: 'idle' | 'sleep' | 'return' | 'clear') => btn(label, () => { void api.invoke('dev:absence', state).then(refresh).catch(error => toast(String(error instanceof Error ? error.message : error), true)); });
  const animation = choice('Animation preview', DEV_ANIMATIONS), activity = choice('Activity preview', DEV_ACTIVITIES), interaction = choice('Interaction preview', DEV_INTERACTIONS);
  const cycle = choice('Cycle preview', ['animations', 'interactions', 'activity', 'loading']), dialogue = choice('Dialogue event', DEV_DIALOGUE), surface = choice('Dialogue platform', ['generic', 'youtube', 'discord', 'chatgpt', 'spotify', 'browser']);
  const secondaryMotion = choice('Secondary motion', ['animated', 'still']);
  const secondary = choice('Secondary pose', SECONDARY_POSES), orientation = choice('Secondary orientation', ['upright', 'inverted']);
  const scenario = choice('Behavior scenario', DEV_SCENARIOS), ping = choice('Contextual ping', Object.keys(PING_LINES));
  const toolbar = h('div', { class: 'dev-toolbar' }, h('label', {}, 'Duration ', seconds, ' sec'), action('Run local checks', () => ({ kind: 'checks' })), stop);
  const nav = h('nav', { class: 'dev-nav', 'aria-label': 'Developer sections' });
  const panes = new Map<string, HTMLElement>();
  const show = (name: string) => { for (const [id, pane] of panes) pane.hidden = name !== id; for (const b of nav.querySelectorAll('button')) b.setAttribute('aria-pressed', String(b.textContent === name)); renderDetailViews(); };
  for (const name of ['Overview', 'Mind & memory', 'Playground', 'Live checks', 'Results']) { const pane = h('div', { class: 'dev-pane', hidden: name !== 'Overview' }); panes.set(name,pane); nav.append(btn(name, () => show(name))); }
  sc.append(note('What she notices, what she chooses, and what gets in the way.'), nav, status, ...panes.values());
  panes.get('Playground')!.append(toolbar);
  show('Overview');
  panes.get('Overview')!.append(state);
  panes.get('Mind & memory')!.append(mind);
  const search = h('input', { type: 'search', placeholder: 'Find an animation, event or scenario…', 'aria-label': 'Search previews' });
  const category = choice('Preview category', ['all', 'artwork', 'expression', 'movement', 'dialogue']);
  panes.get('Playground')!.append(note('Local previews use no model requests. Movement trials restore position. Feature settings and reduced-motion preferences still affect some expressions.'), h('div', { class: 'dev-filter' }, search, category), catalog);
    catalog.append(
    group('Construct moments', ...SCENES.map(name => action(name === 'satellite' ? 'Satellite and red light' : name === 'possession' ? 'Possess an exposed window' : 'Playful cursor spark', () => ({ kind: 'scene', name, seconds: duration() }))), action('Sleep into her mask', () => ({ kind: 'mask', seconds: duration() })), h('div', { class: 'row' }, ...FLOURISHES.map(name => action(name, () => ({ kind: 'flourish', name, seconds: duration() })))), h('div', { class: 'row' }, ...(['grin','laugh','look','eyes','many'] as const).map(name => action('Cut-in: ' + name, () => ({ kind: 'cutin', name, seconds: duration() }))))),
    group('Secondary artwork', field('Motion', secondaryMotion), field('Pose', secondary), field('Orientation', orientation), action('Preview secondary pose', () => ({ kind: 'secondary', motion: secondaryMotion.value as 'animated' | 'still', name: secondary.value as typeof SECONDARY_POSES[number], inverted: secondary.value !== 'recline' && orientation.value === 'inverted', seconds: duration() })), action('Compare still and animated poses', () => ({ kind: 'scenario', name: 'shader_compare', seconds: duration() })), h('p', { class: 'hint' }, 'Closed-eye sitting is reserved for sustained head rubbing on an upright window perch. Lower ledges alternate lying and original sitting, with a longer pause before roaming. Original strips remain the primary artwork.')),
    group('Behavior scenarios', field('Scenario', scenario), action('Run behavior scenario', () => ({ kind: 'scenario', name: scenario.value as typeof DEV_SCENARIOS[number], seconds: duration() })),
      h('div', { class: 'row' }, action('Sitting hover response', () => ({ kind: 'scenario', name: 'sit_hover', seconds: duration() })), action('Inspect below while sitting', () => ({ kind: 'scenario', name: 'sit_inspect', seconds: duration() })), action('Supported lying rest', () => ({ kind: 'scenario', name: 'recline_rest', seconds: duration() }))),
      h('div', { class: 'row' }, action('Cursor visit and return', () => ({ kind: 'scenario', name: 'cursor_visit', seconds: duration() })), action('Quick window release', () => ({ kind: 'scenario', name: 'perch_quick', seconds: duration() })), action('Held window sequence', () => ({ kind: 'scenario', name: 'perch_held', seconds: duration() })), action('Inspect shared continuity', () => ({ kind: 'scenario', name: 'continuity', seconds: duration() })))),
    group('Contextual pings', field('Context', ping), action('Preview contextual ping', () => ({ kind: 'ping', name: ping.value as PingKind, seconds: duration() })), h('p', { class: 'hint' }, 'Fixtures only: does not change the clock, weather, battery, real ping history or quiet settings. Late-night, weather, battery and long-session lines have many variants.')),
    group('Live contextual checks', h('p', { class: 'hint' }, 'Uses a visible external window, a preview of its exposed content when supported, and up to one model request. Rate limits still apply; drop checks show a local fallback when limited. No computer-control actions.'),
      h('div', { class: 'row' }, action('Live window-drop comment', () => ({ kind: 'live', name: 'drop' })), action('Live visual inspection', () => ({ kind: 'live', name: 'inspect' })), action('Live return comment', () => ({ kind: 'live', name: 'cursor_return' })))),
    group('Animations', field('Sprite strip', animation), action('Play animation', () => ({ kind: 'animation', name: animation.value as typeof DEV_ANIMATIONS[number], seconds: duration() })),
      field('Activity', activity), action('Play activity', () => ({ kind: 'activity', name: activity.value as typeof DEV_ACTIVITIES[number], seconds: duration() })),
      field('Interaction', interaction), action('Play interaction', () => ({ kind: 'interaction', name: interaction.value as typeof DEV_INTERACTIONS[number], seconds: duration() }))),
    group('Action cycles', field('Walkthrough', cycle), action('Run cycle', () => ({ kind: 'cycle', name: cycle.value as 'animations' | 'interactions' | 'activity' | 'loading', seconds: duration() })),
      h('div', { class: 'row' }, action('Replay opening', () => ({ kind: 'intro' })), action('Run one exploration outing', () => ({ kind: 'explore' })), action('Run up to 3 exploration outings', () => ({ kind: 'explore', count: 3 })))),
    group('Absence and return', h('p', { class: 'hint' }, 'Simulates inactivity without changing saved mode. After two seconds, move the mouse or type to return, or use Return now. Sleep wakes before teleporting; idle returns with a wave. Return lines follow normal voice settings.'),
      h('div', { class: 'row' }, absence('Simulate idle', 'idle'), absence('Simulate sleep', 'sleep'), absence('Return now', 'return'), absence('Clear absence', 'clear'))),
    group('Local dialogue', field('Event', dialogue), field('Platform', surface), action('Preview dialogue', () => ({ kind: 'dialogue', name: dialogue.value as typeof DEV_DIALOGUE[number], surface: surface.value === 'generic' ? undefined : surface.value as 'youtube' | 'discord' | 'chatgpt' | 'spotify' | 'browser', seconds: duration() }))),
  );

  const reaction = choice('Reaction preview', DEV_REACTIONS), mood = choice('Mood preview', MOODS), life = choice('Life event preview', LIFE_EVENTS), phase = choice('Phase preview', DEV_PHASES);
  catalog.prepend(group('Expression and state', field('Reaction', reaction), action('Play reaction', () => ({ kind: 'reaction', name: reaction.value as typeof DEV_REACTIONS[number], seconds: duration() })),
    field('Mood', mood), action('Preview mood', () => ({ kind: 'mood', name: mood.value as typeof MOODS[number], seconds: duration() })),
    field('Life event', life), action('Trigger life event', () => ({ kind: 'life', name: life.value as typeof LIFE_EVENTS[number], seconds: duration() })),
    field('Phase', phase), action('Preview phase', () => ({ kind: 'phase', name: phase.value as typeof DEV_PHASES[number], seconds: duration() }))));
  const categories: Record<string,string> = { 'Expression and state':'expression', 'Construct moments':'expression', 'Secondary artwork':'artwork', Animations:'artwork', 'Behavior scenarios':'movement', 'Action cycles':'movement', 'Absence and return':'movement', 'Contextual pings':'dialogue', 'Local dialogue':'dialogue' };
  for (const section of Array.from(catalog.children) as HTMLElement[]) {
    const title = section.querySelector('.label')?.textContent ?? '';
    if (title === 'Live contextual checks') { panes.get('Live checks')!.append(section); continue; }
    section.dataset.category = categories[title] ?? 'movement';
    section.dataset.search = [section.textContent, ...Array.from(section.querySelectorAll('option')).map(o => o.value)].join(' ').toLowerCase();
  }
  revealDeveloperSearch = item => { show(item.section ?? 'Playground'); if ((item.section ?? 'Playground') === 'Playground') { search.value = item.terms ?? item.label; category.value = 'all'; filter(); if(item.control) { const control = [...catalog.querySelectorAll<HTMLSelectElement>('select')].find(el => el.getAttribute('aria-label') === item.control); if(control) control.value = item.value ?? ''; } } else highlightResult(item); };
  const filter = () => { const query = search.value.toLowerCase().trim(); for (const section of Array.from(catalog.children) as HTMLElement[]) section.hidden = (category.value !== 'all' && section.dataset.category !== category.value) || !section.dataset.search?.includes(query); };
  search.addEventListener('input', filter); category.addEventListener('change', filter);
  panes.get('Live checks')!.prepend(note('These controls use real exposed-window context and can spend model usage. They honor privacy, focus and request limits. A denied or quiet result is shown in Overview and Results.'));
  panes.get('Results')!.append(card('Preview log', log), card('Recent decisions', decisionQuery, note('A bounded journal of compact decisions from actual events. Local previews have a separate log.'), decisions));
  await refresh(); if (revision === navigationRevision) developerPoll = window.setInterval(() => void refresh(), 1000);
}


// ---------------------------------------------------------------- first run
function renderWelcome() {
  const finish = async (provider?: string) => {
    if (provider) await save('ai.provider', provider);
    await save('firstRunComplete', true);
    go(provider && provider !== 'offline' && provider !== 'gemini' ? 'model' : provider === 'gemini' ? 'model' : 'chat');
  };
  const choice = (title: string, sub: string, provider: string) => h('div', { class: 'choice', role: 'button', tabIndex: 0, onclick: () => finish(provider), onkeydown: (e: KeyboardEvent) => { if (e.key === 'Enter') void finish(provider); } },
    h('b', {}, title), h('span', { class: 'sub' }, sub), h('span', { class: 'go' }, '→'));
  view.append(h('div', { class: 'scroll' }, h('div', { class: 'welcome' },
    h('h2', {}, 'Choose her brain'),
    choice('Codex', 'Use your existing Codex sign-in', 'codex'),
    choice('Claude', 'Sign in with your Claude account', 'claude'),
    choice('Google Gemini', 'Needs an API key', 'gemini'),
    choice('Ollama', 'Local, on this PC', 'ollama'),
    choice('Other API', 'OpenAI-compatible or Anthropic', 'openai'),
    choice('No AI', 'Commands only', 'offline'))));
}

async function renderConnections() {
  const note = (text: string) => h('p',{class:'hint'},text);
  const state = await api.invoke('life:get');
  const stage = await api.invoke('life:stage2');
  const comm = await api.invoke('life:stage3');
  const run = async (action: () => Promise<unknown>) => { try { await action(); await go('connections'); } catch(e) { toast(e instanceof Error ? e.message : String(e),true); } };
  const draftSave = h('div',{class:'hint',role:'status','aria-label':'Setup save status'},'Chrome/project text drafts save automatically. Communication and phone forms require their Save buttons.');
  const saveDraft = (id:string,draft:import('../../shared/lifeContext').LifeDraft) => {draftSave.textContent='Saving setup draft…';void api.invoke('life:draft',{id,draft}).then(()=>{draftSave.textContent='Setup draft saved. Apply source controls to activate changes.';}).catch(e=>{draftSave.textContent='Draft could not save: '+String(e);});};
  const idInput = h('input',{type:'text','aria-label':'Chrome extension ID',placeholder:'32-letter ID from chrome://extensions',value:state.drafts.pairing?.extensionId ?? state.bridge.extensionId ?? '',oninput:(e:Event)=>saveDraft('pairing',{extensionId:(e.target as HTMLInputElement).value})});
  const token = h('input',{type:'text',readOnly:true,'aria-label':'Pairing token',placeholder:'Generated token appears here'});
  const pairStatus = h('div',{role:'status'});
  const sourceCards = state.sources.map(source => {
    const changed = structuredClone(source);
    changed.permissions.proactive ??= changed.permissions.live;
    const permission = (key:'collect'|'live'|'proactive'|'retain'|'content'|'learn', label:string) => field(label,h('input',{type:'checkbox',role:'switch','aria-label':`${source.name}: ${label}`,checked:changed.permissions[key],onchange:(e:Event)=>{changed.permissions[key]=(e.target as HTMLInputElement).checked;}}));
    const sites = h('textarea',{'aria-label':'Chrome allowed sites',value:state.drafts[source.id]?.sites ?? source.sites.join('\n'),oninput:(e:Event)=>saveDraft(source.id,{sites:(e.target as HTMLTextAreaElement).value}),rows:3,placeholder:'https://github.com\nhttps://developer.chrome.com'});
    const name = h('input',{type:'text','aria-label':`${source.name}: Display name`,value:state.drafts[source.id]?.name ?? source.name,maxLength:100,oninput:(e:Event)=>saveDraft(source.id,{name:(e.target as HTMLInputElement).value})});
    const days = h('input',{type:'number','aria-label':`${source.name}: Retention days`,value:state.drafts[source.id]?.retentionDays ?? source.retentionDays,min:1,max:30,oninput:(e:Event)=>saveDraft(source.id,{retentionDays:(e.target as HTMLInputElement).value})});
    const health = state.health[source.id];
    return group(source.name,
      h('p',{},`${health?.state ?? 'waiting'}: ${health?.detail ?? ''}`),
      health?.lastSync ? note('Last accepted sync: '+new Date(health.lastSync).toLocaleString()) : null,
      health?.lastFailure ? note('Last failure: '+new Date(health.lastFailure).toLocaleString()) : null,
      source.folder ? note('Selected folder: '+source.folder) : null,
      field('Display name',name),permission('collect','Collect observations'),permission('live','Use in live dialogue'),permission('proactive','Use in proactive remarks'),permission('retain','Retain source history locally'),permission('content','Allow bounded content access'),
      (['calendar','lastfm','owntracks','academic'].includes(source.id)||/^(gmail|outlook|teams)-[01]$/.test(source.id)) ? permission('learn','Learn summarized observations in Honcho') : null,
      source.kind==='chrome' ? field('Allowed site origins, one per line',sites,'Chrome must also grant each site. Sensitive pages remain blocked.',true) : null,
      field('Retention days',days,'1 to 30 days; current state still expires sooner.'),
      h('div',{class:'row'},
        btn('Save source controls',()=>run(async()=>{changed.name=name.value.trim();changed.retentionDays=Number(days.value);if(source.kind==='chrome')changed.sites=sites.value.split(/\s+/).filter(Boolean);await api.invoke('life:configure',changed); })),
        btn(source.paused?'Resume':'Pause',()=>run(()=>api.invoke('life:configure',{...source,paused:!source.paused})), 'quiet'),
        btn('Disconnect and forget',()=>run(()=>api.invoke('life:forget',{id:source.id})), 'quiet'),
        source.kind==='project'?btn('Remove folder',()=>run(()=>api.invoke('life:forget',{id:source.id,remove:true})), 'quiet'):null));
  });
  const integration = structuredClone(stage.config);
  const secretField = (key:'googleClient'|'googleClientSecret'|'lastfmKey',label:string) => {
    const input=h('input',{type:'password','aria-label':label,autocomplete:'off',placeholder:stage.credentials[key]?'Saved securely; enter only to replace':'Not configured'});
    return field(label,h('div',{},input,btn('Save '+label,()=>run(()=>api.invoke('life:stage2Key',{key,value:input.value})), 'quiet')),undefined,true);
  };
  const user=h('input',{type:'text','aria-label':'Last.fm username',value:integration.lastfmUser});
  const device=h('input',{type:'text','aria-label':'OwnTracks device name',value:integration.device,placeholder:'Your chosen OwnTracks device name'});
  const locationKey=h('input',{type:'text',readOnly:true,'aria-label':'OwnTracks generated credential'});
  const credentialNotice=h('p',{class:'hint',role:'status'});
  const places=h('div',{'aria-label':'Named places'});
  const renderPlaces=()=>{
    places.replaceChildren(...integration.places.map(place=>{
      const text=(key:'name'|'lat'|'lon'|'radius',label:string)=>field(label,h('input',{type:key==='name'?'text':'number','aria-label':place.id+': '+label,value:place[key],step:key==='lat'||key==='lon'?'any':1,oninput:(e:Event)=>{const v=(e.target as HTMLInputElement).value;if(key==='name')place.name=v;else place[key]=Number(v);}}));
      return group(place.name||'New place',text('name','Place name'),text('lat','Latitude'),text('lon','Longitude'),text('radius','Radius in metres'),
        ...state.entities.map(entity=>field('Associate '+entity.name,h('input',{type:'checkbox',checked:place.entities.includes(entity.id),onchange:(e:Event)=>{place.entities=place.entities.filter(id=>id!==entity.id);if((e.target as HTMLInputElement).checked)place.entities.push(entity.id);}}))),
        btn('Remove '+(place.name||'place'),()=>{integration.places=integration.places.filter(p=>p.id!==place.id);renderPlaces();},'quiet'));
    }));
  };renderPlaces();
  const calendarChoices=stage.calendars.map(c=>field(c.name,h('input',{type:'checkbox','aria-label':'Monitor calendar '+c.name,checked:integration.calendars.includes(c.id),onchange:(e:Event)=>{integration.calendars=integration.calendars.filter(id=>id!==c.id);if((e.target as HTMLInputElement).checked)integration.calendars.push(c.id);}})));
  const integrations=group('Calendar, listening history and phone location',
    note('Setup alone does not enable collection. Save integration setup, then enable the corresponding source controls below. Learn requires retention, global automatic learning, and local Honcho. Pausing or changing a source clears its learned reading.'),
    secretField('googleClient','Google Desktop client ID'),secretField('googleClientSecret','Google Desktop client secret'),
    note(stage.credentials.googleRefresh?'Google refresh credential stored. Account access is verified only by successful sync.':'Google not authorized.'),
    btn('Authorize Google',()=>run(()=>api.invoke('life:googleAuth')),'quiet'),btn('Load calendars',()=>run(()=>api.invoke('life:calendars')),'quiet'),
    ...calendarChoices,note('Selected calendar IDs: '+(integration.calendars.join(', ')||'none')),
    btn('Sync Calendar now',()=>run(()=>api.invoke('life:sync','calendar')),'quiet'),
    secretField('lastfmKey','Last.fm API key'),field('Last.fm username',user),note(stage.spotifyScrobbling),
    btn('Sync Last.fm now',()=>run(()=>api.invoke('life:sync','lastfm')),'quiet'),
    note('OwnTracks: '+stage.receiver),field('OwnTracks device name',device),
    btn('Generate OwnTracks credential',async()=>{try{const result=await api.invoke('life:locationKey');locationKey.value=result.username+':'+result.password;credentialNotice.textContent='Copy username and password now. '+(result.persistent?'Stored using OS encryption.':'Session only: OS encryption unavailable.');}catch(e){toast(String(e),true);}},'quiet'),field('Generated username:password',locationKey),credentialNotice,
    places,btn('Add named place',()=>{if(integration.places.length>=30){toast('At most 30 named places.',true);return;}integration.places.push({id:'place-'+Date.now(),name:'',lat:0,lon:0,radius:150,entities:[]});renderPlaces();},'quiet'),note('Coordinates stay local. Use a radius from 50 to 5000 metres. Save integration setup to apply additions or removals.'),
    btn('Save integration setup',()=>run(async()=>{integration.lastfmUser=user.value.trim();integration.device=device.value.trim();await api.invoke('life:stage2Setup',integration);})),
    note('Phone receiver: 127.0.0.1:43130/pub. Use private Tailscale Serve HTTPS. Never Funnel. Read resources/integrations/SETUP.md for exact account and phone setup. A listening receiver does not prove phone connectivity.'),
    ...stage.recentTracks.map(t=>note(new Date(t.at).toLocaleString()+' | '+t.artist+': '+t.title)),
    ...Object.entries(stage.learning).map(([id,status])=>note(id+' learning: '+status.state+'. '+status.detail)),
    ...state.events.filter(e=>e.source==='lastfm'&&e.type==='music-now-playing').slice(0,1).map(e=>note(e.summary)));

  const accountCards=[...comm.config.accounts].sort((a,b)=>Number(a.id.startsWith('gmail'))-Number(b.id.startsWith('gmail'))).map(original=>{
    const account=structuredClone(original),parts:Child[]=[];
    const input=(key:'clientId'|'tenant',label:string)=>field(label,h('input',{type:'text','aria-label':account.id+': '+label,value:account[key],oninput:(e:Event)=>{account[key]=(e.target as HTMLInputElement).value.trim();}}),undefined,true);
    const lines=(key:'labels'|'folders'|'senders'|'excludedSenders'|'excludedWords'|'selectedMessages'|'chats'|'excludedRecords',label:string,help?:string)=>field(label,h('textarea',{rows:2,'aria-label':account.id+': '+label,value:account[key].join('\n'),oninput:(e:Event)=>{account[key]=(e.target as HTMLTextAreaElement).value.split('\n').map(s=>s.trim()).filter(Boolean);}}),help,true);
    parts.push(note(comm.authorization[account.id]??''),note(comm.authorized[account.id]?'Refresh credential stored. API/tenant access is verified only by a successful sync.':'Not authorized. This source can stay disconnected.'),input('clientId','Desktop application client ID'));
    if(!account.id.startsWith('gmail'))parts.push(input('tenant','Microsoft tenant'));
    else parts.push(note('Blank client ID reuses the Google Desktop client configured above. Gmail and Calendar keep separate refresh credentials. The shared Google Desktop client secret above is used if supplied.'));
    parts.push(btn('Authorize '+account.id,()=>run(()=>api.invoke('life:accountAuth',account.id)),'quiet'),btn('Load choices for '+account.id,()=>run(()=>api.invoke('life:accountChoices',account.id)),'quiet'));
    for(const choice of comm.choices[account.id]??[]){const key=account.id.startsWith('gmail')?'labels':account.id.startsWith('teams')?'chats':'folders';parts.push(field(choice.name,h('input',{type:'checkbox',checked:account[key].includes(choice.id),onchange:(e:Event)=>{account[key]=account[key].filter(id=>id!==choice.id);if((e.target as HTMLInputElement).checked)account[key].push(choice.id);}})));}
    if(account.id.startsWith('gmail'))parts.push(lines('labels','Selected Gmail label IDs','Use a small selected label. No arbitrary Gmail search is used with metadata-only access.'));
    else if(account.id.startsWith('outlook'))parts.push(lines('folders','Selected Outlook folder IDs','Remove inbox if you want only a narrower folder. Load choices after authorization.'));
    else{
      parts.push(lines('chats','Selected Teams chat IDs'));
      parts.push(field('Selected Teams channels',h('textarea',{rows:2,'aria-label':account.id+': Teams channels',value:account.channels.map(c=>c.team+' | '+c.channel).join('\n'),oninput:(e:Event)=>{account.channels=(e.target as HTMLTextAreaElement).value.split('\n').filter(s=>s.trim()).map(line=>{const [team,channel]=line.split('|').map(s=>s.trim());return{team,channel:channel??''};});}}),'One team ID | channel ID per line. Adding channels requires explicit Graph channel consent.',true));
    }
    parts.push(lines('senders','Only these senders','Optional sender/address text matches; empty allows all in the selected containers.'),lines('excludedSenders','Excluded senders'),lines('excludedWords','Excluded subject or content phrases'));
    if(!account.id.startsWith('teams'))parts.push(lines('selectedMessages','Selected message IDs for body access','Optional. Bodies are read only for these IDs, with source content permission and explicit read-body authorization. Metadata remains the default.'));
    parts.push(lines('excludedRecords','Excluded record IDs','Exclude a record from Current understanding to populate this list. Remove an ID and save to permit it again.'));
    parts.push(btn('Save '+account.id+' setup',()=>run(()=>api.invoke('life:stage3Setup',{...comm.config,accounts:comm.config.accounts.map(a=>a.id===account.id?account:a)}))),btn('Sync '+account.id,()=>run(()=>api.invoke('life:accountSync',account.id)),'quiet'));
    return h('details',{class:'group'},h('summary',{},account.id+' account setup'),...parts);
  });
  const social=structuredClone(comm.config),socialLines=(key:'discordChannels'|'gameProcesses'|'discordExcludedAuthors',label:string)=>field(label,h('textarea',{rows:2,'aria-label':label,value:social[key].join('\n'),oninput:(e:Event)=>{social[key]=(e.target as HTMLTextAreaElement).value.split('\n').map(s=>s.trim()).filter(Boolean);}}),undefined,true);
  const socialText=(key:'voiceGuild'|'voiceUser',label:string)=>field(label,h('input',{type:'text','aria-label':label,value:social[key],oninput:(e:Event)=>{social[key]=(e.target as HTMLInputElement).value.trim();}}),undefined,true);
  const botKey=h('input',{type:'password',autocomplete:'off','aria-label':'Discord bot token',placeholder:comm.authorized['discord-bot']?'Saved securely':'Not configured'});
  const academicCourse=h('input',{type:'text','aria-label':'Academic course'}),academicAssignment=h('input',{type:'text','aria-label':'Academic assignment'}),academicEvidence=h('textarea',{rows:2,'aria-label':'Academic evidence note'}),academicDue=h('input',{type:'text','aria-label':'Academic due time',placeholder:'Optional ISO time with timezone offset'});
  const academicStatus=h('select',{'aria-label':'Academic status'},...['assigned','due','submitted','graded','feedback','cancelled'].map(value=>h('option',{value},value)));
  const stage3Controls=group('Communication and academic connections',note('No account setup is needed for ordinary chat or movement. Metadata stays local until you enable live dialogue or proactive remarks. Each source has independent controls below. No sending or modification is implemented.'),...accountCards,
    h('details',{class:'group'},h('summary',{},'Discord local and authorized bot setup'),note(comm.capabilities.discordVoice),note(comm.capabilities.discordMessages),socialLines('gameProcesses','Known game process names'),socialLines('discordChannels','Authorized Discord channel IDs'),socialLines('discordExcludedAuthors','Excluded Discord author IDs'),socialText('voiceGuild','Optional voice guild ID'),socialText('voiceUser','Optional voice user ID'),field('Bot token',botKey),btn('Save Discord bot token',()=>run(()=>api.invoke('life:botKey',botKey.value)),'quiet'),btn('Save Discord setup',()=>run(()=>api.invoke('life:stage3Setup',social))),note('Local process/foreground awareness does not authorize account messages or calls. Enable Discord local activity separately.')),
    h('details',{class:'group'},h('summary',{},'Gradescope alternatives and academic records'),note(comm.capabilities.gradescope),note('Enable Academic imports collection below first. These are explicitly supplied records, not Gradescope API verification. Submission, grading and completion are distinct.'),field('Course',academicCourse),field('Assignment',academicAssignment),field('Status',academicStatus),field('Due time',academicDue),field('Evidence note',academicEvidence,undefined,true),btn('Add academic record',()=>run(()=>api.invoke('life:academic',[{id:academicCourse.value+':'+academicAssignment.value,course:academicCourse.value,assignment:academicAssignment.value,status:academicStatus.value as 'assigned',at:new Date().toISOString(),...(academicDue.value?{due:academicDue.value}:{}),evidence:academicEvidence.value,entities:[]}]))),btn('Import academic JSON file',()=>run(()=>api.invoke('life:academicFile')),'quiet')),
    note('See resources/integrations/FINAL_SETUP.md for one consolidated Windows/iPhone guide. Discord messages and local activity have no automatic Honcho learning. Communication/academic opt-in learning exports aggregate counts and explicit project associations, never private messages or grades.'));
  const entities = state.entities.map(entity=>{
    const aliases=h('textarea',{rows:2,value:state.drafts[entity.id]?.aliases ?? entity.aliases.join('\n'),oninput:(e:Event)=>saveDraft(entity.id,{aliases:(e.target as HTMLTextAreaElement).value}),'aria-label':`${entity.name}: Aliases`});
    return h('div',{class:'item',style:'display:block'},h('strong',{},entity.name),note(`${entity.id} | ${entity.certainty} | ${entity.evidence}`),field('Explicit aliases, one per line',aliases,'Use a repository URL, folder path, or distinctive project name.',true),btn('Save explicit aliases',()=>run(()=>api.invoke('life:associate',{...entity,aliases:aliases.value.split('\n').map(a=>a.trim()).filter(Boolean),certainty:'explicit',evidence:'User edited explicit aliases in Connections'})),'quiet'),btn('Forget association',()=>run(()=>api.invoke('life:forgetEntity',entity.id)),'quiet'));
  });
  const associationName=h('input',{type:'text','aria-label':'New association name'}),associationAliases=h('textarea',{rows:2,'aria-label':'New association aliases'}),associationKind=h('select',{'aria-label':'New association type'},...['project','person','course','commitment'].map(value=>h('option',{value},value)));
  const addAssociation=group('Add an explicit association',field('Name',associationName),field('Type',associationKind),field('Distinctive aliases',associationAliases,'One person address, project name or course identifier per line.',true),btn('Add explicit association',()=>run(()=>api.invoke('life:associate',{id:associationKind.value+':'+crypto.randomUUID(),name:associationName.value,aliases:associationAliases.value.split('\n').map(v=>v.trim()).filter(Boolean),evidence:'Explicitly configured in Connections',certainty:'explicit'}))));
  const currentRecords=[...new Map([...state.current,...state.proactiveCurrent].map(e=>[e.source+':'+e.recordId,e])).values()];
  const current = currentRecords.map(event=>{
    const correction=h('input',{type:'text',value:event.summary,maxLength:1200,'aria-label':`Correct ${event.recordId}`});
    return h('div',{class:'item',style:'display:block'},h('strong',{},event.summary),note(`${event.source} | ${event.quality} | ${new Date(event.occurredAt).toLocaleString()} | expires ${new Date(event.expiresAt).toLocaleTimeString()}`),note(event.detail),field('Your correction',correction,undefined,true),btn('Apply correction',()=>run(()=>api.invoke('life:correct',{source:event.source,recordId:event.recordId,summary:correction.value})),'quiet'),comm.config.accounts.some(a=>a.id===event.source)||['academic','discord-bot'].includes(event.source)?btn('Exclude this record',()=>run(()=>api.invoke('life:exclude',{source:event.source,recordId:event.recordId})),'quiet'):null);
  });
  view.replaceChildren(viewHead('Connections / Life Context'), h('div',{class:'scroll'},draftSave,
    group('Private by choice',note('Sources add evidence to Capri’s existing context and attention. Displayed pages do not prove reading; file changes do not prove success. Enable Memory and local desktop context to use connected evidence.'),note(state.learning),note('All account services are optional. New communication/academic/Discord sources start disconnected. Direct Gradescope access and general Discord client calls are unsupported; see supported alternatives below.'),btn('Refresh diagnostics',()=>go('connections'),'quiet')),
    group('Chrome extension',note(`Bridge: ${state.bridge.state}. Local port ${state.bridge.port}.`),field('Chrome extension ID',idInput,undefined,true),btn('Generate new pairing token',async()=>{try{const result=await api.invoke('life:pair',idInput.value.trim());token.value=result.token;pairStatus.textContent=result.persistent?'Copy this token into the extension popup. Rotating invalidates the old token.':'OS credential encryption is unavailable. Pairing lasts only for this session.';}catch(e){toast(String(e),true);}}),field('Pairing token',token,undefined,true),pairStatus,note('Load the supplied extensions/chrome folder using Chrome’s Load unpacked button. Add the same exact site origins here and in the extension popup. Content access permits bounded local document snapshots. In the extension popup, choose metadata, enable passive reading for an approved site, or request deeper reading once. Only relevant sections enter context.')),
    integrations,stage3Controls,
    ...sourceCards,
    group('Local projects',note('Select a specific project folder. Default collection uses filenames and Git metadata. Content access is a separate permission. Changes to source controls invalidate its old contextual records.'),btn('Add project folder',()=>run(()=>api.invoke('life:addProject')))),
    group('Project identities and associations',...(entities.length?entities:[emptyLine('Select a project folder to create an explicit project identity.')])),
    addAssociation,
    group('Current understanding',...(current.length?current:[emptyLine('No fresh authorized evidence.')])),
    group('Recent accepted events',...state.events.slice(0,15).map(e=>h('div',{class:'item',style:'display:block'},h('span',{},e.summary),note(`${e.source} / ${e.recordId} revision ${e.revision}; ${e.operation}; ${new Date(e.receivedAt).toLocaleString()}`)))),
    group('Attention opportunities',...state.candidates.slice(-12).reverse().map(c=>h('div',{class:'item',style:'display:block'},h('span',{},`${c.source}: ${c.status}`),note(c.reason),['pending','deferred'].includes(c.status)?btn('Dismiss opportunity',()=>run(()=>api.invoke('life:candidate',{id:c.id})),'quiet'):null)),emptyLine('Silence is valid. Opportunities expire; repeated evidence does not earn repeated callbacks.')),
    group('Clear Life Context',note('Disconnects sources and clears this subsystem’s evidence and associations. Existing approved memories and saved Chat remain. Source-derived Chat is excluded from automatic recall and learning.'),btn('Disconnect all and clear Life Context',()=>run(()=>api.invoke('life:clear')),'quiet'))));
}

const RENDER: Record<string, () => unknown> = {
  attention: renderAttention, settings: renderSettings, chat: renderChat, model: renderModel, voice: renderVoice, character: renderCharacter, memory: renderMemory, connections: renderConnections, privacy: renderPrivacy, system: renderSystem, developer: renderDeveloper, welcome: renderWelcome,
};

const DEV_SEARCH: SearchItem[] = [
  ...['Current direction','What she is attending to','Why she may be quiet','Body and continuity','Request allowance','Latest contextual outcome'].map(label => ({ page: 'developer', label, detail: 'Live overview', section: 'Overview', terms: 'attention blockers decision diagnostics reason movement connection budget' })),
  ...['Current interests','Observed evidence','Visual readings','Shared conversation','Remembered experiences and wants','Character tastes','Ongoing projects'].map(label => ({ page: 'developer', label, detail: 'Mind & memory', section: 'Mind & memory', terms: 'cognition memory evidence context history' })),
  { page: 'developer', label: 'Recent decisions', detail: 'Results · event and decision history', section: 'Results', terms: 'history timeline why reason blocked failed action journal' },
  { page: 'developer', label: 'Live contextual checks', detail: 'Live checks · uses real context and model usage', section: 'Live checks', terms: 'screenshot inspection model window drop return' },
  ...([
    ['Sprite strip', 'Animation preview', DEV_ANIMATIONS], ['Activity', 'Activity preview', DEV_ACTIVITIES], ['Interaction', 'Interaction preview', DEV_INTERACTIONS],
    ['Scenario', 'Behavior scenario', DEV_SCENARIOS], ['Dialogue', 'Dialogue event', DEV_DIALOGUE], ['Reaction', 'Reaction preview', DEV_REACTIONS],
    ['Secondary artwork', 'Secondary pose', SECONDARY_POSES], ['Mood', 'Mood preview', MOODS], ['Life event', 'Life event preview', LIFE_EVENTS], ['Phase', 'Phase preview', DEV_PHASES],
  ] as const).flatMap(([kind, control, names]) => names.map(name => ({ page: 'developer', label: name.replaceAll('_', ' '), detail: `Playground · ${kind}`, terms: name, control, value: name }))),
  ...[...FLOURISHES, ...SCENES].map(name => ({ page: 'developer', label: name.replaceAll('_', ' '), detail: 'Playground · construct moment', terms: name })),
  ...['Run local checks','Replay opening','Simulate idle','Simulate sleep','Return now','Stop preview'].map(label => ({ page: 'developer', label, detail: 'Playground · testing controls', terms: label })),
];
const settingsItems = [...SETTINGS_SEARCH, ...TOOL_NAMES.map(name => ({ page: 'privacy', label: TOOL_INFO[name], detail: 'Access & privacy · action permission', terms: name.replaceAll('_', ' ') }))];
const popularSettings = ['More capable Capri','Quiet hours','Volume','Conversation activity','Microphone','Search folders'];
settingsItems.sort((a,b) => { const rank = (item: SearchItem) => { const index = popularSettings.indexOf(item.label); return index < 0 ? 100 : index; }; return rank(a)-rank(b); });
const search = searchBox(developerOnly ? DEV_SEARCH : settingsItems, developerOnly ? 'Search diagnostics & tests' : 'Search settings', item => {
  if (developerOnly) { revealDeveloperSearch?.(item); return; }
  searchTarget = item; go(item.page);
});
document.querySelector('.titlebar .spacer')!.before(search);
if (developerOnly) document.getElementById('wordmark')!.textContent = 'CAPRI / DEV';
document.addEventListener('keydown', e => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); search.querySelector('input')!.focus(); } });

// ---------------------------------------------------------------- boot
document.getElementById('closeBtn')!.append(icon('close'));
// startup.ts owns the native close button, including when the bridge is unavailable.
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if(e.defaultPrevented)return;
  e.preventDefault();
  if (phase === 'thinking' || phase === 'speaking') void api.invoke('chat:stop');
  void flushSettings().then(()=>api.invoke('panel:close'));
});
async function startPanel() {
  const deadline = <T>(promise: Promise<T>) => new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Settings connection timed out.')), 4000);
    promise.then(resolve, reject).finally(() => clearTimeout(timer));
  });
  try {
    S = await deadline(api.invoke('settings:get'));
    const [state, connection] = await Promise.allSettled([deadline(api.invoke('chat:state')), deadline(api.invoke('connection:get'))]);
    if (state.status === 'fulfilled') phase = state.value.phase;
    if (connection.status === 'fulfilled') conn = connection.value;
    renderConn(); renderPhase();
    if (!developerOnly && !S.firstRunComplete && tab !== 'welcome') tab = 'welcome';
    booted = true; go(tab);
    window.dispatchEvent(new Event('capri:panel-ready'));
    await api.invoke('panel:ready');
  } catch {
    window.dispatchEvent(new Event('error'));
  }
}
void startPanel();
