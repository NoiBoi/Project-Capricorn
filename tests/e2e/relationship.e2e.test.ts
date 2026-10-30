import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { _electron as electron, type ElectronApplication, type Page } from 'playwright-core';
import { afterEach, describe, expect, it } from 'vitest';
const root = path.resolve(__dirname, '../..');
let app: ElectronApplication | undefined;
const dirs: string[] = [];
function profile() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'capri-relationship-e2e-')); dirs.push(dir);
  fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({ firstRunComplete: true, character:{startupIntro:false}, ai: { provider: 'offline' }, memory: { enabled: true, autoLearn: false }, dialogue: { localContext: false }, voice: { ttsEnabled: false }, behavior: { quietHours: { enabled: false } }, teleport: { auto: false } })); return dir;
}
async function launch(dir: string) {
  app = await electron.launch({ ...(process.env.CAPRI_EXE ? { executablePath: process.env.CAPRI_EXE, args: [] } : { args: [root] }), env: { ...process.env, CAPRI_TEST: '1', CAPRI_OFFSCREEN: '1', CAPRI_USER_DATA: dir, CAPRI_NO_DEV_KEY: '1', GEMINI_API_KEY: '' } });
  await app.firstWindow();
  for (let i = 0; i < 100; i++) { if (await app.evaluate(() => !!(globalThis as any).__capri)) return app; await new Promise(r => setTimeout(r, 100)); }
  throw Error('Capri did not start');
}
async function memoryPanel(a: ElectronApplication): Promise<Page> {
  const char = a.windows().find(w => w.url().includes('character.html'))!;
  await char.evaluate(() => (window as any).capri.invoke('panel:open', 'memory'));
  for (let i = 0; i < 100; i++) { const p = a.windows().find(w => w.url().includes('panel.html')); if (p) { await p.getByRole('button', { name: 'Save taste', exact: true }).waitFor(); return p; } await new Promise(r => setTimeout(r, 100)); }
  throw Error('Memory panel did not open');
}
afterEach(async () => { if (app) await app.close().catch(() => {}); app = undefined; for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); });
describe('lasting relationship in the real app', () => {
  it('edits tastes and project status through the UI and preserves them after restarting', async () => {
    const dir = profile(), a = await launch(dir), panel = await memoryPanel(a);
    await panel.getByRole('textbox', { name: 'Taste topic', exact: true }).fill('Music');
    await panel.getByRole('textbox', { name: 'Capri preference', exact: true }).fill('Prefers loud guitars.');
    await panel.getByRole('button', { name: 'Save taste', exact: true }).click();
    await panel.getByText('Prefers loud guitars.', { exact: true }).first().waitFor();
    await panel.getByRole('textbox', { name: 'Project name', exact: true }).fill('Ceramic fox');
    await panel.getByRole('textbox', { name: 'Current project status', exact: true }).fill('Trying a cobalt glaze.');
    await panel.getByRole('button', { name: 'Save project', exact: true }).click();
    await panel.getByRole('button', { name: 'Pause', exact: true }).waitFor();
    await panel.getByRole('button', { name: 'Pause', exact: true }).click();
    await panel.getByText('paused', { exact: true }).waitFor();
    expect(await panel.locator('body').evaluate(b => b.scrollWidth <= b.clientWidth + 1)).toBe(true);
    if (process.env.CAPRI_RELATIONSHIP_SCREENSHOT) await panel.screenshot({ path: process.env.CAPRI_RELATIONSHIP_SCREENSHOT });
    await a.close(); app = undefined;
    const b = await launch(dir);
    const result = await b.evaluate(() => { const a = (globalThis as any).__capri; return { state: a.relationship.snapshot(), prompt: a.convo.buildMessages('What music do you like?')[0].content, followUp: a.relationship.candidate('', true) }; });
    expect(result.state.tastes[0].text).toBe('Prefers loud guitars.'); expect(result.state.threads[0].status).toBe('paused');
    expect(result.prompt).toContain('Prefers loud guitars'); expect(result.followUp).toBeUndefined();
    await b.evaluate(() => (globalThis as any).__capri.settings.update({ memory: { enabled: false } }));
    expect(await b.evaluate(() => (globalThis as any).__capri.relationship.snapshot().tastes.length)).toBe(1);
    expect(await b.evaluate(() => (globalThis as any).__capri.relationship.context())).toBe('');
    await b.evaluate(() => (globalThis as any).__capri.settings.update({ memory: { enabled: true } }));
    expect(await b.evaluate(() => (globalThis as any).__capri.relationship.context())).toContain('Prefers loud guitars');
  });
  it('retires the visible bubble line with a button, filters it after restarting and restores it', async () => {
    const dir = profile(), a = await launch(dir);
    await a.evaluate(() => (globalThis as any).__capri.presentRemark('Mm. Stay there a second.', true, false));
    let bubble: Page | undefined;
    for (let i = 0; !bubble && i < 100; i++) { bubble = a.windows().find(w => w.url().includes('bubble.html')); if (!bubble) await new Promise(r => setTimeout(r, 100)); }
    if (!bubble) throw Error('No bubble');
    await bubble.getByRole('button', { name: "Don't say this again", exact: true }).click();
    expect(await a.evaluate(() => (globalThis as any).__capri.retiredLines.list()[0].text)).toBe('Mm. Stay there a second.');
    await a.close(); app = undefined;
    const b = await launch(dir);
    const result = await b.evaluate(() => { const a = (globalThis as any).__capri; a.bubble.dismiss(); a.presentRemark('Mm. Stay there a second.', true, false); return { items: a.retiredLines.list(), blocked: a.companionDialogue.acceptGenerated('Mm. Stay there a second.', { event: 'pat' }, 'delight') }; });
    expect(result.items[0].lineId).toBeTruthy();
    const panel = await memoryPanel(b);
    await panel.getByRole('button', { name: 'Restore line', exact: true }).click();
    expect(await b.evaluate(() => (globalThis as any).__capri.retiredLines.list().length)).toBe(0);
  });
  it('handles spoken-style retirement locally and offers only eligible project callbacks', async () => {
    const a = await launch(profile());
    const result = await a.evaluate(async () => {
      const a = (globalThis as any).__capri;
      const sent=a.presentRemark('Mm. Stay there a second.', true, false);const before=a.history.recent(2);const bubbleBefore={...a.bubble.state};
      await a.convo.send("Don't say that again."); await a.convo.settle();
      const p = a.relationship.setThread({ title: 'Ceramic fox', summary: 'Trying cobalt glaze.', status: 'active', nextAskAt: Date.now() - 1000 });
      const greeting = a.convo.buildMessages('Hey')[0].content;
      const task = a.convo.buildMessages('What is seventeen times twenty-four?')[0].content;
      a.relationship.delivered('How did the ceramic fox glaze turn out?');
      return { sent,before,bubbleBefore,retired: a.retiredLines.list(), reply: a.history.recent(1)[0], greeting, task, next: a.relationship.candidate('', true), projectId: p.id };
    });
    expect(result.retired[0],JSON.stringify({sent:result.sent,before:result.before,bubble:result.bubbleBefore,reply:result.reply})).toBeDefined();expect(result.retired[0].text).toBe('Mm. Stay there a second.'); expect(result.reply.meta.provider).toBe('companion');
    expect(result.greeting).toContain('"followUp":{"id":'); expect(result.greeting).toContain('Ceramic fox');
    expect(result.task).toContain('"followUp":null'); expect(result.next).toBeUndefined();
  });
});
