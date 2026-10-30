import { prng } from './geometry';
import { PALETTE as C } from './palette';

/**
 * Teleport effect, composited from the rendered character (offscreen canvas). Everything happens on her
 * own silhouette: the effect measures where her pixels are at the start of each phase, tears her into
 * horizontal bands across her body, splits her colours, and breaks her into shards cut from her own
 * pixels — so the glitch is exactly where she is, and where she lands.
 * Departure: bands jitter wider and wider, colour split, she shatters outward and is gone.
 * Arrival: shards fly in to their places on her body, bands snap into line, one hard flicker, clean.
 * After her glitch-shard visuals (N 2:54) and the show's hard-cut entrances.
 */
export type FxPhase = 'out' | 'in';
interface Shard { x: number; y: number; dx: number; dy: number; rot: number; vr: number; size: number; color: string }
type Box = { x: number; y: number; w: number; h: number };
/** Device-pixel geometry follows the visible silhouette, including flipped poses and display scale. */
export function beamBounds(box: Box, dpr: number): Box {
  const w = Math.max(2 * dpr, Math.min(7 * dpr, box.w * 0.055));
  return { x: box.x + (box.w - w) / 2, y: box.y - 8 * dpr, w, h: box.h + 16 * dpr };
}

export const FX_DURATION: Record<FxPhase, number> = { out: 0.42, in: 0.4 };

const easeOut = (x: number) => 1 - (1 - x) ** 3;

export class TeleportFx {
  phase: FxPhase | null = null;
  t = 0;
  private duration = 0.42;
  id = 0;
  private shards: Shard[] = [];
  private box: Box | null = null; // her silhouette, device px, measured on the first frame of a phase
  private tint: Record<string, HTMLCanvasElement> = {};
  /** Phases completed (for tests/diagnostics). */
  readonly log: string[] = [];
  onDone: ((id: number, phase: FxPhase) => void) | null = null;

  constructor(private makeCanvas: () => HTMLCanvasElement) {}

  get active() { return this.phase !== null; }
  /** 0..1 progress of the current phase. */
  get u() { return this.phase ? Math.min(1, this.t / this.duration) : 0; }
  /** Whether the character should be considered invisible (between out and in). */
  hidden = false;

  /** `_focus` is kept for callers; the effect finds her itself from the rendered frame. */
  start(phase: FxPhase, id: number, _focus?: unknown, duration = FX_DURATION[phase]) {
    this.phase = phase;
    this.duration = duration;
    this.t = 0;
    this.id = id;
    this.hidden = false;
    this.box = null;
    this.shards = [];
  }

