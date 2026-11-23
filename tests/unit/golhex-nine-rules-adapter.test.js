// Tests fuer den GolHex-Adapter (src/lib/golhex-nine-rules-adapter.js).
//
// Der Adapter ist die Stelle, an der Modellentscheidungen getroffen werden. Genau
// dort entstehen die Fehler, die spaeter niemand mehr sieht: eine erfundene Groesse,
// damit ein Feld gruen wird. Diese Suite sichert vor allem ab, dass der Adapter
// EHRLICH bleibt -- also N/A meldet, wo die Entitaet nichts hergibt.

import { describe, it, expect } from "vitest";
import {
  baueTrace, bewerteGolHex, CA_LIFE, NICHT_ANWENDBAR, schwerpunkt, uebergangsKlassen, RBAR_MIN,
  merkeSchritt, uebergangsProbe, RP2_BUDGET,
} from "../../src/lib/golhex-nine-rules-adapter.js";
import { STATUS } from "../../src/lib/nine-rules.js";
import { buildNeighbors } from "../../src/lib/sim-engine.js";

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
    // Ungerundet (Codex P2, PR #228): Spaltenkoordinate x = q + r/2 liegt kreisfoermig bei 0.
    const x = s.pos.q + s.pos.r / 2;
    expect(Math.min(Math.abs(x), Math.abs(10 - x))).toBeLessThan(1e-9);
    expect(s.pos.r).toBeCloseTo(4, 9);
    expect(s.geom).toEqual({ art: "torus", R: 10, C: 10 });
  });

  it("Schwerpunkt bleibt FRAKTIONAL (kein Runden auf eine Zelle)", () => {
    // (2,2),(2,3),(2,4) -> axial q 1,2,3 -> Mittel q=2 ; mit (1,1) statt (2,4): q 1,2,1 / r 2,2,1
    const s = schwerpunkt(gitter(6, 6, [[2, 2], [2, 3], [1, 1]]), 6, 6, { topologie: "edge" });
    expect(s.pos.q).toBeCloseTo(4 / 3, 12);
    expect(s.pos.r).toBeCloseTo(5 / 3, 12);
  });

  it("Torus: ueber eine Achse gleichverteilte Population hat KEINEN Schwerpunkt", () => {
    const ring = Array.from({ length: 10 }, (_, c) => [4, c]);
    const s = schwerpunkt(gitter(10, 10, ring), 10, 10, { topologie: "torus" });
    expect(s.pos).toBeUndefined();
    expect(s.grund).toMatch(/verteilt/);
    expect(RBAR_MIN).toBeGreaterThan(0);
  });

  it("unbekannte Topologien bleiben unbestimmt", () => {
    const s = schwerpunkt(gitter(6, 6, [[2, 2]]), 6, 6, { topologie: "kugel" });
    expect(s.pos).toBeUndefined();
    expect(s.grund).toMatch(/kugel/);
  });
});

