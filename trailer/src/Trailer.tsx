// Capri recruiting trailer: show footage of her, then the app doing the same things on a desktop, cut to
// the score's 99 BPM grid, ending on the two asks (beta testers, developers) and the site.
// Desktop footage: scripts/record-trailer-clips.mjs (the real app, live, on a clean stand-in desktop).
// Close-ups: scripts/capture-closeups.mjs (the app's own renderer at 7x). Show footage: public/show.
import React from 'react';
import { AbsoluteFill, Easing, Img, interpolate, random, Sequence, staticFile, useCurrentFrame } from 'remotion';
import { Audio, Video } from '@remotion/media';
import { loadVariableFont } from '@remotion/google-fonts/Archivo';
import clipMarks from '../public/clips/marks.json';
import faceIndex from '../public/clips/faces/faces.json';

const { fontFamily } = loadVariableFont('normal', { subsets: ['latin'] });
const FPS = 30, W = 1920, H = 1080;
const C = { bg: '#0c0b0f', text: '#f1eef5', muted: '#8f8a98', accent: '#f2154c' };
const BEAT = 60 / 99.25; // the score's grid; the first drop lands on beat 16
const b = (n: number) => n * BEAT;
const f = (s: number) => Math.round(s * FPS);
const clamp = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const;
export const SITE = 'theagencymge.github.io/capri';
export const REPO = 'github.com/TheAgencyMGE/capri-companion';

type Rect = [number, number, number, number];
const { layout: L, ...times } = clipMarks as unknown as Record<string, number> & { layout: Record<string, { her: Rect; panel: Rect | null }> };
const M = times as Record<string, number>;
const FACES = (faceIndex as { shots: Record<string, { frames: number }> }).shots;

// ---------------------------------------------------------------- camera over 1920x1080 footage
type Cam = { z: number; x: number; y: number };
const herBody = (r: Rect): Rect => [r[0] + r[2] * 0.12, r[1] + r[3] * 0.08, r[2] * 0.76, r[3] * 0.8];
const union = (...rs: Rect[]): Rect => {
  const x0 = Math.min(...rs.map((r) => r[0])), y0 = Math.min(...rs.map((r) => r[1]));
  return [x0, y0, Math.max(...rs.map((r) => r[0] + r[2])) - x0, Math.max(...rs.map((r) => r[1] + r[3])) - y0];
};
const fit = (r: Rect, maxZ: number, margin = 1.12): Cam => ({ z: Math.max(1.06, Math.min(maxZ, W / (r[2] * margin), H / (r[3] * margin))), x: r[0] + r[2] / 2, y: r[1] + r[3] / 2 });
const FULL: Cam = { z: 1.06, x: W / 2, y: 470 }; // just enough zoom to keep the taskbar (bottom 60 px) out
const CALC: Rect = [40, 20, 480, 660];

/** Zoom toward a point over the shot; never past the footage edge, never below `floor` (taskbar line). */
const Camera: React.FC<{ cam: [Cam, Cam]; len: number; floor?: number; children: React.ReactNode }> = ({ cam, len, floor = H, children }) => {
  const fr = useCurrentFrame();
  const t = interpolate(fr, [0, len], [0, 1], { ...clamp, easing: Easing.inOut(Easing.cubic) });
  const z = Math.max(H / floor, interpolate(t, [0, 1], [cam[0].z, cam[1].z]));
  const x = interpolate(t, [0, 1], [cam[0].x, cam[1].x]), y = interpolate(t, [0, 1], [cam[0].y, cam[1].y]);
  const tx = Math.min(0, Math.max(W - W * z, W / 2 - x * z));
  const ty = Math.min(0, Math.max(H - floor * z, H / 2 - y * z));
  return <AbsoluteFill style={{ overflow: 'hidden' }}><AbsoluteFill style={{ transform: `translate(${tx}px, ${ty}px) scale(${z})`, transformOrigin: '0 0' }}>{children}</AbsoluteFill></AbsoluteFill>;
};

