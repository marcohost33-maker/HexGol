import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../..");
const guard = resolve(root, "scripts/verify-csp-dom-contract.mjs");

function baselineHtml(extraBodyMarkup = "") {
  return [
    "<!doctype html>",
    '<html lang="de">',
    "  <head>",
    '    <meta charset="UTF-8" />',
    "    <style>:root{--ghx-font-sans:system-ui}</style>",
    '    <script type="module" crossorigin src="/assets/index-abc123.js"></script>',
    "  </head>",
    "  <body>",
    '    <div id="root"></div>',
    `    ${extraBodyMarkup}`,
    "  </body>",
    "</html>",
    "",
  ].join("\n");
}

function runGuard(html) {
  const base = mkdtempSync(join(tmpdir(), "ghx-csp-dom-"));
  mkdirSync(join(base, "dist"));
  writeFileSync(join(base, "dist/index.html"), html, "utf8");
  const run = spawnSync(process.execPath, [guard], {
    encoding: "utf8",
    env: { ...process.env, GHX_CSP_DIST: join(base, "dist") },
    cwd: root,
  });
  return { status: run.status, stdout: run.stdout ?? "", stderr: run.stderr ?? "" };
}

describe("standards-based CSP DOM contract (#176)", () => {
  it("stays green on the shipped output shape", () => {
    const run = runGuard(baselineHtml());
    expect(run.status).toBe(0);
    expect(run.stdout).toContain("script-elements=1");
    expect(run.stdout).toContain("executable-inline-scripts=0");
    expect(run.stdout).toContain("inline-script-sources=0");
  });

  it("does not confuse data-src with the real src attribute", () => {
    const run = runGuard(
      baselineHtml('<script data-src="/assets/index.js">window.__boot=1</script>'),
    );
    expect(run.status).toBe(0);
    expect(run.stdout).toContain("executable-inline-scripts=1");
  });

  it("rejects inline event handlers from parsed DOM attributes", () => {
    const run = runGuard(
      baselineHtml('<img src="/icon.png" onerror="window.__f()" alt="" />'),
    );
    expect(run.status).not.toBe(0);
    expect(run.stderr).toMatch(/inline event handler/);
  });

  it("uses parser-decoded entities before URL semantics", () => {
    for (const href of [
      "&#106;avascript:window.__boot()",
      "&#x6A;avascript:x()",
      "&#106avascript:x()",
      "jav&Tab;ascript:x()",
    ]) {
      const run = runGuard(baselineHtml(`<a href="${href}">start</a>`));
      expect(run.status, `guard accepted ${href}`).not.toBe(0);
      expect(run.stderr).toMatch(/javascript:/);
    }
  });

  it("does not invent named references that the HTML parser does not recognize", () => {
    // The legacy partial entity table had to special-case Object.prototype names.
    // A standards parser leaves these unknown references literal, so they are not
    // silently transformed into JavaScript schemes and need no handwritten table.
    for (const href of [
      "&constructor;javascript:alert(1)",
      "&toString;javascript:alert(1)",
      "&hasOwnProperty;javascript:x()",
      "&zzz;script:x()",
    ]) {
      const run = runGuard(baselineHtml(`<a href="${href}">start</a>`));
      expect(run.status, `standards parser misclassified ${href}`).toBe(0);
    }
  });

  it("accepts ordinary relative and absolute non-script URLs", () => {
    for (const href of [
      "/icon.svg",
      "https://example.org/x",
      "/pfad?a=1&b=2&zzz=3",
      "mailto:x@y.de?subject=A&body=B",
      "#abschnitt",
    ]) {
      const run = runGuard(baselineHtml(`<a href="${href}">start</a>`));
      expect(run.status, `guard rejected harmless ${href}`).toBe(0);
    }
  });

  it("does not treat non-URL CSS attribute text as an executable scheme", () => {
    const run = runGuard(
      baselineHtml('<div style="background:url(/x.png); color:red">x</div>'),
    );
    expect(run.status).toBe(0);
  });

  it("detects unterminated script elements using parser source locations", () => {
    const run = runGuard(`${baselineHtml()}<script>window.__boot=1`);
    expect(run.status).not.toBe(0);
    expect(run.stderr).toMatch(/unterminated <script>/);
  });

  it("classifies non-JavaScript script types as data blocks", () => {
    const run = runGuard(
      baselineHtml('<script type="application/json">{"not":"code"}</script>'),
    );
    expect(run.status).toBe(0);
    expect(run.stdout).toContain("executable-inline-scripts=0");
  });
});
