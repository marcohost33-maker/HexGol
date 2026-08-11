// Tests fuer das 9-Regel-Modell (src/lib/nine-rules.js).
//
// T1-T6 sind die PFLICHT-Gegenbeispiele aus der Spezifikation (007acc-Wissens-
// transfer vom 11.08.2026, Abschnitt 9). Sie sind dort ausdruecklich als
// "Pflicht-Testorakel" gefuehrt: Jedes davon trennt zwei Begriffe, die man leicht
// verwechselt -- und genau diese Verwechslungen waren die Fehler der Vorentwuerfe.
//
// Danach folgen Faelle, die die Spezifikation OFFEN laesst und die ich beim Bau
// entscheiden musste: die Aggregations-Tafel, die Auswertung temporaler Regeln auf
// endlichen Traces, und der fail-closed-Pfad.

import { describe, it, expect } from "vitest";
import {
  evaluateNineRules, andAll, hexDistance, isValidDirection, istDefinitiv,
  STATUS, SCOPE, RULES, D6, SPEC_VERSION, R2_MODUS, R4_MODUS,
} from "../../src/lib/nine-rules.js";

// Hilfen: kompakte Zustaende bauen.
const S = (u, q = 0, r = 0, extra = {}) => ({ u, q: { q, r }, ...extra });
const statusOf = (report, id) => report.rules.find((x) => x.id === id).status;

describe("Pflicht-Gegenbeispiele T1-T6 aus der Spezifikation", () => {
  it("T1 Pendel/Zyklus: Aendern ist nicht Werden (R8 PASS, R2 FAIL im Profil MONOTONE)", () => {
    // Ein Pendel wechselt staendig den Zustand, entwickelt sich aber nicht.
    // Die Spec haengt diesen Fall ausdruecklich an "sofern a keine monotone Entwicklung
    // zeigt" -- also an das Profil MONOTONE.
    const trace = [S(0), S(1), S(0), S(1)].map((s, i) => ({ ...s, a: i % 2 }));
    const rep = evaluateNineRules(trace, {
      progressVariable: (s) => s.a, r2Modus: R2_MODUS.MONOTONE,
    });
    expect(statusOf(rep, "R8")).toBe(STATUS.PASS);
    expect(statusOf(rep, "R2")).toBe(STATUS.FAIL);
    // Der Gegenbeweis muss die Stelle benennen, nicht nur "falsch" sagen.
    expect(rep.rules.find((x) => x.id === "R2").counterexample).toMatchObject({ t: 2 });
  });

  it("T2 stationaeres orientiertes Objekt: Richtung ist nicht Bewegung (R5 PASS, R6 FAIL)", () => {
    const trace = [S(1, 0, 0, { d: D6[0] }), S(1, 0, 0, { d: D6[0] })];
    const rep = evaluateNineRules(trace);
    expect(statusOf(rep, "R5")).toBe(STATUS.PASS);
    expect(statusOf(rep, "R6")).toBe(STATUS.FAIL);
  });

  it("T3 bewegtes Objekt mit konstantem Zustand: Bewegung ist nicht Aenderung (R6 PASS, R8 FAIL)", () => {
    const trace = [S(7, 0, 0), S(7, 1, 0)];
    const rep = evaluateNineRules(trace);
    expect(statusOf(rep, "R6")).toBe(STATUS.PASS);
    expect(statusOf(rep, "R8")).toBe(STATUS.FAIL);
  });

  it("T4 terminaler Nichtnullzustand: Ende ist nicht Nullwert (R7 PASS trotz u != 0)", () => {
    const trace = [S(5), S(9, 0, 0, { z: "done" })];
    const rep = evaluateNineRules(trace, { terminalPredicate: (s) => s.z === "done" });
    expect(statusOf(rep, "R7")).toBe(STATUS.PASS);
    expect(trace[trace.length - 1].u).not.toBe(0); // der Punkt des Tests
  });

  it("T5 statischer Self-Loop: X->X ist kein Lebenskriterium (R9 FAIL)", () => {
    // Ein Stein hat einen Self-Loop. Waere Self-Loop = Leben, muesste er leben.
    const trace = [S(3), S(3), S(3)];
    const autopoiesis = {
      name: "Autopoiesis-Proxy", version: "0.1",
      // Verlangt Selbsterhaltung DURCH Aktivitaet, nicht blosses Gleichbleiben.
      predicate: (_last, tr) => tr.some((s, i) => i > 0 && s.u !== tr[i - 1].u),
    };
    // Der Trace ist abgeschlossen -- nur dann darf ein Lebensurteil endgueltig sein.
    // Auf einem laufenden Trace waere FAIL_VORLAEUFIG korrekt (Befund K3: ein
    // LifeModel wertet ueber ein Fenster, sein Urteil kann durch Fortsetzung kippen).
    const rep = evaluateNineRules(trace, { lifeModel: autopoiesis }, { traceComplete: true });
    expect(statusOf(rep, "R9")).toBe(STATUS.FAIL);
    expect(rep.rules.find((x) => x.id === "R9").claimTier).toBe("MODEL/PROXY");
    // Gegenprobe: solange der Trace laeuft, ist dasselbe Urteil nur vorlaeufig.
    expect(statusOf(evaluateNineRules(trace, { lifeModel: autopoiesis }), "R9"))
      .toBe(STATUS.FAIL_VORLAEUFIG);
  });

  it("T6 initialer Frame: Vergangenheit nicht vortaeuschen (R1 PASS, R3 UNOBSERVED)", () => {
    const rep = evaluateNineRules([S(1)]);
    expect(statusOf(rep, "R1")).toBe(STATUS.PASS);
    expect(statusOf(rep, "R3")).toBe(STATUS.UNOBSERVED);
  });
});

