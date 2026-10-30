import http from 'node:http';
import {createHash,randomBytes,timingSafeEqual} from 'node:crypto';
import type {SecretStore} from '../store/secrets';
import type {LifeContext} from './context';
import {cleanEvidence} from '../../shared/lifeContext';
import {providerJSON,ProviderError} from './network';
export const GOOGLE_SCOPES='https://www.googleapis.com/auth/calendar.events.readonly https://www.googleapis.com/auth/calendar.calendarlist.readonly';
export interface CalendarCheckpoint {token?:string;fullAt:number; fingerprints:Record<string,{hash:string;revision:number}>; ids:string[]}
/** Google normally returns RFC3339 with an offset. Date-only boundaries use the calendar zone. */
export function calendarTime(value:{date?:string;dateTime?:string;timeZone?:string},zone='UTC'){
  if(value.dateTime && /(?:Z|[+-]\d\d:\d\d)$/.test(value.dateTime))return Date.parse(value.dateTime);
  const raw=value.date??value.dateTime;if(!raw)return NaN;
  const target=Date.parse(raw+(value.date?'T00:00:00Z':'Z'));if(!Number.isFinite(target))return NaN;
  let result=target;const fmt=new Intl.DateTimeFormat('en-CA',{timeZone:value.timeZone??zone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'});
  for(let i=0;i<3;i++){const p=Object.fromEntries(fmt.formatToParts(result).map(p=>[p.type,p.value]));const local=Date.parse(`${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}Z`);result+=target-local;}return result;
}
export class GoogleCalendar {
  private auth?:http.Server;private authTimer?:NodeJS.Timeout;private epoch=0;
  constructor(private secrets:SecretStore,private ledger:LifeContext,private fetcher:typeof fetch=fetch){}
  stop(){this.epoch++;if(this.authTimer)clearTimeout(this.authTimer);this.auth?.closeAllConnections();this.auth?.close();this.auth=undefined;}
  async authorize(open:(url:string)=>Promise<unknown>,done:()=>void){
    this.stop();const epoch=this.epoch,client=this.secrets.get('googleClient');if(!client)throw Error('Save a Google Desktop OAuth client ID first.');
    const verifier=randomBytes(48).toString('base64url'), state=randomBytes(32).toString('base64url');
    const server=this.auth=http.createServer(async(req,res)=>{
      const u=new URL(req.url??'/', 'http://127.0.0.1');
      if(u.pathname!=='/oauth2callback'){res.writeHead(404).end();return;}
      const received=Buffer.from(u.searchParams.get('state')??''), expected=Buffer.from(state);
      if(received.length!==expected.length||!timingSafeEqual(received,expected)){res.writeHead(403).end('Invalid authorization state');return;}
      if(!u.searchParams.get('code')){res.end('Authorization declined. Return to Capri.');this.stop();this.ledger.setHealth('calendar',{state:'waiting',detail:'Google authorization was declined. Try Authorize Google again.'});return;}
      try{
        const tokens=await providerJSON('https://oauth2.googleapis.com/token',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:client,client_secret:this.secrets.get('googleClientSecret')??'',code:u.searchParams.get('code')!,code_verifier:verifier,grant_type:'authorization_code',redirect_uri:redirect})},this.fetcher);
        if(epoch!==this.epoch)throw Error('Authorization cancelled');
        const granted=String(tokens.scope??'').split(' ');if(!GOOGLE_SCOPES.split(' ').every(s=>granted.includes(s)))throw Error('Both read-only Calendar permissions are required.');
        if(!tokens.refresh_token)throw Error('No refresh token returned. Reauthorize with consent.');
        this.secrets.set('googleRefresh',tokens.refresh_token);res.end('Calendar authorized. Return to Capri and select calendars.');this.stop();done();
      }catch{res.writeHead(400).end('Authorization did not complete. Return to Capri and retry.');this.stop();this.ledger.setHealth('calendar',{state:'error',detail:'Google token exchange failed. Check Desktop client configuration and authorize again.',lastFailure:Date.now()});}
    });
    server.maxConnections=4;server.requestTimeout=10000;server.headersTimeout=10000;
    await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
    const redirect=`http://127.0.0.1:${(server.address() as any).port}/oauth2callback`;
    this.authTimer=setTimeout(()=>{this.stop();this.ledger.setHealth('calendar',{state:'waiting',detail:'Authorization timed out. Click Authorize Google to retry.'});},180000);this.authTimer.unref();
    const url=new URL('https://accounts.google.com/o/oauth2/v2/auth');url.search=new URLSearchParams({client_id:client,redirect_uri:redirect,response_type:'code',scope:GOOGLE_SCOPES,access_type:'offline',prompt:'consent',state,code_challenge:createHash('sha256').update(verifier).digest('base64url'),code_challenge_method:'S256'}).toString();
    try{await open(url.href);}catch(e){this.stop();throw e;}
  }
  async token(signal:AbortSignal){
    const refresh=this.secrets.get('googleRefresh');if(!refresh)throw Error('Authorize Google in Connections.');
    let data:any;try{data=await providerJSON('https://oauth2.googleapis.com/token',{method:'POST',signal,headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:this.secrets.get('googleClient')??'',client_secret:this.secrets.get('googleClientSecret')??'',refresh_token:refresh,grant_type:'refresh_token'})},this.fetcher);}catch(e){if(e instanceof ProviderError&&e.status===400)throw new ProviderError(401);throw e;}
    if(typeof data.access_token!=='string')throw Error('Google refresh rejected. Authorize again.');return data.access_token as string;
  }
  async list(signal:AbortSignal){const token=await this.token(signal);const list:{id:string;name:string}[]=[];let page='';for(let i=0;i<5;i++) {const u=new URL('https://www.googleapis.com/calendar/v3/users/me/calendarList');u.search=new URLSearchParams({maxResults:'250',...(page?{pageToken:page}:{})}).toString();const data=await providerJSON(u.href,{signal,headers:{authorization:'Bearer '+token}},this.fetcher);for(const c of data.items??[])if(typeof c.id==='string')list.push({id:c.id,name:cleanEvidence(c.summary??c.id,100)});page=data.nextPageToken;if(!page)return list;}throw Error('Calendar list exceeds supported limit.');}
  async sync(ids:string[],checkpoints:Record<string,CalendarCheckpoint>,signal:AbortSignal,active:()=>boolean){
    const token=await this.token(signal),now=Date.now(), source=this.ledger.source('calendar')!;
    for(const id of ids){
      let cp=checkpoints[id]??{fullAt:0,fingerprints:{},ids:[]};let full=!cp.token||now-cp.fullAt>86400000;
      const items:any[]=[];let page='',next='',calendarZone='UTC';
      for(let n=0;n<20;n++){
        const u=new URL(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(id)}/events`);
        u.search=new URLSearchParams({maxResults:'250',singleEvents:'true',showDeleted:'true',...(full?{timeMin:new Date(now-7*86400000).toISOString(),timeMax:new Date(now+30*86400000).toISOString()}:{syncToken:cp.token!}),...(page?{pageToken:page}:{})}).toString();
        let data:any;try{data=await providerJSON(u.href,{signal,headers:{authorization:'Bearer '+token}},this.fetcher);}catch(e){if(e instanceof ProviderError&&e.status===410&&!full){full=true;page='';items.length=0;n=-1;continue;}throw e;}
        if(typeof data.timeZone==='string')calendarZone=data.timeZone;items.push(...data.items??[]);page=data.nextPageToken;next=data.nextSyncToken;if(!page)break;
      }
      if(page||items.length>2500)throw Error('Calendar sync exceeds bounded capacity. Select fewer/smaller calendars.');
      if(!active()||signal.aborted)return;
      const seen=new Set<string>();const fingerprints={...cp.fingerprints};
      for(const item of items){
        if(typeof item.id!=='string')continue;const recordId=createHash('sha256').update(id+'\0'+item.id).digest('hex');seen.add(recordId);
        const hash=createHash('sha256').update(JSON.stringify(item)).digest('hex'), prior=fingerprints[recordId];if(prior?.hash===hash)continue;
        const revision=Math.max(now,(prior?.revision??0)+1);fingerprints[recordId]={hash,revision};
        const cancel=item.status==='cancelled',start=calendarTime(item.start??{},item.start?.timeZone??calendarZone),end=calendarTime(item.end??{},item.end?.timeZone??item.start?.timeZone??calendarZone);
        if(!cancel&&(!Number.isFinite(start)||!Number.isFinite(end)||end<start))continue;
        const detail=JSON.stringify({providerId:item.id,calendarId:id,etag:item.etag,recurringEventId:item.recurringEventId,originalStartTime:item.originalStartTime,start:item.start,end:item.end,startAt:start,endAt:end,attendance:'Scheduled only; attendance and outcomes unknown',...(source.permissions.content?{description:cleanEvidence(item.description??'',500),location:cleanEvidence(item.location??'',150)}:{})});
        this.ledger.ingest({source:'calendar',recordId,revision,type:cancel?'calendar-cancelled':'calendar-scheduled',occurredAt:now,receivedAt:now,expiresAt:cancel?now+86400000:Math.max(now+1000,Math.min(now+31*86400000,end+86400000)),entities:[],quality:'observed',permissions:source.permissions,summary:cleanEvidence(`${cancel?'Cancelled':prior?'Schedule changed':'Scheduled'}: ${item.summary??'(untitled event)'}`,500),detail:detail.slice(0,2500),operation:cancel?'delete':prior?'correct':'upsert',importance:prior&&!cancel? .65:.4});
      }
      if(full)for(const old of cp.ids)if(!seen.has(old)){const prior=fingerprints[old];if(prior)this.ledger.ingest({source:'calendar',recordId:old,revision:prior.revision=Math.max(now,prior.revision+1),type:'calendar-removed',occurredAt:now,receivedAt:now,expiresAt:now+86400000,entities:[],quality:'observed',permissions:source.permissions,summary:'Calendar record left monitored schedule window',detail:'Not evidence of attendance.',operation:'delete',importance:0});}
      checkpoints[id]={token:next,fullAt:full?now:cp.fullAt,fingerprints:Object.fromEntries(Object.entries(fingerprints).slice(-3000)),ids:[...new Set(full?[...seen]:[...cp.ids,...seen])].slice(-2500)};
    }
  }
}
