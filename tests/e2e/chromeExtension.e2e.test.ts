import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { chromium, type BrowserContext } from 'playwright-core';
import { expect, it } from 'vitest';
import { LifeContext } from '../../src/main/life/context';
import { ChromeBridge } from '../../src/main/life/chrome';
import { disconnectedChrome } from '../../src/shared/lifeContext';
import { archiveWorkerPath } from '../helpers/runtime2Archive';
import { WindowFocusArchive } from '../../src/main/runtime2/windowFocusArchive';
import { Perception } from '../../src/main/runtime2/perception';
import { selectRuntime } from '../../src/main/runtime2/selection';
// Real MV3 transport against an isolated Chromium profile and synthetic local pages.
// The test-only copy pregrants ONLY the synthetic site; production optional permissions are unchanged.
it.skipIf(!process.env.CAPRI_CHROMIUM_EXE)('loads MV3, transmits sanitized focused semantics, reconnects after bridge restart, and drops blocked pages',async()=>{
  const executablePath=process.env.CAPRI_CHROMIUM_EXE;
  if(!executablePath) throw Error('Set CAPRI_CHROMIUM_EXE to a working Chromium executable.');
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'capri-mv3-')), ext=path.join(dir,'extension');
  let browser:BrowserContext|undefined, bridge:ChromeBridge|undefined;
  let archive: WindowFocusArchive | undefined;
  const web=http.createServer((req,res)=>{res.setHeader('content-type','text/html');res.end(req.url?.startsWith('/login')?'<input type="password"><h1>Private login</h1>':'<title>ArborCalc API</title><main><h1>Fitting constraints</h1><h2>Bounded parameter domains</h2><p>Approved synthetic article.</p><input value="Never capture form secret"></main>');});
  const otherWeb=http.createServer((_req,res)=>{res.setHeader('content-type','text/html');res.end('<title>Second homework origin</title><main><h1>Independent problem sheet</h1><p>Cross-origin all-websites evidence.</p></main>');});
  try{
    await new Promise<void>(r=>web.listen(0,'127.0.0.1',r));const site=`http://127.0.0.1:${(web.address() as any).port}`;
    await new Promise<void>(r=>otherWeb.listen(0,'127.0.0.1',r));const otherSite=`http://127.0.0.1:${(otherWeb.address() as any).port}`;
    fs.cpSync(path.resolve(__dirname,'../../extensions/chrome'),ext,{recursive:true});
    const reserve=http.createServer();await new Promise<void>(r=>reserve.listen(0,'127.0.0.1',r));const bridgePort=(reserve.address() as any).port;await new Promise<void>(r=>reserve.close(()=>r()));
    for(const name of ['worker.js','manifest.json']){const file=path.join(ext,name);fs.writeFileSync(file,fs.readFileSync(file,'utf8').replaceAll('43129',String(bridgePort)));}
    const manifest=JSON.parse(fs.readFileSync(path.join(ext,'manifest.json'),'utf8'));manifest.host_permissions.push(site+'/*',otherSite+'/*');fs.writeFileSync(path.join(ext,'manifest.json'),JSON.stringify(manifest));
    browser=await chromium.launchPersistentContext(path.join(dir,'browser'),{executablePath,headless:true,ignoreDefaultArgs:['--disable-extensions'],args:['--disable-features=DisableLoadExtensionCommandLineSwitch',`--disable-extensions-except=${ext}`,`--load-extension=${ext}`]});
    const worker=browser.serviceWorkers()[0]??await browser.waitForEvent('serviceworker');const extensionId=new URL(worker.url()).host, token='b'.repeat(64);
    const life=new LifeContext(path.join(dir,'ledger'));life.configure({...disconnectedChrome(),sites:[site],permissions:{collect:true,live:true,retain:false,content:false,learn:false}});
    bridge=new ChromeBridge(life,()=>({extensionId,token}),bridgePort);await bridge.start();expect(life.bridge.state).toBe('listening');
    const check=await worker.evaluate(async({port,token})=>{const r=await fetch('http://127.0.0.1:'+port+'/v1/status',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:'{}'});return {status:r.status,body:await r.json()};},{port:bridgePort,token});
    expect(check).toEqual({status:200,body:{paired:true}});
    expect(await worker.evaluate(async(port)=> (await fetch('http://127.0.0.1:'+port+'/v1/status',{method:'POST',headers:{Authorization:'Bearer invalid','Content-Type':'application/json'},body:'{}'})).status,bridgePort)).toBe(401);
    await worker.evaluate(async(config)=>{await (globalThis as any).chrome.storage.local.set(config);},{token,sites:[site]});
    const page=await browser.newPage();await page.goto(site+'/guide?token=not-for-capri');await page.bringToFront();
    const poll=()=>worker.evaluate(async()=>{await (globalThis as any).chrome.alarms.create('capri-freshness',{when:Date.now()+100});});
    await expect.poll(async()=>{await poll();await new Promise(r=>setTimeout(r,500));return life.current().length;},{timeout:25000}).toBe(1);
    expect(life.current()[0].detail).toContain('Bounded parameter domains');expect(life.current()[0].detail).not.toContain('Never capture form secret');expect(life.current()[0].summary).not.toContain('not-for-capri');
    bridge.stop();await new Promise(r=>setTimeout(r,250));bridge=new ChromeBridge(life,()=>({extensionId,token}),bridgePort);await bridge.start();
    await page.evaluate(()=>{document.querySelector('h2')!.textContent='Reconnected reference';});await poll();
    await expect.poll(async()=>{await poll();await new Promise(r=>setTimeout(r,500));return life.current()[0]?.detail;},{timeout:25000}).toContain('Reconnected reference');
    life.configure({...life.source('chrome')!,permissions:{collect:true,live:true,retain:false,content:true,learn:false}});
    await worker.evaluate(async(site)=>{await (globalThis as any).chrome.storage.local.set({semanticSites:[site]});await (globalThis as any).chrome.storage.session.remove('readBudget');},site);
    await expect.poll(async()=>{await poll();await new Promise(r=>setTimeout(r,500));return life.readPage('synthetic article').length;},{timeout:25000}).toBe(1);
    expect(JSON.stringify(life.readPage('synthetic article'))).toContain('Approved synthetic article');
    expect(JSON.stringify(life.readPage('synthetic article'))).not.toContain('Never capture form secret');
    await page.goto(site+'/login');await expect.poll(async()=>{await poll();await new Promise(r=>setTimeout(r,500));return life.current().length;},{timeout:25000}).toBe(0);
    // Use the real MV3->authenticated loopback->Runtime 2 raw sink, not direct fixture intake.
    life.configure({ ...life.source('chrome')!, permissions: { collect: true, live: true, retain: true, content: true, learn: false } });
    const profile = selectRuntime({ CAPRI_RUNTIME: '2' }, dir).profile!;
    archive = new WindowFocusArchive(profile, { workerPath: archiveWorkerPath }); await archive.initialize();
    const perception = new Perception(archive, { windows: () => [], active: () => null, allowed: () => true, capture: async () => undefined, move: async () => ({ ok: false, detail: 'No movement in browser fixture' }), body: () => null }, () => {});
    bridge.setRawSink(async (page, intake) => { await perception.page(page, intake); return true; });
    await worker.evaluate(async () => { await (globalThis as any).chrome.storage.session.remove('readBudget'); });
    await page.goto(site + '/guide');
    await expect.poll(async () => { await poll(); await new Promise(r => setTimeout(r,500)); return JSON.stringify(perception.current('direct')); }, { timeout: 25000 }).toContain('Approved synthetic article');
    const observed = perception.current('direct')[0];
    expect(observed.provenance.collector).toBe('chrome.extension'); expect(observed.provenance.metadata.pageRecordId).toMatch(/^tab-/);
    expect(bridge.preflight()).toMatchObject({ paired: true, authorized: true, lastIntake: 'extension', deliveringRecently: true });
    expect(await archive.get(observed.id)).toEqual(observed);
    const original = await archive.getEvidence(observed.original!.id); expect(Buffer.from(original!.data).toString()).toContain('Approved synthetic article');
    expect(Buffer.from(original!.data).toString()).not.toContain('Never capture form secret');
    // An explicit wildcard replaces per-origin app/extension allowlists. Chrome's own grants still apply.
    life.configure({...life.source('chrome')!,sites:['*']});
    await worker.evaluate(async()=>{await (globalThis as any).chrome.storage.local.set({sites:['*'],semanticSites:['*']});});
    await page.goto(otherSite+'/problems');
    await expect.poll(()=>JSON.stringify(perception.current('direct')),{timeout:5000}).toContain('Cross-origin all-websites evidence');
    await page.goto(site + '/login');
    await expect.poll(async () => { await poll(); await new Promise(r => setTimeout(r,500)); return perception.current('direct').length; }, { timeout: 25000 }).toBe(0);
    life.flush();
  }finally{bridge?.stop();await archive?.close();await browser?.close();web.closeAllConnections();otherWeb.closeAllConnections();await new Promise<void>(r=>web.close(()=>r()));await new Promise<void>(r=>otherWeb.close(()=>r()));fs.rmSync(dir,{recursive:true,force:true,maxRetries:5,retryDelay:100});}
});
