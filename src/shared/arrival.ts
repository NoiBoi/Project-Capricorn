import { companionDialogue } from './dialogue';
/** Titles establish real targets, not dialogue slots or evidence of their contents. */
export function arrivalLine(_reason: string, _title: string, returning: boolean, recent: readonly string[]) {
  return companionDialogue.choose({ event: 'arrival', returning, recent });
}
