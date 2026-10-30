import { Mat, clamp, toPath, type Poly, type Pt } from './geometry';
import { PALETTE as C } from './palette';
import type { Params } from './params';

/**
 * Capri's live face, drawn over the traced pose so it can blink, look, squint, grin and talk.
 * Shapes follow the official close-ups (wiki infobox / Capri_03): a small black angular head, a split
 * green mask, pointed black almond eyes with thorns, blue irises in a green ring, white pupils, and a
 * thin white zigzag mouth that opens into a slot of jagged teeth. Units: 26 = distance between the eyes.
 */
const HEAD: Poly = [[-22, -25], [-27, -9], [-24, 8], [-15, 21], [-5, 30], [1, 33], [6, 29], [16, 19], [24, 6], [27, -10], [21, -26], [8, -32], [-9, -31]];
const MASK_L: Poly = [[-28, -15], [-3, -20], [-2, 4], [-8, 9], [-23, 8], [-29, -2]];
const MASK_R: Poly = [[3, -21], [28, -17], [30, -3], [23, 7], [7, 9], [2, 4]];
const BANGS: Poly[] = [[[-17, -32], [-3, -32], [-8, -14]], [[3, -32], [17, -30], [7, -16]], [[-27, -21], [-15, -28], [-23, -6]]];
const EYE = { w: 12.5, h: 8.4, slant: 0.2, iris: 5.0, ring: 6.8, pupil: 1.7 };
const EYES: [Pt, number, number][] = [[[-13.5, -5.8], 1.08, -0.05], [[13.5, -3.6], 0.92, 0.1]]; // centre, size, extra slant: never a matched pair
const MANY: [number, number, number, number, number][] = [
  [0, -12, 0.61, 0.05, 0], [-22, 4, 0.52, 0.15, -0.3], [22, 4, 0.52, 0.2, 0.3], [-4, 6, 0.43, 0.3, 0.1], [8, -16, 0.41, 0.4, -0.2],
  [-20, -15, 0.43, 0.45, 0.25], [20, -15, 0.43, 0.5, -0.25], [0, 3, 0.36, 0.6, 0], [-12, 8, 0.32, 0.7, 0.4], [12, 8, 0.32, 0.75, -0.4],
];

export function drawFace(ctx: CanvasRenderingContext2D, head: Mat, p: Params, S: number) {
  const yaw = clamp(p.headYaw + p.turn * 0.4, -1, 1);
  const fx = yaw * 4, fy = p.headPitch * 4, squeeze = 1 - Math.abs(yaw) * 0.12;
  const face = (poly: Poly, depth = 1): Poly => poly.map(([x, y]) => [x * squeeze + fx * depth, y + fy * depth]);
  const fill = (poly: Poly, col: string) => { ctx.fillStyle = col; ctx.fill(toPath(head.map(poly))); };

  // head plate (with the violet offset the show draws under every shape)
  const hp = head.map(face(HEAD, 0.35));
  ctx.fillStyle = C.violet; ctx.fill(toPath(hp.map(([x, y]) => [x - 1.6 * S, y + 2 * S] as Pt)));
  ctx.fillStyle = C.ink; ctx.fill(toPath(hp));

  const glow = clamp(p.maskGlow, 0, 1);
  const masks = [MASK_L, MASK_R].map((m) => head.map(face(m)));
  ctx.save();
  if (glow > 0.35) { ctx.shadowColor = C.mask; ctx.shadowBlur = (glow - 0.35) * 16 * S; }
  ctx.fillStyle = C.mask;
  for (const m of masks) ctx.fill(toPath(m));
  ctx.restore();

  for (const [c, size, rot] of EYES) {
    const far = (c[0] < 0 ? yaw > 0 : yaw < 0) ? 1 - Math.abs(yaw) * 0.25 : 1;
    eye(ctx, head, face([c])[0], c[0] < 0 ? -1 : 1, far, size, p, c[0] < 0 ? p.blinkL : p.blinkR, S, rot);
  }
  if (p.manyEyes > 0.03) {
    ctx.save();
    const clip = new Path2D(); for (const m of masks) clip.addPath(toPath(m));
    ctx.clip(clip);
    for (const [x, y, sc, th, rot] of MANY) {
      const grow = clamp((p.manyEyes - th) / 0.12, 0, 1);
      if (grow > 0) eye(ctx, head, face([[x, y]])[0], x < 0 ? -1 : 1, 1, sc * (0.6 + 0.4 * grow), { ...p, squint: p.squint * 0.5 }, 0, S, rot);
    }
    ctx.restore();
  }
  ctx.fillStyle = C.ink;
  for (const b of BANGS) fill(face(b, 0.6), C.ink);
  mouth(ctx, head, face([[0, 19]])[0], p, S);
}

