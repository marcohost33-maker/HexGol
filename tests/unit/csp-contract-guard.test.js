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
// RUNDE 2 (#168, 2026-09-12) brachte dieselbe Klasse ein drittes und viertes Mal:
//
//   N2  <script>window.__boot=1 OHNE </script> lief mit Exit 0 durch. Der Parser
//       nimmt den Rest der Datei als Rumpf und fuehrt ihn aus; die Paar-Suche des
//       Waechters konnte das unpaarige Auf-Tag prinzipiell nicht sehen.
//   N1  href="&#106;avascript:..." lief mit Exit 0 durch. Der Parser dekodiert die
//       Zeichenreferenz VOR der Navigation, der Waechter verglich den Rohtext.
//
// Beide Male war nicht das Muster zu eng, sondern die Bauform falsch. Deshalb
// pruefen die Zellen unten nicht Varianten derselben Schreibweise, sondern die
// beiden Stellen, an denen der Waechter dem Parser folgen muss.
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
    // Runde 2: der Script-Zerleger muss JEDES `<script` verbucht haben. Steht hier
    // 0/1 oder 1/2, hat er weggesehen -- und "null Inline-Scripts" waere dann keine
    // Aussage ueber die Ausgabe, sondern eine ueber den kaputten Zerleger.
    expect(run.stdout).toContain("script-elements=1/1");
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
    expect(run.stderr).toMatch(/inline script source <a href=\.\.\.> resolves to scheme "javascript:"/);
  });

  it("decodes character references before reading the scheme (N1)", () => {
    // Der Parser loest die Referenz auf, BEVOR er navigiert. Wer den Rohwert
    // vergleicht, liest `&#106;avascript:` als harmlosen relativen Pfad.
    const run = runGuard(baselineHtml('<a href="&#106;avascript:window.__boot()">start</a>'));
    expect(run.status).not.toBe(0);
    expect(run.stderr).toMatch(/resolves to scheme "javascript:"/);
  });

  it("decodes hexadecimal and semicolon-less references too (N1)", () => {
    // Drei Schreibweisen derselben Sache. Waere hier nur die dezimale Form mit
    // Semikolon geprueft, haette der Waechter das Muster gelernt und nicht die
    // Klasse -- und die naechste Schreibweise liefe wieder durch.
    for (const href of ["&#x6A;avascript:x()", "&#106avascript:x()", "jav&Tab;ascript:x()"]) {
      const run = runGuard(baselineHtml(`<a href="${href}">start</a>`));
      expect(run.status, `guard accepted ${href}`).not.toBe(0);
      expect(run.stderr).toMatch(/resolves to scheme "javascript:"/);
    }
  });

  it("treats an unresolvable character reference before the path as undecided (N1)", () => {
    // Die Tabelle der benannten Referenzen ist endlich. Was sie nicht kennt und
    // an einer Stelle steht, an der es noch ein Schema bilden koennte, ist
    // unentscheidbar -- und unentscheidbar zaehlt hier als Verstoss.
    const run = runGuard(baselineHtml('<a href="&zzz;script:x()">start</a>'));
    expect(run.status).not.toBe(0);
    expect(run.stderr).toMatch(/character reference this guard cannot resolve/);
  });

  it("accepts relative, https, mailto and query URLs unchanged (N1 counter-direction)", () => {
    // Ein Waechter, der alles rot faerbt, ist so wertlos wie einer, der alles
    // durchlaesst -- und bei einer fail-closed-Bauform ist das die reale Gefahr.
    // Besonders `?a=1&b=2`: dort steht ein `&`, das KEINE Referenz ist.
    for (const href of ["/icon.svg", "https://example.org/x", "/pfad?a=1&b=2&zzz=3", "mailto:x@y.de?subject=A&body=B", "#abschnitt"]) {
      const run = runGuard(baselineHtml(`<a href="${href}">start</a>`));
      expect(run.status, `guard rejected the harmless ${href}`).toBe(0);
    }
  });

  it("does not read a CSS property as a URI scheme (N1 counter-direction)", () => {
    // `style="background:url(...)"` passt auf das Schema-Muster. Die strenge
    // Einstufung gilt deshalb nur fuer Attribute, deren Wert der Browser als URL
    // aufloest -- sonst waere jedes Stil-Attribut ein Fehlalarm.
    const run = runGuard(baselineHtml('<div style="background:url(/x.png); color:red">x</div>'));
    expect(run.status).toBe(0);
  });

  it("still classifies a genuine external src attribute as external", () => {
    // Gegenprobe zu T2: die Verschaerfung darf nicht jedes <script> mit Rumpf-losem
    // src-Attribut einsammeln, sonst waere script-src 'self' nie mehr erreichbar.
    const run = runGuard(baselineHtml('<script src="/assets/late.js"></script>'));
    expect(run.status).toBe(0);
    expect(run.stdout).toContain("executable-inline-scripts=0");
  });

  it("rejects an unterminated inline script at the end of the file (N2)", () => {
    // Der schwerste Befund der zweiten Runde. Kein Attribut, sondern ein
    // ausfuehrbarer RUMPF: alles ab dem Auf-Tag bis EOF laeuft im Browser.
    const run = runGuard(`${baselineHtml()}<script>window.__boot=1`);
    expect(run.status).not.toBe(0);
    expect(run.stderr).toMatch(/unterminated <script> in dist\/index\.html/);
  });

  it("rejects an unterminated inline script in the middle of the document (N2)", () => {
    // Die Stellung ist egal -- wer nur das Dateiende prueft, hat die Klasse nicht
    // verstanden, sondern nur den vorgefuehrten Fall.
    const run = runGuard(baselineHtml("<script>window.__boot=1"));
    expect(run.status).not.toBe(0);
    expect(run.stderr).toMatch(/unterminated <script> in dist\/index\.html/);
  });

  it("treats a half-written opening script tag as undecided, not as absent (N2)", () => {
    // `<script src=x` ohne schliessende spitze Klammer passt auf kein Auf-Tag-Muster.
    // Genau dann darf der Waechter nicht schweigen: was er nicht eindeutig als
    // Element erkennt, ist ein Verstoss und keine Abwesenheit.
    const run = runGuard(`${baselineHtml()}<script src=x`);
    expect(run.status).not.toBe(0);
    expect(run.stderr).toMatch(/script scan accounted for 1 of 2 "<script" occurrences/);
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
