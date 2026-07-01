import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

// A11y-Gate (Test-Center T5), measure-first.
//
// Runs axe-core (WCAG 2.0/2.1 Level A + AA rules) against the real DOM of the
// GolHex main view. Follows the AGENTS.md e2e contract: NO window/__TEST__
// bridge — the app is driven/loaded through the real page + <canvas>. This scan
// covers the primary landing view (top tab bar, bottom controls, close button);
// panel-internal a11y is a follow-up.
//
// Gate decision is measure-first: the assertion below fails the build ONLY on
// `serious`/`critical` impact violations. `minor`/`moderate` are reported as an
// advisory attachment (console + report) but do not gate, so we can drive the
// baseline down deliberately without a big-bang refactor. If the primary view is
// clean at serious/critical, this spec is a real gate on regressions.
test.describe("GolHex a11y (axe / WCAG 2 A+AA)", () => {
  test("main view has no serious/critical WCAG violations", async ({ page }, testInfo) => {
    await page.goto("/");
    // Let the splash settle and the app mount its controls (same warmup the
    // smoke spec uses). No JS hook — we wait on an observable DOM control.
    await expect(page.locator('canvas:not([aria-hidden="true"])')).toHaveCount(1);
    await expect(page.getByRole("button", { name: "App schliessen" })).toBeVisible();

    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();

    // Full machine-readable dump for the CI report + PR follow-up triage.
    const summary = results.violations.map((v) => ({
      id: v.id,
      impact: v.impact,
      nodes: v.nodes.length,
      help: v.help,
    }));
    await testInfo.attach("axe-violations.json", {
      body: JSON.stringify({ total: results.violations.length, violations: summary }, null, 2),
      contentType: "application/json",
    });
    // eslint-disable-next-line no-console
    console.log("[axe] violations:", JSON.stringify(summary));

    const blocking = results.violations.filter(
      (v) => v.impact === "serious" || v.impact === "critical",
    );
    const blockingIds = blocking.map((v) => `${v.id} (${v.impact}, ${v.nodes.length} nodes)`);

    expect(blocking, `serious/critical WCAG violations: ${blockingIds.join(", ")}`).toEqual([]);
  });
});
