// Real mouse and keyboard input for computer control, through Win32 SendInput (koffi, no compiler).
// Coordinates are physical screen pixels. Every call is a no-op returning false if the API can't load.

type Fn = (...a: unknown[]) => unknown;
interface Api { SetCursorPos: Fn; GetCursorPos: Fn; SendInput: Fn; GetAsyncKeyState: Fn; size: number; KB: unknown; MS: unknown }
let api: Api | null = null;
let tried = false;

function load(): Api | null {
  if (api || tried) return api;
  tried = true;
  if (process.platform !== 'win32') return null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const koffi = require('koffi');
    const u = koffi.load('user32.dll');
    // INPUT is { DWORD type; union { MOUSEINPUT; KEYBDINPUT; HARDWAREINPUT } } = 40 bytes on x64
    const KB = koffi.struct('CAPRI_INPUT_KB', { type: 'uint32', pad0: 'uint32', wVk: 'uint16', wScan: 'uint16', dwFlags: 'uint32', time: 'uint32', extra: 'uint64', tail: 'uint64' });
    const MS = koffi.struct('CAPRI_INPUT_MS', { type: 'uint32', pad0: 'uint32', dx: 'int32', dy: 'int32', mouseData: 'uint32', dwFlags: 'uint32', time: 'uint32', extra: 'uint64' });
    const POINT = koffi.struct('CAPRI_IN_POINT', { x: 'long', y: 'long' });
    void POINT;
    api = {
      SetCursorPos: u.func('bool __stdcall SetCursorPos(int x, int y)'),
      GetCursorPos: u.func('bool __stdcall GetCursorPos(_Out_ CAPRI_IN_POINT* p)'),
      SendInput: u.func('uint32 __stdcall SendInput(uint32 n, void* inputs, int size)'),
      GetAsyncKeyState: u.func('int16 __stdcall GetAsyncKeyState(int vKey)'),
      size: 40, KB, MS,
    };
    return api;
  } catch { return null; }
}

// eslint-disable-next-line @typescript-eslint/no-require-imports
const koffiEncode = (type: unknown, value: object) => { const koffi = require('koffi'); const buf = Buffer.alloc(40); koffi.encode(buf, 0, type, value); return buf; };
function send(bufs: Buffer[]) {
  const a = load(); if (!a || !bufs.length) return false;
  return (a.SendInput(bufs.length, Buffer.concat(bufs), a.size) as number) === bufs.length;
}
const KEYUP = 0x2, UNICODE = 0x4;
const kb = (wVk: number, wScan: number, flags: number) => koffiEncode(load()!.KB, { type: 1, pad0: 0, wVk, wScan, dwFlags: flags, time: 0, extra: 0, tail: 0 });
const ms = (flags: number, data = 0) => koffiEncode(load()!.MS, { type: 0, pad0: 0, dx: 0, dy: 0, mouseData: data >>> 0, dwFlags: flags, time: 0, extra: 0 });

const sleep = (ms_: number) => new Promise((r) => setTimeout(r, ms_));
const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

export function cursor(): { x: number; y: number } | null {
  const a = load(); if (!a) return null;
  const p: { x?: number; y?: number } = {};
  return a.GetCursorPos(p) ? { x: p.x!, y: p.y! } : null;
}

/** Glide the cursor to a point (so it's visible where she's working). */
export async function moveTo(x: number, y: number, ms_ = 200) {
  const a = load(); if (!a) return false;
  const from = cursor() ?? { x, y };
  const n = Math.max(2, Math.round(ms_ / 12));
  for (let i = 1; i <= n; i++) { const k = ease(i / n); a.SetCursorPos(Math.round(from.x + (x - from.x) * k), Math.round(from.y + (y - from.y) * k)); await sleep(12); }
  return true;
}

export async function click(button: 'left' | 'right' = 'left', count = 1) {
  const [down, up] = button === 'left' ? [0x2, 0x4] : [0x8, 0x10];
  for (let i = 0; i < count; i++) { send([ms(down)]); await sleep(40); send([ms(up)]); if (i + 1 < count) await sleep(70); }
  return true;
}

/** Wheel: positive scrolls content up (away from you), like the hardware wheel. */
export function scroll(notches: number) { return send([ms(0x800, Math.round(notches * 120))]); }

/** Type text exactly (Unicode, independent of keyboard layout). */
export async function typeText(text: string) {
  for (const ch of text.slice(0, 2000)) {
    if (ch === '\n') { await keys('enter'); continue; }
    const code = ch.codePointAt(0)!;
    const units = code > 0xffff ? [0xd800 + ((code - 0x10000) >> 10), 0xdc00 + ((code - 0x10000) & 0x3ff)] : [code];
    for (const u of units) send([kb(0, u, UNICODE), kb(0, u, UNICODE | KEYUP)]);
    await sleep(14);
  }
  return true;
}

const VK: Record<string, number> = {
  ctrl: 0x11, control: 0x11, shift: 0x10, alt: 0x12, win: 0x5b, windows: 0x5b, meta: 0x5b,
  enter: 0x0d, return: 0x0d, tab: 0x09, esc: 0x1b, escape: 0x1b, space: 0x20, backspace: 0x08, delete: 0x2e, del: 0x2e,
  up: 0x26, down: 0x28, left: 0x25, right: 0x27, home: 0x24, end: 0x23, pageup: 0x21, pagedown: 0x22, insert: 0x2d,
  f1: 0x70, f2: 0x71, f3: 0x72, f4: 0x73, f5: 0x74, f6: 0x75, f7: 0x76, f8: 0x77, f9: 0x78, f10: 0x79, f11: 0x7a, f12: 0x7b,
};
const EXTENDED = new Set([0x2e, 0x26, 0x28, 0x25, 0x27, 0x24, 0x23, 0x21, 0x22, 0x2d, 0x5b]);
/** A key or chord like "ctrl+l", "alt+tab", "enter", "win". Returns false for keys it doesn't know. */
export async function keys(combo: string) {
  const parts = combo.toLowerCase().split('+').map((s) => s.trim()).filter(Boolean);
  const codes = parts.map((p) => VK[p] ?? (/^[a-z0-9]$/.test(p) ? p.toUpperCase().charCodeAt(0) : -1));
  if (!codes.length || codes.includes(-1)) return false;
  for (const c of codes) { send([kb(c, 0, EXTENDED.has(c) ? 1 : 0)]); await sleep(25); }
  for (const c of [...codes].reverse()) { send([kb(c, 0, (EXTENDED.has(c) ? 1 : 0) | KEYUP)]); await sleep(20); }
  return true;
}

/** True if Esc is down or was tapped since the last check (the user's stop key during computer control). */
export function escapeDown(): boolean { const a = load(); return !!a && ((a.GetAsyncKeyState(0x1b) as number) & 0x8001) !== 0; }
export const inputAvailable = () => !!load();
