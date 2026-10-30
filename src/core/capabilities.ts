import type { Checkpoints } from './contracts';

export type CapabilityOutcome = 'completed' | 'dispatched' | 'failed' | 'cancelled' | 'denied' | 'unknown';
export interface CapabilityReceipt {
  id:string; capability:string; at:number; outcome:CapabilityOutcome; detail:string;
  dependencies:string[]; replayed?:boolean;
}
export interface CapabilityCall {
  id:string; capability:string; fingerprint:string; dependencies:string[];
  approved?:boolean; deadline?:number; persist?:boolean;
}
export interface CapabilityDefinition<I,O> {
  parse(value:unknown):I;
  permission(input:I):'allow'|'confirm'|'deny';
  precondition(input:I):boolean;
  execute(input:I,signal:AbortSignal):Promise<O>;
  verify(input:I,result:O):boolean|'dispatched'|'unknown';
}
interface Entry { id:string; capability:string; fingerprint:string; dependencies:string[]; receipt?:CapabilityReceipt }

/** The common execution boundary. Agency owns workflow transitions; this owns
 * authorization, cancellation, outcome verification and non-replay of effects.
 * Payloads/results are never written to the journal. Interrupted one-shot work
 * has an unknown outcome and requires reconciliation, never automatic replay. */
export class TypedCapabilityExecutor {
  private entries:Entry[];
  private running=new Set<string>();
  private volatile=new Set<string>();
  private controllers=new Map<string,{controller:AbortController;dependencies:string[]}>();
  constructor(private store?:Checkpoints,private now=Date.now) {
    const saved=store?.load<{version:1;entries:Entry[]}>('capability-journal-v1');
    if(saved&&(saved.version!==1||!Array.isArray(saved.entries)||saved.entries.length>4096||saved.entries.some(e=>!e||typeof e.id!=='string'||!e.id||typeof e.capability!=='string'||!e.capability||typeof e.fingerprint!=='string'||!Array.isArray(e.dependencies)||e.dependencies.some(s=>typeof s!=='string')||e.receipt&&(!Number.isFinite(e.receipt.at)||!['completed','dispatched','failed','cancelled','denied','unknown'].includes(e.receipt.outcome)))))throw Error('Invalid capability journal; preserved.');
    this.entries=saved?.entries??[];
  }
  private save(){this.store?.save('capability-journal-v1',{version:1,entries:this.entries.filter(e=>!this.volatile.has(e.id)).map(e=>({...e,...e.receipt?{receipt:{...e.receipt,detail:`${e.capability}: ${e.receipt.outcome}. This audit contains no result payload; reconcile before retrying.`}}:{}}))});}
  invalidate(source?:string){
    for(const {controller,dependencies} of this.controllers.values())if(!source||dependencies.includes(source))controller.abort();
    this.entries=this.entries.filter(e=>source&&!e.dependencies.includes(source));this.save();
  }
  async execute<I,O>(call:CapabilityCall,value:unknown,definition:CapabilityDefinition<I,O>,signal:AbortSignal):Promise<{receipt:CapabilityReceipt;result?:O}> {
    if(!call||typeof call.id!=='string'||!call.id||typeof call.capability!=='string'||!call.capability||typeof call.fingerprint!=='string'||!call.fingerprint||!Array.isArray(call.dependencies)||call.dependencies.some(s=>typeof s!=='string'))throw Error('Invalid capability request.');
    const dependencies=[...new Set(call.dependencies)];
    const receipt=(outcome:CapabilityOutcome,detail:string):CapabilityReceipt=>({id:call.id,capability:call.capability,at:this.now(),outcome,detail,dependencies});
    let input:I;
    try {
      input=definition.parse(value);
      const permission=definition.permission(input);
      if(permission==='deny'||permission==='confirm'&&!call.approved)return {receipt:receipt('denied','Permission or explicit approval is required.')};
      if(signal.aborted)return {receipt:receipt('cancelled','Cancelled before execution.')};
      if(call.deadline!==undefined&&(!Number.isFinite(call.deadline)||call.deadline<=this.now()))return {receipt:receipt('cancelled','Execution deadline elapsed.')};
      if(!definition.precondition(input))return {receipt:receipt('failed','Capability precondition failed.')};
    }catch(error){return {receipt:receipt('failed',error instanceof Error?error.message:String(error))};}
    const prior=this.entries.find(e=>e.id===call.id);
    if(prior){
      if(prior.capability!==call.capability||prior.fingerprint!==call.fingerprint)return {receipt:receipt('denied','Request identity was reused with different arguments.')};
      if(this.running.has(call.id))return {receipt:receipt('unknown','This request is still executing; it was not repeated.')};
      return {receipt:{...(prior.receipt??receipt('unknown','Execution was interrupted; reconcile the outcome before retrying.')),replayed:true}};
    }
    // Never evict a replay barrier to make room for another effect.
    if(this.entries.length>=4096)return {receipt:receipt('denied','Execution journal is full; reconcile or clear activity before continuing.')};
    const entry:Entry={id:call.id,capability:call.capability,fingerprint:call.fingerprint,dependencies};
    if(call.persist===false)this.volatile.add(call.id);
    this.entries.push(entry);if(call.persist!==false)this.save();
    const controller=new AbortController(),abort=()=>controller.abort();
    signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();
    const timer=call.deadline===undefined?undefined:setTimeout(abort,Math.min(2147483647,Math.max(0,call.deadline-this.now())));
    this.running.add(call.id);this.controllers.set(call.id,{controller,dependencies});
    let result:O|undefined;
    try {
      result=await definition.execute(input,controller.signal);
      const permission=definition.permission(input);
      if(permission==='deny'||permission==='confirm'&&!call.approved)controller.abort();
      const verified=definition.verify(input,result);
      entry.receipt=controller.signal.aborted?receipt('cancelled','Stopped during execution; effects may have occurred. Verify before retrying.'):verified==='unknown'?receipt('unknown','The workflow ended, but completion could not be independently verified.'):verified==='dispatched'?receipt('dispatched','Dispatched for consideration; no physical completion or delivery is implied.'):verified?receipt('completed','Outcome verified by capability adapter.'):receipt('failed','Capability adapter could not verify success.');
    }catch(error){entry.receipt=receipt(controller.signal.aborted?'cancelled':'failed',controller.signal.aborted?'Stopped during execution; verify any partial effects.':error instanceof Error?error.message:String(error));}
    finally{
      if(timer!==undefined)clearTimeout(timer);signal.removeEventListener('abort',abort);
      this.running.delete(call.id);this.controllers.delete(call.id);
      // Revocation removes the entry while the effect is in flight. Do not resurrect it.
      if(this.entries.includes(entry)&&call.persist!==false)this.save();
      if(call.persist===false){this.entries=this.entries.filter(e=>e!==entry);this.volatile.delete(call.id);}
    }
    return {receipt:entry.receipt!,...(['completed','dispatched','failed','unknown'].includes(entry.receipt?.outcome??'')?{result}:{})};
  }
}
