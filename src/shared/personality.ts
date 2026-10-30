export const MOODS = ['neutral', 'curious', 'playful', 'content', 'annoyed', 'focused', 'sleepy'] as const;
export type Mood = typeof MOODS[number];
export const LIFE_EVENTS = ['poke', 'pat', 'hover', 'return', 'window', 'reply'] as const;
export type LifeEvent = typeof LIFE_EVENTS[number];
export type Attention = 'rest' | 'notice' | 'watch' | 'play' | 'settle';
export interface LifeFrame { mood: Mood; attention: Attention; look: number | null; lean: number; motion: number; warmth: number; clip: 'blink' | 'grin' | 'glitch' | null }
export const MOOD_DELIVERY: Record<Mood, string> = {
  neutral: '', curious: 'Sound curious and quietly amused, with a questioning lift and attentive pauses.',
  playful: 'Sound mischievous and amused; smile through the words, with light teasing and lively emphasis.',
  content: 'Sound relaxed, quietly pleased, and warm, with an easy smile and softer delivery.',
  annoyed: 'Sound mildly exasperated and dryly teasing. Keep it light and affectionate, never hostile or shouting.',
  focused: 'Sound attentive and confident, with clear measured phrasing and restrained playfulness.',
  sleepy: 'Sound drowsy and soft, with relaxed pacing while keeping the words intelligible.',
};

/** One continuous clock connects attention, touch history, fidgets, and mood. No model calls. */
export class Personality {
  private time = 0;
  private emotion: Mood = 'neutral';
  private emotionUntil = 0;
  private pokes: number[] = [];
  private pats: number[] = [];
  private start = -100;
  private sequence: 'cursor' | 'fidget' | 'touch' | 'window' | 'conversation' = 'fidget';
  private nextFidget = 8;
  private fidgetGlitch = false;
  private nearTime = 0;
  private hoverUsed = false;
  private hoveredAt = -100;
  private look: number | null = null;
  private pendingLook = 0;
  private lookTime = 0;
  private motion = 0.85;
  private warmth = 0;
  mood: Mood = 'neutral';
  attention: Attention = 'rest';
  constructor(private random: () => number = Math.random) {}
  event(event: LifeEvent) {
    this.pokes = this.pokes.filter(t => this.time - t < 12);
    this.pats = this.pats.filter(t => this.time - t < 18);
    if (event === 'poke') { this.pokes.push(this.time); this.emotion = this.pokes.length >= 3 ? 'annoyed' : 'curious'; this.emotionUntil = this.time + (this.pokes.length >= 3 ? 18 : 5); }
    if (event === 'pat') { this.pats.push(this.time); this.emotion = this.pats.length >= 2 ? 'content' : 'playful'; this.emotionUntil = this.time + 22; this.pokes = []; }
    if (event === 'hover') { this.emotion = 'curious'; this.emotionUntil = this.time + 5; }
    if (event === 'return') { this.emotion = 'playful'; this.emotionUntil = this.time + 9; }
    if (event === 'window' && !['content', 'annoyed'].includes(this.emotion)) { this.emotion = 'curious'; this.emotionUntil = this.time + 16; }
    this.start = this.time; this.sequence = event === 'hover' ? 'cursor' : event === 'window' ? 'window' : event === 'reply' ? 'conversation' : 'touch';
    this.mood = this.emotion;
    return this.mood;
  }
  update(dt: number, input: { pointer: { x: number; y: number } | null; phase: string; sleeping: boolean; held: boolean }): LifeFrame {
    this.time += Math.max(0, dt);
    if (this.time > this.emotionUntil) this.emotion = 'neutral';
    const busy = ['listening', 'transcribing', 'thinking'].includes(input.phase);
    this.mood = input.sleeping ? 'sleepy' : busy && ['neutral', 'curious'].includes(this.emotion) ? 'focused' : this.emotion;
    const near = !!input.pointer && Math.hypot(input.pointer.x, input.pointer.y) < 1.55;
    this.nearTime = near ? this.nearTime + dt : 0;
    if (!near) this.hoverUsed = false;
    if (near && this.nearTime > 0.22 && !this.hoverUsed && this.time - this.hoveredAt > 15 && !busy && !input.held && !input.sleeping) {
      this.hoverUsed = true; this.hoveredAt = this.time;
      if (!['annoyed', 'content'].includes(this.mood)) { this.event('hover'); }
    }
    if (!busy && !input.held && !input.sleeping && this.time > this.nextFidget && this.time - this.start > 6) {
      this.fidgetGlitch = false; this.sequence = 'fidget'; this.start = this.time; this.nextFidget = this.time + 22 + this.random() * 19;
    }
    const age = this.time - this.start;
    this.attention = input.sleeping || input.held ? 'rest' : busy ? 'watch' : age < 0.3 ? 'notice' : age < 2 ? 'watch' : age < 3.3 ? 'play' : age < 4.2 ? 'settle' : 'rest';
    const sign = near && input.pointer && Math.abs(input.pointer.x) > 0.25 ? Math.sign(input.pointer.x) : 0;
    if (sign !== this.pendingLook) { this.pendingLook = sign; this.lookTime = 0; } else this.lookTime += dt;
    if (this.lookTime > 0.06 && sign && ['watch', 'play'].includes(this.attention)) this.look = sign;
    if (!near && age > 4.2) this.look = null;
    let clip: LifeFrame['clip'] = null;
    if (!busy && !input.sleeping && !input.held) {
      if (age < 0.5) clip = 'blink';
      else if (this.attention === 'play') clip = ['window', 'conversation'].includes(this.sequence) ? null : this.mood === 'annoyed' || this.sequence === 'fidget' && this.fidgetGlitch ? 'glitch' : this.sequence === 'fidget' ? 'blink' : 'grin';
      else if (this.attention === 'settle' && age < 3.8) clip = 'blink';
      if (this.sequence === 'touch' && ['playful', 'content'].includes(this.mood) && age >= 0.5 && age < 2) clip = 'grin';
    }
    const desiredMotion = this.mood === 'sleepy' ? 0.42 : this.mood === 'content' ? 0.65 : this.mood === 'focused' ? 0.72 : this.mood === 'playful' ? 1.08 : 0.85;
    const ease = 1 - Math.exp(-Math.max(0, dt) / 4);
    this.motion += (desiredMotion - this.motion) * ease;
    this.warmth += ((['content', 'playful'].includes(this.mood) ? 1 : 0) - this.warmth) * ease;
    const lean = this.mood === 'annoyed' ? -0.025 : this.attention === 'watch' && this.look ? this.look * 0.018 : this.attention === 'play' ? 0.012 : this.warmth * 0.006;
    return { mood: this.mood, attention: this.attention, look: this.look, lean, motion: this.motion, warmth: this.warmth, clip };
  }
}
