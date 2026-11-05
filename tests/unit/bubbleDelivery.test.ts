import { afterEach, expect, it, vi } from 'vitest';
vi.mock('electron',()=>({screen:{getDisplayNearestPoint:()=>({workArea:{x:0,y:0,width:1920,height:1080}})},BrowserWindow:{getAllWindows:()=>[]}}));
vi.mock('../../src/main/windows',()=>({OFFSCREEN:true,reveal:vi.fn(),conceal:vi.fn(),createBubbleWindow:()=>({
  isDestroyed:()=>false,webContents:{once:vi.fn(),isLoadingMainFrame:()=>false,send:vi.fn()},on:vi.fn(),setFocusable:vi.fn(),setBounds:vi.fn(),destroy:vi.fn(),
})}));
vi.mock('../../src/main/desktop/win32',()=>({foregroundHandle:()=>0n,handleToBigint:()=>0n,activateChatWindow:vi.fn(),restoreChatFocus:vi.fn()}));
import { BuddyBubble } from '../../src/main/bubble';
const bubbles:BuddyBubble[]=[];
afterEach(()=>{for(const b of bubbles.splice(0))b.close();});
function rig(){
  let block:string|null=null,enabled=true;
  const b=new BuddyBubble({anchor:()=>({x:200,y:200,width:200,height:300}),enabled:()=>enabled,blocked:()=>block,preload:'',log:{} as any});bubbles.push(b);
  const done=(id:string,text=id,delivery:'aside'|'reply'='aside')=>b.done({id,role:'assistant',content:text,ts:1},delivery);
  return {b,done,block:(reason:string|null)=>{block=reason;},disable:()=>{enabled=false;}};
}
it('keeps dismissed A closed across deltas and completion while distinct B appears once as an aside',()=>{
  const {b,done}=rig();expect(b.delta('A','First','aside')).toBe(true);b.dismiss();
  expect(b.delta('A',' more','aside')).toBe(false);expect(done('A','First more')).toBe(false);
  expect(b.hasVisibleText).toBe(false);expect(b.lastPresentation).toEqual({accepted:false,suppressedBy:'dismissed'});
  expect(b.delta('B','Next','aside')).toBe(true);expect(done('B','Next thought')).toBe(true);
  expect(b.state).toMatchObject({text:'Next thought',delivery:'aside',previous:[],speech:{kind:'generated-spontaneous'}});
  expect(done('B','Next thought')).toBe(true);expect(b.state.previous).toEqual([]);
  expect(b.delta('A',' late','aside')).toBe(false);expect(b.state.text).toBe('Next thought');
  expect(b.lastPresentation.accepted).toBe(false);
});
it('preserves direct replies and lets a later direct turn follow a dismissal',()=>{
  const {b,done}=rig();b.begin();expect(b.delta('direct-A','Answer')).toBe(true);expect(done('direct-A','Answer','reply')).toBe(true);
  b.dismiss();b.begin();expect(b.delta('direct-B','Another')).toBe(true);expect(done('direct-B','Another answer','reply')).toBe(true);
  expect(b.state).toMatchObject({text:'Another answer',delivery:'reply',speech:{kind:'generated-direct'}});
});
it('does not interrupt a composer with an aside or archive a suppressed candidate',()=>{
  const {b,done}=rig();b.open();expect(done('A')).toBe(false);expect(b.lastPresentation.suppressedBy).toBe('composer-active');
  expect(b.state.text).toBe('');expect(done('direct','Requested answer','reply')).toBe(true);
});
it.each(['hidden','sleep-or-quiet'])('reports suppressed %s delivery and accepts a later eligible utterance',reason=>{
  const r=rig();r.block(reason);expect(r.b.delta('A','Hidden','aside')).toBe(false);expect(r.done('A')).toBe(false);
  expect(r.b.lastPresentation).toEqual({accepted:false,suppressedBy:reason});expect(r.b.hasVisibleText).toBe(false);
  r.block(null);expect(r.done('B')).toBe(true);expect(r.b.lastPresentation).toEqual({accepted:true,suppressedBy:null});
});
it('honors disabled visual bubbles independently of speech',()=>{
  const r=rig();r.disable();expect(r.done('A')).toBe(false);expect(r.b.lastPresentation.suppressedBy).toBe('bubbles-disabled');
});
it('routes remarks through the same aside admission without inheriting a prior dismissal',()=>{
  const {b}=rig();expect(b.remark('First')).toBe(true);b.dismiss();expect(b.remark('Second')).toBe(true);
  expect(b.state).toMatchObject({text:'Second',delivery:'aside',previous:[]});
  expect(b.lastPresentation).toEqual({accepted:true,suppressedBy:null});
});
