import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { chromium, type BrowserContext } from 'playwright-core';
import { expect, it } from 'vitest';
import { LifeContext } from '../../src/main/life/context';
import { ChromeBridge } from '../../src/main/life/chrome';
import { disconnectedChrome } from '../../src/shared/lifeContext';
// Real MV3 transport against an isolated Chromium profile and synthetic local pages.
// The test-only copy pregrants ONLY the synthetic site; production optional permissions are unchanged.
it.skipIf(!process.env.CAPRI_CHROMIUM_EXE)('loads MV3, transmits sanitized focused semantics, reconnects after bridge restart, and drops blocked pages',async()=>{
  const executablePath=process.env.CAPRI_CHROMIUM_EXE;
  if(!executablePath) throw Error('Set CAPRI_CHROMIUM_EXE to a working Chromium executable.');
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'capri-mv3-')), ext=path.join(dir,'extension');
  let browser:BrowserContext|undefined, bridge:ChromeBridge|undefined;
  const web=http.createServer((req,res)=>{res.setHeader('content-type','text/html');res.end(req.url?.startsWith('/login')?'<input type="password"><h1>Private login</h1>':'<title>ArborCalc API</title><main><h1>Fitting constraints</h1><h2>Bounded parameter domains</h2><p>Approved synthetic article.</p><input value="Never capture form secret"></main>');});
  try{
    await new Promise<void>(r=>web.listen(0,'127.0.0.1',r));const site=`http://127.0.0.1:${(web.address() as any).port}`;
    fs.cpSync(path.resolve(__dirname,'../../extensions/chrome'),ext,{recursive:true});
    const manifest=JSON.parse(fs.readFileSync(path.join(ext,'manifest.json'),'utf8'));manifest.host_permissions.push(site+'/*');fs.writeFileSync(path.join(ext,'manifest.json'),JSON.stringify(manifest));
    browser=await chromium.launchPersistentContext(path.join(dir,'browser'),{executablePath,headless:true,ignoreDefaultArgs:['--disable-extensions'],args:['--disable-features=DisableLoadExtensionCommandLineSwitch',`--disable-extensions-except=${ext}`,`--load-extension=${ext}`]});
    const worker=browser.serviceWorkers()[0]??await browser.waitForEvent('serviceworker');const extensionId=new URL(worker.url()).host, token='b'.repeat(64);
    const life=new LifeContext(path.join(dir,'ledger'));life.configure({...disconnectedChrome(),sites:[site],permissions:{collect:true,live:true,retain:false,content:false,learn:false}});
    bridge=new ChromeBridge(life,()=>({extensionId,token}));await bridge.start();expect(life.bridge.state).toBe('listening');
    await worker.evaluate(async(config)=>{await (globalThis as any).chrome.storage.local.set(config);},{token,sites:[site]});
    const page=await browser.newPage();await page.goto(site+'/guide?token=not-for-capri');await page.bringToFront();
    const poll=()=>worker.evaluate(async()=>{await (globalThis as any).chrome.alarms.create('capri-freshness',{when:Date.now()+100});});
    await expect.poll(async()=>{await poll();await new Promise(r=>setTimeout(r,500));return life.current().length;},{timeout:25000}).toBe(1);
    expect(life.current()[0].detail).toContain('Bounded parameter domains');expect(life.current()[0].detail).not.toContain('Never capture form secret');expect(life.current()[0].summary).not.toContain('not-for-capri');
    bridge.stop();await new Promise(r=>setTimeout(r,250));bridge=new ChromeBridge(life,()=>({extensionId,token}));await bridge.start();
    await page.evaluate(()=>{document.querySelector('h2')!.textContent='Reconnected reference';});await poll();
    await expect.poll(async()=>{await poll();await new Promise(r=>setTimeout(r,500));return life.current()[0]?.detail;},{timeout:25000}).toContain('Reconnected reference');
    life.configure({...life.source('chrome')!,permissions:{collect:true,live:true,retain:false,content:true,learn:false}});
    await worker.evaluate(async(site)=>{await (globalThis as any).chrome.storage.local.set({semanticSites:[site]});await (globalThis as any).chrome.storage.session.remove('readBudget');},site);
    await expect.poll(async()=>{await poll();await new Promise(r=>setTimeout(r,500));return life.readPage('synthetic article').length;},{timeout:25000}).toBe(1);
    expect(JSON.stringify(life.readPage('synthetic article'))).toContain('Approved synthetic article');
    expect(JSON.stringify(life.readPage('synthetic article'))).not.toContain('Never capture form secret');
    await page.goto(site+'/login');await expect.poll(async()=>{await poll();await new Promise(r=>setTimeout(r,500));return life.current().length;},{timeout:25000}).toBe(0);
    life.flush();
  }finally{bridge?.stop();await browser?.close();web.closeAllConnections();await new Promise<void>(r=>web.close(()=>r()));fs.rmSync(dir,{recursive:true,force:true,maxRetries:5,retryDelay:100});}
});
