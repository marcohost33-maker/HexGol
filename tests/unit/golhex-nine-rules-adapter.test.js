// Tests fuer den GolHex-Adapter (src/lib/golhex-nine-rules-adapter.js).
//
// Der Adapter ist die Stelle, an der Modellentscheidungen getroffen werden. Genau
// dort entstehen die Fehler, die spaeter niemand mehr sieht: eine erfundene Groesse,
// damit ein Feld gruen wird. Diese Suite sichert vor allem ab, dass der Adapter
// EHRLICH bleibt -- also N/A meldet, wo die Entitaet nichts hergibt.

import { describe, it, expect } from "vitest";
import { baueTrace, bewerteGolHex, CA_LIFE, NICHT_ANWENDBAR } from "../../src/lib/golhex-nine-rules-adapter.js";
import { STATUS } from "../../src/lib/nine-rules.js";

const buf = (pop, active) => ({ pop, active: active ?? pop.map(() => 1) });
const statusOf = (rep, id) => rep.rules.find((r) => r.id === id)?.status;

describe("Trace-Bau", () => {
  it("uebersetzt den Ringpuffer in Zustaende, aelteste zuerst", () => {
    const t = baueTrace(buf([3, 5, 4]), 10);
    expect(t).toHaveLength(3);
    expect(t.map((s) => s.u)).toEqual([3, 5, 4]);
    // Generationen zaehlen rueckwaerts vom aktuellen Stand.
    expect(t.map((s) => s.gen)).toEqual([8, 9, 10]);
  });

  it("fuehrt bewusst KEINE Position -- eine Population hat keinen Ort", () => {
    for (const s of baueTrace(buf([1, 2]), 5)) expect(s.q).toBeUndefined();
  });

  it("vertraegt einen leeren oder fehlenden Puffer", () => {
    expect(baueTrace(null)).toEqual([]);
    expect(baueTrace({ pop: [] })).toEqual([]);
  });
});

describe("Ehrlichkeit: was das Modell ueber eine Population NICHT sagen kann", () => {
  it("R5 und R6 sind gar nicht erst aktiviert", () => {
    const rep = bewerteGolHex(buf([1, 2, 3]), 3);
    const ids = rep.rules.map((r) => r.id);
    for (const aus of NICHT_ANWENDBAR) expect(ids).not.toContain(aus);
  });

  it("es wird keine Position erfunden, um R6 gruen zu bekommen", () => {
    // Der Test ist der Punkt: waere irgendwo ein Schwerpunkt berechnet worden,
    // saehe R6 plausibel aus und behauptete etwas ueber eine Entitaet ohne Ort.
    const rep = bewerteGolHex(buf([1, 5, 2]), 3);
    expect(rep.rules.find((r) => r.id === "R6")).toBeUndefined();
  });
});

describe("Regeln gegen echte Populationsverlaeufe", () => {
  it("wachsende Population: R2 meldet Entwicklung (vorlaeufig, solange es laeuft)", () => {
    const rep = bewerteGolHex(buf([2, 4, 7, 11]), 3, { laeuft: true });
    expect(statusOf(rep, "R2")).toBe(STATUS.PASS_VORLAEUFIG);
  });

  it("Population mit Delle zaehlt trotzdem als Entwicklung (ORDERED, nicht MONOTONE)", () => {
    // Ein Muster darf schrumpfen und sich erholen. Unter MONOTONE waere das FAIL --
    // genau deshalb ist ORDERED der Default fuer diese Domaene.
    const rep = bewerteGolHex(buf([2, 9, 5, 14]), 3);
    expect(statusOf(rep, "R2")).toBe(STATUS.PASS_VORLAEUFIG);
  });

  it("schrumpfende Population: R2 noch nicht erfuellt, aber nicht endgueltig gescheitert", () => {
    const rep = bewerteGolHex(buf([20, 12, 5]), 3, { laeuft: true });
    expect(statusOf(rep, "R2")).toBe(STATUS.FAIL_VORLAEUFIG);
  });

  it("ausgestorbene Population: R7 ist definitiv erfuellt", () => {
    const rep = bewerteGolHex(buf([5, 2, 0]), 3);
    expect(statusOf(rep, "R7")).toBe(STATUS.PASS);
  });

  it("lebende Population, angehaltene Simulation: R7 wird definitiv FAIL", () => {
    // Der Trace ist abgeschlossen und endete nie terminal.
    const rep = bewerteGolHex(buf([5, 6, 7]), 3, { laeuft: false });
    expect(statusOf(rep, "R7")).toBe(STATUS.FAIL);
  });

  it("konstante Population: R8 meldet keine Aenderung", () => {
    expect(statusOf(bewerteGolHex(buf([7, 7, 7]), 3), "R8")).toBe(STATUS.FAIL);
  });

  it("erster Frame: R3 hat noch keine Vergangenheit", () => {
    expect(statusOf(bewerteGolHex(buf([4]), 0), "R3")).toBe(STATUS.UNOBSERVED);
  });
});

describe("LifeModel CA-Life traegt seine Grenze mit", () => {
  it("ist als MODEL/PROXY gekennzeichnet, nicht als Lebensbeweis", () => {
    const rep = bewerteGolHex(buf([3, 4, 5]), 3);
    expect(rep.rules.find((r) => r.id === "R9").claimTier).toBe("MODEL/PROXY");
  });

  it("ausgestorben ist nicht lebendig", () => {
    expect(CA_LIFE.predicate({ u: 0, aktiv: 0 }, [{ u: 1, aktiv: 1 }, { u: 0, aktiv: 0 }])).toBe(false);
  });

  it("erstarrt ist nicht lebendig -- Stillstand zaehlt nicht als Leben", () => {
    const eingefroren = Array.from({ length: 8 }, () => ({ u: 12, aktiv: 0 }));
    expect(CA_LIFE.predicate(eingefroren[7], eingefroren)).toBe(false);
  });

  it("aktive Population gilt als lebendig", () => {
    const aktiv = [{ u: 10, aktiv: 3 }, { u: 12, aktiv: 4 }];
    expect(CA_LIFE.predicate(aktiv[1], aktiv)).toBe(true);
  });

  it("ein einzelner Frame reicht dem LifeModel nicht", () => {
    expect(CA_LIFE.predicate({ u: 5, aktiv: 2 }, [{ u: 5, aktiv: 2 }])).toBe(false);
  });
});

describe("Robustheit", () => {
  it("leerer Puffer kippt die Auswertung nicht", () => {
    const rep = bewerteGolHex(buf([]), 0);
    expect(rep.rules).toHaveLength(7);
    expect(rep.overall).not.toBe(STATUS.PASS);
  });

  it("keine Regel meldet einen Konfigurationsfehler -- der Adapter ist vollstaendig", () => {
    // Faengt die haeufigste Adapter-Panne: eine Pflichtkonfiguration vergessen.
    const rep = bewerteGolHex(buf([1, 2, 3]), 3);
    for (const r of rep.rules) expect(r.status).not.toBe(STATUS.CONFIG_ERROR);
  });
});
