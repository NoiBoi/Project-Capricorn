import { capture } from './capture.js';
const endpoint='http://127.0.0.1:43129/v1/page';
const safe = raw => {try {const u=new URL(raw);return /^https?:$/.test(u.protocol)&&!u.username&&!u.password&&!/(^|[./_-])(login|signin|sign-in|auth|oauth|password|checkout|payment|billing|bank|account|inbox|mail|messages|medical|health)([./_-]|$)/i.test(u.hostname+u.pathname)?u.origin+u.pathname:null;}catch{return null;}};
let running=false, nextTry=0, failures=0, pending=false, retrySemantic=false;
let readPolling=false;
async function pollReads() {
  if(readPolling)return;
  readPolling=true;
  try {
    const {token}=await chrome.storage.local.get('token');
    if(!token)return;
    const res=await fetch(endpoint.replace('/v1/page','/v1/read-request'),{
      method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:'{}',signal:AbortSignal.timeout(24000)
    });
    if(res.status===200){
      const command=await res.json();
      if(typeof command.id==='string'&&command.mode==='semantic'&&Number.isFinite(command.expiresAt)&&command.expiresAt>Date.now()){
        // A model request still passes the existing focused-tab, grant and sensitive-page checks.
        await inspect('semantic',true,command.id,command.expiresAt);
      }
    }
  }catch{/* Reconnect locally. No inference or permissions change. */}
  finally{readPolling=false;setTimeout(()=>void pollReads(),1000);}
}
// Extraction runs in the existing event/freshness lane. No reasoning or model timer.
async function mayRead(pageKey){const at=Date.now(),{readBudget={start:at,count:0,last:0}}=await chrome.storage.session.get('readBudget');const budget=at-readBudget.start>=3600000?{start:at,count:0,last:0}:readBudget;if((budget.pageKey===pageKey&&at-budget.last<1500)||budget.count>=720)return false;await chrome.storage.session.set({readBudget:{...budget,count:budget.count+1,last:at,pageKey}});return true;}
async function send(page, token) {
  let res=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},body:JSON.stringify(page),signal:AbortSignal.timeout(2500)});
  if(res.status===429){
    await new Promise(resolve=>setTimeout(resolve,250));
    res=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},body:JSON.stringify(page),signal:AbortSignal.timeout(2500)});
  }
  if(!res.ok)throw Error('Capri rejected connection ('+res.status+'). Check pairing.');
  return res.status===202;
}
async function invalidate(token) {
  const {lastPage}=await chrome.storage.session.get('lastPage');
  if(lastPage&&token)try {await send({...lastPage,revision:Date.now(),occurredAt:Date.now(),operation:'delete',headings:[],description:'',selection:'',excerpt:'',sections:[],playback:undefined,title:''},token);}catch{return; /* Keep the reference so a throttled invalidation can retry. */}
  await chrome.storage.session.remove('lastPage');
}
async function inspect(mode='metadata', force=false, readRequestId, readDeadline) {
  if(readRequestId&&Date.now()>=readDeadline)return;
  if(running){if(readRequestId)setTimeout(()=>void inspect(mode,true,readRequestId,readDeadline),250);else pending=true;return;}if(!force&&Date.now()<nextTry){setTimeout(()=>void inspect(),nextTry-Date.now()+25);return;}
  running=true;
  try {
    const config=await chrome.storage.local.get(['token','sites','semanticSites']); if(!config.token)return;
    const [tab]=await chrome.tabs.query({active:true,lastFocusedWindow:true});
    if(tab?.status==='loading'){setTimeout(()=>void inspect(mode,force,readRequestId,readDeadline),200);return;}
    const window=tab&&await chrome.windows.get(tab.windowId);
    const url=tab&&!tab.incognito&&safe(tab.url), origin=url&&new URL(url).origin;
    if(!window?.focused&&readRequestId){
      setTimeout(()=>void inspect(mode,true,readRequestId,readDeadline),250);
      return;
    }
    if(!window?.focused||!origin||(!config.sites?.includes('*')&&!config.sites?.includes(origin))||!await chrome.permissions.contains({origins:[origin+'/*']})){await invalidate(config.token);return;}
    if(mode==='metadata'&&!force&&(config.semanticSites?.includes('*')||config.semanticSites?.includes(origin))&&(retrySemantic||await mayRead(tab.id+':'+url)))mode='semantic';
    const result=await chrome.scripting.executeScript({target:{tabId:tab.id},func:capture,args:[mode]});
    const data=result[0]?.result;
    if(!data){await invalidate(config.token);return;}
    const at=Date.now(), page={...data,url,recordId:'tab-'+tab.id,revision:at,occurredAt:at,mode,incognito:false,focused:true,visible:true,operation:'upsert',...(readRequestId?{readRequestId}:{})};
    // Same record retains current-state freshness without regenerating candidates.
    const accepted=await send(page,config.token);
    if(!accepted){retrySemantic=true;nextTry=0;await chrome.storage.local.set({status:'Paired. Capri is paused or not accepting observations; start a diagnostic session.'});return;}
    retrySemantic=false;
    await chrome.storage.session.set({lastPage:page});failures=0;nextTry=0;
    await chrome.storage.local.set({status:'Connected. Last page accepted at '+new Date().toLocaleTimeString()});
  }catch(e){nextTry=Date.now()+Math.min(300000,500*2**Math.min(failures++,9));await chrome.storage.local.set({status:String(e.message||e)});}
  finally{running=false;if(pending){pending=false;setTimeout(()=>void inspect(),200);}}
}
chrome.tabs.onActivated.addListener(()=>void inspect());
chrome.tabs.onUpdated.addListener((_id, change, tab)=>{if(tab.active&&(change.status==='complete'||change.title&&tab.status!=='loading'))void inspect();});
chrome.windows.onFocusChanged.addListener(()=>void inspect());
chrome.alarms.onAlarm.addListener(alarm=>{if(alarm.name==='capri-freshness'){void inspect();void pollReads();}});
async function alarm(){await chrome.alarms.create('capri-freshness',{periodInMinutes:.5});}
chrome.runtime.onInstalled.addListener(()=>void alarm());
chrome.runtime.onStartup.addListener(()=>{void alarm();void inspect();void pollReads();});
// Mutation messages are only hints. Never trust payload page data; recapture the focused tab.
chrome.runtime.onMessage.addListener((msg,sender,reply)=>{
  if(sender.id!==chrome.runtime.id)return;
  if(msg?.type==='checkPairing'&&!sender.tab){void (async()=>{let status;try{const {token}=await chrome.storage.local.get('token');if(!token)throw Error('No pairing token saved. Paste the token from Capri.');const res=await fetch(endpoint.replace('/v1/page','/v1/status'),{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:'{}',signal:AbortSignal.timeout(3000)});status=res.ok?'Pairing verified. Capri is reachable. Page delivery is checked separately while recording.':res.status===401?'Pairing rejected. Generate a new token in Capri and save it here.':'Capri connection check failed ('+res.status+').';}catch(e){status='Connection not verified: '+e.message;}await chrome.storage.local.set({status});reply({status});})();return true;}
  if(msg?.type==='inspect'&&!sender.tab){void inspect(['metadata','selection','excerpt','semantic','deep'].includes(msg.mode)?msg.mode:'metadata',true).then(()=>reply({ok:true}));return true;}
  if(msg?.type==='dirty'&&sender.tab?.active)void inspect();
});
chrome.permissions.onRemoved.addListener(async permissions=>{
  const c=await chrome.storage.local.get(['sites','token']);const removed=permissions.origins||[];
  const {semanticSites=[]}=await chrome.storage.local.get('semanticSites');await chrome.storage.local.set({sites:(c.sites||[]).filter(site=>!(site==='*'&&removed.length)&&!removed.includes(site+'/*')),semanticSites:semanticSites.filter(site=>!(site==='*'&&removed.length)&&!removed.includes(site+'/*'))});
  if(removed.length)await chrome.scripting.unregisterContentScripts({ids:['capri-sites']}).catch(()=>{});
  await invalidate(c.token);
});

void pollReads();