describe("Fail-closed: fehlende Konfiguration ergibt nie PASS", () => {
  // Die wichtigste Sicherheitseigenschaft. Spec v2.1 (§20.4) verlangt zusaetzlich, dass
  // ein FEHLENDER PFLICHTPARAMETER (CONFIG_ERROR) von echter NICHTANWENDBARKEIT (N/A)
  // unterschieden wird -- sonst verschwindet ein Bedienfehler in einer Kategorie, die
  // wie ein normales Resultat aussieht.
  const trace = [S(1), S(2)];

  it.each([
    ["R2", "progressVariable"],
    ["R4", "population"],
  ])("%s meldet CONFIG_ERROR ohne %s (Bedienfehler, nicht Nichtanwendbarkeit)", (id) => {
    expect(statusOf(evaluateNineRules(trace, {}), id)).toBe(STATUS.CONFIG_ERROR);
  });

  it.each([
    ["R7", "terminalPredicate"],
    ["R9", "lifeModel"],
  ])("%s ist N/A ohne %s", (id) => {
    expect(statusOf(evaluateNineRules(trace, {}), id)).toBe(STATUS.NA);
  });

  it("R5 ist N/A, wenn der Zustand gar keine Orientierung fuehrt", () => {
    expect(statusOf(evaluateNineRules(trace, {}), "R5")).toBe(STATUS.NA);
  });

  it("keine Regel liefert PASS allein aus fehlender Konfiguration", () => {
    const rep = evaluateNineRules(trace, {});
    const konfigAbhaengig = rep.rules.filter((r) => r.deps.length > 0 && r.id !== "R3" && r.id !== "R6");
    for (const r of konfigAbhaengig) expect(r.status).not.toBe(STATUS.PASS);
  });

  it("ein Konfigurationsfehler schlaegt auf das Gesamtergebnis durch", () => {
    // Solange die Pruefung falsch aufgebaut ist, ist ihr Ergebnis nicht deutbar.
    expect(andAll([STATUS.PASS, STATUS.CONFIG_ERROR])).toBe(STATUS.CONFIG_ERROR);
  });
});