// ---------------------------------------------------------------- shots
type Shot =
  | { kind: 'show'; src: 'o' | 'n' | 'e'; t: number; z?: [number, number]; ay?: number }
  | { kind: 'desk'; t: number; cam: [Cam, Cam] }
  | { kind: 'face'; name: string; from?: number };

const ShowShot: React.FC<{ s: Extract<Shot, { kind: 'show' }>; len: number }> = ({ s, len }) => {
  // the compilation clips carry a credit in the bottom corners: frame them from the top, zoomed past it
  const z = s.z ?? (s.src === 'o' ? [1, 1.06] : [1.2, 1.26]);
  const ay = s.ay ?? (s.src === 'o' ? 0.5 : 0.3);
  return (
    <Camera cam={[{ z: z[0], x: W / 2, y: H * ay }, { z: z[1], x: W / 2, y: H * ay }]} len={len}>
      <Video src={staticFile(`show/${s.src}.mp4`)} muted trimBefore={f(s.t)} style={{ width: W, height: H }} />
    </Camera>
  );
};
const DeskShot: React.FC<{ s: Extract<Shot, { kind: 'desk' }>; len: number }> = ({ s, len }) => (
  <Camera cam={s.cam} len={len} floor={1020}>
    <Video src={staticFile('clips/desktop.mp4')} muted trimBefore={f(s.t)} style={{ width: W, height: H }} />
  </Camera>
);
/** A close-up from the app's renderer, over the same city she was recorded on, pushed in slowly. */
const FaceShot: React.FC<{ s: Extract<Shot, { kind: 'face' }>; len: number }> = ({ s, len }) => {
  const fr = useCurrentFrame();
  const n = FACES[s.name].frames;
  const i = Math.min(n - 1, (s.from ?? 0) + fr);
  const z = interpolate(fr, [0, len], [1.02, 1.1], clamp);
  return (
    <AbsoluteFill style={{ background: C.bg, overflow: 'hidden' }}>
      <Img src={staticFile('clips/wallpaper.jpg')} style={{ position: 'absolute', inset: -40, width: W + 80, height: H + 80, objectFit: 'cover', filter: 'blur(14px) brightness(0.45)' }} />
      <Img src={staticFile(`clips/faces/${s.name}/${String(i).padStart(3, '0')}.png`)} style={{ position: 'absolute', inset: 0, width: W, height: H, objectFit: 'cover', transform: `scale(${z})` }} />
    </AbsoluteFill>
  );
};

/** Her own glitch on a cut: torn dark slices, a few frames long. */
const CutGlitch: React.FC<{ seed: number; strength?: number }> = ({ seed, strength = 1 }) => {
  const fr = useCurrentFrame();
  if (fr > 4) return null;
  const k = (1 - fr / 5) * strength;
  return (
    <AbsoluteFill style={{ pointerEvents: 'none' }}>
      {Array.from({ length: 6 }, (_, i) => (
        <div key={i} style={{ position: 'absolute', left: (random(`${seed}x${i}${fr}`) - 0.5) * 240 * k, top: random(`${seed}y${i}${fr}`) * H, width: W, height: 4 + random(`${seed}h${i}`) * 40, background: 'rgba(12,11,15,0.92)', opacity: 0.9 * k }} />
      ))}
    </AbsoluteFill>
  );
};

