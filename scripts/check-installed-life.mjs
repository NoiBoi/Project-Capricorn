import fs from 'node:fs';import path from 'node:path';import { _electron as electron } from 'playwright-core';import {createHash} from 'node:crypto';
const root=path.resolve(import.meta.dirname,'..');
const stateFile=process.argv[2];const state=JSON.parse(fs.readFileSync(stateFile,'utf8').replace(/^\uFEFF/,''));
const app=await electron.launch({executablePath:path.join(state.installed,'Capri Buddy.exe'),args:['--memory'],env:{...process.env,CAPRI_TEST:'0',CAPRI_USER_DATA:state.profile}});
let report;
try{
 await app.firstWindow();for(let i=0;i<100&&!app.windows().some(w=>w.url().includes('panel.html'));i++)await new Promise(r=>setTimeout(r,100));
 const panel=app.windows().find(w=>w.url().includes('panel.html'));if(!panel)throw Error('Production panel unavailable.');
 await panel.waitForFunction(()=>!!window.capri);
 const runtime=await panel.evaluate(async()=>{const api=window.capri;const d=await api.invoke('diagnostics:get');const life=await api.invoke('life:get');const memories=await api.invoke('memory:list');const connection=await api.invoke('connection:check');return {version:d.version,userData:d.userData,startupMs:d.perf.startupMs,approvedMemories:memories.filter(m=>m.status==='approved'&&!m.archived).length,connection:{state:connection.state,provider:connection.provider,detail:connection.detail},sources:life.sources.map(s=>({id:s.id,collect:s.permissions.collect,live:s.permissions.live})),bridge:life.bridge.state};});
 report={date:new Date().toISOString(),runtime,packageMatches:state.packageMatches,rollback:state.rollback,profileBackup:state.profileBackup};
 if(runtime.version!==JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8')).version||runtime.userData!==state.profile)throw Error('Installed state did not match intended version/profile/disconnected sources.');
}finally{await app.close().catch(()=>{});}
const sha=b=>createHash('sha256').update(b).digest('hex').toUpperCase();const preserved={};
for(const name of ['memory.json','secrets.bin','relationship.json'])preserved[name]=sha(fs.readFileSync(path.join(state.profile,name)))===state.beforeHashes[name];
const beforeHistory=fs.readFileSync(path.join(state.profileBackup,'history.jsonl'));const afterHistory=fs.readFileSync(path.join(state.profile,'history.jsonl'));preserved.historyPrefix=afterHistory.subarray(0,beforeHistory.length).equals(beforeHistory);
const beforeSettings=JSON.parse(fs.readFileSync(path.join(state.profileBackup,'settings.json'),'utf8').replace(/^\uFEFF/,'')), afterSettings=JSON.parse(fs.readFileSync(path.join(state.profile,'settings.json'),'utf8').replace(/^\uFEFF/,''));if(beforeSettings.character)delete beforeSettings.character.position;if(afterSettings.character)delete afterSettings.character.position;preserved.settingsExceptPosition=JSON.stringify(beforeSettings)===JSON.stringify(afterSettings);
report.preserved=preserved;report.ok=Object.values(preserved).every(Boolean);fs.writeFileSync(path.join(root,'docs/integrations/installed-check.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));if(!report.ok)process.exitCode=1;
