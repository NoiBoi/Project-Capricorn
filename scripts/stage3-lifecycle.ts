import fs from 'node:fs';
import {CodexSessions} from '../src/main/ai/codexSessions';
const out=process.argv[2],log=(x:unknown)=>fs.appendFileSync(out,JSON.stringify(x)+'\n');
let b=new CodexSessions();
const brief='Perform Capri. Reply with one short sentence. No tools. This is a synthetic lifecycle fixture.';
try{
 const h=await b.start({model:'gpt-6-luna',instructions:brief,scope:'private',dependencies:[]});
 let reply='';for await(const t of b.respond(h,{text:'Privately pick an imaginary pet name for a tiny robot.',state:'No user history.',signal:new AbortController().signal,timeoutMs:60000}))reply+=t;
 log({privateFirstAttempt:reply,turns:h.turns});await b.invalidate(h);await new Promise(r=>setTimeout(r,500));
 try{await b.resume(h,brief);log({privateResume:'FAILED'});process.exitCode=1;}catch(e){log({privateResume:'rejected',detail:String(e)});}
 const p=await b.start({model:'gpt-6-luna',instructions:brief,scope:'primary',dependencies:[]});
 let first='';for await(const t of b.respond(p,{text:'For this fictional fixture, the secret test word is cormorant. Acknowledge briefly.',state:'Synthetic fixture.',signal:new AbortController().signal,timeoutMs:60000}))first+=t;
 b.close();await new Promise(r=>setTimeout(r,500));await b.resume(p,brief);
 let resumed='';for await(const t of b.respond(p,{text:'Which test word did I give you?',state:'No handoff. Use native history.',signal:new AbortController().signal,timeoutMs:60000}))resumed+=t;
 log({first,resumed,sameThread:p.id,usage:p.usage});if(!/cormorant/i.test(resumed))process.exitCode=1;
 const ctrl=new AbortController();let partial='';
 try{for await(const t of b.respond(p,{text:'Count from one to one thousand with a separate sentence for each number.',state:'Interruption fixture.',signal:ctrl.signal,timeoutMs:60000})){partial+=t;ctrl.abort();}}catch(e){log({interruption:String(e),partial,signalAborted:ctrl.signal.aborted});}
 log({deleteAfterInterruption:await b.invalidate(p)});
}catch(e){log({failure:String(e)});process.exitCode=1;}finally{b.close();}
