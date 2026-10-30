export const SCENES = ["satellite", "possession", "zap"] as const;
export type SceneKind = (typeof SCENES)[number];
export const FLOURISHES = [
  "curious",
  "look",
  "hop",
  "split",
  "flinch",
  "land",
  "reach",
  "victory",
  "dive",
  "peek",
] as const;
export type FlourishKind = (typeof FLOURISHES)[number] | "spin";
export type Point = { x: number; y: number };
export type Box = Point & { width: number; height: number };
export interface TheatreFrame {
  id: number;
  kind: SceneKind;
  duration: number;
  from: Point;
  to: Point;
  target?: Box;
  clips: Box[];
  pointer: Point;
  reduced: boolean;
  seed: number;
}
export const SCENE_SECONDS: Record<SceneKind, number> = {
  satellite: 11.8,
  possession: 4.6,
  zap: 1.8,
};
const clamp = (n: number) => Math.max(0, Math.min(1, n));
export function sceneBeat(kind: SceneKind, t: number) {
  if (kind === "satellite")
    return t < 1.6
      ? "hush"
      : t < 4.4
        ? "reach"
        : t < 6.4
          ? "charge"
          : t < 7.5
            ? "bolt"
            : t < 9.2
              ? "answer"
              : "settle";
  if (kind === "possession")
    return t < 0.8 ? "dive" : t < 3.6 ? "inhabit" : "return";
  return t < 0.45 ? "notice" : t < 0.8 ? "zap" : "settle";
}
/** Shared cel clock: small anticipation, readable holds, then a complete return to rest. */
export function flourishMotion(
  kind: FlourishKind,
  seconds: number,
  grounded: boolean,
  side = 1,
) {
  const t = Math.floor(Math.max(0, seconds) * 12) / 12;
  const duration = kind === "reach" ? 10.8 : kind === "peek" ? 3.8 : 2.4;
  const u = clamp(t / duration),
    e = Math.sin(u * Math.PI) ** 2;
  let x = 0,
    y = 0,
    turn = 0,
    sx = 1,
    sy = 1,
    echo = 0,
    arm = 0;
  if (u >= 1) return { x, y, turn, sx, sy, echo, arm, done: true };
  if (kind === "curious" || kind === "look" || kind === "peek") {
    turn = side * e * (kind === "peek" ? 0.07 : 0.045);
    x = side * e * 0.015;
  }
  if (kind === "hop" || kind === "victory") {
    const anticip = t < 0.25 ? t / 0.25 : 0,
      flight = clamp((t - 0.25) / 1.2),
      settle = Math.max(0, 1 - Math.abs(t - 1.65) / 0.45);
    y = grounded ? 0 : -0.075 * Math.sin(flight * Math.PI);
    sy = 1 - anticip * 0.07 - settle * 0.04;
    sx = 1 + anticip * 0.06 + settle * 0.025;
    turn = side * 0.025 * e;
    echo = kind === "victory" ? e * 0.8 : 0;
  }
  if (kind === "spin") {
    sx = grounded ? 1 : Math.max(0.12, Math.abs(Math.cos(u * Math.PI * 2)));
    y = grounded ? 0 : -0.025 * e;
    turn = grounded ? 0.025 * e * side : 0.06 * Math.sin(u * Math.PI * 2);
    echo = e;
  }
  if (kind === "split") {
    echo = e;
    turn = side * 0.025 * e;
  }
  if (kind === "flinch") {
    x = -side * 0.025 * e;
    turn = -side * 0.055 * e;
    sy = 1 - e * 0.04;
  }
  if (kind === "land") {
    sy = 1 - 0.07 * e;
    sx = 1 + 0.045 * e;
  }
  if (kind === "dive") {
    sx = 1 - 0.7 * e;
    sy = 1 + 0.08 * e;
    echo = e * 0.6;
  }
  if (kind === "reach") {
    arm = clamp(t / 2) * clamp((duration - t) / 1.7);
    turn = -side * arm * 0.025;
  }
  return { x, y, turn, sx, sy, echo, arm, done: false };
}
/** Cadence belongs to the companion, never to model requests or cursor sample frequency. */
export class TheatreCadence {
  private next = 0;
  private last = new Map<string, number>();
  private previous = "";
  private satelliteDay = "";
  snapshot() {
    return {
      version: 1,
      satelliteDay: this.satelliteDay,
      last: [...this.last.entries()],
    };
  }
  restore(raw: unknown, now: number) {
    const r = raw as {
      version?: number;
      satelliteDay?: string;
      last?: unknown[];
    } | null;
    if (r?.version !== 1) return;
    if (typeof r.satelliteDay === "string" && r.satelliteDay.length < 32)
      this.satelliteDay = r.satelliteDay;
    for (const row of r.last ?? [])
      if (
        Array.isArray(row) &&
        typeof row[0] === "string" &&
        typeof row[1] === "number" &&
        Number.isFinite(row[1]) &&
        row[1] <= now &&
        now - row[1] < 86400000
      )
        this.last.set(row[0], row[1]);
  }
  choose(
    now: number,
    day: string,
    input: {
      blocked: boolean;
      possession: boolean;
      cursorNear: boolean;
      satellite: boolean;
      mischief: boolean;
    },
    rand = Math.random,
  ): SceneKind | FlourishKind | null {
    if (input.blocked) {
      this.next = Math.max(this.next, now + 12000);
      return null;
    }
    if (!this.next) {
      this.next = now + 65000;
      return null;
    }
    if (now < this.next) return null;
    this.next = now + 45000 + rand() * 60000;
    let pool: (SceneKind | FlourishKind)[] = [
      "curious",
      "look",
      "hop",
      "split",
    ];
    if (
      input.satellite &&
      this.satelliteDay !== day &&
      now - (this.last.get("satellite") ?? -Infinity) > 30 * 60000
    )
      pool.push("satellite");
    if (
      input.possession &&
      input.mischief &&
      now - (this.last.get("possession") ?? -Infinity) >= 12 * 60000
    )
      pool.push("possession");
    if (
      input.cursorNear &&
      input.mischief &&
      now - (this.last.get("zap") ?? -Infinity) >= 8 * 60000
    )
      pool.push("zap");
    pool = pool.filter((k) => k !== this.previous);
    const chosen =
      pool[Math.min(pool.length - 1, Math.floor(rand() * pool.length))];
    this.mark(chosen, now, day);
    return chosen;
  }
  mark(kind: string, now: number, day: string) {
    this.last.set(kind, now);
    this.previous = kind;
    this.next = Math.max(this.next, now + 45000);
    if (kind === "satellite") this.satelliteDay = day;
  }
}
/** Explicit sleep stays asleep until explicitly woken; natural sleep can be stirred by input. */
export class DeepSleepClock {
  asleep = 0;
  amount = 0;
  update(dt: number, sleeping: boolean, enabled: boolean, preview = false) {
    this.asleep = sleeping && enabled ? this.asleep + dt : 0;
    const target =
      sleeping && enabled && (preview || this.asleep >= 40) ? 1 : 0;
    this.amount +=
      Math.sign(target - this.amount) *
      Math.min(Math.abs(target - this.amount), dt / 1.1);
    return this.amount;
  }
}
