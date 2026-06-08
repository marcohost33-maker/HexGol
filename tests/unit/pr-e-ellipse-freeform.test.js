import { describe, it, expect } from "vitest";
import {
  buildNeighbors, GRID_SIZES,
  windingNumber, pointInPolygonWN,
} from "../../src/lib/sim-engine.js";

// =============================================================================
// v33 PR-E — Ellipse-Domaene + Freiform-Domaene (Winding-Number).
// Orakel-basiert: jede Behauptung gegen eine UNABHAENGIGE Gegenprobe (analytische
// Flaeche, Stern-Polygon mit bekanntem Winding, Even-Odd-Divergenz). Kein
// Selbst-Vergleich gegen denselben Code.
// =============================================================================

const S3 = Math.sqrt(3);
// Welt-Koords der Maske (Spiegel von buildNeighbors: pointy-top odd-r).
const wx = (r, c) => (c + ((r & 1) ? 0.5 : 0)) * S3;
const wy = (r) => r * 1.5;

// ---------------------------------------------------------------------------
// 1) Winding-Number — reine Funktion gegen bekannte Wahrheiten.
// ---------------------------------------------------------------------------
describe("windingNumber / pointInPolygonWN — Hormann-Agathos", () => {
  const square = [
    { x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 },
  ];

  it("Quadrat: Punkt klar innen -> wn=1 (gegen den Uhrzeigersinn) und innen=true", () => {
    expect(Math.abs(windingNumber(5, 5, square))).toBe(1);
    expect(pointInPolygonWN(5, 5, square)).toBe(true);
  });

  it("Quadrat: Punkt klar aussen -> wn=0 und innen=false", () => {
    expect(windingNumber(20, 5, square)).toBe(0);
    expect(windingNumber(-1, 5, square)).toBe(0);
    expect(pointInPolygonWN(20, 5, square)).toBe(false);
    expect(pointInPolygonWN(5, -1, square)).toBe(false);
  });

  it("Boundary-Branch: Punkt EXAKT auf einer Kante zaehlt als innen", () => {
    // Mitte der unteren Kante, einer Ecke, der rechten Kante.
    expect(pointInPolygonWN(5, 0, square)).toBe(true);   // untere Kante
    expect(pointInPolygonWN(0, 0, square)).toBe(true);   // Ecke
    expect(pointInPolygonWN(10, 7, square)).toBe(true);  // rechte Kante
  });

  it("geschlossenes Polygon (letzter==erster) wird wie offenes behandelt", () => {
    const closed = [...square, { x: 0, y: 0 }];
    expect(pointInPolygonWN(5, 5, closed)).toBe(true);
    expect(pointInPolygonWN(20, 5, closed)).toBe(false);
  });

  it("< 3 Punkte oder fehlend -> aussen/0 (fail-closed)", () => {
    expect(windingNumber(0, 0, null)).toBe(0);
    expect(windingNumber(0, 0, [{ x: 0, y: 0 }, { x: 1, y: 1 }])).toBe(0);
    expect(pointInPolygonWN(0, 0, [])).toBe(false);
  });

  // --- ROBUSTHEITS-BEWEIS: selbst-ueberschneidendes Polygon (Pentagramm-Stern).
  // Winding != Even-Odd: im Zentrum des Sterns ist wn=2 (innen, nonzero), waehrend
  // Even-Odd dieselbe Region faelschlich als "aussen" klassifizieren wuerde.
  it("Stern (selbst-ueberschneidend): Zentrum hat |wn|=2 -> innen (nonzero), wo even-odd 'aussen' saegt", () => {
    // 5-zackiger Stern als zusammenhaengender Linienzug (Vertices in Stern-Reihenfolge,
    // d.h. jeder 2. Punkt des regulaeren 5-Ecks). Zentrum bei (0,0).
    const star = [];
    for (let i = 0; i < 5; i++) {
      const a = (-Math.PI / 2) + (i * 4 * Math.PI / 5); // 144-Grad-Spruenge
      star.push({ x: Math.cos(a), y: Math.sin(a) });
    }
    const wnCenter = windingNumber(0, 0, star);
    expect(Math.abs(wnCenter)).toBe(2); // doppelt umlaufen -> nonzero => innen
    expect(pointInPolygonWN(0, 0, star)).toBe(true);

    // Unabhaengige Even-Odd-Gegenprobe (Ray-Casting, Crossing-Paritaet): zaehlt
    // im Stern-Zentrum eine GERADE Anzahl Kreuzungen -> "aussen". Das ist genau
    // der Fall, in dem Even-Odd falsch und Winding richtig liegt.
    const evenOdd = (px, py, poly) => {
      let inside = false;
      for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const xi = poly[i].x, yi = poly[i].y, xj = poly[j].x, yj = poly[j].y;
        const hit = (yi > py) !== (yj > py)
          && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi;
        if (hit) inside = !inside;
      }
      return inside;
    };
    expect(evenOdd(0, 0, star)).toBe(false); // even-odd: faelschlich "aussen"
    // -> Winding (true) und Even-Odd (false) divergieren genau hier (Robustheits-Beweis).
  });
});

