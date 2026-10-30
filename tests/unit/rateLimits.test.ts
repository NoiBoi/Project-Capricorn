import { afterEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import { RequestGate } from '../../src/main/ai/requestGate';
import { codexRequests, codexRetryDelay, configureCodexCooldown, runCodex, CodexAccountProvider } from '../../src/main/ai/codexAccount';
import { tmpDir } from './helpers';

vi.mock('node:child_process', () => ({ spawn: vi.fn(), execFile: vi.fn() }));
import { spawn } from 'node:child_process';

afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); vi.clearAllMocks(); codexRequests.until = 0; codexRequests.onCooldown = undefined; });

describe('Codex request coordination', () => {
  it('interrupts background work, waits for it to exit, and runs the user reply alone', async () => {
    const gate = new RequestGate(), order: string[] = [];
    const background = gate.run('memory', new AbortController().signal, async signal => {
      order.push('memory');
      await new Promise<void>(resolve => signal.addEventListener('abort', () => { order.push('cancel'); resolve(); }));
      order.push('exit');
    });
    await Promise.resolve();
    const reply = gate.run('reply', new AbortController().signal, async () => { order.push('reply'); return 'Hi'; });
    expect(await reply).toBe('Hi'); await background;
    expect(order).toEqual(['memory', 'cancel', 'exit', 'reply']);
  });
  it('drops background arrivals while a reply is running and checks cooldown again before queued replies', async () => {
    const gate = new RequestGate(); let finish!: () => void;
    const first = gate.run('reply', new AbortController().signal, () => new Promise<void>(resolve => { finish = resolve; }));
    await Promise.resolve();
    const work = vi.fn();
    await expect(gate.run('ambient', new AbortController().signal, work)).rejects.toMatchObject({ kind: 'aborted' });
    const next = gate.run('reply', new AbortController().signal, work);
    gate.limit(300000); finish(); await first;
    await expect(next).rejects.toMatchObject({ kind: 'rate_limit' });
    expect(work).not.toHaveBeenCalled();
  });
  it('does not start cancelled queued work', async () => {
    const gate = new RequestGate(); let finish!: () => void;
    const first = gate.run('reply', new AbortController().signal, () => new Promise<void>(resolve => { finish = resolve; }));
    await Promise.resolve();
    const ctrl = new AbortController(), work = vi.fn();
    const next = gate.run('reply', ctrl.signal, work); ctrl.abort(); finish(); await first;
    await expect(next).rejects.toMatchObject({ kind: 'aborted' }); expect(work).not.toHaveBeenCalled();
  });
});

