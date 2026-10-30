import http from 'node:http';
import {createHash,timingSafeEqual} from 'node:crypto';
import {z} from 'zod';
import type {Stage2Settings} from '../../shared/lifeContext';
import type {LifeContext} from './context';
import {LocationCheckpoint,type LocationState} from '../../shared/location';
import {Geography} from './geography';
import {LocationInterpreter} from './locationInterpreter';
const BeaconTransition=z.object({_type:z.literal('transition'),t:z.literal('b'),tst:z.number().int().positive(),rid:z.string().min(1).max(100),wtst:z.number().int().positive(),desc:z.string().max(80).optional(),event:z.enum(['enter','leave'])});
const Payload=z.object({_type:z.enum(['location','transition']),tst:z.number().int().positive(),lat:z.number().min(-90).max(90),lon:z.number().min(-180).max(180),acc:z.number().min(0).max(100000),inrids:z.array(z.string().max(100)).max(50).optional(),vel:z.number().min(0).max(1000).optional(),tid:z.string().max(10).optional(),event:z.enum(['enter','leave']).optional(),desc:z.string().max(100).optional()}).passthrough();
import {distance} from './geography';
export {distance} from './geography';
export type {LocationState} from '../../shared/location';
export const emptyLocation=():LocationState=>({...LocationCheckpoint.parse({}),lastFix:undefined,accuracy:undefined});
/** No coordinates enter the shared ledger or long-term learning. */
export class OwnTracks {
  private server?:http.Server;private generation=0;private requests=0;private windowAt=0;
  status='Disabled';readonly geography:Geography;readonly interpreter:LocationInterpreter;private active=false;
  view(){return this.interpreter.view(this.config().location.publicLookup?this.geography.status:'Public lookup disabled. Personal places work offline.');}
  history(){return this.state;}
  edit(id:string,action:'delete'|'rename'|'ignore',name?:string){this.interpreter.edit(id,action,name);this.save();return this.view();}
  reset(){this.geography.clear();}
  clearHistory(){this.ledger.invalidate('owntracks');Object.assign(this.state,emptyLocation());this.geography.clear();this.save();}
  constructor(private ledger:LifeContext,private config:()=>Stage2Settings,private credential:()=>string|undefined,private state:LocationState,private save:()=>void,private port=43130){this.geography=new Geography(()=>this.config().location);this.interpreter=new LocationInterpreter(ledger,config,state);}
  accept(raw:unknown,device:string,now=Date.now()){
    const s=this.ledger.source('owntracks')!,cfg=this.config();
    if(!s.permissions.collect||s.paused||device!==cfg.device||!device)throw Error('Device not authorized');
    if(raw&&typeof raw==='object'&&['_type'].every(k=>k in raw)&&['beacon','status','waypoint','waypoints','lwt','card','steps'].includes(String((raw as any)._type)))return false;
    if((raw as any)?._type==='transition'&&(raw as any)?.t==='b'){const b=BeaconTransition.parse(raw),at=b.tst*1000;if(at>now||now-at>300000)return false;this.interpreter.beaconEvent(b,now);this.state.receivedAt=now;this.ledger.setHealth('owntracks',{state:'healthy',detail:'Authenticated beacon-region report received. Beacon proximity is not room occupancy.',lastSync:now});this.save();return true;}
    const p=Payload.parse(raw),at=p.tst*1000;
    if(!s.permissions.collect||s.paused||device!==cfg.device||!device)throw Error('Device not authorized');
    if(at>now+60000)throw Error('Timestamp is in the future');
    if(at>this.state.lastAt&&at<=now&&now-at<=300000&&p.inrids)this.interpreter.beaconReports(p.inrids,at,now);
    if(now-at>s.retentionDays*86400000||p.acc>200){this.ledger.setHealth('owntracks',{state:'degraded',detail:'Report received but ignored: outside retention or accuracy worse than 200 metres. No present location inferred.',lastSync:this.ledger.view().health.owntracks?.lastSync});return false;}
    const id=createHash('sha256').update(JSON.stringify([device,p._type,p.tst,p.lat,p.lon,p.event,p.desc])).digest('hex');if(this.state.seen.some(e=>e.id===id))return false;
    this.state.seen.push({id,at});this.state.seen=this.state.seen.filter(e=>now-e.at<s.retentionDays*86400000).slice(-3000);
    const ordered=at>this.state.lastAt,fresh=now-at<=5*60000;
    if(!ordered){this.save();return false;} // Delayed out-of-order fixes cannot rewind a place.
    this.state.lastAt=at;
    if(!fresh){this.state.diagnostic='Delayed historical report ignored for presence and dwell. Waiting for a live report.';this.save();return false;}
    const supported=this.interpreter.observe({...p,at},this.config().location.publicLookup?this.geography.cached(p):[],now);
    const generation=this.generation;
    if(supported&&this.active&&this.config().location.publicLookup&&!this.config().places.some(place=>distance(p,place)<place.radius+500))void this.geography.nearby(p).then(()=>{if(generation!==this.generation||!this.active||!this.ledger.source('owntracks')?.permissions.collect||this.ledger.source('owntracks')?.paused)return;this.save();});
    this.ledger.setHealth('owntracks',{state:supported?'healthy':'degraded',detail:this.state.diagnostic,lastSync:now});this.save();return supported;
  }