describe("R2-Profile: Entwicklung darf Rueckschritte haben (Spec v2.1 §20.1)", () => {
  // Die erste Fassung erzwang strikte Monotonie und war damit fuer reale
  // Entwicklungsprozesse zu streng. Derselbe Trace muss je nach Profil anders urteilen --
  // sonst waeren die Profile blosse Dekoration.
  const mitDelle = [0, 3, 2, 5].map((a, i) => ({ ...S(i), a })); // netto +5, ein Rueckschritt

  it("MONOTONE bestraft den Rueckschritt", () => {
    const rep = evaluateNineRules(mitDelle, {
      progressVariable: (s) => s.a, r2Modus: R2_MODUS.MONOTONE,
    });
    expect(statusOf(rep, "R2")).toBe(STATUS.FAIL);
  });

  it("ORDERED (Default) erlaubt ihn bei Netto-Fortschritt", () => {
    const rep = evaluateNineRules(mitDelle, { progressVariable: (s) => s.a });
    expect(statusOf(rep, "R2")).toBe(STATUS.PASS_VORLAEUFIG);
  });

  it("ORDERED kippt, wenn der Rueckschritt die Toleranz sprengt", () => {
    const rep = evaluateNineRules(mitDelle, {
      progressVariable: (s) => s.a, r2ReversalToleranz: 0.5,
    });
    expect(statusOf(rep, "R2")).toBe(STATUS.FAIL);
  });

  it("MINIMAL genuegt ein einziger gerichteter Schritt -- und ist dann definitiv", () => {
    const rep = evaluateNineRules(mitDelle, {
      progressVariable: (s) => s.a, r2Modus: R2_MODUS.MINIMAL,
    });
    expect(statusOf(rep, "R2")).toBe(STATUS.PASS);
    expect(istDefinitiv(statusOf(rep, "R2"))).toBe(true);
  });
});

describe("R4-Profile: unterschieden WERDEN ist nicht unterscheiden (Spec v2.1 §20.2)", () => {
  const trace = [S(1)];
  const pop = () => [1, 2, 2];

  it("STRUCTURAL findet den Unterschied von aussen", () => {
    const rep = evaluateNineRules(trace, { population: pop, r4Modus: R4_MODUS.STRUCTURAL });
    expect(statusOf(rep, "R4")).toBe(STATUS.PASS);
  });

  it("ACTIVE (Default) verlangt einen Discriminator DES SYSTEMS", () => {
    // Ohne ihn faellt der Evaluator NICHT still auf STRUCTURAL zurueck -- das waere
    // eine andere Aussage, die gleich aussieht.
    const rep = evaluateNineRules(trace, { population: pop });
    expect(statusOf(rep, "R4")).toBe(STATUS.CONFIG_ERROR);
  });

  it("ACTIVE ist PASS, wenn das System selbst unterscheidet", () => {
    const rep = evaluateNineRules(trace, { population: pop, discriminator: (a, b) => a !== b });
    expect(statusOf(rep, "R4")).toBe(STATUS.PASS);
  });

  it("ACTIVE ist FAIL, wenn das System blind ist -- obwohl die Werte verschieden sind", () => {
    // Der Stein, der unterschieden werden kann, aber nicht unterscheidet.
    const rep = evaluateNineRules(trace, { population: pop, discriminator: () => false });
    expect(statusOf(rep, "R4")).toBe(STATUS.FAIL);
  });
});

