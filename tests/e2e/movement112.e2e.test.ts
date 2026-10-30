import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { _electron as electron, type ElectronApplication } from 'playwright-core';
import { afterEach, expect, it } from 'vitest';
import { SEAT_RATIO } from '../../src/shared/framing';
import { closeIsolatedApp } from './lifecycle';

let app: ElectronApplication | undefined, dir: string;
afterEach(async () => {
  await closeIsolatedApp(app); app = undefined;
  if (dir) fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});
async function boot() {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'capri-movement112-'));
  fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({ firstRunComplete: true,
    character: { scale: .6, startupIntro: false, hideOnFullscreen: false }, ai: { provider: 'offline' },
    voice: { ttsEnabled: false, interactionLines: false }, behavior: { smallActivities: false, explore: false, idleRemarks: false },
    teleport: { auto: false, effects: false } }));
  app = await electron.launch({ ...(process.env.CAPRI_EXE ? { executablePath: process.env.CAPRI_EXE, args: [] } : { args: [path.resolve(__dirname, '../..')] }),
    env: { ...process.env, CAPRI_TEST: '1', CAPRI_OFFSCREEN: '1', CAPRI_USER_DATA: dir, CAPRI_NO_DEV_KEY: '1' } });
  const char = await app.firstWindow(); await char.waitForFunction(() => !!(window as any).__capriDebug);
  await app.evaluate(({ screen }) => {
    const g = globalThis as any, a = g.__capri, area = screen.getPrimaryDisplay().workArea;
    g.__capriIdleOverride = 0; g.__capriWindowHeld = false;
    g.__capriWindowInfo = { '17': { title: 'Document', process: 'fixture.exe' }, '19': { title: 'Other', process: 'fixture.exe' } };
    g.__capriWindowsOverride = [{ handle: 17n, rect: { x: area.x + 100, y: area.y + 380, width: 850, height: 350 } }];
    // Sample teleport starts, rather than relying on the final position alone.
    g.__departures = 0; g.__perchCues = []; const emit = a.teleporter.d.cue;
    a.teleporter.d.cue = (c: any) => { if (c.type === 'teleport' && c.phase === 'out') g.__departures++; emit(c); };
    const send = a.charWin.webContents.send.bind(a.charWin.webContents);
    a.charWin.webContents.send = (channel: string, ...args: any[]) => { if (args[0]?.type === 'perchMotion') g.__perchCues.push(args[0].phase); send(channel, ...args); };
  });
  // Allow startup position restoration to finish before placing the body.
  await char.waitForTimeout(600);
  return { a: app, char };
}
async function perch(a: ElectronApplication) {
  await a.evaluate((_e, ratio) => {
    const g = globalThis as any, a = g.__capri, w = g.__capriWindowsOverride[0].rect, b = a.charWin.getBounds();
    a.charWin.setBounds({ ...b, x: w.x + 200, y: Math.round(w.y - b.height * ratio) }); a.settleAfterDrop();
  }, SEAT_RATIO);
}

it('keeps the exposed ledge after a single-window visit instead of falling back to the monitor corner',async()=>{
  const {a}=await boot();
  const result=await a.evaluate(async()=>{
    const g=globalThis as any,a=g.__capri;g.__cornerRequests=0;a.settings.update({behavior:{quietHours:{enabled:false}}});
    const go=a.teleporter.go.bind(a.teleporter);a.teleporter.go=(target:string,...args:any[])=>{if(target==='corner')g.__cornerRequests++;return go(target,...args);};
    a.outings.choose=(places:any[])=>({key:places[0].key,goal:'somewhere to settle',manner:'settle',hops:1,pauseMs:0});
    await a.exploreTick(0,undefined,undefined,17n,true);
    return {corners:g.__cornerRequests,target:String(a.attentionHandle)};
  });
  expect(result).toEqual({corners:0,target:'17'});
});

