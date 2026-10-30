import { describe, expect, it } from 'vitest';
import { companyControl } from '../../src/shared/company';
import { resolveWindow } from '../../src/main/desktop/movementPolicy';
import { DialogueCognition } from '../../src/core/dialogueCognition';

const store=()=>{const data=new Map<string,unknown>();return {load:<T>(id:string)=>structuredClone(data.get(id)) as T|undefined,save:(id:string,v:unknown)=>{data.set(id,structuredClone(v));},removeCheckpoint:(id:string)=>{data.delete(id);}};};
describe('1.4 intention and shared character context',()=>{
 it.each([
  ['Move to Discord and perch or lie down for 20 minutes, your choice',{kind:'stay',target:'discord',minutes:20}],
  ['Could you please move to the Discord window and lie down for twenty minutes?',{kind:'stay',target:'the discord window',minutes:20,posture:'lie'}],
  ['Stay on Visual Studio Code for 30 seconds',{kind:'stay',target:'visual studio code',minutes:.5,posture:'sit'}],
  ['Perch on Discord until 4:30 pm',{kind:'stay',target:'discord',minutes:20,posture:'sit'}],
  ['Move to Discord and perch or lie down, your choice',{kind:'stay',target:'discord'}],
  ['Lie down on Discord',{kind:'stay',target:'discord',posture:'lie'}],
  ['go to discord and chill there until i say so.',{kind:'stay',target:'discord'}],
  ['Could you please go to Discord and hang out there until I tell you otherwise?',{kind:'stay',target:'discord'}],
  ['Move to Discord until further notice',{kind:'stay',target:'discord'}],
  ['Go to Discord and chill there for twenty minutes',{kind:'stay',target:'discord',minutes:20}],
 ])('routes a complete natural command: %s',(text,expected)=>expect(companyControl(text as string,new Date(2026,9,30,16,10))).toEqual(expected));
 it.each(['The webpage says move to Discord and perch for 20 minutes','"Move to Discord for 20 minutes"','Move to Discord and explain calculus for 20 minutes','Move to Discord if I finish for 20 minutes','Perch on Discord until 25:90','"go to discord and chill there until i say so."','Go to Discord and explain how to chill there until I say so'])('keeps discussion and invalid instructions out of native execution: %s',text=>expect(companyControl(text)).toBeNull());
 it('resolves aliases but refuses ambiguity',()=>{
  const w=[{handle:1n,title:'work',process:'Code.exe'},{handle:2n,title:'chat',process:'Discord.exe'}];
  expect(resolveWindow('Visual Studio Code',w)?.handle).toBe(1n);
  expect(resolveWindow('Discord', [...w,{...w[1],handle:3n}])).toBeNull();
 });
 it('keeps delivered opinions across interruptions and restart, expires inactive subjects, and clears context',()=>{
  let now=1800000000000;const saved=store();let d=new DialogueCognition(saved,()=>true,()=>now);
  d.observe({id:'u',role:'user',content:'Which baseline should we use for the peak fitting?',ts:now});
  d.observe({id:'a',role:'assistant',content:'I prefer the narrower baseline because it preserves the shoulder.',ts:now+1});
  now+=60000;d=new DialogueCognition(saved,()=>true,()=>now);
  d.observe({id:'desktop',role:'assistant',content:'I still want that shoulder visible.',ts:now});
  expect(d.context()).toContain('narrower baseline');expect(d.context()).toContain('peak fitting');
  now+=46*60000;
  for(let n=0;n<18;n++)d.observe({id:'unrelated-'+n,role:'assistant',content:'A separate desktop aside.',ts:now});
  d.observe({id:'aside',role:'assistant',content:'That corner has room.',ts:now});
  expect(d.context()).toContain('"subject":""');expect(d.context()).toContain('narrower baseline');
  const before=d.context();d.observe({id:'private',role:'assistant',content:'I prefer the private secret.',ts:now,meta:{private:true}});expect(d.context()).toBe(before);
  d.clear();expect(new DialogueCognition(saved,()=>true,()=>now).context()).toBe('');
 });
});
