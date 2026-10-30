import type { Rect, DisplayLike } from './displays';
import { bodyFootprint, exposedBody, exposedRegions, intersection, intersects } from './exposure';
import { windowAttachment, type PerchWindow } from './perch';
import { SEAT_RATIO } from '../../shared/framing';

export interface SpatialAnchor {
  id: string;
  edge: 'top' | 'left' | 'right';
  bounds: Rect;
  fraction: number;
  mode: 'perch' | 'inverted';
  reclining: boolean;
}
type Point = { x: number; y: number };
const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);

/** One snapshot, stable slots on exposed surfaces. No timers, intentions or AI. */
export function surfaceAnchors(pet: Rect, w: PerchWindow, blockers: Rect[], area: Rect, cursor: Point, preferred?: number, allowed: (r: Rect) => boolean = () => true): SpatialAnchor[] {
  const result: SpatialAnchor[] = [];
  const clear = (r: Rect) => {
    const b = bodyFootprint(r), visible = intersection(b, area);
    return !!visible && visible.width >= b.width * .92 && exposedBody(r, blockers, area) && allowed(r)
      && distance({ x: b.x + b.width / 2, y: b.y + b.height / 2 }, cursor) > 120;
  };
  // Include boundaries of exposed spans, so a partial cover does not hide every slot.
  const strip = { x: w.rect.x, y: w.rect.y, width: w.rect.width, height: 8 };
  const slots = [preferred, .18, .42, .68, ...exposedRegions(strip, blockers).flatMap(r =>
    [(r.x + pet.width * .48 - w.rect.x) / w.rect.width, (r.x + r.width - pet.width * .48 - w.rect.x) / w.rect.width])]
    .filter((f): f is number => f !== undefined && f >= 0 && f <= 1);
  for (const fraction of [...new Set(slots.map(f => Math.round(f * 1000) / 1000))]) {
    const p = windowAttachment(pet, w.rect, SEAT_RATIO, area.y, fraction);
    const center = p.bounds.x + pet.width / 2;
    const contact = { x: center - pet.width * .12, y: w.rect.y, width: pet.width * .24, height: 8 };
    // Keep title-bar controls free, including while sitting upside down.
    if (center + pet.width * .2 > w.rect.x + w.rect.width - 138 || center - pet.width * .2 < w.rect.x + 36) continue;
    if (clear(p.bounds) && !blockers.some(b => intersects(contact, b)))
      result.push({ id: `${w.handle}:top:${fraction}`, edge: 'top', ...p });
  }
  for (const edge of ['left', 'right'] as const) for (const fraction of [.32, .65]) {
    const bounds = { ...pet, x: Math.round(edge === 'left' ? w.rect.x - pet.width * .98 - 10 : w.rect.x + w.rect.width - pet.width * .02 + 10),
      y: Math.round(w.rect.y + w.rect.height * fraction - pet.height * .45) };
    const side = { x: edge === 'left' ? w.rect.x : w.rect.x + w.rect.width - 8, y: bounds.y + pet.height * .35, width: 8, height: pet.height * .2 };
    if (clear(bounds) && !blockers.some(b => intersects(side, b))) result.push({ id: `${w.handle}:${edge}:${fraction}`, edge, bounds, fraction, mode: 'perch', reclining: false });
  }
  return result;
}

/** Inspect an exposed side, ascend along it, then take a real ledge. */
export function surfaceTour(pet: Rect, w: PerchWindow, blockers: Rect[], area: Rect, cursor: Point, sidesOnly = false, preferred?: number, allowed?: (r: Rect) => boolean) {
  if (sidesOnly) blockers = [...blockers, { x: w.rect.x + w.rect.width * .25, y: w.rect.y + w.rect.height * .12, width: w.rect.width * .5, height: w.rect.height * .78 }];
  const anchors = surfaceAnchors(pet, w, blockers, area, cursor, preferred, allowed);
  const tops = anchors.filter(a => a.edge === 'top');
  const perch = tops.find(a => preferred !== undefined && Math.abs(a.fraction - preferred) < .015)
    ?? tops.sort((a, b) => distance(a.bounds, pet) - distance(b.bounds, pet))[0];
  if (!perch) return null;
  const side = anchors.filter(a => a.edge !== 'top').sort((a, b) => distance(a.bounds, perch.bounds) - distance(b.bounds, perch.bounds))[0];
  const approach = { ...perch.bounds, y: perch.bounds.y + (perch.mode === 'inverted' ? 42 : -42) };
  const points = side ? [side.bounds, { ...side.bounds, y: approach.y }, approach] : [approach];
  const safe = points.filter(p => exposedBody(p, blockers, area) && !!intersection(bodyFootprint(p), area) && allowed?.(p) !== false);
  return safe.length ? { points: safe, perch } : null;
}

