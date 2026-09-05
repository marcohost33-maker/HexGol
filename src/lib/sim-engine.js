// =============================================================================
// GolHex Sim-Engine (pure) - aus src/App.tsx extrahiert (AP-1, 2026-06-07).
// KEIN React, KEIN DOM: deterministische Hex-Life-/rval-Engine + Geometrie +
// Farbenlehre + ImageData-Pack-Helfer. Worker-importfaehig (src/worker/) UND
// vom Haupt-Thread (App.tsx) genutzt -> EINE Quelle der Wahrheit, kein Fork.
// Logik byte-identisch zur v31-Basis (reiner Move, keine Verhaltensaenderung).
// =============================================================================
import { applyH, solveCN } from "./sim-core.js"; // HQST-Kern (unit-getestet)
import { oddRToCube, cubeToOddR, hexDist, CUBE_DIRS, cubeRing, cubeDisk, kColorByIndex, sectorByAngle, balancedAngularSectors, pointInPolygonWN, windingNumber } from "./hex-geom.js"; // Hex-Wuerfelgeometrie (unit-getestet)
// Geometrie aus hex-geom wird hier re-exportiert, damit App.tsx einen Import hat.
export { oddRToCube, cubeToOddR, hexDist, CUBE_DIRS, cubeRing, cubeDisk, kColorByIndex, sectorByAngle, balancedAngularSectors, pointInPolygonWN, windingNumber };

const S3 = Math.sqrt(3);
const PI2 = Math.PI * 2, PI3 = Math.PI / 3, PI6 = Math.PI / 6;

// Zell-Zustaende: Itten-Farbkreis mit 12 Farben (30-Grad-Schritte, im Uhrzeigersinn
// ab Rot). 6 "Basis" (Primaer+Sekundaer) + 6 Tertiaerfarben dazwischen.
// Reihenfolge der State-IDs folgt dem Kreis, damit Mischung = Winkel-Mittel gilt:
const C0 = 0;
const CR = 1, CRO = 2, CO = 3, CYO = 4, CY = 5, CYG = 6,
      CG = 7, CBG = 8, CB = 9, CBV = 10, CV = 11, CRV = 12;
// rot, rot-orange, orange, gelb-orange, gelb, gelb-gruen,
// gruen, blau-gruen, blau, blau-violett, violett, rot-violett
const PRIMARY = [CB, CR, CY];                 // blau, rot, gelb (Tap-Zyklus-Basis)
const SECONDARY = [CG, CO, CV];               // gruen, orange, violett
const TERTIARY = [CRO, CYO, CYG, CBG, CBV, CRV];
const ALLCOL = [CR, CRO, CO, CYO, CY, CYG, CG, CBG, CB, CBV, CV, CRV];
const NCOL = 12;
// Tap-Zyklus (Primaerfarben, Originalspezifikation): leer -> blau -> rot -> gelb -> leer
const CYCLE = [C0, CB, CR, CY];
// Komplementaerpaare = +6 (180 Grad): rot<->gruen, orange<->blau, gelb<->violett, ...
const COMPLEMENT = {};
ALLCOL.forEach((c) => { const idx = c - 1; COMPLEMENT[c] = ((idx + 6) % 12) + 1; });

// Theme
const T = {
  bg: "#020608", bg2: "#060F12", panel: "rgba(8,22,26,0.72)", border: "rgba(92,240,204,0.18)",
  text: "#E8F5F2", sub: "#8CC4BB", accent: "#5CF0CC",
};
// Anzeigefarben: alle 12 Itten-Toene konsistent aus dem Gossett-Chen RYB-Wuerfel
// (INFOVIS 2004) trilinear interpoliert - eine Quelle statt teils Handwahl.
const COLA = {
  [CR]: [255, 0, 0], [CRO]: [255, 64, 0], [CO]: [255, 128, 0], [CYO]: [255, 191, 0],
  [CY]: [255, 255, 0], [CYG]: [128, 212, 26], [CG]: [0, 168, 51], [CBG]: [21, 132, 102],
  [CB]: [42, 95, 153], [CBV]: [85, 48, 140], [CV]: [128, 0, 128], [CRV]: [191, 0, 64],
};
const rgbStr = (a) => `rgb(${a[0]},${a[1]},${a[2]})`;
const COLHEX = Object.fromEntries(ALLCOL.map((c) => [c, rgbStr(COLA[c])]));
const NAME = {
  [CR]: "Rot", [CRO]: "Rot-Orange", [CO]: "Orange", [CYO]: "Gelb-Orange",
  [CY]: "Gelb", [CYG]: "Gelb-Gruen", [CG]: "Gruen", [CBG]: "Blau-Gruen",
  [CB]: "Blau", [CBV]: "Blau-Violett", [CV]: "Violett", [CRV]: "Rot-Violett",
};
const SHORT = {
  [CR]: "Rot", [CRO]: "R-O", [CO]: "Orange", [CYO]: "G-O",
  [CY]: "Gelb", [CYG]: "G-Gr", [CG]: "Gruen", [CBG]: "B-Gr",
  [CB]: "Blau", [CBV]: "B-V", [CV]: "Violett", [CRV]: "R-V",
};

// Itten-Farbkreis: 12 Toene gleichabstaendig zu je 30 Grad. State-ID c -> Winkel
// (c-1)*30 Grad. Mischung = Vektorsumme -> naechster der 12 Toene. Komplemente
// (180 Grad) heben sich exakt auf.
const STEP12 = PI2 / 12;
const HUE = {}; ALLCOL.forEach((c) => { HUE[c] = (c - 1) * STEP12; });
const COSH = new Float64Array(NCOL + 1), SINH = new Float64Array(NCOL + 1);
ALLCOL.forEach((c) => { COSH[c] = Math.cos(HUE[c]); SINH[c] = Math.sin(HUE[c]); });
const HUE_BUCKET = ALLCOL.slice(); // index = round(angle/30) % 12
function hueToState(ang) {
  let a = ang % PI2; if (a < 0) a += PI2;
  return HUE_BUCKET[Math.round(a / STEP12) % 12];
}

// Grid-Groessen mit Hexradius (world units) pro Stufe.
// AP-2: Ausbau bis 500x500 (250'000 Zellen). hr (Welt-Radius pro Zelle) sinkt mit
// der Stufe, damit das Gesamtfeld in vernuenftiger Welt-Groesse bleibt; der
// ImageData-Raster-Fast-Path greift bei winzigen Bildschirm-Zellen automatisch.
const GRID_SIZES = [
  { l: "S", rows: 40, cols: 50, hr: 12 },
  { l: "M", rows: 80, cols: 100, hr: 6 },
  { l: "L", rows: 120, cols: 150, hr: 4 },
  { l: "XL", rows: 160, cols: 200, hr: 3 },
  { l: "XXL", rows: 200, cols: 250, hr: 2.5 },
  { l: "3XL", rows: 300, cols: 300, hr: 2 },   //  90'000
  { l: "4XL", rows: 400, cols: 400, hr: 1.6 }, // 160'000
  { l: "5XL", rows: 500, cols: 500, hr: 1.3 }, // 250'000 (Marco-Maximum Quadrat)
];

// AP-2 Speicher-Budget / Zell-Deckel (fail-closed, ehrlich auf 8-GB-PC + Handy).
// CELL_CAP_DEFAULT = harter Deckel fuer alle Rahmenformen (gemeinsames Zell-Budget).
// 250'000 = 500x500 (Quadrat-Maximum). Der Kreis r=500 (~785'000 Zellen, Bounding-
// Box noch groesser) liegt darueber -> wird separat per CIRCLE_CELL_CAP erlaubt,
// aber NUR im booleschen Modus (siehe HQST-Cap). MAX_CIRCLE_RADIUS = 500 (Marco).
const CELL_CAP = 250000;            // Quadrat/Hexagon/Dreieck: 500x500-Aequivalent
// Kreis r=500: Bounding-Box 1001x871 = 871'871 Zellen (tool-gemessen,
// tests/manual/ap2-instantiation.mjs), davon ~680'071 in der Scheibe (78%). Der
// Deckel gilt auf die ALLOKIERTE Bounding-Box (das ist der Speicher-Treiber).
const CIRCLE_CELL_CAP = 900000;     // Kreis r=500 Bounding-Box (Bool-CA, ~38 MB RSS)
const MAX_CIRCLE_RADIUS = 500;      // Marco-Vorgabe
const DEFAULT_CIRCLE_RADIUS = 250;  // Marco-Vorgabe
// HQST (Crank-Nicolson, Float32 Re+Im + Arbeitspuffer) ist pro Zelle ~6x teurer
// und bei Riesen-Gittern unzumutbar langsam -> ueber diesem Deckel im UI gesperrt
// (ehrliche Meldung statt stillem Freeze). Bool-CA bleibt das Maximal-Groessen-Ziel.
const HQST_CELL_CAP = 90000;        // ~3XL; darueber HQST gesperrt