describe("Temporale Regeln auf endlichen Traces (Safety vs. Co-Safety)", () => {
  // Der Kern, den die externe Fachrecherche korrigiert hat:
  //   SAFETY   ("immer", G) ist nie endgueltig BESTAETIGBAR  -> hoechstens PASS_VORLAEUFIG
  //   CO-SAFETY("irgendwann", F) ist nie endgueltig WIDERLEGBAR -> hoechstens FAIL_VORLAEUFIG
  // Ein Evaluator, der hier definitiv urteilt, behauptet mehr als er wissen kann.
  const konstant = [S(1), S(1), S(1)].map((s) => ({ ...s, a: 5 }));

  it("R7 laufender Trace ohne Terminalzustand -> FAIL_VORLAEUFIG, niemals FAIL", () => {
    const rep = evaluateNineRules(konstant, { terminalPredicate: (s) => s.z === "end" });
    expect(statusOf(rep, "R7")).toBe(STATUS.FAIL_VORLAEUFIG);
  });

  it("R7 abgeschlossener Trace ohne Terminalzustand -> FAIL (definitiv)", () => {
    const rep = evaluateNineRules(konstant, { terminalPredicate: (s) => s.z === "end" },
      { traceComplete: true });
    expect(statusOf(rep, "R7")).toBe(STATUS.FAIL);
  });

  it("R7 gefundener Terminalzustand ist SOFORT definitiv PASS (good prefix)", () => {
    const tr = [S(1), S(2, 0, 0, { z: "end" }), S(3)];
    const rep = evaluateNineRules(tr, { terminalPredicate: (s) => s.z === "end" });
    expect(statusOf(rep, "R7")).toBe(STATUS.PASS);
    expect(istDefinitiv(statusOf(rep, "R7"))).toBe(true);
  });

  it("R2 gibt auf laufendem Trace NIE definitives PASS -- der G-Teil bleibt widerlegbar", () => {
    const wachsend = [0, 1, 2, 3].map((i) => ({ ...S(i), a: i }));
    const cfg = { progressVariable: (s) => s.a };
    expect(statusOf(evaluateNineRules(wachsend, cfg), "R2")).toBe(STATUS.PASS_VORLAEUFIG);
    // Erst der abgeschlossene Trace erlaubt das definitive Urteil.
    expect(statusOf(evaluateNineRules(wachsend, cfg, { traceComplete: true }), "R2")).toBe(STATUS.PASS);
  });

  it("R2 konstante Groesse: FAIL_VORLAEUFIG solange der Trace laeuft, FAIL wenn abgeschlossen", () => {
    const cfg = { progressVariable: (s) => s.a };
    expect(statusOf(evaluateNineRules(konstant, cfg), "R2")).toBe(STATUS.FAIL_VORLAEUFIG);
    expect(statusOf(evaluateNineRules(konstant, cfg, { traceComplete: true }), "R2")).toBe(STATUS.FAIL);
  });

  it("R2/MONOTONE: Monotoniebruch ist SOFORT definitiv FAIL, auch auf laufendem Trace", () => {
    // Im Profil MONOTONE ist G(a_next >= a) SAFETY: ein gebrochenes G ist durch keine
    // Fortsetzung mehr zu retten -- deshalb endgueltig. Im Default ORDERED gilt das
    // NICHT, dort zaehlt der Netto-Fortschritt und ein Rueckschritt ist erlaubt.
    const fallend = [{ ...S(1), a: 5 }, { ...S(1), a: 3 }];
    const cfg = { progressVariable: (s) => s.a };
    const st = statusOf(evaluateNineRules(fallend, { ...cfg, r2Modus: R2_MODUS.MONOTONE }), "R2");
    expect(st).toBe(STATUS.FAIL);
    expect(istDefinitiv(st)).toBe(true);
    // Gegenprobe: derselbe Trace ist unter ORDERED nur vorlaeufig gescheitert.
    expect(statusOf(evaluateNineRules(fallend, cfg), "R2")).toBe(STATUS.FAIL_VORLAEUFIG);
  });

  it("R2 mit nur einem Zustand ist N/A -- ein G ueber nichts ist vakuum-wahr", () => {
    // Ohne diesen Guard meldete die Logik 'monoton', obwohl kein Uebergang existiert.
    const rep = evaluateNineRules([{ ...S(1), a: 5 }], { progressVariable: (s) => s.a });
    expect(statusOf(rep, "R2")).toBe(STATUS.NA);
  });

  it("Uebergangsregeln sind ohne Nachfolger N/A, nicht FAIL (schwaches Next)", () => {
    const rep = evaluateNineRules([S(1)]);
    expect(statusOf(rep, "R6")).toBe(STATUS.NA);
    expect(statusOf(rep, "R8")).toBe(STATUS.NA);
  });
});

