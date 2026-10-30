import { Personality, type Mood, type LifeEvent, type LifeFrame } from '../../shared/personality';
import type { AssistantPhase, CharacterCue } from '../../shared/ipc';
import type { Settings } from '../../shared/settings';
import type { DevPreview } from '../../shared/developer';
import type { CapriApi } from '../../preload/preload';
import { Animator, Blinker, NEUTRAL, type Params } from './params';
import { Behavior } from './behavior';
import { Speaker } from './speaker';
import { MicRecorder } from './audio';
import { FRAME_SIZE } from '../../shared/framing';
import { TeleportFx } from './teleportFx';
import { DeepSleep } from './deepSleep';
import { StatusFx } from './statusFx';
import { AttentionRig } from '../../shared/presence';
import { POSTURES, type PostureName, type Surface } from './postures';
import { clipByName } from './clips';
import type { Reaction } from './behavior';
import type { PoseName } from './model';
import { CapriSpriteModel } from './spriteModel';
import { modelPoseFor } from './poseMap';

/** Model-requested emotes → validated reactions/clips (the model never touches the renderer directly). */
const EMOTE_MAP: Record<string, { react?: Reaction; clip?: string; posture?: PostureName }> = {
  smug: { clip: 'smug' }, maniac_grin: { clip: 'maniac_grin' }, blank_stare: { clip: 'blank_stare' }, reach: { clip: 'reach_claw' },
  sit: { posture: 'sit_edge' }, stand: { posture: 'stand' }, recline: { posture: 'recline' }, power_stance: { posture: 'power_stance' }, curl_up: { posture: 'air_sit' },
  happy: { react: 'happy' }, laugh: { clip: 'giggle' }, wink: { clip: 'wink' }, tease: { clip: 'tease' }, grin: { clip: 'tilt_grin' },
  surprised: { react: 'surprised' }, many_eyes: { clip: 'many_eyes' }, annoyed: { react: 'annoyed' }, eye_roll: { clip: 'eye_roll' },
  pout: { clip: 'pout' }, menace: { clip: 'menace' }, curious: { react: 'curious' }, thinking: { clip: 'chin_tap' }, shrug: { clip: 'shrug' },
  nod: { clip: 'nod_slow' }, shake_no: { clip: 'shake_no' }, wave: { react: 'wave' }, cheer: { clip: 'cheer' }, proud: { clip: 'proud_pose' },
  reveal: { clip: 'reveal_spread' }, loom: { clip: 'loom' }, facepalm: { clip: 'facepalm' }, yawn: { clip: 'yawn' },
};

declare global { interface Window { capri: CapriApi; __capriDebug?: unknown } }
const api = window.capri;

const canvas = document.getElementById('stage') as HTMLCanvasElement;
const ctx = canvas.getContext('2d', { alpha: true, desynchronized: false })!;
const off = document.createElement('canvas'); // glitch post-process source
const offCtx = off.getContext('2d')!;

let settings: Settings;
let lastRendererState = '';
let phase: AssistantPhase = 'idle';
let idleSec = 0;
let quiet = false;
let paused = false;
let characterBooted = false;
let hoverBegan = 0, lastHoverActAt = -12000;
let hoverAnchor: { x: number; y: number } | null = null;
let poseSupport: import('../../shared/secondaryBehavior').PoseSupport | undefined;
let anchorSentAt = 0, lastAnchor = { x: -1, y: -1 }, lastAnchorBody = '';
let pointer: { x: number; y: number } | null = null;
let lastPointerAt = 0;
let cursorLocal: { x: number; y: number } | null = null;
let hit = false;
let dragging = false;
let stayRest: 'sleep' | 'awake' | null = null;
let forced: Partial<Params> | null = null;
let surface: Surface = 'taskbar';
let attachment: 'perch' | 'inverted' | 'moving' | null = null;
let dashing = 0; // pose override for previews/tests only
let textTalkUntil = 0;

