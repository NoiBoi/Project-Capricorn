import { expect, it, vi } from 'vitest';
import { MovementIntent, PhysicalBehavior, type PhysicalEnvironment } from '../../src/main/desktop/physicalBehavior';
import { physicalRestDestination } from '../../src/main/desktop/physicalGeometry';
import { SEAT_RATIO } from '../../src/shared/framing';

function rig() {
  let now=100, blocked:string|null=null, active='1', valid=true;
  const host:PhysicalEnvironment={blocked:()=>blocked,busy:()=>false,targetValid:()=>valid,active:()=>active,
    execute:vi.fn(async()=>({ok:true,detail:'Native fixture reached target'})),cancel:vi.fn(),posture:vi.fn(),ambient:vi.fn()};
  const body=new PhysicalBehavior(host,()=>now,()=>.2);
  const request=(value:unknown)=>body.request(MovementIntent.parse(value),new AbortController().signal);
  return {body,host,request,advance:(ms:number)=>{now+=ms;},block:(reason:string|null)=>{blocked=reason;},focus:(id:string)=>{active=id;},lose:()=>{valid=false;}};
}
it('runs varied local physical activity without any inference dependency or native wandering',async()=>{
  const r=rig();for(let i=0;i<5;i++){await r.body.tick();r.advance(40000);}
  expect(r.host.ambient).toHaveBeenCalledTimes(5);expect(new Set(vi.mocked(r.host.ambient).mock.calls.map(c=>c[0])).size).toBe(4);
  expect(r.host.execute).not.toHaveBeenCalled();
});
it.each(['fullscreen','gaming','sleep','quiet','dragging','recovery','stay commitment','focus commitment','desktop unavailable'])('suppresses local motion and model placement while %s',async reason=>{
  const r=rig();r.block(reason);await r.body.tick();expect(await r.request({target:'perch'})).toMatchObject({ok:false,detail:reason});
  expect(r.host.execute).not.toHaveBeenCalled();expect(r.host.ambient).not.toHaveBeenCalled();
});
it.each(['User-pinned position','Movement permission denied'])('allows in-place maintenance while relocation is blocked by %s',async reason=>{
  const r=rig();r.host.blocked=effect=>effect==='expression'?null:reason;r.host.obstructed=()=>true;
  await r.body.tick();expect(await r.request({target:'taskbar'})).toMatchObject({ok:false,detail:reason});
  expect(r.host.ambient).toHaveBeenCalledOnce();expect(r.host.execute).not.toHaveBeenCalled();
});
it('keeps an accompanying intention and debounces rapid focus changes',async()=>{
  const r=rig();await r.request({target:'accompany',posture:'sit'});expect(r.body.snapshot().intention?.resolvedHandle).toBe('1');
  for(const id of ['2','3','2','4']){r.focus(id);r.advance(1000);await r.body.tick();}
  expect(r.host.execute).toHaveBeenCalledTimes(1);
  r.advance(8000);await r.body.tick();expect(r.host.execute).toHaveBeenCalledTimes(2);
  expect(r.body.snapshot().intention?.resolvedHandle).toBe('4');
  r.advance(60000);await r.body.tick();expect(r.host.execute).toHaveBeenCalledTimes(2);
});
it('follows briefly, expires, and cancels a disappeared support',async()=>{
  const r=rig();await r.request({target:'follow_cursor'});r.advance(8000);await r.body.tick();expect(r.host.execute).toHaveBeenCalledTimes(2);
  r.advance(5000);await r.body.tick();expect(r.body.snapshot().intention).toBeNull();expect(r.body.snapshot().last?.detail).toContain('expired');
  await r.request({target:'perch',handle:'1'});r.lose();await r.body.tick();expect(r.body.snapshot().last?.detail).toContain('disappeared');
});
it('does not report a cancelled native dispatch as completed or apply its final posture',async()=>{
  const r=rig();let finish!:(v:{ok:boolean;detail:string})=>void;
  vi.mocked(r.host.execute).mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
  const pending=r.request({target:'perch',posture:'lie'});r.body.cancel();finish({ok:true,detail:'Late native result'});
  expect(await pending).toMatchObject({ok:false});expect(r.host.posture).not.toHaveBeenCalled();expect(r.body.snapshot().last?.outcome).toBe('cancelled');
});
it('replaces intentions and handles explicit cancellation through the same contract',async()=>{
  const r=rig();await r.request({target:'perch'});const id=r.body.snapshot().intention?.id;
  await r.request({target:'taskbar',posture:'lie',durationMs:60000});expect(r.body.snapshot().intention?.id).not.toBe(id);
  expect(r.host.posture).toHaveBeenLastCalledWith('lie');await r.request({target:'cancel'});expect(r.body.snapshot().intention).toBeNull();
  expect(()=>MovementIntent.parse({target:'perch',x:10})).toThrow();expect(()=>MovementIntent.parse({target:'follow_cursor',durationMs:99999999})).toThrow();
});
it.each([1,1.25,1.5,1.75])('keeps taskbar contact and stable character dimensions on negative monitors at %s DPI',scaleFactor=>{
  const displays=[{id:1,scaleFactor,bounds:{x:-1536,y:-864,width:1536,height:864},workArea:{x:-1536,y:-864,width:1536,height:824}},
    {id:2,scaleFactor:1,bounds:{x:0,y:0,width:1920,height:1080},workArea:{x:0,y:0,width:1920,height:1040}}];
  let current={x:-1200,y:-700,width:237,height:371};
  for(let n=0;n<100;n++)current=physicalRestDestination(current,displays);
  expect(Math.abs(current.y+current.height*SEAT_RATIO-(-40))).toBeLessThanOrEqual(.5);
  expect(current).toMatchObject({width:237,height:371});expect(current.x).toBeLessThan(0);
  const returned=physicalRestDestination(current,[displays[1]],{x:-800,y:-900,width:238,height:372});
  expect(returned.x+returned.width).toBeGreaterThan(0);expect(returned.y).toBeGreaterThan(-current.height*.26);expect(returned).toMatchObject({width:237,height:371});
});
it('cancels a recycled window identity and identifies local safety recovery separately from model intention',async()=>{
  const r=rig();let identity='fixture:1';r.host.targetIdentity=()=>identity;
  await r.request({target:'perch',handle:'1'});identity='other-process:2';await r.body.tick();
  expect(r.body.snapshot().intention).toBeNull();expect(r.body.snapshot().last?.detail).toContain('identity');
  r.host.obstructed=()=>true;r.advance(10000);await r.body.tick();
  expect(r.body.snapshot().intention).toMatchObject({source:'local-safety',target:'away'});
});
