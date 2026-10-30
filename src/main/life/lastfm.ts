import {createHash} from 'node:crypto';
import {cleanEvidence} from '../../shared/lifeContext';
import type {LifeContext} from './context';
import {providerJSON,ProviderError} from './network';
export interface Scrobble {id:string;artist:string;title:string;at:number}
export interface ListeningState {cursor:number;backfillTo?:number;tracks:Scrobble[];topsAt:number;tops:{artists:string[];tracks:string[]}}
export const emptyListening=():ListeningState=>({cursor:0,tracks:[],topsAt:0,tops:{artists:[],tracks:[]}});
export class Lastfm {
  constructor(private ledger:LifeContext,private fetcher:typeof fetch=fetch){}
  async sync(user:string,key:string,state:ListeningState,signal:AbortSignal,active:()=>boolean){
    const source=this.ledger.source('lastfm')!,now=Date.now(),cutoff=now-source.retentionDays*86400000;
    const call=async(method:string,args:Record<string,string>={})=>{const u=new URL('https://ws.audioscrobbler.com/2.0/');u.search=new URLSearchParams({method,user,api_key:key,format:'json',...args}).toString();const data=await providerJSON(u.href,{signal},this.fetcher);if(data.error)throw new ProviderError([4,10,26].includes(data.error)?401: data.error===29?429:503);return data;};
    // One fixed page plus one historical page per pass avoids unbounded account backfills.
    const recent=await call('user.getRecentTracks',{limit:'200',from:String(Math.floor((state.cursor?Math.max(cutoff,state.cursor-1000):Math.max(cutoff,now-86400000))/1000))});
    const normalize=(v:any)=>Array.isArray(v)?v:v?[v]:[];
    const fresh=normalize(recent.recenttracks?.track),records=[...fresh];
    let nextBackfill=state.backfillTo??(state.cursor?0:now-86400000);
    if(nextBackfill>cutoff){const older=await call('user.getRecentTracks',{limit:'200',from:String(Math.floor(cutoff/1000)),to:String(Math.floor(nextBackfill/1000))});const batch=normalize(older.recenttracks?.track);records.push(...batch);const timestamps=batch.map(t=>Number(t.date?.uts)*1000).filter(Number.isFinite);nextBackfill=timestamps.length?Math.min(...timestamps)-1000:0;}
    let tops=state.tops,topsAt=state.topsAt;
    if(now-topsAt>86400000){const artists=await call('user.getTopArtists',{period:'overall',limit:'8'}),tracks=await call('user.getTopTracks',{period:'overall',limit:'8'});tops={artists:normalize(artists.topartists?.artist).slice(0,8).map(t=>cleanEvidence(t.name,100)+' ('+Number(t.playcount)+' plays)'),tracks:normalize(tracks.toptracks?.track).slice(0,8).map(t=>cleanEvidence(`${t.artist?.name}: ${t.name}`,180)+' ('+Number(t.playcount)+' plays)')};topsAt=now;}
    if(!active()||signal.aborted)return;
    const map=new Map(state.tracks.filter(t=>t.at>=cutoff).map(t=>[t.id,t]));
    for(const t of records){const at=Number(t.date?.uts)*1000;if(!Number.isFinite(at)||at<cutoff||at>now+60000)continue;const artist=cleanEvidence(t.artist?.['#text']??'',120),title=cleanEvidence(t.name??'',120);if(!artist||!title)continue;const id=createHash('sha256').update(`${user.toLowerCase()}\0${at}\0${artist.toLowerCase()}\0${title.toLowerCase()}`).digest('hex');map.set(id,{id,artist,title,at});}
    state.tracks=[...map.values()].sort((a,b)=>a.at-b.at).slice(-3000);state.tops=tops;state.topsAt=topsAt;state.backfillTo=nextBackfill;
    // More than 200 new scrobbles are recovered with a backwards catch-up window.
    if(Number(recent.recenttracks?.['@attr']?.totalPages)>1){const at=fresh.map(t=>Number(t.date?.uts)*1000).filter(Number.isFinite);if(at.length)state.backfillTo=Math.max(state.backfillTo??0,Math.min(...at)-1000);}
    state.cursor=Math.max(state.cursor,...state.tracks.map(t=>t.at),0);
    const nowPlaying=fresh.find(t=>t['@attr']?.nowplaying==='true');
    if(nowPlaying||this.ledger.current().some(e=>e.source==='lastfm'&&e.recordId==='now-playing'))this.ledger.ingest({source:'lastfm',recordId:'now-playing',revision:now,type:'music-now-playing',occurredAt:now,receivedAt:now,expiresAt:now+180000,entities:[],quality:'observed',permissions:source.permissions,summary:nowPlaying?cleanEvidence(`Last.fm currently scrobbling: ${nowPlaying.artist?.['#text']}: ${nowPlaying.name}`,400):'Last.fm has no current scrobble',detail:'Cross-device metadata; not audio analysis. Spotify playback takes priority. No independent song-change initiative.',operation:nowPlaying?'upsert':'delete',importance:0});
    const counts=new Map<string,number>(),artists=new Map<string,number>();for(const t of state.tracks){counts.set(`${t.artist}: ${t.title}`,(counts.get(`${t.artist}: ${t.title}`)??0)+1);artists.set(t.artist,(artists.get(t.artist)??0)+1);}
    const top=(m:Map<string,number>)=>[...m].sort((a,b)=>b[1]-a[1]).slice(0,5);
    const prior=this.ledger.current().find(e=>e.source==='lastfm'&&e.recordId==='listening-pattern');
    const detail=JSON.stringify({windowDays:source.retentionDays,retainedScrobbles:state.tracks.length,revisitedTracks:top(counts),recentArtists:top(artists),lifetimeFavorites:tops,meaning:'User listening history only. Not Capri preferences. Counts are bounded samples; incomplete backfill is not a new discovery.'});
    // Aggregate context refreshes quietly. Existing Spotify reactions own song changes.
    this.ledger.ingest({source:'lastfm',recordId:'listening-pattern',revision:now,type:'music-pattern',occurredAt:now,receivedAt:now,expiresAt:now+86400000,entities:[],quality:'observed',permissions:source.permissions,summary:'Listening familiarity from Last.fm',detail:detail.slice(0,2500),operation:'upsert',importance:prior?.detail===detail?0:.35});
  }
}
