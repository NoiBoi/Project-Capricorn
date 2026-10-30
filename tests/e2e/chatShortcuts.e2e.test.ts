import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { _electron as electron, type ElectronApplication } from 'playwright-core';
import { expect,it } from 'vitest';
import { closeIsolatedApp } from './lifecycle';
import { keys, inputAvailable } from '../../src/main/desktop/input';
it('opens long-term chat on the active monitor, focuses typing and dismisses with Escape',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'capri-shortcuts-'));let app:ElectronApplication|undefined;
 fs.writeFileSync(path.join(dir,'settings.json'),JSON.stringify({firstRunComplete:true,ai:{provider:'offline'},character:{startupIntro:false,hideOnFullscreen:false},voice:{ttsEnabled:false},memory:{autoLearn:false},behavior:{smallActivities:false,idleRemarks:false,explore:false,quietHours:{enabled:false}},teleport:{auto:false}}));
 try{
  app=await electron.launch({...process.env.CAPRI_EXE?{executablePath:process.env.CAPRI_EXE,args:[]}:{args:[path.resolve(__dirname,'../..')]},env:{...process.env,CAPRI_TEST:'1',CAPRI_OFFSCREEN:'0',CAPRI_NO_DEV_KEY:'1',CAPRI_USER_DATA:dir}});
  await (await app.firstWindow()).waitForFunction(()=>!!(window as any).__capriDebug);
  const expected=await app.evaluate(async({BrowserWindow,screen,globalShortcut})=>{
   const g=globalThis as any,a=g.__capri,d=screen.getAllDisplays().at(-1)!,area=d.workArea;
   const w=g.__shortcutPrior=new BrowserWindow({x:area.x+20,y:area.y+40,width:500,height:400,show:false,title:'Capri Shortcut Focus Fixture'});
   await w.loadURL('data:text/html,<title>Capri Shortcut Focus Fixture</title><input autofocus>');w.show();w.focus();w.webContents.focus();
   return {area,activated:a.activateChatWindow(w.getNativeWindowHandle()),registered:globalShortcut.isRegistered('Control+Shift+Space')};
  });
  expect(expected.registered).toBe(true);expect(expected.activated).toBe(true);
  await expect.poll(()=>app!.evaluate(()=>(globalThis as any).__shortcutPrior.isFocused())).toBe(true);
  const opened=app.waitForEvent('window');expect(inputAvailable()).toBe(true);expect(await keys('ctrl+c+space')).toBe(true);const panel=await opened;
  await panel.waitForURL('**/panel.html#chat');await expect.poll(()=>panel.evaluate(()=>document.activeElement?.tagName)).toBe('TEXTAREA');
  await expect.poll(()=>app!.evaluate(()=>(globalThis as any).__capri.panelWin.isFocused())).toBe(true);
  const b=await app.evaluate(()=>(globalThis as any).__capri.panelWin.getBounds());expect(b.x).toBeGreaterThanOrEqual(expected.area.x);expect(b.x+b.width).toBeLessThanOrEqual(expected.area.x+expected.area.width);expect(b.y).toBeGreaterThanOrEqual(expected.area.y);expect(b.y+b.height).toBeLessThanOrEqual(expected.area.y+expected.area.height);
  await panel.keyboard.type('shortcut typing check');expect(await panel.locator('.composer textarea').inputValue()).toBe('shortcut typing check');
  const closed=panel.waitForEvent('close');await panel.keyboard.press('Escape').catch(error=>{if(!panel.isClosed())throw error;});await closed;
  await expect.poll(()=>app!.evaluate(()=>(globalThis as any).__shortcutPrior.isFocused())).toBe(true);
  expect(await keys('ctrl+shift+space')).toBe(true);
  await expect.poll(()=>app!.windows().some(p=>p.url().includes('/bubble.html'))).toBe(true);
  const bubble=app.windows().find(p=>p.url().includes('/bubble.html'))!;
  await expect.poll(()=>app!.evaluate(()=>(globalThis as any).__capri.bubble.nativeActive)).toBe(true);
  await expect.poll(()=>bubble.evaluate(()=>document.activeElement?.id)).toBe('input');
  await bubble.keyboard.type('quick shortcut typing check');expect(await bubble.locator('#input').inputValue()).toBe('quick shortcut typing check');
  await bubble.keyboard.press('Escape');
  await expect.poll(()=>app!.evaluate(()=>(globalThis as any).__shortcutPrior.isFocused())).toBe(true);
  await app.evaluate(()=>(globalThis as any).__shortcutPrior.destroy());
 }finally{await closeIsolatedApp(app);fs.rmSync(dir,{recursive:true,force:true,maxRetries:8,retryDelay:100});}
},45000);
