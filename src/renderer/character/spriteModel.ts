import { CapriModel as VectorModel, type ModelInputs, type PoseName } from './model';
import { SEAT_RATIO } from '../../shared/framing';
import { activityMotion, type ActivityKind } from '../../shared/activity';
import { FacingDelay } from '../../shared/facing';
import { SecondarySprites, type SecondaryPose } from './secondarySprites';
import { flourishMotion, type FlourishKind } from '../../shared/theatrics';
import { SecondaryBehavior, type PoseSupport } from '../../shared/secondaryBehavior';
import type { LifeFrame } from '../../shared/personality';
import type { Params } from './params';
import { SPRITE_CLIPS, spriteBase, spriteFrame, spriteFacing, type SpriteClip } from './spriteClips';

/** Draw the original PNG cells without tracing, recoloring, or replacing their linework. */
export class CapriSpriteModel extends VectorModel {
  readonly artwork = 'lachydotmcg';
  readonly images = new Map<SpriteClip, HTMLImageElement>();
  readonly ready: Promise<void>;
  activeClip: SpriteClip = 'idle';
  activeFrame = 0;
  activeSecondary: SecondaryPose | null = null;
  private secondary = new SecondarySprites();
  private secondaryBehavior = new SecondaryBehavior();
  secondaryReason = 'primary';
  secondaryClosed = false;
  get secondaryRendererState() { return { pose: this.activeSecondary, shader: this.secondary.shaderActive, reduced: this.secondary.reduced, motion: this.activeSecondary ? this.secondary.motion : 0 }; }
  get secondaryShaderActive() { return this.secondary.shaderActive; }
  resetSecondary() { this.secondaryBehavior = new SecondaryBehavior(); this.activeSecondary = null; }
  private secondaryHead: { x: number; y: number; rx: number; ry: number } | null = null;
  speechAnchor = { x: .5, y: .28 };
  private spritePose: PoseName = 'sit';
  private direction = 1;
  private previousY: number | null = null;
  private poseOffsetY = 0;
  private previousPerch: boolean | null = null;
  private lookDirection = 0;
  private turns = new FacingDelay();
  private facingHeldUntil = 0;
  private headTransform: DOMMatrix | null = null;
  private headGeometry = { x: 0, y: 0, scale: 1, cx: 120 };
  private previousInverted: boolean | null = null;
  private lastSize = '';
  sceneHand: { x: number; y: number } | undefined;
  hitOverride: ((x: number, y: number) => boolean) | undefined;
  speechBody: { x: number; y: number; width: number; height: number } | undefined;
  patSparkAnchor = { x: .5, y: .2 };
  holdFacing(seconds = .35) { this.facingHeldUntil = this.t + seconds; }
  headHitTest(x: number, y: number, dpr: number) {
    if (!this.headTransform) return false;
    const p = new DOMPoint(x * dpr, y * dpr).matrixTransform(this.headTransform);
    if (this.secondaryHead) { const h = this.secondaryHead; return ((p.x - h.x) / h.rx) ** 2 + ((p.y - h.y) / h.ry) ** 2 <= 1; }
    const g = this.headGeometry, sx = (p.x - g.x) / g.scale, sy = (p.y - g.y) / g.scale;
    // Include the hair and a little surrounding space so rubbing needn't follow opaque pixels.
    return ((sx - g.cx) / 85) ** 2 + ((sy - 90) / 94) ** 2 <= 1;
  }
  private clipTime = 0;
  private reactionUntil = 0;
  private awakeUntil = 0;
  private wasSleeping = false;
  private burstUntil = 0;
  private patUntil = 0;
  private rubUntil = 0;
  rubHead() { this.rubUntil = this.t + .7; }
  private nextBurst = 9;
  private nextFidget = 5;
  private blinkUntil = 0;
  private wasBlinking = false;
  private squish = 0;
  private motionTime = 0;
  private flightLean = 0;
  private wasFlying = false;
  private hitCanvas = document.createElement('canvas');
  private hitCtx = this.hitCanvas.getContext('2d', { willReadFrequently: true })!;
  private teleportUntil = 0;
  private entranceAt = -100;
  private acting: { kind: ActivityKind; at: number; side: number } | null = null;
  private actingPose = { x: 0, y: 0, turn: 0, scaleX: 1, scaleY: 1 };
  private flourish: { kind: FlourishKind; at: number; side: number } | null = null;
  private echoCanvas = document.createElement('canvas');
  perform(kind: FlourishKind | null, side = 1) { this.flourish = kind ? { kind, at: this.t, side } : null; }
  get performance() { return this.flourish?.kind ?? null; }
  captureHit(ctx: CanvasRenderingContext2D) {
    if (this.hitCanvas.width !== ctx.canvas.width || this.hitCanvas.height !== ctx.canvas.height) { this.hitCanvas.width = ctx.canvas.width; this.hitCanvas.height = ctx.canvas.height; }
    this.hitCtx.clearRect(0, 0, this.hitCanvas.width, this.hitCanvas.height); this.hitCtx.drawImage(ctx.canvas, 0, 0);
  }
  act(kind: ActivityKind, side = 1) { this.acting = { kind, at: this.t, side }; }
  appear() { this.entranceAt = this.t; }
  teleportAnimation(_clip: 'perch_glitch') { this.teleportUntil = this.t + 0.7; this.clipTime = 0; }
  private request: { clip: SpriteClip; until: number } | null = null;
  requestAnimation(clip: SpriteClip, seconds = 20) { this.request = { clip, until: this.t + seconds }; }

