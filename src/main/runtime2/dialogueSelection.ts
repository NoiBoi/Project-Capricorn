import type { WindowFocusArchive } from './windowFocusArchive';
import type { ConversationRecord } from './cognitiveContracts';
import type { CanonicalState } from './canonicalState';
import { ambientDialogue } from './context';

/** Bounded index searches into the existing journal; no time window and no parallel store. */
export async function selectAmbientDialogue(archive: WindowFocusArchive, recent: ConversationRecord[], boundary: number, subjects: string[], evidence: string[], retiredEvidence: Set<string>, endedTasks: CanonicalState[] = []) {
  const relevant = new Set(evidence);
  // An ended task may cite the user's cancellation, not its original instruction.
  // Preserve later user evidence as resolution context; never reactivate the task.
  // The existing six-task / sixteen-evidence bounds also bound these local reads.
  const resolutions = new Map<string, number>();
  const references = new Map<string, number>();
  for (const task of endedTasks.slice(0,6)) for (const id of task.evidence) references.set(id, Math.min(references.get(id) ?? Infinity, task.createdAt));
  await Promise.all([...references].map(async ([id,createdAt]) => {
    const record = recent.find(r=>r.id===id) ?? await archive.getDialogue(id);
    if (record?.kind==='user' && record.at>createdAt) resolutions.set(id,record.at);
  }));
  const resolutionIds=[...resolutions].sort((a,b)=>b[1]-a[1]).slice(0,4).map(([id])=>id);
  resolutionIds.forEach(id=>relevant.add(id));
  const anchors = new Set([...resolutionIds, ...recent.filter(r=>r.kind==='user'||r.kind==='assistant').slice(-6).map(r=>r.id)]);
  const stop = new Set(['the','and','for','with','this','that','window','chrome','microsoft','untitled','google','studio','code']);
  const queries = [...new Set(subjects.map(text=>(text.match(/[\p{L}\p{N}_-]{4,}/gu)??[]).filter(w=>!stop.has(w.toLowerCase())).slice(0,6).join(' ')).filter(Boolean))].slice(0,2);
  for(const search of queries) {
    const result=await archive.discover({modality:'dialogue',search,limit:2});
    for(const hit of result.hits)if('dialogue' in hit){anchors.add(hit.dialogue.id);relevant.add(hit.dialogue.id);}
  }
  for(const id of evidence.slice(0,4))anchors.add(id);
  const exchanges=await Promise.all([...anchors].slice(0,14).map(id=>archive.dialogueExchange(id)));
  // Recent asides do not require an exchange anchor. Searches recover older expressed views.
  // Lexical hits cannot restore retired instructions. Resolution evidence is
  // different: removing it would leave its superseded instruction unqualified.
  const records=[...new Map([...recent.filter(r=>r.kind==='user'||r.kind==='assistant'), ...exchanges.flat()]
    .filter(r=>!retiredEvidence.has(r.id)||resolutions.has(r.id)).map(r=>[r.id,r])).values()].sort((a,b)=>a.sequence-b.sequence);
  return ambientDialogue(records,boundary,Date.now(),relevant);
}
