export type CompanyControl = { kind: 'focus'; minutes: number } | { kind: 'stay'; minutes?: number; target?: string; posture?: 'lie'|'sit'; quiet?: boolean }
  | { kind:'timer'; seconds:number; label?:string } | {kind:'cancel_intentions'}
  | {kind:'commitment';text:string}
  | {kind:'complete_commitment'}
  | { kind: 'avoid' | 'allow_window'; target: string; minutes?: number }
  | { kind: 'move_window'; target: string; motion: 'teleport' | 'glide' }
  | { kind: 'focus_end' | 'release' | 'resume' | 'look' | 'explore' | 'sleep' };

/** Only complete, direct utterances qualify. Quoted text and mixed requests stay in conversation. */
export function companyControl(text: string, now = new Date()): CompanyControl | null {
  const indefinite=/\b(?:until i (?:say so|say otherwise|tell you(?: otherwise)?)|until further notice|indefinitely)[.!?]*$/i.test(text.trim());
  const words: Record<string, number> = {a:1,one:1,two:2,three:3,four:4,five:5,ten:10,fifteen:15,twenty:20,thirty:30,sixty:60};
  const s = text.toLowerCase().replace(/[’]/g, "'").trim().replace(/^(?:hey\s+)?capri[,!]?\s+/, '').replace(/^(?:can|could|would) you\s+/, '').replace(/^please,?\s+/, '').replace(/[.!?]+$/, '').replace(/,?\s+please$/, '').trim().replace(/\s+(?:until i (?:say so|say otherwise|tell you(?: otherwise)?)|until further notice|indefinitely)$/, '').replace(/\bfor (a|one|two|three|four|five|ten|fifteen|twenty|thirty|sixty) (minutes?|mins?|hours?|hrs?|seconds?|secs?)\b/, (_m,n,u)=>`for ${words[n]} ${u}`);
  if (/^(?:go to sleep|sleep mode|take a nap|go to bed|sleep)$/.test(s)) return { kind: 'sleep' };
  const commitment=/^track my commitment to (.{1,280})$/.exec(s);
  if(commitment&&!/["<>]/.test(commitment[1]))return {kind:'commitment',text:commitment[1]};
  if(/^mark my commitment (?:done|complete)$/.test(s))return {kind:'complete_commitment'};
  if (/^(?:explore mode|start exploring|go explor(?:e|ing)|explore)$/.test(s)) return { kind: 'explore' };
  if (/^(?:wake up|wake|normal mode|stop exploring)$/.test(s)) return { kind: 'resume' };
  const stay = /^(?:stay (?:right )?here|sit (?:right )?here|stay put|hold (?:this|your) spot|don't (?:move|wander)|do not (?:move|wander))(?: for (a bit|a while|now|\d+(?:\.\d+)?\s*(?:minutes?|mins?|hours?|hrs?|seconds?|secs?)))?$/.exec(s);
  const duration = (value?: string) => value && /\d/.test(value) ? Math.min(1440, Math.max(1 / 60, parseFloat(value) * (/hours?|hrs?/.test(value) ? 60 : /seconds?|secs?/.test(value) ? 1 / 60 : 1))) : undefined;
  // Interpret only a complete user movement utterance. Destination text is data;
  // quoted instructions, conditional discussion and unrelated clauses stay in chat.
  const natural = /^(?:(?:move|go|come|teleport|fly)(?: yourself)? (?:over )?to|(?:stay|perch|sit|lie|lay|rest)(?: down)? (?:on|at|in|onto)) (.+?)\s+(?:for (\d+(?:\.\d+)?\s*(?:minutes?|mins?|min|hours?|hrs?|seconds?|secs?))|until (\d{1,2}:\d{2}(?:\s*[ap]m)?))(?:[,;]?\s*(?:your choice|you choose|up to you|quietly|keep quiet))?$/.exec(s);
  if (natural) {
    const destination = natural[1].replace(/(?:[,;]?\s*(?:and|then)\s+(?:stay|perch|sit|lie down|lay down|rest|chill(?: out)?|hang out|relax)(?:\s+or\s+(?:perch|sit|lie down|lay down|rest))?(?: there)?(?:[,;]?\s*(?:your choice|you choose|up to you))?)$/, '').trim();
    if (destination && !/["<>]|\b(?:and|then|if|whether|because|explain|say)\b/.test(destination)) {
      let minutes = duration(natural[2]);
      if (natural[3]) {
        const clock = /^(\d{1,2}):(\d{2})(?:\s*([ap])m)?$/.exec(natural[3])!;
        let hour = Number(clock[1]); const minute = Number(clock[2]);
        if (minute > 59 || hour > (clock[3] ? 12 : 23) || clock[3] && hour < 1) return null;
        if (clock[3]) hour = hour % 12 + (clock[3] === 'p' ? 12 : 0);
        const deadline = new Date(now); deadline.setHours(hour, minute, 0, 0);
        if (deadline.getTime() <= now.getTime()) deadline.setDate(deadline.getDate() + 1);
        minutes = (deadline.getTime() - now.getTime()) / 60000;
      }
      const choice = /\bor\b|your choice|you choose|up to you|\b(?:chill|hang out|relax)\b/.test(s);
      return {kind:'stay', target:destination, minutes, ...choice ? {} : {posture:/\b(?:lie|lay|rest)\b/.test(s)?'lie' as const:'sit' as const}, .../quiet/.test(s)?{quiet:true}:{}};
    }
  }
  const untimed=/^(?:(?:move|go|teleport|fly)(?: yourself)? (?:over )?to (.+?) (?:and|then) ((?:stay|perch|sit|lie down|lay down|rest|chill(?: out)?|hang out|relax)(?: or (?:perch|sit|lie down|lay down|rest))?)(?: there)?|((?:stay|perch|sit|lie|lay|rest|chill|hang out|relax)(?: down)?) (?:on|at|in) (.+?))(?:[,;]?\s*(?:your choice|you choose|up to you))?$/.exec(s);
  if(untimed){
    const target=(untimed[1]??untimed[4]).trim(),pose=untimed[2]??untimed[3];
    if(target&&!/["<>]|\b(?:and|then|if|whether|for|until|explain)\b/.test(target))return {kind:'stay',target,.../\bor\b|your choice|you choose|up to you|\b(?:chill|hang out|relax)\b/.test(s)?{}:{posture:/lie|lay|rest/.test(pose)?'lie' as const:'sit' as const}};
  }
  const lay=/^(?:go )?(lay|lie|rest|sit|stay) (?:down )?(?:in|on|at) (.+? window) for (\d+(?:\.\d+)?\s*(?:minutes?|mins?|min|hours?|hrs?|seconds?|secs?))(?: while i (?:finish my (?:hw|homework|work)|work|study))?(?:[.,;]?\s*(?:i need to lock in|i need to focus|keep quiet|quietly))?$/.exec(s);
  if(lay&&!/["<>]|\band\b/.test(lay[2])) return {kind:'stay',target:lay[2],minutes:duration(lay[3]),posture:/lay|lie|rest/.test(lay[1])?'lie':'sit',quiet:/lock in|focus|quiet/.test(s)};
  const timer=/^(?:start|set) (?:a )?(\d+(?:\.\d+)?)\s*(seconds?|secs?|minutes?|mins?|hours?|hrs?)(?: timer)$/.exec(s);
  if(timer)return {kind:'timer',seconds:Math.round((duration(timer[1]+' '+timer[2])??1)*60)};
  if(/^(?:cancel|stop) (?:my |the |all )?(?:timer|timers|commitment|commitments|intentions|stay)$/.test(s))return {kind:'cancel_intentions'};
  if (stay) { const minutes = duration(stay[1]); return { kind: 'stay', ...(minutes === undefined ? {} : { minutes }) }; }
  const stayOn = /^(?:stay|sit) (?:on|at|in) (.+? window)(?: for (\d+(?:\.\d+)?\s*(?:minutes?|mins?|hours?|hrs?|seconds?|secs?)))?$/.exec(s);
  if(stayOn && !/["<>]|\band\b/.test(stayOn[1])) return {kind:'stay',target:stayOn[1],...(duration(stayOn[2])===undefined?{}:{minutes:duration(stayOn[2])})};
  const avoid = /^(avoid|stay (?:away from|off)|keep (?:away from|off)|don't go (?:to|near)|do not go (?:to|near)|stop avoiding|you can visit) (.+?)(?: for (\d+(?:\.\d+)?\s*(?:minutes?|mins?|hours?|hrs?)))?$/.exec(s);
  if (avoid && !/["<>]|\band\b/.test(avoid[2])) return { kind: /stop avoiding|you can visit/.test(avoid[1]) ? 'allow_window' : 'avoid', target: avoid[2], ...(duration(avoid[3]) === undefined ? {} : { minutes: duration(avoid[3]) }) };
  const move = /^(?:(?:move|go|come|teleport|tp|fly|perch|sit)(?: yourself)? (?:over )?(?:to|on|onto)|sit on top of) (.+?)(?: window)?$/.exec(s);
  if (move && !/["<>]|\b(?:and|if|whether|until)\b|\bfor\s+\d/.test(move[1]) && /window|chrome|edge|firefox|youtube|spotify|discord|notepad|codex|vscode/i.test(s)) return indefinite?{kind:'stay',target:move[1]}:{ kind: 'move_window', target: move[1], motion: /^fly/.test(s) ? 'glide' : 'teleport' };
  if (/^(?:look at (?:this|that|this window)|watch this|take a look at this)$/.test(s)) return { kind: 'look' };
  if (/^(?:back to normal|resume (?:exploring|wandering)|you can (?:wander|explore) again)$/.test(s)) return { kind: 'resume' };
  if (/^(?:you can move again|you don't have to stay here|stop staying here)$/.test(s)) return { kind: 'release' };
  if (/^(?:i'm done focusing|i am done focusing|focus time is over|stop focus mode|end focus mode)$/.test(s)) return { kind: 'focus_end' };
  const focus = /^(?:i need to (?:focus|concentrate)|i'm trying to focus|i am trying to focus|let me focus|quiet company|keep me company quietly|be quiet)(?: for (a bit|now|\d{1,3} (?:minutes?|mins?)))?$/.exec(s);
  if (focus) return { kind: 'focus', minutes: Math.min(180, Math.max(1, Number.parseInt(focus[1] ?? '', 10) || 25)) };
  return null;
}

/** Temporary requests never mutate the user's persistent settings or approved memories. */
export class Company {
  durable?: {staying():boolean;focused():boolean;avoiding(id:string):boolean;stayState(now:number):{phase:'sleep'|'awake'|null;remaining:number;reminderDue:boolean};markReminded():void};
  focusUntil = 0;
  private stayUntil = 0;
  private stayStarted = 0;
  private reminded = false;
  stayState(now = Date.now()) {
    if(this.durable)return this.durable.stayState(now);
    const remaining = this.stayUntil - now;
    const lead = Math.min(60000, (this.stayUntil - this.stayStarted) * .2);
    const nearEnd = Number.isFinite(remaining) && remaining > 0 && remaining <= lead;
    return { phase: remaining <= 0 ? null : nearEnd ? 'awake' as const : now - this.stayStarted >= 120000 ? 'sleep' as const : 'awake' as const,
      remaining, reminderDue: nearEnd && !this.reminded };
  }
  markReminded() { if(this.durable)this.durable.markReminded();else this.reminded = true; }
  private avoided = new Map<string, number>();
  get staying() { return this.durable?.staying()??this.stayUntil > Date.now(); }
  set staying(value: boolean) { this.stayUntil = value ? Infinity : 0; }
  avoiding(id: string, now = Date.now()) { if(this.durable)return this.durable.avoiding(id);const until = this.avoided.get(id) ?? 0; if (until <= now) this.avoided.delete(id); return until > now; }
  avoid(id: string, minutes?: number, now = Date.now()) { this.avoided.set(id, minutes === undefined ? Infinity : now + minutes * 60000); }
  allow(id: string) { this.avoided.delete(id); }
  pruneWindows(ids: ReadonlySet<string>) { for (const id of this.avoided.keys()) if (!ids.has(id)) this.avoided.delete(id); }
  focused(now = Date.now()) { return this.durable?.focused()??this.focusUntil > now; }
  apply(control: CompanyControl, now = Date.now()) {
    if (control.kind === 'focus') this.focusUntil = now + control.minutes * 60000;
    if (control.kind === 'focus_end' || control.kind === 'resume') this.focusUntil = 0;
    if (control.kind === 'stay') { this.stayStarted = now; this.reminded = false; this.stayUntil = control.minutes === undefined ? Infinity : now + control.minutes * 60000; }
    if (control.kind === 'release' || control.kind === 'resume') this.staying = false;
  }
  blocked(now = Date.now()) { return this.focused(now) || (this.durable?.staying()??this.stayUntil>now); }
  label(now = Date.now()) { return [this.focused(now) ? 'Quiet company' : '', (this.durable?.staying()??this.stayUntil>now) ? 'Staying here' : ''].filter(Boolean).join(' · '); }
}

export type VisitPhase = 'idle' | 'approach';
/** Cancellation token for the existing tour. The tour owns study, movement and rest. */
export class VisitSequence {
  phase: VisitPhase = 'idle';
  target: bigint | null = null;
  revision = 0;
  get approaching() { return this.phase === 'approach'; }
  begin(target: bigint) { this.cancel(); this.target = target; this.phase = 'approach'; return this.revision; }
  finish(revision: number) {
    if (revision !== this.revision || this.phase !== 'approach') return false;
    this.cancel(); return true;
  }
  cancel() { this.revision++; this.target = null; this.phase = 'idle'; }
}
