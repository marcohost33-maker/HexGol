// Waechter fuer den Baseline-Pfad-Vertrag (Issue #167).
//
// Der Befund war NICHT der fehlende `{platform}`-Baustein allein -- der waere eine
// vertretbare Entwurfsentscheidung gewesen. Der Befund war, dass der Kommentar in
// playwright.config.ts eine Sicherheitseigenschaft BEHAUPTETE ("per-OS suffixes via
// the default Playwright behavior"), die das `snapshotPathTemplate` direkt darunter
// wieder wegnahm. Ein Kommentar, der eine nicht vorhandene Eigenschaft zusichert,
// ist schlimmer als ihre Abwesenheit: er sagt dem naechsten Leser, der Fall sei
// behandelt, also sieht niemand mehr nach.
//
// Deshalb steht der Vertrag jetzt hier und nicht (nur) im Kommentar.
//
// GEGENBEFUND ZUR ANNAHME DES ISSUES, hier gemessen, nicht uebernommen:
// Das Issue haelt Option 2 offen ("eine gemeinsame Baseline behalten und die
// Visual-Assertions auf canvas-only Bereiche beschraenken") und begruendet das
// damit, die heutigen Baselines seien canvas-only. Das stimmt nicht.
// `tests/e2e/visual.spec.ts` fotografiert fuer `worker-overlay-outline` den
// CONTAINER `.ghx-canvas` -- in `src/App.tsx` ein <div> mit `border: 1px solid`,
// `borderRadius: 14` und `boxShadow ... inset`, also Compositor-Chrome. Und das
// ist kein Versehen: die Aufnahme MUSS den Container nehmen, weil sie zwei
// gestapelte Canvas-Elemente zusammen zeigen soll (die Feld-Canvas gehoert im
// Worker-Modus dem Worker, den duennen Umriss traegt eine zweite, immer im
// Main-Thread gezeichnete Overlay-Canvas darueber). Option 2 haette also genau
// die Baseline zerstoert, die es zu schuetzen gilt. Darum `{platform}`.
//
// Was hier NICHT geprueft wird, und warum: ob zwei Plattformen wirklich
// unterschiedlich rastern. Das ist eine Aussage ueber fremde Maschinen; diese
// Suite laeuft auf einer. Geprueft wird ausschliesslich, dass der Pfad die
// Plattform TRENNT -- ob die Trennung noetig ist, entscheidet die Physik der
// Rasterung, nicht dieser Test.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../..");
const configPath = resolve(root, "playwright.config.ts");
const configSrc = readFileSync(configPath, "utf8");
const snapshotRoot = resolve(root, "tests/e2e/__snapshots__");

// Aus der Konfiguration GELESEN, nicht hier wiederholt: ein Waechter, der seine
// eigene Erwartung mitbringt, prueft sich selbst statt die Konfiguration.
function snapshotPathTemplate() {
  const m = configSrc.match(/^\s*snapshotPathTemplate:\s*"([^"]+)"\s*,/m);
  if (!m) {
    throw new Error(
      "snapshotPathTemplate nicht in playwright.config.ts gefunden — der Waechter " +
        "kann den Vertrag nicht mehr lesen und meldet das, statt gruen zu bleiben.",
    );
  }
  return m[1];
}

function mobileTestMatch() {
  const all = [...configSrc.matchAll(/^\s*testMatch:\s*\/(.+?)\/\s*,/gm)];
  if (all.length !== 1) {
    throw new Error(
      `genau ein testMatch erwartet (das mobile-Projekt), ${all.length} gefunden — ` +
        "die Projekt-Struktur hat sich geaendert, der Waechter darf das nicht raten.",
    );
  }
  return new RegExp(all[0][1]);
}

// Die Dateinamen-Form folgt dem Template, statt sie zweitzuschreiben. Aendert
// jemand das Template, wandert diese Pruefung mit — die Frage "enthaelt es
// ueberhaupt {platform}" steht separat darunter.
function baselineNamePattern(template) {
  const base = template.slice(template.lastIndexOf("/") + 1);
  const escaped = base.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const source = escaped
    .replace("\\{arg\\}", "(?:.+)")
    .replace("\\{platform\\}", "(?:linux|win32|darwin)")
    .replace("\\{ext\\}", "\\.[a-z0-9]+");
  return new RegExp(`^${source}$`);
}

