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

function framesetHtml(frameMarkup) {
  return [
    "<!doctype html>",
    '<html lang="de">',
    "  <head><meta charset=\"UTF-8\" /></head>",
    `  <frameset>${frameMarkup}</frameset>`,
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

describe("standards-based CSP DOM structure contract (#176)", () => {
  it("stays green on the shipped output shape", () => {
    const run = runGuard(baselineHtml());
    expect(run.status).toBe(0);
    expect(run.stdout).toContain("script-elements=1");
    expect(run.stdout).toContain("executable-inline-scripts=0");
    expect(run.stdout).toContain("inline-script-sources=0");
    expect(run.stdout).toContain("CSP DOM structure OK:");
    expect(run.stdout).toContain("authorization remains the responsibility of the CSP policy layer");
  });

  it("does not confuse data-src with the real src attribute", () => {
    const run = runGuard(
      baselineHtml('<script data-src="/assets/index.js">window.__boot=1</script>'),
    );
    expect(run.status).toBe(0);
    expect(run.stdout).toContain("executable-inline-scripts=1");
    expect(run.stdout).toContain("authorization remains the responsibility of the CSP policy layer");
  });

  it("rejects inline event handlers from parsed attributes", () => {
    const run = runGuard(
      baselineHtml('<img src="/icon.png" onerror="window.__f()" alt="" />'),
    );
    expect(run.status).not.toBe(0);
    expect(run.stderr).toMatch(/inline event handler/);
  });

  it("uses parser-decoded entities before javascript navigation semantics", () => {
    for (const href of [
      "&#106;avascript:window.__boot()",
      "&#x6A;avascript:x()",
      "&#106avascript:x()",
      "jav&Tab;ascript:x()",
    ]) {
      const run = runGuard(baselineHtml(`<a href="${href}">start</a>`));
      expect(run.status, `guard accepted ${href}`).not.toBe(0);
      expect(run.stderr).toMatch(/javascript: navigation target/);
    }
  });

  it("does not invent named references the HTML parser does not recognize", () => {
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

  it("accepts ordinary relative and absolute non-script navigation URLs", () => {
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

  it("rejects javascript URLs only in navigation-capable element contexts", () => {
    for (const markup of [
      '<a href="javascript:alert(1)">x</a>',
      '<area href="javascript:alert(1)" />',
      '<form action="javascript:alert(1)"><button>go</button></form>',
      '<iframe src="javascript:alert(1)"></iframe>',
      '<button formaction="javascript:alert(1)">go</button>',
      '<svg><a href="javascript:alert(1)"><text>x</text></a></svg>',
    ]) {
      const run = runGuard(baselineHtml(markup));
      expect(run.status, `guard accepted navigation sink ${markup}`).not.toBe(0);
    }

    for (const markup of [
      '<img src="javascript:alert(1)" alt="" />',
      '<link href="javascript:alert(1)" rel="stylesheet" />',
      '<script src="javascript:alert(1)"></script>',
    ]) {
      const run = runGuard(baselineHtml(markup));
      expect(run.status, `guard rejected non-navigation resource ${markup}`).toBe(0);
    }
  });

  it("rejects javascript navigation from legacy frame elements", () => {
    const run = runGuard(framesetHtml('<frame src="javascript:alert(1)">'));
    expect(run.status).not.toBe(0);
    expect(run.stderr).toMatch(/<frame src=\.\.\.> is a javascript: navigation target/);
  });

  it("traverses template contents", () => {
    const run = runGuard(
      baselineHtml('<template><img src="/x.png" onerror="boot()" alt="" /></template>'),
    );
    expect(run.status).not.toBe(0);
    expect(run.stderr).toMatch(/<template>.*inline event handler/);
  });

  it("recursively parses iframe srcdoc documents", () => {
    const run = runGuard(
      baselineHtml(
        '<iframe srcdoc="&lt;img src=&quot;/x.png&quot; onerror=&quot;boot()&quot; alt=&quot;&quot;&gt;"></iframe>',
      ),
    );
    expect(run.status).not.toBe(0);
    expect(run.stderr).toMatch(/iframe\[srcdoc\].*inline event handler/);
    expect(run.stdout).toContain("srcdoc-documents=1");
  });

  it("rejects executable inline scripts in entity-decoded srcdoc documents", () => {
    const run = runGuard(
      baselineHtml(
        '<iframe srcdoc="&lt;script&gt;window.__boot=1&lt;/script&gt;"></iframe>',
      ),
    );
    expect(run.status).not.toBe(0);
    expect(run.stdout).toContain("srcdoc-documents=1");
    expect(run.stdout).toContain("executable-inline-scripts=1");
    expect(run.stderr).toMatch(/iframe\[srcdoc\].*not authorized by the deployed script-src 'self'/);
  });

  it("enforces inherited script-src self for external scripts in srcdoc", () => {
    const blocked = runGuard(
      baselineHtml(
        '<iframe srcdoc="&lt;script src=&quot;https://cdn.example/boot.js&quot;&gt;&lt;/script&gt;"></iframe>',
      ),
    );
    expect(blocked.status).not.toBe(0);
    expect(blocked.stdout).toContain("srcdoc-documents=1");
    expect(blocked.stderr).toMatch(/iframe\[srcdoc\].*inherited script-src 'self'/);

    const allowed = runGuard(
      baselineHtml(
        '<iframe srcdoc="&lt;script src=&quot;/assets/boot.js&quot;&gt;&lt;/script&gt;"></iframe>',
      ),
    );
    expect(allowed.status).toBe(0);
    expect(allowed.stdout).toContain("srcdoc-documents=1");
  });


  it("fails closed on excessive srcdoc nesting", () => {
    let nested = '<img src="/x.png" alt="" />';
    for (let i = 0; i < 10; i += 1) {
      const escaped = nested
        .replaceAll("&", "&amp;")
        .replaceAll('"', "&quot;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;");
      nested = `<iframe srcdoc="${escaped}"></iframe>`;
    }
    const run = runGuard(baselineHtml(nested));
    expect(run.status).not.toBe(0);
    expect(run.stderr).toMatch(/srcdoc depth exceeds/);
  });

  it("detects unterminated HTML script elements using parser source locations", () => {
    const run = runGuard(`${baselineHtml()}<script>window.__boot=1`);
    expect(run.status).not.toBe(0);
    expect(run.stderr).toMatch(/unterminated HTML <script>/);
  });

  it("accepts self-closed SVG script elements as terminated foreign content", () => {
    const run = runGuard(baselineHtml("<svg><script /></svg>"));
    expect(run.status).toBe(0);
    expect(run.stdout).toContain("unterminated-scripts=0");
  });

  it("does not mistake a slash inside an unquoted SVG-script attribute for self-closing syntax", () => {
    const run = runGuard(
      baselineHtml(
        '<iframe srcdoc="&lt;svg&gt;&lt;script type=&quot;application/json&quot; data=x/&gt;payload"></iframe>',
      ),
    );
    expect(run.status).not.toBe(0);
    expect(run.stdout).toContain("srcdoc-documents=1");
    expect(run.stderr).toMatch(/unterminated SVG <script>/);
  });

  it("rejects genuinely unterminated SVG script elements", () => {
    const run = runGuard(`${baselineHtml()}<svg><script>window.__boot=1`);
    expect(run.status).not.toBe(0);
    expect(run.stderr).toMatch(/unterminated SVG <script>/);
  });

  it("classifies every JavaScript MIME essence as executable inline script content", () => {
    for (const type of [
      "application/ecmascript",
      "application/javascript",
      "application/x-ecmascript",
      "application/x-javascript",
      "text/ecmascript",
      "text/javascript",
      "text/javascript1.0",
      "text/javascript1.1",
      "text/javascript1.2",
      "text/javascript1.3",
      "text/javascript1.4",
      "text/javascript1.5",
      "text/jscript",
      "text/livescript",
      "text/x-ecmascript",
      "text/x-javascript",
    ]) {
      const run = runGuard(baselineHtml(`<script type="${type}">window.__boot=1</script>`));
      expect(run.status, `guard rejected valid structure for ${type}`).toBe(0);
      expect(run.stdout, `guard failed to classify ${type}`).toContain(
        "executable-inline-scripts=1",
      );
    }
  });

  it("implements the legacy language fallback only when type is absent", () => {
    const classic = runGuard(
      baselineHtml('<script language="JavaScript1.5">window.__boot=1</script>'),
    );
    expect(classic.status).toBe(0);
    expect(classic.stdout).toContain("executable-inline-scripts=1");

    const dataBlock = runGuard(
      baselineHtml('<script language="python">print("not browser JS")</script>'),
    );
    expect(dataBlock.status).toBe(0);
    expect(dataBlock.stdout).toContain("executable-inline-scripts=0");

    const typeWins = runGuard(
      baselineHtml(
        '<script type="application/json" language="JavaScript">{"not":"code"}</script>',
      ),
    );
    expect(typeWins.status).toBe(0);
    expect(typeWins.stdout).toContain("executable-inline-scripts=0");
  });

  it("classifies non-JavaScript script types as data blocks", () => {
    const run = runGuard(
      baselineHtml('<script type="application/json">{"not":"code"}</script>'),
    );
    expect(run.status).toBe(0);
    expect(run.stdout).toContain("executable-inline-scripts=0");
  });
});
