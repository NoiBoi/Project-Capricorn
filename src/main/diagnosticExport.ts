import fs from 'node:fs';
import path from 'node:path';
import type {LifeView} from '../shared/lifeContext';

export function diagnosticConnections(life:LifeView) {
  const catalog:Record<string,string>={chrome:'Chrome browser context',calendar:'Google Calendar',lastfm:'Last.fm listening history',owntracks:'OwnTracks phone location',
    'outlook-0':'Outlook account 1','outlook-1':'Outlook account 2','gmail-0':'Gmail account 1','gmail-1':'Gmail account 2','teams-0':'Teams account 1','teams-1':'Teams account 2',
    'discord-local':'Discord local activity','discord-bot':'Discord authorized bot',academic:'Academic imports'};
  for(const source of life.sources)catalog[source.id]??=source.name;
  return Object.entries(catalog).map(([id,name])=>{
    const source=life.sources.find(s=>s.id===id),health=life.health[id] as import('../shared/lifeContext').SourceHealth|undefined;
    return {id,name,status:!source?.permissions.collect?'not connected':source.paused?'paused':health?.state??'waiting',
      detail:!source?.permissions.collect?'Collection is off; no live access is authorized. Retained records, if any, are listed separately.':health?.detail??'No successful sync has been verified in current local health state.',
      permissions:source?.permissions??null,configuration:source??null,lastKnownHealth:health??null,
      eligibleForChat:life.current.filter(e=>e.source===id).length,eligibleForAmbient:life.proactiveCurrent.filter(e=>e.source===id).length,
      recentRecords:life.events.filter(e=>e.source===id).length};
  }).concat(life.sources.some(s=>s.kind==='project')?[]:[{id:'project-folders',name:'Approved project folders',status:'not connected',detail:'No approved project folder configured.',permissions:null,configuration:null,lastKnownHealth:null,eligibleForChat:0,eligibleForAmbient:0,recentRecords:0}]);
}

/** Explicit diagnostics preserve content, unlike routine logs, but never credentials. */
export function diagnosticRedactor(secrets: string[] = []) {
  const known = secrets.filter(s => s.length >= 4).sort((a,b)=>b.length-a.length);
  const clean = (text: string) => {
    for (const secret of known) text = text.split(secret).join('[REDACTED]');
    return text.replace(/\b(?:sk-|AIza|AQ\.)[A-Za-z0-9_\-]{8,}/g,'[REDACTED]')
      .replace(/\b(Bearer|Basic)\s+[A-Za-z0-9+/.=_\-]+/gi,'$1 [REDACTED]')
      .replace(/([?&](?:key|api_key|token|password|secret|code)=)[^&#\s]*/gi,'$1[REDACTED]')
      .replace(/(https?:\/\/)[^\s/@]+:[^\s/@]+@/gi,'$1[REDACTED]@');
  };
  const visit = (value: unknown): unknown => {
    if (typeof value === 'string') return clean(value);
    if (typeof value === 'bigint') return String(value);
    if (Array.isArray(value)) return value.filter(v => !(v && typeof v==='object' && ((v as any).private || (v as any).meta?.private))).map(visit);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k,v]) => [k,
      /^(?:api[-_]?key|authorization|password|secret|cookie|token|refreshToken|client_secret|access[-_]?token|refresh[-_]?token|clientSecret|credential|jpegBase64|imageBase64)$/i.test(k) && typeof v!=='boolean' ? '[REDACTED]' : visit(v)]));
    return value;
  };
  return visit;
}

export interface DiagnosticTrace { at:number; lane:string; event:string; data:unknown }
/** Session-only context receipts: no provider-internal reasoning, screenshots, or private turns. */
export class DiagnosticTraces {
  private entries: DiagnosticTrace[] = [];
  private dropped = 0;
  constructor(private allowed:()=>boolean,private sanitize:(v:unknown)=>unknown) {}
  record(lane:string,event:string,data:unknown) {
    if(!this.allowed()){this.clear();return;}
    const entry={at:Date.now(),lane,event,data:this.sanitize(data)};
    const bytes=Buffer.byteLength(JSON.stringify(entry));
    if(bytes>2*1024*1024){this.dropped++;return;}
    this.entries.push(entry);
    while(this.entries.length>40 || Buffer.byteLength(JSON.stringify(this.entries))>8*1024*1024){this.entries.shift();this.dropped++;}
  }
  clear(){this.entries=[];this.dropped=0;}
  snapshot(){if(!this.allowed())this.clear();return {scope:'Current application session only; up to 40 entries / 8 MiB. No trace existed before this version started. Model inputs are application-assembled context; native provider sessions may also hold remote history. No hidden chain of thought is collected.',dropped:this.dropped,entries:structuredClone(this.entries)};}
}

// Only application-owned data. Never traverse Chromium storage, auth stores, or arbitrary folders.
const files = ['settings.json','memory.json','history.jsonl','relationship.json','reminders.json','notes.json',
  'companion-scenes.json','dialogue-history.json','exploration-history.json','interaction-profile.json',
  'activity-usage.json','background-budget.json','codex-cooldown.json','honcho-memory.json',
  'life-stage2-config.json','life-stage2-state.json','life-stage3-config.json','life-stage3-state.json','life-setup-drafts.json',
  'opening-greeting.json','farewell.json','theatre-cadence.json'];

export function collectDiagnosticFiles(dir:string) {
  const data:Record<string,unknown>={}, inventory:{file:string;state:string;bytes?:number;detail?:string}[]=[];
  const read=(relative:string)=>{
    const file=path.join(dir,relative);
    try {
      if(!fs.existsSync(file)){inventory.push({file:relative,state:'absent'});return;}
      const stat=fs.lstatSync(file);
      if(!stat.isFile()||stat.isSymbolicLink()){inventory.push({file:relative,state:'omitted',detail:'Not a regular application data file'});return;}
      if(stat.size>16*1024*1024){inventory.push({file:relative,state:'omitted',bytes:stat.size,detail:'Exceeds 16 MiB per-file export limit'});return;}
      const text=fs.readFileSync(file,'utf8').replace(/^\uFEFF/,'');
      data[relative]=relative.endsWith('.jsonl')?text.split(/\r?\n/).filter(Boolean).map(line=>JSON.parse(line)):JSON.parse(text);
      inventory.push({file:relative,state:'included',bytes:stat.size});
    }catch(e){inventory.push({file:relative,state:'error',detail:e instanceof Error?e.message:String(e)});}
  };
  for(const name of files)read(name);
  const learning=path.join(dir,'life-learning');
  if(fs.existsSync(learning))for(const entry of fs.readdirSync(learning,{withFileTypes:true}))if(entry.isDirectory()&&!entry.isSymbolicLink())read(path.join('life-learning',entry.name,'honcho-memory.json'));
  return {inventory,data,omitted:['Credentials and encrypted secret stores','Chromium cookies, browser cache and authentication/session storage','Screenshot pixels and audio','Off-the-record entries','Legacy life-context.json (migrated; authoritative life-context checkpoint is in cognitive records)','External files, email bodies, cloud memories or provider session history not already available locally; export performs no network fetch','Expired/deleted data and historical GPS coordinates no longer retained']};
}
