import { describe, expect, it } from 'vitest';
import type { MemoryItem } from '../../src/shared/ipc';
import { companionPersonalContext, preferredUserName } from '../../src/shared/userIdentity';
import { selectMemories } from '../../src/main/ai/promptContext';
import { buildSystemPrompt } from '../../src/main/ai/persona';
import { DEFAULT_SETTINGS } from '../../src/shared/settings';

const profile: MemoryItem[] = [
  { id: 'old', text: "The user's name is Matthew.", status: 'approved', source: 'user', createdAt: 1 },
  { id: 'current', text: 'Noi is a mechanical engineering student at Purdue University.', status: 'approved', source: 'user', createdAt: 2, updatedAt: 3,
    learnedFrom: { messageId: 'correction', evidence: "Matthew's too formal. Call me noi." } },
  { id: 'style', text: 'Never use em dashes.', status: 'approved', source: 'user', createdAt: 2 },
];
describe('identity continuity across conversational routes', () => {
  it('recognizes an explicit nickname correction stored on an existing profile fact', () => {
    expect(preferredUserName(profile)).toBe('Noi');
    expect(companionPersonalContext(profile)).toContain('Current preferred name: Noi.');
    expect(companionPersonalContext(profile)).toContain('Purdue');
  });
  it('keeps identity even when many highly relevant memories compete for the small working set', () => {
    const many: MemoryItem[] = [...profile, ...Array.from({ length: 30 }, (_, i) => ({ id: `topic-${i}`, text: `Music song guitar rhythm preference ${i}.`, status: 'approved' as const, source: 'user' as const, createdAt: 10 + i }))];
    const selected = selectMemories(many, 'Music song guitar rhythm');
    expect(selected.some(m => m.id === 'current')).toBe(true);
    expect(selected.length).toBeLessThanOrEqual(12);
    expect(buildSystemPrompt(DEFAULT_SETTINGS, many, new Date(), { compact: true, examples: false, actions: false, userText: 'Music song guitar rhythm' })).toContain('Current preferred name: Noi.');
  });
  it('does not establish identity from someone mentioned incidentally or an archived correction', () => {
    expect(preferredUserName([{ ...profile[1], archived: true }])).toBeUndefined();
    expect(preferredUserName([{ ...profile[1], status: 'pending' }])).toBeUndefined();
    expect(preferredUserName([{ ...profile[1], text: 'Alex is a classmate.', learnedFrom: undefined }])).toBeUndefined();
    expect(preferredUserName([{ ...profile[1], text: 'A current fact about another person.' }])).toBeUndefined();
  });
  it('honors disabled memory and keeps incidental context small', () => {
    expect(companionPersonalContext(profile, false)).toBe('');
    expect(companionPersonalContext(profile).length).toBeLessThan(1300);
    const s = structuredClone(DEFAULT_SETTINGS); s.memory.enabled = false;
    expect(buildSystemPrompt(s, profile, new Date(), { compact: true, examples: false })).not.toContain('Noi');
  });
});