// ---------------------------------------------------------------------------
// 2) Ellipse-Domaene in buildNeighbors.
// ---------------------------------------------------------------------------
describe("buildNeighbors shape=ellipse", () => {
  it("Degeneration a==b ist exakt ein Kreis (gleiche Maske wie shape=circle)", () => {
    const R = 61, C = 61;
    const r = 20;
    const circ = buildNeighbors(R, C, "circle", { circleRadius: r });
    const ell = buildNeighbors(R, C, "ellipse", { ellipseA: r, ellipseB: r });
    expect(ell.inCount).toBe(circ.inCount);
    // Maske zellweise identisch.
    let diff = 0;
    for (let i = 0; i < ell.mask.length; i++) if (ell.mask[i] !== circ.mask[i]) diff++;
    expect(diff).toBe(0);
  });

  it("inCount vs analytische Ellipsenflaeche (Verhaeltnis ~1.0)", () => {
    // Gitter gross genug, dass die Ellipse vollstaendig hineinpasst.
    const R = 121, C = 141;
    const a = 40, b = 25; // Gitterschritte
    const nb = buildNeighbors(R, C, "ellipse", { ellipseA: a, ellipseB: b });
    // Welt-Halbachsen (wie im Code: *1.5, hier nicht geklemmt -> passt ins Gitter).
    const aW = a * 1.5, bW = b * 1.5;
    // Zellflaeche im Welt-Raum: vertikaler Reihenabstand 1.5 * horizontaler S3.
    const cellArea = 1.5 * S3;
    const analytic = (Math.PI * aW * bW) / cellArea;
    const ratio = nb.inCount / analytic;
    expect(ratio).toBeGreaterThan(0.97);
    expect(ratio).toBeLessThan(1.03);
  });

  it("kleinere Achsen -> weniger Zellen; Achsen auf Gitter geklemmt (fail-closed)", () => {
    const R = 81, C = 81;
    const small = buildNeighbors(R, C, "ellipse", { ellipseA: 10, ellipseB: 8 });
    const big = buildNeighbors(R, C, "ellipse", { ellipseA: 40, ellipseB: 40 });
    expect(small.inCount).toBeGreaterThan(0);
    expect(small.inCount).toBeLessThan(big.inCount);
    // Riesen-Achsen werden auf die Gitter-Halbachsen geklemmt -> nicht groesser
    // als die volle eingeschriebene Ellipse (== max).
    const huge = buildNeighbors(R, C, "ellipse", { ellipseA: 9999, ellipseB: 9999 });
    const max = buildNeighbors(R, C, "ellipse"); // ohne opts = Maximum
    expect(huge.inCount).toBe(max.inCount);
  });

  it("Ellipse berandet: Torus == Edge (keine antipodale Wrap-Kante)", () => {
    const nb = buildNeighbors(41, 41, "ellipse", { ellipseA: 15, ellipseB: 10 });
    // berandet -> torus[k] muss == edge[k] sein (Audit: ellipse faellt auf edge).
    let mismatch = 0;
    for (let i = 0; i < nb.torus.length; i++) if (nb.torus[i] !== nb.edge[i]) mismatch++;
    expect(mismatch).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 3) Freiform-Domaene in buildNeighbors.
// ---------------------------------------------------------------------------
describe("buildNeighbors shape=freeform", () => {
  // Hilfsfunktion: welche Zellen liegen (per unabhaengigem Test) innen?
  const wnInsideCount = (R, C, poly) => {
    let cnt = 0;
    for (let r = 0; r < R; r++) for (let c = 0; c < C; c++) {
      if (pointInPolygonWN(wx(r, c), wy(r), poly)) cnt++;
    }
    return cnt;
  };

  it("Quadrat-Polygon: inCount == unabhaengig gezaehlte Innenmenge", () => {
    const R = 41, C = 41;
    const cx = wx(20, 20), cy = wy(20);
    // achsenparalleles Quadrat um die Mitte (Welt-Koords).
    const half = 10;
    const poly = [
      { x: cx - half, y: cy - half }, { x: cx + half, y: cy - half },
      { x: cx + half, y: cy + half }, { x: cx - half, y: cy + half },
    ];
    const nb = buildNeighbors(R, C, "freeform", { polygon: poly });
    expect(nb.inCount).toBeGreaterThan(0);
    expect(nb.inCount).toBe(wnInsideCount(R, C, poly));
  });

  it("Stern-Polygon (selbst-ueberschneidend): Winding != Even-Odd, Maske nicht leer", () => {
    const R = 51, C = 51;
    const cx = wx(25, 25), cy = wy(25);
    const rad = 12;
    const star = [];
    for (let i = 0; i < 5; i++) {
      const a = (-Math.PI / 2) + (i * 4 * Math.PI / 5);
      star.push({ x: cx + rad * Math.cos(a), y: cy + rad * Math.sin(a) });
    }
    const nb = buildNeighbors(R, C, "freeform", { polygon: star });
    expect(nb.inCount).toBe(wnInsideCount(R, C, star));
    expect(nb.inCount).toBeGreaterThan(0);
    // Das Zentrum (nonzero-winding) muss in der Maske sein.
    const centerIdx = 25 * C + 25;
    expect(nb.mask[centerIdx]).toBe(1);
  });

  it("fehlendes / zu kurzes Polygon -> leere Domaene (fail-closed, kein 'alles drin')", () => {
    const R = 21, C = 21;
    const none = buildNeighbors(R, C, "freeform"); // opts undefined
    const tooShort = buildNeighbors(R, C, "freeform", { polygon: [{ x: 0, y: 0 }, { x: 1, y: 1 }] });
    expect(none.inCount).toBe(0);
    expect(tooShort.inCount).toBe(0);
  });

  it("Freiform berandet: Torus == Edge", () => {
    const R = 31, C = 31;
    const cx = wx(15, 15), cy = wy(15);
    const poly = [
      { x: cx - 8, y: cy - 8 }, { x: cx + 8, y: cy - 8 },
      { x: cx + 8, y: cy + 8 }, { x: cx - 8, y: cy + 8 },
    ];
    const nb = buildNeighbors(R, C, "freeform", { polygon: poly });
    let mismatch = 0;
    for (let i = 0; i < nb.torus.length; i++) if (nb.torus[i] !== nb.edge[i]) mismatch++;
    expect(mismatch).toBe(0);
  });
});
