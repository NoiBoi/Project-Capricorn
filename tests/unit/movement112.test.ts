import { expect, it, vi } from 'vitest';
import { snapWindow } from '../../src/main/desktop/perch';
import { TeleportController } from '../../src/main/desktop/teleportController';
import { DEFAULT_SETTINGS } from '../../src/shared/settings';
import { nullLogger } from '../../src/main/log';

it('chooses the nearest contact instead of the first enumerated window', () => {
  const pet = { x: 200, y: 200, width: 200, height: 300 };
  const farther = { handle: 1n, rect: { x: 100, y: 405, width: 700, height: 300 } };
  const nearer = { handle: 2n, rect: { ...farther.rect, y: 442 } };
  expect(snapWindow([farther, nearer], pet, .8)?.handle).toBe(2n);
  expect(snapWindow([farther, nearer], pet, .8, 56, undefined, w => w.handle !== 2n)?.handle).toBe(1n);
});

it('matches the high-window contact point on an offset monitor', () => {
  const pet = { x: -700, y: -935, width: 200, height: 300 };
  const target = { handle: 3n, rect: { x: -800, y: -880, width: 700, height: 600 } };
  expect(snapWindow([target], pet, .712, 56, () => -900)?.handle).toBe(3n);
  expect(snapWindow([target], { ...pet, x: 100 }, .712, 56, () => -900)).toBeNull();
});

function rig(prepare: () => Promise<void>) {
  const moved = vi.fn(), move = vi.fn(); let allowed = true;
  const t: TeleportController = new TeleportController({ settings: () => structuredClone(DEFAULT_SETTINGS),
    bounds: () => ({ x: 0, y: 100, width: 200, height: 300 }), move, moved,
    displays: () => [], cursor: () => ({ x: 0, y: 0 }), activeWindow: () => null,
    aiConnected: () => false, blocked: () => null, userIdleSec: () => 0, log: nullLogger,
    canOccupy: () => allowed, prepareFlight: prepare,
    cue: c => { if (c.type === 'teleport') queueMicrotask(() => t.ack(c.id, c.phase)); } });
  return { t, move, moved, block: () => { allowed = false; } };
}
const destination = { x: 400, y: 100, width: 200, height: 300, kind: 'perch' as const };
it('rechecks a protected destination after releasing the supported pose', async () => {
  const r = rig(async () => { r.block(); });
  expect(await r.t.jumpTo(destination)).toBe(false);
  expect(r.move).not.toHaveBeenCalled(); expect(r.moved).not.toHaveBeenCalled(); expect(r.t.active).toBe(false);
});
it('does not complete an arrival cancelled during takeoff', async () => {
  const r = rig(async () => { r.t.cancel(); });
  expect(await r.t.jumpTo(destination)).toBe(false);
  expect(r.move).not.toHaveBeenCalled(); expect(r.t.active).toBe(false);
});
it('accepts a vanished landing without producing a fake move receipt', async () => {
  const r = rig(async () => {});
  expect(await r.t.jumpTo(() => null)).toBe(false);
  expect(r.move).not.toHaveBeenCalled(); expect(r.moved).not.toHaveBeenCalled();
});
it('resolves the actual snapped edge again after releasing the pose', async () => {
  let latest = destination;
  const r = rig(async () => { latest = { ...destination, x: 520 }; });
  expect(await r.t.jumpTo(() => latest)).toBe(true);
  expect(r.move).toHaveBeenCalledWith(expect.objectContaining({ x: 520 }), 'teleport');
});
