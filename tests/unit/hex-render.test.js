import { describe, it, expect } from "vitest";
import { renderHex } from "../../src/lib/hex-render.js";

// =============================================================================
// HEX-RENDER (src/lib/hex-render.js) -- der Path2D-Hexagon-Pfad, der dem
// OffscreenCanvas-Worker bisher fehlte (Marco 5XL-Quadrate-Bug, 4. Wiederholung).
//
// Beweisziel:
//   1. Eine gemalte Zelle ist ein SECHSECK (6 Eckpunkte, pointy-top), KEIN Quadrat.
//   2. Viewport-Culling: ausserhalb des sichtbaren Welt-Rechtecks liegende Zellen
//      werden NICHT in die Pfade aufgenommen (Freeze-Schutz bei 250k Zellen).
//   3. Silent-Failure-Gate: leere/garbage Eingaben werfen nicht.
//
// Mechanik: ein injizierter Path2D-Recorder (p.Path2D) protokolliert moveTo/lineTo,
// ein Fake-2D-Kontext faengt fill/setTransform ab. So ist die GEOMETRIE pruefbar
// ohne echtes Canvas (wie render-worker.test.js den Worker ohne echten Worker prueft).
// =============================================================================

class RecPath {
  constructor() { this.pts = []; }
  moveTo(x, y) { this.pts.push(["M", x, y]); }
  lineTo(x, y) { this.pts.push(["L", x, y]); }
  closePath() { this.pts.push(["Z"]); }
}

function fakeCtx() {
  const filled = [];
  return {
    filled,
    setTransform() {}, fillRect() {},
    fill(p) { filled.push(p); },
    stroke() {},
    set fillStyle(_v) {}, get fillStyle() { return "#000"; },
    set strokeStyle(_v) {}, get strokeStyle() { return "#000"; },
    set lineWidth(_v) {}, get lineWidth() { return 1; },
  };
}

// Geometrie eines pointy-top-Hexagons mit Welt-Zentrum (cx,cy), Radius rr.
// 6 Ecken bei -PI/2 + k*PI3. moveTo + 5x lineTo = 6 Punkte (Fuell-Pfad, ohne close).
function expectedHexPoints(cx, cy, rr) {
  const out = [];
  for (let k = 0; k < 6; k++) { const a = -Math.PI / 2 + k * (Math.PI / 3); out.push([cx + rr * Math.cos(a), cy + rr * Math.sin(a)]); }
  return out;
}

