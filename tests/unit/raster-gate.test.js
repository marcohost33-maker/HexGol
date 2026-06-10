import { describe, it, expect } from "vitest";
import { usesRasterPath, RASTER_MAX_HR, RASTER_PX_THRESHOLD } from "../../src/lib/ui-gestures.js";
import { GRID_SIZES, worldSize } from "../../src/lib/sim-engine.js";

// =============================================================================
// REQUIRED HEX-CELLS GATE (Marco-Kernforderung, Bug 3. Wiederholung 2026-06-10).
//
// GolHex ist HEXAGONAL — die Zellen MUESSEN als Hexagone rendern. Der ImageData-
// Raster-Fast-Path malt QUADRATE und darf NUR bei genuin winzigen Zellen grosser
// Gitter greifen. Dieser Test rekonstruiert die ECHTE Geometrie (GRID_SIZES +
// worldSize + fit-scale) auf realen, SCHMALEN Hochkant-Viewports und beweist, dass
// das Default-/Normal-Gitter NIE in den Raster-(Quadrat-)Pfad faellt.
//
// FALSIFIKATION (warum dieser Test den Bug fing): mit der alten REINEN pxR-Schwelle
// (`pxR < 2.0`, ohne hr-Gate) faellt M (hr=6) auf einem 360-375px-iPhone auf
// pxR=1.90-1.98 < 2.0 -> raster=true -> QUADRATE. Genau dieser Fall (`usesRasterPath
// nur pxR`) ist hier als roter Test kodiert: ein hr-blinder Gate wuerde
// "M @ 375px -> hexagons" REISSEN. Der korrekte hr-Gate haelt M immer hexagonal.
// =============================================================================

// Reine fit-scale-Geometrie wie src/App.tsx fitView(): s = min(cw/W, ch/H) * 0.98.
// Liefert den on-screen Zell-Radius pxR = hr * s in CSS-px (genau der Wert, den
// draw() an usesRasterPath uebergibt).
function fitPxR(size, cw, ch) {
  const { rows, cols, hr } = size;
  const { W, H } = worldSize(rows, cols, hr);
  const s = Math.min(cw / W, ch / H) * 0.98;
  return hr * s;
}

// Reale Canvas-Innenbreite je Geraet: Viewport - 2x8px Shell-Padding - 2x1px Rand
// (compact-Shell, src/App.tsx Zeile ~3472 + .ghx-canvas border). ch gross (hoher
// Hochkant-Canvas), damit die Breite bindet (M-Welt ist 1060 breit).
const cwOf = (vp) => vp - 16 - 2;
const TALL_CH = 700;

// Reale CSS-Breiten gaengiger iPhones/Androids (Hochkant). 375/360 sind die
// kritischen Geraete, auf denen die alte pxR-only-Schwelle M zu Quadraten machte.
const PHONE_WIDTHS = [430, 414, 393, 390, 375, 360];

const byLabel = (l) => GRID_SIZES.find((g) => g.l === l);

describe("usesRasterPath — HEX-CELLS-LOAD-BEARING render gate", () => {
  // --- KERN-GARANTIE: Default-/Normal-Gitter NIE Raster, auf KEINEM Geraet ------
  it("DEFAULT M-Gitter rendert auf JEDEM Geraet als Hexagone (nie Raster)", () => {
    const M = byLabel("M");
    for (const vp of PHONE_WIDTHS) {
      const pxR = fitPxR(M, cwOf(vp), TALL_CH);
      expect(
        usesRasterPath(pxR, M.hr),
        `M (hr=${M.hr}) @ ${vp}px (pxR=${pxR.toFixed(3)}) MUSS Hexagone sein, NIE Raster`,
      ).toBe(false);
    }
  });

  it("S-Gitter (groesste Zellen) rendert nie als Raster", () => {
    const S = byLabel("S");
    for (const vp of PHONE_WIDTHS) {
      const pxR = fitPxR(S, cwOf(vp), TALL_CH);
      expect(usesRasterPath(pxR, S.hr), `S @ ${vp}px`).toBe(false);
    }
  });

  // --- DER BUG, EXAKT: M auf 375/360px hat pxR < 2.0, darf aber NICHT rastern ----
  // Dieser Test ist die Falsifikation: ein reiner pxR<2.0-Gate (alter Code) liefert
  // hier TRUE -> Quadrate -> rot. Der hr-Gate haelt es FALSE -> gruen.
  it("M auf 375/360px hat pxR UNTER 2.0, bleibt aber dank hr-Gate hexagonal", () => {
    const M = byLabel("M");
    for (const vp of [375, 360]) {
      const pxR = fitPxR(M, cwOf(vp), TALL_CH);
      // Beleg, dass wir wirklich im gefaehrlichen Bereich sind (sonst testet der Test nichts):
      expect(pxR, `M @ ${vp}px liegt im pxR<2.0-Gefahrenbereich`).toBeLessThan(RASTER_PX_THRESHOLD);
      // Trotzdem KEIN Raster (hr=6 > RASTER_MAX_HR):
      expect(usesRasterPath(pxR, M.hr), `M @ ${vp}px trotz pxR<2.0 hexagonal`).toBe(false);
    }
  });

  // --- Freeze-Schutz bleibt: grosse Gitter rastern weiterhin bei winzigen Zellen -
  it("grosse Gitter (L/XL/XXL/3XL+) rastern bei fit-scale (Freeze-Schutz haelt)", () => {
    for (const l of ["L", "XL", "XXL", "3XL", "4XL", "5XL"]) {
      const g = byLabel(l);
      const pxR = fitPxR(g, cwOf(390), TALL_CH);
      expect(pxR, `${l} fit-pxR < Schwelle`).toBeLessThan(RASTER_PX_THRESHOLD);
      expect(usesRasterPath(pxR, g.hr), `${l} (hr=${g.hr}) -> Raster-Fast-Path`).toBe(true);
    }
  });

  // --- Hineingezoomtes grosses Gitter rendert wieder hexagonal (pxR ueber Schwelle)
  it("ein hineingezoomtes grosses Gitter (pxR >= 2.0) rendert hexagonal", () => {
    const L = byLabel("L");
    expect(usesRasterPath(5.0, L.hr), "L weit reingezoomt -> Hexagone").toBe(false);
  });

  // --- Schwellen-Invarianten: schuetzen die Konstanten vor versehentlicher Drift -
  it("RASTER_MAX_HR liegt strikt zwischen L (hr=4) und M (hr=6)", () => {
    const M = byLabel("M"), L = byLabel("L");
    expect(L.hr).toBeLessThanOrEqual(RASTER_MAX_HR); // L darf rastern
    expect(M.hr).toBeGreaterThan(RASTER_MAX_HR);     // M NIE
    expect(RASTER_MAX_HR).toBeGreaterThanOrEqual(L.hr);
    expect(RASTER_MAX_HR).toBeLessThan(M.hr);
  });

  // --- Silent-Failure-Gate: Muell-Eingaben rendern hexagonal (korrekte Form) -----
  it("NaN/garbage faellt sicher auf Hexagone (nie versehentlich Raster)", () => {
    expect(usesRasterPath(NaN, 6)).toBe(false);
    expect(usesRasterPath(1.0, NaN)).toBe(false);
    expect(usesRasterPath(undefined, undefined)).toBe(false);
    expect(usesRasterPath(Infinity, 2)).toBe(false);
  });
});
