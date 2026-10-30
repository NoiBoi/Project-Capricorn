import { DEFAULT_SETTINGS, type Settings } from '../../src/shared/settings';
import type { ActionContext } from '../../src/main/actions/registry';
import { MemoryStore, NotesStore, ReminderStore } from '../../src/main/store/dataStores';
import { tmpDir } from './helpers';

/** Action context backed by real stores in a temp dir, with shell calls recorded instead of executed. */
export function makeCtx(over: Partial<Settings['actions']> = {}, dir = tmpDir()) {
  const s: Settings = structuredClone(DEFAULT_SETTINGS);
  Object.assign(s.actions, over);
  const opened: string[] = [];
  const launched: string[] = [];
  const ctx = {
    settings: () => s,
    opened, launched,
    async openExternal(u: string) { opened.push(u); },
    async openPath(p: string) { launched.push(p); return ''; },
    notes: new NotesStore(dir),
    reminders: new ReminderStore(dir),
    memory: new MemoryStore(dir),
    now: () => Date.now(),
  } satisfies ActionContext & { opened: string[]; launched: string[] };
  return { ctx, s };
}
