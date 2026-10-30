import { screen, type BrowserWindow } from "electron";
import { createTheatreWindow, reveal } from "./windows";
import type { Logger } from "./log";
import {
  SCENE_SECONDS,
  type TheatreFrame,
  type SceneKind,
  type Box,
  type Point,
} from "../shared/theatrics";
/** One temporary click-through scene. Every frame is clipped to freshly observed exposed regions. */
export class DesktopTheatre {
  window: BrowserWindow | null = null;
  active: SceneKind | null = null;
  private seq = 0;
  private timer: NodeJS.Timeout | null = null;
  private guard: NodeJS.Timeout | null = null;
  private complete: ((completed: boolean) => void) | null = null;
  private state: TheatreFrame | null = null;
  private ready = false;
  constructor(
    private d: {
      preload: string;
      log: Logger;
      reduced?(): boolean;
      valid(): boolean;
      frame(
        kind: SceneKind,
      ): {
        from: Point;
        to: Point;
        target?: Box;
        clips: Box[];
        pointer: Point;
      } | null;
      begin(kind: SceneKind): void;
      end(kind: SceneKind, completed: boolean): void;
    },
  ) {}
  play(kind: SceneKind, near: Box) {
    this.cancel();
    const frame = this.d.frame(kind);
    if (!frame || !this.d.valid()) return Promise.resolve(false);
    const area = screen.getDisplayMatching(near).workArea,
      id = ++this.seq;
    this.active = kind;
    this.ready = false;
    const local = (f: typeof frame): TheatreFrame => ({
      id,
      kind,
      duration: SCENE_SECONDS[kind],
      from: { x: f.from.x - area.x, y: f.from.y - area.y },
      to: { x: frame.to.x - area.x, y: frame.to.y - area.y },
      target: f.target
        ? { ...f.target, x: f.target.x - area.x, y: f.target.y - area.y }
        : undefined,
      clips: f.clips.map((r) => ({ ...r, x: r.x - area.x, y: r.y - area.y })),
      pointer: { x: f.pointer.x - area.x, y: f.pointer.y - area.y },
      reduced: this.d.reduced?.() ?? false,
      seed: id * 17,
    });
    this.state = local(frame);
    const win = (this.window = createTheatreWindow(
      area,
      this.d.preload,
      this.d.log,
    ));
    const result = new Promise<boolean>((resolve) => (this.complete = resolve));
    win.once("closed", () => this.finish(id, false));
    win.once("unresponsive", () => this.finish(id, false));
    win.webContents.once("render-process-gone", () => this.finish(id, false));
    win.webContents.once("did-fail-load", () => this.finish(id, false));
    this.timer = setTimeout(() => this.finish(id, false), 4000);
    this.timer.unref();
    this.guard = setInterval(() => {
      if (!this.d.valid()) {
        this.finish(id, false);
        return;
      }
      const next = this.d.frame(kind);
      if (!next) {
        this.finish(id, false);
        return;
      }
      const fresh = local(next);
      // A moving target is cancelled, not chased with stale geometry.
      if (
        this.state?.target &&
        fresh.target &&
        (["x", "y", "width", "height"] as const).some(
          (k) => Math.abs(this.state!.target![k] - fresh.target![k]) > 2,
        )
      ) {
        this.finish(id, false);
        return;
      }
      this.state = fresh;
      if (this.ready && !win.isDestroyed())
        win.webContents.send("theatre:update", fresh);
    }, 100);
    this.guard.unref();
    return result;
  }
  loaded(id: number) {
    if (!this.active || !this.window || id !== this.seq || this.ready) return;
    if (!this.d.valid()) {
      this.finish(id, false);
      return;
    }
    this.ready = true;
    if (this.timer) clearTimeout(this.timer);
    this.window.webContents.send("theatre:play", this.state);
    reveal(this.window);
    this.d.begin(this.active);
    this.timer = setTimeout(
      () => this.finish(id, false),
      (SCENE_SECONDS[this.active] + 2) * 1000,
    );
    this.timer.unref();
  }
  get id() {
    return this.seq;
  }
  finish(id: number, completed = true) {
    if (id !== this.seq || !this.active) return;
    const kind = this.active;
    this.active = null;
    this.state = null;
    if (this.timer) clearTimeout(this.timer);
    if (this.guard) clearInterval(this.guard);
    this.timer = this.guard = null;
    const win = this.window;
    this.window = null;
    if (win && !win.isDestroyed()) win.destroy();
    this.d.end(kind, completed);
    const complete = this.complete;
    this.complete = null;
    complete?.(completed);
  }
  cancel() {
    this.finish(this.seq, false);
  }
}