const SPEEDS = [650, 460, 320, 220, 150, 95, 60, 16, 0];
const SPLBL = ["0.5x", "0.8x", "1.1x", "1.6x", "2.4x", "3.8x", "6x", "MAX", "TURBO"];
const DENS = 0.18, MAX_UNDO = 30;

// 16 hexagonale Rulesets (H-Notation: alle fuer 6-Nachbar-Hexgitter).
// Empirisch auf dem Hexgitter geprueft (200 Gen, 6 Seeds): kein Verloeschen,
// keine Explosion, lebendige Aktivitaet. Quadrat-Regeln, die auf Hex
// degenerieren (klassisch B3/S23, B34/S23, B3/S2), wurden ersetzt.
// H:B2/S34 ist das kanonische "Hexagonal Life" (Wikipedia, LifeWiki).
const RULES = [
  { l: "H:B2/S34", B: [2], S: [3, 4] }, { l: "H:B2/S35 (Bays)", B: [2], S: [3, 5] },
  { l: "H:B2/S23", B: [2], S: [2, 3] }, { l: "H:B3/S34", B: [3], S: [3, 4] },
  { l: "H:B2/S2", B: [2], S: [2] }, { l: "H:B2/S245", B: [2], S: [2, 4, 5] },
  { l: "H:B12/S34", B: [1, 2], S: [3, 4] }, { l: "H:B2/S45", B: [2], S: [4, 5] },
  { l: "H:B1/S34", B: [1], S: [3, 4] }, { l: "H:B12/S23", B: [1, 2], S: [2, 3] },
  { l: "H:B23/S34", B: [2, 3], S: [3, 4] }, { l: "H:B2/S356", B: [2], S: [3, 5, 6] },
  { l: "H:B25/S4", B: [2, 5], S: [4] }, { l: "H:B13/S34", B: [1, 3], S: [3, 4] },
  { l: "H:B24/S34", B: [2, 4], S: [3, 4] }, { l: "H:B1/S245", B: [1], S: [2, 4, 5] },
];
const RMETA = RULES.map((r) => {
  const bL = new Uint8Array(7), sL = new Uint8Array(7);
  r.B.forEach((v) => (bL[v] = 1)); r.S.forEach((v) => (sL[v] = 1));
  return { bL, sL, smin: Math.min(...r.S), smax: Math.max(...r.S) };
});

// --- Isotrope nicht-totalistische (INT) Hex-Regeln, Callahan o/m/p ---
// State of the Art (LifeWiki): bei 2 bzw. 3 Nachbarn zaehlt die ANORDNUNG.
// o=ortho (60grad benachbart), m=meta (120grad), p=para (180grad gegenueber).
// Reicht das totalistische Modell nicht; erst INT erzeugt die reiche Hex-Dynamik.
// hexConfig2: besetzte Richtungen (Bitmaske der 6 Nachbarn) -> Klasse bei genau 2.
function hexClass2(mask) {
  const d = []; for (let k = 0; k < 6; k++) if (mask & (1 << k)) d.push(k);
  if (d.length !== 2) return null;
  const g = Math.min((d[1] - d[0] + 6) % 6, (d[0] - d[1] + 6) % 6);
  return g === 1 ? "o" : g === 2 ? "m" : "p";
}
// INT-Regelsatz: B/S mit optionalen Konfigurations-Constraints bei N=2.
// b2/s2 koennen Teilmengen von {o,m,p} verlangen. Leere Menge = alle erlaubt.
const INT_RULES = [
  { l: "INT H:B2o/S2", b2: ["o"], s2: ["o", "m", "p"], B: [2], S: [2] },
  { l: "INT H:B2m/S34", b2: ["m"], s2: null, B: [2], S: [3, 4] },
  { l: "INT H:B2p/S2o", b2: ["p"], s2: ["o"], B: [2], S: [2] },
  { l: "INT H:B2om/S2", b2: ["o", "m"], s2: ["o", "m", "p"], B: [2], S: [2] },
];
function intMeta(r) {
  const bL = new Uint8Array(7), sL = new Uint8Array(7);
  r.B.forEach((v) => (bL[v] = 1)); r.S.forEach((v) => (sL[v] = 1));
  return { bL, sL, smin: Math.min(...r.S), smax: Math.max(...r.S), b2: r.b2, s2: r.s2, isINT: true };
}
const INT_META = INT_RULES.map(intMeta);

// Watzlawick-Basisregel: B2,3 / S1-5 ("Kommunikationsband")
// Begruendung: totale Isolation (0 Nachbarn) = keine Kommunikation = Tod;
// totale Saettigung (6) = Rauschueberlast = Tod; dazwischen lebt der Dialog.
const WATZ_RULE = { B: [2, 3], S: [1, 2, 3, 4, 5] };
const WATZ_META = (() => {
  const bL = new Uint8Array(7), sL = new Uint8Array(7);
  WATZ_RULE.B.forEach((v) => (bL[v] = 1)); WATZ_RULE.S.forEach((v) => (sL[v] = 1));
  return { bL, sL, smin: Math.min(...WATZ_RULE.S), smax: Math.max(...WATZ_RULE.S) };
})();

const PATS = {
  Block: [[0, 0], [0, 1], [1, 0], [1, 1], [2, 0], [2, 1]],
  Pair: [[0, 0], [0, 1]],
  Triangle: [[0, 0], [0, 1], [1, 0]],
  Diamond: [[0, 1], [1, 0], [1, 2], [2, 1]],
  Ring: [[0, 1], [0, 2], [1, 0], [1, 3], [2, 0], [2, 3], [3, 1], [3, 2]],
  Beehive: [[0, 1], [0, 2], [1, 0], [1, 3], [2, 1], [2, 2]],
  Line4: [[0, 0], [0, 1], [0, 2], [0, 3]],
  Star: [[0, 2], [1, 1], [1, 2], [1, 3], [2, 0], [2, 2], [2, 4], [3, 1], [3, 2], [3, 3], [4, 2]],
  Pentagon: [[0, 1], [1, 0], [1, 1], [1, 2], [2, 1]],
  // KEIN Glider: dieses 5-Zell-Muster wurde frueher faelschlich "BaysGlider"
  // genannt. Gemessen (tests/unit/ca-invariants.test.js) zerfaellt es unter
  // H:B2/S35 (Bays) (Pop 5->7->3->2) und wird ab Gen 5 ein Periode-2-Oszillator
  // -- es gleitet NICHT. Bays' echter Periode-5-Glider existiert auf dieser
  // Topologie theoretisch (Bays, Complex Systems 15(3):245, 2005), ist aber NICHT
  // dieses Muster. Ehrlich umbenannt -> Issue #99.
  BaysP2Blob: [[0, 0], [0, 1], [1, 0], [1, 1], [2, 1]],
};

const AXIOMS = [
  { id: "a1", short: "A1 Stille spricht", desc: "Man kann nicht nicht kommunizieren: vollstaendig stille Leerzonen keimen selten spontan." },
  { id: "a2", short: "A2 Beziehung > Inhalt", desc: "Inhalts-/Beziehungsaspekt: Nachbar-Mehrheit (mMix) klassifiziert den Inhalt statt Mischung (cMix)." },
  { id: "a3", short: "A3 Interpunktion", desc: "Interpunktion der Ereignisfolge: alte Zellen (Alter >= 6) erhalten +/-1 Ueberlebens-Toleranz." },
  { id: "a4", short: "A4 Analog", desc: "Digital + analog: sterbende Zellen hinterlassen einen Halbzustand (Ghost), 1 Generation als Nachbar." },
  { id: "a5", short: "A5 Symmetrisch / komplementaer", desc: "Symmetrische vs. komplementaere Interaktion: Ueberleben verlangt K <= S; Geburt verlangt S > K." },
];

