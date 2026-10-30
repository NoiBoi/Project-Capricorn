import http from 'node:http';
import {createHash,timingSafeEqual} from 'node:crypto';
import {z} from 'zod';
import type {Stage2Settings} from '../../shared/lifeContext';
import type {LifeContext} from './context';
const Payload=z.object({_type:z.enum(['location','transition']),tst:z.number().int().positive(),lat:z.number().min(-90).max(90),lon:z.number().min(-180).max(180),acc:z.number().min(0).max(100000),tid:z.string().max(10).optional(),event:z.enum(['enter','leave']).optional(),desc:z.string().max(100).optional()}).passthrough();
export interface LocationState {lastAt:number;seen:{id:string;at:number}[];inside:Record<string,{since:number;last:number;dwell:boolean}>}
export const emptyLocation=():LocationState=>({lastAt:0,seen:[],inside:{}});
export function distance(a:{lat:number;lon:number},b:{lat:number;lon:number}){const r=Math.PI/180,dlat=(b.lat-a.lat)*r,dlon=(b.lon-a.lon)*r;return 6371000*2*Math.asin(Math.sqrt(Math.sin(dlat/2)**2+Math.cos(a.lat*r)*Math.cos(b.lat*r)*Math.sin(dlon/2)**2));}
/** No coordinates enter the shared ledger or long-term learning. */
export class OwnTracks {
  private server?:http.Server;private generation=0;private requests=0;private windowAt=0;
  status='Disabled';
  constructor(private ledger:LifeContext,private config:()=>Stage2Settings,private credential:()=>string|undefined,private state:LocationState,private save:()=>void,private port=43130){}
  accept(raw:unknown,device:string,now=Date.now()){
    const s=this.ledger.source('owntracks')!,cfg=this.config();
    if(!s.permissions.collect||s.paused||device!==cfg.device||!device)throw Error('Device not authorized');
    if(raw&&typeof raw==='object'&&['_type'].every(k=>k in raw)&&['status','waypoint','waypoints','lwt','card','steps'].includes(String((raw as any)._type)))return false;
    const p=Payload.parse(raw),at=p.tst*1000;
    if(!s.permissions.collect||s.paused||device!==cfg.device||!device)throw Error('Device not authorized');
    if(at>now+60000)throw Error('Timestamp is in the future');
    if(now-at>s.retentionDays*86400000||p.acc>200){this.ledger.setHealth('owntracks',{state:'degraded',detail:'Report received but ignored: outside retention or accuracy worse than 200 metres. No present location inferred.',lastSync:this.ledger.view().health.owntracks?.lastSync});return false;}
    const id=createHash('sha256').update(JSON.stringify([device,p._type,p.tst,p.lat,p.lon,p.event,p.desc])).digest('hex');if(this.state.seen.some(e=>e.id===id))return false;
    this.state.seen.push({id,at});this.state.seen=this.state.seen.filter(e=>now-e.at<s.retentionDays*86400000).slice(-3000);
    const ordered=at>this.state.lastAt,fresh=now-at<=5*60000;
    if(!ordered){this.save();return false;} // Delayed out-of-order fixes cannot rewind a place.
    const priorAt=this.state.lastAt;this.state.lastAt=at;
    const emit=(place:Stage2Settings['places'][number],kind:string,since:number)=>{
      this.ledger.ingest({source:'owntracks',recordId:kind==='presence'?'presence':id+':'+place.id+':'+kind,revision:Math.max(now,at),type:'place-'+kind,occurredAt:at,receivedAt:now,expiresAt:kind==='presence'?at+5*60000:Math.max(at+1000,at+86400000),entities:place.entities,quality:'observed',permissions:s.permissions,summary:`Phone ${kind==='presence'?'reported near':kind==='arrival'?'arrived near':kind==='departure'?'left the area of':'remained near'} ${place.name}`,detail:JSON.stringify({place:place.name,placeId:place.id,since,eventTime:at,receivedAt:now,delayed:!fresh,meaning:'Phone proximity only. User activity, attendance and outcomes unknown. Historical delivery is not current presence.'}),operation:'upsert',importance:0});
    };
    let present=false;
    for(const place of cfg.places){const d=distance(p,place),old=this.state.inside[place.id];
      // Accuracy-aware hysteresis avoids boundary flapping. Uncertain fixes leave state unchanged.
      let inside=d+p.acc<=place.radius?true:d-p.acc>place.radius+50?false:undefined;
      if(p._type==='transition'){if(!p.event||p.desc!==place.name)continue;if(p.event==='enter'&&inside!==true||p.event==='leave'&&inside!==false)continue;}
      if(inside===undefined)continue;
      if(inside){present=true;if(!old){this.state.inside[place.id]={since:at,last:at,dwell:false};emit(place,'arrival',at);}else{if(at-priorAt>10*60000){old.since=at;old.dwell=false;}old.last=at;if(at-old.since>=10*60000&&!old.dwell){old.dwell=true;emit(place,'dwell',old.since);}}emit(place,'presence',this.state.inside[place.id].since);}
      else if(old){emit(place,'departure',old.since);delete this.state.inside[place.id];}
    }
    if(!present){const prior=this.ledger.current().find(e=>e.source==='owntracks'&&e.recordId==='presence');if(prior)this.ledger.ingest({...prior,revision:Math.max(now,prior.revision+1),operation:'delete',occurredAt:at,receivedAt:now,expiresAt:Math.max(at+1000,now+1000)});}
    this.save();return true;
  }
  async start(){
    this.stop();const generation=this.generation;
    if(!this.credential()||!this.config().device){this.status='Waiting for generated credential and device name';this.ledger.setHealth('owntracks',{state:'waiting',detail:this.status});return;}
    const server=this.server=http.createServer((req,res)=>{
      const expected=Buffer.from('Basic '+Buffer.from(this.credential()!).toString('base64')),actual=Buffer.from(req.headers.authorization??'');
      if(actual.length!==expected.length||!timingSafeEqual(actual,expected)){res.writeHead(401,{'WWW-Authenticate':'Basic realm="Capri OwnTracks"'}).end();req.resume();return;}
      if(Date.now()-this.windowAt>60000){this.windowAt=Date.now();this.requests=0;}if(++this.requests>120){res.writeHead(429,{'retry-after':'60'}).end();req.resume();return;}
      if(req.headers.origin||req.method!=='POST'||req.url!=='/pub'||!/^application\/json(?:;|$)/i.test(req.headers['content-type']??'')){res.writeHead(400).end();req.resume();return;}
      if(Number(req.headers['content-length']??0)>16384){res.writeHead(413).end();req.resume();return;}
      const chunks:Buffer[]=[];let size=0;req.on('data',chunk=>{size+=chunk.length;if(size>16384){res.writeHead(413).end();req.destroy();}else chunks.push(chunk);});
      req.on('end',()=>{if(size>16384||generation!==this.generation)return;try{if(size)this.accept(JSON.parse(Buffer.concat(chunks).toString('utf8')),String(req.headers['x-limit-d']??''));res.setHeader('content-type','application/json');res.end('[]');}catch{res.writeHead(422).end('Invalid, stale, inaccurate or unauthorized location report');}});
    });
    server.maxConnections=8;server.requestTimeout=10000;server.headersTimeout=10000;server.keepAliveTimeout=1000;
    try{await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(this.port,'127.0.0.1',resolve);});if(generation!==this.generation){server.close();return;}this.status=`Listening on 127.0.0.1:${this.port}/pub. Tailnet exposure not verified.`;this.ledger.setHealth('owntracks',{state:'waiting',detail:this.status+' Waiting for first valid device report.'});}catch{this.status='Receiver unavailable. Port may be occupied.';this.ledger.setHealth('owntracks',{state:'error',detail:this.status,lastFailure:Date.now()});}
  }
  stop(){this.generation++;this.server?.closeAllConnections();this.server?.close();this.server=undefined;this.status='Disabled';}
}
