import type { Rect } from './displays';
import type { EnvironmentalReading } from '../../shared/curiosity';
export interface InterestPoint { x: number; y: number; label: string }
export interface WindowObservation { jpegBase64: string; signature?:string; region: Rect; window?: Rect }
const shortText = (value: unknown) => typeof value === 'string' ? value.replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, 160) : '';
export function inspectionReading(raw: string): EnvironmentalReading {
  try {
    const data = JSON.parse(raw.replace(/^```(?:json)?\s*|\s*```$/g, '').trim());
    return { facts: Array.isArray(data.facts) ? data.facts.map(shortText).filter(Boolean).slice(0, 3) : [],
      interpretation: shortText(data.interpretation), curiosity: shortText(data.curiosity) };
  } catch { return { facts: [], interpretation: '', curiosity: '' }; }
}
/** Coordinates are normalized to the supplied exposed crop, never the whole screen. */
export function parseInspection(raw: string, observation?: WindowObservation) {
  try {
    const data = JSON.parse(raw.replace(/^```(?:json)?\s*|\s*```$/g, '').trim());
    if (!data || typeof data.line !== 'string') return { line: raw, points: [] as InterestPoint[] };
    const points: InterestPoint[] = observation && Array.isArray(data.points) ? data.points.filter((p: any) => p && Number.isFinite(p.x) && Number.isFinite(p.y) && p.x >= .03 && p.x <= .97 && p.y >= .03 && p.y <= .97 && typeof p.label === 'string')
      .slice(0, 2).map((p: InterestPoint) => ({ x: observation.region.x + p.x * observation.region.width, y: observation.region.y + p.y * observation.region.height, label: p.label.slice(0, 80) })) : [];
    return { line: data.line, points };
  } catch { return { line: raw, points: [] as InterestPoint[] }; }
}
export function inspectionSpots(points: InterestPoint[], pet: Rect, area: Rect, safe: (r: Rect) => boolean) {
  return points.flatMap(p => {
    const options = [-1, 1].map(side => ({ ...pet,
      x: Math.round(Math.max(area.x, Math.min(area.x + area.width - pet.width, p.x + side * pet.width * .55 - pet.width / 2))),
      y: Math.round(Math.max(area.y, Math.min(area.y + area.height - pet.height, p.y - pet.height * .35))) }));
    const spot = options.find(safe); return spot ? [{ ...spot, interest: p }] : [];
  });
}
export function explorationBeat(hop: number, inspecting: boolean, random = Math.random, preview = false) {
  const r = random();
  return { pauseMs: preview ? 350 + r * 450 : inspecting ? 6000 + r * 9000 : hop === 1 || r < .35 ? 4500 + r * 11000 : 1400 + r * 3800,
    curve: (random() - .5) * (inspecting ? 45 : 110), pace: .8 + random() * .55 };
}
