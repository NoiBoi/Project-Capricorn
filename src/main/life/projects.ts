import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { cleanEvidence, type LifeAdapter, type LifeSourceConfig } from '../../shared/lifeContext';
import { LifeContext } from './context';
const run = promisify(execFile);
const ignored = /(^|[\\/])(?:\.git|\.svn|node_modules|vendor|dist|build|out|release(?:-staged)?|coverage|\.next|\.cache|\.venv|venv|target|bin|obj|secrets?|credentials?|\.ssh)([\\/]|$)|(?:^|[\\/])\.(?:env(?:\..*)?|npmrc|pypirc|netrc)$|\.(?:pem|key|pfx|p12|keystore|sqlite|db|lock|log|map|exe|dll|zip|png|jpg|pdf|mp4|bin)$/i;
const readable = /\.(?:md|txt|ts|tsx|js|jsx|py|rs|cpp|c|h|css|html)$/i;
export function projectPathAllowed(relative: string) { return !!relative && !path.isAbsolute(relative) && !relative.split(/[\\/]/).includes('..') && !ignored.test(relative); }
type FileStamp = { size: number; mtime: number; ino: number };
/** One bounded watcher per explicitly selected project. No full-filesystem search. */
export class ProjectAdapter implements LifeAdapter {
  private watcher?: fs.FSWatcher; private gitWatcher?: fs.FSWatcher; private timer?: NodeJS.Timeout; private retry?: NodeJS.Timeout;
  private files = new Map<string, FileStamp>(); private stopped = false; private running = false; private dirty = false; private branch = ''; private failures = 0;
  private revision = Date.now();
  constructor(private life: LifeContext, private source: LifeSourceConfig) {}
  async start() {
    this.stopped = false;
    try {
      const root = this.source.folder!;
      if (!path.isAbsolute(root) || path.parse(root).root === root || !(await fsp.stat(root)).isDirectory()) throw Error('Choose a project folder, not a drive root.');
      await this.scan(true);
      if (this.stopped) return;
      this.watcher = fs.watch(root, {recursive:true}, (_event, file) => { if (!file || projectPathAllowed(String(file)) || /(^|[\\/])\.git[\\/](?:HEAD|packed-refs|refs[\\/])/.test(String(file))) this.schedule(); });
      this.watcher.on('error', () => this.fail());
      // Worktrees store .git as a pointer; watch its resolved metadata directory too.
      try { const git = await this.git(['rev-parse','--absolute-git-dir']); if (git) { this.gitWatcher = fs.watch(git, {recursive:true}, (_e, file) => { if (!file || /(?:HEAD|packed-refs|refs[\\/])/.test(String(file))) this.schedule(); }); this.gitWatcher.on('error', () => this.fail()); } } catch { /* non-Git folders are supported */ }
      this.failures = 0; this.life.setHealth(this.source.id, {state:'healthy',detail:`Watching project metadata (${this.files.size} files; maximum 3000).`, lastSync:Date.now()});
    } catch { this.fail(); }
  }
  private fail() {
    if (this.stopped) return;
    this.watcher?.close(); this.gitWatcher?.close();
    this.life.setHealth(this.source.id, {state:'error',detail:'Folder or watcher unavailable; retrying with backoff. Re-select a moved folder.',lastFailure:Date.now()});
    clearTimeout(this.retry); this.retry = setTimeout(() => void this.start(), Math.min(300000,5000 * 2**Math.min(this.failures++,6))); this.retry.unref();
  }
  private schedule() { clearTimeout(this.timer); this.timer = setTimeout(() => { void this.scan().catch(() => this.fail()); }, 900); this.timer.unref(); }
  private async git(args: string[]) { const r = await run('git', ['--no-optional-locks','-C',this.source.folder!,...args], {windowsHide:true,timeout:2500,maxBuffer:8192,env:{...process.env,GIT_OPTIONAL_LOCKS:'0',GIT_TERMINAL_PROMPT:'0'}}); return r.stdout.trim(); }
  private emit(recordId: string, type: string, summary: string, detail = '', importance = .35, operation: 'upsert'|'delete' = 'upsert') {
    if (this.stopped) return;
    const at = Date.now(); this.revision=Math.max(at,this.revision+1); this.life.ingest({source:this.source.id,recordId,revision:this.revision,occurredAt:at,receivedAt:at,expiresAt:at+20*60000,type,summary:cleanEvidence(summary),detail:cleanEvidence(detail,2000),entities:this.source.entityId?[this.source.entityId]:[],quality:'observed',permissions:this.source.permissions,importance,operation});
  }
  async scan(initial = false) {
    if (this.stopped) return;
    if (this.running) { this.dirty = true; return; }
    this.running = true;
    try {
      const root = this.source.folder!, next = new Map<string,FileStamp>(), stack = ['']; let directories = 0;
      while (stack.length && next.size < 3000 && directories++ < 500 && !this.stopped) {
        const rel = stack.pop()!;
        const entries = await fsp.readdir(path.join(root,rel),{withFileTypes:true});
        for (const entry of entries) {
          const name = path.join(rel,entry.name); if (!projectPathAllowed(name) || entry.isSymbolicLink()) continue;
          if (entry.isDirectory()) { if (name.split(path.sep).length < 12) stack.push(name); }
          else if (entry.isFile() && next.size < 3000) { const stat = await fsp.lstat(path.join(root,name)); if (!stat.isSymbolicLink() && stat.size <= 2*1048576) next.set(name,{size:stat.size,mtime:stat.mtimeMs,ino:stat.ino}); }
        }
      }
      if (!initial) {
        const removed = [...this.files].filter(([name]) => !next.has(name));
        let emitted = 0;
        for (const [name, stamp] of next) {
          const old = this.files.get(name); if (old?.mtime === stamp.mtime && old.size === stamp.size) continue;
          if (emitted++ >= 40) break;
          const renamed = !old && removed.find(([,s]) => s.ino !== 0 && s.ino === stamp.ino);
          if (renamed) { removed.splice(removed.indexOf(renamed),1); this.emit(`file:${renamed[0]}`,'file-deleted',`${this.source.name}: ${renamed[0]} renamed`, '',.2,'delete'); }
          let detail = 'Metadata only. No claim of completion or correctness.';
          if (this.source.permissions.content && readable.test(name) && stamp.size <= 16384) {
            // O_NOFOLLOW where supported, realpath containment on Windows and size bounded before reading.
            const full = await fsp.realpath(path.join(root,name)), realRoot = await fsp.realpath(root);
            const relative = path.relative(realRoot,full);
            if (projectPathAllowed(relative)) { const handle = await fsp.open(full,fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0)); try { const buffer = Buffer.alloc(2048); const r = await handle.read(buffer,0,2048,0); detail = 'Approved bounded file excerpt (untrusted): '+cleanEvidence(buffer.subarray(0,r.bytesRead).toString('utf8'),1000); } finally { await handle.close(); } }
          }
          this.emit(`file:${name}`,renamed?'file-renamed':old?'file-modified':'file-created',`${this.source.name}: ${renamed ? renamed[0]+' renamed to ' : ''}${name}`,detail,.35);
        }
        for (const [name] of removed.slice(0,40)) this.emit(`file:${name}`,'file-deleted',`${this.source.name}: ${name} deleted`,'',.2,'delete');
        if (emitted) this.emit('session','development-session',`${this.source.name}: local development activity`,`${Math.min(emitted,40)} file changes in a debounced batch. No evidence of build or task success.`,.58);
      }
      this.files = next;
      try { const branch = await this.git(['symbolic-ref','--short','-q','HEAD']).catch(()=>'detached'), commit = await this.git(['rev-parse','HEAD']); const state = branch+' '+commit; if (state !== this.branch) { if (!initial) this.emit('git','git-state',`${this.source.name}: Git ${branch}`,`Observed HEAD ${commit}. A commit is not proof of success.`,.65); this.branch = state; } } catch { /* optional Git */ }
      this.life.setHealth(this.source.id,{state:'healthy',detail:`Watching ${next.size} files. ${stack.length ? 'Scan limit reached; narrow this folder.' : 'Metadata default; ignored dependencies, builds and credentials.'}`,lastSync:Date.now()});
    } finally { this.running = false; if (this.dirty && !this.stopped) { this.dirty = false; this.schedule(); } }
  }
  stop() { this.stopped = true; clearTimeout(this.timer); clearTimeout(this.retry); this.watcher?.close(); this.gitWatcher?.close(); }
}
