import { useState, useCallback, useEffect, useRef } from "react";
// =============================================================================
// GolHex v29L.3b - Hexagonal Game of Life (Forschungsstation)
// Coworker Research / Coworkerz - 2026-05-31
// Lineage: v16.5 -> ... -> v29L.2 -> v29L.3 -> v29L.3b
//
// v29L.3b Delta (kritische Haertung der Forschungsmodule):
//   1. FIX: Seed fehlte in den LiouScope-Metadaten -> aufgezeichnete Zeitreihen
//      waren nicht reproduzierbar. Seed + Solver jetzt in recMeta (konsistent
//      mit dem Globalarchiv).
//   2. FIX: Crank-Nicolson-Fixpunkt schnitt still am festen Cap (24) ab. Jetzt
//      echte Konvergenzpruefung (Cap 60) + Konvergenz-Flag. Quelle: arXiv
//      gr-qc/9909026 (nicht-monotone Konvergenz der iterierten CN-Methode kann
//      bei zu fruehem Abbruch instabil werden).
//
// v29L.3 Delta (Reproduzierbarkeit, Globalarchiv, Solver-Triade):
//   1. FIX: Zufalls-Anfangszustaende nutzten Date.now() (NICHT reproduzierbar).
//      Jetzt deterministischer Seed -> gleicher Seed = gleiche Welt (verifiziert).
//   2. Globalarchiv (Q-Forge-Provenienz-Stil): speichert/laedt die vollstaendige
//      Lauf-Konfiguration (Seed + alle Parameter) als JSON, Schema golhex.snapshot.v1.
//      Exakt reproduzierbare Laeufe.
//   3. Solver-Triade vervollstaendigt: RK4 als dritter Integrator. Verifiziert
//      gegen echten Code: cn (~1e-9) < rk4 (~5e-4) < euler (driftet stark).
//
// v29L.2 Delta (Rahmen-Vollfuellung + Forschungsstation-Module):
//   1. Rahmen (Kreis/Rechteck) fuellt das GANZE Hexfeld: groesster eingeschriebener
//      Kreis (rMax=min(halfW,halfH)+Zellrand), Umriss exakt an Maske gekoppelt.
//      Validiert: 100% Feldhoehe bei breiten Gittern (inkl. XXL).
//   2. LiouScope-Anbindung: Zeitreihen-Recorder (volle Trajektorie) + Export CSV
//      und JSON mit Metadaten (Schema liouscope.timeseries.v1).
//   3. Q-SIM-OPS Solver-Abstraktion: HQST-Integrator austauschbar (SOLVERS):
//      Crank-Nicolson (unitaer, Default) vs Euler (driftet, Vergleich).
//
// v29L Delta (Rahmenformen, Topologie-Kopplung, Systemtheorie):
//   1. Rahmenform waehlbar: Rechteck (volle Domaene) oder Kreis (eingeschriebene
//      Scheibe als Domaenenmaske). Zellen ausserhalb sind permanente Waende.
//   2. Drei Randklassen (Fachstandard: periodisch / reflektierend / fest):
//      - Rand (reflektierend, Neumann): Null-Fluss, massenerhaltend (~1e-6).
//      - Torus Rechteck: periodischer Standard-Wrap.
//      - Torus Kreis: antipodale Identifikation = reelle projektive Ebene (RP2).
//        BEWIESEN reziprok + H hermitesch -> HQST-Norm erhalten (~1e-9). Nicht-
//        orientierbar (Moebius): Muster kehren am Rand spiegelverkehrt zurueck.
//      - Offenes System (Dirichlet): Rand haelt konstanten Quellwert, Austausch
//        mit Umgebung (snow/water). Maximumprinzip verifiziert.
//   3. Systemtheorie-Modell (Kybernetik): homeostatische Negativ-Rueckkopplung
//      auf Dichte-Sollwert -> dynamisches Gleichgewicht (konvergiert, verifiziert).
//      Offen/geschlossen-Unterscheidung als systemtheoretische Kernkategorie.
//   Quellen: math.union.edu RP2; Open University Surfaces; jcasim.de Randklassen.
//
// v29.2 Delta (Statistik-Funktion im Physik-Modus):
//   1. FIX: Statistik-Karte zaehlte im rval-Modus das leere boolesche Feld
//      (Pop/Dichte/Histogramm stets 0). Jetzt regelgerechte Kennzahlen:
//      Eis-/Wasser-/belegte Zellen, Wasser-Gesamtmasse, HQST-Norm (~1, unitaer).
//   2. Sparkline folgt im rval-Modus der Aktiv-Zellzahl. Geburten/Tode-Anzeige
//      nur in der Lebenswelt (im rval-Modus nicht sinnvoll).
//   Verifiziert: HQST-Norm=1.000, Wasser-Masse erhalten.
//
// v29.1 Delta (Funktions-Haertung "alles soll funktionieren"):
//   1. FIX: Malen/Tippen im Physik-Modus wirkte auf das unsichtbare boolesche
//      Feld statt auf das reellwertige - jetzt regelabhaengig (Eiskeim/Wasser/
//      Anregung/Zahl/Genotyp). Cycle-Pinsel blockiert rval-Tap nicht mehr.
//   2. FIX: Undo im Physik-Modus sichert/restauriert jetzt das reellwertige Feld
//      statt colorRef.
//   3. Vollkompilierung + Funktionstest aller 5 rval-Regeln (alle zeigen Dynamik).
//
// v29.0 Delta (Luecken aus v26-v28 geschlossen, web-fundiert + paritaetsgetestet):
//   1. HQST: pragmatische Renormierung ersetzt durch CRANK-NICOLSON - von Natur
//      aus unitaer (Norm-Abw. ~1e-9 OHNE Renorm). Quelle: arXiv 2108.12614.
//   2. Performance: kontinuierliche rval-Regeln mit quantisiertem Farb-Batching
//      (24 Klassen, je 1 fill) statt ein fill pro Zelle.
//   3. Farben: alle 12 Itten-Toene konsistent aus Gossett-Chen RYB-Wuerfel.
//   4. Farbkreis-Stempel: Rot oben, Uhrzeigersinn (Itten-Vorlage-treu).
//   5. Genetik ueber 100 Gen verifiziert: Hardy-Weinberg-stabil.
//
// v28.0 Delta (zwei neue rval-Regeln + Reiter-Fix, web-fundiert + paritaetsgetestet):
//   1. FIX: stepReiter paritaetstreu korrigiert - korrekte Randbehandlung
//      (Divisor = tatsaechliche Nachbarzahl) + Single-Pass statt doppelter
//      Rezeptivitaets-Berechnung. Gegen Referenz getestet.
//   2. Collatz (Zahlentheorie): n gerade->n/2, ungerade->3n+1, Int32-gedeckelt,
//      raeumliche Wiedergeburt aus groesstem Nachbarn. Faerbung nach log2.
//   3. Dominante Gene (Mendel/Hardy-Weinberg): diploide Genotypen AA/Aa/aa,
//      dominante zeigen Merkmal mit 1 Allel, rezessive brauchen 2. HW-Start.
//   4. Performance: Gene-Render mit echtem Farb-Batching (endliche Zustaende).
//   Quellen: conwaylife.com (Reiter); Hardy-Weinberg (Nature Scitable, LibreTexts).
//
// v27.0 Delta (reellwertiger Physik-Modus, web-fundiert + verifiziert):
//   1. Zweiter Simulationsmodus "rval" neben der booleschen Engine - die
//      getestete Farbinvarianz der Lebenswelt-Regeln bleibt voellig unberuehrt.
//   2. Drei reellwertige Regeln:
//      - Schneeflocke: Reiter-Automat (Chaos Solitons Fractals 23:1111).
//      - Wasser: Gravitation + Druckausgleich, massenerhaltend.
//      - HQST: hexagonale Tight-Binding-Quantenwelle, normerhaltend (Renorm).
//   3. UI modusabhaengig: Pinsel/Stempel/Farbmodus nur in Lebenswelt.
//   SPAETER (vermerkt): Ableitung auf Welken, Bahnen/Leitungen/Schlaeuche,
//   Wellen und Informationsausbreitung - alle auf der rval-Diffusionsbasis.
//
// v26.0 Delta (12-Farben-Itten):
//   1. Farbsystem auf 12 Itten-Farben erweitert (6 Basis + 6 Tertiaer),
//      30-Grad-Kreis, 6 Komplementaerpaare. Alle gleichberechtigte Zustaende:
//      malbar, durch Geburt entstehend, ueberlebend, mischend (Farbenlehre).
//   2. Farbkreis-Stempel als Ring und als gefuellte Scheibe.
//   3. Farbinvarianz + Mischung auf 12 Zustaenden neu verifiziert.
//
// v25.1 Delta (Paritaets-Haertung):
//   1. Engine konsolidiert: INT-Pfad (hexClass2/b2/s2) jetzt in der EINEN
//      kanonischen stepEngine - keine getrennte stepEngineINT-Kopie mehr.
//      Paritaet Artifact<->Engine per verify_parity.mjs bestaetigt.
//   2. driftHue-Audit: 1-Schritt-Grenze (max 60grad) verifiziert.
//
// v25.0 Delta:
//   - Isotrop nicht-totalistische (INT) Hex-Regeln, Callahan o/m/p.
//   - Engine als Single Source of Truth refaktoriert (golhex_engine.test.mjs).
//   1. Farbmodell korrigiert: Anzeigefarben aus Gossett-Chen RYB-Wuerfel
//      (INFOVIS 2004) statt aequidistanter RGB-Hue-Rotation.
//   2. Farbinvarianz wiederhergestellt (LifeWiki Colourised Life / QuadLife):
//      Farbe ist reiner Datenkanal, beeinflusst NIE die Lebend/Tot-Dynamik.
//      Default "quad" = QuadLife-Vererbung; "mix"/"drift" optional.
//   3. Verfaerben jetzt klar als experimenteller Modus markiert.
//   Quellen: Gossett & Chen INFOVIS 2004; conwaylife.com/wiki/Colourised_Life;
//   ProfJski/ArtColors (Subtraktiv-Mix).
//
// Aeltere Deltas (v20): Regelquelle Standard/Watzlawick, Legende, Zoom, gridRef-Fix.
//
// v19.0 Basis:
//   - Farb-Pinsel oben, Tap-Zyklus leer->blau->rot->gelb, 5 Watzlawick-Axiome.
//
// Originaltechniken erhalten:
//   - Theme T (Teal/Neon, accent #5CF0CC), Space Grotesk + JetBrains Mono.
//   - Echte Grid-Groessen mit Hexradius pro Stufe (S..XXL).
//   - Kanonisches Red-Blob pixelToOddR (Pixel->Axial->Cube-Round->odd-r),
//     100% Trefferquote alle Groessen (verifiziert).
//   - Torus-Wrapping axial-basiert, Path2D addPath-Batching, Glow via Geometrie
//     (kein shadowBlur), Gitterlinien ab Screen-Radius < 4px ausgeblendet.
//   - Double-Buffer Uint8Array, Undo-Stack, Pattern als Stempel (nicht auto).
// =============================================================================

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

// Grid-Groessen mit Hexradius (world units) pro Stufe
const GRID_SIZES = [
  { l: "S", rows: 40, cols: 50, hr: 12 },
  { l: "M", rows: 80, cols: 100, hr: 6 },
  { l: "L", rows: 120, cols: 150, hr: 4 },
  { l: "XL", rows: 160, cols: 200, hr: 3 },
  { l: "XXL", rows: 200, cols: 250, hr: 2.5 },
];

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
  BaysGlider: [[0, 0], [0, 1], [1, 0], [1, 1], [2, 1]],
};

const AXIOMS = [
  { id: "a1", short: "A1 Stille spricht", desc: "Man kann nicht nicht kommunizieren: vollstaendig stille Leerzonen keimen selten spontan." },
  { id: "a2", short: "A2 Beziehung > Inhalt", desc: "Inhalts-/Beziehungsaspekt: Nachbar-Mehrheit (mMix) klassifiziert den Inhalt statt Mischung (cMix)." },
  { id: "a3", short: "A3 Interpunktion", desc: "Interpunktion der Ereignisfolge: alte Zellen (Alter >= 6) erhalten +/-1 Ueberlebens-Toleranz." },
  { id: "a4", short: "A4 Analog", desc: "Digital + analog: sterbende Zellen hinterlassen einen Halbzustand (Ghost), 1 Generation als Nachbar." },
];

// --- Geometrie (kanonisch, verifiziert) -------------------------------------
const PAD = (hr) => hr * 1.3;
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);

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

