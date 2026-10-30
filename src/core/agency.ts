import { assign, createActor, fromPromise, fromTransition, setup, type AnyActorRef } from 'xstate';
import type { Checkpoints } from './contracts';
import { TypedCapabilityExecutor } from './capabilities';

export type IntentionSource = 'command' | 'proposal' | 'curiosity' | 'background' | 'reminder';
export type SkillName = 'stay_at_window' | 'hold_position' | 'quiet' | 'avoid_window' | 'timer' | 'commitment';
export type IntentionState = 'pending'|'executing'|'recovering'|'active'|'completed'|'cancelled'|'failed';
export interface Target { handle: string; process: string; title: string; pid?:number }
export interface RestAnchor {fraction:number;edge:'lower'|'perch'|'inverted'}
export interface SkillInput { target?: Target; query?: string; posture?: 'lie' | 'sit'; quiet?: boolean; position?: {x:number;y:number}; anchor?:RestAnchor; text?: string }
export interface Receipt { id: string; at: number; verified: boolean; detail: string; target?: Target; position?: {x:number;y:number}; anchor?:RestAnchor }
export interface DurableIntention {
  id: string; source: IntentionSource; objective: string; expectedOutcome: string;
  priority: number; interruption: 'user' | 'preemptible'; entity?: string;
  createdAt: number; startAt: number; deadline?: number; expiresAt?: number;
  cancellation: string[]; state: IntentionState; capabilities: SkillName[]; skill: SkillName; input: SkillInput;
  receipts: Receipt[]; recovery: 'revalidate' | 'deadline' | 'acknowledge';
  acknowledged: boolean; failureNotified?:boolean; userOverride?: string; generation: number; attempts: number;
}
export interface Skill<I = SkillInput> {
  name: SkillName; parse(value: unknown): I; permissions: string[];
  plan: readonly string[]; idempotency: 'revalidate' | 'keyed'; maxAttempts: number;
  recovery: string; compensation?: (input:I,signal:AbortSignal)=>Promise<void>;
  precondition(input:I): boolean;
  execute(input:I,signal:AbortSignal,key:string): Promise<Receipt>;
  verify(input:I,receipt:Receipt): boolean;
}
export class SkillExecutor {
  constructor(private skills: Skill[], private permitted: (permission:string,source:IntentionSource)=>boolean,private gateway=new TypedCapabilityExecutor()) {}
  async execute(intent:DurableIntention,signal:AbortSignal):Promise<Receipt> {
    const skill=this.skills.find(s=>s.name===intent.skill);
    if(!skill || !intent.capabilities.includes(intent.skill)) throw Error('Capability is not allowed by this intention.');
    if(intent.attempts>skill.maxAttempts) throw Error('Recovery limit reached. Call me again to retry.');
    const key=`${intent.id}:${intent.generation}`;
    const response=await this.gateway.execute({id:'agency:'+key,capability:skill.name,fingerprint:key,dependencies:[],deadline:intent.deadline},intent.input,{
      parse:skill.parse,permission:()=>skill.permissions.every(p=>this.permitted(p,intent.source))?'allow':'deny',
      precondition:skill.precondition,execute:(input,s)=>skill.execute(input,s,key),verify:(input,r)=>r.verified&&skill.verify(input,r),
    },signal);
    if(response.receipt.outcome!=='completed'||!response.result)throw Error(response.result?.detail??response.receipt.detail);
    return response.result;
  }
}

