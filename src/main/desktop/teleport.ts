import type { DisplayLike, Rect } from './displays';

export type TeleportTarget = 'auto' | 'near_cursor' | 'corner' | 'left' | 'right' | 'other_monitor' | 'random' | 'perch' | 'peek';
export const TELEPORT_TARGETS: TeleportTarget[] = ['auto', 'near_cursor', 'corner', 'left', 'right', 'other_monitor', 'random', 'perch', 'peek'];
export type DestKind = 'spot' | 'perch' | 'peek_left' | 'peek_right';
export type Destination = Rect & { kind: DestKind };
import { SEAT_RATIO } from '../../shared/framing';
/** Fraction of the window height where she rests on a ledge (derived from the character model). */
export { SEAT_RATIO };

/** Sit on the top edge of the active window (B 0:18: she stands on top of D's head). */
export function perchSpot(win: Rect, size: { width: number; height: number }, displays: DisplayLike[], cursor: { x: number; y: number }, rand: () => number): Destination | null {
  const d = displays.find((x) => contains(x.workArea, { x: win.x + win.width / 2, y: Math.max(win.y, x.workArea.y) + 1 }));
  if (!d) return null;
  const a = d.workArea;
  const y = Math.round(win.y - size.height * SEAT_RATIO);
  // the window's top edge must be well below the top of the screen, and wide enough to sit on
  if (y < a.y - size.height * 0.2 || win.y > a.y + a.height - 60 || win.width < size.width + 40) return null;
  const lo = Math.max(win.x + 10, a.x), hi = Math.min(win.x + win.width - size.width - 10, a.x + a.width - size.width);
  if (hi < lo) return null;
  // Favor a shoulder of the window, away from the pointer and the title-bar buttons.
  const shoulders = [lo + (hi - lo) * .12, lo + (hi - lo) * .78];
  const xScore = (x: number) => Math.min(600, Math.abs(x + size.width / 2 - cursor.x)) - (x + size.width > win.x + win.width - 140 ? 180 : 0);
  let x = Math.round(shoulders.sort((a, b) => xScore(b) - xScore(a))[0] + (rand() - .5) * Math.min(30, (hi - lo) * .08));
  x = Math.max(lo, Math.min(hi, x));
  if (cursor.x >= x && cursor.x < x + size.width && cursor.y < win.y + 4 && cursor.y > y) x = cursor.x < (lo + hi) / 2 + size.width / 2 ? Math.min(hi, cursor.x + 30) : Math.max(lo, cursor.x - size.width - 30);
  return { x, y, width: size.width, height: size.height, kind: 'perch' };
}

/** Lean in from a screen edge with part of her off-screen (B 0:28 / 2:13: peeking in). */
export function peekSpot(d: DisplayLike, size: { width: number; height: number }, side: 'left' | 'right'): Destination {
  const a = d.workArea;
  const x = side === 'left' ? Math.round(a.x - size.width * 0.42) : Math.round(a.x + a.width - size.width * 0.58);
  return { x, y: Math.round(a.y + a.height - size.height * SEAT_RATIO), width: size.width, height: size.height, kind: side === 'left' ? 'peek_left' : 'peek_right' };
}

export interface TeleportContext {
  displays: DisplayLike[];
  current: Rect; // character window bounds (DIP)
  cursor: { x: number; y: number };
  avoid: Rect | null; // foreground app window (DIP) — don't cover it
  rand?: () => number;
}

const area = (r: Rect) => Math.max(0, r.width) * Math.max(0, r.height);
const overlap = (a: Rect, b: Rect) =>
  Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
const contains = (r: Rect, p: { x: number; y: number }) => p.x >= r.x && p.x < r.x + r.width && p.y >= r.y && p.y < r.y + r.height;
const centre = (r: Rect) => ({ x: r.x + r.width / 2, y: r.y + r.height / 2 });
const dist = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);

/** Spots along the bottom edge and corners of a work area where she can "stand". */
function spots(d: DisplayLike, w: number, h: number): (Rect & { kind: 'corner' | 'left' | 'right' | 'edge' })[] {
  const a = d.workArea;
  const m = 16;
  const bottom = Math.round(a.y + a.height - h * SEAT_RATIO); // resting on the taskbar's top edge
  const top = a.y + m;
  const out: (Rect & { kind: 'corner' | 'left' | 'right' | 'edge' })[] = [
    { x: a.x + m, y: bottom, width: w, height: h, kind: 'corner' },
    { x: a.x + a.width - w - m, y: bottom, width: w, height: h, kind: 'corner' },
    { x: a.x + m, y: top, width: w, height: h, kind: 'left' },
    { x: a.x + a.width - w - m, y: top, width: w, height: h, kind: 'right' },
    { x: a.x + m, y: Math.round(a.y + (a.height - h) / 2), width: w, height: h, kind: 'left' },
    { x: a.x + a.width - w - m, y: Math.round(a.y + (a.height - h) / 2), width: w, height: h, kind: 'right' },
  ];
  for (const f of [0.25, 0.5, 0.75]) out.push({ x: Math.round(a.x + (a.width - w) * f), y: bottom, width: w, height: h, kind: 'edge' });
  // only spots where she fits the work area down to her seat line (below it, the window may overlap the
  // taskbar: that part only ever holds legs dangling over a window edge, never anything on the taskbar)
  return out.filter((r) => r.x >= a.x && r.y >= a.y && r.x + r.width <= a.x + a.width + 1 && r.y + r.height * SEAT_RATIO <= a.y + a.height + 1);
}

