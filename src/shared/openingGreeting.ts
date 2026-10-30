import { companionDialogue } from './dialogue';

/** Local variation uses approved name facts only, with no model call or inferred personal details. */
export function openingGreeting(hour: number, memories: string[], previous = '', random = Math.random, preferredName?: string) {
  const name = preferredName ?? memories.map(text => text.match(/^(?:(?:the )?user(?:'s)? (?:preferred )?name (?:is|:)\s*|(?:the )?user prefers to be called\s+)([A-Za-z][A-Za-z'-]{1,15})(?:\s|[.!]|$)/i)?.[1]).find(Boolean);
  return companionDialogue.choose({ event: 'opening', hour, name, recent: previous ? [previous] : [] }, { required: true });
}
