// Live Gemini check using the local key (never printed). Usage: node scripts/gemini-probe.mjs
import fs from 'node:fs';
import path from 'node:path';
import { GoogleGenAI } from '@google/genai';

const envFile = path.resolve(import.meta.dirname, '..', '.env.local');
const key = process.env.GEMINI_API_KEY || (fs.existsSync(envFile) && /GEMINI_API_KEY=(.+)/.exec(fs.readFileSync(envFile, 'utf8'))?.[1]?.trim());
if (!key) { console.log('NO KEY'); process.exit(2); }
const redact = (s) => String(s).split(key).join('[KEY]');
const ai = new GoogleGenAI({ apiKey: key });
const want = (process.argv[2] || 'gemini-3.8-flash,gemini-3.5-flash-lite').split(',');

try {
  const pager = await ai.models.list({ config: { pageSize: 200 } });
  const names = [];
  for await (const m of pager) names.push(m.name.replace('models/', ''));
  console.log('auth OK; models visible:', names.length);
  for (const w of want) console.log(`  ${w}: ${names.includes(w) ? 'available' : 'NOT listed'}`);
} catch (e) { console.log('models.list failed:', redact(e.message).slice(0, 300)); }

for (const model of want) {
  const t0 = Date.now();
  try {
    const r = await ai.interactions.create({ model, input: 'Reply with exactly: online', store: false, generation_config: { max_output_tokens: 20, thinking_level: process.env.TL || 'minimal' } });
    console.log(`[${model}] non-stream ${Date.now() - t0}ms →`, JSON.stringify(r.output_text ?? r.outputs ?? r).slice(0, 120));
  } catch (e) { console.log(`[${model}] non-stream FAILED:`, redact(e.status ?? ''), redact(e.message).slice(0, 300)); continue; }
  try {
    const t1 = Date.now(); let first = 0; let text = ''; const types = new Set();
    const stream = await ai.interactions.create({ model, input: 'Count from 1 to 12, separated by spaces.', stream: true, store: false, generation_config: { thinking_level: process.env.TL || 'minimal' } });
    for await (const ev of stream) { types.add(ev.event_type + (ev.delta?.type ? ':' + ev.delta.type : '')); if (ev.event_type === 'step.delta' && ev.delta?.type === 'text') { if (!first) first = Date.now() - t1; text += ev.delta.text; } }
    console.log(`[${model}] stream first-token ${first}ms total ${Date.now() - t1}ms events=${[...types].join(',')} text=${JSON.stringify(text.trim())}`);
  } catch (e) { console.log(`[${model}] stream FAILED:`, redact(e.message).slice(0, 300)); }
  try {
    const input = [
      { type: 'user_input', content: [{ type: 'text', text: 'My cat is named Delta. Just say ok.' }] },
      { type: 'model_output', content: [{ type: 'text', text: 'ok' }] },
      { type: 'user_input', content: [{ type: 'text', text: 'What is my cat called? One word.' }] },
    ];
    const r = await ai.interactions.create({ model, input, system_instruction: 'You are terse.', store: false, generation_config: { thinking_level: process.env.TL || 'minimal' } });
    console.log(`[${model}] multi-turn →`, JSON.stringify(r.output_text ?? '').slice(0, 80));
  } catch (e) { console.log(`[${model}] multi-turn FAILED:`, redact(e.message).slice(0, 300)); }
}
try {
  await new GoogleGenAI({ apiKey: 'invalid-key-for-test' }).interactions.create({ model: want[0], input: 'hi', store: false });
} catch (e) { console.log('bad key →', e.status ?? e.constructor.name, redact(e.message).slice(0, 200)); }
