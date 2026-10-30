export interface PlayingTrack { title: string; artist: string; key: string }
export class MusicChanges {
  private key='';private changedAt=0;private pending:PlayingTrack|null=null;private lastAttempt=-Infinity;
  private seen=new Map<string,number>();
  observe(track:PlayingTrack|null,now:number){
    const key=track?.key??'';if(key===this.key)return;
    this.key=key;this.changedAt=now;this.pending=track;
  }
  take(now:number,blocked:boolean){
    if(blocked||!this.pending||now-this.changedAt<4000||now-this.lastAttempt<45000)return null;
    const track=this.pending;this.pending=null;
    if(now-(this.seen.get(track.key)??-Infinity)<2*3600000)return null;
    this.lastAttempt=now;this.seen.set(track.key,now);if(this.seen.size>32)this.seen.delete(this.seen.keys().next().value!);
    return track;
  }
  clear(){this.key='';this.pending=null;}
}
