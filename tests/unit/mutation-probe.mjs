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
    name: "M8 R2/ORDERED: behauptet definitives PASS auf laufendem Trace",
    von: "        return ctx.traceComplete\n          ? res(STATUS.PASS, `ORDERED: abgeschlossen, Netto-Fortschritt ${netto} > ${delta}`)\n          : res(STATUS.PASS_VORLAEUFIG, `ORDERED: Netto-Fortschritt ${netto} > ${delta}; noch umkehrbar`);",
    nach: "        return res(STATUS.PASS, \"ORDERED: Fortschritt\");",
    schuetzt: "Safety ist nie endgueltig bestaetigbar -- der urspruengliche Fehler",
  },
  {
    name: "M11 R2: Modus wird ignoriert, immer MONOTONE",
    von: "      const modus = ctx.config.r2Modus || R2_MODUS.ORDERED;",
    nach: "      const modus = R2_MODUS.MONOTONE;",
    schuetzt: "Entwicklung darf Rueckschritte haben (Spec v2.1)",
  },
  {
    name: "M12 R4: faellt bei fehlendem Discriminator still auf STRUCTURAL zurueck",
    von: "          return res(STATUS.CONFIG_ERROR,\n            \"Modus ACTIVE verlangt einen discriminator(a,b) des Systems; STRUCTURAL waere eine andere Aussage\");",
    nach: "          return res(STATUS.PASS, \"faellt still auf STRUCTURAL zurueck\");",
    schuetzt: "kein stiller Modus-Wechsel -- unterschieden werden ist nicht unterscheiden",
  },
  {
    name: "M9 R2: Vakuum-Guard entfernt (G ueber leerer Menge)",
    von: "      if (vals.length < 2) {\n        return res(STATUS.NA, \"weniger als zwei Zustaende -- kein Uebergang beobachtbar\");\n      }",
    nach: "      if (false) { }",
    schuetzt: "kein PASS aus Nichtbeobachtung",
  },
  {
    name: "M10 Uebergangsregel meldet FAIL statt N/A ohne Nachfolger",
    von: "      if (ctx.trace.length < 2) return res(STATUS.NA, \"kein Uebergang vorhanden (weniger als zwei Zustaende)\");\n      const a = ctx.trace[ctx.trace.length - 2], b = ctx.last;\n      // Default ist SameValueZero, nicht ===.",
    nach: "      if (ctx.trace.length < 2) return res(STATUS.FAIL, \"kein Uebergang\");\n      const a = ctx.trace[ctx.trace.length - 2], b = ctx.last;\n      // Default ist SameValueZero, nicht ===.",
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
    von: "        return res(STATUS.CONFIG_ERROR, \"R2 ist aktiv, aber keine progressVariable konfiguriert\");",
    nach: "        return res(STATUS.PASS, \"R2 ist aktiv, aber keine progressVariable konfiguriert\");",
    schuetzt: "nicht konfiguriert darf nie wie erfuellt aussehen",
  },
  {
    name: "M13 Konfigurationsfehler schlaegt nicht mehr auf die Aggregation durch",
    von: "  if (statuses.includes(STATUS.CONFIG_ERROR)) return STATUS.CONFIG_ERROR;",
    nach: "  if (false) return STATUS.CONFIG_ERROR;",
    schuetzt: "ein falsch aufgebauter Lauf darf nicht deutbar aussehen",
  },
  // --- Ab hier: FREMDE Mutanten aus der unabhaengigen Pruefung vom 2026-08-11. ---
  // Sie ueberlebten die erste Fassung der Suite und belegten, dass ein Mutation-Score
  // von 100 % gegen die EIGENE Liste nur misst, was der Autor bedacht hat. Eine
  // fremdbestimmte Liste ist der einzige ehrliche Test der eigenen Testguete.
  {
    name: "F1 validState prueft die r-Koordinate nicht mehr",
    von: "  return typeof s.q === \"object\" && isNum(s.q.q) && isNum(s.q.r);",
    nach: "  return typeof s.q === \"object\" && isNum(s.q.q);",
    schuetzt: "beide Hex-Achsen einzeln abgesichert",
  },
  {
    name: "F6 R1 verlangt wieder einen Ort (der Live-Defekt B1)",
    von: "  if (s.q === undefined || s.q === null) return true; // ortlose Entitaet -- zulaessig",
    nach: "  if (s.q === undefined || s.q === null) return false;",
    schuetzt: "ortlose Entitaeten sind gueltig -- sonst ist das Gesamturteil eine Konstante",
  },
  {
    name: "F7 R9 urteilt wieder definitiv aus dem Fenster",
    von: "      const st = ctx.traceComplete\n        ? (alive ? STATUS.PASS : STATUS.FAIL)\n        : (alive ? STATUS.PASS_VORLAEUFIG : STATUS.FAIL_VORLAEUFIG);",
    nach: "      const st = alive ? STATUS.PASS : STATUS.FAIL;",
    schuetzt: "ein Fensterurteil ist nie endgueltig",
  },
  {
    name: "F8 R9 urteilt wieder ohne Evidenz",
    von: "      if (ctx.trace.length < 2) {\n        return res(STATUS.UNOBSERVED, \"zu wenig Verlauf fuer ein Lebensurteil\",\n          { claimTier: \"MODEL/PROXY\" });\n      }",
    nach: "      if (false) { }",
    schuetzt: "kein definitives Urteil aus leerem Trace",
  },
  {
    name: "F2 traceRange behauptet fuer alle Regeln den ganzen Trace",
    von: "      r.scope === SCOPE.TRACE ? [0, letzter]\n        : r.scope === SCOPE.TRANSITION ? [Math.max(0, letzter - 1), letzter]\n          : [letzter, letzter];",
    nach: "      [0, letzter];",
    schuetzt: "der Report ueberzeichnet die Reichweite eines Urteils nicht",
  },
  {
    name: "F3 R8 vergleicht trace[0] statt des Vorgaengers",
    von: "      const a = ctx.trace[ctx.trace.length - 2], b = ctx.last;\n      // Default ist SameValueZero, nicht ===.",
    nach: "      const a = ctx.trace[0], b = ctx.last;\n      // Default ist SameValueZero, nicht ===.",
    schuetzt: "Uebergangsregel meint den LETZTEN Schritt",
  },
  {
    name: "F4 R6 vergleicht trace[0] statt des Vorgaengers",
    von: "      const a = ctx.trace[ctx.trace.length - 2], b = ctx.last;\n      if (!a?.q || !b?.q)",
    nach: "      const a = ctx.trace[0], b = ctx.last;\n      if (!a?.q || !b?.q)",
    schuetzt: "Rueckkehr zum Ausgangspunkt ist trotzdem Bewegung",
  },
  {
    name: "F5 NaN-Guard in R6 entfernt",
    von: "      if (![a.q.q, a.q.r, b.q.q, b.q.r].every(isNum)) {",
    nach: "      if (false) {",
    schuetzt: "Muell-Koordinaten erzeugen kein definitives Urteil",
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
    // BEIDE Suiten: Die Sonde lief zuerst nur gegen nine-rules.test.js -- und ein
    // Mutant ueberlebte, weil der schuetzende Test im ADAPTER-Test stand. Eine Sonde,
    // die nur einen Teil ihres Gegenstands prueft, meldet zu hohe Scores.
    execSync("npx vitest run tests/unit/nine-rules.test.js tests/unit/golhex-nine-rules-adapter.test.js",
      { stdio: "pipe", timeout: 300000 });
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
