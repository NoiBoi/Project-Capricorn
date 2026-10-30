import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {CognitiveRuntime} from '../src/core/cognitiveRuntime';
import {CognitiveSqlite} from '../src/main/store/cognitiveSqlite';
const directory=process.argv[2],output=process.argv[3];if(!directory||!output)throw Error('Supply a dedicated synthetic directory and report path.');
fs.mkdirSync(directory,{recursive:true});let now=Date.now(),writes=0;
const db=new CognitiveSqlite(path.join(directory,'cognitive.sqlite'),()=>now),save=db.save.bind(db);
db.save=(id,value)=>{writes++;save(id,value);};
const runtime=new CognitiveRuntime(db,()=>true,()=>now),started=performance.now(),sizes:number[]=[];
try{
  for(let i=0;i<5000;i++){
    now++;const o={id:'event-'+i,subject:'subject-'+i%64,source:'synthetic',revision:i+1,at:now,expiresAt:now+90000,priority:i%100,action:'reason' as const,event:'inspect'};
    assert(runtime.offer(o));const before=writes;assert.equal(runtime.offer(o),false);assert.equal(writes,before);
  }
  for(let i=0;i<2000;i++){
    now++;runtime.observeMessage({id:'message-'+i,role:i%2?'assistant':'user',ts:now,content:i%2?'Violet works because red belongs on warnings.':'Consider the next synthetic panel.'});
    if(i===999||i===1999)sizes.push(fs.statSync(path.join(directory,'cognitive.sqlite')).size);
  }
  const state=runtime.snapshot(),saved=db.load<any>('cognitive-runtime-v1'),dialogue=runtime.dialogue.snapshot();
  assert(state.subjects.length<=32&&state.deferred.length<=16&&saved.seen.length<=128);
  assert((dialogue.evidence?.length??0)<=16&&dialogue.questions.length<=6&&(dialogue.thoughts?.length??0)<=12);
  const restored=new CognitiveRuntime(db,()=>true,()=>now);assert.deepEqual(restored.dialogue.snapshot(),dialogue);db.integrity();
  fs.writeFileSync(output,JSON.stringify({events:5000,rejectedDuplicates:5000,messages:2000,modelRequests:0,checkpointWrites:writes,elapsedMs:Math.round(performance.now()-started),sqliteBytesAfter1000And2000Messages:sizes,contextCharacters:runtime.context().length,dialogueContextCharacters:runtime.dialogue.context().length,bounds:{subjects:state.subjects.length,deferred:state.deferred.length,seen:saved.seen.length,evidence:dialogue.evidence?.length,thoughts:dialogue.thoughts?.length??0,questions:dialogue.questions.length},integrity:'ok',restart:'identical bounded dialogue checkpoint'},null,2));
}finally{db.close();}
