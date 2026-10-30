import { companionDialogue, type DialogueEvent } from './dialogue';
export function quietGame(info: { title: string; process: string }): boolean {
  return /^(osu!?(?:lazer)?|valorant(?:-win64-shipping)?|deadlock|project8)\.exe$/i.test(info.process)
    || /^(?:osu!?(?:lazer)?(?:\s|$)|valorant(?:\s|$)|deadlock(?:\s|$))/i.test(info.title);
}
export function contextualFallback(event: string, hour: number, _title: string, recent: readonly string[] = [], _rand = Math.random): string {
  // No synthetic observation when a window-generation request has no evidence or fails.
  if (['inspect', 'question', 'placed_window'].includes(event)) return '';
  const known = ['arrival', 'mute', 'unmute', 'pat', 'poke', 'caught', 'return', 'greeting'];
  const mapped = event === 'placed' ? 'putdown' : known.includes(event) ? event as DialogueEvent : 'greeting';
  return companionDialogue.choose({ event: mapped, hour, recent }, { required: true });
}
