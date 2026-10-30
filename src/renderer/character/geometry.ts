export type Pt = [number, number];
export type Poly = Pt[];

/** 2D affine matrix [a b c d e f] (same layout as canvas setTransform). */
export class Mat {
  constructor(public a = 1, public b = 0, public c = 0, public d = 1, public e = 0, public f = 0) {}
  static identity() { return new Mat(); }
  clone() { return new Mat(this.a, this.b, this.c, this.d, this.e, this.f); }
  mul(m: Mat): Mat {
    return new Mat(
      this.a * m.a + this.c * m.b, this.b * m.a + this.d * m.b,
      this.a * m.c + this.c * m.d, this.b * m.c + this.d * m.d,
      this.a * m.e + this.c * m.f + this.e, this.b * m.e + this.d * m.f + this.f,
    );
  }
  translate(x: number, y: number) { return this.mul(new Mat(1, 0, 0, 1, x, y)); }
  rotate(r: number) { const c = Math.cos(r), s = Math.sin(r); return this.mul(new Mat(c, s, -s, c, 0, 0)); }
  scale(x: number, y = x) { return this.mul(new Mat(x, 0, 0, y, 0, 0)); }
  apply([x, y]: Pt): Pt { return [this.a * x + this.c * y + this.e, this.b * x + this.d * y + this.f]; }
  map(p: Poly): Poly { return p.map((v) => this.apply(v)); }
}

export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
export const offset = (p: Poly, dx: number, dy: number): Poly => p.map(([x, y]) => [x + dx, y + dy]);
export const mirrorX = (p: Poly): Poly => p.map(([x, y]) => [-x, y]);

/** Bend a polygon around a pivot: rotation grows with distance (hair/strand sway). */
export function bend(p: Poly, pivot: Pt, angle: number, length: number): Poly {
  return p.map(([x, y]) => {
    const dx = x - pivot[0], dy = y - pivot[1];
    const d = Math.hypot(dx, dy);
    const a = angle * Math.min(1.6, d / length) ** 1.3;
    const c = Math.cos(a), s = Math.sin(a);
    return [pivot[0] + dx * c - dy * s, pivot[1] + dx * s + dy * c];
  });
}

export function toPath(p: Poly): Path2D {
  const path = new Path2D();
  if (!p.length) return path;
  path.moveTo(p[0][0], p[0][1]);
  for (let i = 1; i < p.length; i++) path.lineTo(p[i][0], p[i][1]);
  path.closePath();
  return path;
}

/** Thick polyline as a polygon (for limbs). widths per joint. */
export function limb(points: Pt[], widths: number[]): Poly {
  const left: Pt[] = [], right: Pt[] = [];
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    const a = points[Math.max(0, i - 1)], b = points[Math.min(points.length - 1, i + 1)];
    let nx = -(b[1] - a[1]), ny = b[0] - a[0];
    const l = Math.hypot(nx, ny) || 1;
    nx /= l; ny /= l;
    const w = widths[i] / 2;
    left.push([p[0] + nx * w, p[1] + ny * w]);
    right.push([p[0] - nx * w, p[1] - ny * w]);
  }
  return [...left, ...right.reverse()];
}

/** Mulberry32 — deterministic, so textures never change between frames or sessions. */
export function prng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
