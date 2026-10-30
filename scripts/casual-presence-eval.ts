import fs from 'node:fs';
import {CognitiveRuntime} from '../src/core/cognitiveRuntime';
import {ConversationScene} from '../src/main/store/conversationScene';
import {BehaviorCore} from '../src/main/behavior/core';
import {CodexAccountProvider,configureCodexDiagnostics} from '../src/main/ai/codexAccount';
import {buildCharacterInstructions} from '../src/main/ai/persona';
import {DEFAULT_SETTINGS} from '../src/shared/settings';
const [out,dir]=process.argv.slice(2);if(!out||!dir||fs.existsSync(out))throw Error('Fresh output required');
fs.mkdirSync(dir,{recursive:true});const record=(v:unknown)=>fs.appendFileSync(out,JSON.stringify(v)+'\n');
const provider=new CodexAccountProvider();configureCodexDiagnostics(d=>record({kind:'usage',...d}));
let n=0;
async function ambient(name:string,prior:[string,string][],detail:string,title:string){
 const values=new Map();const store={load:<T>(id:string)=>values.get(id) as T,save:(id:string,v:unknown)=>values.set(id,v),removeCheckpoint:(id:string)=>values.delete(id)};
 const runtime=new CognitiveRuntime(store,()=>true),scene=new ConversationScene(dir+'/'+name,()=>true,()=>true);
 for(const [role,text] of prior){const id='m'+(++n),at=Date.now()-60000+n;const meta=role==='assistant'?{speech:{kind:'generated-spontaneous' as const}}:undefined;runtime.observeMessage({id,role:role as 'user'|'assistant',content:text,ts:at,meta});scene.record({id,role:role as 'user'|'assistant',text,at,event:role==='user'?'chat':'desktop'});}
 const core=new BehaviorCore({directory:dir+'/'+name,cognition:runtime,provider:()=>({name:provider.name,local:false,test:()=>provider.test(),listModels:()=>provider.listModels(),async *stream(messages,o){let raw='';try{for await(const c of provider.stream(messages,o)){raw+=c;yield c;}}finally{record({kind:'raw',name,messages,raw});}}}),scene,memories:()=>[],promptContext:()=>runtime.dialogue.context(),express:()=>true});
 record({kind:'result',name,result:await core.dispatch({kind:'trigger',event:name==='reminder'?'personal_followup':'window_interest',direct:true,budgetReserved:true,detail,observation:{id:name,at:Date.now(),target:'browser',title,process:'chrome.exe',evidence:'metadata',detail},timeoutMs:90000})});
}
async function main(){record({kind:'start',model:'gpt-6-luna',firstAttempt:true});
 await ambient('quiet',[],'User is typing in VS Code, same editor and file. No request, error, completion or new conversational detail. Capri is safely perched.','VS Code - bracket.ts');
 await ambient('unanswered',[['user','I am working on this bracket for a while.'],['assistant','That curved version looks like it wants to escape the drawing.']], 'The same bracket drawing is visible. User continues typing, has not answered the aside. No new design information.','Bracket drawing');
 await ambient('casual',[], 'Visible browser product heading: A mug with an absurdly long handle, called The Long Distance Mug. No user question.','The Long Distance Mug');
 let history:{role:'system'|'user'|'assistant';content:string}[]=[{role:'system',content:buildCharacterInstructions(DEFAULT_SETTINGS)}];
 for(const text of ['I kind of like that ridiculous long-handled mug.','You could steal my coffee from the other side of the desk. Worth the risk?']){history.push({role:'user',content:text});let raw='';try{for await(const c of provider.stream(history,{purpose:'ambient',signal:new AbortController().signal,timeoutMs:90000,temperature:.8,maxTokens:350}))raw+=c;}finally{record({kind:'direct',text,raw});}history.push({role:'assistant',content:raw});}
 await ambient('reminder',[['assistant','The mug handle is ridiculous.']], 'Eligible explicit reminder: user asked to be reminded at 3 PM to submit the lab memo. It is now 3 PM, reminder not delivered, user available. The prior social aside was unanswered. Deliver the due notice without assuming submission.','Lab memo reminder');
 record({kind:'finish'});
}
void main().catch(e=>{record({kind:'failure',error:String(e)});process.exitCode=1;});
