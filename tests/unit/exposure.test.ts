import { tourPlan } from '../../src/main/desktop/spatial';
import { describe, expect, it } from 'vitest';
import { helperWindow, exposedRegions, exposedBody, bodyFootprint, intersects } from '../../src/main/desktop/exposure';
import { visitAside } from '../../src/shared/visitDialogue';
import { DialogueDirector } from '../../src/shared/dialogue';
describe('visible window tours', () => {
  it.each([{ title: 'QA OSD', process: 'unknown.exe' }, { title: 'GeForce Overlay', process: 'NVIDIA Overlay.exe' }, { title: 'Overlay', process: 'nvspcap64.exe' }])('rejects helper %j', info => expect(helperWindow(info)).toBe(true));
  it('keeps normal application windows eligible', () => expect(helperWindow({ title: 'Design review.pdf', process: 'Acrobat.exe' })).toBe(false));
  it('subtracts overlapping covers instead of treating the whole window as visible', () => {
    const target = { x: 0, y: 0, width: 1000, height: 800 }, cover = { x: 0, y: 0, width: 700, height: 800 };
    const regions = exposedRegions(target, [cover]); expect(regions).toEqual([{ x: 700, y: 0, width: 300, height: 800 }]);
    expect(exposedRegions(target, [target])).toEqual([]);
  });
  it('plans a flight and an inverted perch exclusively in the uncovered portion', () => {
    const pet = { x: 0, y: 0, width: 300, height: 400 }, window = { x: 100, y: 100, width: 1200, height: 800 }, cover = { x: 100, y: 100, width: 800, height: 800 }, area = { x: 0, y: 0, width: 1920, height: 1080 };
    const plan = tourPlan(pet, window, [cover], area, { x: 200, y: 700 });
    expect(plan).not.toBeNull(); expect(plan!.perch.mode).toBe('inverted');
    for (const point of plan!.points) { expect(exposedBody(point, [cover], area)).toBe(true); expect(intersects(bodyFootprint(point), cover)).toBe(false); }
    expect(exposedBody(plan!.perch.bounds, [cover], area)).toBe(true);
    expect(tourPlan(pet, window, [window], area, { x: 0, y: 0 })).toBeNull();
  });
  it('varies real movement reactions without reciting the app title', () => {
    const d = new DialogueDirector(() => .5);
    const recent: string[] = []; for (let i = 0; i < 10; i++) recent.push(d.choose({ event: 'roam', recent }, { required: true }));
    expect(new Set(recent).size).toBe(10); expect(visitAside('perch', recent, 0)).not.toContain('app');
  });
});
