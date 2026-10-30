import type { CapriApi } from '../preload/preload';
const api = (window as unknown as { capri: CapriApi }).capri;
const canvas = document.querySelector('canvas')!, ctx = canvas.getContext('2d')!;
api.on('trail:play', raw => {
  const { from, to } = raw as { from: { x: number; y: number }; to: { x: number; y: number } };
  const dpr = devicePixelRatio || 1; canvas.width = Math.round(innerWidth * dpr); canvas.height = Math.round(innerHeight * dpr);
  const start = performance.now();
  const paint = (elapsed: number) => {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, innerWidth, innerHeight);
    const t = Math.max(0, Math.min(1, elapsed / 450)); if (t >= 1) return;
    const head = Math.min(1, t * 2.4), tail = Math.max(0, head - .32);
    ctx.globalAlpha = Math.sin(t * Math.PI) * .65; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(from.x + (to.x - from.x) * tail, from.y + (to.y - from.y) * tail);
    ctx.lineTo(from.x + (to.x - from.x) * head, from.y + (to.y - from.y) * head);
    ctx.strokeStyle = '#9b53ff'; ctx.lineWidth = 3; ctx.stroke(); ctx.strokeStyle = '#fff0f7'; ctx.lineWidth = 1; ctx.stroke();
  };
  const loop = () => { const elapsed = performance.now() - start; paint(elapsed); if (elapsed < 450) requestAnimationFrame(loop); }; loop();
  (window as unknown as { __trailDebug: unknown }).__trailDebug = { from, to, paint };
});
