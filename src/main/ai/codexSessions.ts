import { spawn, execFileSync, type ChildProcessWithoutNullStreams } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import type { PersistentSessions, SessionHandle, SessionInput, SessionStart } from '../../core/modelSessions';
import { CODEX_ENGINE, CODEX_LEAN_CONFIG, codexRequests, codexRetryDelay, findCodex } from './codexAccount';
import { ProviderError } from './providerError';

type Rpc = { id?: number; method?: string; params?: any; result?: any; error?: { message: string; code?: number } };
/** Private stdio server, never the user's shared daemon. Unknown server requests fail closed. */
export class CodexSessions implements PersistentSessions {
  private child?: ChildProcessWithoutNullStreams;
  private seq = 0;
  private pending = new Map<number, { resolve(v: any): void; reject(e: Error): void; timer: ReturnType<typeof setTimeout> }>();
  private events = new EventEmitter();
  private ready?: Promise<void>;
  private methods = new Set<string>();
  private root = '';
  private loaded = new Set<string>();
  readonly stats = { requests: 0, rejectedTools: 0 };
  constructor(private configOverrides: string[] = []) {}
  private removeWorkingDirectory(root:string) {
    if(root && path.dirname(path.resolve(root))===path.resolve(os.tmpdir()) && path.basename(root).startsWith('capri-session-')) {
      try {fs.rmSync(root,{recursive:true,force:true,maxRetries:3,retryDelay:100});}catch{/* an OS-held temporary folder can be cleaned later */}
    }
  }
  private send(message: Rpc) { this.child?.stdin.write(JSON.stringify(message) + '\n'); }
  private fail(error: Error) {
    for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(error); }
    this.pending.clear(); this.loaded.clear(); this.events.emit('failure', error);
  }
  private async boot() {
    if (this.ready) return this.ready;
    this.ready = (async () => {
      if(!this.root)this.root=fs.mkdtempSync(path.join(os.tmpdir(),'capri-session-'));
      const exe = findCodex(); if (!exe) throw new ProviderError('Codex App Server unavailable.', 'config');
      // Export the installed protocol, including optional lifecycle operations. No network inference.
      execFileSync(exe, ['app-server', 'generate-json-schema', '--experimental', '--out', path.join(this.root, 'schema')], { windowsHide: true, timeout: 15000, stdio: 'ignore' });
      const schema = JSON.parse(fs.readFileSync(path.join(this.root, 'schema', 'ClientRequest.json'), 'utf8'));
      this.methods.clear();
      for (const item of schema.oneOf ?? []) for (const method of item.properties?.method?.enum ?? []) this.methods.add(method);
      for (const required of ['initialize','thread/start','thread/resume','turn/start','turn/interrupt']) if (!this.methods.has(required)) throw new ProviderError('Installed Codex protocol lacks ' + required, 'config');
      const turnSchema=JSON.parse(fs.readFileSync(path.join(this.root,'schema','v2','TurnStartParams.json'),'utf8'));
      const startSchema=JSON.parse(fs.readFileSync(path.join(this.root,'schema','v2','ThreadStartParams.json'),'utf8'));
      if(!turnSchema.properties.additionalContext?.additionalProperties || !startSchema.properties.environments || !startSchema.properties.ephemeral)throw new ProviderError('Installed Codex lacks safe companion session fields.','config');
      const config = [...CODEX_LEAN_CONFIG, 'features.hooks=false', 'features.skip_host_skill_discovery=true', 'features.skill_mcp_dependency_install=false', 'features.remote_plugin=false', 'features.environment_access=false', 'mcp_servers={}', 'plugins={}', 'hooks={}', 'tools.apply_patch.enabled=false', 'tools.view_image.enabled=false', 'tools.exec_command.enabled=false', 'tools.write_stdin.enabled=false'];
      this.child = spawn(exe, ['app-server', '--listen', 'stdio://', ...[...config,...this.configOverrides].flatMap(c => ['-c',c])], { cwd: this.root, windowsHide: true, stdio: ['pipe','pipe','pipe'] });
      const child=this.child,root=this.root;
      let buffer = '';
      this.child.stdout.setEncoding('utf8');
      this.child.stdout.on('data', chunk => {
        buffer += chunk;
        if (buffer.length > 8_000_000) { this.close(); return; }
        let i: number;
        while ((i = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0,i); buffer = buffer.slice(i+1);
          try { this.receive(JSON.parse(line)); } catch { /* diagnostics are never dialogue */ }
        }
      });
      this.child.stderr.resume(); this.child.stdin.on('error',()=>{});
      this.child.on('error',()=>this.fail(new ProviderError('Codex App Server could not start.','config')));
      this.child.on('close',()=>{this.removeWorkingDirectory(root);if(this.child===child){this.ready=undefined;this.child=undefined;this.root='';this.fail(new ProviderError('Codex App Server stopped.','server'));}});
      await this.rpc('initialize',{clientInfo:{name:'capri_companion',title:'Capri',version:'0.8.0'},capabilities:{experimentalApi:true}});
      this.send({method:'initialized',params:{}});
    })();
    try { await this.ready; } catch { this.close();throw new ProviderError('Installed Codex App Server could not initialize safely; CLI fallback is available.','config'); }
  }
  private receive(message: Rpc) {
    if (message.id !== undefined && message.method) {
      this.stats.rejectedTools++;
      this.send({id:message.id,error:{code:-32601,message:'Companion session has no native tools or approvals.'}}); return;
    }
    if (message.id !== undefined) {
      const p=this.pending.get(message.id); if (!p) return;
      clearTimeout(p.timer);this.pending.delete(message.id);
      if (message.error) p.reject(new ProviderError(message.error.message,'server')); else p.resolve(message.result);
    } else this.events.emit('event',message);
  }
  private rpc(method: string, params: unknown, timeout = 20000): Promise<any> {
    const id=++this.seq;this.stats.requests++;
    return new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{this.pending.delete(id);reject(new ProviderError('Codex session request timed out.','timeout'));},timeout);
      this.pending.set(id,{resolve,reject,timer});this.send({id,method,params});
    });
  }
  async capabilities() { await this.boot(); return this.methods as ReadonlySet<string>; }
  private options(model: string, instructions: string) { return {model,baseInstructions:CODEX_ENGINE,developerInstructions:instructions,cwd:this.root,sandbox:'read-only',approvalPolicy:'never',config:{mcp_servers:{},plugins:{},hooks:{}},runtimeWorkspaceRoots:[]}; }
  async start(o: SessionStart): Promise<SessionHandle> {
    await this.boot();
    const r=await this.rpc('thread/start',{...this.options(o.model,o.instructions),environments:[],selectedCapabilityRoots:[],dynamicTools:[],ephemeral:!['primary','project'].includes(o.scope)});
    this.loaded.add(r.thread.id);
    return {id:r.thread.id,provider:'codex-app-server',model:o.model,scope:o.scope,dependencies:[...o.dependencies],turns:0};
  }
  async resume(h: SessionHandle, instructions: string) { await this.boot(); if(this.loaded.has(h.id))return;await this.rpc('thread/resume',{threadId:h.id,...this.options(h.model,instructions)});this.loaded.add(h.id); }
  async fork(h: SessionHandle) {
    await this.boot();if(!this.methods.has('thread/fork'))throw new ProviderError('Fork unavailable.','config');
    // Inherit the parent's stable character instructions; only restrict the new host boundary.
    const r=await this.rpc('thread/fork',{threadId:h.id,ephemeral:true,excludeTurns:true,model:h.model,cwd:this.root,sandbox:'read-only',approvalPolicy:'never',runtimeWorkspaceRoots:[],config:{mcp_servers:{},plugins:{},hooks:{}}});
    this.loaded.add(r.thread.id);return {...structuredClone(h),id:r.thread.id,scope:'private' as const};
  }
  async *respond(h: SessionHandle, input: SessionInput): AsyncGenerator<string> {
    await this.boot();
    const queue: string[]=[];let wake=()=>{};let done=false, failure: Error|undefined, turnId='';
    const started=Date.now();
    const event=(m: Rpc)=>{
      const p=m.params;if(p?.threadId!==h.id)return;
      if(m.method==='turn/started')turnId=p.turn.id;
      if(m.method==='item/agentMessage/delta'&&typeof p.delta==='string')queue.push(p.delta);
      if(m.method==='thread/tokenUsage/updated') { const u=p.tokenUsage;h.usage={input:u.last.inputTokens,cached:u.last.cachedInputTokens,output:u.last.outputTokens,context:u.last.inputTokens,latencyMs:Date.now()-started}; }
      if(m.method==='item/started' && ['commandExecution','fileChange','mcpToolCall','webSearch','dynamicToolCall'].includes(p.item?.type)) { this.stats.rejectedTools++;failure=new ProviderError('Native tool rejected in companion session.','config');this.close();done=true; }
      if(m.method==='error') {
        const message=p.error?.message??'Codex session failed.',delay=codexRetryDelay(message);
        if(delay!==null){codexRequests.limit(delay);failure=new ProviderError('Codex allowance exhausted.','rate_limit',429,delay);done=true;this.child?.kill();}
        else if(!p.willRetry){failure=new ProviderError(message,'server');done=true;}
      }
      if(m.method==='turn/completed') { done=true;if(p.turn.status!=='completed')failure??=new ProviderError(p.turn.error?.message??'Turn interrupted.','server'); }
      wake();
    };
    const died=(e:Error)=>{failure??=e;done=true;wake();};
    this.events.on('event',event);this.events.on('failure',died);
    const abort=()=>{failure=new ProviderError('Stopped.','aborted');done=true;if(turnId)void this.rpc('turn/interrupt',{threadId:h.id,turnId},3000).catch(()=>this.close());else this.close();wake();};
    const timer=setTimeout(()=>{abort();failure=new ProviderError('Codex session timed out.','timeout');},input.timeoutMs);
    input.signal.addEventListener('abort',abort,{once:true});
    let task: Promise<void>|undefined;
    try {
      if(input.signal.aborted)abort();
      else task=codexRequests.run(h.scope==='background'?'ambient':'reply',input.signal,async signal=>{
        const stop=()=>abort();signal.addEventListener('abort',stop,{once:true});
        try {
          const r=await this.rpc('turn/start',{threadId:h.id,input:[{type:'text',text:input.text}],additionalContext:{capri:{kind:'application',value:input.state}},environments:[],runtimeWorkspaceRoots:[],effort:'low'});
          turnId=r.turn.id;
          while(!done)await new Promise<void>(resolve=>{wake=resolve;});
        } finally {signal.removeEventListener('abort',stop);}
      }).catch(e=>{failure??=e;done=true;wake();});
      // Poll only the in-memory queue. Notifications wake both producer and consumer.
      while(!done||queue.length) { if(queue.length)yield queue.shift()!;else await new Promise<void>(resolve=>setTimeout(resolve,10)); }
      await task;
      if(failure) {const delay=codexRetryDelay(failure.message);if(delay!==null){codexRequests.limit(delay);throw new ProviderError('Codex allowance exhausted.','rate_limit',429,delay);}throw failure;}
      h.turns++;if(h.usage)h.usage.latencyMs=Date.now()-started;
    } finally {if(!done)abort();clearTimeout(timer);input.signal.removeEventListener('abort',abort);this.events.off('event',event);this.events.off('failure',died);}
  }
  async compact(h:SessionHandle) {
    await this.boot();if(!this.methods.has('thread/compact/start'))throw new ProviderError('Compaction unavailable.','config');
    await new Promise<void>((resolve,reject)=>{
      const timer=setTimeout(()=>finish(new ProviderError('Compaction timed out.','timeout')),120000);
      const event=(m:Rpc)=>{if(m.params?.threadId===h.id&&m.method==='turn/completed')finish(m.params.turn.status==='completed'?undefined:new ProviderError('Compaction failed.','server'));};
      const finish=(e?:Error)=>{clearTimeout(timer);this.events.off('event',event);this.events.off('failure',finish);e?reject(e):resolve();};
      this.events.on('event',event);this.events.on('failure',finish);void this.rpc('thread/compact/start',{threadId:h.id}).catch(finish);
    });
  }
  async invalidate(h:SessionHandle):Promise<'deleted'|'invalidated'> {
    this.loaded.delete(h.id);
    if(!['primary','project'].includes(h.scope)){this.close();return 'invalidated';}
    await this.boot();if(!this.methods.has('thread/delete'))return 'invalidated';
    try {await this.rpc('thread/delete',{threadId:h.id});}catch(e){if(!(e instanceof Error)||!/not found|does not exist|no rollout/i.test(e.message))throw e;}
    return 'deleted';
  }
  close() { const child=this.child,root=this.root;this.child=undefined;this.root='';this.ready=undefined;child?.kill();if(!child)this.removeWorkingDirectory(root);this.loaded.clear();this.fail(new ProviderError('Session closed.','aborted')); }
}
