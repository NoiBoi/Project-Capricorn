import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { MemoryLearning } from '../../src/main/ai/memoryLearning';
import { MemoryStore } from '../../src/main/store/dataStores';
import { DEFAULT_SETTINGS } from '../../src/shared/settings';
import { nullLogger } from '../../src/main/log';
import { tmpDir } from './helpers';
import type { GenOptions, LLMMessage } from '../../src/main/ai/providers';
import { ProviderError } from '../../src/main/ai/providers';
const eventually = async (check: () => boolean) => { for (let i=0;i<100;i++) { if(check()) return; await new Promise(r=>setTimeout(r,10)); } throw Error('Timed out'); };
describe('background learning scheduler', () => {
  it('keeps a source job after malformed model output instead of silently losing it', async () => {
    const settings = structuredClone(DEFAULT_SETTINGS); settings.memory.autoLearn = true;
    const dir = tmpDir(), memory = new MemoryStore(dir); let starts = 0;
    const provider = { name: 'mock', local: true, async *stream() {
      starts++;
      yield starts === 1 ? '{broken' : JSON.stringify({ changes: [{ op: 'add', text: 'Enjoys cycling', kind: 'preference', evidence: 'I enjoy cycling' }] });
    }, async test() { return { ok: true, detail: '' }; }, async listModels() { return []; } };
    const learner = new MemoryLearning({ dir, settings: () => settings, memory, provider: () => provider, log: nullLogger });
    try {
      learner.enqueue('I enjoy cycling', 'cycling'); learner.schedule(0);
      await eventually(() => starts === 1); await new Promise(r => setTimeout(r, 20));
      expect(JSON.parse(fs.readFileSync(path.join(dir, 'memory-learning-queue.json'), 'utf8'))).toHaveLength(1);
      learner.schedule(0); await eventually(() => memory.approved().length === 1);
      expect(memory.approved()[0].learnedFrom?.messageId).toBe('cycling');
    } finally { learner.discard(); }
  });
  it('recovers unfinished learning after a restart and removes it when history saving stops', async () => {
    const settings = structuredClone(DEFAULT_SETTINGS); settings.memory.autoLearn = true;
    const dir = tmpDir(), memory = new MemoryStore(dir);
    const provider = { name: 'mock', local: true, async *stream(messages: LLMMessage[]) {
      const text = JSON.parse(messages[1].content).current_user_message;
      yield JSON.stringify({ changes: [{ op: 'add', text, kind: 'fact', evidence: text }] });
    }, async test() { return { ok: true, detail: '' }; }, async listModels() { return []; } };
    const deps = { dir, settings: () => settings, memory, provider: () => provider, log: nullLogger };
    const original = new MemoryLearning(deps); original.enqueue('I am building a ceramic kiln.', 'kiln'); original.pause();
    expect(fs.existsSync(path.join(dir, 'memory-learning-queue.json'))).toBe(true);
    const restored = new MemoryLearning(deps);
    try {
      restored.schedule(0); await eventually(() => memory.approved().length === 1);
      expect(memory.approved()[0].learnedFrom?.messageId).toBe('kiln');
      await eventually(() => !fs.existsSync(path.join(dir, 'memory-learning-queue.json')));
      restored.enqueue('Another durable fact', 'second'); settings.privacy.saveHistory = false; restored.privacyChanged();
      expect(fs.existsSync(path.join(dir, 'memory-learning-queue.json'))).toBe(false);
    } finally { restored.discard(); }
  });
  it('batches Codex messages while preserving each fact source and retains work after a rate limit', async () => {
    const settings = structuredClone(DEFAULT_SETTINGS); settings.ai.provider = 'codex'; settings.memory.autoLearn = true;
    const memory = new MemoryStore(tmpDir()); let starts = 0;
    const provider = { name: 'codex', local: false, async test() { return { ok: true, detail: '' }; }, async listModels() { return []; },
      async *stream(messages: LLMMessage[]) {
        starts++;
        if (starts === 1) throw new ProviderError('Wait', 'rate_limit', 429, 300000);
        expect(JSON.parse(messages[1].content).current_user_message).toBe('I study engineering\n\nI enjoy cycling');
        yield JSON.stringify({ changes: [
          { op: 'add', text: 'Studies engineering', kind: 'fact', evidence: 'I study engineering' },
          { op: 'add', text: 'Enjoys cycling', kind: 'preference', evidence: 'I enjoy cycling' },
        ] });
      } };
    const learner = new MemoryLearning({ settings: () => settings, memory, provider: () => provider, log: nullLogger });
    try {
      learner.enqueue('I study engineering', 'first'); learner.enqueue('I enjoy cycling', 'second');
      learner.enqueue('Off the record, I work elsewhere', 'private');
      learner.schedule(0); await eventually(() => starts === 1); await new Promise(r => setTimeout(r, 20));
      expect(memory.approved()).toHaveLength(0);
      learner.schedule(0); await eventually(() => memory.approved().length === 2);
      expect(starts).toBe(2);
      expect(memory.approved().map(m => m.learnedFrom?.messageId)).toEqual(['first', 'second']);
    } finally { learner.discard(); }
  });
  it('waits for reply completion, aborts for a new message, then resumes in order', async () => {
    const settings = structuredClone(DEFAULT_SETTINGS); settings.memory.autoLearn = true;
    const memory = new MemoryStore(tmpDir()); let starts = 0; let active = 0; let maxActive = 0;
    const provider = { name: 'mock', local: true, async test() { return { ok: true, detail: '' }; }, async listModels() { return []; },
      async *stream(messages: LLMMessage[], options: GenOptions) {
        starts++; active++; maxActive = Math.max(maxActive, active);
        const data = JSON.parse(messages[1].content);
        try {
          if (starts === 1) await new Promise<void>(resolve => options.signal.addEventListener('abort', () => resolve(), { once: true }));
          if (!options.signal.aborted) yield JSON.stringify({ changes: [{ op:'add', text:data.current_user_message, kind:'fact', evidence:data.current_user_message }] });
        } finally { active--; }
      } };
    const learner = new MemoryLearning({ settings:()=>settings, memory, provider:()=>provider, log:nullLogger });
    try {
      learner.enqueue('First user fact','1'); await new Promise(r=>setTimeout(r,30)); expect(starts).toBe(0);
      learner.schedule(0); await eventually(()=>starts===1);
      learner.enqueue('Second user fact','2'); await eventually(()=>active===0);
      expect(memory.approved()).toHaveLength(0);
      learner.schedule(0); await eventually(()=>memory.approved().length===1);
      learner.schedule(0); await eventually(()=>memory.approved().length===2);
      expect(maxActive).toBe(1); expect(memory.approved().map(m=>m.text)).toEqual(['First user fact','Second user fact']);
    } finally { learner.discard(); }
  });
  it('discard prevents queued facts being restored after a manual deletion', async () => {
    let starts = 0; const settings = structuredClone(DEFAULT_SETTINGS); settings.memory.autoLearn = true;
    const memory = new MemoryStore(tmpDir());
    const provider = { name:'mock', local:true, async *stream() { starts++; yield '{"changes":[]}'; }, async test(){return {ok:true,detail:''};},async listModels(){return [];} };
    const learner = new MemoryLearning({ settings:()=>settings, memory, provider:()=>provider, log:nullLogger });
    learner.enqueue('A personal fact','m'); learner.schedule(0); learner.discard();
    await new Promise(r=>setTimeout(r,30)); expect(starts).toBe(0);
  });
});
