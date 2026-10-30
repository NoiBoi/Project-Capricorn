import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, deepMerge, normalizeSettings } from '../../src/shared/settings';
import { SettingsStore } from '../../src/main/store/settingsStore';
import { SecretStore } from '../../src/main/store/secrets';
import { HistoryStore, MemoryStore, NotesStore, ReminderStore } from '../../src/main/store/dataStores';
import { Logger, redact } from '../../src/main/log';
import { fakeCipher, tmpDir } from './helpers';

describe('profile read safety', () => {
  it.each(['settings.json', 'memory.json'])('does not treat an inaccessible %s as a fresh profile', name => {
    const dir = tmpDir(), file = path.join(dir, name);
    fs.writeFileSync(file, name === 'settings.json' ? JSON.stringify({voice:{volume:.37}}) : JSON.stringify([{id:'known',text:'The user prefers to be called Noi.',status:'approved'}]));
    const original = fs.readFileSync.bind(fs), before = original(file, 'utf8');
    const read = vi.spyOn(fs, 'readFileSync').mockImplementation(((target: any, ...args: any[]) => {
      if (String(target) === file) throw Object.assign(new Error('File is inaccessible'), {code:'EACCES'});
      return (original as any)(target, ...args);
    }) as any);
    try { expect(() => name === 'settings.json' ? new SettingsStore(dir) : new MemoryStore(dir)).toThrow(/Cannot read saved Capri data/); }
    finally { read.mockRestore(); }
    expect(original(file, 'utf8')).toBe(before);
  });
  it('loads Windows BOM-prefixed settings and memories without resetting or quarantining them', () => {
    const dir = tmpDir();
    fs.writeFileSync(path.join(dir,'settings.json'), '\uFEFF'+JSON.stringify({voice:{volume:.37}}));
    fs.writeFileSync(path.join(dir,'memory.json'), '\uFEFF'+JSON.stringify([{id:'known',text:'The user prefers to be called Noi.',status:'approved'}]));
    const s=new SettingsStore(dir);expect(s.get().voice.volume).toBe(.37);expect(s.repairedOnLoad).toEqual([]);
    expect(new MemoryStore(dir).approved()).toHaveLength(1);
    expect(fs.readdirSync(dir).some(name=>name.includes('.corrupt-'))).toBe(false);
  });
});

describe('history write economy and privacy', () => {
  it('does not rewrite valid unchanged history at launch; still repairs a torn tail', () => {
    const dir = tmpDir(), file = path.join(dir, 'history.jsonl');
    const line = JSON.stringify({ id: 'u', role: 'user', content: 'A saved exchange.', ts: Date.now() }) + '\n';
    fs.writeFileSync(file, line); const rename = vi.spyOn(fs, 'renameSync');
    try {
      expect(new HistoryStore(dir, () => 30, () => true).recent()).toHaveLength(1);
      expect(rename).not.toHaveBeenCalled();
      fs.appendFileSync(file, '{torn');
      expect(new HistoryStore(dir, () => 30, () => true).recent()).toHaveLength(1);
      expect(rename).toHaveBeenCalledTimes(1); expect(fs.readFileSync(file, 'utf8')).toBe(line);
    } finally { rename.mockRestore(); }
  });
  it('removes the saved file on privacy change without erasing the ongoing session', () => {
    const dir = tmpDir(); let enabled = true;
    const h = new HistoryStore(dir, () => 30, () => enabled);
    h.append({ id: 'u', role: 'user', content: 'Still in this session.', ts: Date.now() });
    enabled = false; h.privacyChanged(); h.privacyChanged();
    expect(fs.existsSync(path.join(dir, 'history.jsonl'))).toBe(false); expect(h.recent()).toHaveLength(1);
  });
});

describe('settings normalization', () => {
  it('fills defaults for empty / garbage input', () => {
    expect(normalizeSettings(undefined).settings).toEqual(DEFAULT_SETTINGS);
    expect(normalizeSettings('nope').settings).toEqual(DEFAULT_SETTINGS);
  });
  it('repairs only the invalid fields', () => {
    const { settings, repaired } = normalizeSettings({ character: { scale: 99, opacity: 0.5 }, ai: { provider: 'evil' } });
    expect(settings.character.scale).toBe(DEFAULT_SETTINGS.character.scale);
    expect(settings.character.opacity).toBe(0.5);
    expect(settings.ai.provider).toBe(DEFAULT_SETTINGS.ai.provider);
    expect(repaired).toEqual(expect.arrayContaining(['character.scale', 'ai.provider']));
  });
  it('rejects non-http base URLs and bad quiet-hour times', () => {
    const { settings } = normalizeSettings({ ai: { ollama: { baseUrl: 'file:///etc/passwd' } }, behavior: { quietHours: { start: '25:99' } } });
    expect(settings.ai.ollama.baseUrl).toBe(DEFAULT_SETTINGS.ai.ollama.baseUrl);
    expect(settings.behavior.quietHours.start).toBe('22:00');
  });
  it('adds policies for tools introduced in upgrades', () => {
    const { settings } = normalizeSettings({ actions: { policies: { open_url: 'deny' } } });
    expect(settings.actions.policies.open_url).toBe('deny');
    expect(settings.actions.policies.launch_app).toBe('confirm');
  });
  it('deepMerge ignores prototype pollution keys', () => {
    const merged = deepMerge({ a: 1 }, JSON.parse('{"__proto__":{"polluted":true},"b":2}'));
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(merged).toEqual({ a: 1, b: 2 });
  });
});