const fx = new TeleportFx(() => document.createElement('canvas'));
const statusFx = new StatusFx();
const deepSleep = new DeepSleep();
let theatreStand = false;
let theatreKind: import('../../shared/theatrics').SceneKind | null = null;
let theatreTarget: {x:number;y:number} | null = null;
const attention = new AttentionRig();
const model = new CapriSpriteModel();
const personality = new Personality();
let life: LifeFrame | undefined;
let devPreview: DevPreview | null = null;
let perchMotion: 'dangle' | 'stand' | null = null;
let simulatedAbsence: 'idle' | 'sleep' | null = null;
let reportedMood: Mood = 'neutral';
function lifeEvent(event: LifeEvent) {
  if (!settings?.character.personality) return;
  const mood = personality.event(event); reportedMood = mood;
  void api.invoke('char:personality', { mood, event });
}
let variantFor = '', variant = 0, lastP: Params | null = null, shownPose: PoseName | null = null;
let workPose: 'back' | 'crouch' | 'sit' | null = null; // set while she uses the PC
function modelPose(): PoseName {
  // while she breaks apart she keeps the pose she was in; the new spot's pose appears as she arrives
  if (fx.phase === 'out' && shownPose) return shownPose;
  // working on the PC: the pose main picked, except she only sits with a ledge under her
  if (workPose && !dragging) return (shownPose = workPose === 'sit' && surface !== 'window' && surface !== 'taskbar' ? 'crouch' : workPose);
  if (variantFor !== behavior.posture) { variantFor = behavior.posture; variant = Math.random(); }
  return (shownPose = modelPoseFor({ surface, posture: behavior.posture, sleeping: behavior.state === 'sleeping', dragging, variant, back: (lastP?.back ?? 0) > 0.5 }));
}
const anim = new Animator();
const behavior = new Behavior();
let directedAnimation:{id:number;clip:NonNullable<Behavior['clip']>}|undefined;
function finishDirectedAnimation(status:'completed'|'interrupted'){if(directedAnimation){void api.invoke('char:performance',{id:directedAnimation.id,status});directedAnimation=undefined;}}
const blinker = new Blinker();
const mic = new MicRecorder();
const speaker = new Speaker(() => settings, (id, state) => void api.invoke('char:speechState', { utteranceId: id, state }), (text, mood) => api.invoke('tts:fetch', mood ? { text, mood } : text));

