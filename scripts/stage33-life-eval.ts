import fs from 'node:fs';
import path from 'node:path';
import {CognitiveRuntime} from '../src/core/cognitiveRuntime';
import {AgencyRuntime,SkillExecutor} from '../src/core/agency';
import {BehaviorCore} from '../src/main/behavior/core';
import {CognitiveSqlite} from '../src/main/store/cognitiveSqlite';
import {ConversationScene} from '../src/main/store/conversationScene';
import {CodexAccountProvider,configureCodexDiagnostics} from '../src/main/ai/codexAccount';
import {LifeContext} from '../src/main/life/context';
import {LifeSource} from '../src/shared/lifeContext';
async function main(){
const dir=process.argv[2],output=process.argv[3];if(!dir||!output||fs.existsSync(output))throw Error('Supply a new synthetic directory and append-only evidence file.');fs.mkdirSync(dir,{recursive:true});
const record=(v:unknown)=>fs.appendFileSync(output,JSON.stringify(v)+'\n');
const db=new CognitiveSqlite(path.join(dir,'cognitive.sqlite')),runtime=new CognitiveRuntime(db,()=>true),agency=new AgencyRuntime(db,new SkillExecutor([],()=>false));runtime.attachAgency(agency);
const scene=new ConversationScene(dir,()=>true,()=>true),life=new LifeContext(dir,Date.now,()=>{},()=>true,db),provider=new CodexAccountProvider();let calls=0;
configureCodexDiagnostics(e=>record({kind:'provider-usage',...e}));
const behavior=new BehaviorCore({directory:dir,cognition:runtime,provider:()=>({name:provider.name,local:provider.local,test:()=>provider.test(),listModels:()=>provider.listModels(),async *stream(messages,options){calls++;let raw='';try{for await(const chunk of provider.stream(messages,options)){raw+=chunk;yield chunk;}}finally{record({kind:'first-attempt',raw});}}}),scene,memories:()=>[],hostRecordsScene:true,express:e=>{if(e.action!=='speak')return false;scene.record({id:'delivered',role:'assistant',text:e.line,at:Date.now(),contextSources:['mail']});record({kind:'synthetic-host-delivery',line:e.line});return true;}});
const availability=(gameOrCall:boolean)=>agency.observe({gameOrCall,quiet:false,focused:false,suspended:false,idleSeconds:0,leisure:false,sources:['synthetic-availability']});
try{
  const now=Date.now(),permissions={collect:true,live:true,proactive:true,retain:true,content:true,learn:false};
  life.configure(LifeSource.parse({id:'mail',kind:'mail',name:'Synthetic mail',permissions}));
  life.ingest({source:'mail',recordId:'advisor',revision:1,occurredAt:now,receivedAt:now,expiresAt:now+3600000,type:'request-claim',quality:'observed',entities:[],summary:'Advisor asks for a meeting response',detail:'Please confirm whether tomorrow at 10:00 works for the lab review. A response is requested.',importance:.9,permissions,operation:'upsert'});
  const candidate=life.view().candidates[0],evidence=life.current('proactive')[0];runtime.offer({id:candidate.id,subject:'advisor-meeting',source:'mail',revision:1,at:now,expiresAt:now+90000,priority:90,action:'reason',event:'life_context'});
  availability(true);record({kind:'gaming',effect:runtime.decide()??null,calls});availability(false);const effect=runtime.decide();if(!effect||!runtime.claim('behavior'))throw Error('Runtime did not admit available follow-through.');
  life.offered(candidate.id);const result=await behavior.dispatch({kind:'trigger',event:'life_context',direct:false,detail:'The game and call ended. This important, previously deferred request still awaits attention. Consider one concise, useful notice now; no claim that the user forgot, read the mail or attended the meeting.',context:{candidateId:candidate.id,evidence,relatedEvidence:[evidence]},valid:()=>runtime.validEffect(effect)});
  life.consideration(candidate.id,{evaluated:'interpretation'in result,delivered:result.delivered,action:result.action,reason:result.reason});runtime.release('behavior');runtime.settle(effect,'completed');
  record({kind:'result',result,calls,candidate:life.view().candidates.find(c=>c.id===candidate.id),synthetic:true});
}catch(error){record({kind:'failure',error:String(error),calls});process.exitCode=1;}finally{behavior.cancel();agency.stop();life.flush();db.close();}

}
void main();
