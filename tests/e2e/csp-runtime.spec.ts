import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Runtime half of issue #176.
//
// `vite preview` does not apply Cloudflare Pages' `public/_headers`, so the normal
// e2e suite previously exercised the production bundle without the production CSP.
// This test injects the exact proposed production CSP into the top-level document
// response and lets Chromium enforce it. It is deliberately an integration oracle,
// not a completeness proof: it covers the startup/navigation path exercised below;
// the static contract/parser layer remains separately necessary.

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../..");
const headersText = readFileSync(resolve(root, "public/_headers"), "utf8");
const cspLine = headersText
  .split(/\r?\n/)
  .map((line) => line.trim())
  .find((line) => line.toLowerCase().startsWith("content-security-policy:"));

if (!cspLine) {
  throw new Error("public/_headers has no Content-Security-Policy line");
}

const productionCsp = cspLine.slice(cspLine.indexOf(":") + 1).trim();

test.describe("production CSP runtime oracle (#176)", () => {
  test("Chromium reports no CSP violation on the production startup path", async ({ page }) => {
    // Register before navigation. The listener is installed in every new document
    // before application scripts run, so startup-time violations are retained.
    await page.addInitScript(() => {
      const globalWithEvidence = globalThis as typeof globalThis & {
        __golhexCspViolations?: Array<Record<string, unknown>>;
      };
      globalWithEvidence.__golhexCspViolations = [];
      document.addEventListener("securitypolicyviolation", (event) => {
        globalWithEvidence.__golhexCspViolations?.push({
          blockedURI: event.blockedURI,
          effectiveDirective: event.effectiveDirective,
          violatedDirective: event.violatedDirective,
          sourceFile: event.sourceFile,
          lineNumber: event.lineNumber,
          columnNumber: event.columnNumber,
          disposition: event.disposition,
          statusCode: event.statusCode,
        });
      });
    });

    // Apply the checked-in production policy to the real preview document.
    // `route.fetch()` obtains the Vite response; `route.fulfill()` preserves it
    // while adding the header Chromium will actually enforce.
    await page.route("**/*", async (route) => {
      const request = route.request();
      if (request.resourceType() !== "document") {
        await route.continue();
        return;
      }
      const response = await route.fetch();
      await route.fulfill({
        response,
        headers: {
          ...response.headers(),
          "content-security-policy": productionCsp,
        },
      });
    });

    const response = await page.goto("/", { waitUntil: "networkidle" });
    expect(response?.ok(), "production document did not load successfully").toBe(true);

    // Prove this is not merely "no report because nothing ran". The production
    // application must have mounted while the policy was active.
    await expect(page.locator("#root")).toBeAttached();
    await expect(page.locator("#root")).not.toBeEmpty();

    const violations = await page.evaluate(() => {
      const globalWithEvidence = globalThis as typeof globalThis & {
        __golhexCspViolations?: Array<Record<string, unknown>>;
      };
      return globalWithEvidence.__golhexCspViolations ?? [];
    });

    expect(
      violations,
      `Chromium emitted CSP violations under production policy: ${JSON.stringify(violations)}`,
    ).toEqual([]);
  });
});
