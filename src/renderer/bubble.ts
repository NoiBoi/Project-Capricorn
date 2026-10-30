import { PORTRAITS, transmissionFace, transmissionStatus } from '../shared/transmission';
import { WaitingDialogue } from '../shared/dialogue';
const waitingDialogue = new WaitingDialogue();
import type { BubbleState } from '../shared/ipc';
import type { CapriApi } from '../preload/preload';
const api = (window as unknown as { capri: CapriApi }).capri;
const card = document.getElementById('card')!, message = document.getElementById('message')!, status = document.getElementById('status')!;
const form = document.getElementById('composer') as HTMLFormElement, input = document.getElementById('input') as HTMLTextAreaElement;
const stop = document.getElementById('stop') as HTMLButtonElement;
let state: BubbleState;
let composing = false;
let measuredHeight = 0, measureFrame = 0;
const stack=document.getElementById('stack')!,previous=document.getElementById('previous')!,pages=document.getElementById('pages')!;
let selected:string|null=null, offsets=[0],pageEnd=0,lastText='',historyKey='';
const shownText=()=>selected?state.previous?.find(x=>x.id===selected)?.text??state.text:state.text;
function fitText(){ if(card.hidden)return;
  const full=shownText()||message.textContent||'',start=offsets.at(-1)??0,limit=state.maxHeight??700;
  pages.hidden=true;message.textContent=full.slice(start);pageEnd=full.length;
  if(stack.getBoundingClientRect().height+28>limit||start>0||selected){
    pages.hidden=false;let lo=start,hi=full.length;
    while(lo<hi){const mid=Math.ceil((lo+hi)/2);message.textContent=full.slice(start,mid);if(stack.getBoundingClientRect().height+28<=limit)lo=mid;else hi=mid-1;}
    pageEnd=Math.max(start+1,lo);if(pageEnd<full.length){const space=full.lastIndexOf(' ',pageEnd);if(space>start+Math.max(20,(pageEnd-start)*.7))pageEnd=space+1;}
    message.textContent=full.slice(start,pageEnd);
    (document.getElementById('page-prev') as HTMLButtonElement).disabled=offsets.length===1;
    (document.getElementById('page-next') as HTMLButtonElement).disabled=pageEnd>=full.length;
    document.getElementById('page-label')!.textContent=`${offsets.length}${pageEnd<full.length?' · continued':''}`;
    document.getElementById('latest')!.hidden=!selected;
  }
}
function measure() {
  cancelAnimationFrame(measureFrame);
  measureFrame = requestAnimationFrame(() => {
    fitText();
    const height = Math.ceil((stack.getBoundingClientRect().height + 28) / 2) * 2;
    if (height === measuredHeight) return;
    measuredHeight = height; void api.invoke('bubble:resize', height);
  });
}
new ResizeObserver(measure).observe(card);
function render(next: BubbleState) {
  const justOpened = next.composer && !state?.composer;
  state = next; document.body.dataset.fading=String(!!state.fading);
  if(selected&&!state.previous?.some(x=>x.id===selected))selected=null;
  const textKey=shownText();if(textKey!==lastText){offsets=[0];lastText=textKey;}
  const key=JSON.stringify(state.previous);
  if(key!==historyKey){
    historyKey=key;const keep=new Set((state.previous??[]).map(x=>x.id));
    for(const child of [...previous.children])if(!keep.has((child as HTMLElement).dataset.id!))child.remove();
    for(const entry of state.previous??[]){
      let item=[...previous.children].find(n=>(n as HTMLElement).dataset.id===entry.id) as HTMLElement|undefined;
      if(!item){item=document.createElement('section');item.className='earlier';item.dataset.id=entry.id;const text=document.createElement('div');text.textContent=entry.text.length>180?entry.text.slice(0,180)+'…':entry.text;item.append(text);if(entry.text.length>180){const read=document.createElement('button');read.textContent='Read full';read.onclick=()=>{selected=entry.id;offsets=[0];render(state);};item.append(read);}previous.append(item);}
      item.classList.toggle('fading',!!entry.fading);
    }
  }
  card.hidden=!state.text&&state.phase==='idle'&&!state.composer&&!selected;
  document.body.dataset.compact = String(state.delivery === 'aside' && state.phase === 'idle' && !state.composer && state.text.length <= 180);
  const busy = ['thinking', 'transcribing', 'listening'].includes(state.phase);
  document.getElementById('retire')!.hidden=state.speech?.kind!=='authored'||!!selected;
  (document.getElementById('retire') as HTMLButtonElement).disabled = !state.text || busy || state.phase === 'error';
  const elapsed = Math.max(0, Math.floor((Date.now() - (state.startedAt ?? Date.now())) / 1000));
  const display = transmissionStatus(state.phase, !!state.text, elapsed);
  status.textContent = display.label;
  document.body.dataset.kind = display.kind;
  document.getElementById('detail')!.textContent = display.detail || state.company || '';
  document.getElementById('activity')!.hidden = !busy;
  const portrait = document.getElementById('portrait') as HTMLImageElement;
  const face = transmissionFace(state.phase, state.text);
  if (portrait.dataset.face !== face) {
    portrait.dataset.face = face; portrait.src = `capri/mochiiwuff/${PORTRAITS[face]}`;
    portrait.classList.remove('swapping'); void portrait.offsetWidth; portrait.classList.add('swapping');
  }
  const text = state.text || (busy ? waitingDialogue.text(state.phase, state.startedAt ?? 0, elapsed) : '...');
  if (message.textContent !== text) { const stick = message.scrollHeight - message.scrollTop - message.clientHeight < 32; message.textContent = text; if (stick) message.scrollTop = message.scrollHeight; }
  message.classList.toggle('waiting', !state.text && busy);
  form.hidden = !state.composer;
  document.body.dataset.composing = String(state.composer);
  stop.hidden = !busy;
  document.body.dataset.side = state.side;
  if (justOpened) input.focus();
  measure();
}
async function send() {
  const text = input.value.trim(); if (!text) return;
  input.value = ''; input.style.height = 'auto'; void api.invoke('bubble:draft',false);
  try { await api.invoke('chat:send', { text }); } catch (e) { if (!input.value) input.value = text; message.textContent = String((e as Error).message); measure(); }
}
form.addEventListener('submit', (e) => { e.preventDefault(); void send(); });
input.addEventListener('compositionstart', () => { composing = true; }); input.addEventListener('compositionend', () => { composing = false; });
input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey && !composing && !e.isComposing) { e.preventDefault(); void send(); } });
input.addEventListener('input', () => { void api.invoke('bubble:draft',!!input.value.trim()); input.style.height = 'auto'; input.style.height = `${Math.min(84, input.scrollHeight)}px`; measure(); });
document.getElementById('reply')!.addEventListener('click', () => { void api.invoke('bubble:reply'); });
document.getElementById('retire')!.addEventListener('click', () => {
  const line = shownText(); if (!line) return;
  if(state.speech?.kind==='authored')void api.invoke('dialogue:retire', state.speech.lineId).catch(() => {});
});
document.getElementById('settings')!.addEventListener('click', () => { void api.invoke('panel:open', 'settings'); });
document.getElementById('close')!.addEventListener('click', () => { void api.invoke('bubble:close'); });
stop.addEventListener('click', () => { void api.invoke('chat:stop'); });
window.addEventListener('keydown', (e) => { if (e.key === 'Escape') {e.preventDefault();void api.invoke('bubble:escape');} });
document.getElementById('page-next')!.onclick=()=>{offsets.push(pageEnd);measure();};
document.getElementById('page-prev')!.onclick=()=>{if(offsets.length>1)offsets.pop();measure();};
document.getElementById('latest')!.onclick=()=>{selected=null;offsets=[0];render(state);};
document.body.addEventListener('mouseenter',()=>{void api.invoke('bubble:hover',true);});
document.body.addEventListener('mouseleave',()=>{void api.invoke('bubble:hover',false);});
api.on('bubble:state', (s) => render(s as BubbleState));
api.on('bubble:focus', () => input.focus());
void api.invoke('bubble:get').then(render);

setInterval(() => { if (state && ['thinking', 'transcribing', 'listening'].includes(state.phase)) render(state); }, 1000);
