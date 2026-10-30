import type { GenOptions, LLMMessage, LLMProvider } from './providers';
import { companionDialogue } from '../../shared/dialogue';
import { ProviderError } from './providers';
import { parseDuration, parseWhen } from '../actions/timeParse';

const act = (tool: string, args: Record<string, unknown>) => `<action>${JSON.stringify({ tool, args })}</action>`;
const pick = <T,>(xs: T[]) => xs[Math.floor(Math.random() * xs.length)];

/**
 * No-model fallback. Understands direct commands and emits the same <action> protocol a
 * real model would, so the full action pipeline (validation, policy, confirmation) applies.
 */
export function offlineReply(input: string, now = new Date()): string {
  const raw = input.trim();
  const t = raw.toLowerCase();

  if (t.startsWith('[action results]')) {
    const lines = raw.split('\n').slice(1).filter((l) => l.startsWith('- '));
    const ok = lines.filter((l) => /\bok\b/i.test(l));
    const summary = lines.map((l) => l.replace(/^- \S+ (ok|failed): /i, '')).join(' ');
    return ok.length === lines.length ? `${pick(['Done.', 'Handled.', 'Nicely handled, if I say so myself.'])} ${summary}` : `Hit a snag: ${summary}`;
  }
  if (/^(hi|hey|hello|yo|sup)\b|^hey capri/.test(t)) return companionDialogue.choose({ event: 'greeting' }, { required: true }) || 'Hey, you.';
  if (/\b(help|what can you do)\b/.test(t)) {
    return 'Without a model hooked up I can still: set timers ("timer 5 minutes"), reminders ("remind me to stretch in 20 minutes"), take notes ("note: buy coffee"), open sites ("open github.com"), launch approved apps ("launch notepad"), search your authorized folders ("find files named budget"), and tell the time. Connect a model in Settings → Model to really talk.';
  }
  if (/\b(come here|over here)\b/.test(t)) return `On my way. ${act('teleport', { where: 'near_cursor' })}`;
  if (/\bsit on (my|the|this) window\b|\bperch\b/.test(t)) return `Don't mind if I do. ${act('teleport', { where: 'perch' })}`;
  if (/\bpeek\b/.test(t)) return `Peekaboo. ${act('teleport', { where: 'peek' })}`;
  const poseM = /\b(sit down|sit|stand up|stand|recline|lie back|curl up|power stance|pose)\b/.exec(t);
  if (poseM && !/timer|remind|note/.test(t)) { const map: Record<string, string> = { 'sit down': 'sit', sit: 'sit', 'stand up': 'stand', stand: 'stand', recline: 'recline', 'lie back': 'recline', 'curl up': 'curl_up', 'power stance': 'power_stance', pose: 'power_stance' }; return `Like this? ${act('emote', { emotion: map[poseM[1]] })}`; }
  if (/\b(teleport|get out of the way|move (over|away|somewhere)|other (screen|monitor))\b/.test(t)) {
    return `Blink and you'll miss it. ${act('teleport', { where: /other (screen|monitor)/.test(t) ? 'other_monitor' : /corner/.test(t) ? 'corner' : 'auto' })}`;
  }
  if (/\b(cancel|stop|kill)\b.*\b(timer|reminder)\b/.test(t)) {
    const q = t.replace(/.*\b(timer|reminder)\b\s*/, '').trim() || 'timer';
    return `Killing it. ${act('cancel_timer', { query: q })}`;
  }
  if (/\btimer\b/.test(t)) {
    const ms = parseDuration(t);
    if (!ms) return 'How long? Try "timer 10 minutes".';
    return `Timer coming up. ${act('start_timer', { seconds: Math.round(ms / 1000) })}`;
  }
  const rem = /\bremind me (?:to )?(.+)/i.exec(raw);
  if (rem) {
    const when = parseWhen(rem[1], now);
    if (!when) return 'When should I remind you? Say "in 20 minutes" or "at 3pm".';
    const text = rem[1].replace(/\b(in\s+.+|(tomorrow\s+)?at\s+\d.+)$/i, '').trim() || 'Reminder';
    return `Got it. ${act('set_reminder', { text, at: new Date(when).toISOString() })}`;
  }
  const note = /^(?:note|take a note|write down|jot down)[:\s]+(.+)/is.exec(raw);
  if (note) return `Noted. ${act('create_note', { title: note[1].slice(0, 40), body: note[1] })}`;
  if (/\b(show|list|read)\b.*\bnotes\b/.test(t)) return `Pulling your notes. ${act('list_notes', {})}`;
  const rememberM = /^remember (?:that )?(.+)/is.exec(raw);
  if (rememberM) return `I'll keep that — if you approve. ${act('remember', { text: rememberM[1] })}`;
  const search = /\b(?:find|search for|look for)\s+(?:files?\s+(?:named|called)\s+)?["']?([^"']+?)["']?\s*$/i.exec(raw);
  if (search && !/\bweb\b/.test(t)) return `Scanning your folders. ${act('search_files', { query: search[1].trim() })}`;
  const open = /^(?:open|go to|visit|browse to)\s+(.+)$/i.exec(raw);
  if (open) {
    const target = open[1].trim();
    if (/^(https?:\/\/)?[\w-]+(\.[\w-]+)+(\/\S*)?$/i.test(target)) return `Opening it. ${act('open_url', { url: target })}`;
    return `Launching. ${act('launch_app', { name: target })}`;
  }
  const launch = /^(?:launch|start|run)\s+(.+)$/i.exec(raw);
  if (launch) return `Launching. ${act('launch_app', { name: launch[1].trim() })}`;
  if (/\b(what time|the time|what's the date|what day)\b/.test(t)) return `It's ${now.toLocaleString([], { weekday: 'long', hour: 'numeric', minute: '2-digit', month: 'short', day: 'numeric' })}.`;
  if (/\b(who are you|what are you)\b/.test(t)) return 'Capri. A personality construct — lots of minds rolled into one beautiful me. Right now I\'m running without a language model, so I\'m mostly hands, not mouth.';
  if (/\b(thanks|thank you|ty)\b/.test(t)) return companionDialogue.choose({ event: 'thanks' }, { required: true }) || 'Yeah. Anytime.';
  return companionDialogue.choose({ event: 'offline' }, { required: true }) || "My model's disconnected. Try 'help' for commands.";
}

export class OfflineProvider implements LLMProvider {
  readonly name = 'offline';
  readonly local = true;
  async *stream(messages: LLMMessage[], o: GenOptions) {
    const last = [...messages].reverse().find((m) => m.role === 'user');
    const reply = offlineReply(last?.content ?? '');
    // stream in word-sized pieces so the UI/TTS path is identical to real models
    for (const piece of reply.match(/<action>.*?<\/action>|\S+\s*/gs) ?? []) {
      if (o.signal.aborted) throw new ProviderError('aborted', 'aborted');
      yield piece;
      await new Promise((r) => setTimeout(r, 12));
    }
  }
  async test() { return { ok: true, detail: 'Built-in offline command mode (no language model)', latencyMs: 0 }; }
  async listModels() { return ['built-in commands']; }
}
