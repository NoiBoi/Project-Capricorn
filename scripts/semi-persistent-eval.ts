/** First-attempt Luna evaluation. Dedicated synthetic profile; no normal profile writes. */
import fs from 'node:fs';
import path from 'node:path';
import {CognitiveRuntime} from '../src/core/cognitiveRuntime';
import {ConversationScene} from '../src/main/store/conversationScene';
import {BehaviorCore} from '../src/main/behavior/core';
import {ConversationSessions} from '../src/main/cognitive/conversationSessions';
import {CodexSessions} from '../src/main/ai/codexSessions';
import {CodexAccountProvider,configureCodexDiagnostics} from '../src/main/ai/codexAccount';
import {buildCharacterInstructions} from '../src/main/ai/persona';
import {DEFAULT_SETTINGS} from '../src/shared/settings';
const [out,dir]=process.argv.slice(2);if(!out||!dir||fs.existsSync(out))throw Error('Provide fresh output and synthetic profile paths.');
fs.mkdirSync(dir,{recursive:true});const record=(v:unknown)=>fs.appendFileSync(out,JSON.stringify(v)+'\n');
const file=path.join(dir,'checkpoints.json');
const store={load:<T>(id:string)=>{const all=fs.existsSync(file)?JSON.parse(fs.readFileSync(file,'utf8')):{};return all[id] as T|undefined;},save:(id:string,v:unknown)=>{const all=fs.existsSync(file)?JSON.parse(fs.readFileSync(file,'utf8')):{};all[id]=v;fs.writeFileSync(file,JSON.stringify(all));},removeCheckpoint:(id:string)=>{if(!fs.existsSync(file))return;const all=JSON.parse(fs.readFileSync(file,'utf8'));delete all[id];fs.writeFileSync(file,JSON.stringify(all));}};
let runtime=new CognitiveRuntime(store,()=>true),backend=new CodexSessions(),sessions=new ConversationSessions(backend,store,()=>true,()=>[]);
const provider=new CodexAccountProvider(),instructions=buildCharacterInstructions(DEFAULT_SETTINGS);let seq=0,calls=0,sources:string[]=[];
let scene=new ConversationScene(dir,()=>true,()=>true,Date.now,store);
configureCodexDiagnostics(d=>record({kind:'ambient-usage',...d}));
const modeContext=()=>runtime.dialogue.context();
async function direct(text:string){
 const id='u'+(++seq),at=Date.now();runtime.observeMessage({id,role:'user',content:text,ts:at});scene.record({id,role:'user',text,at,event:'chat'});
 const context=runtime.dialogue.context(new Set(),text),dependencies=runtime.dialogue.contextDependencies();calls++;let raw='';const started=Date.now();
 try{for await(const chunk of sessions.respond(provider,[{role:'system',content:instructions+'\n\n'+context+scene.context()},{role:'user',content:text}],{signal:new AbortController().signal,timeoutMs:90000,temperature:.8,maxTokens:250},{private:false,dependencies,instructions,model:DEFAULT_SETTINGS.ai.codex.chatModel}))raw+=chunk;}
 finally{record({kind:'direct-first-attempt',text,raw,contextCharacters:context.length,elapsedMs:Date.now()-started,usage:sessions.snapshot().sessions.map(s=>s.handle.usage)});}
 const m={id:'a'+seq,role:'assistant' as const,content:raw,ts:Date.now(),meta:{contextSources:dependencies,speech:{kind:'generated-direct' as const}}};runtime.observeMessage(m);scene.record({id:m.id,role:m.role,text:raw,at:m.ts,contextSources:dependencies,event:'chat'});sessions.delivered();
}
function behavior(){return new BehaviorCore({directory:dir,cognition:runtime,provider:()=>({name:provider.name,local:false,test:()=>provider.test(),listModels:()=>provider.listModels(),async *stream(messages,o){calls++;let raw='';try{for await(const x of provider.stream(messages,o)){raw+=x;yield x;}}finally{record({kind:'ambient-first-attempt',input:messages.at(-1)?.content,raw,contextCharacters:modeContext().length});}}}),scene,memories:()=>[],persistent:()=>!sources.length,hostRecordsScene:true,contextSources:()=>sources,promptContext:()=>modeContext(),express:e=>{if(!e.line)return true;const id='ambient'+(++seq),at=Date.now();runtime.observeMessage({id,role:'assistant',content:e.line,ts:at,meta:{contextSources:e.contextSources,speech:{kind:'generated-spontaneous'}}});scene.record({id,role:'assistant',text:e.line,at,contextSources:e.contextSources,event:'desktop'});return true;}});}
async function main(){try{
 record({kind:'start',model:DEFAULT_SETTINGS.ai.codex.chatModel,synthetic:true});
 if(process.argv[4]==='followup'){
  const prior=fs.readFileSync(process.argv[5],'utf8').trim().split('\n').map(l=>JSON.parse(l)).find(x=>x.kind==='source-notice').result.line;
  sources=['chrome'];const at=Date.now();runtime.observeMessage({id:'actual-prior',role:'assistant',content:prior,ts:at,meta:{contextSources:sources,speech:{kind:'generated-spontaneous'}}});scene.record({id:'actual-prior',role:'assistant',text:prior,at,contextSources:sources,event:'desktop'});record({kind:'reused-actual-expression',prior});
  await direct('Unrelated: I am making tea.');
  const b=behavior(),observation={id:'perpetual',at:Date.now(),target:'browser',title:'Vendor adds perpetual offline license',process:'chrome.exe',evidence:'metadata' as const,detail:'Vendor correction: existing locally saved designs will open offline forever, with a perpetual license option for new designs.'};
  record({kind:'relevant-development',result:await b.dispatch({kind:'trigger',event:'window_interest',detail:'A relevant new announcement, not a user question.',direct:true,budgetReserved:true,observation,timeoutMs:90000})});
  await direct('That settles it, the CAD license discussion is resolved.');
  record({kind:'unchanged-after-closure',result:await b.dispatch({kind:'trigger',event:'window_interest',detail:'The identical vendor correction refreshed. Nothing changed; the user has closed the discussion.',direct:true,budgetReserved:true,observation:{...observation,id:'same',at:Date.now()},timeoutMs:90000})});
  sessions.clear();record({kind:'finish',calls,stats:backend.stats});return;
 }
 await direct('Two fictional lab mounts: a light one with a sharp inside corner, and a heavier one with a generous fillet. Both see reversing loads. Which would you choose and why? Under 45 words.');
 await direct('Different topic: pick a filling for an omelet. Under 25 words.');
 let b=behavior();record({kind:'contact',result:await b.dispatch({kind:'interact',id:'pat',text:'The user gives Capri a brief headpat.',contact:'pat'})});
 backend.close();backend=new CodexSessions();runtime=new CognitiveRuntime(store,()=>true);sessions=new ConversationSessions(backend,store,()=>true,()=>[]);scene=new ConversationScene(dir,()=>true,()=>true,Date.now,store);record({kind:'restart',context:modeContext()});
 await direct('The light mount drawing now shows a generous polished fillet instead of the sharp corner. Its calculated fatigue margin equals the heavy one. What does that change? Under 45 words.');
 await direct('That settles it, the mount choice is resolved. I will use the light one.');
 b=behavior();record({kind:'unrelated-after-closure',result:await b.dispatch({kind:'interact',id:'pat2',text:'The user gives Capri another brief headpat.',contact:'pat'})});
 sources=['chrome'];b=behavior();
 const observation={id:'license',at:Date.now(),target:'browser',title:'Fictional tool vendor announces subscription-only CAD',process:'chrome.exe',evidence:'metadata' as const,detail:'Vendor announcement: the fictional CAD tool will require a subscription, including to open your locally saved designs.'};
 record({kind:'source-notice',result:await b.dispatch({kind:'trigger',event:'window_interest',detail:'An authorized browser announcement is visible. Respond only if a specific view or curiosity interests you.',direct:true,budgetReserved:true,observation,timeoutMs:90000})});
 await direct('Could an export format still leave you dependent on that vendor? Under 40 words.');
 record({kind:'source-contact',result:await b.dispatch({kind:'interact',id:'pat3',text:'The user relocates Capri safely and gives her a headpat.',contact:'pat'})});
 await direct('Unrelated: I am making tea.');
 record({kind:'source-development',result:await b.dispatch({kind:'trigger',event:'window_interest',detail:'A relevant new vendor announcement, not a user question.',direct:true,observation:{...observation,id:'license2',at:Date.now(),title:'Vendor adds perpetual offline license',detail:'Vendor correction: existing locally saved designs will open offline forever, with a perpetual license option for new designs.'},timeoutMs:90000})});
 const eligible=modeContext(),excluded=runtime.dialogue.context(new Set(['chrome']));runtime.dialogue.invalidateContext('chrome');record({kind:'privacy',eligible,excluded,revoked:modeContext(),checkpoint:store.load('dialogue-cognition')});
 sources=[];sessions.clear();record({kind:'finish',calls,stats:backend.stats});
}catch(e){record({kind:'failure',error:String(e)});process.exitCode=1;}finally{backend.close();}

}
void main();
