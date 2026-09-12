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

const html = readFileSync(resolve(root, "index.html"), "utf8");
const app = readFileSync(resolve(root, "src/App.tsx"), "utf8");
const headers = readFileSync(resolve(root, "public/_headers"), "utf8");

describe("no remote font origins in production source (#163)", () => {
  it("finds zero references to remote font origins", () => {
    const hits = [];
    for (const { rel, text } of productionTextFiles()) {
      for (const host of REMOTE_FONT_HOSTS) {
        const lineIndex = text.split("\n").findIndex((line) => line.includes(host));
        if (lineIndex >= 0) hits.push(`${rel}:${lineIndex + 1} (${host})`);
      }
    }
    expect(hits).toEqual([]);
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
