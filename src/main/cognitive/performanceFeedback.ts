import type { Checkpoints } from '../../core/contracts';
import type { FeedbackKind } from '../../core/performance';
/** Counts and category only. No utterance, user identity, source or memory text. */
export class PerformanceFeedback {
  private lastPruned=-Infinity;
  constructor(private store:Checkpoints,private now=Date.now,private enabled=()=>true){this.prune();}
  prune(){
    if(!this.enabled()){this.clear();return;}
    if(this.now()-this.lastPruned<3600000)return;this.lastPruned=this.now();
    const rows=this.store.load<{kind:FeedbackKind;at:number}[]>('performance-feedback');
    if(!rows)return;
    const kept=rows.filter(r=>this.now()-r.at<30*86400000).slice(-128);
    if(kept.length!==rows.length)this.store.save('performance-feedback',kept);
  }
  record(kind:FeedbackKind) {
    if(!this.enabled()){this.clear();return;}
    const rows=this.store.load<{kind:FeedbackKind;at:number}[]>('performance-feedback')??[];
    rows.push({kind,at:this.now()});
    this.store.save('performance-feedback',rows.filter(r=>this.now()-r.at<30*86400000).slice(-128));
  }
  clear(){this.store.removeCheckpoint('performance-feedback');}
}
