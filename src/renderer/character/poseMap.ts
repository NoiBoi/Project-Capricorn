import type { PoseName } from './model';

export interface PoseInput {
  surface: string; // 'taskbar' | 'window' | 'air' | edges…
  posture: string;
  sleeping: boolean;
  dragging: boolean;
  variant: number; // 0–1, rolled once per posture so the choice holds
  back?: boolean; // turned away, looking at your screen
}

/**
 * Which pose of the model fits what she is doing. Lying down and sitting need something under her:
 * on the taskbar she lies along it or hovers just above it; on a window top she sits on the
 * edge. With nothing under her she floats upright or with her knees drawn up — she never lies or sits
 * on thin air. Turning away for a moment to look at your screen, she shows her back (n 3:33,
 * standing in the sky, so it works floating too); otherwise she always faces you.
 */
export function modelPoseFor(i: PoseInput): PoseName {
  const ledge = i.surface === 'taskbar' || i.surface === 'window';
  if (i.dragging) return 'crouch';
  if (i.sleeping) return ledge ? 'lie' : 'crouch';
  if (i.back) return 'back';
  if (!ledge) return 'crouch';
  if (i.posture === 'recline') return 'lie';
  // a mix, rolled once per posture so each choice holds a while: not always the same pose
  if (i.surface === 'taskbar') return i.variant < 0.45 ? 'lie' : i.variant < 0.75 ? 'crouch' : 'back';
  return i.variant < 0.65 ? 'sit' : 'back'; // on a window top: sitting on the edge, or standing on it watching your screen
}
