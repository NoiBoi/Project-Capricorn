import type { ConnectionStatus } from '../../shared/ipc';
import path from 'node:path';
import { app, safeStorage, shell } from 'electron';
import { createChatGPT, type ChatGPTClient, type SessionState } from '../../vendor/siwc-local';
import type { CognitiveProvider, Model, ModelInput } from './cognitiveContracts';
import { encodeInput, encodeTools } from './context';
export { encodeInput } from './context';
import { assertSyntheticProfile } from './selection';
import type { DailySession } from './dailySession';
export function createDesktopChatGPT(profile: string) {
  const storageDir = path.join(profile, 'runtime2', 'siwc');
  assertSyntheticProfile(storageDir);
  const available = () => app.isReady() && safeStorage.isEncryptionAvailable() && (process.platform !== 'linux' || ['gnome_libsecret','kwallet','kwallet5','kwallet6'].includes(safeStorage.getSelectedStorageBackend()));
  return createChatGPT({ appName: 'Capri Buddy', appId: 'dev.capri.buddy.runtime2', redirectPort: 0, storageDir, sendHostId: true,
    credentialEncryption: { id: 'electron-safe-storage-v1', isAvailable: available,
      encrypt: text => { if (!available()) throw Error('OS encryption unavailable'); return safeStorage.encryptString(text); },
      decrypt: bytes => { if (!available()) throw Error('OS encryption unavailable'); return safeStorage.decryptString(Buffer.from(bytes)); } },
    openBrowser: url => shell.openExternal(url),
  });
}
export class SiwcProvider implements CognitiveProvider {
  constructor(readonly client: ChatGPTClient, private daily?: DailySession) {}
  async models(signal: AbortSignal): Promise<Model[]> {
    const session = await this.client.getSession();
    signal.throwIfAborted();
    if (session.status !== 'connected' || !session.sharing) throw Error('Sign in with ChatGPT and authorize ChatGPT plan usage in the chat panel.');
    return (await this.client.listModels({ signal })).map(m => ({ id: m.slug, label: m.displayName, contextTokens: m.contextWindow, supportsImages: m.supportsImages }));
  }
  async infer(model: Model, input: ModelInput, signal: AbortSignal, delta: (text: string) => void) {
    const tools = encodeTools(input);
    const result = await this.client.streamResponse({ model: model.id, input: encodeInput(input), instructions: input.identity, tools, signal, onDelta: delta,
      beforeRequest: this.daily ? body => this.daily!.admit(body) : undefined,
      onProtocolEvent: this.daily ? event => this.daily!.protocol(event) : undefined });
    this.daily?.usage(result.usage);
    if (result.calls.some(call => call.namespace && call.namespace !== 'capri_archive')) throw Error('Unexpected tool namespace.');
    return result;
  }
  shutdown() { this.client.cancelSignIn(); }
}
export { selectModel } from './context';

/** Authentication status is independent of the legacy provider and inference phase. */
export function siwcConnection(session: SessionState, model?: string): ConnectionStatus {
  const state = session.status === 'connecting' ? 'connecting' : session.status === 'connected' && session.sharing ? 'connected' : session.status === 'reauth_required' ? 'error' : 'disconnected';
  return { state, provider: 'ChatGPT (SIWC)', model, checkedAt: Date.now(), keySource: 'secure-store',
    detail: state === 'connected' ? 'Signed in with ChatGPT plan usage enabled.' : state === 'connecting' ? 'Complete sign-in in your browser.' : session.status === 'connected' ? 'Signed in; enable ChatGPT plan usage to continue.' : 'Sign in with ChatGPT to connect.' };
}
