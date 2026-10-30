import modelData from '../../../assets/capri/model.json';
import { FRAMING, ledgeShift } from '../../shared/framing';
import { Mat, clamp, prng } from './geometry';
import { drawFace } from './face';
import { PALETTE as C } from './palette';
import type { Params } from './params';

/**
 * Capri drawn from her reconstructed vector model (assets/capri/model.json, built by tools/build_model.py
 * from the official stills and show frames). Each pose is a set of palette-flat traced shapes; on top of
 * them the renderer adds everything that makes her alive: glitter on the hair, hair sway and head turns
 * through one smooth deformation field (shared edges move together, so shapes never tear apart),
 * breathing, a float bob, mirroring, a live face, and her glitch bursts.
 */
type Poly = number[][];
interface PoseData { kind: 'sit' | 'lie' | 'float' | 'stand'; back?: boolean; note: string; face: { x: number; y: number; angle: number }; bounds: [number, number, number, number]; layers: Record<string, Poly[]> }
export const POSES = (modelData as unknown as { poses: Record<string, PoseData> }).poses;
export type PoseName = keyof typeof POSES & string;

const FILL: Record<string, string> = { violet: C.violet, hair: C.hair, crimson: C.hair, shade: '#7a0d33', ink: C.ink, green: C.mask };
type GlitchKind = 'slice' | 'shatter' | 'ghost' | 'tear';
interface Shard { x: number; y: number; vx: number; vy: number; r: number; vr: number; s: number; life: number; ink: boolean }

export interface ModelInputs {
  pose: PoseName;
  ledge: boolean; // resting on the taskbar / a window edge (no float bob)
  dragging: boolean;
  glitchEnabled: boolean;
}

export class CapriModel {
  t = 0;
  private pose: PoseName = 'sit';
  private face = 1; // 1 = as drawn, -1 = mirrored
  private faceTarget = 1;
  private sparkle: [CanvasPattern | null, CanvasPattern | null] = [null, null];
  private rand = prng(0xca9e1);
  private readonly swing = 0; // no dangle while dragged: she stays upright where you hold her
  private squash = 0;
  // glitch bursts: she tears, dislocates, shatters and ghosts every few seconds (EFGpu 1:41, 5:10)
  burst = 0;
  stutter = 0;
  ghost = false;
  private kind: GlitchKind = 'tear';
  private burstLeft = 0;
  private burstNext = 2;
  private sliceSeed = 1;
  private shards: Shard[] = [];
  private sparkles: { x: number; y: number; vy: number; life: number }[] = [];

  get currentPose() { return this.pose; }
  get facing() { return this.face; }

  /** Turn to face viewer-left (-1) or viewer-right (1): she snaps round on a glitch frame, like a cut. */
  faceToward(dir: number) {
    if (Math.abs(dir) < 0.2) return;
    const want = dir > 0 ? 1 : -1;
    if (want !== this.faceTarget) { this.faceTarget = want; this.stutter = Math.max(this.stutter, 1); this.startBurst('slice', 0.1); }
  }
  poke() { this.squash = 1; this.startBurst('slice', 0.12); }
  pat() { for (let i = 0; i < 7; i++) this.sparkles.push({ x: (this.rand() * 2 - 1) * 60, y: -40 - this.rand() * 30, vy: -40 - this.rand() * 50, life: 0.8 + this.rand() * 0.5 }); }
  glitchNow(kind: GlitchKind = 'shatter', len = 0.3) { this.startBurst(kind, len); }

