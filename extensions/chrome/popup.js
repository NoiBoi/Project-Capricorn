const el=id=>document.getElementById(id);
el('id').textContent='Extension ID: '+chrome.runtime.id;
const status=s=>{el('status').textContent=s;};
const allOrigins=['http://*/*','https://*/*'];
async function registerSites(sites){await chrome.scripting.unregisterContentScripts({ids:['capri-sites']}).catch(()=>{});if(sites.length)await chrome.scripting.registerContentScripts([{id:'capri-sites',matches:sites.includes('*')?allOrigins:sites.map(s=>s+'/*'),js:['observe.js'],runAt:'document_idle',persistAcrossSessions:true}]);}
async function refresh(){const c=await chrome.storage.local.get(['sites','status','semanticSites','token']);el('sites').textContent='Allowed: '+(c.sites||[]).map(s=>s+(c.semanticSites?.includes(s)?' (passive reading)':' (metadata)')).join(', ');status(c.status||(c.token?'Pairing token saved. Click Check connection to verify Capri.':'Waiting for pairing'));}
el('allowAll').onclick=async()=>{try{
  const approved=await chrome.permissions.request({origins:allOrigins});if(!approved){status('All-websites access was not granted.');return;}
  await chrome.storage.local.set({sites:['*'],semanticSites:['*']});await registerSites(['*']);
  const [tab]=await chrome.tabs.query({active:true,currentWindow:true});if(tab&&!tab.incognito&&/^https?:/.test(tab.url||''))await chrome.scripting.executeScript({target:{tabId:tab.id},files:['observe.js']}).catch(()=>{});
  await chrome.runtime.sendMessage({type:'inspect',mode:'semantic'});await refresh();
}catch(e){status(e.message);}};
const site=async()=>{const [tab]=await chrome.tabs.query({active:true,currentWindow:true});if(tab.incognito)throw Error('Private browsing is excluded.');const u=new URL(tab.url);if(!/^https?:$/.test(u.protocol))throw Error('Choose a regular website.');return u.origin;};
async function checkPairing(){status('Checking local Capri connection…');try{const result=await chrome.runtime.sendMessage({type:'checkPairing'});status(result?.status||'Pairing token saved, but the extension worker did not return a connection result. Reload the extension.');}catch(e){status('Connection check failed: '+e.message);}}
el('checkPairing').onclick=checkPairing;
el('pair').onclick=async()=>{try{const token=el('token').value.trim();if(!/^[a-f0-9]{64}$/.test(token)){status('Paste the pairing token from Capri.');return;}await chrome.storage.local.set({token,status:'Pairing token saved. Connection not yet verified.'});el('token').value='';await checkPairing();}catch(e){status('Pairing could not save: '+e.message);}};
let currentOrigin=null;
void site().then(origin=>{currentOrigin=origin;}).catch(()=>{});
el('allow').onclick=async()=>{try{const origin=currentOrigin;if(!origin)throw Error('Choose a regular website and reopen this popup.');const approved=await chrome.permissions.request({origins:[origin+'/*']});if(!approved)return;const c=await chrome.storage.local.get('sites');const sites=[...new Set([...(c.sites||[]),origin])];await chrome.storage.local.set({sites});await registerSites(sites);const [tab]=await chrome.tabs.query({active:true,currentWindow:true});await chrome.scripting.executeScript({target:{tabId:tab.id},files:['observe.js']});await chrome.runtime.sendMessage({type:'inspect',mode:'metadata'});await refresh();}catch(e){status(e.message);}};
el('remove').onclick=async()=>{try{const origin=await site();await chrome.permissions.remove({origins:[origin+'/*']});await refresh();}catch(e){status(e.message);}};
for(const mode of ['metadata','selection','excerpt','deep'])el(mode).onclick=async()=>{await chrome.runtime.sendMessage({type:'inspect',mode});await refresh();};
for(const id of ['passive','stopPassive'])el(id).onclick=async()=>{try{const origin=await site();const c=await chrome.storage.local.get(['sites','semanticSites']);if(!c.sites?.includes('*')&&!c.sites?.includes(origin))throw Error('Allow this site first.');const semanticSites=(c.semanticSites||[]).filter(s=>s!==origin&&s!=='*');if(id==='passive')semanticSites.push(c.sites.includes('*')?'*':origin);await chrome.storage.local.set({semanticSites});await chrome.runtime.sendMessage({type:'inspect',mode:id==='passive'?'semantic':'metadata'});await refresh();}catch(e){status(e.message);}};
void refresh();
