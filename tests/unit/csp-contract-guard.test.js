// Waechter-Pruefung fuer den Waechter (Review #168, Befunde T2 und T4).
//
// scripts/verify-csp-contract.mjs behauptet fail-closed zu sein. Zwei externe
// Review-Befunde zeigten, dass er an zwei Stellen offen war, und beide Luecken
// hatten dieselbe Form: der Waechter war GRUEN gegen eine Ausgabe, die der Browser
// live blockiert haette.
//
//   T2  <script data-src="..."> mit Rumpf galt als EXTERNES Skript, weil die alte
//       Pruefung /\bsrc\s*=/ auch das "src" hinter dem Bindestrich traf.
//   T4  <img onerror="..."> ohne jedes Inline-<script> lief komplett an der
//       Pruefung vorbei, obwohl script-src auch auf Handler-Attribute wirkt.
//
// Die dritte Zelle stammt NICHT aus dem Review, sondern aus der Gegenprobe am
// eigenen Ergebnis: die Haertung gegen T4 war gruen und liess `javascript:`-URIs
// weiter durch -- dieselbe Klasse, eine Ebene hoeher.
//
// Geprueft wird hier der Waechter so, WIE ER LAEUFT -- als Prozess, mit echtem
// Exit-Code -- und nicht eine herausgeloeste Hilfsfunktion. Das Skript loest sein
// dist/ ueber die EIGENE Position auf (`resolve(here, "..")`), also genuegt eine
// Mini-Kopie des Baums im Temp-Verzeichnis; die echte dist/ bleibt unberuehrt.
//
// Die erste Zelle ist die Gegenprobe zu allen anderen: ein Waechter, der jede
// Ausgabe rot faerbt, ist so wertlos wie einer, der alles durchlaesst.
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../..");
const guard = resolve(root, "scripts/verify-csp-contract.mjs");

const HEADERS_SELF_ONLY = [
  "/*",
  "  Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data:;",
  "",
].join("\n");

// Die Form der echten Ausgabe: genau ein externes Modul-Skript, ein Inline-<style>,
// sonst gewoehnliches Markup.
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

// Legt einen Mini-Baum <tmp>/{scripts,dist} an und laesst den Waechter darin laufen.
function runGuard(html, headers = HEADERS_SELF_ONLY) {
  const base = mkdtempSync(join(tmpdir(), "ghx-csp-guard-"));
  mkdirSync(join(base, "scripts"));
  mkdirSync(join(base, "dist"));
  copyFileSync(guard, join(base, "scripts/verify-csp-contract.mjs"));
  writeFileSync(join(base, "dist/index.html"), html, "utf8");
  writeFileSync(join(base, "dist/_headers"), headers, "utf8");
  const run = spawnSync(process.execPath, [join(base, "scripts/verify-csp-contract.mjs")], {
    encoding: "utf8",
  });
  return { status: run.status, stdout: run.stdout ?? "", stderr: run.stderr ?? "" };
}

describe("CSP output guard (#168 review)", () => {
  it("stays green on the shipped output shape, so its red verdicts mean something", () => {
    const run = runGuard(baselineHtml());
    expect(run.stderr, "guard rejected the unmodified output shape").not.toMatch(/FAIL/);
    expect(run.status).toBe(0);
    expect(run.stdout).toContain("executable-inline-scripts=0");
    expect(run.stdout).toContain("inline-script-sources=0");
  });

  it("rejects an inline bootstrap whose only src-like attribute is data-src (T2)", () => {
    const run = runGuard(
      baselineHtml('<script data-src="/assets/index-abc123.js">window.__boot=1</script>'),
    );
    expect(run.status).not.toBe(0);
    expect(run.stderr).toMatch(/executable inline script\(s\) but script-src forbids them/);
  });

  it("rejects an inline event handler even with no inline script body at all (T4)", () => {
    const run = runGuard(baselineHtml('<img src="/icon-192.png" onerror="window.__f()" alt="" />'));
    expect(run.status).not.toBe(0);
    expect(run.stderr).toMatch(/inline script source <img onerror=\.\.\.>/);
  });

  it("rejects a javascript: URI, the third thing script-src governs", () => {
    // NICHT aus dem Review. Der Befund T4 nannte die Handler-Attribute; die
    // Haertung dagegen war gruen und liess `javascript:` weiter durch -- ein
    // Waechter gegen "behauptet fail-closed, ist offen", der genau diese Klasse
    // enthielt. Reproduziert gegen den bereits geharteten Stand: exit 0, "OK".
    const run = runGuard(baselineHtml('<a href="javascript:window.__boot()">start</a>'));
    expect(run.status).not.toBe(0);
    expect(run.stderr).toMatch(/inline script source <a href="javascript:\.\.\.">/);
  });

  it("still classifies a genuine external src attribute as external", () => {
    // Gegenprobe zu T2: die Verschaerfung darf nicht jedes <script> mit Rumpf-losem
    // src-Attribut einsammeln, sonst waere script-src 'self' nie mehr erreichbar.
    const run = runGuard(baselineHtml('<script src="/assets/late.js"></script>'));
    expect(run.status).toBe(0);
    expect(run.stdout).toContain("executable-inline-scripts=0");
  });

  it("reports how many tags it scanned, so an empty result cannot pass as absence", () => {
    // Ohne diese Zahl waere "null Handler" auch dann gruen, wenn der Tag-Zerleger
    // gar nichts mehr faende -- genau die Klasse, gegen die dieser Waechter baut.
    const run = runGuard(baselineHtml());
    const scanned = run.stdout.match(/markup-tags=(\d+)/);
    expect(scanned, "guard does not report its markup-tag count").not.toBeNull();
    expect(Number(scanned[1])).toBeGreaterThan(5);
  });
});
