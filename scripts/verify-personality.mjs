import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { _electron as electron } from 'playwright-core';
const root = path.resolve(import.meta.dirname, '..');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'capri-personality-'));
fs.writeFileSync(path.join(profile, 'settings.json'), JSON.stringify({ firstRunComplete: true, ai: { provider: 'offline' }, voice: { ttsEnabled: false }, character: { scale: 0.75, personality: true }, teleport: { auto: false } }));
const app = await electron.launch({ ...(process.env.CAPRI_EXE ? { executablePath: process.env.CAPRI_EXE, args: [] } : { args: [root] }), env: { ...process.env, CAPRI_TEST: '1', CAPRI_OFFSCREEN: '1', CAPRI_USER_DATA: profile } });
try {
  const char = await app.firstWindow(); await char.waitForFunction(() => window.__capriDebug);
  const folder = path.resolve(root, '../../work/life-check'); fs.mkdirSync(folder, { recursive: true });
  const report = [];
  for (const [name, events, frames] of [['curious', ['poke'], 10], ['annoyed', ['poke', 'poke', 'poke'], 24], ['content', ['pat', 'pat'], 10]]) {
    const result = await char.evaluate(({ events, frames }) => {
      const d = window.__capriDebug; d.manual(true); d.setSurface('air');
      for (const event of events) d.lifeEvent(event);
      d.step(0.1, frames);
      return { mood: d.life.mood, attention: d.life.attention, clip: d.model.activeClip, frame: d.model.activeFrame };
    }, { events, frames });
    report.push({ name, ...result });
    await char.screenshot({ path: path.join(folder, name + '.png'), omitBackground: true });
  }
  if (report[1].mood !== 'annoyed' || report[2].mood !== 'content' || report[2].clip !== 'grin') throw new Error('Personality visual check failed.');
  console.log(JSON.stringify(report));
} finally { await app.close(); }
