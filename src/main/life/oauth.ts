import http from 'node:http';
import {createHash,randomBytes,timingSafeEqual} from 'node:crypto';
import type {SecretStore} from '../store/secrets';
import type {SecretKey} from '../../shared/ipc';
import type {CommunicationSettings} from '../../shared/communications';
import {providerJSON,ProviderError} from './network';
export const oauthKey=(id:string):SecretKey=>('lifeOAuth'+['gmail-0','gmail-1','outlook-0','outlook-1','teams-0','teams-1'].indexOf(id)) as SecretKey;
export function accountScopes(a:CommunicationSettings,content:boolean){
 if(a.id.startsWith('gmail'))return[content&&a.selectedMessages.length?'https://www.googleapis.com/auth/gmail.readonly':'https://www.googleapis.com/auth/gmail.metadata'];
 return['offline_access',...(a.id.startsWith('teams')?['https://graph.microsoft.com/Chat.Read',...(a.channels.length?['https://graph.microsoft.com/ChannelMessage.Read.All']:[])]:[content&&a.selectedMessages.length?'https://graph.microsoft.com/Mail.Read':'https://graph.microsoft.com/Mail.ReadBasic'])];
}
/** Shared installed-app authorization for communication accounts. No embedded login or user-token scraping. */
export class DesktopOAuth {
 private server?:http.Server;private timer?:NodeJS.Timeout;private controller?:AbortController;private epoch=0;private pendingId='';
 constructor(private secrets:SecretStore,private fetcher:typeof fetch=fetch){}
 private endpoints(a:CommunicationSettings){return a.id.startsWith('gmail')?{authorize:'https://accounts.google.com/o/oauth2/v2/auth',token:'https://oauth2.googleapis.com/token'}:{authorize:`https://login.microsoftonline.com/${a.tenant}/oauth2/v2.0/authorize`,token:`https://login.microsoftonline.com/${a.tenant}/oauth2/v2.0/token`};}
 configured(id:string){return this.secrets.has(oauthKey(id));}
 stop(id?:string){if(id&&id!==this.pendingId)return;this.epoch++;this.controller?.abort();if(this.timer)clearTimeout(this.timer);this.server?.close();this.server?.closeAllConnections();this.server=undefined;this.pendingId='';}
 forget(id:string){this.stop(id);this.secrets.delete(oauthKey(id));}
 async authorize(a:CommunicationSettings,content:boolean,open:(url:string)=>Promise<unknown>,finished:(error?:string)=>void){
  this.stop();const epoch=this.epoch,google=a.id.startsWith('gmail'),client=a.clientId||(google?this.secrets.get('googleClient'):'');if(!client)throw Error('Save a desktop OAuth client ID first.');
  const state=randomBytes(32).toString('base64url'),verifier=randomBytes(48).toString('base64url'),scopes=accountScopes(a,content),endpoint=this.endpoints(a);let redirect='';
  this.pendingId=a.id;this.controller=new AbortController();const signal=this.controller.signal;
  const server=this.server=http.createServer(async(req,res)=>{
   const url=new URL(req.url??'/','http://localhost');if(req.method!=='GET'||url.pathname!=='/oauth2callback'){res.writeHead(404).end();return;}
   const expected=Buffer.from(state),actual=Buffer.from(url.searchParams.get('state')??'');if(actual.length!==expected.length||!timingSafeEqual(actual,expected)){res.writeHead(403).end('Invalid authorization state');return;}
   if(!url.searchParams.get('code')){res.end('Authorization declined. Return to Capri.');this.stop();finished('Authorization declined. Check consent/tenant policy and retry.');return;}
   try{
    const data=await providerJSON(endpoint.token,{method:'POST',signal,headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:client,grant_type:'authorization_code',code:url.searchParams.get('code')!,code_verifier:verifier,redirect_uri:redirect,...(google?{client_secret:this.secrets.get('googleClientSecret')??''}:{})})},this.fetcher);
    if(epoch!==this.epoch||signal.aborted)return;
    if(typeof data.refresh_token!=='string')throw Error('No refresh credential returned.');
    const granted=String(data.scope??'').toLowerCase();if(!google&&a.id.startsWith('teams')&&!granted.includes('chat.read'))throw Error('Teams delegated access not granted.');
    if(google&&!scopes.some(s=>granted.includes(s.toLowerCase())))throw Error('Gmail read permission not granted.');
    this.secrets.set(oauthKey(a.id),JSON.stringify({refresh:data.refresh_token,scopes,client,tenant:a.tenant}));
    res.end('Account authorization saved. Return to Capri, enable collection and sync to verify access.');setTimeout(()=>{if(epoch===this.epoch)this.stop();},50);finished();
   }catch(e){if(epoch!==this.epoch)return;res.writeHead(400).end('Authorization failed. Return to Capri and check setup.');this.stop();finished(e instanceof ProviderError?e.message:'Token exchange failed. Check desktop client, redirect and consent.');}
  });server.maxConnections=4;server.requestTimeout=10000;server.headersTimeout=10000;
  await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(google?0:43131,'127.0.0.1',resolve);});
  redirect=`http://${google?'127.0.0.1':'localhost'}:${(server.address() as any).port}/oauth2callback`;
  const url=new URL(endpoint.authorize);url.search=new URLSearchParams({client_id:client,redirect_uri:redirect,response_type:'code',scope:scopes.join(' '),state,code_challenge:createHash('sha256').update(verifier).digest('base64url'),code_challenge_method:'S256',...(google?{access_type:'offline',prompt:'consent',include_granted_scopes:'true'}:{prompt:'select_account',response_mode:'query'})}).toString();
  this.timer=setTimeout(()=>{this.stop();finished('Authorization timed out. Retry from Connections.');},180000);this.timer.unref();try{await open(url.href);}catch(e){this.stop();throw e;}
 }
 async access(a:CommunicationSettings,signal:AbortSignal){
  const raw=this.secrets.get(oauthKey(a.id));if(!raw)throw Error('Authorize this account in Connections.');const saved=JSON.parse(raw);
  if(saved.tenant!==a.tenant||saved.client!==(a.clientId||(a.id.startsWith('gmail')?this.secrets.get('googleClient'):'')))throw new ProviderError(401);
  let data:any;try{data=await providerJSON(this.endpoints(a).token,{method:'POST',signal,headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:saved.client,refresh_token:saved.refresh,grant_type:'refresh_token',...(a.id.startsWith('gmail')?{client_secret:this.secrets.get('googleClientSecret')??''}:{})})},this.fetcher);}catch(e){if(e instanceof ProviderError&&e.status===400)throw new ProviderError(401);throw e;}
  if(typeof data.access_token!=='string')throw new ProviderError(401);
  if(data.refresh_token&&!signal.aborted)this.secrets.set(oauthKey(a.id),JSON.stringify({...saved,refresh:data.refresh_token}));return data.access_token as string;
 }
}