const intentionMachine=setup({
  types:{} as {context:{receipt?:Receipt;error?:string};events:{type:'START'|'RECOVER'|'COMPLETE'|'CANCEL'|'RETRY'}},
  actors:{execute:fromPromise<Receipt>(async()=>{throw Error('Missing executor');})},
}).createMachine({
  id:'intention',initial:'pending',context:{},
  on:{CANCEL:{target:'.cancelled'},COMPLETE:{target:'.completed'}},
  states:{
    pending:{on:{START:'executing',RECOVER:'recovering'}},
    executing:{on:{RECOVER:'recovering'},invoke:{src:'execute',onDone:{target:'active',actions:assign({receipt:({event})=>event.output,error:undefined})},onError:{target:'failed',actions:assign({error:({event})=>String(event.error instanceof Error?event.error.message:event.error)})}}},
    recovering:{on:{RETRY:'executing'}},
    active:{on:{RECOVER:'recovering'}},failed:{on:{RETRY:'executing'}},
    completed:{type:'final'},cancelled:{type:'final'},
  },
});
export type Availability = 'focused'|'available'|'leisure'|'game_call'|'afk'|'suspended'|'quiet';
export interface AvailabilityEvidence { suspended:boolean; quiet:boolean; focused:boolean; idleSeconds:number; gameOrCall:boolean; leisure:boolean; sources:string[] }
const availabilityLogic=fromTransition((state: {mode:Availability;sources:string[]},e:{type:'OBSERVE';value:AvailabilityEvidence})=>e.type!=='OBSERVE'?state:({
  mode:(e.value.suspended?'suspended':e.value.quiet?'quiet':e.value.idleSeconds>=300?'afk':e.value.gameOrCall?'game_call':e.value.focused?'focused':e.value.leisure?'leisure':'available') as Availability,sources:e.value.sources,
}),{mode:'available' as Availability,sources:[] as string[]});
const attentionLogic=fromTransition((s:{owner:string|null},e:{type:'CLAIM'|'RELEASE';id:string})=>e.type==='CLAIM' ? s.owner? s:{owner:e.id}:e.type==='RELEASE'&&s.owner===e.id?{owner:null}:s,{owner:null as string|null});
const physicalLogic=fromTransition((state: {owner:string|null;state:string},e:{type:'SET';owner:string|null;state:string})=>e.type==='SET'?({owner:e.owner,state:e.state}):state,{owner:null as string|null,state:'free'});
const deadlineLogic=fromTransition((s:{reconciledAt:number},e:{type:'RECONCILE';at:number})=>e.type==='RECONCILE'?{reconciledAt:e.at}:s,{reconciledAt:0});
interface SavedAgency {version:1;intentions:DurableIntention[];snapshots:Record<string,unknown>}
const live=(i:DurableIntention)=>!['completed','cancelled','failed'].includes(i.state);

/** One host heartbeat drives deadlines and optional initiative. Effects are never
 * blindly replayed from an XState snapshot: interrupted work revalidates first. */
