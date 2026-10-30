import { EnvironmentalCuriosity, type VisibleSubject } from '../shared/curiosity';
import { DesktopVisits, PhysicalCueGate, WindowWatch } from '../shared/desktopVisits';
import { ActivityDirector } from '../shared/activity';
import { CursorReturn } from '../shared/cursorReturn';
import { TheatreCadence } from '../shared/theatrics';
import type { Opportunity } from './cognitiveRuntime';
import { MusicChanges } from '../shared/musicChanges';
import { ExplorationDirector } from '../shared/explorationDirector';

export interface PresenceSample {
  at: number; idleSec: number; sleepAfter: number; date: string; hour: number;
  windows: { id: string; key?: string; label?:string; semantic?:string; video?:boolean }[]; engaged?:boolean; active?: { id: string; key: string; title: string };
  watched?: { id: string; key: string; video: boolean }; video?: { id: string; key: string };
  physical?: { id: string; key: string; near: boolean };
  contextCue: string; lowBattery: boolean; rest: boolean; music?: { key: string; title: string; artist: string; visible: boolean };
  teleport: { auto: boolean; minMs: number; maxMs: number };
  explorationReadyAt?: number;
  enabled: { context: boolean; speech: boolean; activities: boolean; movement: boolean; exploration?: boolean; return?: boolean; newWindows: boolean; cursor: boolean; inspect: boolean; theatre: boolean; possession: boolean; cursorNear: boolean; satellite: boolean };
  busy: boolean; movementBusy: boolean; pointerProtected: boolean;
  candidates: Opportunity[];
}
/** Policy only: no callbacks, native handles, renderer objects or I/O. All
 * clocks are sample time; one agenda arbitrates speech, glances and movement. */
