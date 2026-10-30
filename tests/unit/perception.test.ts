import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {afterEach,expect,it} from 'vitest';
import {LifeContext,ContextAssembler} from '../../src/main/life/context';
import {ChromeBridge} from '../../src/main/life/chrome';
import {LifeService} from '../../src/main/life/service';
import {SecretStore} from '../../src/main/store/secrets';
import {SocialAcademic} from '../../src/main/life/socialAcademic';
import {CommunicationAdapter,emptyCommunication} from '../../src/main/life/communications';
import {CommunicationAccount} from '../../src/shared/communications';
import {GoogleCalendar} from '../../src/main/life/calendar';
import {investigation,normalizedSections,relevantSections,worldFacts} from '../../src/main/life/perception';
import type {LifeObservation} from '../../src/shared/lifeContext';
const dirs:string[]=[],cleanups:(()=>void)[]=[];
afterEach(()=>{for(const f of cleanups.splice(0))f();for(const d of dirs.splice(0))fs.rmSync(d,{recursive:true,force:true,maxRetries:5});});
function setup(){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'capri-perception-'));dirs.push(dir);let now=Date.now();const secrets=new SecretStore(dir,{available:()=>true,encrypt:s=>Buffer.from(s),decrypt:b=>b.toString()});const service=new LifeService(dir,secrets,()=>{},()=>true,()=>true);cleanups.push(()=>service.stop());const life=service.ledger; // Real service creates all configured integration slots.
  const enable=(id:string,extra={})=>life.configure({...life.source(id)!,permissions:{collect:true,live:true,proactive:true,retain:true,content:true,learn:false,...extra},...(id==='chrome'?{sites:['https://docs.example.com','https://www.youtube.com']}: {})});
  return{dir,secrets,service,life,enable,get now(){return now;},event:(patch:Partial<LifeObservation>={}):LifeObservation=>({source:'chrome',recordId:'active',revision:1,type:'displayed-page',occurredAt:now,receivedAt:now,expiresAt:now+86400000,entities:[],quality:'observed',permissions:{collect:true,live:true,proactive:true,retain:true,content:true,learn:false},summary:'A displayed homework page',detail:'',operation:'upsert',importance:.7,...patch})};}
