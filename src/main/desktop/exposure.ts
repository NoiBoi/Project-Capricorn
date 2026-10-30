import type { Rect } from './displays';
import { SEAT_RATIO } from '../../shared/framing';
import { restSupport } from './restSupport';
export function helperWindow(info: { title: string; process: string; className?: string }) {
  return /(?:qa[ _-]*osd|geforce.*overlay|nvidia.*(?:overlay|share|hud)|rtss|rivatuner|xbox game bar|gamebar|discord.*overlay)/i.test(info.title + ' ' + info.className)
    || /^(?:nvidia overlay|nvspcap64|gamebar|rtss|presentmon|q[a_ -]*osd)(?:\.exe)?$/i.test(info.process);
}
export const intersects = (a: Rect, b: Rect) => a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
export function intersection(a: Rect, b: Rect): Rect | null {
  const x = Math.max(a.x, b.x), y = Math.max(a.y, b.y), right = Math.min(a.x + a.width, b.x + b.width), bottom = Math.min(a.y + a.height, b.y + b.height);
  return right > x && bottom > y ? { x, y, width: right - x, height: bottom - y } : null;
}
export function exposedRegions(target: Rect, blockers: Rect[]) {
  let regions = [target];
  for (const blocker of blockers) {
    regions = regions.flatMap(r => {
      const cut = intersection(r, blocker); if (!cut) return [r];
      return [{ x: r.x, y: r.y, width: r.width, height: cut.y - r.y },
        { x: r.x, y: cut.y + cut.height, width: r.width, height: r.y + r.height - cut.y - cut.height },
        { x: r.x, y: cut.y, width: cut.x - r.x, height: cut.height },
        { x: cut.x + cut.width, y: cut.y, width: r.x + r.width - cut.x - cut.width, height: cut.height }].filter(p => p.width > 0 && p.height > 0);
    });
    if (regions.length > 128) regions = regions.sort((a, b) => b.width * b.height - a.width * a.height).slice(0, 128);
  }
  return regions;
}
// Include the wider seated art, gestures and mirrored legs, not just the standing torso.
export const bodyFootprint = (pet: Rect): Rect => ({ x: pet.x + pet.width * .02, y: pet.y + pet.height * .10, width: pet.width * .96, height: pet.height * .78 });
export function exposedBody(pet: Rect, blockers: Rect[], area: Rect) {
  const visible = intersection(bodyFootprint(pet), area);
  return !!visible && !blockers.some(b => intersects(visible, b));
}
export function lowerWindowRest(pet: Rect, window: Rect, blockers: Rect[], area: Rect, cursor: { x: number; y: number }, fraction?: number) {
  for (const f of fraction === undefined ? [.18,.82,.38,.62] : [fraction]) {
    const x = Math.round(window.x + f * window.width - pet.width / 2);
    const bounds = { ...pet, x, y: Math.round(window.y + window.height - pet.height * SEAT_RATIO) };
    const clear = (r: Rect) => !blockers.some(b => intersects(r,b));
    if (restSupport(bounds,area,null,[window],clear).lie && exposedBody(bounds,blockers,area)
      && Math.hypot(bounds.x+pet.width*.5-cursor.x,bounds.y+pet.height*.4-cursor.y)>130) return { bounds, fraction:f };
  }
  return null;
}
