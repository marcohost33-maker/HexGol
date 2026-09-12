// Quell-Waechter fuer Typografie und CSP (Issue #163).
//
// Der Ausgabe-Waechter (scripts/verify-csp-contract.mjs, laeuft in `npm run build`)
// prueft das erzeugte Buendel. Dieser Test hier prueft die QUELLE -- er schlaegt an,
// bevor ueberhaupt gebaut wird, und benennt die Datei, in der der Rueckfall steht.
// Beide zusammen, weil keiner den anderen ersetzt: die Quelle kann sauber sein und
// ein Plugin trotzdem etwas einbetten, und eine Quell-Referenz kann im Buendel
// wegoptimiert sein und beim naechsten Build wiederkommen.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve, relative, extname, sep } from "node:path";
import { describe, expect, it } from "vitest";
import { FONT_SANS, FONT_MONO } from "../../src/lib/typography.js";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../..");

// Fremde Schrift-Origins, wortwoertlich. Diese beiden Zeichenketten duerfen im
// Produktionscode NIRGENDS vorkommen -- auch nicht in einem Kommentar. Genau deshalb
// ist die Suche stumpf: ein Waechter mit Ausnahmen ist ein Waechter mit Luecken.
const REMOTE_FONT_HOSTS = Object.freeze(["fonts.googleapis.com", "fonts.gstatic.com"]);

// Was als Produktionsquelle gilt. `experimental/` steht bewusst NICHT hier:
//
// BENANNTE AUSNAHME (#163 Punkt 5) -- experimental/v19.1/ sind archivierte
// Schnappschuesse frueherer Staende (Standalone-HTML und die zugehoerige JSX). Sie
// werden nicht gebaut, nicht importiert und nicht ausgeliefert; ihr @import auf eine
// fremde Schrift-Origin ist Teil des historischen Belegs. Ein Archiv umzuschreiben,
// damit ein Waechter schweigt, waere das Gegenteil von Beweissicherung: der
// Schnappschuss wuerde dann etwas zeigen, das es nie gab. Also wird die Ausnahme
// benannt statt still gemacht -- und weil sie hier steht, faellt sie auf, wenn
// jemand kuenftig echten Produktionscode unter experimental/ ablegt.
const PRODUCTION_SOURCES = Object.freeze(["index.html", "src", "public"]);

// Jede Schrift-Deklaration in der Produktionsquelle -- CSS (`font-family:`) wie
// JSX (`fontFamily:`). Die SCHREIBWEISE wird mitgelesen, weil sie entscheidet,
// wo die Deklaration endet (siehe unten).
const FONT_DECLARATION = /(font-family|fontFamily)\s*:\s*([^\n]*)/g;

// Die einzigen erlaubten Namen:
//   var(--ghx-font-sans|mono)   die index.html-Spiegelung, zeichengleich geprueft
//   FONT_SANS / FONT_MONO       die Quelle selbst
//   DISP / MONO                 die App.tsx-Aliasse (oben als Gleichheit geprueft)
//   ${...}                      dieselben Namen in einer Vorlagen-Zeichenkette
const FONT_TOKEN = "(?:var\\(--ghx-font-(?:sans|mono)\\)|\\$\\{\\s*(?:FONT_SANS|FONT_MONO|DISP|MONO)\\s*\\}|FONT_SANS|FONT_MONO|DISP|MONO)";

// Geprueft wird die GANZE Deklaration, nicht ihr Anfang (Review #168, Runde 2,
// Befund N3). Die alte Fassung war nur am Wertanfang verankert; damit passierten
// `FONT_SANS && "'Space Grotesk', sans-serif"` und
// `var(--ghx-font-sans), "Space Grotesk"` -- beide selbst nachgestellt. Ein
// Anfangs-Anker prueft, womit ein Wert BEGINNT; welche Schrift am Ende steht,
// entscheidet aber der ganze Ausdruck.
//
// Wo die Deklaration endet, haengt an der Schreibweise, denn das sind zwei
// verschiedene Sprachen:
//   font-family:  CSS -- Ende an `;`, `}`, am Zeilenende oder an einem
//                 schliessenden Anfuehrungszeichen. NICHT am Komma: dort geht der
//                 Schriftstapel weiter, und genau das war der Verstoss aus N3.
//   fontFamily:   JS  -- Ende an `,`, `;` oder `}`. Hier trennt das Komma
//                 Objekt-Eigenschaften und ist ein echtes Ende.
const ALLOWED_CSS_VALUE = new RegExp("^" + FONT_TOKEN + "\\s*(?:[;}'\"`]|$)");
const ALLOWED_JS_VALUE = new RegExp("^" + FONT_TOKEN + "\\s*(?:[,;}]|$)");

