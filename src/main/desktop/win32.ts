// Minimal Win32 bindings via koffi (prebuilt FFI, no compiler needed). Every call degrades
// to a safe default if the library can't load, and diagnostics report the status.
import type { Logger } from '../log';
import { helperWindow } from './exposure';

type Fn = (...a: unknown[]) => unknown;
interface Api {
  SwitchToThisWindow:Fn; GetCurrentThreadId:Fn; AttachThreadInput:Fn; SetForegroundWindow:Fn; SetFocus:Fn;
  GetForegroundWindow: Fn; GetWindowRect: Fn; MonitorFromWindow: Fn; GetMonitorInfoW: Fn;
  GetClassNameW: Fn; SHQueryUserNotificationState: Fn; GetAsyncKeyState: Fn; address: (p: unknown) => bigint;
  GetWindowLongPtrW: Fn; GetLayeredWindowAttributes: Fn;
  EnumWindows: Fn; IsWindowVisible: Fn; IsIconic: Fn; IsWindow: Fn; GetWindow: Fn;
  DwmGetWindowAttribute: Fn; GetWindowTextW: Fn; GetWindowThreadProcessId: Fn; OpenProcess: Fn; QueryFullProcessImageNameW: Fn; CloseHandle: Fn;
}
let api: Api | null = null;
let loadError: string | null = null;
const processNames = new Map<number, { name: string; at: number }>();

export function loadWin32(log?: Logger): boolean {
  if (api || loadError) return !!api;
  if (process.platform !== 'win32') { loadError = 'not Windows'; return false; }
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const koffi = require('koffi');
    const user32 = koffi.load('user32.dll');
    const shell32 = koffi.load('shell32.dll');
    const dwm = koffi.load('dwmapi.dll');
    const kernel = koffi.load('kernel32.dll');
    koffi.proto('bool __stdcall CAPRI_ENUM_WINDOW(void* hwnd, intptr_t param)');
    const RECT = koffi.struct('CAPRI_RECT', { left: 'long', top: 'long', right: 'long', bottom: 'long' });
    koffi.struct('CAPRI_MONITORINFO', { cbSize: 'uint32', rcMonitor: RECT, rcWork: RECT, dwFlags: 'uint32' });
    api = {
      SwitchToThisWindow:user32.func('void __stdcall SwitchToThisWindow(void* hwnd, bool altTab)'),
      GetCurrentThreadId:kernel.func('uint32 __stdcall GetCurrentThreadId()'),
      AttachThreadInput:user32.func('bool __stdcall AttachThreadInput(uint32 from, uint32 to, bool attach)'),
      SetForegroundWindow:user32.func('bool __stdcall SetForegroundWindow(void* hwnd)'),
      SetFocus:user32.func('void* __stdcall SetFocus(void* hwnd)'),
      GetWindowTextW: user32.func('int __stdcall GetWindowTextW(void* hwnd, _Out_ uint16_t* text, int size)'),
      GetWindowThreadProcessId: user32.func('uint32 __stdcall GetWindowThreadProcessId(void* hwnd, _Out_ uint32* pid)'),
      OpenProcess: kernel.func('void* __stdcall OpenProcess(uint32 access, bool inherit, uint32 pid)'),
      QueryFullProcessImageNameW: kernel.func('bool __stdcall QueryFullProcessImageNameW(void* process, uint32 flags, _Out_ uint16_t* text, _Inout_ uint32* size)'),
      CloseHandle: kernel.func('bool __stdcall CloseHandle(void* handle)'),
      GetForegroundWindow: user32.func('void* __stdcall GetForegroundWindow()'),
      GetWindowRect: user32.func('bool __stdcall GetWindowRect(void* hWnd, _Out_ CAPRI_RECT* rect)'),
      MonitorFromWindow: user32.func('void* __stdcall MonitorFromWindow(void* hwnd, uint32 flags)'),
      GetMonitorInfoW: user32.func('bool __stdcall GetMonitorInfoW(void* hMonitor, _Inout_ CAPRI_MONITORINFO* info)'),
      GetClassNameW: user32.func('int __stdcall GetClassNameW(void* hWnd, _Out_ uint16_t* buf, int max)'),
      GetAsyncKeyState: user32.func('int16 __stdcall GetAsyncKeyState(int vKey)'),
      GetWindowLongPtrW: user32.func('intptr_t __stdcall GetWindowLongPtrW(void* hwnd, int index)'),
      GetLayeredWindowAttributes: user32.func('bool __stdcall GetLayeredWindowAttributes(void* hwnd, _Out_ uint32* key, _Out_ uint8* alpha, _Out_ uint32* flags)'),
      SHQueryUserNotificationState: shell32.func('long __stdcall SHQueryUserNotificationState(_Out_ int* state)'),
      address: (p: unknown) => (p ? BigInt(koffi.address(p)) : 0n),
      EnumWindows: user32.func('bool __stdcall EnumWindows(CAPRI_ENUM_WINDOW* callback, intptr_t param)'),
      IsWindowVisible: user32.func('bool __stdcall IsWindowVisible(void* hwnd)'),
      IsIconic: user32.func('bool __stdcall IsIconic(void* hwnd)'),
      IsWindow: user32.func('bool __stdcall IsWindow(void* hwnd)'),
      GetWindow: user32.func('void* __stdcall GetWindow(void* hwnd, uint32 command)'),
      DwmGetWindowAttribute: dwm.func('long __stdcall DwmGetWindowAttribute(void* hwnd, uint32 attr, void* value, uint32 size)'),
    };
    return true;
  } catch (e) {
    loadError = (e as Error).message;
    log?.warn('win32 bindings unavailable; fullscreen detection disabled', { error: loadError });
    return false;
  }
}
export const win32Status = () => (api ? 'active' : 'unavailable') as 'active' | 'unavailable';

