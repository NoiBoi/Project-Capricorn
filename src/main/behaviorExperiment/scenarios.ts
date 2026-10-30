import type { BehaviorEvent, Decision, Observation } from '../behavior/core';
export const START = 1800000000000;
export const fact = (id = 'color', detail = 'Two color swatches: muted green and vivid violet.', at = START): Observation =>
  ({ id, at, target: 'window-42', title: 'Palette study', process: 'paint.exe', evidence: 'visual', detail });
export const hold: Decision = { interpretation: 'A color choice is visible; a question might fit later.',
  interest: { topic: 'the violet swatch', intention: 'Ask why the quieter green is beside that violet.', sourceId: 'color', quote: 'muted green and vivid violet' },
  action: 'defer', line: '', gesture: 'none', reason: 'Keep the curiosity without interrupting the current activity.' };
export const ask: Decision = { ...hold, interest: null, action: 'speak', line: 'I keep coming back to that violet. Are you keeping it beside the green?', gesture: 'curious', reason: 'An opportunity arrived while the color curiosity is still relevant.' };
export const nod: Decision = { ...hold, interest: null, action: 'gesture', line: '', gesture: 'nod', reason: 'Acknowledge the pat while retaining the color curiosity.' };
export const correction: Decision = { ...hold, interest: null, action: 'speak', line: 'All right. The shape, then. What are you trying to change?', gesture: 'none', reason: 'The user changed the subject; the old color interest was superseded.' };
export interface Scenario { name: string; steps: { after: number; event: BehaviorEvent; answer?: Decision; restart?: boolean }[] }
export const scenarios: Scenario[] = [
  { name: 'Notice, wait, then ask', steps: [
    { after: 0, event: { kind: 'observe', observation: { ...fact('metadata'), evidence: 'metadata', detail: 'An art application is open.' } } },
    { after: 0, event: { kind: 'observe', observation: fact() }, answer: hold },
    { after: 61000, event: { kind: 'opportunity' }, answer: ask }] },
  { name: 'Affection retains curiosity', steps: [
    { after: 0, event: { kind: 'observe', observation: fact() }, answer: hold },
    { after: 1000, event: { kind: 'interact', id: 'pat', text: '[The user pats Capri.]', contact: 'pat' }, answer: nod },
    { after: 61000, event: { kind: 'opportunity' }, answer: ask }] },
  { name: 'Correction supersedes curiosity', steps: [
    { after: 0, event: { kind: 'observe', observation: fact() }, answer: hold },
    { after: 1000, event: { kind: 'interact', id: 'correction', text: 'Forget the colors. I am changing the shape.', supersedes: true }, answer: correction },
    { after: 61000, event: { kind: 'opportunity' } }] },
  { name: 'Deliberate quiet and repeated evidence', steps: [
    { after: 0, event: { kind: 'observe', observation: fact() }, answer: { ...hold, action: 'silent', reason: 'The detail can wait; no useful interruption.' } },
    { after: 61000, event: { kind: 'observe', observation: { ...fact('repeat'), at: START + 61000 } } },
    { after: 0, event: { kind: 'interact', id: 'quiet', text: 'Stay quiet for a bit.', control: 'quiet' } },
    { after: 61000, event: { kind: 'opportunity' } }] },
  { name: 'Restart preserves an unfinished interest', steps: [
    { after: 0, event: { kind: 'observe', observation: fact() }, answer: hold },
    { after: 61000, restart: true, event: { kind: 'opportunity' }, answer: ask }] },
  { name: 'Expired interest does not wake a model', steps: [
    { after: 0, event: { kind: 'observe', observation: fact() }, answer: hold },
    { after: 11 * 60000, restart: true, event: { kind: 'opportunity' } }] },
];