// ---------------------------------------------------------------- sizing (DPI aware)
let dpr = 1, W = FRAME_SIZE.width, H = FRAME_SIZE.height;
function resize() {
  dpr = window.devicePixelRatio || 1;
  W = window.innerWidth; H = window.innerHeight;
  for (const c of [canvas, off]) { c.width = Math.round(W * dpr); c.height = Math.round(H * dpr); }
  canvas.style.width = `${W}px`; canvas.style.height = `${H}px`;
}
window.addEventListener('resize', resize);
// re-run when moved to a monitor with a different scale factor
const watchDpr = () => matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`).addEventListener('change', () => { resize(); watchDpr(); }, { once: true });

// ---------------------------------------------------------------- render loop (throttled)
let last = performance.now();
let acc = 0;
let frames = 0, fpsT = performance.now();
let raf = 0;
function frameBudget(): number {
  const cap = settings?.character.fpsCap ?? 60;
  if (behavior.state === 'sleeping') return 1000 / Math.min(cap, 15);
  const busy = !!model.performance || !!theatreKind || deepSleep.active || dashing !== 0 || fx.active || speaker.speaking || dragging || phase !== 'idle' || behavior.state !== 'idle' || pointer;
  return 1000 / (busy ? cap : Math.min(cap, 30));
}
function loop(now: number) {
  if (!paused) raf = requestAnimationFrame(loop);
  acc = now - last;
  if (acc < frameBudget() - 1) return;
  const dt = Math.min(0.1, acc / 1000);
  last = now;
  tick(dt);
  frames++;
  if (now - fpsT > 5000) { void api.invoke('char:fps', Math.round((frames * 1000) / (now - fpsT))); frames = 0; fpsT = now; }
}
function setPaused(p: boolean) {
  if (p === paused) return;
  paused = p;
  if (p) {finishDirectedAnimation('interrupted');cancelAnimationFrame(raf);}
  else if (characterBooted) { last = performance.now(); raf = requestAnimationFrame(loop); }
}
// Main pauses genuinely hidden pets explicitly. Covering the native window must
// not stop teleport effects or leave a stale mouse hit region behind.

function tick(dt: number) {
  if (!settings) return;
  const intensity = settings.character.animationIntensity;
  if (pointer && performance.now() - lastPointerAt > 4000) pointer = null; // stop staring when the mouse rests
  life = settings.character.personality ? personality.update(dt, { pointer, phase, sleeping: behavior.state === 'sleeping', held: dragging }) : undefined;
  const mood = life?.mood ?? 'neutral';
  if (mood !== reportedMood) { reportedMood = mood; void api.invoke('char:personality', { mood }); }
  const level = speaker.lips.update(dt);
  const gaze = attention.update(dt, { pointer, engaged: ['listening', 'transcribing', 'thinking', 'speaking'].includes(phase), held: dragging, sleeping: behavior.state === 'sleeping' });
  const target: Params = behavior.update(dt, {
    forceSleep: devPreview ? devPreview.deepSleep || devPreview.animation === 'sleep' : settings.behavior.mode === 'sleep' || stayRest === 'sleep' || simulatedAbsence === 'sleep',
    phase: devPreview?.phase ?? phase, speechLevel: level, speaking: speaker.speaking, pointer: gaze, idleSec: devPreview || stayRest === 'awake' ? 0 : idleSec, quiet, intensity,
    sleepAfterSec: settings.behavior.sleepAfterMinutes * 60,
    surface, dashing, held: devPreview?.held ?? dragging,
  });
  const b = blinker.update(dt, { drowsy: target.sleep, suppressed: behavior.state === 'sleeping' });
  target.blinkL = Math.max(target.blinkL, b);
  target.blinkR = Math.max(target.blinkR, b);
  if (!settings.character.glitchEffects) target.glitch = 0;
  // departure: the many-eyes bloom flashes as she starts to fragment (N 2:14)
  if (fx.phase === 'out') target.manyEyes = Math.max(target.manyEyes, Math.sin(Math.min(1, fx.u / 0.6) * Math.PI));
  if (forced) Object.assign(target, forced);
  anim.step(target, dt, intensity);
  const p = anim.value;
  p.mouthOpen = Math.max(0, speaker.speaking ? level : p.mouthOpen); // lip-sync wins over gesture clips

  const teleporting = fx.active || fx.hidden;
  const sameHover = hoverAnchor && cursorLocal && performance.now() - hoverBegan < 10000 && Math.hypot(cursorLocal.x - hoverAnchor.x, cursorLocal.y - hoverAnchor.y) < 28;
  const hovering = settings.behavior.smallActivities && !quiet && !teleporting && !dragging && settings.behavior.mode !== 'sleep' && phase === 'idle' && !!cursorLocal && (hit || !!sameHover);
  if (!hovering) { hoverBegan = 0; hoverAnchor = null; }
  else {
    const now = performance.now(); if (!hoverBegan) { hoverBegan = now; hoverAnchor = { ...cursorLocal! }; }
    if (now - hoverBegan > 600 && now - lastHoverActAt > 12000) {
      lastHoverActAt = now; personality.event('hover');
    }
  }
  model.faceToward(theatreKind && theatreTarget ? (theatreTarget.x - model.speechAnchor.x * W) / (W * .45) : pointer ? pointer.x : gaze ? gaze.x : life?.look ?? 0);
  if (!settings.voice.ttsEnabled && !speaker.speaking && performance.now() < textTalkUntil) p.mouthOpen = 0.12 + 0.30 * Math.abs(Math.sin(performance.now() / 95));
  if (model.stutter > 0 && !teleporting) { model.stutter--; return; } // glitch stutter: hold the last image a few frames
  const glitch = !deepSleep.active && !teleporting && settings.character.glitchEffects && (p.glitch > 0.05 || model.burst > 0);
  const g = glitch || teleporting ? offCtx : ctx;
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.clearRect(0, 0, canvas.width, canvas.height);
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  lastP = p;
  const stillMotion = matchMedia('(prefers-reduced-motion: reduce)').matches || !settings.character.theatricalMotion || intensity <= 0;
  if (stillMotion) model.perform(null);
  const asleep = devPreview?.deepSleep || settings.behavior.mode === 'sleep' || behavior.state === 'sleeping';
  deepSleep.update(dt, !!asleep && !dragging && phase === 'idle', settings.character.deepSleep, !!devPreview?.deepSleep);
  g.globalAlpha = 1 - deepSleep.amount;
  model.draw(g, p, dt, { personality: devPreview?.mood && life ? { ...life, mood: devPreview.mood } : devPreview ? undefined : life, attachment: devPreview ? devPreview.attachment ?? null : attachment, pose: modelPose(), ledge: surface === 'taskbar' || surface === 'window' || !!poseSupport?.sit, taskbar: surface === 'taskbar', dragging: devPreview?.held ?? dragging, sleeping: devPreview ? devPreview.deepSleep || devPreview.animation === 'sleep' : settings.behavior.mode === 'sleep' || behavior.state === 'sleeping', glitchEnabled: settings.character.glitchEffects, intensity: devPreview ? Math.max(.5, intensity) : intensity, animation: settings.behavior.mode === 'normal' ? settings.character.animation : settings.behavior.mode === 'sleep' ? 'sleep' : 'auto', previewClip: devPreview?.animation, secondaryPose: devPreview?.secondary, secondaryMotion: devPreview?.secondaryMotion, standing: theatreStand || !devPreview && poseSupport?.landing === 'stand', secondaryEnabled: settings.character.secondaryPoses && !theatreKind, secondaryRestPreview: devPreview?.secondaryScene === 'rest', support: devPreview?.secondaryScene ? { sit: true, lie: true, kind: devPreview.secondaryScene === 'rest' ? 'taskbar' : 'window_top' } : devPreview ? undefined : poseSupport, hovering: devPreview?.secondaryScene === 'hover' || !!hovering, inspectingBelow: devPreview?.secondaryScene === 'inspect' || attention.mode === 'window' && (gaze?.y ?? 0) > .35, moving: dashing !== 0 || teleporting, travel: dashing, perchMotion, facing: settings.character.facing }, W, H);
  g.globalAlpha = 1;
  if (deepSleep.active) {
    deepSleep.draw(g, W, H, stillMotion); model.captureHit(g);
    model.speechAnchor = { x: .5, y: .45 }; model.speechBody = undefined;
  }
  model.hitOverride = deepSleep.amount > .8 ? (x,y) => deepSleep.hit(x,y,W,H) : undefined;
  if(directedAnimation){if(directedAnimation.clip.done)finishDirectedAnimation('completed');else if(behavior.clip!==directedAnimation.clip||dragging||teleporting)finishDirectedAnimation('interrupted');}
  const rendererState = { ...model.secondaryRendererState, mood: devPreview?.mood ?? mood, clip: model.activeClip, phase: devPreview?.phase ?? phase, attachment: devPreview ? devPreview.attachment ?? null : attachment }, rendererKey = JSON.stringify(rendererState);
  if (rendererKey !== lastRendererState) { lastRendererState = rendererKey; void api.invoke('char:poseRenderer', rendererState); }
  const head = model.speechAnchor, now = performance.now(), bodyKey = JSON.stringify([model.speechBody,model.sceneHand]);
  if (now - anchorSentAt >= 100 && (Math.hypot(head.x - lastAnchor.x, head.y - lastAnchor.y) > .003 || bodyKey !== lastAnchorBody)) {
    lastAnchor = { ...head }; lastAnchorBody = bodyKey; anchorSentAt = now; void api.invoke('char:anchor', { ...head, body: model.speechBody, hand: model.sceneHand });
  }
  if (glitch) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(off, 0, 0);
    model.post(ctx, off, Math.max(0.3, p.glitch, model.burst * 0.9));
  }
  if (teleporting) fx.render(ctx, off, dt, dpr);
  if (!teleporting) {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    statusFx.draw(ctx, dt, W, H, attachment === 'inverted', settings.character.reactionCutins && settings.character.glitchEffects && !matchMedia('(prefers-reduced-motion: reduce)').matches && !asleep && !quiet);
    if (theatreKind && theatreTarget) {
      // Hold attention on the actual scene target instead of following passing cursor samples.
      attention.watch({ x: (theatreTarget.x - model.speechAnchor.x * W) / (W * .45), y: (theatreTarget.y - model.speechAnchor.y * H) / (H * .35) }, .5);
    }
  }
  if (!dragging && cursorLocal) setHit(!teleporting && model.hitTest(ctx, cursorLocal.x, cursorLocal.y, dpr));
}

// head pats: the cursor rubbing back and forth over her head (Desktop Mate / Shimeji style)
let patDir = 0, patTurns: number[] = [], patLastX = 0, patCool = 0, patAnchor = 0;
function trackPat(x: number, y: number) {
  if (deepSleep.active || !hit || dragging || !model.headHitTest(x, y, dpr)) { patTurns = []; patDir = 0; patLastX = x; patAnchor = x; return; }
  model.holdFacing();
  const d = Math.sign(x - patLastX);
  patLastX = x;
  if (!d || Math.abs(x - patAnchor) < 3) return;
  patAnchor = x;
  const now = performance.now();
  if (d !== patDir) { patDir = d; patTurns.push(now); }
  patTurns = patTurns.filter((t) => now - t < 1400);
  if (patTurns.length >= 3) model.rubHead();
  if (patTurns.length >= 3 && now > patCool) {
    patCool = now + 2500;
    model.pat();
    void api.invoke('char:interaction', 'pat');
    behavior.react('happy');
  }
}

// ---------------------------------------------------------------- teleport (window move happens in main between phases)
fx.onDone = (id, ph) => {
  void api.invoke('char:teleport', { id, phase: ph });
  if (ph === 'in') {
    // arrive with an observed pose: arms flung wide (N 1:51), the tilted grin (W3) or a many-eyes flash (N 2:14)
    const pick = ['reveal_spread', 'tilt_grin', 'many_eyes'][Math.floor(Math.random() * 3)];
    behavior.playClip(pick);
  }
};
function onTeleport(phaseName: 'out' | 'in', id: number, effects: boolean, perchAnimation = false) {
  setHit(false);
  if (!effects) {
    fx.phase = null;
    fx.hidden = phaseName === 'out';
    if (phaseName === 'in') ctx.clearRect(0, 0, canvas.width, canvas.height);
    void api.invoke('char:teleport', { id, phase: phaseName });
    return;
  }
  setPaused(false);
  fx.start(phaseName, id, { x: W / 2, y: H * 0.38, w: W * 0.8, h: H * 0.7 }, perchAnimation ? 0.7 : undefined);
}

// ---------------------------------------------------------------- pointer: hit-test, drag, click
function setHit(h: boolean) { if (h !== hit) { hit = h; void api.invoke('char:hit', h); document.body.style.cursor = h ? 'grab' : 'default'; } }
window.addEventListener('mousemove', (e) => {
  cursorLocal = { x: e.clientX, y: e.clientY };
  lastPointerAt = performance.now();
  // gaze target relative to her head (≈ 34% down the frame)
  pointer = { x: (e.clientX - model.speechAnchor.x * W) / (W * .45), y: (e.clientY - model.speechAnchor.y * H) / (H * .35) };
  if (!dragging) setHit(!fx.active && !fx.hidden && model.hitTest(ctx, e.clientX, e.clientY, dpr));
  trackPat(e.clientX, e.clientY);
});
// Windows can emit mouseleave when switching a transparent window between
// interactive and pass-through. The main-process cursor sample is authoritative.
window.addEventListener('mouseleave', () => { pointer = null; });
window.addEventListener('mousedown', (e) => {
  // Verify the current artwork, rather than a hover flag from the previous frame.
  if (e.button !== 0 || fx.active || fx.hidden || !model.hitTest(ctx, e.clientX, e.clientY, dpr)) return;
  setHit(true);
  void api.invoke('char:drag', 'start');
});
window.addEventListener('mouseup', (e) => {
  if (e.button !== 0) return;
  dragging = false;
  document.body.style.cursor = hit ? 'grab' : 'default';
  void api.invoke('char:drag', 'end');
});
window.addEventListener('dblclick', () => { if (hit) void api.invoke('char:click'); });
window.addEventListener('contextmenu', (e) => { e.preventDefault(); if (hit) void api.invoke('char:menu'); });

// ---------------------------------------------------------------- microphone
async function micStart(autoStop: boolean) {
  try {
    await mic.start(autoStop, () => void micStop(false));
  } catch (e) {
    void api.invoke('char:micError', (e as Error).message || 'microphone unavailable');
  }
}
async function micStop(cancel: boolean) {
  if (!mic.active) return;
  const out = await mic.stop(cancel);
  if (out) await api.invoke('char:audio', out);
}

// ---------------------------------------------------------------- cues from main
let wakeAuto = false;
api.on('cue', (raw) => {
  const c = raw as CharacterCue;
  switch (c.type) {
    case 'flourish': if (c.kind !== 'spin' && (!c.kind || settings.character.theatricalMotion && !matchMedia('(prefers-reduced-motion: reduce)').matches)) model.perform(c.kind, c.side); break;
    case 'theatre': theatreKind = c.kind; theatreStand = !!c.stand; theatreTarget = c.target ?? null; if (!c.kind) { model.perform(null); attention.clear(); } break;
    case 'cutin': if (settings.character.reactionCutins && !quiet && settings.behavior.mode !== 'sleep') statusFx.show(c.kind, c.preview); break;
    case 'userReturn': simulatedAbsence = null; behavior.wake(); idleSec = 0; if (c.from === 'sleep') model.requestAnimation('wake', 13 / 15); else behavior.react('wave'); break;
    case 'perchMotion': perchMotion = c.phase; break;
    case 'dropHint': {
      const hint = document.getElementById('drop-hint')!;
      hint.hidden = !c.edge;
      if (c.edge) { hint.style.left = `${c.edge.x}px`; hint.style.top = `${c.edge.y}px`; hint.style.width = `${c.edge.width}px`; }
      break;
    }
    case 'devPreview': model.perform(null); devPreview = c.preview; model.resetSecondary(); if (!devPreview) { behavior.wake(); model.settle(); } break;
    case 'activity': if (matchMedia('(prefers-reduced-motion: reduce)').matches || settings.character.animationIntensity <= 0) break; if (performance.now() - lastHoverActAt < 2500 && c.kind !== 'putdown') break; model.act(c.kind, c.side); if (c.kind === 'return') behavior.react('wave'); else if (c.kind === 'notice') behavior.react('curious'); else if (c.kind === 'settle' || c.kind === 'putdown') model.settle(); break;
    case 'dragging': model.perform(null); statusFx.clear(); dragging = c.active; document.body.style.cursor = dragging ? 'grabbing' : 'grab'; if (!dragging) { setHit(false); document.getElementById('drop-hint')!.hidden = true; } break;
    case 'entrance': model.appear(); behavior.wake(); break;
    case 'attention': if (c.point) attention.watch({ x: (c.point.x - model.speechAnchor.x * W) / (W * 0.45), y: (c.point.y - model.speechAnchor.y * H) / (H * 0.35) }, c.seconds); else attention.clear(); break;
    case 'life': lifeEvent(c.event); if (c.event === 'pat') model.pat(); if (c.event === 'window') model.settle(); break;
    case 'phase': if (c.phase === 'error' && settings.character.theatricalMotion) model.perform('flinch'); if (c.phase === 'speaking' && phase !== 'speaking') lifeEvent('reply'); phase = c.phase; statusFx.setPhase(c.phase); if (c.phase !== 'idle') behavior.wake(); break;
    case 'react': finishDirectedAnimation('interrupted'); if (c.reaction === 'surprised' && settings.character.theatricalMotion && !matchMedia('(prefers-reduced-motion: reduce)').matches) model.perform('flinch'); behavior.react(c.reaction); if(c.performanceId){if(behavior.clip)directedAnimation={id:c.performanceId,clip:behavior.clip};else void api.invoke('char:performance',{id:c.performanceId,status:'interrupted'});} if (c.reaction === 'happy' || c.reaction === 'surprised') model.poke(); break;
    case 'speak': behavior.wake(); speaker.enqueue(c.utteranceId, c.text, settings.character.personality ? personality.mood : undefined); break;
    case 'stopSpeech': speaker.stopAll(); textTalkUntil = 0; break;
    case 'wake': wakeAuto = true; behavior.react('surprised'); break;
    case 'mic':
      if (c.command === 'start') { void micStart(wakeAuto); wakeAuto = false; speaker.stopAll(); }
      else void micStop(c.command === 'cancel');
      break;
    case 'pause': setPaused(c.paused); if (c.paused) speaker.stopAll(); break;
    case 'interact': canvas.style.filter = c.enabled ? 'drop-shadow(0 0 1.5px #22f27a) drop-shadow(0 0 1px #22f27a)' : ''; break; // click-through lifted for a moment
    case 'presence': simulatedAbsence = c.simulated ?? null; idleSec = c.idleSec; quiet = c.quiet; break;
    case 'stayRest': if(stayRest === 'sleep' && c.phase !== 'sleep') behavior.wake(); stayRest=c.phase; break;
    case 'remark': break;
    case 'bubble': break; // the attached bubble window owns text layout
    case 'textTalk': textTalkUntil = performance.now() + Math.min(10000, Math.max(1800, c.text.length * 40)); break;
    case 'workPose': workPose = c.pose; break;
    case 'teleport': model.perform(null); statusFx.clear(); if (c.animation && c.effects) model.teleportAnimation(c.animation); onTeleport(c.phase, c.id, c.effects, !!c.animation); break;
    case 'attachment': attachment = c.mode; break;
    case 'clip': {
      if (['laugh','maniac_grin','cheer'].includes(c.name) && settings.character.reactionCutins) statusFx.show(c.name === 'cheer' ? 'grin' : 'laugh');
      if (settings.character.theatricalMotion && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
        if (['cheer','proud'].includes(c.name)) model.perform('victory');
        if (['surprised','annoyed'].includes(c.name)) model.perform('flinch');
        if (['curious','thinking'].includes(c.name)) model.perform('curious');
      }
      const spriteEmotes: Record<string, 'idle' | 'perch' | 'grin' | 'sleep' | 'glitch' | 'dangle'> = { sit: 'perch', curl_up: 'perch', stand: 'idle', grin: 'grin', laugh: 'grin', happy: 'grin', smug: 'grin', power_stance: 'glitch', menace: 'glitch', recline: 'sleep', yawn: 'sleep' };
      if (spriteEmotes[c.name]) model.requestAnimation(spriteEmotes[c.name], ['sit', 'stand', 'recline', 'curl_up'].includes(c.name) ? 20 : spriteEmotes[c.name] === 'glitch' ? 10 / 15 : 2);
      const e = EMOTE_MAP[c.name];
      if (e?.posture) behavior.setPosture(surface === 'air' && e.posture === 'sit_edge' ? 'air_sit' : e.posture);
      else if (e?.react) behavior.react(e.react);
      else if (e?.clip && clipByName(e.clip)) behavior.playClip(e.clip, 'reacting');
      break;
    }
    case 'connection': break;
    case 'surface': surface = c.surface; break;
    case 'poseSupport': poseSupport = c.support; break;
    case 'pointer':
      if (!cursorLocal || c.x !== cursorLocal.x || c.y !== cursorLocal.y) lastPointerAt = performance.now();
      cursorLocal = { x: c.x, y: c.y };
      pointer = Math.hypot(c.x - W / 2, c.y - H / 2) < 1100 ? { x: (c.x - model.speechAnchor.x * W) / (W * .45), y: (c.y - model.speechAnchor.y * H) / (H * .35) } : null;
      if (!dragging) { setHit(!fx.active && !fx.hidden && model.hitTest(ctx, c.x, c.y, dpr)); trackPat(c.x, c.y); }
      break;
    case 'dash': dashing = c.dir; break;
  }
});
api.on('settings:changed', (s) => { const wasSleeping = settings.behavior.mode === 'sleep'; settings = s as Settings; if (wasSleeping && settings.behavior.mode !== 'sleep') behavior.wake(); void api.invoke('char:hit', hit); if (!settings.voice.ttsEnabled || settings.behavior.mode === 'sleep') speaker.stopAll(); });

// ---------------------------------------------------------------- boot
(async () => {
  settings = await api.invoke('settings:get');
  await model.ready;
  resize();
  watchDpr();
  anim.snap({ ...NEUTRAL });
  tick(1 / 60);
  await api.invoke('char:ready');
  characterBooted = true;
  if (!paused) raf = requestAnimationFrame(loop);
  window.__capriDebug = {
    deepSleep, statusFx, behavior, anim, speaker, model, mic, fx, personality, attention, lifeEvent, get life() { return life; }, postures: POSTURES,
    get pose() { return modelPose(); },
    get surface() { return surface; },
    get attachment() { return attachment; },
    get hit() { return hit; },
    get dragging() { return dragging; },
    get paused() { return paused; },
    get idleSec() { return idleSec; },
    force(p: Partial<Params> | null) { forced = p; },
    hitAt: (x: number, y: number) => model.hitTest(ctx, x, y, dpr),
    // ---- deterministic capture mode (trailer / docs): stop the clock, advance exact frames, export pixels
    manual(on: boolean) { if (on) { cancelAnimationFrame(raf); paused = true; } else { paused = false; last = performance.now(); raf = requestAnimationFrame(loop); } },
    step(dt: number, n = 1) { for (let i = 0; i < n; i++) tick(dt); },
    setPhase(p: AssistantPhase) { phase = p; },
    setPointer(x: number | null, y = 0) { pointer = x === null ? null : { x, y }; lastPointerAt = performance.now(); },
    setSurface(s: Surface) { surface = s; },
    setDashing(d: number) { dashing = d; },
    setIdle(sec: number, q = false) { idleSec = sec; quiet = q; },
    lips(on: boolean) { if (on) speaker.lips.start(); else speaker.lips.stop(); },
    teleportFx(ph: 'out' | 'in', id = 1) { fx.start(ph, id, { x: W / 2, y: H * 0.38, w: W * 0.8, h: H * 0.7 }); },
    canvasSize: () => [canvas.width, canvas.height],
    grab(crop?: { x: number; y: number; w: number; h: number }, q = 0.9, type = 'image/webp') {
      const r = crop ?? { x: 0, y: 0, w: canvas.width, h: canvas.height };
      const c = document.createElement('canvas'); c.width = r.w; c.height = r.h;
      c.getContext('2d')!.drawImage(canvas, r.x, r.y, r.w, r.h, 0, 0, r.w, r.h);
      return c.toDataURL(type, q);
    },
  };
})();






