import type { Rect } from './displays';

export const nextExploreDelay = (rand = Math.random, mode: 'normal' | 'explore' | 'sleep' = 'normal') => mode === 'explore' ? 30000 + Math.floor(rand() * 15000) : 50000 + Math.floor(rand() * 35000);

/** Floating visits stay on-screen and inside the observed window's area where possible. */
export function floatingVisit(pet: Rect, target: Rect, area: Rect, rand = Math.random): Rect {
  const x = target.x + target.width * (0.25 + rand() * 0.5) - pet.width / 2;
  const y = target.y + target.height * (0.25 + rand() * 0.35) - pet.height * 0.3;
  return { ...pet, x: Math.round(Math.max(area.x, Math.min(area.x + area.width - pet.width, x))),
    y: Math.round(Math.max(area.y, Math.min(area.y + area.height - pet.height, y))) };
}