// --- Geometrie (kanonisch, verifiziert) -------------------------------------
const PAD = (hr) => hr * 1.3;
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);

// oddRToCube/cubeToOddR/hexDist/CUBE_DIRS (Red Blob Games kanonisch) leben jetzt
// in src/lib/hex-geom.js (Single Source, unit-getestet auf Ecken==Maske-Konsistenz)
// und werden oben importiert. Fuer den exakten hexagonalen Rahmen: Punkte mit
// hex-Abstand <= r bilden ein regelmaessiges Sechseck; die 6 Ecken liegen genau r
// Schritte in den 6 Wuerfel-Richtungen vom Zentrum.

function hexCenter(row, col, hr) {
  const w = S3 * hr, v = 1.5 * hr, pad = PAD(hr);
  return { x: pad + w * (col + ((row & 1) ? 0.5 : 0)), y: pad + v * row };
}
function axialRound(q, r) {
  let x = q, z = r, y = -x - z;
  let rx = Math.round(x), ry = Math.round(y), rz = Math.round(z);
  const dx = Math.abs(rx - x), dy = Math.abs(ry - y), dz = Math.abs(rz - z);
  if (dx > dy && dx > dz) rx = -ry - rz; else if (dy > dz) ry = -rx - rz; else rz = -rx - ry;
  return { q: rx, r: rz };
}
function pixelToOddR(px, py, hr, R, C) {
  const pad = PAD(hr);
  const x = (px - pad) / hr, y = (py - pad) / hr;
  const a = axialRound((S3 / 3) * x - (1 / 3) * y, (2 / 3) * y);
  const col = a.q + ((a.r - (a.r & 1)) >> 1), row = a.r;
  if (row < 0 || row >= R || col < 0 || col >= C) return -1;
  return row * C + col;
}
function worldSize(R, C, hr) {
  const w = S3 * hr, v = 1.5 * hr, pad = PAD(hr);
  return { W: pad * 2 + w * (C + 0.5), H: pad * 2 + v * R };
}

// AP-2: Bounding-Gitter fuer einen EXPLIZITEN Kreis-Radius (in Gitterschritten,
// Marcos "250"/"500"). Liefert {rows, cols, hr, radius} so, dass der Kreis exakt
// ins Gitter passt. Welt-Radius = radius*1.5 (vertikaler Reihenabstand). Reihen
// decken (R-1)*1.5 ab -> R = 2*radius+1. Spalten decken (C-1)*S3 + S3 -> aus dem
// Welt-Radius zurueckgerechnet, + 1 Sicherheitsrand je Seite. hr skaliert mit der
// Groesse (Raster-Fast-Path greift bei winzigen Zellen). radius wird auf
// [1, MAX_CIRCLE_RADIUS] geklemmt (fail-closed).
function circleGridDims(radius) {
  const r = Math.max(1, Math.min(Math.round(radius) || 1, MAX_CIRCLE_RADIUS));
  const worldR = r * 1.5;
  const rows = 2 * r + 1;
  // Welt-Halbbreite = worldR; col-Schritt = S3. +2 Rand je Seite gegen Klemm-Verlust.
  const cols = 2 * Math.ceil(worldR / S3) + 3;
  // hr-Heuristik analog GRID_SIZES (groesser = kleinere Zellen).
  let hr = 2.5;
  if (r > 400) hr = 1.3; else if (r > 300) hr = 1.6; else if (r > 200) hr = 2; else if (r > 120) hr = 2.5; else if (r > 60) hr = 4; else hr = 8;
  return { rows, cols, hr, radius: r };
}

