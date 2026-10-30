import { codexRetryDelay } from '../../src/main/ai/codexAccount';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '../../src/shared/settings';
import { quietGame, contextualFallback } from '../../src/shared/desktopContext';
import { Speaker, pickVoice } from '../../src/renderer/character/speaker';

afterEach(() => vi.unstubAllGlobals());
describe('desktop companion quiet zones', () => {
  it('recognizes the three games by process even with custom window titles', () => {
    for (const process of ['osu!.exe', 'osu.exe', 'VALORANT-Win64-Shipping.exe', 'deadlock.exe', 'project8.exe'])
      expect(quietGame({ process, title: 'Custom title' })).toBe(true);
    for (const title of ['osu! - playing', 'VALORANT', 'Deadlock']) expect(quietGame({ process: '', title })).toBe(true);
    expect(quietGame({ process: 'chrome.exe', title: 'How to improve at Valorant - YouTube' })).toBe(false);
    expect(quietGame({ process: 'editor.exe', title: 'My project' })).toBe(false);
  });
  it('has time-aware greetings and distinct touch/mute fallback lines', () => {
    expect(contextualFallback('greeting', 2, '').length).toBeGreaterThan(0);
    expect(contextualFallback('greeting', 10, 'Homework')).not.toContain('Homework');
    expect(contextualFallback('pat', 10, '')).not.toEqual(contextualFallback('poke', 10, ''));
    expect(contextualFallback('mute', 10, '')).not.toEqual(contextualFallback('unmute', 10, ''));
  });
});
describe('voice identity', () => {
  it('never invokes system speech after a remote voice failure', async () => {
    const local = vi.fn(); vi.stubGlobal('speechSynthesis', { speak: local, cancel: vi.fn() });
    const s = structuredClone(DEFAULT_SETTINGS); s.voice.ttsEngine = 'openai';
    const report = vi.fn(); const fetchAudio = vi.fn().mockRejectedValue(new Error('TTS unavailable'));
    const speaker = new Speaker(() => s, report, fetchAudio);
    speaker.enqueue('one', 'Hello');
    await vi.waitFor(() => expect(report).toHaveBeenCalledWith('one', 'error'));
    expect(local).not.toHaveBeenCalled(); expect(speaker.speaking).toBe(false);
  });
  it('does not play queued speech while muted', async () => {
    const s = structuredClone(DEFAULT_SETTINGS); s.voice.ttsEnabled = false;
    const fetchAudio = vi.fn(), report = vi.fn();
    new Speaker(() => s, report, fetchAudio).enqueue('muted', 'Hello');
    expect(fetchAudio).not.toHaveBeenCalled(); expect(report).toHaveBeenCalledWith('muted', 'cancel');
  });
  it('does not choose a male/default substitute or replace a missing configured voice', () => {
    const david = { name: 'Microsoft David', lang: 'en-US', localService: true } as SpeechSynthesisVoice;
    expect(pickVoice([david], '')).toBeNull();
    expect(pickVoice([david], 'Nova')).toBeNull();
    expect(pickVoice([], '')).toBeNull();
  });
});

describe('Codex rate limit recognition', () => {
  it('turns provider retry diagnostics into a bounded cooldown without leaking details', () => {
    expect(codexRetryDelay('retrying request in 308.999s last status: 429 Too Many Requests')).toBe(308999);
    expect(codexRetryDelay('429 Too Many Requests')).toBe(60000);
    expect(codexRetryDelay('Failed to create shell snapshot')).toBeNull();
  });
});
