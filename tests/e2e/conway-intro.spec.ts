import { test, expect } from "@playwright/test";

// e2e: GolHex Bildungs-Intro (Conway / Game of Life / GolHex), 2026-06-10.
// Real DOM contract (AGENTS.md §2, no window hooks): drive through real controls,
// assert observable behaviour, zero console/page errors.
//   1. First open: after the splash is gone, the intro overlay is shown.
//   2. "Los geht's" dismisses it; the app underneath is interactive.
//   3. Reload: it does NOT auto-appear again (localStorage flag persists).
//   4. The ⓘ button re-opens it on demand.

async function dismissSplash(page: import("@playwright/test").Page) {
  const splash = page.getByTestId("splash");
  // The splash auto-dismisses; tap to be deterministic, then wait until gone.
  if (await splash.isVisible().catch(() => false)) {
    await splash.click().catch(() => {});
  }
  await expect(splash).toBeHidden({ timeout: 4000 });
}

// This spec exercises the FIRST-OPEN path, so it must run with a CLEAN storage
// state — overriding the suite-wide "intro already seen" seed from the config.
test.use({ storageState: { cookies: [], origins: [] } });

test.describe("GolHex Bildungs-Intro", () => {
  test("first open shows the intro after the splash; 'Los geht's' closes it", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
    page.on("console", (m) => { if (m.type() === "error") errors.push("console: " + m.text()); });

    await page.goto("/");

    await dismissSplash(page);

    // Intro overlay is now visible (after splash), with dialog role.
    const intro = page.getByTestId("conway-intro");
    await expect(intro).toBeVisible();
    await expect(intro).toHaveAttribute("role", "dialog");
    await expect(intro).toContainText("John Horton Conway");
    await expect(intro).toContainText("Game of Life");
    await expect(intro).toContainText("GolHex");

    // "Los geht's" closes it.
    await page.getByTestId("conway-intro-start").click();
    await expect(intro).toBeHidden({ timeout: 2000 });

    // App underneath is interactive.
    await expect(page.getByRole("button", { name: "Start", exact: true })).toBeVisible();

    expect(errors, "keine Konsolen-/Page-Fehler").toEqual([]);
  });

  test("after being seen, a reload does NOT auto-show the intro", async ({ page }) => {
    // First visit: dismiss splash + intro so the flag is written.
    await page.goto("/");
    await dismissSplash(page);
    await expect(page.getByTestId("conway-intro")).toBeVisible();
    await page.getByTestId("conway-intro-start").click();
    await expect(page.getByTestId("conway-intro")).toBeHidden({ timeout: 2000 });

    // Reload: splash again, but the intro must NOT auto-appear.
    await page.reload();
    await dismissSplash(page);
    // Give the app a moment; the intro stays hidden.
    await expect(page.getByRole("button", { name: "Start", exact: true })).toBeVisible();
    await expect(page.getByTestId("conway-intro")).toBeHidden();
  });

  test("the ⓘ button re-opens the intro on demand", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
    page.on("console", (m) => { if (m.type() === "error") errors.push("console: " + m.text()); });

    await page.goto("/");
    await dismissSplash(page);
    // Close the first-open intro if present.
    const intro = page.getByTestId("conway-intro");
    if (await intro.isVisible().catch(() => false)) {
      await page.getByTestId("conway-intro-start").click();
      await expect(intro).toBeHidden({ timeout: 2000 });
    }

    // The ⓘ button re-opens it.
    await page.getByTestId("intro-btn").click();
    await expect(intro).toBeVisible();
    await expect(intro).toContainText("John Horton Conway");

    // Esc closes it again.
    await page.keyboard.press("Escape");
    await expect(intro).toBeHidden({ timeout: 2000 });

    expect(errors, "keine Konsolen-/Page-Fehler").toEqual([]);
  });
});
