// Tests fuer den GolHex-Adapter (src/lib/golhex-nine-rules-adapter.js).
//
// Der Adapter ist die Stelle, an der Modellentscheidungen getroffen werden. Genau
// dort entstehen die Fehler, die spaeter niemand mehr sieht: eine erfundene Groesse,
// damit ein Feld gruen wird. Diese Suite sichert vor allem ab, dass der Adapter
// EHRLICH bleibt -- also N/A meldet, wo die Entitaet nichts hergibt.

import { describe, it, expect } from "vitest";
import {
  baueTrace, bewerteGolHex, CA_LIFE, NICHT_ANWENDBAR, schwerpunkt, uebergangsKlassen, RBAR_MIN,
} from "../../src/lib/golhex-nine-rules-adapter.js";
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

  it("ohne erhobene Ortsdaten wird KEINE Position erfunden (unbestimmt, nicht geraten)", () => {
    for (const s of baueTrace(buf([1, 2]), 5)) {
      expect(s.q).toBeUndefined();
      expect(typeof s.qUnbekannt).toBe("string");
    }
  });

  it("vertraegt einen leeren oder fehlenden Puffer", () => {
    expect(baueTrace(null)).toEqual([]);
    expect(baueTrace({ pop: [] })).toEqual([]);
  });
});

describe("Ehrlichkeit: alle neun Regeln sind aktiv, Unbestimmtes bleibt UNKNOWN", () => {
  it("keine Regel ist mehr abgeschaltet", () => {
    expect(NICHT_ANWENDBAR).toEqual([]);
    const ids = bewerteGolHex(buf([1, 2, 3]), 3).rules.map((r) => r.id);
    expect(ids).toEqual(["R1", "R2", "R3", "R4", "R5", "R6", "R7", "R8", "R9"]);
  });

  it("ohne Ortsdaten ist R6 UNOBSERVED -- weder erfundenes PASS noch N/A", () => {
    const rep = bewerteGolHex(buf([1, 5, 2]), 3);
    expect(statusOf(rep, "R6")).toBe(STATUS.UNOBSERVED);
    expect(statusOf(rep, "R5")).toBe(STATUS.UNOBSERVED);
    expect(statusOf(rep, "R4")).toBe(STATUS.UNOBSERVED);
  });
});

// --- Erhobene Trace-Groessen (2026-11-22) -----------------------------------
// Puffer mit `extra` je Probe, wie App.tsx ihn ueber pushSample fuellt.
const bufX = (pop, extra) => ({ pop, active: pop.map(() => 1), extra });
const schritt = (births, deaths, zellen = 100, rest = {}) => ({ schritt: true, births, deaths, zellen, ...rest });
const ruleOf = (rep, id) => rep.rules.find((r) => r.id === id);

/** Gitter R x C (odd-r offset), lebend an den gegebenen [row, col]. */
function gitter(R, C, zellen) {
  const col = new Uint8Array(R * C);
  for (const [r, c] of zellen) col[r * C + c] = 1;
  return col;
}

