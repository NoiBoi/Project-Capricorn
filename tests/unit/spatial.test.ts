import { afterEach, expect, it, vi } from 'vitest';
import { surfaceAnchors, surfaceTour, traversalPlan, traversalPoint, cursorResponse } from '../../src/main/desktop/spatial';
import { intersects, bodyFootprint } from '../../src/main/desktop/exposure';
import { TeleportController } from '../../src/main/desktop/teleportController';
import { DEFAULT_SETTINGS } from '../../src/shared/settings';
import { nullLogger } from '../../src/main/log';

const area = { x: -1200, y: -600, width: 1600, height: 1000 };
const displays = [{ id: 2, workArea: area, bounds: area, scaleFactor: 1.5 }];
const pet = { x: -1100, y: -500, width: 120, height: 180 };
const w = { handle: 42n, rect: { x: -950, y: -300, width: 900, height: 500 } };
const cursor = { x: 200, y: 300 };
afterEach(() => vi.useRealTimers());

it('preserves anchor identity and favorite fraction across an offset-monitor move', () => {
  const a = surfaceAnchors(pet, w, [], area, cursor, .42).find(a => a.edge === 'top' && a.fraction === .42)!;
  const moved = { ...w, rect: { ...w.rect, x: w.rect.x + 23, y: w.rect.y + 11 } };
  const b = surfaceAnchors(pet, moved, [], area, cursor, .42).find(b => b.id === a.id)!;
  expect(b.bounds.x - a.bounds.x).toBe(23); expect(b.bounds.y - a.bounds.y).toBe(11);
  expect(surfaceTour(pet, moved, [], area, cursor, false, .42)?.perch.id).toBe(a.id);
});
it('uses exposed spans, avoids title-bar buttons, and gives fully covered windows no anchor', () => {
  const cover = { ...w.rect, width: 500 };
  const anchors = surfaceAnchors(pet, w, [cover], area, cursor);
  expect(anchors.some(a => a.edge === 'top')).toBe(true);
  for (const a of anchors) expect(intersects(bodyFootprint(a.bounds), cover)).toBe(false);
  for (const a of anchors.filter(a => a.edge === 'top')) expect(a.bounds.x + pet.width * .7).toBeLessThanOrEqual(w.rect.x + w.rect.width - 138);
  expect(surfaceAnchors(pet, w, [w.rect], area, cursor)).toEqual([]);
});
it('routes around a protected region and refuses disconnected monitor gaps', () => {
  const to = { ...pet, x: -400, y: -50 }, obstacle = { x: -850, y: -400, width: 150, height: 200 };
  const safe = (r: typeof pet) => !intersects(bodyFootprint(r), obstacle);
  const plan = traversalPlan(pet, to, displays, safe)!;
  expect(plan.kind).toBe('edge');
  for (let i = 0; i <= 100; i++) expect(safe({ ...pet, ...traversalPoint(pet, plan, i / 100) })).toBe(true);
  const far = { ...pet, x: 1000 };
  expect(traversalPlan(pet, far, [...displays, { ...displays[0], workArea: { ...area, x: 950 } }], () => true)).toBeNull();
});
it('makes a real hop and retreats from an approaching pointer without chasing a stationary one', () => {
  const to = { ...pet, x: pet.x + 160 }, p = traversalPlan(pet, to, displays, () => true, true)!;
  expect(p.kind).toBe('hop'); expect(traversalPoint(pet, p, .5).y).toBeLessThan(pet.y - 40);
  const center = { x: pet.x + 50, y: pet.y + 70 };
  const response = cursorResponse(pet, center, { ...center, x: center.x + 100 }, area);
  expect(Math.abs(response.x - pet.x)).toBeGreaterThan(65);
});