it('lets explicit feet placement catch a YouTube top while autonomous video avoidance stays active',async()=>{
  const {a,char}=await boot();
  await a.evaluate((_e,ratio)=>{
    const g=globalThis as any,a=g.__capri,w=g.__capriWindowsOverride[0],b=a.charWin.getBounds();
    g.__capriWindowInfo['17']={title:'2500 Miles to Limp Home From the Arctic - YouTube',process:'chrome.exe'};
    w.rect={...w.rect,y:0,height:900};
    a.charWin.setBounds({...b,x:w.rect.x+w.rect.width/2-b.width/2,y:Math.round(-b.height*(1-ratio))});
    g.__autoUnsafe=!a.safeForTarget(a.placement(w).bounds,17n);a.settleAfterDrop();
  },SEAT_RATIO);
  expect(await a.evaluate(()=>(globalThis as any).__autoUnsafe)).toBe(true);
  await expect.poll(()=>char.evaluate(()=>(window as any).__capriDebug.attachment)).toBe('inverted');
  expect(await a.evaluate(()=>String((globalThis as any).__capri.attentionHandle))).toBe('17');
  await a.evaluate(()=>{const g=globalThis as any;g.__capriWindowHeld=true;g.__capriWindowsOverride[0].rect.x+=24;g.__capri.perchTick();g.__capriWindowHeld=false;g.__capri.perchTick();});
  await expect.poll(()=>a.evaluate(()=>(globalThis as any).__capri.teleporter.active)).toBe(false);
  await expect.poll(()=>char.evaluate(()=>(window as any).__capriDebug.attachment)).toBe('inverted');
});

it('uses seated, grounded standing and reclining phases on the actual taskbar support',async()=>{
  const {a,char}=await boot();
  await a.evaluate(({screen},ratio)=>{const g=globalThis as any,a=g.__capri,b=a.charWin.getBounds(),area=screen.getPrimaryDisplay().workArea;g.__capriWindowsOverride=[];a.charWin.setBounds({...b,x:area.x+500,y:Math.round(area.y+area.height-b.height*ratio)});a.settleAfterDrop();},SEAT_RATIO);
  await char.waitForTimeout(200);
  await char.evaluate(()=>{const d=(window as any).__capriDebug;d.manual(true);d.model.resetSecondary();d.step(.1);});
  expect(await char.evaluate(()=>(window as any).__capriDebug.model.activeClip)).toMatch(/^perch/);
  if(process.env.CAPRI_QA_DIR){fs.mkdirSync(process.env.CAPRI_QA_DIR,{recursive:true});await char.screenshot({path:path.join(process.env.CAPRI_QA_DIR,'taskbar-sitting.png')});}
  await char.evaluate(()=>(window as any).__capriDebug.step(1,40));
  expect(await char.evaluate(()=>(window as any).__capriDebug.model.activeClip)).toMatch(/^(idle|blink)$/);
  if(process.env.CAPRI_QA_DIR)await char.screenshot({path:path.join(process.env.CAPRI_QA_DIR,'taskbar-standing.png')});
  await char.evaluate(()=>(window as any).__capriDebug.step(1,30));
  expect(await char.evaluate(()=>(window as any).__capriDebug.model.secondaryRendererState.pose)).toBe('recline');
  if(process.env.CAPRI_QA_DIR)await char.screenshot({path:path.join(process.env.CAPRI_QA_DIR,'taskbar-lying.png')});
});

it('snaps feet to a window bottom, advertises the edge, remembers support and releases a closed window',async()=>{
  const {a,char}=await boot();
  await a.evaluate((_e,ratio)=>{
    const g=globalThis as any,a=g.__capri,w=g.__capriWindowsOverride[0].rect,b=a.charWin.getBounds();
    a.charWin.setBounds({...b,x:w.x+200,y:Math.round(w.y+w.height-b.height*ratio-30)});
    const placed=a.charWin.getBounds();g.__capriDragInput={down:true,point:{x:placed.x+100,y:placed.y+100}};
  },SEAT_RATIO);
  await char.evaluate(()=>window.capri.invoke('char:drag','start'));
  await a.evaluate(()=>{const g=globalThis as any;g.__capriDragInput.point={...g.__capriDragInput.point,x:g.__capriDragInput.point.x+15};});
  await expect.poll(()=>char.locator('#drop-hint').isVisible()).toBe(true);
  await a.evaluate(()=>{(globalThis as any).__capriDragInput.down=false;});
  await expect.poll(()=>a.evaluate(()=>String((globalThis as any).__capriVisits.lowerAnchor?.handle))).toBe('17');
  await expect.poll(()=>char.evaluate(()=>(window as any).__capriDebug.model.activeClip)).toMatch(/^perch/);
  await a.evaluate(()=>{const g=globalThis as any;g.__capriWindowsOverride=[];g.__capri.perchTick();});
  expect(await a.evaluate(()=>(globalThis as any).__capriVisits.lowerAnchor)).toBeNull();
});

