import { screen, BrowserWindow, type Rectangle } from 'electron';
import { createBubbleWindow, reveal, conceal, OFFSCREEN } from './windows';
import type { BubbleState, AssistantPhase, ChatMessage } from '../shared/ipc';
import type { Logger } from './log';
import { SEAT_RATIO } from '../shared/framing';
import {activateChatWindow,foregroundHandle,handleToBigint,restoreChatFocus} from './desktop/win32';

/** Position against the pose's fixed envelope, never its animated face or mirrored head. */
export function lyingBubblePosition(pet: Rectangle, size: { width: number; height: number }, area: Rectangle) {
  const anchor = pet.height * SEAT_RATIO;
  const scale = Math.min(pet.width * .92 / 2006, (anchor - 8) / (764 * .93), (pet.height - anchor - 8) / (764 * .07));
  const width = 2006 * scale, height = 764 * scale, padding = Math.max(12, pet.width * .04);
  const body = { x: pet.x + (pet.width - width) / 2 - padding, y: pet.y + anchor - height * .93 - padding, width: width + padding * 2, height: height + padding * 2 };
  const head = { x: .5, y: (anchor - height * .2) / pet.height };
  return bubblePosition(pet, size, area, false, head, body);
}

export function bubblePosition(pet: Rectangle, size: { width: number; height: number }, area: Rectangle, inverted = false, head = { x: .5, y: inverted ? .72 : .28 }, body?: Rectangle) {
  const face = { x: pet.x + pet.width * head.x, y: pet.y + pet.height * head.y };
  if (body) {
    const gap = 18;
    const clamp = (x: number, y: number) => ({
      x: Math.round(Math.max(area.x + 4, Math.min(area.x + area.width - size.width - 4, x))),
      y: Math.round(Math.max(area.y + 4, Math.min(area.y + area.height - size.height - 4, y))),
    });
    const candidates = [
      clamp(body.x + (body.width - size.width) / 2, body.y - size.height - gap),
      clamp(body.x + body.width + gap, face.y - size.height / 2),
      clamp(body.x - size.width - gap, face.y - size.height / 2),
      clamp(body.x + (body.width - size.width) / 2, body.y + body.height + gap),
    ];
    const score = (p: { x: number; y: number }, i: number) => {
      const overlap = Math.max(0, Math.min(p.x + size.width, body.x + body.width + gap) - Math.max(p.x, body.x - gap))
        * Math.max(0, Math.min(p.y + size.height, body.y + body.height + gap) - Math.max(p.y, body.y - gap));
      const distance = Math.hypot(Math.max(p.x - face.x, 0, face.x - p.x - size.width), Math.max(p.y - face.y, 0, face.y - p.y - size.height));
      return overlap * 100 + distance * .2 + i * 12;
    };
    const best = candidates.map((p, i) => ({ ...p, score: score(p, i) })).sort((a, b) => a.score - b.score)[0];
    return { x: best.x, y: best.y, side: best.x + size.width / 2 >= face.x ? 'right' as const : 'left' as const };
  }
  const right = Math.round(face.x + pet.width * .20 + 12), left = Math.round(face.x - pet.width * .20 - size.width - 12);
  const side = right + size.width <= area.x + area.width ? 'right' : 'left';
  return { side: side as 'left' | 'right', x: Math.round(Math.max(area.x + 4, Math.min(area.x + area.width - size.width - 4, side === 'right' ? right : left))),
    y: Math.round(Math.max(area.y + 4, Math.min(area.y + area.height - size.height - 4, face.y - Math.min(75, size.height * .4)))) };
}