  private startBurst(kind: GlitchKind, len: number) {
    this.kind = kind; this.burstLeft = len; this.burst = 1;
    if (kind === 'shatter') this.shards.push(...Array.from({ length: 14 }, () => this.newShard()));
  }
  private newShard(): Shard {
    const r = this.rand, a = -Math.PI * (0.05 + r() * 0.9) + (r() < 0.25 ? Math.PI : 0), sp = 150 + r() * 330;
    return { x: (r() * 2 - 1) * 70, y: -60 - r() * 120, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, r: r() * 6, vr: (r() * 2 - 1) * 9, s: 8 + r() * 20, life: 0.35 + r() * 0.4, ink: r() < 0.3 };
  }
  private updateBurst(dt: number, enabled: boolean, level: number) {
    if (this.burstLeft > 0) {
      this.burstLeft -= dt;
      this.burst = this.burstLeft > 0 ? 0.55 + 0.45 * this.rand() : 0;
      this.ghost = this.burst > 0 && this.kind === 'ghost';
      if (this.burstLeft <= 0) this.burstNext = 2.5 + this.rand() * 6;
      return;
    }
    this.burst = 0; this.ghost = false;
    if (!enabled) return;
    this.burstNext -= dt * (1 + level * 5);
    if (this.burstNext > 0) return;
    const kinds: GlitchKind[] = ['slice', 'shatter', 'ghost', 'tear', 'slice'];
    this.startBurst(kinds[Math.floor(this.rand() * kinds.length)], 0.08 + this.rand() * 0.25);
    if (this.rand() < 0.4) this.stutter = 2 + Math.floor(this.rand() * 2);
  }

  private glitter(ctx: CanvasRenderingContext2D, seed: number) {
    // fine white speckle like the show's hair: many tiny dots, a few 4-point glints
    const N = 128, cv = document.createElement('canvas'); cv.width = N; cv.height = N;
    const g = cv.getContext('2d')!, r = prng(seed);
    for (let i = 0; i < 700; i++) {
      const x = r() * N, y = r() * N, s = 0.25 + r() ** 4 * 1.3;
      g.globalAlpha = 0.6 + r() * 0.4; g.fillStyle = r() < 0.75 ? C.white : C.sparkle;
      g.beginPath();
      if (s > 1.0) { g.moveTo(x - s * 1.8, y); g.lineTo(x, y - s * 0.45); g.lineTo(x + s * 1.8, y); g.lineTo(x, y + s * 0.45); } else g.arc(x, y, s, 0, Math.PI * 2);
      g.fill();
    }
    return ctx.createPattern(cv, 'repeat');
  }

