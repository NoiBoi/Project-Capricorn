import type { AssistantPhase } from './ipc';

export const PORTRAITS = {
  calm: 'face-calm.png', aside: 'face-aside.png', smug: 'face-smug.png', wide: 'face-wide.png',
  look: 'face-look.png', laugh: 'face-laugh.png', many: 'face-many.png', grin: 'capri-face.png',
} as const;
export type Portrait = keyof typeof PORTRAITS;
export function transmissionFace(phase: AssistantPhase, text: string): Portrait {
  if (phase === 'error') return 'wide';
  if (phase === 'thinking' || phase === 'transcribing') return 'aside';
  if (phase === 'listening') return 'calm';
  if (/\b(ha(?:ha)+|laugh|magnificent|beautiful)\b/i.test(text)) return 'grin';
  if (/\b(preem|mischief|trouble|bold|challenge)\b/i.test(text)) return 'smug';
  return text.includes('?') ? 'look' : 'calm';
}
export function transmissionStatus(phase: AssistantPhase, hasText: boolean, elapsedSec: number) {
  if (phase === 'error') return { kind: 'error', label: 'Error', detail: 'Reply interrupted' };
  if (phase === 'thinking' || phase === 'transcribing') return { kind: 'work', label: elapsedSec >= 15 ? 'Still working' : 'Thinking', detail: `${Math.max(0, elapsedSec)} s` };
  if (phase === 'listening') return { kind: 'work', label: 'Listening', detail: 'Microphone active' };
  if (phase === 'speaking') return { kind: 'chat', label: 'Speaking', detail: 'Voice active' };
  if (phase === 'offline') return { kind: 'idle', label: 'Offline', detail: 'Commands only' };
  return { kind: hasText ? 'chat' : 'idle', label: hasText ? 'Reply' : 'Ready', detail: '' };
}
