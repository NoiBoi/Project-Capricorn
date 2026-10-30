import type { LLMMessage } from './providers';

/** Routing hint for direct body requests; it never grants native permission. */
export function windowMovementRequest(text:string) {
  const s=text.trim().replace(/^(?:hey\s+)?capri[,!]?\s+/i,'').replace(/^(?:can|could|would) you\s+/i,'').replace(/^please[, ]+\s*/i,'');
  return !/["<>]/.test(s)&&/^(?:go|move|head|come|teleport|fly|park|settle|perch|sit|lie|lay|hang|chill)\b/i.test(s)&&/\b(?:to|on|onto|at|in|over)\b/i.test(s)&&/\b(?:window|discord|chrome|edge|firefox|spotify|codex|notepad|vscode|visual studio code)\b/i.test(s);
}

/** Local routing only decides whether to supply Capri's action catalog.
 * It grants no permissions. Every emitted action still passes the existing validator. */
export function needsActions(text: string, history: LLMMessage[] = []): boolean {
  const request = text.trim();
  if (/^(?:do you|what do you|can you tell me what you) remember\b/i.test(request)) return false;
  if (/^(?:(?:can|could) you )?(?:explain|describe|tell me how|teach me)\b|\bhow (?:do i|to)\b/i.test(request)) return false;
  if (/\b(?:don't|do not|never)\s+(?:open|launch|click|type|move|use|read)\b/i.test(request)) return false;
  if(windowMovementRequest(request))return true;
  if (/\b(?:open|launch|start|set|cancel|stop|create|make|write|save|list|show|find|search|read|inspect|check|click|press|type|scroll|drag|move|teleport|come|look|use|control|browse|navigate|switch|close|play|pause|mute|unmute|remind|remember|forget|prank|glitch)\b/i.test(request) &&
      /\b(?:app|application|browser|window|screen|desktop|computer|file|folder|document|note|notes|timer|reminder|alarm|calculator|chrome|edge|notepad|spotify|youtube|website|web|cursor|mouse|keyboard|memory|memories|tab|button|click|teleport|prank|glitch|minute|minutes|seconds|here|there|closer|away)\b|https?:\/\/|\b\w+\.(?:com|org|edu|net)\b/i.test(request)) return true;
  if (/\b(?:remind me|remember (?:that|i|my|this)|forget (?:my|that)|read (?:this|it)|open (?:it|that)|find\s+\S|timer\s+\d|what (?:is|does).*(?:on my screen|this window)|what time is it|what (?:notes|reminders|timers) (?:do i|are))\b/i.test(request)) return true;
  if (/^(?:yes|okay|ok|sure|please|do it|go ahead|try again|continue)[.!\s]*$/i.test(request)) {
    // A short follow-up inherits an actionable user request, never arbitrary tool output.
    const prior = [...history].reverse().find(m => m.role === 'user');
    return !!prior && needsActions(prior.content);
  }
  return false;
}