// E1 (c), Marco 2026-11-22: Kreis + Torus ist in der Engine eine antipodale
// Identifikation des Randes (RP2, sim-engine buildNeighbors -> antipode()).
describe("RP2 (Kreis + Torus): Schwerpunkt ueber die Antipoden-Naht", () => {
  const R = 30, C = 30;
  const nb = buildNeighbors(R, C, "circle");
  const S3 = Math.sqrt(3);
  const cr = (R - 1) / 2, cc = (C - 1) / 2;
  const zx = (cc + ((cr & 1) ? 0.5 : 0)) * S3, zy = cr * 1.5;           // Kreismitte (Welt)
  const welt = (row, c) => [(c + ((row & 1) ? 0.5 : 0)) * S3, row * 1.5];
  const weltAusPos = (p) => [(p.q + p.r / 2) * S3, p.r * 1.5];
  // Randzelle in Reihe 14 ganz rechts + ihre antipodale Zelle (aus der ENGINE).
  const reihe = 14;
  let rechts = -1;
  for (let c = C - 1; c >= 0; c--) if (nb.mask[reihe * C + c]) { rechts = c; break; }
  const i = reihe * C + rechts;
  let anti = -1;
  for (let k = 0; k < 6; k++) { const j = nb.torus[i * 6 + k]; if (j >= 0 && nb.edge[i * 6 + k] < 0) anti = j; }

  it("Vorbedingung: die Engine verbindet die Randzelle mit einer Zelle am gegenueberliegenden Rand", () => {
    expect(anti).toBeGreaterThanOrEqual(0);
    const [ax] = welt((anti / C) | 0, anti % C);
    expect(ax).toBeLessThan(zx); // links der Mitte
  });

  it("Haufen ueber die Naht liegt AM Rand, nicht in der Kreismitte", () => {
    const col = new Uint8Array(R * C);
    col[i] = 1; col[anti] = 1;
    const s = schwerpunkt(col, R, C, { topologie: "rp2", mask: nb.mask });
    expect(s.grund).toBeUndefined();
    expect(s.geom?.art).toBe("rp2");
    const [x, y] = weltAusPos(s.pos);
    // Das arithmetische Mittel laege bei ~0 Abstand zur Mitte; RP2 legt es an den Rand.
    expect(Math.hypot(x - zx, y - zy)).toBeGreaterThan(0.8 * s.geom.rho);
  });

  it("Haufen im Inneren: identisch zum arithmetischen Mittel", () => {
    const col = gitter(R, C, [[14, 14], [14, 15], [15, 14]]);
    const a = schwerpunkt(col, R, C, { topologie: "rp2", mask: nb.mask });
    const e = schwerpunkt(col, R, C, { topologie: "edge" });
    expect(a.pos.q).toBeCloseTo(e.pos.q, 9);
    expect(a.pos.r).toBeCloseTo(e.pos.r, 9);
  });

  it("ueber die ganze Scheibe verteilte Population hat keinen Schwerpunkt", () => {
    const s = schwerpunkt(nb.mask, R, C, { topologie: "rp2", mask: nb.mask });
    expect(s.pos).toBeUndefined();
    expect(s.grund).toMatch(/verteilt/);
  });

  it("ohne Maske ist der Kreisrand unbekannt -> unbestimmt", () => {
    expect(schwerpunkt(gitter(R, C, [[14, 14]]), R, C, { topologie: "rp2" }).grund).toMatch(/Maske/);
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
    const geom = { art: "torus", R: 10, C: 10 };
    // offset (4,9) -> q = 9-2 = 7 ; offset (4,0) -> q = -2. Roh-Differenz -9, kuerzeste +1.
    const rep = bewerteGolHex(bufX([5, 5], [pos(7, 4, { geom }), pos(-2, 4, { geom })]), 1);
    expect(statusOf(rep, "R5")).toBe(STATUS.PASS);
    expect(ruleOf(rep, "R5").evidence).toMatch(/\(1,0\)/);
  });

  // Codex P2 (PR #228): gleich kurze Wege in beide Richtungen -> keine Richtung.
  it("Torus: halbe Periode ist mehrdeutig -> R5 UNKNOWN statt willkuerlicher Richtung", () => {
    const geom = { art: "torus", R: 10, C: 10 };
    const rep = bewerteGolHex(bufX([5, 5], [pos(0, 0, { geom }), pos(5, 0, { geom })]), 1);
    expect(statusOf(rep, "R5")).toBe(STATUS.UNOBSERVED);
    expect(ruleOf(rep, "R5").evidence).toMatch(/mehrdeutig/);
  });

  // Codex P2 (PR #228): erst runden, dann vergleichen machte eine schraege echte
  // Verschiebung (-2/3,-1/3) zu einer D6-Richtung (-1,0).
  it("echte Verschiebung (-2/3,-1/3) aus Zellen bleibt schraeg -> R5 UNKNOWN", () => {
    const sp = (z) => schwerpunkt(gitter(6, 6, z), 6, 6, { topologie: "edge" });
    const a = sp([[2, 2], [2, 3], [2, 4]]), b = sp([[2, 2], [2, 3], [1, 1]]);
    const rep = bewerteGolHex(bufX([3, 3], [pos(a.pos.q, a.pos.r), pos(b.pos.q, b.pos.r)]), 1);
    expect(statusOf(rep, "R6")).toBe(STATUS.PASS);
    expect(statusOf(rep, "R5")).toBe(STATUS.UNOBSERVED);
  });

  it("kleine echte Verschiebung (unter einer Zelle) zaehlt als Bewegung", () => {
    const rep = bewerteGolHex(bufX([5, 5], [pos(0, 0), pos(0.25, 0)]), 1);
    expect(statusOf(rep, "R6")).toBe(STATUS.PASS);
    expect(statusOf(rep, "R5")).toBe(STATUS.PASS);
  });

  it("RP2: Verschiebung ueber die Antipoden-Naht ist nicht orientierbar -> R5 UNKNOWN", () => {
    const S3 = Math.sqrt(3);
    const geom = { art: "rp2", cx: 0, cy: 0, rho: 10 };
    // Welt X=+9 und X=-9 auf der Mittelachse: direkt 18 auseinander, ueber die Naht 2.
    const rep = bewerteGolHex(bufX([5, 5], [pos(9 / S3, 0, { geom }), pos(-9 / S3, 0, { geom })]), 1);
    expect(statusOf(rep, "R6")).toBe(STATUS.PASS);
    expect(statusOf(rep, "R5")).toBe(STATUS.UNOBSERVED);
    expect(ruleOf(rep, "R5").evidence).toMatch(/nicht orientierbar/);
  });

  it("RP2: Verschiebung im Inneren behaelt ihre Richtung", () => {
    const geom = { art: "rp2", cx: 0, cy: 0, rho: 10 };
    const rep = bewerteGolHex(bufX([5, 5], [pos(0, 0, { geom }), pos(1, 0, { geom })]), 1);
    expect(statusOf(rep, "R5")).toBe(STATUS.PASS);
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

  // Codex P2 (PR #228): mit A1 erzeugt stepLife Spontangeburten, die in `births`
  // (Stand main) fehlen -- Neugeborene wuerden als Ueberlebende gezaehlt. Solange
  // die Zaehlwerte das nicht abbilden, ist R4 unter A1 UNKNOWN statt eines Urteils.
  it("A1 aktiv: Zaehlwerte unvollstaendig -> R4 UNKNOWN, nicht FAIL", () => {
    const rep = bewerteGolHex(bufX([0, 3], [schritt(0, 0), schritt(0, 0, 100, { a1: true })]), 1);
    expect(statusOf(rep, "R4")).toBe(STATUS.UNOBSERVED);
    expect(ruleOf(rep, "R4").evidence).toMatch(/A1/);
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

// Codex-Runde 2 auf PR #228 (2026-11-22).
describe("Codex R2: Rauschen, Einklassen-Schritte, Topologiewechsel", () => {
  const probe = (R, C, zellen, topologie) => {
    const s = schwerpunkt(gitter(R, C, zellen), R, C, { topologie });
    return { pos: s.pos, geom: s.geom };
  };

  it("Gleitkomma-Rauschen ist keine Bewegung: R6 FAIL, R5 n. a. (Torus 10x10)", () => {
    // (1,4)+(1,6) werden zu (1,5): Schwerpunkt unveraendert, Kreismittel rauscht ~1e-15.
    const a = probe(10, 10, [[1, 4], [1, 6]], "torus");
    const b = probe(10, 10, [[1, 5]], "torus");
    const rep = bewerteGolHex(bufX([2, 1], [schritt(0, 0, 100, a), schritt(0, 1, 100, b)]), 1);
    expect(statusOf(rep, "R6")).toBe(STATUS.FAIL);
    expect(statusOf(rep, "R5")).toBe(STATUS.NA);
  });

  it("vollstaendig gemessener Einklassen-Schritt (leeres Feld) unterscheidet NICHT: R4 FAIL", () => {
    const rep = bewerteGolHex(bufX([0, 0], [schritt(0, 0), schritt(0, 0)]), 1);
    expect(statusOf(rep, "R4")).toBe(STATUS.FAIL);
  });

  it("ganze Domaene stirbt gleichfoermig: R4 FAIL statt UNKNOWN", () => {
    const rep = bewerteGolHex(bufX([5, 0], [schritt(0, 0, 5), schritt(0, 5, 5)]), 1);
    expect(statusOf(rep, "R4")).toBe(STATUS.FAIL);
  });

  it("eine einzige Zelle bleibt UNKNOWN (kein Vergleich moeglich)", () => {
    const rep = bewerteGolHex(bufX([0, 0], [schritt(0, 0, 1), schritt(0, 0, 1)]), 1);
    expect(statusOf(rep, "R4")).toBe(STATUS.UNOBSERVED);
  });

  it("Wechsel Rand -> Torus ohne Zellbewegung: R5 und R6 UNKNOWN, keine Scheinbewegung", () => {
    const zellen = [[4, 49], [4, 0], [4, 1]];
    const a = probe(40, 50, zellen, "edge");
    const b = probe(40, 50, zellen, "torus");
    const rep = bewerteGolHex(bufX([3, 3], [schritt(0, 0, 2000, a), schritt(0, 0, 2000, b)]), 1);
    expect(statusOf(rep, "R6")).toBe(STATUS.UNOBSERVED);
    expect(statusOf(rep, "R5")).toBe(STATUS.UNOBSERVED);
    expect(ruleOf(rep, "R6").evidence).toMatch(/Topologie/);
  });

  it("Positivkontrolle: gleiche Topologie, echte Verschiebung bleibt PASS", () => {
    const a = probe(40, 50, [[4, 10], [4, 11]], "torus");
    const b = probe(40, 50, [[4, 12], [4, 13]], "torus");
    const rep = bewerteGolHex(bufX([2, 2], [schritt(0, 0, 2000, a), schritt(2, 2, 2000, b)]), 1);
    expect(statusOf(rep, "R6")).toBe(STATUS.PASS);
    expect(statusOf(rep, "R5")).toBe(STATUS.PASS);
  });
});

describe("Codex R3: Zaehlwerte gehoeren zu genau einem Feld", () => {
  // 10x10 Rechteck: zwei isolierte Zellen sterben unter B2/S34 -> {births:0, deaths:2}.
  const R = 10, C = 10;
  const nb = buildNeighbors(R, C, "box");
  const nachSchritt = () => new Uint8Array(R * C);                 // beide tot, Feld leer
  const probeUrteil = (stand, feld) => {
    const x = uebergangsProbe(stand, feld, nb);
    const pop = feld.reduce((s, v) => s + (v !== 0 ? 1 : 0), 0);
    return { x, rep: bewerteGolHex(bufX([2, pop], [schritt(0, 0, 100), { ...x }]), 1) };
  };

  it("Positivkontrolle: unveraendertes Feld traegt die Zaehlwerte -> R4 FAIL (gemessen)", () => {
    const feld = nachSchritt();
    const stand = merkeSchritt(null, feld, 0, 2, nb.inCount || R * C, false, nb);
    const { x, rep } = probeUrteil(stand, feld);
    expect(x.schritt).toBe(true);
    expect(statusOf(rep, "R4")).toBe(STATUS.FAIL);
  });

  it("eine nach dem Schritt gemalte Zelle macht die Zaehlwerte ungueltig: R4 UNKNOWN statt PASS", () => {
    const feld = nachSchritt();
    const stand = merkeSchritt(null, feld, 0, 2, nb.inCount || R * C, false, nb);
    feld[55] = 1;                                                   // Malen vor dem naechsten Schritt
    const { x, rep } = probeUrteil(stand, feld);
    expect(x.schritt).toBe(false);
    expect(statusOf(rep, "R4")).toBe(STATUS.UNOBSERVED);
    expect(ruleOf(rep, "R4").evidence).toMatch(/bearbeitet/);
  });

  it("der naechste echte Schritt misst wieder (Puffer wird wiederverwendet)", () => {
    const feld = nachSchritt();
    const alt = merkeSchritt(null, feld, 0, 2, 100, false, nb);
    feld[55] = 1;
    const neu = merkeSchritt(alt, feld, 1, 0, 100, false, nb);
    expect(neu.feld).toBe(alt.feld);
    expect(uebergangsProbe(neu, feld, nb)).toMatchObject({ schritt: true, births: 1, deaths: 0 });
  });

  it("A1 gilt so, wie es IM Schritt lief -- spaeteres Abschalten macht die Zaehlung nicht vollstaendig", () => {
    const feld = nachSchritt();
    const stand = merkeSchritt(null, feld, 0, 2, 100, true, nb);
    expect(uebergangsProbe(stand, feld, nb).a1).toBe(true);
  });

  it("Domaenenwechsel und fehlender Schritt-Stand sind unbestimmt", () => {
    const feld = nachSchritt();
    const stand = merkeSchritt(null, feld, 0, 2, 100, false, nb);
    expect(uebergangsProbe(stand, feld, buildNeighbors(R, C, "box")).schritt).toBe(false);
    expect(uebergangsProbe(null, feld, nb).schritt).toBe(false);
  });
});

describe("Codex R3: RP2-Schwerpunkt begrenzt, Ergebnis unveraendert", () => {
  // Referenz: schwerpunktRP2 im Stand c09f98a, woertlich (nur umbenannt).
  const S3 = Math.sqrt(3);
  function rp2BildRef(vx, vy, rho) {
    const l = Math.hypot(vx, vy);
    if (!(l > 0)) return [vx, vy];
    const f = -(2 * rho - l) / l;
    return [vx * f, vy * f];
  }
  function rp2Referenz(col, R, C, mask) {
    const cr = (R - 1) / 2, cc = (C - 1) / 2;
    const cx = cc + ((cr & 1) ? 0.5 : 0), cy = cr;
    let maxD = 0;
    const vs = [];
    for (let row = 0; row < R; row++) {
      const halb = (row & 1) ? 0.5 : 0;
      for (let c = 0; c < C; c++) {
        const i = row * C + c;
        if (!mask[i]) continue;
        const vx = (c + halb - cx) * S3, vy = (row - cy) * 1.5;
        const d = Math.hypot(vx, vy);
        if (d > maxD) maxD = d;
        if (col[i] !== 0) vs.push(vx, vy);
      }
    }
    const n = vs.length / 2;
    if (n === 0) return { grund: "keine lebende Zelle" };
    const rho = maxD + S3 / 2;
    const iteriere = (mx, my) => {
      let streu = Infinity;
      for (let it = 0; it < 8; it++) {
        let sx = 0, sy = 0, s2 = 0;
        const reps = [];
        for (let k = 0; k < vs.length; k += 2) {
          const [bx, by] = rp2BildRef(vs[k], vs[k + 1], rho);
          const direkt = Math.hypot(vs[k] - mx, vs[k + 1] - my), bild = Math.hypot(bx - mx, by - my);
          const [px, py] = bild < direkt ? [bx, by] : [vs[k], vs[k + 1]];
          reps.push(px, py); sx += px; sy += py;
        }
        const nx = sx / n, ny = sy / n;
        for (let k = 0; k < reps.length; k += 2) s2 += (reps[k] - nx) ** 2 + (reps[k + 1] - ny) ** 2;
        streu = Math.sqrt(s2 / n);
        const fertig = nx === mx && ny === my;
        mx = nx; my = ny;
        if (fertig) break;
      }
      return { mx, my, streu };
    };
    let sx0 = 0, sy0 = 0;
    for (let k = 0; k < vs.length; k += 2) { sx0 += vs[k]; sy0 += vs[k + 1]; }
    let best = iteriere(sx0 / n, sy0 / n);
    const schritt = Math.max(1, Math.floor(n / 8));
    for (let z = 0; z < n; z += schritt) {
      const v = iteriere(vs[2 * z], vs[2 * z + 1]);
      if (v.streu < best.streu) best = v;
    }
    let { mx, my } = best;
    const { streu } = best;
    if (!(streu <= 0.5 * rho)) {
      return { grund: `Population ueber die Scheibe verteilt (Streuung ${(streu / rho).toFixed(2)} rho > 0.5)` };
    }
    if (Math.hypot(mx, my) > rho) [mx, my] = rp2BildRef(mx, my, rho);
    const x = cx + mx / S3, y = cy + my / 1.5;
    return { pos: { q: x - y / 2, r: y }, geom: { art: "rp2", cx, cy, rho } };
  }
  // Fester Zufall (mulberry32).
  const zufall = (seed) => () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  it("bitgleich zur Referenz auf zufaelligen und gehaeuften Feldern (feste Seeds)", () => {
    let mitPos = 0, verteilt = 0, faelle = 0;
    for (const [R, C] of [[30, 30], [41, 37], [64, 58]]) {
      const nb = buildNeighbors(R, C, "circle");
      const innen = [];
      for (let i = 0; i < R * C; i++) if (nb.mask[i]) innen.push(i);
      for (let seed = 1; seed <= 12; seed++) {
        const rnd = zufall(seed * 7919 + R);
        const col = new Uint8Array(R * C);
        if (seed % 3 === 0) {
          const dichte = [0.03, 0.15, 0.4][(seed / 3) % 3];
          for (const i of innen) if (rnd() < dichte) col[i] = 1;
        } else {
          // Haufen um eine zufaellige Domaenenzelle, oft am Rand ...
          const m = innen[Math.floor(rnd() * innen.length)];
          const mr = (m / C) | 0, mc = m % C, rad = 1 + Math.floor(rnd() * 4);
          for (const i of innen) {
            const r = (i / C) | 0, c = i % C;
            if (Math.abs(r - mr) <= rad && Math.abs(c - mc) <= rad && rnd() < 0.7) col[i] = 1;
          }
          // ... plus Antipoden-Partner einiger Randzellen (Haufen ueber der Naht)
          for (const i of innen) {
            if (!col[i] || rnd() < 0.5) continue;
            for (let k = 0; k < 6; k++) {
              const j = nb.torus[i * 6 + k];
              if (j >= 0 && nb.edge[i * 6 + k] < 0) col[j] = 1;
            }
          }
        }
        const ref = rp2Referenz(col, R, C, nb.mask);
        const neu = schwerpunkt(col, R, C, { topologie: "rp2", mask: nb.mask, budget: Infinity });
        faelle++;
        if (ref.pos) {
          mitPos++;
          expect(Object.is(neu.pos.q, ref.pos.q) && Object.is(neu.pos.r, ref.pos.r)).toBe(true);
          expect(neu.geom).toEqual(ref.geom);
        } else {
          if (/verteilt/.test(ref.grund)) verteilt++;
          expect(neu.grund).toBe(ref.grund);
        }
        // Mit Standardbudget: dasselbe Ergebnis oder ausdruecklich "Rechenbudget".
        const std = schwerpunkt(col, R, C, { topologie: "rp2", mask: nb.mask });
        if (std.grund && /Rechenbudget/.test(std.grund)) continue;
        expect(std).toEqual(neu);
      }
    }
    // Beide Zweige wirklich ausgeuebt (sonst waere die Gleichheit leer).
    expect(faelle).toBe(36);
    expect(mitPos).toBeGreaterThan(5);
    expect(verteilt).toBeGreaterThan(2);
  });

  it("grosse verteilte Population sprengt das Budget: UNBESTIMMT statt Main-Thread-Blockade", () => {
    const R = 300, C = 280;
    const nb = buildNeighbors(R, C, "circle");
    const rnd = zufall(42);
    const col = new Uint8Array(R * C);
    let n = 0;
    for (let i = 0; i < R * C; i++) if (nb.mask[i] && rnd() < 0.5) { col[i] = 1; n++; }
    expect(n * 2 * 9).toBeGreaterThan(RP2_BUDGET);                  // Vorbedingung
    const s = schwerpunkt(col, R, C, { topologie: "rp2", mask: nb.mask });
    expect(s.pos).toBeUndefined();
    expect(s.grund).toMatch(/Rechenbudget/);
  });

  it("Positivkontrolle: kleiner Haufen bleibt unter dem Standardbudget bestimmbar", () => {
    const R = 120, C = 110;
    const nb = buildNeighbors(R, C, "circle");
    const col = gitter(R, C, [[60, 50], [60, 51], [61, 50], [61, 51]]);
    const s = schwerpunkt(col, R, C, { topologie: "rp2", mask: nb.mask });
    expect(s.grund).toBeUndefined();
    expect(s.geom?.art).toBe("rp2");
  });
});