// ---------------------------------------------------------------- type
const Wordmark: React.FC<{ size: number; glitchUntil?: number }> = ({ size, glitchUntil = 0 }) => {
  const fr = useCurrentFrame();
  const jit = fr < glitchUntil ? (random(`wm${fr}`) - 0.5) * 60 : 0;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: size * 0.12, transform: `translateX(${jit}px)` }}>
      <div style={{ width: size * 0.09, height: size * 0.82, background: C.accent, transform: 'skewX(-20deg)' }} />
      <div style={{ fontFamily, fontVariationSettings: "'wdth' 62", fontWeight: 800, fontSize: size, lineHeight: 0.8, letterSpacing: '-0.02em', color: C.text, textTransform: 'uppercase' }}>Capri</div>
    </div>
  );
};
const Title: React.FC<{ len: number }> = ({ len }) => {
  const fr = useCurrentFrame();
  const s = interpolate(fr, [0, 6], [1.25, 1], { ...clamp, easing: Easing.out(Easing.cubic) });
  const o = interpolate(fr, [len - 6, len], [1, 0], clamp);
  return (
    <AbsoluteFill style={{ background: C.bg, alignItems: 'center', justifyContent: 'center', opacity: o }}>
      <div style={{ transform: `scale(${s})` }}><Wordmark size={330} glitchUntil={8} /></div>
    </AbsoluteFill>
  );
};
const Caption: React.FC<{ text: string; len: number; side?: 'left' | 'right' }> = ({ text, len, side = 'left' }) => {
  const fr = useCurrentFrame();
  const inn = interpolate(fr, [4, 12], [0, 1], { ...clamp, easing: Easing.out(Easing.cubic) });
  const out = interpolate(fr, [len - 10, len - 2], [1, 0], clamp);
  return (
    <AbsoluteFill style={{ justifyContent: 'flex-end', alignItems: side === 'left' ? 'flex-start' : 'flex-end', padding: '0 110px 92px', pointerEvents: 'none' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 20, opacity: Math.min(inn, out), transform: `translateY(${(1 - inn) * 16}px)` }}>
        <div style={{ width: 7, height: 64, background: C.accent, transform: 'skewX(-18deg)' }} />
        <div style={{ fontFamily, fontVariationSettings: "'wdth' 75", fontWeight: 750, fontSize: 70, color: C.text, background: 'rgba(12,11,15,0.88)', padding: '6px 24px 12px' }}>{text}</div>
      </div>
    </AbsoluteFill>
  );
};
/** The asks: one big line over a darkened shot. */
const Ask: React.FC<{ line: string; len: number }> = ({ line, len }) => {
  const fr = useCurrentFrame();
  const s = interpolate(fr, [0, 5], [1.15, 1], { ...clamp, easing: Easing.out(Easing.cubic) });
  const o = interpolate(fr, [len - 4, len], [1, 0.0], clamp);
  return (
    <AbsoluteFill style={{ alignItems: 'flex-start', justifyContent: 'center', padding: '0 110px', opacity: o }}>
      <div style={{ transform: `scale(${s})`, transformOrigin: 'left center', fontFamily, fontVariationSettings: "'wdth' 62", fontWeight: 800, fontSize: 210, lineHeight: 0.86, color: C.text, textTransform: 'uppercase', letterSpacing: '-0.01em' }}>{line}</div>
    </AbsoluteFill>
  );
};
const EndCard: React.FC = () => {
  const fr = useCurrentFrame();
  const a = interpolate(fr, [0, 8], [0, 1], clamp), u = interpolate(fr, [14, 24], [0, 1], { ...clamp, easing: Easing.out(Easing.cubic) });
  return (
    <AbsoluteFill style={{ background: C.bg, justifyContent: 'center', padding: '0 110px' }}>
      <div style={{ opacity: a }}><Wordmark size={300} glitchUntil={6} /></div>
      <div style={{ marginTop: 56, opacity: u, transform: `translateY(${(1 - u) * 14}px)`, fontFamily, fontWeight: 600, fontSize: 56, color: C.text }}>
        Beta testers wanted
      </div>
      <div style={{ marginTop: 18, opacity: u, fontFamily, fontWeight: 700, fontSize: 56, color: C.accent }}>{SITE}</div>
      <div style={{ marginTop: 14, opacity: u, fontFamily, fontWeight: 600, fontSize: 40, color: C.text }}>{REPO}</div>
      <div style={{ position: 'absolute', left: 110, bottom: 64, opacity: u, fontFamily, fontSize: 24, color: C.muted }}>
        Unofficial fan project. Not affiliated with CD PROJEKT RED, Studio Trigger or Netflix.
      </div>
    </AbsoluteFill>
  );
};

