import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, normalizeSettings, CAPRI_VOICE_DELIVERY } from '../../src/shared/settings';
import { speechRequest } from '../../src/main/voice/tts';

describe('remote voice delivery', () => {
  it('sends Nova delivery instructions and the requested speed', () => {
    const voice = structuredClone(DEFAULT_SETTINGS.voice); voice.rate = 1.15;
    expect(speechRequest('Hey, choom.', voice)).toMatchObject({ model: 'gpt-4o-mini-tts', voice: 'nova', instructions: CAPRI_VOICE_DELIVERY, speed: 1.15, input: 'Hey, choom.' });
  });
  it('keeps older speech models compatible and allows an empty delivery prompt', () => {
    for (const model of ['tts-1', 'tts-1-hd']) {
      const voice = structuredClone(DEFAULT_SETTINGS.voice); voice.openaiTts.model = model;
      expect(speechRequest('Hi.', voice)).not.toHaveProperty('instructions');
    }
    const voice = structuredClone(DEFAULT_SETTINGS.voice); voice.openaiTts.instructions = '  ';
    expect(speechRequest('Hi.', voice)).not.toHaveProperty('instructions');
  });
  it('adds delivery instructions to existing settings without changing saved provider or voice choices', () => {
    const { settings, repaired } = normalizeSettings({ voice: { openaiTts: { model: 'tts-1', voice: 'shimmer' } } });
    expect(settings.voice.openaiTts).toMatchObject({ model: 'tts-1', voice: 'shimmer', instructions: CAPRI_VOICE_DELIVERY });
    expect(repaired).toEqual([]);
  });
});