export class PresencePolicy {
  readonly curiosity = new EnvironmentalCuriosity();
  readonly visits: DesktopVisits;
  readonly physical = new PhysicalCueGate();
  readonly watch = new WindowWatch();
  readonly activities = new ActivityDirector();
  readonly returns = new CursorReturn();
  readonly theatre = new TheatreCadence();
  readonly music = new MusicChanges();
  readonly outings = new ExplorationDirector(()=>Math.random());
  private backgroundSongAt = -Infinity;
  private lastMusic = '';
  private lastCue = '';
  private revision = 0;
  private autoAt = 0;
  constructor(private now = () => Date.now()) { this.visits = new DesktopVisits(now()); }
  teleportStatus(ready:boolean) {return {nextAt:this.autoAt,ready:ready&&this.autoAt>0};}
  resetTeleport() { this.autoAt = 0; }
  clear() { this.curiosity.clear(); this.visits.clear(this.now()); this.returns.cancel(); this.lastCue = this.lastMusic = ''; }
  sample(s: PresenceSample, ready: boolean): Opportunity[] {
    const result: Opportunity[] = [], blocked = !ready || s.busy;
    const add = (event: string, action: Opportunity['action'], subject: string, priority: number, target?: string, detail?: string, revision = 1) => result.push({ id: `${event}:${subject}`, subject: `${event}:${subject}`, revision, source: 'desktop', at: s.at, expiresAt: s.at + (action === 'reason' ? 90000 : 8000), priority, event, action, target, detail });
    const changes = this.curiosity.syncWindows(s.enabled.context ? s.windows : [], s.at);
    this.visits.closed(new Set(s.windows.map(w => w.id)));
    for (const c of changes) if (c.kind === 'opened') this.visits.opened(c.id, s.at);
    const returned = this.returns.observe(s.idleSec, s.at, Math.min(90,s.sleepAfter));
    if (returned && this.returns.move(s.at, blocked || s.movementBusy || s.enabled.return === false)) add('return', 'move', `return:${s.at}`, 90);
    this.curiosity.observe(s.enabled.context && s.idleSec < 60 ? s.active?.key ?? null : null, s.at);
    const choice = this.curiosity.choose(s.at, { blocked: blocked || !s.enabled.activities || s.movementBusy, mayInspect: s.enabled.inspect && s.enabled.speech, windows:s.windows.filter((w):w is VisibleSubject=>!!w.key), engaged:s.engaged });
    if ((choice.target??s.active) && choice.action !== 'quiet') add(choice.action === 'inspect' ? 'inspect' : 'look', choice.action === 'inspect' ? 'reason' : 'perform', (choice.target??s.active)!.key, 40, (choice.target??s.active)!.id, choice.reason, choice.action === 'inspect' ? ++this.revision : 1);
    const moveBlocked = blocked || s.movementBusy || !s.enabled.activities || !s.enabled.movement || s.idleSec >= 120;
    if (!this.autoAt) this.autoAt = s.at + s.teleport.minMs + Math.random() * (s.teleport.maxMs-s.teleport.minMs);
    if (s.teleport.auto && s.at >= this.autoAt && !blocked && !s.movementBusy && s.enabled.movement && s.idleSec<120) { add('native-auto','move',`native-auto:${s.at}`,34); this.autoAt = s.at + s.teleport.minMs + Math.random() * (s.teleport.maxMs-s.teleport.minMs); }
    const window = this.visits.window(s.at, moveBlocked || !s.enabled.newWindows);
    if (window) add('visit', 'move', window, 35, window);
    else if (this.visits.cursor(s.at, moveBlocked || !s.enabled.cursor || s.pointerProtected)) add('cursor', 'move', `cursor:${s.at}`, 25);
    const cue = s.lowBattery ? `battery:${s.date}` : s.hour >= 23 || s.hour < 5 ? `clock:${s.date}` : '';
    if (cue && this.physical.taskbar(cue,moveBlocked)) add(s.lowBattery ? 'battery' : 'clock','move',cue,30,s.active?.id);
    if (s.rest && !moveBlocked) add('rest','move',`rest:${s.date}`,28,s.active?.id);
    if (s.physical && this.physical.shift(s.physical.key,s.at,moveBlocked)) add('shift','move',s.physical.key,20,s.physical.id,s.physical.near ? 'the pointer approached her space' : 'a fresh observed view offered another detail');
    if (s.video && this.watch.videoVisit(s.video.key,s.at,moveBlocked || !s.enabled.newWindows)) add('visit','move',s.video.key,38,s.video.id);
    this.music.observe(s.music ?? null,s.at);
    const track = this.music.take(s.at,!s.enabled.speech);
    if (track && (!s.music?.visible ? s.at-this.backgroundSongAt>=900000 : true) && track.key !== this.lastMusic) {
      // Only consume a track once it has entered the bounded agenda.
      this.lastMusic=track.key; if (!s.music?.visible) this.backgroundSongAt=s.at;
      add('song','reason',track.key,55,undefined,'A new identified playing song can earn a specific personal opinion. No lyrics or claims of hearing live audio.');
      result[result.length-1].media = { ...track };
    }
    if (s.contextCue && s.contextCue !== this.lastCue && s.enabled.speech) add('context','reason',s.contextCue,45);
    this.lastCue=s.contextCue;
    const theatre=this.theatre.choose(s.at,s.date,{blocked:blocked||!s.enabled.theatre||s.movementBusy,possession:s.enabled.possession,cursorNear:s.enabled.cursorNear,satellite:s.enabled.satellite,mischief:true});
    if (theatre) add('theatre','perform',`theatre:${s.at}`,15,undefined,theatre);
    const beat=this.activities.tick(s.at,{subject:s.active&&this.curiosity.stable(s.active.key,s.at)?s.active.title:'',idleSec:s.idleSec,blocked:blocked||s.movementBusy||!s.enabled.activities||s.idleSec>=s.sleepAfter});
    if (beat) add('activity','perform',`activity:${s.at}`,10,s.active?.id,beat.kind);
    if (!moveBlocked && s.enabled.exploration && s.at >= (s.explorationReadyAt??0)) add('explore','move',`explore:${Math.floor(s.at/30000)}`,5);
    if (s.enabled.speech) result.push(...s.candidates.slice(0,8));
    return result.map(o => ({...o,change:o.event==='inspect'?'probe':o.change,targetKey:o.target===s.active?.id?s.active?.key:o.target===s.watched?.id?s.watched?.key:s.windows.find(w=>w.id===o.target)?.key}));
  }
}
