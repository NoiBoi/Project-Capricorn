import { z } from 'zod';
import { AgencyRuntime, SkillExecutor, type Receipt, type Skill, type SkillInput, type SkillName, type Target } from '../../core/agency';
import type { Checkpoints } from '../../core/contracts';
import type { Company, CompanyControl } from '../../shared/company';
import { TypedCapabilityExecutor } from '../../core/capabilities';

const inputSchema=z.object({target:z.object({handle:z.string(),process:z.string(),title:z.string(),pid:z.number().int().positive().optional()} ).optional(),query:z.string().max(300).optional(),posture:z.enum(['lie','sit']).optional(),quiet:z.boolean().optional(),position:z.object({x:z.number().finite(),y:z.number().finite()}).optional(),anchor:z.object({fraction:z.number().finite().min(0).max(1),edge:z.enum(['lower','perch','inverted'])}).optional(),text:z.string().max(300).optional()});
export interface AgencyHost {
  place(input:SkillInput,signal:AbortSignal):Promise<Receipt>;
  hold(input:SkillInput,signal:AbortSignal):Promise<Receipt>;
  avoid(input:SkillInput,signal:AbortSignal):Promise<Receipt>;
  verify(input:SkillInput,receipt:Receipt):boolean;
  resolve(query:string):Target;
  matches(target:Target):boolean;
  position():{x:number;y:number};
  stopMovement():void;
  timer(key:string,text:string,dueAt:number):boolean;
  cancelTimer(key:string):void;
  canMove():boolean;
  notice(text:string):void;
}
export function createAgency(store:Checkpoints,host:AgencyHost,company:Company,gateway=new TypedCapabilityExecutor(store)) {
  let runtime:AgencyRuntime;
  const skills:Skill[]=(['stay_at_window','hold_position','quiet','avoid_window','timer','commitment'] as SkillName[]).map(name=>({
    name,parse:value=>inputSchema.parse(value),permissions:['user:'+name],
    plan:name==='stay_at_window'?['resolve exact target','find exposed supported position','native placement','verify native bounds']:['validate input','apply native state','verify receipt'],
    idempotency:'revalidate',maxAttempts:3,recovery:name==='stay_at_window'?'Re-resolve identity and geometry before placement. Never substitute another app.':'Reconcile absolute deadline; no blind action replay.',
    precondition:input=>name!=='stay_at_window'||!!input.target||!!input.query,
    execute:async(input,signal,key)=>{
      if(name==='stay_at_window')return host.place(input,signal);
      if(name==='hold_position')return host.hold(input,signal);
      if(name==='avoid_window')return host.avoid(input,signal);
      const receipt:Receipt={id:key,at:Date.now(),verified:true,detail:`${name} recorded.`};
      if(name==='timer') {
        const i=runtime.list().find(i=>`${i.id}:${i.generation}`===key);
        if(!i?.deadline||!host.timer(i.id,input.text??'Timer',i.deadline))throw Error('Timer could not be saved.');
      }
      return receipt;
    },
    verify:(input,receipt)=>name==='stay_at_window'?host.verify(input,receipt):receipt.verified,
  }));
  runtime=new AgencyRuntime(store,new SkillExecutor(skills,(p,source)=>p.startsWith('user:')&&source==='command'&&(!['user:stay_at_window','user:hold_position','user:avoid_window'].includes(p)||host.canMove()),gateway),Date.now,()=>{
    for(const i of runtime?.list()??[]) {
      if(i.state==='cancelled'&&i.skill==='timer')host.cancelTimer(i.id);
      if(i.state==='failed'&&!i.failureNotified){runtime.markFailureNotified(i.id);host.notice(i.receipts.at(-1)?.detail??'The commitment could not be recovered.');}
    }
  });
  company.durable={staying:()=>runtime.movementHeld(),focused:()=>runtime.quiet(),avoiding:id=>runtime.active('avoid_window').some(i=>i.input.target?.handle===id&&host.matches(i.input.target)),
    stayState:now=>{const i=runtime.active().find(i=>['stay_at_window','hold_position'].includes(i.skill)&&i.state==='active');if(!i)return {phase:null,remaining:0,reminderDue:false};const remaining=(i.deadline??Infinity)-now,lead=Math.min(60000,((i.deadline??Infinity)-i.startAt)*.2),near=remaining>0&&remaining<=lead;return {phase:near?'awake':now-i.startAt>=120000?'sleep':'awake',remaining,reminderDue:near&&!i.receipts.some(r=>r.id==='near-end')};},
    markReminded:()=>{ /* Near-end delivery is owned by the host's existing gate; durable ack below. */ runtime.markNearEnd(); }};
  return runtime;
}
export async function agencyControl(runtime:AgencyRuntime,host:AgencyHost,control:CompanyControl):Promise<string|null> {
  if(control.kind==='complete_commitment') {
    const items=runtime.active('commitment');if(items.length!==1)return 'I need exactly one active commitment to mark complete. Release older commitments first.';
    runtime.complete(items[0].id);return 'Marked complete, based on your confirmation.';
  }
  const cancel=(match:(i:ReturnType<AgencyRuntime['list']>[number])=>boolean,reason:string)=>{
    for(const i of runtime.active().filter(match))if(i.skill==='timer')host.cancelTimer(i.id);
    runtime.cancelWhere(match,reason);
  };
  if(['resume','release','focus_end','cancel_intentions'].includes(control.kind)) {
    if(control.kind==='focus_end')for(const i of runtime.active())runtime.setQuiet(i.id,false);
    cancel(i=>control.kind==='resume'&&['quiet','stay_at_window','hold_position'].includes(i.skill)||control.kind==='cancel_intentions'||control.kind==='release'&&['stay_at_window','hold_position'].includes(i.skill)||control.kind==='focus_end'&&i.skill==='quiet','user released commitment');host.stopMovement();
    return control.kind==='resume'?null:'Released. You can give me a new plan.';
  }
  if(control.kind==='allow_window'){const target=host.resolve(control.target);cancel(i=>i.skill==='avoid_window'&&i.input.target?.handle===target.handle,'user allowed window');return 'That window is back on my map.';}
  if(!['stay','focus','avoid','timer','move_window','commitment'].includes(control.kind))return null;
  if(control.kind==='move_window'){cancel(i=>['stay_at_window','hold_position'].includes(i.skill),'user requested movement');host.stopMovement();return null;}
  const durationMs='minutes'in control&&control.minutes!==undefined?control.minutes*60000:control.kind==='timer'?control.seconds*1000:undefined;
  let skill:SkillName='quiet',input:SkillInput={};
  if(control.kind==='stay'){cancel(i=>['stay_at_window','hold_position'].includes(i.skill),'new window instruction');host.stopMovement();}
  if(control.kind==='stay'){skill=control.target?'stay_at_window':'hold_position';input={query:control.target,posture:control.posture,quiet:control.quiet,target:control.target?host.resolve(control.target):undefined};}
  if(control.kind==='avoid'){skill='avoid_window';input={target:host.resolve(control.target)};cancel(i=>['stay_at_window','hold_position'].includes(i.skill),'user requested avoidance');}
  if(control.kind==='timer'){skill='timer';input={text:control.label??'Timer'};}
  if(control.kind==='commitment'){skill='commitment';input={text:control.text};}
  if(skill!=='timer')host.stopMovement();
  const result=await runtime.submit(skill,input,{durationMs,objective:input.text??(input.query?`${skill}: ${input.query}`:skill)});
  if(result.state!=='active')return result.receipts.at(-1)?.detail??'That action was interrupted. Call me again to retry.';
  if(skill==='stay_at_window')return `I'm settled on ${result.input.target?.title}${durationMs?` for ${Math.round(durationMs/60000*100)/100} minutes`:''}.${input.quiet?' Quiet company. You can still talk to me.':''}`;
  if(skill==='hold_position')return `This spot is mine${durationMs?` for ${durationMs/60000} minutes`:' until you call me away'}.`;
  if(skill==='avoid_window')return 'That window is off limits until the deadline or you release it.';
  if(skill==='timer')return 'Timer saved and running.';
  if(skill==='commitment')return 'I have recorded that commitment. Tell me when it is done or cancelled.';
  return durationMs?`I'll keep you quiet company for ${durationMs/60000} minutes. You can still talk to me.`:'Quiet company is on. You can still talk to me.';
}
