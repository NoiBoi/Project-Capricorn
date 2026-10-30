import { describe, expect, it } from "vitest";
import {
  DeepSleepClock,
  FLOURISHES,
  flourishMotion,
  sceneBeat,
  TheatreCadence,
} from "../../src/shared/theatrics";
describe("construct choreography", () => {
  it("dozes before becoming a mask and completely re-forms when woken or disabled", () => {
    const c = new DeepSleepClock();
    for (let i = 0; i < 390; i++) c.update(0.1, true, true);
    expect(c.amount).toBe(0);
    for (let i = 0; i < 25; i++) c.update(0.1, true, true);
    expect(c.amount).toBe(1);
    for (let i = 0; i < 12; i++) c.update(0.1, false, true);
    expect(c.amount).toBe(0);
    expect(c.asleep).toBe(0);
    c.update(1.2, true, true, true);
    expect(c.amount).toBe(1);
    c.update(1.2, true, false);
    expect(c.amount).toBe(0);
  });
  it("ends every gesture at neutral, holds cels and keeps seated hops anchored", () => {
    for (const kind of FLOURISHES) {
      expect(flourishMotion(kind, 20, false)).toMatchObject({
        x: 0,
        y: 0,
        turn: 0,
        sx: 1,
        sy: 1,
        echo: 0,
        arm: 0,
        done: true,
      });
      expect(flourishMotion(kind, 0.51, false)).toEqual(
        flourishMotion(kind, 0.54, false),
      );
      for (let t = 0; t < 3; t += 0.1) {
        const p = flourishMotion(kind, t, true);
        expect(p.y).toBe(0);
        expect(p.sx).toBeGreaterThan(0);
        expect(p.sy).toBeGreaterThan(0);
      }
    }
    expect(flourishMotion("hop", 0.8, false).y).toBeLessThan(0);
  });
  it("uses each satellite beat in order and keeps possession bounded", () => {
    expect([0, 2, 5, 6.8, 8, 10].map((t) => sceneBeat("satellite", t))).toEqual(
      ["hush", "reach", "charge", "bolt", "answer", "settle"],
    );
    expect([0, 1, 4].map((t) => sceneBeat("possession", t))).toEqual([
      "dive",
      "inhabit",
      "return",
    ]);
  });
  it("spaces spectacle choices, never repeats consecutively, and permits one satellite per day", () => {
    const c = new TheatreCadence(),
      input = {
        blocked: false,
        possession: true,
        cursorNear: true,
        satellite: true,
        mischief: true,
      };
    expect(c.choose(1000, "today", input, () => 0.99)).toBeNull();
    expect(c.choose(65000, "today", input, () => 0.99)).toBeNull();
    expect(
      c.choose(
        67000,
        "today",
        { ...input, possession: false, cursorNear: false },
        () => 0.99,
      ),
    ).toBe("satellite");
    expect(c.choose(68000, "today", input, () => 0.99)).toBeNull();
    const seen: (string | null)[] = [];
    for (let t = 200000; t < 2000000; t += 200000)
      seen.push(c.choose(t, "today", input, () => 0.99));
    expect(seen).not.toContain("satellite");
    expect(seen.every((x, i) => !i || x !== seen[i - 1])).toBe(true);
    expect(
      c.choose(
        3000000,
        "tomorrow",
        { ...input, possession: false, cursorNear: false },
        () => 0.99,
      ),
    ).toBe("satellite");
    expect(
      c.choose(4000000, "tomorrow", { ...input, blocked: true }, () => 0.99),
    ).toBeNull();
    expect(c.choose(4001000, "tomorrow", input, () => 0.99)).toBeNull();
  });
});
