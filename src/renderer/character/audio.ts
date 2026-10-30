/** 16-bit PCM mono WAV encoder. */
export function encodeWav(samples: Float32Array, sampleRate: number): Uint8Array {
  const buf = new ArrayBuffer(44 + samples.length * 2);
  const v = new DataView(buf);
  const w = (o: number, s: string) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  w(0, 'RIFF'); v.setUint32(4, 36 + samples.length * 2, true); w(8, 'WAVE');
  w(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, sampleRate, true); v.setUint32(28, sampleRate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  w(36, 'data'); v.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Uint8Array(buf);
}

/** Linear resample (mic contexts may not honour the requested rate). */
export function resample(input: Float32Array, from: number, to: number): Float32Array {
  if (from === to) return input;
  const ratio = from / to;
  const out = new Float32Array(Math.floor(input.length / ratio));
  for (let i = 0; i < out.length; i++) {
    const x = i * ratio, i0 = Math.floor(x), f = x - i0;
    out[i] = input[i0] * (1 - f) + (input[Math.min(i0 + 1, input.length - 1)] ?? 0) * f;
  }
  return out;
}

export const rms = (b: Float32Array) => { let s = 0; for (let i = 0; i < b.length; i++) s += b[i] * b[i]; return Math.sqrt(s / Math.max(1, b.length)); };

/**
 * Voice-activity endpointing: adaptive noise floor; stops after `silenceMs` of quiet
 * once speech was heard, or `maxMs` total, or `noSpeechMs` with no speech at all.
 */
export class Endpointer {
  private floor = 0.01;
  heardSpeech = false;
  private silentFor = 0;
  private elapsed = 0;
  constructor(private o = { silenceMs: 1300, maxMs: 30_000, noSpeechMs: 6000 }) {}
  /** returns true when recording should end */
  push(level: number, ms: number): boolean {
    this.elapsed += ms;
    const speech = level > Math.max(0.02, this.floor * 3);
    if (!speech) this.floor = this.floor * 0.95 + level * 0.05;
    if (speech) { this.heardSpeech = true; this.silentFor = 0; } else this.silentFor += ms;
    if (this.elapsed >= this.o.maxMs) return true;
    if (!this.heardSpeech) return this.elapsed >= this.o.noSpeechMs;
    return this.silentFor >= this.o.silenceMs;
  }
}

/** Microphone capture. The stream is opened only while recording and released immediately. */
export class MicRecorder {
  private ctx: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private node: ScriptProcessorNode | null = null;
  private chunks: Float32Array[] = [];
  private ep: Endpointer | null = null;
  level = 0;
  get active() { return !!this.stream; }

  async start(autoStop: boolean, onAutoStop: () => void) {
    if (this.stream) return;
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false });
    this.ctx = new AudioContext({ sampleRate: 16000 });
    const src = this.ctx.createMediaStreamSource(this.stream);
    this.node = this.ctx.createScriptProcessor(2048, 1, 1);
    this.chunks = [];
    this.ep = new Endpointer({ silenceMs: autoStop ? 1300 : 60_000, maxMs: 30_000, noSpeechMs: autoStop ? 6000 : 30_000 });
    this.node.onaudioprocess = (e) => {
      const d = new Float32Array(e.inputBuffer.getChannelData(0));
      this.chunks.push(d);
      this.level = rms(d);
      const ms = (d.length / (this.ctx?.sampleRate ?? 16000)) * 1000;
      if (this.ep?.push(this.level, ms)) onAutoStop();
    };
    src.connect(this.node);
    this.node.connect(this.ctx.destination);
  }

  /** Stop and return WAV (16 kHz mono) — or null when cancelled/empty. */
  async stop(cancel = false): Promise<{ wav: Uint8Array; durationMs: number } | null> {
    const rate = this.ctx?.sampleRate ?? 16000;
    this.node?.disconnect();
    this.stream?.getTracks().forEach((t) => t.stop());
    await this.ctx?.close().catch(() => {});
    this.node = null; this.stream = null; this.ctx = null; this.level = 0;
    const chunks = this.chunks; this.chunks = [];
    if (cancel || !chunks.length) return null;
    const total = chunks.reduce((n, c) => n + c.length, 0);
    const all = new Float32Array(total);
    let o = 0; for (const c of chunks) { all.set(c, o); o += c.length; }
    const pcm = resample(all, rate, 16000);
    return { wav: encodeWav(pcm, 16000), durationMs: (pcm.length / 16000) * 1000 };
  }
}
