import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { _electron as electron, type ElectronApplication } from 'playwright-core';
import { expect, it } from 'vitest';
import { closeIsolatedApp } from './lifecycle';

it('uses real runtime SQLite and preserves ordinary continuity across evidence, rollback, restart and revocation', async () => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'capri-foundation-runtime-'));
  fs.writeFileSync(path.join(dir,'settings.json'),JSON.stringify({firstRunComplete:true,ai:{provider:'offline'},memory:{enabled:true,autoLearn:true},character:{startupIntro:false,hideOnFullscreen:false},voice:{ttsEnabled:false},behavior:{idleRemarks:false,explore:false,smallActivities:false,quietHours:{enabled:false}},teleport:{auto:false,effects:false}}));
  fs.writeFileSync(path.join(dir,'memory.json'),JSON.stringify([{id:'fixture-approved',text:'The fixture user likes numerical tools.',status:'approved',source:'user',createdAt:Date.now()}]));
  let app:ElectronApplication|undefined;
  async function boot() {
    app=await electron.launch({...process.env.CAPRI_EXE?{executablePath:process.env.CAPRI_EXE,args:[]}:{args:[path.resolve(__dirname,'../..')]},env:{...process.env,CAPRI_TEST:'1',CAPRI_OFFSCREEN:'1',CAPRI_NO_DEV_KEY:'1',CAPRI_USER_DATA:dir}});
    const char=await app.firstWindow();await char.waitForFunction(()=>!!(window as any).__capriDebug);return app;
  }
  try {
    const first=await boot();
    const ordinary=await first.evaluate(async()=>{
      const a=(globalThis as any).__capri;a.cognitiveStore.integrity();
      const source=a.life.ledger.source('chrome');a.life.configure({...source,permissions:{collect:true,live:true,retain:true,content:false,learn:false}});
      await a.convo.send('My fixture project uses numerical tools.');await a.convo.settle();
      return {sources:a.history.recent(1)[0].meta.contextSources,entries:a.conversationScene.snapshot().entries.length,approved:a.memory.approved().length,queued:a.memoryLearner.queue.some((j:any)=>j.text==='My fixture project uses numerical tools.')};
    });
    expect(ordinary).toEqual({sources:[],entries:2,approved:1,queued:true});
    const derived=await first.evaluate(async()=>{
      const a=(globalThis as any).__capri,at=Date.now();a.life.ledger.ingest({source:'chrome',recordId:'fixture',revision:1,type:'displayed-page',occurredAt:at,receivedAt:at,expiresAt:at+60000,entities:[],quality:'observed',permissions:{collect:true,live:true,retain:true,content:false,learn:false},summary:'Fixture source',detail:'Private synthetic evidence',operation:'upsert',importance:.7});
      await a.convo.send('What does the fixture source show?');await a.convo.settle();
      try { a.cognitiveStore.transaction(()=>{a.cognitiveStore.save('rolled-back',{bad:true});throw Error('fixture');}); } catch {}
      return {sources:a.history.recent(1)[0].meta.contextSources,rollback:a.cognitiveStore.load('rolled-back')===undefined,session:a.cognitiveStore.get('session','current-chat').dependencies};
    });
    expect(derived).toEqual({sources:['chrome'],rollback:true,session:['chrome']});
    await closeIsolatedApp(app);app=undefined;
    const second=await boot();
    const recovered=await second.evaluate(()=>{
      const a=(globalThis as any).__capri;a.cognitiveStore.integrity();
      const entries=a.conversationScene.snapshot().entries;
      const before={source:a.life.ledger.current()[0]?.summary,entries:entries.length,ordinary:entries.some((e:any)=>e.text==='My fixture project uses numerical tools.'),derived:entries.some((e:any)=>e.contextSources?.length)};
      a.life.forget('chrome');
      a.settings.update({dialogue:{localContext:false}});
      return {before,current:a.life.ledger.current().length,entries:a.conversationScene.snapshot().entries.length,session:a.cognitiveStore.get('session','current-chat')===undefined,approved:a.memory.approved().length};
    });
    expect(recovered).toEqual({before:{source:'Fixture source',entries:3,ordinary:true,derived:false},current:0,entries:3,session:true,approved:1});
    expect(fs.existsSync(path.join(dir,'cognitive.sqlite'))).toBe(true);
  } finally { await closeIsolatedApp(app);fs.rmSync(dir,{recursive:true,force:true}); }
});
