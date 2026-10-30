// Optional-site script. No page text is sent in messages. At most one hint per 5s.
if(!globalThis.__capriObserver){
  globalThis.__capriObserver=true;let last=0,timer;
  const hint=()=>{clearTimeout(timer);timer=setTimeout(()=>{if(document.visibilityState==='visible'&&Date.now()-last>5000){last=Date.now();chrome.runtime.sendMessage({type:'dirty'}).catch(()=>{});}},1500);};
  new MutationObserver(hint).observe(document.documentElement,{childList:true,subtree:true,characterData:true});
  document.addEventListener('visibilitychange',hint);
}
