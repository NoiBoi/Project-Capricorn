import type { Params } from './params';

/**
 * Whole-body postures she holds for a while (legs, hips, lean, arms). Clips layer on top.
 * Sources: W = wiki frames, N = Netflix "The Moment D Meets Capri" (5wGdjjwoDbY),
 * B = "Capri is a baddie" compilation of Netflix footage (Nli_SZ-DBco). See docs/ANIMATION_CATALOG.md.
 */
export type PostureName = 'stand' | 'contrapposto' | 'sit_edge' | 'air_sit' | 'recline' | 'power_stance' | 'peek_left' | 'peek_right' | 'balance';
export type Surface = 'taskbar' | 'window' | 'air' | 'edge_left' | 'edge_right';

export interface Posture { name: PostureName; source: string; pose: Partial<Params>; surfaces: Surface[] }

export const POSTURES: Record<PostureName, Posture> = {
  stand: { name: 'stand', source: 'W1, B 4:08 (front, arms hanging long)', surfaces: ['taskbar', 'window', 'air'], pose: {} },
  contrapposto: {
    name: 'contrapposto', source: 'B 3:33 (weight on one leg, hip out, arms away from body)', surfaces: ['taskbar', 'window', 'air'],
    pose: { thighL: 7, kneeL: 0, thighR: -8, kneeR: 18, foreR: 0.93, hip: 0.9, bodyRot: -0.035, armLRaise: 0.07, armRRaise: 0.12, headRoll: 0.06 },
  },
  sit_edge: {
    // sits on the ledge: one leg laid out along it, the other dangling over (behind the taskbar / window edge)
    name: 'sit_edge', source: 'W2 + N 2:22 (seated on the edge of a bed, one leg along the edge)', surfaces: ['taskbar', 'window'],
    pose: { hipDrop: 186, thighL: 86, foreL: 0.64, kneeL: 26, thighR: 5, foreR: 0.34, kneeR: -6, lean: -0.05, armLRaise: 0.04, armRRaise: 0.04, armSpread: 0.14, float: 0.4 },
  },
  air_sit: {
    // knees drawn up, sitting on nothing
    name: 'air_sit', source: 'B 0:23 (curled up, floating beside a building)', surfaces: ['air'],
    pose: { hipDrop: 40, thighL: 122, foreL: 0.6, kneeL: 128, thighR: 118, foreR: 0.6, kneeR: 122, armLRaise: 0.3, armRRaise: 0.3, armSpread: 0.1, float: 0.75, headPitch: 0.12 },
  },
  recline: {
    // lounging back in mid-air, one leg crossed, hand behind the head
    name: 'recline', source: 'B 0:48 (reclining in the air beside D); N 0:29 (lying on her side on the bed)', surfaces: ['air', 'taskbar', 'window'],
    pose: { lean: -0.4, hipDrop: 36, thighL: 38, kneeL: 64, foreL: 0.85, thighR: -16, kneeR: 12, armLRaise: 1, armRRaise: 0.05, float: 0.8, headRoll: 0.2, mouthSmile: 0.7, squint: 0.3 },
  },
  power_stance: {
    name: 'power_stance', source: 'B 1:23, B 4:53 (standing in a burst, arms out)', surfaces: ['taskbar', 'window', 'air'],
    pose: { thighL: 16, thighR: 16, kneeL: -4, kneeR: -4, armSpread: 0.85, hairWind: 1, headPitch: -0.12, eyeWide: 0.3 },
  },
  peek_left: {
    // leaning in from the left screen edge, as she leans in over shoulders / between people
    name: 'peek_left', source: 'B 0:28, B 4:48, B 2:13–2:28 (leaning in, peeking between characters)', surfaces: ['edge_left'],
    pose: { lean: 0.42, headRoll: -0.32, thighL: 4, thighR: -3, armRRaise: 0.38, armLRaise: 0.05, gazeX: 0.6, mouthSmile: 0.8, squint: 0.25 },
  },
  peek_right: {
    name: 'peek_right', source: 'B 0:28, B 4:48, B 2:13–2:28', surfaces: ['edge_right'],
    pose: { lean: -0.42, headRoll: 0.32, thighL: -3, thighR: 4, armLRaise: 0.38, armRRaise: 0.05, gazeX: -0.6, mouthSmile: 0.8, squint: 0.25 },
  },
  balance: {
    // perched on top of something, arms slightly out for balance
    name: 'balance', source: 'B 0:18 (standing on top of D’s head)', surfaces: ['window'],
    pose: { thighL: 3, thighR: 3, armSpread: 0.28, armLRaise: 0.1, armRRaise: 0.1, float: 0.35, headPitch: 0.15 },
  },
};

/** Which postures make sense for where she is on the desktop, with relative weights. */
export function posturesFor(surface: Surface): [PostureName, number][] {
  switch (surface) {
    case 'taskbar': return [['sit_edge', 5], ['recline', 2.5], ['contrapposto', 1]];
    case 'window': return [['sit_edge', 5], ['recline', 2.5], ['balance', 1]];
    case 'edge_left': return [['peek_left', 1]];
    case 'edge_right': return [['peek_right', 1]];
    default: return [['air_sit', 3], ['recline', 2], ['contrapposto', 2], ['stand', 1]];
  }
}
