import { randomUUID } from 'node:crypto';
import type { Observation } from './contracts';

export type WindowFocus = Observation['content'];
/** One metadata feed, sampled by the existing host heartbeat before semantic policy. */
export class WindowFocusSource {
  private listeners = new Set<(observation: Observation) => void>();
  private last?: string;
  subscribe(listener: (observation: Observation) => void) {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }
  sample(content: WindowFocus, at = Date.now()) {
    const identity = JSON.stringify(content);
    if (identity === this.last) return;
    this.last = identity;
    const observation: Observation = {
      id: randomUUID(), at, source: 'desktop:foreground', modality: 'window-metadata', content: { ...content },
      provenance: { authority: 'host', collector: 'win32.foreground', metadata: { evidence: 'metadata-only', processRepresentation: 'basename', titleBufferUtf16Units: '1024' } },
      loss: {
        // Win32's existing collector has a 1,024-unit title buffer. Saturation
        // means possible truncation; never imply that the title is complete.
        truncated: content.title.length >= 1023,
        missing: ['window-contents', 'original-payload-not-archived', 'process-full-path',
          ...(content.title.length >= 1023 ? ['window-title-may-be-truncated'] : []),
          ...(!content.process ? ['process-metadata-unavailable'] : []),
          ...(content.handle ? [] : ['external-foreground-unavailable'])],
      },
    };
    for (const listener of this.listeners) listener(structuredClone(observation));
  }
}
