export type AppKind = 'notes' | 'code' | 'music' | 'art' | 'video' | 'browser' | 'other';
export type DialogueSurface = 'youtube' | 'discord' | 'chatgpt' | 'spotify' | 'browser';
export function dialogueSurface(info: { title: string; process: string }): DialogueSurface | undefined {
  const process = info.process.toLowerCase();
  const title = info.title.replace(/\s[-–|]\s(?:Google Chrome|Microsoft Edge|Mozilla Firefox).*$/i, '').trim();
  if (/^spotify(?:\.exe)?$/.test(process) || /^(?:Spotify|.*[-|] Spotify)$/i.test(title)) return 'spotify';
  if (/^discord(?:\.exe)?$/.test(process) || /^(?:Discord|.*[-|] Discord)$/i.test(title)) return 'discord';
  // Match website identity, not a word mentioned in an unrelated article/video title.
  if (/^(?:YouTube|.*[-|] YouTube)$/i.test(title)) return 'youtube';
  if (/^chatgpt(?:\.exe)?$/.test(process) || /^(?:ChatGPT|.*[-|] ChatGPT)$/i.test(title)) return 'chatgpt';
  return /^(?:chrome|msedge|firefox)(?:\.exe)?$/.test(process) ? 'browser' : undefined;
}
export interface LocalDialogueContext {
  hour: number; weekday: string; weekend: boolean;
  battery?: { percent: number; charging: boolean };
  activity?: { kind: AppKind; minutes: number; switches: number; returning: boolean };
  openKinds?: AppKind[];
  weather?: { condition: 'rain' | 'snow' | 'clear' | 'cloud' | 'storm' | 'fog'; celsius: number; observedAt: number };
}
/** Titles are used only to classify a broad activity. They never become spoken template slots. */
export function appKind(info: { title: string; process: string }): AppKind {
  const s = `${info.process} ${info.title}`.toLowerCase();
  if (/spotify|music|foobar|winamp/.test(s)) return 'music';
  if (/photoshop|illustrator|krita|blender|paint|figma|solidworks|fusion|autocad/.test(s)) return 'art';
  if (/visual studio|code\.exe|pycharm|intellij|colab|jupyter|github/.test(s)) return 'code';
  if (/notepad|acrobat|\.pdf\b|onenote|word|lecture|homework|notes|docs\.google/.test(s)) return 'notes';
  if (/youtube|netflix|vlc|mpv\.exe|media player/.test(s)) return 'video';
  if (/chrome|firefox|msedge|browser/.test(s)) return 'browser';
  return 'other';
}
export class ActivityContext {
  private current = ''; private since = 0; private lastSeen = 0; private returning = false;
  private kind: AppKind = 'other'; private switches: number[] = []; private seen = new Map<string, number>();
  observe(info: { title: string; process: string } | null, now: number) {
    if (!info) { this.current = ''; this.since = now; this.lastSeen = now; return; }
    const key = `${info.process}\n${info.title}`;
    // Idle/hidden/quiet periods never count as time spent working.
    if (now - this.lastSeen > 10000) this.since = now;
    this.lastSeen = now;
    if (key === this.current) {
      if (now - this.since >= 3500) {
        this.seen.delete(key); this.seen.set(key, now);
        if (this.seen.size > 32) this.seen.delete(this.seen.keys().next().value!);
      }
      return;
    }
    this.returning = this.seen.has(key); this.current = key; this.since = now; this.kind = appKind(info);
    this.switches.push(now); this.switches = this.switches.filter(t => now - t < 300000).slice(-50);
  }
  snapshot(now: number): LocalDialogueContext['activity'] {
    if (!this.current || now - this.lastSeen > 10000 || now - this.since < 3500) return undefined;
    return { kind: this.kind, minutes: Math.floor((now - this.since) / 60000), returning: this.returning,
      switches: this.switches.filter(t => now - t < 300000).length };
  }
}
