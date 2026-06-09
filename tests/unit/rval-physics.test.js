// Invarianten-Tests fuer die reellwertigen Physik-Schritte (src/lib/sim-engine):
// stepWater, stepReiter (snow), stepCollatz, stepGenes. Diese pure Funktionen
// trugen bisher KEINE Unit-Abdeckung ihrer dokumentierten Erhaltungs-/Wachstums-
// gesetze (nur HQST + Raender waren getestet). Hier werden die Gesetze direkt
// geprueft — Massenerhaltung (Wasser), monotones Eiswachstum (Reiter), korrekte
// Collatz-Uebergaenge, Mendel-Survival/Geburt + Determinismus (Gene). Keine
// Verhaltensaenderung am Code; reine Absicherung gegen kuenftige Regressionen.
import { describe, it, expect } from "vitest";
import {
  buildNeighbors, stepWater, stepReiter, stepCollatz, stepGenes,
  genotype, G_AA, G_Aa, G_aa,
} from "../../src/lib/sim-engine.js";

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const sum = (a) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i]; return s; };
const allFinite = (a) => { for (let i = 0; i < a.length; i++) if (!Number.isFinite(a[i])) return false; return true; };

describe("stepWater — Masse erhalten, Werte in [0,1], keine NaN", () => {
  it("konserviert die Gesamtmasse ueber 80 Schritte (berandet, kein Torus)", () => {
    const R = 10, C = 6;
    const { edge } = buildNeighbors(R, C, "box");
    const N = R * C;
    let w = new Float32Array(N), buf = new Float32Array(N);
    // obere 3 Reihen voll Wasser
    for (let r = 0; r < 3; r++) for (let c = 0; c < C; c++) w[r * C + c] = 1;
    const m0 = sum(w);
    for (let t = 0; t < 80; t++) {
      const out = stepWater(w, edge, C, buf);
      buf = (out === w) ? buf : w; w = out; // wie App.tsx: Puffer tauschen
    }
    // Massenerhaltung: Gravitation + Druck verschieben nur, erzeugen/vernichten nichts.
    expect(Math.abs(sum(w) - m0)).toBeLessThan(1e-3);
    expect(allFinite(w)).toBe(true);
    for (let i = 0; i < N; i++) { expect(w[i]).toBeGreaterThanOrEqual(-1e-6); expect(w[i]).toBeLessThanOrEqual(1 + 1e-6); }
  });

  it("Wasser sinkt: untere Reihen fuellen sich, obere leeren", () => {
    const R = 12, C = 4;
    const { edge } = buildNeighbors(R, C, "box");
    const N = R * C;
    let w = new Float32Array(N), buf = new Float32Array(N);
    for (let r = 0; r < 4; r++) for (let c = 0; c < C; c++) w[r * C + c] = 1;
    for (let t = 0; t < 200; t++) { const out = stepWater(w, edge, C, buf); buf = w; w = out; }
    let topMass = 0, botMass = 0;
    for (let c = 0; c < C; c++) { topMass += w[0 * C + c]; botMass += w[(R - 1) * C + c]; }
    expect(botMass).toBeGreaterThan(topMass); // Schwerkraft: unten mehr als oben
  });
});

describe("stepReiter (Schnee) — monotones Eiswachstum, nicht-negativ, keine NaN", () => {
  // HINWEIS (Experten-Befund, verifiziert): Diese GolHex-Reiter-Variante ist
  // "leck" — nicht-rezeptive Zellen diffundieren zu rezeptiven (Eis-)Nachbarn hin
  // (die in der Laplace-Summe als 0 zaehlen), aber rezeptive Zellen (ns=s+gamma)
  // FANGEN diesen einstroemenden Anteil NICHT auf. Das kanonische Reiter-Modell
  // (Chaos Solitons Fractals 23) faengt ihn auf und ist daher massenerhaltend bis
  // auf den gamma-Term. Folglich ist die Gesamtmasse hier NICHT erhalten (sie
  // sinkt am Eisrand); die belastbare Invariante ist das monotone Eiswachstum.
  it("Eis waechst monoton (rezeptive Zellen tauen nie), nicht-negativ, endlich", () => {
    const R = 13, C = 13;
    const { edge } = buildNeighbors(R, C, "box");
    const N = R * C;
    let s = new Float32Array(N), buf = new Float32Array(N);
    const rec = new Float32Array(N);
    for (let i = 0; i < N; i++) s[i] = 0.4;          // Hintergrund-Dampf beta
    const mid = (R >> 1) * C + (C >> 1); s[mid] = 1; // Eiskeim
    // gamma=0.05 (statt App-Default 0.01), damit die 6 rezeptiven Keim-Nachbarn
    // (Start 0.4) innerhalb der 40 Schritte ueber 1 akkumulieren -> Eis waechst
    // sichtbar (0.4 + 40*0.05 = 2.4). Default 0.01 braeuchte ~60 Schritte.
    const alpha = 1.0, gamma = 0.05;
    const iceCount = (a) => { let n = 0; for (let i = 0; i < a.length; i++) if (a[i] >= 1) n++; return n; };
    let prevIce = iceCount(s);
    for (let t = 0; t < 40; t++) {
      const out = stepReiter(s, edge, alpha, gamma, buf, rec);
      buf = s; s = out;
      const ice = iceCount(s);
      expect(ice).toBeGreaterThanOrEqual(prevIce);   // rezeptive Zellen frieren, tauen nie
      expect(allFinite(s)).toBe(true);
      for (let i = 0; i < N; i++) expect(s[i]).toBeGreaterThanOrEqual(-1e-6);
      prevIce = ice;
    }
    expect(s[mid]).toBeGreaterThanOrEqual(1);        // Keim bleibt Eis
    expect(iceCount(s)).toBeGreaterThan(1);          // Flocke ist gewachsen
  });
});

