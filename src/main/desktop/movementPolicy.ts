import type { Rect } from './displays';
import { bodyFootprint, intersects } from './exposure';

/** Metadata-only fallback: protect the broad viewing area without claiming player bounds. */
export function videoWindow(info: { title: string; process: string }) {
  return /youtube|netflix|twitch|prime video|disney\+|hulu|vimeo|dailymotion/i.test(info.title)
    || /^(?:vlc|mpv|potplayer|wmplayer|moviesandtv)(?:\.exe)?$/i.test(info.process);
}
export function videoCenter(window: Rect): Rect {
  return { x: window.x + window.width * .25, y: window.y + window.height * .12, width: window.width * .50, height: window.height * .78 };
}
export function clearVideo(pet: Rect, window: Rect) { return !intersects(bodyFootprint(pet), videoCenter(window)); }

/** Exact title/app first, then a unique partial match. Ambiguity never picks an arbitrary window. */
export function resolveWindow<T extends { handle: bigint; title: string; process: string }>(query: string, windows: T[], current?: bigint | null): T | null {
  let q = query.toLowerCase().replace(/^(?:the|my)\s+/, '').replace(/\s+window$/, '').trim();
  const aliases:Record<string,string>={'google chrome':'chrome','microsoft edge':'msedge',edge:'msedge','visual studio code':'code',vscode:'code','vs code':'code','discord app':'discord'};
  q = aliases[q] ?? q;
  if (/^(?:this|that|current|active)(?: window)?$/.test(q)) return windows.find(w => w.handle === current) ?? null;
  if (!q) return null;
  const app = (w: T) => w.process.toLowerCase().replace(/\.exe$/, '');
  const exact = windows.filter(w => w.title.toLowerCase() === q || app(w) === q);
  const matches = exact.length ? exact : windows.filter(w => (w.title + ' ' + app(w)).toLowerCase().includes(q));
  return matches.length === 1 ? matches[0] : null;
}