describe("Monotonie der Verdikte -- der Koenigs-Test", () => {
  // KORRIGIERT nach unabhaengiger Pruefung: Die erste Fassung behauptete Stabilitaet
  // fuer ALLE Regeln. Das ist falsch und wurde widerlegt -- bei 6 von 9 kippte ein
  // "definitives" PASS. Der Fehler lag in der Zusicherung, nicht im Urteil:
  // Nur TRACE-Regeln urteilen ueber den Verlauf; STATE/TRANSITION urteilen ueber den
  // Zeitpunkt und duerfen sich mit ihm aendern.
  const cfg = {
    progressVariable: (s) => s.a,
    terminalPredicate: (s) => s.z === "end",
    population: (s) => [s.u, s.u + 1],
    discriminator: (a, b) => a !== b,
  };
  const voll = [
    { ...S(0), a: 0 },
    { ...S(1, 1, 0), a: 1, z: "end" },
    { ...S(2, 2, 0), a: 0 },
    { ...S(3, 3, 0), a: 5 },
  ];

  it("TRACE-Verdikte, die definitiv wurden, bleiben es bei jeder Verlaengerung", () => {
    const definitivBei = new Map();
    let geprueft = 0;
    for (let n = 1; n <= voll.length; n++) {
      for (const r of evaluateNineRules(voll.slice(0, n), cfg).rules) {
        if (r.scope !== SCOPE.TRACE) continue;
        if (definitivBei.has(r.id)) {
          expect(r.status).toBe(definitivBei.get(r.id));
          geprueft++;
        } else if (istDefinitiv(r.status, r.scope)) {
          definitivBei.set(r.id, r.status);
        }
      }
    }
    // Ohne diese beiden Zusicherungen waere der Test gruen, auch wenn er nichts sah.
    expect(definitivBei.size).toBeGreaterThan(0);
    expect(geprueft).toBeGreaterThan(0);
  });

  it("STATE/TRANSITION-Verdikte sind NICHT als trace-stabil markiert", () => {
    // R7 wird bei t=1 terminal -> definitiv. R6 sagt nur etwas ueber den letzten Schritt.
    const rep = evaluateNineRules(voll, cfg);
    const r7 = rep.rules.find((r) => r.id === "R7");
    const r6 = rep.rules.find((r) => r.id === "R6");
    expect(r7.status).toBe(STATUS.PASS);
    expect(r7.stabilUeberTrace).toBe(true);
    expect(r6.stabilUeberTrace).toBe(false);
  });

  it("der Geltungsbereich im Report ueberzeichnet nicht", () => {
    const rep = evaluateNineRules(voll, cfg);
    const letzter = voll.length - 1;
    expect(rep.rules.find((r) => r.id === "R7").traceRange).toEqual([0, letzter]);          // TRACE
    expect(rep.rules.find((r) => r.id === "R6").traceRange).toEqual([letzter - 1, letzter]); // TRANSITION
    expect(rep.rules.find((r) => r.id === "R5").traceRange).toEqual([letzter, letzter]);     // STATE
  });
});

describe("Robustheit gegen Muell-Eingaben und werfende Konfiguration", () => {
  it("NaN-Koordinaten erzeugen kein Urteil, sondern einen Konfigurationsfehler", () => {
    const tr = [S(1, 0, 0), { u: 2, q: { q: NaN, r: 0 } }];
    expect(statusOf(evaluateNineRules(tr, {}), "R6")).toBe(STATUS.CONFIG_ERROR);
  });

  it("unveraendertes NaN gilt NICHT als Aenderung", () => {
    const tr = [{ u: NaN, q: { q: 0, r: 0 } }, { u: NaN, q: { q: 0, r: 0 } }];
    expect(statusOf(evaluateNineRules(tr, {}), "R8")).toBe(STATUS.FAIL);
  });

  it("eine werfende Konfigurations-Funktion reisst nicht die anderen Regeln mit", () => {
    const rep = evaluateNineRules([S(1), S(2, 1, 0)], {
      population: () => { throw new Error("kaputt"); },
    });
    expect(statusOf(rep, "R4")).toBe(STATUS.CONFIG_ERROR);
    expect(rep.rules.find((r) => r.id === "R4").evidence).toMatch(/kaputt/);
    // Die uebrigen acht haben trotzdem geurteilt.
    expect(statusOf(rep, "R6")).toBe(STATUS.PASS);
    expect(rep.rules).toHaveLength(9);
  });

  it("ein null-Eintrag im Trace kippt den Lauf nicht", () => {
    const rep = evaluateNineRules([S(1), null], {});
    expect(rep.rules).toHaveLength(9);
    expect(rep.overall).not.toBe(STATUS.PASS);
  });
});

