import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { _electron as electron, type ElectronApplication } from 'playwright-core';
import { expect, it } from 'vitest';
import { selectRuntime } from '../../src/main/runtime2/selection';
import { closeIsolatedApp } from './lifecycle';

it('traces synthetic model output through aside/reply presentation and records actual bubble acceptance',async()=>{
  const env={...process.env,CAPRI_RUNTIME:'2',CAPRI_V2_DAILY:'1',CAPRI_V2_PROFILE_ID:'delivery-'+randomUUID(),CAPRI_TEST:'1',CAPRI_OFFSCREEN:'1',CAPRI_NO_DEV_KEY:'1',CAPRI_V2_WINDOW_FOCUS:'0'};
  const dir=selectRuntime(env,os.homedir()).profile!;
  fs.mkdirSync(dir,{recursive:true});
  fs.writeFileSync(path.join(dir,'settings.json'),JSON.stringify({firstRunComplete:true,ai:{provider:'offline'},character:{startupIntro:false},voice:{ttsEnabled:false},behavior:{quietHours:{enabled:false}},privacy:{saveHistory:true}}));
  let app:ElectronApplication|undefined;
  try {
    app=await electron.launch({args:[path.resolve(__dirname,'../..')],env});
    await expect.poll(()=>app!.evaluate(()=>!!(globalThis as any).__capri?.runtime2)).toBe(true);
    await app.evaluate(async()=>{
      const g=globalThis as any,a=g.__capri,r=a.runtime2,l=r.cognitive;
      clearInterval(l.timer);l.environment(false);l.ambientTrigger=()=>undefined;
      l.provider={models:async()=>[{id:'synthetic',label:'Fixture',contextTokens:128000}],shutdown(){},infer:async(_m:any,_i:any,_s:any,delta:(text:string)=>void)=>{
        delta(g.__text.slice(0,2));
        if(g.__dismiss)a.bubble.dismiss();
        delta(g.__text.slice(2));return {text:g.__text,calls:[]};
      }};
      r.daily.config.model='synthetic';await r.daily.recorder.start({fixture:'delivery-no-network'});r.daily.resume();
      a.bubble.dismiss();g.__legacyLength=a.history.recent(200).length;
    });
    const ambient=async(text:string,dismiss=false)=>{
      await app!.evaluate((_,{text,dismiss})=>{
        const g=globalThis as any,l=g.__capri.runtime2.cognitive;g.__text=text;g.__dismiss=dismiss;
        let pending=true;l.ambientTrigger=()=>{if(pending){pending=false;return 'source-change';}};
        l.kick();
      },{text,dismiss});
      await expect.poll(()=>app!.evaluate(()=>(globalThis as any).__capri.runtime2.chatState.busy)).toBe(false);
      return app!.evaluate(()=>{const b=(globalThis as any).__capri.bubble;return {visible:b.hasVisibleText,state:b.state,outcome:b.lastPresentation};});
    };
    expect(await ambient('Utterance A',true)).toMatchObject({visible:false,outcome:{accepted:false,suppressedBy:'dismissed'}});
    expect(await ambient('Utterance B')).toMatchObject({visible:true,state:{text:'Utterance B',delivery:'aside',previous:[]},outcome:{accepted:true}});
    const bubblePage=app.windows().find(w=>/bubble\.html/.test(w.url()))!;
    await expect.poll(()=>bubblePage.locator('body').innerText()).toContain('Utterance B');
    for(const restriction of ['quiet','sleep','hidden','quiet-commitment']) {
      await app.evaluate(async(_,restriction)=>{const a=(globalThis as any).__capri;a.bubble.dismiss();
        if(restriction==='quiet')a.settings.update({behavior:{doNotDisturb:true}});
        if(restriction==='sleep')a.settings.update({behavior:{mode:'sleep'}});
        if(restriction==='hidden')a.minimizeCapri();
        if(restriction==='quiet-commitment')await a.applyCompanyControl({kind:'focus',minutes:5});
      },restriction);
      // Replay a generated completion at the presentation boundary: restrictions
      // normally stop the next ambient cycle before it can reach this boundary.
      const suppressed=await app.evaluate((_,restriction)=>{
        const a=(globalThis as any).__capri,l=a.runtime2.cognitive;
        l.options.emit('chat:done',{message:{id:'restricted-'+restriction,role:'assistant',content:'Utterance B',ts:Date.now()},delivery:'aside'});
        return {visible:a.bubble.hasVisibleText,outcome:a.bubble.lastPresentation};
      },restriction);
      expect(suppressed).toMatchObject({visible:false,outcome:{accepted:false,suppressedBy:restriction==='hidden'?'hidden':'sleep-or-quiet'}});
      await app.evaluate(async(_,restriction)=>{const a=(globalThis as any).__capri;
        if(restriction==='quiet')a.settings.update({behavior:{doNotDisturb:false}});
        if(restriction==='sleep')a.settings.update({behavior:{mode:'normal'}});
        if(restriction==='hidden')a.restoreCapri();
        if(restriction==='quiet-commitment')await a.applyCompanyControl({kind:'cancel_intentions'});
        a.runtime2.cognitive.environment(false);
      },restriction);
    }
    await app.evaluate(async()=>{const g=globalThis as any,a=g.__capri;g.__text='Direct answer';g.__dismiss=false;
      a.settings.update({behavior:{doNotDisturb:true}});await a.runtime2.send('Direct question');
    });
    await expect.poll(()=>app!.evaluate(()=>(globalThis as any).__capri.runtime2.chatState.busy)).toBe(false);
    expect(await app.evaluate(()=>{const a=(globalThis as any).__capri;return {visible:a.bubble.hasVisibleText,state:a.bubble.state,speaks:a.speakCount};})).toMatchObject({visible:true,state:{text:'Direct answer',delivery:'reply'},speaks:0});
    const result=await app.evaluate(async()=>{const g=globalThis as any,a=g.__capri,r=a.runtime2;
      await r.daily.recorder.flush();return {folder:r.daily.recorder.status.folder,history:await r.chatHistory(),legacyUnchanged:g.__legacyLength===a.history.recent(200).length};
    });
    expect(result.legacyUnchanged).toBe(true);
    expect(result.history.filter((m:any)=>m.content==='Utterance B')).toHaveLength(1);
    const events=fs.readFileSync(path.join(result.folder,'events.jsonl'),'utf8').trim().split('\n').map(line=>JSON.parse(line));
    const presentations=events.filter(e=>e.type==='presentation.dispatch');
    expect(presentations).toEqual(expect.arrayContaining([
      expect.objectContaining({data:expect.objectContaining({stage:'done',delivery:'aside',accepted:false,suppressedBy:'dismissed'})}),
      expect.objectContaining({data:expect.objectContaining({stage:'done',delivery:'aside',accepted:true,suppressedBy:null})}),
      expect.objectContaining({data:expect.objectContaining({stage:'done',delivery:'reply',accepted:true})}),
    ]));
    expect(events.filter(e=>e.type==='dialogue')).toHaveLength(3);
  } finally {
    await closeIsolatedApp(app);
    if(path.dirname(dir)!==path.join(os.homedir(),'Documents','Capri Buddy 2.0 Synthetic'))throw Error('Unexpected synthetic profile');
    fs.rmSync(dir,{recursive:true,force:true,maxRetries:5,retryDelay:100});
  }
});
