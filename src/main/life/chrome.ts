import http from 'node:http';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { safePage, cleanEvidence, chromeSiteAllowed } from '../../shared/lifeContext';
import { LifeContext } from './context';
import { PageSection } from './perception';
const Page = z.object({ readRequestId:z.string().uuid().optional(), recordId:z.string().min(1).max(100), revision:z.number().int().nonnegative(), occurredAt:z.number().finite(), url:z.string().max(2000), title:z.string().max(300), headings:z.array(z.string().max(200)).max(8), description:z.string().max(500).default(''), selection:z.string().max(1500).default(''), excerpt:z.string().max(1500).default(''), mode:z.enum(['metadata','selection','excerpt','semantic','deep']).default('metadata'), sections:z.array(PageSection).max(80).default([]), playback:z.object({state:z.enum(['playing','paused','ended']),position:z.number().min(0).max(864000),duration:z.number().min(0).max(864000).nullable()}).strict().optional(), incognito:z.literal(false), focused:z.literal(true), visible:z.literal(true), operation:z.enum(['upsert','delete']).default('upsert') }).strict();
export const ChromePage = Page;
/** Authenticated loopback, fixed Host and exact extension Origin. No browser CORS wildcard. */
export class ChromeBridge {
  private lastIntake: 'extension' | 'controlled-test' | null = null;
  private lastAcceptedAt?: number;
  preflight(url?: string) {
    const source = this.life.source('chrome'), credentials = this.credentials();
    const paired = /^[a-p]{32}$/.test(credentials.extensionId ?? '') && (credentials.token?.length ?? 0) >= 32;
    const safe = url === undefined ? undefined : safePage(url);
    const authorized = !!source?.permissions.collect && !source.paused && !!source.permissions.content && !!source.permissions.live && (url === undefined || !!safe && chromeSiteAllowed(source.sites, safe));
    return { status: !authorized ? 'source-disallowed' : paired && this.life.bridge.state === 'listening' ? 'paired-authorized' : 'unavailable-or-unpaired', paired, authorized, transport: this.life.bridge.state, lastIntake: this.lastIntake, lastAcceptedAt: this.lastAcceptedAt, deliveringRecently: this.lastIntake === 'extension' && !!this.lastAcceptedAt && Date.now() - this.lastAcceptedAt < 90000 };
  }
  private reading?: { id: string; startedAt: number; delivered: boolean; finish(status: string): void };
  private reader?: http.ServerResponse;
  requestPage(signal: AbortSignal): Promise<{ status: string }> {
    signal.throwIfAborted();
    if (this.preflight().status !== 'paired-authorized') return Promise.resolve({ status: 'unavailable-or-disallowed' });
    if (this.reading) return Promise.resolve({ status: 'busy' });
    return new Promise(resolve => {
      const abort = () => finish('cancelled');
      const timeout = setTimeout(() => finish('extension-timeout'), 8000);
      const finish = (status: string) => {
        clearTimeout(timeout);
        signal.removeEventListener('abort', abort);
        this.reading = undefined;
        resolve({ status });
      };
      this.reading = { id: randomUUID(), startedAt: Date.now(), delivered: false, finish };
      signal.addEventListener('abort', abort, { once: true });
      if (signal.aborted) abort();
      else this.deliverRead();
    });
  }
  isRequestedRead(id?: string) { return id !== undefined && id === this.reading?.id; }
  private deliverRead() {
    if (!this.reader || !this.reading || this.reading.delivered) return;
    this.reading.delivered = true;
    this.reader.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    this.reader.end(JSON.stringify({ id: this.reading.id, mode: 'semantic', expiresAt: this.reading.startedAt + 8000 }));
    this.reader = undefined;
  }
  private server?: http.Server; private last = 0; private serial = 0;
  private rawSink?: (page: z.infer<typeof Page>, intake: 'extension' | 'controlled-test') => boolean | Promise<boolean>;
  private rawRevisions = new Map<string, number>();
  setRawSink(sink: NonNullable<ChromeBridge['rawSink']>) { this.rawSink = sink; }
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
      if (req.headers.host !== `127.0.0.1:${this.port}` || req.headers.origin !== origin || !['/v1/page','/v1/status','/v1/read-request'].includes(req.url ?? '')) return reject(403);
      res.setHeader('Access-Control-Allow-Origin',origin); res.setHeader('Vary','Origin');
      if (req.method === 'OPTIONS') { res.setHeader('Access-Control-Allow-Methods','POST, GET'); res.setHeader('Access-Control-Allow-Headers','authorization,content-type'); return reject(204); }
      const provided = Buffer.from(req.headers.authorization ?? ''), expected = Buffer.from('Bearer '+credentials.token);
      if (provided.length !== expected.length || !timingSafeEqual(provided,expected)) return reject(401);
      if (req.method === 'POST' && req.url === '/v1/read-request' && req.headers['content-type']?.startsWith('application/json')) {
        if (this.reader) { this.reader.writeHead(204); this.reader.end(); }
        this.reader = res;
        const timer = setTimeout(() => { if (!res.writableEnded) { res.writeHead(204); res.end(); } }, 20000);
        res.on('close', () => { clearTimeout(timer); if (this.reader === res) this.reader = undefined; });
        this.deliverRead();
        return;
      }
      if (req.method === 'POST' && req.url === '/v1/status') { res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'}); res.end(JSON.stringify({ paired: true })); return; }
      if (req.method !== 'POST' || req.url !== '/v1/page' || !req.headers['content-type']?.startsWith('application/json')) return reject(401);
      if (Date.now()-this.last < 200) return reject(429); this.last = Date.now();
      let size = 0, body = ''; req.setTimeout(3000,()=>req.destroy());
      req.on('data', chunk => { size += chunk.length; if (size>256000) { req.destroy(); return; } body += chunk.toString(); });
      req.on('end',async()=>{ try { const data=Page.parse(JSON.parse(body)); const accepted=await this.accept(data, 'extension');
        if (this.reading) {
          if (accepted && data.operation === 'upsert' && data.mode === 'semantic' && data.occurredAt >= this.reading.startedAt) this.reading.finish('accepted');
          else if (data.readRequestId === this.reading.id) this.reading.finish('disallowed-or-paused');
        }
        res.writeHead(accepted?202:204); res.end(); } catch { reject(400); } });
    });
    server.maxConnections = 4; server.headersTimeout = 4000; server.requestTimeout = 4000;
    await new Promise<void>(resolve => { server.once('error',()=>{if(serial===this.serial)this.life.bridge.state='unavailable: loopback port in use';resolve();}); server.listen(this.port,'127.0.0.1',()=>{if(serial===this.serial)this.life.bridge.state='listening';resolve();}); });
  }
  accept(input: z.input<typeof Page>, intake: 'extension' | 'controlled-test' = 'controlled-test') {
    const page = Page.parse(input), s=this.life.source('chrome'); if (!s?.permissions.collect || s.paused) return false;
    const url=safePage(page.url); if (!url || url.length>2000 || !chromeSiteAllowed(s.sites, url)) return false;
    const now=Date.now(); if (Math.abs(now-page.occurredAt)>120000||!this.life.acceptsRevision('chrome',page.recordId,page.revision)) return false;
    if (this.rawSink) {
      if (page.revision <= (this.rawRevisions.get(page.recordId) ?? -1)) return false;
      const content = s.permissions.content;
      const sanitized = { ...page, url, title: cleanEvidence(page.title,300), headings: page.headings.map(h => cleanEvidence(h,200)), description: cleanEvidence(page.description,500), selection: content ? cleanEvidence(page.selection,1500) : '', excerpt: content ? cleanEvidence(page.excerpt,1500) : '', sections: content ? page.sections.map(section => ({ ...section, path: cleanEvidence(section.path,300), text: cleanEvidence(section.text.replace(/\r?\n/g,'\u2028'),3000).replace(/\u2028/g,'\n') })) : [] };
      const finish = (accepted: boolean) => {
        if (!accepted) return false;
        this.lastIntake = intake;
        this.lastAcceptedAt = Date.now();
        this.rawRevisions.set(page.recordId, Math.max(page.revision, this.rawRevisions.get(page.recordId) ?? -1)); if (this.rawRevisions.size > 100) this.rawRevisions.delete(this.rawRevisions.keys().next().value!);
        return true;
      };
      const accepted = this.rawSink(sanitized, intake); return accepted instanceof Promise ? accepted.then(finish) : finish(accepted);
    }
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
  stop() { this.reading?.finish('stopped'); this.reader?.end(); this.reader = undefined; this.serial++; this.server?.closeAllConnections(); this.server?.close(); this.server=undefined; }
}
