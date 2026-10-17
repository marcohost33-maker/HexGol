import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Runtime layer of issue #176.
//
// The whole Playwright suite is now served by scripts/serve-dist-with-headers.mjs,
// which applies the repository's production `/*` headers to every dist response.
// This spec adds two security-specific witnesses on top of the normal functional
// e2e suite: document CSP violations and a successfully activated service worker.
// Existing worker specs therefore run behind the same production-header server.
//
// This remains an integration oracle, not a completeness proof: only executed
// application paths can emit runtime evidence. Static parser/policy layers remain
// separately necessary.

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../..");
const headersText = readFileSync(resolve(root, "public/_headers"), "utf8");
const cspLine = headersText
  .split(/\r?\n/)
  .map((line) => line.trim())
  .find((line) => line.toLowerCase().startsWith("content-security-policy:"));

if (!cspLine) throw new Error("public/_headers has no Content-Security-Policy line");
const productionCsp = cspLine.slice(cspLine.indexOf(":") + 1).trim();

test.describe("production CSP runtime oracle (#176)", () => {
  test("Chromium starts the app and service worker under the production wildcard headers", async ({ page }) => {
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

    const response = await page.goto("/", { waitUntil: "networkidle" });
    expect(response?.ok(), "production document did not load successfully").toBe(true);
    expect(response?.headers()["content-security-policy"]).toBe(productionCsp);

    // Counter-witness against a vacuous "zero violations" result: the app really
    // mounted under the policy.
    await expect(page.locator("#root")).toBeAttached();
    await expect(page.locator("#root")).not.toBeEmpty();

    const sw = await page.evaluate(async () => {
      if (!("serviceWorker" in navigator)) return { supported: false };
      const result = await Promise.race([
        navigator.serviceWorker.ready.then((registration) => ({
          supported: true,
          active: Boolean(registration.active),
          scriptURL: registration.active?.scriptURL ?? "",
          state: registration.active?.state ?? "",
        })),
        new Promise<{ supported: true; timeout: true }>((resolveTimeout) =>
          setTimeout(() => resolveTimeout({ supported: true, timeout: true }), 10_000),
        ),
      ]);
      return result;
    });

    expect(sw.supported).toBe(true);
    expect("timeout" in sw ? sw.timeout : false, "service worker did not become ready under production CSP").toBe(false);
    if (!("timeout" in sw)) {
      expect(sw.active).toBe(true);
      expect(sw.state).toBe("activated");
      expect(sw.scriptURL).toMatch(/\/sw\.js$/);
    }

    // The same wildcard header must be present on the actual worker script bytes.
    // The successful registration above is the browser-side enforcement witness;
    // this request is the transport witness that the worker resource carries CSP.
    const swResponse = await page.request.get("/sw.js");
    expect(swResponse.ok()).toBe(true);
    expect(swResponse.headers()["content-security-policy"]).toBe(productionCsp);

    const violations = await page.evaluate(() => {
      const globalWithEvidence = globalThis as typeof globalThis & {
        __golhexCspViolations?: Array<Record<string, unknown>>;
      };
      return globalWithEvidence.__golhexCspViolations ?? [];
    });

    expect(
      violations,
      `Chromium emitted document CSP violations under production policy: ${JSON.stringify(violations)}`,
    ).toEqual([]);
  });
});