describe('CLI rate limit protocol', () => {
  function child() {
    vi.stubEnv('CAPRI_CODEX_PATH', process.execPath);
    const child = Object.assign(new EventEmitter(), { stdout: new EventEmitter(), stderr: new EventEmitter(), stdin: Object.assign(new EventEmitter(), { end: vi.fn() }), kill: vi.fn() });
    vi.mocked(spawn).mockReturnValue(child as never);
    return child;
  }
  it('passes the behavioral output schema to Codex so required fields cannot silently disappear', async () => {
    const c = child(), outputSchema = { type: 'object', properties: { reason: { type: 'string' } }, required: ['reason'], additionalProperties: false };
    const stream = new CodexAccountProvider().stream([{ role: 'user', content: 'Inspect this view.' }], {
      purpose: 'ambient', outputSchema, signal: new AbortController().signal, timeoutMs: 10000, temperature: .9, maxTokens: 768 });
    const response = stream.next(); await Promise.resolve();
    const args = vi.mocked(spawn).mock.calls[0][1] as string[], file = args[args.indexOf('--output-schema') + 1];
    expect(JSON.parse(fs.readFileSync(file, 'utf8'))).toEqual(outputSchema);
    c.stdout.emit('data', Buffer.from('{"type":"item.completed","item":{"type":"agent_message","text":"{\\"reason\\":\\"interesting detail\\"}"}}\n'));
    c.emit('close', 0); await response; await stream.return(undefined);
  });
  it('replaces coding instructions, separates the persona from conversation, and records real usage', async () => {
    const c = child(); const stream = new CodexAccountProvider().stream([
      { role: 'system', content: 'Capri personality and all approved memories.' }, { role: 'user', content: 'Hello' },
    ], { signal: new AbortController().signal, timeoutMs: 10000, temperature: 0.8, maxTokens: 100 });
    const response = stream.next(); await Promise.resolve();
    const args = vi.mocked(spawn).mock.calls[0][1] as string[];
    const option = args.find(a => a.startsWith('model_instructions_file='))!;
    const file = JSON.parse(option.slice(option.indexOf('=') + 1));
    expect(fs.readFileSync(file, 'utf8')).toContain('Capri personality and all approved memories.');
    expect(c.stdin.end).toHaveBeenCalledWith('User: Hello');
    for (const flag of ['features.shell_tool=false', 'features.plugins=false', 'features.memories=false', 'skills.include_instructions=false', 'web_search="disabled"']) expect(args).toContain(flag);
    expect(args).toContain('gpt-6-luna');
    c.stdout.emit('data', Buffer.from('{"type":"item.completed","item":{"type":"agent_message","text":"Hello, choom."}}\n'));
    c.emit('close', 0);
    expect((await response).value).toBe('Hello, choom.'); expect(fs.existsSync(file)).toBe(false);
    await stream.return(undefined);
  });
  it.each([false, true])('selects the configured model for the route (actions: %s)', async agentic => {
    const c = child();
    const stream = new CodexAccountProvider({ chatModel: 'test-chat', taskModel: 'test-task' }).stream(
      [{ role: 'user', content: 'A request' }],
      { agentic, signal: new AbortController().signal, timeoutMs: 10000, temperature: 0.8, maxTokens: 100 });
    const response = stream.next(); await Promise.resolve();
    expect(vi.mocked(spawn).mock.calls[0][1]).toContain(agentic ? 'test-task' : 'test-chat');
    c.stdout.emit('data', Buffer.from('{"type":"item.completed","item":{"type":"agent_message","text":"Done."}}\n'));
    c.emit('close', 0); await response; await stream.return(undefined);
  });
  it('recognizes JSON stdout errors, saves the cooldown, and rejects subsequent work without spawning', async () => {
    const file = path.join(tmpDir(), 'cooldown.json'); configureCodexCooldown(file);
    const c = child(), request = runCodex('Hello', { signal: new AbortController().signal, timeoutMs: 10000 });
    await Promise.resolve();
    c.stdout.emit('data', Buffer.from(JSON.stringify({ type: 'turn.failed', error: { message: '429 Too Many Requests; retry after 309 seconds' } }) + '\n'));
    c.emit('close', 1);
    await expect(request).rejects.toMatchObject({ kind: 'rate_limit', retryAfterMs: 309000 });
    expect(JSON.parse(fs.readFileSync(file, 'utf8')).until).toBeGreaterThan(Date.now());
    await expect(runCodex('Hello again', { signal: new AbortController().signal, timeoutMs: 10000 })).rejects.toMatchObject({ kind: 'rate_limit' });
    expect(spawn).toHaveBeenCalledTimes(1);
    codexRequests.until = 0; configureCodexCooldown(file); expect(codexRequests.until).toBeGreaterThan(Date.now());
  });
  it('buffers split stderr lines so it preserves the full retry delay', async () => {
    const c = child(), request = runCodex('Hello', { signal: new AbortController().signal, timeoutMs: 10000 });
    await Promise.resolve();
    c.stderr.emit('data', Buffer.from('429 Too Many Requests; retrying request in '));
    expect(c.kill).not.toHaveBeenCalled();
    c.stderr.emit('data', Buffer.from('308.999s\n')); c.emit('close', 1);
    await expect(request).rejects.toMatchObject({ kind: 'rate_limit', retryAfterMs: 308999 });
  });
  it('parses units and structured retry delays without matching unrelated numbers', () => {
    expect(codexRetryDelay('429 retry after 2 minutes')).toBe(120000);
    expect(codexRetryDelay('rate_limit retry after 1500ms')).toBe(1500);
    expect(codexRetryDelay('rate_limit "retry_after": 310')).toBe(310000);
    expect(codexRetryDelay('request ID 14290')).toBeNull();
    expect(codexRetryDelay("You've hit your usage limit. Upgrade your plan or add credits to continue, or try again later.")).toBe(60000);
    expect(codexRetryDelay('usage_limit_reached retry after 120 seconds')).toBe(120000);
  });
  it('treats a usage-limit failure as quota and never respawns during cooldown',async()=>{
    const c=child(), request=runCodex('Hello',{signal:new AbortController().signal,timeoutMs:10000});await Promise.resolve();
    c.stdout.emit('data',Buffer.from(JSON.stringify({type:'turn.failed',error:{message:"You've hit your usage limit. Upgrade your plan or add credits to continue, or try again later."}})+'\n'));c.emit('close',1);
    await expect(request).rejects.toMatchObject({kind:'rate_limit'});
    await expect(runCodex('Again',{signal:new AbortController().signal,timeoutMs:10000})).rejects.toMatchObject({kind:'rate_limit'});expect(spawn).toHaveBeenCalledTimes(1);
  });
});
