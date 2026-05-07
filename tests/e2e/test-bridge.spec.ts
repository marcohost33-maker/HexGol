// E2E tests for the window.__TEST__ bridge.
//
// v17.14 hardened the bridge against several races (NR-G62: ready-state on
// teardown; NR-G65: sim hard-pause via simPaused ref; NR-G66: per-call
// seed override on randomize). These specs cover both happy paths and the
// regression cases that motivated the fixes.

import { test, expect } from "@playwright/test";

declare global {
  interface Window {
    __TEST__?: {
      ready: boolean;
      version: string;
      seed: number;
      state: () => {
        gen: number;
        alive: number;
        rows: number;
        cols: number;
        gridSizeI: number;
        ruleI: number;
        wrap: boolean;
        mix: string;
        view: { zoom: number; panX: number; panY: number };
      };
      step: (n?: number) => void;
      advanceTime: (ms: number) => void;
      randomize: (seedOverride?: number) => void;
      clear: () => void;
      setSeed: (n: number) => void;
      setRuleset: (i: number) => void;
      setGrid: (i: number) => void;
      telemetry: () => Array<Record<string, unknown>>;
      perfStats: () => { simStepMs: number; renderMs: number; frameBudget: number; samples: number };
    };
  }
}

async function waitForBridge(page: import("@playwright/test").Page) {
  await page.waitForFunction(() => window.__TEST__?.ready === true, undefined, { timeout: 10_000 });
}

test.describe("__TEST__ bridge", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/?test=1&seed=42");
    await waitForBridge(page);
  });

  test("reports version v17.14 and stable seed", async ({ page }) => {
    const info = await page.evaluate(() => ({
      version: window.__TEST__!.version,
      seed: window.__TEST__!.seed,
      ready: window.__TEST__!.ready,
    }));
    expect(info.version).toBe("v17.14");
    expect(info.seed).toBe(42);
    expect(info.ready).toBe(true);
  });

  test("clear() yields zero alive cells", async ({ page }) => {
    await page.evaluate(() => window.__TEST__!.clear());
    const s = await page.evaluate(() => window.__TEST__!.state());
    expect(s.alive).toBe(0);
    expect(s.gen).toBe(0);
  });

  test("step(n) advances the generation counter by n", async ({ page }) => {
    await page.evaluate(() => window.__TEST__!.clear());
    const before = await page.evaluate(() => window.__TEST__!.state().gen);
    await page.evaluate(() => window.__TEST__!.step(5));
    const after = await page.evaluate(() => window.__TEST__!.state().gen);
    expect(after - before).toBe(5);
  });

  // NR-G66: randomize accepts a per-call seed override; the same seed must
  // produce the same alive count across two clear+randomize cycles.
  test("randomize(seed) is deterministic across calls", async ({ page }) => {
    const aliveA = await page.evaluate(() => {
      window.__TEST__!.clear();
      window.__TEST__!.randomize(123);
      return window.__TEST__!.state().alive;
    });
    const aliveB = await page.evaluate(() => {
      window.__TEST__!.clear();
      window.__TEST__!.randomize(123);
      return window.__TEST__!.state().alive;
    });
    expect(aliveA).toBeGreaterThan(0);
    expect(aliveB).toBe(aliveA);
  });

  test("randomize() produces a non-empty alive count", async ({ page }) => {
    await page.evaluate(() => window.__TEST__!.randomize());
    const s = await page.evaluate(() => window.__TEST__!.state());
    expect(s.alive).toBeGreaterThan(0);
  });

  test("setGrid(i) updates rows/cols", async ({ page }) => {
    await page.evaluate(() => window.__TEST__!.setGrid(0));
    // Grid switch happens inside a useTransition, so poll until it propagates.
    await page.waitForFunction(() => window.__TEST__!.state().gridSizeI === 0, undefined, { timeout: 5_000 });
    const s = await page.evaluate(() => window.__TEST__!.state());
    expect(s.rows).toBe(40);
    expect(s.cols).toBe(50);
  });

  test("telemetry buffer accumulates entries after stepping", async ({ page }) => {
    await page.evaluate(() => {
      window.__TEST__!.clear();
      window.__TEST__!.randomize(42);
      window.__TEST__!.step(20);
    });
    const entries = await page.evaluate(() => window.__TEST__!.telemetry());
    expect(Array.isArray(entries)).toBe(true);
    expect(entries.length).toBeGreaterThan(0);
  });

  // NR-G65 regression: prior to the simPaused ref the bridge's setRunning
  // toggle was batched away by React, leaving the rAF sim loop free to add
  // phantom generations between bridge.step() calls. Now we start a sim
  // tick (slow speed so the loop's setTimeout is well above one tick) and
  // call step(N) several times, verifying gen advances by exactly N each.
  test("step(n) does not race the running sim", async ({ page }) => {
    await page.evaluate(() => {
      const t = window.__TEST__!;
      t.clear();
      t.randomize(7);
    });
    // Click PLAY to start the rAF sim loop. The button is keyboard-focused
    // by clicking on it; pressing Space toggles play. Using the button keeps
    // the test independent of label text, which the i18n could change.
    const play = page.getByRole("button", { name: "Space" }).first();
    await play.click();

    // Now drive 3 deterministic step batches and assert exact gen deltas.
    for (let i = 0; i < 3; i++) {
      const before = await page.evaluate(() => window.__TEST__!.state().gen);
      await page.evaluate(() => window.__TEST__!.step(4));
      const after = await page.evaluate(() => window.__TEST__!.state().gen);
      expect(after - before).toBe(4);
    }

    // Pause again so subsequent tests in this describe see a quiescent app.
    await play.click();
  });
});
