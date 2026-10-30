import { companionDialogue } from './dialogue';
import type { DialogueSurface } from './dialogueContext';
import type { ExplorationGoal } from './explorationDirector';
export function visitAside(stage: 'roam' | 'perch', recent: readonly string[], _turn: number, inverted = false, surface?: DialogueSurface, purpose?: ExplorationGoal, resting = false) {
  return companionDialogue.choose({ event: stage, recent, inverted, surface, purpose, resting });
}