// ---------------------------------------------------------------- the edit
type Cut = { at: number; dur: number; shot: Shot; glitch?: number };
const her = (k: string) => herBody(L[k].her);
const cuts: Cut[] = [];
const add = (from: number, to: number, shot: Shot, glitch = 1) => cuts.push({ at: b(from), dur: b(to) - b(from), shot, glitch });

// cold open: her, from the show
add(0, 2, { kind: 'show', src: 'o', t: 98.2, z: [1, 1.08] }, 0);
add(2, 6, { kind: 'show', src: 'o', t: 117.6, z: [1, 1.07] });
add(6, 10, { kind: 'show', src: 'n', t: 213.3, z: [1.2, 1.32], ay: 0.32 });
add(10, 11, { kind: 'show', src: 'o', t: 133.2 });
add(11, 12, { kind: 'show', src: 'e', t: 342.3 });
add(12, 13, { kind: 'show', src: 'o', t: 49.3 });
add(13, 14, { kind: 'show', src: 'o', t: 34.3 });
add(14, 16, { kind: 'show', src: 'e', t: 73.6, z: [1.05, 1.12], ay: 0.4 });
// (16–20: title)
// the app: she arrives on a desktop
add(20, 24, { kind: 'desk', t: M.arrive - 0.1, cam: [FULL, FULL] });
add(24, 28, { kind: 'desk', t: M.watch + 0.4, cam: [fit(her('arrive'), 1.7, 1.6), fit(her('arrive'), 1.9, 1.4)] });
add(28, 32, { kind: 'desk', t: M.poke - 0.4, cam: [fit(her('arrive'), 2.1, 1.25), fit(her('arrive'), 2.3, 1.15)] });
// faces: the app's, answered by the show's
add(32, 33, { kind: 'face', name: 'smug', from: 12 });
add(33, 34, { kind: 'show', src: 'o', t: 34.3 });
add(34, 35, { kind: 'face', name: 'maniac', from: 18 });
add(35, 36, { kind: 'show', src: 'o', t: 132.6 });
add(36, 37, { kind: 'face', name: 'many_eyes', from: 22 });
add(37, 38, { kind: 'face', name: 'wink', from: 4 });
add(38, 39, { kind: 'face', name: 'tilt_grin', from: 16 });
add(39, 40, { kind: 'face', name: 'talk', from: 0 });
// talk to her (live Gemini)
const chatRect = union(L.chat.panel!, her('chat'));
add(40, 52, { kind: 'desk', t: M.chat + 0.1, cam: [fit(chatRect, 1.5, 1.08), fit(chatRect, 1.55, 1.04)] });
// ask her to move: the real window crosses the screen
const TP_LEAD = 3.4;
add(52, 60, { kind: 'desk', t: M.moved - TP_LEAD, cam: [FULL, FULL] });
// she does real things: an approved app, a timer
const actRect = union(L.moved.panel!, her('moved'), CALC);
add(60, 64, { kind: 'desk', t: M.allow - 1.0, cam: [fit(actRect, 1.4, 1.04), fit(actRect, 1.45, 1.02)] });
const timerRect = union(L.timer.panel!, her('timer'));
add(64, 68, { kind: 'desk', t: M.ask_timer + 3.2, cam: [fit(timerRect, 1.5, 1.06), fit(timerRect, 1.55, 1.03)] });
// the back view: show, then app
add(68, 70, { kind: 'show', src: 'n', t: 214.0, z: [1.24, 1.3], ay: 0.32 });
add(70, 72, { kind: 'desk', t: M.back + 0.5, cam: [fit(her('end'), 1.8, 1.25), fit(her('end'), 1.95, 1.15)] });
// montage
add(72, 73, { kind: 'show', src: 'o', t: 5.2 });
add(73, 74, { kind: 'desk', t: M.arrive + 0.7, cam: [FULL, FULL] });
add(74, 75, { kind: 'face', name: 'maniac', from: 34 });
add(75, 76, { kind: 'show', src: 'o', t: 113.6 });
add(76, 77, { kind: 'desk', t: M.moved - 0.45, cam: [FULL, FULL] });
add(77, 78, { kind: 'face', name: 'many_eyes', from: 40 });
add(78, 79, { kind: 'show', src: 'e', t: 300.4, z: [1.1, 1.16], ay: 0.4 });
add(79, 80, { kind: 'face', name: 'happy', from: 10 });
// the asks, over darkened shots
add(80, 82, { kind: 'desk', t: M.back + 1.2, cam: [fit(her('end'), 1.6, 1.4), fit(her('end'), 1.7, 1.3)] });
add(82, 84, { kind: 'show', src: 'o', t: 120.0 });
const END = b(84) + 7.4;
export const TRAILER_FRAMES = f(END);

