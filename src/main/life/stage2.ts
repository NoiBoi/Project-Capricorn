import path from 'node:path';
import fs from 'node:fs';
import {randomBytes,createHash} from 'node:crypto';
import {z} from 'zod';
import {Stage2Config,type Stage2Settings,type Stage2View} from '../../shared/lifeContext';
import type {SecretStore} from '../store/secrets';
import type {Settings} from '../../shared/settings';
import {readJson,writeJsonAtomic} from '../store/jsonFile';
import {HonchoMemory,type honchoTransport,type HonchoSource} from '../ai/honchoMemory';
import type {LifeContext} from './context';
import {GoogleCalendar,type CalendarCheckpoint} from './calendar';
import {Lastfm,emptyListening} from './lastfm';
import {OwnTracks,emptyLocation} from './owntracks';
import {ProviderError} from './network';
const sourceKinds={calendar:'calendar',lastfm:'music',owntracks:'location'} as const;
const SavedStage2=z.object({version:z.literal(1),calendar:z.record(z.string().max(256),z.object({token:z.string().max(8192).optional(),fullAt:z.number().finite().nonnegative(),fingerprints:z.record(z.string().max(100),z.object({hash:z.string().max(100),revision:z.number().int().nonnegative()})).refine(v=>Object.keys(v).length<=3000),ids:z.array(z.string().max(100)).max(2500)})).refine(v=>Object.keys(v).length<=12).default({}),lastfm:z.object({cursor:z.number().finite().nonnegative(),backfillTo:z.number().finite().nonnegative().optional(),tracks:z.array(z.object({id:z.string().max(100),artist:z.string().max(120),title:z.string().max(120),at:z.number().finite().nonnegative()})).max(3000),topsAt:z.number().finite().nonnegative(),tops:z.object({artists:z.array(z.string().max(250)).max(8),tracks:z.array(z.string().max(250)).max(8)})}).default(emptyListening()),owntracks:z.object({lastAt:z.number().finite().nonnegative(),seen:z.array(z.object({id:z.string().max(100),at:z.number().finite().nonnegative()})).max(3000),inside:z.record(z.string().max(60),z.object({since:z.number().finite().nonnegative(),last:z.number().finite().nonnegative(),dwell:z.boolean()})).refine(v=>Object.keys(v).length<=30)}).default(emptyLocation())});
export class Stage2 {
  config:Stage2Settings;readonly google:GoogleCalendar;readonly music:Lastfm;readonly receiver:OwnTracks;
  private calendars:{id:string;name:string}[]=[];
  private checkpoints:Record<string,CalendarCheckpoint>={};private listening=emptyListening();private location=emptyLocation();
  private timers=new Map<string,NodeJS.Timeout>();private controllers=new Map<string,AbortController>();private epochs=new Map<string,number>();private failures=new Map<string,number>();private nextAt=new Map<string,number>();
  private learningProviders=new Map<string,()=>HonchoSource[]>();
  registerLearningSource(id:string,provider:()=>HonchoSource[]){this.learningProviders.set(id,provider);}
  private learning=new Map<string,HonchoMemory>();private stopped=true;
  constructor(private dir:string,private ledger:LifeContext,private secrets:SecretStore,private persist:()=>boolean,private enabled:()=>boolean){
    const raw=readJson(path.join(dir,'life-stage2-config.json'),Stage2Config.parse({})).value;this.config=Stage2Config.parse(raw);
    const parsed=SavedStage2.safeParse(readJson<unknown>(path.join(dir,'life-stage2-state.json'),{version:1}).value);if(!parsed.success)throw Error('Unrecognized Stage 2 checkpoints. Existing data preserved.');const saved=parsed.data;
    for(const [id,kind] of Object.entries(sourceKinds))if(!ledger.source(id))ledger.configure({id,kind,name:id==='calendar'?'Google Calendar':id==='lastfm'?'Last.fm':'OwnTracks',paused:false,sites:[],retentionDays:7,permissions:{collect:false,live:false,retain:false,content:false,learn:false}});
    if(this.retained('calendar'))this.checkpoints=saved.calendar??{};
    if(this.retained('lastfm'))this.listening=saved.lastfm??emptyListening();
    if(this.retained('owntracks'))this.location=saved.owntracks??emptyLocation();
    this.google=new GoogleCalendar(secrets,ledger);this.music=new Lastfm(ledger);this.receiver=new OwnTracks(ledger,()=>this.config,()=>secrets.get('owntracksBasic'),this.location,()=>this.save());
  }
  private retained(id:string){return this.persist()&&!!this.ledger.source(id)?.permissions.retain;}
  private active(id:string){const s=this.ledger.source(id);return !this.stopped&&this.enabled()&&!!s?.permissions.collect&&!s.paused;}
  private save(){const now=Date.now();this.location.seen=this.location.seen.filter(e=>now-e.at<(this.ledger.source('owntracks')?.retentionDays??7)*86400000).slice(-3000);this.listening.tracks=this.listening.tracks.filter(t=>now-t.at<(this.ledger.source('lastfm')?.retentionDays??7)*86400000).slice(-3000);for(const [id,v] of Object.entries(this.location.inside))if(now-v.last>86400000)delete this.location.inside[id];this.ledger.flush();writeJsonAtomic(path.join(this.dir,'life-stage2-state.json'),{version:1,calendar:this.retained('calendar')?this.checkpoints:{},lastfm:this.retained('lastfm')?this.listening:emptyListening(),owntracks:this.retained('owntracks')?this.location:emptyLocation()});}
  setup(raw:unknown){const config=Stage2Config.parse(raw);if(new Set(config.places.map(p=>p.id)).size!==config.places.length)throw Error('Place IDs must be unique.');
    const changed:string[]=[];if(JSON.stringify(config.calendars)!==JSON.stringify(this.config.calendars))changed.push('calendar');if(config.lastfmUser!==this.config.lastfmUser)changed.push('lastfm');if(config.device!==this.config.device||JSON.stringify(config.places)!==JSON.stringify(this.config.places))changed.push('owntracks');
    for(const id of changed)this.invalidate(id);this.config=config;writeJsonAtomic(path.join(this.dir,'life-stage2-config.json'),config);void this.start();return this.view();}
  view():Stage2View{return{config:this.config,calendars:this.calendars,credentials:Object.fromEntries(['googleClient','googleClientSecret','googleRefresh','lastfmKey','owntracksBasic'].map(k=>[k,this.secrets.has(k as any)])),receiver:this.receiver.status,recentTracks:this.listening.tracks.slice(-10).reverse().map(({artist,title,at})=>({artist,title,at})),learning:Object.fromEntries([...this.learning].map(([id,m])=>[id,{state:m.status().state,detail:m.status().detail}])),spotifyScrobbling:'Not verifiable through Last.fm API. Check Last.fm Connected Applications and a Spotify scrobble. Current tracks can originate on any connected device.'};}
  credential(key:'googleClient'|'googleClientSecret'|'lastfmKey',value:string){this.invalidate(key.startsWith('google')?'calendar':'lastfm');if(key.startsWith('google')){this.google.stop();this.secrets.delete('googleRefresh');}this.secrets.set(key,value);void this.start();}
  generate(){this.invalidate('owntracks');const username='capri',password=randomBytes(32).toString('base64url');this.secrets.set('owntracksBasic',username+':'+password);void this.start();return{username,password,persistent:this.secrets.persistent};}
  async list(){const ctl=new AbortController(),epoch=this.epochs.get('calendar')??0;this.controllers.get('calendar')?.abort();this.controllers.set('calendar',ctl);try{const list=await this.google.list(ctl.signal);if(ctl.signal.aborted||epoch!==(this.epochs.get('calendar')??0))return this.view();this.calendars=list;}finally{if(this.controllers.get('calendar')===ctl)this.controllers.delete('calendar');}return this.view();}
  authorize(open:(url:string)=>Promise<unknown>){return this.google.authorize(open,()=>{void this.list().then(()=>this.start()).catch(()=>this.ledger.setHealth('calendar',{state:'waiting',detail:'Authorized, but calendar list failed. Click Load calendars to retry.'}));});}
  invalidateLearning(id?:string){if(id&&this.learning.has(id))void this.learning.get(id)!.forget();else if(!id)for(const memory of this.learning.values())void memory.forget();}
  invalidate(id:string,credentials=false){
    this.epochs.set(id,(this.epochs.get(id)??0)+1);this.controllers.get(id)?.abort();this.controllers.delete(id);const t=this.timers.get(id);if(t)clearTimeout(t);this.timers.delete(id);this.nextAt.delete(id);this.failures.delete(id);
    this.ledger.invalidate(id);
    if(id==='calendar'){this.checkpoints={};this.calendars=[];this.google.stop();if(credentials)this.secrets.delete('googleRefresh');}
    if(id==='lastfm'){this.listening=emptyListening();if(credentials)this.secrets.delete('lastfmKey');}
    if(id==='owntracks'){Object.assign(this.location,emptyLocation());this.receiver.stop();if(credentials)this.secrets.delete('owntracksBasic');}
    this.save();
  }
  async start(){this.stopped=false;for(const id of Object.keys(sourceKinds)){if(!this.active(id)){void this.learning.get(id)?.privacyChanged();this.controllers.get(id)?.abort();const t=this.timers.get(id);if(t)clearTimeout(t);this.timers.delete(id);if(id==='owntracks')this.receiver.stop();continue;}if(id==='owntracks'){if(this.receiver.status==='Disabled')await this.receiver.start();}else if(!this.timers.has(id)&&!this.controllers.has(id))void this.sync(id);}}
  async sync(id:string){
    if(!['calendar','lastfm'].includes(id)||!this.active(id)||this.controllers.has(id))return;
    const existing=this.timers.get(id);if(existing)clearTimeout(existing);this.timers.delete(id);
    const remaining=(this.nextAt.get(id)??0)-Date.now();if(remaining>0){this.schedule(id,remaining);return;}
    const epoch=this.epochs.get(id)??0,ctl=new AbortController();this.controllers.set(id,ctl);let delay=id==='calendar'?300000:120000;
    const active=()=>this.active(id)&&epoch===(this.epochs.get(id)??0)&&!ctl.signal.aborted;
    try{
      if(id==='calendar'&&(!this.secrets.has('googleRefresh')||!this.config.calendars.length)){this.ledger.setHealth(id,{state:'waiting',detail:'Authorize Google, load calendars, select at least one and save integration setup.'});return;}
      if(id==='lastfm'&&(!this.secrets.has('lastfmKey')||!this.config.lastfmUser)){this.ledger.setHealth(id,{state:'waiting',detail:'Save a Last.fm API key and username in integration setup.'});return;}
      const lastSync=this.ledger.view().health[id]?.lastSync;this.ledger.setHealth(id,{state:'syncing',detail:'Reading supported provider API',lastSync});
      if(id==='calendar')await this.google.sync(this.config.calendars,this.checkpoints,ctl.signal,active);else await this.music.sync(this.config.lastfmUser,this.secrets.get('lastfmKey')!,this.listening,ctl.signal,active);
      if(!active())return;this.failures.delete(id);this.save();this.ledger.setHealth(id,{state:'healthy',detail:id==='calendar'?'Read-only schedule synchronized. Attendance remains unknown.':'Listening history synchronized. Spotify scrobbling connection is not verified by this API.',lastSync:Date.now()});
    }catch(e){if(!active())return;if(e instanceof ProviderError&&[401,403].includes(e.status)){this.invalidate(id);if(id==='calendar')this.secrets.delete('googleRefresh');this.ledger.setHealth(id,{state:'error',detail:'Authorization or access rejected. Old source context cleared. Check credentials/permissions and authorize again, then Sync now.',lastFailure:Date.now()});return;}const failures=(this.failures.get(id)??0)+1;this.failures.set(id,failures);delay=Math.max(delay,Math.min(3600000,30000*2**Math.min(failures,7)),e instanceof ProviderError?e.retryAfter:0);this.ledger.setHealth(id,{state:'error',detail:e instanceof Error?e.message:'Synchronization failed; will retry',lastFailure:Date.now(),lastSync:this.ledger.view().health[id]?.lastSync});}
    finally{if(this.controllers.get(id)===ctl)this.controllers.delete(id);if(active()){this.nextAt.set(id,Date.now()+delay);this.schedule(id,delay);}}
  }
  private schedule(id:string,delay:number){const t=setTimeout(()=>{this.timers.delete(id);void this.sync(id);},delay);t.unref();this.timers.set(id,t);}
  startLearning(settings:()=>Settings,canWork:()=>boolean,transport?:typeof honchoTransport){
    for(const id of [...Object.keys(sourceKinds),...this.learningProviders.keys()]){
      const dir=path.join(this.dir,'life-learning',id);fs.mkdirSync(dir,{recursive:true});
      const memory=new HonchoMemory({dir,settings:()=>{const s=structuredClone(settings()),p=this.ledger.source(id);s.memory.honcho.enabled=s.memory.honcho.enabled&&!!p?.permissions.learn&&!!p.permissions.retain&&!!p.permissions.collect&&!p.paused&&this.enabled();return s;},transport,history:()=>[],observations:()=>{
        const p=this.ledger.source(id);if(!p?.permissions.learn||!this.retained(id))return[];
        if(this.learningProviders.has(id))return this.learningProviders.get(id)!();
        // Stable, provenance-labelled daily summaries only. No descriptions, coordinates or full track lists.
        const day=new Date().toISOString().slice(0,10),events=(id==='calendar'?this.ledger.current():this.ledger.view().events).filter(e=>e.source===id&&e.operation!=='delete');
        if(!events.length)return[];
        let summary=id==='calendar'?`Recent schedule observations: ${events.filter(e=>e.type==='calendar-scheduled').slice(0,3).map(e=>e.summary).join('; ')}. Scheduled only; attendance and completion unknown.`:id==='lastfm'?`Bounded listening sample: ${this.listening.tracks.length} scrobbles. Recently observed artists: ${[...new Set(this.listening.tracks.slice(-40).map(t=>t.artist))].slice(0,3).join(', ')}. User tastes only, not Capri opinions.`:`Recent phone proximity observations: ${events.filter(e=>['place-arrival','place-departure','place-dwell'].includes(e.type)).slice(0,3).map(e=>e.summary).join('; ')}. Does not establish user activity or routine.`;
        if(summary.length>1000)summary=summary.slice(0,1000);
        return[{id:`life-summary:${id}:${day}:${createHash('sha256').update(summary).digest('hex').slice(0,16)}`,role:'user' as const,text:`Source summary (${id}), ${day}, observed metadata rather than explicit user report. ${summary} Treat inferred routines as uncertain.`,at:Math.max(...events.map(e=>e.receivedAt))}];
      },memories:()=>[],excluded:()=>new Set(),canWork});this.learning.set(id,memory);memory.start();
    }
  }
  pcActivity(idleSeconds:number,now=Date.now()){
    if(!this.active('owntracks')||idleSeconds>30)return;
    const current=this.ledger.current(),arrival=this.ledger.view().events.find(e=>e.source==='owntracks'&&e.type==='place-arrival'&&now-e.occurredAt<=300000&&now>=e.occurredAt);
    if(!arrival||!current.some(e=>e.source==='owntracks'&&e.recordId==='presence'&&e.summary.endsWith(arrival.summary.split('arrived near ')[1])))return;
    const recordId='pc:'+arrival.recordId;if(this.ledger.view().events.some(e=>e.source==='owntracks'&&e.recordId===recordId))return;
    this.ledger.ingest({...arrival,recordId,revision:now,type:'place-pc-corroboration',receivedAt:now,expiresAt:arrival.occurredAt+300000,summary:arrival.summary+'; actual PC input is also recent',detail:arrival.detail+' PC input was observed within 30 seconds. A selective acknowledgement or silence is appropriate. Do not claim an activity or continuous tracking.',importance:.6});
  }
  musicContext(track:{title:string;artist:string}|null){
    if(!track||!this.active('lastfm')||!this.ledger.source('lastfm')?.permissions.live)return '';
    const matches=this.listening.tracks.filter(t=>t.title.toLowerCase()===track.title.toLowerCase()&&t.artist.toLowerCase()===track.artist.toLowerCase());
    const artist=this.listening.tracks.filter(t=>t.artist.toLowerCase()===track.artist.toLowerCase()),now=Date.now();
    return '\nLAST.FM FAMILIARITY FOR ACTUAL SPOTIFY PLAYBACK (bounded user history, not Capri tastes): '+JSON.stringify({track,plays:matches.length,artistPlays:artist.length,artistLastWeek:artist.filter(t=>now-t.at<=7*86400000).length,artistEarlier:artist.filter(t=>now-t.at>7*86400000).length,firstRetained:matches[0]?.at,lastRetained:matches.at(-1)?.at,historyIncomplete:!!this.listening.backfillTo})+'. Treat a return/discovery as tentative unless history supports it. Keep your own opinions. No separate scrobble reaction.\n';
  }
  learningContext(mode:'chat'|'proactive'='chat'){return [...this.learning].filter(([id])=>this.active(id)&&this.ledger.source(id)?.permissions.learn&&(mode==='chat'?this.ledger.source(id)?.permissions.live:this.ledger.source(id)?.permissions.proactive??this.ledger.source(id)?.permissions.live)).map(([id,m])=>m.context()?`\nOPT-IN ${id} SUMMARIZED SOURCE LEARNING; dated observations, not user reports or Capri opinions:\n${m.context()}`:'').join('').slice(0,2500);}
  stop(){this.stopped=true;this.google.stop();this.receiver.stop();for(const c of this.controllers.values())c.abort();this.controllers.clear();for(const t of this.timers.values())clearTimeout(t);this.timers.clear();for(const m of this.learning.values())m.stop();this.save();}
}

