// =============================================================================
// GolHex Path2D-HEXAGON-Render (pure, OffscreenCanvas-faehig).
//
// WURZEL (Marco 5XL-Quadrate-Bug, 4. Wiederholung 2026-06-11): Der Render-Worker
// (src/worker/render-worker.js) kannte NUR den Raster-(Quadrat-)Pfad
// (src/lib/raster-render.js). Sobald er bei >=90k Zellen die Canvas via
// transferControlToOffscreen besass (irreversibel), zeichnete ER auf JEDER
// Zoomstufe Quadrate -- auch hineingezoomt, wo eine Zelle gross genug fuer eine
// Hexform ist. Der Main-Thread-Hex-Pfad (App.tsx draw() -> addHexIdx, gated durch
// usesRasterPath) griff im Worker-Modus nie.
//
// DIESES MODUL ist der fehlende Hex-Pfad fuer den Worker. Es zeichnet Hexagone in
// einen 2D-Kontext (OffscreenCanvas ODER normale Canvas) und spiegelt EXAKT die
// Geometrie + Zeichenreihenfolge des Main-Thread-Vollredraws (App.tsx draw()):
//   - 6 pointy-top-Ecken bei Winkel -PI/2 + k*PI3 (k=0..5),
//   - Fuell-Radius hr*0.92, Geister hr*0.78, Glow hr*1.1, Gitterlinie hr*0.95,
//   - Gitterlinien ab pxR>=4, Glow ab pxR>=5,
//   - Farben/Reihenfolge wie Main (ALLCOL-Reihenfolge, Geister-Untergrund zuerst),
//   - rval-Modus mit identischem 24-Bucket-Batching wie Main + Raster.
//
// EINE QUELLE DER WAHRHEIT: die PFAD-WAHL (Raster vs. Hex) liegt unveraendert in
// usesRasterPath() (src/lib/ui-gestures.js) und wird vom Worker importiert, NICHT
// dupliziert. Dieses Modul ist NUR der Hex-Zeichner.
//
// PERFORMANCE -- VIEWPORT-CULLING (gegen den XXL-Freeze, gegen den der Raster-Pfad
// urspruenglich gebaut wurde): bei 250k Zellen darf der Hex-Pfad nur greifen, wenn
// pxR>=2 (Zellen sichtbar/aufloesbar). Das ist NUR beim Hineinzoomen der Fall, wo
// dann zwangslaeufig nur ein BRUCHTEIL der Zellen im Viewport liegt. Wir scannen
// zwar O(N) Indizes (billig: zwei Float-Vergleiche), fuegen aber nur SICHTBARE
// Zellen in die Path2D-Objekte ein -> die teure Skia-Pfad-/fill()-Arbeit ist auf
// den Viewport begrenzt. Das spiegelt das Main-Thread-Verhalten (dort schuetzt der
// inkrementelle Pfad + Vollredraw-bei-Zoom analog). Bench: tests/manual/
// bench-worker-hex.mjs.
// =============================================================================
import {
  ALLCOL, COLA, COLHEX, PI3,
  G_AA, G_Aa, G_aa, geneColor, collatzColor, rvalColor,
} from "./sim-engine.js";
import {
  SPECIES_FAMILY, familyOf, DYING_NEUTRAL,
  formParams, GENE_CVD, cividisCss,
} from "./cell-style.js"; // F10/F10-ext: CVD-safe Stil-Wahl (shared mit App.tsx)

// pointy-top-Hexagon: 6 Ecken bei -PI/2 + k*PI3 (identisch zu App.tsx draw()).
const COSA = [], SINA = [];
for (let k = 0; k < 6; k++) { const a = -Math.PI / 2 + k * PI3; COSA.push(Math.cos(a)); SINA.push(Math.sin(a)); }

// Geister-/Glow-Stilkonstanten -- byte-fuer-byte wie App.tsx draw() (Fuell-Pfad).
const GHOST_FILL = "rgba(140,196,187,0.20)";
const GRID_STROKE = "rgba(92,240,204,0.10)";