  /**
   * Draw her into a W×H (CSS px) frame. p supplies expression, gaze, head pose, breathing and hair
   * motion; inp picks the pose and context. Returns nothing; the caller composes glitch post-effects.
   */
  draw(ctx: CanvasRenderingContext2D, p: Params, dt: number, inp: ModelInputs, W: number, H: number) {
    this.t += dt;
    if (!this.sparkle[0]) this.sparkle = [this.glitter(ctx, 7), this.glitter(ctx, 1337)];
    if (inp.pose !== this.pose && POSES[inp.pose]) { this.pose = inp.pose; this.stutter = Math.max(this.stutter, 1); this.startBurst('slice', 0.12); }
    this.face = this.faceTarget;
    this.updateBurst(dt, inp.glitchEnabled, p.glitch);
    const P = POSES[this.pose];
    const s = W / FRAMING.unitsW;
    const t = this.t;

    this.squash = Math.max(0, this.squash - dt * 4);

    const floating = !inp.ledge || P.kind === 'float';
    const bob = floating && !inp.dragging ? Math.sin(t * 1.1) * 5 + Math.sin(t * 0.37) * 2.5 + p.bodyY * 0.6 : 0;
    const cx = (P.bounds[0] + P.bounds[2]) / 2;
    const flip = this.face;
    const f = P.face;
    // head turn (look toward cursor / around), sleep droop
    const hx = (p.headYaw * 12 + p.turn * 4) * flip, hy = p.headPitch * 9 + p.sleep * 6;
    const sway = (0.35 + p.hairWind) * 5, stream = -p.hairStream * 34 * flip;
    const breath = (p.breathe - 0.5) * 1.6;

    // one deformation field for every vertex of every layer: neighbouring shapes stay glued together
    const deform = (x: number, y: number): [number, number] => {
      let dx = 0, dy = 0;
      const ddx = x - f.x, ddy = y - f.y, d = Math.hypot(ddx, ddy);
      const wHead = Math.max(0, 1 - d / 85); const wh = wHead * wHead;
      dx += hx * wh; dy += hy * wh;
      const above = clamp((f.y + 40 - y) / 70, 0, 1);
      const wHair = Math.pow(clamp((d - 30) / 260, 0, 1), 1.25) * above;
      if (wHair > 0) {
        const ph = Math.atan2(ddy, ddx);
        dx += wHair * (Math.sin(t * 1.15 + ph * 1.7) * sway + stream);
        dy += wHair * Math.cos(t * 0.9 + ph * 2.3) * sway * 0.45;
      }
      if (y < 0 && y > f.y) dy -= breath * (1 - y / f.y); // chest rises with the breath
      return [x + dx, y + dy];
    };

    const sq = this.squash;
    const lean = Math.sin(t * 0.29) * 0.01 + p.bodyRot * 0.5;
    const sx = flip * s * (1 + sq * 0.1), sy = s * (1 - sq * 0.12);
    // pivot for the dangle is the grab point near the top of the frame
    const base = new Mat()
      .translate(W / 2, H * 0.06).rotate(this.swing).translate(0, FRAMING.seatFromTop * s - H * 0.06 + (bob + (inp.ledge ? ledgeShift(this.pose) : 0)) * s)
      .rotate(lean).scale(sx, sy).translate(-cx, 0);

    const drawBody = (offsetX = 0) => {
      const m = offsetX ? new Mat(1, 0, 0, 1, offsetX, 0).mul(base) : base;
      const path = (poly: Poly) => {
        const pth = new Path2D();
        for (let i = 0; i < poly.length; i++) {
          const [x, y] = deform(poly[i][0], poly[i][1]);
          const [X, Y] = m.apply([x, y]);
          if (i) pth.lineTo(X, Y); else pth.moveTo(X, Y);
        }
        pth.closePath();
        return pth;
      };
      let hairPath: Path2D | null = null;
      for (const cls of ['violet', 'hair', 'crimson', 'shade', 'ink', 'green']) {
        const polys = P.layers[cls];
        if (!polys) continue;
        const all = new Path2D();
        for (const poly of polys) all.addPath(path(poly));
        ctx.fillStyle = FILL[cls]; ctx.strokeStyle = FILL[cls]; ctx.lineWidth = 1.1; ctx.lineJoin = 'round';
        ctx.fill(all, 'evenodd'); ctx.stroke(all);
        if (cls === 'hair') hairPath = all;
      }
      if (hairPath) {
        // the glitter: two speckle layers cross-fading, brighter toward the crown (N 1:51, official stills)
        ctx.save(); ctx.clip(hairPath, 'evenodd');
        const tw = 0.5 + 0.5 * Math.sin(t * 1.3);
        for (const [pat, a, o] of [[this.sparkle[0], 0.55 + 0.35 * tw, 0], [this.sparkle[1], 0.55 + 0.35 * (1 - tw), 31]] as const) {
          if (!pat) continue;
          pat.setTransform?.(new DOMMatrix().translate(o, o * 0.5)); // screen-sized grain, like the show at any zoom
          ctx.globalAlpha = a; ctx.fillStyle = pat; ctx.fillRect(0, 0, W, H);
        }
        ctx.globalAlpha = 1;
        const [sx, sy] = m.apply(deform(f.x, f.y - 130));
        const g = ctx.createRadialGradient(sx, sy, 0, sx, sy, 170 * s);
        g.addColorStop(0, 'rgba(255,170,195,0.35)'); g.addColorStop(1, 'rgba(255,90,130,0)');
        ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
        ctx.restore();
      }
      // the live face, riding the same field as the head around it
      const [fx2, fy2] = m.apply(deform(f.x, f.y));
      const head = new Mat().translate(fx2, fy2).rotate(this.swing + lean).scale(sx, sy).rotate(f.angle + p.headRoll * 0.6);
      if (!P.back) drawFace(ctx, head, p, s); // a back view shows the back of her head, no face
    };

    if (this.burst > 0 && this.kind === 'slice') {
      // dislocation: she tears into horizontal bands that jump sideways
      const r = prng((this.sliceSeed = (this.sliceSeed + (this.rand() < 0.5 ? 1 : 0)) | 0));
      const bands = 7;
      for (let i = 0; i < bands; i++) {
        const off = r() < 0.55 ? (r() * 2 - 1) * W * 0.07 * this.burst : 0;
        ctx.save(); ctx.beginPath(); ctx.rect(0, (H * i) / bands, W, H / bands + 1); ctx.clip();
        drawBody(off);
        ctx.restore();
      }
    } else drawBody();

    // shards thrown off while she shatters; sparkles when patted
    const [ox, oy] = base.apply([P.face.x, P.face.y]);
    for (const sh of this.shards) {
      sh.life -= dt; sh.x += sh.vx * dt; sh.y += sh.vy * dt; sh.r += sh.vr * dt;
      const m = new Mat().translate(ox + sh.x * s, oy + sh.y * s).rotate(sh.r).scale((s * sh.s) / 10);
      const tri = m.map([[-3, -1.4], [3, -1.1], [0.6, 9]]);
      ctx.globalAlpha = clamp(sh.life * 3, 0, 1);
      const pth = (pts: number[][]) => { const q = new Path2D(); q.moveTo(pts[0][0], pts[0][1]); for (const v of pts.slice(1)) q.lineTo(v[0], v[1]); q.closePath(); return q; };
      ctx.fillStyle = C.violet; ctx.fill(pth(tri.map(([x, y]) => [x - 2 * s, y + 2 * s])));
      ctx.fillStyle = sh.ink ? C.ink : C.hair; ctx.fill(pth(tri));
    }
    ctx.globalAlpha = 1;
    this.shards = this.shards.filter((x) => x.life > 0);
    for (const sp of this.sparkles) {
      sp.life -= dt; sp.y += sp.vy * dt;
      const x = ox + sp.x * s, y = oy + sp.y * s, z = 9 * s * 2;
      ctx.globalAlpha = clamp(sp.life, 0, 1); ctx.fillStyle = sp.life > 0.5 ? C.white : C.sparkle;
      ctx.beginPath(); ctx.moveTo(x - z, y); ctx.lineTo(x, y - z * 0.35); ctx.lineTo(x + z, y); ctx.lineTo(x, y + z * 0.35); ctx.closePath(); ctx.fill();
      ctx.beginPath(); ctx.moveTo(x, y - z); ctx.lineTo(x + z * 0.35, y); ctx.lineTo(x, y + z); ctx.lineTo(x - z * 0.35, y); ctx.closePath(); ctx.fill();
    }
    ctx.globalAlpha = 1;
    this.sparkles = this.sparkles.filter((x) => x.life > 0);
  }

