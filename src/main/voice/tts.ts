import { MOOD_DELIVERY, type Mood } from '../../shared/personality';
import type { Settings } from '../../shared/settings';

/** Older TTS models reject delivery instructions; compatible endpoints can use them on newer models. */
export function speechRequest(text: string, voice: Settings['voice'], mood?: Mood) {
  const { model, voice: name, instructions } = voice.openaiTts;
  const delivery = [instructions.trim(), mood ? MOOD_DELIVERY[mood] : ''].filter(Boolean).join('\n').slice(0, 4096);
  return {
    model, voice: name, input: text, response_format: 'mp3', speed: voice.rate,
    ...(!/^tts-1(?:-hd)?$/.test(model) && delivery ? { instructions: delivery } : {}),
  };
}
