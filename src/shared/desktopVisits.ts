/** Local physical initiative, independent of generated wording and model budgets. */
export class DesktopVisits {
  private cursorAt: number;
  private lastWindowAt = -Infinity;
  private pending = new Map<string, number>();
  private admitted = new Set<string>();
  constructor(now: number, private random = Math.random) { this.cursorAt = now + 90000 + this.random() * 90000; }
  opened(id: string, now: number) {
    if(this.admitted.has(id))return;
    this.admitted.add(id);
    if (!this.pending.has(id)) this.pending.set(id, now);
    if (this.pending.size > 16) this.pending.delete(this.pending.keys().next().value!);
  }
  closed(visible: ReadonlySet<string>) { for (const id of this.admitted) if (!visible.has(id)) {this.pending.delete(id);this.admitted.delete(id);} }
  window(now: number, blocked: boolean) {
    for (const [id, at] of this.pending) if (now - at > 60000) this.pending.delete(id);
    if (blocked || now - this.lastWindowAt < 12000) return null;
    const ready = [...this.pending].find(([,at]) => now - at >= 1800);
    if (!ready) return null;
    this.pending.delete(ready[0]); this.lastWindowAt = now; return ready[0];
  }
  cursor(now: number, blocked: boolean) {
    if (blocked || now < this.cursorAt) return false;
    this.cursorAt = now + 150000 + this.random() * 150000; return true;
  }
  clear(now: number) { this.pending.clear();this.admitted.clear(); this.cursorAt = now + 90000 + this.random() * 90000; }
}

export class PhysicalCueGate {
  private seen=new Set<string>();private positionKey='';private lastShift=-Infinity;
  private shiftedViews=new Set<string>();
  taskbar(key:string,blocked:boolean){if(blocked||this.seen.has(key))return false;this.seen.add(key);if(this.seen.size>32)this.seen.delete(this.seen.values().next().value!);return true;}
  shift(key:string,now:number,blocked:boolean){if(!key){this.positionKey='';return false;}if(blocked||key===this.positionKey||now-this.lastShift<30000||key.includes(':view:')&&this.shiftedViews.has(key))return false;this.positionKey=key;this.lastShift=now;if(key.includes(':view:')){this.shiftedViews.add(key);if(this.shiftedViews.size>64)this.shiftedViews.delete(this.shiftedViews.values().next().value!);}return true;}
}

/** Sampling cadence is for changed evidence, never a requirement to speak or move. */
export class WindowWatch {
  private windows=new Map<string,{since:number;checked:number;visited:boolean}>();
  private item(key:string,now:number){let item=this.windows.get(key);if(!item){item={since:now,checked:0,visited:false};this.windows.set(key,item);if(this.windows.size>32)this.windows.delete(this.windows.keys().next().value!);}return item;}
  videoVisit(key:string,now:number,blocked:boolean){if(!key)return false;const item=this.item(key,now);if(blocked||item.visited||now-item.since<6500)return false;item.visited=true;return true;}
  inspect(key:string,now:number,blocked:boolean,readAt=0,video=false){if(!key)return false;const item=this.item(key,now);if(blocked||now-item.since<(video?8000:45000)||now-Math.max(item.checked,readAt)<90000)return false;item.checked=now;return true;}
}

/** Stay beside the pointer, on screen, while leaving the click point clear. */
export function besideCursor(point: { x: number; y: number }, pet: { width: number; height: number }, area: { x: number; y: number; width: number; height: number }) {
  const x = point.x + 48 + pet.width <= area.x + area.width ? point.x + 48 : point.x - pet.width - 48;
  return { ...pet, x: Math.round(Math.max(area.x,Math.min(area.x+area.width-pet.width,x))), y: Math.round(Math.max(area.y,Math.min(area.y+area.height-pet.height,point.y-pet.height*.3))) };
}
