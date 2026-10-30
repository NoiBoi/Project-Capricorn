import { describe, expect, it } from 'vitest';
import { DeveloperController, previewWait } from '../../src/main/developer';
import { DEV_ANIMATIONS } from '../../src/shared/developer';
import { SPRITE_CLIPS } from '../../src/renderer/character/spriteClips';

describe('developer jobs', () => {
  it('supports every actual sprite strip', () => expect([...DEV_ANIMATIONS].sort()).toEqual(Object.keys(SPRITE_CLIPS).sort()));
  it('stops a running job promptly and resets exactly once', async () => {
    const d = new DeveloperController(); let resets = 0;
    d.start('long preview', async signal => previewWait(30000, signal), () => resets++);
    expect(d.active).toBe(true);
    expect(() => d.start('second', async () => {}, () => {})).toThrow(/already running/);
    const state = await d.stop();
    expect(state.result).toBe('stopped'); expect(resets).toBe(1); expect(d.active).toBe(false);
    await d.stop(); expect(resets).toBe(1);
  });
  it('clears temporary state after failures and allows the next job', async () => {
    const d = new DeveloperController(); let resets = 0;
    d.start('failing check', async () => { throw Error('Missing test asset'); }, () => resets++);
    await new Promise(r => setTimeout(r, 0));
    expect(d.snapshot().result).toBe('failed'); expect(d.snapshot().log.some(l => l.text.includes('Missing test asset'))).toBe(true);
    expect(resets).toBe(1);
    d.start('good check', async () => {}, () => resets++); await new Promise(r => setTimeout(r, 0));
    expect(d.snapshot().result).toBe('passed'); expect(resets).toBe(2);
  });
  it('bounds the in-app result log', () => { const d = new DeveloperController(); for (let i = 0; i < 100; i++) d.note(`step ${i}`); expect(d.snapshot().log).toHaveLength(60); });
});
