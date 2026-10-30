import model from '../../assets/capri/model.json';

/**
 * Character framing, derived from the actual model: the window must hold every pose (mirrored too)
 * plus room for what moves past the silhouette (hair sway, bob, shards, ghost offsets, glitch slices).
 * Poses are centred horizontally and share one seat line, so she sits on a ledge at the same height
 * whichever pose she is in. Main uses this to size and place the window; the renderer to draw into it.
 */
type Bounds = [number, number, number, number];
const poses = (model as unknown as { poses: Record<string, { bounds: Bounds; kind: string }> }).poses;
/**
 * Vertical offset (model units) of a pose's anchor when she rests on a ledge: a sitting pose rests on
 * its seat (legs hang below it); every other pose rests on its lowest point.
 */
export function ledgeShift(pose: string): number {
  const p = poses[pose];
  return !p || p.kind === 'sit' ? 0 : -p.bounds[3];
}
const widest = Math.max(...Object.values(poses).map((p) => p.bounds[2] - p.bounds[0]));
const above = Math.max(...Object.entries(poses).map(([n, p]) => -(p.bounds[1] + ledgeShift(n))));
const below = Math.max(...Object.values(poses).map((p) => p.bounds[3]));
/** Extra room on every side for effects, as a fraction of the larger dimension. */
export const FX_MARGIN = 0.07;
const margin = FX_MARGIN * Math.max(widest, above + below);

export const FRAMING = {
  /** Model units across / down the window. */
  unitsW: widest + 2 * margin,
  unitsH: above + below + 2 * margin,
  /** Model units from the window top to the seat line (where she rests on a ledge). */
  seatFromTop: margin + above,
  /** DIP per model unit at character scale 1 (she is ~400 DIP tall sitting). */
  dipPerUnit: 0.6,
};
export const FRAME_SIZE = { width: Math.round(FRAMING.unitsW * FRAMING.dipPerUnit), height: Math.round(FRAMING.unitsH * FRAMING.dipPerUnit) };
/** Seat line as a fraction of the window height. */
export const SEAT_RATIO = FRAMING.seatFromTop / FRAMING.unitsH;
