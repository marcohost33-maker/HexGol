// Mutations-Sonde fuer nine-rules.js — beweist, dass die Tests DISKRIMINIEREN.
//
// Warum das noetig ist: Eine gruene Suite belegt nur, dass sie laeuft, nicht dass
// sie etwas misst. Ein Test ohne Aussagekraft ist gruen und wertlos zugleich.
// Diese Sonde nimmt gezielt die tragenden Praedikate zurueck ("Mutant") und
// verlangt, dass die Suite daraufhin ROT wird. Ueberlebt ein Mutant, ist die
// zugehoerige Eigenschaft NICHT abgesichert -- das ist ein Befund, kein Detail.
//
// Ausfuehrung:  node tests/unit/mutation-probe.mjs
// Exit 0 = alle Mutanten getoetet. Exit 1 = mindestens einer ueberlebt.
//
// Die Datei wird waehrend des Laufs veraendert und IMMER wiederhergestellt --
// auch bei Absturz (try/finally + Hash-Vergleich am Ende).

import { readFileSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { createHash } from "node:crypto";

const ZIEL = "src/lib/nine-rules.js";
const original = readFileSync(ZIEL, "utf8");
const hashVorher = createHash("sha256").update(original).digest("hex");

// Jeder Mutant nimmt EINE tragende Entscheidung zurueck.
const MUTANTEN = [
  {
    name: "M1 andAll: Aggregation nimmt das Maximum statt des Minimums",
    von: "    if (RANG[s] < RANG[min]) min = s;",
    nach: "    if (RANG[s] > RANG[min]) min = s;",
    schuetzt: "FAIL dominiert; Unwissen wird nicht zu Zustimmung",
  },
  {
    name: "M2 R7: laufender Trace wird als endgueltig widerlegt behandelt",
    von: "      return ctx.traceComplete\n        ? res(STATUS.FAIL, \"Trace abgeschlossen, nie terminal geworden\")\n        : res(STATUS.FAIL_VORLAEUFIG, \"bisher nicht terminal; der Trace laeuft noch\");",
    nach: "      return res(STATUS.FAIL, \"nicht terminal\");",
    schuetzt: "Co-Safety ist nie endgueltig widerlegbar",
  },
  {
    name: "M8 R2: behauptet definitives PASS auf laufendem Trace",
    von: "        return ctx.traceComplete\n          ? res(STATUS.PASS, \"Trace abgeschlossen: durchgehend monoton und echt gewachsen\")\n          : res(STATUS.PASS_VORLAEUFIG, \"bisher monoton und echt gewachsen; der G-Teil bleibt widerlegbar\");",
    nach: "        return res(STATUS.PASS, \"monoton und gewachsen\");",
    schuetzt: "Safety ist nie endgueltig bestaetigbar -- der urspruengliche Fehler",
  },
  {
    name: "M9 R2: Vakuum-Guard entfernt (G ueber leerer Menge)",
    von: "      if (vals.length < 2) {\n        return res(STATUS.NA, \"weniger als zwei Zustaende -- kein Uebergang beobachtbar\");\n      }",
    nach: "      if (false) { }",
    schuetzt: "kein PASS aus Nichtbeobachtung",
  },
  {
    name: "M10 Uebergangsregel meldet FAIL statt N/A ohne Nachfolger",
    von: "      if (ctx.trace.length < 2) return res(STATUS.NA, \"kein Uebergang vorhanden (weniger als zwei Zustaende)\");\n      const a = ctx.trace[ctx.trace.length - 2], b = ctx.last;\n      const eq = ctx.config.valueEquals || ((x, y) => x === y);",
    nach: "      if (ctx.trace.length < 2) return res(STATUS.FAIL, \"kein Uebergang\");\n      const a = ctx.trace[ctx.trace.length - 2], b = ctx.last;\n      const eq = ctx.config.valueEquals || ((x, y) => x === y);",
    schuetzt: "schwaches Next: nicht anwendbar ist nicht verletzt",
  },
  {
    name: "M3 R2: Monotoniebruch wird nicht mehr erkannt",
    von: "        if (vals[i] < vals[i - 1]) {",
    nach: "        if (false) {",
    schuetzt: "Aendern ist nicht Werden (T1)",
  },
  {
    name: "M4 fail-closed aufgehoben: fehlende Konfiguration ergibt PASS",
    von: "        return res(STATUS.NA, \"keine progressVariable konfiguriert\");",
    nach: "        return res(STATUS.PASS, \"keine progressVariable konfiguriert\");",
    schuetzt: "nicht konfiguriert darf nie wie erfuellt aussehen",
  },
  {
    name: "M5 Hex-Distanz: falsche Formel",
    von: "  return (Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) / 2;",
    nach: "  return Math.abs(dq) + Math.abs(dr);",
    schuetzt: "Hex-Geometrie (Nachbarn haben Distanz 1)",
  },
  {
    name: "M6 R8: Zustandsaenderung wird nicht mehr geprueft",
    von: "      return !eq(a.u, b.u)",
    nach: "      return true",
    schuetzt: "Bewegung ist nicht Aenderung (T3)",
  },
  {
    name: "M7 R9: Lebensmodell wird ignoriert, alles lebt",
    von: "      const alive = lm.predicate(ctx.last, ctx.trace);",
    nach: "      const alive = true;",
    schuetzt: "Self-Loop ist kein Lebenskriterium (T5)",
  },
];

function suiteLaeuftDurch() {
  try {
    execSync("npx vitest run tests/unit/nine-rules.test.js", { stdio: "pipe", timeout: 300000 });
    return true;   // gruen
  } catch {
    return false;  // rot
  }
}

let ueberlebende = [];
try {
  console.log("Baseline: unveraenderte Suite muss GRUEN sein ...");
  if (!suiteLaeuftDurch()) {
    console.error("ABBRUCH: die Suite ist schon vor jeder Mutation rot. "
      + "Ohne gruene Baseline sagt kein Mutationsergebnis etwas aus.");
    process.exit(2);
  }
  console.log("Baseline gruen.\n");

  for (const m of MUTANTEN) {
    if (!original.includes(m.von)) {
      console.error(`FEHLER ${m.name}: Ankertext nicht gefunden -- Sonde veraltet.`);
      ueberlebende.push({ ...m, grund: "anker_fehlt" });
      continue;
    }
    writeFileSync(ZIEL, original.replace(m.von, m.nach), "utf8");
    const gruen = suiteLaeuftDurch();
    writeFileSync(ZIEL, original, "utf8");

    if (gruen) {
      console.log(`UEBERLEBT  ${m.name}`);
      console.log(`           -> ungeschuetzt: ${m.schuetzt}`);
      ueberlebende.push({ ...m, grund: "suite_blieb_gruen" });
    } else {
      console.log(`getoetet   ${m.name}`);
    }
  }
} finally {
  writeFileSync(ZIEL, original, "utf8");
  const hashNachher = createHash("sha256").update(readFileSync(ZIEL, "utf8")).digest("hex");
  console.log(`\nDatei wiederhergestellt: ${hashVorher === hashNachher ? "ja (Hash identisch)" : "NEIN -- PRUEFEN!"}`);
  if (hashVorher !== hashNachher) process.exit(3);
}

const score = ((MUTANTEN.length - ueberlebende.length) / MUTANTEN.length * 100).toFixed(1);
console.log(`\nMutation-Score: ${MUTANTEN.length - ueberlebende.length}/${MUTANTEN.length} getoetet (${score} %)`);
if (ueberlebende.length > 0) {
  console.log("Ueberlebende Mutanten bedeuten: diese Eigenschaft ist nicht abgesichert.");
  process.exit(1);
}
console.log("Alle Mutanten getoetet -- die Tests messen, was sie behaupten.");
process.exit(0);
