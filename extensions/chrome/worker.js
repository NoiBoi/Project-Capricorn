import { capture } from './capture.js';
const endpoint='http://127.0.0.1:43129/v1/page';
const safe = raw => {try {const u=new URL(raw);return /^https?:$/.test(u.protocol)&&!u.username&&!u.password&&!/(^|[./_-])(login|signin|sign-in|auth|oauth|password|checkout|payment|billing|bank|account|inbox|mail|messages|medical|health)([./_-]|$)/i.test(u.hostname+u.pathname)?u.origin+u.pathname:null;}catch{return null;}};
let running=false, nextTry=0, failures=0;
// Extraction runs in the existing event/freshness lane. No reasoning or model timer.
async function mayRead(){const at=Date.now(),{readBudget={start:at,count:0,last:0}}=await chrome.storage.session.get('readBudget');const budget=at-readBudget.start>=3600000?{start:at,count:0,last:0}:readBudget;if(at-budget.last<30000||budget.count>=120)return false;await chrome.storage.session.set({readBudget:{...budget,count:budget.count+1,last:at}});return true;}
async function send(page, token) {
  const res=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},body:JSON.stringify(page),signal:AbortSignal.timeout(2500)});
  if(!res.ok)throw Error('Capri rejected connection ('+res.status+'). Check pairing.');
}
async function invalidate(token) {
  const {lastPage}=await chrome.storage.session.get('lastPage');
  if(lastPage&&token)try {await send({...lastPage,revision:Date.now(),occurredAt:Date.now(),operation:'delete',headings:[],description:'',selection:'',excerpt:'',sections:[],playback:undefined,title:''},token);}catch{/* Freshness expiry also removes current evidence. */}
  await chrome.storage.session.remove('lastPage');
}
async function inspect(mode='metadata', force=false) {
  if(running||(!force&&Date.now()<nextTry))return;
  running=true;
  try {
    const config=await chrome.storage.local.get(['token','sites','semanticSites']); if(!config.token)return;
    const [tab]=await chrome.tabs.query({active:true,lastFocusedWindow:true});
    const window=tab&&await chrome.windows.get(tab.windowId);
    const url=tab&&!tab.incognito&&safe(tab.url), origin=url&&new URL(url).origin;
    if(!window?.focused||!origin||!config.sites?.includes(origin)||!await chrome.permissions.contains({origins:[origin+'/*']})){await invalidate(config.token);return;}
    if(mode==='metadata'&&!force&&config.semanticSites?.includes(origin)&&await mayRead())mode='semantic';
    const result=await chrome.scripting.executeScript({target:{tabId:tab.id},func:capture,args:[mode]});
    const data=result[0]?.result;
    if(!data){await invalidate(config.token);return;}
    const at=Date.now(), page={...data,url,recordId:'active-page',revision:at,occurredAt:at,mode,incognito:false,focused:true,visible:true,operation:'upsert'};
    // Same record retains current-state freshness without regenerating candidates.
    await send(page,config.token);
    await chrome.storage.session.set({lastPage:page});failures=0;nextTry=0;
    await chrome.storage.local.set({status:'Connected. Last page accepted at '+new Date().toLocaleTimeString()});
  }catch(e){nextTry=Date.now()+Math.min(300000,5000*2**Math.min(failures++,6));await chrome.storage.local.set({status:String(e.message||e)});}
  finally{running=false;}
}
chrome.tabs.onActivated.addListener(()=>void inspect());
chrome.tabs.onUpdated.addListener((_id, change, tab)=>{if(tab.active&&(change.status==='complete'||change.url||change.title))void inspect();});
chrome.windows.onFocusChanged.addListener(()=>void inspect());
chrome.alarms.onAlarm.addListener(alarm=>{if(alarm.name==='capri-freshness')void inspect();});
async function alarm(){await chrome.alarms.create('capri-freshness',{periodInMinutes:.5});}
chrome.runtime.onInstalled.addListener(()=>void alarm());
chrome.runtime.onStartup.addListener(()=>{void alarm();void inspect();});
// Mutation messages are only hints. Never trust payload page data; recapture the focused tab.
chrome.runtime.onMessage.addListener((msg,sender,reply)=>{
  if(sender.id!==chrome.runtime.id)return;
  if(msg?.type==='inspect'&&!sender.tab){void inspect(['metadata','selection','excerpt','semantic','deep'].includes(msg.mode)?msg.mode:'metadata',true).then(()=>reply({ok:true}));return true;}
  if(msg?.type==='dirty'&&sender.tab?.active)void inspect();
});
chrome.permissions.onRemoved.addListener(async permissions=>{
  const c=await chrome.storage.local.get(['sites','token']);const removed=permissions.origins||[];
  const {semanticSites=[]}=await chrome.storage.local.get('semanticSites');await chrome.storage.local.set({sites:(c.sites||[]).filter(site=>!removed.includes(site+'/*')),semanticSites:semanticSites.filter(site=>!removed.includes(site+'/*'))});await invalidate(c.token);
});
