import fs from 'node:fs';
import {InteractionProfile} from '../src/main/store/interactionProfile';
import {noonDay,type UsageDay} from '../src/shared/activityPatterns';
import {CodexAccountProvider,configureCodexDiagnostics} from '../src/main/ai/codexAccount';
import {buildCharacterInstructions} from '../src/main/ai/persona';
import {DEFAULT_SETTINGS} from '../src/shared/settings';
const [out,dir]=process.argv.slice(2);if(!out||!dir||fs.existsSync(out))throw Error('Fresh output/profile paths required.');
fs.mkdirSync(dir,{recursive:true});const record=(v:unknown)=>fs.appendFileSync(out,JSON.stringify(v)+'\n');
const now=new Date(2026,9,30,14).getTime();const days:UsageDay[]=Array.from({length:30},(_,n)=>({day:noonDay(now,-n-1),first:540,last:n===0?780:960,endConfirmed:true,active:18000,idle:5400,observed:32400,hours:Array.from({length:24},(_,h)=>h<4?1800:0),sessions:[{start:1,end:5400001,active:3000,complete:true}],breaks:[{hour:23,seconds:900}]}));
fs.writeFileSync(dir+'/activity-usage.json',JSON.stringify({version:1,days}));
const profile=new InteractionProfile(dir,()=>false,()=>90,()=>now,()=>true,()=>60),provider=new CodexAccountProvider();configureCodexDiagnostics(d=>record({kind:'usage',...d}));
async function main(){for(const user of process.argv[4]==='compare'?['Yesterday felt like an early exit from the PC. Does that fit the rhythm you have actually seen? Under 35 words.']:['An optional existing desktop opportunity: PC input has resumed. There is no new user request, and no evidence of sleep or location. A relevant new thought under 30 words or exactly <quiet/>.','I went idle earlier yesterday. Does that prove I finally went to sleep earlier? Under 35 words.']){let raw='';const context=profile.activityContext('late-night habits');try{for await(const x of provider.stream([{role:'system',content:buildCharacterInstructions(DEFAULT_SETTINGS)+context},{role:'user',content:user}],{purpose:'ambient',signal:new AbortController().signal,timeoutMs:90000,temperature:.8,maxTokens:200}))raw+=x;}finally{record({kind:'first-attempt',syntheticHistory:true,user,contextCharacters:context.length,raw});}}}
void main().catch(e=>{record({kind:'failure',error:String(e)});process.exitCode=1;});
