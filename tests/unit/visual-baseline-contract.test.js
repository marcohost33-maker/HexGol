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
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path, { dirname, join, resolve } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import playwrightConfig from "../../playwright.config.ts";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../..");
const configPath = resolve(root, "playwright.config.ts");
const configSrc = readFileSync(configPath, "utf8");
const snapshotRoot = resolve(root, "tests/e2e/__snapshots__");

// ---- Welches Template benutzt Playwright fuer toHaveScreenshot? (Issue #182) ----
//
// Bis #182 las dieser Waechter per Regex die Top-Level-`snapshotPathTemplate`.
// Playwright nimmt aber, JE PROJEKT, zuerst `expect.toHaveScreenshot.pathTemplate`
// und erst danach `snapshotPathTemplate`. Ein pathTemplate ohne `{platform}` liess
// den Waechter gruen, waehrend die Screenshots wieder plattformlos landeten.
//
// Die Konfiguration wird deshalb nicht mehr als TEXT gelesen, sondern als das
// Objekt importiert, das Playwright selbst laedt. Die Aufloesung darauf ist ein
// NACHBAU, keine Abfrage: Playwright bietet sie nur ueber `testInfo.snapshotPath()`
// in einem laufenden Test an, und ein Playwright-Lauf braucht den webServer, also
// einen Build -- nicht in einer Unit-Suite. Gemessen an der Quelle von
// playwright 1.62.1 (installiert) und 1.63.0 (npm pack, Dependabot #173), in beiden
// wortgleich:
//   lib/common/index.js            projectConfigs = CLI || userConfig.projects || [{ ...userConfig }]
//                                  snapshotPathTemplate = takeFirst(project, config)
//                                  expect               = takeFirst(project, config, {})
//   lib/worker/workerProcessEntry  expect?.toHaveScreenshot?.pathTemplate
//                                  || snapshotPathTemplate || legacyTemplate
// `takeFirst` prueft auf `undefined`: ein Projekt mit EIGENEM `expect` verdeckt das
// Top-Level-`expect` ganz, es wird nicht zusammengefuehrt. Die Kette danach prueft
// mit `||`: ein leerer String faellt durch.
//
// Ein Nachbau veraltet still, wenn Playwright die Aufloesung aendert. Dagegen steht
// der Kanarien-Test weiter unten: er sucht genau diese Ausdruecke in der
// INSTALLIERTEN Playwright-Quelle und schlaegt laut fehl, wenn einer fehlt.
const LEGACY_SCREENSHOT_TEMPLATE =
  "{snapshotDir}/{testFileDir}/{testFileName}-snapshots/{arg}{-projectName}{-snapshotSuffix}{ext}";

function takeFirst(...args) {
  for (const arg of args) {
    if (arg !== undefined) return arg;
  }
  return undefined;
}

function effectiveScreenshotTemplates(config) {
  const projects = config.projects || [{ ...config }];
  if (!Array.isArray(projects) || projects.length === 0) {
    // Null Projekte heisst: nichts wird aufgeloest, also auch nichts geprueft.
    // Eine leere Luecken-Liste waere dann ein gruener Befund ueber nichts.
    throw new Error("playwright.config.ts hat keine Projekte — der Waechter hat nichts zu pruefen.");
  }
  return projects.map((project, i) => {
    const expectConfig = takeFirst(project.expect, config.expect, {});
    const snapshotPathTemplate = takeFirst(project.snapshotPathTemplate, config.snapshotPathTemplate);
    const fromExpect = expectConfig?.toHaveScreenshot?.pathTemplate;
    if (fromExpect) return { project: project.name ?? `#${i}`, template: fromExpect, source: "expect.toHaveScreenshot.pathTemplate" };
    if (snapshotPathTemplate) return { project: project.name ?? `#${i}`, template: snapshotPathTemplate, source: "snapshotPathTemplate" };
    return { project: project.name ?? `#${i}`, template: LEGACY_SCREENSHOT_TEMPLATE, source: "legacyTemplate" };
  });
}