/**
 * Pick where to teleport. Never off-screen, never under the cursor, avoids covering the
 * active app, prefers a real move (not a few pixels), and adds controlled randomness.
 * Returns null when no valid destination exists.
 */
export function chooseDestination(target: TeleportTarget, c: TeleportContext): Destination | null {
  const rand = c.rand ?? Math.random;
  const { width: w, height: h } = c.current;
  if (!c.displays.length) return null;
  const here = centre(c.current);
  const currentDisplay = c.displays.find((d) => contains(d.workArea, here)) ?? c.displays[0];

  if (target === 'near_cursor') {
    const d = c.displays.find((x) => contains(x.bounds, c.cursor)) ?? currentDisplay;
    const a = d.workArea;
    // stand beside the cursor (not on it), on whichever side has room
    const side = c.cursor.x + 40 + w <= a.x + a.width ? 1 : -1;
    const x = side > 0 ? c.cursor.x + 40 : c.cursor.x - 40 - w;
    const y = Math.min(Math.max(a.y, c.cursor.y - h * 0.35), a.y + a.height - h);
    return { x: Math.round(Math.min(Math.max(a.x, x), a.x + a.width - w)), y: Math.round(y), width: w, height: h, kind: 'spot' };
  }
  if (target === 'perch') return c.avoid ? perchSpot(c.avoid, { width: w, height: h }, c.displays, c.cursor, rand) : null;
  if (target === 'peek') {
    const a = currentDisplay.workArea;
    const side = c.cursor.x < a.x + a.width / 2 ? 'right' : 'left'; // the edge away from what you're pointing at
    return peekSpot(currentDisplay, { width: w, height: h }, side);
  }
  if (target === 'auto') {
    // character behaviour, not random repositioning: sometimes sit on your window, sometimes peek in from an edge
    const roll = rand();
    if (roll < 0.3 && c.avoid) { const pr = perchSpot(c.avoid, { width: w, height: h }, c.displays, c.cursor, rand); if (pr && dist(centre(pr), here) > 150) return pr; }
    if (roll > 0.88 && w <= currentDisplay.workArea.width && h <= currentDisplay.workArea.height) { const a = currentDisplay.workArea; const pk = peekSpot(currentDisplay, { width: w, height: h }, c.cursor.x < a.x + a.width / 2 ? 'right' : 'left'); if (!contains(pk, c.cursor)) return pk; }
  }

  let pool = c.displays.flatMap((d) => spots(d, w, h).map((s) => ({ ...s, display: d.id })));
  if (target === 'other_monitor') {
    const others = pool.filter((s) => s.display !== currentDisplay.id);
    if (others.length) pool = others; // single monitor: fall back to the best spot on this one
  } else if (target === 'corner') {
    pool = pool.filter((s) => s.kind === 'corner');
  } else if (target === 'left' || target === 'right') {
    // left/right half of the current display
    const a = currentDisplay.workArea;
    pool = pool.filter((s) => s.display === currentDisplay.id && (target === 'left' ? centre(s).x < a.x + a.width / 2 : centre(s).x >= a.x + a.width / 2));
  } else {
    pool = pool.filter((s) => s.display === currentDisplay.id || target === 'random' || rand() < 0.35);
  }
  const moved = pool.filter((s) => dist(centre(s), here) > Math.min(w, 220)); // a real move
  // keep clear of the cursor when there is a choice; asked to go somewhere, she still goes
  const clear = moved.filter((s) => !contains(s, c.cursor));
  const scored = (clear.length ? clear : moved)
    .map((s) => {
      const cover = c.avoid ? overlap(s, c.avoid) / area(s) : 0;
      // she rests on ledges: a seat on the taskbar beats floating, and "go left/right" always means
      // sitting on that side's stretch of taskbar (floating there only if no seat is free)
      const seated = s.kind === 'corner' || s.kind === 'edge';
      const ledge = seated ? (target === 'left' || target === 'right' ? 2 : target === 'random' ? 0 : 0.35) : 0;
      const score = -cover * 3 + ledge + (target === 'random' ? rand() * 2 : rand() * 0.6) + (s.kind === 'corner' ? 0.25 : 0) + Math.min(1, dist(centre(s), here) / 1500) * 0.3;
      return { s, score };
    })
    .sort((a, b) => b.score - a.score);
  const best = scored[0]?.s;
  return best ? { x: Math.round(best.x), y: Math.round(best.y), width: w, height: h, kind: 'spot' } : null;
}

/** Next automatic teleport delay (ms), uniformly random within the configured range. */
export function nextAutoDelay(minMinutes: number, maxMinutes: number, rand: () => number = Math.random) {
  const lo = Math.max(1, Math.min(minMinutes, maxMinutes)), hi = Math.max(lo, maxMinutes);
  return Math.round((lo + (hi - lo) * rand()) * 60_000);
}