describe("renderHex — Path2D-Hexagon-Pfad (Worker-Hex, Marco 5XL-Bug)", () => {
  it("malt EINE life-Zelle als regelmaessiges SECHSECK (6 Ecken), nicht als Quadrat", () => {
    const ctx = fakeCtx();
    // 1 Zelle, Zentrum (10,10), Farbe 1, voll im Viewport.
    const CX = new Float32Array([10]); const CY = new Float32Array([10]);
    const col = new Uint8Array([1]); const gh = new Uint8Array([0]);
    renderHex(ctx, {
      Wc: 200, Hc: 200, hr: 10, s: 1, tx: 0, ty: 0, dpr: 1,
      CX, CY, mode: "life", col, gh, Path2D: RecPath,
    });
    // Genau ein gefuellter Pfad (eine Farbe). Glow aus (pxR=10>=5 -> Glow AN!).
    // pxR=hr*s=10 -> drawGlow=true -> 2 fills (Glow + Fuellung) fuer dieselbe Farbe.
    expect(ctx.filled.length).toBeGreaterThanOrEqual(1);
    const fillPath = ctx.filled[ctx.filled.length - 1]; // Fuellung (zuletzt) rr=hr*0.92
    const verts = fillPath.pts.filter((p) => p[0] === "M" || p[0] === "L");
    // SECHS Eckpunkte == Hexagon. Ein Quadrat haette 4. Das ist die Kern-Diskriminante.
    expect(verts.length, "Hexagon hat 6 Ecken (Quadrat haette 4)").toBe(6);
    // Geometrie exakt gegen die pointy-top-Hex-Formel (rr = hr*0.92 = 9.2).
    const exp = expectedHexPoints(10, 10, 9.2);
    verts.forEach((v, k) => {
      expect(v[1]).toBeCloseTo(exp[k][0], 5);
      expect(v[2]).toBeCloseTo(exp[k][1], 5);
    });
    // pointy-top: erste Ecke liegt OBEN (y minimal), Ober-/Unterkante sind je EIN
    // Punkt (Spitze), nicht zwei -> falsifiziert ein achsenparalleles Quadrat.
    const ys = verts.map((v) => v[2]);
    const topCount = ys.filter((y) => Math.abs(y - Math.min(...ys)) < 1e-6).length;
    expect(topCount, "Spitze oben = genau 1 Punkt (Quadrat haette 2)").toBe(1);
  });

  it("VIEWPORT-CULLING: Zellen ausserhalb des sichtbaren Welt-Rechtecks werden NICHT gezeichnet", () => {
    const ctx = fakeCtx();
    // 3 Zellen: (10,10) sichtbar; (10000,10000) + (-9000,-9000) weit ausserhalb.
    const CX = new Float32Array([10, 10000, -9000]);
    const CY = new Float32Array([10, 10000, -9000]);
    const col = new Uint8Array([1, 1, 1]); const gh = new Uint8Array([0, 0, 0]);
    renderHex(ctx, {
      Wc: 200, Hc: 200, hr: 10, s: 1, tx: 0, ty: 0, dpr: 1,
      CX, CY, mode: "life", col, gh, Path2D: RecPath,
    });
    // Nur die EINE sichtbare Zelle landet im Fuell-Pfad -> 6 Ecken total, nicht 18.
    const fillPath = ctx.filled[ctx.filled.length - 1];
    const verts = fillPath.pts.filter((p) => p[0] === "M" || p[0] === "L");
    expect(verts.length, "nur die sichtbare Zelle (6 Ecken), Off-Screen gecullt").toBe(6);
  });

  it("rval-Modus (snow): ueberschwellige Zellen als Hexagone, Bucket-Batching", () => {
    const ctx = fakeCtx();
    const CX = new Float32Array([10, 30]); const CY = new Float32Array([10, 10]);
    const fld = new Float32Array([0.9, 0.0]); // Zelle 0 ueber thresh(0.02), Zelle 1 nicht
    const fim = new Float32Array([0, 0]);
    renderHex(ctx, {
      Wc: 200, Hc: 200, hr: 10, s: 1, tx: 0, ty: 0, dpr: 1,
      CX, CY, mode: "rval", rule: "snow", fld, fim, Path2D: RecPath,
    });
    expect(ctx.filled.length, "ein Bucket gefuellt").toBeGreaterThanOrEqual(1);
    const verts = ctx.filled[0].pts.filter((p) => p[0] === "M" || p[0] === "L");
    expect(verts.length, "rval-Zelle ist ebenfalls ein Hexagon (6 Ecken)").toBe(6);
  });

  it("Silent-Failure-Gate: leere Gitter + fehlendes Path2D werfen nicht", () => {
    const ctx = fakeCtx();
    const empty = new Float32Array(0);
    expect(() => renderHex(ctx, { Wc: 10, Hc: 10, hr: 4, s: 1, tx: 0, ty: 0, dpr: 1, CX: empty, CY: empty, mode: "life", col: new Uint8Array(0), Path2D: RecPath })).not.toThrow();
    // Ohne Path2D (z.B. exotische Umgebung): kein Wurf, nur kein Pfad-Render.
    expect(() => renderHex(ctx, { Wc: 10, Hc: 10, hr: 4, s: 1, tx: 0, ty: 0, dpr: 1, CX: new Float32Array([5]), CY: new Float32Array([5]), mode: "life", col: new Uint8Array([1]), Path2D: null })).not.toThrow();
  });
});

// =============================================================================
// #111 -- CVD-Dying-Ring traegt die ECHTE letzte Spezies-Familie (Parity zum
// Main-Thread App.tsx lastLiveColorRef, Marco-Entscheid 3 zu #110).
//
// Vorher substituierte der Worker-Hex-Pfad fuer ALLE Dying-Ringe pauschal
// DYING_NEUTRAL. Jetzt liest er p.lastLive (Worker-last-live-Puffer) und faerbt
// den Ring nach familyOf(lastLive[i]) -- neutral nur als Fallback (familyOf == -1
// bzw. kein Puffer geliefert). Diese Tests pruefen die strokeStyle-Zuordnung.
// =============================================================================

// Kontext, der strokeStyle ZUM stroke()-Zeitpunkt festhaelt (der fakeCtx oben
// schluckt strokeStyle -> hier eigener Recorder fuer die Ring-Farb-Zuordnung).
function strokeRecCtx() {
  const strokes = [];
  let _ss = "#000";
  return {
    strokes,
    setTransform() {}, fillRect() {}, fill() {},
    stroke(p) { strokes.push({ style: _ss, path: p }); },
    set fillStyle(_v) {}, get fillStyle() { return "#000"; },
    set strokeStyle(v) { _ss = v; }, get strokeStyle() { return _ss; },
    set lineWidth(_v) {}, get lineWidth() { return 1; },
  };
}

