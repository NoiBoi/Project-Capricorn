/** Standalone replay composition, never loaded by the application. Tests must
 * acquire the same CognitiveRuntime attention lease as the desktop host. */
import path from 'node:path';
import { CognitiveRuntime } from '../src/core/cognitiveRuntime';
import { BehaviorCore as Interpreter, type CoreDeps, type BehaviorEvent } from '../src/main/behavior/core';
import {readJson,writeJsonAtomic} from '../src/main/store/jsonFile';
export * from '../src/main/behavior/core';
export class BehaviorCore extends Interpreter {
  private runtime:CognitiveRuntime;
  constructor(d:Omit<CoreDeps,'cognition'>) {
    const file=path.join(d.directory,'replay-checkpoints.json');
    const checkpoints=readJson<Record<string,unknown>>(file,{}).value;
    const store={load:<T>(k:string)=>checkpoints[k] as T|undefined,save:<T>(k:string,v:T)=>{checkpoints[k]=structuredClone(v);writeJsonAtomic(file,checkpoints);},removeCheckpoint:(k:string)=>{delete checkpoints[k];writeJsonAtomic(file,checkpoints);}};
    const runtime=new CognitiveRuntime(store,()=>d.persistent?.()!==false,d.now);
    super({...d,cognition:runtime});this.runtime=runtime;
  }
  override async dispatch(event:BehaviorEvent) {
    const optional=event.kind==='observe'||event.kind==='opportunity'||event.kind==='trigger'&&!event.direct;
    if(optional)this.runtime.claim('behavior');
    try{return await super.dispatch(event);}finally{if(optional)this.runtime.release('behavior');}
  }
}
