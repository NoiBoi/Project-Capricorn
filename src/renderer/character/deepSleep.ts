import { DeepSleepClock } from "../../shared/theatrics";
import { drawConstructMask, polygon } from "./constructArt";
export class DeepSleep {
  readonly clock = new DeepSleepClock();
  private t = 0;
  get active() {
    return this.clock.amount > 0;
  }
  get amount() {
    return this.clock.amount;
  }
  update(dt: number, sleeping: boolean, enabled: boolean, preview: boolean) {
    this.t += dt;
    return this.clock.update(dt, sleeping, enabled, preview);
  }
  draw(g: CanvasRenderingContext2D, W: number, H: number, reduced: boolean) {
    const a = this.amount;
    if (a <= 0) return;
    const x = W * 0.5,
      y = H * 0.45 + (reduced ? 0 : Math.sin(this.t * 0.65) * 2),
      k = Math.min(W / 310, H / 420) * 0.9;
    g.save();
    g.globalAlpha = a;
    if (!reduced && a < 0.99)
      for (let i = 0; i < 24; i++) {
        const angle = i * 2.399,
          radius = (1 - a) * W * 0.37;
        const px = x + Math.cos(angle) * radius,
          py = y + Math.sin(angle) * radius * 0.9;
        polygon(
          g,
          [
            [px, py - 7],
            [px + 3, py + 4],
            [px - 3, py + 7],
          ],
          i % 3 === 0 ? "#22f27a" : i % 3 === 1 ? "#f2154c" : "#7b3df2",
        );
      }
    const waking = this.clock.asleep === 0,
      peek = !waking && Math.floor(this.t) % 23 === 17;
    drawConstructMask(
      g,
      x,
      y,
      k,
      waking ? Math.max(0.1, 1 - a) : peek ? 0.5 : 0,
      0,
      peek,
    );
    g.restore();
  }
  hit(x: number, y: number, W: number, H: number) {
    const k = Math.min(W / 310, H / 420) * 0.9;
    return Math.abs(x - W * 0.5) < 48 * k && Math.abs(y - H * 0.45) < 37 * k;
  }
}