/** Pointed almond eye with thorns; blinks, squints, widens, goes blank or turns into ^ arcs. */
function eye(ctx: CanvasRenderingContext2D, head: Mat, c: Pt, side: -1 | 1, xScale: number, size: number, p: Params, blink: number, S: number, extraRot = 0) {
  const closed = clamp(Math.max(blink, p.sleep * 0.9), 0, 1);
  const sq = clamp(p.squint, 0, 1), wide = clamp(p.eyeWide, 0, 1);
  const m = head.translate(c[0], c[1]).rotate(side * (-EYE.slant - sq * 0.22) + extraRot).scale(xScale * size, size);
  const w = EYE.w * (1 + wide * 0.06);
  const hTop = EYE.h * (1 + wide * 0.3) * (1 - sq * 0.62) * (1 - closed);
  const hBot = EYE.h * 0.82 * (1 + wide * 0.2) * (1 - sq * 0.35) * (1 - closed);
  const almond = (ht: number, hb: number): Poly => {
    const pts: Pt[] = [];
    for (let i = 0; i <= 14; i++) { const x = -w + (2 * w * i) / 14; pts.push([x, -ht * Math.pow(Math.max(0, 1 - (x / w) ** 2), 0.75)]); }
    for (let i = 13; i >= 1; i--) { const x = -w + (2 * w * i) / 14; pts.push([x, hb * Math.pow(Math.max(0, 1 - (x / w) ** 2), 0.9)]); }
    return pts;
  };
  ctx.fillStyle = C.ink;
  for (const t of [[[w * 0.6 * side, hBot * 0.6], [w * 0.85 * side, hBot * 0.3], [w * 0.98 * side, EYE.h * 1.05]], [[-w * 0.4 * side, -hTop * 0.8], [-w * 0.62 * side, -hTop * 0.55], [-w * 0.72 * side, -EYE.h * 1.12]]] as Poly[]) ctx.fill(toPath(m.map(t)));
  if (hTop + hBot < 1.2) { ctx.fill(toPath(m.map(almond(0.8, 0.8)))); return; }
  if (p.happyEyes > 0.5) {
    const arc: Pt[] = [];
    for (let i = 0; i <= 12; i++) { const x = -w + (2 * w * i) / 12; arc.push([x, -EYE.h * 0.55 * (1 - (x / w) ** 2) + EYE.h * 0.15]); }
    const t = EYE.h * 0.38;
    ctx.fill(toPath(m.map([...arc.map(([x, y]) => [x, y - t / 2] as Pt), ...[...arc].reverse().map(([x, y]) => [x, y + t / 2] as Pt)])));
    return;
  }
  const shape = toPath(m.map(almond(hTop, hBot)));
  ctx.fill(shape);
  ctx.save();
  ctx.clip(shape);
  const gx = p.gazeX * w * 0.42, gy = p.gazeY * EYE.h * 0.38;
  const dot = (cx: number, cy: number, r: number, col: string, stroke = 0) => {
    const [x, y] = m.apply([cx, cy]);
    ctx.beginPath();
    ctx.ellipse(x, y, r * Math.hypot(m.a, m.b), r * Math.hypot(m.c, m.d), Math.atan2(m.b, m.a), 0, Math.PI * 2);
    if (stroke) { ctx.strokeStyle = col; ctx.lineWidth = stroke * S * size; ctx.stroke(); } else { ctx.fillStyle = col; ctx.fill(); }
  };
  dot(gx * 0.85 + 0.6 * side, gy * 0.85 - 0.3, EYE.ring, C.mask, 0.8);
  if (p.blankEyes > 0.5) dot(gx * 0.5, gy * 0.5, EYE.iris * 1.35, C.white);
  else { dot(gx, gy, EYE.iris * (1 - wide * 0.15), C.iris); dot(gx, gy, EYE.pupil * (1 - wide * 0.25), C.white); }
  ctx.restore();
}

type MouthIn = Pick<Params, 'mouthOpen' | 'mouthSmile' | 'happyEyes' | 'squint' | 'eyeWide'>;
/** How open her mouth reads: talking, plus the open smile of a happy face or a beaming one. */
function openness(p: MouthIn) {
  const smile = clamp(p.mouthSmile, -1, 1);
  return Math.max(clamp(p.mouthOpen, 0, 1), p.happyEyes > 0.5 ? 0.55 : 0, smile >= 0.95 && p.squint < 0.6 ? 0.3 : 0);
}
/**
 * Which mouth the expression calls for (exported for tests). From the show's clips: at rest a thin
 * wavy zigzag; open — happy, beaming, talking, surprised — a solid white fang shape, wide across the
 * top and pointed below; only the maniac/menace grin (B 3:03, 5:33: eyes wide or narrowed, full smile)
 * is the slot of jagged teeth.
 */
export function mouthShape(p: MouthIn): 'neutral' | 'smirk' | 'frown' | 'fang' | 'teeth' {
  const o = openness(p), smile = clamp(p.mouthSmile, -1, 1);
  if (o > 0.12) return p.mouthOpen > 0.12 && smile >= 0.85 && (p.squint >= 0.6 || p.eyeWide >= 0.7) ? 'teeth' : 'fang';
  if (smile >= 0.6) return 'smirk';
  if (smile <= -0.3) return 'frown';
  return 'neutral';
}

function mouth(ctx: CanvasRenderingContext2D, head: Mat, c: Pt, p: Params, S: number) {
  if (mouthShape(p) === 'fang') fang(ctx, head, c, p, openness(p));
  else zigOrTeeth(ctx, head, c, p, S);
}

