/** Host-independent presentation policy. It requests existing animations, never
 * treats an animation request as a completed physical action. No model calls. */
export type SpeechOrigin = { kind:'authored'; lineId:string } | { kind:'generated-direct'|'generated-spontaneous'|'action-result'|'system-error' };
export type FeedbackKind = 'repetitive'|'generic'|'character'|'intrusive';
export type Reaction = 'happy'|'surprised'|'annoyed'|'curious'|'wave'|'nod';
export interface PerformanceInput {
  meaning?:string; attitude?:'curious'|'playful'|'defensive'|'sincere'|'settled';
  direct:boolean; quiet:boolean; available:boolean; held:boolean; moving:boolean;
  line?:string; origin:SpeechOrigin; reaction?:Reaction; availableReactions:readonly Reaction[];
  /** Completed host actions may support physical claims. Model intent cannot. */
  actionVerified?:boolean;
}
export type PerformanceBeat = {kind:'expression';reaction:Reaction}|{kind:'speech';text:string};
export interface PerformancePlan { speech?:string; origin:SpeechOrigin; reaction?:Reaction; reason:string; intention?:string; beats?:PerformanceBeat[] }
export interface PerformanceOutcome { action:'completed'|'failed'|'interrupted'|'dispatched'; continued:boolean }
export class PerformanceDirector {
  private feedback:{kind:FeedbackKind;at:number}[]=[];
  private serial=0;
  private animations:{id:number;reaction:Reaction;at:number;status:'requested'|'completed'|'interrupted'|'expired'}[]=[];
  constructor(private now=Date.now) {}
  /** A physical intention becomes evidence only after host verification. The
   * continuation is checked again after the await (drag, sleep, revocation). */
  async perform(action:()=>Promise<boolean|undefined>,valid:()=>boolean,after?:()=>Promise<void>):Promise<PerformanceOutcome> {
    if(!valid())return {action:'interrupted',continued:false};
    let result:boolean|undefined;try{result=await action();}catch{return {action:'failed',continued:false};}
    if(!valid())return {action:'interrupted',continued:false};
    if(result!==true)return {action:result===false?'failed':'dispatched',continued:false};
    if(after){await after();return {action:'completed',continued:true};}
    return {action:'completed',continued:false};
  }
  requestAnimation(reaction:Reaction) { const id=++this.serial;this.animations.push({id,reaction,at:this.now(),status:'requested'});this.animations=this.animations.slice(-32);return id; }
  animationResult(id:number,status:'completed'|'interrupted') { const item=this.animations.find(a=>a.id===id);if(item?.status==='requested'&&this.now()-item.at<15000)item.status=status; }
  animationState() {for(const a of this.animations)if(a.status==='requested'&&this.now()-a.at>=15000)a.status='expired';return this.animations.map(a=>({...a}));}
  feedbackGiven(kind:FeedbackKind,at=this.now()) {if(at>this.now()||this.now()-at>=600000)return; this.feedback.push({kind,at});this.feedback=this.feedback.slice(-32); }
  context() {
    const kinds=new Set(this.feedback.filter(f=>this.now()-f.at<10*60000).map(f=>f.kind));
    const notes=[kinds.has('repetitive')?'Advance the thought or let it end; no callback to justify the criticism.':'',kinds.has('generic')?'Prefer one concrete judgment supported by the exchange; a plain answer is fine.':'',kinds.has('character')?'Use the established character guide and a fitting attitude, without forced wit or praise.':''].filter(Boolean);
    return notes.length?'\nTEMPORARY DELIVERY FEEDBACK: '+notes.join(' ')+'\n':'';
  }
  plan(i:PerformanceInput):PerformancePlan {
    const base={origin:i.origin};
    const expression=!i.held&&!i.moving&&i.reaction&&i.availableReactions.includes(i.reaction)?i.reaction:undefined;
    // Explicit quiet can retain a small stationary expression. Unavailability
    // (including gaming/calls) suppresses optional presentation altogether.
    if(!i.direct && (i.quiet||!i.available))return {...base,...i.available&&expression?{reaction:expression}:{},beats:i.available&&expression?[{kind:'expression',reaction:expression}]:[],intention:i.meaning,reason:'quiet presence'};
    const line=i.line?.replace(/\s*[—–]\s*/g,', ').trim();
    // Physical actions execute through the capability host, never through prose.
    const claims=/\bI(?:['’]ve| have)? (?:teleported|(?:moved|landed)\s+(?:here|there|onto|into|to your|to the)|read your document|inspected the geometry)\b/i;
    if(line && claims.test(line) && !i.actionVerified)return {...base,reason:'unverified physical claim'};
    const intrusive=this.feedback.some(f=>f.kind==='intrusive'&&this.now()-f.at<10*60000);
    if(!i.direct&&intrusive)return {...base,reason:'temporary feedback quiet'};
    const reaction=!i.held&&!i.moving&&i.reaction&&i.availableReactions.includes(i.reaction)?i.reaction:undefined;
    const beats:PerformanceBeat[]=[];
    if(reaction)beats.push({kind:'expression',reaction});
    if(line)beats.push({kind:'speech',text:line});
    return {...base,speech:line||undefined,reaction,beats,intention:i.meaning,reason:line?'speak':reaction?'expression only':'silence'};
  }
}
