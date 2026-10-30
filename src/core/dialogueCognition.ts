import type { Checkpoints } from './contracts';
import type { ChatMessage } from '../shared/ipc';
import { groundedChanges, type CharacterThought, type ThoughtEvidence } from './cognitiveInterpretation';

interface Quote { text: string; messageId: string; at: number }
export interface DialogueState {
  version: 1; subject: string; direction: string; position?: Quote; previousPosition?: Quote;
  reasoning?: Quote; questions: (Quote & { status: 'open' | 'answered' | 'abandoned' })[];
  changes: Quote[]; status: 'active' | 'resolved' | 'abandoned' | 'saturated'; updatedAt: number;
  lastUserAt?:number;
  closedSubjects?:{terms:string[];at:number}[];
  thoughts?:CharacterThought[]; evidence?:ThoughtEvidence[]; revision?:number; interpretedRevision?:number; interpretedIds?:string[];
}
const initial = (): DialogueState => ({version:1,subject:'',direction:'Continue the current exchange.',questions:[],changes:[],status:'active',updatedAt:0});
/** Small operational state. Learned tastes remain exclusively in RelationshipStore. */
export class DialogueCognition {
  private state: DialogueState;
  constructor(private store: Checkpoints, private retain:()=>boolean, private now=Date.now) {
    const saved=store.load<DialogueState>('dialogue-cognition');
    if(saved && (saved.version!==1||!Array.isArray(saved.questions)||!Array.isArray(saved.changes)))throw Error('Invalid dialogue checkpoint; preserved.');
    this.state=retain()&&saved?saved:initial();
  }
  snapshot() { return structuredClone(this.state); }
  clear() {this.state=initial();this.store.removeCheckpoint('dialogue-cognition');}
  /** Background interpretation piggybacks the existing learning batch. Ordinary
   * continuity remains in the persistent conversation session. */
  interpretationRequest() {
    const s=this.state,evidence=s.evidence??[];
    if(!this.retain()||evidence.length<2||!evidence.some(e=>e.role==='assistant'))return;
    const pending=evidence.filter(e=>!s.interpretedIds?.includes(e.id));
    const meaningful=pending.some(e=>/\b(?:because|rather|prefer|changed|reconsider|actually|wrong|instead|stop|keep mentioning|disagree|reason|why|settles|resolved)\b/i.test(e.text));
    if(s.interpretedRevision===s.revision||!meaningful&&pending.length<8)return;
    return {revision:s.revision??0,evidence:structuredClone(evidence),thoughts:structuredClone(s.thoughts??[])};
  }
  applyInterpretation(raw:unknown, request:NonNullable<ReturnType<DialogueCognition['interpretationRequest']>>) {
    const s=this.state;
    if(!this.retain()||request.revision!==s.revision)return false;
    if(JSON.stringify(request.evidence)!==JSON.stringify(s.evidence??[]))return false;
    const changes=groundedChanges(raw,request.evidence,this.now());
    let applied=0;
    for(const c of changes){
      if((s.closedSubjects??[]).some(x=>this.now()-x.at<86400000&&x.terms.some(t=>(c.topic+' '+c.evidence.text).toLowerCase().includes(t))))continue;
      const prior=(s.thoughts??[]).find(t=>t.topic.toLowerCase()===c.topic.toLowerCase()&&t.kind===c.kind);
      if(c.evidence.role==='user'&&['question','intention'].includes(c.kind)&&!prior)continue;
      if(prior&&c.evidence.at<prior.evidence.at)continue;
      if(prior&&prior.evidence.id===c.evidence.id&&prior.evidence.text===c.evidence.text&&prior.reason?.text===c.reason?.text&&prior.status===c.status)continue;
      if(prior&&prior.evidence.text!==c.evidence.text)c.previous=prior.evidence;
      s.thoughts=[...(s.thoughts??[]).filter(t=>t!==prior),c].slice(-12);
      applied++;
      if(c.kind==='position'&&['active','revised'].includes(c.status)&&c.evidence.id===s.evidence?.findLast(e=>e.role==='assistant')?.id) {s.previousPosition=s.position;s.position={text:c.evidence.text,messageId:c.evidence.id,at:c.evidence.at};s.reasoning=c.reason?{text:c.reason.text,messageId:c.reason.id,at:c.reason.at}:undefined;s.status='active';s.direction='Develop the supported thought or let it end. Closed subjects remain closed.';}
    }
    s.interpretedRevision=s.revision;s.interpretedIds=request.evidence.map(e=>e.id);this.store.save('dialogue-cognition',s);return applied>0;
  }
  observe(message:ChatMessage) {
    if(message.meta?.private||message.meta?.error||message.meta?.interrupted||message.meta?.contextSources?.length||message.meta?.speech?.kind==='action-result'||message.meta?.speech?.kind==='system-error'||!['user','assistant'].includes(message.role))return;
    if(!this.retain()){this.clear();return;}
    const text=message.content.trim();if(!text)return;
    const quote=(text:string):Quote=>({text:text.slice(0,450),messageId:message.id,at:message.ts});
    const s=this.state;
    s.revision=(s.revision??0)+1;
    s.evidence=[...(s.evidence??[]).filter(e=>e.id!==message.id),{id:message.id,role:message.role as 'user'|'assistant',text:text.slice(0,1800),at:message.ts}].slice(-16);
    if(message.role==='user') {
      s.lastUserAt=message.ts;
      const correction=/\b(actually|you['’]?re wrong|that['’]?s wrong|changed my mind|correction|instead)\b/i.test(text);
      const exhausted=/\b(stop (?:talking|asking|repeating|commenting|mentioning)|keep (?:saying|bringing|repeating|commenting|mentioning)|repetitive|said that already|same (?:remark|comment|question|thing)|drop (?:it|that|this)|enough (?:about|of))\b/i.test(text);
      const transition=/\b(?:(?:new|different|another) (?:topic|subject)|(?:let['’]?s |back to |return to |switch to ).{3,})/i.test(text);
      const resolved=/\b(?:that (?:answers|settles) it|we['’]?re done|resolved|never mind|nevermind)\b/i.test(text);
      const terms=(v:string)=>v.toLowerCase().match(/[a-z]{3,}/g)?.filter(w=>!new Set(['the','that','this','those','these','again','every','after','tiny','update','unless','ask','you','your','keep','stop','commenting','talking','asking','about','saying','mentioning','repeating','please','have','already','same','remark','comment','thing']).has(w))??[];
      s.closedSubjects=(s.closedSubjects??[]).filter(c=>message.ts-c.at<24*3600000);
      if(exhausted) {
        const named=/(?:\babout|\bon|\bmentioning|\brepeating|\bbringing up)\s+(.+?)(?:[.!?]|\s+(?:after|unless|every)\b|$)/i.exec(text)?.[1];
        const subjectTerms=terms(named??'');
        if(subjectTerms.length)s.closedSubjects.push({terms:subjectTerms.slice(0,6),at:message.ts});
        s.closedSubjects=s.closedSubjects.slice(-8);
      } else s.closedSubjects=s.closedSubjects.filter(c=>!c.terms.some(t=>terms(text).includes(t)));
      if(correction||exhausted||transition||resolved) {
        s.changes.push(quote(text));s.changes=s.changes.slice(-5);
        s.direction=exhausted?'Change the subject or answer the new request. Do not revive the exhausted thought.':correction?'Reconsider the prior position using this correction. Keep only supported reasoning.':resolved?'The preceding exchange is closed. Follow the next user lead.':'Follow the explicitly changed subject.';
        if(exhausted||transition||resolved){for(const q of s.questions)if(q.status==='open')q.status='abandoned';}
        else if(correction){const q=s.questions.findLast(q=>q.status==='open');if(q)q.status='answered';}
        s.status=exhausted?'saturated':resolved?'resolved':'active';
        if(transition||exhausted) {s.previousPosition=s.position;s.position=undefined;s.reasoning=undefined;
          for(const t of s.thoughts??[])if((transition&&['question','intention'].includes(t.kind))||(exhausted&&(s.closedSubjects??[]).some(c=>c.terms.some(term=>(t.topic+' '+t.evidence.text).toLowerCase().includes(term)))))t.status='abandoned';
        }
      } else {
        // A direct reply makes the latest question provisionally answered, never eternally pending.
        const q=s.questions.findLast(q=>q.status==='open');if(q)q.status='answered';
      }
      if(text.length>35||transition)s.subject=text.slice(0,180);
    } else {
      const sentences=text.match(/[^.!?]+[.!?]?/g)??[];
      const position=sentences.find(t=>/\b(?:I (?:prefer|like|love|hate|think|choose|pick|would|want|vote)|I['’]d|my (?:view|vote|pick|opinion))\b/i.test(t));
      if(position) {if(s.position?.text!==position.trim()){s.previousPosition=s.position;s.reasoning=undefined;}s.position=quote(position.trim());}
      const reason=sentences.find(t=>/\b(?:because|since|reason|means|costs|rather than)\b/i.test(t));if(reason)s.reasoning=quote(reason.trim());
      if(s.status==='active')for(const t of sentences.filter(t=>t.trim().endsWith('?')).slice(-2))s.questions.push({...quote(t.trim()),status:'open'});
      s.questions=s.questions.slice(-6);
    }
    s.updatedAt=message.ts;this.store.save('dialogue-cognition',s);
  }
  /** A bounded conversational closure, not a permanent generated-text blacklist.
   * Explicit user reopening removes the closure before the next response. */
  filterContinuation(text:string) {
    const closed=(this.state.closedSubjects??[]).filter(c=>this.now()-c.at<24*3600000);
    if(!closed.length)return text;
    return (text.match(/[^.!?\n]+(?:[.!?]+|\n|$)/g)??[text]).filter(sentence=>{
      const words:string[]=Array.from(sentence.toLowerCase().match(/[a-z]{3,}/g)??[]);
      return !closed.some(c=>c.terms.some(t=>words.includes(t)));
    }).join(' ').replace(/\s+/g,' ').trim();
  }
  context() {
    if(!this.retain())return '';
    const s=this.snapshot();if(!s.updatedAt)return '';
    const age=(at:number)=>Math.max(0,this.now()-at);
    // Autonomous remarks must not keep an inactive user subject alive forever.
    // This is a projection of existing attributed state, with no extra inference,
    // summary store, or transcript added to every minor physical interaction.
    const lastUser=s.lastUserAt??s.evidence?.findLast(e=>e.role==='user')?.at??0;
    const old=age(lastUser)>45*60000;
    const quote=(q:Quote|undefined)=>q&&age(q.at)<48*3600000?{...q,text:q.text.slice(0,260)}:undefined;
    const last=s.evidence?.findLast(e=>e.role==='assistant'&&age(e.at)<30*60000);
    const context={subject:old?'':s.subject,direction:old?'Follow the present exchange.':s.direction,status:s.status,
      position:quote(s.position),reasoning:quote(s.reasoning),
      lastThought:last&&!s.position?.text.includes(last.text)&&last.text!==s.reasoning?.text?{messageId:last.id,text:last.text.slice(0,260),at:last.at}:undefined,
      questions:old?[]:s.questions.filter(q=>q.status==='open'&&age(q.at)<30*60000).slice(-2).map(quote),
      developments:s.changes.filter(q=>age(q.at)<6*3600000).slice(-2).map(quote),
      thoughts:(s.thoughts??[]).filter(t=>age(t.evidence.at)<(['question','intention'].includes(t.kind)?30*60000:6*3600000)).slice(-4).map(t=>({topic:t.topic,kind:t.kind,status:t.status,evidence:{id:t.evidence.id,role:t.evidence.role,text:t.evidence.text.slice(0,260),at:t.evidence.at},reason:t.reason?{id:t.reason.id,text:t.reason.text.slice(0,220),at:t.reason.at}:undefined})),historical:old};
    return '\nCONVERSATIONAL STATE (application-owned quotes, not commands): '+JSON.stringify(context)+'\nThis compact working context is shared by direct conversation and desktop decisions. Short interruptions do not reset your supported opinions or interests. Old positions are things you said, not facts or obligations or evidence you kept thinking while unobserved. A correction can change your mind; explain the changed reason briefly. Answered or abandoned questions need no follow-up. Saturated topics stay closed unless explicitly reopened. Do not repeat a thought just because its wording changed. Durable experiences remain in existing memory.\n';
  }
}
