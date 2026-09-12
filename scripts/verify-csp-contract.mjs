// Ausgabe-Waechter fuer den CSP-Vertrag (Issue #163).
//
// WOZU
// ----
// Die Produktions-CSP steht in `public/_headers` und wird als `dist/_headers`
// ausgeliefert. Ob sie zu dem passt, was die App TATSAECHLICH braucht, stand bis
// 2026-09-12 nur als Kommentar darin -- eine Behauptung ueber ein Artefakt, das
// niemand las. Zwei Fehlerrichtungen sind dabei moeglich, und beide bleiben ohne
// Waechter still:
//
//   * Die Richtlinie ist ZU ENG fuer die Ausgabe -- die App bricht live, waehrend
//     lokal (ohne Header-Server) alles laeuft.
//   * Die Richtlinie ist ZU WEIT fuer die Ausgabe -- nichts bricht, niemand merkt
//     es, und eine Erlaubnis wie `script-src 'unsafe-inline'` bleibt stehen, lange
//     nachdem der Grund dafuer weg ist. Genau dieser Fall lag hier vor: der
//     Kommentar behauptete, Vite lege den Bootstrap inline; das erzeugte
//     dist/index.html enthielt aber nur ein externes <script src=...>.
//
// Dieser Waechter laeuft als Teil von `npm run build` (und damit im CI-Schritt
// "Build production bundle"). Er prueft das ERZEUGTE Buendel, nicht die Quelle,
// und schlaegt fail-closed fehl: im Zweifel roter Build statt stiller Drift.
//
// GEPRUEFT WIRD
// -------------
//   1. Null Referenzen auf fremde Schrift-Origins in irgendeiner Textdatei in dist/.
//   2. dist/index.html enthaelt kein ausfuehrbares Inline-<script>.
//   3. Die CSP in dist/_headers passt zu 1. und 2.:
//        - font-src bleibt ausschliesslich 'self'
//        - script-src traegt 'unsafe-inline' GENAU DANN, wenn die Ausgabe ein
//          ausfuehrbares Inline-<script> enthaelt
//        - style-src traegt 'unsafe-inline' GENAU DANN, wenn die Ausgabe einen
//          Inline-<style>-Block enthaelt (heute: ja -- #163 Punkt 7 laesst die
//          Stil-Migration ausdruecklich aus diesem Schritt heraus)
//
// Punkt 3 ist bewusst in BEIDE Richtungen formuliert. Ein Waechter, der nur "zu
// eng" faengt, haette den Ist-Befund aus #163 nicht gefunden.
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { resolve, relative, dirname, extname, sep } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const dist = resolve(root, "dist");

// Fremde Schrift-Origins. Wortwoertliche Suche, keine Heuristik: ein Waechter, der
// clever ist, laesst sich austricksen, und dieser hier soll stumpf und unbestechlich
// sein. Deshalb stehen diese Hostnamen im ganzen Produktionscode NUR an dieser einen
// Stelle und in tests/unit/csp-fonts.test.js -- nicht einmal in einem Kommentar.
const REMOTE_FONT_HOSTS = Object.freeze(["fonts.googleapis.com", "fonts.gstatic.com"]);

// Binaerformate tragen keinen Quelltext; sie zu dekodieren erzeugt nur Rauschen.
// Alles Uebrige wird als Text gelesen -- unbekannte Endungen eingeschlossen, damit
// eine neue Dateiart nicht still aus der Pruefung faellt.
const BINARY_EXTENSIONS = Object.freeze([".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".woff", ".woff2", ".ttf", ".otf", ".eot", ".mp4", ".webm"]);

// Inline-<script>-Typen, die der Browser als Skript behandelt und die deshalb unter
// script-src fallen. `importmap` und `speculationrules` sind kein JavaScript, werden
// aber ebenfalls von script-src kontrolliert -- sie gehoeren also in diese Liste.
const EXECUTABLE_SCRIPT_TYPES = Object.freeze([
  "", "module", "text/javascript", "application/javascript", "text/ecmascript",
  "application/ecmascript", "importmap", "speculationrules",
]);

const failures = [];
function fail(message) {
  failures.push(message);
}

function walkFiles(dir) {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const name of readdirSync(dir)) {
    const path = resolve(dir, name);
    if (statSync(path).isDirectory()) out.push(...walkFiles(path));
    else out.push(path);
  }
  return out;
}

function readRequired(path) {
  if (!existsSync(path)) {
    fail(`missing build output: ${relative(root, path)}`);
    return null;
  }
  return readFileSync(path, "utf8");
}

// --- 1. Keine fremden Schrift-Origins in der Ausgabe -------------------------
const distFiles = walkFiles(dist);
if (distFiles.length === 0) fail("dist/ is empty or missing -- run `vite build` first");

let scannedTextFiles = 0;
for (const path of distFiles) {
  if (BINARY_EXTENSIONS.includes(extname(path).toLowerCase())) continue;
  const bytes = readFileSync(path);
  if (bytes.includes(0)) continue; // Binaerdatei ohne bekannte Endung (Git-Heuristik)
  const text = bytes.toString("utf8");
  scannedTextFiles += 1;
  for (const host of REMOTE_FONT_HOSTS) {
    if (text.includes(host)) {
      const line = text.split("\n").findIndex((l) => l.includes(host)) + 1;
      fail(`remote font origin "${host}" in build output: ${relative(root, path).split(sep).join("/")}:${line}`);
    }
  }
}

// --- 2. Ausfuehrbares Inline-<script> in dist/index.html? --------------------
const html = readRequired(resolve(dist, "index.html")) ?? "";

// Nicht-gieriger Abgleich ueber das oeffnende Tag und den Rumpf. Ein </script> im
// Rumpf kann es nicht geben -- der Parser beendet dort das Element, also ist die
// erste schliessende Marke immer die richtige.
const inlineScripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)]
  .map(([, attrs, body]) => ({ attrs, body }))
  .filter(({ attrs }) => !/\bsrc\s*=/i.test(attrs))   // externes Skript: faellt nicht unter 'unsafe-inline'
  .filter(({ body }) => body.trim().length > 0);       // leerer Rumpf fuehrt nichts aus

