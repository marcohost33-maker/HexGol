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
  STATUS, SCOPE, RULES, D6, SPEC_VERSION,
} from "../../src/lib/nine-rules.js";

// Hilfen: kompakte Zustaende bauen.
const S = (u, q = 0, r = 0, extra = {}) => ({ u, q: { q, r }, ...extra });
const statusOf = (report, id) => report.rules.find((x) => x.id === id).status;

describe("Pflicht-Gegenbeispiele T1-T6 aus der Spezifikation", () => {
  it("T1 Pendel/Zyklus: Aendern ist nicht Werden (R8 PASS, R2 FAIL)", () => {
    // Ein Pendel wechselt staendig den Zustand, entwickelt sich aber nicht.
    const trace = [S(0), S(1), S(0), S(1)].map((s, i) => ({ ...s, a: i % 2 }));
    const rep = evaluateNineRules(trace, { progressVariable: (s) => s.a });
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
    const rep = evaluateNineRules(trace, { lifeModel: autopoiesis });
    expect(statusOf(rep, "R9")).toBe(STATUS.FAIL);
    expect(rep.rules.find((x) => x.id === "R9").claimTier).toBe("MODEL/PROXY");
  });

  it("T6 initialer Frame: Vergangenheit nicht vortaeuschen (R1 PASS, R3 UNOBSERVED)", () => {
    const rep = evaluateNineRules([S(1)]);
    expect(statusOf(rep, "R1")).toBe(STATUS.PASS);
    expect(statusOf(rep, "R3")).toBe(STATUS.UNOBSERVED);
  });
});

describe("Fail-closed: fehlende Konfiguration ergibt N/A, niemals PASS", () => {
  // Das ist die wichtigste Sicherheitseigenschaft des Modells. Eine nicht
  // konfigurierte Regel darf nicht wie eine erfuellte aussehen.
  const trace = [S(1), S(2)];

  it.each([
    ["R2", "progressVariable"],
    ["R4", "population"],
    ["R7", "terminalPredicate"],
    ["R9", "lifeModel"],
  ])("%s ist N/A ohne %s", (id) => {
    const rep = evaluateNineRules(trace, {});
    expect(statusOf(rep, id)).toBe(STATUS.NA);
  });

  it("R5 ist N/A, wenn der Zustand gar keine Orientierung fuehrt", () => {
    expect(statusOf(evaluateNineRules(trace, {}), "R5")).toBe(STATUS.NA);
  });

  it("keine Regel liefert PASS allein aus fehlender Konfiguration", () => {
    const rep = evaluateNineRules(trace, {});
    const konfigAbhaengig = rep.rules.filter((r) => r.deps.length > 0 && r.id !== "R3" && r.id !== "R6");
    for (const r of konfigAbhaengig) expect(r.status).not.toBe(STATUS.PASS);
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

  it("R2 Monotoniebruch ist SOFORT definitiv FAIL, auch auf laufendem Trace", () => {
    // Anders als das fehlende F ist ein gebrochenes G durch keine Fortsetzung
    // mehr zu retten -- deshalb endgueltig.
    const fallend = [{ ...S(1), a: 5 }, { ...S(1), a: 3 }];
    const st = statusOf(evaluateNineRules(fallend, { progressVariable: (s) => s.a }), "R2");
    expect(st).toBe(STATUS.FAIL);
    expect(istDefinitiv(st)).toBe(true);
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
  // Ein einmal DEFINITIVES Urteil darf durch keine Trace-Verlaengerung kippen.
  // Vorlaeufige duerfen sich bewegen. Diese Eigenschaft faengt nahezu jeden
  // Semantikfehler in temporaler Auswertung.
  it("definitive Verdikte bleiben stabil, wenn der Trace waechst", () => {
    const cfg = {
      progressVariable: (s) => s.a,
      terminalPredicate: (s) => s.z === "end",
      population: (s) => [s.u, s.u + 1],
    };
    // Ein Trace, der unterwegs terminal wird UND die Monotonie bricht.
    const voll = [
      { ...S(0), a: 0 },
      { ...S(1, 1, 0), a: 1, z: "end" },
      { ...S(2, 2, 0), a: 0 },
      { ...S(3, 3, 0), a: 5 },
    ];
    const definitivBei = new Map();
    for (let n = 1; n <= voll.length; n++) {
      const rep = evaluateNineRules(voll.slice(0, n), cfg);
      for (const r of rep.rules) {
        if (definitivBei.has(r.id)) {
          // war schon definitiv -> muss identisch bleiben
          expect(r.status).toBe(definitivBei.get(r.id));
        } else if (istDefinitiv(r.status)) {
          definitivBei.set(r.id, r.status);
        }
      }
    }
    // Der Test waere wertlos, wenn nie ein definitives Verdikt entstanden waere.
    expect(definitivBei.size).toBeGreaterThan(0);
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

  it("die neun Regeln decken alle drei Geltungsbereiche ab", () => {
    const scopes = new Set(RULES.map((r) => r.scope));
    expect(scopes).toEqual(new Set([SCOPE.STATE, SCOPE.TRANSITION, SCOPE.TRACE]));
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

describe("R1 erkennt ungueltige Zustaende", () => {
  it("fehlende Position ist FAIL, nicht PASS", () => {
    expect(statusOf(evaluateNineRules([{ u: 1 }]), "R1")).toBe(STATUS.FAIL);
  });
});

describe("R4 Vergleichsraum", () => {
  it("PASS bei Unterschied", () => {
    const rep = evaluateNineRules([S(1)], { population: () => [1, 1, 2] });
    expect(statusOf(rep, "R4")).toBe(STATUS.PASS);
  });
  it("FAIL bei lauter Gleichen", () => {
    const rep = evaluateNineRules([S(1)], { population: () => [4, 4, 4] });
    expect(statusOf(rep, "R4")).toBe(STATUS.FAIL);
  });
  it("UNOBSERVED bei zu kleinem Vergleichsraum", () => {
    const rep = evaluateNineRules([S(1)], { population: () => [4] });
    expect(statusOf(rep, "R4")).toBe(STATUS.UNOBSERVED);
  });
});