type Over = { at: number; dur: number; node: React.ReactNode };
const overlays: Over[] = [
  { at: b(16), dur: b(4), node: <Title len={f(b(4))} /> },
  { at: b(20), dur: b(4), node: <Caption text="Now on your desktop." len={f(b(4))} side="left" /> },
  { at: b(40), dur: b(12), node: <Caption text="Talk to her." len={f(b(12))} side="right" /> },
  { at: b(52), dur: b(8), node: <Caption text="Ask her to move." len={f(b(8))} side="right" /> },
  { at: b(60), dur: b(8), node: <Caption text="She does real things." len={f(b(8))} side="right" /> },
  { at: b(80), dur: b(4), node: <AbsoluteFill style={{ background: 'rgba(12,11,15,0.72)' }}><Ask line="Beta testers wanted." len={f(b(4))} /></AbsoluteFill> },
  { at: b(84), dur: END - b(84), node: <EndCard /> },
];
const sfx: { at: number; name: string; volume: number }[] = [
  { at: b(16) - 0.05, name: 'braam', volume: 0.6 },
  { at: b(52) + TP_LEAD - 0.45, name: 'teleport_whoosh', volume: 0.7 },
  { at: b(60) + 1.0, name: 'hud_ping', volume: 0.45 },
  { at: b(80), name: 'impact_boom', volume: 0.5 },
  { at: b(84), name: 'sub_drop', volume: 0.55 },
];

export const Trailer: React.FC = () => (
  <AbsoluteFill style={{ background: C.bg }}>
    {cuts.map((c, i) => (
      <Sequence key={i} from={f(c.at)} durationInFrames={f(c.at + c.dur) - f(c.at)} name={`${c.shot.kind} ${i}`}>
        {c.shot.kind === 'show' ? <ShowShot s={c.shot} len={f(c.dur)} /> : c.shot.kind === 'desk' ? <DeskShot s={c.shot} len={f(c.dur)} /> : <FaceShot s={c.shot} len={f(c.dur)} />}
        {i > 0 && c.glitch ? <CutGlitch seed={i} strength={c.glitch} /> : null}
      </Sequence>
    ))}
    {overlays.map((o, i) => <Sequence key={`o${i}`} from={f(o.at)} durationInFrames={f(o.dur)}>{o.node}</Sequence>)}
    {sfx.map((s, i) => <Sequence key={`s${i}`} from={Math.max(0, f(s.at))}><Audio src={staticFile(`audio/sfx/${s.name}.mp3`)} volume={s.volume} /></Sequence>)}
    {cuts.filter((c, i) => i > 0 && c.dur <= BEAT + 0.01).map((c, i) => <Sequence key={`g${i}`} from={f(c.at)}><Audio src={staticFile('audio/sfx/glitch1.mp3')} volume={0.12} /></Sequence>)}
    <Audio src={staticFile('audio/score.mp3')} volume={(fr) => 0.75 * interpolate(fr, [TRAILER_FRAMES - 75, TRAILER_FRAMES - 3], [1, 0], clamp)} />
  </AbsoluteFill>
);
