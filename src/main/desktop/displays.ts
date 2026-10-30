import { SEAT_RATIO } from '../../shared/framing';
export interface Rect { x: number; y: number; width: number; height: number }
export interface DisplayLike { id: number; workArea: Rect; bounds: Rect; scaleFactor: number }

const overlap = (a: Rect, b: Rect) =>
  Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)) *
  Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));

/** Display with the largest overlap with `r`, else nearest by centre distance. */
export function displayFor(r: Rect, displays: DisplayLike[]): DisplayLike {
  let best = displays[0];
  let bestArea = -1;
  for (const d of displays) {
    const a = overlap(r, d.workArea);
    if (a > bestArea) { best = d; bestArea = a; }
  }
  if (bestArea > 0) return best;
  const cx = r.x + r.width / 2, cy = r.y + r.height / 2;
  let bestDist = Infinity;
  for (const d of displays) {
    const dx = d.workArea.x + d.workArea.width / 2 - cx, dy = d.workArea.y + d.workArea.height / 2 - cy;
    const dist = dx * dx + dy * dy;
    if (dist < bestDist) { best = d; bestDist = dist; }
  }
  return best;
}

/**
 * Keep the window reachable: at least `minVisible` px of it must stay inside some
 * display's work area (so she can never be lost off-screen after a monitor is unplugged).
 */
export function clampToDisplays(r: Rect, displays: DisplayLike[], minVisible = 80): Rect {
  if (!displays.length) return r;
  const d = displayFor(r, displays).workArea;
  const vis = Math.min(minVisible, r.width, r.height);
  const x = Math.min(Math.max(r.x, d.x - r.width + vis), d.x + d.width - vis);
  const y = Math.min(Math.max(r.y, d.y - r.height * 0.25), d.y + d.height - vis);
  return { ...r, x: Math.round(x), y: Math.round(y) };
}

/** Default spot: bottom-right of the primary work area, resting on the taskbar. */
export function defaultPosition(size: { width: number; height: number }, primary: DisplayLike): Rect {
  const w = primary.workArea;
  return { x: Math.round(w.x + w.width - size.width - 24), y: Math.round(w.y + w.height - size.height * SEAT_RATIO), ...size };
}

/** Restore a saved position; if its display is gone or the spot is invalid, fall back sensibly. */
export function restorePosition(
  saved: { x: number; y: number; displayId: number } | null,
  size: { width: number; height: number },
  displays: DisplayLike[],
  primaryId: number,
): Rect {
  const primary = displays.find((d) => d.id === primaryId) ?? displays[0];
  if (!saved) return defaultPosition(size, primary);
  const stillThere = displays.some((d) => d.id === saved.displayId);
  const r = { x: saved.x, y: saved.y, ...size };
  if (!stillThere && overlap(r, primary.workArea) === 0 && !displays.some((d) => overlap(r, d.workArea) > 0)) return defaultPosition(size, primary);
  return clampToDisplays(r, displays);
}