describe('SettingsStore persistence', () => {
  it('round trips every settings section and nested leaf through a disk reload',()=>{
    const dir=tmpDir(), s=new SettingsStore(dir), initial=structuredClone(DEFAULT_SETTINGS);
    const change=(value:unknown):unknown=>typeof value==='boolean'?!value:typeof value==='number'?value:typeof value==='string'?value:Array.isArray(value)?value:value&&typeof value==='object'?Object.fromEntries(Object.entries(value).map(([k,v])=>[k,change(v)])):value;
    const patch=change(initial) as typeof DEFAULT_SETTINGS;patch.dialogue.weatherCity='West Lafayette';patch.ai.codex={chatModel:'restart-chat',taskModel:'restart-task'};patch.ai.openai={baseUrl:'https://example.com/v1',model:'restart-model'};patch.voice.systemVoice='Restart fixture voice';patch.voice.volume=.42;patch.character.position={x:123,y:234,displayId:9};patch.actions.searchRoots=['C:\\project-fixture'];patch.actions.approvedApps=[{name:'Fixture',path:'C:\\fixture.exe'}];const result=s.update(patch);expect(result.repaired).toEqual([]);s.flush();
    const restarted=new SettingsStore(dir);expect(restarted.get()).toEqual(result.settings);expect(restarted.repairedOnLoad).toEqual([]);
    expect(Object.keys(restarted.get())).toEqual(Object.keys(DEFAULT_SETTINGS));
  });
  it('persists updates and reloads them', () => {
    const dir = tmpDir();
    const s = new SettingsStore(dir);
    s.update({ character: { scale: 1.5, position: { x: 10, y: 20, displayId: 1 } } });
    s.flush();
    const again = new SettingsStore(dir);
    expect(again.get().character.scale).toBe(1.5);
    expect(again.get().character.position).toEqual({ x: 10, y: 20, displayId: 1 });
  });
  it('recovers from a corrupt file and keeps it aside', () => {
    const dir = tmpDir();
    fs.writeFileSync(path.join(dir, 'settings.json'), '{not json');
    const s = new SettingsStore(dir);
    expect(s.get()).toEqual(DEFAULT_SETTINGS);
    expect(s.repairedOnLoad[0]).toMatch(/corrupt/);
    expect(fs.readdirSync(dir).some((f) => f.startsWith('settings.json.corrupt-'))).toBe(true);
  });
  it('emits change events', () => {
    const s = new SettingsStore(tmpDir());
    const spy = vi.fn();
    s.on('changed', spy);
    s.update({ behavior: { doNotDisturb: true } });
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ behavior: expect.objectContaining({ doNotDisturb: true }) }));
  });
});

describe('SecretStore', () => {
  it('encrypts at rest and round-trips', () => {
    const dir = tmpDir();
    const s = new SecretStore(dir, fakeCipher());
    s.set('openai', 'sk-test-1234567890');
    const raw = fs.readFileSync(path.join(dir, 'secrets.bin'), 'utf8');
    expect(raw).not.toContain('sk-test');
    expect(new SecretStore(dir, fakeCipher()).get('openai')).toBe('sk-test-1234567890');
  });
  it('never writes plaintext when OS encryption is unavailable', () => {
    const dir = tmpDir();
    const s = new SecretStore(dir, fakeCipher(false));
    s.set('anthropic', 'secret-value-123');
    expect(s.get('anthropic')).toBe('secret-value-123');
    expect(fs.existsSync(path.join(dir, 'secrets.bin'))).toBe(false);
  });
  it('rejects malformed keys and unknown names', () => {
    const s = new SecretStore(tmpDir(), fakeCipher());
    expect(() => s.set('openai', 'a\nb')).toThrow();
    expect(() => s.set('openai', '   ')).toThrow();
    expect(SecretStore.isKey('../../etc')).toBe(false);
  });
  it('sets aside an unreadable blob instead of crashing', () => {
    const dir = tmpDir();
    fs.writeFileSync(path.join(dir, 'secrets.bin'), 'garbage');
    const s = new SecretStore(dir, fakeCipher());
    expect(s.has('openai')).toBe(false);
    expect(fs.readdirSync(dir).some((f) => f.includes('unreadable'))).toBe(true);
  });
});