// Der Dateiname wird der Plattform ueberlassen. Die frueherere Form
// `rel.slice(rel.lastIndexOf("/") + 1)` traf auf Windows ins Leere
// (`join` liefert dort "\\"), gab den GANZEN Pfad zurueck und liess damit
// das Verzeichnis mitpruefen. Gemessen: kaputt ging davon nichts, weil
// `{arg}` als `(?:.+)` uebersetzt wird und ein "\\" mitfrisst -- alle neun
// Baselines galten auch auf Windows als in Ordnung. Der Fehler lag nicht
// im Ergebnis, sondern darin, WORUEBER geurteilt wurde, und genau da faellt
// er auseinander: eine Baseline namens "-linux.png" (leeres {arg}) ist auf
// Linux ein offender und wurde auf Windows durchgewunken, weil "visual.spec.ts\\" dort
// die `.+`-Bedingung vor dem Bindestrich bereits erfuellte. Zwei Urteile
// ueber denselben Stand, je nach Betriebssystem des Entwicklers -- dieselbe
// Fehlerklasse, gegen die dieser Waechter ueberhaupt antritt.
function baselineName(fullPath) {
  return basename(fullPath);
}

function baselineFiles(dir = snapshotRoot) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...baselineFiles(full));
    else out.push(full);
  }
  return out;
}

function specFiles() {
  const dir = resolve(root, "tests/e2e");
  return readdirSync(dir)
    .filter((f) => f.endsWith(".spec.ts"))
    .map((f) => join(dir, f));
}

describe("visual baselines: Plattform-Trennung (Issue #167)", () => {
  it("das Template trennt die Plattform, statt es nur zu behaupten", () => {
    expect(snapshotPathTemplate()).toContain("{platform}");
  });

  it("keine Baseline liegt ohne Plattform-Kennung auf der Platte", () => {
    const pattern = baselineNamePattern(snapshotPathTemplate());
    const offenders = baselineFiles()
      .filter((f) => !pattern.test(baselineName(f)))
      .map((f) => f.slice(snapshotRoot.length + 1));
    expect(offenders, `Baselines ohne Plattform-Kennung: ${offenders.join(", ")}`).toEqual([]);
    // Positiv-Kontrolle: der Lauf darf nicht deshalb gruen sein, weil gar nichts
    // gefunden wurde. Ein leeres Verzeichnis wuerde dieselbe leere Liste liefern.
    expect(baselineFiles().length).toBeGreaterThan(0);
  });

  it("GEGENPROBE: dieselbe Pruefung faellt ueber die alten Namen", () => {
    // Die Namen VOR #167. Ein Matcher, der auch die durchlaesst, pruefte nichts.
    const pattern = baselineNamePattern(snapshotPathTemplate());
    expect(pattern.test("life-random-default.png")).toBe(false);
    expect(pattern.test("worker-overlay-outline.png")).toBe(false);
    expect(pattern.test("life-random-default-linux.png")).toBe(true);
    expect(pattern.test("life-random-default-darwin.png")).toBe(true);
    // Eine erfundene Plattform ist keine Plattform.
    expect(pattern.test("life-random-default-solaris.png")).toBe(false);
    // Und die Namensgewinnung muss den Trenner DIESER Plattform abraeumen:
    // `join` schreibt ihn, `basename` nimmt ihn wieder weg, auf beiden
    // Systemen. Die alte "/"-Variante faellt hier auf Windows durch --
    // deshalb steht die Zusicherung hier und nicht im Kommentar.
    expect(baselineName(join("visual.spec.ts", "life-random-default-linux.png"))).toBe(
      "life-random-default-linux.png",
    );
  });

  it("kein mobile-Spec fotografiert — deshalb fehlt {projectName} zu Recht", () => {
    // Die beiden Projekte teilen sich denselben Baseline-Pfad. Das ist heute
    // folgenlos, weil die Screenshots ausschliesslich im chromium-Projekt liegen
    // (1280x800); das mobile-Projekt (390x844) nimmt keine auf. Solange das gilt,
    // ist das fehlende {projectName} kein zweiter Fall derselben Klasse. Sobald
    // es nicht mehr gilt, faellt dieser Test — und nicht die naechste Baseline.
    const matcher = mobileTestMatch();
    const shooting = specFiles()
      .filter((f) => matcher.test(f))
      .filter((f) => readFileSync(f, "utf8").includes("toHaveScreenshot"))
      .map((f) => f.slice(root.length + 1));
    expect(
      shooting,
      "mobile-Specs mit Screenshot-Assertion — dann braucht das Template zusaetzlich " +
        `{projectName}: ${shooting.join(", ")}`,
    ).toEqual([]);
    // Positiv-Kontrolle: der Matcher trifft ueberhaupt Specs. Ein Matcher, der
    // nichts trifft, liefert ebenfalls die leere Liste oben.
    expect(specFiles().filter((f) => matcher.test(f)).length).toBeGreaterThan(0);
  });
});
