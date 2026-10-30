import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { probeWindowsRecognizer, transcribeOpenAI, transcribeWindows, WakeWordListener } from '../../src/main/voice/speech';
import { nullLogger } from '../../src/main/log';
import { mockServer, tmpDir } from './helpers';

const win = process.platform === 'win32';

/** Synthesize a 16 kHz mono WAV with the Windows voice (no microphone needed). */
function synthWav(text: string): Uint8Array {
  const out = path.join(tmpDir(), 'speech.wav');
  const script = `Add-Type -AssemblyName System.Speech
$s = New-Object System.Speech.Synthesis.SpeechSynthesizer
$fmt = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(16000, [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen, [System.Speech.AudioFormat.AudioChannel]::Mono)
$s.SetOutputToWaveFile($env:OUT, $fmt); $s.Rate = -1; $s.Speak($env:TXT); $s.Dispose()`;
  execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { env: { ...process.env, OUT: out, TXT: text } });
  return new Uint8Array(fs.readFileSync(out));
}

describe.runIf(win)('offline Windows speech recognition', () => {
  it('reports the installed recognizer', async () => {
    const r = await probeWindowsRecognizer();
    expect(r.available).toBe(true);
    expect(r.detail).toMatch(/en-/);
  }, 30_000);

  it('transcribes speech and deletes the temporary recording', async () => {
    const before = fs.readdirSync(os.tmpdir()).filter((f) => f.startsWith('capri-stt-')).length;
    const text = await transcribeWindows(synthWav('Set a timer for five minutes.'));
    expect(text.toLowerCase()).toMatch(/timer/);
    expect(text.toLowerCase()).toMatch(/five|5/);
    expect(fs.readdirSync(os.tmpdir()).filter((f) => f.startsWith('capri-stt-')).length).toBe(before);
  }, 60_000);

  it('wake-word listener starts as one process and is fully stopped', async () => {
    const w = new WakeWordListener(nullLogger);
    const outcome = await new Promise<string>((resolve) => {
      w.once('ready', () => resolve('ready'));
      w.once('error', (e: Error) => resolve(`error: ${e.message}`)); // e.g. no microphone on CI
      w.start();
      setTimeout(() => resolve('timeout'), 20_000);
    });
    // 'ready' on a machine with a microphone; a clear error (not a hang) without one
    expect(outcome === 'ready' || /error: .+/.test(outcome)).toBe(true);
    if (outcome === 'ready') expect(w.running).toBe(true);
    w.stop();
    expect(w.running).toBe(false);
  }, 30_000);
});

describe('cloud transcription endpoint', () => {
  it('uploads a WAV as multipart and returns the text', async () => {
    const srv = await mockServer((_q, res) => res.end(JSON.stringify({ text: ' hello capri ' })));
    const text = await transcribeOpenAI(new Uint8Array(100), srv.url, 'whisper-1', 'sk-voice');
    expect(text).toBe('hello capri');
    expect(srv.requests[0].url).toBe('/audio/transcriptions');
    expect(srv.requests[0].headers['content-type']).toMatch(/multipart\/form-data/);
    expect(srv.requests[0].headers.authorization).toBe('Bearer sk-voice');
    await srv.close();
  });
});
