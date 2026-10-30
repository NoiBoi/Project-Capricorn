import {createHash} from 'node:crypto';
import type {CommunicationSettings} from '../../shared/communications';
import {cleanEvidence} from '../../shared/lifeContext';
import type {LifeContext} from './context';
import {providerJSON,ProviderError} from './network';
export interface CommunicationCheckpoint {cursor:string;lastSync?:number;links:Record<string,string>;records:Record<string,{hash:string;revision:number;at:number;providerId?:string;channel?:string}>}
export const emptyCommunication=():CommunicationCheckpoint=>({cursor:'',links:{},records:{}});
export class CheckpointExpired extends Error {}
export const fingerprint=(data:unknown)=>createHash('sha256').update(JSON.stringify(data)).digest('hex');
export function plainMessage(value:string){return cleanEvidence(value.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi,'').replace(/<[^>]*>/g,' ').replace(/&nbsp;/g,' ').replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>'),1400);}
export function significance(subject:string,sender:string){
 const address=(sender.match(/<([^<>]+)>/)?.[1]??sender).trim().toLowerCase(),domain=address.split('@').at(-1);
 const academic=!!address.includes('@')&&(domain==='gradescope.com'||!!domain?.endsWith('.gradescope.com'));
 const kind=academic?/grade|feedback/i.test(subject)?'academic-grade-notice':/submitt|submission.*receiv/i.test(subject)?'academic-submission-notice':/due|deadline|extend/i.test(subject)?'academic-deadline-notice':'academic-assignment-notice':/cancel|reschedul|time.*chang/i.test(subject)?'schedule-change-claim':/deadline|due|extension/i.test(subject)?'deadline-claim':/interview|recruit|offer|application.*updat/i.test(subject)?'recruiting-update':/please|request|action required|assignment|review|research|project/i.test(subject)?'request-claim':'communication';
 return{kind,importance:kind==='communication'?.3:.62};
}
function metadataAllowed(a:CommunicationSettings,subject:string,sender:string){const text=subject.toLowerCase(),from=sender.toLowerCase();return !a.excludedSenders.some(v=>from.includes(v.toLowerCase()))&&!a.excludedWords.some(v=>text.includes(v.toLowerCase()))&&(!a.senders.length||a.senders.some(v=>from.includes(v.toLowerCase())));}
export class CommunicationAdapter {
 constructor(private ledger:LifeContext,private fetcher:typeof fetch=fetch){}
 private publish(a:CommunicationSettings,cp:CommunicationCheckpoint,id:string,data:{thread:string;subject:string;sender:string;at:number;text?:string;deleted?:boolean;providerRevision?:string;receivedAt?:number},initial:boolean){
  const s=this.ledger.source(a.id)!;const now=Date.now(),key=fingerprint(id),prior=cp.records[key];
  const at=Number.isFinite(data.at)?data.at:now;if(!data.deleted&&(at>now+60000||now-at>s.retentionDays*86400000))return;
  const sender=data.sender.toLowerCase(),combined=(data.subject+' '+(data.text??'')).toLowerCase();
  const excluded=a.excludedSenders.some(x=>sender.includes(x.toLowerCase()))||a.excludedWords.some(x=>combined.includes(x.toLowerCase()))||a.senders.length&&!a.senders.some(x=>sender.includes(x.toLowerCase()));
  const deleted=!!data.deleted||!!excluded||a.excludedRecords.includes(key);if(deleted&&!prior)return;
  const content=s.permissions.content?plainMessage(data.text??''):'';
  const normalized={thread:data.thread,subject:cleanEvidence(data.subject,300),sender:cleanEvidence(data.sender,160),at,text:content,deleted};
  const hash=fingerprint(normalized);if(prior?.hash===hash)return;const revision=Math.max(now,(prior?.revision??0)+1);
  const label=significance(data.subject+' '+content,data.sender);cp.records[key]={hash,revision,at};
  this.ledger.ingest({source:a.id,recordId:key,revision,type:label.kind,occurredAt:at,receivedAt:now,expiresAt:Math.max(at+1000,Math.min(at+s.retentionDays*86400000,now+86400000)),entities:[],quality:'observed',permissions:s.permissions,summary:deleted?'Communication record removed or excluded':cleanEvidence(`${data.sender}: ${data.subject||'(message metadata)'}`,500),detail:JSON.stringify({providerId:id,threadId:data.thread,providerRevision:data.providerRevision,sender:normalized.sender,at,messageReceivedAt:data.receivedAt,selectedContent:content,meaning:'Source-attributed communication claims. Not proof of completion, attendance, submission or a verified grade. Newer explicit updates can supersede older claims.'}).slice(0,2500),operation:deleted?'delete':prior?'correct':'upsert',importance:initial?.25:label.importance});
 }
 async gmail(a:CommunicationSettings,token:string,cp:CommunicationCheckpoint,signal:AbortSignal,active:()=>boolean){
  const get=(route:string,args:Record<string,string>={})=>{const u=new URL('https://gmail.googleapis.com/gmail/v1/users/me/'+route);u.search=new URLSearchParams(args).toString();return providerJSON(u.href,{signal,headers:{authorization:'Bearer '+token}},this.fetcher);};
  const initial=!cp.cursor,ids=new Set<string>(),deleted=new Set<string>();let cursor=cp.cursor,page='';
  if(initial){const profile=await get('profile');cursor=String(profile.historyId??'');for(const label of a.labels){const d=await get('messages',{maxResults:'100',labelIds:label});for(const m of d.messages??[])if(typeof m.id==='string')ids.add(m.id);cp.links['backfill:'+label]=d.nextPageToken??'';}}

  else{for(let n=0;n<10;n++){let d:any;try{d=await get('history',{startHistoryId:cp.cursor,maxResults:'100',...(page?{pageToken:page}:{})});}catch(e){if(e instanceof ProviderError&&e.status===404){cp.cursor='';throw new CheckpointExpired('Gmail history checkpoint expired. Next sync performs a bounded rescan.');}throw e;}
    for(const h of d.history??[]){for(const m of h.messages??[])if(m.id)ids.add(m.id);for(const name of ['messagesAdded','labelsAdded','labelsRemoved'])for(const m of h[name]??[])if(m.message?.id)ids.add(m.message.id);for(const m of h.messagesDeleted??[])if(m.message?.id)deleted.add(m.message.id);}cursor=String(d.historyId??cursor);page=d.nextPageToken;if(!page)break;}
    if(page)throw Error('Gmail changes exceed bounded sync. Narrow labels or reconnect to rescan.');}
  if(ids.size>400)throw Error('Too many changed messages in one pass. Narrow labels and reconnect.');
  if(!initial){const pending=Object.entries(cp.links).find(([key,value])=>key.startsWith('backfill:')&&value);if(pending){const [key,pageToken]=pending;const d=await get('messages',{maxResults:'50',labelIds:key.slice(9),pageToken});for(const m of d.messages??[])if(m.id)ids.add(m.id);cp.links[key]=d.nextPageToken??'';}}
  const messages:any[]=[];for(const id of ids){if(deleted.has(id))continue;const u=new URL('https://gmail.googleapis.com/gmail/v1/users/me/messages/'+encodeURIComponent(id));u.search='format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date';let d:any;
   try{d=await providerJSON(u.href,{signal,headers:{authorization:'Bearer '+token}},this.fetcher);}catch(e){if(e instanceof ProviderError&&e.status===404){deleted.add(id);continue;}throw e;}
   if(!(d.labelIds??[]).some((l:string)=>a.labels.includes(l))){deleted.add(id);continue;}
   const header=(name:string)=>String((d.payload?.headers??[]).find((h:any)=>String(h.name).toLowerCase()===name)?.value??'');
   if(this.ledger.source(a.id)?.permissions.content&&a.selectedMessages.includes(id)&&metadataAllowed(a,header('subject'),header('from'))&&!a.excludedRecords.includes(fingerprint(id))){const full=await get('messages/'+encodeURIComponent(id),{format:'full'});let chars=0;const walk=(p:any,depth=0):string=>{if(!p||depth>4||chars>1800)return'';if(p.body?.data&&['text/plain','text/html'].includes(p.mimeType)){const t=Buffer.from(String(p.body.data).slice(0,12000),'base64url').toString('utf8');chars+=t.length;return plainMessage(t);}return(p.parts??[]).slice(0,10).map((x:any)=>walk(x,depth+1)).join(' ');};d.selectedText=walk(full.payload);}
   messages.push(d);
  }
  if(!active()||signal.aborted)return;
  for(const id of deleted)this.publish(a,cp,id,{thread:'',subject:'',sender:'',at:Date.now(),deleted:true},initial);
  for(const m of messages){const header=(name:string)=>String((m.payload?.headers??[]).find((h:any)=>String(h.name).toLowerCase()===name)?.value??'');this.publish(a,cp,m.id,{thread:m.threadId??m.id,subject:header('subject'),sender:header('from'),at:Number(m.internalDate),text:m.selectedText,providerRevision:m.historyId},initial);}
  cp.cursor=cursor;
 }
 async graph(a:CommunicationSettings,token:string,cp:CommunicationCheckpoint,signal:AbortSignal,active:()=>boolean){
  const headers={authorization:'Bearer '+token,Prefer:'IdType="ImmutableId"'};
  const get=(url:string)=>{const u=new URL(url,'https://graph.microsoft.com/v1.0/');if(u.origin!=='https://graph.microsoft.com'||!u.pathname.startsWith('/v1.0/'))throw Error('Rejected off-provider Graph continuation link');return providerJSON(u.href,{signal,headers},this.fetcher);};
  if(a.id.startsWith('teams')){
   for(const c of [...a.chats.map(id=>({key:'chat:'+id,url:`https://graph.microsoft.com/v1.0/chats/${encodeURIComponent(id)}/messages?$top=50&$orderby=lastModifiedDateTime%20desc`})),...a.channels.map(c=>({key:'channel:'+c.team+':'+c.channel,url:`https://graph.microsoft.com/v1.0/teams/${encodeURIComponent(c.team)}/channels/${encodeURIComponent(c.channel)}/messages?$top=50`}))]){
    let next=cp.links[c.key]||c.url;const rows:any[]=[];for(let page=0;page<4;page++){const d=await get(next);if(!Array.isArray(d.value))throw Error('Invalid Teams message collection.');rows.push(...d.value);next=d['@odata.nextLink'];if(!next)break;}
    if(c.key.startsWith('channel:'))for(const parent of rows.slice(0,5)){const base=c.url.split('?')[0];const d=await get(base+'/'+encodeURIComponent(parent.id)+'/replies?$top=20');for(const reply of d.value??[])rows.push({...reply,replyToId:parent.id});}
    if(!active()||signal.aborted)return;
    // Continue bounded history scans across passes, then rescan latest messages for edits/deletes.
    cp.links[c.key]=next??'';
    for(const m of rows){const at=Date.parse(m.lastModifiedDateTime??m.createdDateTime);this.publish(a,cp,c.key+':'+m.id,{thread:c.key+':'+(m.replyToId??m.id),subject:m.subject??'Selected Teams conversation',sender:m.from?.user?.displayName??m.from?.application?.displayName??'Teams sender',at,text:this.ledger.source(a.id)?.permissions.content?m.body?.content:'',deleted:!!m.deletedDateTime,providerRevision:m.etag??m.lastModifiedDateTime},!cp.cursor);
    }
   }cp.cursor='initialized';return;
  }
  const updates=new Map<string,any>(),removals=new Set<string>(),links={...cp.links};
  for(const folder of a.folders){let next=links[folder]||`https://graph.microsoft.com/v1.0/me/mailFolders/${encodeURIComponent(folder)}/messages/delta?$top=50&$select=id,conversationId,subject,from,receivedDateTime,lastModifiedDateTime&$filter=receivedDateTime%20ge%20${new Date(Date.now()-this.ledger.source(a.id)!.retentionDays*86400000).toISOString()}`;
   let delta='';for(let page=0;page<10;page++){let d:any;try{d=await get(next);}catch(e){if(e instanceof ProviderError&&[410,404].includes(e.status)){cp.links[folder]='';throw new CheckpointExpired('Outlook delta expired or folder missing. Check folder selection; next sync rescans.');}throw e;}
    for(const m of d.value??[]){if(m['@removed'])removals.add(m.id);else updates.set(m.id,m);}next=d['@odata.nextLink'];delta=d['@odata.deltaLink'];if(!next)break;}
   if(next)throw Error('Outlook folder exceeds bounded delta pass. Select a smaller folder.');if(!delta)throw Error('Outlook did not return a delta checkpoint.');links[folder]=delta;
  }
  for(const [id,m] of updates)if(this.ledger.source(a.id)?.permissions.content&&a.selectedMessages.includes(id)&&metadataAllowed(a,m.subject??'',m.from?.emailAddress?.address??'')&&!a.excludedRecords.includes(fingerprint(id))){const d=await get('me/messages/'+encodeURIComponent(id)+'?$select=body');m.selectedText=plainMessage(d.body?.content??'');}
  if(!active()||signal.aborted)return;
  for(const id of removals)if(!updates.has(id))this.publish(a,cp,id,{thread:'',subject:'',sender:'',at:Date.now(),deleted:true},!cp.cursor);
  for(const [id,m] of updates)this.publish(a,cp,id,{thread:m.conversationId??id,subject:m.subject??'',sender:m.from?.emailAddress?.address??'',at:Date.parse(m.lastModifiedDateTime??m.receivedDateTime),receivedAt:Date.parse(m.receivedDateTime),text:m.selectedText,providerRevision:m.lastModifiedDateTime},!cp.cursor);
  cp.links=links;cp.cursor='initialized';
 }
}