export class BuddyBubble {
  window: BrowserWindow | null = null;
  state: BubbleState = { text: '', phase: 'idle', composer: false, side: 'right' };
  private id = '';
  private timer: NodeJS.Timeout | null = null;
  private visible = false;
  private dismissed = false;
  private disposed = false;
  private height = 170;
  private serial=0;
  private previous: {id:string;text:string;expires:number}[]=[];
  private stackTimer:NodeJS.Timeout|null=null;
  private expiresAt=0;
  private hoveredAt=0;
  private collapseTimer:NodeJS.Timeout|null=null;
  private hasDraft=false;
  private previousFocus=0n;
  private activationRequested=false;
  private focusEpoch=0;
  escape(){
    const previous=this.previousFocus;this.previousFocus=0n;this.dismiss();
    if(!OFFSCREEN&&previous){
      // Electron-owned windows also need their webContents focus restored.
      const owned=BrowserWindow.getAllWindows().find(w=>!w.isDestroyed()&&handleToBigint(w.getNativeWindowHandle())===previous);
      if(owned){owned.focus();owned.webContents.focus();}
      // Finish with native activation, after Electron's own focus bookkeeping.
      restoreChatFocus(previous);
    }
  }
  draft(present:boolean){this.hasDraft=present;this.scheduleCollapse();}
  private scheduleCollapse(){
    if(this.collapseTimer)clearTimeout(this.collapseTimer);
    if(!this.state.composer||this.hoveredAt||this.hasDraft||this.disposed||this.nativeActive)return;
    this.collapseTimer=setTimeout(()=>{
      if(this.state.phase!=='idle'&&this.state.phase!=='error'){this.scheduleCollapse();return;}
      this.state.composer=false;this.state.delivery='aside';this.send();this.expire();
    },4000);this.collapseTimer.unref?.();
  }
  private pausedMs=0;
  private clock(){return (this.hoveredAt||Date.now())-this.pausedMs;}
  hover(active:boolean){
    if(active){if(this.hoveredAt)return;this.hoveredAt=Date.now();this.state.fading=false;this.send();if(this.timer)clearTimeout(this.timer);if(this.stackTimer)clearTimeout(this.stackTimer);}
    else if(this.hoveredAt){this.pausedMs+=Date.now()-this.hoveredAt;this.hoveredAt=0;this.syncStack();this.scheduleExpiry();}
    this.scheduleCollapse();
  }
  private scheduleExpiry(){
    if(this.timer)clearTimeout(this.timer);
    if(this.hoveredAt||this.state.composer||!this.visible||!this.state.text)return;
    this.timer=setTimeout(()=>{
      this.state.fading=true;this.send();
      this.timer=setTimeout(()=>{
      this.state.fading=false;this.syncStack();
      this.previous=this.previous.filter(p=>p.expires>this.clock());
      if(this.previous.length){this.state.text='';this.syncStack();this.send();}
      else this.hide();
      },220);
    },Math.max(1,this.expiresAt-this.clock()));this.timer.unref?.();
  }
  private lastBounds: Rectangle | null = null;
  constructor(private d: { anchor(): Rectangle | null; head?(): { x: number; y: number }; body?(): Rectangle | undefined; inverted?(): boolean; enabled(): boolean; filterText?(text: string): string; preload: string; log: Logger }) {}
  get nativeActive(){const active=foregroundHandle();return !!active&&!!this.window&&!this.window.isDestroyed()&&active===handleToBigint(this.window.getNativeWindowHandle());}
  get hasVisibleText() { return this.visible && (!!this.state.text||this.previous.length>0); }
  private ensure() {
    if (this.window && !this.window.isDestroyed()) return this.window;
    const win = (this.window = createBubbleWindow(this.d.preload, this.d.log));
    this.lastBounds = null;
    win.webContents.once('did-finish-load', () => { this.send(); if (this.visible) { const focus = this.state.composer && this.activationRequested; reveal(win, focus); if (focus) this.focusInput(); } });
    win.on('closed', () => { if (this.window === win) this.window = null; });
    win.on('blur', () => { this.activationRequested=false; this.focusEpoch++; this.scheduleCollapse(); });
    return win;
  }
  private send() { if (this.window && !this.window.isDestroyed() && !this.window.webContents.isLoadingMainFrame()) this.window.webContents.send('bubble:state', this.state); }
  private focusInput() { const w = this.window; if (!w || w.isDestroyed() || w.webContents.isLoadingMainFrame()) return; if (!OFFSCREEN) { w.setFocusable(true);w.setIgnoreMouseEvents(false);w.show();w.focus();w.webContents.focus();activateChatWindow(w.getNativeWindowHandle()); } w.webContents.send('bubble:focus', null); }
  private show(focus = false) {
    if (this.disposed || this.dismissed || (!this.d.enabled() && !this.state.composer)) return false;
    this.visible = true;
    const win = this.ensure(); this.reposition(); this.send();
    // showInactive keeps asides quiet; a real click can activate their reply/settings buttons.
    win.setFocusable(true);
    if (!win.webContents.isLoadingMainFrame()) { reveal(win, focus); if (focus && !OFFSCREEN) win.focus(); }
    return true;
  }
  private expire() {
    if (this.disposed) return;
    if (this.timer) clearTimeout(this.timer);
    if (this.state.composer) return;
    const aside = this.state.delivery === 'aside';
    const duration=aside ? Math.min(24000, Math.max(10000, this.state.text.length * 65)) : Math.min(90000, Math.max(16000, this.state.text.length * 65));
    this.expiresAt=this.clock()+duration;this.state.fading=false;
    this.scheduleExpiry();
  }
  open() { const epoch=++this.focusEpoch;this.activationRequested=true;if(!OFFSCREEN){const focused=foregroundHandle(),own=this.window&&!this.window.isDestroyed()?handleToBigint(this.window.getNativeWindowHandle()):0n;if(focused&&focused!==own)this.previousFocus=focused;}this.dismissed = false; this.state.composer = true; if (this.timer) clearTimeout(this.timer); this.show(true); this.focusInput();for(const delay of [80,240])setTimeout(()=>{if(epoch===this.focusEpoch&&this.activationRequested&&this.visible&&this.state.composer&&!this.disposed)this.focusInput();},delay);this.scheduleCollapse(); }
  company(label: string) { if (this.state.company !== label) { this.state.company = label; this.send(); } }
  private archive(){
    if(!this.visible||!this.state.text.trim())return;
    if(this.expiresAt<=this.clock())return;
    this.previous.push({id:`aside-${++this.serial}`,text:this.state.text,expires:this.expiresAt});
    this.previous=this.previous.slice(-3);this.syncStack();
  }
  private syncStack(){
    if(this.stackTimer)clearTimeout(this.stackTimer);
    this.previous=this.previous.filter(x=>x.expires+220>this.clock());
    this.state.previous=this.previous.map(({id,text,expires})=>({id,text,fading:expires<=this.clock()}));
    if(this.visible&&!this.state.text&&!this.previous.length&&!this.state.composer&&this.state.phase==='idle'){this.visible=false;if(this.window&&!this.window.isDestroyed())conceal(this.window);}
    if(this.previous.length&&!this.hoveredAt){const next=Math.min(...this.previous.map(x=>x.expires>this.clock()?x.expires:x.expires+220));this.stackTimer=setTimeout(()=>{this.syncStack();this.send();},Math.max(1,next-this.clock()));this.stackTimer.unref?.();}
  }
  hide() { this.visible = false;this.hoveredAt=0;this.state.fading=false; this.previous=[];this.syncStack(); if (this.window && !this.window.isDestroyed()) conceal(this.window); }
  dismiss() { this.dismissed = true; this.state.composer = false; this.hide(); }
  begin() { this.state.speech=undefined; this.archive();this.id = ''; this.state.text = ''; this.state.delivery = 'reply'; this.state.startedAt = Date.now(); this.dismissed = false; if (this.timer) clearTimeout(this.timer); }
  phase(p: AssistantPhase) { if (p === 'thinking' && !this.state.startedAt) this.state.startedAt = Date.now(); this.state.phase = p; if (p === 'thinking' || p === 'listening' || p === 'transcribing') this.show(); else this.send(); }
  delta(id: string, text: string) { this.state.speech={kind:'generated-direct'}; if (this.id !== id) { this.archive();this.id = id; this.state.text = ''; } this.state.text = (this.state.text + text).slice(-20000); this.show(); }
  done(message: ChatMessage) { this.state.speech=message.meta?.speech; if(this.id!==message.id)this.archive();this.id = message.id; this.state.delivery = 'reply'; this.state.text = this.d.filterText?.(message.content) ?? message.content; this.state.phase = message.meta?.error ? 'error' : 'idle'; this.state.startedAt = undefined; const shown = !!this.state.text && this.show(); this.expire(); return shown; }
  remark(text: string,speech?:import('../core/performance').SpeechOrigin) { this.state.speech=speech; text = this.d.filterText?.(text) ?? text; if (this.state.composer || !text.trim()) return false; this.archive();this.id='';this.dismissed = false; this.state.delivery = 'aside'; this.state.startedAt = undefined; this.state.text = text; this.state.phase = 'idle'; const shown = this.show(); this.expire(); return shown; }
  resize(height: number) {
    if (!this.window || this.window.isDestroyed()) return;
    const h = Math.min(this.state.maxHeight??1200, Math.max(76, Math.ceil(height / 2) * 2));
    if (Math.abs(h - this.height) > 2) this.height = h;
    this.reposition();
  }
  reposition() {
    if (!this.visible) return;
    const pet = this.d.anchor(), win = this.window;
    if (!pet || !win || win.isDestroyed()) return;
    // Never feed Windows' rounded native dimensions back into a positioning write.
    // At fractional DPI, setPosition/readBounds loops can add a pixel on each pass.
    const head = this.d.head?.() ?? { x: .5, y: this.d.inverted?.() ? .72 : .28 };
    const face = { x: Math.round(pet.x + pet.width * head.x), y: Math.round(pet.y + pet.height * head.y) };
    const area = screen.getDisplayNearestPoint(face).workArea, localBody = this.d.body?.();
    const body = localBody ? { x: pet.x + localBody.x * pet.width, y: pet.y + localBody.y * pet.height, width: localBody.width * pet.width, height: localBody.height * pet.height } : undefined;
    // While lying, choose the display by the fixed contact line as well. A face
    // crossing a monitor seam must not send the whole text box to another screen.
    const lyingArea = body ? screen.getDisplayNearestPoint({ x: Math.round(pet.x + pet.width / 2), y: Math.round(pet.y + pet.height * SEAT_RATIO - 8) }).workArea : area;
    const longest=Math.max(this.state.text.length,...this.previous.map(x=>x.text.length));
    this.state.maxHeight=Math.min(1200,lyingArea.height-16);
    const size = { width: Math.min(Math.max(320,340+Math.ceil(Math.max(0,longest-180)/5)),540,lyingArea.width - 8), height: Math.min(this.height, this.state.maxHeight) };
    const envelope=body??{x:pet.x+pet.width*.12,y:pet.y+pet.height*.12,width:pet.width*.76,height:pet.height*.76};
    const pos = body ? lyingBubblePosition(pet, size, lyingArea) : bubblePosition(pet, size, area, this.d.inverted?.(), head,envelope);
    const bounds = { x: pos.x, y: pos.y, ...size }, old = this.lastBounds;
    if (!old || Math.abs(old.x - bounds.x) > 1 || Math.abs(old.y - bounds.y) > 1 || old.height !== bounds.height || old.width !== bounds.width) {
      this.lastBounds = bounds;
      win.setBounds(bounds);
    }
    const tail = { x: Math.round(pet.x + pet.width * head.x - pos.x), y: Math.round(pet.y + pet.height * head.y - pos.y) };
    if (this.state.side !== pos.side || this.state.tail?.x !== tail.x || this.state.tail?.y !== tail.y) { this.state.side = pos.side; this.state.tail = tail; this.send(); }
  }
  close() { this.disposed = true; if (this.timer) clearTimeout(this.timer);if(this.stackTimer)clearTimeout(this.stackTimer);if(this.collapseTimer)clearTimeout(this.collapseTimer); this.window?.destroy(); this.window = null; }
}

