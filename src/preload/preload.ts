import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import { EVENT_CHANNELS, INVOKE_CHANNELS, type InvokeChannel, type InvokeMap } from '../shared/ipc';

// Only allow-listed channels cross the bridge; the main process additionally checks
// which window sent each request and validates every payload.
const invokeOk = new Set<string>(INVOKE_CHANNELS);
const eventOk = new Set<string>(EVENT_CHANNELS);

const api = {
  invoke<C extends InvokeChannel>(channel: C, arg?: InvokeMap[C][0]): Promise<InvokeMap[C][1]> {
    if (!invokeOk.has(channel)) return Promise.reject(new Error(`blocked channel ${channel}`));
    return ipcRenderer.invoke(channel, arg);
  },
  on(channel: string, cb: (payload: unknown) => void): () => void {
    if (!eventOk.has(channel)) throw new Error(`blocked channel ${channel}`);
    const listener = (_e: IpcRendererEvent, payload: unknown) => cb(payload);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  },
};
contextBridge.exposeInMainWorld('capri', api);
export type CapriApi = typeof api;