describe('HistoryStore', () => {
  const msg = (i: number, ts = Date.now()) => ({ id: `m${i}`, role: 'user' as const, content: `hello ${i}`, ts });
  it('persists and skips torn lines from a crash', () => {
    const dir = tmpDir();
    const h = new HistoryStore(dir, () => 0, () => true);
    h.append(msg(1)); h.append(msg(2));
    fs.appendFileSync(path.join(dir, 'history.jsonl'), '{"id":"m3","role":"us');
    const again = new HistoryStore(dir, () => 0, () => true);
    expect(again.recent(10).map((m) => m.id)).toEqual(['m1', 'm2']);
  });
  it('applies retention on load', () => {
    const dir = tmpDir();
    const h = new HistoryStore(dir, () => 0, () => true);
    h.append(msg(1, Date.now() - 10 * 86400_000)); h.append(msg(2));
    expect(new HistoryStore(dir, () => 5, () => true).recent(10).map((m) => m.id)).toEqual(['m2']);
  });
  it('does not write to disk when saving is disabled', () => {
    const dir = tmpDir();
    const h = new HistoryStore(dir, () => 0, () => false);
    h.append(msg(1));
    expect(h.recent(5)).toHaveLength(1);
    expect(fs.existsSync(path.join(dir, 'history.jsonl'))).toBe(false);
  });
});

describe('MemoryStore', () => {
  it('model suggestions are pending until approved; user entries approved', () => {
    const m = new MemoryStore(tmpDir());
    const a = m.add('Likes synthwave', 'model');
    const b = m.add('Name is Sam', 'user');
    expect(a.status).toBe('pending');
    expect(b.status).toBe('approved');
    expect(m.approved().map((x) => x.text)).toEqual(['Name is Sam']);
    m.approve(a.id);
    expect(m.approved()).toHaveLength(2);
  });
  it('dedupes, deletes, clears and persists', () => {
    const dir = tmpDir();
    const m = new MemoryStore(dir);
    const a = m.add('Prefers dark mode', 'user');
    expect(m.add('prefers DARK mode', 'user').id).toBe(a.id);
    m.add('Has a cat', 'user');
    m.delete(a.id);
    expect(new MemoryStore(dir).list().map((x) => x.text)).toEqual(['Has a cat']);
    m.clear();
    expect(new MemoryStore(dir).list()).toEqual([]);
  });
  it('enforces a size cap', () => {
    const m = new MemoryStore(tmpDir());
    for (let i = 0; i < MemoryStore.MAX; i++) m.add(`fact ${i}`, 'user');
    expect(() => m.add('one too many', 'user')).toThrow(/full/);
  });
});

describe('ReminderStore', () => {
  it('fires due reminders, persists state and survives restarts', () => {
    const dir = tmpDir();
    let now = 1_000_000;
    const r = new ReminderStore(dir, () => now);
    const fired = vi.fn();
    r.on('fired', fired);
    r.add('stretch', now + 5000, 'reminder');
    r.tick();
    expect(fired).not.toHaveBeenCalled();
    now += 6000;
    r.tick();
    expect(fired).toHaveBeenCalledWith(expect.objectContaining({ text: 'stretch' }));
    r.stop();
    const again = new ReminderStore(dir, () => now);
    expect(again.active()).toHaveLength(0);
  });
  it('fires reminders that came due while the app was closed', () => {
    const dir = tmpDir();
    let now = 1_000_000;
    const r = new ReminderStore(dir, () => now);
    r.add('missed', now + 1000, 'timer');
    r.stop();
    now += 60_000;
    const again = new ReminderStore(dir, () => now);
    const fired = vi.fn();
    again.on('fired', fired);
    again.tick();
    expect(fired).toHaveBeenCalledOnce();
    again.stop();
  });
  it('validates times and caps active items', () => {
    const r = new ReminderStore(tmpDir(), () => 1_000_000);
    expect(() => r.add('past', 1, 'reminder')).toThrow(/past/);
    expect(() => r.add('far', 1_000_000 + 400 * 86400_000, 'reminder')).toThrow(/far/);
    for (let i = 0; i < ReminderStore.MAX_ACTIVE; i++) r.add(`t${i}`, 2_000_000 + i, 'timer');
    expect(() => r.add('overflow', 3_000_000, 'timer')).toThrow(/Too many/);
    r.stop();
  });
  it('cancels by id or by text', () => {
    const r = new ReminderStore(tmpDir(), () => 1_000_000);
    const a = r.add('tea timer', 1_100_000, 'timer');
    r.add('call mom', 1_200_000, 'reminder');
    expect(r.cancel(a.id)?.text).toBe('tea timer');
    expect(r.cancel('mom')?.text).toBe('call mom');
    expect(r.cancel('nothing')).toBeNull();
    r.stop();
  });
});

