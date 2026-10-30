import type {LLMProvider} from '../../src/main/ai/providers';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { CognitiveSqlite } from '../../src/main/store/cognitiveSqlite';
import { ConversationScene } from '../../src/main/store/conversationScene';
import { RequestEvidence, revokeDependencies } from '../../src/core/provenance';
import { retainedConversation } from '../../src/core/conversation';
import type { StateRecord } from '../../src/core/contracts';
import { LifeContext, ContextAssembler } from '../../src/main/life/context';
import { disconnectedChrome } from '../../src/shared/lifeContext';
import { CognitiveFoundation } from '../../src/main/cognitive/foundation';
import { ConversationSessions } from '../../src/main/cognitive/conversationSessions';

const directories: string[] = [], stores: CognitiveSqlite[] = [];
const fixture = () => { const dir = fs.mkdtempSync(path.join(os.tmpdir(),'capri-core-')); directories.push(dir); return dir; };
const open = (dir: string) => { const store = new CognitiveSqlite(path.join(dir,'cognitive.sqlite')); stores.push(store); return store; };
const record = (id = 'sample', revision = 1, dependencies: string[] = []): StateRecord => ({ kind:'world',id,revision,at:100,value:{status:'fixture'},dependencies });
afterEach(() => { for (const store of stores.splice(0)) try { store.close(); } catch {} for (const dir of directories.splice(0)) fs.rmSync(dir,{recursive:true,force:true}); });

describe('transactional cognitive foundation', () => {
  it('keeps projections and dependency edges atomic through a failed write', () => {
    const db = open(fixture()); db.put(record());
    expect(() => db.transaction(() => { db.put(record('sample',2,['chrome'])); db.save('partial',{text:'uncommitted'}); throw Error('disk/write fixture'); })).toThrow();
    expect(db.get('world','sample')?.revision).toBe(1); expect(db.load('partial')).toBeUndefined(); expect(db.invalidate('chrome')).toEqual([]);
  });
  it('orders corrections by revision, rejects duplicates and keeps unrelated state', () => {
    const db = open(fixture()); db.put(record('sample',3,['chrome']));
    expect(db.put(record('sample',2))).toBe(false); expect(db.put(record('sample',3))).toBe(false);
    db.put(record('other',1)); db.put({...record('derived',1,['world:sample']),kind:'memory'});
    expect(db.invalidate('chrome')).toEqual(['world:sample','memory:derived']); expect(db.get('world','other')).toBeDefined();
  });
  it('rolls back nested writes while allowing the parent transaction to commit', () => {
    const db = open(fixture()); db.transaction(() => { db.put(record()); try { db.transaction(() => { db.put(record('nested')); throw Error('rollback'); }); } catch {} db.put(record('after')); });
    expect(db.get('world','sample')).toBeDefined(); expect(db.get('world','nested')).toBeUndefined(); expect(db.get('world','after')).toBeDefined();
  });
  it('rejects asynchronous transaction callbacks', () => { const db = open(fixture()); expect(() => db.transaction(() => Promise.resolve())).toThrow('synchronous'); });
  it('opens a verified backup as a complete independent snapshot', () => {
    const dir=fixture(), db=open(dir); db.put(record()); const target=path.join(dir,'backup.sqlite'); db.backup(target); db.put(record('later'));
    const copy=new CognitiveSqlite(target); try { expect(copy.get('world','sample')).toBeDefined(); expect(copy.get('world','later')).toBeUndefined(); } finally { copy.close(); }
    expect(() => db.backup(target)).toThrow('exists');
  });
  it('upgrades v1 transactionally and preserves a verified pre-upgrade backup', () => {
    const dir=fixture(), file=path.join(dir,'cognitive.sqlite'), old=new DatabaseSync(file);
    old.exec('CREATE TABLE records(kind TEXT NOT NULL,id TEXT NOT NULL,revision INTEGER NOT NULL,at REAL NOT NULL,value TEXT NOT NULL,PRIMARY KEY(kind,id)); PRAGMA user_version=1;');
    old.prepare('INSERT INTO records VALUES(?,?,?,?,?)').run('world','legacy',1,100,'{"kept":true}'); old.close();
    const db=open(dir); expect(db.get('world','legacy')?.value).toEqual({kept:true}); db.put(record('new',1,['chrome'])); expect(db.invalidate('chrome')).toEqual(['world:new']);
    expect(fs.readdirSync(dir).some(f=>f.endsWith('.backup'))).toBe(true);
  });
  it('rejects a future schema without overwriting the store', () => {
    const dir=fixture(), file=path.join(dir,'cognitive.sqlite'), old=new DatabaseSync(file); old.exec('PRAGMA user_version=999'); old.close(); const before=fs.readFileSync(file);
    expect(() => open(dir)).toThrow('newer'); expect(fs.readFileSync(file)).toEqual(before);
  });
  it('preserves corrupt stores instead of treating them as an empty profile', () => {
    const dir=fixture(), file=path.join(dir,'cognitive.sqlite'); fs.writeFileSync(file,'broken fixture');
    expect(() => open(dir)).toThrow(); expect(fs.readFileSync(file,'utf8')).toBe('broken fixture');
  });
  it('recovers an uncommitted write after abrupt process termination', () => {
    const dir=fixture(), db=open(dir); db.put(record()); db.close(); stores.pop();
    const file=path.join(dir,'cognitive.sqlite');
    const child=spawnSync(process.execPath,['-e',`const {DatabaseSync}=require('node:sqlite');const d=new DatabaseSync(process.argv[1]);d.exec("BEGIN IMMEDIATE; UPDATE records SET revision=99; INSERT INTO records VALUES('world','partial',1,100,'{}');");process.exit(19)`,file],{encoding:'utf8',windowsHide:true});
    expect(child.status,child.stderr).toBe(19); const recovered=open(dir); recovered.integrity(); expect(recovered.get('world','sample')?.revision).toBe(1); expect(recovered.get('world','partial')).toBeUndefined();
  });
  it('imports old scenes once, restarts from SQLite and respects clear without resurrection', () => {
    const dir=fixture(), db=open(dir), now=Date.now(); const old={version:1,revision:1,entries:[{id:'u',role:'user',text:'Fixture plan',at:now}]};
    fs.writeFileSync(path.join(dir,'conversation-scene.json'),JSON.stringify(old));
    const scene=db.transaction(()=>new ConversationScene(dir,()=>true,()=>true,()=>now,db)); expect(scene.snapshot().entries).toHaveLength(1);
    expect(fs.existsSync(path.join(dir,'conversation-scene.json'))).toBe(true);
    scene.record({id:'a',role:'assistant',text:'A fixture reply',at:now}); expect(new ConversationScene(dir,()=>true,()=>true,()=>now,db).snapshot().entries).toHaveLength(2);
    scene.clear(); expect(new ConversationScene(dir,()=>true,()=>true,()=>now,db).snapshot().entries).toHaveLength(0);
  });
  it('retains direct user evidence through source revocation and excludes derived text on restart', () => {
    const dir=fixture(), db=open(dir), now=Date.now(), scene=new ConversationScene(dir,()=>true,()=>true,()=>now,db);
    scene.record({id:'u',role:'user',text:'My own fixture statement',at:now});
    scene.record({id:'a',role:'assistant',text:'Private source fixture',at:now,contextSources:['chrome']});
    scene.record({id:'b',role:'assistant',text:'Another source fixture',at:now,contextSources:['calendar']});
    scene.invalidateContext('chrome'); expect(scene.snapshot().entries.map(e=>e.id)).toEqual(['u','b']);
    expect(new ConversationScene(dir,()=>true,()=>true,()=>now,db).snapshot().entries.map(e=>e.id)).toEqual(['u']);
  });
  it('clears persistent scenes when history retention is disabled', () => {
    const dir=fixture(),db=open(dir); let persist=true; const scene=new ConversationScene(dir,()=>true,()=>persist,Date.now,db); scene.record({id:'u',role:'user',text:'Fixture',at:Date.now()}); persist=false;scene.privacyChanged();expect(db.load('conversation-scene')).toBeUndefined();
  });
});

