import type { TheatreFrame, Point } from "../shared/theatrics";
import { sceneBeat } from "../shared/theatrics";
import {
  bolt,
  drawConstructMask,
  polygon,
  star,
} from "./character/constructArt";
import type { CapriApi } from "../preload/preload";
const api = (window as unknown as { capri: CapriApi }).capri;
const canvas = document.getElementById("scene") as HTMLCanvasElement,
  g = canvas.getContext("2d")!;
const reduced = matchMedia("(prefers-reduced-motion: reduce)");
let state: TheatreFrame | null = null,
  start = 0,
  raf = 0,
  last = 0,
  manual = false;
function resize() {
  const d = devicePixelRatio;
  canvas.width = Math.round(innerWidth * d);
  canvas.height = Math.round(innerHeight * d);
}
resize();
addEventListener("resize", resize);
function lerp(a: Point, b: Point, u: number): Point {
  return { x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u };
}
function stroke(points: Point[], color: string, width = 2) {
  g.strokeStyle = color;
  g.lineWidth = width;
  g.beginPath();
  points.forEach((p, i) => (i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y)));
  g.stroke();
}
function satellite(s: TheatreFrame, t: number, still: boolean) {
  const { from, to } = s,
    beat = sceneBeat(s.kind, t),
    fade = Math.min(1, t / 0.7, (s.duration - t) / 1.2);
  g.globalAlpha = Math.max(0, fade);
  const twinkle =
    beat === "answer"
      ? 1 + Math.max(0, Math.sin((t - 7.5) * Math.PI * 3)) * 1.7
      : 1;
  const sat = { x: to.x + (still ? 0 : Math.sin(t * 0.2) * 12), y: to.y };
  star(g, sat.x, sat.y, 5 * twinkle);
  stroke(
    [
      { x: sat.x - 13, y: sat.y },
      { x: sat.x + 13, y: sat.y },
    ],
    "#a4a2be",
    1,
  );
  if (still) {
    for (let i = 0; i < 12; i++) {
      const p = lerp(from, sat, 0.1 + i * 0.07);
      star(g, p.x, p.y, 1.8);
    }
    return;
  }
  for (let i = 0; i < 32; i++) {
    const phase = i / 32,
      angle = i * 2.399,
      base = {
        x: from.x + Math.cos(angle) * 45,
        y: from.y - 35 + Math.sin(angle) * 32,
      };
    let p = base;
    if (t < 1.6) {
      const u = t / 1.6;
      p = { x: base.x, y: base.y - u * (25 + phase * 80) };
    } else if (t < 6.4) {
      const u = Math.min(1, (t - 1.6) / 2.3);
      const road = lerp(from, sat, 0.12 + phase * 0.76);
      p = lerp({ x: base.x, y: base.y - 45 - phase * 55 }, road, u);
    } else if (t < 7.5) {
      p = lerp(from, sat, 0.12 + phase * 0.76);
    } else {
      const u = Math.min(1, (t - 7.5) / 3);
      p = lerp(lerp(from, sat, 0.12 + phase * 0.76), base, u * u);
    }
    star(
      g,
      p.x,
      p.y,
      1.3 + (i % 3) * 0.45,
      i % 5 === 0 ? "#ff9eba" : "#ffeff5",
    );
  }
  if (beat === "charge") {
    const radius = 10 + (still ? 0 : Math.sin(t * 6) * 2);
    g.strokeStyle = "#f2154c";
    g.lineWidth = 2;
    g.beginPath();
    g.arc(from.x, from.y, radius, 0, Math.PI * 2);
    g.stroke();
  }
  if (beat === "bolt" && !still) {
    const u = (t - 6.4) / 1.1;
    bolt(
      g,
      from,
      lerp(from, sat, Math.min(1, u * 3)),
      t,
      Math.min(1, u * 6, Math.max(0, (1 - u) * 3)),
    );
  }
  if (beat === "answer")
    for (let i = 0; i < 7; i++) {
      const u = (t - 7.5) / 1.7;
      star(
        g,
        sat.x + (i - 3) * 7 * u,
        sat.y + u * u * 75,
        2 * (1 - u),
        "#f2154c",
      );
    }
}
function possession(s: TheatreFrame, t: number, still: boolean) {
  const r = s.target;
  if (!r) return;
  g.beginPath();
  for (const c of s.clips) g.rect(c.x, c.y, c.width, c.height);
  g.clip();
  const envelope = Math.max(0, Math.min(1, t / 0.7, (s.duration - t) / 0.8));
  g.globalAlpha = envelope;
  const corners = [
    { x: r.x + 5, y: r.y + 5 },
    { x: r.x + r.width - 5, y: r.y + 5 },
    { x: r.x + r.width - 5, y: r.y + r.height - 5 },
    { x: r.x + 5, y: r.y + r.height - 5 },
  ];
  if (!still)
    for (let i = 0; i < 4; i++)
      bolt(g, corners[i], corners[(i + 1) % 4], t + i, 0.65);
  else {
    g.strokeStyle = "#7b3df2";
    g.lineWidth = 2;
    g.strokeRect(r.x + 4, r.y + 4, r.width - 8, r.height - 8);
  }
  const faceRegion =
    [...s.clips].sort((a, b) => b.width * b.height - a.width * a.height)[0] ??
    r;
  const mask = {
      x: faceRegion.x + faceRegion.width * 0.5,
      y: faceRegion.y + faceRegion.height * 0.42,
    },
    k = Math.min(2.7, faceRegion.width / 180, faceRegion.height / 160);
  const look = Math.max(-1, Math.min(1, (s.pointer.x - mask.x) / 200));
  drawConstructMask(g, mask.x, mask.y, k, Math.min(1, (t - 0.65) * 3), look);
  if (t > 0.9) {
    g.save();
    g.translate(mask.x, mask.y + 37 * k);
    g.scale(k, k);
    stroke(
      [
        [-35, -4],
        [-24, 3],
        [-15, -3],
        [-5, 4],
        [5, -3],
        [16, 3],
        [32, -7],
      ].map(([x, y]) => ({ x, y })),
      "#f8efff",
      2.5,
    );
    g.restore();
  }
  if (t > 0.95)
    for (let i = 0; i < 6; i++) {
      const x = r.x + r.width * (0.16 + (i % 3) * 0.34),
        y = r.y + r.height * (i < 3 ? 0.23 : 0.76),
        eye = Math.max(0, Math.min(1, (t - 1.2 - i * 0.12) * 3));
      g.save();
      g.translate(x, y);
      g.scale(Math.min(1.3, r.width / 450), eye);
      polygon(
        g,
        [
          [-15, 0],
          [-5, -10],
          [8, -8],
          [16, 0],
          [4, 10],
          [-9, 8],
        ],
        "#22f27a",
      );
      const dx = Math.max(-4, Math.min(4, (s.pointer.x - x) / 90)),
        dy = Math.max(-3, Math.min(3, (s.pointer.y - y) / 100));
      g.fillStyle = "#216cff";
      g.beginPath();
      g.arc(dx, dy, 7, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = "#090710";
      g.beginPath();
      g.arc(dx, dy, 3.5, 0, Math.PI * 2);
      g.fill();
      g.restore();
    }
  if (!still && t > 1 && t < 3.4)
    for (let i = 0; i < 5; i++) {
      const y = r.y + r.height * ((i * 0.19 + Math.floor(t * 8) * 0.023) % 1);
      g.fillStyle = i % 2 ? "#7b3df2" : "#f2154c";
      g.globalAlpha = envelope * 0.12;
      g.fillRect(r.x + 6, y, r.width - 12, 1 + (i % 3));
    }
}
function zap(s: TheatreFrame, t: number, still: boolean) {
  const fade = Math.max(0, Math.min(1, t / 0.2, (s.duration - t) / 0.6));
  g.globalAlpha = fade;
  if (t > 0.45 && t < 0.85 && !still) bolt(g, s.from, s.to, t);
  if (t > 0.45) {
    const u = (t - 0.45) / 1.2,
      r = 7 + u * 27;
    g.strokeStyle = "#f2154c";
    g.lineWidth = 2;
    g.beginPath();
    g.arc(s.to.x, s.to.y, r, 0, Math.PI * 2);
    g.stroke();
    for (let i = 0; i < 5; i++) {
      const a = (i * Math.PI * 2) / 5;
      star(g, s.to.x + Math.cos(a) * r, s.to.y + Math.sin(a) * r, 2, "#22f27a");
    }
  }
}
function draw(t: number) {
  if (!state) return;
  g.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
  g.clearRect(0, 0, innerWidth, innerHeight);
  g.save();
  const still = reduced.matches || state.reduced;
  if (state.kind === "satellite") satellite(state, t, still);
  else if (state.kind === "possession") possession(state, t, still);
  else zap(state, t, still);
  g.restore();
}
function loop(now: number) {
  if (manual) return;
  raf = requestAnimationFrame(loop);
  if (now - last < 1000 / 24 - 1) return;
  last = now;
  const t = (now - start) / 1000;
  if (state && t >= state.duration) {
    cancelAnimationFrame(raf);
    void api.invoke("theatre:done", state.id).catch(() => {});
    state = null;
    return;
  }
  draw(t);
}
api.on("theatre:play", (raw) => {
  state = raw as TheatreFrame;
  start = performance.now();
  cancelAnimationFrame(raf);
  raf = requestAnimationFrame(loop);
});
api.on("theatre:update", (raw) => {
  const s = raw as TheatreFrame;
  if (state?.id === s.id) state = s;
});
// The main process owns identity and lifetime; this overlay has no desktop or input permissions.
void api.invoke("theatre:ready").catch(() => {});
(window as unknown as { __theatreDebug: unknown }).__theatreDebug = {
  get state() {
    return state;
  },
  draw(t: number) {
    manual = true;
    cancelAnimationFrame(raf);
    draw(t);
  },
  resume() {
    manual = false;
    raf = requestAnimationFrame(loop);
  },
};