  /** Per-pixel hit test against what was drawn. */
  hitTest(ctx: CanvasRenderingContext2D, x: number, y: number, dpr: number) {
    try { return ctx.getImageData(Math.round(x * dpr), Math.round(y * dpr), 1, 1).data[3] > 40; } catch { return false; }
  }

  /** Post-process on the composed frame: ghost double, datamosh smear, scan-line band tearing. */
  post(dst: CanvasRenderingContext2D, src: CanvasImageSource & { width: number; height: number }, amount: number) {
    const r = this.rand, H = src.height, W = src.width;
    if (this.ghost) {
      dst.save(); dst.globalCompositeOperation = 'destination-over'; dst.globalAlpha = 0.5;
      dst.filter = r() < 0.5 ? 'hue-rotate(110deg) saturate(1.6)' : 'hue-rotate(-60deg) saturate(1.4)';
      dst.drawImage(src, Math.round((r() * 2 - 1) * W * 0.05), Math.round((r() * 2 - 1) * H * 0.012));
      dst.restore();
    }
    if (amount > 0.6 && r() < 0.35) {
      const y = Math.floor(H * (0.15 + r() * 0.6)), hh = Math.floor(H * (0.03 + r() * 0.08)), x = Math.floor(r() * W * 0.6), w = Math.floor(W * (0.15 + r() * 0.3));
      dst.drawImage(src, x, y, w, 1, x + (r() * 2 - 1) * W * 0.04, y, w, hh);
    }
    for (let i = 0; i < Math.ceil(amount * 5); i++) {
      const h = Math.max(2, Math.floor(r() * H * 0.04)), y = Math.floor(r() * (H - h)), dx = Math.round((r() * 2 - 1) * W * 0.05 * amount);
      dst.clearRect(0, y, W, h); dst.drawImage(src, 0, y, W, h, dx, y, W, h);
      if (r() < 0.3) { dst.save(); dst.globalCompositeOperation = 'source-atop'; dst.fillStyle = r() < 0.6 ? C.mask : C.hair; const bw = W * (0.2 + r() * 0.5); dst.fillRect(r() * (W - bw), y + h * 0.3, bw, Math.max(2, h * 0.35)); dst.restore(); }
    }
  }
}
