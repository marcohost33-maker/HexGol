// E2E tests that exercise the window.__TEST__ bridge introduced in v17.13
// and hardened in v17.14 (NR-G62: ready-state lifecycle; NR-G63: deterministic
// step that pauses and restores the running flag).
//
// Each test loads /?test=1&seed=42 so the bridge is installed and the seeded
// RNG produces reproducible randomize() output. We then drive the simulation
// through the bridge and assert via state() / telemetry() rather than DOM
// inspection - this is the faster, less-flaky path for canvas applications.

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
      randomize: () => void;
      clear: () => void;
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

  test("randomize() produces a non-empty alive count for seed 42", async ({ page }) => {
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
      window.__TEST__!.randomize();
      window.__TEST__!.step(20);
    });
    const entries = await page.evaluate(() => window.__TEST__!.telemetry());
    // Some entries (sim/render) should have accumulated; LoAF/longtask are
    // browser-dependent so we only require that the buffer is non-empty.
    expect(Array.isArray(entries)).toBe(true);
    expect(entries.length).toBeGreaterThan(0);
  });
});
