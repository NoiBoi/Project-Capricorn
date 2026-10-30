import { describe, it, expect } from 'vitest';
import { SettingsStore } from '../../src/main/store/settingsStore';
import { tmpDir } from './helpers';
import { suggestions } from '../../src/renderer/panel/search';
import { SETTINGS_SEARCH } from '../../src/renderer/panel/settingsSearch';

describe('capability preferences', () => {
  it('persists the original choices across restart and restores only its own changes', () => {
    const dir = tmpDir(), store = new SettingsStore(dir);
    store.update({ voice: { volume: .37 }, actions: { policies: { read_screen: 'deny' } } }); store.flush();
    const before = store.get();
    store.setCapabilityBoost(true);
    const restarted = new SettingsStore(dir);
    expect(restarted.get().actions.policies.read_screen).toBe('allow');
    expect(restarted.get().voice.micPermission).toBe(true);
    expect(restarted.get().behavior.explore).toBe(true);
    expect(restarted.get().voice.wakeWord).toBe(false);
    expect(restarted.get().actions.policies.use_computer).toBe(before.actions.policies.use_computer);
    restarted.setCapabilityBoost(false);
    expect(restarted.get()).toEqual(before);
  });
  it('keeps later individual edits and does not reset the baseline on repeated enable', () => {
    const dir = tmpDir(), store = new SettingsStore(dir);
    store.setCapabilityBoost(true); const original = store.get().capabilityBoost.previous;
    store.setCapabilityBoost(true); expect(store.get().capabilityBoost.previous).toEqual(original);
    store.update({ memory: { autoLearn: false } });
    store.update({ memory: { autoLearn: true }, voice: { volume: .21 } }); store.flush();
    const restarted = new SettingsStore(dir); restarted.setCapabilityBoost(false);
    expect(restarted.get().memory.autoLearn).toBe(true);
    expect(restarted.get().voice.volume).toBe(.21);
    expect(restarted.get().voice.micPermission).toBe(false);
    expect(restarted.get().character.speechBubbles).toBe(true);
    expect(restarted.get().capabilityBoost).toEqual({ enabled: false, previous: {} });
  });
});
describe('settings suggestions', () => {
  it('finds specific controls across sections, requires all query words and gives useful defaults', () => {
    expect(suggestions(SETTINGS_SEARCH, 'quiet hours')[0]).toMatchObject({ page: 'attention', label: 'Quiet hours' });
    expect(suggestions(SETTINGS_SEARCH, 'volume')[0]).toMatchObject({ page: 'voice' });
    expect(suggestions(SETTINGS_SEARCH, 'greater desktop access')[0]).toMatchObject({ page: 'settings' });
    expect(suggestions(SETTINGS_SEARCH, 'quiet zebrafish')).toEqual([]);
    expect(suggestions(SETTINGS_SEARCH, '')).toHaveLength(6);
  });
});