  /** Her bounding box and shards sampled from her opaque pixels (with their colours). */
  private measure(src: HTMLCanvasElement, dpr: number) {
    const W = src.width, H = src.height;
    const data = src.getContext('2d')!.getImageData(0, 0, W, H).data;
    let x0 = W, y0 = H, x1 = -1, y1 = -1;
    const step = Math.max(2, Math.round(3 * dpr));
    const opaque: number[] = [];
    for (let y = 0; y < H; y += step) for (let x = 0; x < W; x += step) {
      if (data[(y * W + x) * 4 + 3] > 120) { opaque.push(x, y); if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    }
    this.box = x1 < 0 ? { x: W * 0.2, y: H * 0.1, w: W * 0.6, h: H * 0.8 } : { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
    const r = prng(this.id * 7919 + (this.phase === 'out' ? 1 : 2));
    const n = opaque.length / 2;
    const cx = this.box.x + this.box.w / 2, cy = this.box.y + this.box.h * 0.45;
    this.shards = Array.from({ length: n ? 70 : 0 }, () => {
      const k = Math.floor(r() * n), x = opaque[2 * k], y = opaque[2 * k + 1];
      const i = (y * W + x) * 4;
      const a = Math.atan2(y - cy, x - cx) + (r() - 0.5) * 0.9;
      const dist = (0.35 + r() * 0.9) * Math.max(this.box!.w, this.box!.h) * 0.6;
      return { x, y, dx: Math.cos(a) * dist, dy: Math.sin(a) * dist, rot: r() * 6, vr: (r() - 0.5) * 14, size: (3 + r() * 9) * dpr, color: `rgb(${data[i]},${data[i + 1]},${data[i + 2]})` };
    });
  }

  /** Called every frame with the freshly rendered character in `src`. Draws into `dst`. */
  render(dst: CanvasRenderingContext2D, src: HTMLCanvasElement, dt: number, dpr: number) {
    const W = src.width, H = src.height;
    dst.setTransform(1, 0, 0, 1, 0, 0);
    dst.clearRect(0, 0, W, H);
    if (!this.phase) {
      if (!this.hidden) dst.drawImage(src, 0, 0);
      return;
    }
    if (!this.box) this.measure(src, dpr);
    const box = this.box!;
    this.t += dt;
    const u = this.u;
    const out = this.phase === 'out';
    // how broken she is: 0 = whole, 1 = gone
    const broken = out ? Math.min(1, u / 0.85) : 1 - easeOut(Math.min(1, u / 0.8));
    const r = prng(Math.floor(this.t * 60) + this.id * 31);
    const flick = r() < 0.18; // the show's hard-cut stutter: a frame here and there drops out

    // A short, narrow transport filament inside her own window. No display-sized overlay.
    // Adapted from capri-desktop's MIT beam concept; the artwork remains separately credited.
    const beam = beamBounds(box, dpr);
    const fade = Math.sin(Math.PI * u) * 0.55;
    dst.globalAlpha = fade;
    dst.fillStyle = C.violet; dst.fillRect(beam.x - 2 * dpr, beam.y, beam.w + 4 * dpr, beam.h);
    dst.fillStyle = '#ff4871'; dst.fillRect(beam.x, beam.y, beam.w, beam.h);
    dst.globalAlpha = fade * 0.7;
    dst.fillStyle = '#fff4f6'; dst.fillRect(beam.x + beam.w / 2 - dpr / 2, beam.y, dpr, beam.h);
    dst.globalAlpha = 1;

    // body: horizontal bands across her own height, offset sideways more the more broken she is;
    // bands drop out as she breaks, and fill back in on arrival
    const present = out ? 1 - Math.max(0, (u - 0.55) / 0.45) : Math.min(1, u / 0.35);
    if (present > 0 && !(flick && broken > 0.5)) {
      // Collapse/re-form the silhouette into the transport slit, as in capri-desktop (MIT).
      dst.save();
      const cx = box.x + box.w / 2, cy = box.y + box.h / 2;
      dst.translate(cx, cy); dst.scale(Math.max(0.06, 1 - broken * 0.94), 1 - broken * 0.12); dst.translate(-cx, -cy);
      const bands = 18, bh = Math.ceil(box.h / bands) + 1;
      const chroma = broken * 14 * dpr;
      for (let i = 0; i < bands; i++) {
        if (r() > present + 0.15) continue; // missing band
        const y = box.y + i * (box.h / bands);
        const shift = (r() < 0.7 ? (r() - 0.5) * 2 : 0) * box.w * 0.22 * broken;
        if (chroma > 1) {
          for (const [col, dx] of [[C.violet, -chroma], [C.mask, chroma]] as const) {
            dst.globalAlpha = 0.6 * broken;
            dst.drawImage(this.tinted(src, col), 0, y, W, bh, shift + dx, y, W, bh);
          }
        }
        dst.globalAlpha = 1;
        dst.drawImage(src, 0, y, W, bh, shift, y, W, bh);
      }
      dst.globalAlpha = 1;
      dst.restore();
    }
    // glitch blocks: solid slabs of her colours over her body while she is breaking
    const blocks = Math.round(broken * (1 - broken) * 4 * 9);
    for (let i = 0; i < blocks; i++) {
      dst.fillStyle = [C.hair, C.mask, C.violet, C.ink][Math.floor(r() * 4)];
      dst.globalAlpha = 0.85;
      dst.fillRect(box.x + r() * box.w * 0.9, box.y + r() * box.h, (8 + r() * 46) * dpr, (2 + r() * 7) * dpr);
    }
    dst.globalAlpha = 1;
    // shards cut from her: fly out from where they were on her body, or fly in to it
    const sk = out ? Math.max(0, (u - 0.25) / 0.75) : 1 - Math.min(1, u / 0.7);
    if (sk > 0) {
      for (const s of this.shards) {
        const tt = easeOut(sk);
        dst.globalAlpha = out ? Math.max(0, 1 - sk * 0.9) : Math.min(1, sk * 1.4);
        dst.fillStyle = s.color;
        dst.setTransform(1, 0, 0, 1, s.x + s.dx * tt, s.y + s.dy * tt + 60 * dpr * tt * tt);
        dst.rotate(s.rot + s.vr * tt);
        const z = s.size;
        dst.beginPath(); dst.moveTo(-z, -z * 0.4); dst.lineTo(z, 0); dst.lineTo(-z * 0.3, z * 0.6); dst.closePath(); dst.fill();
      }
      dst.setTransform(1, 0, 0, 1, 0, 0);
      dst.globalAlpha = 1;
    }
    // Brief green/ink impact cut on arrival; the final frame is always clean.
    if (!out && u > 0.35 && u < 0.52) {
      dst.globalAlpha = 0.85;
      dst.drawImage(this.tinted(src, u < 0.44 ? C.mask : C.ink), 0, 0);
      dst.globalAlpha = 1;
    }
    if (u >= 1) {
      const done = this.phase;
      this.phase = null;
      this.hidden = done === 'out';
      this.log.push(`${this.id}:${done}`);
      if (this.log.length > 40) this.log.shift();
      dst.clearRect(0, 0, W, H);
      if (!this.hidden) dst.drawImage(src, 0, 0);
      this.onDone?.(this.id, done);
    }
  }

  /** Character silhouette filled with a flat colour (cached canvas per colour). */
  private tinted(src: HTMLCanvasElement, col: string) {
    let c = this.tint[col];
    if (!c) { c = this.makeCanvas(); this.tint[col] = c; }
    if (c.width !== src.width || c.height !== src.height) { c.width = src.width; c.height = src.height; }
    const g = c.getContext('2d')!;
    g.globalCompositeOperation = 'source-over';
    g.clearRect(0, 0, c.width, c.height);
    g.drawImage(src, 0, 0);
    g.globalCompositeOperation = 'source-in';
    g.fillStyle = col;
    g.fillRect(0, 0, c.width, c.height);
    g.globalCompositeOperation = 'source-over';
    return c;
  }
}
