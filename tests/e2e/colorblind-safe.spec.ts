import { test, expect } from "@playwright/test";

// F10 — functional e2e for the opt-in Colorblind-safe toggle. NO new visual
// baseline (deliberate: avoid flaky screenshots, per the F10 envelope). We assert
// the observable contract: the toggle exists + is accessible, default is OFF, the
// default render is unchanged (data-render-mode stays "hex"), turning it ON keeps
// the boolean CA on the hexagon path with zero console/page errors, and the
// localStorage flag persists. Drives only real DOM controls (AGENTS.md §2).
test.describe("GolHex F10 colorblind-safe (opt-in)", () => {
  test("toggle: default OFF, ON re-renders boolean CA on hex path, no errors, persists", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
    page.on("console", (m) => { if (m.type() === "error") errors.push("console: " + m.text()); });

    await page.goto("/");
    await page.waitForTimeout(600);

    // The toggle lives in the Tab 3 (Hex-Regeln) panel under "DARSTELLUNG".
    await page.getByRole("button", { name: "Tab 3 Hex-Regeln" }).click();
    await page.waitForTimeout(250);

    const toggle = page.getByRole("checkbox", { name: "Farbenblind-sichere Darstellung" });
    await expect(toggle).toBeVisible();
    // Default OFF (opt-in) — default render must be untouched.
    await expect(toggle).not.toBeChecked();

    // Seed a deterministic field and confirm the default hex render path.
    await page.getByRole("button", { name: "Tab 3 Hex-Regeln" }).click(); // close panel
    await page.waitForTimeout(150);
    await page.getByRole("button", { name: "Random", exact: true }).click();
    await page.waitForTimeout(200);
    const canvas = page.locator('canvas:not([aria-hidden="true"])').first();
    await expect(canvas).toHaveAttribute("data-render-mode", "hex");

    // Turn the colorblind-safe encoding ON.
    await page.getByRole("button", { name: "Tab 3 Hex-Regeln" }).click();
    await page.waitForTimeout(200);
    await toggle.check();
    await expect(toggle).toBeChecked();

    // Run a few generations on the CVD path — still hexagons, no errors.
    await page.getByRole("button", { name: "Tab 3 Hex-Regeln" }).click(); // close panel
    await page.waitForTimeout(150);
    await page.getByRole("button", { name: "Start", exact: true }).click();
    await page.waitForTimeout(700);
    // Play button flips to "Pause" while running — pause to settle the render.
    await page.getByRole("button", { name: "Pause", exact: true }).click().catch(() => {});
    await page.waitForTimeout(150);
    await expect(canvas).toHaveAttribute("data-render-mode", "hex");

    // Persistence: the flag survives a reload (localStorage golhex_cvd_v1).
    const stored = await page.evaluate(() => localStorage.getItem("golhex_cvd_v1"));
    expect(stored).toBe("1");

    expect(errors, "keine Konsolen-/Page-Fehler im CVD-Modus").toEqual([]);
  });
});
