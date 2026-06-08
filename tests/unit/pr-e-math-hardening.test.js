import { describe, it, expect } from "vitest";
import { buildNeighbors } from "../../src/lib/sim-engine.js";

// =============================================================================
// v33 PR-E — Mathe-Haertung (Mathe-Audit TEIL C).
//   P1.3: circleRadius-Clamp-Pfad (Silent-Failure-/Grenzwert-Gate).
//   P1.5: Antipode-Suche umgestellt auf Direktberechnung — Reziprozitaet MUSS 0
//         bleiben (Geometrie-Aequivalenz, vgl. /tmp/verify5.mjs aus dem Audit).
// =============================================================================

// ---------------------------------------------------------------------------
// P1.3 — circleRadius-Clamp auf absichtlich zu kleinem Gitter.
// ---------------------------------------------------------------------------
describe("P1.3 circleRadius-Clamp (Grenzwert/Silent-Failure-Gate)", () => {
  it("circleRadius MAX auf zu kleinem Gitter -> inCount gegen radiusMax geklemmt", () => {
    // Kleines Gitter 21x21: eingeschriebenes Maximum << 500. Ein riesiger
    // circleRadius muss auf den eingeschriebenen Maximalkreis geklemmt werden,
    // NICHT die Maske ueber den Gitterrand wachsen lassen (still falsch).
    const R = 21, C = 21;
    const clamped = buildNeighbors(R, C, "circle", { circleRadius: 500 });
    const max = buildNeighbors(R, C, "circle"); // ohne opts = eingeschriebenes Maximum
    expect(clamped.inCount).toBe(max.inCount);
    // Maske bleibt strikt im Gitter (kein Ueberlauf).
    expect(clamped.inCount).toBeLessThanOrEqual(R * C);
    expect(clamped.inCount).toBeGreaterThan(0);
  });

  it("Grenze: circleRadius exakt am eingeschriebenen Maximum == Maximum (kein Off-by-one)", () => {
    const R = 41, C = 41;
    // halfH = (R-1)*1.5/2 + 1 = 31; circleRad = radius*1.5 -> radius am Limit ~ 20.67.
    // Ein Wert knapp darueber muss == Maximum bleiben (geklemmt).
    const justOver = buildNeighbors(R, C, "circle", { circleRadius: 25 });
    const max = buildNeighbors(R, C, "circle");
    expect(justOver.inCount).toBe(max.inCount);
  });
});

// ---------------------------------------------------------------------------
// P1.5 — Circle-Torus Reziprozitaet + max-Grad nach Antipode-Direktberechnung.
//   Unabhaengiges Orakel (nicht der Engine-Code): zaehle alle gerichteten Kanten
//   und pruefe, dass JEDE Kante u->v eine Gegenkante v->u hat (0 nicht-reziprok),
//   keine Selbstschleifen, max in-degree <= 6. Spiegelt /tmp/verify5.mjs.
// ---------------------------------------------------------------------------
describe("P1.5 circle-torus Antipode (Direktberechnung): Reziprozitaet bleibt 0", () => {
  const reciprocityReport = (R, C, circleRadius) => {
    const nb = buildNeighbors(R, C, "circle", { circleRadius });
    const N = R * C;
    // Adjazenz aus torus aufbauen (nur In-Domaenen-Zellen).
    const out = new Map();
    let selfLoops = 0, maxIndeg = 0;
    const indeg = new Int32Array(N);
    for (let i = 0; i < N; i++) {
      if (!nb.mask[i]) continue;
      const set = new Set();
      for (let k = 0; k < 6; k++) {
        const v = nb.torus[i * 6 + k];
        if (v < 0) continue;
        if (v === i) selfLoops++;
        set.add(v);
        indeg[v]++;
      }
      out.set(i, set);
    }
    let nonReciprocal = 0;
    for (const [u, set] of out) {
      for (const v of set) {
        const sv = out.get(v);
        if (!sv || !sv.has(u)) nonReciprocal++;
      }
    }
    for (let i = 0; i < N; i++) if (indeg[i] > maxIndeg) maxIndeg = indeg[i];
    return { selfLoops, nonReciprocal, maxIndeg, inCount: nb.inCount };
  };

  for (const [R, C, r] of [[41, 41, 20], [61, 61, 30], [81, 81, 40]]) {
    it(`Gitter ${R}x${C}, r=${r}: 0 self-loops, 0 nicht-reziprok, max in-degree <= 6`, () => {
      const rep = reciprocityReport(R, C, r);
      expect(rep.inCount).toBeGreaterThan(0);
      expect(rep.selfLoops).toBe(0);
      expect(rep.nonReciprocal).toBe(0);
      expect(rep.maxIndeg).toBeLessThanOrEqual(6);
    });
  }

  it("Direktberechnung == frueheres Verhalten: antipodale Kante existiert (nicht alle -1)", () => {
    // Bei aktiviertem circle-torus duerfen Randzellen NICHT alle ins Leere zeigen;
    // die antipodale Identifikation muss echte Gegenzellen liefern.
    const R = 61, C = 61, r = 28;
    const nb = buildNeighbors(R, C, "circle", { circleRadius: r });
    let wrapped = 0, edgeMinus = 0;
    for (let i = 0; i < R * C; i++) {
      if (!nb.mask[i]) continue;
      for (let k = 0; k < 6; k++) {
        const t = nb.torus[i * 6 + k], e = nb.edge[i * 6 + k];
        if (e < 0 && t >= 0) wrapped++;   // Edge ins Leere, aber Torus gewrappt
        if (e < 0) edgeMinus++;
      }
    }
    expect(edgeMinus).toBeGreaterThan(0); // es GIBT Randzellen
    expect(wrapped).toBeGreaterThan(0);   // und sie werden antipodal verbunden
  });
});