describe('NotesStore', () => {
  it('adds, lists newest first, deletes', () => {
    const dir = tmpDir();
    const n = new NotesStore(dir);
    const a = n.add('A', 'first');
    n.add('B', 'second');
    expect(new NotesStore(dir).list()).toHaveLength(2);
    n.delete(a.id);
    expect(new NotesStore(dir).list().map((x) => x.title)).toEqual(['B']);
  });
});

describe('Logger', () => {
  it('redacts secrets, auth headers and message content', () => {
    const r = redact({ apiKey: 'abc', headers: { authorization: 'Bearer xyz' }, note: 'key sk-abcdefghijk123', content: 'my private message' }) as Record<string, unknown>;
    expect(JSON.stringify(r)).not.toMatch(/abc"|xyz|sk-abcdefghijk123|private message/);
    expect(r.content).toBe('[18 chars]');
  });
  it('rotates at the size cap and keeps a bounded number of files', () => {
    const dir = tmpDir();
    const log = new Logger(dir, 'debug', 2000, 2);
    for (let i = 0; i < 200; i++) log.info('line', { i, pad: 'x'.repeat(50) });
    const files = fs.readdirSync(dir).filter((f) => f.startsWith('capri.log'));
    expect(files.length).toBeLessThanOrEqual(3);
    for (const f of files) expect(fs.statSync(path.join(dir, f)).size).toBeLessThan(2500);
    expect(log.tail(5)).toHaveLength(5);
  });
  it('respects the level', () => {
    const dir = tmpDir();
    const log = new Logger(dir, 'warn');
    log.info('hidden'); log.warn('shown');
    expect(log.tail(10).join('\n')).not.toContain('hidden');
    expect(log.tail(10).join('\n')).toContain('shown');
  });
});


describe('profile import and correction', () => {
  it('imports a whole attributed profile once, preserves existing memories, and survives reload', () => {
    const dir = tmpDir(), store = new MemoryStore(dir);
    store.add('Prefers concise answers', 'user');
    const entries = [{ text: 'Name is Sam', kind: 'fact' as const }, { text: 'Profile describes Sam as reserved', kind: 'interpretation' as const }];
    expect(store.importProfile(entries, 'User profile', '2026-10-26')).toEqual({ added: 2, duplicates: 0 });
    expect(store.importProfile(entries, 'User profile', '2026-10-26')).toEqual({ added: 0, duplicates: 2 });
    const loaded = new MemoryStore(dir); expect(loaded.approved()).toHaveLength(3);
    expect(loaded.list()[2].context).toEqual({ label: 'User profile', kind: 'interpretation', asOf: '2026-10-26' });
  });
  it('rejects an invalid batch atomically and persists a correction with its original source', () => {
    const dir = tmpDir(), store = new MemoryStore(dir);
    expect(() => store.importProfile([{ text: 'Name is Sam', kind: 'fact' }, { text: '', kind: 'fact' }], 'User profile', '2026-10-26')).toThrow();
    expect(store.list()).toEqual([]);
    store.importProfile([{ text: 'Studies physics', kind: 'fact' }], 'User profile', '2026-10-26');
    const id = store.list()[0].id; store.update(id, 'Studies mechanical engineering');
    const loaded = new MemoryStore(dir).list()[0];
    expect(loaded.text).toBe('Studies mechanical engineering'); expect(loaded.updatedAt).toBeTypeOf('number'); expect(loaded.context?.label).toBe('User profile');
    expect(() => store.update(id, '')).toThrow(); expect(() => store.update('missing', 'Anything')).toThrow();
  });
});


describe('memory refresh after external import', () => {
  it('uses a restored profile in both the panel and conversation without a restart', () => {
    const dir = tmpDir(), store = new MemoryStore(dir);
    store.add('Original memory', 'user');
    const restored = [...store.list(), { id: 'restored', text: 'Name is Sam, attending Purdue', createdAt: 1, status: 'approved', source: 'user', context: { label: 'Profile import', kind: 'fact', asOf: '2026-10-26' } }];
    fs.writeFileSync(path.join(dir, 'memory.json'), JSON.stringify(restored));
    expect(store.list()).toHaveLength(2); expect(store.approved().at(-1)?.text).toContain('Purdue');
    fs.writeFileSync(path.join(dir, 'memory.json'), '{partial');
    expect(store.approved()).toHaveLength(2);
  });
});
