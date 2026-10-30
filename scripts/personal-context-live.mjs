// Exactly one live optional decision against synthetic context, with the already selected Codex provider.
// No production memories, screenshots, chat history or credentials are copied into the fixture profile.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
import { _electron as electron } from 'playwright-core';
const root=path.resolve(import.meta.dirname,'..');
const repairCheck=process.argv.includes('--repair-check');
const output=path.join(root,'docs/personal-context',repairCheck?'live-after-repair.json':'live-first-result.json');
if(fs.existsSync(output))throw new Error('A first result already exists; do not overwrite it by re-sampling.');
const configured=JSON.parse(fs.readFileSync(path.join(process.env.APPDATA,'Capri Buddy','settings.json'),'utf8').replace(/^\uFEFF/,''));
if(configured.ai.provider!=='codex')throw new Error('This bounded live check requires the existing selected Codex provider.');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'capri-personal-live-'));
let app;
try {
  await build({stdin:{contents:"export {PersonalContext,PersonalChanges} from './src/main/store/personalContext'; export {RelationshipStore} from './src/main/store/relationship';",loader:'ts',resolveDir:root},outfile:path.join(dir,'seed.cjs'),bundle:true,platform:'node',format:'cjs'});
  const require=createRequire(import.meta.url),{PersonalContext,PersonalChanges,RelationshipStore}=require(path.join(dir,'seed.cjs'));
  const now=Date.now(),working=new PersonalContext(dir,()=>true,()=>true,()=>true),relationship=new RelationshipStore(dir,()=>true,()=>true);
  const text='I am working on ArborCalc. The export is still broken. I will go to bed after this reply.';
  const source={messageId:'synthetic-u',text,at:now-12*60000};
  working.learn(PersonalChanges.parse({situations:[{key:'current_work',value:'working on ArborCalc',evidence:'I am working on ArborCalc.',ttlMinutes:120}],commitments:[{op:'add',intention:'go to bed',condition:{kind:'reply'},evidence:'I will go to bed after this reply.'}]}),[source],working.checkpoint());
  working.replyDelivered('synthetic-u','synthetic-a',now-11*60000);
  relationship.setThread({title:'ArborCalc',summary:'The user reports the export is still broken.',status:'active'}, {role:'user',messageId:source.messageId,evidence:'The export is still broken.',at:source.at});
  const opinion='I prefer finishing the broken part before dressing it up, because polish does not make a failed export useful.';
  relationship.learnTaste({op:'add',topic:'finishing work',text:'Prefers fixing a broken function before polishing its appearance.',evidence:opinion},{role:'assistant',messageId:'synthetic-a',evidence:opinion,at:now-11*60000},relationship.snapshot());
  const commitment=working.snapshot().commitments[0];
  fs.writeFileSync(path.join(dir,'settings.json'),JSON.stringify({firstRunComplete:true,character:{startupIntro:false,hideOnFullscreen:false},ai:{...configured.ai,historyTurns:0},voice:{ttsEnabled:false,interactionLines:true},memory:{autoLearn:false},dialogue:{localContext:true,contextPings:false,spotifyBanter:false},behavior:{idleRemarks:false,smallActivities:false,explore:false,quietHours:{enabled:false}},teleport:{auto:false,effects:false}}));
  app=await electron.launch({args:[root],env:{...process.env,CAPRI_TEST:'1',CAPRI_OFFSCREEN:'1',CAPRI_NO_DEV_KEY:'1',CAPRI_USER_DATA:dir}});
  const char=await app.firstWindow();await char.waitForFunction(()=>!!window.__capriDebug);
  const result=await app.evaluate(async(_e,id)=>{
    const g=globalThis,a=g.__capri;g.__capriIdleOverride=0;g.__capriDesktopOverride={title:'Synthetic fixture',process:'fixture.exe'};
    a.personalContext.observePresence(0);
    const decision=await a.generatedRemark('personal_followup','The user stated an intention to sleep after the matching reply. That reply was delivered eleven minutes ago and PC input is active. Consider one specific natural callback, connected to the real supplied project or your established position if it fits. Do not assert that the task is done or that the user never slept.',{personalCommitmentId:id});
    a.memoryLearner.discard();
    return {decision:decision??null,diagnostic:a.lastDialogueOutcome,failure:a.behavior.diagnostics().failure,commitments:a.personalContext.snapshot().commitments,delivered:a.scenes.recent().filter(e=>e.kind==='said').map(e=>e.text)};
  },commitment.id);
  const report={scope:repairCheck ? 'One follow-up verification after correcting targetless follow-ups being cancelled by routine pose changes. The original suppressed first result is retained separately. No broad naturalness claim.' : 'Exactly one first live optional generation using the configured Codex model and entirely synthetic context. No re-sampling or broad naturalness claim.',model:configured.ai.codex?.chatModel,fixture:{userReport:text,priorAssistantOpinion:opinion,replyMinutesAgo:11,currentPCInput:true},result};
  fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,JSON.stringify(report,null,2));
  console.log(JSON.stringify(report));
} finally {
  if(app)await app.close().catch(()=>{});
  fs.rmSync(dir,{recursive:true,force:true,maxRetries:10,retryDelay:100});
}
