import {afterEach,beforeEach,expect,it,vi} from 'vitest';
const windowMock=vi.hoisted(()=>({webContents:{once:vi.fn(),isLoading:()=>false,isLoadingMainFrame:()=>false,send:vi.fn(),focus:vi.fn()},isDestroyed:()=>false,on:vi.fn(),setFocusable:vi.fn(),setBounds:vi.fn(),destroy:vi.fn()}));
vi.mock('electron',()=>({screen:{getDisplayNearestPoint:()=>({workArea:{x:0,y:0,width:1280,height:900}})}}));
vi.mock('../../src/main/windows',()=>({createBubbleWindow:()=>windowMock,reveal:vi.fn(),conceal:vi.fn(),OFFSCREEN:true}));
import {BuddyBubble} from '../../src/main/bubble';
import {SecondaryBehavior} from '../../src/shared/secondaryBehavior';
import {Behavior} from '../../src/renderer/character/behavior';
let bubble:BuddyBubble;
beforeEach(()=>{vi.useFakeTimers();vi.setSystemTime(100000);bubble=new BuddyBubble({anchor:()=>({x:500,y:400,width:200,height:300}),enabled:()=>true,preload:'',log:{} as any});});
afterEach(()=>{bubble.close();vi.useRealTimers();});
it('keeps each displayed line on its original expiry, fades it, and compacts the remaining stack',()=>{
  bubble.remark('First.');vi.advanceTimersByTime(8000);bubble.remark('Second.');
  expect(bubble.state.previous?.map(p=>p.text)).toEqual(['First.']);
  vi.advanceTimersByTime(2000);expect(bubble.state.previous?.[0].fading).toBe(true);
  vi.advanceTimersByTime(230);expect(bubble.state.previous).toEqual([]);expect(bubble.state.text).toBe('Second.');
  vi.advanceTimersByTime(8000);expect(bubble.hasVisibleText).toBe(false);
});
it('pauses expiry while hovered, including a new line arriving during hover',()=>{
  bubble.remark('First.');vi.advanceTimersByTime(5000);bubble.hover(true);vi.advanceTimersByTime(20000);
  bubble.remark('Second.');vi.advanceTimersByTime(20000);expect(bubble.state.previous).toHaveLength(1);expect(bubble.hasVisibleText).toBe(true);
  bubble.hover(false);vi.advanceTimersByTime(5230);expect(bubble.state.previous).toHaveLength(0);expect(bubble.hasVisibleText).toBe(true);
  vi.advanceTimersByTime(5000);expect(bubble.hasVisibleText).toBe(false);
});
it('collapses an unattended composer, protects hover and unsent drafts, then fades normally',()=>{
  bubble.remark('Hello.');bubble.open();bubble.hover(true);vi.advanceTimersByTime(10000);expect(bubble.state.composer).toBe(true);
  bubble.draft(true);bubble.hover(false);vi.advanceTimersByTime(5000);expect(bubble.state.composer).toBe(true);
  bubble.draft(false);vi.advanceTimersByTime(4000);expect(bubble.state.composer).toBe(false);expect(bubble.state.delivery).toBe('aside');
  vi.advanceTimersByTime(10230);expect(bubble.hasVisibleText).toBe(false);
});
it('holds a supported long recline across fifteen minutes but releases it for sleep or movement',()=>{
  const b=new SecondaryBehavior(),input={enabled:true,blocked:false,support:{sit:true,lie:true,kind:'taskbar' as const,sustainedRest:true},inverted:false,hovering:false,inspectingBelow:false,patting:false};
  for(let second=0;second<900;second++)expect(b.update(1,input).pose).toBe('recline');
  expect(b.update(1,{...input,blocked:true}).pose).toBeNull();
});
it('honors the configured sleep threshold and returns on user activity',()=>{
  const b=new Behavior(()=>.9),input={phase:'idle' as const,speechLevel:0,speaking:false,pointer:null,idleSec:0,sleepAfterSec:600,quiet:true,intensity:0};
  b.update(.1,{...input,idleSec:599});expect(b.state).not.toBe('sleeping');
  b.update(.1,{...input,idleSec:600});expect(b.state).toBe('sleeping');
  b.update(.1,input);expect(b.state).toBe('returning');
  b.update(2,input);expect(b.state).toBe('idle');
});
