import type { WindowFocusArchive } from './windowFocusArchive';
import type { ConversationRecord } from './cognitiveContracts';
import { ambientDialogue } from './context';

/** Bounded index searches into the existing journal; no time window and no parallel store. */
export async function selectAmbientDialogue(archive: WindowFocusArchive, recent: ConversationRecord[], boundary: number, subjects: string[], evidence: string[], retiredEvidence: Set<string>) {
  const relevant = new Set(evidence);
  const anchors = new Set(recent.filter(r=>r.kind==='user'||r.kind==='assistant').slice(-6).map(r=>r.id));
  const stop = new Set(['the','and','for','with','this','that','window','chrome','microsoft','untitled','google','studio','code']);
  const queries = [...new Set(subjects.map(text=>(text.match(/[\p{L}\p{N}_-]{4,}/gu)??[]).filter(w=>!stop.has(w.toLowerCase())).slice(0,6).join(' ')).filter(Boolean))].slice(0,2);
  for(const search of queries) {
    const result=await archive.discover({modality:'dialogue',search,limit:2});
    for(const hit of result.hits)if('dialogue' in hit){anchors.add(hit.dialogue.id);relevant.add(hit.dialogue.id);}
  }
  for(const id of evidence.slice(0,4))anchors.add(id);
  const exchanges=await Promise.all([...anchors].slice(0,14).map(id=>archive.dialogueExchange(id)));
  // Recent asides do not require an exchange anchor. Searches recover older expressed views.
  // Explicit retirement is never overridden by a lexical hit or active-state reference.
  const records=[...new Map([...recent.filter(r=>r.kind==='user'||r.kind==='assistant'), ...exchanges.flat()]
    .filter(r=>!retiredEvidence.has(r.id)).map(r=>[r.id,r])).values()].sort((a,b)=>a.sequence-b.sequence);
  return ambientDialogue(records,boundary,Date.now(),relevant);
}
