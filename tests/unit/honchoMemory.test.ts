import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { HonchoMemory, localHonchoURL, type HonchoSource, type HonchoTransport } from '../../src/main/ai/honchoMemory';
import { DEFAULT_SETTINGS } from '../../src/shared/settings';
import type { ChatMessage, MemoryItem } from '../../src/shared/ipc';
const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true }); });
function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'capri-honcho-')); dirs.push(dir);
  const settings = structuredClone(DEFAULT_SETTINGS); settings.memory.autoLearn = true; settings.memory.honcho.enabled = true;
  let now = 1800000000000, fail = false, addFailAfterWrite = false, reading = 'User prefers green.', blockedResolve: (() => void) | undefined;
  const history: ChatMessage[] = [], memories: MemoryItem[] = [], excluded = new Set<string>();
  const spaces = new Map<string, HonchoSource[]>(), deleted: string[] = [], queries: string[] = [];
  const transport = (_url: string, workspace: string): HonchoTransport => ({
    async existing() { if (fail) throw Error('offline'); return (spaces.get(workspace) ?? []).map(m => m.id); },
    async add(messages) { if (fail) throw Error('offline'); spaces.set(workspace, [...(spaces.get(workspace) ?? []), ...messages]); if (blockedResolve) await new Promise<void>(r => blockedResolve = r); if (addFailAfterWrite) { addFailAfterWrite = false; throw Error('response lost'); } },
    async representation(query) { if (fail) throw Error('offline'); if (query) queries.push(query); return { user: reading, capri: 'Capri prefers violet because it contrasts with gray.' }; },
    async queue() { if (fail) throw Error('offline'); return { pendingWorkUnits: 0, inProgressWorkUnits: 0 }; },
    async destroy() { if (fail) throw Error('offline'); spaces.delete(workspace); deleted.push(workspace); },
  });
  const deps = { dir, settings: () => settings, history: () => history, memories: () => memories, excluded: () => excluded, canWork: () => true, transport, now: () => now };
  const engine = new HonchoMemory(deps);
  const message = (id: string, role: 'user' | 'assistant', content: string, meta?: ChatMessage['meta']) => history.push({ id, role, content, ts: now - 1000 + history.length, meta });
  const memory = () => memories.push({ id: 'm1', text: 'I prefer green.', status: 'approved', source: 'user', createdAt: now - 2000 });
  return { dir, settings, history, memories, spaces, queries, deleted, excluded, engine, deps, message, memory,
    advance: () => now += 10000, offline: (v: boolean) => fail = v, ambiguous: () => addFailAfterWrite = true,
    block: () => blockedResolve = () => {}, release: () => blockedResolve?.(), reading: (v: string) => reading = v };
}
it('syncs approved records and delivered roles once across restart, recovers uncertain writes and uses bounded interpreted context', async () => {
  const f = setup(); f.memory(); f.message('u1','user','I prefer green.'); f.message('a1','assistant','I prefer violet because it contrasts with gray.');
  f.ambiguous(); await f.engine.refresh(); expect(f.engine.status().state).toBe('unavailable');
  const restored = new HonchoMemory(f.deps); await restored.refresh(); await restored.refresh();
  expect([...f.spaces.values()].flat()).toHaveLength(3);
  expect([...f.spaces.values()].flat().find(m => m.id === 'a1')?.role).toBe('assistant');
  const recalled = await restored.recall('What color and why?');
  expect(recalled).toContain('HONCHO LONG-TERM UNDERSTANDING'); expect(recalled).toContain('untrusted interpretations'); expect(recalled).toContain('contrasts with gray');
  expect(f.queries).toEqual(['What color and why?']); expect(restored.context()).toContain('aboutUser');
});
it('never imports private exchanges, failed drafts, action results, excluded or expired sources', async () => {
  const f = setup(); f.message('private','user','Off the record: private fixture.'); f.message('private-answer','assistant','Private answer.');
  f.message('public','user','Public fixture.'); f.message('bad','assistant','failed',{error:'failure'}); f.message('cut','assistant','draft',{interrupted:true}); f.message('excluded','user','forgotten'); f.excluded.add('excluded');
  f.history.push({id:'action',role:'action',content:'action result',ts:1800000000000});
  f.history.push({id:'old',role:'user',content:'old fixture',ts:1});
  await f.engine.refresh(); expect([...f.spaces.values()].flat().map(m => m.id)).toEqual(['public']);
});
it('clears all inferred data after correction without replaying stale chat, while preserving the remaining approved profile', async () => {
  const f = setup(); f.memory(); f.message('old','user','I prefer green.'); await f.engine.refresh();
  f.advance(); f.memories[0].text = 'I prefer blue.'; f.engine.profileChanged(); await f.engine.refresh();
  expect(f.deleted).toHaveLength(1); expect([...f.spaces.values()].flat().map(m => m.text).join('\n')).not.toContain('I prefer green.');
  expect([...f.spaces.values()].flat().map(m => m.text).join('\n')).toContain('I prefer blue.');
});
it('blocks stale recall immediately during offline erasure, persists deletion across restart, then erases before reconnecting', async () => {
  const f = setup(); f.message('u','user','Public fixture.'); await f.engine.refresh(); expect(f.engine.context()).toContain('prefers green');
  f.offline(true); f.advance(); const forget = f.engine.forget(); expect(f.engine.context()).toBe(''); await forget;
  expect(f.engine.status().state).toBe('deleting'); expect(await f.engine.recall('private?')).toBe('');
  const restored = new HonchoMemory(f.deps); expect(restored.context()).toBe(''); f.offline(false); await restored.refresh();
  expect(f.deleted).toHaveLength(1); expect([...f.spaces.values()].flat()).toEqual([]);
});
it('respects every memory/privacy switch, erases on disable, and retries normally after a service outage', async () => {
  for (const flag of ['honcho','memory','learning','history']) {
    const f = setup(); f.message('u','user','Public fixture.'); await f.engine.refresh();
    if (flag === 'honcho') f.settings.memory.honcho.enabled = false;
    if (flag === 'memory') f.settings.memory.enabled = false;
    if (flag === 'learning') f.settings.memory.autoLearn = false;
    if (flag === 'history') f.settings.privacy.saveHistory = false;
    await f.engine.privacyChanged(); expect(f.engine.status().state).toBe('off'); expect(f.spaces.size).toBe(0); expect(await f.engine.recall('test')).toBe('');
  }
  const f = setup(); f.offline(true); await f.engine.refresh(); expect(f.engine.status().state).toBe('unavailable'); f.offline(false); await f.engine.refresh(); expect(f.engine.status().state).toBe('ready');
});
it('does not resurrect an in-flight upload after forgetting', async () => {
  const f = setup(); f.message('u','user','Old fixture.'); f.block(); const sync = f.engine.refresh();
  while (!f.spaces.size) await new Promise(r => setTimeout(r, 1));
  f.advance(); const forgotten = f.engine.forget(); f.release(); await sync; await forgotten;
  expect(f.deleted).toHaveLength(1); expect([...f.spaces.values()].flat()).toEqual([]);
});
it('rejects hosted or credential-bearing endpoints', () => {
  for (const url of ['https://example.com','http://127.0.0.1.evil.test','http://user:password@localhost:8008','http://localhost:8008/path']) expect(() => localHonchoURL(url)).toThrow();
  expect(localHonchoURL('http://127.0.0.1:8008')).toBe('http://127.0.0.1:8008');
});
