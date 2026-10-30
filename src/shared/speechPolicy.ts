import type { Settings } from './settings';
import { mayInterrupt } from './behaviorRules';

/**
 * The only reasons Capri may speak out loud. Every speech request in the app goes through
 * {@link speechAllowed}; reconnects, idle animations and arbitrary model output do not bypass it.
 * - reply: answering something the user said or typed to her
 * - reminder: a timer or reminder the user created
 * - proactive: volunteering a line; off unless the user enabled both idle remarks and their voice
 * - arrival: a short movement reaction, controlled by voice/interaction lines and quiet settings
 */
export type SpeechReason = 'reply' | 'reminder' | 'proactive' | 'interaction' | 'arrival';

export function speechAllowed(reason: SpeechReason, s: Settings, ctx: { fullscreen: boolean; hidden: boolean; now?: Date }): boolean {
  if (!s.voice.ttsEnabled) return false;
  switch (reason) {
    case 'reply': return true;
    case 'interaction': return !s.behavior.doNotDisturb && !ctx.fullscreen && !ctx.hidden;
    case 'arrival': return s.voice.interactionLines && !ctx.fullscreen && !ctx.hidden && mayInterrupt(s, ctx);
    case 'reminder': return !s.behavior.doNotDisturb && !ctx.fullscreen;
    case 'proactive': return s.behavior.idleRemarks && s.behavior.proactiveVoice && mayInterrupt(s, ctx);
  }
}
