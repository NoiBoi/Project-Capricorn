import fs from 'node:fs';
import {CognitiveRuntime} from '../src/core/cognitiveRuntime';
import {ConversationScene} from '../src/main/store/conversationScene';
import {BehaviorCore} from '../src/main/behavior/core';
import {Conversation, type ConversationDeps} from '../src/main/ai/conversation';
import {CodexAccountProvider,configureCodexDiagnostics} from '../src/main/ai/codexAccount';
import {ConversationSessions} from '../src/main/cognitive/conversationSessions';
import {CodexSessions} from '../src/main/ai/codexSessions';
import {DEFAULT_SETTINGS} from '../src/shared/settings';
import {BackgroundBudget} from '../src/main/ai/backgroundBudget';
import type {ChatMessage} from '../src/shared/ipc';
const [out,dir]=process.argv.slice(2);if(!out||!dir||fs.existsSync(out)||fs.existsSync(dir))throw Error('Fresh output and profile paths required');
fs.mkdirSync(dir,{recursive:true});const record=(v:unknown)=>fs.appendFileSync(out,JSON.stringify(v)+'\n');
let scenario='',n=0,at=Date.now();
configureCodexDiagnostics(d=>record({kind:'usage',scenario,...d}));
const real=new CodexAccountProvider();
const provider={name:real.name,local:false,test:()=>real.test(),listModels:()=>real.listModels(),async *stream(messages:Parameters<typeof real.stream>[0],o:Parameters<typeof real.stream>[1]){let raw='';try{for await(const c of real.stream(messages,o)){raw+=c;yield c;}}finally{record({kind:'raw',scenario,messages,raw});}}};
const values=new Map();const store={load:<T>(id:string)=>values.get(id) as T,save:(id:string,v:unknown)=>values.set(id,v),removeCheckpoint:(id:string)=>values.delete(id)};
const runtime=new CognitiveRuntime(store,()=>true,()=>at),scene=new ConversationScene(dir,()=>true,()=>true,()=>at),budget=new BackgroundBudget(undefined,()=>at),history:ChatMessage[]=[];
const delivered=(m:ChatMessage)=>{history.push(m);runtime.observeMessage(m);scene.record({id:m.id,role:m.role as 'user'|'assistant',text:m.content,at:m.ts,event:m.role==='user'?'chat':'desktop'});};
const maySpeak=(direct=false)=>runtime.mayPresent({direct,composer:false,pendingAudio:0,waitSeconds:0});
const core=new BehaviorCore({directory:dir,cognition:runtime,now:()=>at,provider,scene,budget,memories:()=>[],hostRecordsScene:true,promptContext:()=>runtime.dialogue.context(),maySpeak:()=>maySpeak(),express:e=>{
 if(!runtime.deliveryAllowed())return false;
 const plan=runtime.performance.plan({direct:false,quiet:false,available:true,held:false,moving:false,line:e.line,origin:{kind:'generated-spontaneous'},availableReactions:['curious','nod']});
 if(plan.speech)delivered({id:'a'+(++n),role:'assistant',content:plan.speech,ts:++at,meta:{speech:plan.origin}});
 record({kind:'delivery',scenario,plan});return !!plan.speech||!!plan.reaction;
}});
const settings=structuredClone(DEFAULT_SETTINGS);settings.voice.ttsEnabled=false;
// Capture native first attempts before delivery filtering, including failures.
const backend=new CodexSessions(),nativeRespond=backend.respond.bind(backend);
backend.respond=async function*(handle,input){let raw='';try{for await(const c of nativeRespond(handle,input)){raw+=c;yield c;}}finally{record({kind:'native-raw',scenario,raw,usage:handle.usage});}};
const sessions=new ConversationSessions(backend,store,()=>true,()=>[]);
const conversation=new Conversation({sessions,onModelSession:session=>record({kind:'native-session',scenario,session}),settings:()=>settings,provider:()=>provider,history:{append:m=>{m.ts=++at;history.push(m);},recent:n=>history.slice(-n),recallHistory:()=>history},memories:()=>[],companionContext:(_b,q)=>runtime.dialogue.context(new Set(),q),onUserMessage:m=>{at=Math.max(at,m.ts);runtime.observeMessage(m);scene.record({id:m.id,role:'user',text:m.content,at:m.ts,event:'chat'});},onAssistantMessage:m=>{sessions.delivered();at=Math.max(at,m.ts);runtime.observeMessage(m);scene.record({id:m.id,role:'assistant',text:m.content,at:m.ts,event:'chat'});},filterReply:text=>runtime.performance.plan({direct:true,quiet:false,available:true,held:false,moving:false,line:text,origin:{kind:'generated-direct'},availableReactions:[]}).speech??'',emit:(channel,payload)=>{if(channel==='chat:done')record({kind:'conversation-delivery',scenario,payload});},cue:()=>{},confirm:async()=>false,actionCtx:{} as ConversationDeps['actionCtx'],log:{info:()=>{},warn:()=>{},error:()=>{}} as unknown as ConversationDeps['log']});
async function ambient(name:string,detail:string,title:string,important=false){
 scenario=name;at+=60000;
 const o={id:name,subject:name,revision:1,source:'desktop',at,expiresAt:at+90000,priority:important?90:50,action:'reason' as const,event:important?'personal_followup':'window_interest',detail,important};
 const offered=runtime.offer(o),effect=runtime.decide();record({kind:'admission',scenario,offered,effect,engagement:runtime.dialogue.engagement(),budget:budget.snapshot()});
 if(!effect||!runtime.claim('behavior')){record({kind:'result',scenario,result:{action:'defer',reason:'normal cognitive admission'}});return;}
 try{record({kind:'result',scenario,result:await core.dispatch({kind:'trigger',event:o.event,direct:false,detail,observation:{id:name,at,target:'browser',title,process:'chrome.exe',evidence:'metadata',detail},timeoutMs:90000})});}finally{runtime.release('behavior');runtime.settle(effect,'completed');}
}
async function chat(name:string,text:string){scenario=name;at+=1000;conversation.send(text);await conversation.settle();record({kind:'chat-result',scenario,text,message:history.at(-1),engagement:runtime.dialogue.engagement(),native:sessions.snapshot()});}
async function main(){record({kind:'start',model:'gpt-6-luna',firstAttempt:true,fixtures:'Headless available desktop, no private data/integrations. Real cognition admission, budget, BehaviorCore, Conversation and performance policies; no native UI/audio claim.'});
 if(!['social','native'].includes(process.argv[4]))await ambient('quiet','User is typing in VS Code, same editor and file. No request, error, completion or new conversational detail. Capri is safely perched.','VS Code - bracket.ts');
 if(process.argv[4]!=='native')await ambient('casual','Visible browser product heading: A mug with an absurdly long handle, called The Long Distance Mug. No user question.','The Long Distance Mug');
 if(process.argv[4]!=='native')await ambient('ignored','The same Long Distance Mug heading remains visible. User continues working without replying. No new product detail.','The Long Distance Mug');
 await chat('opening','I kind of like that ridiculous long-handled mug.');
 await chat('sustained','You could steal my coffee from the other side of the desk. Worth the risk?');
 if(process.argv[4]!=='social')await chat('topic-change','Unrelated: I need a dinner idea. Something with eggs and mushrooms, and I am sick of omelets.');
 if(!['social','native'].includes(process.argv[4]))await ambient('reminder','Eligible explicit reminder: user asked to be reminded at 3 PM to submit the lab memo. It is now 3 PM, reminder not delivered, user available. Deliver the due notice without assuming submission.','Lab memo reminder',true);
 record({kind:'native-final',sessions:sessions.snapshot()});sessions.close();record({kind:'finish'});
}
void main().catch(e=>{record({kind:'failure',scenario,error:String(e)});sessions.close();process.exitCode=1;});
