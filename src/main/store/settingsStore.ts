import path from 'node:path';
import { EventEmitter } from 'node:events';
import { DEFAULT_SETTINGS, deepMerge, normalizeSettings, type Settings } from '../../shared/settings';
import { DebouncedWriter, readJson } from './jsonFile';
import { CAPABILITY_BOOST, valueAt, putAt } from '../../shared/capabilityBoost';

export class SettingsStore extends EventEmitter {
  private current: Settings;
  readonly repairedOnLoad: string[];
  private writer: DebouncedWriter;
  readonly file: string;

  constructor(dir: string) {
    super();
    this.file = path.join(dir, 'settings.json');
    const { value, corrupt } = readJson<unknown>(this.file, {});
    const { settings, repaired } = normalizeSettings(value);
    this.current = settings;
    this.repairedOnLoad = corrupt ? ['(file was corrupt; defaults restored)', ...repaired] : repaired;
    this.writer = new DebouncedWriter(this.file, 250);
    if (corrupt || repaired.length) this.writer.schedule(this.current);
  }

  get(): Settings {
    return structuredClone(this.current);
  }

  /** Apply a deep partial patch. Invalid fields are reset to defaults and reported. */
  update(patch: unknown): { settings: Settings; repaired: string[] } {
    // An individual edit takes ownership away from the preset, even across restarts.
    if (this.current.capabilityBoost.enabled) {
      for (const key of Object.keys(this.current.capabilityBoost.previous)) {
        if (valueAt(patch, key) !== undefined) delete this.current.capabilityBoost.previous[key];
      }
    }
    const { settings, repaired } = normalizeSettings(deepMerge(this.current, patch));
    // arrays/records are replaced not merged — that's intended for lists like approvedApps
    this.current = settings;
    this.writer.schedule(settings);
    this.emit('changed', this.get());
    return { settings: this.get(), repaired };
  }

  reset(): Settings {
    this.current = structuredClone({ ...DEFAULT_SETTINGS, firstRunComplete: true });
    this.writer.schedule(this.current);
    this.emit('changed', this.get());
    return this.get();
  }

  setCapabilityBoost(enabled: boolean) {
    if (enabled === this.current.capabilityBoost.enabled) return { settings: this.get(), repaired: [] };
    const next = this.get(), previous: Record<string, boolean | string> = {};
    if (enabled) {
      for (const [key, value] of Object.entries(CAPABILITY_BOOST)) {
        const before = valueAt(next, key);
        if (before === value) continue;
        previous[key] = before as boolean | string;
        putAt(next as unknown as Record<string, unknown>, key, value);
      }
    } else {
      for (const [key, before] of Object.entries(next.capabilityBoost.previous)) {
        if (Object.hasOwn(CAPABILITY_BOOST, key) && valueAt(next, key) === CAPABILITY_BOOST[key as keyof typeof CAPABILITY_BOOST])
          putAt(next as unknown as Record<string, unknown>, key, before);
      }
    }
    next.capabilityBoost = { enabled, previous };
    const result = this.update(next); this.flush(); return result;
  }

  flush() { this.writer.flush(); }
}
