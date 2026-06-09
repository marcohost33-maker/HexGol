import { test, expect } from "@playwright/test";

// e2e: GolHex branding intro-splash (v33 branding welle, 2026-06-09).
// Real DOM contract (AGENTS.md §2, no window hooks): the splash mounts once,
// shows the REAL app version, and is dismissable (tap) / auto-dismisses, after
// which the normal app is interactive. Version is read build-time from
// package.json via __APP_VERSION__ (vite.config.js define) — the spec asserts
// the version *pattern* (vMAJOR.MINOR.PATCH) so it never hard-codes a number
// that would rot on the next bump.
test.describe("GolHex branding splash", () => {
  test("shows the real version, then dismisses on tap and the app is usable", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
    page.on("console", (m) => { if (m.type() === "error") errors.push("console: " + m.text()); });

    await page.goto("/");

    // Splash present on first render with accessible dialog role.
    const splash = page.getByTestId("splash");
    await expect(splash).toBeVisible();
    await expect(splash).toHaveAttribute("role", "dialog");

    // Real version is shown: "COWORKER RESEARCH · V<x.y.z>".
    const ver = page.getByTestId("splash-version");
    await expect(ver).toContainText("COWORKER RESEARCH");
    await expect(ver).toHaveText(/COWORKER RESEARCH · V\d+\.\d+\.\d+/);

    // Tap dismisses the splash.
    await splash.click();
    await expect(splash).toBeHidden({ timeout: 2000 });

    // App underneath is the normal GolHex shell and is interactive.
    await expect(page.locator('canvas:not([aria-hidden="true"])')).toHaveCount(1);
    await expect(page.getByRole("button", { name: "Start", exact: true })).toBeVisible();

    expect(errors, "keine Konsolen-/Page-Fehler").toEqual([]);
  });

  test("auto-dismisses without interaction", async ({ page }) => {
    await page.goto("/");
    const splash = page.getByTestId("splash");
    await expect(splash).toBeVisible();
    // holdMs 1500 + fade -> gone well within 4s, no click.
    await expect(splash).toBeHidden({ timeout: 4000 });
    await expect(page.getByRole("button", { name: "Start", exact: true })).toBeVisible();
  });
});