function rig() {
  let bounds = { ...pet }, blocked = false;
  const moved = vi.fn(), frames: typeof pet[] = [], cues: any[] = [];
  const t = new TeleportController({ settings: () => structuredClone(DEFAULT_SETTINGS), bounds: () => bounds,
    move: r => { bounds = r; frames.push(r); }, displays: () => displays, cursor: () => cursor, activeWindow: () => null,
    aiConnected: () => false, blocked: () => null, userIdleSec: () => 0, moved, log: nullLogger,
    canOccupy: () => !blocked, cue: c => { cues.push(c); if (c.type === 'teleport') queueMicrotask(() => t.ack(c.id, c.phase)); } });
  return { t, moved, frames, cues, block: () => { blocked = true; } };
}
it.each(['manual','ai'] as const)('reports the protected traversal for %s glide even when the legacy AI monitor is disconnected',async reason=>{
  const moved=vi.fn(),move=vi.fn(),arrived=vi.fn();
  const start={x:300,y:300,width:180,height:240};
  const t=new TeleportController({settings:()=>structuredClone(DEFAULT_SETTINGS),bounds:()=>start,move,moved,arrived,
    displays:()=>[{id:1,bounds:{x:0,y:0,width:1920,height:1080},workArea:{x:0,y:0,width:1920,height:1040},scaleFactor:1}],
    cursor:()=>({x:0,y:0}),activeWindow:()=>null,aiConnected:()=>false,blocked:()=>null,userIdleSec:()=>0,log:nullLogger,cue:()=>{},
    // The destination is clear; the rounded first frame meets a protected area.
    canOccupy:r=>r.x!==start.x||r.y!==start.y});
  expect(await t.go('left',reason,'glide')).toEqual({ok:false,detail:'Glide stopped at a protected area; native position may have changed.'});
  expect(move).not.toHaveBeenCalled();expect(moved).not.toHaveBeenCalled();expect(arrived).not.toHaveBeenCalled();
  expect(t.count).toBe(0);expect(t.active).toBe(false);
});
it('attributes interrupted AI travel to cancellation, and keeps automatic admission checks intact',async()=>{
  vi.useFakeTimers();const r=rig();
  const travel=r.t.go('left','ai','glide');await vi.advanceTimersByTimeAsync(160);r.t.cancel();
  await vi.advanceTimersByTimeAsync(2000);
  expect(await travel).toMatchObject({ok:false,detail:expect.stringContaining('cancelled by a newer instruction')});
  expect(r.moved).not.toHaveBeenCalled();expect(r.t.count).toBe(0);
  expect(await r.t.go('left','auto','glide')).toMatchObject({ok:false,detail:'AI is not connected'});
});
it('reports a path failure before native travel and admits successful AI glide without the legacy monitor',async()=>{
  vi.useFakeTimers();let protectedPath=true,bounds={x:300,y:300,width:180,height:240};const moved=vi.fn();
  const t=new TeleportController({settings:()=>structuredClone(DEFAULT_SETTINGS),bounds:()=>bounds,move:r=>{bounds=r;},moved,
    displays:()=>[{id:1,bounds:{x:0,y:0,width:1920,height:1080},workArea:{x:0,y:0,width:1920,height:1040},scaleFactor:1}],
    cursor:()=>({x:0,y:0}),activeWindow:()=>null,aiConnected:()=>false,blocked:()=>null,userIdleSec:()=>0,log:nullLogger,cue:()=>{},
    canOccupy:()=>!protectedPath,prepareFlight:async()=>{protectedPath=true;}});
  protectedPath=false;
  expect(await t.go('left','ai','glide')).toEqual({ok:false,detail:'No safe traversal path to the destination.'});
  expect(moved).not.toHaveBeenCalled();expect(t.count).toBe(0);
  // A separate clear route proves disconnected legacy status is not AI admission.
  const r=rig();const travel=r.t.go('left','ai','glide');await vi.advanceTimersByTimeAsync(5000);
  expect(await travel).toMatchObject({ok:true});expect(r.moved).toHaveBeenCalledOnce();expect(r.t.count).toBe(1);
});
it('executes the hop through native positions, stops on interruption and emits no false arrival', async () => {
  vi.useFakeTimers(); const r = rig();
  const flight = r.t.flyTo({ ...pet, x: pet.x + 160, kind: 'spot' }, { hop: true, silent: true });
  await vi.advanceTimersByTimeAsync(240);
  expect(r.frames.length).toBeGreaterThan(5); expect(Math.min(...r.frames.map(f => f.y))).toBeLessThan(pet.y - 10);
  r.t.cancel(); const last = r.frames.at(-1);
  await vi.advanceTimersByTimeAsync(2000);
  expect(await flight).toBe(false); expect(r.frames.at(-1)).toBe(last); expect(r.moved).not.toHaveBeenCalled();
  expect(r.cues.at(-1)).toMatchObject({ type: 'dash', dir: 0 });
});
it('stops mid-flight if an area becomes protected', async () => {
  vi.useFakeTimers(); const r = rig();
  const flight = r.t.flyTo({ ...pet, x: -500, kind: 'spot' });
  await vi.advanceTimersByTimeAsync(160); r.block();
  const count = r.frames.length; await vi.advanceTimersByTimeAsync(3000);
  expect(await flight).toBe(false); expect(r.frames.length).toBe(count); expect(r.moved).not.toHaveBeenCalled();
});
