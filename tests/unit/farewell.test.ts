import { afterEach, describe, expect, it, vi } from 'vitest';
import { Farewell, cleanFarewell } from '../../src/main/farewell';
afterEach(() => vi.useRealTimers());
function harness(generate = async (_signal: AbortSignal) => 'See you, trouble.') {
  const events: string[] = [];
  const d = { visible: () => true, prepare: () => events.push('prepare'), generate: vi.fn(generate), fallback: () => 'Off I go.', show: (s: string) => events.push(s), depart: async () => { events.push('depart'); }, finish: () => events.push('finish') };
  return { events, d, sequence: new Farewell(d) };
}
describe('bounded quit sequence', () => {
  it('generates once, shows the line, departs, then finishes despite repeated quit clicks', async () => {
    vi.useFakeTimers(); const h = harness(); const run = h.sequence.start(); await h.sequence.start();
    await vi.runAllTimersAsync(); await run;
    expect(h.events).toEqual(['prepare', 'See you, trouble.', 'depart', 'finish']); expect(h.d.generate).toHaveBeenCalledOnce();
  });
  it('uses a local farewell when generation never resolves', async () => {
    vi.useFakeTimers(); const h = harness(() => new Promise<string>(() => {})); const run = h.sequence.start();
    await vi.runAllTimersAsync(); await run;
    expect(h.events).toEqual(['prepare', 'Off I go.', 'depart', 'finish']);
  });
  it('does not reveal a hidden companion or make a request to quit', async () => {
    vi.useFakeTimers(); const h = harness(); h.d.visible = () => false;
    await h.sequence.start(); expect(h.events).toEqual(['prepare', 'finish']); expect(h.d.generate).not.toHaveBeenCalled();
  });
  it('finishes even if departure never acknowledges', async () => {
    vi.useFakeTimers(); const h = harness(); h.d.depart = () => new Promise<void>(() => {}); void h.sequence.start();
    await vi.advanceTimersByTimeAsync(8501); expect(h.events.at(-1)).toBe('finish'); expect(h.events.filter(e => e === 'finish')).toHaveLength(1);
  });
  it('rejects action output and cleans a plain farewell', () => {
    expect(cleanFarewell('<action>do something</action>')).toBe('');
    expect(cleanFarewell('“See you.\nBehave.”')).toBe('See you. Behave.');
  });
});
