import type { AssistantPhase } from '../../shared/ipc';

/** Official-frame cut-ins sourced and credited separately from the MIT code. */
export class StatusFx {
  private phase: AssistantPhase = 'idle';
  private elapsed = 0;
  private impact = 0;
  private readonly error = new Image();
  private cutins = new Map<string, HTMLImageElement>();
  private cutin: { kind: string; left: number } | null = null;
  private sinceCutin = 100;
  show(kind: 'grin' | 'laugh' | 'look' | 'eyes' | 'many', force = false) { if (!force && this.sinceCutin < 35) return; this.cutin = { kind, left: 1.3 }; this.sinceCutin = 0; }
  clear() { this.cutin = null; this.impact = 0; }
  get currentCutin() { return this.cutin?.kind ?? null; }
  constructor() { this.error.src = 'capri/mochiiwuff/cutin-many.png'; for (const name of ['grin','laugh','look','eyes','many']) { const image = new Image(); image.src = `capri/mochiiwuff/cutin-${name}.png`; this.cutins.set(name,image); } }
  setPhase(phase: AssistantPhase) {
    if (phase === this.phase) return;
    this.phase = phase; this.elapsed = 0;
    this.impact = phase === 'error' ? 1.2 : 0;
  }
  draw(ctx: CanvasRenderingContext2D, dt: number, W: number, H: number, inverted: boolean, effects: boolean) {
    this.sinceCutin += dt; if (this.cutin) { this.cutin.left -= dt; if (this.cutin.left <= 0) this.cutin = null; }
    this.elapsed += dt; this.impact = Math.max(0, this.impact - dt);
    const waiting = this.phase === 'thinking' || this.phase === 'transcribing';
    const y = H * (inverted ? 0.84 : 0.12);
    ctx.save();
    if (waiting) {
      const slow = this.elapsed >= 15;
      ctx.fillStyle = '#14101c'; ctx.fillRect(W * (slow ? 0.24 : 0.43), y - 12, W * (slow ? 0.52 : 0.14), 21);
      ctx.fillStyle = slow ? '#b38aff' : '#36ff7a';
      ctx.font = '10px monospace'; ctx.textAlign = 'center';
      if (slow) ctx.fillText(`STILL HERE ${Math.floor(this.elapsed)}s`, W / 2, y);
      else for (let i = 0; i < 3; i++) { ctx.globalAlpha = effects ? 0.3 + ((Math.floor(this.elapsed * 2) + i) % 3) * 0.3 : 0.7; ctx.fillRect(W / 2 - 12 + i * 10, y - 3, 4, 4); }
    }
    if (this.impact > 0 && effects && this.error.complete && this.error.naturalWidth) {
      const w = W * 0.64, h = w * 2 / 3, x = (W - w) / 2, top = Math.max(8, Math.min(H - h - 8, y));
      ctx.globalAlpha = Math.min(1, this.impact * 3);
      ctx.fillStyle = '#7b3dff'; ctx.fillRect(x + 5, top + 5, w, h);
      ctx.drawImage(this.error, x, top, w, h);
      ctx.strokeStyle = '#ff2152'; ctx.lineWidth = 2; ctx.strokeRect(x, top, w, h);
    }
    if (this.cutin && effects) {
      const image = this.cutins.get(this.cutin.kind);
      if (image?.complete && image.naturalWidth) {
        const w = Math.min(185,W*.34), h=w*image.naturalHeight/image.naturalWidth;
        const x = (W-w)/2, top = inverted ? H*.75 : 12;
        ctx.globalAlpha = Math.max(0,Math.min(1,this.cutin.left*5));
        ctx.fillStyle='#7b3df2';ctx.fillRect(x+3,top+3,w,h);ctx.drawImage(image,x,top,w,h);
        ctx.strokeStyle='#f2154c';ctx.lineWidth=1.5;ctx.strokeRect(x,top,w,h);
      }
    }
    ctx.restore();
  }
}