export class AgencyRuntime {
  private intentions:DurableIntention[]=[];
  private actors=new Map<string,AnyActorRef>();
  readonly availability=createActor(availabilityLogic).start();
  readonly attention=createActor(attentionLogic).start();
  readonly physical=createActor(physicalLogic).start();
  readonly deadlines=createActor(deadlineLogic).start();
  private stopped=false;
  private sequence=0;
  private carried=false;
  constructor(private store:Checkpoints,private executor:SkillExecutor,private now=Date.now,private changed:()=>void=()=>{}) {
    const saved=store.load<SavedAgency>('agency-v1');
    if(saved && saved.version!==1) throw Error('Unsupported agency checkpoint; preserved.');
    if(saved&&(!Array.isArray(saved.intentions)||saved.intentions.length>64))throw Error('Invalid agency checkpoint; preserved.');
    for(const original of saved?.intentions??[]) {
      if(!original||typeof original.id!=='string'||!original.id||!['command','proposal','curiosity','background','reminder'].includes(original.source)||!['pending','executing','recovering','active','completed','cancelled','failed'].includes(original.state)||!original.input||!Array.isArray(original.capabilities)||!Array.isArray(original.receipts)||!Number.isFinite(original.createdAt)||!Number.isFinite(original.startAt)||original.deadline!==undefined&&!Number.isFinite(original.deadline))throw Error('Invalid intention checkpoint; preserved.');
      const i=structuredClone(original);
      if(live(i)) {i.state='recovering';i.generation++;i.failureNotified=false;}
      this.intentions.push(i);
    }
    for(const i of this.intentions)this.attach(i);
  }
  private attach(i:DurableIntention) {
    const machine=intentionMachine.provide({actors:{execute:fromPromise(async({signal})=>this.executor.execute(structuredClone(i),signal))}});
    // Restore only stable states. Recovering has no invocation/delayed effect.
    const snapshot={...createActor(machine).getPersistedSnapshot() as object,value:i.state,status:['completed','cancelled'].includes(i.state)?'done':'active'};
    const actor=createActor(machine,{snapshot:snapshot as any});this.actors.set(i.id,actor);
    actor.subscribe({next:s=>{
      if(this.stopped)return;
      i.state=String(s.value) as IntentionState;
      if(s.context.receipt && !i.receipts.some(r=>r.id===s.context.receipt!.id)) {
        i.receipts=[...i.receipts,s.context.receipt].slice(-8);
        if(i.state==='active' && s.context.receipt.target)i.input.target=s.context.receipt.target;
        if(i.state==='active' && s.context.receipt.position)i.input.position=s.context.receipt.position;
        if(i.state==='active' && s.context.receipt.anchor)i.input.anchor=s.context.receipt.anchor;
      }
      if(s.context.error && i.receipts.at(-1)?.detail!==s.context.error)i.receipts=[...i.receipts,{id:`${i.id}:failed:${i.generation}`,at:this.now(),verified:false,detail:s.context.error}].slice(-8);
      this.refreshPhysical();this.persist();this.changed();
    },error:error=>{throw error;}});actor.start();
  }
  private refreshPhysical() {
    const i=this.intentions.find(i=>live(i)&&['stay_at_window','hold_position'].includes(i.skill));
    this.physical.send({type:'SET',owner:i?.id??null,state:i?.state??'free'});
  }
  private persist() {
    this.store.save<SavedAgency>('agency-v1',{version:1,intentions:this.intentions,snapshots:Object.fromEntries([...this.actors].map(([id,a])=>[id,a.getPersistedSnapshot()]))});
  }
  list(){return structuredClone(this.intentions);}
  get(id:string){return this.list().find(i=>i.id===id);}
  async submit(skill:SkillName,input:SkillInput,options:{id?:string;source?:IntentionSource;durationMs?:number;objective?:string}={}) {
    if(options.durationMs!==undefined&&(!Number.isFinite(options.durationMs)||options.durationMs<=0||options.durationMs>366*86400000))throw Error('Invalid intention duration.');
    const id=options.id??`intent:${this.now()}:${++this.sequence}`;
    if(this.actors.has(id))return this.get(id)!;
    if(skill==='commitment'&&input.text){const text=input.text.trim().toLowerCase();const existing=this.active('commitment').find(i=>i.input.text?.trim().toLowerCase()===text);if(existing)return existing;}
    const source=options.source??'command';
    if(source==='curiosity' && options.durationMs===undefined)throw Error('Curiosity requires an expiration.');
    if(source!=='command' && ['stay_at_window','hold_position','quiet','avoid_window'].includes(skill))throw Error('A direct user command is required.');
    if(this.intentions.filter(live).length>=32)throw Error('Too many active intentions. Release one first.');
    if(['stay_at_window','hold_position'].includes(skill))this.cancelWhere(i=>['stay_at_window','hold_position'].includes(i.skill),'new movement command');
    if(skill==='quiet')this.cancelWhere(i=>i.skill==='quiet','new quiet command');
    const at=this.now(),i:DurableIntention={id,source,objective:options.objective??skill,expectedOutcome:`Verified ${skill}`,priority:source==='command'?100:source==='curiosity'?10:50,interruption:source==='command'?'user':'preemptible',entity:input.target?.handle??input.query,createdAt:at,startAt:at,...options.durationMs===undefined?{}:{deadline:at+options.durationMs,expiresAt:at+options.durationMs},cancellation:['user override','deadline','target lost'],state:'pending',capabilities:[skill],skill,input:structuredClone(input),receipts:[],recovery:['timer','quiet','avoid_window'].includes(skill)?'deadline':'revalidate',acknowledged:source==='command',failureNotified:true,generation:0,attempts:1};
    this.intentions.push(i);this.trim();this.attach(i);this.actors.get(id)!.send({type:'START'});
    return this.settle(id);
  }
  private settle(id:string):Promise<DurableIntention> {
    const a=this.actors.get(id)!;
    if(!['executing','pending'].includes(String(a.getSnapshot().value)))return Promise.resolve(this.get(id)!);
    return new Promise(resolve=>{const sub=a.subscribe(s=>{if(!['executing','pending'].includes(String(s.value))){sub.unsubscribe();resolve(this.get(id)!);}});});
  }
  cancelWhere(match:(i:DurableIntention)=>boolean,reason:string) {
    for(const i of this.intentions.filter(i=>live(i)&&match(i))){i.generation++;i.userOverride=reason;this.actors.get(i.id)?.send({type:'CANCEL'});}
  }
  retry(id:string){const i=this.intentions.find(i=>i.id===id);if(!i||!['failed','recovering'].includes(i.state))return; i.attempts=i.state==='recovering'?1:i.attempts+1;i.generation++;this.actors.get(id)?.send({type:'RETRY'});return this.settle(id);}
  recover(id:string){const i=this.intentions.find(i=>i.id===id);if(i&&i.state==='active'){i.generation++;i.failureNotified=false;this.actors.get(id)?.send({type:'RECOVER'});}}
  /** Carrying suspends native enforcement, not the user's absolute deadline. */
  beginHandling(){this.carried=true;for(const i of this.intentions.filter(i=>i.state==='executing'&&['stay_at_window','hold_position'].includes(i.skill))){i.generation++;this.actors.get(i.id)?.send({type:'RECOVER'});}}
  endHandling(){this.carried=false;}
  handling(){return this.carried;}
  acceptRest(id:string,receipt:Receipt){
    const i=this.intentions.find(i=>i.id===id&&i.state==='active');
    if(!i||!receipt.verified||!receipt.position||receipt.target?.handle!==i.input.target?.handle)return false;
    i.input.position=receipt.position;if(receipt.anchor)i.input.anchor=receipt.anchor;i.receipts=[...i.receipts,receipt].slice(-8);this.persist();return true;
  }
  tick(){
    if(this.stopped)return;
    this.deadlines.send({type:'RECONCILE',at:this.now()});
    for(const i of this.intentions.filter(live)) {
      if((i.deadline??Infinity)<=this.now() || (i.expiresAt??Infinity)<=this.now()) {this.actors.get(i.id)?.send({type:'COMPLETE'});continue;}
      if(i.state==='recovering' && !this.carried && this.availability.getSnapshot().context.mode!=='suspended')void this.retry(i.id);
    }
  }
  acknowledge(id:string){const i=this.intentions.find(i=>i.id===id);if(i){i.acknowledged=true;this.persist();}}
  markFailureNotified(id:string){const i=this.intentions.find(i=>i.id===id);if(i){i.failureNotified=true;this.persist();}}
  setQuiet(id:string,quiet:boolean){const i=this.intentions.find(i=>i.id===id);if(i){i.input.quiet=quiet;this.persist();}}
  complete(id:string){this.actors.get(id)?.send({type:'COMPLETE'});}
  markNearEnd(){const i=this.intentions.find(i=>live(i)&&['stay_at_window','hold_position'].includes(i.skill));if(i&&!i.receipts.some(r=>r.id==='near-end')){i.receipts.push({id:'near-end',at:this.now(),verified:true,detail:'Near-end heads-up delivered.'});this.persist();}}
  observe(value:AvailabilityEvidence){this.availability.send({type:'OBSERVE',value});}
  active(skill?:SkillName){return this.list().filter(i=>live(i)&&(!skill||i.skill===skill));}
  movementHeld(){return this.active().some(i=>['stay_at_window','hold_position'].includes(i.skill));}
  quiet(){return this.active().some(i=>i.skill==='quiet'||i.input.quiet);}
  optionalAllowed(){return !this.movementHeld()&&!this.quiet()&&['available','leisure'].includes(this.availability.getSnapshot().context.mode);}
  claim(id:string){if(!this.optionalAllowed()||this.attention.getSnapshot().context.owner)return false;this.attention.send({type:'CLAIM',id});return this.attention.getSnapshot().context.owner===id;}
  release(id:string){this.attention.send({type:'RELEASE',id});}
  private trim(){const terminal=this.intentions.filter(i=>!live(i)).slice(0,-32);for(const i of terminal){this.actors.get(i.id)?.stop();this.actors.delete(i.id);}this.intentions=this.intentions.filter(i=>!terminal.includes(i));}
  stop(){this.persist();this.stopped=true;for(const a of this.actors.values())a.stop();this.availability.stop();this.attention.stop();this.physical.stop();this.deadlines.stop();}
  clearHistory(){this.cancelWhere(i=>i.skill!=='timer','user cleared history');for(const i of this.intentions.filter(i=>i.skill!=='timer')){this.actors.get(i.id)?.stop();this.actors.delete(i.id);}this.intentions=this.intentions.filter(i=>i.skill==='timer');this.persist();}
  clear(){this.cancelWhere(()=>true,'user cleared activity');this.intentions=[];for(const a of this.actors.values())a.stop();this.actors.clear();this.persist();}
}
