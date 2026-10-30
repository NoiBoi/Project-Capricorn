// Isolated-world DOM extraction. Called only after an exact optional host grant.
export function capture(mode) {
  const secret='input[type=password],input[autocomplete="cc-number"],input[autocomplete="current-password"],input[autocomplete="one-time-code"]';
  if(document.visibilityState!=='visible'||document.querySelector(secret))return null;
  const excluded='form,input,textarea,select,button,[contenteditable],script,style,template,noscript,nav,aside,footer,[hidden],[aria-hidden="true"],[inert]';
  const visible=el=>{if(!el||!el.getClientRects().length||el.closest(excluded))return false;for(let p=el;p;p=p.parentElement){const s=getComputedStyle(p);if(s.display==='none'||s.visibility==='hidden'||s.opacity==='0')return false;}return true;};
  const scrub=s=>String(s||'').replace(/\b(?:sk-[\w-]+|gh[pousr]_[\w]+|Bearer\s+\S+|(?:password|secret|token|api[_ -]?key)\s*[:=]\s*\S+)\b/gi,'[redacted]').replace(/\b(?:\d[ -]?){13,19}\b/g,'[redacted]');
  const text=(el,max)=>{
    // Remove hidden descendants using the original rendered tree before reading text.
    const clean=el.cloneNode(true),all=[...clean.querySelectorAll('*')];[...el.querySelectorAll('*')].forEach((n,i)=>{if(!visible(n))all[i]?.remove();});clean.querySelectorAll(excluded).forEach(n=>n.remove());return scrub(clean.textContent).trim().slice(0,max);};
  const selection=window.getSelection();let selected='';
  if(mode==='selection'&&selection?.rangeCount&&visible(selection.anchorNode?.parentElement)&&visible(selection.focusNode?.parentElement)){
    const range=selection.getRangeAt(0),container=range.commonAncestorContainer.nodeType===1?range.commonAncestorContainer:range.commonAncestorContainer.parentElement;
    if(container&&![...container.querySelectorAll(excluded)].some(el=>range.intersectsNode(el)))selected=scrub(selection.toString()).slice(0,1500);
  }
  const semantic=['semantic','deep','excerpt'].includes(mode),deep=mode==='deep';
  // Bounded site-specific roots, no auth surfaces or application internals.
  const siteRoot=location.hostname==='github.com'?document.querySelector('article.markdown-body'):location.hostname==='en.wikipedia.org'?document.querySelector('#mw-content-text .mw-parser-output'):null;
  const root=siteRoot||document.querySelector('main,article,[role=main]');
  const sections=[];let remaining=deep?48000:18000,visited=0,path=[];
  if(semantic&&root&&visible(root))for(const el of root.querySelectorAll('h1,h2,h3,h4,h5,h6,p,ul,ol,table,pre')){
    if(++visited>1200||sections.length>=(deep?80:40)||remaining<=0)break;
    if(!visible(el)||el.parentElement?.closest('p,ul,ol,table,pre'))continue;
    const heading=/^H[1-6]$/.test(el.tagName),level=heading?Number(el.tagName[1]):0;
    const kind=heading?'heading':el.tagName==='PRE'?'code':el.tagName==='TABLE'?'table':['UL','OL'].includes(el.tagName)?'list':'paragraph';
    let value=kind==='table'?[...el.rows].slice(0,30).map(row=>[...row.cells].slice(0,12).filter(visible).map(c=>text(c,200)).join(' | ')).join('\n'):kind==='list'?[...el.children].slice(0,30).filter(visible).map(c=>text(c,300)).join('\n'):text(el,Math.min(3000,remaining));
    value=value.slice(0,Math.min(3000,remaining));if(!value)continue;if(heading){path=path.slice(0,level-1);path[level-1]=value.slice(0,100);}remaining-=value.length;sections.push({kind,level,path:path.filter(Boolean).join(' > ').slice(0,300),text:value});
  }
  const video=semantic&&location.hostname==='www.youtube.com'?[...document.querySelectorAll('video')].find(visible):null;
  const playback=video?{state:video.ended?'ended':video.paused?'paused':'playing',position:Math.min(864000,Math.max(0,video.currentTime||0)),duration:Number.isFinite(video.duration)?Math.min(864000,Math.max(0,video.duration)):null}:undefined;
  return {title:scrub(document.title).slice(0,300),headings:[...document.querySelectorAll('h1,h2,h3')].slice(0,40).filter(visible).slice(0,8).map(el=>text(el,200)),description:scrub(document.querySelector('meta[name=description]')?.content).slice(0,500),selection:selected,excerpt:mode==='excerpt'?sections.map(s=>s.text).join('\n').slice(0,1500):'',sections:['semantic','deep'].includes(mode)?sections:[],...(playback?{playback}:{})};
}