// Verlangt wird das woertliche `{platform}`. Das Legacy-Template trennt die
// Plattform zwar ueber `{-snapshotSuffix}` (Default: process.platform), aber nur,
// solange niemand `snapshotSuffix` setzt -- der Kommentar in der Konfiguration
// sagt "spells out explicitly", und genau das wird hier gehalten.
function platformGaps(config) {
  return effectiveScreenshotTemplates(config).filter((e) => !e.template.includes("{platform}"));
}

// Die Namensmuster aller effektiven Templates: eine Baseline ist in Ordnung, wenn
// sie zu MINDESTENS EINEM Projekt passt. Jedes Muster verlangt fuer sich die
// Plattform, die Vereinigung also auch.
function screenshotTemplates() {
  return [...new Set(effectiveScreenshotTemplates(playwrightConfig).map((e) => e.template))];
}

// Die Stellen in Playwrights eigener Quelle, auf denen der Nachbau oben beruht.
// Je Gruppe muessen ALLE Anker in DERSELBEN Datei stehen: `takeFirst` gibt es in
// 1.62.1 zweimal (common/index.js und util.js), ein Treffer irgendwo waere kein
// Beleg dafuer, dass die Konfigurations-Zusammenfuehrung ihn benutzt.
const RESOLUTION_ANCHORS = [
  {
    group: "Projekt-Zusammenfuehrung",
    anchors: [
      "userConfig.projects || [{ ...userConfig",
      "this.snapshotPathTemplate = takeFirst(projectConfig.snapshotPathTemplate, config.snapshotPathTemplate);",
      "this.expect = takeFirst(projectConfig.expect, config.expect, {});",
      /function takeFirst\(\.\.\.args\) \{\s*for \(const arg of args\) \{\s*if \(arg !== void 0\)\s*return arg;\s*\}\s*return void 0;\s*\}/,
    ],
  },
  {
    group: "Screenshot-Praezedenz",
    anchors: [
      "template = this._projectInternal.expect?.toHaveScreenshot?.pathTemplate || this._projectInternal.snapshotPathTemplate || legacyTemplate;",
      `const legacyTemplate = "${LEGACY_SCREENSHOT_TEMPLATE}";`,
    ],
  },
];

function jsFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...jsFiles(full));
    else if (entry.endsWith(".js")) out.push(full);
  }
  return out;
}

const hit = (src, anchor) => (typeof anchor === "string" ? src.includes(anchor) : anchor.test(src));

// Liefert die Gruppen, fuer die KEINE Datei alle Anker enthaelt, mit den Ankern,
// die in der bestpassenden Datei fehlen.
function missingResolutionAnchors(libDir) {
  const sources = jsFiles(libDir).map((f) => readFileSync(f, "utf8"));
  const missing = [];
  for (const { group, anchors } of RESOLUTION_ANCHORS) {
    let best = anchors;
    for (const src of sources) {
      const absent = anchors.filter((a) => !hit(src, a));
      if (absent.length < best.length) best = absent;
    }
    if (best.length > 0) missing.push({ group, anchors: best.map(String) });
  }
  return missing;
}

// Aufgeloest VON @playwright/test aus, nicht von dieser Datei: die Kanarie soll
// genau das `playwright` lesen, das der Test-Runner laedt -- auch wenn npm eines
// Tages eine zweite Version darunter verschachtelt.
const playwrightDir = dirname(
  createRequire(createRequire(import.meta.url).resolve("@playwright/test")).resolve("playwright/package.json"),
);

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
//
// Das Pfad-Flavour ist ein Parameter, damit die Gegenprobe BEIDE Trenner auf
// JEDER Maschine fahren kann: der Pflicht-Job `unit` laeuft auf Ubuntu, wo
// `join` nur "/" schreibt -- eine Zelle mit dem nativen `join` kann die
// Windows-Regression dort nicht rot machen (Codex-Review auf e1c6c95).
function baselineName(fullPath, flavour = path) {
  return flavour.basename(fullPath);
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

// Rekursiv, wie Playwright `testDir` durchsucht: ein kuenftiger Spec in einem
// Unterordner (z. B. tests/e2e/mobile/...) darf dem Waechter nicht entgehen,
// waehrend die Positiv-Kontrolle an den heutigen Top-Level-Specs gruen bleibt.
function specFiles(dir = resolve(root, "tests/e2e")) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...specFiles(full));
    else if (entry.endsWith(".spec.ts")) out.push(full);
  }
  return out;
}

