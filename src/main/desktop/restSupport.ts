import type { Rect } from './displays';
import type { PoseSupport } from '../../shared/secondaryBehavior';
import { SEAT_RATIO } from '../../shared/framing';
/** Only established horizontal contact lines count. No imaginary beds in mid-air. */
export function restSupport(pet: Rect, area: Rect, perch: { rect: Rect; inverted: boolean; reclining?: boolean } | null, windows: Rect[], clear: (r: Rect) => boolean): PoseSupport {
  const seat = pet.y + pet.height * SEAT_RATIO;
  const span = { left: pet.x + pet.width * .04, right: pet.x + pet.width * .96 };
  const lyingBody = { x: span.left, y: seat - pet.width * .34, width: span.right - span.left, height: pet.width * .37 };
  const space = lyingBody.y >= area.y + 4 && lyingBody.x >= area.x && lyingBody.x + lyingBody.width <= area.x + area.width && clear(lyingBody);
  if (perch) {
    const fits = span.left >= perch.rect.x - 4 && span.right <= perch.rect.x + perch.rect.width + 4;
    return { sit: true, lie: !perch.inverted && fits && space, kind: 'window_top', tight: !!perch.reclining };
  }
  if (Math.abs(seat - area.y - area.height) <= 12) return { sit: true, lie: space, kind: 'taskbar' };
  const bottom = windows.find(w => Math.abs(seat - w.y - w.height) <= 14 && pet.x+pet.width*.5 >= w.x && pet.x+pet.width*.5 <= w.x+w.width && seat > w.y+12 && clear({x:Math.max(w.x,pet.x+pet.width*.38),y:seat-3,width:Math.min(w.width,pet.width*.24),height:6}));
  if (bottom) return { sit: true, lie: space && span.left>=bottom.x && span.right<=bottom.x+bottom.width && lyingBody.y>=bottom.y+4, kind: 'window_bottom' };
  return { sit: false, lie: false, kind: 'none' };
}