/**
 * Zeichnet die Zellen als Path2D-Hexagone in einen 2D-Kontext (Offscreen ODER DOM).
 * Reiner Zeichner: KEINE Pfad-Wahl (die liegt in usesRasterPath); der Aufrufer
 * entscheidet, ob er diesen Pfad oder renderRaster nutzt.
 *
 * @param {CanvasRenderingContext2D|OffscreenCanvasRenderingContext2D} ctx
 * @param {object} p
 *   p.Wc, p.Hc       Canvas-Pixelmasse (Geraete-px)
 *   p.hr             Hex-Radius (world units) der Grid-Stufe
 *   p.s, p.tx, p.ty  View-Transform (scale / translate, CSS-px)
 *   p.dpr            devicePixelRatio
 *   p.CX, p.CY       Float32Array Welt-Zentren je Zelle (== hexCenter, vorberechnet)
 *   p.mode           "life" | "rval"
 *   p.rule           rval-Regel-Id (nur mode==="rval")
 *   p.col            Uint8Array Farbzustaende (life)
 *   p.gh             Uint8Array Geisterzustaende (life; optional)
 *   p.fld, p.fim     Float32Array Feld Re/Im (rval)
 *   p.bgFill         Hintergrundfarbe (string), zum vollflaechigen Loeschen
 *   p.Path2D, p.bg   optionale Injektion (Tests ohne echtes OffscreenCanvas):
 *                    p.Path2D = Path2D-Ctor; p.bg fillStyle fuers Loeschen.
 */
