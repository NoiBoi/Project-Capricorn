import fs from 'node:fs';
import { CodexSessions } from '../src/main/ai/codexSessions';
import { buildCharacterInstructions } from '../src/main/ai/persona';
import { DEFAULT_SETTINGS } from '../src/shared/settings';
const out=process.argv[2];
const log=(v:unknown)=>fs.appendFileSync(out,JSON.stringify(v)+'\n');
let b=new CodexSessions();
try {
 const caps=await b.capabilities();log({capabilities:[...caps].filter(x=>/thread\/(start|resume|fork|delete|compact)|turn\/(start|interrupt)/.test(x))});
 const instructions=buildCharacterInstructions(DEFAULT_SETTINGS);
 const h=await b.start({model:'gpt-6-luna',instructions,scope:'primary',dependencies:[]});log({started:h});
 const prompts=[
 'We are planning a fictional tabletop project called Glass Finch. I favor a red dashboard. Pick your own view and one reason. Keep replies under 45 words.',
 'What would you preserve if we simplified it?',
 'Actually red is reserved for warnings, so a red dashboard would hide the warnings. Reconsider your choice.',
 'What changed your mind?',
 'Could we keep some of the energy without the confusion?',
 '*pats your head*',
 'That does not mean you have to agree with me.',
 'What did you recommend before I corrected the warning color?',
 'Enough color talk. New topic: I am making dinner. Pick between dumplings and soup.',
 'Why that one?',
 'No need to turn every reply into a joke.',
 'Keep me quiet company for a moment. One short reply.',
 'Back to Glass Finch. What problem made you reconsider the red dashboard?',
 'We have decided to use blue with red warnings. That settles it.',
 'Do not keep asking me about those colors.',
 'New topic: What would you want to see outside a computer?',
 'You can choose something impractical.',
 'What makes that worth doing?',
 'I would rather stay indoors today.',
 'You can disagree without trying to convince me.',
 'What is one thing we have settled today? Do not reopen the debate.',
 'Now I poke you twice. React to the interruption, then leave the settled subjects alone.'
 ];
 for(let i=0;i<prompts.length;i++){
  if(i===12){b.close();await new Promise(r=>setTimeout(r,1000));b=new CodexSessions();await b.resume(h,instructions);log({resumedAfterProcessRestart:h.id});}
  let text='';const at=Date.now();try{for await(const chunk of b.respond(h,{text:prompts[i],state:'Current conversation is a synthetic evaluation. No real private history or actual physical actions. Earlier choices are historical. Only fictional pats/pokes occurred.',signal:new AbortController().signal,timeoutMs:120000}))text+=chunk;log({turn:i+1,user:prompts[i],firstAttempt:text,usage:h.usage,elapsed:Date.now()-at});}catch(e){log({turn:i+1,failure:String(e),partial:text});throw e;}
 }
 await b.compact(h);log({compacted:h.id});
 let text='';for await(const chunk of b.respond(h,{text:'After our conversation was condensed, what caused the dashboard recommendation to change? Keep it brief.',state:'Settled topics stay closed unless directly asked, as now.',signal:new AbortController().signal,timeoutMs:120000}))text+=chunk;
 log({afterCompaction:text,stats:b.stats});
 log({deletion:await b.invalidate(h)});
 try{b.close();await new Promise(r=>setTimeout(r,1000));b=new CodexSessions();await b.resume(h,instructions);log({deletionVerification:'FAILED: resumed deleted thread'});}catch(e){log({deletionVerification:'resume rejected',detail:String(e)});}
}catch(e){log({failure:String(e)});process.exitCode=1;}finally{b.close();}
