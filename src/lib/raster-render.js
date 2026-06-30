// =============================================================================
// GolHex Raster-Render (pure) - aus src/App.tsx (drawRaster) extrahiert (AP-1).
// EINE Quelle der Wahrheit fuer den ImageData-Raster-Fast-Path (winzige Zellen /
// XXL / 500x500). Wird vom Haupt-Thread (App.tsx drawRaster) UND vom
// OffscreenCanvas-Worker (src/worker/render-worker.js) aufgerufen -> kein Fork.
//
// Schreibt RGBA-little-endian (0xAABBGGRR) direkt in ein Uint32Array. KEIN ctx,
// KEIN DOM. Logik byte-identisch zum bisherigen drawRaster-Pixelpfad (reiner
// Move + Parametrisierung): gleiche Schwellen, gleiche Bucket-Mathematik,
// gleiches plot()-Rechteck. Verifiziert ueber die unveraenderten Visual-Baselines.
// =============================================================================
import {
  ALLCOL, COLA, BG_PACK, packRGB, parsePack,
  G_AA, G_Aa, G_aa, geneColor, collatzColor, rvalColor,
} from "./sim-engine.js";
// F10-ext: CVD-safe Familien/cividis fuer den Raster-Fast-Path (winzige Zellen).
import { familyColor, GENE_CVD, cividisCss } from "./cell-style.js";
// Hex (#RRGGBB) -> gepacktes RGBA-little-endian (parsePack kann nur "rgb(...)").
const hexPack = (h) => { const n = String(h).replace("#", ""); return packRGB(parseInt(n.slice(0, 2), 16), parseInt(n.slice(2, 4), 16), parseInt(n.slice(4, 6), 16)); };

/**
 * Fuellt d32 (Wc*Hc Uint32-Pixel) mit dem Raster-Fast-Path.
 * @param {Uint32Array} d32   Ziel-Pixelpuffer (RGBA little-endian), Laenge Wc*Hc
 * @param {object} p          Render-Parameter
 *   p.Wc, p.Hc       Canvas-Pixelmasse
 *   p.hr             Hex-Radius (world units) der aktuellen Grid-Stufe
 *   p.s, p.tx, p.ty  View-Transform (scale / translate, CSS-Pixel)
 *   p.dpr            devicePixelRatio
 *   p.CX, p.CY       Float32Array Welt-Zentren je Zelle
 *   p.mode           "rval" | "life"
 *   p.rule           rval-Regel-Id (nur mode==="rval")
 *   p.col            Uint8Array Farbzustaende (life)
 *   p.fld, p.fim     Float32Array Feld Re/Im (rval)
 */
export function renderRaster(d32, p) {
  const { Wc, Hc, hr, s, tx, ty, dpr, CX, CY, mode } = p;
  d32.fill(BG_PACK);
  const half = Math.max(0, Math.floor(hr * s * dpr * 0.72));
  const plot = (px, py, packed) => {
    let y0 = py - half, y1 = py + half, x0 = px - half, x1 = px + half;
    if (y0 < 0) y0 = 0; if (y1 >= Hc) y1 = Hc - 1; if (x0 < 0) x0 = 0; if (x1 >= Wc) x1 = Wc - 1;
    for (let yy = y0; yy <= y1; yy++) { const row = yy * Wc; for (let xx = x0; xx <= x1; xx++) d32[row + xx] = packed; }
  };
  const cvd = !!p.cvd; // F10-ext: opt-in CVD-safe Faerbung (Default OFF = bytegleich)
  if (mode === "rval") {
    const rule = p.rule, fld = p.fld, fim = p.fim;
    if (rule === "genes") {
      const gp = cvd
        ? { [G_AA]: hexPack(GENE_CVD.AA), [G_Aa]: hexPack(GENE_CVD.Aa), [G_aa]: hexPack(GENE_CVD.aa) }
        : { [G_AA]: parsePack(geneColor(G_AA)), [G_Aa]: parsePack(geneColor(G_Aa)), [G_aa]: parsePack(geneColor(G_aa)) };
      for (let i = 0; i < fld.length; i++) { const gv = fld[i]; if (!gv || !gp[gv]) continue; plot(Math.round((CX[i] * s + tx) * dpr), Math.round((CY[i] * s + ty) * dpr), gp[gv]); }
    } else {
      const BUCKETS = 24; let thresh = 0, vmax = 0;
      if (rule === "snow") thresh = 0.02; else if (rule === "water") thresh = 0.01; else if (rule === "hqst") thresh = 1e-5; else thresh = 1.0001;
      if (rule === "hqst") { for (let i = 0; i < fld.length; i++) { const pr = fld[i] * fld[i] + fim[i] * fim[i]; if (pr > vmax) vmax = pr; } if (vmax < 1e-12) vmax = 1; }
      const bcol = new Array(BUCKETS);
      // CVD: cividis ueber die wert-geordnete Bucket-Position (graustufenlesbar).
      for (let bi = 0; bi < BUCKETS; bi++) { let repV; if (rule === "collatz") repV = Math.pow(2, (bi + 0.5) / BUCKETS * 30); else if (rule === "hqst") repV = (bi + 0.5) / BUCKETS * vmax; else repV = (bi + 0.5) / (BUCKETS - 1); bcol[bi] = cvd ? parsePack(cividisCss(bi / (BUCKETS - 1))) : parsePack(rule === "collatz" ? collatzColor(repV) : rvalColor(repV, rule)); }
      for (let i = 0; i < fld.length; i++) {
        let v = fld[i];
        if (rule === "hqst") { v = fld[i] * fld[i] + fim[i] * fim[i]; if (v < thresh) continue; }
        else if (rule === "collatz") { if (v <= 1) continue; }
        else if (v < thresh) continue;
        let bi;
        if (rule === "collatz") bi = Math.min(BUCKETS - 1, Math.floor(Math.log2(v) / 30 * BUCKETS));
        else if (rule === "hqst") bi = Math.min(BUCKETS - 1, Math.floor(Math.min(1, v / vmax) * (BUCKETS - 1)));
        else bi = Math.min(BUCKETS - 1, Math.floor(Math.min(1, v) * (BUCKETS - 1)));
        plot(Math.round((CX[i] * s + tx) * dpr), Math.round((CY[i] * s + ty) * dpr), bcol[bi]);
      }
    }
  } else {
    const col = p.col, packed = {};
    // F10-ext: bei winzigen Zellen (Raster) traegt FARBE die Spezies-Familie (6
    // CVD-sichere Toene); die Lebenszyklus-FORM ist hier ohnehin sub-pixel (Spec
    // §3.4: exakte Spezies via Tap). Default OFF -> volle 12 Itten-Toene wie bisher.
    if (cvd) { for (const cc of ALLCOL) packed[cc] = hexPack(familyColor(cc)); }
    else { for (const cc of ALLCOL) { const a = COLA[cc]; packed[cc] = packRGB(a[0], a[1], a[2]); } }
    for (let i = 0; i < col.length; i++) { const cc = col[i]; if (!cc) continue; plot(Math.round((CX[i] * s + tx) * dpr), Math.round((CY[i] * s + ty) * dpr), packed[cc]); }
  }
}
