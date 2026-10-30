import fs from 'node:fs';
import path from 'node:path';
import {expect,it} from 'vitest';
import {InteractionProfile} from '../../src/main/store/interactionProfile';
import {noonDay,nextNoon,usagePatterns,type UsageDay} from '../../src/shared/activityPatterns';
import {tmpDir} from './helpers';

const day=(key:string,last=960):UsageDay=>({day:key,first:540,last,endConfirmed:true,active:18000,idle:5400,observed:32400,hours:Array.from({length:24},(_,h)=>h<4?1800:0),sessions:[{start:1,end:5400001,active:3000,complete:true}],breaks:[{hour:23,seconds:900}]});
it('uses local noon boundaries including a DST-length day, and derives evidence-qualified 7/30-day patterns',()=>{
 const before=new Date(2026,9,30,11,59).getTime(),after=new Date(2026,9,30,12).getTime();
 expect(noonDay(before)).toBe('2026-10-29');expect(noonDay(after)).toBe('2026-10-30');expect(nextNoon(before)).toBe(after);
 const dst=new Date(2026,10,1,1).getTime();expect(new Date(nextNoon(dst)).getHours()).toBe(12);
 const now=new Date(2026,9,30,14).getTime(),days=Array.from({length:30},(_,n)=>day(noonDay(now,-n-1),n===0?780:960));
 const summary=usagePatterns(days,now,true,60);expect(summary.week).toMatchObject({days:7,typicalFirst:'21:00',typicalLast:'04:00',sessionMinutes:90,lateNightDays:7,recurringBreak:{hour:'23:00',days:7,minutes:15}});expect(summary.month.days).toBe(30);expect(summary.change).toContain('earlier');
 expect(usagePatterns(days.map(d=>({...d,endConfirmed:false,observed:1800})),now,true,60).week.typicalLast).toBeUndefined();
});
it('counts only continuous observed input windows, closes actual idle periods, and never backfills restart or suspend gaps',()=>{
 const dir=tmpDir();let now=new Date(2026,9,29,23).getTime();
 const make=()=>new InteractionProfile(dir,()=>false,()=>90,()=>now,()=>true,()=>60);let p=make();
 const step=(seconds:number,idle:(n:number)=>number)=>{for(let n=1;n<=seconds;n++){now+=1000;p.observeActivity(idle(n));}};
 p.observeActivity(0);step(120,()=>0);step(301,n=>n);
 expect(p.activitySummary().daysObserved).toBe(1);p.flush();
 const saved=()=>JSON.parse(fs.readFileSync(path.join(dir,'activity-usage.json'),'utf8'));
 expect(saved().days[0]).toMatchObject({endConfirmed:true});expect(saved().days[0].active).toBeLessThan(181);
 p.observeActivity(0);step(120,()=>0);p.pauseActivity('suspend');const active=saved().days[0].active;
 now+=12*3600000;p=make();p.observeActivity(0);p.flush();expect(saved().days.reduce((n:number,d:UsageDay)=>n+d.active,0)).toBe(active);
 now+=600000;p.observeActivity(0);p.flush();expect(saved().days.reduce((n:number,d:UsageDay)=>n+d.active,0)).toBe(active);
 expect(JSON.stringify(saved())).not.toMatch(/window|title|process|keystroke|sleep/);
});
it('provides compact context selectively, honors retention and deletes timing history independently of old companion patterns',()=>{
 const dir=tmpDir(),now=new Date(2026,9,30,14).getTime();let enabled=true,retain=60;
 fs.writeFileSync(path.join(dir,'activity-usage.json'),JSON.stringify({version:1,days:Array.from({length:60},(_,n)=>day(noonDay(now,-n-1)))}));
 const p=new InteractionProfile(dir,()=>true,()=>90,()=>now,()=>enabled,()=>retain);
 expect(p.activitySummary().daysObserved).toBe(59);expect(p.activityContext('')).toContain('OBSERVED PC ROUTINE');expect(p.activityContext('')).toBe('');expect(p.activityContext('What are my late-night habits?').length).toBeLessThan(1300);
 retain=30;p.privacyChanged();expect(p.activitySummary().daysObserved).toBe(29);
 p.touch('pat');p.flush();enabled=false;p.privacyChanged();expect(fs.existsSync(path.join(dir,'activity-usage.json'))).toBe(false);expect(p.activityContext('my routine')).toBe('');expect(p.summary().interactions.pat).toBe(1);
 enabled=true;expect(p.activitySummary().daysObserved).toBe(0);
});