it('waits for release, immediately interrupts falling, teleports once, then stays still', async () => {
  const { a, char } = await boot(); await perch(a);
  const before = await a.evaluate(() => (globalThis as any).__capri.charWin.getBounds());
  await a.evaluate(() => { const g = globalThis as any, w = g.__capriWindowsOverride[0]; g.__capriWindowHeld = true; w.rect = { ...w.rect, x: w.rect.x + 24, y: w.rect.y + 12 }; g.__capri.perchTick(); });
  expect(await a.evaluate(() => (globalThis as any).__capri.charWin.getBounds())).toEqual(before);
  const released = await a.evaluate(() => {
    const g = globalThis as any; g.__capriWindowHeld = false; g.__capri.perchTick();
    return { departures: g.__departures, phases: g.__perchCues };
  });
  expect(released.departures).toBe(1); expect(released.phases).toContain('dangle'); expect(released.phases.at(-1)).toBeNull();
  await expect.poll(() => a.evaluate(() => (globalThis as any).__departures)).toBe(1);
  await expect.poll(() => a.evaluate(() => (globalThis as any).__capri.teleporter.active)).toBe(false);
  const landed = await a.evaluate(() => (globalThis as any).__capri.charWin.getBounds());
  expect(landed.x - before.x).toBe(24); expect(landed.y - before.y).toBe(12);
  await char.waitForTimeout(1300);
  expect(await a.evaluate(() => (globalThis as any).__departures)).toBe(1);
});

it('retains falling then floating while held, without carrying the body with the window', async () => {
  const { a, char } = await boot(); await perch(a);
  const before = await a.evaluate(() => (globalThis as any).__capri.charWin.getBounds());
  await a.evaluate(() => { const g = globalThis as any, w = g.__capriWindowsOverride[0]; g.__capriWindowHeld = true; w.rect = { ...w.rect, x: w.rect.x + 90 }; g.__capri.perchTick(); });
  await expect.poll(() => char.evaluate(() => (window as any).__capriDebug.model.activeClip)).toBe('dangle');
  await char.waitForTimeout(2500);
  const held = await a.evaluate(() => { const g = globalThis as any; return { bounds: g.__capri.charWin.getBounds(), phases: g.__perchCues, departures: g.__departures }; });
  expect(held.bounds).toEqual(before); expect(held.phases).toContain('stand'); expect(held.departures).toBe(0);
  await a.evaluate(() => { const g = globalThis as any; g.__capriWindowHeld = false; g.__capri.perchTick(); });
  await expect.poll(() => char.evaluate(() => (window as any).__capriDebug.attachment)).toBe('perch');
});

it('does not teleport in place when only the bottom edge is resized', async () => {
  const { a, char } = await boot(); await perch(a);
  await a.evaluate(() => { const g = globalThis as any, w = g.__capriWindowsOverride[0]; w.rect = { ...w.rect, height: w.rect.height + 200 }; g.__capri.perchTick(); });
  await char.waitForTimeout(1400);
  expect(await a.evaluate(() => (globalThis as any).__departures)).toBe(0);
});

it('waits quietly for a blocked landing, then recovers once the edge is exposed', async () => {
  const { a, char } = await boot(); await perch(a);
  await a.evaluate(() => {
    const g = globalThis as any, w = g.__capriWindowsOverride[0], b = g.__capri.charWin.getBounds();
    w.rect = { ...w.rect, y: w.rect.y + 240 };
    // Occupy the desired body position while leaving most of the target window visible.
    g.__capriWindowsOverride.unshift({ handle: 19n, rect: { x: b.x, y: b.y + 240, width: b.width, height: b.height } });
    g.__capriWindowInfo['19'] = { title: 'YouTube', process: 'chrome.exe' };
    g.__capri.perchTick();
  });
  await char.waitForTimeout(1800);
  expect(await a.evaluate(() => (globalThis as any).__departures)).toBe(0);
  await a.evaluate(() => { const g = globalThis as any; g.__capriWindowsOverride.shift(); g.__capri.perchTick(); });
  await expect.poll(() => a.evaluate(() => (globalThis as any).__departures)).toBe(1);
  await expect.poll(() => a.evaluate(() => (globalThis as any).__capri.teleporter.active)).toBe(false);
});

