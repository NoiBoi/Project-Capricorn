import http from 'node:http';
import fs from 'node:fs';
import {CodexSessions} from '../src/main/ai/codexSessions';
const report=process.argv[2];let captured=false;
const server=http.createServer((req,res)=>{let text='';req.on('data',c=>text+=c);req.on('end',()=>{try{const body=JSON.parse(text);const tools=body.tools??[];fs.appendFileSync(report,JSON.stringify({path:req.url,tools,instructions:body.instructions,inputTypes:(body.input??[]).map((x:any)=>x.type)})+'\n');captured=true;}catch{}res.writeHead(400,{'Content-Type':'application/json'});res.end(JSON.stringify({error:{message:'Synthetic tool inventory audit complete',type:'invalid_request_error'}}));});});
await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));
const port=(server.address() as any).port;
const backend=new CodexSessions(['model_provider="capri_audit"','model_providers.capri_audit.name="Capri audit"',`model_providers.capri_audit.base_url="http://127.0.0.1:${port}/v1"`,'model_providers.capri_audit.wire_api="responses"','model_providers.capri_audit.requires_openai_auth=false','model_providers.capri_audit.supports_websockets=false']);
try{const h=await backend.start({model:'gpt-6-luna',instructions:'Only dialogue. No tools.',scope:'private',dependencies:[]});for await(const t of backend.respond(h,{text:'List the tools you can call.',state:'Synthetic audit.',signal:new AbortController().signal,timeoutMs:20000})){};}catch(e){fs.appendFileSync(report,JSON.stringify({expectedFailure:String(e),captured})+'\n');}finally{backend.close();server.close();}
if(!captured)process.exitCode=1;
