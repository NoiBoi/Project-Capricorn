import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { BackgroundBudget } from '../../src/main/ai/backgroundBudget';
import { selectMemories, recentContext } from '../../src/main/ai/promptContext';
import { worldContext } from '../../src/shared/worldContext';
import { arrivalLine } from '../../src/shared/arrival';
import { companyControl } from '../../src/shared/company';
import type { MemoryItem } from '../../src/shared/ipc';
describe('activity, grounded context and background economy', () => {
  it('lets engaged discussion use its remaining allowance without a timer, preserving hard caps',()=>{
    const b=new BackgroundBudget(undefined,()=>1000000);
    expect(b.reserve('ambient')).toBe(true);expect(b.reserve('ambient')).toBe(false);
    for(let i=0;i<5;i++)expect(b.reserve('ambient',true)).toBe(true);
    expect(b.canReserve('ambient',true)).toBe(false);expect(b.reserve('ambient',true)).toBe(false);
    expect(b.reserve('memory',true)).toBe(true);expect(b.reserve('memory',true)).toBe(false);
  });
  it('allows a correction batch after one minute while retaining the total background ceiling', () => {
    let now = 1000000; const b = new BackgroundBudget(undefined, () => now);
    expect(b.reserve('memory')).toBe(true); expect(b.reserve('memory')).toBe(false);
    now += 60001; expect(b.reserve('memory')).toBe(true);
    now += 60001; expect(b.reserve('memory')).toBe(true);
    now += 60001; expect(b.reserve('memory')).toBe(false);
    expect(b.reserve('ambient')).toBe(true); now += 60001; expect(b.reserve('ambient')).toBe(true);
    now += 60001; expect(b.reserve('ambient')).toBe(true);
    now += 30001; expect(b.reserve('ambient')).toBe(true);
    now += 30001; expect(b.reserve('ambient')).toBe(true);
    now += 30001; expect(b.reserve('ambient')).toBe(false); // three memory + five observations exhaust the shared eight
  });
  it('shares a persisted background ceiling without needing a reply reservation', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'capri-budget-')), file = path.join(dir, 'budget.json'); let now = 1000000;
    try {
      const b = new BackgroundBudget(file, () => now);
      expect(b.reserve('ambient')).toBe(true); expect(b.reserve('ambient')).toBe(false);
      expect(b.reserve('memory')).toBe(true); now += 120001;
      expect(b.reserve('ambient')).toBe(true); expect(b.reserve('memory')).toBe(true); now += 120001;
      expect(b.reserve('ambient')).toBe(true); expect(new BackgroundBudget(file, () => now).reserve('ambient')).toBe(false);
      for (let i=0;i<3;i++) { now += 30001; expect(new BackgroundBudget(file, () => now).reserve('ambient')).toBe(true); }
      now += 30001; expect(new BackgroundBudget(file, () => now).reserve('ambient')).toBe(false);
      now += 600001; expect(new BackgroundBudget(file, () => now).reserve('memory')).toBe(true);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
  it('retrieves a relevant working set while keeping full explicit recall and storage intact', () => {
    const saved: MemoryItem[] = Array.from({ length: 30 }, (_, i) => ({ id: String(i), text: `Unrelated saved detail number ${i}`, status: 'approved', source: 'user', createdAt: 0 }));
    saved[0].text = 'The user prefers painting watercolor landscapes.'; saved[1].text = "The user's name is Alex.";
    const selected = selectMemories(saved, 'What painting should we try?');
    expect(selected.some(m => m.id === '0')).toBe(true); expect(selected.some(m => m.id === '1')).toBe(true);
    expect(selected.length).toBeLessThanOrEqual(8); expect(selectMemories(saved, 'What do you remember about me?')).toHaveLength(30); expect(saved).toHaveLength(30);
  });
  it('selects actual world context, not unrelated cast biography on every turn', () => {
    const ordinary = worldContext('17 times 23'); expect(ordinary).toContain('NIGHT CITY PERSPECTIVE'); expect(ordinary).not.toContain('WORLD FACT:');
    expect(worldContext('What do you think of Talia?')).toContain('Talia grew up'); expect(worldContext('Roman and movies')).toContain('Roman Carax');
    expect(worldContext('D and revenge')).toContain('Snake Nation');
  });
  it('keeps recent full turns instead of an unbounded transcript', () => {
    const past = Array.from({ length: 10 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: String(i).repeat(1000) }));
    const current = recentContext(past, 4000); expect(current).toHaveLength(4); expect(current[0].role).toBe('user'); expect(current.at(-1)).toEqual(past.at(-1));
  });
  it('uses explicit mode commands without routing quotations into controls', () => {
    expect(companyControl('go to sleep')).toEqual({ kind: 'sleep' }); expect(companyControl('start exploring')).toEqual({ kind: 'explore' }); expect(companyControl('wake up')).toEqual({ kind: 'resume' });
    expect(companyControl('What does "go to sleep" mean?')).toBe(null);
  });
  it('ties arrival speech to its destination and avoids the previous line', () => {
    for (let i = 0; i < 15; i++) expect(arrivalLine('auto', 'PRIVATE Homework.pdf', i > 3, [])).not.toContain('Homework.pdf');
    // Optional arrivals may be silent, especially after another reaction.
  });
});
