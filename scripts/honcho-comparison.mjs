// Optional research adapter. Never imported by the desktop app or sent real profile/history data.
// Uses the official SDK, pinned to the version verified in the companion report.
import { createRequire } from 'node:module';
import path from 'node:path';

export function loadHonchoSDK(sdkPath = process.env.CAPRI_HONCHO_SDK) {
  const require = createRequire(import.meta.url);
  return sdkPath ? require(path.resolve(sdkPath)) : require('@honcho-ai/sdk');
}
export class HonchoComparison {
  constructor(Honcho, { baseURL, apiKey, workspaceId = `capri-synthetic-${Date.now()}`, timeoutMs = 90000 }) {
    if (!baseURL) throw new Error('Supply HONCHO_URL explicitly. This experiment never selects a hosted service automatically.');
    const url = new URL(baseURL);
    if (!['http:','https:'].includes(url.protocol) || url.username || url.password) throw new Error('Invalid Honcho URL.');
    this.workspaceId = workspaceId;
    // SDK 2.7.0 environment:'local' overrides even an explicit URL with localhost:8000.
    // Leave environment unset so custom local ports and user-selected servers are honored.
    this.client = new Honcho({ workspaceId, baseURL, apiKey, timeout: timeoutMs, maxRetries: 0 });
  }
  async ingestSynthetic(messages) {
    if (!Array.isArray(messages) || messages.some(m => m.synthetic !== true || !['user','assistant'].includes(m.role))) throw new Error('This adapter accepts explicitly synthetic user/assistant fixtures only.');
    this.user = await this.client.peer('fixture-user');
    this.capri = await this.client.peer('capri');
    this.session = await this.client.session('fixture-session');
    await this.session.setPeers([[this.user.id, { observeMe: true, observeOthers: false }], [this.capri.id, { observeMe: true, observeOthers: true }]]);
    this.ingested = await this.session.addMessages(messages.map(m => (m.role === 'user' ? this.user : this.capri).message(m.text, { createdAt: new Date(m.at).toISOString(), metadata: { synthetic: true, source_id: m.id } })));
  }
  async ready() {
    if (!this.session) throw new Error('Load synthetic fixtures first.');
    const status = await this.session.queueStatus();
    return { ready: status.pendingWorkUnits === 0 && status.inProgressWorkUnits === 0, status };
  }
  async recall(query) {
    if (!this.session) throw new Error('Load synthetic fixtures first.');
    const result = await this.capri.chat(query, { target: this.user, session: this.session, includeEvidence: true, reasoningLevel: 'low' });
    return { content: result.content, evidence: result.evidence, classification: 'external interpretation; not an approved Capri fact' };
  }
  async cleanup() {
    // Honcho 3.4.1 refuses workspace deletion while a session is active.
    // Session deletion marks it inactive immediately and queues its data removal.
    if (this.session) await this.session.delete();
    await this.client.deleteWorkspace(this.workspaceId);
  }
}
