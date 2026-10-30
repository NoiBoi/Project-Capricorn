import http from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { safePage, cleanEvidence } from '../../shared/lifeContext';
import { LifeContext } from './context';
import { PageSection } from './perception';
const Page = z.object({ recordId:z.string().min(1).max(100), revision:z.number().int().nonnegative(), occurredAt:z.number().finite(), url:z.string().max(2000), title:z.string().max(300), headings:z.array(z.string().max(200)).max(8), description:z.string().max(500).default(''), selection:z.string().max(1500).default(''), excerpt:z.string().max(1500).default(''), mode:z.enum(['metadata','selection','excerpt','semantic','deep']).default('metadata'), sections:z.array(PageSection).max(80).default([]), playback:z.object({state:z.enum(['playing','paused','ended']),position:z.number().min(0).max(864000),duration:z.number().min(0).max(864000).nullable()}).strict().optional(), incognito:z.literal(false), focused:z.literal(true), visible:z.literal(true), operation:z.enum(['upsert','delete']).default('upsert') }).strict();
export const ChromePage = Page;
/** Authenticated loopback, fixed Host and exact extension Origin. No browser CORS wildcard. */
export class ChromeBridge {
  private server?: http.Server; private last = 0; private serial = 0;
  constructor(private life: LifeContext, private credentials: () => { token: string; extensionId: string }, private port = 43129) {}
  async start() {
    this.stop(); const serial = ++this.serial;
    const {token='',extensionId=''} = this.credentials();
    const credentials = {token,extensionId};
    if (!/^[a-p]{32}$/.test(credentials.extensionId) || credentials.token.length < 32) { this.life.bridge = {state:'Pair extension in Connections',port:this.port,extensionId:credentials.extensionId}; return; }
    this.life.bridge = {state:'starting',port:this.port,extensionId:credentials.extensionId};
    const server = this.server = http.createServer((req,res) => {
      const origin = `chrome-extension://${credentials.extensionId}`;
      const reject = (code:number) => { res.writeHead(code); res.end(); };
      if (req.headers.host !== `127.0.0.1:${this.port}` || req.headers.origin !== origin || req.url !== '/v1/page') return reject(403);
      res.setHeader('Access-Control-Allow-Origin',origin); res.setHeader('Vary','Origin');
      if (req.method === 'OPTIONS') { res.setHeader('Access-Control-Allow-Methods','POST'); res.setHeader('Access-Control-Allow-Headers','authorization,content-type'); return reject(204); }
      const provided = Buffer.from(req.headers.authorization ?? ''), expected = Buffer.from('Bearer '+credentials.token);
      if (req.method !== 'POST' || provided.length !== expected.length || !timingSafeEqual(provided,expected) || !req.headers['content-type']?.startsWith('application/json')) return reject(401);
      if (Date.now()-this.last < 200) return reject(429); this.last = Date.now();
      let size = 0, body = ''; req.setTimeout(3000,()=>req.destroy());
      req.on('data', chunk => { size += chunk.length; if (size>256000) { req.destroy(); return; } body += chunk.toString(); });
      req.on('end',()=>{ try { const data=Page.parse(JSON.parse(body)); const accepted=this.accept(data); res.writeHead(accepted?202:204); res.end(); } catch { reject(400); } });
    });
    server.maxConnections = 4; server.headersTimeout = 4000; server.requestTimeout = 4000;
    await new Promise<void>(resolve => { server.once('error',()=>{if(serial===this.serial)this.life.bridge.state='unavailable: loopback port in use';resolve();}); server.listen(this.port,'127.0.0.1',()=>{if(serial===this.serial)this.life.bridge.state='listening';resolve();}); });
  }
  accept(input: z.input<typeof Page>) {
    const page = Page.parse(input), s=this.life.source('chrome'); if (!s?.permissions.collect || s.paused) return false;
    const url=safePage(page.url); if (!url || url.length>2000 || !s.sites.includes(new URL(url).origin)) return false;
    const now=Date.now(); if (Math.abs(now-page.occurredAt)>120000||!this.life.acceptsRevision('chrome',page.recordId,page.revision)) return false;
    const sections=page.operation!=='delete'&&s.permissions.content&&['semantic','deep'].includes(page.mode)?page.sections.map(section=>({...section,path:cleanEvidence(section.path,300),text:cleanEvidence(section.text.replace(/\r?\n/g,'\u2028'),3000).replace(/\u2028/g,'\n')})):[];
    const stored=this.life.pageSnapshot(url);
    const hash=sections.length?this.life.snapshotPage(url,page.revision,sections):stored?.hash;
    const structure=(sections.length?sections:stored?.sections??[]).filter(s=>s.kind==='heading').slice(0,8).map(s=>({level:s.level,text:s.text.slice(0,120)}));
    const body = s.permissions.content ? (page.mode==='selection'?page.selection:page.mode==='excerpt'?page.excerpt:'') : '';
    const detail={url,contentHash:hash,title:cleanEvidence(page.title,160),headings:page.headings.map(h=>cleanEvidence(h,100)),description:cleanEvidence(page.description,200),structure,approvedContent:cleanEvidence(body,1500),meaning:'Displayed in the focused Chrome tab, not proof of reading.'};
    // Keep identity/hash and valid JSON even when optional metadata exceeds the record budget.
    while(JSON.stringify(detail).length>2400){if(detail.approvedContent.length)detail.approvedContent=detail.approvedContent.slice(0,Math.max(0,detail.approvedContent.length-200));else if(detail.description)detail.description='';else if(detail.headings.length)detail.headings.pop();else if(detail.structure.length)detail.structure.pop();else if(detail.title)detail.title='';else return false;}
    const accepted=this.life.ingest({source:'chrome',recordId:page.recordId,revision:page.revision,type:'displayed-page',occurredAt:page.occurredAt,receivedAt:now,expiresAt:now+90000,entities:this.life.resolve(url+' '+page.title),quality:'observed',permissions:s.permissions,summary:cleanEvidence(`${page.title} (${url})`,600),detail:page.operation==='delete'?'Page no longer active or authorized.':JSON.stringify(detail),operation:page.operation,importance:body.length||sections.length? .65 : .4});
    if(accepted&&page.playback&&s.permissions.content){const p=page.playback;this.life.ingest({source:'chrome',recordId:'playback',revision:page.revision,type:'browser-playback',occurredAt:page.occurredAt,receivedAt:now,expiresAt:now+45000,entities:[],quality:'observed',permissions:s.permissions,summary:`Media ${p.state}: ${cleanEvidence(page.title,200)}`,detail:JSON.stringify({url,...p,meaning:'Authorized visible media element sample, not user attention or accumulated watching duration.'}),operation:page.operation,importance:0});}
    else if(accepted){const prior=this.life.latest().find(e=>e.source==='chrome'&&e.recordId==='playback');if(prior&&page.revision>prior.revision)this.life.ingest({...prior,revision:page.revision,occurredAt:now,receivedAt:now,operation:'delete'});}
    return accepted;
  }
  stop() { this.serial++; this.server?.closeAllConnections(); this.server?.close(); this.server=undefined; }
}
