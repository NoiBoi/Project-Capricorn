import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  _electron as electron,
  type ElectronApplication,
  type Page,
} from "playwright-core";
import { afterEach, describe, expect, it } from "vitest";
import { SCENES } from "../../src/shared/theatrics";
import { SEAT_RATIO } from "../../src/shared/framing";
const ROOT = path.resolve(__dirname, "../.."),
  apps: ElectronApplication[] = [],
  dirs: string[] = [];
async function launch() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "capri-theatre-"));
  dirs.push(dir);
  fs.writeFileSync(
    path.join(dir, "settings.json"),
    JSON.stringify({
      firstRunComplete: true,
      ai: { provider: "offline" },
      character: { startupIntro: false, glitchEffects: true, deepSleep: true, hideOnFullscreen: false },
      behavior: {
        satelliteMoments: true, windowPossession: true, quietHours: { enabled: false },
        idleRemarks: false,
        explore: false,
      },
      voice: { ttsEnabled: false, interactionLines: false },
      teleport: { auto: false, effects: false },
    }),
  );
  const app = await electron.launch({
    ...(process.env.CAPRI_EXE
      ? { executablePath: process.env.CAPRI_EXE, args: [] }
      : { args: [ROOT] }),
    env: {
      ...process.env,
      CAPRI_TEST: "1",
      CAPRI_OFFSCREEN: "1",
      CAPRI_USER_DATA: dir,
      CAPRI_NO_DEV_KEY: "1",
    },
    timeout: 30000,
  });
  apps.push(app);
  const char = await find(app, "/character.html");
  await char.waitForFunction(() => !!(window as any).__capriDebug);
  await app.evaluate(({ screen }) => {
    const g = globalThis as any,
      a = g.__capri,
      area = screen.getPrimaryDisplay().workArea,
      b = a.charWin.getBounds();
    g.__capriIdleOverride = 0;
    g.__capriTheatrePointer = { x: area.x + 800, y: area.y + 450 };
    g.__capriWindowsOverride = [];
    g.__capriDesktopOverride = { title: "Test", process: "test.exe" };
    a.charWin.setBounds({ ...b, x: area.x + 200, y: area.y + 30 });
    a.settleAfterDrop();
  });
  return { app, char };
}
async function find(app: ElectronApplication, suffix: string): Promise<Page> {
  for (let i = 0; i < 100; i++) {
    const p = app.windows().find((p) => p.url().includes(suffix));
    if (p) return p;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw Error("Missing " + suffix);
}
async function scene(app: ElectronApplication, kind: (typeof SCENES)[number]) {
  await app.evaluate((_e, kind) => {
    const g = globalThis as any;
    g.__sceneResult = null;
    g.__sceneRun = g.__capri
      .runTheatre(kind, true)
      .then((r: boolean) => (g.__sceneResult = r));
  }, kind);
  const overlay = await find(app, "/theatre.html");
  await overlay.waitForFunction(() => !!(window as any).__theatreDebug?.state);
  return overlay;
}
afterEach(async () => {
  for (const app of apps.splice(0)) {
    try {
      await app.close();
    } catch {
      app.process().kill();
    }
  }
  for (const dir of dirs.splice(0))
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {}
});
describe("construct life and desktop spectacles", () => {
  it("dissolves into her mask, keeps a real hit region, and reforms completely", async () => {
    const { app, char } = await launch();
    await app.evaluate(() => {
      (globalThis as any).__capri.settings.update({
        behavior: { mode: "sleep" },
      });
    });
    await expect.poll(()=>char.evaluate(()=>(window as any).__capriDebug.behavior.state)).toBe('sleeping');
    const sleeping = await char.evaluate(() => {
      const d = (window as any).__capriDebug;
      d.manual(true);
      d.step(0.1, 420);
      return {
        a: d.deepSleep.amount,
        asleep: d.deepSleep.clock.asleep,
        hit: d.hitAt(innerWidth * 0.5, innerHeight * 0.45),
        outside: d.hitAt(5, 5),
      };
    });
    expect(sleeping.a).toBe(1);
    expect(sleeping.asleep).toBeGreaterThan(40);
    expect(sleeping.hit).toBe(true);
    expect(sleeping.outside).toBe(false);
    expect(
      await char.evaluate(() => {
        const d = (window as any).__capriDebug;
        return d.hitAt(innerWidth * 0.5, innerHeight * 0.2);
      }),
    ).toBe(false);
    if (process.env.CAPRI_THEATRE_CAPTURE)
      await char.screenshot({
        path: process.env.CAPRI_THEATRE_CAPTURE + "-mask.png",
      });
    await app.evaluate(() => {
      (globalThis as any).__capri.settings.update({
        behavior: { mode: "normal" },
      });
    });
    expect(
      await char.evaluate(() => {
        const d = (window as any).__capriDebug;
        d.step(0.1, 15);
        d.manual(false);
        return d.deepSleep.amount;
      }),
    ).toBe(0);
  });
  it("runs every visual scene without capturing content, changing focus or moving the pointer", async () => {
    const { app, char } = await launch();
    await app.evaluate(({ app }) => {
      const g = globalThis as any;
      g.__theatreInputAttempts = 0;
      // Observe native input attempts, independently of the human moving the mouse.
      // Block any accidental writes rather than performing them in a test.
      const nativeRequire = process.getBuiltinModule('module').createRequire(app.getAppPath() + '/package.json');
      const koffi = nativeRequire('koffi'), load = koffi.load;
      koffi.load = (...args: any[]) => {
        const library = load(...args), func = library.func;
        library.func = (...signature: any[]) => /SetCursorPos|SendInput/.test(signature.join(' '))
          ? () => { g.__theatreInputAttempts++; return 0; } : func.apply(library, signature);
        return library;
      };
    });
    await app.evaluate(({ screen }) => {
      const g = globalThis as any,
        area = screen.getPrimaryDisplay().workArea;
      g.__capriWindowsOverride = [
        {
          handle: -882n,
          rect: { x: area.x + 60, y: area.y + 180, width: 900, height: 550 },
        },
      ];
    });
    for (const kind of SCENES) {
      const before = await app.evaluate(() => ({
        inputAttempts: (globalThis as any).__theatreInputAttempts,
        scenes: (globalThis as any).__capri.scenes.recent().length,
      }));
      const overlay = await scene(app, kind);
      if(kind === 'satellite') {
        const look = await char.evaluate(() => { const d = (window as any).__capriDebug; d.manual(true); d.setPointer(-1,0); d.step(.1,8); const look = d.model.lookDirection; d.manual(false); return look; });
        expect(look).toBeGreaterThan(0);
      }

      expect(
        await app.evaluate(() => {
          const w = (globalThis as any).__capri.theatre.window;
          return { focusable: w.isFocusable(), focused: w.isFocused() };
        }),
      ).toEqual({ focusable: false, focused: false });
      await overlay.evaluate((kind) => {
        (window as any).__theatreDebug.draw(
          kind === "satellite" ? 6.8 : kind === "possession" ? 2 : 0.65,
        );
      }, kind);
      const pixels = await overlay.evaluate(() => {
        const c = document.querySelector("canvas")!,
          g = c.getContext("2d")!,
          data = g.getImageData(0, 0, c.width, c.height).data;
        let n = 0;
        for (let i = 3; i < data.length; i += 4) if (data[i]) n++;
        return n;
      });
      expect(pixels).toBeGreaterThan(30);
      if (process.env.CAPRI_THEATRE_CAPTURE) {
        await overlay.screenshot({
          path: process.env.CAPRI_THEATRE_CAPTURE + "-" + kind + ".png",
        });
        await char.screenshot({
          path: process.env.CAPRI_THEATRE_CAPTURE + "-" + kind + "-body.png",
        });
      }
      await overlay
        .evaluate(() =>
          window.capri.invoke(
            "theatre:done",
            (window as any).__theatreDebug.state.id,
          ),
        )
        .catch((error) => {
          if (!String(error).includes("closed")) throw error;
        });
      await expect
        .poll(() => app.evaluate(() => (globalThis as any).__sceneResult))
        .toBe(true);
      const after = await app.evaluate(() => ({
        inputAttempts: (globalThis as any).__theatreInputAttempts,
        scenes: (globalThis as any).__capri.scenes.recent().length,
      }));
      expect(after).toEqual(before);
      expect(after.inputAttempts).toBe(0);
      expect(
        await app.evaluate(() => {
          const a = (globalThis as any).__capri;
          return a.theatre.window === null && !a.charWin.isDestroyed();
        }),
      ).toBe(true);
    }
  });
  it("clips possession away from covering windows and restores Capri if the target vanishes or moves", async () => {
    const { app } = await launch();
    await app.evaluate(({ screen }) => {
      const g = globalThis as any,
        a = screen.getPrimaryDisplay().workArea;
      g.__capriWindowsOverride = [
        {
          handle: -901n,
          rect: { x: a.x + 400, y: a.y + 200, width: 300, height: 250 },
          eligible: false,
        },
        {
          handle: -902n,
          rect: { x: a.x + 100, y: a.y + 150, width: 1000, height: 600 },
        },
      ];
    });
    let overlay = await scene(app, "possession");
    const clipped = await overlay.evaluate(() => {
      const d = (window as any).__theatreDebug,
        s = d.state;
      d.draw(2);
      const c = document.querySelector("canvas")!,
        g = c.getContext("2d")!;
      const x = s.target.x + 350,
        y = s.target.y + 100;
      return {
        alpha: g.getImageData(
          Math.round(x * devicePixelRatio),
          Math.round(y * devicePixelRatio),
          1,
          1,
        ).data[3],
        clips: s.clips.length,
      };
    });
    expect(clipped.alpha).toBe(0);
    expect(clipped.clips).toBeGreaterThan(1);
    await app.evaluate(() => {
      (globalThis as any).__capriWindowsOverride = [];
    });
    await expect
      .poll(() => app.evaluate(() => (globalThis as any).__sceneResult))
      .toBe(false);
    expect(
      await app.evaluate(() => {
        const a = (globalThis as any).__capri;
        return a.theatre.window === null;
      }),
    ).toBe(true);
    await app.evaluate(({ screen }) => {
      const g = globalThis as any,
        a = screen.getPrimaryDisplay().workArea;
      g.__capriWindowsOverride = [
        {
          handle: -902n,
          rect: { x: a.x + 100, y: a.y + 150, width: 1000, height: 600 },
        },
      ];
    });
    overlay = await scene(app, "possession");
    await overlay.waitForTimeout(800);
    await app.evaluate(() => {
      (globalThis as any).__capriWindowsOverride[0].rect.y += 50;
    });
    await expect
      .poll(() => app.evaluate(() => (globalThis as any).__sceneResult))
      .toBe(false);
    expect(
      await app.evaluate(() => {
        const a = (globalThis as any).__capri;
        return !a.theatre.active;
      }),
    ).toBe(true);
  });
  it("cancels on chat, sleep and hide, and refuses scenes during settled lounging", async () => {
    const { app } = await launch();
    await scene(app, "satellite");
    await app.evaluate(() => {
      (globalThis as any).__capri.settings.update({
        behavior: { mode: "sleep" },
      });
    });
    await expect
      .poll(() => app.evaluate(() => (globalThis as any).__sceneResult))
      .toBe(false);
    expect(
      await app.evaluate(() =>
        (globalThis as any).__capri.runTheatre("satellite"),
      ),
    ).toBe(false);
    await app.evaluate(({ screen }, seat) => {
      const a = (globalThis as any).__capri,
        area = screen.getPrimaryDisplay().workArea,
        b = a.charWin.getBounds();
      a.settings.update({ behavior: { mode: "normal" } });
      a.charWin.setBounds({
        ...b,
        x: area.x + 200,
        y: Math.round(area.y + area.height - b.height * seat),
      });
      a.settleAfterDrop();
    }, SEAT_RATIO);
    expect(
      await app.evaluate(() =>
        (globalThis as any).__capri.runTheatre("satellite"),
      ),
    ).toBe(false);
    await app.evaluate(() => {
      const a = (globalThis as any).__capri;
      a.bubble.open();
    });
    expect(
      await app.evaluate(() => (globalThis as any).__capri.runTheatre("zap")),
    ).toBe(false);
  });
  it("completes a real scene clock and restores a hidden possession body on interruption", async () => {
    const { app, char } = await launch();
    await scene(app, "zap");
    await expect
      .poll(() => app.evaluate(() => (globalThis as any).__sceneResult), {
        timeout: 5000,
      })
      .toBe(true);
    await scene(app, "satellite");
    await char.evaluate(() => window.capri.invoke("char:click"));
    await expect
      .poll(() => app.evaluate(() => (globalThis as any).__sceneResult))
      .toBe(false);
    await app.evaluate(({ screen }) => {
      const g = globalThis as any,
        a = g.__capri,
        area = screen.getPrimaryDisplay().workArea;
      a.bubble.dismiss();
      g.__capriWindowsOverride = [
        {
          handle: -999n,
          rect: { x: area.x + 50, y: area.y + 100, width: 1000, height: 600 },
        },
      ];
    });
    await scene(app, "possession");
    await expect
      .poll(() =>
        app.evaluate(() => (globalThis as any).__capri.charWin.capriShown),
      )
      .toBe(false);
    await app.evaluate(() => (globalThis as any).__capri.theatre.cancel());
    expect(
      await app.evaluate(() => (globalThis as any).__capri.charWin.capriShown),
    ).toBe(true);
    await scene(app, "satellite");
    await app.evaluate(() => (globalThis as any).__capri.minimizeCapri());
    await expect
      .poll(() => app.evaluate(() => (globalThis as any).__sceneResult))
      .toBe(false);
    expect(
      await app.evaluate(() => (globalThis as any).__capri.charWin.capriShown),
    ).toBe(false);
  });
  it("falls safely to another ledge after its supporting window closes", async () => {
    const { app } = await launch();
    await app.evaluate(({ screen }, seat) => {
      const g = globalThis as any,
        a = g.__capri,
        area = screen.getPrimaryDisplay().workArea,
        b = a.charWin.getBounds();
      g.__capriWindowsOverride = [
        {
          handle: -721n,
          rect: { x: area.x + 100, y: area.y + 500, width: 1000, height: 300 },
        },
      ];
      a.charWin.setBounds({
        ...b,
        x: area.x + 250,
        y: Math.round(area.y + 500 - b.height * seat),
      });
      a.settleAfterDrop();
      g.__capriWindowsOverride = [];
      a.perchTick();
    }, SEAT_RATIO);
    await expect
      .poll(() => app.evaluate(() => (globalThis as any).__capri.falling), {
        timeout: 6000,
      })
      .toBe(false);
    const result = await app.evaluate(({ screen }, seat) => {
      const a = (globalThis as any).__capri,
        b = a.charWin.getBounds(),
        area = screen.getPrimaryDisplay().workArea;
      return Math.abs(b.y + b.height * seat - area.y - area.height);
    }, SEAT_RATIO);
    expect(result).toBeLessThan(2);
  });
  it("previews every flourish and mask from the developer panel and stops without leftover windows", async () => {
    const { app, char } = await launch();
    await char.evaluate(() => window.capri.invoke("panel:open", "developer"));
    const panel = await find(app, "/panel.html");
    await panel.waitForSelector(".scroll");
    for (const name of ["hop", "look", "split", "reach"] as const) {
      await panel.evaluate(
        (name) =>
          window.capri.invoke("dev:run", {
            kind: "flourish",
            name,
            seconds: 2,
          }),
        name,
      );
      await expect
        .poll(() =>
          char.evaluate(() => (window as any).__capriDebug.model.performance),
        )
        .toBe(name);
      if (process.env.CAPRI_THEATRE_CAPTURE && name === "reach") {
        await char.evaluate(() => {
          const d = (window as any).__capriDebug;
          d.manual(true);
          d.step(0.1, 30);
        });
        await char.screenshot({
          path: process.env.CAPRI_THEATRE_CAPTURE + "-reach.png",
        });
        await char.evaluate(() => (window as any).__capriDebug.manual(false));
      }
      await panel.evaluate(() => window.capri.invoke("dev:stop"));
      expect(
        await char.evaluate(
          () => (window as any).__capriDebug.model.performance,
        ),
      ).toBeNull();
    }
    await panel.evaluate(() =>
      window.capri.invoke("dev:run", { kind: "mask", seconds: 3 }),
    );
    await expect
      .poll(
        () =>
          char.evaluate(() => (window as any).__capriDebug.deepSleep.amount),
        { timeout: 5000 },
      )
      .toBe(1);
    await panel.evaluate(() => window.capri.invoke("dev:stop"));
    await expect
      .poll(
        () =>
          char.evaluate(() => (window as any).__capriDebug.deepSleep.amount),
        { timeout: 5000 },
      )
      .toBe(0);
    await panel.evaluate(() =>
      window.capri.invoke("dev:run", {
        kind: "scene",
        name: "satellite",
        seconds: 2,
      }),
    );
    await expect
      .poll(() =>
        app.evaluate(() => (globalThis as any).__capri.theatre?.active),
      )
      .toBe("satellite");
    await panel.evaluate(() => window.capri.invoke("dev:stop"));
    expect(
      await app.evaluate(() => {
        const a = (globalThis as any).__capri;
        return !a.theatre.active && !a.theatre.window;
      }),
    ).toBe(true);
  });
  it("honors reduced motion and renders distinct original-art gestures with a neutral recovery", async () => {
    const { app, char } = await launch();
    for (const kind of ["hop", "look", "split", "reach"] as const) {
      const result = await char.evaluate((kind) => {
        const d = (window as any).__capriDebug;
        d.manual(true);
        d.force({ sleep: 0, mouthOpen: 0 });
        d.model.perform(kind);
        d.step(0.1, 8);
        const a = d.grab();
        d.step(0.1, 8);
        const changed = a !== d.grab();
        d.step(1, 13);
        return { changed, performance: d.model.performance };
      }, kind);
      expect(result.changed).toBe(true);
      expect(result.performance).toBeNull();
    }
    await char.emulateMedia({ reducedMotion: "reduce" });
    expect(
      await char.evaluate(() => {
        const d = (window as any).__capriDebug;
        d.model.perform("spin");
        d.step(0.1);
        d.manual(false);
        return d.model.performance;
      }),
    ).toBeNull();
    const overlay = await scene(app, "satellite");
    await overlay.emulateMedia({ reducedMotion: "reduce" });
    await overlay.evaluate(() => (window as any).__theatreDebug.draw(6.8));
    expect(
      await overlay.evaluate(() => !!(window as any).__theatreDebug.state),
    ).toBe(true);
    await app.evaluate(() => (globalThis as any).__capri.theatre.cancel());
  });
});
