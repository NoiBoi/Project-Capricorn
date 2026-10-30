export function bubbleTail(rect: { x: number; y: number; width: number; height: number }, target: { x: number; y: number }, viewport: { width: number; height: number }) {
  const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
  const right = rect.x + rect.width, bottom = rect.y + rect.height;
  if (target.x >= rect.x && target.x <= right && target.y >= rect.y && target.y <= bottom) return '';
  // Clip along the same ray, so a face outside the bubble window still receives
  // the correct bearing instead of bending the pointer toward a clamped point.
  const tip = (x: number, y: number) => {
    const dx = target.x - x, dy = target.y - y;
    let t = 1;
    if (target.x < 2) t = Math.min(t, (2 - x) / dx);
    else if (target.x > viewport.width - 3) t = Math.min(t, (viewport.width - 3 - x) / dx);
    if (target.y < 2) t = Math.min(t, (2 - y) / dy);
    else if (target.y > viewport.height - 3) t = Math.min(t, (viewport.height - 3 - y) / dy);
    return `${x + dx * t},${y + dy * t}`;
  };
  const cx = rect.x + rect.width / 2, cy = rect.y + rect.height / 2;
  const dx = target.x - cx, dy = target.y - cy;
  if (Math.abs(dx) / rect.width >= Math.abs(dy) / rect.height) {
    const x = dx < 0 ? rect.x + 2 : right - 2;
    const y = clamp(cy + dy * Math.abs((x - cx) / dx), rect.y + 24, bottom - 24);
    return `${x},${y - 8} ${tip(x, y)} ${x},${y + 8}`;
  }
  const y = dy < 0 ? rect.y + 2 : bottom - 2;
  const x = clamp(cx + dx * Math.abs((y - cy) / dy), rect.x + 24, right - 24);
  return `${x - 8},${y} ${tip(x, y)} ${x + 8},${y}`;
}