  constructor() {
    super();
    this.ready = Promise.all([this.secondary.ready, ...((Object.keys(SPRITE_CLIPS) as SpriteClip[]).map((name) => new Promise<void>((resolve, reject) => {
      const img = new Image();
      img.onload = () => { this.images.set(name, img); resolve(); };
      img.onerror = () => reject(new Error(`Missing Capri artwork: ${name}.png`));
      img.src = `capri/lachy/${name}.png`;
    })))]).then(() => undefined);
  }

  override get currentPose() { return this.spritePose; }
  override get facing() { return this.direction; }
  override faceToward(dir: number) { this.lookDirection = dir; }
  override poke() { this.reactionUntil = this.t + 2; this.squish = 0.1; }
  settle() { this.squish = 0.055; }
  override pat() { this.reactionUntil = this.t + 3; this.patUntil = this.t + 1.2; }
  override glitchNow(_kind: 'slice' | 'shatter' | 'ghost' | 'tear' = 'slice', len = 0.3) { this.burstUntil = this.t + len; }

  override draw(ctx: CanvasRenderingContext2D, p: Params, dt: number, inp: ModelInputs & { personality?: LifeFrame; standing?: boolean; attachment?: 'perch' | 'inverted' | 'moving' | null; perchMotion?: 'dangle' | 'stand' | null; taskbar?: boolean; intensity?: number; animation?: 'auto' | SpriteClip; previewClip?: SpriteClip; secondaryPose?: SecondaryPose; secondaryEnabled?: boolean; secondaryRestPreview?: boolean; secondaryMotion?: 'animated' | 'still'; support?: PoseSupport; hovering?: boolean; inspectingBelow?: boolean; moving?: boolean; travel?: number; sleeping?: boolean; facing?: 'cursor' | 'original' | 'left' | 'right' }, W: number, H: number) {
    this.t += dt; this.sceneHand = undefined;
    const intensity = Math.max(0, inp.intensity ?? 1);
    const flying = !!inp.travel && !inp.dragging && !inp.sleeping;
    if (this.wasFlying && !flying && inp.ledge && intensity > 0) this.squish = Math.max(this.squish, .025);
    this.wasFlying = flying;
    this.flightLean += ((flying ? inp.travel! * .055 : 0) - this.flightLean) * (1 - Math.exp(-dt * 9));
    const motionDt = dt * intensity * (inp.personality?.motion ?? 1);
    this.motionTime += motionDt;
    this.spritePose = inp.pose;
    this.squish = Math.max(0, this.squish - dt * 0.4);
    const sleeping = inp.sleeping ?? p.sleep > 0.7;
    if (this.wasSleeping && !sleeping) this.awakeUntil = this.t + 13 / 15;
    this.wasSleeping = sleeping;
    if (!inp.personality && intensity > 0 && inp.glitchEnabled && this.t > this.nextBurst && !sleeping && p.mouthOpen < 0.08) {
      this.burstUntil = this.t + 10 / 15;
      this.nextBurst = this.t + 15 + Math.random() * 20;
    }
    const bursting = inp.glitchEnabled && this.t < this.burstUntil;
    this.burst = bursting ? 0.5 : 0;
    this.ghost = false;
    const selected = inp.animation && inp.animation !== 'auto' ? inp.animation : this.request && this.request.until > this.t ? this.request.clip : null;
    let clip = selected === 'idle' || selected === 'perch' ? selected : spriteBase({ sleeping, dragging: inp.dragging, ledge: inp.ledge && !inp.standing, speaking: p.mouthOpen > 0.04 });
    if (inp.dragging) clip = 'dangle';
    const perched = clip === 'perch';
    const blinkRequested = p.blinkL > 0.2 || p.blinkR > 0.2;
    if (blinkRequested && !this.wasBlinking && !sleeping && intensity > 0) this.blinkUntil = this.motionTime + 4 / 8;
    this.wasBlinking = blinkRequested;
    if (!inp.personality && intensity > 0 && !sleeping && !inp.dragging && this.t > this.nextFidget) {
      this.reactionUntil = this.t + 1.6;
      this.nextFidget = this.t + 9 + Math.random() * 12;
    }
    if (!sleeping && !inp.dragging && intensity > 0) {
      if (this.t < this.awakeUntil) clip = 'wake';
      else if (this.motionTime < this.blinkUntil) clip = perched ? (bursting ? 'perch_blink_glitch' : 'perch_blink') : (bursting ? 'blink_glitch' : 'blink');
      else if (bursting) clip = perched ? 'perch_glitch' : 'glitch';
      else if (!perched && (this.t < this.reactionUntil || p.happyEyes > 0.3 || p.mouthSmile > 0.75)) clip = 'grin';
    }
    if (selected && selected !== 'idle' && selected !== 'perch' && !inp.dragging) clip = selected;
    if (inp.personality?.clip && !selected && !sleeping && !inp.dragging && intensity > 0) {
      const requested = inp.personality.clip;
      clip = perched ? (requested === 'glitch' && inp.glitchEnabled ? 'perch_blink_glitch' : 'perch_blink') : requested === 'glitch' && !inp.glitchEnabled ? 'blink' : requested;
    }
    if (inp.attachment === 'moving' && !inp.dragging) clip = this.motionTime < this.blinkUntil ? 'blink' : 'idle';
    if (inp.attachment === 'inverted' && !inp.dragging && !sleeping) clip = bursting ? 'perch_glitch' : this.motionTime < this.blinkUntil ? 'perch_blink' : 'perch';
    if (this.t < this.teleportUntil && !inp.dragging) clip = 'perch_glitch';
    const beingPatted = this.t < this.patUntil && !sleeping && !inp.dragging && !inp.perchMotion && this.t >= this.teleportUntil && !inp.previewClip;
    if (beingPatted) clip = inp.attachment === 'perch' || inp.attachment === 'inverted' || clip.startsWith('perch') ? 'perch_blink' : 'blink';
    if (inp.perchMotion) clip = inp.perchMotion === 'dangle' ? 'dangle' : 'idle';
    if (flying && !inp.previewClip) clip = this.motionTime < this.blinkUntil ? 'blink' : 'idle';
    if (inp.previewClip) clip = inp.previewClip;
    const secondaryScene = this.secondaryBehavior.update(dt * (inp.secondaryRestPreview ? 6 : 1), {
      enabled: inp.secondaryEnabled !== false,
      blocked: !!inp.moving || !!inp.previewClip || !!selected || sleeping || inp.dragging || !!inp.perchMotion || this.t < this.teleportUntil,
      support: inp.support ?? { sit: inp.ledge, lie: inp.ledge && inp.attachment !== 'inverted', kind: inp.ledge ? 'window_top' : 'none' },
      inverted: inp.attachment === 'inverted', hovering: !!inp.hovering, inspectingBelow: !!inp.inspectingBelow, patting: this.t < this.rubUntil,
    });
    if(secondaryScene.standing)clip=this.motionTime<this.blinkUntil?'blink':'idle';
    this.activeSecondary = secondaryScene.pose;
    this.secondaryReason = secondaryScene.reason;
    this.secondaryClosed = secondaryScene.closed || !!this.activeSecondary && beingPatted || Math.max(p.blinkL, p.blinkR) > .75;
    if (inp.secondaryPose) {
      this.activeSecondary = inp.secondaryPose === 'recline' && inp.attachment === 'inverted' ? null : inp.secondaryPose;
      this.secondaryClosed = inp.secondaryPose === 'sit_closed';
      this.secondaryReason = 'preview';
    }
    const facing = inp.facing ?? 'cursor';
    const target = facing === 'left' ? -1 : facing === 'right' ? 1 : flying ? Math.sign(inp.travel!) : this.turns.update(this.lookDirection, this.t * 1000, this.t < this.facingHeldUntil, this.activeSecondary === 'recline');
    const direction = facing === 'original' || clip === 'sleep' ? 1 : !target ? this.direction : spriteFacing(target, this.direction, clip);
    if (!inp.dragging) this.direction = direction;
    if (clip !== this.activeClip) { this.activeClip = clip; this.clipTime = 0; }
    else this.clipTime += this.t < this.teleportUntil || inp.perchMotion ? dt : motionDt;
    // Base idle/perch/grin loops keep their phase across blinks and expression changes.
    this.activeFrame = spriteFrame(clip, ['idle', 'perch', 'grin'].includes(clip) ? this.motionTime : this.clipTime, clip !== 'wake' && inp.perchMotion !== 'dangle');
    // Cell 1 is the fully closed-eye expression in both original blink strips.
    if (beingPatted) this.activeFrame = 1;
    const img = this.images.get(clip);
    if (!img) return;
    const def = SPRITE_CLIPS[clip];
    const isPerch = clip.startsWith('perch');
    // Equal head size across standing and sitting art; fit all original pixels inside the window.
    const scale = Math.min(W * 0.88 / 384, H * 0.90 / 384) * (clip === 'sleep' ? .9 : 1);
    const dw = def.width * scale, dh = 384 * scale;
    // The visible contact point must match the main process's snap line in air too.
    // Leaving an inverted seat uses upright dangle/float art; the seat itself stays attached.
    const inverted = inp.attachment === 'inverted' && !inp.dragging && !inp.perchMotion;
    const anchor = H * (inverted ? 1 - SEAT_RATIO : SEAT_RATIO);
    // Perch seat is 79% down the source cell, as in lachydotmcg's original renderer.
    const sourceAnchor = isPerch ? 384 * 0.79 : 367;
    const bob = inp.ledge || sleeping || inp.dragging ? 0 : (Math.sin(this.motionTime * 0.85) * 3 + Math.sin(this.motionTime * 0.31) * 1.5) * intensity;
    const drift = inp.ledge || sleeping || inp.dragging ? 0 : Math.sin(this.motionTime * 0.38) * 3 * intensity;
    const x = (W - dw) / 2 + drift;
    const desiredY = anchor - sourceAnchor * scale + bob;
    const sizeKey = `${W},${H}`;
    if (sizeKey !== this.lastSize) { this.poseOffsetY = 0; this.previousY = null; this.lastSize = sizeKey; }
    if (this.previousInverted !== inverted) { this.poseOffsetY = 0; this.previousY = null; }
    if (this.previousPerch !== null && this.previousPerch !== isPerch && !inp.dragging && !inp.perchMotion && this.previousY !== null) this.poseOffsetY = this.previousY - desiredY;
    this.previousInverted = inverted;
    this.previousPerch = isPerch;
    this.poseOffsetY *= Math.exp(-dt * 18);
    const y = desiredY + this.poseOffsetY; this.previousY = y;
    ctx.save();
    const emerge = Math.min(1, Math.max(0, (this.t - this.entranceAt) / .35));
    if (emerge < 1) { ctx.globalAlpha = emerge; ctx.translate(W / 2, H * .3); ctx.scale(.65 + emerge * .35, .12 + emerge * .88); ctx.translate(-W / 2, -H * .3); }
    ctx.translate(W / 2, anchor);
    ctx.rotate(this.flightLean * intensity);
    const gesture = this.flourish && !sleeping && !inp.dragging && !inp.moving && !this.activeSecondary
      ? flourishMotion(this.flourish.kind, this.t - this.flourish.at, !!inp.ledge, this.flourish.side) : null;
    if (gesture?.done || sleeping || inp.dragging || inp.moving) this.flourish = null;
    if (gesture && !gesture.done && intensity > 0) {
      ctx.translate(gesture.x * W * intensity, gesture.y * H * intensity); ctx.rotate(gesture.turn * intensity);
      ctx.scale(1 + (gesture.sx - 1) * intensity, 1 + (gesture.sy - 1) * intensity);
    }
    if (this.acting && !sleeping && !inp.dragging && !inp.moving) {
      const desired = activityMotion(this.acting.kind, this.t - this.acting.at, this.acting.side);
      const ease = 1 - Math.exp(-dt * 14);
      for (const key of ['x', 'y', 'turn', 'scaleX', 'scaleY'] as const) this.actingPose[key] += (desired[key] - this.actingPose[key]) * ease;
      const pose = this.actingPose;
      ctx.translate(pose.x * W * intensity, pose.y * H * intensity); ctx.rotate(pose.turn * intensity); ctx.scale(1 + (pose.scaleX - 1) * intensity, 1 + (pose.scaleY - 1) * intensity);
    }
    // Cursor attention changes facing only. Body acting has its own explicit gestures.
    const still = !!this.activeSecondary && inp.secondaryMotion === 'still';
    ctx.rotate((still ? 0 : intensity) * Math.max(-0.035, Math.min(0.035, p.headRoll * 0.20 + p.bodyRot * 0.15 + (isPerch ? Math.sin(this.motionTime * 0.9) * 0.008 : 0))));
    ctx.scale(this.direction * (1 + (still ? 0 : this.squish)), (inverted ? -1 : 1) * (1 - (still ? 0 : this.squish)));
    ctx.translate(-W / 2, -anchor);
    this.headTransform = ctx.getTransform().inverse();
    this.headGeometry = { x, y, scale, cx: def.width * (isPerch ? .46 : .5) };
    this.secondaryHead = null; this.speechBody = undefined;
    const hairTop = new DOMPoint(x + this.headGeometry.cx * scale, y + (isPerch ? 55 : 35) * scale).matrixTransform(ctx.getTransform());
    this.patSparkAnchor = { x: hairTop.x / ctx.canvas.width, y: hairTop.y / ctx.canvas.height };
    const face = new DOMPoint(x + dw * (isPerch ? .46 : .5), y + 110 * scale).matrixTransform(ctx.getTransform());
    this.speechAnchor = { x: Math.max(0, Math.min(1, face.x / ctx.canvas.width)), y: Math.max(0, Math.min(1, face.y / ctx.canvas.height)) };
    const draw = (image: HTMLImageElement, frame: number, width: number) => ctx.drawImage(image, frame * width, 0, width, 384, x, y, dw, dh);
    if (this.activeSecondary) {
      const pose = this.activeSecondary;
      const secondary = this.secondary.draw(ctx, pose, W, H, anchor, inverted, this.motionTime, still ? 0 : intensity);
      if (secondary) {
        this.secondaryHead = secondary.head;
        if (pose === 'recline') {
          const b = secondary.body, transform = ctx.getTransform();
          const corners = [[b.x, b.y], [b.x + b.width, b.y], [b.x, b.y + b.height], [b.x + b.width, b.y + b.height]].map(([x, y]) => new DOMPoint(x, y).matrixTransform(transform));
          const x = Math.min(...corners.map(p => p.x)) / ctx.canvas.width, y = Math.min(...corners.map(p => p.y)) / ctx.canvas.height;
          this.speechBody = { x, y, width: Math.max(...corners.map(p => p.x)) / ctx.canvas.width - x, height: Math.max(...corners.map(p => p.y)) / ctx.canvas.height - y };
        }
        const head = new DOMPoint(secondary.face.x, secondary.face.y).matrixTransform(ctx.getTransform());
        const hair = new DOMPoint(secondary.hair.x, secondary.hair.y).matrixTransform(ctx.getTransform());
        this.speechAnchor = { x: head.x / ctx.canvas.width, y: head.y / ctx.canvas.height };
        this.patSparkAnchor = { x: hair.x / ctx.canvas.width, y: hair.y / ctx.canvas.height };
      }
    } else {
      if (gesture && gesture.echo > 0 && intensity > 0) {
        const echo = this.echoCanvas; if (echo.width !== def.width || echo.height !== 384) { echo.width = def.width; echo.height = 384; }
        const eg = echo.getContext('2d')!;
        for (const [color, side] of [['#22f27a', -1], ['#f2154c', 1]] as const) {
          eg.clearRect(0,0,echo.width,echo.height); eg.globalCompositeOperation = 'source-over'; eg.drawImage(img,this.activeFrame*def.width,0,def.width,384,0,0,def.width,384); eg.globalCompositeOperation='source-in';eg.fillStyle=color;eg.fillRect(0,0,echo.width,echo.height);eg.globalCompositeOperation='source-over';
          ctx.save();ctx.globalAlpha *= gesture.echo * .20;ctx.drawImage(echo,x+side*gesture.echo*W*.055,y-gesture.echo*6,dw,dh);ctx.restore();
        }
      }
      if (gesture && gesture.arm > 0 && intensity > 0 && def.width === 240) {
        // Lift the original arm pixels, preserving their palette, claws and line weight.
        const arm = new Path2D();
        const points = [[128,143],[106,157],[74,170],[60,175],[15,185],[12,221],[55,225],[79,204],[76,187],[117,165],[130,154]];
        points.forEach(([px,py],i)=>i?arm.lineTo(x+px*scale,y+py*scale):arm.moveTo(x+px*scale,y+py*scale));arm.closePath();
        const body = new Path2D();body.rect(x-1,y-1,dw+2,dh+2);body.addPath(arm);
        ctx.save();ctx.clip(body,'evenodd');draw(img,this.activeFrame,def.width);ctx.restore();
        const shoulder = {x:x+124*scale,y:y+149*scale};
        ctx.save();ctx.translate(shoulder.x,shoulder.y);ctx.rotate(1.72*gesture.arm);ctx.scale(1+gesture.arm*.12,1+gesture.arm*.12);ctx.translate(-shoulder.x,-shoulder.y);
        const tip=new DOMPoint(x+32*scale,y+193*scale).matrixTransform(ctx.getTransform());this.sceneHand={x:tip.x/ctx.canvas.width,y:tip.y/ctx.canvas.height};
        ctx.clip(arm);draw(img,this.activeFrame,def.width);ctx.restore();
      } else draw(img, this.activeFrame, def.width);
    }
    if (!this.activeSecondary && (clip === 'idle' || clip === 'blink' || clip === 'grin') && p.mouthOpen > 0.04) {
      const mouth = this.images.get('mouth');
      if (mouth) draw(mouth, Math.min(4, Math.floor(p.mouthOpen * 5)), 240);
    }
    ctx.restore();
    // Hit-test the base art before particles or teleport effects add extra opaque pixels.
    if (this.hitCanvas.width !== ctx.canvas.width || this.hitCanvas.height !== ctx.canvas.height) { this.hitCanvas.width = ctx.canvas.width; this.hitCanvas.height = ctx.canvas.height; }
    this.hitCtx.clearRect(0, 0, this.hitCanvas.width, this.hitCanvas.height);
    this.hitCtx.drawImage(ctx.canvas, 0, 0);
    if (this.t < this.patUntil) {
      ctx.save();
      ctx.fillStyle = '#6dffb0'; ctx.globalAlpha = Math.min(1, this.patUntil - this.t);
      for (let i = 0; i < 4; i++) { const sx = this.patSparkAnchor.x * W + (i - 1.5) * 9, sy = this.patSparkAnchor.y * H + (inverted ? 1 : -1) * (5 + (this.t % 1) * 14); ctx.fillRect(sx - 3, sy, 6, 2); ctx.fillRect(sx - 1, sy - 2, 2, 6); }
      ctx.restore();
    }
  }
  override hitTest(_ctx: CanvasRenderingContext2D, x: number, y: number, dpr: number) {
    if (this.hitOverride) return this.hitOverride(x,y);
    const px = Math.floor(x * dpr), py = Math.floor(y * dpr);
    if (px < 0 || py < 0 || px >= this.hitCanvas.width || py >= this.hitCanvas.height) return false;
    return this.headHitTest(x, y, dpr) || this.hitCtx.getImageData(px, py, 1, 1).data[3] >= 128;
  }
}