describe('host-independent privacy boundaries', () => {
  it('collects only supplied dependencies and isolates requests', () => { const request=new RequestEvidence();expect(request.snapshot()).toEqual([]);request.include(['chrome','chrome']);expect(request.snapshot()).toEqual(['chrome']);request.reset();expect(request.derived).toBe(false); });
  it('cancels before invalidating and does not mutate caller state', () => { const order:string[]=[];revokeDependencies('chrome',{cancel:()=>order.push('cancel'),invalidate:id=>order.push(id!)});expect(order).toEqual(['cancel','chrome']); const input={entries:[{id:'a',contextSources:['chrome']},{id:'u'}],reading:{sourceId:'a'}};expect(retainedConversation(input)).toEqual({entries:[{id:'u'}],reading:undefined});expect(input.entries).toHaveLength(2); });
  it('has no host or provider imports', () => { const root=path.resolve('src/core'); for(const file of fs.readdirSync(root)){expect(fs.readFileSync(path.join(root,file),'utf8')).not.toMatch(/(?:from|require\()\s*['"](?:electron|node:|.*\/main\/|.*providers|.*win32)/);}});
});

describe('migrated host slices', () => {
  it.each(['conversation-scene.json','life-context.json'])('preserves malformed legacy %s without committing an empty replacement', file => {
    const dir=fixture(),db=open(dir);fs.writeFileSync(path.join(dir,file),'broken fixture');
    expect(()=>db.transaction(()=>file==='life-context.json'?new LifeContext(dir,Date.now,()=>{},()=>true,db):new ConversationScene(dir,()=>true,()=>true,Date.now,db))).toThrow('malformed');
    expect(fs.readFileSync(path.join(dir,file),'utf8')).toBe('broken fixture');expect(db.load(file==='life-context.json'?'life-context':'conversation-scene')).toBeUndefined();
  });
  function connected(dir: string, db: CognitiveSqlite, retain = true) {
    const now=Date.now(), life=new LifeContext(dir,()=>now,()=>{},()=>true,db);
    life.configure({...disconnectedChrome(),permissions:{collect:true,live:true,proactive:true,retain,learn:false,content:false}});
    const event={source:'chrome',recordId:'fixture',revision:1,type:'displayed-page',occurredAt:now,receivedAt:now,expiresAt:now+60000,entities:[],quality:'observed',permissions:{collect:true,live:true,proactive:true,retain,learn:false,content:false},summary:'Fixture article',detail:'Synthetic evidence only',operation:'upsert',importance:.7};
    return {life,event,now};
  }
  it('stores observations, correction ordering and deferred attention together through restart', () => {
    const dir=fixture(),db=open(dir),{life,event,now}=connected(dir,db);expect(life.ingest(event)).toBe(true);
    const first=life.view().candidates[0];life.offered(first.id);
    const restarted=new LifeContext(dir,()=>now,()=>{},()=>true,db);expect(restarted.current()[0].summary).toBe('Fixture article');expect(restarted.view().candidates[0].attempts).toBe(1);expect(restarted.ingest(event)).toBe(false);
    expect(restarted.ingest({...event,revision:2,operation:'correct',quality:'user-statement',summary:'Corrected fixture'})).toBe(true);
    expect(new LifeContext(dir,()=>now,()=>{},()=>true,db).current()[0].summary).toBe('Corrected fixture');
  });
  it('keeps nonretained evidence in the current session only', () => {
    const dir=fixture(),db=open(dir),{life,event,now}=connected(dir,db,false);life.ingest(event);expect(life.current()).toHaveLength(1);
    const restarted=new LifeContext(dir,()=>now,()=>{},()=>true,db);expect(restarted.current()).toHaveLength(0);expect(restarted.view().candidates).toHaveLength(0);
  });
  it('tags admitted evidence and no enabled-but-empty source', () => {
    const {life,event}=connected(fixture(),open(fixture()));const assembler=new ContextAssembler(life);assembler.assemble('hello');expect(assembler.suppliedSources).toEqual([]);
    life.ingest(event);assembler.assemble('fixture');expect(assembler.suppliedSources).toEqual(['chrome']);assembler.assemble('fixture',{},0);expect(assembler.suppliedSources).toEqual([]);
  });
  it('keeps revoked source data out of the retained legacy rollback file', () => {
    const dir=fixture(),db=open(dir),{life,event}=connected(dir,db);life.ingest(event);
    fs.writeFileSync(path.join(dir,'life-context.json'),JSON.stringify(db.load('life-context')));life.forget('chrome');
    const legacy=JSON.parse(fs.readFileSync(path.join(dir,'life-context.json'),'utf8'));expect(legacy.events).toEqual([]);expect(legacy.sources[0].permissions.collect).toBe(false);expect(new LifeContext(dir,Date.now,()=>{},()=>true,db).current()).toEqual([]);
  });
  it('invalidates invocation metadata without removing ordinary checkpoints or approved-store files', () => {
    const dir=fixture(),foundation=new CognitiveFoundation(dir,()=>true,()=>true);stores.push(foundation.store);const requests=new RequestEvidence();requests.include(['chrome']);
    foundation.scene.record({id:'u',role:'user',text:'My fixture statement',at:Date.now()});foundation.session({id:'turn',revision:0,dependencies:['chrome']});fs.writeFileSync(path.join(dir,'memory.json'),'[{"id":"approved-fixture"}]');
    foundation.receipt({id:'receipt',requestId:'request',at:Date.now(),outcome:'completed',detail:'get_time',dependencies:['chrome']});expect(foundation.store.get('receipt','latest')?.value).toMatchObject({outcome:'completed'});
    const order:string[]=[];foundation.revoke('chrome',()=>order.push('cancel'),()=>order.push('legacy'),[requests]);expect(order).toEqual(['cancel','legacy']);expect(foundation.store.get('session','current-chat')).toBeUndefined();expect(foundation.store.get('receipt','latest')).toBeUndefined();expect(foundation.scene.snapshot().entries).toHaveLength(1);expect(fs.readFileSync(path.join(dir,'memory.json'),'utf8')).toContain('approved-fixture');expect(requests.derived).toBe(false);
  });
  it('adapts an existing provider without changing role order and cancels on dependency revocation', async () => {
    let received:unknown,aborted=false;
    const provider:LLMProvider={name:'fixture',local:true,test:async()=>({ok:true,detail:'fixture',latencyMs:0}),listModels:async()=>[],async *stream(messages,opts){received=messages;opts.signal.addEventListener('abort',()=>{aborted=true;});yield 'fixture';}};
    const runtime=new ConversationSessions({} as any,open(fixture()),()=>true,()=>[]);
    const messages=[{role:'user' as const,content:'A synthetic question'}], stream=runtime.respond(provider,messages,{temperature:0,maxTokens:20,timeoutMs:1000,signal:new AbortController().signal},{private:false,dependencies:['chrome'],instructions:'',model:'fixture'});
    expect((await stream.next()).value).toBe('fixture');runtime.invalidate('chrome');expect(aborted).toBe(true);expect(received).toEqual(messages);await stream.return(undefined);
  });
});
