import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { _electron as electron, type ElectronApplication } from 'playwright-core';
import { afterEach, describe, expect, it } from 'vitest';

const root = path.resolve(__dirname, '../..');
let app: ElectronApplication | undefined;
const dirs: string[] = [];
async function launch(dir: string) {
  app = await electron.launch({ ...(process.env.CAPRI_EXE ? { executablePath: process.env.CAPRI_EXE, args: [] } : { args: [root] }), env: { ...process.env, CAPRI_TEST: '1', CAPRI_OFFSCREEN: '1', CAPRI_USER_DATA: dir, CAPRI_NO_DEV_KEY: '1', GEMINI_API_KEY: '' } });
  await app.firstWindow();
  for (let i = 0; i < 100; i++) {
    if (await app.evaluate(() => !!(globalThis as any).__capri)) return app;
    await new Promise(r => setTimeout(r, 100));
  }
  throw Error('Capri startup timed out');
}
afterEach(async () => {
  if (app) await app.close().catch(() => {});
  app = undefined;
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});
describe('observed patterns and long recall in the real app', () => {
  it('renders persisted patterns, counts real touches, feeds chat and clears private aggregates', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'capri-patterns-e2e-')); dirs.push(dir);
    const now = new Date(), day = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({ firstRunComplete: true, ai: { provider: 'offline' }, memory: { enabled: true, interactionProfile: true, autoLearn: false }, voice: { ttsEnabled: false }, teleport: { auto: false } }));
    fs.writeFileSync(path.join(dir, 'interaction-profile.json'), JSON.stringify([{ day, seconds: { code: 1200 }, interactions: { pat: 14, poke: 1, chat: 2 } }]));
    const instance = await launch(dir);
    const char = instance.windows().find(w => w.url().includes('character.html'))!;
    await char.evaluate(() => (window as any).capri.invoke('char:interaction', 'pat'));
    await char.evaluate(() => (window as any).capri.invoke('panel:open', 'memory'));
    let panel = instance.windows().find(w => w.url().includes('panel.html'));
    for (let i = 0; !panel && i < 100; i++) { await new Promise(r => setTimeout(r, 100)); panel = instance.windows().find(w => w.url().includes('panel.html')); }
    if (!panel) throw Error('Missing panel');
    await panel.getByRole('button', { name: 'Clear observed patterns', exact: true }).waitFor();
    expect(await panel.locator('body').innerText()).toContain('15 head pats');
    expect(await panel.locator('body').innerText()).toContain('20 minutes in the last 7 days');
    expect(await panel.locator('body').evaluate(b => b.scrollWidth <= b.clientWidth + 1)).toBe(true);
    if (process.env.CAPRI_PROFILE_SCREENSHOT) {
      await panel.getByRole('button', { name: 'Clear observed patterns', exact: true }).scrollIntoViewIfNeeded();
      await panel.screenshot({ path: process.env.CAPRI_PROFILE_SCREENSHOT });
    }
    const context = await instance.evaluate(() => {
      const a = (globalThis as any).__capri;
      return a.convo.buildMessages('Do I pat you often?')[0].content;
    });
    expect(context).toContain('OBSERVED COMPANION PATTERNS'); expect(context).toContain('"pat":15'); expect(context).toContain('your last actual thought');
    await instance.close(); app = undefined;
    const restarted = await launch(dir);
    const restoredContext = await restarted.evaluate(() => (globalThis as any).__capri.convo.buildMessages('Hey')[0].content);
    expect(restoredContext).toContain('"pat":15');
    await restarted.evaluate(() => (globalThis as any).__capri.settings.update({ privacy: { saveHistory: false } }));
    expect(fs.existsSync(path.join(dir, 'interaction-profile.json'))).toBe(false);
    expect(await restarted.evaluate(() => (globalThis as any).__capri.convo.buildMessages('Hey')[0].content)).not.toContain('OBSERVED COMPANION PATTERNS');
  });
  it('recalls an exchange older than 2,000 messages without expanding the live turn window', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'capri-archive-e2e-')); dirs.push(dir);
    fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({ firstRunComplete: true, ai: { provider: 'offline', historyTurns: 4 }, memory: { autoLearn: false }, voice: { ttsEnabled: false }, teleport: { auto: false } }));
    const at = Date.now() - 86400000;
    const history = [{ id: 'fox-user', role: 'user', content: 'Our ceramic fox has a cobalt glaze and a crooked tail.', ts: at }, { id: 'fox-capri', role: 'assistant', content: 'The crooked tail stays. I voted for that.', ts: at + 1 },
      ...Array.from({ length: 2100 }, (_, i) => ({ id: `filler-${i}`, role: i % 2 ? 'assistant' : 'user', content: `Ordinary exchange number ${i}.`, ts: at + i + 2 }))];
    fs.writeFileSync(path.join(dir, 'history.jsonl'), history.map(m => JSON.stringify(m)).join('\n') + '\n');
    const instance = await launch(dir);
    const messages = await instance.evaluate(() => {
      const a = (globalThis as any).__capri;
      a.history.append({ id: 'current', role: 'user', content: 'Remember the cobalt ceramic fox?', ts: Date.now() });
      return a.convo.buildMessages('Remember the cobalt ceramic fox?');
    });
    expect(messages[0].content).toContain('The crooked tail stays');
    expect(messages.length).toBeLessThanOrEqual(10);
  });
});