describe("visual baselines: Plattform-Trennung (Issue #167)", () => {
  const nameMatches = (name) => screenshotTemplates().some((t) => baselineNamePattern(t).test(name));

  it("das Template trennt die Plattform, statt es nur zu behaupten", () => {
    // Geprueft wird das Template, das Playwright je Projekt fuer toHaveScreenshot
    // TATSAECHLICH nimmt (#182), nicht nur die Top-Level-snapshotPathTemplate.
    const gaps = platformGaps(playwrightConfig);
    expect(
      gaps,
      `Screenshot-Templates ohne {platform}: ${gaps.map((g) => `${g.project} (${g.source}): ${g.template}`).join("; ")}`,
    ).toEqual([]);
    // Positiv-Kontrolle: jedes Projekt wurde aufgeloest, nicht keines.
    expect(effectiveScreenshotTemplates(playwrightConfig).length).toBe(playwrightConfig.projects.length);
  });

  it("KANARIE: Playwrights Aufloesungsweg ist in der installierten Version noch derselbe", () => {
    // Versionsfragil mit Absicht, und laut: aendert ein Playwright-Update die
    // Praezedenz, wird hier rot -- nicht still der Nachbau falsch.
    const { version } = JSON.parse(readFileSync(join(playwrightDir, "package.json"), "utf8"));
    const missing = missingResolutionAnchors(join(playwrightDir, "lib"));
    expect(
      missing,
      `playwright@${version}: die Aufloesung des Screenshot-Templates sieht nicht mehr aus wie in ` +
        "1.62.1/1.63.0. effectiveScreenshotTemplates() gegen die neue Quelle nachmessen und die " +
        `Anker anpassen. Fehlend: ${JSON.stringify(missing)}`,
    ).toEqual([]);
  });

  it("GEGENPROBE: die Kanarie wird rot, wenn ein Anker fehlt oder gar keine Quelle da ist", () => {
    const tmp = mkdtempSync(join(tmpdir(), "hexgol-pwlib-"));
    try {
      mkdirSync(join(tmp, "worker"), { recursive: true });
      // Leeres Verzeichnis: alle Gruppen fehlen, kein gruener Befund ueber nichts.
      expect(missingResolutionAnchors(tmp).map((m) => m.group)).toEqual([
        "Projekt-Zusammenfuehrung",
        "Screenshot-Praezedenz",
      ]);
      // Die echte Quelle, mit genau einer Aenderung: `??` statt `||` in der
      // Praezedenz-Zeile. Die Gruppe davor muss weiter gefunden werden.
      // Die Dateien werden ueber ihre Anker gefunden, nicht ueber interne Pfade.
      const sources = jsFiles(join(playwrightDir, "lib")).map((f) => readFileSync(f, "utf8"));
      const holding = ({ anchors }) => sources.find((src) => anchors.every((a) => hit(src, a)));
      const common = holding(RESOLUTION_ANCHORS[0]);
      const worker = holding(RESOLUTION_ANCHORS[1]);
      expect(common, "Quelle der Projekt-Zusammenfuehrung nicht gefunden").toBeTypeOf("string");
      expect(worker, "Quelle der Screenshot-Praezedenz nicht gefunden").toBeTypeOf("string");
      const line = RESOLUTION_ANCHORS[1].anchors[0];
      writeFileSync(join(tmp, "index.js"), common);
      writeFileSync(join(tmp, "worker", "entry.js"), worker.replace(line, line.replaceAll(" || ", " ?? ")));
      expect(missingResolutionAnchors(tmp)).toEqual([{ group: "Screenshot-Praezedenz", anchors: [line] }]);
      // Und die Anker einer Gruppe muessen in DERSELBEN Datei stehen.
      const [a, b] = RESOLUTION_ANCHORS[1].anchors;
      writeFileSync(join(tmp, "worker", "entry.js"), a);
      writeFileSync(join(tmp, "worker", "other.js"), String(b));
      expect(missingResolutionAnchors(tmp).map((m) => m.group)).toEqual(["Screenshot-Praezedenz"]);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("keine Baseline liegt ohne Plattform-Kennung auf der Platte", () => {
    const offenders = baselineFiles()
      .filter((f) => !nameMatches(baselineName(f)))
      .map((f) => f.slice(snapshotRoot.length + 1));
    expect(offenders, `Baselines ohne Plattform-Kennung: ${offenders.join(", ")}`).toEqual([]);
    // Positiv-Kontrolle: der Lauf darf nicht deshalb gruen sein, weil gar nichts
    // gefunden wurde. Ein leeres Verzeichnis wuerde dieselbe leere Liste liefern.
    expect(baselineFiles().length).toBeGreaterThan(0);
  });

  it("GEGENPROBE: dieselbe Pruefung faellt ueber die alten Namen", () => {
    // Die Namen VOR #167. Ein Matcher, der auch die durchlaesst, pruefte nichts.
    expect(nameMatches("life-random-default.png")).toBe(false);
    expect(nameMatches("worker-overlay-outline.png")).toBe(false);
    expect(nameMatches("life-random-default-linux.png")).toBe(true);
    expect(nameMatches("life-random-default-darwin.png")).toBe(true);
    // Eine erfundene Plattform ist keine Plattform.
    expect(nameMatches("life-random-default-solaris.png")).toBe(false);
    // Und die Namensgewinnung muss den Trenner DIESER Plattform abraeumen:
    // `join` schreibt ihn, `basename` nimmt ihn wieder weg, auf beiden
    // Systemen. Die alte "/"-Variante faellt hier auf Windows durch --
    // deshalb steht die Zusicherung hier und nicht im Kommentar.
    for (const flavour of [path.posix, path.win32]) {
      expect(
        baselineName(flavour.join("visual.spec.ts", "life-random-default-linux.png"), flavour),
        `Trenner ${JSON.stringify(flavour.sep)}`,
      ).toBe("life-random-default-linux.png");
    }
  });

  it("GEGENPROBE: die Spec-Aufzaehlung findet auch verschachtelte Specs", () => {
    const tmp = mkdtempSync(join(tmpdir(), "hexgol-specs-"));
    try {
      mkdirSync(join(tmp, "mobile"), { recursive: true });
      writeFileSync(join(tmp, "top.spec.ts"), "");
      writeFileSync(join(tmp, "mobile", "mobile-layout.spec.ts"), "");
      writeFileSync(join(tmp, "mobile", "helper.ts"), "");
      const found = specFiles(tmp).map((f) => path.relative(tmp, f).split(path.sep).join("/")).sort();
      expect(found).toEqual(["mobile/mobile-layout.spec.ts", "top.spec.ts"]);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
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

describe("visual baselines: effektives Screenshot-Template (Issue #182)", () => {
  // Alle Zellen arbeiten auf FIXTURE-Objekten, die aus der echten Konfiguration
  // abgeleitet sind (Spread, keine Mutation). playwright.config.ts bleibt unberuehrt;
  // die letzte Zelle prueft das ausdruecklich.
  const withoutPlatform = "{testDir}/__snapshots__/{testFilePath}/{arg}{ext}";
  const gapsOf = (config) => platformGaps(config).map((g) => `${g.project}:${g.source}`);
  const fingerprint = (c) =>
    JSON.stringify({
      snapshotPathTemplate: c.snapshotPathTemplate,
      expect: c.expect,
      projects: c.projects.map((p) => ({ name: p.name, snapshotPathTemplate: p.snapshotPathTemplate, expect: p.expect })),
    });
  // Beim Einsammeln festgehalten, also bevor irgendeine Zelle laeuft.
  const pristine = fingerprint(playwrightConfig);

  it("GEGENPROBE (a): expect.toHaveScreenshot.pathTemplate ohne {platform} schlaegt snapshotPathTemplate", () => {
    const config = {
      ...playwrightConfig,
      expect: {
        ...playwrightConfig.expect,
        toHaveScreenshot: { ...playwrightConfig.expect.toHaveScreenshot, pathTemplate: withoutPlatform },
      },
    };
    // Die Top-Level-snapshotPathTemplate enthaelt {platform} weiterhin -- genau
    // deshalb blieb der alte Waechter hier gruen.
    expect(config.snapshotPathTemplate).toContain("{platform}");
    expect(gapsOf(config)).toEqual([
      "chromium:expect.toHaveScreenshot.pathTemplate",
      "mobile:expect.toHaveScreenshot.pathTemplate",
    ]);
  });

  it("GEGENPROBE (b): Projekt-Override von snapshotPathTemplate ohne {platform}", () => {
    const config = {
      ...playwrightConfig,
      projects: playwrightConfig.projects.map((p) =>
        p.name === "mobile" ? { ...p, snapshotPathTemplate: withoutPlatform } : p,
      ),
    };
    expect(gapsOf(config)).toEqual(["mobile:snapshotPathTemplate"]);
  });

  it("GEGENPROBE (b2): Projekt-Override von expect.toHaveScreenshot.pathTemplate ohne {platform}", () => {
    const config = {
      ...playwrightConfig,
      projects: playwrightConfig.projects.map((p) =>
        p.name === "chromium" ? { ...p, expect: { toHaveScreenshot: { pathTemplate: withoutPlatform } } } : p,
      ),
    };
    expect(gapsOf(config)).toEqual(["chromium:expect.toHaveScreenshot.pathTemplate"]);
  });

  it("GEGENPROBE (b3): ein Projekt-expect VERDECKT das Top-Level-expect ganz (kein Deep-Merge)", () => {
    // Oben traegt expect.toHaveScreenshot.pathTemplate die Plattform, die
    // snapshotPathTemplate nicht. Ein Projekt mit eigenem `expect` (hier nur ein
    // Timeout) verliert das Top-Level-pathTemplate und faellt auf die
    // plattformlose snapshotPathTemplate zurueck. Ein Nachbau mit Deep-Merge
    // bliebe hier gruen.
    const config = {
      ...playwrightConfig,
      snapshotPathTemplate: withoutPlatform,
      expect: { toHaveScreenshot: { pathTemplate: "{testDir}/{arg}-{platform}{ext}" } },
      projects: playwrightConfig.projects.map((p) => (p.name === "mobile" ? { ...p, expect: { timeout: 1000 } } : p)),
    };
    expect(gapsOf(config)).toEqual(["mobile:snapshotPathTemplate"]);
  });

  it("GEGENPROBE (b4): ein leeres pathTemplate faellt durch (Playwright prueft mit ||)", () => {
    const config = {
      ...playwrightConfig,
      snapshotPathTemplate: withoutPlatform,
      expect: { toHaveScreenshot: { pathTemplate: "" } },
    };
    expect(gapsOf(config)).toEqual(["chromium:snapshotPathTemplate", "mobile:snapshotPathTemplate"]);
  });

  it("GEGENPROBE (b5): ohne jedes Template greift Playwrights Legacy-Default -- der ist NICHT ausdruecklich", () => {
    const { snapshotPathTemplate: _drop, ...rest } = playwrightConfig;
    const config = { ...rest, expect: {} };
    expect(gapsOf(config)).toEqual(["chromium:legacyTemplate", "mobile:legacyTemplate"]);
  });

  it("GEGENPROBE (b6): eine leere Projektliste ist kein gruener Befund", () => {
    expect(() => platformGaps({ ...playwrightConfig, projects: [] })).toThrow(/keine Projekte/);
  });

  it("GEGENPROBE (c): der heutige Stand ist gruen, und die Zellen haben die Konfiguration nicht veraendert", () => {
    const effective = effectiveScreenshotTemplates(playwrightConfig);
    expect(effective.map((e) => `${e.project}:${e.source}`)).toEqual([
      "chromium:snapshotPathTemplate",
      "mobile:snapshotPathTemplate",
    ]);
    expect(platformGaps(playwrightConfig)).toEqual([]);
    expect(fingerprint(playwrightConfig)).toBe(pristine);
  });
});
