import fs from 'node:fs';import path from 'node:path';import {randomUUID} from 'node:crypto';import {createRequire} from 'node:module';import {build} from 'esbuild';import {Honcho} from '@honcho-ai/sdk';
const root=path.resolve(import.meta.dirname,'..'),scratch=path.join(root,'work/honcho-transport.cjs');
await build({entryPoints:[path.join(root,'src/main/ai/honchoMemory.ts')],outfile:scratch,bundle:true,platform:'node',format:'cjs',external:['@honcho-ai/sdk']});
const {honchoTransport}=createRequire(import.meta.url)(scratch),workspace='capri-stage2-verify-'+randomUUID(),transport=honchoTransport('http://127.0.0.1:8008',workspace);
const report={date:new Date().toISOString(),synthetic:true,workspace,checks:{},limitation:''};
try{
 const health=await fetch('http://127.0.0.1:8011/health',{signal:AbortSignal.timeout(2000)}).then(r=>r.json()).catch(()=>null);if(health)report.modelAdapter={requests:health.requests,limit:health.limit};
 await transport.add([{id:'life-summary:calendar:fixture',role:'user',at:Date.now(),text:'Synthetic source summary. A fictional Arbor spectroscopy review is scheduled. This is observed schedule metadata, not an explicit user report or evidence of attendance.'}]);
 report.checks.actualSourceImport=(await transport.existing()).includes('life-summary:calendar:fixture');report.queue=await transport.queue();
 const reading=await transport.representation();report.checks.derivedReadingAvailable=!!reading.user;
 if(health&&health.requests>=health.limit)report.limitation='The existing local model adapter reports its request allowance exhausted. No limit reset or bypass was attempted; real derivation is unverified.';
}catch(e){report.error=String(e.message??e);}
finally{try{await transport.destroy();const client=new Honcho({baseURL:'http://127.0.0.1:8008',timeout:5000,maxRetries:0});let found=false;for await(const id of await client.workspaces({size:100}))if(id===workspace)found=true;report.checks.actualWorkspaceDeletion=!found;report.deletionVerification='SDK workspace listing after successful session/workspace DELETE';}catch(e){report.deletionError=String(e.message??e);}}
report.ok=!!report.checks.actualSourceImport&&!!report.checks.actualWorkspaceDeletion;
fs.writeFileSync(path.join(root,'docs/integrations/stage2-honcho-transport.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));if(!report.ok)process.exitCode=1;
