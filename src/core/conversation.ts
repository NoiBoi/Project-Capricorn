/** Retention boundary shared by the host checkpoint adapter and learning inputs. */
export function retainedConversation<T extends { entries: { id: string; contextSources?: string[] }[]; reading?: { sourceId: string } }>(state: T): T {
  const retained = structuredClone(state);
  retained.entries = retained.entries.filter(entry => !entry.contextSources?.length);
  if (retained.reading && !retained.entries.some(entry => entry.id === retained.reading?.sourceId)) retained.reading = undefined;
  return retained;
}
