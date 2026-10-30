// Contract test against a loopback fixture server using the REAL official SDK.
// It checks transport/authorship/evidence options, not Honcho's reasoning quality.
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import { HonchoComparison, loadHonchoSDK } from './honcho-comparison.mjs';
const requests = [], at = Date.now() - 600000;
let sessionActive = true;
const server = http.createServer((req,res) => {
  let raw=''; req.on('data',c=>raw+=c); req.on('end',()=>{
    const body = raw ? JSON.parse(raw) : undefined; requests.push({method:req.method,url:req.url,body});
    let result = {id:body?.id,metadata:{},configuration:{},created_at:new Date(at).toISOString()};
    if (req.url.endsWith('/messages')) result = body.messages.map((m,i)=>({id:`stored-${i}`,content:m.content,peer_id:m.peer_id,session_id:'fixture-session',workspace_id:'capri-contract-fixture',metadata:m.metadata,created_at:m.created_at,token_count:10}));
    if (req.url.includes('/queue/status')) result={total_work_units:2,completed_work_units:2,pending_work_units:0,in_progress_work_units:0};
    if (req.url.endsWith('/chat')) result={content:'Fixture response only.',evidence:{conclusions:[],messages:[{id:'stored-0',session_id:'fixture-session',peer_id:'fixture-user',created_at:new Date(at).toISOString()}],tool_calls:[],reasoning_trace_id:null}};
    if (req.method==='DELETE') {
      if(req.url.endsWith('/sessions/fixture-session'))sessionActive=false;
      else if(sessionActive){res.writeHead(409,{'content-type':'application/json'});res.end(JSON.stringify({detail:'Active sessions remain.'}));return;}
      res.writeHead(204);res.end();return;
    }
    res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify(result));
  });
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
try {
  const {Honcho} = loadHonchoSDK(), adapter = new HonchoComparison(Honcho,{baseURL:`http://127.0.0.1:${server.address().port}`,workspaceId:'capri-contract-fixture'});
  assert.equal(adapter.client.baseURL,`http://127.0.0.1:${server.address().port}`);
  await assert.rejects(()=>adapter.ingestSynthetic([{role:'user',text:'Not a synthetic fixture.',id:'real',at}]),/synthetic/);
  await adapter.ingestSynthetic([{synthetic:true,role:'user',text:'I will go to bed after this reply.',id:'u',at},{synthetic:true,role:'assistant',text:'Fine. Get some rest.',id:'a',at:at+1000}]);
  assert.equal((await adapter.ready()).ready,true);
  const response=await adapter.recall('What was the stated bedtime condition?');
  assert.equal(response.evidence.messages[0].id,'stored-0');
  const chat=requests.find(r=>r.url.endsWith('/chat'));
  assert.equal(chat.body.target,'fixture-user');assert.equal(chat.body.include_evidence,true);
  const messages=requests.find(r=>r.url.endsWith('/messages')).body.messages;
  assert.deepEqual(messages.map(m=>m.peer_id),['fixture-user','capri']);
  assert.equal(messages[0].created_at,new Date(at).toISOString());
  assert.equal(messages[0].metadata.source_id,'u');
  assert.equal(requests.find(r=>r.method==='PUT'&&r.url.endsWith('/peers')).body.capri.observe_others,true);
  await adapter.cleanup();assert.equal(requests.at(-1).method,'DELETE');
  const report={sdk:'@honcho-ai/sdk@2.7.0',scope:'Real SDK with loopback contract fixture. No Honcho backend or reasoning-quality comparison was run.',passed:true,checks:['synthetic-only boundary','separate user/Capri authorship','original timestamps','source ids','observer/target perspective','background readiness','evidence requested and preserved','isolated workspace cleanup'],requests:requests.map(r=>({method:r.method,url:r.url}))};
  fs.mkdirSync('docs/personal-context',{recursive:true});fs.writeFileSync('docs/personal-context/honcho-contract.json',JSON.stringify(report,null,2));
  console.log(JSON.stringify({passed:report.passed,checks:report.checks.length,scope:report.scope}));
} finally {server.closeAllConnections();await new Promise(r=>server.close(r));}
