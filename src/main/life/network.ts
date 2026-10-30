/** Provider requests are bounded, abortable, never redirected with credentials. */
export class ProviderError extends Error { constructor(public status:number, public retryAfter=0){super(status===401||status===403?'Authorization rejected. Reauthorize or check API access.':status===429?'Provider quota reached. Automatic retry is delayed.':`Provider request failed (${status}). Check connection and account setup.`);} }
export async function providerJSON(url:string, init:RequestInit={}, fetcher:typeof fetch=fetch):Promise<any>{
  const timeout=AbortSignal.timeout(15000), signal=init.signal?AbortSignal.any([timeout,init.signal]):timeout;
  const response=await fetcher(url,{...init,signal,redirect:'error'});
  const retry=response.headers.get('retry-after')??'0',seconds=Number(retry),retryAfter=Number.isFinite(seconds)?seconds*1000:Math.max(0,Date.parse(retry)-Date.now());
  const reader=response.body?.getReader(); if(!reader){if(!response.ok)throw new ProviderError(response.status);throw Error('Empty provider response');}
  const chunks:Uint8Array[]=[];let size=0;
  try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>4*1024*1024)throw Error('Provider response exceeded 4MB. Narrow selected sources.');chunks.push(value);}}finally{await reader.cancel();}
  const raw=Buffer.concat(chunks).toString('utf8');
  if(!response.ok)throw new ProviderError(response.status===403&&/rateLimitExceeded|quotaExceeded|dailyLimitExceeded|userRateLimitExceeded/.test(raw)?429:response.status,Number.isFinite(retryAfter)?Math.min(3600000,retryAfter):0);
  return JSON.parse(raw);
}
