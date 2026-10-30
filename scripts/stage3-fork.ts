import fs from 'node:fs';import {CodexSessions} from '../src/main/ai/codexSessions';
const out=process.argv[2],log=(x:unknown)=>fs.appendFileSync(out,JSON.stringify(x)+'\n');const b=new CodexSessions();
try{const h=await b.start({model:'gpt-6-luna',instructions:'Perform Capri. Keep replies under 20 words. For this synthetic test, when asked for your standing preference say you prefer violet for the test badge. No tools.',scope:'primary',dependencies:[]});let first='';for await(const t of b.respond(h,{text:'Our synthetic badge project is named Quartz. Acknowledge it.',state:'No real user history.',signal:new AbortController().signal,timeoutMs:60000}))first+=t;
const fork=await b.fork(h);let continued='';for await(const t of b.respond(fork,{text:'What is the project name and your standing preference?',state:'Synthetic isolated continuation.',signal:new AbortController().signal,timeoutMs:60000}))continued+=t;
log({first,continued,distinctThread:fork.id!==h.id,ephemeral:fork.scope==='private',inheritedHistory:/Quartz/i.test(continued),inheritedInstructions:/violet/i.test(continued)});if(!/Quartz/i.test(continued)||!/violet/i.test(continued))process.exitCode=1;
log({forkInvalidation:await b.invalidate(fork),parentDeletion:await b.invalidate(h)});
}catch(e){log({failure:String(e)});process.exitCode=1;}finally{b.close();}
