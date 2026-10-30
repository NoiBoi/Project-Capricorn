import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {LifeContext,ContextAssembler} from '../src/main/life/context';
import {disconnectedChrome} from '../src/shared/lifeContext';
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'capri-stage4-cost-'));
try{
 const at=Date.now(),life=new LifeContext(dir);life.configure({...disconnectedChrome(),sites:['https://docs.example.com'],permissions:{collect:true,live:true,proactive:true,retain:true,content:true,learn:false}});
 const initial=process.memoryUsage().heapUsed,cpu=process.cpuUsage(),start=performance.now();
 for(let revision=1;revision<=2500;revision++)life.ingest({source:'chrome',recordId:'active',revision,type:'displayed-page',occurredAt:at,receivedAt:at,expiresAt:at+60000,entities:[],quality:'observed',permissions:life.source('chrome')!.permissions,summary:'Statics document',detail:'Unchanged reaction forces.',importance:.7});
 for(let i=0;i<30;i++)life.snapshotPage(`https://docs.example.com/${i}`,i,Array.from({length:16},()=>({kind:'paragraph',level:0,path:'Reaction forces',text:'Reaction forces balance. '.repeat(100)})));
 life.flush();const elapsedMs=performance.now()-start,used=process.cpuUsage(cpu),prompt=new ContextAssembler(life).assemble('reaction forces');
 const result={observations:2500,elapsedMs:Math.round(elapsedMs),cpuMs:Math.round((used.user+used.system)/1000),heapGrowthMB:+((process.memoryUsage().heapUsed-initial)/1048576).toFixed(1),checkpointBytes:fs.statSync(path.join(dir,'life-context.json')).size,contextCharacters:prompt.length,candidates:life.view().candidates.length,...life.diagnostics()};
 console.log(JSON.stringify(result,null,2));if(result.snapshots!==24||result.candidates!==1||result.contextCharacters>9500||result.snapshotCharacters>24*48000)process.exitCode=1;
}finally{fs.rmSync(dir,{recursive:true,force:true,maxRetries:5});}