const response=(data:unknown)=>new Response(JSON.stringify(data),{status:200,headers:{'content-type':'application/json'}});
it('separates detection, permission, relevance, availability and cost without a model',()=>{
 const base={permitted:true,available:true,novel:true,usefulness:.8,cost:1,remaining:1,unavailable:false};
 expect(investigation(base).action).toBe('investigate');for(const p of [{permitted:false},{novel:false},{usefulness:.1}])expect(investigation({...base,...p}).action).toBe('silent');for(const p of [{available:false},{unavailable:true},{remaining:0}])expect(investigation({...base,...p}).action).toBe('defer');
});
it('retains structured approved pages, retrieves matching sections and removes them on revocation/restart',()=>{
 const s=setup();s.enable('chrome');const at=Date.now(),bridge=new ChromeBridge(s.life,()=>({token:'',extensionId:''}));
 const page={recordId:'active-page',revision:at,occurredAt:at,url:'https://docs.example.com/FBD',title:'Free body diagrams',headings:['Forces'],mode:'semantic' as const,incognito:false as const,focused:true as const,visible:true as const,sections:[{kind:'paragraph' as const,level:0,path:'Forces',text:'Balance reaction forces at a pin joint.'},{kind:'code' as const,level:0,path:'Unrelated code',text:'UNRELATED_PAYLOAD '.repeat(150)}]};
 expect(bridge.accept(page)).toBe(true);expect(bridge.accept({...page,revision:at-1,sections:[]})).toBe(false);
 expect(s.life.developmentSections(s.life.current()[0]).length).toBeGreaterThan(0);
 const prompt=s.service.assembler.assemble('reaction forces');expect(prompt).toContain('pin joint');expect(prompt).not.toContain('UNRELATED_PAYLOAD');expect(prompt.length).toBeLessThan(9500);expect(s.service.assembler.suppliedSources).toContain('chrome');
 s.life.flush();const restored=new LifeContext(s.dir);expect(restored.readPage('reaction forces')).toHaveLength(1);restored.forget('chrome');restored.flush();expect(fs.readFileSync(path.join(s.dir,'life-context.json'),'utf8')).not.toContain('pin joint');expect(restored.readPage('forces')).toEqual([]);
 expect(restored.developmentSections(s.life.current()[0])).toEqual([]);
});
it('does not store content with metadata-only access or volatile retention',()=>{
 const s=setup();s.enable('chrome',{content:false});expect(s.life.snapshotPage('https://docs.example.com',1,[{kind:'paragraph',level:0,path:'',text:'PRIVATE'}])).toBeUndefined();
 s.enable('chrome',{retain:false});s.life.snapshotPage('https://docs.example.com',1,[{kind:'paragraph',level:0,path:'',text:'VOLATILE'}]);s.life.flush();expect(fs.readFileSync(path.join(s.dir,'life-context.json'),'utf8')).not.toContain('VOLATILE');
});
it('keeps valid attributed snapshot identity when long optional metadata fills the event budget',()=>{
 const s=setup();s.enable('chrome');const at=Date.now(),bridge=new ChromeBridge(s.life,()=>({token:'',extensionId:''}));expect(bridge.accept({recordId:'long',revision:at,occurredAt:at,url:'https://docs.example.com/'+('a'.repeat(1700)),title:'Long document',headings:Array(8).fill('Heading '.repeat(25)),description:'Description '.repeat(35),mode:'deep',sections:[{kind:'paragraph',level:0,path:'',text:'A real pin joint reaction is 12 N.'}],incognito:false,focused:true,visible:true})).toBe(true);
 const e=s.life.current()[0],d=JSON.parse(e.detail);expect(d.contentHash).toBeDefined();expect(e.detail.length).toBeLessThanOrEqual(2400);expect(s.life.developmentSections(e)[0].text).toContain('12 N');
});
it('treats refresh, scrolling metadata and equivalent structure as the same development, then reopens on content change',()=>{
 const s=setup();s.enable('chrome');const at=Date.now(),bridge=new ChromeBridge(s.life,()=>({token:'',extensionId:''}));const page={recordId:'active',revision:at,occurredAt:at,url:'https://docs.example.com/FBD',title:'FBD',headings:['Forces'],mode:'semantic' as const,incognito:false as const,focused:true as const,visible:true as const,sections:[{kind:'paragraph' as const,level:0,path:'',text:'Balance reaction forces.'}]};
 bridge.accept(page);const id=s.life.view().candidates[0].id;s.life.settle(id,'delivered');bridge.accept({...page,revision:at+1,description:'Refresh-only description'});expect(s.life.view().candidates).toHaveLength(1);expect(s.life.view().candidates[0].phase).toBe('discussed');
 bridge.accept({...page,revision:at+2,sections:[{...page.sections[0],text:'A new applied moment changes the balance.'}]});expect(s.life.view().candidates).toHaveLength(2);expect(s.life.view().candidates.at(-1)?.status).toBe('pending');
});
it('defers important real mail during a game, survives restart and coalesces a related meeting tomorrow',async()=>{
 const s=setup();s.enable('gmail-0');s.enable('calendar');s.life.associate({id:'research',name:'Research',aliases:['Research review'],evidence:'User configured research project'});
 const cp=emptyCommunication();cp.cursor='10';const at=Date.now(),adapter=new CommunicationAdapter(s.life,(async raw=>{const u=String(raw);if(u.includes('/history'))return response({historyId:'11',history:[{messagesAdded:[{message:{id:'m1'}}]}]});return response({id:'m1',labelIds:['INBOX'],threadId:'review',internalDate:String(at),payload:{headers:[{name:'Subject',value:'Research review request'},{name:'From',value:'advisor@example.test'},{name:'Date',value:new Date(at).toISOString()}]}});}) as typeof fetch);
 await adapter.gmail(CommunicationAccount.parse({id:'gmail-0'}),'fixture',cp,new AbortController().signal,()=>true);
 const mail=s.life.current().find(e=>e.source==='gmail-0')!;expect(mail).toBeDefined();
 s.life.ingest(s.event({source:'calendar',recordId:'review',type:'calendar-scheduled',summary:'Research review',detail:JSON.stringify({startAt:at+20*3600000,endAt:at+21*3600000}),importance:.4}));
 s.life.deferAttention('Availability: game_call');s.life.flush();const restored=new LifeContext(s.dir,()=>at+2*3600000);const c=restored.candidate('Research review')!;expect(c).toBeDefined();expect(c.reason).toContain('game_call');expect(c.attempts).toBe(0);expect(restored.bundle(c.id).map(e=>e.source)).toEqual(['gmail-0','calendar']);restored.settle(c.id,'delivered');restored.flush();expect(restored.candidate()).toBeUndefined();expect(restored.view().candidates[0].phase).toBe('discussed');
});
it('does not revive source-revoked deferred attention or acknowledged unchanged issues',()=>{
 const s=setup();s.enable('chrome');s.life.ingest(s.event());const id=s.life.view().candidates[0].id;s.life.acknowledge(id);s.life.ingest(s.event({revision:2}));expect(s.life.view().candidates).toHaveLength(1);expect(s.life.view().candidates[0].phase).toBe('resolved');s.life.deferAttention('game');s.life.forget('chrome');expect(s.life.view().candidates).toEqual([]);expect(s.life.world()).toEqual([]);
});
it('distinguishes assignment viewing, third-party notices, source confirmation and explicit user submission',()=>{
 const s=setup();const viewed=s.event(),notice=s.event({source:'gmail-0',recordId:'notice',type:'academic-submission-notice',summary:'Submission received email'}),receipt=s.event({source:'academic',recordId:'receipt',type:'academic-submitted',summary:'Provider submission receipt',detail:JSON.stringify({course:'ME239',assignment:'HW7',status:'submitted'})});
 expect(worldFacts([viewed],s.now)[0].value).toContain('submission and watching duration unknown');expect(worldFacts([notice],s.now)[0].status).toBe('unknown');expect(worldFacts([receipt],s.now)[0].status).toBe('authoritative');
 s.enable('academic');new SocialAcademic(s.life).academic([{id:'hw7',course:'ME239',assignment:'HW7',status:'submitted',at:new Date().toISOString(),evidence:'I already submitted'}]);expect(s.life.world()[0].status).toBe('user-reported');expect(s.life.world()[0].value).toContain('submitted');
});
it('records a named direct submission report, suppresses its callback, preserves attribution and accepts a correction',()=>{
 const s=setup();s.enable('academic');new SocialAcademic(s.life).academic([{id:'hw7',course:'ME239',assignment:'Homework 7',status:'due',at:new Date().toISOString(),due:new Date(Date.now()+3600000).toISOString(),evidence:'Known assignment'}]);s.life.maintain();
 s.life.userMessage('I already submitted Homework 7.','user-report',Date.now());expect(s.life.userReports()[0].quality).toBe('user-statement');expect(s.life.userReports()[0].type).toBe('academic-submitted');expect(s.life.view().candidates.every(c=>c.status==='dismissed')).toBe(true);const prompt=s.service.assembler.assemble('Homework 7');expect(prompt).toContain('User-reported submitted');expect(s.service.assembler.suppliedSources).not.toContain('user');
 s.life.userMessage("Actually I haven't submitted Homework 7.",'correction',Date.now()+1);expect(s.life.userReports()).toHaveLength(1);expect(s.life.userReports()[0].type).toBe('academic-not-submitted');s.life.forget('academic');expect(s.life.userReports()).toHaveLength(0); // Source-associated reports are withdrawn; the authored Chat message is retained by History.
s.life.clear();expect(s.life.userReports()).toEqual([]);
});
it('keeps a failed network sync and delayed source events from inventing current developments',async()=>{
 const s=setup();s.enable('gmail-0');const cp=emptyCommunication();cp.cursor='10';const adapter=new CommunicationAdapter(s.life,(async()=>{throw Error('fixture network outage');}) as typeof fetch);await expect(adapter.gmail(CommunicationAccount.parse({id:'gmail-0'}),'fixture',cp,new AbortController().signal,()=>true)).rejects.toThrow('network');expect(cp.cursor).toBe('10');expect(s.life.current()).toEqual([]);
 s.life.ingest(s.event({source:'gmail-0',recordId:'delayed',type:'request-claim',occurredAt:s.now-3600000,summary:'Delayed research request'}));expect(s.life.view().candidates).toEqual([]);expect(s.life.world()[0].at).toBe(s.now-3600000);
});
it('uses real Calendar response fixtures for next-day horizon crossing without repeated reminders',async()=>{
 const s=setup();s.enable('calendar');const at=Date.now(),calendar=new GoogleCalendar(s.secrets,s.life,(async raw=>String(raw).includes('oauth2')?response({access_token:'fixture'}):response({timeZone:'UTC',nextSyncToken:'done',items:[{id:'review',summary:'Research review',status:'confirmed',start:{dateTime:new Date(at+20*3600000).toISOString()},end:{dateTime:new Date(at+21*3600000).toISOString()}}]})) as typeof fetch);s.secrets.set('googleRefresh','fixture');
 await calendar.sync(['research'],{},new AbortController().signal,()=>true);expect(s.life.world()[0].kind).toBe('meeting');s.life.maintain();expect(s.life.view().candidates).toHaveLength(1);s.life.acknowledge(s.life.view().candidates[0].id);s.life.maintain();expect(s.life.view().candidates).toHaveLength(1);
});
it('associates CAD activity only with an approved research folder, never geometry or success',()=>{
 const s=setup();s.life.configure({id:'project:cad',kind:'project',name:'Research CAD',folder:s.dir,entityId:'research',permissions:{collect:true,live:true,retain:true,content:false,learn:false}});s.life.associate({id:'research',name:'Research',aliases:[s.dir],source:'project:cad',evidence:'Explicitly selected folder'});
 const event=s.event({source:'project:cad',type:'file-modified',summary:'Research CAD: bracket.sldprt',entities:['research'],detail:'Metadata only.'});s.life.ingest(event);s.life.ingest({...event,revision:2});expect(s.life.view().candidates).toHaveLength(1);expect(s.life.world()[0].value).toContain('Geometry and success unknown');expect(s.life.world()[0].entities).toEqual(['research']);
});
it('labels location, return and playback without inventing exercise or watching duration',()=>{
 const s=setup();const facts=worldFacts([s.event({type:'location-geofence',summary:'Phone inside gym geofence'}),s.event({recordId:'return',type:'pc-return',summary:'Keyboard activity resumed'}),s.event({recordId:'playback',type:'browser-playback',summary:'Video paused',detail:'{"state":"paused","position":91}'})],s.now);
 expect(facts[0].value).toContain('User activity unknown');expect(facts[1].value).toBe('Keyboard activity resumed');expect(facts[2].value).toContain('not accumulated watching duration');
});
it('handles authorized local game and Discord observations without claiming gameplay or voice from a process',()=>{
 const s=setup();s.enable('discord-local');const social=new SocialAcademic(s.life);social.local({process:'game.exe',title:'Game'},['game.exe']);expect(s.life.current()[0].type).toBe('local-game-foreground');expect(s.life.current()[0].detail).toContain('Not account presence');social.local(null,['game.exe']);expect(s.life.current()).toEqual([]);social.local({process:'Discord.exe',title:'Private conversation title'},[]);expect(s.life.current()[0].summary).not.toContain('Private');expect(s.life.current()[0].type).toBe('discord-foreground');
});
it('bounds content, context and repeated event cost with zero ingestion model calls',()=>{
 const s=setup();s.enable('chrome');const sections=normalizedSections(Array.from({length:80},()=>({kind:'paragraph' as const,path:'Forces',level:0,text:'reaction forces '.repeat(200)})));expect(sections.reduce((n,s)=>n+s.text.length,0)).toBeLessThanOrEqual(48000);
 const start=performance.now();for(let i=0;i<250;i++)s.life.ingest(s.event({revision:i+1}));expect(s.life.view().candidates).toHaveLength(1);expect(s.life.diagnostics().backgroundModelsOnIngest).toBe(0);expect(performance.now()-start).toBeLessThan(5000);
 expect(relevantSections(sections,'reaction',900).reduce((n,s)=>n+s.text.length,0)).toBeLessThanOrEqual(900);expect(new ContextAssembler(s.life).assemble('reaction',{},600).length).toBeLessThanOrEqual(600);
});