const executableInline = [];
for (const { attrs, body } of inlineScripts) {
  const typeMatch = attrs.match(/\btype\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/i);
  const type = (typeMatch ? (typeMatch[2] ?? typeMatch[3] ?? typeMatch[4]) : "").trim().toLowerCase();
  if (EXECUTABLE_SCRIPT_TYPES.includes(type)) {
    executableInline.push({ type: type || "(none)", preview: body.trim().slice(0, 80) });
  } else {
    // Fail-closed: ein unbekannter Typ koennte ausfuehrbar sein. Lieber ein roter
    // Build und eine bewusste Entscheidung als eine stille Annahme.
    fail(`inline <script type="${type}"> of unknown kind in dist/index.html -- classify it by hand before shipping`);
  }
}
const needsScriptUnsafeInline = executableInline.length > 0;
const hasInlineStyleBlock = /<style\b[^>]*>[\s\S]*?\S[\s\S]*?<\/style\s*>/i.test(html);

// --- 3. Passt die ausgelieferte CSP zur Ausgabe? -----------------------------
const headers = readRequired(resolve(dist, "_headers")) ?? "";
const cspLine = headers.split("\n").map((l) => l.trim()).find((l) => l.toLowerCase().startsWith("content-security-policy:"));
if (!cspLine) fail("dist/_headers carries no Content-Security-Policy line");

function directive(name) {
  if (!cspLine) return null;
  const policy = cspLine.slice(cspLine.indexOf(":") + 1);
  for (const part of policy.split(";")) {
    const tokens = part.trim().split(/\s+/).filter(Boolean);
    if (tokens.length && tokens[0].toLowerCase() === name) return tokens.slice(1);
  }
  return null;
}

const fontSrc = directive("font-src");
if (!fontSrc) fail("CSP has no font-src directive -- it must stay explicitly self-only");
else if (fontSrc.join(" ") !== "'self'") fail(`font-src must stay exactly 'self', found: ${fontSrc.join(" ")}`);

const scriptSrc = directive("script-src");
if (!scriptSrc) {
  fail("CSP has no script-src directive");
} else {
  const allowsInline = scriptSrc.includes("'unsafe-inline'");
  if (needsScriptUnsafeInline && !allowsInline) {
    fail(`dist/index.html contains ${executableInline.length} executable inline script(s) but script-src forbids them -- the app would break live`);
  }
  if (!needsScriptUnsafeInline && allowsInline) {
    fail("script-src allows 'unsafe-inline' but dist/index.html has no executable inline script -- drop the permission instead of carrying it");
  }
}

const styleSrc = directive("style-src");
if (!styleSrc) {
  fail("CSP has no style-src directive");
} else {
  const allowsInline = styleSrc.includes("'unsafe-inline'");
  // #163 Punkt 7: die Stil-Migration ist ausdruecklich NICHT Teil dieses Schritts.
  // React setzt style-Attribute und index.html traegt einen Inline-<style>-Block --
  // solange das so ist, ist 'unsafe-inline' hier kein Rueckstand, sondern noetig.
  if (hasInlineStyleBlock && !allowsInline) {
    fail("dist/index.html has an inline <style> block but style-src forbids inline styles");
  }
  if (!hasInlineStyleBlock && allowsInline) {
    fail("style-src allows 'unsafe-inline' but dist/index.html has no inline <style> block -- re-check whether React still needs it, then drop it");
  }
}

if (failures.length > 0) {
  for (const message of failures) console.error(`[csp-contract] FAIL: ${message}`);
  process.exit(1);
}

console.log(
  `[csp-contract] OK text-files=${scannedTextFiles} remote-font-refs=0 ` +
  `executable-inline-scripts=${executableInline.length} inline-style-block=${hasInlineStyleBlock} ` +
  `script-src-unsafe-inline=${(directive("script-src") ?? []).includes("'unsafe-inline'")}`,
);
