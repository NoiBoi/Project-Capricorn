import { describe, expect, it } from 'vitest';
import { invitesCloserLook } from '../../src/shared/curiosity';
describe('curiosity action promises', () => {
  it('recognizes closer-look lines without treating every curiosity as movement', () => {
    for (const line of ['Ooh, hang on. I want to see.', 'Let me get closer.', 'Hang on, I’m coming over.', 'I want another look.']) expect(invitesCloserLook(line)).toBe(true);
    for (const line of ['I like this view.', 'I’m curious now.', 'I don’t want to see that.', 'The weather says snow. I’d want to see that.']) expect(invitesCloserLook(line)).toBe(false);
  });
});
