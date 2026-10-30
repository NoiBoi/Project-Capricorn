export interface PoseSupport { sit: boolean; lie: boolean; kind: 'window_top' | 'window_bottom' | 'taskbar' | 'none'; tight?: boolean; landing?: 'stand' | 'sit' | 'lie'; sustainedRest?:boolean }
export interface SecondaryInput {
  enabled: boolean; blocked: boolean; support: PoseSupport; inverted: boolean;
  hovering: boolean; inspectingBelow: boolean; patting: boolean;
}
/** Front sitting is earned by sustained rubbing; lower ledges start a quiet lounge. */
export class SecondaryBehavior {
  private rest = 0;
  private rub = 0;
  private supportKind: PoseSupport['kind'] = 'none';
  update(dt: number, input: SecondaryInput): { pose: 'sit_closed' | 'recline' | null; standing?: boolean; closed: boolean; reason: string } {
    if (input.support.kind !== this.supportKind) { this.rest = this.rub = 0; this.supportKind = input.support.kind; }
    if (!input.enabled || input.blocked) {
      this.rest = this.rub = 0;
      return { pose: null, closed: false, reason: 'busy' };
    }
    if (input.support.tight && input.support.lie && !input.inverted) {
      this.rub = 0;
      return { pose: 'recline', closed: false, reason: 'low ceiling' };
    }
    const uprightWindow = input.support.sit && input.support.kind === 'window_top' && !input.inverted && input.support.landing !== 'stand';
    this.rub = uprightWindow && input.patting ? this.rub + dt : 0;
    if (this.rub >= 4) return { pose: 'sit_closed', closed: true, reason: 'sustained head rub' };
    if (input.support.landing) {
      return input.support.landing === 'lie' && input.support.lie && !input.inverted
        ? { pose: 'recline', closed: false, reason: 'settled after landing' }
        : { pose: null, closed: false, reason: 'recovering after landing' };
    }
    const lounge = input.support.sit && input.support.lie && !input.inverted
      && (input.support.kind === 'taskbar' || input.support.kind === 'window_bottom');
    this.rest = lounge ? this.rest + dt : 0;
    // A lower edge is a place to linger, not a command to lie down.
    // Reuse the existing physical pose clock; no speech or model requests.
    const beat=this.rest % (input.support.sustainedRest ? 210 : 140);
    if(lounge && beat>=35 && beat<55)return {pose:null,standing:true,closed:false,reason:'standing on lower ledge'};
    if(lounge && beat>=55 && beat<(input.support.sustainedRest?180:120))return {pose:'recline',closed:false,reason:'lower ledge rest'};
    return { pose: null, closed: false, reason: 'primary' };
  }
}
