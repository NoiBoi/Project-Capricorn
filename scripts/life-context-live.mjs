import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { _electron as electron } from 'playwright-core';
const root=path.resolve(import.meta.dirname,'..'), output=path.join(root,'docs/integrations/live-dialogue-first.json');
if(fs.existsSync(output))throw Error('First samples already exist. Preserve them.');
const original=path.join(os.homedir(),'Documents','Capri Buddy','settings.json');
const configured=JSON.parse(fs.readFileSync(original,'utf8').replace(/^\uFEFF/,''));
const report={date:new Date().toISOString(),scope:'Exactly two first model attempts on synthetic authorized evidence. No user source data, memories, history or credentials copied. Failures and bland/quiet results retained.',provider:configured.ai.provider,results:[]};
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'capri-life-live-'));let app;
try{
 if(configured.ai.provider!=='codex')throw Error('Existing provider is not Codex; no credentials were copied for a live check.');
 fs.writeFileSync(path.join(dir,'settings.json'),JSON.stringify({firstRunComplete:true,character:{startupIntro:false,hideOnFullscreen:false},ai:{...configured.ai,maxTokens:384,requestTimeoutSec:45},memory:{autoLearn:false,honcho:{enabled:false}},dialogue:{localContext:true,contextPings:false,spotifyBanter:false},voice:{ttsEnabled:false,interactionLines:true},behavior:{smallActivities:false,idleRemarks:false,explore:false,quietHours:{enabled:false}},teleport:{auto:false,effects:false}}));
 app=await electron.launch({args:[root],env:{...process.env,CAPRI_TEST:'1',CAPRI_OFFSCREEN:'1',CAPRI_NO_DEV_KEY:'1',CAPRI_USER_DATA:dir}});
 const char=await app.firstWindow();await char.waitForFunction(()=>!!window.__capriDebug);
 await app.evaluate(()=>{const a=globalThis.__capri;globalThis.__capriIdleOverride=0;globalThis.__capriDesktopOverride={title:'Synthetic project fixture',process:'fixture.exe'};const source=a.life.ledger.source('chrome');a.life.configure({...source,sites:['https://docs.example.com'],permissions:{collect:true,live:true,retain:false,content:false,learn:false}});const at=Date.now();a.life.ledger.ingest({source:'chrome',recordId:'active-page',revision:at,type:'displayed-page',occurredAt:at,receivedAt:at,expiresAt:at+90000,entities:[],quality:'observed',permissions:{collect:true,live:true,retain:false,content:false,learn:false},summary:'ArborCalc API design reference',detail:'Displayed heading: Keep browser observation separate from computer action authorization. A read-only metadata route and a separately confirmed action route are proposed. Synthetic demonstration evidence, not a claim about actual repository code.',operation:'upsert',importance:.7});});
 const chat=await app.evaluate(async()=>{const a=globalThis.__capri;await a.convo.send('What do you think of the separation proposed in the displayed API reference?');await a.convo.settle();return a.history.recent(1)[0];});report.results.push({kind:'chat',message:chat});
 const optional=await app.evaluate(async()=>{const a=globalThis.__capri;a.behavior.resumeInitiative();const result=await a.behavior.dispatch({kind:'trigger',event:'life_context',detail:'The same authorized API-design reference remains displayed. Consider one specific personal opinion about its separation of observation and action, or silence if the recent answer already covered it. Do not claim the implementation changed.',direct:false,timeoutMs:30000,context:{evidence:a.life.ledger.current()[0]}});return{result,failure:a.behavior.diagnostics().failure};});report.results.push({kind:'optional',...optional});
}catch(e){report.results.push({kind:'failure',error:String(e.message||e)});}
finally{if(app)await app.close().catch(()=>{});fs.writeFileSync(output,JSON.stringify(report,null,2));fs.rmSync(dir,{recursive:true,force:true,maxRetries:5,retryDelay:100});}
console.log(JSON.stringify(report,null,2));
