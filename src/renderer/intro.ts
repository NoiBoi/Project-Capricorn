// Screen-grab greeting adapted from mochiiwuff/capri-desktop (MIT), commit 16985d14.
// Separate artwork provenance: assets/capri/mochiiwuff/SOURCES.md.
import { INTRO_FRAMES, INTRO_MS, introPosition, type IntroState } from '../shared/intro';
import type { CapriApi } from '../preload/preload';
const api = (window as unknown as { capri: CapriApi }).capri;
const canvas = document.getElementById('opening') as HTMLCanvasElement, ctx = canvas.getContext('2d')!;
const images = new Map<string, HTMLImageElement>();
const ready = Promise.all(INTRO_FRAMES.map(name => new Promise<void>((resolve, reject) => {
  const img = new Image(); img.onload = () => { images.set(name, img); resolve(); }; img.onerror = reject;
  img.src = `capri/mochiiwuff/intro-${name}.webp`;
})));
let frame = 0, current = 0;
const clamp = (x: number) => Math.max(0, Math.min(1, x));
function draw(state: IntroState) {
  cancelAnimationFrame(frame); current = state.id;
  const still = state.still || matchMedia('(prefers-reduced-motion: reduce)').matches;
  const start = performance.now(), duration = still ? 1250 : INTRO_MS;
  let last = -1;
  const paint = (elapsed: number) => {
    const dpr = devicePixelRatio || 1, w = innerWidth, h = innerHeight;
    const pixelW = Math.round(w * dpr), pixelH = Math.round(h * dpr);
    if (canvas.width !== pixelW || canvas.height !== pixelH) {
      canvas.width = pixelW; canvas.height = pixelH; last = -1;
    }
    const tick = Math.floor(elapsed * 24 / 1000);
    if (tick === last) return; last = tick;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, w, h);
    const t = elapsed / duration, at = introPosition(w, h, state.to, elapsed, still);
    const sourceFrame = Math.floor(elapsed * 24 / 1000);
    let cel = 'grab';
    if (!still) {
      if (sourceFrame >= 34 && sourceFrame < 44) cel = ['mouth1', 'mouth1', 'mouth3', 'mouth3', 'mouth3', 'mouth3', 'mouth2', 'mouth2', 'mouth1', 'mouth1'][sourceFrame - 34];
      if (sourceFrame >= 46 && sourceFrame < 48 || sourceFrame >= 63 && sourceFrame < 65) cel = 'smear';
      else if (sourceFrame >= 48 && sourceFrame < 63) cel = ['wave1', 'wave3', 'wave2', 'wave3', 'wave1'][Math.floor((sourceFrame - 48) / 3)];
      else if (sourceFrame >= 65 && sourceFrame < 75) cel = 'happy';
    }
    ctx.save();
    ctx.globalAlpha = still ? Math.min(clamp(t * 6), clamp((1 - t) * 6)) : clamp((1 - t) * 45);
    ctx.translate(at.x, at.y + (!still && sourceFrame < 16 ? 70 * at.scaleY * (1 - clamp((sourceFrame - 10) / 6)) : 0));
    ctx.scale(at.scale, at.scaleY); ctx.translate(-830, -330);
    // Her hands arrive from opposite edges, then the arms pull the close-up into view.
    if (!still && sourceFrame < 16) {
      const reach = sourceFrame < 6 ? 0 : sourceFrame < 10 ? .16 : .16 + 1.05 * clamp((sourceFrame - 10) / 6) ** 2;
      ctx.beginPath();
      for (const side of [-1, 1]) {
        if (side === 1 && sourceFrame < 8) continue;
        const edge = side === -1 ? 0 : 1672, amount = reach * 836;
        ctx.moveTo(edge, 0);
        for (let y = 0; y <= 1000; y += 70) ctx.lineTo(edge - side * (amount + Math.sin(y + sourceFrame) * 15), y);
        ctx.lineTo(edge, 1000); ctx.closePath();
      }
      ctx.clip();
    }
    if (!still && sourceFrame >= 80) {
      const radius = 370, half = 836 - clamp((sourceFrame - 80) / 7) * 466;
      ctx.beginPath();
      if (sourceFrame < 88) {
        ctx.moveTo(830 - half, -50);
        for (let y = -50; y <= 1000; y += 70) ctx.lineTo(830 - half + Math.sin(y + sourceFrame) * 20, y);
        for (let y = 1000; y >= -50; y -= 70) ctx.lineTo(830 + half + Math.sin(y - sourceFrame) * 20, y);
      } else {
        for (let i = 0; i <= 20; i++) { const angle = i / 20 * Math.PI * 2, r = radius + (i % 2 ? 15 : -15); ctx.lineTo(830 + Math.cos(angle) * r, 330 + Math.sin(angle) * r); }
      }
      ctx.closePath(); ctx.clip();
    }
    ctx.drawImage(images.get(cel) ?? images.get('grab')!, 0, 0);
    ctx.restore();
    if ((still && t > .2 && t < .8) || !still && sourceFrame >= 34 && sourceFrame < 80) {
      const greeting = state.greeting ?? 'hey, you.';
      const fontSize = Math.max(22, Math.min(48, h * .037)); ctx.font = `${fontSize}px Chakra, sans-serif`;
      const tagWidth = Math.min(w - 40, ctx.measureText(greeting).width + 28);
      const tagX = Math.max(20, Math.min(w - tagWidth - 20, at.x + at.scale * 280)), tagY = Math.max(fontSize + 15, at.y - at.scaleY * 150);
      ctx.fillStyle = '#7b3dff'; ctx.fillRect(tagX + 5, tagY - fontSize + 5, tagWidth, fontSize + 15);
      ctx.fillStyle = '#14101c'; ctx.fillRect(tagX, tagY - fontSize, tagWidth, fontSize + 15);
      ctx.fillStyle = '#fff4f6'; ctx.fillText(greeting, tagX + 13, tagY + 3, tagWidth - 26);
      ctx.font = '12px monospace'; ctx.fillText('PROJECT CAPRICORN', tagX + 4, tagY + 35);
    }
  };
  const loop = () => {
    if (current !== state.id) return;
    const elapsed = performance.now() - start;
    if (elapsed >= duration) { ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, canvas.width, canvas.height); void api.invoke('intro:done', state.id); return; }
    paint(elapsed); frame = requestAnimationFrame(loop);
  };
  // Deterministic visual checks can inspect the exact frames without changing production timing.
  (window as unknown as { __introDebug: unknown }).__introDebug = { paint, still, duration, freeze: () => cancelAnimationFrame(frame) };
  loop();
}
api.on('intro:play', payload => { const state = payload as IntroState; void ready.then(() => draw(state)).catch(() => api.invoke('intro:done', state.id)); });