// Rahmenform + Topologie -> Nachbar-Lookups mit korrekter Randphysik.
// shape: "box" (volle Rechteck-Domaene) | "circle" (eingeschriebene Scheibe)
//        | "hexagon" | "triangle" | "ellipse" (v33 PR-E) | "freeform" (v33 PR-E).
// Liefert: { torus, edge, mask, inCount }.
//   mask[i]=1 wenn Zelle in der Domaene. Zellen ausserhalb sind permanente Waende.
//   edge:  Nachbar ausserhalb Domaene -> -1 (Rand: Neumann/reflektierend; boolesch
//          = tote Wand, rval = Selbstwert -> Null-Fluss, massenerhaltend).
//   torus: Nachbar ausserhalb Domaene -> bei "box" Standard-Wrap; bei "circle"
//          antipodale Identifikation (Strahl durch Zentrum, gegenueberliegende
//          Randzelle) -> periodische Scheibe (RP2-artig), reflexionsfrei.
// opts (AP-2, optional, rueckwaerts-kompatibel):
//   opts.circleRadius : EXPLIZITER Kreis-Radius in GITTERSCHRITTEN (Hex-Reihen,
//     Marcos "250"/"500"). Nur fuer shape==="circle" wirksam. Fehlt er, faellt der
//     Kreis auf den eingeschriebenen Maximal-Radius (bisheriges Verhalten) zurueck.
//     Ein Wert > eingeschriebenem Maximum wird auf das Maximum geklemmt (der Kreis
//     kann nicht ueber das Gitter hinausragen).
//   opts.ellipseA / opts.ellipseB (v33 PR-E): Halbachsen in GITTERSCHRITTEN fuer
//     shape==="ellipse" (a = horizontal, b = vertikal), je auf die Gitter-Halbachse
//     geklemmt (fail-closed). Fehlen -> Maximum (fuellt das Gitter).
//   opts.polygon (v33 PR-E): Array von Welt-{x,y}-Punkten fuer shape==="freeform";
//     Maske via Winding-Number (Hormann-Agathos), Punkt-auf-Kante == innen. Fehlt
//     oder < 3 Punkte -> leere Domaene (fail-closed). Torus(ellipse|freeform) =
//     berandet (wie hexagon/triangle; die Form kachelt die Ebene nicht periodisch).
function buildNeighbors(R, C, shape, opts) {
  const N = R * C, torus = new Int32Array(N * 6), edge = new Int32Array(N * 6);
  const mask = new Uint8Array(N);
  const oddOff = [[-1, 0], [-1, 1], [0, -1], [0, 1], [1, 0], [1, 1]];
  const evenOff = [[-1, -1], [-1, 0], [0, -1], [0, 1], [1, -1], [1, 0]];
  // Welt-Koordinaten (pointy-top odd-r) fuer runde Masken + Antipoden
  const cr = (R - 1) / 2, cc = (C - 1) / 2;
  const wx = (r, c) => (c + ((r & 1) ? 0.5 : 0)) * S3;
  const wy = (r) => r * 1.5;
  const cx = wx(cr, cc), cy = wy(cr);
  // Groesster Kreis, der das ganze Hexfeld ausfuellt: min der Halbachsen der
  // Bounding-Box der Zentren, plus halbe Hexzell-Ausdehnung. Bindend ist bei
  // breiten Gittern die Hoehe. Validiert in test_frame_fill.mjs.
  const halfW = ((C - 1) * S3) / 2 + S3 / 2;
  const halfH = ((R - 1) * 1.5) / 2 + 1.0;
  const radiusMax = Math.min(halfW, halfH);
  // radius = Welt-Radius der Dreieck-Eckpunkte (immer das Maximum, fuellt das Gitter).
  const radius = radiusMax;
  // Kreis-Radius: expliziter Wert (in Gitterschritten -> Welt: *1.5 = vertikaler
// Reihenabstand) ODER eingeschriebenes Maximum. Auf [0, radiusMax] geklemmt
// (fail-closed: kein Kreis ueber den Gitterrand hinaus).
  let circleRad = radiusMax;
  if (opts && Number.isFinite(opts.circleRadius) && opts.circleRadius > 0) {
    circleRad = Math.min(opts.circleRadius * 1.5, radiusMax);
  }
  // v33 PR-E: Ellipse-Halbachsen (Welt). a = horizontal (Spalten), b = vertikal
  // (Reihen). Werte in Gitterschritten *1.5 (wie circleRad), je Achse auf die
  // Halbachsen der Bounding-Box geklemmt (fail-closed: keine Ellipse ueber den
  // Gitterrand). Default = Maximum (fuellt das Gitter wie der Kreis).
  let ellA = halfW, ellB = halfH;
  if (opts && Number.isFinite(opts.ellipseA) && opts.ellipseA > 0) {
    ellA = Math.min(opts.ellipseA * 1.5, halfW);
  }
  if (opts && Number.isFinite(opts.ellipseB) && opts.ellipseB > 0) {
    ellB = Math.min(opts.ellipseB * 1.5, halfH);
  }
  // v33 PR-E: Freiform-Polygon (Array Welt-{x,y}). Maske via Winding-Number
  // (Hormann-Agathos), Punkt-auf-Kante == innen. Fehlt/zu kurz -> leere Domaene
  // (fail-closed: kein "alles drin"-Versehen).
  const polygon = (opts && Array.isArray(opts.polygon) && opts.polygon.length >= 3)
    ? opts.polygon : null;
  // Hexagon-Rahmen: groesster eingeschriebener Hex-Radius (in Gitterschritten).
  // Begrenzt durch Reihen (R) und Spalten; konservativ das Minimum.
  const centerCube = oddRToCube(cc, cr);
  const hexRad = Math.min(Math.floor((R - 1) / 2), Math.floor((C - 1) / 2));
  // Dreieck-Rahmen: gleichseitiges Dreieck, Spitze oben, 3 Eckpunkte.
  const triVerts = [];
  for (const deg of [-90, 30, 150]) {
    const a = deg * Math.PI / 180;
    triVerts.push([cx + radius * Math.cos(a), cy + radius * Math.sin(a)]);
  }
  const triSign = (px, py, ax, ay, bx, by) => (px - bx) * (ay - by) - (ax - bx) * (py - by);
  const inDomain = (r, c) => {
    if (r < 0 || r >= R || c < 0 || c >= C) return false;
    if (shape === "circle") {
      const dx = wx(r, c) - cx, dy = wy(r) - cy;
      return Math.hypot(dx, dy) <= circleRad;
    }
    if (shape === "ellipse") {
      // Welt-Test ((wx-cx)/a)^2 + ((wy-cy)/b)^2 <= 1 (Audit Mathe TEIL B(a)).
      // wx/wy inkl. odd-row-0.5-Versatz -> keine Verzerrung durch das
      // Achsverhaeltnis 1.5 (Reihe) vs sqrt(3) (Spalte).
      const dx = (wx(r, c) - cx) / ellA, dy = (wy(r) - cy) / ellB;
      return dx * dx + dy * dy <= 1;
    }
    if (shape === "freeform") {
      // Freiform: Winding-Number gegen das Nutzer-Polygon in Welt-Koordinaten.
      // Kein Polygon -> leere Domaene (fail-closed).
      if (!polygon) return false;
      return pointInPolygonWN(wx(r, c), wy(r), polygon);
    }
    if (shape === "hexagon") {
      return hexDist(oddRToCube(c, r), centerCube) <= hexRad;
    }
    if (shape === "triangle") {
      const px = wx(r, c), py = wy(r);
      const d1 = triSign(px, py, triVerts[0][0], triVerts[0][1], triVerts[1][0], triVerts[1][1]);
      const d2 = triSign(px, py, triVerts[1][0], triVerts[1][1], triVerts[2][0], triVerts[2][1]);
      const d3 = triSign(px, py, triVerts[2][0], triVerts[2][1], triVerts[0][0], triVerts[0][1]);
      const hasNeg = d1 < 0 || d2 < 0 || d3 < 0, hasPos = d1 > 0 || d2 > 0 || d3 > 0;
      return !(hasNeg && hasPos);
    }
    return true; // box: ganze Domaene
  };
  let inCount = 0;
  for (let r = 0; r < R; r++) for (let c = 0; c < C; c++) { if (inDomain(r, c)) { mask[r * C + c] = 1; inCount++; } }
  // Antipodale In-Domaenen-Zelle fuer circle-torus: gegenueberliegende Randzelle.
  // v33 Mathe-Audit P1.5: direkte Berechnung der Punktspiegelung am Zentrum
  //   (ax,ay) = (2cx-wx, 2cy-wy) -> Welt->odd-r ruecktransformieren -> kleine
  //   lokale Korrektur (Rundung + Maske). Ersetzt die alte O(circleRad)-
  //   Strahlsuche (bis 1500 Iterationen/Randzelle bei r=500). Reziprozitaet bleibt
  //   0 (Geometrie-Aequivalenz, test_antipode-Orakel) — die Punktspiegelung ist
  //   involutorisch und die lokale 3x3-Suche faengt Rundungs-Randfaelle ab.
  const worldToOddR = (ax, ay) => {
    const rr = Math.round(ay / 1.5);
    const cc2 = Math.round(ax / S3 - ((rr & 1) ? 0.5 : 0));
    return [rr, cc2];
  };
  const antipode = (r, c) => {
    const ax = 2 * cx - wx(r, c), ay = 2 * cy - wy(r);
    let [rr, cc2] = worldToOddR(ax, ay);
    if (inDomain(rr, cc2)) return rr * C + cc2;
    // Lokale Korrektur: die naechste In-Domaenen-Zelle in einer kleinen Umgebung
    // (Rundung kann am Rand 1 Schritt daneben liegen). Best = minimaler
    // Welt-Abstand zum exakt gespiegelten Punkt -> stabile, eindeutige Wahl.
    let bestIdx = -1, bestD = Infinity;
    for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
      const nr = rr + dr, nc = cc2 + dc;
      if (!inDomain(nr, nc)) continue;
      const ddx = wx(nr, nc) - ax, ddy = wy(nr) - ay;
      const d = ddx * ddx + ddy * ddy;
      if (d < bestD) { bestD = d; bestIdx = nr * C + nc; }
    }
    return bestIdx >= 0 ? bestIdx : r * C + c;
  };
  for (let r = 0; r < R; r++) {
    const off = (r & 1) ? oddOff : evenOff;
    for (let c = 0; c < C; c++) {
      const base = (r * C + c) * 6;
      const selfIn = mask[r * C + c] === 1;
      for (let k = 0; k < 6; k++) {
        const nr = r + off[k][0], nc = c + off[k][1];
        // Rand (edge): ausserhalb Domaene -> -1
        edge[base + k] = inDomain(nr, nc) ? nr * C + nc : -1;
        // Torus-Wrapping nur fuer box: nur das Rechteck kachelt die Ebene
        // periodisch sauber. hexagon/triangle fuellen das Gitter nicht, ihr
        // naives Wrapping laege ausserhalb der Form -> mathematisch falsch.
        // Daher: circle weiter antipodal, hexagon/triangle wie berandet (edge).
        if (shape === "box") {
          torus[base + k] = (((nr % R) + R) % R) * C + (((nc % C) + C) % C);
        } else if (shape === "circle") {
          if (!selfIn) { torus[base + k] = -1; }
          else if (inDomain(nr, nc)) { torus[base + k] = nr * C + nc; }
          else { torus[base + k] = antipode(r, c); }
        } else {
          // hexagon/triangle: berandet (Torus-Schalter faellt auf edge zurueck)
          torus[base + k] = inDomain(nr, nc) ? nr * C + nc : -1;
        }
      }
    }
  }
  return { torus, edge, mask, inCount, bnd: (function () {
    // Randzellen: In-Domaenen-Zellen mit mind. einem fehlenden Edge-Nachbarn.
    const bnd = new Uint8Array(N);
    for (let i = 0; i < N; i++) { if (!mask[i]) continue; const b = i * 6; for (let k = 0; k < 6; k++) if (edge[b + k] < 0) { bnd[i] = 1; break; } }
    return bnd;
  })() };
}

function hash2(a, b) {
  let h = (Math.imul(a, 0x9e3779b1) ^ Math.imul(b + 1, 0x85ebca77)) >>> 0;
  h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d) >>> 0;
  h ^= h >>> 12; h = Math.imul(h, 0x297a2d39) >>> 0; h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}
