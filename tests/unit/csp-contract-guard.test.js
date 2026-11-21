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
//   N2  <script>window.__boot=1 OHNE </script> lief mit Exit 0 durch. Die Paar-Suche
//       des Waechters konnte das unpaarige Auf-Tag prinzipiell nicht sehen.
//       Nachgemessen in Chromium: der Rumpf wird NICHT ausgefuehrt -- der Befund
//       sagte etwas anderes --, aber alles danach verschwindet darin, im Versuch
//       samt #root. Die Ausgabe ist also kaputt, nur anders als behauptet.
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

  it("does not mistake a prototype property for a known character reference (N1, self-check)", () => {
    // Dieser Fall stammt aus keinem Review, sondern aus der Probe der eigenen
    // Fassung: die Tabelle war ein gewoehnliches Objekt, also lieferte
    // NAMED_REFERENCES["constructor"] eine FUNKTION statt undefined.
    // `&constructor;javascript:alert(1)` wurde damit zu
    // `function Object() { [native code] }javascript:alert(1)`, trug an Position 0
    // kein Schema mehr -- und galt als harmlos. Exit 0, in genau dem Waechter, der
    // gegen "unbekannt liest sich wie harmlos" gebaut wurde.
    for (const href of ["&constructor;javascript:alert(1)", "&toString;javascript:alert(1)", "&hasOwnProperty;javascript:x()"]) {
      const run = runGuard(baselineHtml(`<a href="${href}">start</a>`));
      expect(run.status, `guard accepted ${href}`).not.toBe(0);
    }
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
    // Der schwerste Befund der zweiten Runde. Kein Attribut, sondern ein RUMPF:
    // alles ab dem Auf-Tag bis EOF gehoert dazu und faellt aus dem Dokument.
    const run = runGuard(`${baselineHtml()}<script>window.__boot=1`);
    expect(run.status).not.toBe(0);
    expect(run.stderr).toMatch(/unterminated <script> in dist\/index\.html/);
  });

  it("rejects an unterminated inline script in the middle of the document (N2)", () => {
    // Die Stellung ist egal fuer den Waechter -- und sie ist der schlimmere Fall:
    // hier verschwindet das gesamte folgende Markup im Rumpf (in Chromium gemessen,
    // #root war weg). Wer nur das Dateiende prueft, hat den vorgefuehrten Fall
    // verstanden, nicht die Klasse.
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

  // RUNDE 3 (#168, 2026-09-12, vier Minuten NACH dem Merge). Der Befund trifft die
  // Bauform, nicht ein Muster: bis fe5e7b2 lag EINE Schema-Positivliste ueber allen
  // URI-Attributen, ohne Ruecksicht darauf, welche Direktive der Browser anwendet.
  // Das war in beide Richtungen falsch, und beides ist auf fe5e7b2 nachgemessen.
  it("rejects an external script origin that script-src does not allow (N1, round 3)", () => {
    // Der schwerste der vier: ein falsches OK auf main. Die Liste kennt `https`
    // als harmlos, also galt <script src="https://cdn.example/app.js"> als in
    // Ordnung -- unter `script-src 'self'` blockt der Browser genau das. Der
    // Waechter meldete Exit 0 fuer eine Ausgabe, die live nicht startet.
    const run = runGuard(baselineHtml('<script src="https://cdn.example/app.js"></script>'));
    expect(run.status).not.toBe(0);
    expect(run.stderr).toMatch(/blocked resource <script src="https:\/\/cdn\.example\/app\.js">/);
    expect(run.stderr).toMatch(/is not allowed by script-src 'self'/);
  });

  it("accepts a data: image because img-src permits it (N1 counter-direction)", () => {
    // Die andere Richtung desselben Befunds: `data:` stand auf der Sperrliste und
    // war damit ueberall ein Verstoss -- auch unter `img-src 'self' data:`, wo die
    // Richtlinie es ausdruecklich erlaubt. Ein Waechter, der Korrektes rot faerbt,
    // wird abgeschaltet; deshalb steht diese Zelle direkt neben der obigen.
    const run = runGuard(baselineHtml('<img src="data:image/png;base64,iVBORw0KGgo=" alt="" />'));
    expect(run.status, run.stderr).toBe(0);
    expect(run.stdout).toContain("blocked-resources=0");
  });

  it("still rejects the same data: image when img-src does not permit it", () => {
    // Die Gegenprobe zur Gegenprobe. Ohne sie waere die Zelle darueber auch dann
    // gruen, wenn `data:` jetzt ueberall durchginge -- die Lockerung muss an der
    // RICHTLINIE haengen, nicht am Schema.
    const strict = HEADERS_SELF_ONLY.replace("img-src 'self' data:;", "img-src 'self';");
    expect(strict, "the strict fixture did not change").not.toBe(HEADERS_SELF_ONLY);
    const run = runGuard(baselineHtml('<img src="data:image/png;base64,iVBORw0KGgo=" alt="" />'), strict);
    expect(run.status).not.toBe(0);
    expect(run.stderr).toMatch(/is not allowed by img-src 'self'/);
  });

  it("does not read a scheme-relative URL as a relative one (N1, self-check)", () => {
    // NICHT aus dem Review. Beim Umbau auf die Direktiven-Pruefung fiel auf, dass
    // `//cdn.example/x.png` vor dem ersten `/` kein Schema traegt und deshalb als
    // relative -- also gleich-origin -- URL galt. Sie zeigt aber auf eine fremde
    // Origin. Derselbe Fehler wie der Hauptbefund, nur ohne Schema; auf fe5e7b2
    // mit Exit 0 nachgestellt.
    const run = runGuard(baselineHtml('<img src="//cdn.example/x.png" alt="" />'));
    expect(run.status).not.toBe(0);
    expect(run.stderr).toMatch(/\(scheme-relative\)\/\/cdn\.example is not allowed by img-src/);
  });

  it("keeps judging <link href> by its rel, not by one list for all of them", () => {
    // Dasselbe Attribut, drei Direktiven: ein Icon faellt unter img-src, ein
    // Stylesheet unter style-src, ein Manifest unter manifest-src (und mangels
    // Eintrag unter default-src). Eine einzige Liste ueber alles kann das nicht.
    const ok = runGuard(baselineHtml('<link rel="icon" href="/icon.svg" />'));
    expect(ok.status, ok.stderr).toBe(0);
    const remote = runGuard(baselineHtml('<link rel="stylesheet" href="https://cdn.example/x.css" />'));
    expect(remote.status).not.toBe(0);
    expect(remote.stderr).toMatch(/is not allowed by style-src/);
  });

  // Der Hostname steht hier zusammengesetzt: woertlich darf er im Baum nur an den
  // beiden benannten Stellen vorkommen (scripts/verify-csp-contract.mjs und
  // tests/unit/csp-fonts.test.js), damit der stumpfe Quell-Waechter nicht an
  // einer Ausnahme vorbeisehen muss.
  const FONT_HOST = ["fonts", "gstatic", "com"].join(".");

  it("compares remote font hostnames case-insensitively (N3 round 3, N4)", () => {
    // DNS loest einen Hostnamen ohne Ruecksicht auf die Schreibweise auf --
    // `FONTS.GSTATIC.COM` und die kleine Form sind dieselbe Herkunft. Der
    // woertliche Vergleich meldete auf fe5e7b2 null Referenzen, und die
    // Schrift ging live an `font-src 'self'` kaputt: genau die Drift zwischen
    // Entwicklung und Produktion, gegen die dieser Punkt gebaut ist.
    const shouted = runGuard(baselineHtml(`<link rel="preconnect" href="https://${FONT_HOST.toUpperCase()}" />`));
    expect(shouted.status).not.toBe(0);
    expect(shouted.stderr).toMatch(/remote font origin/);
  });

  it("still finds the lower-case spelling and still passes without it (N4 controls)", () => {
    // Positiv-Kontrolle und Gegenrichtung in einer Zelle: die kleine Form MUSS
    // weiter rot sein (sonst misst die Zelle oben nichts), und eine Ausgabe ohne
    // fremde Schrift-Origin MUSS gruen bleiben (sonst faerbt der Waechter alles).
    const lower = runGuard(baselineHtml(`<link rel="preconnect" href="https://${FONT_HOST}" />`));
    expect(lower.status, "the lower-case control no longer reddens").not.toBe(0);
    const clean = runGuard(baselineHtml('<link rel="preconnect" href="https://example.org" />'));
    expect(clean.status, clean.stderr).toBe(0);
    expect(clean.stdout).toContain("remote-font-refs=0");
  });

  it("counts a style attribute as an inline style, not only a <style> block (N3)", () => {
    // Zweites falsches OK der Runde. Die Entscheidung ueber
    // `style-src 'unsafe-inline'` hing allein am <style>-BLOCK -- eine Ausgabe mit
    // `style="..."` und ohne Block galt als stilfrei, und der Waechter war gruen,
    // waehrend der Browser das Attribut blockt.
    const withoutBlock = baselineHtml('<div style="background:red">x</div>')
      .replace("    <style>:root{--ghx-font-sans:system-ui}</style>\n", "");
    expect(withoutBlock, "the fixture still carries a <style> block").not.toContain("<style>");
    const strict = HEADERS_SELF_ONLY.replace("style-src 'self' 'unsafe-inline';", "style-src 'self';");
    expect(strict, "the strict fixture did not change").not.toBe(HEADERS_SELF_ONLY);

    const run = runGuard(withoutBlock, strict);
    expect(run.status).not.toBe(0);
    expect(run.stderr).toMatch(/carries inline styles but style-src forbids them/);
    expect(run.stderr).toMatch(/style attributes: 1/);
  });

  it("keeps the style decision two-sided after counting attributes (N3 counter-direction)", () => {
    // Punkt 4 ist bewusst beidseitig: die Erlaubnis muss auch WEGFALLEN, wenn
    // nichts mehr sie braucht. Sonst haette das Mitzaehlen der Attribute die
    // Richtlinie stillschweigend nach oben verriegelt.
    const withoutAnyInlineStyle = baselineHtml()
      .replace("    <style>:root{--ghx-font-sans:system-ui}</style>\n", "");
    expect(withoutAnyInlineStyle).not.toContain("<style>");
    expect(withoutAnyInlineStyle).not.toContain("style=");
    const stale = runGuard(withoutAnyInlineStyle);
    expect(stale.status, "the unused 'unsafe-inline' is no longer reported").not.toBe(0);
    expect(stale.stderr).toMatch(/neither an inline <style> block nor a style attribute/);

    // Und mit der Erlaubnis bleibt das style-Attribut gruen -- sonst waere die
    // Verschaerfung ein Fehlalarm auf der heutigen, bewusst offenen Richtlinie.
    const permitted = runGuard(
      baselineHtml('<div style="background:red">x</div>').replace("    <style>:root{--ghx-font-sans:system-ui}</style>\n", ""),
    );
    expect(permitted.status, permitted.stderr).toBe(0);
    expect(permitted.stdout).toContain("inline-style-attributes=1");
  });

  it("checks every URL of a list attribute, not only the first (N1, self-check)", () => {
    // NICHT aus dem Review, sondern aus der Probe der eigenen Haertung: die
    // Direktiven-Tabelle ordnete `img:srcset` zu, und `srcset` stand gar nicht in
    // URI_ATTRIBUTES -- die Zuordnung las sich wie Deckung und war keine. Alle
    // drei Faelle liefen auf der ersten Fassung dieser Runde mit Exit 0 durch.
    const zweiter = runGuard(baselineHtml('<img src="/icon-192.png" srcset="/icon-192.png 1x, https://cdn.example/b.png 2x" alt="" />'));
    expect(zweiter.status, "the second srcset entry is still unchecked").not.toBe(0);
    expect(zweiter.stderr).toMatch(/is not allowed by img-src/);

    const einzeln = runGuard(baselineHtml('<img srcset="https://cdn.example/b.png 2x" alt="" />'));
    expect(einzeln.status).not.toBe(0);

    // ping ist Leerzeichen-getrennt und faellt unter connect-src.
    const beacon = runGuard(baselineHtml('<a href="/x" ping="/beacon https://cdn.example/beacon">x</a>'));
    expect(beacon.status, "the second ping URL is still unchecked").not.toBe(0);
  });

  it("leaves a well-formed list attribute alone (self-check counter-direction)", () => {
    // Sonst waere die Zelle darueber mit einem Waechter gruen, der jedes
    // srcset rot faerbt -- und der waere nach einer Woche abgeschaltet.
    const run = runGuard(baselineHtml('<img src="/icon-192.png" srcset="/icon-192.png 1x, /icon-384.png 2x" alt="" />'));
    expect(run.status, run.stderr).toBe(0);
    expect(run.stdout).toContain("blocked-resources=0");
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