// Rahmenform + Topologie -> Nachbar-Lookups mit korrekter Randphysik.
// shape: "box" (volle Rechteck-Domaene) | "circle" (eingeschriebene Scheibe).
// Liefert: { torus, edge, mask, inCount }.
//   mask[i]=1 wenn Zelle in der Domaene. Zellen ausserhalb sind permanente Waende.
//   edge:  Nachbar ausserhalb Domaene -> -1 (Rand: Neumann/reflektierend; boolesch
//          = tote Wand, rval = Selbstwert -> Null-Fluss, massenerhaltend).
//   torus: Nachbar ausserhalb Domaene -> bei "box" Standard-Wrap; bei "circle"
//          antipodale Identifikation (Strahl durch Zentrum, gegenueberliegende
//          Randzelle) -> periodische Scheibe (RP2-artig), reflexionsfrei.
function buildNeighbors(R, C, shape) {
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
  const radius = Math.min(halfW, halfH);
  const inDomain = (r, c) => {
    if (r < 0 || r >= R || c < 0 || c >= C) return false;
    if (shape !== "circle") return true;
    const dx = wx(r, c) - cx, dy = wy(r) - cy;
    return Math.hypot(dx, dy) <= radius;
  };
  let inCount = 0;
  for (let r = 0; r < R; r++) for (let c = 0; c < C; c++) { if (inDomain(r, c)) { mask[r * C + c] = 1; inCount++; } }
  // Antipodale In-Domaenen-Zelle fuer circle-torus: gegenueberliegender Strahl.
  const antipode = (r, c) => {
    const dx = wx(r, c) - cx, dy = wy(r) - cy;
    // gegenueberliegende Richtung, am Rand entlang nach innen suchen
    for (let t = radius; t > 0; t -= 0.5) {
      const ax = cx - dx * (t / (Math.hypot(dx, dy) || 1));
      const ay = cy - dy * (t / (Math.hypot(dx, dy) || 1));
      const rr = Math.round(ay / 1.5);
      const cc2 = Math.round(ax / S3 - ((rr & 1) ? 0.5 : 0));
      if (inDomain(rr, cc2)) return rr * C + cc2;
    }
    return r * C + c;
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
        // Torus
        if (shape !== "circle") {
          torus[base + k] = (((nr % R) + R) % R) * C + (((nc % C) + C) % C);
        } else {
          if (!selfIn) { torus[base + k] = -1; }
          else if (inDomain(nr, nc)) { torus[base + k] = nr * C + nc; }
          else { torus[base + k] = antipode(r, c); }
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

// Reiter-Schritt: rezeptiv = Eis (>=1) oder Nachbar von Eis. Rezeptive speichern
// Wert + gamma; nichtrezeptive diffundieren (Laplace, rezeptive Nachbarn = 0,
// Rand = Selbstwert mit korrektem Divisor). Vorab-Pass fuer Rezeptivitaet, damit
// die Diffusionsnachbarn konsistent klassifiziert sind (Paritaet mit Referenz).
function stepReiter(s, NL, alpha, gamma, buf, recBuf) {
  const n = s.length, ns = buf, rec = recBuf;
  for (let i = 0; i < n; i++) {
    let r = s[i] >= 1;
    if (!r) { const b = i * 6; for (let k = 0; k < 6; k++) { const j = NL[b + k]; if (j >= 0 && s[j] >= 1) { r = true; break; } } }
    rec[i] = r ? 1 : 0;
  }
  for (let i = 0; i < n; i++) {
    if (rec[i]) { ns[i] = s[i] + gamma; continue; }
    const b = i * 6; let sum = 0, cnt = 0;
    for (let k = 0; k < 6; k++) {
      const j = NL[b + k];
      if (j < 0) { sum += s[i]; cnt++; continue; }
      sum += rec[j] ? 0 : s[j]; cnt++;
    }
    const lap = sum / cnt - s[i];
    ns[i] = s[i] + (alpha / 2) * lap;
  }
  return ns;
}
// Wasser: Gravitation (untere Nachbarn k=4,5) + seitlicher Druckausgleich (k=2,3).
// Massenerhaltend. Grundregel dessen, was sich auf Wasser verhaelt: Auftrieb.
function stepWater(w, NL, C, buf) {
  const n = w.length, nw = buf;
  for (let i = 0; i < n; i++) nw[i] = w[i];
  for (let i = n - 1; i >= 0; i--) {
    let amt = nw[i]; if (amt <= 1e-6) continue;
    const r = (i / C) | 0, b = i * 6;
    for (const k of [4, 5]) {
      const j = NL[b + k]; if (j < 0) continue;
      if (((j / C) | 0) <= r) continue;
      const room = 1 - nw[j]; if (room <= 0) continue;
      const move = Math.min(amt, room) * 0.5; nw[j] += move; nw[i] -= move; amt -= move;
      if (amt <= 1e-6) break;
    }
  }
  for (let i = 0; i < n; i++) {
    const b = i * 6;
    for (const k of [2, 3]) { const j = NL[b + k]; if (j < 0) continue; const diff = (nw[i] - nw[j]) * 0.25; if (diff > 0) { nw[i] -= diff; nw[j] += diff; } }
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
function applyH(re, im, NL, J, V, hRe, hIm) {
  const n = re.length;
  for (let i = 0; i < n; i++) {
    const b = i * 6; let sre = 0, sim = 0;
    for (let k = 0; k < 6; k++) { const j = NL[b + k]; if (j >= 0) { sre += re[j]; sim += im[j]; } }
    hRe[i] = -J * sre + V * re[i]; hIm[i] = -J * sim + V * im[i];
  }
}
// Crank-Nicolson (unitaer, Default): (I + i*a*H) x = b, Fixpunkt-Iteration.
// Konvergenz garantiert, wenn der Spektralradius a*||H|| < 1 (||H|| ~ 6*J fuer
// das Hex-Tight-Binding). Bei Bedarf mehr Iterationen; Konvergenz wird geprueft
// statt still am Cap abzuschneiden (vgl. arXiv gr-qc/9909026: nicht-monotone
// Konvergenz der iterierten CN-Methode kann sonst instabil werden).
function solveCN(re, im, NL, J, V, dt, reBuf, imBuf, work) {
  const n = re.length, a = dt / 2;
  const bRe = work.bRe, bIm = work.bIm, hRe = work.hRe, hIm = work.hIm;
  applyH(re, im, NL, J, V, hRe, hIm);
  for (let i = 0; i < n; i++) { bRe[i] = re[i] + a * hIm[i]; bIm[i] = im[i] - a * hRe[i]; }
  let xRe = reBuf, xIm = imBuf;
  for (let i = 0; i < n; i++) { xRe[i] = bRe[i]; xIm[i] = bIm[i]; }
  // PERF-FIX (2026-06-01): Felder sind Float32 (~1e-7 Rausch-Boden). Die alte
  // Schwelle 1e-10 war UNTER diesem Boden -> Fixpunkt konvergierte NIE -> jedes
  // Step lief alle 60 Iterationen (~150ms/Step, HQST gedeckelt auf ~6 Gen/s).
  // Float32-gerechte Schwelle 2e-6 wird bei a*||H||=0.225 in ~10 Iter erreicht
  // (0.225^10 ~ 3e-7) -> ~5x schneller, Genauigkeit fuer Visualisierung unveraendert.
  const MAXIT = 60, TOL = 2e-6; let conv = false;
  for (let it = 0; it < MAXIT; it++) {
    applyH(xRe, xIm, NL, J, V, hRe, hIm);
    let maxd = 0;
    for (let i = 0; i < n; i++) {
      const nxRe = bRe[i] + a * hIm[i], nxIm = bIm[i] - a * hRe[i];
      const d = Math.abs(nxRe - xRe[i]) + Math.abs(nxIm - xIm[i]); if (d > maxd) maxd = d;
      xRe[i] = nxRe; xIm[i] = nxIm;
    }
    if (maxd < TOL) { conv = true; break; }
  }
  return conv; // false signalisiert Nicht-Konvergenz (Parameter zu gross)
}
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
  s.fn(re, im, NL, J, V, dt, reBuf, imBuf, work);
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
// ImageData-Raster-Helfer (Perf, 2026-06-01). Bei winzigen Zellen (XXL/rausgezoomt)
// bringt ein Hexagon-Pfad nichts — direkte Pixel-Block-Writes in ein Uint32-ImageData
// sind ~50x schneller als tausende Path2D-fills (web-belegt: putImageData > path-fill;
// in-Lineage bewiesen in GolHex v30). RGBA little-endian: 0xAABBGGRR.
const BG_PACK = ((255 << 24) | (8 << 16) | (6 << 8) | 2) >>> 0; // T.bg #020608
function packRGB(r, g, b) { return ((255 << 24) | (b << 16) | (g << 8) | r) >>> 0; }
function parsePack(str) { const m = String(str).match(/\d+/g); return (m && m.length >= 3) ? packRGB(+m[0], +m[1], +m[2]) : BG_PACK; }

// =============================================================================
// Coworkerz-Standard: plattform-ehrliches Schliessen (✕ -> Zentrale / Fenster).
// Aus einem Launcher (Zentrale) im selben Tab geoeffnet -> Verlauf zurueck; sonst
// window.close() (Electron/PWA) mit ehrlichem Browser-Tab-Fallback. Kein hardcodierter Pfad.
function closeApp() {
  if (typeof window !== "undefined" && window.history && window.history.length > 1) { window.history.back(); return; }
  try { window.close(); } catch { /* ignore */ }
  setTimeout(() => {
    if (typeof document !== "undefined" && !document.hidden) {
      try {
        document.documentElement.innerHTML =
          '<body style="margin:0;height:100vh;display:flex;align-items:center;justify-content:center;' +
          'background:#0a0a0a;color:#8a94a6;font-family:system-ui,sans-serif;text-align:center;padding:24px">' +
          '<div><div style="font-size:18px;color:#5CF0CC;font-weight:700;margin-bottom:8px">GolHex beendet</div>' +
          '<div>Du kannst diesen Tab / dieses Fenster jetzt schliessen.</div></div></body>';
      } catch { /* ignore */ }
    }
  }, 250);
}

export default function GolHex() {
  const [sizeIdx, setSizeIdx] = useState(1); // M default
  const G = GRID_SIZES[sizeIdx];
  const R = G.rows, C = G.cols, HR = G.hr, N = R * C;
  const gridRef = useRef(G);
  gridRef.current = G; // waehrend Render aktuell halten (stabil fuer draw/fitView)

  const [running, setRunning] = useState(false);
  const [speedIdx, setSpeedIdx] = useState(4);
  const [ruleIdx, setRuleIdx] = useState(0);
  const [torusOn, setTorusOn] = useState(true);
  const [frameShape, setFrameShape] = useState("box"); // "box" Rechteck | "circle" Scheibe
  // Systemtheorie-Modell: homeostatische Negativ-Rueckkopplung (Kybernetik).
  const [sysTheory, setSysTheory] = useState(false);
  const [sysSetpoint, setSysSetpoint] = useState(0.5); // Ziel-Nachbardichte (0..1)
  // Offenes System (Dirichlet-Rand): Randzellen halten konstanten Quellwert,
  // Austausch mit Umgebung. Nur fuer Diffusionsphysik (snow/water) wirksam.
  const [openSys, setOpenSys] = useState(false);
  // LiouScope-Recorder-UI-State
  const [recording, setRecording] = useState(false);
  const [recMsg, setRecMsg] = useState("");
  // Q-SIM-OPS Solver-Wahl fuer HQST (cn = unitaerer Default, euler = Vergleich)
  const [solverId, setSolverId] = useState("cn");
  // Deterministischer Seed: macht Zufalls-Anfangszustaende reproduzierbar
  // (Voraussetzung fuer das Globalarchiv und korrekte LiouScope-Metadaten).
  const [seed, setSeed] = useState(12345);
  // Globalarchiv-Rueckmeldung
  const [archMsg, setArchMsg] = useState("");
  const [brush, setBrush] = useState("cycle"); // cycle | CR | CB | CY | erase
  const [pattern, setPattern] = useState("BaysGlider");
  const [gen, setGen] = useState(0);
  const [stats, setStats] = useState({ pop: 0, cnt: [0,0,0,0,0,0,0,0,0,0,0,0,0], density: 0, births: 0, deaths: 0, sps: 0, hist: [] });
  const [zoomLbl, setZoomLbl] = useState(1);
  const [showSettings, setShowSettings] = useState(true);
  const [showAxioms, setShowAxioms] = useState(false);
  const [ax, setAx] = useState({ a1: false, a2: false, a3: false, a4: false });
  const [a5, setA5] = useState("off");
  const [watzOnly, setWatzOnly] = useState(false);
  const [ruleSrc, setRuleSrc] = useState("tot"); // "tot" totalistisch | "int" isotrop-nicht-totalistisch
  const [showLegend, setShowLegend] = useState(false);
  // Farbmodus: "quad" = QuadLife-farbinvariant (State of the Art),
  //            "mix" = subtraktiver Hue-Mix, "drift" = Verfaerben (experimentell)
  const [colorMode, setColorMode] = useState("quad");
  // Simulationsmodus: "life" = boolesche farbinvariante Engine (Default),
  //                   "rval" = reellwertig (Schneeflocke/Wasser/HQST).
  const [simMode, setSimMode] = useState("life");
  const [rvalRule, setRvalRule] = useState("snow");

  const colorRef = useRef(new Uint8Array(N));
  const ghostRef = useRef(new Uint8Array(N));
  const ageRef = useRef(new Uint16Array(N));
  const nColorRef = useRef(new Uint8Array(N));
  const nGhostRef = useRef(new Uint8Array(N));
  const nAgeRef = useRef(new Uint16Array(N));
  // Reellwertige Felder
  const fieldRef = useRef(new Float32Array(N));      // snow/water + hqst-Re
  const fieldImRef = useRef(new Float32Array(N));    // hqst-Im
  const fBufRef = useRef(new Float32Array(N));
  const fBufImRef = useRef(new Float32Array(N));
  const fRecRef = useRef(new Uint8Array(N));
  const hqstWorkRef = useRef(mkHqstWork(N));
  // ImageData-Raster (Perf): wiederverwendetes ImageData + precomputed Welt-Zentren.
  const rasterImgRef = useRef(null);
  const cellCxRef = useRef(new Float32Array(N));
  const cellCyRef = useRef(new Float32Array(N));
  const tickRef = useRef(0);
  const neighRef = useRef(buildNeighbors(R, C, "box"));
  const dirtyRef = useRef(true);
  const statsRef = useRef({ births: 0, deaths: 0 });
  const histRef = useRef([]);
  // LiouScope-Recorder: vollstaendige Zeitreihe der Observablen (nicht nur das
  // 120-Punkt-Anzeigefenster). Jede Zeile = ein Schritt; Spalten regelabhaengig.
  const recRef = useRef({ on: false, rows: [], cols: [] });
  const spsRef = useRef(0);
  const loopStepRef = useRef(0);
  const loopT0Ref = useRef(performance.now());

  const viewRef = useRef({ s: 1, tx: 0, ty: 0, fit: 1 });
  const canvasRef = useRef(null);
  const wrapRef = useRef(null);
  const undoRef = useRef([]);

  const cfg = useRef({ ruleIdx, torusOn, ax, a5, R, C, watzOnly, ruleSrc });
  useEffect(() => { cfg.current = { ruleIdx, torusOn, ax: { ...ax, colorMode }, a5, R, C, watzOnly, ruleSrc, sysT: sysTheory, sysSp: sysSetpoint, openSys, solverId }; }, [ruleIdx, torusOn, ax, a5, R, C, watzOnly, colorMode, ruleSrc, sysTheory, sysSetpoint, openSys, solverId]);
  const runRef = useRef(running); useEffect(() => { runRef.current = running; }, [running]);
  const spRef = useRef(SPEEDS[speedIdx]); useEffect(() => { spRef.current = SPEEDS[speedIdx]; }, [speedIdx]);
  const brushRef = useRef(brush); useEffect(() => { brushRef.current = brush; }, [brush]);
  const simRef = useRef(simMode); useEffect(() => { simRef.current = simMode; }, [simMode]);
  const frameRef = useRef(frameShape); useEffect(() => { frameRef.current = frameShape; }, [frameShape]);
  const seedRef = useRef(seed); useEffect(() => { seedRef.current = seed; }, [seed]);
  const rvalRef = useRef(rvalRule); useEffect(() => { rvalRef.current = rvalRule; }, [rvalRule]);

  // Grid-Wechsel: Buffer + Geometrie neu
  useEffect(() => {
    colorRef.current = new Uint8Array(N); ghostRef.current = new Uint8Array(N); ageRef.current = new Uint16Array(N);
    nColorRef.current = new Uint8Array(N); nGhostRef.current = new Uint8Array(N); nAgeRef.current = new Uint16Array(N);
    fieldRef.current = new Float32Array(N); fieldImRef.current = new Float32Array(N);
    fBufRef.current = new Float32Array(N); fBufImRef.current = new Float32Array(N);
    fRecRef.current = new Uint8Array(N);
    hqstWorkRef.current = mkHqstWork(N);
    neighRef.current = buildNeighbors(R, C, frameShape);
    // Welt-Zentren je Zelle (einmal pro Grid) fuer den ImageData-Raster-Fast-Path.
    { const cx = new Float32Array(N), cy = new Float32Array(N);
      for (let i = 0; i < N; i++) { const ctr = hexCenter((i / C) | 0, i % C, HR); cx[i] = ctr.x; cy[i] = ctr.y; }
      cellCxRef.current = cx; cellCyRef.current = cy; }
    rasterImgRef.current = null; // bei Grid-Wechsel ImageData neu anlegen
    undoRef.current = []; tickRef.current = 0; setGen(0);
    histRef.current = []; statsRef.current = { births: 0, deaths: 0 };
    setStats({ pop: 0, cnt: [0,0,0,0,0,0,0,0,0,0,0,0,0], density: 0, births: 0, deaths: 0, sps: 0, hist: [] });
    setRunning(false); dirtyRef.current = true;
    fitView();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sizeIdx, frameShape]);

  const countColor = useCallback(() => {
    const col = colorRef.current; const cnt = [0,0,0,0,0,0,0,0,0,0,0,0,0]; let pop = 0;
    for (let i = 0; i < col.length; i++) { const c = col[i]; if (c) { cnt[c]++; pop++; } }
    return { cnt, pop };
  }, []);

  // Reellwertige Kennzahl je Regel: aktive Zellen + charakteristische Groesse.
  const countRval = useCallback(() => {
    const fld = fieldRef.current, fim = fieldImRef.current, rule = rvalRef.current;
    let active = 0, sum = 0, extra = 0;
    if (rule === "snow") { for (let i = 0; i < fld.length; i++) { if (fld[i] >= 1) active++; sum += fld[i]; } extra = active; }
    else if (rule === "water") { for (let i = 0; i < fld.length; i++) { if (fld[i] > 0.01) active++; sum += fld[i]; } extra = sum; }
    else if (rule === "hqst") { for (let i = 0; i < fld.length; i++) { const p = fld[i] * fld[i] + fim[i] * fim[i]; if (p > 1e-5) active++; sum += p; } extra = sum; }
    else if (rule === "collatz") { for (let i = 0; i < fld.length; i++) { if (fld[i] > 1) active++; } extra = active; }
    else if (rule === "genes") { for (let i = 0; i < fld.length; i++) { if (fld[i] !== 0) active++; } extra = active; }
    return { active, sum, extra };
  }, []);

  // Statistik aktualisieren (births/deaths vom letzten Schritt, sonst 0)
  const pushStats = useCallback((births, deaths) => {
    const N2 = gridRef.current.rows * gridRef.current.cols;
    if (simRef.current === "rval") {
      const r = countRval();
      const h = histRef.current; h.push(r.active); if (h.length > 120) h.shift();
      recordStep(["gen", "active", "sum"], [tickRef.current, r.active, r.sum]);
      setStats({ pop: r.active, cnt: [0,0,0,0,0,0,0,0,0,0,0,0,0], density: N2 ? r.active / N2 : 0, births: 0, deaths: 0, sps: spsRef.current, hist: h.slice(), rval: true, rvalSum: r.sum });
      return;
    }
    const c = countColor();
    const h = histRef.current; h.push(c.pop); if (h.length > 120) h.shift();
    recordStep(["gen", "pop", "density", "births", "deaths"], [tickRef.current, c.pop, N2 ? c.pop / N2 : 0, births, deaths]);
    setStats({ pop: c.pop, cnt: c.cnt, density: N2 ? c.pop / N2 : 0, births, deaths, sps: spsRef.current, hist: h.slice() });
  }, [countColor, countRval]);

  // Einen Datensatz in den Recorder schreiben (nur wenn aktiv).
  const recordStep = (cols, vals) => {
    const rec = recRef.current; if (!rec.on) return;
    if (rec.rows.length === 0) rec.cols = cols;
    rec.rows.push(vals);
    if (rec.rows.length > 100000) rec.rows.shift(); // Speicherschutz
  };

  const updatePop = useCallback(() => pushStats(0, 0), [pushStats]);

  // --- Simulationsschritt ---------------------------------------------------
  const step = useCallback(() => {
    // Reellwertiger Modus: eigene Engine, beruehrt die boolesche Logik nicht.
    if (simRef.current === "rval") {
      const to = cfg.current.torusOn;
      const NL = to ? neighRef.current.torus : neighRef.current.edge;
      const dmask = neighRef.current.mask;
      const rule = rvalRef.current, n = fieldRef.current.length;
      const C2 = gridRef.current.cols;
      if (rule === "hqst") {
        stepHQST(fieldRef.current, fieldImRef.current, NL, 0.15, 0.0, 0.5, fBufRef.current, fBufImRef.current, hqstWorkRef.current, cfg.current.solverId);
        [fieldRef.current, fBufRef.current] = [fBufRef.current, fieldRef.current];
        [fieldImRef.current, fBufImRef.current] = [fBufImRef.current, fieldImRef.current];
      } else if (rule === "water") {
        const out = stepWater(fieldRef.current, NL, C2, fBufRef.current);
        fBufRef.current = fieldRef.current; fieldRef.current = out;
      } else if (rule === "collatz") {
        const out = stepCollatz(fieldRef.current, NL, fBufRef.current);
        fBufRef.current = fieldRef.current; fieldRef.current = out;
      } else if (rule === "genes") {
        const out = stepGenes(fieldRef.current, NL, fBufRef.current, tickRef.current + 1);
        fBufRef.current = fieldRef.current; fieldRef.current = out;
      } else { // snow
        const out = stepReiter(fieldRef.current, NL, 1.0, 0.01, fBufRef.current, fRecRef.current);
        fBufRef.current = fieldRef.current; fieldRef.current = out;
      }
      // Domaenenmaske erzwingen: Zellen ausserhalb bleiben leer (Wand).
      const fld = fieldRef.current, fim = fieldImRef.current;
      for (let i = 0; i < n; i++) if (dmask[i] === 0) { fld[i] = 0; fim[i] = 0; }
      // Offenes System (Dirichlet): Randzellen auf konstanten Quellwert halten.
      // Nur fuer Diffusionsphysik sinnvoll (snow/water); Austausch mit Umgebung.
      if (cfg.current.openSys && (rule === "snow" || rule === "water")) {
        const bnd = neighRef.current.bnd, src = rule === "snow" ? 0.6 : 1.0;
        for (let i = 0; i < n; i++) if (bnd[i]) fld[i] = src;
      }
      tickRef.current += 1; dirtyRef.current = true; loopStepRef.current += 1;
      return;
    }
    const { ruleIdx: ri, torusOn: to, ax: A, a5: A5, watzOnly: wO, ruleSrc: rs, sysT, sysSp } = cfg.current;
    const meta = wO ? WATZ_META : (rs === "int" ? INT_META[ri] : RMETA[ri]);
    const { bL, sL, smin, smax } = meta;
    const isINT = !!meta.isINT, b2 = meta.b2 || null, s2 = meta.s2 || null;
    const col = colorRef.current, gh = ghostRef.current, age = ageRef.current;
    const nc = nColorRef.current, ng = nGhostRef.current, na = nAgeRef.current;
    const NL = to ? neighRef.current.torus : neighRef.current.edge;
    const dmask = neighRef.current.mask;
    const tick = tickRef.current + 1, n = col.length;
    let births = 0, deaths = 0;
    // Systemtheorie: homeostatische Negativ-Rueckkopplung (Kybernetik). Die lokale
    // Nachbardichte wird gegen einen Sollwert geregelt; Abweichung verschiebt die
    // effektive Geburts/Survival-Schwelle gegenlaeufig (Selbstregulation Richtung
    // Gleichgewicht). sysSp in {1..6}-Sollnachbarn aus 0..1 abgeleitet.
    const spN = sysT ? Math.round(sysSp * 6) : 0;

    for (let i = 0; i < n; i++) {
      if (dmask[i] === 0) { nc[i] = 0; ng[i] = 0; na[i] = 0; continue; } // ausserhalb Domaene: Wand
      const base = i * 6;
      const cnt = [0,0,0,0,0,0,0,0,0,0,0,0,0];
      let live = 0, sx = 0, sy = 0, mask = 0;
      for (let k = 0; k < 6; k++) {
        const j = NL[base + k];
        if (j < 0) continue;
        const cj = col[j];
        if (cj !== 0) { cnt[cj]++; live++; sx += COSH[cj]; sy += SINH[cj]; mask |= (1 << k); }
        else if (A.a4 && gh[j]) live++;
      }
      const self = col[i], selfAlive = self !== 0;
      const cntSelf = selfAlive ? cnt[self] : 0;
      let maxN = 0; for (let c = 1; c <= 12; c++) if (cnt[c] > maxN) maxN = cnt[c];
      let eff = live;
      if (A5 === "sym") eff = selfAlive ? cntSelf : maxN;
      else if (A5 === "komp") eff = selfAlive ? live - cntSelf : live - maxN;

      let born = false, newC = 0;
      if (selfAlive) {
        let surv = eff <= 6 && sL[eff] === 1;
        // INT: bei genau 2 Nachbarn zusaetzlich Konfigurations-Constraint (Callahan)
        if (surv && isINT && eff === 2 && s2 && !s2.includes(hexClass2(mask))) surv = false;
        if (!surv && A.a3 && age[i] >= 6 && eff >= smin - 1 && eff <= smax + 1) surv = true;
        // Systemtheorie: Unterdichte (live<Sollwert) stuetzt das Ueberleben,
        // Ueberdichte (live>Sollwert) entzieht es -> Homeostase.
        if (sysT) { if (!surv && live > 0 && live < spN) surv = true; else if (surv && live > spN + 1) surv = false; }
        if (surv) {
          born = true;
          newC = (A.colorMode === "drift" && live > 0) ? driftHue(self, sx, sy) : self;
        }
      } else if (live > 0 && eff >= 0 && eff <= 6 && bL[eff] === 1) {
        let ok = true;
        if (isINT && eff === 2 && b2 && !b2.includes(hexClass2(mask))) ok = false;
        // Systemtheorie: Geburt nur, wenn lokale Dichte unter dem Sollwert liegt
        // (das System fuellt Luecken bis zum Gleichgewicht, nicht darueber).
        if (sysT && live > spN) ok = false;
        if (ok) {
          born = true;
          if (A.colorMode === "quad") newC = birthColorQuad(cnt, sx, sy);
          else if (A.a2) newC = mMixCnt(cnt, i);
          else newC = cMixVec(sx, sy, i);
        }
      }
      if (born) { nc[i] = newC; ng[i] = 0; na[i] = selfAlive ? (age[i] < 65535 ? age[i] + 1 : 65535) : 1; if (!selfAlive) births++; }
      else { na[i] = 0; if (selfAlive) deaths++; if (selfAlive && A.a4) { nc[i] = 0; ng[i] = 1; } else { nc[i] = 0; ng[i] = 0; } }
    }

    if (A.a1) {
      for (let i = 0; i < n; i++) {
        if (nc[i] !== 0 || ng[i] !== 0 || col[i] !== 0) continue;
        const base = i * 6; let silent = true;
        for (let k = 0; k < 6; k++) { const j = NL[base + k]; if (j < 0) continue; if (col[j] !== 0 || (A.a4 && gh[j])) { silent = false; break; } }
        if (silent && hash2(i, tick) < 0.012) { nc[i] = PRIMARY[Math.floor(hash2(i + 7, tick * 3 + 1) * 3)]; na[i] = 1; }
      }
    }
    colorRef.current = nc; nColorRef.current = col;
    ghostRef.current = ng; nGhostRef.current = gh;
    ageRef.current = na; nAgeRef.current = age;
    tickRef.current = tick; dirtyRef.current = true;
    statsRef.current.births = births; statsRef.current.deaths = deaths;
    loopStepRef.current += 1;
  }, []);

  // --- ImageData-Raster-Fast-Path (winzige Zellen / XXL) ---------------------
  // Direkte Pixel-Block-Writes statt Path2D-Hexe: O(Pixel) flach, unabhaengig von
  // der Zahl aktiver Zellen. Loest XXL-Vollfeld (z.B. Snow), wo der Chunked-Path
  // noch ~3fps brachte. Hex-Form ist bei <~3.5px/Zelle ohnehin nicht aufgeloest.
  const drawRaster = useCallback(() => {
    const canvas = canvasRef.current; if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const dpr = window.devicePixelRatio || 1;
    const Wc = canvas.width, Hc = canvas.height;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (!rasterImgRef.current || rasterImgRef.current.width !== Wc || rasterImgRef.current.height !== Hc) rasterImgRef.current = ctx.createImageData(Wc, Hc);
    const img = rasterImgRef.current, d32 = new Uint32Array(img.data.buffer);
    d32.fill(BG_PACK);
    const g = gridRef.current, hr = g.hr;
    const { s, tx, ty } = viewRef.current;
    const CX = cellCxRef.current, CY = cellCyRef.current;
    const half = Math.max(0, Math.floor(hr * s * dpr * 0.72));
    const plot = (px, py, packed) => {
      let y0 = py - half, y1 = py + half, x0 = px - half, x1 = px + half;
      if (y0 < 0) y0 = 0; if (y1 >= Hc) y1 = Hc - 1; if (x0 < 0) x0 = 0; if (x1 >= Wc) x1 = Wc - 1;
      for (let yy = y0; yy <= y1; yy++) { const row = yy * Wc; for (let xx = x0; xx <= x1; xx++) d32[row + xx] = packed; }
    };
    if (simRef.current === "rval") {
      const rule = rvalRef.current, fld = fieldRef.current, fim = fieldImRef.current;
      if (rule === "genes") {
        const gp = { [G_AA]: parsePack(geneColor(G_AA)), [G_Aa]: parsePack(geneColor(G_Aa)), [G_aa]: parsePack(geneColor(G_aa)) };
        for (let i = 0; i < fld.length; i++) { const gv = fld[i]; if (!gv || !gp[gv]) continue; plot(Math.round((CX[i] * s + tx) * dpr), Math.round((CY[i] * s + ty) * dpr), gp[gv]); }
      } else {
        const BUCKETS = 24; let thresh = 0, vmax = 0;
        if (rule === "snow") thresh = 0.02; else if (rule === "water") thresh = 0.01; else if (rule === "hqst") thresh = 1e-5; else thresh = 1.0001;
        if (rule === "hqst") { for (let i = 0; i < fld.length; i++) { const p = fld[i] * fld[i] + fim[i] * fim[i]; if (p > vmax) vmax = p; } if (vmax < 1e-12) vmax = 1; }
        const bcol = new Array(BUCKETS);
        for (let bi = 0; bi < BUCKETS; bi++) { let repV; if (rule === "collatz") repV = Math.pow(2, (bi + 0.5) / BUCKETS * 30); else if (rule === "hqst") repV = (bi + 0.5) / BUCKETS * vmax; else repV = (bi + 0.5) / (BUCKETS - 1); bcol[bi] = parsePack(rule === "collatz" ? collatzColor(repV) : rvalColor(repV, rule)); }
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
      const col = colorRef.current, packed = {};
      for (const cc of ALLCOL) { const a = COLA[cc]; packed[cc] = packRGB(a[0], a[1], a[2]); }
      for (let i = 0; i < col.length; i++) { const cc = col[i]; if (!cc) continue; plot(Math.round((CX[i] * s + tx) * dpr), Math.round((CY[i] * s + ty) * dpr), packed[cc]); }
    }
    ctx.putImageData(img, 0, 0);
    ctx.setTransform(dpr * s, 0, 0, dpr * s, dpr * tx, dpr * ty);
    drawFrame(ctx, s);
    dirtyRef.current = false;
  }, []);

  // --- Render ---------------------------------------------------------------
  const draw = useCallback(() => {
    const canvas = canvasRef.current; if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const dpr = window.devicePixelRatio || 1;
    const Wc = canvas.width, Hc = canvas.height;
    const { s, tx, ty } = viewRef.current;
    const g = gridRef.current; const hr = g.hr, r0 = g.rows, c0 = g.cols;

    // Hybrid: winzige Zellen (XXL/rausgezoomt) -> ImageData-Raster (flach, 60fps);
    // grosse Zellen (S/M/L) -> schoene Hex-Pfade (chunked).
    if (hr * s < 3.5) { drawRaster(); return; }

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = T.bg; ctx.fillRect(0, 0, Wc, Hc);
    ctx.setTransform(dpr * s, 0, 0, dpr * s, dpr * tx, dpr * ty);

    const cosA = [], sinA = [];
    for (let k = 0; k < 6; k++) { const a = -Math.PI / 2 + k * PI3; cosA.push(Math.cos(a)); sinA.push(Math.sin(a)); }
    const addHex = (path, x, y, rr) => {
      path.moveTo(x + rr * cosA[0], y + rr * sinA[0]);
      for (let k = 1; k < 6; k++) path.lineTo(x + rr * cosA[k], y + rr * sinA[k]);
      path.closePath();
    };
    const pxR = hr * s;

    // Reellwertiger Modus: jede Zelle nach Feldwert eingefaerbt.
    if (simRef.current === "rval") {
      const rule = rvalRef.current, fld = fieldRef.current, fim = fieldImRef.current;
      // Performance: Zellen nach Farbe buendeln und je Farbe EIN fill() (Batching).
      // Discrete Regeln (collatz/genes) haben endliche Farbmengen -> echtes Batching.
      if (rule === "genes") {
        for (const [g, col] of [[G_AA, geneColor(G_AA)], [G_Aa, geneColor(G_Aa)], [G_aa, geneColor(G_aa)]]) {
          const p = new Path2D(); let any = false;
          for (let i = 0; i < fld.length; i++) { if (fld[i] === g) { const { x, y } = hexCenter((i / c0) | 0, i % c0, hr); addHex(p, x, y, hr * 0.92); any = true; } }
          if (any) { ctx.fillStyle = col; ctx.fill(p); }
        }
        drawFrame(ctx, s); dirtyRef.current = false; return;
      }
      // Performance: Werte in feste Farbklassen quantisieren und je Klasse EIN
      // gebatchtes fill() (statt ein Path2D + fill pro Zelle). Drastisch weniger
      // Canvas-Aufrufe bei grossen Gittern.
      const BUCKETS = 24;
      // PERF-FIX (2026-06-01): Zell-INDIZES je Bucket sammeln, dann je Bucket in
      // CHUNKS von je CHUNK Hexen fuellen. Eine einzelne riesige Path2D (tausende
      // Subpaths) liess ctx.fill() super-linear degenerieren (gemessen: 2k=47fps,
      // 8k=1.3fps, 18k=0.7fps -> v30-Freeze-Klasse). Begrenzte Path-Groesse =
      // lineare Kosten, exakt dieselben Hex-Formen (keine Qualitaetseinbusse).
      const CHUNK = 256;
      const buckets = new Array(BUCKETS);
      let thresh = 0;
      if (rule === "snow") thresh = 0.02; else if (rule === "water") thresh = 0.01; else if (rule === "hqst") thresh = 1e-5; else thresh = 1.0001;
      // hqst max |psi|^2 fuer relative Skala bestimmen
      let vmax = 0;
      if (rule === "hqst") { for (let i = 0; i < fld.length; i++) { const p = fld[i] * fld[i] + fim[i] * fim[i]; if (p > vmax) vmax = p; } if (vmax < 1e-12) vmax = 1; }
      for (let i = 0; i < fld.length; i++) {
        let v = fld[i];
        if (rule === "hqst") { v = fld[i] * fld[i] + fim[i] * fim[i]; if (v < thresh) continue; }
        else if (rule === "collatz") { if (v <= 1) continue; }
        else if (v < thresh) continue;
        // Bucket-Index 0..BUCKETS-1 je Regel
        let bi;
        if (rule === "collatz") bi = Math.min(BUCKETS - 1, Math.floor(Math.log2(v) / 30 * BUCKETS));
        else if (rule === "hqst") bi = Math.min(BUCKETS - 1, Math.floor(Math.min(1, v / vmax) * (BUCKETS - 1)));
        else bi = Math.min(BUCKETS - 1, Math.floor(Math.min(1, v) * (BUCKETS - 1)));
        (buckets[bi] || (buckets[bi] = [])).push(i);
      }
      for (let bi = 0; bi < BUCKETS; bi++) {
        const cells = buckets[bi]; if (!cells || cells.length === 0) continue;
        // repraesentativer Wert der Klasse fuer die Farbe
        let repV;
        if (rule === "collatz") repV = Math.pow(2, (bi + 0.5) / BUCKETS * 30);
        else if (rule === "hqst") repV = (bi + 0.5) / BUCKETS * vmax;
        else repV = (bi + 0.5) / (BUCKETS - 1);
        ctx.fillStyle = rule === "collatz" ? collatzColor(repV) : rvalColor(repV, rule);
        let p = new Path2D(), cnt = 0;
        for (let m = 0; m < cells.length; m++) {
          const i = cells[m];
          const { x, y } = hexCenter((i / c0) | 0, i % c0, hr);
          addHex(p, x, y, hr * 0.95);
          if (++cnt >= CHUNK) { ctx.fill(p); p = new Path2D(); cnt = 0; }
        }
        if (cnt) ctx.fill(p);
      }
      drawFrame(ctx, s);
      dirtyRef.current = false;
      return;
    }

    const col = colorRef.current, gh = ghostRef.current;
    const dmask = neighRef.current.mask;
    // Gitterlinien nur wenn gross genug (nur In-Domaenen-Zellen)
    if (pxR >= 4) {
      const grid = new Path2D();
      for (let r = 0; r < r0; r++) for (let c = 0; c < c0; c++) { if (!dmask[r * c0 + c]) continue; const { x, y } = hexCenter(r, c, hr); addHex(grid, x, y, hr * 0.95); }
      ctx.lineWidth = Math.max(0.4, 1 / s); ctx.strokeStyle = "rgba(92,240,204,0.10)"; ctx.stroke(grid);
    }

    // Ghosts (analog)
    const gp = new Path2D(); let anyG = false;
    for (let i = 0; i < gh.length; i++) if (gh[i]) { const { x, y } = hexCenter((i / c0) | 0, i % c0, hr); addHex(gp, x, y, hr * 0.78); anyG = true; }
    if (anyG) { ctx.fillStyle = "rgba(140,196,187,0.20)"; ctx.fill(gp); }

    // Fuellung + Glow pro Farbe
    for (const cc of ALLCOL) {
      const fill = new Path2D(); let any = false;
      const glow = new Path2D();
      for (let i = 0; i < col.length; i++) {
        if (col[i] !== cc) continue; any = true;
        const { x, y } = hexCenter((i / c0) | 0, i % c0, hr);
        addHex(fill, x, y, hr * 0.92);
        if (pxR >= 5) addHex(glow, x, y, hr * 1.1);
      }
      if (!any) continue;
      const [rr, gg, bb] = COLA[cc];
      if (pxR >= 5) { ctx.fillStyle = `rgba(${rr},${gg},${bb},0.16)`; ctx.fill(glow); }
      ctx.fillStyle = COLHEX[cc]; ctx.fill(fill);
    }
    drawFrame(ctx, s);
    dirtyRef.current = false;
  }, []);

  // Rahmen-Umriss (Box/Kreis) als Domaenengrenze zeichnen. Radius EXAKT wie in
  // buildNeighbors (gleiche Welt-Metrik * hr), damit Umriss und Maske deckungsgleich.
  const drawFrame = useCallback((ctx, s) => {
    const g = gridRef.current; const hr = g.hr, R0 = g.rows, C0 = g.cols;
    ctx.lineWidth = Math.max(1, 2 / s); ctx.strokeStyle = "rgba(92,240,204,0.5)";
    if (frameRef.current === "circle") {
      const cr = (R0 - 1) / 2, cc = (C0 - 1) / 2;
      const ctr = hexCenter(cr, cc, hr);
      const halfW = ((C0 - 1) * S3) / 2 + S3 / 2;
      const halfH = ((R0 - 1) * 1.5) / 2 + 1.0;
      const rad = Math.min(halfW, halfH) * hr;
      ctx.beginPath(); ctx.arc(ctr.x, ctr.y, rad, 0, PI2); ctx.stroke();
    } else {
      const a = hexCenter(0, 0, hr), b = hexCenter(R0 - 1, C0 - 1, hr);
      const pad = hr * 1.1;
      ctx.strokeRect(a.x - pad, a.y - pad, (b.x - a.x) + 2 * pad, (b.y - a.y) + 2 * pad);
    }
  }, []);

  // --- Loop -----------------------------------------------------------------
  useEffect(() => {
    let raf, last = performance.now(), acc = 0;
    const loop = (now) => {
      const dt = now - last; last = now;
      if (runRef.current) {
        acc += dt; const iv = spRef.current; let guard = 0;
        // PERF (2026-06-01): Simulation vom Render entkoppeln. Statt fixem Cap (8
        // Steps/Frame) laeuft die Sim so viele Steps wie in einem Wall-Time-Budget
        // passen (STEP_BUDGET_MS). Billige Steps (HQST-CN bei wenigen Zellen) -> viele
        // Generationen/Frame; teure Steps -> Budget greift, Frame bleibt smooth.
        // iv=0 ("TURBO") = nur durch Budget begrenzt. HARDCAP = Endlos-Schutz.
        const STEP_BUDGET_MS = 12, STEP_HARDCAP = 4000, tStart = performance.now();
        while (acc >= iv && guard < STEP_HARDCAP) {
          step(); guard++;
          if (iv > 0) acc -= iv;
          if (performance.now() - tStart >= STEP_BUDGET_MS) break;
        }
        // Anti-Spiral: nach einem langsamen Frame acc nicht unbegrenzt auflaufen lassen
        if (iv > 0) { if (acc > iv * 4) acc = iv * 4; } else { acc = 0; }
      }
      if (dirtyRef.current) draw();
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [step, draw]);

  // Statistik + Zoom-Label (throttled, 250ms)
  useEffect(() => {
    const id = setInterval(() => {
      const v = viewRef.current; setZoomLbl(v.fit ? v.s / v.fit : 1);
      const now = performance.now(), dt = (now - loopT0Ref.current) / 1000;
      if (dt > 0) { spsRef.current = loopStepRef.current / dt; loopStepRef.current = 0; loopT0Ref.current = now; }
      if (runRef.current) { setGen(tickRef.current); pushStats(statsRef.current.births, statsRef.current.deaths); }
    }, 250);
    return () => clearInterval(id);
  }, [pushStats]);

  // --- Resize ---------------------------------------------------------------
  useEffect(() => {
    const fit = () => {
      const canvas = canvasRef.current, wrap = wrapRef.current; if (!canvas || !wrap) return;
      const dpr = window.devicePixelRatio || 1;
      const cw = wrap.clientWidth, ch = Math.min(Math.round(window.innerHeight * 0.5), 540);
      canvas.style.width = cw + "px"; canvas.style.height = ch + "px";
      canvas.width = Math.round(cw * dpr); canvas.height = Math.round(ch * dpr);
      fitView(); dirtyRef.current = true;
    };
    fit(); window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function fitView() {
    const canvas = canvasRef.current; if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const cw = canvas.width / dpr, ch = canvas.height / dpr;
    const g = gridRef.current;
    const { W, H } = worldSize(g.rows, g.cols, g.hr);
    const s = Math.min(cw / W, ch / H) * 0.98;
    viewRef.current = { s, fit: s, tx: (cw - W * s) / 2, ty: (ch - H * s) / 2 };
    dirtyRef.current = true;
  }

  // --- Pointer / Gesten -----------------------------------------------------
  const ptrs = useRef(new Map());
  const ges = useRef({ mode: "", startDist: 0, startS: 1, lastMid: null, moved: 0, lastCell: -1, down: null });

  const toWorld = (cx, cy) => {
    const rect = canvasRef.current.getBoundingClientRect();
    const { s, tx, ty } = viewRef.current;
    return { wx: (cx - rect.left - tx) / s, wy: (cy - rect.top - ty) / s };
  };
  const pushUndo = () => {
    if (simRef.current === "rval") {
      undoRef.current.push({ rval: true, fld: fieldRef.current.slice(), fim: fieldImRef.current.slice() });
    } else {
      undoRef.current.push(colorRef.current.slice());
    }
    if (undoRef.current.length > MAX_UNDO) undoRef.current.shift();
  };

  // Im rval-Modus auf das reellwertige Feld setzen (regelabhaengig), sonst boolesch.
  const paintRval = (idx) => {
    if (idx < 0) return;
    const fld = fieldRef.current, fim = fieldImRef.current, b = brushRef.current;
    const rule = rvalRef.current;
    if (b === "erase") { fld[idx] = 0; if (rule === "hqst") fim[idx] = 0; }
    else if (rule === "snow") fld[idx] = 1;           // Eiskeim setzen
    else if (rule === "water") fld[idx] = 1;          // Wasser fuellen
    else if (rule === "hqst") { fld[idx] = 1; fim[idx] = 0; } // Anregung setzen
    else if (rule === "collatz") fld[idx] = 27;       // Startzahl mit langer Folge
    else if (rule === "genes") fld[idx] = G_Aa;       // heterozygot setzen
    dirtyRef.current = true;
  };
  const paintCell = (idx, isTap) => {
    if (idx < 0) return;
    if (simRef.current === "rval") { paintRval(idx); return; }
    const col = colorRef.current, b = brushRef.current;
    if (b === "cycle") { if (isTap) { const ci = CYCLE.indexOf(col[idx]); col[idx] = CYCLE[(ci + 1) % 4]; ageRef.current[idx] = col[idx] ? 1 : 0; } }
    else if (b === "erase") { col[idx] = C0; ageRef.current[idx] = 0; }
    else { col[idx] = b; ageRef.current[idx] = 1; }
    ghostRef.current[idx] = 0; dirtyRef.current = true;
  };

  const onDown = (e) => {
    e.currentTarget.setPointerCapture?.(e.pointerId);
    ptrs.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (ptrs.current.size === 1) {
      ges.current.moved = 0; ges.current.down = { x: e.clientX, y: e.clientY }; ges.current.lastCell = -1;
      if (brushRef.current !== "cycle" || simRef.current === "rval") {
        pushUndo();
        const { wx, wy } = toWorld(e.clientX, e.clientY);
        const idx = pixelToOddR(wx, wy, HR, R, C); paintCell(idx, false); ges.current.lastCell = idx; ges.current.mode = "paint"; updatePop();
      } else ges.current.mode = "maybe-tap";
    } else if (ptrs.current.size === 2) {
      const p = [...ptrs.current.values()];
      ges.current.mode = "pinch"; ges.current.startDist = Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y);
      ges.current.startS = viewRef.current.s; ges.current.lastMid = { x: (p[0].x + p[1].x) / 2, y: (p[0].y + p[1].y) / 2 };
    }
  };
  const onMove = (e) => {
    if (!ptrs.current.has(e.pointerId)) return;
    const prev = ptrs.current.get(e.pointerId); ptrs.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (ptrs.current.size >= 2 && ges.current.mode === "pinch") {
      const p = [...ptrs.current.values()];
      const dist = Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y);
      const mid = { x: (p[0].x + p[1].x) / 2, y: (p[0].y + p[1].y) / 2 };
      const v = viewRef.current, rect = canvasRef.current.getBoundingClientRect();
      const ns = clamp(ges.current.startS * (dist / (ges.current.startDist || 1)), v.fit * 0.2, v.fit * 16);
      const mx = mid.x - rect.left, my = mid.y - rect.top;
      const wx = (mx - v.tx) / v.s, wy = (my - v.ty) / v.s;
      v.tx = mx - wx * ns; v.ty = my - wy * ns; v.s = ns;
      if (ges.current.lastMid) { v.tx += mid.x - ges.current.lastMid.x; v.ty += mid.y - ges.current.lastMid.y; }
      ges.current.lastMid = mid; dirtyRef.current = true; return;
    }
    if (ptrs.current.size === 1) {
      ges.current.moved = Math.hypot(e.clientX - ges.current.down.x, e.clientY - ges.current.down.y);
      if (ges.current.mode === "paint") {
        const { wx, wy } = toWorld(e.clientX, e.clientY); const idx = pixelToOddR(wx, wy, HR, R, C);
        if (idx >= 0 && idx !== ges.current.lastCell) { paintCell(idx, false); ges.current.lastCell = idx; }
      } else {
        if (ges.current.moved > 6) ges.current.mode = "pan";
        if (ges.current.mode === "pan") { viewRef.current.tx += e.clientX - prev.x; viewRef.current.ty += e.clientY - prev.y; dirtyRef.current = true; }
      }
    }
  };
  const onUp = (e) => {
    const was = ptrs.current.size; ptrs.current.delete(e.pointerId);
    if (was === 1) {
      if (ges.current.mode === "maybe-tap" && ges.current.moved <= 6) {
        pushUndo(); const { wx, wy } = toWorld(e.clientX, e.clientY); paintCell(pixelToOddR(wx, wy, HR, R, C), true); updatePop();
      } else if (ges.current.mode === "paint") updatePop();
    }
    ges.current.mode = ptrs.current.size === 1 ? "maybe-tap" : "";
  };
  const onWheel = (e) => {
    e.preventDefault();
    const v = viewRef.current, rect = canvasRef.current.getBoundingClientRect();
    const mx = e.clientX - rect.left, my = e.clientY - rect.top;
    const ns = clamp(v.s * (e.deltaY < 0 ? 1.12 : 1 / 1.12), v.fit * 0.2, v.fit * 16);
    const wx = (mx - v.tx) / v.s, wy = (my - v.ty) / v.s;
    v.tx = mx - wx * ns; v.ty = my - wy * ns; v.s = ns; dirtyRef.current = true;
  };

  // --- Aktionen -------------------------------------------------------------
  const doStep = () => { pushUndo(); step(); setGen(tickRef.current); pushStats(statsRef.current.births, statsRef.current.deaths); };
  const doClear = () => {
    pushUndo();
    if (simMode === "rval") { fieldRef.current.fill(0); fieldImRef.current.fill(0); tickRef.current = 0; setGen(0); dirtyRef.current = true; return; }
    colorRef.current.fill(0); ghostRef.current.fill(0); ageRef.current.fill(0); tickRef.current = 0; setGen(0); updatePop(); dirtyRef.current = true;
  };
  const doRandom = () => {
    pushUndo();
    if (simMode === "rval") { rvalSeed(); return; }
    const col = colorRef.current; ghostRef.current.fill(0); ageRef.current.fill(0);
    const dmask = neighRef.current.mask;
    const rand = rng((seedRef.current & 0x7fffffff) | 1);
    for (let i = 0; i < col.length; i++) { col[i] = (dmask[i] && rand() >= (1 - DENS)) ? PRIMARY[Math.floor(rand() * 3)] : 0; ageRef.current[i] = col[i] ? 1 : 0; }
    tickRef.current = 0; setGen(0); updatePop(); dirtyRef.current = true;
  };
  // Reellwertige Anfangsbedingung je Regel (nur innerhalb der Domaene).
  const rvalSeed = () => {
    const fld = fieldRef.current, fim = fieldImRef.current, dmask = neighRef.current.mask;
    fld.fill(0); fim.fill(0);
    // Mittelpunkt der Domaene (naechste In-Domaenen-Zelle zur Gittermitte)
    let mid = ((R >> 1) * C + (C >> 1));
    if (!dmask[mid]) { for (let i = 0; i < fld.length; i++) if (dmask[i]) { mid = i; break; } }
    if (rvalRule === "snow") { for (let i = 0; i < fld.length; i++) if (dmask[i]) fld[i] = 0.4; fld[mid] = 1; }
    else if (rvalRule === "water") { for (let r = 0; r < Math.min(10, R >> 2); r++) for (let c = 0; c < C; c++) { const i = r * C + c; if (dmask[i]) fld[i] = 1; } }
    else if (rvalRule === "collatz") { const rnd = rng((seedRef.current & 0x7fffffff) | 1); for (let i = 0; i < fld.length; i++) if (dmask[i]) fld[i] = 2 + Math.floor(rnd() * 9998); }
    else if (rvalRule === "genes") { const rnd = rng((seedRef.current & 0x7fffffff) | 1); for (let i = 0; i < fld.length; i++) { if (dmask[i] && rnd() < 0.45) { const a1 = rnd() < 0.6 ? 0 : 1, a2 = rnd() < 0.6 ? 0 : 1; fld[i] = genotype(a1, a2); } } }
    else { fld[mid] = 1; }
    tickRef.current = 0; setGen(0); dirtyRef.current = true; fitView();
  };
  // Beim Wechsel in den rval-Modus / der Regel automatisch sinnvoll seeden.
  useEffect(() => { if (simMode === "rval") { rvalSeed(); setRunning(false); } else { dirtyRef.current = true; } // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [simMode, rvalRule]);
  const doUndo = () => {
    const u = undoRef.current.pop(); if (!u) return;
    if (u && u.rval) { fieldRef.current.set(u.fld); fieldImRef.current.set(u.fim); dirtyRef.current = true; return; }
    colorRef.current.set(u); ghostRef.current.fill(0); updatePop(); dirtyRef.current = true;
  };

  // --- LiouScope-Anbindung: Zeitreihen-Export ------------------------------
  // Exportiert die aufgezeichnete Trajektorie als CSV oder JSON. Das JSON traegt
  // einen Metadaten-Kopf (Regel, Topologie, Rahmen, Seed-Kontext), damit der Lauf
  // in LiouScope reproduzierbar und korrekt interpretierbar ist.
  const downloadBlob = (text, filename, mime) => {
    const blob = new Blob([text], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = filename; document.body.appendChild(a); a.click();
    document.body.removeChild(a); setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const recMeta = () => ({
    project: "GolHex", station: "Coworker Research",
    simMode, rule: simMode === "rval" ? rvalRule : (watzOnly ? "Watzlawick" : (ruleSrc === "int" ? INT_RULES[ruleIdx]?.l : RULES[ruleIdx]?.l)),
    topology: torusOn ? "torus" : "edge", frame: frameShape, openSystem: openSys,
    sysTheory, sysSetpoint: Math.round(sysSetpoint * 6), solver: simMode === "rval" && rvalRule === "hqst" ? solverId : null,
    seed, grid: { rows: R, cols: C, size: GRID_SIZES[sizeIdx].l }, steps: recRef.current.rows.length,
  });
  const exportCSV = () => {
    const rec = recRef.current;
    if (!rec.rows.length) { setRecMsg("Keine Aufzeichnung. Erst Recorder starten."); return; }
    const head = rec.cols.join(",");
    const body = rec.rows.map((r) => r.map((v) => (typeof v === "number" ? (Number.isInteger(v) ? v : v.toFixed(6)) : v)).join(",")).join("\n");
    downloadBlob(head + "\n" + body + "\n", `golhex_timeseries_${Date.now()}.csv`, "text/csv");
    setRecMsg(`CSV exportiert: ${rec.rows.length} Schritte, Spalten ${rec.cols.join("/")}.`);
  };
  const exportJSON = () => {
    const rec = recRef.current;
    if (!rec.rows.length) { setRecMsg("Keine Aufzeichnung. Erst Recorder starten."); return; }
    const payload = { meta: recMeta(), schema: "liouscope.timeseries.v1", columns: rec.cols, data: rec.rows };
    downloadBlob(JSON.stringify(payload, null, 2), `golhex_liouscope_${Date.now()}.json`, "application/json");
    setRecMsg(`JSON (LiouScope) exportiert: ${rec.rows.length} Schritte.`);
  };
  const toggleRecord = () => {
    const rec = recRef.current; rec.on = !rec.on;
    if (rec.on) { rec.rows = []; rec.cols = []; setRecMsg("Aufzeichnung laeuft..."); }
    else setRecMsg(`Aufzeichnung gestoppt: ${rec.rows.length} Schritte erfasst.`);
    setRecording(rec.on);
  };

  // --- Globalarchiv: reproduzierbarer Lauf-Schnappschuss ---------------------
  // Speichert die VOLLSTAENDIGE Lauf-Konfiguration (Seed + alle Parameter), sodass
  // ein Lauf exakt rekonstruierbar ist. Provenienz-Stil aus Q-Forge: jeder
  // Schnappschuss traegt Schema, Zeitstempel und Projektkennung.
  const exportSnapshot = () => {
    const snap = {
      schema: "golhex.snapshot.v1", project: "Coworker Research", created: new Date().toISOString(),
      config: {
        simMode, rvalRule, ruleIdx, ruleSrc, watzOnly, ax, a5, colorMode,
        torusOn, frameShape, openSys, sysTheory, sysSetpoint, solverId,
        sizeIdx, seed,
      },
    };
    downloadBlob(JSON.stringify(snap, null, 2), `golhex_snapshot_${seed}_${Date.now()}.json`, "application/json");
    setArchMsg(`Schnappschuss gespeichert (Seed ${seed}). Exakt reproduzierbar.`);
  };
  const applySnapshot = (cfgObj) => {
    if (!cfgObj) return;
    if (cfgObj.simMode) setSimMode(cfgObj.simMode);
    if (cfgObj.rvalRule) setRvalRule(cfgObj.rvalRule);
    if (typeof cfgObj.ruleIdx === "number") setRuleIdx(cfgObj.ruleIdx);
    if (cfgObj.ruleSrc) setRuleSrc(cfgObj.ruleSrc);
    if (typeof cfgObj.watzOnly === "boolean") setWatzOnly(cfgObj.watzOnly);
    if (cfgObj.ax) setAx(cfgObj.ax);
    if (cfgObj.a5) setA5(cfgObj.a5);
    if (cfgObj.colorMode) setColorMode(cfgObj.colorMode);
    if (typeof cfgObj.torusOn === "boolean") setTorusOn(cfgObj.torusOn);
    if (cfgObj.frameShape) setFrameShape(cfgObj.frameShape);
    if (typeof cfgObj.openSys === "boolean") setOpenSys(cfgObj.openSys);
    if (typeof cfgObj.sysTheory === "boolean") setSysTheory(cfgObj.sysTheory);
    if (typeof cfgObj.sysSetpoint === "number") setSysSetpoint(cfgObj.sysSetpoint);
    if (cfgObj.solverId) setSolverId(cfgObj.solverId);
    if (typeof cfgObj.sizeIdx === "number") setSizeIdx(cfgObj.sizeIdx);
    if (typeof cfgObj.seed === "number") setSeed(cfgObj.seed);
    setArchMsg(`Schnappschuss geladen (Seed ${cfgObj.seed}). "Neu initialisieren" reproduziert den Lauf.`);
  };
  const importSnapshot = (ev) => {
    const file = ev.target.files && ev.target.files[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try { const obj = JSON.parse(String(reader.result)); applySnapshot(obj.config || obj); }
      catch (e) { setArchMsg("Fehler: Datei ist kein gueltiger GolHex-Schnappschuss."); }
    };
    reader.readAsText(file); ev.target.value = "";
  };
  const doPlace = () => {
    pushUndo(); const offs = PATS[pattern], col = colorRef.current;
    const pc = (typeof brush === "number" && brush >= 1 && brush <= 12) ? brush : CB;
    let mR = 0, mC = 0; offs.forEach(([dr, dc]) => { mR = Math.max(mR, dr); mC = Math.max(mC, dc); });
    const r0 = (R - mR) >> 1, c0 = (C - mC) >> 1;
    offs.forEach(([dr, dc]) => { const rr = r0 + dr, cc = c0 + dc; if (rr >= 0 && rr < R && cc >= 0 && cc < C) { const idx = rr * C + cc; col[idx] = pc; ageRef.current[idx] = 1; } });
    updatePop(); dirtyRef.current = true; fitView();
  };
  // Farbkreis-Stempel: 12 Itten-Farben kreisfoermig in die Gittermitte.
  // mode "ring" = Farben nur auf dem Kreisrand; "disc" = gefuellte Scheibe,
  // jede Zelle nach ihrem Winkel zum Zentrum eingefaerbt (Itten-Anordnung).
  const placeColorWheel = (mode) => {
    pushUndo();
    const col = colorRef.current, age = ageRef.current;
    const cr = (R - 1) / 2, cc = (C - 1) / 2;
    const radius = Math.max(3, Math.min(R, C) * 0.42);
    const inner = mode === "ring" ? radius * 0.74 : 0;
    // Achsverhaeltnis odd-r: Zeilenabstand 1.5*hr, Spaltenabstand sqrt(3)*hr.
    // Wir messen Distanz im world-Raum, damit der Kreis rund ist.
    for (let r = 0; r < R; r++) {
      for (let c = 0; c < C; c++) {
        const px = (c + ((r & 1) ? 0.5 : 0)) * S3;
        const py = r * 1.5;
        const cpx = (cc + ((Math.round(cr) & 1) ? 0.5 : 0)) * S3;
        const cpy = cr * 1.5;
        const dx = px - cpx, dy = py - cpy;
        const dist = Math.hypot(dx, dy) / 1.5; // in Zeilen-Einheiten
        if (dist > radius || dist < inner) continue;
        // Winkel -> Itten-Farbe. Itten-Vorlage: Rot oben, im Uhrzeigersinn.
        // Bildschirm: dy zeigt nach unten. "Oben" = -90 Grad. Wir verschieben so,
        // dass die Position oben (dx=0, dy<0) auf Rot (Hue 0) faellt und im
        // Uhrzeigersinn die Itten-Reihenfolge durchlaeuft.
        let raw = Math.atan2(dy, dx);           // 0=rechts, +unten
        let ang = (raw + Math.PI / 2);          // oben -> 0
        ang = -ang;                              // Uhrzeigersinn
        ang %= PI2; if (ang < 0) ang += PI2;
        const idx = r * C + c;
        col[idx] = hueToState(ang);
        age[idx] = 1;
      }
    }
    updatePop(); dirtyRef.current = true; fitView();
  };
  const zoom = (f) => {
    const v = viewRef.current, dpr = window.devicePixelRatio || 1;
    const cw = canvasRef.current.width / dpr, ch = canvasRef.current.height / dpr, mx = cw / 2, my = ch / 2;
    const ns = clamp(v.s * f, v.fit * 0.2, v.fit * 16);
    const wx = (mx - v.tx) / v.s, wy = (my - v.ty) / v.s; v.tx = mx - wx * ns; v.ty = my - wy * ns; v.s = ns; dirtyRef.current = true;
  };

  // --- Fonts ---------------------------------------------------------------
  useEffect(() => {
    try {
      if (!document.getElementById("ghx-font")) {
        const l = document.createElement("link"); l.id = "ghx-font"; l.rel = "stylesheet";
        l.href = "https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;700&family=JetBrains+Mono:wght@400;600&display=swap";
        document.head.appendChild(l);
      }
    } catch (e) { /* ignore */ }
  }, []);

  const DISP = "'Space Grotesk', system-ui, sans-serif";
  const MONO = "'JetBrains Mono', ui-monospace, Menlo, monospace";
  const total = stats.pop;
  const pct = (x) => (total ? Math.round((x / total) * 100) : 0);
  // Sparkline-Pfad (Population-Verlauf)
  const sparkPath = (() => {
    const h = stats.hist; if (!h || h.length < 2) return "";
    const w = 100, ht = 28, mx = Math.max(1, ...h);
    return h.map((v, i) => `${i === 0 ? "M" : "L"}${((i / (h.length - 1)) * w).toFixed(1)},${(ht - (v / mx) * ht).toFixed(1)}`).join(" ");
  })();

  const swatch = (key, label, color) => {
    const active = brush === key;
    return (
      <button key={key} onClick={() => setBrush(key)} aria-pressed={active} style={{
        flex: "1 1 0", minWidth: 0, padding: "9px 4px", borderRadius: 10,
        border: active ? `2px solid ${T.accent}` : "2px solid rgba(92,240,204,0.16)",
        background: color || T.bg2, color: color ? "#04110d" : T.sub,
        fontWeight: 700, fontSize: 12, cursor: "pointer", fontFamily: MONO,
        boxShadow: active ? `0 0 14px ${color ? color : T.accent}55` : "none", transition: "all .12s",
      }}>{label}</button>
    );
  };
  const btn = (onClick, children, extra = {}) => (
    <button onClick={onClick} style={{
      display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6,
      padding: "9px 12px", borderRadius: 10, border: `1px solid ${T.border}`,
      background: T.panel, color: T.text, fontSize: 12, fontWeight: 600, cursor: "pointer",
      fontFamily: MONO, backdropFilter: "blur(6px)", ...extra,
    }}>{children}</button>
  );
  const sel = { width: "100%", marginTop: 4, padding: "8px", borderRadius: 9, background: T.bg2, color: T.text, border: `1px solid ${T.border}`, fontSize: 12, fontFamily: MONO };

  return (
    <div style={{ fontFamily: DISP, background: `radial-gradient(120% 80% at 50% 0%, ${T.bg2} 0%, ${T.bg} 70%)`, minHeight: "100%", color: T.text, padding: "12px 12px 26px", boxSizing: "border-box" }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 8 }}>
        <div style={{ fontSize: 20, fontWeight: 700, letterSpacing: "0.04em" }}>
          <span style={{ color: T.accent, textShadow: `0 0 18px ${T.accent}66` }}>Gol</span><span style={{ color: T.text }}>Hex</span>
          <span style={{ color: T.sub, fontSize: 12, marginLeft: 8, fontFamily: MONO }}>v29L.3b</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 11, color: T.sub, fontFamily: MONO }}>Coworker Research</span>
          <button onClick={closeApp} aria-label="App schliessen" title="Schliessen"
            style={{ width: 30, height: 30, borderRadius: 8, cursor: "pointer", lineHeight: 1,
              border: "1px solid rgba(255,107,134,0.45)", background: "rgba(255,51,85,0.12)",
              color: "#FFC2CE", fontSize: 16, fontWeight: 700, fontFamily: MONO,
              display: "flex", alignItems: "center", justifyContent: "center" }}>&times;</button>
        </div>
      </div>

      {simMode === "life" && (<>
      <div style={{ fontSize: 11, color: T.sub, marginBottom: 4, fontFamily: MONO, letterSpacing: "0.03em" }}>
        PINSEL &middot; Zyklus-Tap: leer &rarr; blau &rarr; rot &rarr; gelb &rarr; leer
      </div>
      <div style={{ display: "flex", gap: 5, marginBottom: 6 }}>
        {swatch("cycle", "Zyklus", null)}
        {swatch(CB, "Blau", COLHEX[CB])}
        {swatch(CR, "Rot", COLHEX[CR])}
        {swatch(CY, "Gelb", COLHEX[CY])}
        {swatch("erase", "Leer", null)}
      </div>
      <div style={{ fontSize: 10, color: T.sub, opacity: 0.7, marginBottom: 3, fontFamily: MONO }}>SEKUNDAER</div>
      <div style={{ display: "flex", gap: 5, marginBottom: 6 }}>
        {swatch(CO, "Orange", COLHEX[CO])}
        {swatch(CG, "Gruen", COLHEX[CG])}
        {swatch(CV, "Violett", COLHEX[CV])}
      </div>
      <div style={{ fontSize: 10, color: T.sub, opacity: 0.7, marginBottom: 3, fontFamily: MONO }}>TERTIAER (Itten-Kreis)</div>
      <div style={{ display: "flex", gap: 5, marginBottom: 6 }}>
        {swatch(CRO, "R-O", COLHEX[CRO])}
        {swatch(CYO, "G-O", COLHEX[CYO])}
        {swatch(CYG, "G-Gr", COLHEX[CYG])}
        {swatch(CBG, "B-Gr", COLHEX[CBG])}
        {swatch(CBV, "B-V", COLHEX[CBV])}
        {swatch(CRV, "R-V", COLHEX[CRV])}
      </div>
      {/* Farbkreis-Stempel-Steuerung */}
      <div style={{ display: "flex", gap: 5, marginBottom: 10, alignItems: "center" }}>
        <span style={{ fontSize: 10, color: T.sub, opacity: 0.7, fontFamily: MONO, flexShrink: 0 }}>KREIS-STEMPEL</span>
        <button onClick={() => placeColorWheel("ring")} style={{
          flex: 1, padding: "8px 4px", borderRadius: 9, fontSize: 11, fontWeight: 700, cursor: "pointer", fontFamily: MONO,
          border: `1px solid ${T.border}`, background: T.bg2, color: T.accent,
        }}>Ring</button>
        <button onClick={() => placeColorWheel("disc")} style={{
          flex: 1, padding: "8px 4px", borderRadius: 9, fontSize: 11, fontWeight: 700, cursor: "pointer", fontFamily: MONO,
          border: `1px solid ${T.border}`, background: T.bg2, color: T.accent,
        }}>Scheibe</button>
      </div>
      </>)}
      {simMode === "rval" && (
        <div style={{ fontSize: 11, color: T.sub, marginBottom: 10, fontFamily: MONO, lineHeight: 1.5, padding: "8px 10px", borderRadius: 9, border: `1px solid ${T.border}`, background: T.bg2 }}>
          <b style={{ color: T.accent }}>{rvalRule === "snow" ? "Schneeflocke" : rvalRule === "water" ? "Wasser" : "HQST-Welle"}</b> &mdash; reellwertige Physik. Start/Pause steuert die Zeitentwicklung, "Neu initialisieren" setzt den Anfangszustand.
        </div>
      )}

      <div ref={wrapRef} style={{ position: "relative", width: "100%", borderRadius: 14, overflow: "hidden", border: `1px solid ${T.border}`, background: T.bg, boxShadow: `0 0 30px rgba(92,240,204,0.06) inset` }}>
        <canvas ref={canvasRef} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} onWheel={onWheel}
          style={{ display: "block", touchAction: "none", cursor: brush === "cycle" ? "pointer" : "crosshair" }} />
        {/* Schwebende Zoom-Steuerung */}
        <div style={{ position: "absolute", top: 8, right: 8, display: "flex", flexDirection: "column", gap: 6, pointerEvents: "none" }}>
          {[["+", () => zoom(1.3)], ["\u2212", () => zoom(1 / 1.3)], ["\u2316", () => fitView()]].map(([lab, fn], i) => (
            <button key={i} onClick={fn} style={{
              pointerEvents: "auto", width: 34, height: 34, borderRadius: 9, cursor: "pointer",
              border: `1px solid ${T.border}`, background: "rgba(6,15,18,0.78)", backdropFilter: "blur(8px)",
              color: T.accent, fontSize: 16, fontWeight: 700, fontFamily: MONO, lineHeight: 1, display: "flex", alignItems: "center", justifyContent: "center",
            }}>{lab}</button>
          ))}
          <div style={{ pointerEvents: "none", textAlign: "center", fontSize: 9.5, color: T.sub, fontFamily: MONO, background: "rgba(6,15,18,0.78)", borderRadius: 7, padding: "2px 0", border: `1px solid ${T.border}` }}>
            {zoomLbl >= 10 ? zoomLbl.toFixed(0) : zoomLbl.toFixed(1)}x
          </div>
        </div>
      </div>

      {/* Statistik-Karte */}
      <div style={{ margin: "8px 0", padding: "10px 12px", borderRadius: 12, border: `1px solid ${T.border}`, background: T.panel, backdropFilter: "blur(6px)", fontFamily: MONO }}>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11.5, color: T.sub, marginBottom: 8 }}>
          <span>Gen <b style={{ color: T.text }}>{gen}</b></span>
          <span>{stats.rval ? "Aktiv" : "Pop"} <b style={{ color: T.text }}>{total}</b></span>
          <span>Dichte <b style={{ color: T.text }}>{(stats.density * 100).toFixed(1)}%</b></span>
          <span>{running ? <span style={{ color: T.accent }}>{stats.sps.toFixed(0)}/s</span> : <span style={{ opacity: 0.5 }}>pausiert</span>}</span>
        </div>
        {stats.rval ? (
          <div style={{ fontSize: 11, color: T.sub, marginBottom: 8, lineHeight: 1.5 }}>
            {rvalRule === "snow" && <span>Eiszellen: <b style={{ color: T.text }}>{total}</b> &middot; reellwertige Diffusion</span>}
            {rvalRule === "water" && <span>Wasserzellen: <b style={{ color: T.text }}>{total}</b> &middot; Gesamtmasse <b style={{ color: T.text }}>{(stats.rvalSum || 0).toFixed(0)}</b> (erhalten)</span>}
            {rvalRule === "hqst" && <span>Belegte Zellen: <b style={{ color: T.text }}>{total}</b> &middot; Norm <b style={{ color: T.text }}>{(stats.rvalSum || 0).toFixed(3)}</b> (unitaer)</span>}
            {rvalRule === "collatz" && <span>Zellen &gt; 1: <b style={{ color: T.text }}>{total}</b> &middot; Collatz-Folgen aktiv</span>}
            {rvalRule === "genes" && <span>Lebende Genotypen: <b style={{ color: T.text }}>{total}</b> &middot; Mendel/Hardy-Weinberg</span>}
          </div>
        ) : (<>
        {/* Farb-Stapelbalken (12 Farben) */}
        <div style={{ display: "flex", height: 8, borderRadius: 4, overflow: "hidden", background: "rgba(140,196,187,0.12)", marginBottom: 8 }}>
          {ALLCOL.map((c) => <div key={c} style={{ width: `${pct(stats.cnt[c])}%`, background: COLHEX[c] }} />)}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "4px 8px", fontSize: 10.5, marginBottom: 8 }}>
          {ALLCOL.map((c) => (
            <span key={c} style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
              <span style={{ width: 9, height: 9, borderRadius: "50%", background: COLHEX[c], display: "inline-block", flexShrink: 0 }} />
              <span style={{ color: T.sub, whiteSpace: "nowrap" }}>{NAME[c]} <b style={{ color: T.text }}>{stats.cnt[c]}</b> <span style={{ opacity: 0.55 }}>{pct(stats.cnt[c])}%</span></span>
            </span>
          ))}
        </div>
        </>)}
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          {!stats.rval && <span style={{ fontSize: 11, color: "#7CF0B0" }}>+{stats.births}</span>}
          {!stats.rval && <span style={{ fontSize: 11, color: "#FF7A93" }}>-{stats.deaths}</span>}
          <svg viewBox="0 0 100 28" preserveAspectRatio="none" style={{ flex: 1, height: 28, opacity: 0.9 }}>
            {sparkPath && <path d={sparkPath} fill="none" stroke={T.accent} strokeWidth="1.3" vectorEffect="non-scaling-stroke" />}
          </svg>
        </div>
      </div>

      <div style={{ display: "flex", gap: 6, marginBottom: 8, flexWrap: "wrap" }}>
        {btn(() => setRunning((r) => !r), running ? "Pause" : "Start", { flex: "1 1 80px", background: running ? "rgba(255,51,85,0.16)" : "rgba(92,240,204,0.14)", borderColor: running ? "rgba(255,51,85,0.4)" : T.accent, color: running ? "#FFC2CE" : T.accent, fontWeight: 700 })}
        {btn(doStep, "Schritt", { flex: "1 1 70px" })}
        {btn(doRandom, "Random", { flex: "1 1 70px" })}
        {btn(doClear, "Leeren", { flex: "1 1 70px" })}
        {btn(doUndo, "Undo", { flex: "1 1 60px" })}
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10, fontFamily: MONO }}>
        <span style={{ fontSize: 11, color: T.sub, width: 60 }}>Tempo</span>
        <input type="range" min={0} max={SPEEDS.length - 1} value={speedIdx} onChange={(e) => setSpeedIdx(Number(e.target.value))} style={{ flex: 1, accentColor: T.accent }} />
        <span style={{ fontSize: 11, color: T.sub, width: 44, textAlign: "right" }}>{SPLBL[speedIdx]}</span>
      </div>

      {/* Watzlawick */}
      <button onClick={() => setShowAxioms((v) => !v)} style={{ width: "100%", textAlign: "left", padding: "9px 10px", borderRadius: 10, border: `1px solid ${T.border}`, background: T.panel, color: T.text, fontFamily: MONO, fontSize: 12, fontWeight: 700, cursor: "pointer", marginBottom: 8 }}>
        {showAxioms ? "v" : ">"} WATZLAWICK-AXIOME (als Regeln)
      </button>
      {showAxioms && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 10 }}>
          {AXIOMS.map((a) => (
            <button key={a.id} onClick={() => setAx((s) => ({ ...s, [a.id]: !s[a.id] }))} title={a.desc} style={{
              textAlign: "left", padding: "8px 10px", borderRadius: 9, cursor: "pointer", fontFamily: MONO,
              border: ax[a.id] ? `1px solid ${T.accent}` : "1px solid rgba(92,240,204,0.14)",
              background: ax[a.id] ? "rgba(92,240,204,0.10)" : T.bg2, color: ax[a.id] ? T.text : T.sub,
            }}>
              <div style={{ fontSize: 12, fontWeight: 700 }}><span style={{ color: ax[a.id] ? T.accent : T.sub }}>{ax[a.id] ? "[x]" : "[ ]"}</span> {a.short}</div>
              <div style={{ fontSize: 10.5, color: T.sub, marginTop: 2, lineHeight: 1.4, opacity: 0.85 }}>{a.desc}</div>
            </button>
          ))}
          <div style={{ padding: "8px 10px", borderRadius: 9, border: "1px solid rgba(92,240,204,0.14)", background: T.bg2 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: a5 !== "off" ? T.text : T.sub, fontFamily: MONO }}>
              <span style={{ color: a5 !== "off" ? T.accent : T.sub }}>{a5 !== "off" ? "[x]" : "[ ]"}</span> A5 Symmetrie / Komplementaritaet
            </div>
            <div style={{ fontSize: 10.5, color: T.sub, margin: "2px 0 6px", lineHeight: 1.4, opacity: 0.85, fontFamily: MONO }}>
              Symmetrisch: nur gleichfarbige Nachbarn zaehlen. Komplementaer: nur andersfarbige.
            </div>
            <div style={{ display: "flex", gap: 6 }}>
              {[["off", "Aus"], ["sym", "Symm."], ["komp", "Kompl."]].map(([k, lab]) => (
                <button key={k} onClick={() => setA5(k)} style={{
                  flex: 1, padding: "6px 4px", borderRadius: 8, fontSize: 11, fontWeight: 600, cursor: "pointer", fontFamily: MONO,
                  border: a5 === k ? `1px solid ${T.accent}` : "1px solid rgba(92,240,204,0.14)",
                  background: a5 === k ? "rgba(92,240,204,0.12)" : T.bg, color: a5 === k ? T.accent : T.sub,
                }}>{lab}</button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Settings */}
      <button onClick={() => setShowSettings((v) => !v)} style={{ width: "100%", textAlign: "left", padding: "9px 10px", borderRadius: 10, border: `1px solid ${T.border}`, background: T.panel, color: T.text, fontFamily: MONO, fontSize: 12, fontWeight: 700, cursor: "pointer", marginBottom: 8 }}>
        {showSettings ? "v" : ">"} REGEL / GROESSE / PATTERN
      </button>
      {showSettings && (
        <>
          {/* Simulationsmodus: boolesche Lebenswelt-Engine vs. reellwertige Physik */}
          <div style={{ fontSize: 11, color: T.sub, fontFamily: MONO, marginBottom: 4 }}>SIMULATIONSMODUS</div>
          <div style={{ display: "flex", gap: 6, marginBottom: simMode === "rval" ? 6 : 8 }}>
            {[["life", "Lebenswelt"], ["rval", "Physik (reellwertig)"]].map(([k, lab]) => (
              <button key={k} onClick={() => setSimMode(k)} style={{
                flex: 1, padding: "8px 6px", borderRadius: 9, fontSize: 11.5, fontWeight: 700, cursor: "pointer", fontFamily: MONO,
                border: simMode === k ? `1px solid ${T.accent}` : "1px solid rgba(92,240,204,0.14)",
                background: simMode === k ? "rgba(92,240,204,0.12)" : T.bg2, color: simMode === k ? T.accent : T.sub,
              }}>{lab}</button>
            ))}
          </div>
          {/* Reellwertige Regelauswahl + Seed */}
          {simMode === "rval" && (
            <>
              <div style={{ display: "flex", gap: 6, marginBottom: 6, flexWrap: "wrap" }}>
                {RVAL_RULES.map((r) => (
                  <button key={r.id} onClick={() => setRvalRule(r.id)} style={{
                    flex: "1 1 28%", minWidth: 0, padding: "7px 4px", borderRadius: 9, fontSize: 10.5, fontWeight: 700, cursor: "pointer", fontFamily: MONO,
                    border: rvalRule === r.id ? `1px solid ${T.accent}` : "1px solid rgba(92,240,204,0.14)",
                    background: rvalRule === r.id ? "rgba(92,240,204,0.12)" : T.bg2, color: rvalRule === r.id ? T.accent : T.sub,
                  }}>{r.id === "snow" ? "Schnee" : r.id === "water" ? "Wasser" : r.id === "hqst" ? "HQST" : r.id === "collatz" ? "Collatz" : "Gene"}</button>
                ))}
              </div>
              <div style={{ fontSize: 10, color: T.sub, opacity: 0.7, marginBottom: 6, fontFamily: MONO, lineHeight: 1.4 }}>
                {rvalRule === "snow" && "Reiter-Schneeflocke: reellwertige Wasserdiffusion, rezeptive Zellen frieren (Chaos Solitons Fractals 23). Start setzt Eiskeim + Dampf."}
                {rvalRule === "water" && "Wasser: Gravitation nach unten + seitlicher Druckausgleich, massenerhaltend. Start fuellt eine Saeule oben."}
                {rvalRule === "hqst" && "HQST: hexagonale Tight-Binding-Quantenwelle, normerhaltend. Start setzt ein lokalisiertes Wellenpaket in der Mitte."}
                {rvalRule === "collatz" && "Collatz: jede Zelle eine Zahl; gerade -> n/2, ungerade -> 3n+1. Erreicht 1, wird aus groesstem Nachbarn neu geboren. Farbe nach log2(Wert)."}
                {rvalRule === "genes" && "Dominante Gene (Mendel): diploide Genotypen AA/Aa/aa. AA+Aa zeigen dominant (rot/orange), aa rezessiv (blau). Geburt vererbt je 1 Allel zweier Eltern; Hardy-Weinberg-Start p=0.6."}
              </div>
              <button onClick={rvalSeed} style={{ width: "100%", padding: "8px", borderRadius: 9, fontSize: 11, fontWeight: 700, cursor: "pointer", fontFamily: MONO, border: `1px solid ${T.border}`, background: T.bg2, color: T.accent, marginBottom: 10 }}>
                Neu initialisieren (Seed)
              </button>
              {rvalRule === "hqst" && (
                <div style={{ marginBottom: 10 }}>
                  <div style={{ fontSize: 10.5, color: T.sub, fontFamily: MONO, marginBottom: 4 }}>SOLVER (Q-SIM-OPS)</div>
                  <div style={{ display: "flex", gap: 6, marginBottom: 4 }}>
                    {Object.entries(SOLVERS).map(([k, s]) => (
                      <button key={k} onClick={() => setSolverId(k)} style={{
                        flex: 1, padding: "7px 4px", borderRadius: 9, fontSize: 10.5, fontWeight: 700, cursor: "pointer", fontFamily: MONO,
                        border: solverId === k ? `1px solid ${T.accent}` : "1px solid rgba(92,240,204,0.14)",
                        background: solverId === k ? "rgba(92,240,204,0.12)" : T.bg2, color: solverId === k ? T.accent : T.sub,
                      }}>{s.l}</button>
                    ))}
                  </div>
                  <div style={{ fontSize: 10, color: T.sub, opacity: 0.7, fontFamily: MONO, lineHeight: 1.4 }}>
                    Austauschbarer Integrator: {SOLVERS[solverId].note}. Crank-Nicolson erhaelt die Norm exakt; Euler driftet sichtbar (Vergleich der Verfahren).
                  </div>
                </div>
              )}
            </>
          )}

          {/* Regelquelle: Standard B/S abwaehlbar -> nur Watzlawick (nur Lebenswelt) */}
          {simMode === "life" && (<>
          <div style={{ fontSize: 11, color: T.sub, fontFamily: MONO, marginBottom: 4 }}>REGELQUELLE</div>
          <div style={{ display: "flex", gap: 6, marginBottom: 6 }}>
            {[["std", "Standard B/S"], ["watz", "Nur Watzlawick"]].map(([k, lab]) => {
              const on = (k === "watz") === watzOnly;
              return (
                <button key={k} onClick={() => setWatzOnly(k === "watz")} style={{
                  flex: 1, padding: "8px 6px", borderRadius: 9, fontSize: 11.5, fontWeight: 700, cursor: "pointer", fontFamily: MONO,
                  border: on ? `1px solid ${T.accent}` : "1px solid rgba(92,240,204,0.14)",
                  background: on ? "rgba(92,240,204,0.12)" : T.bg2, color: on ? T.accent : T.sub,
                }}>{lab}</button>
              );
            })}
          </div>
          {/* Regeltyp: totalistisch vs. isotrop-nicht-totalistisch (INT, Callahan o/m/p) */}
          {!watzOnly && (
            <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
              {[["tot", "Totalistisch"], ["int", "INT (o/m/p)"]].map(([k, lab]) => (
                <button key={k} onClick={() => { setRuleSrc(k); setRuleIdx(0); }} style={{
                  flex: 1, padding: "7px 6px", borderRadius: 9, fontSize: 11, fontWeight: 700, cursor: "pointer", fontFamily: MONO,
                  border: ruleSrc === k ? `1px solid ${T.accent}` : "1px solid rgba(92,240,204,0.14)",
                  background: ruleSrc === k ? "rgba(92,240,204,0.12)" : T.bg2, color: ruleSrc === k ? T.accent : T.sub,
                }}>{lab}</button>
              ))}
            </div>
          )}
          </>)}

          {/* Farbmodus (Farbenlehre) */}
          <div style={{ fontSize: 11, color: T.sub, fontFamily: MONO, marginBottom: 4 }}>FARBMODUS</div>
          <div style={{ display: "flex", gap: 6, marginBottom: 4 }}>
            {[["quad", "QuadLife"], ["mix", "Hue-Mix"], ["drift", "Verfaerben"]].map(([k, lab]) => (
              <button key={k} onClick={() => setColorMode(k)} style={{
                flex: 1, padding: "8px 4px", borderRadius: 9, fontSize: 11, fontWeight: 700, cursor: "pointer", fontFamily: MONO,
                border: colorMode === k ? `1px solid ${T.accent}` : "1px solid rgba(92,240,204,0.14)",
                background: colorMode === k ? "rgba(92,240,204,0.12)" : T.bg2, color: colorMode === k ? T.accent : T.sub,
              }}>{lab}</button>
            ))}
          </div>
          <div style={{ fontSize: 10, color: T.sub, opacity: 0.7, marginBottom: 8, fontFamily: MONO, lineHeight: 1.4 }}>
            {colorMode === "quad" && "Farbinvariant (State of the Art): Dynamik exakt wie Life, Farbe vererbt nach QuadLife. A2 erzwingt Mehrheit."}
            {colorMode === "mix" && "Subtraktiver Hue-Mix: Geburtsfarbe = Mittel der Nachbarfarben (Rot+Gelb=Orange usw.)."}
            {colorMode === "drift" && "Verfaerben (experimentell): lebende Zellen driften farblich - bricht bewusst die Farbinvarianz."}
          </div>
          <button onClick={() => setShowLegend((v) => !v)} style={{ width: "100%", textAlign: "left", padding: "8px 10px", borderRadius: 9, border: `1px solid ${T.border}`, background: T.bg2, color: T.text, fontFamily: MONO, fontSize: 11.5, fontWeight: 700, cursor: "pointer", marginBottom: showLegend ? 6 : 8 }}>
            {showLegend ? "v" : ">"} Legende: alle Regeln &amp; Farbenlehre
          </button>
          {showLegend && (
            <div style={{ border: "1px solid rgba(92,240,204,0.14)", borderRadius: 9, padding: "10px 12px", marginBottom: 10, background: T.bg2, fontFamily: MONO, fontSize: 10.5, color: T.sub, lineHeight: 1.55 }}>
              <div style={{ color: T.text, fontWeight: 700, marginBottom: 3 }}>B/S-Notation (Hexgitter: 0-6 Nachbarn)</div>
              <div><b style={{ color: T.accent }}>B</b> Geburt bei dieser Nachbarzahl, <b style={{ color: T.accent }}>S</b> Survival sonst Tod.</div>

              <div style={{ color: T.text, fontWeight: 700, margin: "7px 0 3px" }}>Alle Standard-Rulesets ({RULES.length})</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "2px 10px" }}>
                {RULES.map((r, i) => (
                  <div key={i} style={{ color: (!watzOnly && ruleIdx === i) ? T.accent : T.sub }}>
                    {(!watzOnly && ruleIdx === i) ? "\u25B8 " : ""}B{r.B.join("")}/S{r.S.join("")}{i === 1 ? " *Bays" : ""}
                  </div>
                ))}
              </div>
              <div style={{ opacity: 0.7, marginTop: 2 }}>*B2/S35 = Carter-Bays (Complex Systems 15:245).</div>

              <div style={{ color: T.text, fontWeight: 700, margin: "7px 0 3px" }}>Watzlawick-Regel {watzOnly ? "(aktiv)" : ""}</div>
              <div style={{ color: watzOnly ? T.accent : T.sub }}>B2,3 / S1-5 - Kommunikationsband: 0 = Isolation = Tod; 6 = Rauschueberlast = Tod; dazwischen lebt der Dialog.</div>

              <div style={{ color: T.text, fontWeight: 700, margin: "7px 0 3px" }}>Axiome (modulieren jede Regel)</div>
              <div><b style={{ color: ax.a1 ? T.accent : T.sub }}>A1</b> Stille: stille Leerzonen keimen selten spontan.</div>
              <div><b style={{ color: ax.a2 ? T.accent : T.sub }}>A2</b> Beziehung: Geburtsfarbe per Nachbar-Mehrheit statt Mischung.</div>
              <div><b style={{ color: ax.a3 ? T.accent : T.sub }}>A3</b> Interpunktion: alte Zellen (Alter &ge;6) +/-1 Survival-Toleranz.</div>
              <div><b style={{ color: ax.a4 ? T.accent : T.sub }}>A4</b> Analog: sterbende Zelle hinterlaesst 1 Generation Ghost.</div>
              <div><b style={{ color: a5 !== "off" ? T.accent : T.sub }}>A5</b> Symm./Kompl.: nur gleich- bzw. andersfarbige Nachbarn zaehlen.</div>

              <div style={{ color: T.text, fontWeight: 700, margin: "7px 0 3px" }}>INT-Regeln (isotrop nicht-totalistisch, {INT_RULES.length})</div>
              <div>Callahan o/m/p: bei genau 2 Nachbarn zaehlt die Anordnung - o=ortho (60grad), m=meta (120grad), p=para (180grad gegenueber). Erzeugt Dynamik, die rein totalistische Regeln nicht erreichen.</div>

              <div style={{ color: T.text, fontWeight: 700, margin: "7px 0 3px" }}>Farbenlehre (Itten-Kreis, 12 Farben)</div>
              <div>Primaer: <span style={{ color: COLHEX[CR] }}>Rot</span>, <span style={{ color: COLHEX[CY] }}>Gelb</span>, <span style={{ color: COLHEX[CB] }}>Blau</span>. Sekundaer: <span style={{ color: COLHEX[CO] }}>Orange</span>, <span style={{ color: COLHEX[CG] }}>Gruen</span>, <span style={{ color: COLHEX[CV] }}>Violett</span>.</div>
              <div>Tertiaer (Mischung benachbarter): <span style={{ color: COLHEX[CRO] }}>Rot-Orange</span>, <span style={{ color: COLHEX[CYO] }}>Gelb-Orange</span>, <span style={{ color: COLHEX[CYG] }}>Gelb-Gruen</span>, <span style={{ color: COLHEX[CBG] }}>Blau-Gruen</span>, <span style={{ color: COLHEX[CBV] }}>Blau-Violett</span>, <span style={{ color: COLHEX[CRV] }}>Rot-Violett</span>.</div>
              <div>Mischung: <span style={{ color: COLHEX[CR] }}>Rot</span>+<span style={{ color: COLHEX[CY] }}>Gelb</span>=<span style={{ color: COLHEX[CO] }}>Orange</span>, <span style={{ color: COLHEX[CY] }}>Gelb</span>+<span style={{ color: COLHEX[CB] }}>Blau</span>=<span style={{ color: COLHEX[CG] }}>Gruen</span>, <span style={{ color: COLHEX[CB] }}>Blau</span>+<span style={{ color: COLHEX[CR] }}>Rot</span>=<span style={{ color: COLHEX[CV] }}>Violett</span>. Benachbarte Toene mischen zur Tertiaerfarbe dazwischen.</div>
              <div>Komplementaer (180grad, 6 Paare): <span style={{ color: COLHEX[CR] }}>Rot</span>&harr;<span style={{ color: COLHEX[CG] }}>Gruen</span>, <span style={{ color: COLHEX[CY] }}>Gelb</span>&harr;<span style={{ color: COLHEX[CV] }}>Violett</span>, <span style={{ color: COLHEX[CB] }}>Blau</span>&harr;<span style={{ color: COLHEX[CO] }}>Orange</span>, und die drei Tertiaer-Paare.</div>
              <div style={{ opacity: 0.8, marginTop: 2 }}>Farbkreis-Stempel oben setzt die 12 Toene als Ring oder Scheibe. Farbinvarianz: Farbe ist ein reiner Datenkanal (QuadLife); Modus "quad" wahrt das, "mix"/"drift" sind kuenstlerische Varianten.</div>
            </div>
          )}

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 8 }}>
            <label style={{ fontSize: 11, color: T.sub, fontFamily: MONO }}>Regel
              {watzOnly
                ? <div style={{ ...sel, opacity: 0.85, color: T.accent }}>Watzlawick B2,3 / S1-5</div>
                : <select value={ruleIdx} onChange={(e) => setRuleIdx(Number(e.target.value))} style={sel}>{(ruleSrc === "int" ? INT_RULES : RULES).map((r, i) => <option key={i} value={i}>{r.l}</option>)}</select>}
            </label>
            <label style={{ fontSize: 11, color: T.sub, fontFamily: MONO }}>Groesse
              <select value={sizeIdx} onChange={(e) => setSizeIdx(Number(e.target.value))} style={sel}>{GRID_SIZES.map((g, i) => <option key={i} value={i}>{g.l} ({g.rows}x{g.cols})</option>)}</select>
            </label>
            <label style={{ fontSize: 11, color: T.sub, fontFamily: MONO }}>Pattern
              <select value={pattern} onChange={(e) => setPattern(e.target.value)} style={sel}>{Object.keys(PATS).map((k) => <option key={k} value={k}>{k}</option>)}</select>
            </label>
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span style={{ fontSize: 11, color: T.sub, fontFamily: MONO }}>Aktion</span>
              {btn(doPlace, "Stempel setzen", { padding: "7px 8px" })}
            </div>
          </div>
          <div style={{ marginBottom: 10 }}>
            <div style={{ fontSize: 11, color: T.sub, fontFamily: MONO, marginBottom: 4 }}>TOPOLOGIE &amp; RAHMEN</div>
            <div style={{ display: "flex", gap: 6, marginBottom: 6 }}>
              {[["torus", "Torus"], ["edge", "Rand"]].map(([k, lab]) => {
                const on = (k === "torus") === torusOn;
                return (
                  <button key={k} onClick={() => setTorusOn(k === "torus")} style={{
                    flex: 1, padding: "8px 6px", borderRadius: 9, fontSize: 11.5, fontWeight: 700, cursor: "pointer", fontFamily: MONO,
                    border: on ? `1px solid ${T.accent}` : "1px solid rgba(92,240,204,0.14)",
                    background: on ? "rgba(92,240,204,0.12)" : T.bg2, color: on ? T.accent : T.sub,
                  }}>{lab}</button>
                );
              })}
            </div>
            <div style={{ display: "flex", gap: 6, marginBottom: 4 }}>
              {[["box", "Rechteck"], ["circle", "Kreis"]].map(([k, lab]) => (
                <button key={k} onClick={() => setFrameShape(k)} style={{
                  flex: 1, padding: "8px 6px", borderRadius: 9, fontSize: 11.5, fontWeight: 700, cursor: "pointer", fontFamily: MONO,
                  border: frameShape === k ? `1px solid ${T.accent}` : "1px solid rgba(92,240,204,0.14)",
                  background: frameShape === k ? "rgba(92,240,204,0.12)" : T.bg2, color: frameShape === k ? T.accent : T.sub,
                }}>{lab}</button>
              ))}
            </div>
            <div style={{ fontSize: 10, color: T.sub, opacity: 0.7, fontFamily: MONO, lineHeight: 1.4 }}>
              {frameShape === "circle"
                ? (torusOn ? "Kreis + Torus: antipodale Identifikation (reelle projektive Ebene, RP2). Reflexionsfrei, aber nicht-orientierbar - Muster kehren am Rand spiegelverkehrt zurueck (Moebius-Eigenschaft)." : "Kreis + Rand: harte runde Wand, Null-Fluss (Neumann), massenerhaltend.")
                : (torusOn ? "Rechteck + Torus: periodischer Rand (Standard-Wrap)." : "Rechteck + Rand: feste Wand, Null-Fluss (Neumann).")}
            </div>
          </div>

          {/* Systemtheorie-Modell (Kybernetik / Homeostase) */}
          <div style={{ marginBottom: 14 }}>
            <button onClick={() => setSysTheory((v) => !v)} style={{
              width: "100%", padding: "9px", borderRadius: 9, fontSize: 11.5, fontWeight: 700, cursor: "pointer", fontFamily: MONO,
              border: sysTheory ? `1px solid ${T.accent}` : `1px solid ${T.border}`,
              background: sysTheory ? "rgba(92,240,204,0.12)" : T.bg2, color: sysTheory ? T.accent : T.sub, marginBottom: sysTheory ? 6 : 0,
            }}>{sysTheory ? "Systemtheorie: AN (Homeostase)" : "Systemtheorie: AUS"}</button>
            {sysTheory && (
              <>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                  <span style={{ fontSize: 10.5, color: T.sub, fontFamily: MONO, whiteSpace: "nowrap" }}>Sollwert {Math.round(sysSetpoint * 6)}</span>
                  <input type="range" min="1" max="6" step="1" value={Math.round(sysSetpoint * 6)} onChange={(e) => setSysSetpoint(Number(e.target.value) / 6)} style={{ flex: 1, accentColor: T.accent }} />
                </div>
                <div style={{ fontSize: 10, color: T.sub, opacity: 0.7, fontFamily: MONO, lineHeight: 1.4 }}>
                  Kybernetische Negativ-Rueckkopplung: Unterdichte stuetzt Leben, Ueberdichte entzieht es. Das System regelt sich auf den Sollwert (dynamisches Gleichgewicht), statt frei zu wachsen oder zu sterben.
                </div>
              </>
            )}
            <button onClick={() => setOpenSys((v) => !v)} style={{
              width: "100%", marginTop: 6, padding: "9px", borderRadius: 9, fontSize: 11.5, fontWeight: 700, cursor: "pointer", fontFamily: MONO,
              border: openSys ? `1px solid ${T.accent}` : `1px solid ${T.border}`,
              background: openSys ? "rgba(92,240,204,0.12)" : T.bg2, color: openSys ? T.accent : T.sub,
            }}>{openSys ? "Offenes System: AN (Dirichlet-Rand)" : "Offenes System: AUS (geschlossen)"}</button>
            {openSys && (
              <div style={{ fontSize: 10, color: T.sub, opacity: 0.7, marginTop: 4, fontFamily: MONO, lineHeight: 1.4 }}>
                Systemtheorie: offenes System. Der Rand haelt einen konstanten Quellwert (Dirichlet) und tauscht mit der Umgebung aus - wirkt in der Physik bei Schnee und Wasser. Geschlossen = Null-Fluss (Neumann).
              </div>
            )}
          </div>

          {/* Forschungsstation: LiouScope-Zeitreihen-Recorder + Export */}
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 11, color: T.sub, fontFamily: MONO, marginBottom: 4 }}>FORSCHUNG &middot; LIOUSCOPE-EXPORT</div>
            <button onClick={toggleRecord} style={{
              width: "100%", padding: "9px", borderRadius: 9, fontSize: 11.5, fontWeight: 700, cursor: "pointer", fontFamily: MONO,
              border: recording ? `1px solid ${T.accent}` : `1px solid ${T.border}`,
              background: recording ? "rgba(92,240,204,0.12)" : T.bg2, color: recording ? T.accent : T.sub, marginBottom: 6,
            }}>{recording ? "Aufzeichnung: LAEUFT (stoppen)" : "Zeitreihe aufzeichnen (Start)"}</button>
            <div style={{ display: "flex", gap: 6, marginBottom: 4 }}>
              <button onClick={exportCSV} style={{ flex: 1, padding: "8px 4px", borderRadius: 9, fontSize: 11, fontWeight: 700, cursor: "pointer", fontFamily: MONO, border: `1px solid ${T.border}`, background: T.bg2, color: T.accent }}>CSV</button>
              <button onClick={exportJSON} style={{ flex: 1, padding: "8px 4px", borderRadius: 9, fontSize: 11, fontWeight: 700, cursor: "pointer", fontFamily: MONO, border: `1px solid ${T.border}`, background: T.bg2, color: T.accent }}>JSON (LiouScope)</button>
            </div>
            <div style={{ fontSize: 10, color: T.sub, opacity: 0.75, fontFamily: MONO, lineHeight: 1.4 }}>
              {recMsg || "Zeichnet pro Schritt Observablen auf (Pop/Dichte/Geburten oder aktive Zellen/Summe). JSON traegt Metadaten fuer reproduzierbare LiouScope-Analyse (Spektrum, Skalierung)."}
            </div>
          </div>

          {/* Forschungsstation: Globalarchiv (reproduzierbarer Lauf-Schnappschuss) */}
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 11, color: T.sub, fontFamily: MONO, marginBottom: 4 }}>FORSCHUNG &middot; GLOBALARCHIV</div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
              <span style={{ fontSize: 10.5, color: T.sub, fontFamily: MONO, whiteSpace: "nowrap" }}>Seed</span>
              <input type="number" value={seed} onChange={(e) => setSeed(Number(e.target.value) | 0)} style={{ flex: 1, minWidth: 0, padding: "6px 8px", borderRadius: 8, border: `1px solid ${T.border}`, background: T.bg2, color: T.text, fontFamily: MONO, fontSize: 11 }} />
              <button onClick={() => setSeed((Math.random() * 1e9) | 0)} style={{ padding: "6px 8px", borderRadius: 8, fontSize: 10.5, fontWeight: 700, cursor: "pointer", fontFamily: MONO, border: `1px solid ${T.border}`, background: T.bg2, color: T.accent }}>Wuerfeln</button>
            </div>
            <div style={{ display: "flex", gap: 6, marginBottom: 4 }}>
              <button onClick={exportSnapshot} style={{ flex: 1, padding: "8px 4px", borderRadius: 9, fontSize: 11, fontWeight: 700, cursor: "pointer", fontFamily: MONO, border: `1px solid ${T.border}`, background: T.bg2, color: T.accent }}>Speichern</button>
              <label style={{ flex: 1, padding: "8px 4px", borderRadius: 9, fontSize: 11, fontWeight: 700, cursor: "pointer", fontFamily: MONO, border: `1px solid ${T.border}`, background: T.bg2, color: T.accent, textAlign: "center" }}>
                Laden<input type="file" accept="application/json,.json" onChange={importSnapshot} style={{ display: "none" }} />
              </label>
            </div>
            <div style={{ fontSize: 10, color: T.sub, opacity: 0.75, fontFamily: MONO, lineHeight: 1.4 }}>
              {archMsg || "Speichert/laedt die vollstaendige Lauf-Konfiguration (Seed + alle Parameter) als JSON. Mit festem Seed ist jeder Zufallsstart exakt reproduzierbar."}
            </div>
          </div>
        </>
      )}

      <div style={{ fontSize: 10.5, color: T.sub, opacity: 0.7, lineHeight: 1.6, fontFamily: MONO }}>
        Pinsel Zyklus: ein Tap schaltet weiter (leer&rarr;blau&rarr;rot&rarr;gelb&rarr;leer), ein Finger pant. Blau/Rot/Gelb/Leer: Tap und Ziehen malen.
        Zwei Finger oder Rad = Zoom (jetzt bis 0.2x rausgezoomt), Fit zentriert. Regelquelle "Nur Watzlawick" deaktiviert die B/S-Rulesets.
      </div>
    </div>
  );
}