function rng(s) {
  let a = s | 0;
  return () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
// --- Farbenlehre nach Gossett-Chen (INFOVIS 2004) + QuadLife-Farbinvarianz ---
// Geburtsfarbe-Modi. WICHTIG (State of the Art, LifeWiki Colourised Life):
// Die Farbe beeinflusst NIE die Lebend/Tot-Dynamik - sie ist ein reiner
// Datenkanal. Ignoriert man Farbe, verhaelt sich alles wie normales Life.

// (1) Farbinvariante Geburtsregel, fundiert auf Niemiec's Life + QuadLife
//     (conwaylife.com/wiki/Colourised_Life), verallgemeinert auf 6 Farben /
//     3 Komplementaerpaare und n Hex-Nachbarn. Deterministisch, permutations-
//     invariant, symmetrisch. sxAll/syAll = Hue-Vektor ueber ALLE Nachbarn.
//   - eindeutige Mehrheit        -> diese Farbe        (x+x+x, x+x+y)
//   - genau 2 gleichstark, kein Komplement -> subtraktive Mischung (R+B->Lila)
//   - 2 gleichstarke Komplemente -> dritte Farbe falls vorhanden (x+x'+y->y),
//                                   sonst symmetrischer Hue-Fallback
//   - 3+ gleichstark             -> Hue-Mittel der Leader (Aufhebung: global)
function birthColorQuad(cnt, sxAll, syAll) {
  let maxN = 0;
  for (let c = 1; c <= 12; c++) if (cnt[c] > maxN) maxN = cnt[c];
  const leaders = [];
  for (let c = 1; c <= 12; c++) if (cnt[c] === maxN) leaders.push(c);
  if (leaders.length === 1) return leaders[0];
  if (leaders.length === 2) {
    const a = leaders[0], b = leaders[1];
    if (COMPLEMENT[a] === b) {
      for (let c = 1; c <= 12; c++) if (cnt[c] > 0 && c !== a && c !== b) return c;
      if (sxAll * sxAll + syAll * syAll >= 1e-9) return hueToState(Math.atan2(syAll, sxAll));
      return a < b ? a : b;
    }
    const sx = COSH[a] + COSH[b], sy = SINH[a] + SINH[b];
    return hueToState(Math.atan2(sy, sx));
  }
  let sx = 0, sy = 0;
  for (const c of leaders) { sx += COSH[c]; sy += SINH[c]; }
  if (sx * sx + sy * sy >= 1e-9) return hueToState(Math.atan2(sy, sx));
  if (sxAll * sxAll + syAll * syAll >= 1e-9) return hueToState(Math.atan2(syAll, sxAll));
  return leaders[0];
}

// (2) Subtraktiver Hue-Mix (Farbenlehre): Hue-Vektorsumme -> naechste Farbe.
function cMixVec(sx, sy, i) {
  if (sx * sx + sy * sy < 1e-9) return PRIMARY[((i * 31 + 7) >>> 0) % 3];
  return hueToState(Math.atan2(sy, sx));
}
// (3) Mehrheitsmischung (Beziehungsaspekt, A2): dominante Nachbarfarbe.
function mMixCnt(cnt, i) {
  let m = 0; for (let c = 1; c <= 12; c++) if (cnt[c] > m) m = cnt[c];
  if (m === 0) return PRIMARY[((i * 31 + 7) >>> 0) % 3];
  const t = []; for (let c = 1; c <= 12; c++) if (cnt[c] === m) t.push(c);
  return t[((i * 31 + 7) >>> 0) % t.length];
}
// Verfaerben (experimentell, bricht bewusst die Farbinvarianz): lebende Zelle
// driftet einen Schritt zur Nachbar-Mittelfarbe. Nur wenn colorMode "drift".
function driftHue(selfState, sx, sy) {
  if (sx * sx + sy * sy < 1e-9) return selfState;
  const target = Math.atan2(sy, sx);
  const cur = HUE[selfState];
  let d = target - cur; while (d > Math.PI) d -= PI2; while (d < -Math.PI) d += PI2;
  if (Math.abs(d) < STEP12 * 0.5) return selfState;
  return hueToState(cur + Math.sign(d) * STEP12);
}

// =============================================================================
// BOOLESCHER LIFE-SCHRITT (pure) — extrahiert aus src/App.tsx (2026-06-08).
// Frueher inline in step() (load-bearing, §1.4); jetzt EINE getestete Quelle wie
// HQST/Geometrie. Logik byte-identisch zur v33-Basis (Parity-Orakel:
// tests/unit/step-life.test.js vergleicht ueber zufaellige Regeln/Seeds/Achsen/
// Generationen gegen eine naive Referenz). Optimierungen (verhaltens-erhaltend,
// gemessen experimental/bench-step-life.mjs):
//   - maxN (12er-Scan pro Zelle) nur berechnet, wenn A5 in {sym,komp} es braucht.
//     Default a5="off" zahlte den Scan bisher pro Zelle umsonst -> ~1.2-1.3x
//     schneller bei 3XL/5XL im Default-Pfad, kein Regress im sym/komp-Pfad.
//   - adia/Flags/needMax einmal vor der Zellschleife gehoben (kein Re-Eval/Zelle).
//   - cnt bleibt bewusst ein Array-Literal: ein wiederverwendetes Int32Array+fill(0)
//     ist hier nachweislich LANGSAMER (V8 packed-SMI; Bench-belegt, nicht geraten).
// g (Eingabe, alles vom Aufrufer bereitgestellt — kein React/DOM/Ref):
//   col/gh/age : aktuelle Ebenen (Farbe Uint8, Geist Uint8, Alter Uint16-artig)
//   nc/ng/na   : Ziel-Ebenen (werden geschrieben; Aufrufer tauscht die Refs)
//   NL         : Nachbar-Lookup (torus ODER edge), dmask : Domaenenmaske
//   meta       : {bL,sL,smin,smax,isINT?,b2?,s2?} (RMETA/INT_META/WATZ_META)
//   colorMode  : "quad"|"drift"|... , a1/a2/a3/a4 : Axiom-Flags (booleans)
//   a5         : "off"|"sym"|"komp" , sysT : Systemtheorie an?, spN : Sollnachbarn
//   adia       : adiabatische (reflektierende) Wand?, tick : aktueller Tick (a1-Hash)
// Rueckgabe: { births, deaths } (Statistik); nc/ng/na sind die Ausgabe.
function stepLife(g) {
  const col = g.col, gh = g.gh, age = g.age;
  const nc = g.nc, ng = g.ng, na = g.na;
  const NL = g.NL, dmask = g.dmask;
  const { bL, sL, smin, smax } = g.meta;
  const isINT = !!g.meta.isINT, b2 = g.meta.b2 || null, s2 = g.meta.s2 || null;
  const colorMode = g.colorMode, a1 = g.a1, a2 = g.a2, a3 = g.a3, a4 = g.a4;
  const A5 = g.a5, sysT = g.sysT, spN = g.spN, adia = g.adia, tick = g.tick;
  const n = col.length;
  let births = 0, deaths = 0;
  const needMax = (A5 === "sym" || A5 === "komp"); // maxN-Scan nur dann noetig
  for (let i = 0; i < n; i++) {
    if (dmask[i] === 0) { nc[i] = 0; ng[i] = 0; na[i] = 0; continue; } // ausserhalb Domaene: Wand
    const base = i * 6;
    // cnt bewusst als kleines, packed-SMI Array-Literal (12 Farben, Index 1..12):
    // V8 behandelt dieses Muster schneller als ein wiederverwendetes Int32Array
    // mit fill(0) (gemessen experimental/bench-step-life.mjs). Der reine Gewinn
    // kommt aus dem lazy maxN-Scan unten, nicht aus dem cnt-Puffer.
    const cnt = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    let live = 0, sx = 0, sy = 0, mask = 0;
    const self = col[i], selfAlive = self !== 0;
    for (let k = 0; k < 6; k++) {
      const j = NL[base + k];
      if (j < 0) {
        // Adiabatische (reflektierende) Wand: fehlender Nachbar = Spiegelung der
        // Randzelle selbst (arxiv 2406.06195, 1607.02291). "null"-Standard = tote Wand.
        if (adia) {
          if (selfAlive) { cnt[self]++; live++; sx += COSH[self]; sy += SINH[self]; mask |= (1 << k); }
          else if (a4 && gh[i]) live++;
        }
        continue;
      }
      const cj = col[j];
      if (cj !== 0) { cnt[cj]++; live++; sx += COSH[cj]; sy += SINH[cj]; mask |= (1 << k); }
      else if (a4 && gh[j]) live++;
    }
    const cntSelf = selfAlive ? cnt[self] : 0;
    let maxN = 0; if (needMax) { for (let c = 1; c <= 12; c++) if (cnt[c] > maxN) maxN = cnt[c]; }
    let eff = live;
    if (A5 === "sym") eff = selfAlive ? cntSelf : maxN;
    else if (A5 === "komp") eff = selfAlive ? live - cntSelf : live - maxN;

    let born = false, newC = 0;
    if (selfAlive) {
      let surv = eff <= 6 && sL[eff] === 1;
      // INT: bei genau 2 Nachbarn zusaetzlich Konfigurations-Constraint (Callahan)
      if (surv && isINT && eff === 2 && s2 && !s2.includes(hexClass2(mask))) surv = false;
      if (!surv && a3 && age[i] >= 6 && eff >= smin - 1 && eff <= smax + 1) surv = true;
      // Systemtheorie: Unterdichte stuetzt das Ueberleben, Ueberdichte entzieht es.
      if (sysT) { if (!surv && live > 0 && live < spN) surv = true; else if (surv && live > spN + 1) surv = false; }
      if (surv) {
        born = true;
        newC = (colorMode === "drift" && live > 0) ? driftHue(self, sx, sy) : self;
      }
    } else if (live > 0 && eff >= 0 && eff <= 6 && bL[eff] === 1) {
      let ok = true;
      if (isINT && eff === 2 && b2 && !b2.includes(hexClass2(mask))) ok = false;
      // Systemtheorie: Geburt nur unter dem Sollwert (fuellt Luecken bis Gleichgewicht).
      if (sysT && live > spN) ok = false;
      if (ok) {
        born = true;
        if (colorMode === "quad") newC = birthColorQuad(cnt, sx, sy);
        else if (a2) newC = mMixCnt(cnt, i);
        else newC = cMixVec(sx, sy, i);
      }
    }
    if (born) { nc[i] = newC; ng[i] = 0; na[i] = selfAlive ? (age[i] < 65535 ? age[i] + 1 : 65535) : 1; if (!selfAlive) births++; }
    else { na[i] = 0; if (selfAlive) deaths++; if (selfAlive && a4) { nc[i] = 0; ng[i] = 1; } else { nc[i] = 0; ng[i] = 0; } }
  }

  if (a1) {
    for (let i = 0; i < n; i++) {
      if (nc[i] !== 0 || ng[i] !== 0 || col[i] !== 0) continue;
      const base = i * 6; let silent = true;
      for (let k = 0; k < 6; k++) { const j = NL[base + k]; if (j < 0) continue; if (col[j] !== 0 || (a4 && gh[j])) { silent = false; break; } }
      if (silent && hash2(i, tick) < 0.012) { nc[i] = PRIMARY[Math.floor(hash2(i + 7, tick * 3 + 1) * 3)]; na[i] = 1; }
    }
  }
  return { births, deaths };
}

// =============================================================================
// REELLWERTIGER SIMULATIONSMODUS (eigenstaendig, neben der booleschen Engine).
// Drei Regeln, alle web-fundiert und numerisch verifiziert:
//   - "snow": Reiter-Schneeflocken-Automat (Chaos Solitons Fractals 23:1111).
//   - "water": Gravitations-/Druck-Wasser mit Massenerhaltung.
//   - "hqst": hexagonale Tight-Binding-Quantensimulation, normerhaltend.
// Feld R0..R6: realwertiges Float32Array (snow/water) bzw. Re+Im (hqst).
// =============================================================================
const RVAL_RULES = [
  { id: "snow", l: "Schneeflocke (Reiter)" },
  { id: "water", l: "Wasser (Gravitation)" },
  { id: "hqst", l: "HQST (Quanten-Welle)" },
  { id: "collatz", l: "Collatz (Zahlentheorie)" },
  { id: "genes", l: "Dominante Gene (Mendel)" },
];

// Reiter-Schritt (kanonisch, MASSENERHALTEND bis auf den gamma-Quellterm) — Cliff
// Reiter, "A local cellular model for snow crystal growth", Chaos Solitons
// Fractals 23 (2005). rezeptiv = Eis (>=1) ODER Nachbar von Eis. Feldsplit:
//   u(z) = rezeptiv ? 0 : s(z)   (diffundierender Dampf)
//   v(z) = rezeptiv ? s(z) : 0   (quasi-gefroren)
// Diffusion (diskreter Hex-Laplace, Grad 6) wird auf ALLE Zellen angewandt:
//   u'(z) = u(z) + (alpha/2) * ( mean_{NN} u - u(z) )
// Das ist ALGEBRAISCH IDENTISCH zu Reiters Originalgleichung (primaerquellen-
// validiert) u(t+1,P) = u(t,P) + (alpha/12)*( -6 u(t,P) + sum_{N} u(t,N) ), da
// mean_{NN} = (1/6) sum_{N}  ->  (alpha/2)((1/6)sum - u) = (alpha/12)(sum - 6u).
// Rezeptive Zellen (u=0) FANGEN damit den Einstrom ihrer nicht-rezeptiven Nachbarn
// AUF (genau das fehlte der frueheren "lecken" Variante -> Masse versickerte am
// Eisrand). Update:  s'(z) = u'(z) + v(z) + gamma*[rezeptiv].
// Rand: fehlender Nachbar zaehlt als u(self) -> Null-Fluss (reflektierend), global
// massenerhaltend. Es gilt exakt  sum(s') - sum(s) = gamma * #rezeptiv  (Invariante
// in tests/unit/reiter-mass.test.js). Vorab-Pass fuer konsistente Rezeptivitaet.
function stepReiter(s, NL, alpha, gamma, buf, recBuf) {
  const n = s.length, ns = buf, rec = recBuf;
  for (let i = 0; i < n; i++) {
    let r = s[i] >= 1;
    if (!r) { const b = i * 6; for (let k = 0; k < 6; k++) { const j = NL[b + k]; if (j >= 0 && s[j] >= 1) { r = true; break; } } }
    rec[i] = r ? 1 : 0;
  }
  for (let i = 0; i < n; i++) {
    const recep = rec[i] === 1;
    const ui = recep ? 0 : s[i];               // u(self): rezeptiv -> 0
    const b = i * 6; let sum = 0;
    for (let k = 0; k < 6; k++) {
      const j = NL[b + k];
      if (j < 0) { sum += ui; continue; }      // Null-Fluss-Rand: fehlender Nachbar = self
      sum += rec[j] ? 0 : s[j];                // u(Nachbar): rezeptiv -> 0
    }
    const uPrime = ui + (alpha / 2) * (sum / 6 - ui); // Divisor 6 (Grad) -> erhaltend
    // s' = u' + v + gamma*[rezeptiv]; rezeptive fangen den Diffusions-Einstrom (u') auf.
    ns[i] = recep ? (s[i] + gamma + uPrime) : uPrime;
  }
  return ns;
}
// Wasser: Gravitation (untere Nachbarn k=4,5) + seitlicher Druckausgleich.
// Massenerhaltend. Standard-Spiel-CA-Fluid (w-shadow "Simple Fluid Simulation"):
// nach unten fuellen bis MaxMass=1, dann horizontal ausgleichen.
// SEITLICHER AUSGLEICH ORDNUNGSUNABHAENGIG (2026-06-08): frueher ein In-Place-
// Sweep links->rechts (diff>0), der eine RICHTUNGS-DRIFT erzeugte (Wasser wanderte
// ueber viele Schritte nach +x). Jetzt: jede horizontale Kante GENAU EINMAL ueber
// den Rechtsnachbarn (k=3), Fluesse aus einem SCHNAPPSCHUSS des Nach-Gravitations-
// Zustands (w wird recycelt) -> additiv in nw. Ergebnis = symmetrische Diffusion
//   nw[i] = 0.5*w[i] + 0.25*w[links] + 0.25*w[rechts]   (Konvexkombination)
// invariant gegen Iterationsrichtung (Links-Rechts-Spiegelsymmetrie, Test
// tests/unit/water-order-independence.test.js), massenerhaltend (paarig -/+) und
// wertbeschraenkt auf [0,1].
// GRAVITATION OHNE LINKS-/RECHTS-VORZUG (2026-06-08): frueher wurden die beiden
// unteren Nachbarn k=4,5 SEQUENZIELL gefuellt (k=4 zuerst, *0.5) -> die erste
// Richtung bekam mehr -> horizontaler Drift beim Fallen. Jetzt wird der Abfluss
// PROPORTIONAL zum freien Platz (room) auf beide unteren Nachbarn verteilt
// (reihenfolge-/richtungsunabhaengig): gleicher Platz -> gleiche Haelfte.
// Massenerhaltend (Abfluss == Summe Zufluss) und wertbeschraenkt (Anteil <= room).
function stepWater(w, NL, C, buf) {
  const n = w.length, nw = buf;
  for (let i = 0; i < n; i++) nw[i] = w[i];
  for (let i = n - 1; i >= 0; i--) {
    const amt = nw[i]; if (amt <= 1e-6) continue;
    const r = (i / C) | 0, b = i * 6;
    const j4 = NL[b + 4], j5 = NL[b + 5];
    const d4 = (j4 >= 0 && ((j4 / C) | 0) > r) ? j4 : -1;
    const d5 = (j5 >= 0 && ((j5 / C) | 0) > r) ? j5 : -1;
    const r4 = d4 >= 0 ? Math.max(0, 1 - nw[d4]) : 0;
    const r5 = d5 >= 0 ? Math.max(0, 1 - nw[d5]) : 0;
    const totalRoom = r4 + r5; if (totalRoom <= 0) continue;
    const flow = Math.min(amt, totalRoom) * 0.5; if (flow <= 0) continue;
    if (r4 > 0) nw[d4] += flow * (r4 / totalRoom); // Anteil <= r4 -> bleibt <= 1
    if (r5 > 0) nw[d5] += flow * (r5 / totalRoom);
    nw[i] -= flow;
  }
  // Schnappschuss des Nach-Gravitations-Zustands: w wird dafuer UEBERSCHRIEBEN
  // (allokationsfrei, Hot-Path bis 250k Zellen). Im App-Doppelpuffer unkritisch —
  // w (= altes Feld) wird nach dem Swap ohnehin zum naechsten Scratch-Puffer.
  for (let i = 0; i < n; i++) w[i] = nw[i];
  // Jede horizontale Kante einmal: Rechtsnachbar (k=3). Signierter Fluss -> fliesst
  // immer vom hoeheren zum niedrigeren Pegel, unabhaengig von der Reihenfolge.
  for (let i = 0; i < n; i++) {
    const j = NL[i * 6 + 3]; if (j < 0) continue;
    const diff = (w[i] - w[j]) * 0.25;
    nw[i] -= diff; nw[j] += diff;
  }
  return nw;
}
// HQST: Tight-Binding psi' = psi - i*dt*(-J*sum_nb + V*psi), danach renormiert
// (Wahrscheinlichkeitserhaltung). re/im getrennt; buf = [reBuf, imBuf].
// HQST: Crank-Nicolson-Integration der Tight-Binding-Schroedingergleichung,
// von Natur aus UNITAER (normerhaltend ohne kuenstliche Renormierung).
// (I + i*a*H) psi^{n+1} = (I - i*a*H) psi^n, a=dt/2, H psi = -J*sum_nb + V*psi.
// Diagonale von H = V (hier 0), daher A_ii=1+i*a*V; Fixpunkt-Iteration konvergiert
// fuer das duenn besetzte H schnell. reBuf/imBuf halten das Ergebnis.
// === Q-SIM-OPS Solver-Abstraktion ===
// Austauschbare Integratoren fuer die HQST-Zeitentwicklung. Alle teilen den
// gemeinsamen Tight-Binding-Operator applyH; die Adapter unterscheiden sich nur
// im Integrationsschema. So lassen sich Verfahren vergleichen (siehe
// test_solver_abstraction.mjs: euler driftet, rk4 driftet schwach, cn unitaer).
// SOLVERS-Registry am Komponentenrand fuer die UI.
// applyH (Tight-Binding-Operator) + solveCN (Crank-Nicolson, unitaer) leben jetzt
// in src/lib/sim-core.js (Single Source, unit-getestet auf Norm-Erhaltung) und
// werden oben importiert. solveEuler/solveRK4 unten nutzen das importierte applyH.
// Hinweis: die Modul-Version nutzt TOL=2e-6 (Float32-gerecht) statt des frueheren
// 1e-10 (lag unter dem Float32-Rausch-Boden ~1e-7 -> Iteration konvergierte nie).
// Euler (explizit): schnell, NICHT normerhaltend - fuer Vergleichszwecke.
function solveEuler(re, im, NL, J, V, dt, reBuf, imBuf, work) {
  const n = re.length, hRe = work.hRe, hIm = work.hIm;
  applyH(re, im, NL, J, V, hRe, hIm);
  for (let i = 0; i < n; i++) { reBuf[i] = re[i] + dt * hIm[i]; imBuf[i] = im[i] - dt * hRe[i]; }
}
// RK4 fuer dpsi/dt = -i H psi: genauer als Euler, driftet aber langfristig (nicht
// strikt unitaer). Zeigt den Genauigkeits-/Erhaltungs-Kompromiss im Vergleich.
function solveRK4(re, im, NL, J, V, dt, reBuf, imBuf, work) {
  const n = re.length, hRe = work.hRe, hIm = work.hIm;
  const k1r = work.k1r, k1i = work.k1i, k2r = work.k2r, k2i = work.k2i;
  const k3r = work.k3r, k3i = work.k3i, k4r = work.k4r, k4i = work.k4i, tr = work.tr, ti = work.ti;
  // f(psi) = -i H psi -> (Im(Hpsi), -Re(Hpsi))
  applyH(re, im, NL, J, V, hRe, hIm); for (let i = 0; i < n; i++) { k1r[i] = hIm[i]; k1i[i] = -hRe[i]; }
  for (let i = 0; i < n; i++) { tr[i] = re[i] + dt / 2 * k1r[i]; ti[i] = im[i] + dt / 2 * k1i[i]; }
  applyH(tr, ti, NL, J, V, hRe, hIm); for (let i = 0; i < n; i++) { k2r[i] = hIm[i]; k2i[i] = -hRe[i]; }
  for (let i = 0; i < n; i++) { tr[i] = re[i] + dt / 2 * k2r[i]; ti[i] = im[i] + dt / 2 * k2i[i]; }
  applyH(tr, ti, NL, J, V, hRe, hIm); for (let i = 0; i < n; i++) { k3r[i] = hIm[i]; k3i[i] = -hRe[i]; }
  for (let i = 0; i < n; i++) { tr[i] = re[i] + dt * k3r[i]; ti[i] = im[i] + dt * k3i[i]; }
  applyH(tr, ti, NL, J, V, hRe, hIm); for (let i = 0; i < n; i++) { k4r[i] = hIm[i]; k4i[i] = -hRe[i]; }
  for (let i = 0; i < n; i++) {
    reBuf[i] = re[i] + dt / 6 * (k1r[i] + 2 * k2r[i] + 2 * k3r[i] + k4r[i]);
    imBuf[i] = im[i] + dt / 6 * (k1i[i] + 2 * k2i[i] + 2 * k3i[i] + k4i[i]);
  }
}
// Solver-Registry (Q-SIM-OPS-Stil): Name -> Adapter + Eigenschaft.
const SOLVERS = {
  cn: { fn: solveCN, l: "Crank-Nicolson", note: "unitaer (normerhaltend)" },
  rk4: { fn: solveRK4, l: "Runge-Kutta 4", note: "genau, driftet langsam" },
  euler: { fn: solveEuler, l: "Euler (explizit)", note: "driftet stark - Vergleich" },
};
// Work-Buffer fuer alle HQST-Solver (CN nutzt b*, alle nutzen h*, RK4 k*/t*).
function mkHqstWork(n) {
  return {
    bRe: new Float64Array(n), bIm: new Float64Array(n), hRe: new Float64Array(n), hIm: new Float64Array(n),
    k1r: new Float64Array(n), k1i: new Float64Array(n), k2r: new Float64Array(n), k2i: new Float64Array(n),
    k3r: new Float64Array(n), k3i: new Float64Array(n), k4r: new Float64Array(n), k4i: new Float64Array(n),
    tr: new Float64Array(n), ti: new Float64Array(n),
  };
}
// Einheitlicher Einstiegspunkt; solverId waehlt den Adapter.
function stepHQST(re, im, NL, J, V, dt, reBuf, imBuf, work, solverId) {
  const s = SOLVERS[solverId] || SOLVERS.cn;
  return s.fn(re, im, NL, J, V, dt, reBuf, imBuf, work); // Konvergenz-Flag (cn) bzw. undefined
}
// Wertfeld -> Anzeigefarbe. snow/water: Blau-Weiss-Verlauf; hqst: |psi|^2 als Hitze.
function rvalColor(v, rule) {
  if (rule === "hqst") {
    const p = Math.min(1, v * 800); // |psi|^2 skaliert
    const r = Math.round(40 + 215 * p), g = Math.round(20 + 100 * p), b2 = Math.round(60 + 195 * (1 - p) * p * 4);
    return `rgb(${r},${g},${Math.min(255, b2 + 80)})`;
  }
  if (rule === "snow") {
    if (v >= 1) { const ic = Math.min(255, 200 + (v - 1) * 30); return `rgb(${ic},${ic},255)`; }
    const t = Math.min(1, v); const c = Math.round(20 + t * 60); return `rgb(${c},${c + 20},${c + 60})`;
  }
  // water
  const t = Math.min(1, v); const r = Math.round(20 + t * 20), g = Math.round(60 + t * 80), b2 = Math.round(90 + t * 165);
  return `rgb(${r},${g},${b2})`;
}

// === COLLATZ (Zahlentheorie) ===
// Jede Zelle traegt eine ganze Zahl. Collatz-Schritt: gerade -> n/2, ungerade
// -> 3n+1. Werte bei 2^31 gedeckelt (Int32-sicher). Zellen, die 1 erreichen,
// uebernehmen periodisch den Nachbar-Maximalwert (raeumliche Kopplung), damit
// das Feld lebendig bleibt statt komplett auf 1 zu kollabieren.
const COLLATZ_CAP = 0x40000000; // 2^30, sicher unter 2^31
function stepCollatz(s, NL, buf) {
  const n = s.length, ns = buf;
  for (let i = 0; i < n; i++) {
    let v = s[i];
    if (v <= 1) {
      // raeumliche Wiedergeburt: groesster Nachbar / 2, sonst bleibt 1
      const b = i * 6; let mx = 0;
      for (let k = 0; k < 6; k++) { const j = NL[b + k]; if (j >= 0 && s[j] > mx) mx = s[j]; }
      ns[i] = mx > 2 ? (mx >> 1) : 1;
    } else if ((v & 1) === 0) {
      ns[i] = v >> 1;
    } else {
      const nv = 3 * v + 1;
      ns[i] = nv > COLLATZ_CAP ? (nv % COLLATZ_CAP) | 1 : nv; // deckeln, ungerade halten
    }
  }
  return ns;
}
// Collatz-Faerbung: Stopping-Time-artige Groesse -> Itten-Hue. log2(Wert) auf
// 12 Farben gemappt, plus Helligkeit nach Paritaet.
function collatzColor(v) {
  if (v <= 1) return "rgb(18,22,30)";
  const bits = Math.min(30, Math.floor(Math.log2(v)));
  const hue = (bits / 30) * PI2;
  const c = ALLCOL[Math.round((hue / STEP12)) % 12];
  const [r, g, b] = COLA[c];
  const odd = (v & 1) ? 1 : 0.7;
  return `rgb(${Math.round(r * odd)},${Math.round(g * odd)},${Math.round(b * odd)})`;
}

// === DOMINANTE GENE (Mendel + Hardy-Weinberg) ===
// Diploide Zelle: Genotyp 0 leer, 1=AA, 2=Aa, 3=aa. Phaenotyp: AA/Aa dominant,
// aa rezessiv. Fortpflanzung: leere Zelle mit >=2 belebten Nachbarn erhaelt je
// ein zufaellig (deterministisch via hash) gewaehltes Allel zweier Nachbar-
// Eltern (Mendel). Belebte Zelle ueberlebt bei 2-4 Nachbarn (Stabilitaet).
const G_AA = 1, G_Aa = 2, G_aa = 3;
function alleleA(g, pick) { // pick 0/1 waehlt erstes/zweites Allel
  if (g === G_AA) return 0;            // A
  if (g === G_aa) return 1;            // a
  return pick;                          // Aa -> A wenn pick 0, sonst a
}
function genotype(a1, a2) {
  const sum = a1 + a2; // 0=AA,1=Aa,2=aa
  return sum === 0 ? G_AA : sum === 2 ? G_aa : G_Aa;
}
function stepGenes(s, NL, buf, tick) {
  const n = s.length, ns = buf;
  for (let i = 0; i < n; i++) {
    const b = i * 6;
    let live = 0; const par = [];
    for (let k = 0; k < 6; k++) { const j = NL[b + k]; if (j >= 0 && s[j] !== 0) { live++; par.push(j); } }
    const self = s[i];
    if (self !== 0) {
      ns[i] = (live >= 2 && live <= 4) ? self : 0; // Survival 2-4
    } else if (live >= 2) {
      // zwei Eltern deterministisch waehlen
      const h1 = hash2(i, tick), h2 = hash2(i + 1, tick * 3 + 7);
      const p1 = par[Math.floor(h1 * par.length) % par.length];
      const p2 = par[Math.floor(h2 * par.length) % par.length];
      const a1 = alleleA(s[p1], hash2(i + 2, tick) < 0.5 ? 0 : 1);
      const a2 = alleleA(s[p2], hash2(i + 3, tick) < 0.5 ? 0 : 1);
      ns[i] = (live === 3 || live === 2) ? genotype(a1, a2) : 0; // Geburt bei 2-3 Eltern
    } else ns[i] = 0;
  }
  return ns;
}
// Genotyp-Faerbung: AA dominant-satt, Aa Mischung, aa rezessiv-blass.
function geneColor(g) {
  if (g === G_AA) return "rgb(230,60,60)";   // homozygot dominant - kraeftig rot
  if (g === G_Aa) return "rgb(210,150,40)";  // heterozygot - misch (zeigt dominant)
  if (g === G_aa) return "rgb(70,110,200)";  // homozygot rezessiv - blau
  return "rgb(18,22,30)";
}

// =============================================================================
// ImageData-Raster-Helfer (Perf). Bei winzigen Zellen (XXL/rausgezoomt) bringt ein
// Hexagon-Pfad nichts - direkte Pixel-Block-Writes in ein Uint32-ImageData sind weit
// schneller als tausende Path2D-fills (web-belegt: putImageData > path-fill; in-Lineage
// bewiesen v30; bench: experimental/bench-render-paths.mjs). RGBA little-endian 0xAABBGGRR.
const BG_PACK = ((255 << 24) | (8 << 16) | (6 << 8) | 2) >>> 0; // T.bg #020608
function packRGB(r, g, b) { return ((255 << 24) | (b << 16) | (g << 8) | r) >>> 0; }
function parsePack(str) { const m = String(str).match(/\d+/g); return (m && m.length >= 3) ? packRGB(+m[0], +m[1], +m[2]) : BG_PACK; }

// --- Sammel-Export (AP-1) ----------------------------------------------------
export {
  S3,
  PI2,
  PI3,
  PI6,
  C0,
  CR,
  CRO,
  CO,
  CYO,
  CY,
  CYG,
  CG,
  CBG,
  CB,
  CBV,
  CV,
  CRV,
  PRIMARY,
  SECONDARY,
  TERTIARY,
  ALLCOL,
  NCOL,
  CYCLE,
  COMPLEMENT,
  T,
  COLA,
  rgbStr,
  COLHEX,
  NAME,
  SHORT,
  STEP12,
  HUE,
  COSH,
  SINH,
  HUE_BUCKET,
  hueToState,
  GRID_SIZES,
  CELL_CAP,
  CIRCLE_CELL_CAP,
  MAX_CIRCLE_RADIUS,
  DEFAULT_CIRCLE_RADIUS,
  HQST_CELL_CAP,
  SPEEDS,
  SPLBL,
  DENS,
  MAX_UNDO,
  RULES,
  RMETA,
  hexClass2,
  INT_RULES,
  intMeta,
  INT_META,
  WATZ_RULE,
  WATZ_META,
  PATS,
  AXIOMS,
  PAD,
  clamp,
  hexCenter,
  axialRound,
  pixelToOddR,
  worldSize,
  circleGridDims,
  buildNeighbors,
  hash2,
  rng,
  birthColorQuad,
  cMixVec,
  mMixCnt,
  driftHue,
  stepLife,
  RVAL_RULES,
  stepReiter,
  stepWater,
  solveEuler,
  solveRK4,
  SOLVERS,
  mkHqstWork,
  stepHQST,
  rvalColor,
  COLLATZ_CAP,
  stepCollatz,
  collatzColor,
  G_AA,
  G_Aa,
  G_aa,
  alleleA,
  genotype,
  stepGenes,
  geneColor,
  BG_PACK,
  packRGB,
  parsePack,
};
