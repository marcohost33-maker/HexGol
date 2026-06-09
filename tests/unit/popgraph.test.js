import { describe, it, expect } from "vitest";
import {
  POPGRAPH_CAP, createBuffer, pushSample, resetBuffer, buildPath, buildPaths,
} from "../../src/lib/popgraph.js";

// Orakel fuer die PURE Populations-Graph-Logik (Feature 1, 2026-06-09).
// Geprueft: Ring-Buffer-Wrap (FIFO), leerer Buffer, Reset, Pfad-Monotonie/-Skalierung,
// gemeinsame Skala beider Reihen, sowie Silent-Failure-Faelle (NaN/Infinity/negativ).
// Diese Funktionen sind dieselbe Single-Source, die App.tsx fuer die UI-Sparkline nutzt.

// Hilfen: x/y aus einem "M..L.."-Pfad ziehen.
function points(d) {
  if (!d) return [];
  return d.replace(/[ML]/g, " ").trim().split(/\s+/).filter(Boolean)
    .map((seg) => seg.split(",").map(Number));
}

describe("createBuffer", () => {
  it("legt leeren Buffer mit Default-Kapazitaet 200 an", () => {
    const b = createBuffer();
    expect(b.pop).toEqual([]);
    expect(b.active).toEqual([]);
    expect(b.cap).toBe(200);
    expect(POPGRAPH_CAP).toBe(200);
  });
  it("erzwingt cap >= 1 (defensiv gegen 0/negativ)", () => {
    expect(createBuffer(0).cap).toBe(1);
    expect(createBuffer(-5).cap).toBe(1);
    expect(createBuffer(50).cap).toBe(50);
  });
});

describe("pushSample — Ring-Buffer-Wrap (FIFO)", () => {
  it("haengt Stichproben in beide Reihen an", () => {
    const b = createBuffer(5);
    pushSample(b, 10, 3);
    pushSample(b, 12, 4);
    expect(b.pop).toEqual([10, 12]);
    expect(b.active).toEqual([3, 4]);
  });
  it("verwirft die aeltesten Werte bei Ueberlauf (Wrap), Reihen bleiben synchron", () => {
    const b = createBuffer(3);
    for (let i = 1; i <= 6; i++) pushSample(b, i * 10, i);
    // cap=3 -> nur die letzten 3 Generationen bleiben
    expect(b.pop).toEqual([40, 50, 60]);
    expect(b.active).toEqual([4, 5, 6]);
    expect(b.pop.length).toBe(3);
    expect(b.active.length).toBe(3);
  });
  it("klemmt nicht-endliche/negative Eingaben auf 0 (Silent-Failure-Gate)", () => {
    const b = createBuffer(10);
    pushSample(b, NaN, Infinity);
    pushSample(b, -7, -1);
    pushSample(b, undefined, null);
    expect(b.pop).toEqual([0, 0, 0]);
    expect(b.active).toEqual([0, 0, 0]);
  });
  it("gibt denselben Buffer zurueck (mutierend, kein Realloc)", () => {
    const b = createBuffer();
    expect(pushSample(b, 1, 1)).toBe(b);
  });
});

describe("resetBuffer", () => {
  it("leert beide Reihen, behaelt Kapazitaet + Identitaet", () => {
    const b = createBuffer(7);
    pushSample(b, 5, 2); pushSample(b, 6, 3);
    const same = resetBuffer(b);
    expect(same).toBe(b);
    expect(b.pop).toEqual([]);
    expect(b.active).toEqual([]);
    expect(b.cap).toBe(7);
  });
});

describe("buildPath — leerer / 1-Punkt-Buffer", () => {
  it("ergibt '' bei 0 oder 1 Punkt (nichts zeichnen)", () => {
    expect(buildPath([], 100, 40, 10)).toBe("");
    expect(buildPath([5], 100, 40, 10)).toBe("");
  });
});

describe("buildPath — Monotonie + Skalierung", () => {
  it("x ist streng monoton steigend von 0 bis w", () => {
    const d = buildPath([1, 2, 3, 4, 5], 100, 40, 5);
    const pts = points(d);
    expect(pts.length).toBe(5);
    expect(pts[0][0]).toBeCloseTo(0, 5);
    expect(pts[pts.length - 1][0]).toBeCloseTo(100, 5);
    for (let i = 1; i < pts.length; i++) {
      expect(pts[i][0]).toBeGreaterThan(pts[i - 1][0]);
    }
  });
  it("y ist invertiert: Maximalwert sitzt oben (y=0), 0 sitzt unten (y=h)", () => {
    const h = 40;
    const d = buildPath([0, 10], 100, h, 10);
    const pts = points(d);
    expect(pts[0][1]).toBeCloseTo(h, 5);  // Wert 0 -> unten
    expect(pts[1][1]).toBeCloseTo(0, 5);  // Wert max -> oben
  });
  it("alle y liegen im Intervall [0, h]", () => {
    const h = 56;
    const d = buildPath([3, 9, 1, 7, 4], 120, h, 9);
    for (const [, y] of points(d)) {
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThanOrEqual(h);
    }
  });
  it("erzwingt max >= 1 (kein div-by-0 bei reiner Null-Reihe)", () => {
    const h = 40;
    const d = buildPath([0, 0, 0], 100, h, 0);
    for (const [, y] of points(d)) expect(y).toBeCloseTo(h, 5); // alles am Boden
    expect(Number.isNaN(parseFloat(d.replace(/[ML,]/g, " ").trim().split(/\s+/)[1]))).toBe(false);
  });
});

describe("buildPaths — gemeinsame Skala beider Reihen", () => {
  it("ergibt leere Pfade bei <2 Punkten", () => {
    const b = createBuffer();
    expect(buildPaths(b, 100, 40)).toMatchObject({ pop: "", active: "", n: 0 });
    pushSample(b, 5, 2);
    expect(buildPaths(b, 100, 40)).toMatchObject({ pop: "", active: "", n: 1 });
  });
  it("skaliert pop UND active mit demselben Maximum (Pop-Linie nie unter Aktiv bei groesserem Wert)", () => {
    const b = createBuffer();
    pushSample(b, 100, 30);
    pushSample(b, 80, 50);
    const r = buildPaths(b, 100, 40);
    expect(r.max).toBe(100); // groesster Wert ueber BEIDE Reihen
    const pPts = points(r.pop);
    const aPts = points(r.active);
    // Gen 0: pop=100=max -> y=0 (ganz oben); active=30 -> tiefer (groesseres y)
    expect(pPts[0][1]).toBeCloseTo(0, 5);
    expect(aPts[0][1]).toBeGreaterThan(pPts[0][1]);
  });
  it("nutzt nur die synchron vorhandenen Punkte (n = min beider Laengen)", () => {
    const b = createBuffer();
    // kuenstlich entkoppeln (sollte im Normalbetrieb nie passieren)
    b.pop.push(1, 2, 3);
    b.active.push(1, 2);
    const r = buildPaths(b, 100, 40);
    expect(r.n).toBe(2);
    expect(points(r.pop).length).toBe(2);
    expect(points(r.active).length).toBe(2);
  });
});
