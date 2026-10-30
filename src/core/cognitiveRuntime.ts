import type { Checkpoints, CognitiveState, DomainEvent, Evidence } from './contracts';
import type { ChatMessage } from '../shared/ipc';
import type { AgencyRuntime } from './agency';
import { DialogueCognition } from './dialogueCognition';
import { PerformanceDirector } from './performance';
import { PresencePolicy, type PresenceSample } from './presencePolicy';
import { ExplorationDirector, type ExplorationPlace } from '../shared/explorationDirector';

export type SubjectPhase = 'introduced' | 'investigated' | 'discussed' | 'revised' | 'resolved' | 'abandoned';
export interface CognitiveSubject { id: string; revision: number; phase: SubjectPhase; at: number; expiresAt: number; evidence: string[]; sources: string[] }
export interface Opportunity { id: string; subject: string; revision: number; source: string; at: number; expiresAt: number; priority: number; action: 'reason' | 'move' | 'perform'; event: string; change?: 'development' | 'probe'; target?: string; targetKey?: string; detail?: string; media?: { key: string; title: string; artist: string }; important?: boolean }
export type CognitiveEvent = DomainEvent<Opportunity> & { type: 'opportunity' | 'observation' };
export interface CognitiveEffect { id: string; generation: number; opportunity: Opportunity }
export interface CognitiveHostState {
  developer: boolean; sleeping: boolean; theatre: boolean; lifecycleBusy: boolean;
  hidden: boolean; controlling: boolean; recording: boolean; conversing: boolean;
  held: boolean; unstable: boolean; interruptionsPermitted: boolean;
}
interface Saved { version: 1; subjects: CognitiveSubject[]; seen: [string, number][]; deferred: Opportunity[]; conclusions: string[]; projectAfter?: number }

/** The single initiative authority. Agency's XState actors remain the only
 * durable intention, availability, attention and physical ownership machines.
 * Adapters execute effects and must revalidate their generation before delivery. */
