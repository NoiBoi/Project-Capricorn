import fs from 'node:fs';
import path from 'node:path';
import { _electron as electron } from 'playwright-core';
const root = path.resolve(import.meta.dirname, '..');
if (!process.argv.includes('--live')) throw new Error('Use --live to verify the saved voice configuration.');
const userData = path.join(process.env.APPDATA, 'Capri Buddy');
const app = await electron.launch({ args: [root], env: { ...process.env, CAPRI_TEST: '1', CAPRI_OFFSCREEN: '1', CAPRI_USER_DATA: userData } });
try {
  const char = await app.firstWindow(); await char.waitForFunction(() => window.__capriDebug);
  const config = await app.evaluate(() => {
    const a = globalThis.__capri, v = a.settings.get().voice;
    return { model: v.openaiTts.model, voice: v.openaiTts.voice, rate: v.rate, hasDelivery: !!v.openaiTts.instructions, hasKey: a.secrets.has('openaiVoice') || a.secrets.has('openai') };
  });
  const wait = app.waitForEvent('window');
  await char.evaluate(() => window.capri.invoke('panel:open', 'voice'));
  const panel = await wait; await panel.getByLabel('Delivery instructions', { exact: true }).waitFor();
  const field = await panel.getByLabel('Delivery instructions', { exact: true }).boundingBox();
  if (!field || field.height < 120) throw new Error('Delivery editor is too small.');
  const capture = path.resolve(root, '../../work/voice-check'); fs.mkdirSync(capture, { recursive: true });
  await panel.screenshot({ path: path.join(capture, 'voice-settings.png') });
  if (!config.hasKey) { console.log(JSON.stringify({ ...config, liveAudio: false, reason: 'No saved voice API key.' })); }
  else {
    const phrase = "Hey, choom. There you are. I was starting to think you forgot about me. Come on, what trouble are we getting into?";
    const bytes = await char.evaluate(async text => Array.from(await window.capri.invoke('tts:fetch', text)), phrase);
    const audio = await char.evaluate(async bytes => {
      const ctx = new AudioContext();
      try { const buf = await ctx.decodeAudioData(new Uint8Array(bytes).buffer); let peak = 0; for (const x of buf.getChannelData(0)) peak = Math.max(peak, Math.abs(x)); return { duration: buf.duration, peak }; }
      finally { await ctx.close(); }
    }, bytes);
    if (audio.duration < 1 || audio.peak < 0.001) throw new Error('Generated speech is empty.');
    fs.writeFileSync(path.resolve(root, '../Capri Voice Preview.mp3'), Buffer.from(bytes));
    console.log(JSON.stringify({ ...config, liveAudio: true, ...audio }));
  }
} finally { await app.close(); }
