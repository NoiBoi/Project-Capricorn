import type { CharacterCue } from '../../shared/ipc';
import type { Expression } from '../behavior/core';

/** Narrow bridge to existing rendering contracts. No filesystem, input control or new permissions. */
export function expressionSink(host: {
  cue: (cue: CharacterCue) => void;
  present: (text: string) => boolean;
  validTarget: (target: string) => boolean;
  glance: (target: string) => boolean;
}) {
  return (expression: Expression) => {
    if (expression.action === 'silent' || expression.action === 'defer') return false;
    if (expression.target && !host.validTarget(expression.target)) return false;
    if (expression.action === 'investigate') return !!expression.target && host.glance(expression.target);
    if (expression.action === 'speak' && !host.present(expression.line)) return false;
    if (expression.gesture !== 'none') host.cue({ type: 'react', reaction: expression.gesture });
    return true;
  };
}
