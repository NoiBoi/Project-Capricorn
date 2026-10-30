import type { Rect } from './displays';

export interface PerchWindow { handle: bigint; rect: Rect }
import { SEAT_RATIO } from '../../shared/framing';
export const INVERTED_SEAT_RATIO = 1 - SEAT_RATIO;

/** Leave room for the whole seated silhouette; otherwise sit upside down beneath the title bar. */
export function windowAttachment(pet: Rect, window: Rect, seatRatio: number, screenTop: number, fraction?: number, previous?: 'perch' | 'recline' | 'inverted') {
  // Hysteresis prevents flickering between poses near the threshold.
  const canLie = window.width >= pet.width * .92;
  const seatedClearance = pet.height * (seatRatio - (previous === 'recline' ? .10 : .14));
  // The wide, shallow lying silhouette fits far closer to the screen top.
  const clearance = canLie ? pet.width * .34 + 12 + (previous === 'inverted' ? pet.height * .025 : 0) : seatedClearance;
  const mode = window.y - screenTop < clearance ? 'inverted' as const : 'perch' as const;
  const reclining = mode === 'perch' && canLie && window.y - screenTop < seatedClearance;
  return { ...attachToWindow(pet, window, mode === 'inverted' ? INVERTED_SEAT_RATIO : seatRatio, fraction, reclining ? .46 : .22), mode, reclining };
}

/** Snap by the visible seat, rather than the large transparent renderer rectangle. */
export function snapWindow(windows: PerchWindow[], pet: Rect, seatRatio: number, distance = 56, screenTop?: (window: Rect) => number, canSnap?: (window: PerchWindow) => boolean): PerchWindow | null {
  const x = pet.x + pet.width / 2, y = pet.y + pet.height * seatRatio;
  return windows.map(window => {
    const w = window.rect;
    const inverted = screenTop && windowAttachment(pet, w, seatRatio, screenTop(w)).mode === 'inverted';
    const gap = Math.min(Math.abs(y - w.y), inverted ? Math.abs(pet.y + pet.height * INVERTED_SEAT_RATIO - w.y) : Infinity);
    return { window, gap, within: x >= w.x && x <= w.x + w.width };
  }).filter(c => c.within && c.gap <= distance)
    .sort((a, b) => a.gap - b.gap)
    .find(c => !canSnap || canSnap(c.window))?.window ?? null;
}

export function attachToWindow(pet: Rect, window: Rect, seatRatio: number, fraction?: number, footprint = .22): { bounds: Rect; fraction: number } {
  const f = Math.max(0, Math.min(1, fraction ?? (pet.x + pet.width / 2 - window.x) / window.width));
  const inset = Math.min(pet.width * footprint, window.width / 2);
  const center = Math.max(window.x + inset, Math.min(window.x + window.width - inset, window.x + f * window.width));
  return { bounds: { ...pet, x: Math.round(center - pet.width / 2), y: Math.round(window.y - pet.height * seatRatio) }, fraction: f };
}