describe("#111 renderHex CVD — Dying-Ring traegt echte letzte Familie (Main-Parity)", () => {
  // Import lazily inside test bodies to keep the file's top imports minimal? No —
  // vitest hoists; use a static import block at file head is cleaner, aber hier
  // reicht dynamic require-Style via top-level. Wir nutzen die shared cell-style.

  it("faerbt jeden Dying-Ring nach familyOf(lastLive[i]); neutral nur als Fallback", async () => {
    const { SPECIES_FAMILY, DYING_NEUTRAL, familyOf } = await import("../../src/lib/cell-style.js");
    const ctx = strokeRecCtx();
    // 3 sterbende Zellen (col=0, gh=1), alle im Viewport. lastLive-Familien:
    //   i0: id 1  -> familyOf=0 (skyBlue)
    //   i1: id 5  -> familyOf=2 (yellow)
    //   i2: id 0  -> familyOf=-1 -> NEUTRAL-Fallback
    const CX = new Float32Array([10, 30, 50]);
    const CY = new Float32Array([10, 10, 10]);
    const col = new Uint8Array([0, 0, 0]);
    const gh = new Uint8Array([1, 1, 1]);
    const lastLive = new Uint8Array([1, 5, 0]);
    renderHex(ctx, {
      Wc: 200, Hc: 200, hr: 8, s: 1, tx: 0, ty: 0, dpr: 1, // pxR=8 -> ring aktiv
      CX, CY, mode: "life", col, gh, cvd: true, lastLive, Path2D: RecPath,
    });
    const styles = ctx.strokes.map((s) => s.style);
    // Family 0 (id 1) und Family 2 (id 5) muessen als eigene Ring-Farbe erscheinen.
    expect(styles, "Family-0-Ring (skyBlue) gezeichnet").toContain(SPECIES_FAMILY[0]);
    expect(styles, "Family-2-Ring (yellow) gezeichnet").toContain(SPECIES_FAMILY[2]);
    // Zelle ohne je gemerkte Familie -> neutraler Ring als Fallback.
    expect(styles, "Neutral-Fallback fuer nie-gelebte Zelle").toContain(DYING_NEUTRAL);
    // Kein Ring traegt eine falsche Familie (nur 0, 2 und Neutral vorhanden).
    const wrong = styles.filter((s) => s === SPECIES_FAMILY[1] || s === SPECIES_FAMILY[3] || s === SPECIES_FAMILY[4]);
    expect(wrong.length, "keine falsche Familie eingefaerbt").toBe(0);
    // Sanity: familyOf-Orakel unabhaengig bestaetigen (kein Selbstbezug auf Render).
    expect(familyOf(1)).toBe(0); expect(familyOf(5)).toBe(2); expect(familyOf(0)).toBe(-1);
  });

  it("Rueckwaerts-kompatibel: OHNE lastLive-Puffer bleibt der Ring NEUTRAL (kein Wurf)", async () => {
    const { SPECIES_FAMILY, DYING_NEUTRAL } = await import("../../src/lib/cell-style.js");
    const ctx = strokeRecCtx();
    const CX = new Float32Array([10]); const CY = new Float32Array([10]);
    const col = new Uint8Array([0]); const gh = new Uint8Array([1]);
    // KEIN lastLive (Alt-Aufrufer / Alt-Test): Fallback = DYING_NEUTRAL, kein Wurf.
    expect(() => renderHex(ctx, {
      Wc: 200, Hc: 200, hr: 8, s: 1, tx: 0, ty: 0, dpr: 1,
      CX, CY, mode: "life", col, gh, cvd: true, Path2D: RecPath,
    })).not.toThrow();
    const styles = ctx.strokes.map((s) => s.style);
    expect(styles, "ohne Puffer -> neutraler Ring").toContain(DYING_NEUTRAL);
    expect(styles.some((s) => SPECIES_FAMILY.includes(s) && s !== DYING_NEUTRAL),
      "keine Spezies-Familie ohne Puffer").toBe(false);
  });

  it("Silent-Failure-Gate: CVD-Dying-Ring mit leerem/kaputtem lastLive wirft nicht", async () => {
    const ctx = strokeRecCtx();
    // lastLive kuerzer als N / undefined-Zugriffe -> familyOf(undefined)=-1 -> neutral, kein Wurf.
    const CX = new Float32Array([10, 30]); const CY = new Float32Array([10, 10]);
    const col = new Uint8Array([0, 0]); const gh = new Uint8Array([1, 1]);
    const shortLast = new Uint8Array([7]); // Index 1 fehlt -> undefined
    expect(() => renderHex(ctx, {
      Wc: 200, Hc: 200, hr: 8, s: 1, tx: 0, ty: 0, dpr: 1,
      CX, CY, mode: "life", col, gh, cvd: true, lastLive: shortLast, Path2D: RecPath,
    })).not.toThrow();
    // Leeres Gitter im CVD-Modus wirft ebenfalls nicht.
    expect(() => renderHex(ctx, {
      Wc: 10, Hc: 10, hr: 8, s: 1, tx: 0, ty: 0, dpr: 1,
      CX: new Float32Array(0), CY: new Float32Array(0), mode: "life",
      col: new Uint8Array(0), gh: new Uint8Array(0), cvd: true, lastLive: new Uint8Array(0), Path2D: RecPath,
    })).not.toThrow();
  });
});