const SHELL_CLASSES = new Set(['Progman', 'WorkerW', 'Shell_TrayWnd', 'Shell_SecondaryTrayWnd']);
export interface ExternalWindow { handle: bigint; rect: { x: number; y: number; width: number; height: number }; eligible?: boolean }

/** Follow a specific window regardless of which app has keyboard focus. Physical pixels. */
export function windowRect(handle: bigint): ExternalWindow['rect'] | null {
  if (!api || !handle) return null;
  try {
    if (!api.IsWindow(handle) || !api.IsWindowVisible(handle) || api.IsIconic(handle)) return null;
    const r: { left?: number; top?: number; right?: number; bottom?: number } = {};
    if (!api.GetWindowRect(handle, r)) return null;
    // DWM's visible frame excludes the invisible resize border around ordinary windows.
    const native = new Int32Array(4);
    if (api.DwmGetWindowAttribute(handle, 9, native, 16) === 0) [r.left, r.top, r.right, r.bottom] = native;
    const rect = { x: r.left!, y: r.top!, width: r.right! - r.left!, height: r.bottom! - r.top! };
    return rect.width > 80 && rect.height > 60 ? rect : null;
  } catch { return null; }
}

/** Visible surfaces in front-to-back order, with real app targets marked separately from occluders. */
export function externalWindows(ownHandles: bigint[]): ExternalWindow[] {
  if (!api) return [];
  const result: ExternalWindow[] = [];
  try {
    api.EnumWindows((hwnd: unknown) => {
      const handle = api!.address(hwnd);
      if (!handle || ownHandles.includes(handle)) return true;
      const buf = new Uint16Array(128);
      const n = api!.GetClassNameW(hwnd, buf, buf.length) as number;
      const cls = String.fromCharCode(...buf.slice(0, Math.max(0, n)));
      if (SHELL_CLASSES.has(cls) || cls === '#32768' || cls === 'tooltips_class32') return true;
      const style = Number(api!.GetWindowLongPtrW(hwnd, -20));
      if (style & 0x20) return true; // transparent helper surfaces do not occlude applications
      if (style & 0x80000) {
        const key = new Uint32Array(1), alpha = new Uint8Array(1), flags = new Uint32Array(1);
        if (api!.GetLayeredWindowAttributes(hwnd, key, alpha, flags) && (flags[0] & 2) && !alpha[0]) return true;
      }
      const cloaked = new Int32Array(1);
      if (api!.DwmGetWindowAttribute(hwnd, 14, cloaked, 4) === 0 && cloaked[0]) return true;
      const rect = windowRect(handle);
      if (rect) {
        const info = windowInfo(handle);
        if (helperWindow({ ...info, className: cls })) return true;
        result.push({ handle, rect, eligible: !!info.title.trim() && !(style & (0x80 | 0x08000000)) && !api!.GetWindow(hwnd, 4) });
      }
      return true;
    }, 0);
  } catch { /* return the windows collected before an unavailable window */ }
  return result;
}

/**
 * True when some other app is fullscreen (game, video, presentation).
 * `ownHandles` = native handles of our windows (excluded).
 */
export function isOtherAppFullscreen(ownHandles: bigint[]): boolean {
  if (!api) return false;
  try {
    const st = [0];
    if (api.SHQueryUserNotificationState(st) === 0 && [2, 3, 4].includes(st[0])) return true; // BUSY, D3D_FULL_SCREEN, PRESENTATION
    const hwnd = api.GetForegroundWindow();
    if (!hwnd || ownHandles.includes(api.address(hwnd))) return false;
    const buf = new Uint16Array(64);
    const n = api.GetClassNameW(hwnd, buf, 64) as number;
    const cls = String.fromCharCode(...buf.slice(0, Math.max(0, n)));
    if (SHELL_CLASSES.has(cls)) return false;
    const r: { left?: number; top?: number; right?: number; bottom?: number } = {};
    if (!api.GetWindowRect(hwnd, r)) return false;
    const mon = api.MonitorFromWindow(hwnd, 2 /* MONITOR_DEFAULTTONEAREST */);
    const mi = { cbSize: 72, rcMonitor: {} as typeof r, rcWork: {}, dwFlags: 0 };
    if (!api.GetMonitorInfoW(mon, mi)) return false;
    const m = mi.rcMonitor;
    return r.left! <= m.left! && r.top! <= m.top! && r.right! >= m.right! && r.bottom! >= m.bottom!;
  } catch {
    return false;
  }
}

