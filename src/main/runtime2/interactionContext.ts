import { randomUUID } from 'node:crypto';
import type { Observation, UserInteraction } from './contracts';

/** Host facts in the existing observation archive, never invented user speech. */
export function interactionObservation(event: UserInteraction, target?: {handle: string; title: string}, now=Date.now()): Observation {
  let text: string;
  if (event.kind === 'contact') {
    if (![event.startedAt,event.endedAt,event.pats,event.pokes].every(Number.isSafeInteger) || event.startedAt<0 || event.endedAt<event.startedAt || event.endedAt-event.startedAt>15000 || event.pats<0 || event.pokes<0 || event.pats+event.pokes<1 || event.pats+event.pokes>100) throw Error('Invalid contact burst');
    text=`Actual user contact: ${event.pats} pats and ${event.pokes} pokes between ${event.startedAt} and ${event.endedAt}. Contact establishes no emotion or motive.`;
  } else if (event.kind === 'placement') {
    event={...event,surface:event.surface.slice(0,60)};
    text=`The user completed manual placement ${target?'on the identified window':'on '+event.surface}. Moved aside: ${event.movedAside}. Interrupted physical activity: ${event.interrupted}. No motive is established.`;
  } else {
    event={...event,...(event.page?{page:event.page.slice(0,40)}:{}),...(event.changes?{changes:event.changes.slice(0,4).map(s=>s.slice(0,120))}:{})};
    text=event.page?`The user opened Capri's own ${event.page} page. Navigation does not establish any settings change.`:`The user changed Capri's own settings: ${event.changes?.join('; ')}.`;
  }
  return {id:randomUUID(),at:now,source:'host:user-interaction',sourceIdentity:'user-interaction:'+event.kind,modality:'user-interaction',
    disclosure:{source:'screen',retain:true,expiresAt:now+600000,retainUntil:now+86400000},
    content:{handle:target?.handle??null,title:target?.title.slice(0,160)??'Direct user '+event.kind,process:'capri-buddy',text,interaction:event},
    provenance:{authority:'host',collector:'native-user-interaction',metadata:{origin:'user',evidence:'direct-event'}},loss:{truncated:false,missing:[]}};
}
