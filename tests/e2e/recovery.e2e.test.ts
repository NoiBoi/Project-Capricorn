import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import { _electron as electron, type ElectronApplication, type Page } from 'playwright-core';
import { afterEach, describe, expect, it } from 'vitest';
import { SEAT_RATIO } from '../../src/shared/framing';
let app:ElectronApplication,dir:string;
async function launch(){
  dir=fs.mkdtempSync(path.join(os.tmpdir(),'capri-recovery-'));
  fs.writeFileSync(path.join(dir,'settings.json'),JSON.stringify({firstRunComplete:true,ai:{provider:'offline'},character:{startupIntro:false,glitchEffects:false},behavior:{quietHours:{enabled:false}},voice:{ttsEnabled:false,interactionLines:false},teleport:{auto:false}}));
  app=await electron.launch({...(process.env.CAPRI_EXE?{executablePath:process.env.CAPRI_EXE,args:[]}:{args:[path.resolve(__dirname,'../..')]}),env:{...process.env,CAPRI_TEST:'1',CAPRI_OFFSCREEN:'1',CAPRI_USER_DATA:dir,CAPRI_NO_DEV_KEY:'1'}});
  let char:Page|undefined;for(let i=0;i<100;i++){char=app.windows().find(p=>p.url().includes('/character.html'));if(char)break;await new Promise(r=>setTimeout(r,50));}if(!char)throw Error('No character');await char.waitForFunction(()=>!!(window as any).__capriDebug);
  await app.evaluate(()=>{const g=globalThis as any;g.__capriIdleOverride=0;g.__capriWindowsOverride=[];g.__capriDesktopOverride={title:'Test',process:'test.exe'};});return char;
}
afterEach(async()=>{if(app)await app.close().catch(()=>app.process().kill());if(dir)try{fs.rmSync(dir,{recursive:true,force:true});}catch{}});
describe('requested recovery and stable lying dialogue',()=>{
  it('disables rejected features by default and removes spins from the live cue path',async()=>{
    const char=await launch();
    const settings=await app.evaluate(()=>(globalThis as any).__capri.settings.get());
    expect(settings.character.deepSleep).toBe(false);expect(settings.behavior.satelliteMoments).toBe(false);expect(settings.behavior.windowPossession).toBe(false);
    expect(await app.evaluate(()=>(globalThis as any).__capri.runTheatre('satellite',false,true))).toBe(false);
    expect(await app.evaluate(()=>(globalThis as any).__capri.runTheatre('possession',false,true))).toBe(false);
    await app.evaluate(()=>{(globalThis as any).__capri.charWin.webContents.send('cue',{type:'flourish',kind:'spin'});});
    expect(await char.evaluate(()=>{const d=(window as any).__capriDebug;d.manual(true);d.step(.1);const kind=d.model.performance;d.manual(false);return kind;})).toBeNull();
    await app.evaluate(()=>(globalThis as any).__capri.settings.update({behavior:{mode:'sleep'}}));
    expect(await char.evaluate(()=>{const d=(window as any).__capriDebug;d.manual(true);d.step(.1,450);const a=d.deepSleep.amount;d.manual(false);return a;})).toBe(0);
  });
  it('lands standing, then sits, and only later optionally reclines',async()=>{
    const char=await launch();
    await app.evaluate(({screen},seat)=>{const g=globalThis as any,a=g.__capri,area=screen.getPrimaryDisplay().workArea,b=a.charWin.getBounds();a.landingRest.random=()=>.99;g.__capriWindowsOverride=[{handle:-401n,rect:{x:area.x+100,y:area.y+500,width:1100,height:300}}];a.charWin.setBounds({...b,x:area.x+300,y:Math.round(area.y+500-b.height*seat)});a.settleAfterDrop();g.__capriWindowsOverride=[];a.perchTick();},SEAT_RATIO);
    await expect.poll(()=>app.evaluate(()=>(globalThis as any).__capri.falling),{timeout:6000}).toBe(false);
    await expect.poll(()=>char.evaluate(()=>{const m=(window as any).__capriDebug.model;return {lying:m.activeSecondary,seated:m.activeClip.startsWith('perch')};})).toEqual({lying:null,seated:false});
    await app.evaluate(()=>{const a=(globalThis as any).__capri;a.landingRest.at=Date.now()-15000;a.presenceTick();});
    await expect.poll(()=>char.evaluate(()=>{const m=(window as any).__capriDebug.model;return {lying:m.activeSecondary,seated:m.activeClip.startsWith('perch')};})).toEqual({lying:null,seated:true});
    await app.evaluate(()=>{const a=(globalThis as any).__capri;a.landingRest.at=Date.now()-65000;a.presenceTick();});
    expect(await char.evaluate(()=>(window as any).__capriDebug.model.activeSecondary)).toBeNull();
    await app.evaluate(()=>{const a=(globalThis as any).__capri;a.landingRest.random=()=>0;a.landingRest.cycle=-1;a.presenceTick();});
    await expect.poll(()=>char.evaluate(()=>(window as any).__capriDebug.model.activeSecondary)).toBe('recline');
  });
  it('keeps the lying text box fixed while the head, hair, facing and tail move',async()=>{
    const char=await launch();
    await app.evaluate(({screen},seat)=>{const a=(globalThis as any).__capri,area=screen.getPrimaryDisplay().workArea,b=a.charWin.getBounds();a.charWin.setBounds({...b,x:area.x+area.width-b.width,y:Math.round(area.y+area.height-b.height*seat)});a.settleAfterDrop();a.bubble.remark('Mm. I like this spot.');a.bubble.open();},SEAT_RATIO);
    await expect.poll(()=>char.evaluate(()=>(window as any).__capriDebug.model.activeSecondary)).toBe('recline');
    let bubble:Page|undefined;for(let i=0;i<100;i++){bubble=app.windows().find(w=>w.url().includes('/bubble.html'));if(bubble)break;await new Promise(r=>setTimeout(r,50));}if(!bubble)throw Error('No bubble');await bubble.waitForSelector('textarea');await bubble.evaluate(()=>document.fonts.ready);await bubble.waitForTimeout(500);
    const positions=[];
    for(let i=0;i<10;i++){
      await app.evaluate((_e,i)=>{(globalThis as any).__capri.settings.update({character:{facing:i%2?'left':'right'}});},i);
      await char.evaluate(i=>{const d=(window as any).__capriDebug;d.force({headRoll:i%2?.12:-.12,bodyRot:i%2?.1:-.1,mouthOpen:0});},i);
      await char.waitForTimeout(250);positions.push(await app.evaluate(()=>(globalThis as any).__capri.bubble.window.getBounds()));
    }
    expect(new Set(positions.map(p=>`${p.x},${p.y},${p.width},${p.height}`)).size).toBe(1);
    if(process.env.CAPRI_RECOVERY_CAPTURE)await bubble.screenshot({path:process.env.CAPRI_RECOVERY_CAPTURE});
  });
});
