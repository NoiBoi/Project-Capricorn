import { describe, expect, it } from 'vitest';
import { ExplorationDirector } from '../../src/shared/explorationDirector';
import { parsePlayingTrack, SongBanterGate } from '../../src/main/spotifyContext';

describe('bounded purposeful outings', () => {
  const places = [{ key: 'one', surface: 'spotify' as const }, { key: 'two', surface: 'youtube' as const }, { key: 'three', surface: 'discord' as const }];
  it('retains a mission over multiple visits then takes a real rest', () => {
    let turn = 0; const d = new ExplorationDirector(() => turn++ === 0 ? 0 : .5); let now = 1000000;
    const a = d.choose(places, now)!; expect(a.goal).toBe('something unfamiliar');
    const rest = d.complete(a.key, now); expect(rest).toBeGreaterThanOrEqual(40000);
    expect(d.choose(places, now + 1000)).toBeNull();
    now = d.snapshot().restUntil + 1;
    const b = d.choose(places, now)!; expect(b.goal).toBe(a.goal); expect(b.key).not.toBe(a.key);
    const endRest = d.complete(b.key, now); expect(endRest).toBeGreaterThanOrEqual(120000); expect(d.snapshot().outing).toBeNull();
  });
  it('chooses different physical forms rather than repeating a roam-perch routine', () => {
    const d=new ExplorationDirector(()=>0); let now=1000000; const manners=new Set<string>(); let previous='';
    for(let i=0;i<8;i++) { const pick=d.choose([{key:'place_'+i}],now)!; manners.add(pick.manner); expect(pick.manner).not.toBe(previous); previous=pick.manner; d.complete(pick.key,now); now=d.snapshot().restUntil+1; }
    expect(manners.size).toBeGreaterThanOrEqual(3);
  });
  it('persists visits and rest across launches without raw window titles', () => {
    const first = new ExplorationDirector(() => .9), now = 1000000;
    const pick = first.choose([{ key: 'one' }], now)!; first.complete(pick.key, now);
    const restored = new ExplorationDirector(() => .9); restored.restore(first.snapshot(), now + 1000);
    expect(restored.choose(places, now + 2000)).toBeNull();
    expect(restored.snapshot().visits[0].key).toBe(pick.key);
    expect(restored.snapshot().restUntil - now).toBeGreaterThanOrEqual(8 * 60000);
  });
  it('waits when the only window is already visited instead of looping it again', () => {
    const d = new ExplorationDirector(() => .1), now = 1000000;
    const a = d.choose([places[0]], now)!; d.complete(a.key, now);
    expect(d.choose([places[0]], d.snapshot().restUntil + 1)).toBeNull();
  });
  it('allows new visual evidence to justify one revisit, while an old unresolved question cannot bypass visit memory', () => {
    const d=new ExplorationDirector(()=>0), now=1000000;
    const pick=d.choose([{key:'one',interest:12,interestAt:now-1}],now)!;d.complete(pick.key,now);
    const later=d.snapshot().restUntil+1;
    expect(d.choose([{key:'one',interest:12,interestAt:now-1}],later)).toBeNull();
    const ready=d.snapshot().restUntil+1;
    expect(d.choose([{key:'one',interest:12,interestAt:ready-1}],ready)?.key).toBe('one');
  });
  it('resumes an interrupted outing without counting a failed visit as finished', () => {
    const d = new ExplorationDirector(() => .3), now = 1000000;
    const a = d.choose(places, now)!; const before = d.snapshot().outing;
    d.interrupt(a.key, now); expect(d.snapshot().visits).toHaveLength(0);
    expect(d.choose(places, now + 1000)).toBeNull();
    const resumed = d.choose(places, now + 61000)!;
    expect(resumed.goal).toBe(before!.goal); expect(d.snapshot().outing!.left).toBe(before!.left);
  });
  it('never immediately repeats a goal and bounds saved visits', () => {
    const d = new ExplorationDirector(() => .1); let now = 1000000; let last = '';
    for (let i = 0; i < 40; i++) {
      const picked = d.choose([{ key: `place_${i}` }], now)!;
      expect(picked.goal).not.toBe(last); last = picked.goal; d.complete(picked.key, now); now = d.snapshot().restUntil + 1;
    }
    expect(d.snapshot().visits.length).toBeLessThanOrEqual(32);
    expect(d.snapshot().recentGoals.length).toBeLessThanOrEqual(3);
  });
  it('lets an unresolved visual interest influence the next safe outing without bypassing rest', () => {
    const d = new ExplorationDirector(() => 0), now = 1000000;
    const pick = d.choose([{ key: 'ordinary' }, { key: 'unfinished-diagram', interest: 12 }], now)!;
    expect(pick.key).toBe('unfinished-diagram');
    d.complete(pick.key, now);
    expect(d.choose([{ key: 'unfinished-diagram', interest: 12 }], now + 1000)).toBeNull();
  });
});
describe('sparse Spotify opinions', () => {
  const raw = JSON.stringify({ title: 'Track', artist: 'Artist', playing: true, source: 'Spotify.exe' });
  it('requires actual playing Spotify session metadata, not an app/window title', () => {
    expect(parsePlayingTrack(raw)).toMatchObject({ title: 'Track', artist: 'Artist' });
    expect(parsePlayingTrack('Track - Artist - Spotify')).toBeNull();
    expect(parsePlayingTrack(raw.replace('true', 'false'))).toBeNull();
    expect(parsePlayingTrack(raw.replace('Spotify.exe', 'Other.exe'))).toBeNull();
    expect(parsePlayingTrack(raw.replace('Artist', ''))).toBeNull();
  });
  it('spaces probes, caps opinions to 15 minutes, and avoids the same track for two hours', () => {
    const gate = new SongBanterGate(), track = parsePlayingTrack(raw)!; const now = 1000000;
    expect(gate.eligible(now)).toBe(true); gate.probe(now); expect(gate.eligible(now + 60000)).toBe(false);
    gate.attempted(track, now); expect(gate.eligible(now + 899999)).toBe(false); expect(gate.eligible(now + 900001)).toBe(true);
    expect(gate.fresh(track, now + 900001)).toBe(false); expect(gate.fresh(track, now + 7200001)).toBe(true);
  });
});
