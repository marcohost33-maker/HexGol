// Ordnungsunabhaengigkeit des seitlichen Wasser-Ausgleichs (stepWater, 2026-06-08).
// Frueher war der laterale Pass ein In-Place-Sweep links->rechts (diff>0), der eine
// RICHTUNGS-DRIFT erzeugte (Wasser wanderte ueber viele Schritte nach +x). Der Fix
// macht den Ausgleich symmetrisch/ordnungsunabhaengig. Der entscheidende Test ist
// die LINKS-RECHTS-SPIEGELSYMMETRIE: step(spiegel(w)) == spiegel(step(w)). Mit dem
// alten Bias bricht diese Gleichheit; mit dem Fix gilt sie exakt. Zusaetzlich:
// Massenerhaltung + Wertebereich [0,1] (wie fuer jedes CA-Fluid gefordert).
import { describe, it, expect } from "vitest";
import { buildNeighbors, stepWater } from "../../src/lib/sim-engine.js";

const sum = (a) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i]; return s; };
const allFinite = (a) => { for (let i = 0; i < a.length; i++) if (!Number.isFinite(a[i])) return false; return true; };
function mulberry32(seed) { let a = seed >>> 0; return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

describe("stepWater — seitlicher Ausgleich ist ordnungsunabhaengig (kein Sweep-Bias)", () => {
  it("Links-Rechts-Spiegelsymmetrie: step(spiegel(w)) == spiegel(step(w)) (1 Reihe, nur lateral)", () => {
    // R=1 -> keine unteren Nachbarn -> Gravitation ist No-op -> NUR der laterale
    // Pass wirkt. Genau hier zeigte sich frueher die Sweep-Richtungsdrift.
    const R = 1, C = 12;
    const { edge } = buildNeighbors(R, C, "box");
    const rnd = mulberry32(20260608);
    const base = new Float32Array(C);
    for (let i = 0; i < C; i++) base[i] = rnd(); // asymmetrisches Profil in [0,1)

    // step(w)
    const w1 = base.slice();
    const out1 = stepWater(w1, edge, C, new Float32Array(C)).slice();

    // step(spiegel(w)) — gespiegeltes Eingabeprofil
    const mirroredIn = base.slice().reverse();
    const out2 = stepWater(mirroredIn, edge, C, new Float32Array(C));

    // spiegel(step(w))
    const out1Mirrored = out1.slice().reverse();

    for (let i = 0; i < C; i++) {
      expect(Math.abs(out2[i] - out1Mirrored[i])).toBeLessThan(1e-6);
    }
  });

  it("symmetrische Diffusion: Innenzelle = 0.5*self + 0.25*links + 0.25*rechts", () => {
    // Exakte Form des ordnungsunabhaengigen Ausgleichs an einer Innenzelle pruefen.
    const R = 1, C = 5;
    const { edge } = buildNeighbors(R, C, "box");
    const w = Float32Array.from([0.2, 0.9, 0.1, 0.7, 0.4]);
    const expectMid = 0.5 * 0.1 + 0.25 * 0.9 + 0.25 * 0.7; // Zelle 2 (Innen)
    const out = stepWater(w, edge, C, new Float32Array(C));
    expect(Math.abs(out[2] - expectMid)).toBeLessThan(1e-6);
  });

  it("Gravitation ohne Links/Rechts-Vorzug: beide unteren Nachbarn bekommen gleich viel", () => {
    // Wasser in einer Zelle ueber zwei gleich freien unteren Nachbarn muss sich
    // SYMMETRISCH aufteilen. Der alte sequentielle Pass (k=4 zuerst, *0.5) gab dem
    // ersten Nachbarn mehr -> dieser Test schlug damit fehl, mit dem Fix gilt er.
    // Aufbau R=3,C=2 mit Quelle in einer UNGERADEN Reihe: deren zwei untere Nachbarn
    // (k=4,5) spannen die VOLLE Breite (Spalten 0 und 1) -> kein seitliches Auslaufen
    // in eine dritte Spalte, das die Symmetrie sonst (durch die hex-Geometrie) brechen
    // wuerde. Beide unteren Zellen liegen am Rand -> der laterale Pass ist hier ein No-op.
    const R = 3, C = 2;
    const { edge } = buildNeighbors(R, C, "box");
    const N = R * C, w = new Float32Array(N);
    const top = 1 * C + 0;           // Reihe 1 (ungerade), Spalte 0
    w[top] = 1;
    const j4 = edge[top * 6 + 4], j5 = edge[top * 6 + 5];
    expect(j4).toBeGreaterThanOrEqual(0); expect(j5).toBeGreaterThanOrEqual(0); // beide unten existieren
    const out = stepWater(w, edge, C, new Float32Array(N));
    expect(Math.abs(out[j4] - out[j5])).toBeLessThan(1e-6); // gleiche Aufteilung
    expect(out[j4]).toBeGreaterThan(0);                      // es ist tatsaechlich geflossen
  });

  it("Masse erhalten + Werte in [0,1] ueber 100 Schritte (2D, berandet)", () => {
    const R = 10, C = 8;
    const { edge } = buildNeighbors(R, C, "box");
    const N = R * C;
    let w = new Float32Array(N), buf = new Float32Array(N);
    const rnd = mulberry32(7);
    for (let r = 0; r < 3; r++) for (let c = 0; c < C; c++) w[r * C + c] = 0.5 + 0.5 * rnd();
    const m0 = sum(w);
    for (let t = 0; t < 100; t++) { const out = stepWater(w, edge, C, buf); buf = w; w = out; }
    expect(Math.abs(sum(w) - m0)).toBeLessThan(1e-2); // Massenerhaltung
    expect(allFinite(w)).toBe(true);
    for (let i = 0; i < N; i++) { expect(w[i]).toBeGreaterThanOrEqual(-1e-6); expect(w[i]).toBeLessThanOrEqual(1 + 1e-6); }
  });
});