describe("Aggregation (Kleene-stark, AND = Minimum)", () => {
  it("FAIL dominiert alles", () => {
    expect(andAll([STATUS.PASS, STATUS.FAIL, STATUS.UNOBSERVED])).toBe(STATUS.FAIL);
  });
  it("UNOBSERVED schlaegt PASS -- Unwissen wird nicht zu Zustimmung", () => {
    expect(andAll([STATUS.PASS, STATUS.UNOBSERVED])).toBe(STATUS.UNOBSERVED);
  });
  it("ein vorlaeufiges PASS zieht ein definitives NICHT hoch", () => {
    expect(andAll([STATUS.PASS, STATUS.PASS_VORLAEUFIG])).toBe(STATUS.PASS_VORLAEUFIG);
  });
  it("FAIL_VORLAEUFIG liegt unter UNOBSERVED, aber ueber FAIL", () => {
    expect(andAll([STATUS.UNOBSERVED, STATUS.FAIL_VORLAEUFIG])).toBe(STATUS.FAIL_VORLAEUFIG);
    expect(andAll([STATUS.FAIL, STATUS.FAIL_VORLAEUFIG])).toBe(STATUS.FAIL);
  });
  it("N/A wird uebersprungen -- es ist kein Wahrheitswert", () => {
    expect(andAll([STATUS.PASS, STATUS.NA, STATUS.PASS])).toBe(STATUS.PASS);
  });
  it("nur N/A ergibt N/A, nicht PASS -- 'nichts geprueft' ist kein 'alles gut'", () => {
    expect(andAll([STATUS.NA, STATUS.NA])).toBe(STATUS.NA);
  });
  it("leere Menge ergibt N/A", () => {
    expect(andAll([])).toBe(STATUS.NA);
  });
  it("weist unbekannte Status zurueck statt sie stillschweigend zu schlucken", () => {
    expect(() => andAll(["VIELLEICHT"])).toThrow(TypeError);
  });
  it("istDefinitiv trennt endgueltige von vorlaeufigen Urteilen", () => {
    expect(istDefinitiv(STATUS.PASS)).toBe(true);
    expect(istDefinitiv(STATUS.FAIL)).toBe(true);
    expect(istDefinitiv(STATUS.PASS_VORLAEUFIG)).toBe(false);
    expect(istDefinitiv(STATUS.FAIL_VORLAEUFIG)).toBe(false);
    expect(istDefinitiv(STATUS.UNOBSERVED)).toBe(false);
  });
});

describe("Hex-Geometrie", () => {
  it("Distanz zu sich selbst ist 0", () => {
    expect(hexDistance({ q: 2, r: -3 }, { q: 2, r: -3 })).toBe(0);
  });
  it("alle sechs Nachbarn haben Distanz 1", () => {
    for (const d of D6) expect(hexDistance({ q: 0, r: 0 }, d)).toBe(1);
  });
  it("Distanz ist symmetrisch", () => {
    const a = { q: 3, r: -1 }, b = { q: -2, r: 4 };
    expect(hexDistance(a, b)).toBe(hexDistance(b, a));
  });
  it("Dreiecksungleichung haelt fuer eine Stichprobe", () => {
    const pts = [{ q: 0, r: 0 }, { q: 2, r: -1 }, { q: -3, r: 2 }, { q: 1, r: 1 }];
    for (const a of pts) for (const b of pts) for (const c of pts) {
      expect(hexDistance(a, c)).toBeLessThanOrEqual(hexDistance(a, b) + hexDistance(b, c));
    }
  });
  it("erkennt ungueltige Richtungen", () => {
    expect(isValidDirection({ q: 2, r: 0 })).toBe(false);
    expect(isValidDirection(null)).toBe(false);
    expect(isValidDirection(D6[3])).toBe(true);
  });
});

