import { describe, expect, it } from 'vitest';
import { ContextPings, PING_LINES, pingLine } from '../../src/shared/contextPings';
import { dropLine } from '../../src/shared/dropDialogue';
import { parseInspection, inspectionSpots, explorationBeat } from '../../src/main/desktop/inspection';
import { BackgroundBudget } from '../../src/main/ai/backgroundBudget';

describe('contextual pings', () => {
  it('has many complete, nonrepeating late-night variants', () => {
    const recent: string[] = [];
    for (let i = 0; i < 20; i++) recent.push(pingLine('late', recent, () => .2));
    expect(new Set(recent).size).toBe(20); expect(Object.values(PING_LINES).flat().length).toBeGreaterThan(60);
  });
  it('limits late-night pings across reloads and stops at morning', () => {
    const now = new Date(2026, 9, 27, 2, 5), local = { hour: 2, weekday: 'Tuesday', weekend: false };
    const p = new ContextPings(() => .2);
    expect(p.next(now, local)?.kind).toBe('late'); expect(p.next(new Date(+now + 60000), local)).toBeNull();
    const q = new ContextPings(() => .5); q.restore(p.snapshot());
    expect(q.next(new Date(+now + 46 * 60000), { ...local, hour: 3 })?.kind).toBe('late');
    expect(q.next(new Date(+now + 100 * 60000), { ...local, hour: 4 })).toBeNull();
    expect(q.next(new Date(+now + 4 * 3600000), { ...local, hour: 6 })).toBeNull();
  });
  it('requires real fresh weather and an unplugged low battery', () => {
    const now = new Date(2026, 9, 27, 12), local = { hour: 12, weekday: 'Tuesday', weekend: false };
    expect(new ContextPings().next(now, local)).toBeNull();
    expect(new ContextPings().next(now, { ...local, weather: { condition: 'rain', celsius: 15, observedAt: +now - 3600001 } })).toBeNull();
    expect(new ContextPings().next(now, { ...local, weather: { condition: 'rain', celsius: 15, observedAt: +now } })?.kind).toBe('rain');
    expect(new ContextPings().next(now, { ...local, battery: { percent: 10, charging: true } })).toBeNull();
    expect(new ContextPings().next(now, { ...local, battery: { percent: 10, charging: false } })?.kind).toBe('battery');
  });
});
describe('drop fallback and request priority', () => {
  it.each(['youtube', 'discord', 'chatgpt', 'spotify'])('provides varied grounded %s fallback lines', app => {
    const info = { title: app === 'youtube' ? 'YouTube' : app, process: app + '.exe' }, recent: string[] = [];
    for (let i = 0; i < 6; i++) recent.push(dropLine(info, recent, () => .3));
    expect(new Set(recent).size).toBe(6); expect(recent.join(' ')).not.toMatch(/I (?:read|saw) your/);
  });
  it('reserves a bounded drop allowance without competing with background work', () => {
    let now = 1000000; const b = new BackgroundBudget(undefined, () => now);
    for (let i = 0; i < 6; i++) { expect(b.reserve('ambient')).toBe(true); now += 30001; }
    for (let i = 0; i < 4; i++) { expect(b.reserve('placement')).toBe(true); now += 15001; }
    expect(b.reserve('placement')).toBe(false); expect(b.reserve('ambient')).toBe(false);
  });
});
describe('grounded window inspection and varied movement', () => {
  it('maps only valid crop-relative coordinates and ignores points without an image', () => {
    const raw = JSON.stringify({ line: 'Ooh, that diagram.', points: [{ x: .5, y: .25, label: 'diagram' }, { x: 2, y: .2, label: 'outside' }] });
    expect(parseInspection(raw).points).toEqual([]);
    expect(parseInspection(raw, { jpegBase64: 'fixture', region: { x: 100, y: 200, width: 800, height: 400 } }).points).toEqual([{ x: 500, y: 300, label: 'diagram' }]);
    expect(parseInspection('a plain line').line).toBe('a plain line');
  });
  it('filters occupied inspection approaches and mixes long pauses with short ones', () => {
    const pet = { x: 0, y: 0, width: 200, height: 300 }, area = { x: 0, y: 0, width: 1200, height: 900 };
    expect(inspectionSpots([{ x: 500, y: 400, label: 'art' }], pet, area, () => false)).toEqual([]);
    expect(inspectionSpots([{ x: 500, y: 400, label: 'art' }], pet, area, () => true)).toHaveLength(1);
    expect(explorationBeat(1, true, () => .9).pauseMs).toBeGreaterThan(12000);
    expect(explorationBeat(2, false, () => .8).pauseMs).toBeLessThan(5000);
    expect(explorationBeat(1, true, () => .9, true).pauseMs).toBeLessThan(1000);
  });
});
