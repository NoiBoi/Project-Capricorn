// Optional-site script. No page text is sent in messages. Coalesce mutations; prompt hints on load and tab visibility.
if(!globalThis.__capriObserver){
  globalThis.__capriObserver=true;let last=0,timer;
  const hint=()=>{if(timer)return;timer=setTimeout(()=>{timer=undefined;if(document.visibilityState==='visible'&&Date.now()-last>1000){last=Date.now();chrome.runtime.sendMessage({type:'dirty'}).catch(()=>{});}},300);};
  new MutationObserver(hint).observe(document.documentElement,{childList:true,subtree:true,characterData:true});
  document.addEventListener('visibilitychange',hint);
  hint();
}