describe("Vertrag des Reports", () => {
  const trace = [S(1), S(2, 1, 0)];

  it("jede Regel traegt Geltungsbereich, Status und Evidenz", () => {
    const rep = evaluateNineRules(trace);
    expect(rep.rules).toHaveLength(9);
    for (const r of rep.rules) {
      expect(Object.values(SCOPE)).toContain(r.scope);
      expect(Object.values(STATUS)).toContain(r.status);
      expect(typeof r.evidence).toBe("string");
      expect(r.evidence.length).toBeGreaterThan(0); // eine Aussage ohne Begruendung ist wertlos
      expect(r.specVersion).toBe(SPEC_VERSION);
    }
  });

  it("jede Regel traegt einen gueltigen Geltungsbereich, und die tragenden sind belegt", () => {
    const scopes = new Set(RULES.map((r) => r.scope));
    // Jeder verwendete Scope muss deklariert sein -- kein freihändiger String.
    for (const s of scopes) expect(Object.values(SCOPE)).toContain(s);
    // Die drei zeitlichen Grundtypen muessen vorkommen; CLASSIFIER kam mit Spec v2.1
    // dazu (R4 "unterscheidet" ist eine Systemleistung, kein Zustandsmerkmal).
    for (const s of [SCOPE.STATE, SCOPE.TRANSITION, SCOPE.TRACE]) expect(scopes).toContain(s);
    expect(scopes).toContain(SCOPE.CLASSIFIER);
  });

  it("Replay ist deterministisch: gleicher Trace -> identischer Report", () => {
    const cfg = { progressVariable: (s) => s.u, terminalPredicate: (s) => s.u > 5 };
    const a = evaluateNineRules(trace, cfg);
    const b = evaluateNineRules(trace, cfg);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("Regelauswahl wird respektiert", () => {
    const rep = evaluateNineRules(trace, {}, { enabled: ["R1", "R8"] });
    expect(rep.rules.map((r) => r.id)).toEqual(["R1", "R8"]);
  });

  it("counts summieren auf die Regelzahl", () => {
    const rep = evaluateNineRules(trace);
    const sum = Object.values(rep.counts).reduce((x, y) => x + y, 0);
    expect(sum).toBe(rep.rules.length);
  });

  it("leerer Trace kippt nicht, sondern meldet Unwissen", () => {
    const rep = evaluateNineRules([]);
    expect(statusOf(rep, "R1")).toBe(STATUS.UNOBSERVED);
    expect(rep.overall).not.toBe(STATUS.PASS);
  });

  it("weist Nicht-Arrays zurueck", () => {
    expect(() => evaluateNineRules(null)).toThrow(TypeError);
  });
});

describe("R1 fragt nach gueltiger Instanziierung, nicht nach Verortung", () => {
  // KORRIGIERTE ERWARTUNG (Befund B1). Hier stand: "fehlende Position ist FAIL".
  // Das machte R1 fuer jede ORTLOSE Entitaet zu einem definitiven FAIL -- und da FAIL
  // die Aggregation dominiert, war das Gesamturteil des GolHex-Adapters eine Konstante
  // (40'000/40'000 FAIL). Der Widerspruch lag in der eigenen Konstruktion: fuer R5/R6
  // wurde entschieden, dass eine Population keinen Ort hat, und dann verlangte R1 ihn.
  //
  // Das ist KEIN "Test an den Bau anpassen": geaendert wurde die SEMANTIK von R1 mit
  // Begruendung, und die Erwartungen unten pruefen sie schaerfer als vorher -- eine
  // GEFUEHRTE, aber kaputte Position bleibt FAIL.
  it("ein Zustand ohne Position ist gueltig -- Ortlosigkeit ist kein Defekt", () => {
    expect(statusOf(evaluateNineRules([{ u: 1 }]), "R1")).toBe(STATUS.PASS);
  });
  it("fehlender intrinsischer Wert bleibt FAIL", () => {
    expect(statusOf(evaluateNineRules([{ q: { q: 0, r: 0 } }]), "R1")).toBe(STATUS.FAIL);
    expect(statusOf(evaluateNineRules([{}]), "R1")).toBe(STATUS.FAIL);
  });
  it("wer eine Position FUEHRT, muss eine brauchbare fuehren -- beide Achsen", () => {
    // Fremd-Mutant aus der unabhaengigen Pruefung: ein Guard, der nur q pruefte,
    // ueberlebte die alte Suite. Beide Achsen muessen einzeln abgesichert sein.
    expect(statusOf(evaluateNineRules([{ u: 1, q: { q: 0 } }]), "R1")).toBe(STATUS.FAIL);
    expect(statusOf(evaluateNineRules([{ u: 1, q: { r: 0 } }]), "R1")).toBe(STATUS.FAIL);
    expect(statusOf(evaluateNineRules([{ u: 1, q: { q: NaN, r: 0 } }]), "R1")).toBe(STATUS.FAIL);
    expect(statusOf(evaluateNineRules([{ u: 1, q: { q: 0, r: Infinity } }]), "R1")).toBe(STATUS.FAIL);
  });
});

describe("Uebergangsregeln vergleichen den LETZTEN Schritt, nicht Anfang gegen Ende", () => {
  // Fremd-Mutanten aus der unabhaengigen Pruefung: R6/R8 liessen sich still von
  // "letzter Uebergang" auf "trace[0] gegen last" umdefinieren, ohne dass die Suite
  // es merkte. Folge waere: ein Objekt, das an seinen Ausgangspunkt zurueckkehrt,
  // gaelte als nie bewegt.
  it("R6: Rueckkehr zum Ausgangspunkt gilt trotzdem als Bewegung im letzten Schritt", () => {
    const rundreise = [S(1, 0, 0), S(1, 1, 0), S(1, 0, 0)];
    expect(statusOf(evaluateNineRules(rundreise, {}), "R6")).toBe(STATUS.PASS);
  });
  it("R8: Rueckkehr zum Ausgangswert gilt trotzdem als Aenderung im letzten Schritt", () => {
    const zurueck = [S(5), S(9), S(5)];
    expect(statusOf(evaluateNineRules(zurueck, {}), "R8")).toBe(STATUS.PASS);
  });
  it("R6: Stillstand im letzten Schritt ist FAIL, auch wenn frueher Bewegung war", () => {
    const angehalten = [S(1, 0, 0), S(1, 5, 0), S(1, 5, 0)];
    expect(statusOf(evaluateNineRules(angehalten, {}), "R6")).toBe(STATUS.FAIL);
  });
});

describe("R4 Vergleichsraum (Profil STRUCTURAL)", () => {
  const strukturell = (pop) => ({ population: () => pop, r4Modus: R4_MODUS.STRUCTURAL });
  it("PASS bei Unterschied", () => {
    expect(statusOf(evaluateNineRules([S(1)], strukturell([1, 1, 2])), "R4")).toBe(STATUS.PASS);
  });
  it("FAIL bei lauter Gleichen", () => {
    expect(statusOf(evaluateNineRules([S(1)], strukturell([4, 4, 4])), "R4")).toBe(STATUS.FAIL);
  });
  it("UNOBSERVED bei zu kleinem Vergleichsraum -- greift vor der Modus-Wahl", () => {
    expect(statusOf(evaluateNineRules([S(1)], strukturell([4])), "R4")).toBe(STATUS.UNOBSERVED);
  });
});