/** Existing geometry callers can omit a native attachment identity. */
export function tourPlan(pet: Rect, window: Rect, blockers: Rect[], area: Rect, cursor: Point, _random = Math.random, sidesOnly = false) {
  return surfaceTour(pet, { handle: 0n, rect: window }, blockers, area, cursor, sidesOnly);
}

export interface TraversalPlan { kind: 'glide' | 'hop' | 'edge'; points: Rect[] }
export function traversalPoint(from: Rect, plan: TraversalPlan, t: number): Point {
  const to = plan.points.at(-1)!;
  if (plan.kind === 'hop') return { x: from.x + (to.x - from.x) * t,
    y: from.y + (to.y - from.y) * t - 4 * t * (1 - t) * Math.min(65, distance(from, to) * .3) };
  const starts = [from, ...plan.points.slice(0, -1)];
  const lengths = plan.points.map((p, i) => distance(starts[i], p));
  let remaining = t * lengths.reduce((a, b) => a + b, 0);
  for (let i = 0; i < lengths.length; i++) {
    if (remaining <= lengths[i] || i === lengths.length - 1) {
      const u = lengths[i] ? remaining / lengths[i] : 1;
      return { x: starts[i].x + (plan.points[i].x - starts[i].x) * u, y: starts[i].y + (plan.points[i].y - starts[i].y) * u };
    }
    remaining -= lengths[i];
  }
  return to;
}
/** Test swept bodies, not just endpoints. Small, bounded orthogonal detours. */
export function traversalPlan(from: Rect, to: Rect, displays: DisplayLike[], safe: (r: Rect) => boolean, hop = false): TraversalPlan | null {
  const inside = (r: Rect) => displays.some(d => {
    const b = bodyFootprint(r), v = intersection(b, d.workArea);
    return !!v && v.width >= b.width * .9 && v.height >= b.height * .65;
  });
  const segment = (a: Rect, b: Rect) => {
    const steps = Math.ceil(distance(a, b) / 12);
    for (let i = 1; i <= Math.max(1, steps); i++) {
      const t = i / Math.max(1, steps), r = { ...b, x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
      if (!inside(r) || !safe(r)) return false;
    }
    return true;
  };
  if (!inside(to) || !safe(to)) return null;
  if (hop && distance(from, to) < 360) {
    const peak = { ...to, x: (from.x + to.x) / 2, y: Math.min(from.y, to.y) - Math.min(65, distance(from, to) * .3) };
    const plan: TraversalPlan = { kind: 'hop', points: [peak, to] };
    const steps = Math.max(12, Math.ceil(distance(from, to) / 10));
    if (Array.from({ length: steps + 1 }, (_, i) => ({ ...to, ...traversalPoint(from, plan, i / steps) })).every(p => inside(p) && safe(p))) return plan;
  }
  if (segment(from, to)) return { kind: 'glide', points: [to] };
  for (const corner of [{ ...to, x: from.x }, { ...to, y: from.y },
    { ...to, x: from.x, y: Math.min(from.y, to.y) - from.height * .65 }]) {
    if (segment(from, corner) && segment(corner, to)) return { kind: 'edge', points: [corner, to] };
  }
  return null;
}

/** A single visit may dodge once, then investigate; this never schedules a visit. */
export function cursorResponse(pet: Rect, point: Point, previous: Point, area: Rect): Rect {
  const center = { x: pet.x + pet.width * .5, y: pet.y + pet.height * .4 };
  const approaching = distance(point, center) < distance(previous, center) - 8;
  const retreat = approaching && distance(point, center) < pet.width * .75;
  const side = center.x < point.x ? -1 : 1;
  const x = retreat ? pet.x + side * Math.max(70, pet.width * .65) : point.x + side * (pet.width * .5 + 65) - pet.width * .5;
  return { ...pet, x: Math.round(Math.max(area.x, Math.min(area.x + area.width - pet.width, x))),
    y: Math.round(Math.max(area.y, Math.min(area.y + area.height - pet.height, retreat ? pet.y - 18 : point.y - pet.height * .35))) };
}
