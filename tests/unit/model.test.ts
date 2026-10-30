import { describe, expect, it } from 'vitest';
import model from '../../assets/capri/model.json';
import { FRAMING, FRAME_SIZE, SEAT_RATIO, ledgeShift } from '../../src/shared/framing';

type Pose = { kind: string; face: { x: number; y: number; angle: number }; bounds: [number, number, number, number]; layers: Record<string, number[][][]> };
const poses = (model as unknown as { poses: Record<string, Pose> }).poses;
const SWAY = 14, BOB = 8; // most the hair sway / float bob can move a vertex, in model units

describe('character model (traced from the reference stills)', () => {
  it('has the poses the desktop behaviour needs, each a clean set of palette shapes with a face', () => {
    expect(Object.keys(poses).sort()).toEqual(['back', 'crouch', 'lie', 'sit']);
    for (const [name, p] of Object.entries(poses)) {
      expect(['sit', 'lie', 'float', 'stand']).toContain(p.kind);
      expect(Object.keys(p.layers)).toEqual(expect.arrayContaining(['hair', 'violet', 'ink']));
      for (const [cls, polys] of Object.entries(p.layers)) {
        expect(['violet', 'hair', 'crimson', 'shade', 'ink', 'green'], `${name}.${cls}`).toContain(cls);
        for (const poly of polys) {
          expect(poly.length).toBeGreaterThanOrEqual(3);
          for (const [x, y] of poly) expect(Number.isFinite(x) && Number.isFinite(y)).toBe(true);
        }
      }
      // the live face sits inside the figure, near the top of the body
      expect(p.face.x).toBeGreaterThan(p.bounds[0]); expect(p.face.x).toBeLessThan(p.bounds[2]);
      expect(p.face.y).toBeGreaterThan(p.bounds[1]); expect(p.face.y).toBeLessThan(p.bounds[3]);
    }
  });

  it('every pose, mirrored or not, in the air or on a ledge, fits her window with room for sway and bob', () => {
    for (const [name, p] of Object.entries(poses)) {
      const cx = (p.bounds[0] + p.bounds[2]) / 2;
      for (const ledge of [false, true]) {
        const shift = ledge ? ledgeShift(name) : 0;
        const half = Math.max(cx - p.bounds[0], p.bounds[2] - cx) + SWAY; // centred, either facing
        expect(2 * half, `${name} width`).toBeLessThanOrEqual(FRAMING.unitsW);
        const top = FRAMING.seatFromTop + p.bounds[1] + shift - SWAY - BOB;
        const bottom = FRAMING.seatFromTop + p.bounds[3] + shift + BOB;
        expect(top, `${name} top (ledge=${ledge})`).toBeGreaterThanOrEqual(0);
        expect(bottom, `${name} bottom (ledge=${ledge})`).toBeLessThanOrEqual(FRAMING.unitsH);
      }
    }
  });

  it('poses used on the taskbar never hang below the seat line (nothing drawn off the bottom of the screen)', () => {
    for (const name of ['lie', 'crouch']) expect(poses[name].bounds[3] + ledgeShift(name)).toBeLessThanOrEqual(0.5);
  });

  it('frame and seat line are derived consistently', () => {
    expect(SEAT_RATIO).toBeGreaterThan(0.5); expect(SEAT_RATIO).toBeLessThan(0.95);
    expect(FRAME_SIZE.width / FRAME_SIZE.height).toBeCloseTo(FRAMING.unitsW / FRAMING.unitsH, 1);
  });
});
