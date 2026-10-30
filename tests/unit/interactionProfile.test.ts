import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { InteractionProfile } from '../../src/main/store/interactionProfile';
import { tmpDir } from './helpers';

describe('persistent observed companion patterns', () => {
  it('counts continuous active samples, not idle gaps, restarts or switches', () => {
    const dir = tmpDir(); let now = new Date(2026, 9, 27, 10).getTime();
    const p = new InteractionProfile(dir, () => true, () => 90, () => now);
    p.observe('code');
    for (let i = 0; i < 65; i++) { now += 1000; p.observe('code'); }
    p.observe(null); now += 600000; p.observe('code');
    p.observe('notes'); now += 1000; p.observe('notes');
    now += 600000; p.observe('notes');
    p.touch('pat'); p.touch('pat'); p.touch('chat'); p.flush();
    expect(p.summary().activity).toEqual([{ category: 'code', minutes: 1, recentMinutes: 1 }]);
    const again = new InteractionProfile(dir, () => true, () => 90, () => now);
    now += 1000; again.observe('code'); again.flush();
    expect(again.summary().interactions).toEqual({ pat: 2, poke: 0, chat: 1 });
    expect(again.context()).toContain('not a complete computer history');
    expect(again.context()).toContain('never consent');
    expect(fs.readFileSync(path.join(dir, 'interaction-profile.json'), 'utf8')).not.toMatch(/title|screenshot|process|path|password/);
  });
  it('separates recent habits from older observations and obeys retention/clearing', () => {
    const dir = tmpDir(); let now = new Date(2026, 9, 1, 12).getTime(), enabled = true, retain = 90;
    const p = new InteractionProfile(dir, () => enabled, () => retain, () => now);
    p.touch('pat'); now += 10 * 86400000; p.touch('poke'); p.flush();
    expect(p.summary()).toMatchObject({ daysObserved: 2, interactions: { pat: 1, poke: 1 }, recentInteractions: { pat: 0, poke: 1 } });
    retain = 7; p.privacyChanged(); expect(p.summary().interactions.pat).toBe(0);
    enabled = false; p.privacyChanged();
    expect(fs.existsSync(path.join(dir, 'interaction-profile.json'))).toBe(false);
    enabled = true; expect(p.summary().daysObserved).toBe(0);
    p.touch('chat'); p.clear(); p.flush(); expect(p.summary().interactions.chat).toBe(0);
  });
  it('rejects invalid aggregate fields, duplicate days and future dates', () => {
    const dir = tmpDir(), now = new Date(2026, 9, 27, 12).getTime();
    fs.writeFileSync(path.join(dir, 'interaction-profile.json'), JSON.stringify([
      { day: '2026-10-27', seconds: { code: 120, title: 'private', music: -60 }, interactions: { pat: 2, chat: 'bad', unknown: 9 } },
      { day: '2026-10-27', seconds: { code: 99999 }, interactions: { pat: 200 } },
      { day: '2027-01-01', seconds: { code: 600 }, interactions: {} },
      null,
    ]));
    const p = new InteractionProfile(dir, () => true, () => 90, () => now);
    expect(p.summary()).toMatchObject({ daysObserved: 1, activity: [{ category: 'code', minutes: 2 }], interactions: { pat: 2, chat: 0, poke: 0 } });
    expect(p.context()).not.toContain('private');
  });
});