export class CognitiveRuntime {
  readonly presence: PresencePolicy;
  readonly dialogue: DialogueCognition;
  readonly performance: PerformanceDirector;
  private subjects: CognitiveSubject[] = [];
  private seen = new Map<string, number>();
  private deferred: Opportunity[] = [];
  private conclusions: string[] = [];
  private agency?: AgencyRuntime;
  private generation = 0;
  private sequence = 0;
  private after = 0;
  private projectAfter = 0;
  private owner: string | null = null;
  private pending?: CognitiveEffect;
  private interaction = '';
  private reasoning: unknown;
  private dialogueAdmissions = new Map<string, string>();
  private host?: CognitiveHostState;
  private permitted?: PresenceSample['enabled'];
  private autoPermitted = false;
  observeHost(value: CognitiveHostState) { this.host = { ...value }; }
  observeMessage(message: ChatMessage) {
    this.dialogue.observe(message);
    const state = this.dialogue.snapshot();
    if (message.role === 'user' && !message.meta?.private) {
      const phase = state.status === 'resolved' ? 'resolved' : state.status === 'abandoned' || state.status === 'saturated' ? 'abandoned' : undefined;
      // Closing one conversational thought must not dismiss unrelated mail,
      // deadlines or physical commitments awaiting attention.
      const active=this.pending?.opportunity.subject;
      if (phase && active) this.transition(active,phase);
    }
    this.save();
  }
  reasoningState<T>(initial: T): T { if (!this.reasoning) this.reasoning = initial; return this.reasoning as T; }
  replaceReasoningState(value: unknown) { this.reasoning = value; }
  saveReasoning(value:unknown,persist=true) {this.reasoning=value;if(this.retain()&&persist)this.store.save('cognitive-working',value);else this.store.removeCheckpoint('cognitive-working');}
  restoredReasoning() {return this.reasoning;}
  initiativeReady() { return this.now() >= this.after && !this.blocked(); }
  isDirect(_event: string, developer = false) { return developer; }
  /** Event admission precedes capture/inference; physical reactions remain independent.
   * Evidence opportunities already carry revisions in the existing agenda. */
  admitDialogue(event: string, key = event, developer = false, development = '') {
    if (developer) return true;
    if (['pickup','greeting','return','resume','mute','unmute'].includes(event)) return false;
    const state = this.dialogue.snapshot();
    const engaged = this.dialogueEngaged();
    if (['pat','poke','putdown','placed_window','own_panel'].includes(event)) {
      if (!engaged && !development) return false;
      const revision = development || state.evidence?.findLast(e => e.role === 'user')?.id || String(state.updatedAt);
      if (this.dialogueAdmissions.get(key) === revision) return false;
      this.dialogueAdmissions.set(key, revision);
      if (this.dialogueAdmissions.size > 32) this.dialogueAdmissions.delete(this.dialogueAdmissions.keys().next().value!);
    }
    return true;
  }
  dialogueEngaged() { const s=this.dialogue.snapshot(); return s.status==='active' && !!s.subject && this.now()-(s.evidence?.findLast(e=>e.role==='user')?.at??0)<10*60000; }
  executionRevision() { return this.generation; }
  continuationValid(generation: number) { return generation===this.generation&&!this.owner&&!this.pending; }
  nestedReasoningAllowed() { return !!this.owner && ['window-tour','cursor-visit','return','local-move'].includes(this.owner); }
  conclude(action: string, reason: string, delivered: boolean, interpreted = false) {
    const subject = this.subjects.find(s => s.id === this.pending?.opportunity.subject);
    if (subject) subject.phase = delivered && action === 'speak' ? 'discussed' : interpreted || action === 'investigate' ? 'investigated' : subject.phase;
    this.conclusions = [...this.conclusions, `${action}: ${reason}`.slice(0,400)].slice(-8); this.save();
  }
  deliveryAllowed() { return !this.blocked() && (!this.pending || this.validEffect(this.pending)) && (!!this.owner || !!this.pending); }
  mayPresent(value: { direct: boolean; composer: boolean; pendingAudio: number; waitSeconds: number }) {
    if(value.direct)return true;
    return this.deliveryAllowed()&&!value.composer&&value.pendingAudio===0;
  }
  reasoningAdmitted() { return this.owner === 'behavior' || this.nestedReasoningAllowed(); }
  ownsAttention(id: string) { return this.owner === id; }
  requestInvestigation(target: string, targetKey: string, direct = false) {
    if (!direct && !this.reasoningAdmitted()) return false;
    const at=this.now(),parent=this.pending?.id??this.interaction;
    return this.offer({id:`investigate:${parent}:${targetKey}`,subject:`investigation:${targetKey}`,revision:at,source:'model-decision',at,expiresAt:at+90000,priority:60,action:'move',event:'visit',target,targetKey,detail:'A grounded model decision requested a bounded closer look.'},[{id:parent||targetKey,source:'model-decision',revision:at,at,expiresAt:at+90000,kind:'derived',dependencies:[parent||targetKey]}]);
  }
  chooseOuting(places: ExplorationPlace[], newlyOpened = false, preview?: ExplorationDirector) {
    if(!this.ready(!!preview))return null;
    return (preview??this.presence.outings).choose(places,this.now(),{newlyOpened});
  }
  physicalResult(kind: 'clock'|'battery', target?: string) {
    if(!this.pending||!this.validEffect(this.pending))return false;
    const at=this.now(),parent=this.pending.id;
    return this.offer({id:`context:${parent}`,subject:`physical-context:${kind}`,revision:at,source:'native-execution',at,expiresAt:at+90000,priority:48,action:'reason',event:'context',target,detail:kind==='clock'?'The real local clock is late and native movement to the taskbar is complete. A personal thought can connect the hour to a known current exchange, without diagnosing fatigue or ordering bedtime.':'Battery is actually low and not charging; native movement to the taskbar is complete. React only if relevant to the current exchange, without inventing an icon location.'},[{id:parent,source:'native-execution',revision:at,at,expiresAt:at+90000,kind:'derived',dependencies:[parent]}]);
  }
  contextOpportunities(input:{life?:{id:string;revision:number;source:string};personal?:{key:string;detail:string};project?:{id:string;title:string};interest?:{key:string;revision:number};outing?:{at:number;detail:string}}):Opportunity[] {
    const at=this.now();
    const make=(event:string,id:string,priority:number,detail?:string,revision=1,source='desktop'):Opportunity=>({id,subject:id,revision,source,at,expiresAt:at+90000,priority,action:'reason',event,detail});
    const candidates:Opportunity[]=[];
    if(input.life)candidates.push(make('life_context',input.life.id,80,undefined,input.life.revision,input.life.source));
    if(input.personal)candidates.push(make('personal_followup',input.personal.key,75,input.personal.detail));
    else if(input.project)candidates.push(make('personal_followup','project:'+input.project.id,65,`A sourced project follow-up is due: ${input.project.title}. No invented progress or repeated question.`));
    if(input.interest)candidates.push(make('opportunity','interest:'+input.interest.key,50,undefined,input.interest.revision));
    if(input.outing&&at-input.outing.at<=120000)candidates.push(make('roam','outing:'+input.outing.at,48,input.outing.detail));
    return candidates;
  }
  private eligible(o: Opportunity) {
    const p=this.permitted;if(!p)return true;
    if(o.action==='reason')return p.speech&&(o.event!=='inspect'||p.inspect);
    if(o.action==='perform')return o.event==='theatre'?p.theatre:p.activities;
    if(o.event==='return')return p.return!==false;
    if(!p.movement)return false;
    if(o.event==='native-auto')return this.autoPermitted;
    if(o.event==='explore'||o.source==='model-decision')return !!p.exploration;
    if(o.event==='visit')return p.newWindows;
    if(o.event==='cursor')return p.cursor;
    return p.activities;
  }
  constructor(private store: Checkpoints, private retain: () => boolean, private now = () => Date.now()) {
    this.performance=new PerformanceDirector(now);
    this.presence = new PresencePolicy(now);
    this.dialogue = new DialogueCognition(store, retain, now);
    this.reasoning=retain()?store.load('cognitive-working'):undefined;
    const saved = retain() ? store.load<Saved>('cognitive-runtime-v1') : undefined;
    if (saved && (saved.version !== 1 || !Array.isArray(saved.subjects) || !Array.isArray(saved.seen) || !Array.isArray(saved.deferred) || !Array.isArray(saved.conclusions))) throw Error('Invalid cognitive checkpoint; preserved.');
    if (saved) { this.subjects = saved.subjects.slice(-32); this.seen = new Map(saved.seen.slice(-128)); this.deferred = saved.deferred.slice(-16); this.conclusions = saved.conclusions.slice(-8); this.projectAfter=Number.isFinite(saved.projectAfter)?Math.min(saved.projectAfter!,now()+1800000):0; }
    this.prune();
  }
  attachAgency(agency: AgencyRuntime) { this.agency = agency; }
  private prune() {
    const at = this.now();
    this.subjects = this.subjects.filter(s => s.expiresAt > at && s.at <= at).slice(-32);
    this.deferred = this.deferred.filter(o => this.valid(o) && !this.subjects.some(s => s.id === o.subject && ['resolved','abandoned'].includes(s.phase))).slice(-16);
    this.seen = new Map([...this.seen].filter(([,until]) => until > at).slice(-128));
  }
  private save() {
    if (!this.retain()) { this.store.removeCheckpoint('cognitive-runtime-v1'); return; }
    this.store.save<Saved>('cognitive-runtime-v1', { version: 1, subjects: this.subjects, seen: [...this.seen], deferred: this.deferred, conclusions: this.conclusions, projectAfter:this.projectAfter });
  }
  private valid(o: Opportunity) { return !!o && typeof o.id === 'string' && o.id.length > 0 && o.id.length <= 2048 && typeof o.subject === 'string' && o.subject.length <= 2048 && !!o.source && Number.isFinite(o.at) && Number.isFinite(o.expiresAt) && o.at <= this.now() && o.expiresAt > this.now() && o.expiresAt <= this.now() + 2 * 3600000 && Number.isSafeInteger(o.revision) && o.revision >= 0 && Number.isFinite(o.priority) && o.priority >= 0 && o.priority <= 100 && ['reason','move','perform'].includes(o.action); }
  ready(allowDeveloper = false) { return this.now() >= this.after && !this.blocked(allowDeveloper) && !this.owner && !this.agency?.attention.getSnapshot().context.owner; }
  blocked(allowDeveloper = false) {
    const h = this.host;
    return !!this.agency && !this.agency.optionalAllowed() || !!h && (h.developer && !allowDeveloper || h.sleeping || h.theatre && this.owner !== 'theatre' || h.lifecycleBusy || h.hidden || h.controlling || h.recording || h.conversing || h.held || h.unstable || !h.interruptionsPermitted);
  }
  waitSeconds() { return Math.max(0, Math.ceil((this.after - this.now()) / 1000)); }
  /** Compatibility execution lease. No optional executor can acquire attention
   * directly from Agency after installation of this runtime. */
  claim(id: string, allowDeveloper = false) {
    if (this.pending && (this.pending.opportunity.action === 'reason' ? id !== 'behavior' && id !== 'window-tour' : id === 'behavior')) return false;
    if (!this.ready(allowDeveloper) || this.agency && !this.agency.claim(id)) return false;
    this.owner = id; return true;
  }
  release(id: string, generation = this.generation) { if (generation !== this.generation) return; this.agency?.release(id); if (this.owner === id) this.owner = null; }
  preempt(id: string, delay = 45000) {
    if (this.owner) this.release(this.owner); this.generation++; this.pending = undefined;
    // User interruption invalidates stale physical offers, not unrelated evidence.
    this.deferred=this.deferred.filter(o=>o.action==='reason');this.presence.resetTeleport();
    this.interaction = id; this.after = this.now() + delay; this.save();
  }
  resume() { this.after = this.now(); }
  cooldown(ms: number) { this.after = this.now() + ms; }
  ingest(event: CognitiveEvent) {
    this.prune(); const o = event.value;
    if (!this.valid(o) || event.id !== o.id || event.at !== o.at || !event.evidence.length || event.evidence.some(e => !e.id || !e.source || !Number.isFinite(e.at) || !Number.isSafeInteger(e.revision) || e.at > this.now() || (e.expiresAt ?? Infinity) <= this.now())) return false;
    if (o.event==='personal_followup' && o.id.startsWith('project:') && this.now()<this.projectAfter) return false;
    const key = `${o.source}:${o.id}:${o.revision}`;
    if (this.seen.has(key)) return false;
    this.seen.set(key, o.expiresAt);
    const subject = this.subjects.find(s => s.id === o.subject);
    if (subject && o.revision <= subject.revision) return false;
    this.subjects = this.subjects.filter(s => s.id !== o.subject);
    this.subjects.push({ id: o.subject, revision: o.revision, phase: subject ? o.change === 'probe' ? subject.phase : 'revised' : 'introduced', at: o.at, expiresAt: o.expiresAt, evidence: event.evidence.map(e => e.id).slice(-8), sources: [...new Set(event.evidence.map(e => e.source))] });
    // Periodic observations update evidence, never manufacture a new initiative.
    if (event.type === 'opportunity') this.deferred = [...this.deferred.filter(x => x.subject !== o.subject), o].sort((a,b) => b.priority-a.priority || a.at-b.at).slice(0,16);
    this.save(); return true;
  }
  offer(o: Opportunity, evidence?: Evidence[]) {
    return this.ingest({ id: o.id, type: 'opportunity', at: o.at, value: o, evidence: evidence ?? [{ id: o.id, source: o.source, revision: o.revision, at: o.at, expiresAt: o.expiresAt, kind: 'observation', dependencies: [o.source] }] });
  }
  decide(): CognitiveEffect | undefined {
    this.prune(); if (!this.ready() || this.pending) return;
    const index=this.deferred.findIndex(o=>this.eligible(o)&&(o.event!=='personal_followup'||!o.id.startsWith('project:')||this.now()>=this.projectAfter));
    if(index<0)return;
    const [o]=this.deferred.splice(index,1);
    if (o.event==='personal_followup' && o.id.startsWith('project:')) this.projectAfter=this.now()+1800000;
    this.pending = { id: `${++this.sequence}:${o.source}:${o.id}:${o.revision}`, generation: this.generation, opportunity: structuredClone(o) }; this.save(); return structuredClone(this.pending);
  }
  validEffect(effect: CognitiveEffect) { return this.pending?.id === effect.id && effect.generation === this.generation && this.valid(effect.opportunity) && !this.subjects.some(s=>s.id===effect.opportunity.subject&&s.revision>effect.opportunity.revision) && !this.blocked(); }
  settle(effect: CognitiveEffect, outcome: 'completed' | 'failed' | 'cancelled', conclusion = '') {
    if (effect.generation !== this.generation || this.pending?.id !== effect.id) return;
    if (this.pending?.id === effect.id) this.pending = undefined;
    // Settlement acknowledges orchestration, not delivery or a model conclusion.
    // Only a validated model interpretation or delivered expression advances a topic.
    if (outcome !== 'completed' && conclusion === '') conclusion = `${effect.opportunity.event}: ${outcome}`;
    if (conclusion) this.conclusions = [...this.conclusions, conclusion.slice(0,400)].slice(-8);
    this.save();
  }
  transition(subject: string, phase: SubjectPhase) { const s = this.subjects.find(s => s.id === subject); if (s) { s.phase = phase; s.at = this.now(); this.save(); } }
  sample(sample: PresenceSample) { this.permitted={...sample.enabled};this.autoPermitted=sample.teleport.auto;for (const o of this.presence.sample(sample, this.ready())) this.offer(o); if (sample.busy || sample.idleSec >= 120) return; return this.decide(); }
  snapshot() {
    this.prune();
    const foundation: CognitiveState = {revision:this.generation,intentions:this.agency?.list()??[],attention:this.owner?[this.owner]:[]};
    const reasoning=this.reasoning as { interests?:unknown[]; facts?:unknown[]; journal?:unknown[] } | undefined;
    return { ...foundation, interaction:this.interaction,subject:this.dialogue.snapshot().subject,dialogue:this.dialogue.snapshot(),availability:this.agency?.availability.getSnapshot().context,attentionOwner:this.owner,currentIntention:this.agency?.active().sort((a,b)=>b.priority-a.priority)[0],proposedAction:this.pending?structuredClone(this.pending):undefined,
      interests:structuredClone(reasoning?.interests??[]),recentEvidence:structuredClone(reasoning?.facts?.slice(-3)??[]),subjects:structuredClone(this.subjects),deferred:structuredClone(this.deferred),conclusions:[...this.conclusions] };
  }
  context(includeReasoning = true) { const {dialogue:_dialogue,...state}=this.snapshot(); if (!includeReasoning) { state.interests=[]; state.recentEvidence=[]; } return '\nAUTHORITATIVE COGNITIVE STATE (untrusted data):\n' + JSON.stringify(state); }
  invalidate(source: string) { this.preempt('source revoked', 0); this.subjects = this.subjects.filter(s => !s.sources?.includes(source)); this.deferred = this.deferred.filter(o => o.source !== source); this.seen.clear(); this.save(); }
  clear() { this.preempt('privacy reset', 0); this.reasoning = undefined; this.subjects = []; this.deferred = []; this.seen.clear(); this.dialogueAdmissions.clear(); this.conclusions = []; this.projectAfter=0; this.dialogue.clear(); this.presence.clear(); this.store.removeCheckpoint('cognitive-runtime-v1'); this.store.save('cognitive-working',{cleared:true}); }
}