/**
 * The open mouth the show draws most: one solid white shape, a wide top edge with a small notch in the
 * middle that tips up at the corners as she smiles, narrowing to a point below. Grows with how open
 * she is (lip-sync drives it while she talks).
 */
function fang(ctx: CanvasRenderingContext2D, head: Mat, c: Pt, p: Params, o: number) {
  const smile = clamp(p.mouthSmile, -1, 1);
  const w = 4.5 + o * 5.5 + Math.max(0, smile) * 2.5;
  const lift = Math.max(0, smile) * 1.6;
  const y0 = -1.2;
  const h = 3 + o * 9.5;
  const tipX = -w * 0.12 * smile; // her grin pulls a little to one side
  const shape: Pt[] = [
    [-w, y0 - lift], [-w * 0.55, y0 - lift * 0.25], [-w * 0.16, y0 + 0.35], [0, y0 + 0.9 + o * 0.6], [w * 0.16, y0 + 0.35], [w * 0.55, y0 - lift * 0.25], [w, y0 - lift],
    [w * 0.45, y0 + h * 0.55], [tipX, y0 + h], [-w * 0.45, y0 + h * 0.55],
  ];
  ctx.fillStyle = C.white;
  ctx.fill(toPath(head.translate(c[0], c[1]).map(shape)));
}

/**
 * At rest a short thin white zigzag; smug, the zigzag with one corner hitched up; cross, corners down;
 * the maniac grin, a wide crescent opening from the corners into a slot of sharp teeth top and bottom.
 */
function zigOrTeeth(ctx: CanvasRenderingContext2D, head: Mat, c: Pt, p: Params, S: number) {
  const open = clamp(p.mouthOpen, 0, 1), smile = clamp(p.mouthSmile, -1, 1);
  const grin = clamp((smile - 0.4) / 0.6, 0, 1); // how far the smile has spread into her grin
  const frown = clamp(-smile, 0, 1);
  const smirk = open < 0.12 ? clamp((smile - 0.45) / 0.4, 0, 1) : 0; // closed smile: one corner up
  const w = 7.5 + grin * 7.5 + open * 1.5 - frown * 2;
  const n = 3 + Math.round(grin * 3 + open * 1.5); // zig count grows with the grin: more teeth
  const lift = smile * 3.4; // corners up (smile) or down (frown)
  const depthMax = open * (3.2 + grin * 3.6) + (1 - grin) * open * 2.2; // open slot height at the centre
  const zigAmp = 0.85 + open * 0.4 - frown * 0.25;
  const pts = n * 2 + 1;
  const upper: Pt[] = [], lower: Pt[] = [];
  for (let i = 0; i < pts; i++) {
    const t = i / (pts - 1), u = 2 * t - 1, x = -w + 2 * w * t;
    const base = -lift * u * u + lift * 0.35 - smirk * 2.6 * Math.max(0, u) ** 1.5; // smile curve, smirk hitch on her left
    const zig = (i % 2 ? zigAmp : -zigAmp) * (1 - 0.5 * u * u);
    // a grin opens as a crescent (nothing at the corners); a plain open mouth is a rounder slot
    const profile = grin > 0.3 ? Math.pow(Math.max(0, 1 - u * u), 0.75) : Math.pow(Math.max(0, 1 - u * u), 0.45);
    const d = depthMax * profile;
    upper.push([x, base + zig - d * 0.35]);
    lower.push([x, base - zig * 0.6 + d * 0.65 + (grin > 0.3 ? lift * 0.25 * (1 - u * u) : 0)]);
  }
  const m = head.translate(c[0], c[1]);
  const U = m.map(upper), Lo = m.map(lower);
  if (open > 0.05) {
    const slot = toPath([...U, ...[...Lo].reverse()]);
    ctx.fillStyle = C.mouthInner; ctx.fill(slot);
    ctx.save(); ctx.clip(slot); ctx.fillStyle = C.white;
    // sharp teeth: one triangle per zig on each jaw, as long as the opening there allows
    const ky = Math.hypot(m.c, m.d);
    for (const [line, other, dir] of [[U, Lo, 1], [Lo, U, -1]] as const) {
      for (let i = 0; i + 2 < line.length; i += 2) {
        const a = line[i], b = line[i + 2], mid = line[i + 1];
        const gap = Math.abs(other[i + 1][1] - mid[1]);
        const len = Math.min(gap * (grin > 0.3 ? 0.55 : 0.4), (1.6 + grin * 2.6) * ky);
        ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.lineTo(mid[0], mid[1] + dir * len); ctx.closePath(); ctx.fill();
      }
    }
    ctx.restore();
  }
  ctx.strokeStyle = C.white; ctx.lineWidth = (1.05 + grin * 0.35) * S; ctx.lineJoin = 'miter';
  for (const line of open > 0.05 ? [U, Lo] : [U]) { ctx.beginPath(); ctx.moveTo(line[0][0], line[0][1]); for (const q of line.slice(1)) ctx.lineTo(q[0], q[1]); ctx.stroke(); }
}