it('captures a mid-height edge from a forgiving distance and releases a closed support', async () => {
  const { a, char } = await boot();
  await a.evaluate((_e, ratio) => {
    const g = globalThis as any, a = g.__capri, w = g.__capriWindowsOverride[0], b = a.charWin.getBounds();
    g.__capriWindowsOverride = [w];
    a.charWin.setBounds({ ...b, x: w.rect.x + 200, y: Math.round(w.rect.y - b.height * ratio + 72) }); a.settleAfterDrop();
  }, SEAT_RATIO);
  expect(await a.evaluate(() => String((globalThis as any).__capri.attentionHandle))).toBe('17');
  await expect.poll(() => char.evaluate(() => (window as any).__capriDebug.attachment)).toBe('perch');
  await a.evaluate(() => { const g = globalThis as any; g.__capriWindowsOverride = []; g.__capri.perchTick(); });
  await expect.poll(() => char.evaluate(() => (window as any).__capriDebug.attachment)).toBeNull();
});

it('previews the landing during an actual drag and cancels travel when picked up', async () => {
  const { a, char } = await boot();
  await a.evaluate((_e, ratio) => {
    const g = globalThis as any, a = g.__capri, w = g.__capriWindowsOverride[0].rect, b = a.charWin.getBounds();
    a.charWin.setBounds({ ...b, x: w.x + 200, y: Math.round(w.y - b.height * ratio - 15) });
    const placed = a.charWin.getBounds(); g.__capriDragInput = { down: true, point: { x: placed.x + 100, y: placed.y + 120 } };
  }, SEAT_RATIO);
  await char.evaluate(() => window.capri.invoke('char:drag', 'start'));
  await a.evaluate(() => { const g = globalThis as any; g.__capriDragInput.point = { ...g.__capriDragInput.point, x: g.__capriDragInput.point.x + 15 }; });
  await expect.poll(() => char.locator('#drop-hint').isVisible()).toBe(true);
  if (process.env.CAPRI_QA_DIR) { fs.mkdirSync(process.env.CAPRI_QA_DIR, { recursive: true }); await char.screenshot({ path: path.join(process.env.CAPRI_QA_DIR, 'drop-preview.png') }); }
  await a.evaluate(() => { (globalThis as any).__capriDragInput.down = false; });
  await expect.poll(() => char.evaluate(() => (window as any).__capriDebug.attachment)).toBe('perch');
  expect(await char.locator('#drop-hint').isVisible()).toBe(false);
  if (process.env.CAPRI_QA_DIR) await char.screenshot({ path: path.join(process.env.CAPRI_QA_DIR, 'landed.png') });
  // Pick up during the departure delay: the stale destination must not win.
  await a.evaluate(() => {
    const g = globalThis as any, a = g.__capri, b = a.charWin.getBounds();
    g.__flight = a.teleporter.flyTo({ ...b, x: b.x + 400, kind: 'spot' }, { silent: true });
    g.__capriDragInput = { down: true, point: { x: b.x + 100, y: b.y + 120 } };
  });
  await char.evaluate(() => window.capri.invoke('char:drag', 'start'));
  await a.evaluate(() => { const g = globalThis as any; g.__capriDragInput.point = { ...g.__capriDragInput.point, x: g.__capriDragInput.point.x + 30 }; });
  await char.waitForTimeout(220);
  expect(await a.evaluate(() => (globalThis as any).__flight)).toBe(false);
  await a.evaluate(() => { (globalThis as any).__capriDragInput.down = false; });
});