describe("Schwerpunkt der lebenden Zellen (Grundlage fuer R5/R6)", () => {
  it("Rand-Topologie: Einzelzelle liegt auf ihrer eigenen axialen Koordinate", () => {
    // odd-r (row 2, col 3) -> axial q = 3 - (2 - 0)/2 = 2, r = 2
    expect(schwerpunkt(gitter(6, 6, [[2, 3]]), 6, 6, { topologie: "edge" }).pos).toEqual({ q: 2, r: 2 });
  });

  it("Rand-Topologie: Mittel ueber mehrere Zellen, auf die naechste Zelle gerundet", () => {
    // (2,1) und (2,3) -> axial (0,2) und (2,2) -> Mittel (1,2)
    expect(schwerpunkt(gitter(6, 6, [[2, 1], [2, 3]]), 6, 6, { topologie: "edge" }).pos).toEqual({ q: 1, r: 2 });
  });

  it("leere Population hat keinen Schwerpunkt", () => {
    const s = schwerpunkt(gitter(4, 4, []), 4, 4, { topologie: "edge" });
    expect(s.pos).toBeUndefined();
    expect(s.grund).toMatch(/keine lebende Zelle/);
  });

  it("Torus: Haufen ueber die Naht liegt AN der Naht, nicht in der Gittermitte", () => {
    // Spalten 9, 0, 1 in Reihe 4 eines 10x10-Torus. Das arithmetische Mittel waere
    // Spalte 3.3 (Gittermitte, falsch); das Kreismittel ist Spalte 0.
    const s = schwerpunkt(gitter(10, 10, [[4, 9], [4, 0], [4, 1]]), 10, 10, { topologie: "torus" });
    expect(s.pos).toEqual({ q: -2, r: 4 }); // offset (4,0) -> q = 0 - 2
    expect(s.periode).toEqual({ R: 10, C: 10 });
  });

  it("Torus: ueber eine Achse gleichverteilte Population hat KEINEN Schwerpunkt", () => {
    const ring = Array.from({ length: 10 }, (_, c) => [4, c]);
    const s = schwerpunkt(gitter(10, 10, ring), 10, 10, { topologie: "torus" });
    expect(s.pos).toBeUndefined();
    expect(s.grund).toMatch(/verteilt/);
    expect(RBAR_MIN).toBeGreaterThan(0);
  });

  it("andere Topologien (z. B. Kreis + Torus = RP2) bleiben unbestimmt", () => {
    const s = schwerpunkt(gitter(6, 6, [[2, 2]]), 6, 6, { topologie: "rp2" });
    expect(s.pos).toBeUndefined();
    expect(s.grund).toMatch(/rp2/);
  });
});

describe("R6 Bewegt / R5 Richtung auf dem Schwerpunkt", () => {
  const pos = (q, r, rest = {}) => schritt(0, 0, 100, { pos: { q, r }, ...rest });

  it("Schwerpunkt wandert axial: R6 PASS, R5 PASS mit D6-Richtung", () => {
    const rep = bewerteGolHex(bufX([5, 5], [pos(0, 0), pos(2, 0)]), 1);
    expect(statusOf(rep, "R6")).toBe(STATUS.PASS);
    expect(statusOf(rep, "R5")).toBe(STATUS.PASS);
    expect(ruleOf(rep, "R5").evidence).toMatch(/\(1,0\)/);
  });

  it("Schwerpunkt steht: R6 FAIL, R5 N/A (ohne Bewegung keine Richtung)", () => {
    const rep = bewerteGolHex(bufX([5, 5], [pos(3, 1), pos(3, 1)]), 1);
    expect(statusOf(rep, "R6")).toBe(STATUS.FAIL);
    expect(statusOf(rep, "R5")).toBe(STATUS.NA);
    expect(ruleOf(rep, "R5").evidence).toMatch(/unbewegt/);
  });

  it("schraege Verschiebung: R6 PASS, R5 UNKNOWN statt auf eine D6-Richtung gerundet", () => {
    const rep = bewerteGolHex(bufX([5, 5], [pos(0, 0), pos(1, 1)]), 1);
    expect(statusOf(rep, "R6")).toBe(STATUS.PASS);
    expect(statusOf(rep, "R5")).toBe(STATUS.UNOBSERVED);
  });

  it("unbestimmter Schwerpunkt: R6 und R5 UNKNOWN mit Grund", () => {
    const rep = bewerteGolHex(bufX([5, 5], [pos(0, 0), schritt(0, 0, 100, { posGrund: "gleich verteilt" })]), 1);
    expect(statusOf(rep, "R6")).toBe(STATUS.UNOBSERVED);
    expect(ruleOf(rep, "R6").evidence).toMatch(/gleich verteilt/);
    expect(statusOf(rep, "R5")).toBe(STATUS.UNOBSERVED);
  });

  it("Torus: Schritt ueber die Naht ist EIN Schritt (Minimalbild), nicht ein Sprung quer", () => {
    const periode = { R: 10, C: 10 };
    // offset (4,9) -> q = 9-2 = 7 ; offset (4,0) -> q = -2. Roh-Differenz -9, kuerzeste +1.
    const rep = bewerteGolHex(bufX([5, 5], [pos(7, 4, { periode }), pos(-2, 4, { periode })]), 1);
    expect(statusOf(rep, "R5")).toBe(STATUS.PASS);
    expect(ruleOf(rep, "R5").evidence).toMatch(/\(1,0\)/);
  });
});

