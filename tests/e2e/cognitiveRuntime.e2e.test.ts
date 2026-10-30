import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { _electron as electron, type ElectronApplication } from 'playwright-core';
import { expect, it } from 'vitest';
import { closeIsolatedApp } from './lifecycle';

it('wires one cognitive owner into actual chat, optional delivery and native movement admission',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'capri-cognitive-runtime-'));let app:ElectronApplication|undefined;
  fs.writeFileSync(path.join(dir,'settings.json'),JSON.stringify({firstRunComplete:true,ai:{provider:'offline'},memory:{enabled:true,autoLearn:false},character:{startupIntro:false,hideOnFullscreen:false},voice:{ttsEnabled:false,interactionLines:true},behavior:{smallActivities:false,idleRemarks:false,explore:false,quietHours:{enabled:false}},teleport:{auto:false,effects:false}}));
  const boot=async()=>{app=await electron.launch({args:[path.resolve(__dirname,'../..')],env:{...process.env,CAPRI_TEST:'1',CAPRI_OFFSCREEN:'1',CAPRI_NO_DEV_KEY:'1',CAPRI_USER_DATA:dir}});const page=await app.firstWindow();await page.waitForFunction(()=>!!(window as any).__capriDebug);return app;};
  try{
    const first=await boot();
    const result=await first.evaluate(async()=>{
      const g=globalThis as any,a=g.__capri,r=a.cognitiveRuntime;
      g.__capriIdleOverride=0;a.observeAgency();r.resume();
      const unauthorized=a.presentRemark('An unadmitted optional line.',false);
      const unadmittedAuto=await a.teleporter.go('auto','auto');
      const at=Date.now();r.offer({id:'fixture:important',subject:'fixture:important',revision:1,source:'fixture',at,expiresAt:at+600000,priority:80,action:'reason',event:'context',important:true});
      const effect=r.decide();
      await a.convo.send('Actually, use the blue swatch for the larger bracket.');await a.convo.settle();
      const preempted=!r.validEffect(effect),shared=r.dialogue===a.dialogueCognition;
      await a.convo.send('stay here for 5 minutes');await a.convo.settle();
      const held=a.agency.movementHeld();
      const before=a.history.recent(100).length;
      const optional=await a.generatedRemark('context','The unchanged window is still here.');
      const moved=await a.curiosityDetour('',undefined,undefined,true);
      return {unauthorized,unadmittedAuto:unadmittedAuto.ok,preempted,shared,held,optionalDelivered:!!optional?.delivered,moved,historyUnchanged:a.history.recent(100).length===before,commitments:r.snapshot().intentions.length};
    });
    expect(result).toMatchObject({unauthorized:false,unadmittedAuto:false,preempted:true,shared:true,held:true,optionalDelivered:false,moved:false,historyUnchanged:true});expect(result.commitments).toBeGreaterThan(0);
    await closeIsolatedApp(app);app=undefined;
    const second=await boot();
    const restored=await second.evaluate(()=>{const a=(globalThis as any).__capri;return {shared:a.cognitiveRuntime.dialogue===a.dialogueCognition,subject:a.cognitiveRuntime.snapshot().dialogue.subject,unauthorized:a.presentRemark('Late stale optional line.',false),held:a.agency.movementHeld()};});
    expect(restored.shared).toBe(true);expect(restored.unauthorized).toBe(false);expect(restored.held).toBe(true);expect(restored.subject).toBeTruthy();
  }finally{await closeIsolatedApp(app);fs.rmSync(dir,{recursive:true,force:true});}
});
