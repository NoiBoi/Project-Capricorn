import http from 'node:http';import fs from 'node:fs';import {CodexSessions} from '../src/main/ai/codexSessions';import {codexRequests} from '../src/main/ai/codexAccount';
const out=process.argv[2],log=(x:unknown)=>fs.appendFileSync(out,JSON.stringify(x)+'\n');
for(const mode of ['quota','timeout']){
 codexRequests.until=0;let calls=0;
 const server=http.createServer((req,res)=>{req.resume();req.on('end',()=>{calls++;if(mode==='quota'){res.writeHead(429,{'Content-Type':'application/json','Retry-After':'1'});res.end(JSON.stringify({error:{message:'Synthetic usage_limit_reached. Retry after 1 seconds.',type:'usage_limit_reached'}}));}});});
 await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));const port=(server.address() as any).port;
 const b=new CodexSessions(['model_provider="capri_fixture"','model_providers.capri_fixture.name="Capri fixture"',`model_providers.capri_fixture.base_url="http://127.0.0.1:${port}/v1"`,'model_providers.capri_fixture.wire_api="responses"','model_providers.capri_fixture.requires_openai_auth=false','model_providers.capri_fixture.supports_websockets=false']);
 try{const h=await b.start({model:'gpt-6-luna',instructions:'Synthetic test. No tools.',scope:'private',dependencies:[]});for await(const t of b.respond(h,{text:'Test failure handling.',state:'No private context.',signal:new AbortController().signal,timeoutMs:mode==='quota'?15000:700})){}log({mode,unexpectedSuccess:true});process.exitCode=1;}catch(e){log({mode,kind:(e as any).kind,error:String(e),calls,cooldownActive:codexRequests.until>Date.now()});if((e as any).kind!==(mode==='quota'?'rate_limit':'timeout'))process.exitCode=1;}finally{b.close();server.closeAllConnections();server.close();}
}