// Die DRITTE Schreibweise (Review #168, Runde 2, Befund N6). Ein Canvas traegt
// seinen Schriftstapel in `ctx.font`, im CSS-`font`-Kurzformat und ohne ein
// `font-family:` davor -- die beiden Muster oben sehen davon nichts. In
// src/App.tsx stand deshalb bis 2026-09-12 ein dritter Stapel
// (`${fs}px ui-monospace, monospace`), waehrend beide Waechter gruen waren und
// der Text "eine Quelle" behauptete.
//
// Erlaubt ist nur eine Vorlagen-Zeichenkette, deren Familienteil ein geteiltes
// Token IST und die davor weder Komma noch Anfuehrungszeichen traegt -- damit
// faellt `${fs}px Arial, ${FONT_MONO}` genauso wie eine reine Zeichenkette.
const CANVAS_FONT_DECLARATION = /\.font\s*=\s*([^\n]*)/g;
const ALLOWED_CANVAS_FONT = new RegExp("^`[^`,\"']*\\$\\{\\s*(?:FONT_SANS|FONT_MONO|DISP|MONO)\\s*\\}`\\s*[;,)]?\\s*$");

const BINARY_EXTENSIONS = Object.freeze([".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".woff", ".woff2", ".ttf", ".otf"]);

function walkFiles(path) {
  if (statSync(path).isFile()) return [path];
  const out = [];
  for (const name of readdirSync(path)) out.push(...walkFiles(resolve(path, name)));
  return out;
}

function productionTextFiles() {
  const out = [];
  for (const entry of PRODUCTION_SOURCES) {
    for (const path of walkFiles(resolve(root, entry))) {
      if (BINARY_EXTENSIONS.includes(extname(path).toLowerCase())) continue;
      const bytes = readFileSync(path);
      if (bytes.includes(0)) continue;
      out.push({ rel: relative(root, path).split(sep).join("/"), text: bytes.toString("utf8") });
    }
  }
  return out;
}

// Eine Sammelstelle fuer alle Schrift-Deklarationen. Vorher lag die Schleife in
// der Verstoss-Zelle; damit konnte die Deckungs-Zelle nur eine Gesamtzahl sehen
// und nicht, WO die Treffer herkamen -- genau die Blindheit, die N5 benannt hat.
// Drei Schreibweisen, drei Grammatiken -- die Zuordnung steht an EINER Stelle,
// damit eine vierte nicht still in den CSS-Zweig faellt.
function allowedFormFor(spelling) {
  if (spelling === "fontFamily") return ALLOWED_JS_VALUE;
  if (spelling === "canvas.font") return ALLOWED_CANVAS_FONT;
  return ALLOWED_CSS_VALUE;
}

function fontDeclarations() {
  const out = [];
  for (const { rel, text } of productionTextFiles()) {
    const lines = text.split("\n");
    for (let i = 0; i < lines.length; i += 1) {
      for (const match of lines[i].matchAll(FONT_DECLARATION)) {
        out.push({ rel, spelling: match[1], value: match[2].trim(), line: i + 1 });
      }
      for (const match of lines[i].matchAll(CANVAS_FONT_DECLARATION)) {
        out.push({ rel, spelling: "canvas.font", value: match[1].trim(), line: i + 1 });
      }
    }
  }
  return out;
}

const html = readFileSync(resolve(root, "index.html"), "utf8");
const app = readFileSync(resolve(root, "src/App.tsx"), "utf8");
const headers = readFileSync(resolve(root, "public/_headers"), "utf8");

// Die Suche liegt in einer eigenen Funktion, damit sie gegen eine SYNTHETISCHE
// Dateiliste pruefbar ist. Vorher stand sie in der Zelle, und die konnte nur
// gegen den heutigen Baum urteilen -- dort steht kein grossgeschriebener Host,
// also war die Zelle gegen Befund N4 blind (Review #168, Runde 3).
//
// Verglichen wird auf einer kleingeschriebenen Kopie: DNS loest Hostnamen ohne
// Ruecksicht auf die Schreibweise auf, `FONTS.GSTATIC.COM` ist dieselbe Herkunft.
// Gemeldet wird weiter die Zeilennummer im Originaltext.
function remoteFontHits(files) {
  const hits = [];
  for (const { rel, text } of files) {
    const lower = text.toLowerCase();
    for (const host of REMOTE_FONT_HOSTS) {
      if (!lower.includes(host)) continue;
      const lineIndex = text.split("\n").findIndex((line) => line.toLowerCase().includes(host));
      hits.push(`${rel}:${lineIndex + 1} (${host})`);
    }
  }
  return hits;
}

describe("no remote font origins in production source (#163)", () => {
  it("finds zero references to remote font origins", () => {
    expect(remoteFontHits(productionTextFiles())).toEqual([]);
  });

  it("compares font hostnames case-insensitively (#168 N4)", () => {
    // Der Quell-Waechter trug denselben woertlichen Vergleich wie der
    // Ausgabe-Waechter. Eine abweichende Schreibweise kam damit durch beide
    // Netze, landete im Buendel und wurde live von `font-src 'self'` geblockt --
    // die Typografie-Drift, die #163 geschlossen hat, waere zurueck.
    const shouted = REMOTE_FONT_HOSTS.map((h) => h.toUpperCase());
    for (const host of shouted) {
      const hits = remoteFontHits([{ rel: "probe.css", text: `@font-face{src:url(https://${host}/x.woff2)}` }]);
      expect(hits, `missed the shouted spelling ${host}`).toHaveLength(1);
    }
    // Gemischte Schreibweise ebenfalls, sonst waere nur GROSS gelernt.
    expect(remoteFontHits([{ rel: "p.css", text: `url(https://Fonts.GStatic.com/x)` }])).toHaveLength(1);
  });

  it("reports the right line and stays silent on unrelated text (#168 N4 counter-direction)", () => {
    // Ein Waechter, der jede Datei meldet, ist so wertlos wie einer, der keine
    // meldet. Und die Zeilennummer muss die des ORIGINALS bleiben, nicht die
    // einer umgeschriebenen Kopie.
    const text = ["/* nichts */", "body{}", `@import url(https://${REMOTE_FONT_HOSTS[0].toUpperCase()}/css)`].join("\n");
    expect(remoteFontHits([{ rel: "p.css", text }])).toEqual([`p.css:3 (${REMOTE_FONT_HOSTS[0]})`]);
    expect(remoteFontHits([{ rel: "q.css", text: "body{font-family:system-ui}" }])).toEqual([]);
  });

  it("scans a non-empty set of files, so an empty result means absence and not a broken walk", () => {
    // Ohne diese Zelle waere der Test oben auch dann gruen, wenn die Sammelfunktion
    // nichts mehr faende -- eine blinde Suche liest sich wie eine Abwesenheit.
    const files = productionTextFiles();
    expect(files.length).toBeGreaterThan(5);
    expect(files.map((f) => f.rel)).toContain("index.html");
    expect(files.map((f) => f.rel)).toContain("src/App.tsx");
  });

  it("injects no font stylesheet link at runtime", () => {
    // Der fruehere Pfad war ein useEffect, der ein <link rel="stylesheet"> in den
    // <head> haengte. Gesucht wird die Bauweise, nicht der alte Bezeichner: eine
    // Umbenennung von "ghx-font" darf den Waechter nicht blind machen.
    expect(app).not.toMatch(/createElement\(\s*["']link["']\s*\)/);
    expect(app).not.toMatch(/\.rel\s*=\s*["']stylesheet["']/);
  });
});

describe("system font stacks are the single source (#163)", () => {
  it("keeps index.html custom properties character-identical to src/lib/typography.js", () => {
    const sans = html.match(/--ghx-font-sans:\s*([^;]+);/);
    const mono = html.match(/--ghx-font-mono:\s*([^;]+);/);
    expect(sans, "index.html carries no --ghx-font-sans").not.toBeNull();
    expect(mono, "index.html carries no --ghx-font-mono").not.toBeNull();
    expect(sans[1].trim()).toBe(FONT_SANS);
    expect(mono[1].trim()).toBe(FONT_MONO);
  });

  it("names no font that the app does not ship", () => {
    // Es liegt keine Schriftdatei im Buendel; jede benannte Familie muesste also vom
    // Betriebssystem kommen. Diese drei kamen frueher aus dem Netz.
    for (const stack of [FONT_SANS, FONT_MONO]) {
      for (const webfont of ["Space Grotesk", "JetBrains Mono", "IBM Plex"]) {
        expect(stack).not.toContain(webfont);
      }
    }
    expect(FONT_SANS).toMatch(/^system-ui,/);
    expect(FONT_MONO).toMatch(/^ui-monospace,/);
    expect(FONT_SANS).toMatch(/sans-serif$/);
    expect(FONT_MONO).toMatch(/monospace$/);
  });

  it("uses the shared constants in App.tsx instead of literal stacks", () => {
    expect(app).toContain('from "./lib/typography.js"');
    expect(app).toMatch(/const DISP = FONT_SANS;/);
    expect(app).toMatch(/const MONO = FONT_MONO;/);
  });

  // Review #168, Befund T1. Der Test oben prueft, dass App.tsx die Konstanten
  // BENUTZT -- er sagt nichts darueber, ob daneben noch jemand seinen eigenen
  // Stapel fuehrt. Genau das war der Fall: Splash.jsx und ConwayIntro.jsx trugen
  // an drei Stellen `fontFamily: "'Space Grotesk', system-ui, sans-serif"`. Die
  // Schrift wird seit #163 nirgends mehr geladen und auch nicht ausgeliefert --
  // die Overlays sahen also auf Rechnern MIT installierter Schrift anders aus
  // als auf allen anderen, und "eine Quelle" stimmte nicht.
  //
  // Deshalb prueft der Waechter ab jetzt die FORM jeder Deklaration statt eine
  // Liste bekannter Schriftnamen: erlaubt sind nur Verweise auf die eine Quelle.
  // Ein Namensverbot faengt nur die drei Namen, die man schon kennt; ein
  // Formverbot faengt auch den vierten, den noch niemand eingesetzt hat.
  it("lets no production source declare its own font stack (#168 T1)", () => {
    const violations = [];
    for (const { rel, spelling, value, line } of fontDeclarations()) {
      const allowed = allowedFormFor(spelling);
      if (!allowed.test(value)) violations.push(`${rel}:${line} (${spelling}) -> ${value.slice(0, 60)}`);
    }
    expect(violations).toEqual([]);
  });

  it("rejects a stack that continues past the shared token (#168 N3)", () => {
    // Diese Zelle prueft die FORM-Regel unmittelbar, nicht nur ihre Wirkung auf
    // den heutigen Baum. Grund: die Verstossliste oben ist leer, solange niemand
    // einen zweiten Stapel eingebaut hat -- sie kann also gruen bleiben, waehrend
    // die Regel offen steht. Genau so war es: der Anfangs-Anker liess alle sechs
    // Formen unten passieren (selbst nachgestellt auf 1ba42f1).
    const rejected = [
      ["fontFamily", `FONT_SANS && "'Space Grotesk', sans-serif"`],
      ["font-family", `var(--ghx-font-sans), "Space Grotesk"`],
      ["fontFamily", `MONO + ", 'JetBrains Mono'"`],
      ["font-family", "${FONT_SANS} , \"Space Grotesk\""],
      ["fontFamily", `MONO ?? "Arial"`],
      ["fontFamily", `FONT_SANS.replace("system-ui", "Space Grotesk")`],
      ["font-family", "MONO, monospace;"],
      // N6: die Canvas-Form. Die ersten beiden sind die Stelle, die in App.tsx
      // wirklich stand; die dritte schiebt einen Namen VOR das geteilte Token.
      ["canvas.font", "`${fs}px ui-monospace, monospace`;"],
      ["canvas.font", `"12px monospace";`],
      ["canvas.font", "`${fs}px Arial, ${FONT_MONO}`;"],
    ];
    for (const [spelling, value] of rejected) {
      const allowed = allowedFormFor(spelling);
      expect(allowed.test(value), `accepted a second stack: ${spelling}: ${value}`).toBe(false);
    }
  });

  it("still accepts every form the tree actually uses (#168 N3 counter-direction)", () => {
    // Ein Formverbot, das alles verwirft, ist so wertlos wie keines -- und bei
    // einer verschaerften Regel ist das die reale Gefahr. Diese sieben Formen
    // stehen so im Baum; sie muessen weiterhin durchgehen.
    const accepted = [
      ["font-family", "var(--ghx-font-sans); }"],
      ["font-family", "${FONT_SANS};text-align:center;padding:24px'>` +"],
      ["fontFamily", "MONO, fontSize: 11.5, fontWeight: 700 }}>"],
      ["fontFamily", "MONO }}>"],
      ["fontFamily", "MONO,"],
      ["fontFamily", "FONT_SANS,"],
      ["fontFamily", "MONO };"],
      ["canvas.font", "`${fs}px ${FONT_MONO}`;"],
    ];
    for (const [spelling, value] of accepted) {
      const allowed = allowedFormFor(spelling);
      expect(allowed.test(value), `rejected a form the tree uses: ${spelling}: ${value}`).toBe(true);
    }
  });

  // Die Nachbarzelle zur Verstossliste: ohne sie waere eine leere Liste auch dann
  // gruen, wenn der Sammler gar nichts mehr faende -- eine blinde Suche liest sich
  // wie eine Abwesenheit.
  //
  // Hier stand bis 2026-09-12 eine Gesamtzahl ("mehr als 20 Deklarationen"). Die
  // trug nicht, und das ist nachgezaehlt: 147 der 151 Deklarationen stehen in
  // src/App.tsx allein. Faellt jede ANDERE Datei aus dem Sammler, bleiben 147 --
  // die Schwelle merkt nichts. Faellt umgekehrt nur App.tsx aus, bleiben 4 und sie
  // greift. Eine Gesamtzahl misst also die groesste Datei, nicht die Deckung.
  //
  // Getragen wird der Nachweis deshalb von der DECKUNG: beide Schreibweisen
  // muessen Treffer liefern, und es muessen mehrere Dateien beitragen -- auch
  // ohne App.tsx.
  it("covers both spellings and more than one file, so the scan cannot go half-blind (#168 N5)", () => {
    const found = fontDeclarations();
    const spellings = new Set(found.map((d) => d.spelling));
    const files = new Set(found.map((d) => d.rel));
    const withoutApp = new Set([...files].filter((f) => f !== "src/App.tsx"));

    expect(spellings, "CSS spelling font-family: no longer matches").toContain("font-family");
    expect(spellings, "JS spelling fontFamily: no longer matches").toContain("fontFamily");
    // N6: die Canvas-Form muss ebenfalls Treffer liefern, sonst ist sie stumm
    // hinzugefuegt und faellt bei der naechsten Umbenennung lautlos wieder aus.
    expect(spellings, "canvas ctx.font is no longer scanned").toContain("canvas.font");
    expect(files, "index.html contributes no declaration -- the walk misses the HTML entry").toContain("index.html");
    expect(
      withoutApp.size,
      "only src/App.tsx contributes -- every other file fell out of the scan unnoticed",
    ).toBeGreaterThanOrEqual(2);
    expect(
      found.filter((d) => d.rel === "src/App.tsx").length,
      "src/App.tsx contributes almost nothing -- the .tsx branch of the scan is broken",
    ).toBeGreaterThan(50);
  });
});

describe("production CSP stays self-only for fonts (#163 point 4)", () => {
  it("keeps font-src exactly 'self'", () => {
    const csp = headers.split("\n").map((l) => l.trim()).find((l) => l.startsWith("Content-Security-Policy:"));
    expect(csp, "public/_headers carries no CSP line").toBeTruthy();
    const fontSrc = csp
      .slice(csp.indexOf(":") + 1)
      .split(";")
      .map((part) => part.trim().split(/\s+/).filter(Boolean))
      .find((tokens) => tokens[0] === "font-src");
    expect(fontSrc, "CSP has no font-src directive").toBeTruthy();
    expect(fontSrc.slice(1)).toEqual(["'self'"]);
  });
});