describe("stepCollatz — korrekte Zahlentheorie-Uebergaenge", () => {
  it("gerade -> n/2, ungerade(>1) -> 3n+1 (kleine, Float32-exakte Werte)", () => {
    const R = 3, C = 3;
    const { torus } = buildNeighbors(R, C, "box");
    const N = R * C, s = new Float32Array(N), buf = new Float32Array(N);
    // Schachbrett aus geraden/ungeraden Werten, alle exakt in Float32 (< 2^24).
    const vals = [8, 5, 16, 7, 64, 3, 10, 9, 2];
    for (let i = 0; i < N; i++) s[i] = vals[i];
    const out = stepCollatz(s, torus, buf);
    // neighbor-unabhaengige Uebergaenge:
    expect(out[0]).toBe(4);   // 8  -> 4
    expect(out[1]).toBe(16);  // 5  -> 16
    expect(out[2]).toBe(8);   // 16 -> 8
    expect(out[3]).toBe(22);  // 7  -> 22
    expect(out[4]).toBe(32);  // 64 -> 32
    expect(out[5]).toBe(10);  // 3  -> 10
    expect(out[6]).toBe(5);   // 10 -> 5
    expect(out[7]).toBe(28);  // 9  -> 28
    expect(out[8]).toBe(1);   // 2  -> 1
  });

  it("Wert<=1 wird raeumlich wiedergeboren (groesster Nachbar / 2)", () => {
    const R = 3, C = 3;
    const { torus } = buildNeighbors(R, C, "box");
    const N = R * C, s = new Float32Array(N), buf = new Float32Array(N);
    for (let i = 0; i < N; i++) s[i] = 1;  // alle tot
    // Einen ECHTEN Nachbarn des Zentrums (idx 4) aus dem Lookup waehlen und auf 64
    // setzen -> Zentrum wird aus dem groessten Nachbarn (64) wiedergeboren: 64/2=32.
    const nb = torus[4 * 6 + 0];
    s[nb] = 64;
    const out = stepCollatz(s, torus, buf);
    expect(out[nb]).toBe(32); // 64 (gerade) -> 32
    expect(out[4]).toBe(32);  // Zentrum (1) -> groesster Nachbar 64 -> 32
  });
});

describe("stepGenes (Mendel) — Survival/Geburt-Regeln, gueltige Genotypen, deterministisch", () => {
  // Lebend-Nachbarzahl aus dem Lookup (wie in der Engine).
  const liveCount = (s, NL, i) => { let n = 0; const b = i * 6; for (let k = 0; k < 6; k++) { const j = NL[b + k]; if (j >= 0 && s[j] !== 0) n++; } return n; };

  it("respektiert Survival(2-4)/Geburt(2-3) fuer JEDE Zelle und liefert nur Genotypen 0..3", () => {
    const R = 8, C = 8;
    const { torus } = buildNeighbors(R, C, "box");
    const N = R * C, s = new Float32Array(N), buf = new Float32Array(N);
    const rnd = mulberry32(4242);
    for (let i = 0; i < N; i++) if (rnd() < 0.45) s[i] = genotype(rnd() < 0.6 ? 0 : 1, rnd() < 0.6 ? 0 : 1);
    const tick = 7;
    const out = stepGenes(s, torus, buf, tick);
    for (let i = 0; i < N; i++) {
      const live = liveCount(s, torus, i);
      expect([0, G_AA, G_Aa, G_aa]).toContain(out[i]); // gueltiger Genotyp
      if (s[i] !== 0) {
        // Survival: 2..4 Nachbarn -> Genotyp bleibt; sonst Tod.
        expect(out[i]).toBe((live >= 2 && live <= 4) ? s[i] : 0);
      } else {
        // Geburt nur bei genau 2 oder 3 belebten Nachbarn.
        if (live === 2 || live === 3) expect(out[i]).not.toBe(0);
        else expect(out[i]).toBe(0);
      }
    }
  });

  it("ist deterministisch: gleicher Input + gleicher Tick -> identisches Ergebnis", () => {
    const R = 6, C = 6;
    const { torus } = buildNeighbors(R, C, "box");
    const N = R * C, s = new Float32Array(N);
    const rnd = mulberry32(99);
    for (let i = 0; i < N; i++) if (rnd() < 0.5) s[i] = genotype(rnd() < 0.5 ? 0 : 1, rnd() < 0.5 ? 0 : 1);
    const a = stepGenes(s, torus, new Float32Array(N), 11);
    const b = stepGenes(s, torus, new Float32Array(N), 11);
    expect(Array.from(a)).toEqual(Array.from(b));
  });
});
