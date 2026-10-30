import { afterEach, describe, expect, it, vi } from 'vitest';
import { Speaker } from '../../src/renderer/character/speaker';
import { DEFAULT_SETTINGS } from '../../src/shared/settings';
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
it('waits for the selected Windows voice without dropping the first sentence', async () => {
  vi.useFakeTimers(); let voices: any[]=[];
  const speak=vi.fn((u:any)=>u.onstart()), report=vi.fn(), settings=structuredClone(DEFAULT_SETTINGS);
  vi.stubGlobal('SpeechSynthesisUtterance',class { constructor(public text:string){} });
  vi.stubGlobal('speechSynthesis',{getVoices:()=>voices,speak,cancel:vi.fn()});
  const speaker=new Speaker(()=>settings,report,vi.fn());speaker.enqueue('first','First sentence.');
  await vi.advanceTimersByTimeAsync(100);expect(speak).not.toHaveBeenCalled();
  voices=[{name:'Microsoft Zira',lang:'en-US'}];await vi.advanceTimersByTimeAsync(50);
  expect(speak).toHaveBeenCalledTimes(1);expect(report).toHaveBeenCalledWith('first','start');
  speak.mock.calls[0][0].onend();await Promise.resolve();expect(report).toHaveBeenCalledWith('first','end');
});
it('cancels voice readiness and never plays a late available voice', async () => {
  vi.useFakeTimers();let voices:any[]=[];const speak=vi.fn(),report=vi.fn();
  vi.stubGlobal('SpeechSynthesisUtterance',class {});
  vi.stubGlobal('speechSynthesis',{getVoices:()=>voices,speak,cancel:vi.fn()});
  const settings=structuredClone(DEFAULT_SETTINGS),speaker=new Speaker(()=>settings,report,vi.fn());
  speaker.enqueue('cancelled','Do not play.');speaker.stopAll();voices=[{name:'Microsoft Zira',lang:'en-US'}];
  await vi.advanceTimersByTimeAsync(2500);expect(speak).not.toHaveBeenCalled();expect(report.mock.calls).toEqual([['cancelled','cancel']]);
});
it('reports an unavailable configured Windows voice once after a bounded wait', async()=>{
  vi.useFakeTimers();const report=vi.fn();vi.stubGlobal('SpeechSynthesisUtterance',class {});
  vi.stubGlobal('speechSynthesis',{getVoices:()=>[],speak:vi.fn(),cancel:vi.fn()});
  const settings=structuredClone(DEFAULT_SETTINGS),speaker=new Speaker(()=>settings,report,vi.fn());speaker.enqueue('missing','No substitute.');
  await vi.advanceTimersByTimeAsync(2100);expect(report.mock.calls).toEqual([['missing','error']]);expect(speaker.speaking).toBe(false);
});
function setup() {
  const sources: any[] = [];
  class Context {
    destination = {};
    async decodeAudioData() { return {}; }
    createBufferSource() { const src: any = { connect: (n: any) => n, start: vi.fn(), stop: () => src.onended?.(), onended: null }; sources.push(src); return src; }
    createGain() { return { connect: (n: any) => n, gain: { value: 1 } }; }
    createAnalyser() { return { connect: (n: any) => n, fftSize: 512, getFloatTimeDomainData: (a: Float32Array) => a.fill(0.1) }; }
  }
  vi.stubGlobal('AudioContext', Context); vi.stubGlobal('speechSynthesis', { cancel: vi.fn() });
  const settings = structuredClone(DEFAULT_SETTINGS); settings.voice.ttsEngine = 'openai';
  const resolves: ((b: Uint8Array) => void)[] = [];
  const fetch = vi.fn((_text: string, _mood?: string) => new Promise<Uint8Array>(r => resolves.push(r)));
  const report = vi.fn(); const speaker = new Speaker(() => settings, report, fetch);
  return { speaker, sources, resolves, fetch, report };
}
describe('speech mood and sequencing', () => {
  it('keeps fetches and playback sequential with the mood captured per utterance', async () => {
    const a = setup(); a.speaker.enqueue('a', 'One.', 'annoyed'); a.speaker.enqueue('b', 'Two.', 'content');
    expect(a.fetch).toHaveBeenCalledTimes(1); expect(a.fetch).toHaveBeenLastCalledWith('One.', 'annoyed');
    a.resolves[0](new Uint8Array([1])); await vi.waitFor(() => expect(a.sources[0]?.start).toHaveBeenCalled());
    expect(a.fetch).toHaveBeenCalledTimes(1); a.sources[0].onended();
    await vi.waitFor(() => expect(a.fetch).toHaveBeenCalledTimes(2));
    expect(a.fetch).toHaveBeenLastCalledWith('Two.', 'content');
    a.speaker.stopAll(); a.resolves[1](new Uint8Array([1]));
    await vi.waitFor(() => expect(a.report).toHaveBeenCalledWith('b', 'cancel'));
  });
  it('does not play a late remote response after stop', async () => {
    const a = setup(); a.speaker.enqueue('a', 'One.', 'curious'); a.speaker.stopAll(); a.resolves[0](new Uint8Array([1]));
    await vi.waitFor(() => expect(a.report).toHaveBeenCalledWith('a', 'cancel'));
    expect(a.sources).toHaveLength(0); expect(a.speaker.speaking).toBe(false);
  });
  it('starts a fresh reply immediately while a cancelled fetch is still pending', async () => {
    const a = setup(); a.speaker.enqueue('a', 'Old.', 'curious'); a.speaker.stopAll(); a.speaker.enqueue('b', 'Fresh.', 'content');
    expect(a.fetch).toHaveBeenCalledTimes(2);
    a.resolves[0](new Uint8Array([1])); a.resolves[1](new Uint8Array([1]));
    await vi.waitFor(() => expect(a.sources[0]?.start).toHaveBeenCalled());
    expect(a.sources).toHaveLength(1); a.speaker.stopAll();
  });
  it('reports cancellation once for playing and queued speech, rather than successful delivery', async () => {
    const a = setup(); a.speaker.enqueue('a', 'Playing.'); a.speaker.enqueue('b', 'Queued.');
    a.resolves[0](new Uint8Array([1])); await vi.waitFor(() => expect(a.sources[0]?.start).toHaveBeenCalled());
    a.speaker.stopAll(); a.sources[0].onended();
    expect(a.report.mock.calls.filter(([id, state]) => id === 'a' && state === 'cancel')).toHaveLength(1);
    expect(a.report).toHaveBeenCalledWith('b', 'cancel');
    expect(a.report.mock.calls.some(([, state]) => state === 'end')).toBe(false);
  });

});
