import {execFile} from 'node:child_process';
import {AcademicImport,type Stage3Settings} from '../../shared/communications';
import {cleanEvidence} from '../../shared/lifeContext';
import type {LifeContext} from './context';
import {providerJSON,ProviderError} from './network';
import {fingerprint,plainMessage,significance,type CommunicationCheckpoint} from './communications';
export function discordRunning(signal:AbortSignal):Promise<boolean>{
 if(process.platform!=='win32')return Promise.reject(Error('Discord process detection requires Windows.'));
 return new Promise((resolve,reject)=>execFile('tasklist.exe',['/FI','IMAGENAME eq Discord.exe','/FO','CSV','/NH'],{windowsHide:true,signal,timeout:3000,maxBuffer:32768},(error,stdout)=>error?reject(Error('Windows process query unavailable.')):resolve(/^"Discord\.exe",/im.test(stdout))));
}
export class SocialAcademic {
 constructor(private ledger:LifeContext,private fetcher:typeof fetch=fetch,private excluded:(source:string,record:string)=>boolean=()=>false){}
 local(info:{process:string;title:string}|null,games:string[],now=Date.now()){
  const s=this.ledger.source('discord-local');if(!s?.permissions.collect||s.paused)return;
  const discord=info&&/^discord(?:canary|ptb)?\.exe$/i.test(info.process),game=info&&games.some(g=>g.toLowerCase()===info.process.toLowerCase());
  const prior=this.ledger.latest().find(e=>e.source===s.id&&e.recordId==='foreground');
  if(!discord&&!game){if(prior&&prior.operation!=='delete')this.ledger.ingest({...prior,revision:Math.max(now,prior.revision+1),occurredAt:now,receivedAt:now,expiresAt:now+1000,operation:'delete'});return;}
  const summary=discord?'Discord is foreground':'Configured game application is foreground: '+cleanEvidence(info!.process,80);
  if(prior?.operation!=='delete'&&prior?.summary===summary&&now-prior.receivedAt<30000)return;
  this.ledger.ingest({source:s.id,recordId:'foreground',revision:Math.max(now,(prior?.revision??0)+1),type:game?'local-game-foreground':'discord-foreground',occurredAt:now,receivedAt:now,expiresAt:now+90000,entities:[],quality:'observed',permissions:s.permissions,summary,detail:'Local Windows foreground metadata only. Not account presence, a voice call, actual gameplay or message access. Discord window titles are not collected.',operation:'upsert',importance:.25});
 }
 running(running:boolean){const s=this.ledger.source('discord-local')!,now=Date.now();this.ledger.ingest({source:s.id,recordId:'process',revision:now,type:'discord-process',occurredAt:now,receivedAt:now,expiresAt:now+90000,entities:[],quality:'observed',permissions:s.permissions,summary:running?'Discord process is running':'Discord process was not found',detail:'Process inventory only; not foreground, call status or account activity.',operation:'upsert',importance:0});}
 async bot(config:Stage3Settings,token:string,cp:CommunicationCheckpoint,signal:AbortSignal,active:()=>boolean){
  const get=(route:string)=>providerJSON('https://discord.com/api/v10/'+route,{signal,headers:{authorization:'Bot '+token}},this.fetcher);
  const me=await get('users/@me');if(me.bot!==true)throw Error('Only a legitimate bot credential is accepted.');
  const rows:{id:string;data:any;channel:string}[]=[],progress:Record<string,string>={};
  for(const channel of config.discordChannels){
   let channelInfo:any;try{channelInfo=await get('channels/'+channel);}catch(e){if(e instanceof ProviderError&&e.status===404)throw new ProviderError(403);throw e;}
   if(!channelInfo.guild_id||![0,5,10,11,12].includes(channelInfo.type))throw Error('Only authorized guild text channels and threads are supported. Bot direct messages are excluded.');
   // Re-read a bounded recent window to detect edits. Sequential snowflakes retain historical scan progress.
   const latest=await get(`channels/${channel}/messages?limit=50`);if(!Array.isArray(latest))throw Error('Discord returned an invalid message collection.');
   for(const m of latest)if(/^\d{17,22}$/.test(m.id))rows.push({id:channel+':'+m.id,data:m,channel});
   const cursor=cp.links[channel];if(cursor){const old=await get(`channels/${channel}/messages?limit=50&after=${encodeURIComponent(cursor)}`);for(const m of old)if(/^\d{17,22}$/.test(m.id)){rows.push({id:channel+':'+m.id,data:m,channel});if(!progress[channel]||BigInt(m.id)>BigInt(progress[channel]))progress[channel]=m.id;}}
  }
  let voice:any;let voiceAbsent=false;
  if(config.voiceGuild&&config.voiceUser)try{voice=await get(`guilds/${config.voiceGuild}/voice-states/${config.voiceUser}`);}catch(e){if(e instanceof ProviderError&&e.status===404)voiceAbsent=true;else throw e;}
  if(!active()||signal.aborted)return;
  const s=this.ledger.source('discord-bot')!,now=Date.now();
  for(const {id,data:m,channel} of rows){if(config.discordExcludedAuthors.includes(m.author?.id))continue;const at=Date.parse(m.edited_timestamp??m.timestamp);if(!Number.isFinite(at)||now-at>s.retentionDays*86400000)continue;
   const normalized={author:cleanEvidence(m.author?.username??'Discord author',100),text:s.permissions.content?plainMessage(m.content??''):'',at};const key=fingerprint(id),hash=fingerprint(normalized),old=cp.records[key];
   if(this.excluded(s.id,key)||old?.hash===hash)continue;const revision=Math.max(now,(old?.revision??0)+1);cp.records[key]={hash,revision,at,providerId:m.id,channel};
   this.ledger.ingest({source:s.id,recordId:key,revision,type:'discord-channel-message',occurredAt:at,receivedAt:now,expiresAt:at+s.retentionDays*86400000,entities:[],quality:'observed',permissions:s.permissions,summary:`Selected Discord channel message from ${normalized.author}`,detail:JSON.stringify({providerId:m.id,channelId:channel,selectedContent:normalized.text,meaning:'Third-party message claim, not user completion. Content may be empty when Message Content access is unavailable. Never automatically learn third-party messages.'}),operation:old?'correct':'upsert',importance:cp.cursor&&normalized.text?significance(normalized.text,normalized.author).importance:.25});
   // Store earliest outstanding point, not newest, so bursts cannot skip >50 messages.
   if(!cp.links[channel]&&(!progress[channel]||BigInt(m.id)>BigInt(progress[channel])))progress[channel]=m.id;
  }
  for(const [channel,cursor]of Object.entries(progress))cp.links[channel]=cursor;
  // A missing message in a recent window is not deletion proof. Audit five older retained IDs per pass.
  const candidates=Object.entries(cp.records).filter(([,r])=>r.providerId&&r.channel&&config.discordChannels.includes(r.channel)&&!rows.some(m=>m.data.id===r.providerId&&m.channel===r.channel));
  const audit=Number(cp.links['_audit']??0)||0;
  for(let n=0;n<Math.min(5,candidates.length);n++){const [key,r]=candidates[(audit+n)%candidates.length];try{await get(`channels/${r.channel}/messages/${r.providerId}`);}catch(e){if(e instanceof ProviderError&&e.status===404){if(!active()||signal.aborted)return;const revision=Math.max(Date.now(),r.revision+1);cp.records[key]={...r,hash:'deleted',revision};this.ledger.ingest({source:s.id,recordId:key,revision,type:'discord-message-removed',occurredAt:Date.now(),receivedAt:Date.now(),expiresAt:Date.now()+1000,entities:[],quality:'observed',permissions:s.permissions,summary:'Selected Discord message is no longer available',detail:'Verified missing through the authorized message endpoint.',operation:'delete',importance:0});}else throw e;}}
  cp.links['_audit']=String(audit+5);
  const oldVoice=this.ledger.latest().find(e=>e.source===s.id&&e.recordId==='voice-membership'&&e.operation!=='delete');
  if(voice?.channel_id||oldVoice&&(voice||voiceAbsent))this.ledger.ingest({source:s.id,recordId:'voice-membership',revision:Math.max(now,(oldVoice?.revision??0)+1),type:'discord-guild-voice',occurredAt:now,receivedAt:now,expiresAt:now+120000,entities:[],quality:'observed',permissions:s.permissions,summary:voice?.channel_id?'Configured user is connected to an authorized guild voice channel':'No voice connection reported in the selected guild',detail:JSON.stringify({guildId:config.voiceGuild,userId:config.voiceUser,channelId:voice?.channel_id??null,meaning:'Bot-authorized guild connection metadata only. No speech/audio detection, direct-message calls or account-wide voice status.'}),operation:voice?.channel_id?'upsert':'delete',importance:0});
  cp.cursor='initialized';
 }
 academic(raw:unknown){
  const rows=AcademicImport.parse(raw),source=this.ledger.source('academic');if(!source?.permissions.collect||source.paused)throw Error('Enable Academic imports collection before importing.');let accepted=0;
  for(const r of rows){const now=Date.now(),at=Date.parse(r.at),recordId=fingerprint(r.id),prior=this.ledger.latest().find(e=>e.source==='academic'&&e.recordId===recordId);const detail=JSON.stringify({course:cleanEvidence(r.course,100),assignment:cleanEvidence(r.assignment,150),status:r.status,due:r.due,evidence:source.permissions.content?cleanEvidence(r.evidence,800):'Manual evidence note withheld by content policy',meaning:'Explicitly supplied manual record. No direct Gradescope API access. Assigned, due, submitted, graded and completed are distinct.'});if(this.excluded('academic',recordId)||prior?.detail===detail)continue;
   if(this.ledger.ingest({source:'academic',recordId,revision:Math.max(now,(prior?.revision??0)+1),type:'academic-'+r.status,occurredAt:at,receivedAt:now,expiresAt:Math.max(at+1000,at+source.retentionDays*86400000),entities:r.entities,quality:'user-statement',permissions:source.permissions,summary:cleanEvidence(`${r.course}: ${r.assignment} (${r.status}, manual record)`,400),detail,operation:r.status==='cancelled'?'delete':prior?'correct':'upsert',importance:prior&&r.status==='due'?.65:.3}))accepted++;
  }return accepted;
 }
}
