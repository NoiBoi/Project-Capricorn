export const INTRO_FRAMES = ['grab', 'mouth1', 'mouth2', 'mouth3', 'wave1', 'wave2', 'wave3', 'smear', 'happy'] as const;
export const INTRO_MS = 4250;
export interface IntroState { id: number; to: { x: number; y: number; size: number }; still: boolean; effects: boolean; greeting?: string }
export function introPosition(width: number, height: number, to: IntroState['to'], elapsed: number, still = false) {
  // Hands hold the viewport edges. Keep the vertical framing inside the work area
  // instead of using a cover transform that crops the close-up on other aspect ratios.
  const t = Math.max(0, elapsed / INTRO_MS), scale = width / 1672, scaleY = Math.min(scale, height / 941);
  const x = 830 * scale, y = (height - 941 * scaleY) / 2 + 330 * scaleY;
  if (still) { const s = Math.min(width * .65 / 1672, height * .6 / 941); return { x: width / 2, y: height * .42, scale: s, scaleY: s, progress: 0 }; }
  const u = Math.max(0, Math.min(1, (t - .85) / .13)), e = u * u;
  return { x: x + (to.x - x) * e, y: y + (to.y - y) * e,
    scale: scale * (1 - u) + to.size / 430 * u,
    scaleY: scaleY * (1 - u) + to.size / 430 * u, progress: u };
}
