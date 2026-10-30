import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, type Settings } from '../../src/shared/settings';
import { speechAllowed } from '../../src/shared/speechPolicy';

const noon = new Date(2026, 9, 25, 12, 0);
const ctx = { fullscreen: false, hidden: false, now: noon };
const with_ = (patch: (s: Settings) => void) => { const s = structuredClone(DEFAULT_SETTINGS); patch(s); return s; };

describe('speech policy: she only talks for a reason', () => {
  it('voices arrival reactions independently of idle chatter while honoring mute and quiet settings', () => {
    const on = with_(s => { s.voice.interactionLines = true; s.behavior.idleRemarks = false; s.behavior.proactiveVoice = false; });
    expect(speechAllowed('arrival', on, ctx)).toBe(true);
    expect(speechAllowed('arrival', on, { ...ctx, fullscreen: true })).toBe(false);
    on.voice.ttsEnabled = false; expect(speechAllowed('arrival', on, ctx)).toBe(false);
    on.voice.ttsEnabled = true; on.voice.interactionLines = false; expect(speechAllowed('arrival', on, ctx)).toBe(false);
    on.voice.interactionLines = true; on.behavior.doNotDisturb = true; expect(speechAllowed('arrival', on, ctx)).toBe(false);
  });
  it('answers the user out loud when voice is on, never when it is off', () => {
    expect(speechAllowed('reply', DEFAULT_SETTINGS, ctx)).toBe(true);
    expect(speechAllowed('reply', with_((s) => { s.voice.ttsEnabled = false; }), ctx)).toBe(false);
  });
  it('never volunteers lines by default', () => {
    expect(DEFAULT_SETTINGS.behavior.idleRemarks).toBe(false);
    expect(DEFAULT_SETTINGS.behavior.proactiveVoice).toBe(false);
    expect(speechAllowed('proactive', DEFAULT_SETTINGS, ctx)).toBe(false);
  });
  it('idle remarks stay silent bubbles unless proactive voice is enabled too', () => {
    expect(speechAllowed('proactive', with_((s) => { s.behavior.idleRemarks = true; }), ctx)).toBe(false);
    expect(speechAllowed('proactive', with_((s) => { s.behavior.idleRemarks = true; s.behavior.proactiveVoice = true; }), ctx)).toBe(true);
  });
  it('proactive speech respects quiet hours, do-not-disturb and fullscreen apps', () => {
    const on = with_((s) => { s.behavior.idleRemarks = true; s.behavior.proactiveVoice = true; });
    expect(speechAllowed('proactive', on, { ...ctx, now: new Date(2026, 9, 25, 23, 30) })).toBe(false);
    expect(speechAllowed('proactive', on, { ...ctx, fullscreen: true })).toBe(false);
    expect(speechAllowed('proactive', with_((s) => { s.behavior.idleRemarks = true; s.behavior.proactiveVoice = true; s.behavior.doNotDisturb = true; }), ctx)).toBe(false);
  });
  it('reminders the user set may speak, but not over do-not-disturb or a fullscreen app', () => {
    expect(speechAllowed('reminder', DEFAULT_SETTINGS, ctx)).toBe(true);
    expect(speechAllowed('reminder', with_((s) => { s.behavior.doNotDisturb = true; }), ctx)).toBe(false);
    expect(speechAllowed('reminder', DEFAULT_SETTINGS, { ...ctx, fullscreen: true })).toBe(false);
  });
});
