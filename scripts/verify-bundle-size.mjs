// Ausgabe-Waechter fuer die Buendelgroesse (Marco-Entscheid 2026-11-02).
//
// WOZU
// ----
// README.md und AGENTS.md §3 nennen die Buendelgroesse eine "tracked property",
// aber bis 2026-11-02 pruefte sie niemand. Gemessen auf #198 (2026-10-07): React
// 19.2.8 -> 19.3.0 liess `index-*.js` von 379.22 kB auf 408.51 kB wachsen
// (+7.4 %, gzip +8.75 kB) -- gefunden in einem Selbst-Review, nicht von der CI.
// Wenig spaeter kam derselbe Sprung als Dependabot-PR (#192) auf `main`, ohne
// dass irgendein Check anschlug.
//
// Dieser Waechter laeuft als Teil von `npm run build` (und damit im CI-Schritt
// "Build production bundle" des Pflicht-Checks `unit`). Er misst das ERZEUGTE
// Haupt-Buendel `dist/assets/index-*.js` roh und gzip und vergleicht beides mit
// dem eingecheckten Grenzwert in `bundle-budget.json`.
//
// REGEL
// -----
//   grenze = baseline * (1 + toleranz_prozent / 100)      (je Messgroesse)
//   gruen  genau dann, wenn  roh <= grenze_roh  UND  gzip <= grenze_gzip
//
// Fail-closed: fehlt die Budgetdatei, ist ein Wert keine endliche positive Zahl,
// gibt es nicht GENAU EIN `index-*.js`, oder ergibt ein Vergleich NaN -- rot.
// Der Annahme-Zweig haengt an einem WAHREN Vergleich (`roh <= grenze`), nicht an
// einem falschen `roh > grenze`; so faellt NaN nicht still durch.
//
// gzip wird mit Node `zlib.gzipSync` in der Voreinstellung gemessen. Die Zahl ist
// NICHT dieselbe wie die "gzip:"-Spalte in Vites Build-Ausgabe (gemessen
// 2026-11-02 auf demselben Buendel: hier 125426 B, Vite zeigte 126.48 kB). Massgeblich
// fuer den Waechter ist allein diese Messung; Baseline und Messung stammen aus
// demselben Verfahren.
//
// WENN ER ROT WIRD
// ----------------
// Entweder ist der Zuwachs ungewollt (dann die Ursache finden), oder er ist eine
// bewusste Produktentscheidung: dann `bundle-budget.json` im SELBEN PR neu setzen
// (`node scripts/verify-bundle-size.mjs --print` gibt die gemessenen Werte aus) und
// den Grund in `reason` sowie im PR-Text nennen. Ein stilles Anheben ist genau die
// Drift, gegen die der Waechter gebaut ist.
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const assetsDir = join(root, "dist", "assets");
const budgetPath = join(root, "bundle-budget.json");

function fail(msg) {
  console.error(`[bundle-size] FAIL ${msg}`);
  process.exit(1);
}

function positiveFinite(name, v) {
  if (typeof v !== "number" || !Number.isFinite(v) || !(v > 0)) {
    fail(`${name} ist keine endliche positive Zahl: ${JSON.stringify(v)}`);
  }
  return v;
}

let files;
try {
  files = readdirSync(assetsDir).filter((f) => /^index-[^/]*\.js$/.test(f));
} catch (e) {
  fail(`dist/assets nicht lesbar (${e.code ?? e.message}) -- vorher vite build?`);
}
if (files.length !== 1) {
  fail(`erwartet genau ein dist/assets/index-*.js, gefunden ${files.length}: ${files.join(", ")}`);
}
const bytes = readFileSync(join(assetsDir, files[0]));
const measured = { raw: bytes.length, gzip: gzipSync(bytes).length };

if (process.argv.includes("--print")) {
  console.log(JSON.stringify({ file: files[0], raw_bytes: measured.raw, gzip_bytes: measured.gzip }));
  process.exit(0);
}

let budget;
try {
  budget = JSON.parse(readFileSync(budgetPath, "utf8"));
} catch (e) {
  fail(`bundle-budget.json nicht lesbar (${e.code ?? e.message})`);
}
const tol = budget?.tolerance_percent;
if (typeof tol !== "number" || !Number.isFinite(tol) || tol < 0 || tol > 25) {
  fail(`tolerance_percent muss eine Zahl in [0, 25] sein: ${JSON.stringify(tol)}`);
}
const base = {
  raw: positiveFinite("baseline.raw_bytes", budget?.baseline?.raw_bytes),
  gzip: positiveFinite("baseline.gzip_bytes", budget?.baseline?.gzip_bytes),
};

const report = [];
let ok = true;
for (const k of ["raw", "gzip"]) {
  const limit = Math.floor(base[k] * (1 + tol / 100));
  const within = measured[k] <= limit; // Annahme nur bei WAHREM Vergleich (NaN -> rot)
  const delta = ((measured[k] / base[k] - 1) * 100).toFixed(2);
  report.push(`${k}=${measured[k]} B (baseline ${base[k]}, ${delta >= 0 ? "+" : ""}${delta} %, limit ${limit})`);
  if (!within) ok = false;
}
const line = `${files[0]} ${report.join(" ")} tolerance=${tol}%`;
if (!ok) fail(`${line} -- Grenzwert ueberschritten; bewusste Aenderung? bundle-budget.json im selben PR anheben und begruenden`);
console.log(`[bundle-size] OK ${line}`);
