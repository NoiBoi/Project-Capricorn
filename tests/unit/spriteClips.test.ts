import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { SPRITE_CLIPS, spriteBase, spriteFrame, spriteFacing, type SpriteClip } from '../../src/renderer/character/spriteClips';
import { snapWindow, attachToWindow, windowAttachment, INVERTED_SEAT_RATIO } from '../../src/main/desktop/perch';
import { codexEventText } from '../../src/main/ai/codexAccount';

describe('lachydotmcg artwork integration', () => {
  it('ships every original strip with the expected PNG cell dimensions', () => {
    for (const [name, clip] of Object.entries(SPRITE_CLIPS)) {
      const png = fs.readFileSync(path.join(__dirname, '../../assets/capri/lachy', `${name}.png`));
      expect(png.subarray(1, 4).toString()).toBe('PNG');
      expect(png.readUInt32BE(16), name).toBe(clip.width * clip.frames);
      expect(png.readUInt32BE(20), name).toBe(384);
    }
  });
  it('keeps animation frames inside their cells, including long runtimes and wake completion', () => {
    for (const name of Object.keys(SPRITE_CLIPS) as SpriteClip[]) {
      for (const time of [0, 0.1, 1.7, 12, 3600, -1]) {
        expect(spriteFrame(name, time)).toBeGreaterThanOrEqual(0);
        expect(spriteFrame(name, time)).toBeLessThan(SPRITE_CLIPS[name].frames);
      }
    }
    expect(spriteFrame('wake', 40, false)).toBe(12);
  });
  it('prioritizes held, sleeping, and speaking states over perching', () => {
    expect(spriteBase({ sleeping: true, dragging: true, ledge: true, speaking: false })).toBe('dangle');
    expect(spriteBase({ sleeping: true, dragging: false, ledge: true, speaking: false })).toBe('sleep');
    expect(spriteBase({ sleeping: false, dragging: false, ledge: true, speaking: true })).toBe('perch');
    expect(spriteBase({ sleeping: false, dragging: false, ledge: true, speaking: false })).toBe('perch');
  });
});

describe('desktop buddy regressions', () => {
  it('mirrors the left-facing source to look toward a cursor on the right', () => {
    expect(spriteFacing(1)).toBe(-1);
    expect(spriteFacing(-1)).toBe(1);
    expect(spriteFacing(0.02, -1)).toBe(-1);
    expect(spriteFacing(1, 1, 'perch')).toBe(1);
    expect(spriteFacing(-1, 1, 'perch')).toBe(-1);
    expect(spriteFacing(1, 1, 'perch_blink')).toBe(1);
    expect(spriteFacing(1, 1, 'perch_glitch')).toBe(1);
  });
  it('snaps by the seat line even when the target window is not foreground', () => {
    const pet = { x: 300, y: 200, width: 200, height: 300 };
    const target = { handle: 5n, rect: { x: 200, y: 450, width: 600, height: 300 } };
    expect(snapWindow([{ handle: 8n, rect: { x: 0, y: 0, width: 100, height: 100 } }, target], pet, 0.8)?.handle).toBe(5n);
    expect(snapWindow([target], { ...pet, y: 50 }, 0.8)).toBeNull();
  });
  it('can be dropped onto a high title bar using the inverted contact point', () => {
    const pet = { x: 300, y: -40, width: 200, height: 300 };
    const target = { handle: 9n, rect: { x: 200, y: 18, width: 600, height: 500 } };
    expect(snapWindow([target], pet, 0.712, 56, () => 0)?.handle).toBe(9n);
  });
  it('sits upside down below high windows and restores the seat with room above, on either monitor', () => {
    const pet = { x: 300, y: 200, width: 200, height: 300 };
    const high = { x: 100, y: -880, width: 800, height: 600 };
    const hung = windowAttachment(pet, high, 0.712, -900, 0.3);
    expect(hung.mode).toBe('inverted');
    expect(Math.abs(hung.bounds.y + pet.height * INVERTED_SEAT_RATIO - high.y)).toBeLessThan(1);
    const seated = windowAttachment(hung.bounds, { ...high, y: -500 }, 0.712, -900, hung.fraction, hung.mode);
    expect(seated.mode).toBe('perch');
    expect(Math.abs(seated.bounds.y + pet.height * 0.712 + 500)).toBeLessThan(1);
    expect(seated.bounds.x).toBe(hung.bounds.x);
    const boundary = { ...high, y: -814 };
    expect(windowAttachment(pet, boundary, 0.712, -900, 0.3, 'inverted').mode).toBe('inverted');
    expect(windowAttachment(pet, boundary, 0.712, -900, 0.3, 'perch').mode).toBe('perch');
    // A title bar at the former early-flip height now keeps her upright.
    expect(windowAttachment(pet, { ...high, y: -715 }, 0.712, -900).mode).toBe('perch');
    expect(windowAttachment(pet, { ...high, y: -735 }, 0.712, -900)).toMatchObject({ mode: 'perch', reclining: true });
    expect(windowAttachment(pet, { ...high, y: -825 }, 0.712, -900)).toMatchObject({ mode: 'inverted', reclining: false });
    expect(windowAttachment(pet, { ...high, y: -650 }, 0.712, -900)).toMatchObject({ mode: 'perch', reclining: false });
  });
  it('keeps the same relative seat when the attached window moves or resizes', () => {
    const pet = { x: 300, y: 200, width: 200, height: 300 };
    const first = attachToWindow(pet, { x: 200, y: 450, width: 600, height: 300 }, 0.8);
    expect(first.bounds.y).toBe(210);
    const moved = attachToWindow(first.bounds, { x: 500, y: 600, width: 900, height: 400 }, 0.8, first.fraction);
    expect(moved.bounds).toMatchObject({ x: 700, y: 360 });
  });
});

describe('Codex conversation protocol', () => {
  it('uses completed assistant text and never exposes tool messages or diagnostics', () => {
    expect(codexEventText('{"type":"item.completed","item":{"type":"agent_message","text":"Hey, choom."}}')).toEqual({ text: 'Hey, choom.' });
    expect(codexEventText('{"type":"item.completed","item":{"type":"command_execution","text":"private output"}}')).toEqual({});
    expect(codexEventText('not JSON')).toEqual({});
    expect(codexEventText('{"type":"turn.failed","error":{"message":"Limit reached"}}')).toEqual({ error: 'Limit reached' });
  });
});
