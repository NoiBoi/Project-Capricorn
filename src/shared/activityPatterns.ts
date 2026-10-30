/** Timing aggregates only. No application identity, titles or content. */
export interface UsageSession { start:number; end:number; active:number; complete:boolean }
export interface UsageDay {
  day:string; first?:number; last?:number; endConfirmed:boolean;
  active:number; idle:number; observed:number; hours:number[];
  sessions:UsageSession[]; breaks:{hour:number;seconds:number}[];
}
export interface UsageWindow {
  days:number; endpointDays:number; typicalFirst?:string; typicalLast?:string;
  activeHours?:number; sessionMinutes?:number; lateNightDays?:number;
  recurringBreak?:{hour:string;days:number;minutes:number};
}
export interface ActivitySummary { enabled:boolean; daysObserved:number; retentionDays:number; week:UsageWindow; month:UsageWindow; change?:string }
export const noonMinute=(at:number)=>{const d=new Date(at);return (d.getHours()+12)%24*60+d.getMinutes();};
export function noonDay(at:number,offset=0){
  const d=new Date(at);if(d.getHours()<12)d.setDate(d.getDate()-1);d.setDate(d.getDate()+offset);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
export function nextNoon(at:number){const d=new Date(at);d.setHours(12,0,0,0);if(d.getTime()<=at)d.setDate(d.getDate()+1);return d.getTime();}
const median=(values:number[])=>{const v=values.toSorted((a,b)=>a-b);return v.length?v[Math.floor(v.length/2)]:undefined;};
const clock=(minute:number)=>{const rounded=Math.round(minute/30)*30,hour=(Math.floor(rounded/60)+12)%24;return `${String(hour).padStart(2,'0')}:${rounded%60?'30':'00'}`;};
export function usagePatterns(days:UsageDay[],now:number,enabled:boolean,retentionDays:number):ActivitySummary {
  const today=noonDay(now);
  const window=(length:number):UsageWindow=>{
    // The current day is incomplete. Sparse/app-start-only days cannot establish
    // an end-of-day routine. These remain observed endpoints, never bedtimes.
    const observed=days.filter(d=>d.day>=noonDay(now,-length)&&d.day<today&&d.observed>=7200&&d.active>=600);
    const endpoints=observed.filter(d=>d.endConfirmed&&d.first!==undefined&&d.last!==undefined);
    const result:UsageWindow={days:observed.length,endpointDays:endpoints.length};
    if(observed.length<3)return result;
    result.activeHours=Math.round((median(observed.map(d=>d.active))??0)/360)/10;
    const sessions=observed.flatMap(d=>d.sessions).filter(s=>s.complete&&s.end>s.start&&s.end-s.start<=18*3600000);
    if(sessions.length>=3)result.sessionMinutes=Math.round((median(sessions.map(s=>(s.end-s.start)/60000))??0)/5)*5;
    result.lateNightDays=observed.filter(d=>d.hours.slice(0,5).reduce((a,b)=>a+b,0)>=600).length;
    if(endpoints.length>=3){result.typicalFirst=clock(median(endpoints.map(d=>d.first!))!);result.typicalLast=clock(median(endpoints.map(d=>d.last!))!);}
    const breaks=Array.from({length:24},(_,hour)=>({hour,days:observed.filter(d=>d.breaks.some(b=>b.hour===hour&&b.seconds>=300&&b.seconds<=10800)).length})).sort((a,b)=>b.days-a.days);
    const repeated=breaks[0];
    if(repeated.days>=3&&repeated.days/observed.length>=.5)result.recurringBreak={hour:`${String(repeated.hour).padStart(2,'0')}:00`,days:repeated.days,minutes:Math.round((median(observed.flatMap(d=>d.breaks.filter(b=>b.hour===repeated.hour).map(b=>b.seconds/60)))??0)/5)*5};
    return result;
  };
  const week=window(7),month=window(30),result:ActivitySummary={enabled,daysObserved:days.filter(d=>d.active>0).length,retentionDays,week,month};
  const baseline=days.filter(d=>d.day>=noonDay(now,-31)&&d.day<noonDay(now,-1)&&d.endConfirmed&&d.observed>=7200&&d.active>=600&&d.last!==undefined);
  const yesterday=days.find(d=>d.day===noonDay(now,-1));
  if(baseline.length>=5&&yesterday?.endConfirmed&&yesterday.last!==undefined&&yesterday.observed>=7200&&yesterday.active>=600){
    const ends=baseline.map(d=>d.last!),typical=median(ends)!,spread=median(ends.map(x=>Math.abs(x-typical)))!;
    if(Math.abs(yesterday.last-typical)>=Math.max(90,spread*3))result.change=`The previous noon-to-noon day's last observed input was substantially ${yesterday.last<typical?'earlier':'later'} than the adequately observed baseline. This establishes a change in observed PC activity only.`;
  }
  return result;
}
