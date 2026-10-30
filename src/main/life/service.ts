import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { randomBytes,createHash } from 'node:crypto';
import { LifeContext, ContextAssembler } from './context';
import { ChromeBridge } from './chrome';
import { Stage3 } from './stage3';
import { Stage2 } from './stage2';
import { ProjectAdapter } from './projects';
import { LifeSource, safePage } from '../../shared/lifeContext';
import type { SecretStore } from '../store/secrets';
import type { Checkpoints } from '../../core/contracts';
export class LifeService {
  readonly ledger: LifeContext; readonly assembler: ContextAssembler; readonly chrome: ChromeBridge; readonly stage2: Stage2; readonly stage3: Stage3;
  private projects = new Map<string,ProjectAdapter>();
  private projectSignatures=new Map<string,string>();private chromeSignature='';
  private generation = 0;
  constructor(dir: string, private secrets: SecretStore, invalidated: (source?: string) => void, private enabled: () => boolean, persist: () => boolean, checkpoints?: Checkpoints) {
    this.ledger=new LifeContext(dir,Date.now,source=>{invalidated(source);this.stage2?.invalidateLearning(source);},persist,checkpoints); this.assembler=new ContextAssembler(this.ledger);
    this.stage2=new Stage2(dir,this.ledger,secrets,persist,enabled);
    this.stage3=new Stage3(dir,this.ledger,secrets,enabled,persist,this.stage2);
    this.chrome=new ChromeBridge(this.ledger,()=>{try {return JSON.parse(secrets.get('lifeBridge')??'{}');}catch{return {token:'',extensionId:''};}});
  }
  async start() {
    const generation = ++this.generation;
    const wanted=this.enabled()?this.ledger.view().sources.filter(s=>s.kind==='project'&&s.permissions.collect&&!s.paused):[];
    for(const [id,adapter]of this.projects)if(!wanted.some(s=>s.id===id&&JSON.stringify(s)===this.projectSignatures.get(id))){adapter.stop();this.projects.delete(id);this.projectSignatures.delete(id);}
    if(!this.enabled()){this.chrome.stop();this.chromeSignature='';}
    await this.stage2.start();
    await this.stage3.start();
    if(!this.enabled()) {this.ledger.bridge.state='disabled by memory or local-context controls';return;}
    const chrome=this.ledger.source('chrome');
    if(chrome?.permissions.collect&&!chrome.paused){const signature=createHash('sha256').update(JSON.stringify(chrome)+(this.secrets.get('lifeBridge')??'')).digest('hex');if(signature!==this.chromeSignature||this.ledger.bridge.state!=='listening'){this.chromeSignature=signature;await this.chrome.start();}}
    else{this.chrome.stop();this.chromeSignature='';this.ledger.bridge.state='off';}
    if(generation!==this.generation)return;
    for(const source of wanted)if(!this.projects.has(source.id)){const adapter=new ProjectAdapter(this.ledger,source);this.projects.set(source.id,adapter);this.projectSignatures.set(source.id,JSON.stringify(source));void adapter.start();}
  }
  configure(raw: unknown) {
    const config=LifeSource.parse(raw), old=this.ledger.source(config.id);
    if(!old)throw Error('Use Add project folder to authorize a new source.');
    if(config.kind!==old.kind||config.folder!==old.folder)throw Error('Re-select folders through the folder picker.');
    config.sites=config.sites.map(site=>{const u=safePage(site);if(!u||new URL(site).origin!==site)throw Error('Use exact http(s) site origins, without paths.');return site;});
    if(config.permissions.learn && !['calendar','lastfm','owntracks'].includes(config.id)&&!(/^(gmail|outlook|teams)-[01]$/.test(config.id)||config.id==='academic'))throw Error('This source does not support long-term source learning.');
    if(config.permissions.learn && (!config.permissions.collect||!config.permissions.retain))throw Error('Source learning requires collection and local retention.');
    if(['calendar','lastfm','owntracks'].includes(config.id)&&JSON.stringify(config)!==JSON.stringify(old))this.stage2.invalidate(config.id);
    if(this.stage3.has(config.id)&&JSON.stringify(config)!==JSON.stringify(old))this.stage3.invalidate(config.id,config.permissions.content!==old.permissions.content);
    this.ledger.configure(config);this.ledger.clearDraft(config.id);void this.start();return this.ledger.view();
  }
  addProject(folder: string) {
    const full=fs.realpathSync(folder), forbidden=[path.parse(full).root,os.homedir(),process.env.APPDATA,process.env.LOCALAPPDATA,process.env.WINDIR].filter(Boolean).map(s=>path.resolve(s!).toLowerCase());
    if(forbidden.includes(full.toLowerCase())||!fs.statSync(full).isDirectory())throw Error('Select a specific project folder.');
    if(this.ledger.view().sources.some(s=>s.kind==='project'&&s.folder?.toLowerCase()===full.toLowerCase()))return this.ledger.view();
    if(this.ledger.view().sources.filter(s=>s.kind==='project').length>=20)throw Error('At most 20 monitored projects.');
    const id='project:'+randomBytes(8).toString('hex'), entityId='project:'+randomBytes(8).toString('hex');
    const source=this.ledger.configure({id,kind:'project',name:path.basename(full),folder:full,entityId,sites:[],retentionDays:7,paused:false,permissions:{collect:true,live:true,retain:false,content:false,learn:false}});
    this.ledger.associate({id:entityId,name:source.name,aliases:[full],evidence:'Explicitly selected project folder',source:id,certainty:'explicit'});
    void this.start();return this.ledger.view();
  }
  pair(extensionId: string) {if(!/^[a-p]{32}$/.test(extensionId))throw Error('Copy the 32-letter extension ID from chrome://extensions.');const token=randomBytes(32).toString('hex');this.secrets.set('lifeBridge',JSON.stringify({extensionId,token}));void this.start();return {token,port:43129,persistent:this.secrets.persistent};}
  forget(id: string, remove=false) {if(this.stage3.has(id))this.stage3.invalidate(id,true);if(['calendar','lastfm','owntracks'].includes(id))this.stage2.invalidate(id,true);this.ledger.forget(id,remove);if(id==='chrome')this.secrets.delete('lifeBridge');void this.start();}
  clear(){for(const id of this.ledger.view().sources.map(s=>s.id))if(this.stage3.has(id))this.stage3.invalidate(id,true);for(const id of ['calendar','lastfm','owntracks'])this.stage2.invalidate(id,true);this.ledger.clear();this.secrets.delete('lifeBridge');void this.start();}
  stop(){this.stage3.stop();this.stage2.stop();this.generation++;for(const p of this.projects.values())p.stop();this.projects.clear();this.chrome.stop();this.ledger.flush();}
}
