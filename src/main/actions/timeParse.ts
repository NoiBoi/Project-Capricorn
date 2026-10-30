const UNIT_MS: Record<string, number> = {
  s: 1000, sec: 1000, secs: 1000, second: 1000, seconds: 1000,
  m: 60_000, min: 60_000, mins: 60_000, minute: 60_000, minutes: 60_000,
  h: 3_600_000, hr: 3_600_000, hrs: 3_600_000, hour: 3_600_000, hours: 3_600_000,
};
const WORD_NUM: Record<string, number> = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, ten: 10, fifteen: 15, twenty: 20, thirty: 30, half: 0.5 };

/** "5 minutes", "1h30m", "90s", "an hour", "half an hour" → ms, or null. */
export function parseDuration(text: string): number | null {
  const t = text.toLowerCase().replace(/half an hour/g, '30 minutes');
  let total = 0;
  let matched = false;
  // digits may be glued to the previous unit ("1h30m"); number words need a word boundary
  const re = /(?:(\d+(?:\.\d+)?)|\b(a|an|one|two|three|four|five|ten|fifteen|twenty|thirty))\s*(seconds?|secs?|s|minutes?|mins?|m|hours?|hrs?|h)(?![a-z])/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(t))) {
    const n = m[1] !== undefined ? parseFloat(m[1]) : WORD_NUM[m[2]];
    const unit = UNIT_MS[m[3]];
    if (n === undefined || !unit) continue;
    total += n * unit;
    matched = true;
  }
  return matched && total > 0 ? Math.round(total) : null;
}

/** "at 3pm", "at 15:30", "tomorrow at 9am", "in 10 minutes" → epoch ms, or null. */
export function parseWhen(text: string, now = new Date()): number | null {
  const t = text.toLowerCase();
  const rel = /\bin\s+(.+)/.exec(t);
  if (rel) {
    const d = parseDuration(rel[1]);
    if (d) return now.getTime() + d;
  }
  const at = /\bat\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/.exec(t);
  if (at) {
    let h = parseInt(at[1], 10);
    const min = at[2] ? parseInt(at[2], 10) : 0;
    if (at[3] === 'pm' && h < 12) h += 12;
    if (at[3] === 'am' && h === 12) h = 0;
    if (h > 23 || min > 59) return null;
    const d = new Date(now);
    d.setHours(h, min, 0, 0);
    if (/\btomorrow\b/.test(t)) d.setDate(d.getDate() + 1);
    else if (d.getTime() <= now.getTime()) d.setDate(d.getDate() + 1);
    return d.getTime();
  }
  return null;
}

export function formatDuration(ms: number): string {
  const s = Math.round(ms / 1000);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return [h && `${h}h`, m && `${m}m`, sec && !h && `${sec}s`].filter(Boolean).join(' ') || '0s';
}