describe("R4 Unterscheidet: der Schritt behandelt Zellen gleichen Vorzustands verschieden", () => {
  it("Uebergangsklassen werden aus Pop/Geburten/Toden/Domaene abgeleitet", () => {
    // pop jetzt 7, 3 Geburten, 5 Tode, 100 Zellen: vorher lebend = 7-3+5 = 9
    // -> ueberlebt 4, gestorben 5, geboren 3, leer geblieben 100-9-3 = 88
    expect(uebergangsKlassen(7, 3, 5, 100).klassen).toEqual([
      { vor: 1, nach: 1, n: 4 }, { vor: 1, nach: 0, n: 5 },
      { vor: 0, nach: 1, n: 3 }, { vor: 0, nach: 0, n: 88 },
    ]);
  });

  it("inkonsistente Zaehlung ergibt keinen Vergleichsraum", () => {
    expect(uebergangsKlassen(2, 5, 0, 100).grund).toMatch(/inkonsistent/);
  });

  it("ERSTARRT unterscheidet NICHT (Befund B3 2026-08-11 andersherum war falsch)", () => {
    const rep = bewerteGolHex(bufX([9, 9], [schritt(0, 0), schritt(0, 0)]), 1);
    expect(statusOf(rep, "R4")).toBe(STATUS.FAIL);
  });

  it("teilweise sterbend unterscheidet: Ueberlebende und Gestorbene gleichen Vorzustands", () => {
    const rep = bewerteGolHex(bufX([9, 5], [schritt(0, 0), schritt(0, 4)]), 1);
    expect(statusOf(rep, "R4")).toBe(STATUS.PASS);
  });

  it("Geburt nur an manchen leeren Zellen unterscheidet ebenfalls", () => {
    const rep = bewerteGolHex(bufX([4, 7], [schritt(0, 0), schritt(3, 0)]), 1);
    expect(statusOf(rep, "R4")).toBe(STATUS.PASS);
  });

  it("vollstaendiges Aussterben in einem Schritt behandelt alle Lebenden gleich -> FAIL", () => {
    const rep = bewerteGolHex(bufX([9, 0], [schritt(0, 0), schritt(0, 9)]), 1);
    expect(statusOf(rep, "R4")).toBe(STATUS.FAIL);
  });

  it("Probe ohne Simulationsschritt (Malen, Laden) ist UNKNOWN, nicht FAIL", () => {
    const rep = bewerteGolHex(bufX([9, 10], [schritt(0, 0), { schritt: false }]), 1);
    expect(statusOf(rep, "R4")).toBe(STATUS.UNOBSERVED);
    expect(ruleOf(rep, "R4").evidence).toMatch(/kein Simulationsschritt/);
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

describe("Das Gesamturteil muss VARIIEREN koennen", () => {
  // Der Test, der Befund B1 gefangen haette. Die erste Fassung meldete fuer JEDEN
  // Zustand `overall: FAIL` -- 40'000 von 40'000 geprueften Traces -- weil R1 eine
  // Position verlangte, die der Adapter bewusst nicht liefert. Im UI sah der Nutzer
  // ein dauerhaftes, als endgueltig deklariertes Fehlurteil.
  //
  // Die alte Assertion `expect(overall).not.toBe(PASS)` konnte das nicht sehen: sie
  // ist fuer eine Konstante FAIL immer erfuellt. Eine Pruefung, die eine Konstante
  // durchlaesst, misst nichts -- genau die Klasse, die dieses Projekt bekaempft.
  it("ueber viele Verlaeufe entstehen MEHRERE verschiedene Gesamturteile", () => {
    const gesehen = new Set();
    for (let n = 0; n <= 10; n++) {
      for (const laeuft of [true, false]) {
        const pop = Array.from({ length: n }, (_, i) => (i * 7) % 13);
        const act = Array.from({ length: n }, (_, i) => (i * 3) % 5);
        gesehen.add(bewerteGolHex(buf(pop, act), n, { laeuft }).overall);
      }
    }
    expect(gesehen.size).toBeGreaterThan(1);
  });

  it("eine lebendige Simulation wird NICHT als endgueltig gescheitert gemeldet", () => {
    const rep = bewerteGolHex(buf([4, 7, 9, 12], [2, 3, 4, 5]), 3, { laeuft: true });
    expect(rep.overall).not.toBe(STATUS.FAIL);
    expect(statusOf(rep, "R1")).toBe(STATUS.PASS); // ortlose Entitaet ist gueltig
  });

  it("kein Urteil ohne Evidenz: leerer Puffer erzeugt kein definitives FAIL", () => {
    const rep = bewerteGolHex(buf([]), 0);
    expect(rep.overall).not.toBe(STATUS.FAIL);
    expect(statusOf(rep, "R9")).toBe(STATUS.UNOBSERVED);
  });
});

describe("Praefix-Monotonie: definitive TRACE-Urteile duerfen nie kippen", () => {
  // Als TEST ueber alle Regeln und alle Praefixe, nicht als Zusicherung im Kommentar.
  // Genau so wurden K3 (R3/R9/R2 kippten trotz stabilUeberTrace) gefunden.
  it("ueber jeden Praefix jedes Verlaufs bleibt ein definitives Urteil bestehen", () => {
    const verlaeufe = [
      { pop: [3, 5, 2, 8, 0, 4], act: [1, 2, 0, 3, 0, 1] },
      { pop: [9, 9, 9, 9], act: [0, 0, 0, 0] },
      { pop: [1, 2, 3, 4, 5], act: [1, 1, 1, 1, 1] },
      { pop: [10, 6, 3, 1, 0], act: [4, 3, 2, 1, 0] },
    ];
    let beobachtet = 0;
    for (const v of verlaeufe) {
      const fest = new Map();
      for (let n = 1; n <= v.pop.length; n++) {
        const rep = bewerteGolHex(buf(v.pop.slice(0, n), v.act.slice(0, n)), n - 1, { laeuft: true });
        for (const r of rep.rules) {
          if (!r.stabilUeberTrace) continue;
          if (fest.has(r.id)) { expect(r.status).toBe(fest.get(r.id)); beobachtet++; }
          else fest.set(r.id, r.status);
        }
      }
    }
    // Ohne diese Zusicherung waere der Test gruen, auch wenn er nie etwas sah.
    expect(beobachtet).toBeGreaterThan(0);
  });
});

describe("Robustheit", () => {
  it("leerer Puffer kippt die Auswertung nicht", () => {
    const rep = bewerteGolHex(buf([]), 0);
    expect(rep.rules).toHaveLength(9);
  });

  it("keine Regel meldet einen Konfigurationsfehler -- der Adapter ist vollstaendig", () => {
    // Faengt die haeufigste Adapter-Panne: eine Pflichtkonfiguration vergessen.
    const rep = bewerteGolHex(buf([1, 2, 3]), 3);
    for (const r of rep.rules) expect(r.status).not.toBe(STATUS.CONFIG_ERROR);
  });
});
