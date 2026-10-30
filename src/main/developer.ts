import type { DevState } from '../shared/developer';

/** One bounded, cancellable job. The IPC layer supplies only registered operations. */
export class DeveloperController {
  private state: DevState = { active: false, label: '', step: '', startedAt: null, result: 'idle', log: [] };
  private ctrl: AbortController | null = null;
  private pending: Promise<void> | null = null;
  get active() { return this.state.active; }
  snapshot(): DevState { return structuredClone(this.state); }
  note(text: string) {
    this.state.step = text; this.state.log.push({ at: Date.now(), text }); this.state.log = this.state.log.slice(-60);
  }
  start(label: string, run: (signal: AbortSignal, note: (s: string) => void) => Promise<void>, finish: () => void) {
    if (this.active) throw new Error('A developer preview is already running. Stop it first.');
    const ctrl = this.ctrl = new AbortController();
    this.state = { active: true, label, step: 'Starting', startedAt: Date.now(), result: 'running', log: [] };
    this.pending = Promise.resolve().then(() => run(ctrl.signal, text => this.note(text))).then(() => {
      this.state.result = ctrl.signal.aborted ? 'stopped' : 'passed';
    }).catch(error => {
      this.state.result = ctrl.signal.aborted ? 'stopped' : 'failed'; this.note(String(error instanceof Error ? error.message : error));
    }).finally(() => {
      try { finish(); } catch (error) { this.state.result = 'failed'; this.note(`Reset failed: ${String(error)}`); }
      this.state.active = false; this.ctrl = null;
      this.note(this.state.result === 'passed' ? 'Finished; preview state cleared.' : this.state.result === 'stopped' ? 'Stopped; preview state cleared.' : 'Failed; preview state cleared.');
    });
    return this.snapshot();
  }
  async stop() { this.ctrl?.abort(); await this.pending; return this.snapshot(); }
}
export function previewWait(ms: number, signal: AbortSignal) {
  return new Promise<void>(resolve => {
    if (signal.aborted) { resolve(); return; }
    const finish = () => { clearTimeout(timer); signal.removeEventListener('abort', finish); resolve(); };
    const timer = setTimeout(finish, ms); signal.addEventListener('abort', finish, { once: true });
  });
}
