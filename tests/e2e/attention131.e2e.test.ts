import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {_electron as electron,type ElectronApplication}from'playwright-core';import {it,expect}from'vitest';import {closeIsolatedApp}from'./lifecycle';
it('shares visual/metadata observation receipts with chat, suppresses unchanged crops, preserves background work through foreground sampling and clears privacy state',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'capri-attention-'));let app:ElectronApplication|undefined;
 fs.writeFileSync(path.join(dir,'settings.json'),JSON.stringify({firstRunComplete:true,actions:{policies:{read_screen:'allow'}},character:{startupIntro:false,hideOnFullscreen:false},ai:{provider:'codex'},memory:{autoLearn:false,honcho:{enabled:false}},voice:{ttsEnabled:false},behavior:{idleRemarks:false,smallActivities:false,explore:false,quietHours:{enabled:false}},teleport:{auto:false,effects:false}}));
 try{app=await electron.launch({...process.env.CAPRI_EXE?{executablePath:process.env.CAPRI_EXE,args:[]}:{args:[path.resolve(__dirname,'../..')]},env:{...process.env,CAPRI_TEST:'1',CAPRI_OFFSCREEN:'1',CAPRI_USER_DATA:dir,CAPRI_NO_DEV_KEY:'1'}});const char=await app.firstWindow();await char.waitForFunction(()=>!!(window as any).__capriDebug);
 await app.evaluate(({nativeImage})=>{const g=globalThis as any,a=g.__capri;g.__calls=0;g.__images=[];g.__capriIdleOverride=0;g.__capriForegroundHandle=17n;g.__capriWindowsOverride=[{handle:17n,rect:{x:100,y:100,width:900,height:800}},{handle:19n,rect:{x:1100,y:100,width:800,height:800}},{handle:21n,rect:{x:100,y:950,width:800,height:500}}];g.__capriWindowInfo={'17':{title:'ChatGPT',process:'ChatGPT.exe'},'19':{title:'Visible chat - Discord',process:'Discord.exe'},'21':{title:'Winter Camping - YouTube - Google Chrome',process:'chrome.exe'}};
 g.__capriObservationOverride={jpegBase64:nativeImage.createFromBitmap(Buffer.alloc(64*48*4,128),{width:64,height:48}).toJPEG(65).toString('base64'),signature:'8'.repeat(3072),region:g.__capriWindowsOverride[1].rect,window:g.__capriWindowsOverride[1].rect};
 a.behavior.d.provider={name:'mock',local:true,async *stream(_m:any,o:any){g.__calls++;g.__images.push(!!o.jpegBase64);await new Promise(r=>setTimeout(r,300));yield JSON.stringify({interpretation:'Only supplied exposed evidence has been inspected.',interest:null,action:'silent',line:'',gesture:'none',reason:'No reason to interrupt.',facts:['Visible chat pane'],curiosity:''});}};

 a.environmentalCuriosity.syncWindows(a.visibleObservationWindows(),Date.now()-30000);
 g.__pending=a.generatedRemark('inspect','Underexplored background selected.',{target:19n});
 });
 await char.waitForTimeout(100);await app.evaluate(()=>(globalThis as any).__capri.presenceTick());await app.evaluate(async()=>await(globalThis as any).__pending);
 expect(await app.evaluate(()=>(globalThis as any).__capri.lastDialogueOutcome)).toContain('chose quiet');
 const context=await app.evaluate(()=>(globalThis as any).__capri.sharedSceneContext('Have you looked at Discord?'));
 expect(context).toContain('recently inspected');expect(context).toContain('Visible chat pane');expect(context).toContain('metadata detected; contents not inspected');
 await app.evaluate(async()=>{const a=(globalThis as any).__capri;await a.generatedRemark('inspect','Same crop.',{target:19n});});
 expect(await app.evaluate(()=>(globalThis as any).__calls)).toBe(1);
 await app.evaluate(async()=>{const a=(globalThis as any).__capri;await a.generatedRemark('inspect','YouTube metadata only.',{target:21n});});
 expect(await app.evaluate(()=>(globalThis as any).__images)).toEqual([true,false]);
 await app.evaluate(()=>{const a=(globalThis as any).__capri;a.behavior.userInput('Actually, new topic.');a.environmentalCuriosity.dropInterests();});
 expect(await app.evaluate(()=>(globalThis as any).__capri.sharedSceneContext('Discord'))).toContain('recently inspected');
 await app.evaluate(()=>{const a=(globalThis as any).__capri;a.settings.update({dialogue:{localContext:false}});});
 expect(await app.evaluate(()=>(globalThis as any).__capri.environmentalCuriosity.history('Discord',Date.now()))).toEqual([]);
 }finally{await closeIsolatedApp(app);fs.rmSync(dir,{recursive:true,force:true,maxRetries:5,retryDelay:100});}
});
