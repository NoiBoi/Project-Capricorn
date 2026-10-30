import type { LifeEvent, Mood } from './personality';
import { companionDialogue, type DialogueEvent } from './dialogue';
/** Legacy entry point shares the dialogue director rather than a second set of catchphrases. */
export function companionLines(kind: LifeEvent, mood: Mood, lastEvent: LifeEvent | null): readonly string[] {
  const event: DialogueEvent = kind === 'return' ? 'return' : kind === 'window' ? 'notice' : kind === 'pat' ? 'pat' : 'poke';
  const line = companionDialogue.choose({ event, mood, repeated: kind === lastEvent }, { required: true });
  return line ? [line] : [];
}
