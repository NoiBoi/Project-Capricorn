import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { _electron as electron, type ElectronApplication } from 'playwright-core';
import { expect, it } from 'vitest';
import { closeIsolatedApp } from './lifecycle';

it('keeps identity and an immediately saved setting through a full production-mode quit and relaunch', async () => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'capri-production-profile-'));
  fs.writeFileSync(path.join(dir,'settings.json'),'\uFEFF'+JSON.stringify({firstRunComplete:true,ai:{provider:'offline'},character:{startupIntro:false,hideOnFullscreen:false,scale:.8},voice:{ttsEnabled:false,volume:.37},behavior:{idleRemarks:false,explore:false,smallActivities:false,quietHours:{enabled:false}},teleport:{auto:false,effects:false}}));
  fs.writeFileSync(path.join(dir,'memory.json'),'\uFEFF'+JSON.stringify([{id:'known',text:'The user prefers to be called Noi.',status:'approved',source:'user',createdAt:Date.now()},...Array.from({length:39},(_,i)=>({id:`saved-${i}`,text:`Original saved preference ${i}.`,status:'approved',source:'user',createdAt:Date.now()}))]));
  fs.writeFileSync(path.join(dir,'history.jsonl'),JSON.stringify({id:'original-chat',role:'user',content:'Our original saved conversation.',ts:Date.now()})+'\n');
  let app:ElectronApplication|undefined;
  async function boot() {
    app=await electron.launch({...process.env.CAPRI_EXE?{executablePath:process.env.CAPRI_EXE,args:['--memory']}:{args:[path.resolve(__dirname,'../..'),'--memory']},env:{...process.env,CAPRI_TEST:'0',CAPRI_USER_DATA:dir,CAPRI_NO_DEV_KEY:'1'}});
    await app.firstWindow();
    await expect.poll(()=>app!.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().some(w=>w.webContents.getURL().includes('panel.html'))), { timeout: 15000 }).toBe(true);
    return app;
  }
  async function read(a:ElectronApplication,save=false) {
    return a.evaluate(async({BrowserWindow,ipcMain},save)=>{
      const panel=BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('panel.html'))!;
      const event={sender:panel.webContents,senderFrame:panel.webContents.mainFrame}, handlers=(ipcMain as any)._invokeHandlers;
      if(save){await handlers.get('settings:set')(event,{voice:{volume:.42}});await handlers.get('secrets:set')(event,{key:'openai',value:'profile-restart-fixture-key'});
        const life=await handlers.get('life:get')(event);await handlers.get('life:configure')(event,{...life.sources[0],sites:['https://github.com','https://developer.chrome.com']});
        await handlers.get('life:draft')(event,{id:'chrome',draft:{sites:'https://github.com\nhttps://unfinished.',name:'Chrome setup draft'}});
      }
      const settings=await handlers.get('settings:get')(event),memories=await handlers.get('memory:list')(event),dev=await handlers.get('dev:get')(event);
      const history=await handlers.get('chat:history')(event,{limit:200});
      const secretStatus=await handlers.get('secrets:status')(event);
      const life=await handlers.get('life:get')(event);
      return {volume:settings.voice.volume,scale:settings.character.scale,memories:memories.length,name:dev.runtime.preferredName,testHook:'__capri' in globalThis,originalChat:history.some((m:any)=>m.id==='original-chat'),savedCredential:secretStatus.openai,sites:life.sources[0].sites,draft:life.drafts.chrome};
    },save);
  }
  async function quit() {
    if(!app)return;
    let child;try{child=app.process();}catch{app=undefined;return;}
    await app.evaluate(({app})=>app.quit()).catch(()=>{});
    let timer:ReturnType<typeof setTimeout>|undefined;
    try{await Promise.race([new Promise<void>(r=>{if(child.exitCode!==null)r();else child.once('exit',()=>r());}),new Promise<void>(r=>{timer=setTimeout(r,8000);})]);}finally{clearTimeout(timer);}
    if(child.exitCode===null && child.signalCode===null)await closeIsolatedApp(app,child);app=undefined;
  }
  try {
    const expected={volume:.42,scale:.8,memories:40,name:'Noi',testHook:false,originalChat:true,savedCredential:true,sites:['https://github.com','https://developer.chrome.com'],draft:{sites:'https://github.com\nhttps://unfinished.',name:'Chrome setup draft'}};
    expect(await read(await boot(),true)).toEqual(expected);
    expect(JSON.parse(fs.readFileSync(path.join(dir,'settings.json'),'utf8')).voice.volume).toBe(.42);
    await quit();
    expect(await read(await boot())).toEqual(expected);
  } finally {await quit();try{fs.rmSync(dir,{recursive:true,force:true,maxRetries:3});}catch{/* Chromium cache may still be closing. */}}
},60000);
