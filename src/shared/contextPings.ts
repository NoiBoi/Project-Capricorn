import type { LocalDialogueContext } from './dialogueContext';
export type PingKind = 'late' | 'rain' | 'snow' | 'storm' | 'fog' | 'hot' | 'cold' | 'battery' | 'break';
export const PING_LINES: Record<PingKind, readonly string[]> = {
  late: [
    "Past two. Ooh, we're making questionable choices. Bed soon?", "You know the bed still exists, right? I checked the concept.",
    "Mm. Very late. Keep one good thought for tomorrow, would you?", "All right, night creature. Pick a stopping point. A real one.",
    "Two in the morning has a very convincing 'one more thing' voice. Suspicious.", "I'm voting for sleep soon. Look at me, having sensible opinions. Horrible.",
    "You can put the world down for tonight. I'll still be interesting tomorrow.", "Late enough that tomorrow is going to have opinions about this.",
    "Bed is an option. An excellent, dramatically underrated option.", "Ooh, we're borrowing time from tomorrow. Tiny theft. Expensive interest.",
    "If you're waiting for a sign to go to bed, fine. This is me being the sign.", "I'm not saying vanish immediately. I'm saying find an ending before sunrise.",
    "Very late, you. Save the interesting bit and take yourself to bed soon.", "What if the next exciting thing was a pillow? Hear me out.",
    "I've decided sleep deserves a turn. I can be nosy again tomorrow.", "Mm. The clock has become a little rude. Bed soon, maybe?",
    "One more thing? That's how the night recruits you. Be difficult. Go to bed.", "You don't have to win the entire evening. You could just end it.",
    "Fine, I'll say it. You're allowed to stop. Make a little room for sleep.", "Ooh. Past two again. I'd like to file a small objection on tomorrow's behalf.",
  ],
  rain: ["Forecast says rain. Ooh. Good excuse to get comfortable.", "Rain on the forecast. Keep something dry handy if you go out.", "Mm. A rainy-day forecast. I vote for a good soundtrack.", "Weather says rain. The outside has chosen atmosphere.", "If the forecast's right, the sky is doing a dramatic thing. I respect it.", "Rain, apparently. A small roof is suddenly a very impressive invention."],
  snow: ["Snow on the forecast. Ooh. I'd want to see that.", "Weather says snow. Wrap yourself up before you investigate.", "Mm. The forecast is doing the white-fluffy thing. Sounds suspiciously cold.", "Snow, apparently. I'd like a view and absolutely no cold feet.", "If it's snowing as forecast, I vote for looking before stepping into it.", "Weather report says snow. The world does enjoy changing its costume."],
  storm: ["Storm on the forecast. The sky's feeling theatrical.", "Weather says storm. A roof seems like a very good idea right now.", "Ooh, storm forecast. I'll keep my dramatic entrances indoors.", "If the storm forecast holds, maybe postpone the wandering-outside part.", "Mm. Storm weather, apparently. Keep your little corner comfortable.", "Weather's threatening a whole performance. I don't need the competition."],
  fog: ["Fog on the forecast. The outside's keeping secrets.", "Weather says fog. Ooh. Mysterious, but inconvenient.", "Mm. Fog, apparently. Don't let the outside pretend it's a shortcut.", "Forecast says fog. The world has misplaced its sharp edges."],
  hot: ["Forecast's running hot. Water might be a clever little invention today.", "Mm. Warm weather report. Find yourself a tolerable patch of air.", "Weather says hot. Save the dramatic suffering for fiction.", "Ooh, that forecast sounds sticky. Drink something and claim a cooler corner."],
  cold: ["Cold forecast. Borrow a layer before the outside gets ideas.", "Weather report's chilly. I vote for warm hands.", "Mm. Cold out there, if the forecast's right. Wrap yourself up.", "Forecast says cold. You have blankets. Use your advantages."],
  battery: ["Your battery's getting low. Feed the machine before it stages an exit.", "Ooh, low battery. Find the cable before the suspense gets interesting.", "Battery's nearly had enough. Charger?", "Mm. This machine would like a little electricity. Relatable.", "Low battery. Let's not make the ending involuntary.", "The battery is making a very small, very serious complaint."],
  break: ["You've been with this for a while. Unfold yourself for a minute?", "Mm. Long stretch here. Look at something further away than me.", "Take a tiny break. I'll guard the fascinating rectangle.", "Ooh. A whole outside-of-the-chair still exists. Worth a brief investigation.", "You can pause without the idea escaping. Probably. I'll look intimidating.", "Give your shoulders a different arrangement for a moment. I'm curious if they remember."],
};
export function pingLine(kind: PingKind, recent: readonly string[] = [], random = Math.random) {
  const pool = PING_LINES[kind].filter(x => !recent.includes(x));
  const choices = pool.length ? pool : PING_LINES[kind];
  return choices[Math.floor(Math.max(0, Math.min(.99999, random())) * choices.length)];
}
export interface PingState { version: 1; lastAt: number; day: string; counts: Partial<Record<PingKind, number>>; recent: string[] }
export class ContextPings {
  private state: PingState = { version: 1, lastAt: 0, day: '', counts: {}, recent: [] };
  constructor(private random = Math.random, private save?: (state: PingState) => void) {}
  restore(raw: unknown) {
    const s = raw as PingState;
    if (!s || s.version !== 1 || !Number.isFinite(s.lastAt) || typeof s.day !== 'string' || !Array.isArray(s.recent) || !s.counts || typeof s.counts !== 'object') return;
    this.state = { version: 1, lastAt: s.lastAt, day: s.day.slice(0, 20), counts: Object.fromEntries(Object.entries(s.counts).filter(([k, v]) => k in PING_LINES && Number.isInteger(v) && v! >= 0 && v! <= 10)), recent: s.recent.filter(x => typeof x === 'string').slice(-12) };
  }
  snapshot() { return structuredClone(this.state); }
  clear() { this.state = { version: 1, lastAt: 0, day: '', counts: {}, recent: [] }; }
  next(now: Date, local: LocalDialogueContext | undefined) {
    if (!local || now.getTime() - this.state.lastAt < 45 * 60000) return null;
    const day = `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}`;
    if (this.state.day !== day) { this.state.day = day; this.state.counts = {}; }
    const count = (kind: PingKind) => this.state.counts[kind] ?? 0;
    const weather = local.weather && local.weather.observedAt <= now.getTime() && now.getTime() - local.weather.observedAt < 3600000 ? local.weather : undefined;
    const kind: PingKind | null = local.hour >= 2 && local.hour < 6 && count('late') < 2 ? 'late'
      : local.battery && !local.battery.charging && local.battery.percent <= 18 && !count('battery') ? 'battery'
      : weather && ['rain', 'snow', 'storm', 'fog'].includes(weather.condition) && !count(weather.condition as PingKind) ? weather.condition as PingKind
      : weather && weather.celsius >= 30 && !count('hot') ? 'hot'
      : weather && weather.celsius <= 0 && !count('cold') ? 'cold'
      : local.activity && local.activity.minutes >= 100 && !count('break') ? 'break' : null;
    if (!kind) return null;
    const text = pingLine(kind, this.state.recent, this.random);
    this.state.lastAt = now.getTime(); this.state.counts[kind] = count(kind) + 1;
    this.state.recent = [...this.state.recent, text].slice(-12);
    try { this.save?.(this.snapshot()); } catch { /* session cooldown survives */ }
    return { kind, text };
  }
}