  async start(){
    this.stop();this.active=true;const generation=this.generation;
    if(!this.credential()||!this.config().device){this.status='Waiting for generated credential and device name';this.ledger.setHealth('owntracks',{state:'waiting',detail:this.status});return;}
    const server=this.server=http.createServer((req,res)=>{
      const expected=Buffer.from('Basic '+Buffer.from(this.credential()!).toString('base64')),actual=Buffer.from(req.headers.authorization??'');
      if(actual.length!==expected.length||!timingSafeEqual(actual,expected)){this.ledger.setHealth('owntracks',{state:'degraded',detail:'Phone credentials rejected. Re-import the current pairing configuration.'});res.writeHead(401,{'WWW-Authenticate':'Basic realm="Capri OwnTracks"'}).end();req.resume();return;}
      if(Date.now()-this.windowAt>60000){this.windowAt=Date.now();this.requests=0;}if(++this.requests>120){res.writeHead(429,{'retry-after':'60'}).end();req.resume();return;}
      if(req.headers.origin||req.method!=='POST'||req.url!=='/pub'||!/^application\/json(?:;|$)/i.test(req.headers['content-type']??'')){res.writeHead(400).end();req.resume();return;}
      if(Number(req.headers['content-length']??0)>16384){res.writeHead(413).end();req.resume();return;}
      const chunks:Buffer[]=[];let size=0;req.on('data',chunk=>{size+=chunk.length;if(size>16384){res.writeHead(413).end();req.destroy();}else chunks.push(chunk);});
      req.on('end',()=>{if(size>16384||generation!==this.generation)return;try{if(size)this.accept(JSON.parse(Buffer.concat(chunks).toString('utf8')),String(req.headers['x-limit-d']??''));res.setHeader('content-type','application/json');res.end('[]');}catch{res.writeHead(422).end('Invalid, stale, inaccurate or unauthorized location report');}});
    });
    server.maxConnections=8;server.requestTimeout=10000;server.headersTimeout=10000;server.keepAliveTimeout=1000;
    try{await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(this.port,'127.0.0.1',resolve);});if(generation!==this.generation){server.close();return;}this.status=`Listening on 127.0.0.1:${this.port}/pub. Tailnet exposure not verified.`;this.ledger.setHealth('owntracks',{state:'waiting',detail:this.status+' Waiting for first valid device report.'});}catch{this.status='Receiver unavailable. Port may be occupied.';this.ledger.setHealth('owntracks',{state:'error',detail:this.status,lastFailure:Date.now()});}
  }
  stop(){this.active=false;this.geography.clear();this.generation++;this.server?.closeAllConnections();this.server?.close();this.server=undefined;this.status='Disabled';}
}