/** Rect (physical px) of the foreground app window, excluding the shell and our own windows. */
export function foregroundRect(ownHandles: bigint[]): { x: number; y: number; width: number; height: number } | null {
  if (!api) return null;
  try {
    const hwnd = api.GetForegroundWindow();
    if (!hwnd || ownHandles.includes(api.address(hwnd))) return null;
    const buf = new Uint16Array(64);
    const n = api.GetClassNameW(hwnd, buf, 64) as number;
    if (SHELL_CLASSES.has(String.fromCharCode(...buf.slice(0, Math.max(0, n))))) return null;
    const r: { left?: number; top?: number; right?: number; bottom?: number } = {};
    if (!api.GetWindowRect(hwnd, r)) return null;
    return { x: r.left!, y: r.top!, width: r.right! - r.left!, height: r.bottom! - r.top! };
  } catch { return null; }
}

/** Is the left mouse button physically down? (used to end drags robustly). Null if unknown. */
/** Handle of the foreground window (0n when none or unavailable). */
export function foregroundHandle(): bigint {
  if (!api) return 0n;
  try { const h = api.GetForegroundWindow(); return h ? api.address(h) : 0n; } catch { return 0n; }
}

export function leftButtonDown(): boolean | null {
  if (!api) return null;
  try { return ((api.GetAsyncKeyState(0x01) as number) & 0x8000) !== 0; } catch { return null; }
}
/** Only sample the requested chord. No key history or typed text is collected. */
let chatChordPrimed=false;
export function chatChordDown():boolean{
  if(!api)return false;
  // Sample every requested key each frame. The pressed bit also catches a
  // complete quick chord between frames; short-circuiting leaves stale bits.
  try{const states=[0x11,0x20,0x43].map(key=>api!.GetAsyncKeyState(key) as number);const mask=chatChordPrimed?0x8001:0x8000;chatChordPrimed=true;return states.every(state=>(state&mask)!==0);}catch{return false;}
}
/** Explicit user activation only. Release the temporary input-queue link immediately. */
export function activateChatWindow(handle:Buffer):boolean{
  if(!api)return false;
  const native=handleToBigint(handle);let linked=false,targetLinked=false,from=0,to=0,target=0;
  try{
    from=Number(api.GetCurrentThreadId());const foreground=api.GetForegroundWindow();
    target=Number(api.GetWindowThreadProcessId(native,new Uint32Array(1)));
    to=foreground?Number(api.GetWindowThreadProcessId(foreground,new Uint32Array(1))):0;
    if(to&&from!==to)linked=!!api.AttachThreadInput(from,to,true);
    if(target&&target!==from&&target!==to)targetLinked=!!api.AttachThreadInput(from,target,true);
    api.SwitchToThisWindow(native,true);api.SetForegroundWindow(native);api.SetFocus(native);
    const active=api.GetForegroundWindow();return !!active&&api.address(active)===native;
  }catch{return false;}finally{if(targetLinked)try{api.AttachThreadInput(from,target,false);}catch{}if(linked)try{api.AttachThreadInput(from,to,false);}catch{}}
}
export function restoreChatFocus(handle:bigint):boolean{
  if(!api||!handle)return false;
  try{if(!api.IsWindow(handle))return false;const bytes=Buffer.alloc(8);bytes.writeBigUInt64LE(handle);return activateChatWindow(bytes);}catch{return false;}
}

/** Read a BrowserWindow native handle Buffer as a bigint. */
export function handleToBigint(buf: Buffer): bigint {
  return buf.length >= 8 ? buf.readBigUInt64LE(0) : BigInt(buf.readUInt32LE(0));
}

/** Read window metadata without activating it or inspecting document contents. */
export function windowInfo(handle: bigint): { title: string; process: string; pid?: number } {
  if (!api || !handle) return { title: '', process: '' };
  let processHandle: unknown;
  try {
    const text = new Uint16Array(1024);
    const n = api.GetWindowTextW(handle, text, text.length) as number;
    const title = String.fromCharCode(...text.slice(0, Math.max(0, n)));
    const pid = new Uint32Array(1); api.GetWindowThreadProcessId(handle, pid);
    const cached = processNames.get(pid[0]);
    if (cached && Date.now() - cached.at < 2000) return { title, process: cached.name, pid:pid[0] };
    processHandle = api.OpenProcess(0x1000, false, pid[0]);
    const filename = new Uint16Array(2048), size = new Uint32Array([filename.length]);
    const process = processHandle && api.QueryFullProcessImageNameW(processHandle, 0, filename, size)
      ? String.fromCharCode(...filename.slice(0, size[0])).split(/[\\/]/).pop()! : '';
    processNames.set(pid[0], { name: process, at: Date.now() });
    if (processNames.size > 128) processNames.delete(processNames.keys().next().value!);
    return { title, process, pid:pid[0] };
  } catch { return { title: '', process: '' }; }
  finally { if (processHandle) api.CloseHandle(processHandle); }
}