export function renderHex(ctx, p) {
  const { Wc, Hc, hr, s, tx, ty, dpr, CX, CY, mode } = p;
  const P2D = p.Path2D || (typeof Path2D !== "undefined" ? Path2D : null);
  const N = (mode === "rval" ? p.fld.length : p.col.length);
  const pxR = hr * s;

  // 1) Vollflaechig loeschen (Identitaets-Transform), wie der Main-Thread-Vollredraw.
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = p.bgFill || "#0a0e0d";
  ctx.fillRect(0, 0, Wc, Hc);

  // 2) Welt-Transform setzen (identisch zu App.tsx draw(): dpr*s skaliert Welt->Px).
  ctx.setTransform(dpr * s, 0, 0, dpr * s, dpr * tx, dpr * ty);

  // --- Viewport-Culling-Grenzen in WELT-Koordinaten -------------------------
  // Sichtbares CSS-px-Rechteck = [0,Wc/dpr] x [0,Hc/dpr]. Welt-Koord daraus:
  //   xWorld = (xCss - tx) / s. Rand = hr*1.3 (eine Zellenbreite) gegen Clipping
  //   an Zellen, deren Zentrum knapp ausserhalb, deren Ecken aber drinnen liegen.
  const margin = hr * 1.3;
  const cwCss = Wc / dpr, chCss = Hc / dpr;
  const wx0 = (0 - tx) / s - margin, wx1 = (cwCss - tx) / s + margin;
  const wy0 = (0 - ty) / s - margin, wy1 = (chCss - ty) / s + margin;
  const visible = (i) => { const x = CX[i], y = CY[i]; return x >= wx0 && x <= wx1 && y >= wy0 && y <= wy1; };

  const addHex = (path, i, rr) => {
    const x = CX[i], y = CY[i];
    path.moveTo(x + rr * COSA[0], y + rr * SINA[0]);
    for (let k = 1; k < 6; k++) path.lineTo(x + rr * COSA[k], y + rr * SINA[k]);
  };

  // ---------------------------------------------------------------------------
  // rval-Modus: jede Zelle nach Feldwert eingefaerbt, 24-Bucket-Batching wie Main.
  // ---------------------------------------------------------------------------
  if (mode === "rval") {
    const rule = p.rule, fld = p.fld, fim = p.fim;
    if (!P2D) return;
    if (rule === "genes") {
      // F10-ext: CVD-Modus -> 3 CVD-sichere Genotyp-Toene; sonst Standard.
      for (const [gv, colStr] of [
        [G_AA, p.cvd ? GENE_CVD.AA : geneColor(G_AA)],
        [G_Aa, p.cvd ? GENE_CVD.Aa : geneColor(G_Aa)],
        [G_aa, p.cvd ? GENE_CVD.aa : geneColor(G_aa)],
      ]) {
        const path = new P2D(); let any = false;
        for (let i = 0; i < N; i++) { if (fld[i] === gv && visible(i)) { addHex(path, i, hr * 0.92); any = true; } }
        if (any) { ctx.fillStyle = colStr; ctx.fill(path); }
      }
      return;
    }
    const BUCKETS = 24;
    let thresh = 0;
    if (rule === "snow") thresh = 0.02; else if (rule === "water") thresh = 0.01; else if (rule === "hqst") thresh = 1e-5; else thresh = 1.0001;
    let vmax = 0;
    if (rule === "hqst") { for (let i = 0; i < N; i++) { const pr = fld[i] * fld[i] + fim[i] * fim[i]; if (pr > vmax) vmax = pr; } if (vmax < 1e-12) vmax = 1; }
    const buckets = new Array(BUCKETS);
    for (let i = 0; i < N; i++) {
      if (!visible(i)) continue;
      let v = fld[i];
      if (rule === "hqst") { v = fld[i] * fld[i] + fim[i] * fim[i]; if (v < thresh) continue; }
      else if (rule === "collatz") { if (v <= 1) continue; }
      else if (v < thresh) continue;
      let bi;
      if (rule === "collatz") bi = Math.min(BUCKETS - 1, Math.floor(Math.log2(v) / 30 * BUCKETS));
      else if (rule === "hqst") bi = Math.min(BUCKETS - 1, Math.floor(Math.min(1, v / vmax) * (BUCKETS - 1)));
      else bi = Math.min(BUCKETS - 1, Math.floor(Math.min(1, v) * (BUCKETS - 1)));
      let bk = buckets[bi]; if (!bk) bk = buckets[bi] = new P2D();
      addHex(bk, i, hr * 0.95);
    }
    for (let bi = 0; bi < BUCKETS; bi++) {
      const bk = buckets[bi]; if (!bk) continue;
      let repV;
      if (rule === "collatz") repV = Math.pow(2, (bi + 0.5) / BUCKETS * 30);
      else if (rule === "hqst") repV = (bi + 0.5) / BUCKETS * vmax;
      else repV = (bi + 0.5) / (BUCKETS - 1);
      // F10-ext: CVD -> cividis (graustufenlesbar) ueber wert-geordnete Position.
      if (p.cvd) ctx.fillStyle = cividisCss(bi / (BUCKETS - 1));
      else ctx.fillStyle = rule === "collatz" ? collatzColor(repV) : rvalColor(repV, rule);
      ctx.fill(bk);
    }
    return;
  }

  // ---------------------------------------------------------------------------
  // life-Modus: Geister-Untergrund, dann je Farbe Glow + Fuellung (ALLCOL-Folge).
  // Reihenfolge byte-identisch zu App.tsx draw() (Geister -> Glow/Fuellung).
  // Gitterlinien ab pxR>=4, Glow ab pxR>=5 -- exakt die Main-Thread-Schwellen.
  // ---------------------------------------------------------------------------
  if (!P2D) return;
  const col = p.col, gh = p.gh || null;

  // --- F10 CVD-safe life-Pfad (opt-in, p.cvd === true) -----------------------
  // Spiegelt EXAKT App.tsx draw() CVD-Zweig: 4 boolesche Zustaende, Okabe-Ito +
  // Form-Cue (Loch/Ring), nie Farbe allein (WCAG 1.4.1). Reihenfolge: Dying-Ringe
  // (Untergrund) -> Survivor-Fuellung -> Newborn-Fuellung -> Newborn-Loecher.
  // Radien identisch zum Main-Thread: Fuellung hr*0.92, Loch hr*0.34.
  if (p.cvd) {
    // F10-ext (#97): wie App.tsx draw() — 6 Spezies-Familien (Farbe) x Lebenszyklus
    // (Form). #101-1: formParams(pxR) degradiert Loch/Ring grazioes. Einschraenkung
    // ggue. Main-Thread: der Worker fuehrt KEINEN persistenten last-live-Puffer, daher
    // traegt der Dying-Ring hier die NEUTRALE Familie (DYING_NEUTRAL) statt der echten
    // letzten Spezies — bei den grossen Gittern, fuer die der Worker zustaendig ist,
    // ist der Ring ohnehin sub-pixel. Survivor/Newborn (Farbe vorhanden) voll-familiar.
    const age = p.age || null;
    const bg = (p.bgFill || "#0a0e0d");
    const fp = formParams(pxR);
    const survByFam = [], newbByFam = [];
    for (let f = 0; f < 6; f++) { survByFam[f] = new P2D(); newbByFam[f] = new P2D(); }
    const holeP = new P2D(), ringP = new P2D();
    const sAny = [0, 0, 0, 0, 0, 0], nAny = [0, 0, 0, 0, 0, 0];
    let anyHole = false, anyD = false;
    for (let i = 0; i < N; i++) {
      if (!visible(i)) continue;
      const cc = col[i];
      if (cc !== 0) {
        const f = familyOf(cc);
        if (age && age[i] > 1) { addHex(survByFam[f], i, hr * 0.92); sAny[f] = 1; }
        else {
          addHex(newbByFam[f], i, hr * 0.92); nAny[f] = 1;
          if (fp.holeScale > 0) { addHex(holeP, i, hr * fp.holeScale); anyHole = true; }
        }
      } else if (gh && gh[i]) { addHex(ringP, i, hr * fp.ringScale); anyD = true; }
    }
    if (anyD) { ctx.lineWidth = Math.max(0.6, fp.ringWidthK / s); ctx.strokeStyle = DYING_NEUTRAL; ctx.stroke(ringP); }
    for (let f = 0; f < 6; f++) if (sAny[f]) { ctx.fillStyle = SPECIES_FAMILY[f]; ctx.fill(survByFam[f]); }
    for (let f = 0; f < 6; f++) if (nAny[f]) { ctx.fillStyle = SPECIES_FAMILY[f]; ctx.fill(newbByFam[f]); }
    if (anyHole) { ctx.fillStyle = bg; ctx.fill(holeP); }
    return;
  }

  const drawGrid = pxR >= 4, drawGlow = pxR >= 5;
  const gridP = drawGrid ? new P2D() : null;
  const gp = new P2D(); let anyG = false;
  const fillByCol = new Array(13), glowByCol = drawGlow ? new Array(13) : null;
  for (let i = 0; i < N; i++) {
    if (!visible(i)) continue;
    if (gridP) addHex(gridP, i, hr * 0.95);
    if (gh && gh[i]) { addHex(gp, i, hr * 0.78); anyG = true; }
    const cc = col[i];
    if (cc) {
      let fp = fillByCol[cc]; if (!fp) fp = fillByCol[cc] = new P2D();
      addHex(fp, i, hr * 0.92);
      if (glowByCol) { let gw = glowByCol[cc]; if (!gw) gw = glowByCol[cc] = new P2D(); addHex(gw, i, hr * 1.1); }
    }
  }
  if (gridP) { ctx.lineWidth = Math.max(0.4, 1 / s); ctx.strokeStyle = GRID_STROKE; ctx.stroke(gridP); }
  if (anyG) { ctx.fillStyle = GHOST_FILL; ctx.fill(gp); }
  for (const cc of ALLCOL) {
    const fill = fillByCol[cc]; if (!fill) continue;
    const a = COLA[cc];
    if (drawGlow) { ctx.fillStyle = `rgba(${a[0]},${a[1]},${a[2]},0.16)`; ctx.fill(glowByCol[cc]); }
    ctx.fillStyle = COLHEX[cc]; ctx.fill(fill);
  }
}
