import { afterEach, expect, it, vi } from 'vitest';
import { StatusFx } from '../../src/renderer/character/statusFx';
afterEach(() => vi.unstubAllGlobals());
it('clears the error expression when recovery or an interrupt supersedes it', () => {
  vi.stubGlobal('Image', class { complete = true; naturalWidth = 100; naturalHeight = 100; src = ''; });
  const drawImage = vi.fn(), noop = () => {};
  const ctx = { save: noop, restore: noop, fillRect: noop, strokeRect: noop, drawImage } as unknown as CanvasRenderingContext2D;
  const fx = new StatusFx();
  fx.setPhase('error'); fx.draw(ctx, .1, 300, 500, false, true); expect(drawImage).toHaveBeenCalledOnce();
  drawImage.mockClear(); fx.setPhase('idle'); fx.draw(ctx, .1, 300, 500, false, true); expect(drawImage).not.toHaveBeenCalled();
  fx.setPhase('error'); fx.clear(); fx.draw(ctx, .1, 300, 500, false, true); expect(drawImage).not.toHaveBeenCalled();
});
