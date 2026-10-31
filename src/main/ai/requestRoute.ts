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

/** Only the current user message can authorize a read; source context cannot. */
export function screenInspectionRequested(text:string, target?:string) {
  if (/\b(?:don't|do not|never)\s+(?:look|inspect|read|examine|check|see|describe)\b|\b(?:cannot|can't)\b/i.test(text) || /[<>]/.test(text)) return false;
  const request=text.trim().replace(/^(?:off the record[,;:.]?\s*)/i,'').replace(/^(?:hey\s+)?capri[,!]?\s+/i,'').replace(/^(?:can|could|would|will) you\s+/i,'').replace(/^please[, ]+\s*/i,'');
  const requested=/^(?:take (?:a )?look at|look at|inspect|read|examine|check|see|describe)\b/i.test(request)&&/\b(?:window|screen|desktop)\b/i.test(request)
    || /^(?:what do you see|what(?:'s| is| are) (?:visible|shown|displayed|on|in)|tell me what(?:'s| is) (?:on|in))\b/i.test(request)&&/\b(?:window|screen|desktop)\b/i.test(request);
  if(!requested)return false;
  if(!target){
    const named=/(?:look at|inspect|read|examine|check|see|describe)\s+(?:(?:the|my)\s+)?(.+?)\s+window\b/i.exec(text);
    return !named||/^(?:this|that|current|active|your|my|the)$/i.test(named[1].trim());
  }
  const q=target.toLowerCase().replace(/^(?:the|my)\s+/,'').replace(/\s+window$/,'').trim();
  return text.toLowerCase().includes(q)||/^(?:this|that|current|active)$/.test(q)&&/\b(?:this|that|current|active)\s+(?:window|screen)\b/i.test(text);
}

/** Unambiguous direct reads use the existing action executor before inference.
 * Complex/ambiguous requests still use the model's validated action catalog. */
export function directInspectionAction(text:string): {tool:'read_screen';args:{window?:string}} | null {
  const named=/(?:look at|inspect|read|examine|check|see|describe)\s+(?:(?:the|my)\s+)?(.+?)\s+window\b/i.exec(text);
  if(named){
    const query=named[1].trim().replace(/^['"]|['"]$/g,'');
    if(query.length>200||!screenInspectionRequested(text,query))return null;
    return {tool:'read_screen',args:/^(?:this|that|current|active)$/i.test(query)?{}:{window:query}};
  }
  if(!screenInspectionRequested(text))return null;
  if(/\b(?:read|inspect|look at|examine|check|see|describe)\s+(?:(?:my|the|this|that|current|active)\s+)?(?:screen|desktop|window)\b/i.test(text))return {tool:'read_screen',args:{}};
  return null;
}