it.skipIf(process.env.CAPRI_NATIVE_MOVEMENT !== '1')('relocates against a real native window without taking focus or changing unrelated preferences', async () => {
  const { a, char } = await boot();
  const handle = await a.evaluate(async ({ BrowserWindow, screen }) => {
    const g = globalThis as any, area = screen.getPrimaryDisplay().workArea;
    delete g.__capriWindowsOverride; delete g.__capriFgOverride;
    const backdrop = g.__movementBackdrop = new BrowserWindow({ x: area.x, y: area.y, width: 1200, height: 900, title: 'Capri movement backdrop', show: false, skipTaskbar: true });
    await backdrop.loadURL('data:text/html,<title>Capri movement backdrop</title><body style="background:%23181b26">');
    backdrop.setAlwaysOnTop(true); backdrop.showInactive();
    const w = g.__movementFixture = new BrowserWindow({ x: area.x + 100, y: area.y + 380, width: 850, height: 350, title: 'Capri movement fixture', show: false, skipTaskbar: true });
    await w.loadURL('data:text/html,<title>Capri movement fixture</title><body style="background:%23151a24;color:white;font:20px sans-serif">Movement test window</body>');
    w.setAlwaysOnTop(true); w.showInactive();
    return String(w.getNativeWindowHandle().readBigUInt64LE());
  });
  await expect.poll(() => a.evaluate((_e, h) => (globalThis as any).__capri.desktopWindows().some((w: any) => String(w.handle) === h), handle)).toBe(true);
  const before = await a.evaluate((_e, p) => {
    const g = globalThis as any, a = g.__capri, w = a.desktopWindows().find((w: any) => String(w.handle) === p.handle), b = a.charWin.getBounds();
    a.charWin.setBounds({ ...b, x: w.rect.x + 200, y: Math.round(w.rect.y - b.height * p.ratio) }); a.settleAfterDrop();
    g.__settingsBefore = structuredClone(a.settings.get());
    return { b: a.charWin.getBounds(), target: w.rect };
  }, { handle, ratio: SEAT_RATIO });
  expect(await a.evaluate(() => String((globalThis as any).__capri.attentionHandle))).toBe(handle);
  await expect.poll(() => char.evaluate(() => (window as any).__capriDebug.attachment)).toBe('perch');
  await a.evaluate(() => { const g = globalThis as any, w = g.__movementFixture, b = w.getBounds(); g.__capriWindowHeld = true; w.setBounds({ ...b, x: b.x + 24, y: b.y + 12 }); });
  await char.waitForTimeout(320);
  expect(await a.evaluate(() => (globalThis as any).__capri.charWin.getBounds())).toEqual(before.b);
  await a.evaluate(() => { (globalThis as any).__capriWindowHeld = false; });
  await expect.poll(() => a.evaluate(() => (globalThis as any).__departures), { timeout: 4000 }).toBe(1);
  await expect.poll(() => a.evaluate(() => (globalThis as any).__capri.teleporter.active)).toBe(false);
  const result = await a.evaluate(() => {
    const g = globalThis as any, a = g.__capri, settings = structuredClone(a.settings.get()), before = g.__settingsBefore;
    delete settings.character.position; delete before.character.position;
    return { b: a.charWin.getBounds(), focused: a.charWin.isFocused(), sameSettings: JSON.stringify(settings) === JSON.stringify(before) };
  });
  expect(result.b.x - before.b.x).toBe(24); expect(result.b.y - before.b.y).toBe(12);
  expect(result.focused).toBe(false); expect(result.sameSettings).toBe(true);
  await a.evaluate(() => { const g = globalThis as any, a = g.__capri; a.settings.update({ behavior: { mode: 'sleep' }, teleport: { effects: true } }); a.presenceTick(); const w = g.__movementFixture, b = w.getBounds(); w.setBounds({ ...b, x: b.x + 200 }); });
  await expect.poll(() => a.evaluate(() => (globalThis as any).__departures), { timeout: 4000 }).toBe(2);
  await expect.poll(() => a.evaluate(() => (globalThis as any).__capri.teleporter.active), { timeout: 5000 }).toBe(false);
  await expect.poll(() => char.evaluate(() => (window as any).__capriDebug.behavior.state)).toBe('sleeping');
  await char.waitForTimeout(1000);
  expect(await a.evaluate(() => (globalThis as any).__departures)).toBe(2);
  await a.evaluate(() => { const g = globalThis as any; g.__movementFixture.destroy(); g.__movementBackdrop.destroy(); });
});
