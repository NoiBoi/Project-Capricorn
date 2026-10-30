import { PoseShader } from './poseShader';
export const SECONDARY_POSES = ['sit_closed', 'recline'] as const;
export type SecondaryPose = typeof SECONDARY_POSES[number];
// Alpha bounds and landmarks measured on the cleaned source assets. Anchors are relative to that crop.
const DEFINITIONS = {
  sit_closed: { crop: [245, 9, 893, 1190], contact: .79, face: [.53, .515], head: [.53, .34, .48, .35], hair: [.53, .035] },
  recline: { crop: [12, 5, 2006, 764], contact: .93, face: [.72, .73], head: [.80, .43, .21, .47], hair: [.80, .05] },
} as const;
export class SecondarySprites {
  private images = new Map<SecondaryPose, HTMLImageElement>();
  private shader = new PoseShader();
  private reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  get shaderActive() { return this.shader.available; }
  get reduced() { return this.reducedMotion.matches; }
  motion = 0;
  readonly ready = Promise.all(SECONDARY_POSES.map(name => new Promise<void>((resolve, reject) => {
    const image = new Image(); image.onload = () => { this.images.set(name, image); resolve(); }; image.onerror = () => reject(new Error(`Missing secondary ${name}`));
    image.src = `capri/secondary/${name === 'recline' ? 'recline-palette' : 'sit-soft-closed'}.png`;
  }))).then(() => undefined);
  draw(ctx: CanvasRenderingContext2D, name: SecondaryPose, W: number, H: number, anchor: number, inverted: boolean, time: number, intensity: number) {
    const image = this.images.get(name); if (!image) return null;
    const def = DEFINITIONS[name], [sx, sy, sw, sh] = def.crop;
    const topRoom = inverted ? H - anchor : anchor, bottomRoom = inverted ? anchor : H - anchor;
    const fit = Math.min(W * .92 / sw, (topRoom - 8) / (sh * def.contact), (bottomRoom - 8) / (sh * (1 - def.contact)));
    // Intermediate presentation size: the previous 160px reference felt too small,
    // while filling the entire window made this wide sitting cutout too large.
    const primaryScale = Math.min(W * .88 / 384, H * .90 / 384);
    const scale = name === 'recline' ? fit : Math.min(fit, primaryScale * 240 / 874);
    const width = sw * scale, height = sh * scale, x = (W - width) / 2, y = anchor - height * def.contact;
    const dpr = Math.max(1, ctx.canvas.width / W);
    this.motion = this.reducedMotion.matches ? 0 : intensity;
    const animated = this.shader.render(image, def.crop, width * dpr, height * dpr, time, this.motion, name === 'recline');
    if (animated) ctx.drawImage(animated, x, y, width, height);
    else ctx.drawImage(image, sx, sy, sw, sh, x, y, width, height);
    return { body: { x, y, width, height }, face: { x: x + width * def.face[0], y: y + height * def.face[1] },
      hair: { x: x + width * def.hair[0], y: y + height * def.hair[1] },
      head: { x: x + width * def.head[0], y: y + height * def.head[1], rx: width * def.head[2], ry: height * def.head[3] } };
  }
}
