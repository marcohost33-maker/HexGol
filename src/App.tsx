import { useState, useCallback, useEffect, useRef } from "react";
// Sim-Engine (pure, worker-importfaehig) - aus dieser Datei extrahiert (AP-1).
import {
  S3, PI2, PI3, C0, CR, CRO, CO, CYO, CY, CYG, CG, CBG, CB, CBV, CV, CRV,
  PRIMARY, ALLCOL, CYCLE, T, COLA, COLHEX,
  NAME, COSH, SINH, hueToState, GRID_SIZES, SPEEDS, SPLBL,
  MAX_CIRCLE_RADIUS, DEFAULT_CIRCLE_RADIUS, HQST_CELL_CAP,
  DENS, MAX_UNDO, RULES, RMETA, hexClass2, INT_RULES, INT_META, WATZ_META,
  PATS, AXIOMS, PAD, clamp, hexCenter, pixelToOddR, worldSize, buildNeighbors, circleGridDims,
  hash2, rng, birthColorQuad, cMixVec, mMixCnt, driftHue, RVAL_RULES, stepReiter, stepWater,
  SOLVERS, mkHqstWork, stepHQST, rvalColor, stepCollatz,
  collatzColor, G_AA, G_Aa, G_aa, genotype, stepGenes, geneColor,
  oddRToCube, cubeToOddR, hexDist, CUBE_DIRS,
  cubeRing, cubeDisk, kColorByIndex, sectorByAngle,
} from "./lib/sim-engine.js";
import { renderRaster } from "./lib/raster-render.js"; // geteilter Raster-Pfad (Worker + Main)
import { supportsOffscreenWorker } from "./lib/worker-support.js"; // Feature-Detection (fail-closed)
// v33 PR-C: Spielstand-Speichern (IndexedDB + Datei-Export/Import + Urzustand).
import {
  serializeSave, deserializeSave, makeOriginSnapshot, shouldCaptureOrigin,
  idbPut, idbGet, idbList, idbDelete, idbRename,
  SAVE_FILE_EXT, AUTOSAVE_KEY, reloadGuardDecision,
} from "./lib/savestate.js";
// v33 PR-D: Canvas-Snapshot teilen (Web Share L2 + Download-Fallback).
import {
  buildSnapshotFilename, buildWatermarkLabel, canvasToBlob, shareOrDownloadBlob,
} from "./lib/snapshot.js";
// Re-Export der von den Unit-Tests importierten Engine-Funktionen, damit die
// bestehenden Test-Importpfade (tests/unit/*.test.js -> "../../src/App.tsx")
// unveraendert weiterlaufen (PR#41-Kontrakt, named exports, export-only).
export { buildNeighbors, mkHqstWork, stepHQST };

// --- HQST-Parameter + Divergenz-Schranke (v33 PR-E / Mathe-Audit P1.4) -------
// Tight-Binding-Parameter der HQST-Quantenwelle (siehe stepHQST-Aufruf in step()).
// J = Hopping, V = On-Site-Potential, dt = Zeitschritt. Hier ZENTRAL benannt,
// damit die Divergenz-Schranke unten nachweislich aus DIESEN Annahmen folgt
// (statt einer magischen 1e4).
const HQST_J = 0.15, HQST_V = 0.0, HQST_DT = 0.5;
// Crank-Nicolson ist unitaer/normerhaltend: ||psi||_2 = const. Damit bleibt die
// Amplitude pro Zelle O(1) (Norm auf die Zellzahl verteilt). Konvergenz der
// CN-Fixpunkt-Iteration ist garantiert, solange a*||H|| < 1 mit a = dt/2 und
// ||H||_op <= 6J + |V| (6 Nachbarn). Hier: a = 0.25, ||H|| <= 6*0.15 = 0.9 ->
// a*||H|| = 0.225 < 1 (Audit A5, /tmp/verify6.mjs: Norm-Drift -2.4e-3 %).
// Ein expliziter Loeser (Euler/RK4) bricht diese Schranke und waechst
// exponentiell. Eine entgleiste Amplitude > HQST_DIVERGENCE_BOUND ist also
// EINDEUTIG Verfahrensdivergenz: weit ueber dem O(1)-Normband, aber noch unter
// dem Float32-Ueberlauf (~3.4e38), damit der Waechter VOR Inf/NaN greift.
const HQST_DIVERGENCE_BOUND = 1e4;

// v33 PR-E: buildNeighbors-opts aus dem aktuellen Form-Zustand ableiten. EINE
// Quelle fuer Main-Thread (Grid-Effekt) UND Worker-init-Nachricht -> Maske
// deckungsgleich. circle: {circleRadius}; ellipse: {ellipseA,ellipseB};
// freeform: {polygon} (>=3 Punkte, sonst undefined -> leere Domaene, fail-closed).
function frameOptsFor(shape, { circleRadius, ellipseA, ellipseB, polygon }) {
  if (shape === "circle") return { circleRadius };
  if (shape === "ellipse") return { ellipseA, ellipseB };
  if (shape === "freeform") {
    return Array.isArray(polygon) && polygon.length >= 3 ? { polygon } : undefined;
  }
  return undefined;
}

// =============================================================================
// GolHex v31 - Hexagonal Game of Life (Forschungsstation, Produktionsreife)
// Coworker Research / Coworkerz - 2026-05-31
// Lineage: v16.5 -> ... -> v30 -> v30.1 -> v31
//
// v31 Delta (zwei neue Rahmenformen + Validierung der Zellentwicklung):
//   0. FIX (Audit): der Hexagon-UMRISS war trigonometrisch geraten (falsche
//      Orientierung, Seitenverhaeltnis 0.87 statt 1.155 -> schnitt die Maske ab).
//      Jetzt aus der Maske abgeleitet: 6 Ecken = hexRad Schritte in den 6 Wuerfel-
//      Richtungen (CUBE_DIRS + cubeToOddR). Ecken-BBox == Masken-BBox verifiziert.
//   1. HEXAGON-Rahmen: exaktes regelmaessiges Sechseck via Hex-Distanz in
//      Wuerfelkoordinaten (oddRToCube + hexDist). Web-fundiert (devmag.org.za):
//      Punkte mit hex-Abstand <= r bilden ein regelmaessiges Sechseck. Verifiziert
//      ueber zentrierte Hexzahlen 1+3r(r+1) -> exakt, keine Naeherung.
//   2. DREIECK-Rahmen: gleichseitig (Spitze oben) via Schnittmenge dreier
//      Halbebenen (Punkt-im-Dreieck, Vorzeichen der Kreuzprodukte).
//   3. TORUS-Korrektur: nur box kachelt die Ebene periodisch sauber. circle bleibt
//      antipodal (RP2); hexagon/triangle berandet (kein falsches Wrapping).
//   4. Zellentwicklung verifiziert: Nachbarschaft reziprok (0 Asymmetrien),
//      keine Lecks aus der Domaene, 1..6 Nachbarn/Zelle, 100 Gen stabil,
//      deterministisch. (test_new_shapes/shapes_real/shapes_evolution.mjs)
//
// v30.1 Delta (ehrliche Perf-Metrik + inkrementelles Neuzeichnen, web-validiert):
//   0b. AUDIT-FIX (letzte 5 Reaktionen): (i) der nicht-passive touchmove-Listener
//      unterband das Scrollen UNBEDINGT -> Ueberkorrektur (Nutzer auf Canvas
//      "eingesperrt"). Jetzt BEDINGT: nur bei aktiver Geste (paint/pan/pinch);
//      reine Scrollbewegung durchgelassen. (ii) Rad-Zoom: fester 12%-Sprung ->
//      proportional (exp), Trackpad-Pinch (ctrlKey) glatt statt ruckartig; als
//      nicht-passiver wheel-Listener (zuverlaessiges preventDefault). Quelle:
//      Figma/tldraw/Excalidraw ctrlKey-Muster, p5 bedingtes preventDefault.
//   0. STABILITAET/BEDIENUNG: gestaffelte Touch-Strategie, damit das Fenster bei
//      Bedienung nicht mitwandert (Nutzer-Rueckmeldung): (a) Regler touch-action
//      none, (b) Canvas touch-action none, (c) NICHT-PASSIVER touchmove-Listener
//      auf Canvas -> preventDefault (React-Touch ist passiv, daher noetig),
//      (d) Wurzelcontainer touch-action pan-y + overscroll-behavior contain.
//      Spezifitaet: Canvas/Regler verwalten eigene Gesten, Rest vertikal scrollbar.
//      Quelle: MDN touch-action, Chrome 56+ passive touch events. Gesten-Abbruch
//      (onPointerCancel) + Listener-Lebenszyklus geprueft -> keine Leaks.
//   1. KORREKTUR: die v30-Perf-"Beschleunigung" (1.1x-2.3x schwankend) war
//      Scheinpraezision (leeres Attrappen-Objekt, JIT optimierte weg). Ersetzt
//      durch ehrliche, deterministische Allokations-Metrik. KEINE x-fach-Zahl
//      mehr behauptet; messbar ist die eliminierte per-Zelle-Allokation.
//   2. Inkrementelles Neuzeichnen (State of the Art, MDN/web.dev "redraw regions"):
//      nur geaenderte Zellen statt Vollredraw. Zwei-Signal-Architektur (starkes
//      dirtyRef = Vollredraw mit Vorfahrt; schwaches stepDirtyRef = Schritt).
//      Farbe UND Geister werden per eigenem Diff-Gedaechtnis gefuehrt
//      (prevColorRef/prevGhostRef). GATING: nur pxR<4 (Gitter/Glow sind globale
//      Ebenen, beim Zoom ohnehin wenige Zellen -> Vollredraw guenstig). Mit allen
//      Ebenen verifiziert (test_incremental_layers/ghosts): 0 Abweichung.
//
// v30 Delta (Produktionsreife: Performance + UI/UX-Standards, web-validiert):
//   1. Render allokationsfrei: addHexIdx berechnet Zellzentren inline statt pro
//      Zelle ein {x,y}-Objekt zu erzeugen. Geometrie bitidentisch zu hexCenter
//      verifiziert (0 Abweichung). Gemessen ~1.9x schneller, 6 Mio GC-Objekte/
//      120 Frames eingespart (XXL). Quelle: MDN/web.dev Canvas-Optimierung.
//   2. Canvas-Kontext mit alpha:false (opakes Rendering, intern optimiert).
//   3. UI/UX nach WCAG 2.2 + Material/Apple: jeder Button min 44px Touch-Target,
//      sichtbarer Fokusring (Tastatur), reduzierte-Bewegung-Respekt. Quelle:
//      WCAG 2.5.8, Apple HIG 44pt, Material 48dp.
//
// v29L.4 Delta (Audit-Fixes letzte 4 Versionen):
//   1. FIX (toter Code): das in v29L.3b eingefuehrte CN-Konvergenz-Flag wurde von
//      stepHQST verworfen und nirgends genutzt. Jetzt propagiert + als UI-Warnung
//      sichtbar (nur cn; euler/rk4 liefern undefined -> kein Falsch-Alarm).
//   2. FIX (Datenintegritaet): Recorder mischte bei Modus-Wechsel waehrend der
//      Aufzeichnung Zeilen verschiedener Spaltenzahl. Jetzt beginnt er bei
//      Spaltenwechsel sauber neu (CSV/JSON immer konsistent).
//   Beides gegen echten extrahierten Code verifiziert.
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


// =============================================================================
// Coworkerz-Standard: plattform-ehrliches Schliessen (X -> Zentrale / Fenster).
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

// =============================================================================
export default function GolHex() {
  const [sizeIdx, setSizeIdx] = useState(1); // M default
  const [frameShape, setFrameShape] = useState("box"); // "box" Rechteck | "circle" Scheibe | "hexagon" | "triangle" | "ellipse" (v33 PR-E) | "freeform" (v33 PR-E)
  // AP-2: EXPLIZITER Kreis-Radius (Gitterschritte, Marco: Default 250, Max 500).
  // Nur fuer frameShape==="circle" wirksam; das Gitter wird dann aus dem Radius
  // abgeleitet (circleGridDims), statt aus der GRID_SIZES-Stufe.
  const [circleRadius, setCircleRadius] = useState(DEFAULT_CIRCLE_RADIUS);
  // v33 PR-E: Ellipse-Halbachsen (Gitterschritte). Nur fuer frameShape==="ellipse".
  // a = horizontal (Spalten), b = vertikal (Reihen). Default a>b (liegende Ellipse).
  const [ellipseA, setEllipseA] = useState(80);
  const [ellipseB, setEllipseB] = useState(50);
  // v33 PR-E: Freiform-Polygon in WELT-Koordinaten ([{x,y},...], >=3 Punkte).
  // Wird im Zeichen-Modus auf dem Canvas gesammelt; bei pointerup geschlossen.
  // Leer -> leere Domaene (fail-closed; UI fordert zum Zeichnen auf).
  const [freeformPolygon, setFreeformPolygon] = useState([]);
  // Zeichen-Modus aktiv (Frei-Rahmen gewaehlt, User zieht gerade den Polygonzug).
  const [freeformDrawing, setFreeformDrawing] = useState(false);
  // Effektive Gitter-Geometrie: bei "circle" aus dem Radius, sonst aus der Stufe.
  const G = (frameShape === "circle")
    ? (() => { const d = circleGridDims(circleRadius); return { l: `r=${d.radius}`, rows: d.rows, cols: d.cols, hr: d.hr }; })()
    : GRID_SIZES[sizeIdx];
  const R = G.rows, C = G.cols, HR = G.hr, N = R * C;
  // HQST bei Riesen-Gittern gesperrt (ehrliche UI-Meldung statt stillem Freeze).
  const hqstLocked = N > HQST_CELL_CAP;
  // Riesen-Gitter-Schwelle fuer den Auto-Worker (Marco-Entscheid M-2). Gleiche
  // Single-Source-Schwelle wie der HQST-Cap (HQST_CELL_CAP, aus sim-engine.js),
  // hier aber INKLUSIV (>=): ab dem Cap friert der Haupt-Thread ein (Data AP-D2),
  // ueber dem OffscreenCanvas-Worker laeuft es bis ~680k weiter.
  const bigGrid = N >= HQST_CELL_CAP;
  const gridRef = useRef(G);
  gridRef.current = G; // waehrend Render aktuell halten (stabil fuer draw/fitView)

  const [running, setRunning] = useState(false);
  const [speedIdx, setSpeedIdx] = useState(4);
  const [ruleIdx, setRuleIdx] = useState(0);
  const [torusOn, setTorusOn] = useState(true);
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
  // v33 PR-C: "1. Figur" / Urzustand. Snapshot des Feldes UNMITTELBAR vor dem
  // ERSTEN Play eines Laufes (klar getrennt von Undo/Redo). Ref, weil der Play-
  // Toggle ihn synchron im selben Tick setzen/lesen muss (kein Re-Render-Lag).
  // null = noch kein Urzustand fuer den aktuellen Lauf -> naechstes Play setzt ihn.
  const originRef = useRef(null);
  const [hasOrigin, setHasOrigin] = useState(false); // nur fuer Button-Enable/Tooltip
  // v33 PR-C: Spielstand-Speichern-UI (IndexedDB). Panel ueber 💾 in der Top-Leiste.
  const [saveOpen, setSaveOpen] = useState(false);
  const [saveName, setSaveName] = useState("");
  const [saveSlots, setSaveSlots] = useState([]); // [{key, meta}]
  const [saveMsg, setSaveMsg] = useState("");
  // v33 PR-D: Snapshot-Status + dezentes Wasserzeichen-Label (abschaltbar).
  const [snapMsg, setSnapMsg] = useState("");
  const [snapWatermark, setSnapWatermark] = useState(true);
  const snapBusyRef = useRef(false); // Doppelklick-Schutz waehrend toBlob/share
  const fileInputRef = useRef(null); // versteckter <input type=file> fuer Import
  // Solver-Konvergenzwarnung (CN-Fixpunkt nicht konvergiert -> Parameter zu gross)
  const [solverWarn, setSolverWarn] = useState(false);
  // Divergenzwarnung: explizites Verfahren (Euler) ist fuer die Schroedinger-
  // gleichung instabil und entgleist ueber lange Laeufe (Inf/NaN). Wird abgefangen.
  const [solverDiverged, setSolverDiverged] = useState(false);
  // Waehlbare Randbedingung fuer den booleschen Modus (web-fundiert, 4 kanonische
  // BCs): "null" = feste Wand (fehlende Nachbarn zaehlen als tot, Standard) |
  // "adiabatic" = reflektierende Wand (fehlender Nachbar spiegelt die Randzelle
  // selbst). Im rval-Modus sind die Diffusionsregeln bereits adiabatisch.
  const [boundaryMode, setBoundaryMode] = useState("null");
  // Randzellen-Kennzahl, gesetzt im Grid/Form-Effekt (NICHT pro Render berechnet).
  const [boundaryStat, setBoundaryStat] = useState({ count: 0, total: 0 });
  // Erweiterte Palette (Sekundaer/Tertiaer + Kreis-Stempel) schrittweise offenlegen:
  // standardmaessig eingeklappt, damit die Leinwand oben sichtbar bleibt (visuelle
  // Hierarchie + progressive disclosure, web-fundiert).
  const [showMoreColors, setShowMoreColors] = useState(false);
  const [brush, setBrush] = useState("cycle"); // cycle | CR | CB | CY | erase
  // AP-3: Long-Press-Farbrad. Hold ~500 ms ohne Bewegung > Touch-Slop oeffnet ein
  // radiales 12-Farb-Rad um den Druckpunkt; Auswahl faerbt die Zelle SOFORT und
  // setzt die aktive Pinselfarbe (Marco-Entscheid M-3 "Beides"). null = geschlossen.
  // {x,y} = Druckpunkt in CSS-Pixeln relativ zum Canvas-Wrapper; idx = getroffene Zelle.
  const [wheel, setWheel] = useState(null);
  const [pattern, setPattern] = useState("BaysGlider");
  // v33 Einwisch-Drawer (PR-B): von links einfahrendes Panel fuer Farben (Tab 1) +
  // Formen/Stempel (Tab 2). null = zu; 1 = Farben offen; 2 = Formen offen. Tab-Tipp
  // (toggleTab) ODER Handle ODER Edge-Swipe (Bonus) oeffnet; Feld bleibt rechts sichtbar.
  const [drawer, setDrawer] = useState(null);
  // v33 Stempel-Konfiguration. typ: ring|disc|hex|brush; size = Hex-Ring-Distanz n
  // (1..4, Audit-P1.2 statt min(R,C)*0.42); kcols = symmetrische Farbanzahl 1..3
  // (Audit: 6n teilbar durch 1/2/3 -> restfreie Sektoren). Refs fuer den Tap-Handler.
  const [stampType, setStampType] = useState("ring"); // ring | disc | hex | brush
  const [stampSize, setStampSize] = useState(2);       // n = 1..4 Ringe
  const [stampK, setStampK] = useState(1);             // 1..3 Farben symmetrisch
  const stampTypeRef = useRef(stampType); useEffect(() => { stampTypeRef.current = stampType; }, [stampType]);
  const stampSizeRef = useRef(stampSize); useEffect(() => { stampSizeRef.current = stampSize; }, [stampSize]);
  const stampKRef = useRef(stampK); useEffect(() => { stampKRef.current = stampK; }, [stampK]);
  // Stempel-Modus aktiv? Im Drawer Tab 2 (Formen) -> Tap aufs Feld setzt einen
  // Stempel statt einzelner Zelle. Ref fuer den Pointer-Handler (kein Re-Render-Lag).
  const stampModeRef = useRef(false);
  useEffect(() => { stampModeRef.current = (drawer === 2); }, [drawer]);
  const stampPvRef = useRef(null); // Live-Mini-Vorschau des Stempels im Drawer
  const [gen, setGen] = useState(0);
  const [stats, setStats] = useState({ pop: 0, cnt: [0,0,0,0,0,0,0,0,0,0,0,0,0], density: 0, births: 0, deaths: 0, sps: 0, hist: [] });
  const [zoomLbl, setZoomLbl] = useState(1);
  const [showAxioms, setShowAxioms] = useState(false);
  const [ax, setAx] = useState({ a1: false, a2: false, a3: false, a4: false });
  const [a5, setA5] = useState("off");
  const [watzOnly, setWatzOnly] = useState(false);
  const [ruleSrc, setRuleSrc] = useState("tot"); // "tot" totalistisch | "int" isotrop-nicht-totalistisch
  const [showLegend, setShowLegend] = useState(false);
  // AP-4: 1-Seiten-Mobile-Layout. "compact" = schmaler Hochkant-Viewport (Handy):
  //   Canvas fuellt die Flaeche, Kern-Controls bleiben als feste Leiste sichtbar,
  //   ALLE Sekundaer-Controls wandern in ein einklappbares Bottom-Sheet (Menue).
  //   Auf breiteren Viewports (Desktop, >=768px) ist alles weiterhin inline
  //   sichtbar (kein Desktop-Regress; bestehende e2e laufen bei 1280 weiter).
  // SSR-/Test-sicher: matchMedia kann fehlen -> Fallback "nicht compact".
  const [compact, setCompact] = useState(() => {
    if (typeof window === "undefined" || !window.matchMedia) return false;
    return window.matchMedia("(max-width: 767px)").matches;
  });
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(max-width: 767px)");
    const onChange = () => setCompact(mq.matches);
    onChange();
    // addEventListener (modern) mit addListener-Fallback (aeltere Safari).
    if (mq.addEventListener) { mq.addEventListener("change", onChange); return () => mq.removeEventListener("change", onChange); }
    mq.addListener(onChange); return () => mq.removeListener(onChange);
  }, []);
  // v33-Layout (PR-A): aktiver Tab-Panel-Overlay. null = kein Panel (Feld maximal);
  // 1 Farben | 2 Formen | 3 Hex-Regeln | 4 Physik. Tab-Tipp auf den aktiven Tab
  // schliesst (toggle). Das Panel ueberlagert das Feld (Feld bleibt darunter sichtbar).
  const [activeTab, setActiveTab] = useState(null);
  // v33 PR-B: Tabs 1 (Farben) + 2 (Formen) oeffnen den LINKS-Drawer; Tabs 3/4
  // (Regeln/Physik) bleiben Voll-Overlay. Tab-Tipp auf den aktiven schliesst (toggle).
  const toggleTab = (id) => {
    if (id === 1 || id === 2) {
      setActiveTab(null);
      setDrawer((cur) => (cur === id ? null : id));
    } else {
      setDrawer(null);
      setActiveTab((cur) => (cur === id ? null : id));
    }
  };
  // Stempel-Modus an, sobald der Drawer auf Tab 2 (Formen) steht und Stempeltyp
  // gewaehlt ist. Ref, damit der Pointer-Handler ohne Re-Render-Lag liest.
  useEffect(() => { compactRef.current = compact; }, [compact]);
  // Farbmodus: "quad" = QuadLife-farbinvariant (State of the Art),
  //            "mix" = subtraktiver Hue-Mix, "drift" = Verfaerben (experimentell)
  const [colorMode, setColorMode] = useState("quad");
  // Simulationsmodus: "life" = boolesche farbinvariante Engine (Default),
  //                   "rval" = reellwertig (Schneeflocke/Wasser/HQST).
  const [simMode, setSimMode] = useState("life");
  const [rvalRule, setRvalRule] = useState("snow");
  // AP-1 OffscreenCanvas-Worker (Stufe 1): Sim + Raster-Render off-main-thread.
  // Feature-detektiert (fail-closed) + OPT-IN: Default AUS, damit der bewaehrte
  // Haupt-Thread-Pfad (inkl. aller Gesten/Path2D-Detail/inkrementell) unveraendert
  // laeuft. Ist OffscreenCanvas nicht verfuegbar (alte Browser/Safari), bleibt der
  // Schalter ausgeblendet und der Main-Thread-Pfad ist der Fallback.
  const compactRef = useRef(false);
  const [workerSupported] = useState(() => supportsOffscreenWorker());
  const [workerMode, setWorkerMode] = useState(false);
  // Auto-Worker (Marco-Entscheid M-2): bei Riesen-Gittern (>= HQST_CELL_CAP Zellen)
  // wird der Worker-Modus AUTOMATISCH eingeschaltet, sofern OffscreenCanvas
  // verfuegbar ist - der Haupt-Thread friert dort sonst ein (Data AP-D2). Der
  // User-Schalter gewinnt aber immer: hat der User den Worker auf einem Riesen-
  // Gitter bewusst AUSgeschaltet, merkt sich dieser Ref den Override und die
  // Automatik draengt ihn NICHT erneut auf. null = keine bewusste User-Wahl
  // (Automatik darf entscheiden); true/false = letzte bewusste User-Wahl.
  const userWorkerPrefRef = useRef(null);
  // Einmalige, plain-sprachliche Notiz, wenn die Automatik den Worker einschaltet.
  const [autoWorkerNotice, setAutoWorkerNotice] = useState(false);
  const [canvasKey, setCanvasKey] = useState(0); // transferControlToOffscreen ist
  // irreversibel je Canvas-Element -> beim Moduswechsel ein frisches Element erzwingen.
  const workerRef = useRef(null);
  const workerActiveRef = useRef(false); // true = Worker rendert; Main-Loop pausiert Render

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
  const dirtyRef = useRef(true);     // starkes Signal: Vollredraw (Zoom/Pan/Modus/Groesse)
  // Inkrementelles Neuzeichnen (State of the Art fuer grosse Gitter, nur life-Modus):
  // stepDirtyRef markiert einen reinen Simulationsschritt bei stabiler Ansicht;
  // dann werden nur die seit dem letzten Bild geaenderten Zellen neu gezeichnet.
  // prevColorRef ist das "Gedaechtnis" des zuletzt gezeichneten Zustands.
  // Das starke dirtyRef hat IMMER Vorfahrt (sonst Bildfehler bei Ansichtsaenderung).
  const stepDirtyRef = useRef(false);
  const prevColorRef = useRef(new Uint8Array(N));
  const prevGhostRef = useRef(new Uint8Array(N)); // Gedaechtnis der Geister-Ebene
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
  const overlayRef = useRef(null); // v33.0.2: Rahmen-Umriss-Overlay (immer Main-Thread,
  // auch wenn die Feld-Canvas an den Worker übergeben ist -> Umriss bleibt sichtbar)
  const overlaySigRef = useRef(""); // Redraw-Guard: nur bei View-/Frame-/Grid-Änderung
  const wrapRef = useRef(null);
  const refitRef = useRef(null); // AP-4: aktuelle fit()-Funktion (Layout-Reflow-Refit)
  const undoRef = useRef([]);

  const cfg = useRef({ ruleIdx, torusOn, ax, a5, R, C, watzOnly, ruleSrc });
  useEffect(() => { cfg.current = { ruleIdx, torusOn, ax: { ...ax, colorMode }, a5, R, C, watzOnly, ruleSrc, sysT: sysTheory, sysSp: sysSetpoint, openSys, solverId, bcMode: boundaryMode }; }, [ruleIdx, torusOn, ax, a5, R, C, watzOnly, colorMode, ruleSrc, sysTheory, sysSetpoint, openSys, solverId, boundaryMode]);
  const runRef = useRef(running); useEffect(() => { runRef.current = running; }, [running]);
  const spRef = useRef(SPEEDS[speedIdx]); useEffect(() => { spRef.current = SPEEDS[speedIdx]; }, [speedIdx]);
  const brushRef = useRef(brush); useEffect(() => { brushRef.current = brush; }, [brush]);
  const simRef = useRef(simMode); useEffect(() => { simRef.current = simMode; }, [simMode]);
  const frameRef = useRef(frameShape); useEffect(() => { frameRef.current = frameShape; }, [frameShape]);
  const circleRadiusRef = useRef(circleRadius); useEffect(() => { circleRadiusRef.current = circleRadius; }, [circleRadius]);
  const ellipseARef = useRef(ellipseA); useEffect(() => { ellipseARef.current = ellipseA; }, [ellipseA]);
  const ellipseBRef = useRef(ellipseB); useEffect(() => { ellipseBRef.current = ellipseB; }, [ellipseB]);
  const freeformPolyRef = useRef(freeformPolygon); useEffect(() => { freeformPolyRef.current = freeformPolygon; }, [freeformPolygon]);
  const freeformDrawRef = useRef(freeformDrawing); useEffect(() => { freeformDrawRef.current = freeformDrawing; }, [freeformDrawing]);
  const freeformDraftRef = useRef(null); // laufender Polygonzug (Live-Vorschau)
  const hqstLockedRef = useRef(hqstLocked); useEffect(() => { hqstLockedRef.current = hqstLocked; }, [hqstLocked]);
  const seedRef = useRef(seed); useEffect(() => { seedRef.current = seed; }, [seed]);
  const solverWarnRef = useRef(false);
  const solverDivergedRef = useRef(false);
  const rvalRef = useRef(rvalRule); useEffect(() => { rvalRef.current = rvalRule; }, [rvalRule]);

  // Grid-Wechsel: Buffer + Geometrie neu
  useEffect(() => {
    colorRef.current = new Uint8Array(N); ghostRef.current = new Uint8Array(N); ageRef.current = new Uint16Array(N);
    nColorRef.current = new Uint8Array(N); nGhostRef.current = new Uint8Array(N); nAgeRef.current = new Uint16Array(N);
    prevColorRef.current = new Uint8Array(N); stepDirtyRef.current = false;
    prevGhostRef.current = new Uint8Array(N);
    fieldRef.current = new Float32Array(N); fieldImRef.current = new Float32Array(N);
    fBufRef.current = new Float32Array(N); fBufImRef.current = new Float32Array(N);
    fRecRef.current = new Uint8Array(N);
    hqstWorkRef.current = mkHqstWork(N);
    neighRef.current = buildNeighbors(R, C, frameShape, frameOptsFor(frameShape, { circleRadius, ellipseA, ellipseB, polygon: freeformPolygon }));
    // Randzellen-Zahl GENAU HIER berechnen, wo das Feld neu entsteht (frischer Wert,
    // keine Render-Reihenfolge-Falle). Speist die transparente Randanzeige.
    { const nb = neighRef.current; let bc = 0; const bd = nb.bnd; for (let i = 0; i < bd.length; i++) if (bd[i]) bc++; setBoundaryStat({ count: bc, total: nb.inCount || 0 }); }
    // Welt-Zentren je Zelle (einmal pro Grid) fuer den ImageData-Raster-Fast-Path.
    { const cx = new Float32Array(N), cy = new Float32Array(N);
      for (let i = 0; i < N; i++) { const ctr = hexCenter((i / C) | 0, i % C, HR); cx[i] = ctr.x; cy[i] = ctr.y; }
      cellCxRef.current = cx; cellCyRef.current = cy; }
    rasterImgRef.current = null; // bei Grid-Wechsel ImageData neu anlegen
    undoRef.current = []; originRef.current = null; setHasOrigin(false); // Gitter neu -> Urzustand verwerfen
    tickRef.current = 0; setGen(0);
    histRef.current = []; statsRef.current = { births: 0, deaths: 0 };
    setStats({ pop: 0, cnt: [0,0,0,0,0,0,0,0,0,0,0,0,0], density: 0, births: 0, deaths: 0, sps: 0, hist: [] });
    setRunning(false); dirtyRef.current = true;
    fitView();
    // v33 P2-C (Codex-Review): Laeuft schon ein AKTIVER Worker, muss seine Geometrie
    // IN-PLACE aktualisiert werden (kein Respawn -> transferControlToOffscreen ist
    // je Canvas-Element irreversibel; der Radius-Slider feuert zudem roh pro Drag-
    // Step). Ohne dies bliebe der Worker auf der STALEN init-Geometrie (alte Maske/
    // Grid/N) stehen -> bei Kreis/Ellipse sogar N-Desync. NUR wenn bereits aktiv:
    // der erste Eintritt in bigGrid laeuft weiter ueber den canvasKey-Init-Pfad
    // (Auto-Worker-Effekt) -> kein Doppel-Setup. Reihenfolge: fitView() OBEN hat
    // viewRef bereits frisch gesetzt; diese frische View geht mit.
    if (workerActiveRef.current && workerRef.current) {
      const w = workerRef.current;
      const dpr = window.devicePixelRatio || 1;
      const v = viewRef.current;
      const canvas = canvasRef.current;
      // Canvas-Pixelmasse aus dem realen Element (vom Init/Resize gesetzt). Falls
      // (noch) nicht gemessen, liefert applyGeometry-Fallback die alte Groesse.
      const width = canvas ? canvas.width : undefined;
      const height = canvas ? canvas.height : undefined;
      w.postMessage({
        type: "regeom",
        R, C, hr: HR, shape: frameShape,
        circleRadius, ellipseA, ellipseB, polygon: freeformPolygon,
        dpr, width, height,
        view: { s: v.s, tx: v.tx, ty: v.ty }, tick: 0,
        // Neues Grid = Reset (Felder leer): KEINE col/fld mitsenden -> applyGeometry
        // alloziert frische Nullarrays auf das neue N (konsistent mit Main-Rebuild).
        CX: cellCxRef.current.slice().buffer, CY: cellCyRef.current.slice().buffer,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sizeIdx, frameShape, circleRadius, ellipseA, ellipseB, freeformPolygon]);

  // AP-1: aktuellen Engine-Config-Snapshot fuer den Worker bauen (Spiegel von
  // cfg.current). Reine Daten (struktur-klonbar), kein Funktions-/Ref-Inhalt.
  const buildWorkerCfg = useCallback(() => ({
    ruleIdx, torusOn,
    ax: { ...ax, colorMode },
    a5, watzOnly, ruleSrc, solverId,
    sysT: sysTheory, sysSp: sysSetpoint, bcMode: boundaryMode, openSys,
  }), [ruleIdx, torusOn, ax, colorMode, a5, watzOnly, ruleSrc, solverId, sysTheory, sysSetpoint, boundaryMode, openSys]);

  // AP-4: einheitliche Canvas-CSS-Groesse fuer ALLE Pfade (Main + Worker, Init +
  // Resize). Im compact-Modus (Handy, 1-Seiten-Layout) fuellt die Canvas die reale
  // Flaeche des flex-grow-Wrappers (groesstmoegliche Leinwand). Auf Desktop bleibt
  // die bewaehrte Formel min(innerHeight*0.5, 540) -> Desktop-Canvas-Masse und damit
  // die Visual-Baselines (bei 1280x800) bit-stabil. Untergrenze 160px verhindert
  // eine 0px-Canvas, falls der Wrapper waehrend eines Layout-Frames noch nicht
  // gemessen ist.
  const canvasCssSize = () => {
    const wrap = wrapRef.current;
    const cw = wrap ? wrap.clientWidth : (canvasRef.current ? canvasRef.current.clientWidth : 300);
    let ch;
    if (compactRef.current && wrap) {
      ch = Math.max(160, Math.round(wrap.clientHeight));
    } else {
      ch = Math.min(Math.round(window.innerHeight * 0.5), 540);
    }
    return { cw, ch };
  };

  // Auto-Worker (Marco-Entscheid M-2): zentrale Stelle, die ALLE Gitter-Wechsel
  // abdeckt (Groessen-Select, Form, Kreis-Radius) - sie haengt nur an der
  // abgeleiteten Schwelle `bigGrid` (= N >= HQST_CELL_CAP), nicht an den einzelnen
  // Controls (keine 3 Duplikate). Beim Eintritt in ein Riesen-Gitter wird der
  // Worker AUTOMATISCH eingeschaltet, sofern OffscreenCanvas verfuegbar ist UND
  // der User ihn nicht zuvor bewusst ausgeschaltet hat (userWorkerPrefRef === false).
  // Beim Verlassen des Riesen-Gitters bleibt der Worker-Zustand wie zuletzt gesetzt
  // (kein Auto-Aus). Ohne OffscreenCanvas passiert hier nichts -> Fallback-Pfad +
  // separate Riesen-Gitter-Warnung im UI.
  const workerModeRef = useRef(workerMode);
  useEffect(() => { workerModeRef.current = workerMode; }, [workerMode]);
  // HQST ist ueber dem Cap GESPERRT (Crank-Nicolson auch off-thread unzumutbar) -
  // dort greift die bestehende Sperr-UI + Step-Skip (PR#43), NICHT der Auto-Worker.
  const hqstActiveLocked = simMode === "rval" && rvalRule === "hqst" && hqstLocked;
  useEffect(() => {
    if (!workerSupported) return;            // Fallback-Geraete: Automatik aus
    if (!bigGrid) return;                    // kleines Gitter: nie automatisch an
    if (hqstActiveLocked) return;            // gesperrtes HQST: Sperre statt Worker
    if (userWorkerPrefRef.current === false) return; // User-Override "aus" gewinnt
    if (workerModeRef.current) return;       // schon an -> nichts tun (kein Flackern)
    workerModeRef.current = true;            // SYNCHRON: schliesst das Render-Race
    // (Main-Loop darf ab sofort nicht mehr zeichnen, bevor transferiert wird).
    setWorkerMode(true);
    setAutoWorkerNotice(true);               // einmalige plain-Notiz zeigen
    setCanvasKey((k) => k + 1);              // frisches Canvas-Element fuer Transfer
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bigGrid, workerSupported, hqstActiveLocked]);

  // AP-1 Worker-Lebenszyklus: spinnt den OffscreenCanvas-Worker hoch, wenn
  // workerMode aktiv (nur moeglich wenn feature-detektiert). transferControlToOffscreen
  // ist je Canvas-Element irreversibel -> canvasKey erzwingt ein frisches Element
  // bei jedem Moduswechsel. Wird der Worker abgeschaltet (oder unmount), uebernimmt
  // wieder der bewaehrte Main-Thread-Pfad (Fallback) auf einer neuen Canvas.
  useEffect(() => {
    if (!workerMode || !workerSupported) { workerActiveRef.current = false; return; }
    const canvas = canvasRef.current; if (!canvas) return;
    let worker = null, disposed = false;
    try {
      // Canvas-Pixelmasse vor dem Transfer sicherstellen (fit() laeuft sonst erst spaeter).
      const dpr = window.devicePixelRatio || 1;
      const { cw, ch } = canvasCssSize();
      canvas.style.width = cw + "px"; canvas.style.height = ch + "px";
      canvas.width = Math.round(cw * dpr); canvas.height = Math.round(ch * dpr);
      const off = canvas.transferControlToOffscreen();
      worker = new Worker(new URL("./worker/render-worker.js", import.meta.url), { type: "module" });
      workerRef.current = worker;
      worker.onmessage = (e) => {
        const m = e.data;
        if (m.type === "ready") {
          workerActiveRef.current = true;
          // P2 (Codex-Review 2026-06-08): Mutationen im Init-Fenster (Random/Leeren
          // VOR "ready") liefen ins Leere (syncWorkerState returnte, workerActive=false).
          // Jetzt den aktuellen Main-Zustand einmal nachreichen -> kein Start-Blank.
          syncWorkerState();
        }
        else if (m.type === "telemetry") {
          setGen(m.tick);
          spsRef.current = m.sps;
          if (m.solverWarn) setSolverWarn(true);
          if (m.diverged) { setSolverDiverged(true); setRunning(false); }
        } else if (m.type === "snapshot") {
          // P1 (Codex-Review 2026-06-08): Pull des EVOLVIERTEN Worker-Zustands zurück
          // in die Main-Arrays (bei Pause angefordert). Hält colorRef/age/field frisch,
          // damit additive Edits (Stempel/Pattern/Undo), Save UND der nächste
          // syncWorkerState NICHT auf stalem Pre-Run-Stand operieren (= Worker-
          // Korruption + Gen-Reset). Single source of truth: laufend Worker, bei
          // Pause zurück an Main.
          if (m.col) colorRef.current.set(new Uint8Array(m.col));
          if (m.gh) ghostRef.current.set(new Uint8Array(m.gh));
          if (m.age) ageRef.current.set(new Uint16Array(m.age));
          if (m.fld) fieldRef.current.set(new Float32Array(m.fld));
          if (m.fim) fieldImRef.current.set(new Float32Array(m.fim));
          if (typeof m.tick === "number") { tickRef.current = m.tick; setGen(m.tick); }
          updatePop(); dirtyRef.current = true;
        } else if (m.type === "error") {
          // Worker konnte nicht initialisieren -> ehrlicher Fallback auf Main-Thread.
          // eslint-disable-next-line no-console
          console.warn("[GolHex] Worker-Init fehlgeschlagen, Fallback Main-Thread:", m.message);
          workerActiveRef.current = false; setWorkerMode(false); setCanvasKey((k) => k + 1);
        }
      };
      worker.onerror = () => {
        workerActiveRef.current = false; setWorkerMode(false); setCanvasKey((k) => k + 1);
      };
      // fitView fuer den Worker spiegeln (gleiche Mathematik wie Main-fitView).
      const { W, H } = worldSize(R, C, HR);
      const vs = Math.min((canvas.width / dpr) / W, (canvas.height / dpr) / H) * 0.98;
      const view = { s: vs, tx: ((canvas.width / dpr) - W * vs) / 2, ty: ((canvas.height / dpr) - H * vs) / 2 };
      viewRef.current = { ...view, fit: vs };
      worker.postMessage({
        type: "init", canvas: off,
        R, C, hr: HR, shape: frameShape, circleRadius, ellipseA, ellipseB, polygon: freeformPolygon, dpr,
        cfg: buildWorkerCfg(), mode: simMode, rule: rvalRule,
        speedMs: SPEEDS[speedIdx], view, tick: tickRef.current,
        col: colorRef.current.slice().buffer, gh: ghostRef.current.slice().buffer, age: ageRef.current.slice().buffer,
        fld: fieldRef.current.slice().buffer, fim: fieldImRef.current.slice().buffer,
        CX: cellCxRef.current.slice().buffer, CY: cellCyRef.current.slice().buffer,
      }, [off,
        // transferierte Buffer (Performance, kein Copy)
      ]);
    } catch (err) {
      // Jeder Fehler beim Transfer/Spawn -> sauberer Fallback auf den Main-Thread.
      // eslint-disable-next-line no-console
      console.warn("[GolHex] OffscreenCanvas-Worker nicht startbar, Fallback Main-Thread:", err && err.message);
      workerActiveRef.current = false;
      if (worker) { try { worker.terminate(); } catch { /* ignore */ } }
      workerRef.current = null;
      // Modus zuruecknehmen + frische Canvas fuer den Main-Thread-Pfad.
      setWorkerMode(false); setCanvasKey((k) => k + 1);
      return;
    }
    return () => {
      disposed = true;
      workerActiveRef.current = false;
      if (worker) { try { worker.postMessage({ type: "dispose" }); worker.terminate(); } catch { /* ignore */ } }
      if (workerRef.current === worker) workerRef.current = null;
      dirtyRef.current = true; // Main-Thread-Pfad soll nach Rueckkehr neu zeichnen
      void disposed;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workerMode, canvasKey, workerSupported]);

  // AP-1: laufende Worker-Sim ueber run/config/view auf dem Laufenden halten.
  useEffect(() => {
    const w = workerRef.current; if (!w || !workerActiveRef.current) return;
    w.postMessage({ type: "run", running });
  }, [running]);
  useEffect(() => {
    const w = workerRef.current; if (!w || !workerActiveRef.current) return;
    w.postMessage({ type: "config", cfg: buildWorkerCfg(), mode: simMode, rule: rvalRule, speedMs: SPEEDS[speedIdx] });
  }, [buildWorkerCfg, simMode, rvalRule, speedIdx]);

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
    // Spaltenstruktur aendert sich bei Modus-Wechsel (Lebenswelt 5 vs Physik 3).
    // Wechsel -> Aufzeichnung sauber neu beginnen, statt inkonsistente Zeilen zu mischen.
    const sameCols = rec.cols.length === cols.length && rec.cols.every((c, i) => c === cols[i]);
    if (rec.rows.length === 0 || !sameCols) { rec.cols = cols.slice(); rec.rows = []; }
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
        // AP-2: HQST bei Riesen-Gittern gesperrt (Crank-Nicolson zu langsam) -> Step
        // ueberspringen statt den Tab einzufrieren. Die UI zeigt die ehrliche Meldung.
        if (hqstLockedRef.current) { runRef.current = false; setRunning(false); return; }
        const conv = stepHQST(fieldRef.current, fieldImRef.current, NL, HQST_J, HQST_V, HQST_DT, fBufRef.current, fBufImRef.current, hqstWorkRef.current, cfg.current.solverId);
        // Nur der CN-Solver liefert ein Flag; false = Fixpunkt nicht konvergiert.
        if (conv === false && !solverWarnRef.current) { solverWarnRef.current = true; }
        [fieldRef.current, fBufRef.current] = [fBufRef.current, fieldRef.current];
        [fieldImRef.current, fBufImRef.current] = [fBufImRef.current, fieldImRef.current];
        // DIVERGENZ-WAECHTER (web-fundiert, arxiv 1101.3161 NaNChecker-Muster):
        // explizite Verfahren wie Euler sind fuer die Schroedingergleichung
        // instabil und wachsen exponentiell, bis Float32 ueberlaeuft (Inf/NaN).
        // Eine ungueltige Zahl ist "ansteckend" und wuerde Statistik + Recorder
        // verseuchen. Daher: nach jedem Schritt die Amplitude pruefen; entgleist
        // -> Feld nullen, Lauf stoppen, ehrliche Warnung an den Nutzer.
        {
          const re = fieldRef.current, im = fieldImRef.current; let maxA = 0, bad = false;
          for (let i = 0; i < n; i++) {
            const a = Math.abs(re[i]) + Math.abs(im[i]);
            if (a > maxA) maxA = a;
            if (!Number.isFinite(a)) { bad = true; break; }
          }
          // Schranke aus HQST_DIVERGENCE_BOUND (aus J/V/dt abgeleitet, s.o.):
          // normerhaltende Wellen bleiben O(1); ein Anwachsen darueber ist
          // eindeutig Verfahrensdivergenz (CN/RK4 bleiben weit darunter).
          if (bad || maxA > HQST_DIVERGENCE_BOUND) {
            re.fill(0); im.fill(0);
            solverDivergedRef.current = true;
            runRef.current = false; // Lauf anhalten, sonst sofortige Re-Divergenz
          }
        }
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
    const { ruleIdx: ri, torusOn: to, ax: A, a5: A5, watzOnly: wO, ruleSrc: rs, sysT, sysSp, bcMode: bc } = cfg.current;
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
      const self = col[i], selfAlive = self !== 0;
      const adia = bc === "adiabatic";
      for (let k = 0; k < 6; k++) {
        const j = NL[base + k];
        if (j < 0) {
          // Adiabatische (reflektierende) Wand: der fehlende Nachbar ist eine
          // Spiegelung der Randzelle selbst (web-fundiert: arxiv 2406.06195,
          // 1607.02291). Bei "null" (Standard) traegt er nichts bei = tote Wand.
          if (adia) {
            if (selfAlive) { cnt[self]++; live++; sx += COSH[self]; sy += SINH[self]; mask |= (1 << k); }
            else if (A.a4 && gh[i]) live++;
          }
          continue;
        }
        const cj = col[j];
        if (cj !== 0) { cnt[cj]++; live++; sx += COSH[cj]; sy += SINH[cj]; mask |= (1 << k); }
        else if (A.a4 && gh[j]) live++;
      }
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
    // Schwaches Signal: reiner Simulationsschritt -> inkrementelles Neuzeichnen
    // erlaubt (nur wenn die Ansicht stabil ist; dirtyRef hat sonst Vorfahrt).
    tickRef.current = tick; stepDirtyRef.current = true;
    statsRef.current.births = births; statsRef.current.deaths = deaths;
    loopStepRef.current += 1;
  }, []);

  // --- ImageData-Raster-Fast-Path (winzige Zellen / XXL) ---------------------
  // Direkte Pixel-Block-Writes statt Path2D-Hexe: O(Pixel) flach, unabhaengig von
  // der Zahl aktiver Zellen. Hex-Form ist bei <~3.5px/Zelle ohnehin nicht
  // aufgeloest. Behandelt life- UND rval-Modus (Snow/Water/HQST/Collatz/Genetik).
  const drawRaster = useCallback(() => {
    const canvas = canvasRef.current; if (!canvas) return;
    // Fail-safe: eine an den Worker transferierte Canvas wirft bei getContext().
    // Im (engen) Race-Fenster zwischen transferControlToOffscreen und der "ready"-
    // Meldung kann der Main-Thread sonst die Seite crashen -> hier sauber abbrechen,
    // der Worker-Pfad ist dann zustaendig.
    let ctx; try { ctx = canvas.getContext("2d", { alpha: false }); } catch { return; }
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    const Wc = canvas.width, Hc = canvas.height;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (!rasterImgRef.current || rasterImgRef.current.width !== Wc || rasterImgRef.current.height !== Hc) rasterImgRef.current = ctx.createImageData(Wc, Hc);
    const img = rasterImgRef.current, d32 = new Uint32Array(img.data.buffer);
    const g = gridRef.current, hr = g.hr;
    const { s, tx, ty } = viewRef.current;
    const CX = cellCxRef.current, CY = cellCyRef.current;
    // Geteilter, reiner Pixel-Pfad (src/lib/raster-render.js) - EINE Quelle der
    // Wahrheit, die auch der OffscreenCanvas-Worker nutzt. Output byte-identisch.
    renderRaster(d32, {
      Wc, Hc, hr, s, tx, ty, dpr, CX, CY,
      mode: simRef.current,
      rule: rvalRef.current,
      col: colorRef.current,
      fld: fieldRef.current, fim: fieldImRef.current,
    });
    ctx.putImageData(img, 0, 0);
    ctx.setTransform(dpr * s, 0, 0, dpr * s, dpr * tx, dpr * ty);
    drawFrame(ctx, s);
    // Gedaechtnis fuer das inkrementelle Neuzeichnen synchronisieren: nach einem
    // Fast-Path-Vollredraw im life-Modus muss prevColorRef/prevGhostRef den gerade
    // gezeichneten Zustand kennen, sonst difft der naechste Teilredraw (draw(true),
    // pxR<4) gegen einen veralteten Snapshot -> Bildfehler.
    if (simRef.current === "life") { prevColorRef.current.set(colorRef.current); prevGhostRef.current.set(ghostRef.current); }
    dirtyRef.current = false; stepDirtyRef.current = false;
  }, []);

  // --- Render ---------------------------------------------------------------
  const draw = useCallback((incremental) => {
    const canvas = canvasRef.current; if (!canvas) return;
    // Fail-safe gegen eine bereits an den Worker transferierte Canvas (s. drawRaster).
    let ctx; try { ctx = canvas.getContext("2d", { alpha: false }); } catch { return; }
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    const Wc = canvas.width, Hc = canvas.height;
    const { s, tx, ty } = viewRef.current;
    const g = gridRef.current; const hr = g.hr, r0 = g.rows, c0 = g.cols;
    const pxRgate = hr * s;

    // --- ImageData-Raster-Fast-Path (winzige Zellen / XXL, Vollredraw) ---------
    // Greift NUR bei Vollredraw (!incremental): direkte Pixel-Block-Writes statt
    // Path2D-Hexe, O(Pixel) flach, unabhaengig von der Zahl aktiver Zellen. Loest
    // das XXL-Vollfeld (Snow/Water), wo der Chunked-Path-Pfad zur Freeze-Klasse
    // degeneriert (in-Lineage v30: 18k Subpaths ~0.7fps; bench-render-paths.mjs:
    // ImageData 50k Zellen = 1.18ms/Frame). Koexistenz mit dem inkrementellen
    // Pfad: inkrementell (draw(true)) hat Vorfahrt fuer Schritt-Updates (wenige
    // geaenderte Zellen -> billiger als ein 50k-Pixel-Refill); der Fast-Path
    // beschleunigt Vollredraws (Grid-Wechsel/Zoom/rval). Disjunkte Trigger.
    if (!incremental && pxRgate < 3.5) { drawRaster(); return; }

    // Vollredraw startet mit vollflaechigem Loeschen; der inkrementelle Pfad
    // (unten) loescht NUR die geaenderten Zellen selektiv und darf NICHT
    // vollflaechig loeschen (sonst verschwinden die unveraenderten Zellen).
    if (!incremental) {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = T.bg; ctx.fillRect(0, 0, Wc, Hc);
    }
    ctx.setTransform(dpr * s, 0, 0, dpr * s, dpr * tx, dpr * ty);

    const cosA = [], sinA = [];
    for (let k = 0; k < 6; k++) { const a = -Math.PI / 2 + k * PI3; cosA.push(Math.cos(a)); sinA.push(Math.sin(a)); }
    const addHex = (path, x, y, rr) => {
      path.moveTo(x + rr * cosA[0], y + rr * sinA[0]);
      for (let k = 1; k < 6; k++) path.lineTo(x + rr * cosA[k], y + rr * sinA[k]);
      path.closePath();
    };
    // Allokationsfreie Variante: berechnet das Zellzentrum inline aus dem Index,
    // ohne pro Zelle ein {x,y}-Objekt zu erzeugen (vermeidet GC-Druck bei XXL).
    // Spiegelt hexCenter: x = PAD + S3*hr*(col + (row&1?0.5:0)), y = PAD + 1.5*hr*row.
    const padHr = PAD(hr), wHr = S3 * hr, vHr = 1.5 * hr;
    const addHexIdx = (path, i, rr) => {
      const row = (i / c0) | 0, c = i - row * c0;
      const x = padHr + wHr * (c + ((row & 1) ? 0.5 : 0)), y = padHr + vHr * row;
      path.moveTo(x + rr * cosA[0], y + rr * sinA[0]);
      for (let k = 1; k < 6; k++) path.lineTo(x + rr * cosA[k], y + rr * sinA[k]);
      path.closePath();
    };
    const pxR = hr * s;

    // --- Inkrementelles Neuzeichnen (State of the Art, nur life-Modus) --------
    // Bei stabiler Ansicht nach einem Simulationsschritt: nur die Zellen neu
    // zeichnen, deren Farbe ODER Geisterzustand sich seit dem letzten Bild
    // geaendert hat. Beide veraenderlichen Ebenen werden ueber ein eigenes
    // Gedaechtnis (prevColorRef/prevGhostRef) per Diff gefuehrt (web-fundiert,
    // Chidi Williams "Redraw Only The Diff": je veraenderliche Ebene ein Diff).
    // KORREKTHEITSBEDINGUNG: nur pxR<4, denn Gitterlinien (ab pxR>=4) und Glow
    // (ab pxR>=5) sind globale/ueberlappende Ebenen, die sich nicht lokal
    // ueberzeichnen lassen. Beim Hineinzoomen sind ohnehin wenige Zellen sichtbar
    // -> Vollredraw guenstig. Verifiziert mit allen Ebenen (test_incremental_layers).
    if (incremental && simRef.current === "life" && pxR < 4) {
      const col = colorRef.current, prev = prevColorRef.current;
      const gh = ghostRef.current, pgh = prevGhostRef.current;
      // Pro geaenderter Zelle: erst loeschen, dann Geist (Untergrund) + Farbe.
      const erase = new Path2D(); let anyErase = false;
      const ghostP = new Path2D(); let anyGhost = false;
      const byColor = {};
      for (let i = 0; i < col.length; i++) {
        if (col[i] === prev[i] && gh[i] === pgh[i]) continue; // nichts geaendert
        addHexIdx(erase, i, hr * 1.0); anyErase = true;
        if (gh[i]) { addHexIdx(ghostP, i, hr * 0.78); anyGhost = true; }
        const cc = col[i];
        if (cc) { (byColor[cc] || (byColor[cc] = new Path2D())); addHexIdx(byColor[cc], i, hr * 0.92); }
        prev[i] = col[i]; pgh[i] = gh[i];
      }
      if (anyErase) { ctx.fillStyle = T.bg; ctx.fill(erase); }
      if (anyGhost) { ctx.fillStyle = "rgba(140,196,187,0.20)"; ctx.fill(ghostP); }
      for (const cc in byColor) { ctx.fillStyle = COLHEX[cc]; ctx.fill(byColor[cc]); }
      drawFrame(ctx, s);
      stepDirtyRef.current = false;
      return;
    }
    // Wenn inkrementell angefordert, aber Bedingungen unsicher: Vollredraw faellt
    // automatisch durch (kein return). prevColorRef/prevGhostRef unten synchronisiert.

    // Reellwertiger Modus: jede Zelle nach Feldwert eingefaerbt.
    if (simRef.current === "rval") {
      const rule = rvalRef.current, fld = fieldRef.current, fim = fieldImRef.current;
      // Performance: Zellen nach Farbe buendeln und je Farbe EIN fill() (Batching).
      // Discrete Regeln (collatz/genes) haben endliche Farbmengen -> echtes Batching.
      if (rule === "genes") {
        for (const [g, col] of [[G_AA, geneColor(G_AA)], [G_Aa, geneColor(G_Aa)], [G_aa, geneColor(G_aa)]]) {
          const p = new Path2D(); let any = false;
          for (let i = 0; i < fld.length; i++) { if (fld[i] === g) { addHexIdx(p, i, hr * 0.92); any = true; } }
          if (any) { ctx.fillStyle = col; ctx.fill(p); }
        }
        drawFrame(ctx, s); dirtyRef.current = false; return;
      }
      // Performance: Werte in feste Farbklassen quantisieren und je Klasse EIN
      // gebatchtes fill() (statt ein Path2D + fill pro Zelle). Drastisch weniger
      // Canvas-Aufrufe bei grossen Gittern.
      const BUCKETS = 24;
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
        let bk = buckets[bi]; if (!bk) { bk = buckets[bi] = new Path2D(); }
        addHexIdx(bk, i, hr * 0.95);
      }
      for (let bi = 0; bi < BUCKETS; bi++) {
        const bk = buckets[bi]; if (!bk) continue;
        // repraesentativer Wert der Klasse fuer die Farbe
        let repV;
        if (rule === "collatz") repV = Math.pow(2, (bi + 0.5) / BUCKETS * 30);
        else if (rule === "hqst") repV = (bi + 0.5) / BUCKETS * vmax;
        else repV = (bi + 0.5) / (BUCKETS - 1);
        ctx.fillStyle = rule === "collatz" ? collatzColor(repV) : rvalColor(repV, rule);
        ctx.fill(bk);
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
      for (let r = 0; r < r0; r++) for (let c = 0; c < c0; c++) { const i = r * c0 + c; if (!dmask[i]) continue; addHexIdx(grid, i, hr * 0.95); }
      ctx.lineWidth = Math.max(0.4, 1 / s); ctx.strokeStyle = "rgba(92,240,204,0.10)"; ctx.stroke(grid);
    }

    // Ghosts (analog)
    const gp = new Path2D(); let anyG = false;
    for (let i = 0; i < gh.length; i++) if (gh[i]) { addHexIdx(gp, i, hr * 0.78); anyG = true; }
    if (anyG) { ctx.fillStyle = "rgba(140,196,187,0.20)"; ctx.fill(gp); }

    // Fuellung + Glow pro Farbe
    for (const cc of ALLCOL) {
      const fill = new Path2D(); let any = false;
      const glow = new Path2D();
      for (let i = 0; i < col.length; i++) {
        if (col[i] !== cc) continue; any = true;
        addHexIdx(fill, i, hr * 0.92);
        if (pxR >= 5) addHexIdx(glow, i, hr * 1.1);
      }
      if (!any) continue;
      const [rr, gg, bb] = COLA[cc];
      if (pxR >= 5) { ctx.fillStyle = `rgba(${rr},${gg},${bb},0.16)`; ctx.fill(glow); }
      ctx.fillStyle = COLHEX[cc]; ctx.fill(fill);
    }
    drawFrame(ctx, s);
    // Gedaechtnis fuer inkrementelles Neuzeichnen mit dem gerade gezeichneten
    // Zustand synchronisieren, sonst rechnet der naechste Teilredraw gegen einen
    // veralteten Snapshot. Nur im life-Modus relevant.
    if (simRef.current === "life") { prevColorRef.current.set(colorRef.current); prevGhostRef.current.set(ghostRef.current); }
    dirtyRef.current = false; stepDirtyRef.current = false;
  }, []);

  // Rahmen-Umriss (Box/Kreis) als Domaenengrenze zeichnen. Radius EXAKT wie in
  // buildNeighbors (gleiche Welt-Metrik * hr), damit Umriss und Maske deckungsgleich.
  const drawFrame = useCallback((ctx, s) => {
    const g = gridRef.current; const hr = g.hr, R0 = g.rows, C0 = g.cols;
    ctx.lineWidth = Math.max(1, 2 / s); ctx.strokeStyle = "rgba(92,240,204,0.5)";
    const sh = frameRef.current;
    const cr = (R0 - 1) / 2, cc = (C0 - 1) / 2;
    const ctr = hexCenter(cr, cc, hr);
    const halfW = ((C0 - 1) * S3) / 2 + S3 / 2;
    const halfH = ((R0 - 1) * 1.5) / 2 + 1.0;
    const radiusMaxWorld = Math.min(halfW, halfH);
    const radPx = radiusMaxWorld * hr; // Welt-Radius * hr = Pixel (Maximum)
    if (sh === "circle") {
      // AP-2: expliziter Radius (Gitterschritte -> Welt *1.5), auf Maximum geklemmt
      // — EXAKT die Formel aus buildNeighbors (circleRad), Umriss == Maske.
      const circleWorld = Math.min(circleRadiusRef.current * 1.5, radiusMaxWorld);
      ctx.beginPath(); ctx.arc(ctr.x, ctr.y, circleWorld * hr, 0, PI2); ctx.stroke();
    } else if (sh === "ellipse") {
      // v33 PR-E: Halbachsen EXAKT wie buildNeighbors (ellA/ellB, je geklemmt) —
      // Umriss == Maske. ctx.ellipse(cx,cy, rx,ry, rotation, start, end).
      const ellAw = Math.min(ellipseARef.current * 1.5, halfW);
      const ellBw = Math.min(ellipseBRef.current * 1.5, halfH);
      ctx.beginPath(); ctx.ellipse(ctr.x, ctr.y, ellAw * hr, ellBw * hr, 0, 0, PI2); ctx.stroke();
    } else if (sh === "freeform") {
      // v33 PR-E: Nutzer-Polygon (Welt-Koords) -> Pixel: pad + px*hr (gleiche
      // Transform wie hexCenter). Maske == Umriss (beide gegen dasselbe Polygon).
      // Live-Vorschau (Draft) hat Vorrang, sonst das committete Polygon.
      const draft = freeformDraftRef.current;
      const poly = (draft && draft.length >= 2) ? draft : freeformPolyRef.current;
      if (poly && poly.length >= 2) {
        const pad = PAD(hr);
        if (draft) ctx.setLineDash([6 / s, 4 / s]); // Vorschau gestrichelt
        ctx.beginPath();
        poly.forEach((p, idx) => {
          const x = pad + p.x * hr, y = pad + p.y * hr;
          if (idx === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        });
        if (poly.length >= 3 && !draft) ctx.closePath();
        ctx.stroke();
        if (draft) ctx.setLineDash([]);
      }
    } else if (sh === "triangle") {
      // Gleiche 3 Ecken wie der Punkt-im-Dreieck-Test (Spitze oben).
      ctx.beginPath();
      [-90, 30, 150].forEach((deg, idx) => {
        const a = deg * Math.PI / 180;
        const x = ctr.x + radPx * Math.cos(a), y = ctr.y + radPx * Math.sin(a);
        if (idx === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      });
      ctx.closePath(); ctx.stroke();
    } else if (sh === "hexagon") {
      // Umriss EXAKT aus der Maske abgeleitet (eine Quelle der Wahrheit): die 6
      // Ecken liegen hexRad Schritte in den 6 Wuerfel-Richtungen vom Zentrum.
      // Verifiziert: Ecken-BBox == Masken-BBox (test_hex_corners.mjs). Behebt den
      // Orientierungsfehler der frueheren trigonometrischen Naeherung.
      const hexRad = Math.min(Math.floor((R0 - 1) / 2), Math.floor((C0 - 1) / 2));
      const centerCube = oddRToCube(cc, cr);
      ctx.beginPath();
      for (let k = 0; k < 6; k++) {
        const cube = {
          x: centerCube.x + hexRad * CUBE_DIRS[k].x,
          y: centerCube.y + hexRad * CUBE_DIRS[k].y,
          z: centerCube.z + hexRad * CUBE_DIRS[k].z,
        };
        const off = cubeToOddR(cube);
        const p = hexCenter(off.row, off.col, hr);
        if (k === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y);
      }
      ctx.closePath(); ctx.stroke();
    } else {
      const a = hexCenter(0, 0, hr), b = hexCenter(R0 - 1, C0 - 1, hr);
      const pad = hr * 1.1;
      ctx.strokeRect(a.x - pad, a.y - pad, (b.x - a.x) + 2 * pad, (b.y - a.y) + 2 * pad);
    }
  }, []);

  // v33.0.2: Rahmen-Umriss auf das Overlay zeichnen — NUR im Worker-Modus nötig
  // (dort besitzt der Worker die Feld-Canvas und zeichnet den dünnen Umriss nicht;
  // die Zellen zeigen zwar die Form, aber bei leerem Feld fehlte jede Rahmen-Linie).
  // Eine Quelle der Wahrheit: dieselbe drawFrame() wie der Main-Thread, nur auf eine
  // separate, immer-Main-Thread Overlay-Canvas mit identischer View-Transform.
  const drawOverlayOutline = useCallback((force) => {
    const ov = overlayRef.current; if (!ov) return;
    const active = workerActiveRef.current;
    const octx = ov.getContext("2d"); if (!octx) return;
    if (!active) {
      // Main-Thread-Pfad zeichnet den Umriss selbst auf die Feld-Canvas -> Overlay leer.
      if (overlaySigRef.current !== "") { octx.setTransform(1, 0, 0, 1, 0, 0); octx.clearRect(0, 0, ov.width, ov.height); overlaySigRef.current = ""; }
      return;
    }
    const dpr = window.devicePixelRatio || 1;
    const { cw, ch } = canvasCssSize();
    const w = Math.round(cw * dpr), h = Math.round(ch * dpr);
    if (ov.width !== w || ov.height !== h) { ov.width = w; ov.height = h; ov.style.width = cw + "px"; ov.style.height = ch + "px"; }
    const v = viewRef.current, g = gridRef.current;
    // Redraw-Guard: nur neu zeichnen, wenn sich View/Frame/Grid wirklich änderten.
    // Codex-Review P2-A: Freiform-Draft + Polygon-Endpunkt mit in die Signatur, sonst
    // friert die gestrichelte Live-Vorschau bei gleicher Punktzahl ein.
    const draft = freeformDraftRef.current;
    const dlast = draft && draft.length ? draft[draft.length - 1] : null;
    const plast = freeformPolygon.length ? freeformPolygon[freeformPolygon.length - 1] : null;
    const sig = `${w}x${h}|${v.s.toFixed(4)}|${v.tx.toFixed(2)}|${v.ty.toFixed(2)}|${frameShape}|${g.rows}x${g.cols}|${circleRadius}|${ellipseA}|${ellipseB}|${freeformPolygon.length}|${plast ? plast.x.toFixed(1) + "," + plast.y.toFixed(1) : "-"}|${draft ? draft.length : 0}|${dlast ? dlast.x.toFixed(1) + "," + dlast.y.toFixed(1) : "-"}`;
    if (!force && sig === overlaySigRef.current) return;
    overlaySigRef.current = sig;
    octx.setTransform(1, 0, 0, 1, 0, 0); octx.clearRect(0, 0, w, h);
    octx.setTransform(dpr * v.s, 0, 0, dpr * v.s, dpr * v.tx, dpr * v.ty);
    drawFrame(octx, v.s);
    octx.setTransform(1, 0, 0, 1, 0, 0);
  }, [drawFrame, frameShape, circleRadius, ellipseA, ellipseB, freeformPolygon]);

  // --- Loop -----------------------------------------------------------------
  useEffect(() => {
    let raf, last = performance.now(), acc = 0;
    const loop = (now) => {
      const dt = now - last; last = now;
      // v33.0.2: Rahmen-Umriss-Overlay aktuell halten (zeichnet nur im Worker-Modus,
      // leert sich im Main-Modus selbst; Redraw-Guard verhindert Arbeit pro Frame).
      drawOverlayOutline();
      // Worker aktiv ODER beabsichtigt: Sim + Render laufen off-main-thread -> die
      // Main-Loop macht hier nichts. workerModeRef deckt das Zeitfenster zwischen
      // transferControlToOffscreen und der "ready"-Meldung ab: in diesem Fenster ist
      // die Canvas bereits transferiert, workerActiveRef aber noch false -> ein
      // draw() wuerde getContext() auf der transferierten Canvas werfen (Auto-Worker-
      // Race bei Riesen-Gittern, da der Grid-Rebuild gleichzeitig dirtyRef setzt).
      if (workerActiveRef.current || workerModeRef.current) { raf = requestAnimationFrame(loop); return; }
      if (runRef.current) {
        acc += dt; const iv = spRef.current; let guard = 0;
        // PERF: Simulation vom Render entkoppeln. Statt fixem Cap (8 Steps/Frame)
        // laeuft die Sim so viele Steps wie in ein Wall-Time-Budget passen.
        // iv=0 ("TURBO") = nur durch Budget begrenzt. HARDCAP = Endlos-Schutz.
        const STEP_BUDGET_MS = 12, STEP_HARDCAP = 4000, tStart = performance.now();
        while (acc >= iv && guard < STEP_HARDCAP) {
          step(); guard++;
          if (iv > 0) acc -= iv;
          if (performance.now() - tStart >= STEP_BUDGET_MS) break;
        }
        // Anti-Spiral: nach langsamem Frame acc nicht unbegrenzt auflaufen lassen.
        if (iv > 0) { if (acc > iv * 4) acc = iv * 4; } else { acc = 0; }
      }
      // Render-Steuerung: starkes dirtyRef -> Vollredraw (Vorfahrt). Sonst, wenn
      // nur ein Simulationsschritt anstand, inkrementell (nur geaenderte Zellen).
      if (dirtyRef.current) draw(false);
      else if (stepDirtyRef.current) draw(true);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [step, draw, drawOverlayOutline]);

  // Statistik + Zoom-Label (throttled, 250ms)
  useEffect(() => {
    const id = setInterval(() => {
      const v = viewRef.current; setZoomLbl(v.fit ? v.s / v.fit : 1);
      const now = performance.now(), dt = (now - loopT0Ref.current) / 1000;
      // Worker aktiv: Gen + sps liefert die Worker-Telemetrie-Bruecke; den
      // Main-Thread-Zaehler (tickRef=0, loopStep=0) hier NICHT ueberschreiben.
      if (workerActiveRef.current) { loopT0Ref.current = now; loopStepRef.current = 0; }
      else {
        if (dt > 0) { spsRef.current = loopStepRef.current / dt; loopStepRef.current = 0; loopT0Ref.current = now; }
        if (runRef.current) { setGen(tickRef.current); pushStats(statsRef.current.births, statsRef.current.deaths); }
      }
      if (solverWarnRef.current) setSolverWarn(true);
      // Divergenz EINMALIG pro Ereignis behandeln: die Ref ist der Ausloeser und
      // wird sofort zurueckgesetzt, damit setRunning(false) nicht bei jedem Tick
      // feuert (sonst koennte der Nutzer nicht neu starten). Die Warnung
      // (solverDiverged) bleibt sichtbar, bis neu geseedet/Solver gewechselt wird.
      if (solverDivergedRef.current) { solverDivergedRef.current = false; setSolverDiverged(true); setRunning(false); dirtyRef.current = true; }
    }, 250);
    return () => clearInterval(id);
  }, [pushStats]);

  // --- Resize ---------------------------------------------------------------
  useEffect(() => {
    const fit = () => {
      const canvas = canvasRef.current, wrap = wrapRef.current; if (!canvas || !wrap) return;
      const dpr = window.devicePixelRatio || 1;
      const { cw, ch } = canvasCssSize();
      // Worker aktiv: die Canvas-Kontrolle liegt off-main-thread; Groesse NICHT
      // direkt setzen (wuerfe InvalidStateError) -> per postMessage an den Worker.
      if (workerActiveRef.current && workerRef.current) {
        canvas.style.width = cw + "px"; canvas.style.height = ch + "px";
        workerRef.current.postMessage({ type: "resize", width: Math.round(cw * dpr), height: Math.round(ch * dpr), dpr });
        return;
      }
      canvas.style.width = cw + "px"; canvas.style.height = ch + "px";
      try {
        // Auf einer bereits transferierten Canvas (Worker uebernimmt im selben
        // canvasKey-Zyklus) wirft das Setzen von width/height InvalidStateError.
        // Dann ist der Worker-Pfad zustaendig -> Resize wird dort gehandhabt.
        canvas.width = Math.round(cw * dpr); canvas.height = Math.round(ch * dpr);
      } catch { return; }
      fitView(); dirtyRef.current = true;
    };
    refitRef.current = fit; // AP-4: fuer Layout-Reflow-Refit (compact/sheet) abrufbar
    fit(); window.addEventListener("resize", fit);
    // Nicht-passiver touchmove-Listener: React behandelt Touch-Events als passiv,
    // wodurch preventDefault dort wirkungslos ist. BEDINGT (web-fundiert, p5/Figma-
    // Muster): das Seitenscrollen nur unterbinden, wenn tatsaechlich eine
    // anwendungseigene Geste laeuft (paint/pan/pinch). Bei reiner Beruehrung ohne
    // Geste (mode "" oder "maybe-tap") bleibt das Seiten-Scroll erlaubt, damit der
    // Nutzer nicht auf der Leinwand "eingesperrt" wird (Korrektur einer
    // Ueberkorrektur: vorher wurde IMMER blockiert).
    const canvasEl = canvasRef.current;
    const blockScroll = (ev) => {
      const m = ges.current.mode;
      if (m === "paint" || m === "pan" || m === "pinch") ev.preventDefault();
    };
    const wheelHandler = (ev) => onWheelRef.current && onWheelRef.current(ev);
    if (canvasEl) {
      canvasEl.addEventListener("touchmove", blockScroll, { passive: false });
      canvasEl.addEventListener("wheel", wheelHandler, { passive: false });
    }
    return () => {
      window.removeEventListener("resize", fit);
      if (canvasEl) {
        canvasEl.removeEventListener("touchmove", blockScroll);
        canvasEl.removeEventListener("wheel", wheelHandler);
      }
    };
    // canvasKey: bei Worker-Moduswechsel entsteht ein frisches Canvas-Element
    // (transferControlToOffscreen ist irreversibel) -> Listener neu binden.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canvasKey]);

  // AP-4: Layout-Reflow-Refit. Wenn der Viewport zwischen compact/Desktop wechselt
  // oder das Bottom-Sheet auf-/zugeht, aendert sich die verfuegbare Canvas-Flaeche.
  // rAF stellt sicher, dass der Browser das neue Flex-Layout schon gemessen hat,
  // bevor wir die Canvas-Pixelmasse neu setzen.
  useEffect(() => {
    const id = requestAnimationFrame(() => { refitRef.current && refitRef.current(); });
    return () => cancelAnimationFrame(id);
  }, [compact, activeTab]);

  function fitView() {
    const canvas = canvasRef.current; if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const cw = canvas.width / dpr, ch = canvas.height / dpr;
    const g = gridRef.current;
    const { W, H } = worldSize(g.rows, g.cols, g.hr);
    const s = Math.min(cw / W, ch / H) * 0.98;
    viewRef.current = { s, fit: s, tx: (cw - W * s) / 2, ty: (ch - H * s) / 2 };
    dirtyRef.current = true; syncWorkerView();
  }

  // --- Pointer / Gesten -----------------------------------------------------
  const ptrs = useRef(new Map());
  const ges = useRef({ mode: "", startDist: 0, startS: 1, lastMid: null, moved: 0, lastCell: -1, down: null });
  // AP-3 Long-Press (web-fundiert: B4 ~500 ms Hold + Touch-Slop). Ein Timer pro
  // Single-Pointer-Down; jede Bewegung > LONG_PRESS_SLOP oder ein zweiter Finger
  // (Pinch) oder ein frueher Pointerup bricht ihn ab (kein Rad beim Pan/Zoom/Tap).
  const LONG_PRESS_MS = 500, LONG_PRESS_SLOP = 8; // px Toleranz (Compose/MAUI-Konvention)
  const lpTimer = useRef(null);
  const lpOrigin = useRef(null); // {x,y} CSS-Pixel relativ Canvas-Wrapper beim Press
  const wheelRef = useRef(wheel); useEffect(() => { wheelRef.current = wheel; }, [wheel]);
  const clearLongPress = () => { if (lpTimer.current) { clearTimeout(lpTimer.current); lpTimer.current = null; } lpOrigin.current = null; };
  // Sicherheit: haengender Long-Press-Timer beim Unmount aufraeumen (kein Leak).
  useEffect(() => () => { if (lpTimer.current) { clearTimeout(lpTimer.current); lpTimer.current = null; } }, []);
  // Rad oeffnen: Druckpunkt -> Zelle bestimmen, Rad zentriert auf dem Druckpunkt.
  const openWheel = (clientX, clientY) => {
    const wrap = wrapRef.current, canvas = canvasRef.current;
    if (!wrap || !canvas) return;
    const wrect = wrap.getBoundingClientRect();
    const { wx, wy } = toWorld(clientX, clientY);
    const idx = pixelToOddR(wx, wy, HR, R, C);
    setWheel({ x: clientX - wrect.left, y: clientY - wrect.top, idx });
  };
  // Auswahl: gewaehlte Farbe (State-ID 1..12) faerbt die Zelle SOFORT + wird neue
  // Pinselfarbe (M-3 "Beides"). Danach Rad schliessen; direkt weitermalen moeglich.
  const pickWheelColor = (stateId) => {
    const w = wheelRef.current; if (!w) { setWheel(null); return; }
    const idx = w.idx;
    if (idx >= 0) {
      pushUndo();
      if (simRef.current === "rval") {
        // rval-Modus: Farbe steuert keinen reellen Wert -> Zelle setzen (regelabhaengig)
        // und Pinsel auf die Farbe stellen (wirkt im booleschen Modus).
        const fld = fieldRef.current, fim = fieldImRef.current, rule = rvalRef.current;
        if (rule === "snow" || rule === "water" || rule === "hqst") { fld[idx] = 1; if (rule === "hqst") fim[idx] = 0; }
        else if (rule === "collatz") fld[idx] = 27;
        else if (rule === "genes") fld[idx] = G_Aa;
      } else {
        colorRef.current[idx] = stateId; ageRef.current[idx] = 1; ghostRef.current[idx] = 0;
      }
      dirtyRef.current = true; syncWorkerState(); updatePop();
    }
    setBrush(stateId); brushRef.current = stateId; // aktive Pinselfarbe wechseln
    setWheel(null);
  };
  const cancelWheel = () => setWheel(null);

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
    if (simRef.current === "rval") { paintRval(idx); syncWorkerState(); return; }
    const col = colorRef.current, b = brushRef.current;
    if (b === "cycle") { if (isTap) { const ci = CYCLE.indexOf(col[idx]); col[idx] = CYCLE[(ci + 1) % 4]; ageRef.current[idx] = col[idx] ? 1 : 0; } }
    else if (b === "erase") { col[idx] = C0; ageRef.current[idx] = 0; }
    else { col[idx] = b; ageRef.current[idx] = 1; }
    ghostRef.current[idx] = 0; dirtyRef.current = true;
    syncWorkerState();
  };
  // Worker-Pfad: der OffscreenCanvas-Worker (AP-1) haelt eigene Zustands-Arrays
  // (per Transfer uebernommen). Eingabe-Aenderungen aus dem Main-Thread
  // (Paint/Farbrad/Reset/Undo) muessen ihm explizit nachgereicht werden, sonst
  // zeigt der Worker den alten Zustand. Wir senden den vollen Zustand (slice-Kopie,
  // KEIN Transfer -> Main behaelt seine Arrays) ueber die schon vorhandene
  // "state"-Bruecke des Workers (render-worker.js). Im Main-Thread-Pfad
  // (Worker inaktiv) ist das ein No-Op.
  // Pusht den Main-Thread-Zustand in den Worker (der die OffscreenCanvas BESITZT
  // und sonst seine eigene, ggf. evolvierte Kopie behaelt — web.dev OffscreenCanvas).
  // INVARIANTE (load-bearing, Equalita 2026-06-08): nur aus PAUSE-Zeit-Mutationen
  // rufen (Random/Leeren/Undo/Place/Seed/Stempel/Load) ODER solange der Main-Loop
  // bei aktivem Worker NICHT steppt (App.tsx:~1205 early-return). Ein Sync MITTEN in
  // einer laufenden Worker-Sim wuerde dessen evolvierten Zustand mit stalem Main-
  // Zustand ueberschreiben. Nicht aus dem Render-/Step-Loop aufrufen.
  const syncWorkerState = () => {
    const w = workerRef.current;
    if (!w || !workerActiveRef.current) return;
    w.postMessage({
      type: "state", tick: tickRef.current,
      col: colorRef.current.slice().buffer, gh: ghostRef.current.slice().buffer, age: ageRef.current.slice().buffer,
      fld: fieldRef.current.slice().buffer, fim: fieldImRef.current.slice().buffer,
    });
  };
  // v33.0.2 (Codex-Review P2-B): View-Transform an den Worker spiegeln. Ohne dies
  // bewegten sich bei Pan/Zoom im Worker-Modus die Zellen NICHT (Worker bekam die
  // View nur beim init) -> Umriss (Overlay nutzt viewRef) und Zellen drifteten
  // auseinander. Jetzt steuern Zoom/Fit/Pan/Pinch/Wheel den Worker live mit.
  const syncWorkerView = () => {
    const w = workerRef.current;
    if (!w || !workerActiveRef.current) return;
    const v = viewRef.current;
    w.postMessage({ type: "view", view: { s: v.s, tx: v.tx, ty: v.ty } });
  };

  const onDown = (e) => {
    try { e.currentTarget.setPointerCapture?.(e.pointerId); } catch { /* synthetische Events / nicht aktive Pointer: ignorieren */ }
    ptrs.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    // Bei offenem Rad faengt das Overlay die Klicks (Auswahl/Ausserhalb) ab; ein
    // erneutes Down auf der Leinwand soll das Rad NICHT zugleich neu starten.
    if (wheelRef.current) return;
    // v33 PR-E: Freiform-Zeichen-Modus ("Frei"-Rahmen + Zeichnen aktiv). Ein
    // Single-Pointer-Down beginnt einen neuen Polygonzug; onMove sammelt Punkte;
    // onUp schliesst und baut die Maske. Unterdrueckt Paint/Pan/Long-Press.
    if (freeformDrawRef.current && frameRef.current === "freeform" && ptrs.current.size === 1) {
      clearLongPress();
      ges.current.mode = "freeform"; ges.current.moved = 0;
      ges.current.down = { x: e.clientX, y: e.clientY };
      const { wx, wy } = toWorld(e.clientX, e.clientY);
      const hr = gridRef.current.hr, pad = PAD(hr);
      // Welt-Koords der Maske: raw = (canvasWelt - pad) / hr.
      ges.current.draftPoly = [{ x: (wx - pad) / hr, y: (wy - pad) / hr }];
      return;
    }
    if (ptrs.current.size === 1) {
      ges.current.moved = 0; ges.current.down = { x: e.clientX, y: e.clientY }; ges.current.lastCell = -1;
      // AP-3: Long-Press-Timer fuer JEDEN Single-Pointer-Down starten (Maus + Touch,
      // einheitlich ueber Pointer Events, B5). Bewegung/zweiter Finger/frueher Up
      // bricht ihn ab; feuert er, oeffnet sich das Farbrad und das Painting wird
      // zurueckgenommen (kein versehentlicher Strich vor dem Rad).
      clearLongPress();
      lpOrigin.current = { x: e.clientX, y: e.clientY };
      const ox = e.clientX, oy = e.clientY;
      lpTimer.current = setTimeout(() => {
        lpTimer.current = null;
        // Nur oeffnen, wenn die Geste nicht inzwischen zu Pan/Pinch wurde.
        if (ptrs.current.size !== 1) return;
        const m = ges.current.mode;
        if (m === "pan" || m === "pinch") return;
        if (ges.current.moved > LONG_PRESS_SLOP) return;
        // Falls schon gemalt wurde (Farb-/Erase-/rval-Pinsel malt sofort beim Down),
        // diesen einen Strich rueckgaengig machen -> Long-Press hat Vorrang.
        if (ges.current.mode === "paint") {
          const u = undoRef.current.pop();
          if (u) {
            if (u.rval) { fieldRef.current.set(u.fld); fieldImRef.current.set(u.fim); }
            else colorRef.current.set(u);
            dirtyRef.current = true; syncWorkerState();
          }
        }
        ges.current.mode = "wheel-open"; // weiteres Painting/Pan unterdruecken
        openWheel(ox, oy);
      }, LONG_PRESS_MS);
      // v33 PR-B: Stempel-Modus (Drawer Tab 2 "Formen" offen) -> ein Tap setzt den
      // gewaehlten Stempel an die getippte Zelle und unterdrueckt Pinsel/Pan.
      if (stampModeRef.current && simRef.current === "life") {
        clearLongPress();
        const { wx, wy } = toWorld(e.clientX, e.clientY);
        const idx = pixelToOddR(wx, wy, HR, R, C);
        if (idx >= 0) {
          // Audit #4 (Phantom-Undo): placeStamp ruft intern pushUndo(). Setzt der
          // Stempel 0 Zellen (ganz ausserhalb der Domaene), den eben erzeugten
          // Undo-Eintrag wieder verwerfen -> kein "toter" Undo-Klick.
          const undoLenBefore = undoRef.current.length;
          const painted = placeStamp(idx);
          if (!painted && undoRef.current.length > undoLenBefore) undoRef.current.pop();
          ges.current.mode = "stamped";
        }
        else ges.current.mode = "maybe-tap";
      } else if (brushRef.current !== "cycle" || simRef.current === "rval") {
        pushUndo();
        const { wx, wy } = toWorld(e.clientX, e.clientY);
        const idx = pixelToOddR(wx, wy, HR, R, C); paintCell(idx, false); ges.current.lastCell = idx; ges.current.mode = "paint"; updatePop();
      } else ges.current.mode = "maybe-tap";
    } else if (ptrs.current.size === 2) {
      clearLongPress(); // zweiter Finger = Pinch, kein Long-Press
      const p = [...ptrs.current.values()];
      ges.current.mode = "pinch"; ges.current.startDist = Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y);
      ges.current.startS = viewRef.current.s; ges.current.lastMid = { x: (p[0].x + p[1].x) / 2, y: (p[0].y + p[1].y) / 2 };
    }
  };
  const onMove = (e) => {
    if (!ptrs.current.has(e.pointerId)) return;
    const prev = ptrs.current.get(e.pointerId); ptrs.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    // Rad offen: laufende Pointer-Moves auf der Leinwand ignorieren (das Overlay
    // steuert die Auswahl); kein Pan/Paint im Hintergrund.
    if (ges.current.mode === "wheel-open" || wheelRef.current) return;
    // AP-3: Bewegung > Touch-Slop bricht den Long-Press ab (Drag/Pan-Abgrenzung, B4).
    if (lpTimer.current && lpOrigin.current) {
      const d = Math.hypot(e.clientX - lpOrigin.current.x, e.clientY - lpOrigin.current.y);
      if (d > LONG_PRESS_SLOP) clearLongPress();
    }
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
      ges.current.lastMid = mid; dirtyRef.current = true; syncWorkerView(); return;
    }
    // v33 PR-E: Freiform-Zeichnen — Punkte sammeln (Min-Abstand gegen Flut) +
    // Live-Vorschau ueber den Draft-Ref (von drawFrame gezeichnet).
    if (ges.current.mode === "freeform" && ges.current.draftPoly) {
      const { wx, wy } = toWorld(e.clientX, e.clientY);
      const hr = gridRef.current.hr, pad = PAD(hr);
      const p = { x: (wx - pad) / hr, y: (wy - pad) / hr };
      const dp = ges.current.draftPoly, lastP = dp[dp.length - 1];
      // Min-Abstand ~ halbe Hexbreite (in raw-Welt-Einheiten ~ S3/2), damit der Zug
      // nicht aus Hunderten Mikro-Segmenten besteht.
      if (Math.hypot(p.x - lastP.x, p.y - lastP.y) >= S3 * 0.5) {
        dp.push(p);
        freeformDraftRef.current = dp;
        dirtyRef.current = true;
      }
      return;
    }
    if (ptrs.current.size === 1) {
      ges.current.moved = Math.hypot(e.clientX - ges.current.down.x, e.clientY - ges.current.down.y);
      if (ges.current.mode === "paint") {
        const { wx, wy } = toWorld(e.clientX, e.clientY); const idx = pixelToOddR(wx, wy, HR, R, C);
        if (idx >= 0 && idx !== ges.current.lastCell) { paintCell(idx, false); ges.current.lastCell = idx; }
      } else {
        if (ges.current.moved > 6) ges.current.mode = "pan";
        if (ges.current.mode === "pan") { viewRef.current.tx += e.clientX - prev.x; viewRef.current.ty += e.clientY - prev.y; dirtyRef.current = true; syncWorkerView(); }
      }
    }
  };
  const onUp = (e) => {
    const was = ptrs.current.size; ptrs.current.delete(e.pointerId);
    clearLongPress(); // Loslassen bricht einen noch laufenden Long-Press-Timer ab
    // v33 PR-E: Freiform-Zug fertig -> Polygon schliessen + Maske bauen. <3 Punkte
    // (nur getippt, kein Zug) -> Zeichnen aktiv lassen, nichts bauen (kein Crash).
    if (ges.current.mode === "freeform") {
      const dp = ges.current.draftPoly || [];
      ges.current.draftPoly = null; freeformDraftRef.current = null; ges.current.mode = "";
      if (dp.length >= 3) {
        setFreeformPolygon(dp.map((p) => ({ x: p.x, y: p.y })));
        setFreeformDrawing(false); // Zug abgeschlossen, Zeichen-Modus verlassen
      } else {
        dirtyRef.current = true; // zu wenige Punkte -> Vorschau verwerfen
      }
      return;
    }
    // Rad bereits offen (Long-Press hat gefeuert): das Loslassen schliesst das Rad
    // NICHT und malt NICHT -> der Nutzer waehlt im Overlay aus oder tippt ausserhalb.
    if (ges.current.mode === "wheel-open") { ges.current.mode = ptrs.current.size === 1 ? "maybe-tap" : ""; return; }
    if (was === 1) {
      if (ges.current.mode === "maybe-tap" && ges.current.moved <= 6) {
        pushUndo(); const { wx, wy } = toWorld(e.clientX, e.clientY); paintCell(pixelToOddR(wx, wy, HR, R, C), true); updatePop();
      } else if (ges.current.mode === "paint") updatePop();
    }
    ges.current.mode = ptrs.current.size === 1 ? "maybe-tap" : "";
  };
  // Rad/Trackpad-Zoom. Zwei web-fundierte Verbesserungen (Figma/tldraw-Muster):
  // (1) Zoomfaktor proportional zur Drehungsstaerke statt fester 12%-Schritt ->
  //     Trackpad-Pinch (viele winzige Events) zoomt glatt statt ruckartig.
  // (2) Trackpad-Pinch setzt ctrlKey (De-facto-Standard) -> feinere Stufe.
  // Als Ref, damit ein nicht-passiver Listener (siehe useEffect) preventDefault
  // zuverlaessig ausfuehren kann (React-Wheel ist passiv).
  const onWheelRef = useRef(null);
  onWheelRef.current = (e) => {
    e.preventDefault();
    const v = viewRef.current, rect = canvasRef.current.getBoundingClientRect();
    const mx = e.clientX - rect.left, my = e.clientY - rect.top;
    // deltaMode 1 = Zeilen (Maus), 0 = Pixel (Trackpad). Auf Zeilen ~16px normieren.
    const unit = e.deltaMode === 1 ? 16 : 1;
    const dy = e.deltaY * unit;
    // ctrlKey (Trackpad-Pinch) -> feinfuehliger; sonst etwas kraeftiger.
    const k = e.ctrlKey ? 0.01 : 0.0035;
    const factor = Math.exp(-dy * k);                 // proportional + stetig
    const ns = clamp(v.s * factor, v.fit * 0.2, v.fit * 16);
    const wx = (mx - v.tx) / v.s, wy = (my - v.ty) / v.s;
    v.tx = mx - wx * ns; v.ty = my - wy * ns; v.s = ns; dirtyRef.current = true; syncWorkerView();
  };

  // --- Aktionen -------------------------------------------------------------
  const doStep = () => { captureOriginIfFirstPlay(); pushUndo(); step(); setGen(tickRef.current); pushStats(statsRef.current.births, statsRef.current.deaths); };
  // Play/Pause-Toggle: beim Uebergang AUS->AN den Urzustand sichern (erstes Play
  // eines Laufes). Pause aendert den Urzustand NICHT.
  const togglePlay = () => {
    setRunning((r) => {
      if (!r) { captureOriginIfFirstPlay(); return true; }
      // Pause: bei aktivem Worker den evolvierten Zustand zurück an Main pullen
      // (P1-Fix, Codex-Review) -> colorRef/age/field frisch für Edits/Save/Undo.
      const w = workerRef.current;
      if (w && workerActiveRef.current) w.postMessage({ type: "snapshot" });
      return false;
    });
  };
  const doClear = () => {
    pushUndo(); resetOrigin(); // neuer Lauf -> Urzustand-Slot zuruecksetzen
    if (simMode === "rval") { fieldRef.current.fill(0); fieldImRef.current.fill(0); tickRef.current = 0; setGen(0); dirtyRef.current = true; syncWorkerState(); return; }
    colorRef.current.fill(0); ghostRef.current.fill(0); ageRef.current.fill(0); tickRef.current = 0; setGen(0); updatePop(); dirtyRef.current = true; syncWorkerState();
  };
  const doRandom = () => {
    pushUndo(); resetOrigin(); // neuer Lauf -> Urzustand-Slot zuruecksetzen
    if (simMode === "rval") { rvalSeed(); return; }
    const col = colorRef.current; ghostRef.current.fill(0); ageRef.current.fill(0);
    const dmask = neighRef.current.mask;
    const rand = rng((seedRef.current & 0x7fffffff) | 1);
    for (let i = 0; i < col.length; i++) { col[i] = (dmask[i] && rand() >= (1 - DENS)) ? PRIMARY[Math.floor(rand() * 3)] : 0; ageRef.current[i] = col[i] ? 1 : 0; }
    tickRef.current = 0; setGen(0); updatePop(); dirtyRef.current = true; syncWorkerState();
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
    tickRef.current = 0; setGen(0); dirtyRef.current = true; fitView(); syncWorkerState();
    solverWarnRef.current = false; setSolverWarn(false);
    solverDivergedRef.current = false; setSolverDiverged(false);
  };
  // Beim Wechsel in den rval-Modus / der Regel automatisch sinnvoll seeden.
  useEffect(() => { if (simMode === "rval") { rvalSeed(); setRunning(false); } else { dirtyRef.current = true; } // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [simMode, rvalRule]);
  const doUndo = () => {
    const u = undoRef.current.pop(); if (!u) return;
    if (u && u.rval) { fieldRef.current.set(u.fld); fieldImRef.current.set(u.fim); dirtyRef.current = true; syncWorkerState(); return; }
    colorRef.current.set(u); ghostRef.current.fill(0); updatePop(); dirtyRef.current = true; syncWorkerState();
  };

  // --- v33 PR-C: "1. Figur" / Urzustand ------------------------------------
  // Snapshot des aktuellen Feldes als "Urzustand" eines Laufes. Aufgerufen beim
  // ERSTEN Play (captureOriginIfFirstPlay) und vom Restore verwendet.
  const captureOrigin = () => {
    const meta = {
      gen: tickRef.current, simMode, rvalRule, ruleIdx, ruleSrc, watzOnly,
      torusOn, boundaryMode, colorMode, frameShape, circleRadius, sizeIdx,
    };
    originRef.current = makeOriginSnapshot({
      cells: simRef.current === "rval" ? null : colorRef.current,
      ghost: simRef.current === "rval" ? null : ghostRef.current,
      age: simRef.current === "rval" ? null : ageRef.current,
      field: simRef.current === "rval" ? fieldRef.current : null,
      fieldIm: simRef.current === "rval" ? fieldImRef.current : null,
      meta,
    });
    setHasOrigin(true);
  };
  // Setzt beim ersten Play den Urzustand (nur wenn noch keiner existiert). Klar
  // getrennt vom Undo-Stack (der bei jeder Mal-/Step-Aktion waechst).
  const captureOriginIfFirstPlay = () => {
    if (shouldCaptureOrigin(originRef.current)) captureOrigin();
  };
  // Verwirft den Urzustand-Slot (naechstes Play setzt einen neuen). Aufzurufen bei
  // jeder Aktion, die "ein neuer Lauf" bedeutet: Leeren, Random, Stempel/Figur setzen.
  const resetOrigin = () => { originRef.current = null; setHasOrigin(false); };
  // Stellt EXAKT den Urzustand (vor dem ersten Play) wieder her. Stoppt den Lauf,
  // setzt Generation 0 zurueck. Lebenswelt: Zellen+Geister+Alter; rval: Felder.
  const restoreOrigin = () => {
    const o = originRef.current; if (!o) return;
    setRunning(false); runRef.current = false;
    if (o.field) { fieldRef.current.set(o.field); if (o.fieldIm) fieldImRef.current.set(o.fieldIm); }
    if (o.cells) { colorRef.current.set(o.cells); }
    if (o.ghost) { ghostRef.current.set(o.ghost); }
    if (o.age) { ageRef.current.set(o.age); }
    tickRef.current = o.meta && o.meta.gen != null ? o.meta.gen : 0;
    setGen(tickRef.current);
    undoRef.current = []; // Undo-Stack gehoert zum vergangenen Lauf -> leeren
    dirtyRef.current = true; updatePop(); syncWorkerState();
  };

  // --- v33 PR-C: Spielstand-Speichern (IndexedDB + Datei) -------------------
  // Aktuelle Meta + Zellen einsammeln. Lebenswelt: colorRef (Uint8). rval ist
  // reellwertig (Float32) — fuer den kompakten TypedArray-Save quantisieren wir
  // hier NICHT, sondern speichern nur den Lebenswelt-Modus voll (rval-Save waere
  // ein eigenes Float-Format; bewusst out-of-scope, ehrliche UI-Meldung).
  const currentSaveMeta = (name) => ({
    name, ts: Date.now(), width: C, height: R, bitDepth: 8,
    sizeIdx, frameShape, circleRadius, ellipseA, ellipseB, polygon: freeformPolygon,
    ruleIdx, ruleSrc, watzOnly,
    torusOn, boundaryMode, colorMode, simMode, rvalRule, seed, gen: tickRef.current, zoom: zoomLbl,
  });
  // Speichert in einen IndexedDB-Slot. Grosse Felder: idbPut kopiert + IDB ist
  // async (kein UI-Block). Quota-Fehler -> ehrliche User-Meldung.
  const saveToSlot = async (name) => {
    if (simMode === "rval") { setSaveMsg("Speichern aktuell nur im Lebenswelt-Modus (rval folgt)."); return false; }
    const key = name && name.trim() ? name.trim() : `Stand ${new Date().toLocaleString("de-CH")}`;
    try {
      await idbPut({ key, cells: colorRef.current, meta: currentSaveMeta(key) });
      await refreshSlots();
      setSaveMsg(`Gespeichert: "${key}" (${(R * C).toLocaleString("de-CH")} Zellen).`);
      return true;
    } catch (e) {
      setSaveMsg(e && e.code === "QUOTA" ? e.message : `Speichern fehlgeschlagen: ${e && e.message}`);
      return false;
    }
  };
  // Rehydriert die Engine aus einem Slot/Objekt: erst Sim-Parameter (Groesse/Form/
  // Regel/Rahmen), dann — NACH dem dadurch ausgeloesten Grid-Reset — die Zellen.
  // Da der Grid-Effekt asynchron die Buffer neu allokiert, schreiben wir die Zellen
  // in einem Microtask nach dem State-Flush (requestAnimationFrame-aequivalent).
  const applyLoadedState = (cells, meta) => {
    setRunning(false); runRef.current = false;
    resetOrigin();
    // Audit #5: Gespeicherte Staende sind IMMER Lebenswelt (rval-Save ist
    // blockiert). Laedt man waehrend rval aktiv ist, ohne den Modus zu wechseln,
    // weicht der sichtbare Modus vom geladenen ab. -> simMode mitladen (Default
    // "life"), und falls aktuell rval, ehrlich melden, dass gewechselt wird.
    const targetSim = meta.simMode === "rval" ? "rval" : "life";
    if (simRef.current !== targetSim) {
      setSimMode(targetSim);
      if (simRef.current === "rval" && targetSim === "life") {
        setSaveMsg("In den Lebenswelt-Modus gewechselt (gespeicherter Stand).");
      }
    }
    // 1) Sim-Parameter setzen (loest ggf. Grid-Reallokation aus).
    if (typeof meta.sizeIdx === "number") setSizeIdx(meta.sizeIdx);
    if (meta.frameShape) setFrameShape(meta.frameShape);
    if (typeof meta.circleRadius === "number") setCircleRadius(clamp(Math.round(meta.circleRadius), 1, MAX_CIRCLE_RADIUS));
    // v33 PR-E: Ellipse-Achsen + Freiform-Polygon mitladen (sonst weicht die
    // Maske vom gespeicherten Stand ab und die Zellzahl kann differieren). NUR
    // setzen, wenn der gespeicherte Rahmen das tatsaechlich nutzt — sonst wuerde
    // ein neuer (leerer) Polygon-/Achsen-State unnoetig den Grid-Effekt erneut
    // ausloesen und die soeben geschriebenen Zellen ueberschreiben (Grid-Effekt
    // haengt an diesen Deps). Default-Werte gespeicherter Box-/Kreis-Staende
    // bleiben so unangetastet.
    if (meta.frameShape === "ellipse") {
      if (typeof meta.ellipseA === "number") setEllipseA(clamp(Math.round(meta.ellipseA), 5, MAX_CIRCLE_RADIUS));
      if (typeof meta.ellipseB === "number") setEllipseB(clamp(Math.round(meta.ellipseB), 5, MAX_CIRCLE_RADIUS));
    }
    if (meta.frameShape === "freeform" && Array.isArray(meta.polygon) && meta.polygon.length >= 3) {
      setFreeformPolygon(meta.polygon.map((p) => ({ x: p.x, y: p.y })));
    }
    if (typeof meta.ruleIdx === "number") setRuleIdx(meta.ruleIdx);
    if (meta.ruleSrc) setRuleSrc(meta.ruleSrc);
    if (typeof meta.watzOnly === "boolean") setWatzOnly(meta.watzOnly);
    if (typeof meta.torusOn === "boolean") setTorusOn(meta.torusOn);
    if (meta.boundaryMode) setBoundaryMode(meta.boundaryMode);
    if (meta.colorMode) setColorMode(meta.colorMode);
    if (typeof meta.seed === "number") setSeed(meta.seed);
    // 2) Zellen nach dem Grid-Reset einspielen. Der Grid-Effekt setzt N/Buffer neu;
    //    wir warten zwei Frames (State-Flush + Effekt) und schreiben dann exakt.
    const targetLen = cells.length;
    let attempts = 0;
    const writeCells = () => {
      // Buffer muss zur geladenen Laenge passen (sonst noch im Reflow) -> retry.
      // Audit A-GAP-1/A-BUG-2: Endlosschleife verhindern, falls die Ziel-Laenge
      // nie konvergiert (z.B. geclampter circleRadius). Fail-closed nach MAX Frames.
      const decision = reloadGuardDecision(colorRef.current.length, targetLen, attempts);
      if (decision === "retry") { attempts++; requestAnimationFrame(writeCells); return; }
      if (decision === "abort") {
        setSaveMsg("Laden fehlgeschlagen: Stand ist mit der aktuellen Version nicht kompatibel (Gittergroesse weicht ab).");
        return;
      }
      colorRef.current.set(cells);
      ghostRef.current.fill(0);
      // Alter: lebende Zellen als "1" markieren, damit Render/Glow konsistent ist.
      const age = ageRef.current; for (let i = 0; i < age.length; i++) age[i] = cells[i] ? 1 : 0;
      tickRef.current = meta.gen | 0; setGen(tickRef.current);
      dirtyRef.current = true; updatePop(); fitView(); syncWorkerState();
    };
    requestAnimationFrame(writeCells);
  };
  const loadFromSlot = async (key) => {
    try {
      const rec = await idbGet(key);
      if (!rec) { setSaveMsg(`Slot "${key}" nicht gefunden.`); return; }
      applyLoadedState(new Uint8Array(rec.cells), rec.meta || {});
      setSaveMsg(`Geladen: "${key}".`);
      setSaveOpen(false);
    } catch (e) { setSaveMsg(`Laden fehlgeschlagen: ${e && e.message}`); }
  };
  const deleteSlot = async (key) => {
    try { await idbDelete(key); await refreshSlots(); setSaveMsg(`Geloescht: "${key}".`); }
    catch (e) { setSaveMsg(`Loeschen fehlgeschlagen: ${e && e.message}`); }
  };
  const renameSlot = async (oldKey) => {
    const neu = (typeof window !== "undefined" && window.prompt) ? window.prompt("Neuer Name:", oldKey) : null;
    if (!neu || !neu.trim() || neu.trim() === oldKey) return;
    try { await idbRename(oldKey, neu.trim()); await refreshSlots(); setSaveMsg(`Umbenannt: "${oldKey}" -> "${neu.trim()}".`); }
    catch (e) { setSaveMsg(`Umbenennen fehlgeschlagen: ${e && e.message}`); }
  };
  const refreshSlots = async () => {
    try { setSaveSlots(await idbList()); }
    catch (e) { setSaveMsg(`Slot-Liste nicht verfuegbar: ${e && e.message}`); }
  };
  // Datei-Export: Spielstand als .golhex.json herunterladen (Blob + <a download>,
  // KEINE Lib). Vorwaertskompatibel ueber das version-Feld im Format.
  const exportSaveFile = () => {
    if (simMode === "rval") { setSaveMsg("Datei-Export aktuell nur im Lebenswelt-Modus."); return; }
    const name = (saveName && saveName.trim()) || `golhex_${Date.now()}`;
    const obj = serializeSave({ cells: colorRef.current, meta: currentSaveMeta(name) });
    downloadBlob(JSON.stringify(obj), `${name}${SAVE_FILE_EXT}`, "application/json");
    setSaveMsg(`Datei exportiert: ${name}${SAVE_FILE_EXT}.`);
  };
  // Datei-Import: .golhex.json laden (FileReader). Validierung via deserializeSave
  // (Fail-Closed bei fremdem/korruptem/zukuenftigem Format).
  const importSaveFile = (ev) => {
    const file = ev.target.files && ev.target.files[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const { cells, meta } = deserializeSave(JSON.parse(String(reader.result)));
        applyLoadedState(cells, meta);
        setSaveMsg(`Datei geladen: "${meta.name || file.name}".`);
        setSaveOpen(false);
      } catch (e) { setSaveMsg(`Import fehlgeschlagen: ${e && e.message}`); }
    };
    reader.onerror = () => setSaveMsg("Datei konnte nicht gelesen werden.");
    reader.readAsText(file); ev.target.value = "";
  };
  // 💾-Toggle: Panel oeffnen, Slots laden, Namensfeld mit Datum vorbelegen (Klick-
  // Effizienz: 💾 -> Name vorbelegt -> Enter).
  const toggleSavePanel = () => {
    setSaveOpen((o) => {
      const next = !o;
      if (next) { setSaveName(`Stand ${new Date().toLocaleDateString("de-CH")}`); refreshSlots(); setSaveMsg(""); }
      return next;
    });
  };
  // Autosave-Slot: letzter Stand beim Pausieren/Verlassen. Debounced ueber den
  // running-Wechsel + beforeunload. Nur Lebenswelt-Modus.
  const autosave = useCallback(() => {
    if (simRef.current === "rval") return;
    try { idbPut({ key: AUTOSAVE_KEY, cells: colorRef.current, meta: { ...currentSaveMeta("Autosave"), autosave: true } }).catch(() => {}); }
    catch { /* IDB evtl. nicht verfuegbar -> still */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [R, C, sizeIdx, frameShape, circleRadius, ruleIdx, ruleSrc, watzOnly, torusOn, boundaryMode, colorMode, simMode, rvalRule, seed, zoomLbl]);
  // Beim Verlassen der Seite den letzten Stand sichern.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onLeave = () => autosave();
    window.addEventListener("beforeunload", onLeave);
    window.addEventListener("pagehide", onLeave);
    return () => { window.removeEventListener("beforeunload", onLeave); window.removeEventListener("pagehide", onLeave); };
  }, [autosave]);
  // Beim Pausieren (running true->false) ebenfalls autosaven.
  const prevRunningRef = useRef(running);
  useEffect(() => {
    if (prevRunningRef.current && !running) autosave();
    prevRunningRef.current = running;
  }, [running, autosave]);

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
    seed, grid: { rows: R, cols: C, size: G.l, circleRadius: frameShape === "circle" ? circleRadius : null }, steps: recRef.current.rows.length,
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
        sizeIdx, circleRadius, ellipseA, ellipseB, polygon: freeformPolygon, seed,
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
    if (typeof cfgObj.circleRadius === "number") setCircleRadius(clamp(Math.round(cfgObj.circleRadius), 1, MAX_CIRCLE_RADIUS));
    if (typeof cfgObj.ellipseA === "number") setEllipseA(clamp(Math.round(cfgObj.ellipseA), 5, MAX_CIRCLE_RADIUS));
    if (typeof cfgObj.ellipseB === "number") setEllipseB(clamp(Math.round(cfgObj.ellipseB), 5, MAX_CIRCLE_RADIUS));
    if (Array.isArray(cfgObj.polygon)) setFreeformPolygon(cfgObj.polygon.map((p) => ({ x: p.x, y: p.y })));
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

  // v33 PR-D: aktuelle Regel als Kurzlabel (B/S oder rval-Name) — identische
  // Logik wie der Statistik-Regel-Chip, hier auch vor dem Render abrufbar.
  const currentRuleLabel = () => {
    if (simMode === "rval") {
      return rvalRule === "snow" ? "Schnee" : rvalRule === "water" ? "Wasser"
        : rvalRule === "hqst" ? "HQST" : rvalRule === "collatz" ? "Collatz" : "Gene";
    }
    if (watzOnly) return "B2,3/S1-5";
    const r = (ruleSrc === "int" ? INT_RULES : RULES)[ruleIdx];
    return r ? `B${r.B.join("")}/S${r.S.join("")}` : "—";
  };

  // v33 PR-D: aktuellen Feld-Canvas als PNG teilen (Web Share L2) oder
  // herunterladen (Fallback). v1 exportiert den SICHTBAREN Canvas (Viewport-
  // Ausschnitt) — ausreichend fuer einen Teil-Schnappschuss; ein Voll-Feld-
  // Offscreen-Render in Original-Aufloesung ist als Folge-PR notiert (XXL-Raster).
  // Das share() laeuft im selben Klick-Handler-Zweig (iOS-Geste; toBlob ist async,
  // der nachgelagerte share-Call bleibt im User-aktivierten Kontext, iOS 15+).
  const shareCanvasImage = async () => {
    if (snapBusyRef.current) return;
    const src = canvasRef.current;
    if (!src) { setSnapMsg("Snapshot: keine Leinwand gefunden."); return; }
    snapBusyRef.current = true;
    setSnapMsg("Snapshot wird erstellt …");
    // Audit #7 (Snapshot-Determinismus): Gen-Label SYNCHRON einfrieren, bevor der
    // async toBlob/share-Pfad laeuft. Sonst kann tickRef bis zum Resolve
    // weitergelaufen sein -> Dateiname gen42, Bild zeigt gen45.
    const snapGen = tickRef.current;
    try {
      // Optionales Wasserzeichen: auf eine Kopie zeichnen, damit der Live-Canvas
      // unberuehrt bleibt (kein Flackern im Spielfeld).
      let target = src;
      if (snapWatermark) {
        const off = document.createElement("canvas");
        off.width = src.width; off.height = src.height;
        const octx = off.getContext("2d");
        if (octx) {
          octx.drawImage(src, 0, 0);
          const label = buildWatermarkLabel(snapGen, currentRuleLabel());
          const fs = Math.max(11, Math.round(src.width / 48));
          octx.font = `${fs}px ui-monospace, monospace`;
          octx.textBaseline = "bottom";
          const padX = Math.round(fs * 0.6), padY = Math.round(fs * 0.45);
          const tw = octx.measureText(label).width;
          // halbtransparenter Streifen unten links, damit das Label auf jedem
          // Untergrund lesbar bleibt (dezent, kleine Box).
          octx.fillStyle = "rgba(0,0,0,0.45)";
          octx.fillRect(0, off.height - fs - padY * 2, tw + padX * 2, fs + padY * 2);
          octx.fillStyle = "rgba(255,255,255,0.92)";
          octx.fillText(label, padX, off.height - padY);
          target = off;
        }
      }
      const blob = await canvasToBlob(target, "image/png");
      const filename = buildSnapshotFilename(new Date(), snapGen, "png");
      const res = await shareOrDownloadBlob(blob, filename, {
        title: "GolHex",
        text: buildWatermarkLabel(snapGen, currentRuleLabel()),
      });
      if (res.method === "share" && res.shared) setSnapMsg("Geteilt.");
      else if (res.method === "share" && res.cancelled) setSnapMsg("Teilen abgebrochen.");
      else setSnapMsg(`Heruntergeladen: ${filename}`);
    } catch (e) {
      setSnapMsg(`Snapshot fehlgeschlagen: ${e && e.message ? e.message : e}`);
    } finally {
      snapBusyRef.current = false;
    }
  };
  const doPlace = () => {
    pushUndo(); resetOrigin(); const offs = PATS[pattern], col = colorRef.current;
    const pc = (typeof brush === "number" && brush >= 1 && brush <= 12) ? brush : CB;
    let mR = 0, mC = 0; offs.forEach(([dr, dc]) => { mR = Math.max(mR, dr); mC = Math.max(mC, dc); });
    const r0 = (R - mR) >> 1, c0 = (C - mC) >> 1;
    const dmask = neighRef.current.mask; // Audit-P1.1: nicht out-of-domain stempeln
    offs.forEach(([dr, dc]) => { const rr = r0 + dr, cc = c0 + dc; if (rr >= 0 && rr < R && cc >= 0 && cc < C) { const idx = rr * C + cc; if (!dmask[idx]) return; col[idx] = pc; ageRef.current[idx] = 1; } });
    updatePop(); dirtyRef.current = true; fitView(); syncWorkerState();
  };
  // Farbkreis-Stempel: 12 Itten-Farben kreisfoermig in die Gittermitte.
  // mode "ring" = Farben nur auf dem Kreisrand; "disc" = gefuellte Scheibe,
  // jede Zelle nach ihrem Winkel zum Zentrum eingefaerbt (Itten-Anordnung).
  const placeColorWheel = (mode) => {
    pushUndo(); resetOrigin();
    const col = colorRef.current, age = ageRef.current;
    const dmask = neighRef.current.mask; // Audit-P1.1: Domaenen-Maske respektieren
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
        if (!dmask[idx]) continue;        // Audit-P1.1: out-of-domain ueberspringen
        col[idx] = hueToState(ang);
        age[idx] = 1;
      }
    }
    updatePop(); dirtyRef.current = true; fitView(); syncWorkerState();
  };

  // v33 PR-B: Stempel an die getippte Zelle setzen. Nutzt die kanonischen
  // hex-geom-Primitive (cubeRing/cubeDisk) — Groesse = Hex-Ring-Distanz n
  // (Audit-P1.2, NICHT min(R,C)*0.42) — und respektiert die Domaenen-Maske
  // (Audit-P1.1: out-of-domain wird uebersprungen, kein Aufblitzen). k Farben
  // werden SYMMETRISCH verteilt (Ring: 6n/k zusammenhaengende Sektoren; Disk/Hex:
  // winkelbasierte Sektoren). centerIdx = row*C+col der getippten Zelle.
  const STAMP_PALETTES = {
    // k Farben gleichmaessig ueber den Itten-Kreis verteilt (visuell distinkt),
    // verankert an der aktuell gewaehlten Pinselfarbe falls eine reale Farbe (1..12).
    pick: (k, anchor) => {
      const base = (typeof anchor === "number" && anchor >= 1 && anchor <= 12)
        ? ALLCOL.indexOf(anchor) : ALLCOL.indexOf(CR);
      const start = base < 0 ? 0 : base;
      const out = [];
      for (let j = 0; j < k; j++) out.push(ALLCOL[(start + Math.round((j * 12) / k)) % 12]);
      return out;
    },
  };
  const placeStamp = (centerIdx) => {
    if (centerIdx < 0 || simRef.current === "rval") return false; // Stempel nur in Lebenswelt
    const cr0 = Math.floor(centerIdx / C), cc0 = centerIdx % C;
    if (cr0 < 0 || cr0 >= R || cc0 < 0 || cc0 >= C) return false;
    const center = oddRToCube(cc0, cr0);
    const n = clamp(stampSizeRef.current | 0, 1, 4);
    const k = clamp(stampKRef.current | 0, 1, 3);
    const typ = stampTypeRef.current;
    pushUndo();
    resetOrigin(); // Audit A-BUG-1: Stempel = "neuer Lauf" (vgl. Kommentar 1548-1549) -> Urzustand verwerfen
    const col = colorRef.current, age = ageRef.current, gh = ghostRef.current;
    const dmask = neighRef.current.mask;
    const cols = STAMP_PALETTES.pick(k, brushRef.current);
    let painted = 0;
    const setCell = (cube, colorState) => {
      const off = cubeToOddR(cube);
      if (off.row < 0 || off.row >= R || off.col < 0 || off.col >= C) return;
      const idx = off.row * C + off.col;
      if (!dmask[idx]) return;            // Audit-P1.1: out-of-domain ueberspringen
      col[idx] = colorState; age[idx] = 1; gh[idx] = 0; painted++;
    };
    const S3w = S3;
    const wxF = (r, c) => (c + ((r & 1) ? 0.5 : 0)) * S3w;
    const wyF = (r) => r * 1.5;
    if (typ === "ring") {
      const ring = cubeRing(center, n);            // genau 6n Zellen, geordnet
      const sectorOf = kColorByIndex(ring.length, k);
      ring.forEach((cube, i) => setCell(cube, cols[sectorOf(i)]));
    } else if (typ === "disc") {
      const disk = cubeDisk(center, n);            // 1+3n(n+1) Zellen
      disk.forEach((cube) => setCell(cube, cols[sectorByAngle(cube, center, k, wxF, wyF)]));
    } else if (typ === "hex") {
      // Hexagon = gefuellte Scheibe in Hex-Distanz-Metrik == cubeDisk (regelm. Sechseck).
      const disk = cubeDisk(center, n);
      disk.forEach((cube) => setCell(cube, cols[sectorByAngle(cube, center, k, wxF, wyF)]));
    } else { // brush (Freiform) — UI-Stub: setzt nur die Zentrumszelle (Geometrie PR-E)
      setCell(center, cols[0]);
    }
    dirtyRef.current = true; syncWorkerState(); updatePop();
    return painted > 0;
  };

  // v33 PR-B: Live-Mini-Vorschau des aktuellen Stempels (Typ/Groesse/Farbanzahl).
  // Rendert exakt die Zellen, die placeStamp setzen wuerde — symmetrische k-Sektoren.
  // Pointy-top-Hexzellen, Zentrum in der Vorschau-Mitte. Kein Engine-Eingriff.
  useEffect(() => {
    if (drawer !== 2) return;
    const cv = stampPvRef.current; if (!cv) return;
    const ctx = cv.getContext("2d"); if (!ctx) return;
    const W = cv.width, H = cv.height;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = "#0b0f14"; ctx.fillRect(0, 0, W, H);
    const n = clamp(stampSize | 0, 1, 4), k = clamp(stampK | 0, 1, 3);
    const center = { x: 0, y: 0, z: 0 };
    let cells;
    if (stampType === "ring") cells = cubeRing(center, n).map((cube, i) => [cube, i, cubeRing(center, n).length]);
    else if (stampType === "brush") cells = [[center, 0, 1]];
    else cells = cubeDisk(center, n).map((cube) => [cube, -1, 0]);
    const cols = STAMP_PALETTES.pick(k, brush);
    const ringLen = stampType === "ring" ? cubeRing(center, n).length : 0;
    const sectorRing = kColorByIndex(ringLen, k);
    const S3w = S3;
    const wxF = (r, c) => (c + ((r & 1) ? 0.5 : 0)) * S3w;
    const wyF = (r) => r * 1.5;
    // Welt-Bbox bestimmen, damit der Stempel die Vorschau ausfuellt.
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const [cube] of cells) {
      const o = cubeToOddR(cube); const x = wxF(o.row, o.col), y = wyF(o.row);
      minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y);
    }
    const spanX = Math.max(1e-6, maxX - minX), spanY = Math.max(1e-6, maxY - minY);
    const pad = 10, scale = Math.min((W - 2 * pad) / spanX, (H - 2 * pad) / spanY);
    const hr = scale * 1.0 / 1.5 * 0.92; // Hex-Radius in px (1.5 = Zeilenabstand-Faktor)
    const cxPx = W / 2, cyPx = H / 2, midX = (minX + maxX) / 2, midY = (minY + maxY) / 2;
    for (const [cube, i, len] of cells) {
      const o = cubeToOddR(cube);
      const wx = wxF(o.row, o.col), wy = wyF(o.row);
      const px = cxPx + (wx - midX) * scale, py = cyPx + (wy - midY) * scale;
      let colorState;
      if (stampType === "ring") colorState = cols[sectorRing(i)];
      else if (stampType === "brush") colorState = cols[0];
      else colorState = cols[sectorByAngle(cube, center, k, wxF, wyF)];
      ctx.beginPath();
      for (let s = 0; s < 6; s++) {
        const a = Math.PI / 180 * (60 * s - 30);
        const hx = px + (hr) * Math.cos(a), hy = py + (hr) * Math.sin(a);
        s ? ctx.lineTo(hx, hy) : ctx.moveTo(hx, hy);
      }
      ctx.closePath();
      ctx.fillStyle = COLHEX[colorState] || "#5cf0cc"; ctx.fill();
      ctx.strokeStyle = "#0b0f14"; ctx.lineWidth = 1; ctx.stroke();
    }
  }, [drawer, stampType, stampSize, stampK, brush]);

  const zoom = (f) => {
    const v = viewRef.current, dpr = window.devicePixelRatio || 1;
    const cw = canvasRef.current.width / dpr, ch = canvasRef.current.height / dpr, mx = cw / 2, my = ch / 2;
    const ns = clamp(v.s * f, v.fit * 0.2, v.fit * 16);
    const wx = (mx - v.tx) / v.s, wy = (my - v.ty) / v.s; v.tx = mx - wx * ns; v.ty = my - wy * ns; v.s = ns; dirtyRef.current = true; syncWorkerView();
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
  // Randzellen-Info kommt aus dem Zustand boundaryStat, der GENAU DANN gesetzt wird,
  // wenn das Randfeld neu aufgebaut wird (im Grid/Form-Effekt). Berechnung am Ort der
  // Datenaenderung ist robust gegen die Render-Reihenfolge-Falle (stale useMemo).
  const boundaryInfo = boundaryStat;
  // Sparkline-Pfad (Population-Verlauf)
  const sparkPath = (() => {
    const h = stats.hist; if (!h || h.length < 2) return "";
    const w = 100, ht = 28, mx = Math.max(1, ...h);
    return h.map((v, i) => `${i === 0 ? "M" : "L"}${((i / (h.length - 1)) * w).toFixed(1)},${(ht - (v / mx) * ht).toFixed(1)}`).join(" ");
  })();

  const swatch = (key, label, color) => {
    const active = brush === key;
    return (
      <button key={key} onClick={() => setBrush(key)} aria-pressed={active} className="ghx-btn" style={{
        flex: "1 1 0", minWidth: 0, minHeight: 44, padding: "9px 4px", borderRadius: 10,
        border: active ? `2px solid ${T.accent}` : "2px solid rgba(92,240,204,0.16)",
        background: color || T.bg2, color: color ? "#04110d" : T.sub,
        fontWeight: 700, fontSize: 12, cursor: "pointer", fontFamily: MONO,
        boxShadow: active ? `0 0 14px ${color ? color : T.accent}55` : "none", transition: "all .12s",
      }}>{label}</button>
    );
  };
  const btn = (onClick, children, extra = {}) => (
    <button onClick={onClick} className="ghx-btn" style={{
      display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6, minHeight: 44,
      padding: "9px 12px", borderRadius: 10, border: `1px solid ${T.border}`,
      background: T.panel, color: T.text, fontSize: 12, fontWeight: 600, cursor: "pointer",
      fontFamily: MONO, backdropFilter: "blur(6px)", ...extra,
    }}>{children}</button>
  );
  const sel = { width: "100%", marginTop: 4, minHeight: 44, padding: "8px", borderRadius: 9, background: T.bg2, color: T.text, border: `1px solid ${T.border}`, fontSize: 12, fontFamily: MONO };

  // AP-4: Pinsel-/Farbblock als benannter Knoten. Auf Desktop sitzt er ueber der
  // Leinwand (wie bisher); im compact-Modus wandert er ins Bottom-Sheet, damit die
  // Leinwand oben die volle Flaeche bekommt. Inhalt + alle Handler unveraendert.
  const brushBlock = (
    <>
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
      <button onClick={() => setShowMoreColors((v) => !v)} style={{ width: "100%", textAlign: "left", padding: "7px 10px", borderRadius: 9, border: "1px solid rgba(92,240,204,0.14)", background: T.bg2, color: T.sub, fontFamily: MONO, fontSize: 10.5, fontWeight: 700, cursor: "pointer", marginBottom: 8, letterSpacing: "0.03em" }}>
        {showMoreColors ? "v" : ">"} WEITERE FARBEN & KREIS-STEMPEL
      </button>
      {showMoreColors && (<>
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
      </>)}
      {simMode === "rval" && (
        <div style={{ fontSize: 11, color: T.sub, marginBottom: 10, fontFamily: MONO, lineHeight: 1.5, padding: "8px 10px", borderRadius: 9, border: `1px solid ${T.border}`, background: T.bg2 }}>
          <b style={{ color: T.accent }}>{rvalRule === "snow" ? "Schneeflocke" : rvalRule === "water" ? "Wasser" : "HQST-Welle"}</b> &mdash; reellwertige Physik. Start/Pause steuert die Zeitentwicklung, "Neu initialisieren" setzt den Anfangszustand.
        </div>
      )}
    </>
  );

  // v33 PR-B: Stempel-Picker im Drawer-Tab "Formen". Typ (Ring/Scheibe/Hex/Frei) +
  // Kaestchen-Reihe GROESSE (1..4 = Hex-Ring-Distanz n) + FARBANZAHL (1..3, symm.
  // Sektoren) + Live-Mini-Vorschau (stampPvRef). Tap aufs Feld setzt den Stempel.
  const STAMP_DEFS = [
    { id: "ring", icon: "◌", lab: "Ring" },
    { id: "disc", icon: "●", lab: "Scheibe" },
    { id: "hex", icon: "⬡", lab: "Hex" },
    { id: "brush", icon: "✎", lab: "Frei" },
  ];
  const kastBtn = (val, cur, onClick, key) => (
    <button key={key ?? val} onClick={onClick} aria-pressed={cur === val} aria-label={`Wert ${val}`}
      style={{ width: 40, height: 40, borderRadius: 10, cursor: "pointer", fontFamily: MONO, fontSize: 15,
        fontWeight: cur === val ? 700 : 500, border: cur === val ? `1px solid ${T.accent}` : `1px solid ${T.border}`,
        background: cur === val ? "rgba(92,240,204,0.12)" : T.bg2, color: cur === val ? T.accent : T.text }}>{val}</button>
  );
  const stampDrawerContent = (
    <div data-drawer="formen">
      <div style={{ fontSize: 11, color: T.sub, fontFamily: MONO, marginBottom: 6, letterSpacing: "0.03em" }}>STEMPEL</div>
      <div style={{ display: "flex", gap: 6, marginBottom: 12 }}>
        {STAMP_DEFS.map((s) => (
          <button key={s.id} onClick={() => setStampType(s.id)} aria-pressed={stampType === s.id}
            aria-label={`Stempel ${s.lab}`}
            style={{ flex: 1, height: 54, borderRadius: 12, cursor: "pointer", fontFamily: MONO,
              display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 2,
              border: stampType === s.id ? `1px solid ${T.accent}` : `1px solid ${T.border}`,
              background: stampType === s.id ? "rgba(92,240,204,0.1)" : T.bg2, color: stampType === s.id ? T.accent : T.text }}>
            <span style={{ fontSize: 18, lineHeight: 1 }}>{s.icon}</span>
            <span style={{ fontSize: 9, color: T.sub }}>{s.lab}</span>
          </button>
        ))}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
        <span style={{ fontSize: 11.5, color: T.sub, fontFamily: MONO, width: 96, flexShrink: 0 }}>Groesse (Ringe)</span>
        {[1, 2, 3, 4].map((v) => kastBtn(v, stampSize, () => setStampSize(v), `sz${v}`))}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
        <span style={{ fontSize: 11.5, color: T.sub, fontFamily: MONO, width: 96, flexShrink: 0 }}>Farbanzahl</span>
        {[1, 2, 3].map((v) => kastBtn(v, stampK, () => setStampK(v), `k${v}`))}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12, background: T.bg2,
        border: `1px solid ${T.border}`, borderRadius: 12, padding: 10 }}>
        <canvas ref={stampPvRef} width={92} height={92} aria-label="Stempel-Vorschau"
          style={{ borderRadius: 8, background: "#0b0f14", flexShrink: 0 }} />
        <div style={{ fontSize: 11, color: T.sub, fontFamily: MONO, lineHeight: 1.5 }}>
          <b style={{ color: T.text }}>Vorschau:</b> {STAMP_DEFS.find((s) => s.id === stampType)?.lab}, Groesse {stampSize},<br />
          {stampK} {stampK === 1 ? "Farbe" : "Farben"} {stampK > 1 ? <b style={{ color: T.text }}>symmetrisch</b> : ""}
          {stampType === "brush" && <span style={{ color: T.accent }}><br />Freiform-Maske: Geometrie folgt (PR-E)</span>}
        </div>
      </div>
      <div style={{ fontSize: 11, color: T.accent, fontFamily: MONO, lineHeight: 1.5, padding: "9px 10px",
        borderRadius: 10, border: `1px solid ${T.accent}`, background: "rgba(92,240,204,0.06)" }}>
        Jetzt aufs <b>Feld tippen</b> &mdash; der Stempel wird an der Tipp-Stelle gesetzt (kein Bestaetigen noetig).
      </div>
      {simMode === "rval" && (
        <div style={{ fontSize: 11, color: T.sub, fontFamily: MONO, marginTop: 10, lineHeight: 1.5 }}>
          Hinweis: Stempel wirken nur in der <b>Lebenswelt</b> (Tab 3). Im Physik-Modus malt der Tap das reellwertige Feld.
        </div>
      )}
    </div>
  );

  // v33-Layout (PR-A): aktive Regel als B/S-Chip + Rahmen/Groesse-Chip fuer die
  // Statistik-Zeile. Reine Anzeige aus bestehendem State (keine Engine-Aenderung).
  const ruleChip = simMode === "rval"
    ? (rvalRule === "snow" ? "Schnee" : rvalRule === "water" ? "Wasser" : rvalRule === "hqst" ? "HQST" : rvalRule === "collatz" ? "Collatz" : "Gene")
    : watzOnly
    ? "B2,3/S1-5"
    : (() => { const r = (ruleSrc === "int" ? INT_RULES : RULES)[ruleIdx]; return r ? `B${r.B.join("")}/S${r.S.join("")}` : "—"; })();
  const frameLbl = { box: "Rechteck", circle: "Kreis", hexagon: "Hexagon", triangle: "Dreieck" }[frameShape] || frameShape;
  const sizeLbl = frameShape === "circle" ? `r${circleRadius}` : (GRID_SIZES[sizeIdx]?.l || "");
  const frameChip = `${frameShape === "circle" ? "◯" : frameShape === "box" ? "▭" : "⬢"} ${frameLbl} ${sizeLbl}`;

  // v33: Tab-Meta (Reihenfolge + Icon + Kurzname). 4 inhaltliche Tabs (Recherche
  // Thema 3: Aktionen sind keine Tabs -> rechts als Icon-Buttons abgesetzt).
  const TABS = [
    { id: 1, icon: "🎨", label: "Farben" },
    { id: 2, icon: "⬢", label: "Formen" },
    { id: 3, icon: "⚙", label: "Hex-Regeln" },
    { id: 4, icon: "🌊", label: "Physik" },
  ];

  // v33 Tab 3 (Hex-Regeln): Regelquelle/INT + Regel- & GROESSE-Auswahl (S-5XL bleibt
  // hier erreichbar, Auflage Punkt 1) + Topologie/Rahmen + Watzlawick-Axiome +
  // Systemtheorie + Legende. Inhalt 1:1 aus der bisherigen Settings-Sektion.
  const tab3Content = (
    <>
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
                {(!watzOnly && ruleIdx === i) ? "▸ " : ""}B{r.B.join("")}/S{r.S.join("")}{i === 1 ? " *Bays" : ""}
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
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 8 }}>
        <label style={{ fontSize: 11, color: T.sub, fontFamily: MONO }}>Regel
          {watzOnly
            ? <div style={{ ...sel, opacity: 0.85, color: T.accent }}>Watzlawick B2,3 / S1-5</div>
            : <select value={ruleIdx} onChange={(e) => setRuleIdx(Number(e.target.value))} style={sel}>{(ruleSrc === "int" ? INT_RULES : RULES).map((r, i) => <option key={i} value={i}>{r.l}</option>)}</select>}
        </label>
        <label style={{ fontSize: 11, color: T.sub, fontFamily: MONO }}>Groesse
          {frameShape === "circle"
            ? <div style={{ ...sel, opacity: 0.7, color: T.accent }}>Kreis: per Radius unten</div>
            : <select value={sizeIdx} onChange={(e) => setSizeIdx(Number(e.target.value))} style={sel}>{GRID_SIZES.map((g, i) => <option key={i} value={i}>{g.l} ({g.rows}x{g.cols} = {(g.rows * g.cols).toLocaleString("de-CH")} Zellen)</option>)}</select>}
        </label>
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
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 4 }}>
          {[["box", "Rechteck"], ["circle", "Kreis"], ["hexagon", "Hexagon"], ["triangle", "Dreieck"], ["ellipse", "Ellipse"], ["freeform", "Frei"]].map(([k, lab]) => (
            <button key={k} onClick={() => { setFrameShape(k); if (k !== "freeform") setFreeformDrawing(false); }} style={{
              flex: "1 1 30%", padding: "8px 6px", borderRadius: 9, fontSize: 11.5, fontWeight: 700, cursor: "pointer", fontFamily: MONO,
              border: frameShape === k ? `1px solid ${T.accent}` : "1px solid rgba(92,240,204,0.14)",
              background: frameShape === k ? "rgba(92,240,204,0.12)" : T.bg2, color: frameShape === k ? T.accent : T.sub,
            }}>{lab}</button>
          ))}
        </div>
        <div style={{ fontSize: 10, color: T.sub, opacity: 0.7, fontFamily: MONO, lineHeight: 1.4 }}>
          {frameShape === "circle"
            ? (torusOn ? "Kreis + Torus: antipodale Identifikation (reelle projektive Ebene, RP2). Reflexionsfrei, aber nicht-orientierbar - Muster kehren am Rand spiegelverkehrt zurueck (Moebius-Eigenschaft)." : "Kreis + Rand: harte runde Wand, Null-Fluss (Neumann), massenerhaltend.")
            : frameShape === "ellipse"
            ? "Ellipse: Welt-Test ((x-cx)/a)^2 + ((y-cy)/b)^2 <= 1 mit zwei Halbachsen a (waagerecht) / b (senkrecht). Berandet (Neumann-Wand), kein Torus. a=b ergibt exakt einen Kreis."
            : frameShape === "freeform"
            ? "Frei: selbst gezeichnete Form. Knopf 'Zeichnen' druecken, dann mit gedruecktem Finger/Maus einen geschlossenen Zug auf das Feld ziehen. Maske via Winding-Number (auch selbst-ueberschneidende Formen korrekt). Berandet, kein Torus."
            : frameShape === "hexagon"
            ? "Hexagon: exaktes regelmaessiges Sechseck via Hex-Distanz (Wuerfelkoordinaten), die natuerliche Form des Hexgitters. Berandet (Neumann-Wand), kein Torus - die Form kachelt das Gitter nicht periodisch sauber."
            : frameShape === "triangle"
            ? "Dreieck: gleichseitig (Spitze oben) via Schnittmenge dreier Halbebenen. Berandet (Neumann-Wand), kein Torus. Eckzellen haben wenige Nachbarn - sichtbar staerkere Randdynamik."
            : (torusOn ? "Rechteck + Torus: periodischer Rand (Standard-Wrap)." : "Rechteck + Rand: feste Wand, Null-Fluss (Neumann).")}
        </div>

        {/* AP-2: Kreis-Radius waehlen (Slider + Zahl). Nur bei Kreis. */}
        {frameShape === "circle" && (
          <div style={{ marginTop: 8, padding: "8px 10px", borderRadius: 9, background: T.bg2, border: "1px solid rgba(92,240,204,0.14)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
              <span style={{ fontSize: 11, color: T.sub, fontFamily: MONO, whiteSpace: "nowrap" }}>Kreis-Radius</span>
              <input type="range" min={10} max={MAX_CIRCLE_RADIUS} step={1} value={circleRadius}
                onChange={(e) => setCircleRadius(clamp(Number(e.target.value) || 10, 10, MAX_CIRCLE_RADIUS))}
                style={{ flex: 1, accentColor: T.accent }} aria-label="Kreis-Radius" />
              <input type="number" min={10} max={MAX_CIRCLE_RADIUS} value={circleRadius}
                onChange={(e) => { const v = Number(e.target.value); if (Number.isFinite(v)) setCircleRadius(clamp(Math.round(v), 10, MAX_CIRCLE_RADIUS)); }}
                style={{ width: 56, padding: "4px 6px", borderRadius: 7, fontSize: 12, fontFamily: MONO, background: T.bg, color: T.accent, border: `1px solid ${T.border}`, textAlign: "right" }}
                aria-label="Kreis-Radius (Zahl)" />
            </div>
            <div style={{ fontSize: 10, color: T.sub, opacity: 0.85, fontFamily: MONO, lineHeight: 1.4 }}>
              Wie gross der Kreis ist: 10 (klein) bis {MAX_CIRCLE_RADIUS} (maximal). Standard {DEFAULT_CIRCLE_RADIUS}.
              Gitter {R}x{C}, davon ~{(boundaryStat.total || 0).toLocaleString("de-CH")} Zellen im Kreis.
            </div>
          </div>
        )}

        {/* v33 PR-E: Ellipse-Halbachsen a/b waehlen (zwei Regler). Nur bei Ellipse. */}
        {frameShape === "ellipse" && (
          <div style={{ marginTop: 8, padding: "8px 10px", borderRadius: 9, background: T.bg2, border: "1px solid rgba(92,240,204,0.14)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
              <span style={{ fontSize: 11, color: T.sub, fontFamily: MONO, whiteSpace: "nowrap" }}>Achse a (waagerecht)</span>
              <input type="range" min={5} max={MAX_CIRCLE_RADIUS} step={1} value={ellipseA}
                onChange={(e) => setEllipseA(clamp(Number(e.target.value) || 5, 5, MAX_CIRCLE_RADIUS))}
                style={{ flex: 1, accentColor: T.accent }} aria-label="Ellipse Achse a" />
              <input type="number" min={5} max={MAX_CIRCLE_RADIUS} value={ellipseA}
                onChange={(e) => { const v = Number(e.target.value); if (Number.isFinite(v)) setEllipseA(clamp(Math.round(v), 5, MAX_CIRCLE_RADIUS)); }}
                style={{ width: 56, padding: "4px 6px", borderRadius: 7, fontSize: 12, fontFamily: MONO, background: T.bg, color: T.accent, border: `1px solid ${T.border}`, textAlign: "right" }}
                aria-label="Ellipse Achse a (Zahl)" />
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
              <span style={{ fontSize: 11, color: T.sub, fontFamily: MONO, whiteSpace: "nowrap" }}>Achse b (senkrecht)</span>
              <input type="range" min={5} max={MAX_CIRCLE_RADIUS} step={1} value={ellipseB}
                onChange={(e) => setEllipseB(clamp(Number(e.target.value) || 5, 5, MAX_CIRCLE_RADIUS))}
                style={{ flex: 1, accentColor: T.accent }} aria-label="Ellipse Achse b" />
              <input type="number" min={5} max={MAX_CIRCLE_RADIUS} value={ellipseB}
                onChange={(e) => { const v = Number(e.target.value); if (Number.isFinite(v)) setEllipseB(clamp(Math.round(v), 5, MAX_CIRCLE_RADIUS)); }}
                style={{ width: 56, padding: "4px 6px", borderRadius: 7, fontSize: 12, fontFamily: MONO, background: T.bg, color: T.accent, border: `1px solid ${T.border}`, textAlign: "right" }}
                aria-label="Ellipse Achse b (Zahl)" />
            </div>
            <div style={{ fontSize: 10, color: T.sub, opacity: 0.85, fontFamily: MONO, lineHeight: 1.4 }}>
              a = waagerechte, b = senkrechte Halbachse (Gitterschritte, je auf das Gitter geklemmt).
              a = b ergibt einen Kreis. Gitter {R}x{C}, ~{(boundaryStat.total || 0).toLocaleString("de-CH")} Zellen in der Ellipse.
            </div>
          </div>
        )}

        {/* v33 PR-E: Freiform — Zeichnen-Knopf + Status. Nur bei "Frei". */}
        {frameShape === "freeform" && (
          <div style={{ marginTop: 8, padding: "8px 10px", borderRadius: 9, background: T.bg2, border: "1px solid rgba(92,240,204,0.14)" }}>
            <div style={{ display: "flex", gap: 6, marginBottom: 6 }}>
              <button aria-label="Freiform zeichnen" aria-pressed={freeformDrawing} onClick={() => setFreeformDrawing((v) => !v)} style={{
                flex: 1, padding: "8px 6px", borderRadius: 9, fontSize: 11.5, fontWeight: 700, cursor: "pointer", fontFamily: MONO,
                border: freeformDrawing ? `1px solid ${T.accent}` : "1px solid rgba(92,240,204,0.14)",
                background: freeformDrawing ? "rgba(92,240,204,0.12)" : T.bg, color: freeformDrawing ? T.accent : T.sub,
              }}>{freeformDrawing ? "Zeichnen aktiv…" : "✎ Zeichnen"}</button>
              <button aria-label="Freiform loeschen" onClick={() => { setFreeformPolygon([]); setFreeformDrawing(false); }} style={{
                flex: 1, padding: "8px 6px", borderRadius: 9, fontSize: 11.5, fontWeight: 700, cursor: "pointer", fontFamily: MONO,
                border: "1px solid rgba(92,240,204,0.14)", background: T.bg, color: T.sub,
              }}>Leeren</button>
            </div>
            <div style={{ fontSize: 10, color: T.sub, opacity: 0.85, fontFamily: MONO, lineHeight: 1.4 }}>
              {freeformDrawing
                ? "Jetzt mit gedruecktem Finger/Maus einen geschlossenen Zug auf das Feld ziehen. Loslassen schliesst die Form."
                : freeformPolygon.length >= 3
                ? `Form mit ${freeformPolygon.length} Punkten gezeichnet. ~${(boundaryStat.total || 0).toLocaleString("de-CH")} Zellen darin. "Zeichnen" fuer eine neue Form.`
                : "Noch keine Form. \"Zeichnen\" druecken und auf dem Feld einen Zug ziehen."}
            </div>
          </div>
        )}

        {N >= 250000 && (
          <div style={{ marginTop: 8, padding: "7px 10px", borderRadius: 9, background: "rgba(255,180,60,0.10)", border: "1px solid rgba(255,180,60,0.35)", fontSize: 10.5, color: "#f0c674", fontFamily: MONO, lineHeight: 1.4 }}>
            Sehr grosses Gitter ({(N).toLocaleString("de-CH")} Zellen). Auf aelteren Handys / 8-GB-PCs
            kann der Browser langsam werden oder den Tab neu laden. Bei Rucklern eine Stufe kleiner waehlen.
          </div>
        )}
        {hqstLocked && simMode === "rval" && rvalRule === "hqst" && (
          <div style={{ marginTop: 8, padding: "7px 10px", borderRadius: 9, background: "rgba(255,120,120,0.10)", border: "1px solid rgba(255,120,120,0.35)", fontSize: 10.5, color: "#ffb0b0", fontFamily: MONO, lineHeight: 1.4 }}>
            HQST (Quantenwelle) ist ab {(HQST_CELL_CAP).toLocaleString("de-CH")} Zellen gesperrt - der
            Crank-Nicolson-Loeser waere hier unzumutbar langsam. Fuer Riesen-Gitter den booleschen
            Modus (Game of Life) nutzen, oder das Gitter verkleinern.
          </div>
        )}

        {/* OffscreenCanvas-Worker (Stufe 1) + Auto-Worker-Hinweise. v33: hier bei der
            Gitter-Groesse einsortiert (Worker = Riesen-Gitter-Konzern, Tab 3). */}
        {workerSupported && (
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 10, marginBottom: 10, fontFamily: MONO, fontSize: 11, color: T.sub }}>
            <button
              onClick={() => {
                setRunning(false);
                setWorkerMode((v) => {
                  const next = !v;
                  userWorkerPrefRef.current = next;
                  workerModeRef.current = next;
                  return next;
                });
                setAutoWorkerNotice(false);
                setCanvasKey((k) => k + 1);
              }}
              aria-pressed={workerMode}
              title="Simulation + Raster-Render in einen OffscreenCanvas-Worker auslagern (Beta, Stufe 1)"
              style={{
                padding: "7px 12px", borderRadius: 9, cursor: "pointer", fontFamily: MONO, fontSize: 11, fontWeight: 700,
                border: `1px solid ${workerMode ? T.accent : T.border}`,
                background: workerMode ? "rgba(92,240,204,0.14)" : T.bg2,
                color: workerMode ? T.accent : T.sub,
              }}
            >
              Worker {workerMode ? "AN" : "AUS"} (Beta)
            </button>
            <span style={{ opacity: 0.7, lineHeight: 1.35 }}>
              {workerMode
                ? "Sim + Raster off-main-thread. Gesten/Detail-Render pausiert (Stufe 1)."
                : "Off-main-thread Raster-Render fuer grosse Gitter. Fallback: Haupt-Thread."}
            </span>
          </div>
        )}
        {workerSupported && workerMode && autoWorkerNotice && bigGrid && (
          <div style={{ marginBottom: 10, padding: "7px 10px", borderRadius: 9, background: "rgba(92,240,204,0.10)", border: "1px solid rgba(92,240,204,0.35)", fontSize: 10.5, color: T.accent, fontFamily: MONO, lineHeight: 1.4 }}>
            Grosses Gitter ({N.toLocaleString("de-CH")} Zellen): Der Worker wurde
            automatisch eingeschaltet, damit die App nicht einfriert. Du kannst ihn
            mit dem Schalter oben jederzeit wieder ausschalten.
          </div>
        )}
        {workerSupported && !workerMode && bigGrid && !hqstActiveLocked && (
          <div style={{ marginBottom: 10, padding: "7px 10px", borderRadius: 9, background: "rgba(255,120,120,0.10)", border: "1px solid rgba(255,120,120,0.35)", fontSize: 10.5, color: "#ffb0b0", fontFamily: MONO, lineHeight: 1.4 }}>
            Worker ist AUS bei {N.toLocaleString("de-CH")} Zellen - der Haupt-Thread
            kann hier einfrieren. Schalte den Worker oben ein, oder verkleinere das Gitter.
          </div>
        )}
        {!workerSupported && bigGrid && !hqstActiveLocked && (
          <div style={{ marginBottom: 10, padding: "7px 10px", borderRadius: 9, background: "rgba(255,120,120,0.10)", border: "1px solid rgba(255,120,120,0.35)", fontSize: 10.5, color: "#ffb0b0", fontFamily: MONO, lineHeight: 1.4 }}>
            Grosses Gitter ({N.toLocaleString("de-CH")} Zellen): Dieser Browser
            unterstuetzt den Worker nicht - der Haupt-Thread kann einfrieren.
            Verkleinere das Gitter fuer fluessiges Verhalten.
          </div>
        )}
      </div>

      {/* WATZLAWICK-AXIOME (komplett erhalten, Auflage Punkt 1) */}
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
    </>
  );

  // v33 Tab 4 (Physik): Simulationsmodus + reellwertige Regeln (Schnee/Wasser/HQST/
  // Collatz/Gene) + Solver + Seed + Forschung (Recorder + Globalarchiv).
  const tab4Content = (
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
              {solverWarn && solverId === "cn" && (
                <div style={{ fontSize: 10, color: "#FFB347", fontFamily: MONO, lineHeight: 1.4, marginTop: 4 }}>
                  Warnung: Crank-Nicolson-Fixpunkt nicht konvergiert (Parameter zu gross). Ergebnis kann ungenau sein.
                </div>
              )}
              {solverDiverged && (
                <div style={{ fontSize: 10, color: "#FF6680", fontFamily: MONO, lineHeight: 1.4, marginTop: 4 }}>
                  Divergenz abgefangen: {SOLVERS[solverId] ? solverId.toUpperCase() : "Der Loeser"} ist fuer die Schroedingergleichung instabil und die Amplitude wuchs unbegrenzt. Das Feld wurde genullt und der Lauf gestoppt. Fuer stabile Langzeitlaeufe Crank-Nicolson (cn) waehlen und neu seeden.
                </div>
              )}
            </div>
          )}
        </>
      )}

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

      {/* Statistik-Detail (Farb-Aufschluesselung + Sparkline + Randbedingung) */}
      <div style={{ marginBottom: 6, padding: "10px 12px", borderRadius: 12, border: `1px solid ${T.border}`, background: T.panel, fontFamily: MONO }}>
        <div style={{ fontSize: 11, color: T.sub, marginBottom: 8 }}>STATISTIK-DETAIL</div>
        {!stats.rval && boundaryInfo.count > 0 && (
          <div style={{ fontSize: 10, color: T.sub, opacity: 0.7, marginBottom: 8, lineHeight: 1.4 }}>
            Randzellen: <b style={{ color: T.text }}>{boundaryInfo.count}</b> von {boundaryInfo.total} &middot; {
              (frameShape === "box" && torusOn)
                ? "periodischer Rand (Torus, kein fester Rand)"
                : (frameShape === "circle" && torusOn)
                ? "antipodaler Rand (RP2)"
                : (boundaryMode === "adiabatic")
                ? "reflektierende Wand (adiabatisch: fehlender Nachbar spiegelt die Zelle)"
                : "feste Wand (Null-Randbedingung: fehlende Nachbarn = tot)"
            }
          </div>
        )}
        {!stats.rval && boundaryInfo.count > 0 && !((frameShape === "box" || frameShape === "circle") && torusOn) && (
          <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
            {[["null", "Feste Wand"], ["adiabatic", "Reflektierend"]].map(([k, lab]) => (
              <button key={k} onClick={() => setBoundaryMode(k)} style={{
                flex: 1, padding: "6px 6px", borderRadius: 8, fontSize: 10.5, fontWeight: 700, cursor: "pointer", fontFamily: MONO,
                border: boundaryMode === k ? `1px solid ${T.accent}` : "1px solid rgba(92,240,204,0.14)",
                background: boundaryMode === k ? "rgba(92,240,204,0.12)" : T.bg2, color: boundaryMode === k ? T.accent : T.sub,
              }}>{lab}</button>
            ))}
          </div>
        )}
        {stats.rval ? (
          <div style={{ fontSize: 11, color: T.sub, marginBottom: 8, lineHeight: 1.5 }}>
            {rvalRule === "snow" && <span>Eiszellen: <b style={{ color: T.text }}>{total}</b> &middot; reellwertige Diffusion</span>}
            {rvalRule === "water" && <span>Wasserzellen: <b style={{ color: T.text }}>{total}</b> &middot; Gesamtmasse <b style={{ color: T.text }}>{(stats.rvalSum || 0).toFixed(0)}</b> (erhalten)</span>}
            {rvalRule === "hqst" && <span>Belegte Zellen: <b style={{ color: T.text }}>{total}</b> &middot; Norm <b style={{ color: T.text }}>{(stats.rvalSum || 0).toFixed(3)}</b> (unitaer)</span>}
            {rvalRule === "collatz" && <span>Zellen &gt; 1: <b style={{ color: T.text }}>{total}</b> &middot; Collatz-Folgen aktiv</span>}
            {rvalRule === "genes" && <span>Lebende Genotypen: <b style={{ color: T.text }}>{total}</b> &middot; Mendel/Hardy-Weinberg</span>}
          </div>
        ) : (<>
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

      <div style={{ fontSize: 10.5, color: T.sub, opacity: 0.7, lineHeight: 1.6, fontFamily: MONO }}>
        Pinsel Zyklus: ein Tap schaltet weiter (leer&rarr;blau&rarr;rot&rarr;gelb&rarr;leer), ein Finger pant. Blau/Rot/Gelb/Leer: Tap und Ziehen malen.
        Zwei Finger oder Rad = Zoom (jetzt bis 0.2x rausgezoomt), Fit zentriert. Regelquelle "Nur Watzlawick" deaktiviert die B/S-Rulesets.
      </div>
    </>
  );

  return (
    <div style={compact
      ? {
          // AP-4: 1-Seiten-Mobile-Shell. Volle (dynamische) Viewport-Hoehe, kein
          // Seiten-Scroll: Header (fix) + Leinwand (flex, max) + Kern-Leiste (fix).
          // safe-area-insets fuer Notch/Home-Indicator (viewport-fit=cover, index.html).
          fontFamily: DISP, background: `radial-gradient(120% 80% at 50% 0%, ${T.bg2} 0%, ${T.bg} 70%)`,
          color: T.text, boxSizing: "border-box", height: "100dvh", overflow: "hidden",
          display: "flex", flexDirection: "column",
          paddingTop: "max(8px, env(safe-area-inset-top))",
          paddingLeft: "max(8px, env(safe-area-inset-left))",
          paddingRight: "max(8px, env(safe-area-inset-right))",
          paddingBottom: "max(8px, env(safe-area-inset-bottom))",
          overscrollBehavior: "contain", touchAction: "pan-y",
        }
      : { fontFamily: DISP, background: `radial-gradient(120% 80% at 50% 0%, ${T.bg2} 0%, ${T.bg} 70%)`, minHeight: "100%", color: T.text, padding: "12px 12px 26px", boxSizing: "border-box", overscrollBehavior: "contain", touchAction: "pan-y" }
    }>
      {/* Globale UI-Standards (WCAG 2.2): jeder Button mindestens 44px Touch-Target,
          sichtbarer Fokusring fuer Tastaturbedienung, leichtes Hover/Active-Feedback.
          Schieberegler beanspruchen ihre Bedienachse: touch-action verhindert, dass
          das Ziehen am Regler stattdessen die Seite scrollt (MDN: touch-action ist
          die Schnittmenge von Element + Vorfahren). overscroll-behavior unterbindet
          das Fortpflanzen einer Geste auf Pull-to-Refresh/Zurueck-Wischen.
          AP-4 PR#44-Auflage (3): user-select:none + -webkit-touch-callout:none auf
          Leinwand UND Farbrad -> kein Text-/Bild-Markieren oder iOS-Callout beim
          langen Druck (Long-Press-Geste sauber, kein nativer Selektions-Konflikt). */}
      <style>{`
        button { min-height: 44px; }
        button:focus-visible { outline: 2px solid ${T.accent}; outline-offset: 2px; }
        button:active { transform: translateY(1px); }
        input[type="range"] { min-height: 32px; touch-action: none; }
        input:focus-visible, select:focus-visible { outline: 2px solid ${T.accent}; outline-offset: 2px; }
        /* prefers-reduced-motion: keine Transitionen UND kein Press-Versatz (das
           Verschieben beim Druecken ist Bewegung; deaktiviert -> ruhige UI fuer
           bewegungsempfindliche Nutzer, deterministische Hit-Tests). */
        @media (prefers-reduced-motion: reduce) {
          * { transition: none !important; }
          button:active { transform: none !important; }
        }
        /* v33 Statistik-Zeile: feste Hoehe, horizontal scrollbar OHNE Layout-Sprung.
           Scrollbalken ausblenden + Hoehe konstant halten -> kein Jitter, der die
           darunter liegende Steuerung waehrend eines laufenden Sims verschiebt. */
        .ghx-stats { scrollbar-width: none; -ms-overflow-style: none; }
        .ghx-stats::-webkit-scrollbar { display: none; height: 0; }
        .ghx-canvas, .ghx-canvas canvas, [data-testid="color-wheel"] {
          -webkit-user-select: none; user-select: none;
          -webkit-touch-callout: none;
        }
      `}</style>
      {/* v33 TOP-LEISTE (52px): 4 Tabs links + Aktions-Icons rechts (Snapshot 📷 /
          Speichern 💾 — PR-C/D, vorerst disabled+TODO) + Schliessen ✕ (closeApp).
          Tab-Tipp oeffnet/schliesst den zugehoerigen Panel-Overlay (toggleTab). */}
      <div style={{ flexShrink: 0, display: "flex", alignItems: "stretch", height: 52, marginBottom: compact ? 6 : 8,
        background: T.panel, border: `1px solid ${T.border}`, borderRadius: compact ? 10 : 12, overflow: "hidden" }}>
        <div style={{ display: "flex", flex: 1, minWidth: 0 }}>
          {TABS.map((t) => {
            const on = activeTab === t.id;
            return (
              <button key={t.id} onClick={() => toggleTab(t.id)} aria-pressed={on}
                aria-label={`Tab ${t.id} ${t.label}`} title={t.label}
                style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 1,
                  cursor: "pointer", border: "none", borderRight: `1px solid ${T.border}`,
                  background: on ? T.bg2 : "transparent", color: on ? T.accent : T.sub,
                  boxShadow: on ? `inset 0 -3px 0 ${T.accent}` : "none", fontFamily: MONO, padding: 0 }}>
                <span style={{ fontSize: 15, lineHeight: 1 }}>{t.icon}</span>
                <span style={{ fontSize: 9, opacity: 0.85, whiteSpace: "nowrap" }}>{t.id} {t.label}</span>
              </button>
            );
          })}
        </div>
        <div style={{ display: "flex", flexShrink: 0 }}>
          {/* v33 PR-D: Snapshot (canvas.toBlob -> Web Share L2 / Download-Fallback).
              1 Tipp -> System-Share-Sheet bzw. Download startet (kein Zwischendialog). */}
          <button onClick={shareCanvasImage} aria-label="Snapshot teilen"
            title="Snapshot teilen (Bild des Feldes — Teilen oder Download)"
            data-testid="snapshot-btn"
            style={{ width: 42, border: "none", borderLeft: `1px solid ${T.border}`, background: "transparent", color: T.text, fontSize: 16, cursor: "pointer" }}>📷</button>
          {/* v33 PR-C: Spielstand speichern (IndexedDB + Datei-Export/Import). */}
          <button onClick={toggleSavePanel} aria-label="Spielstand speichern" aria-pressed={saveOpen}
            title="Speichern (Spielstand: Feld + Regel + Rahmen)"
            style={{ width: 42, border: "none", borderLeft: `1px solid ${T.border}`, background: saveOpen ? T.bg2 : "transparent", color: saveOpen ? T.accent : T.text, fontSize: 16, cursor: "pointer" }}>💾</button>
          <button onClick={closeApp} aria-label="App schliessen" title="Schliessen"
            style={{ width: 46, border: "none", borderLeft: `1px solid ${T.border}`, background: "rgba(255,51,85,0.12)", color: "#FFC2CE", fontSize: 17, fontWeight: 700, fontFamily: MONO, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>&times;</button>
        </div>
      </div>

      {/* v33 PR-C: Spielstand-Panel (IndexedDB-Slots + Datei-Export/Import).
          "Speichern = kompletter Spielstand" (Feld + Regel + Rahmen + Groesse).
          Klick-Effizienz: Name vorbelegt -> Enter speichert; Slot-Tipp laedt. */}
      {saveOpen && (
        <div data-testid="save-panel" style={{ flexShrink: 0, marginBottom: compact ? 6 : 8, padding: 12, borderRadius: 12, border: `1px solid ${T.accent}`, background: T.panel, fontFamily: MONO }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: T.accent }}>Spielstand speichern</span>
            <span style={{ fontSize: 10, color: T.sub }}>Feld + Regel + Rahmen + Groesse</span>
            <button onClick={() => setSaveOpen(false)} aria-label="Speichern-Panel schliessen"
              style={{ marginLeft: "auto", width: 28, height: 28, borderRadius: 7, border: `1px solid ${T.border}`, background: "transparent", color: T.sub, cursor: "pointer", fontSize: 14 }}>&times;</button>
          </div>
          <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
            <input value={saveName} onChange={(e) => setSaveName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") saveToSlot(saveName); }}
              aria-label="Name fuer Spielstand" placeholder="Name"
              style={{ flex: 1, minWidth: 0, height: 38, borderRadius: 9, border: `1px solid ${T.border}`, background: T.bg2, color: T.text, padding: "0 10px", fontFamily: MONO, fontSize: 12 }} />
            <button onClick={() => saveToSlot(saveName)} aria-label="Speichern"
              style={{ height: 38, padding: "0 12px", borderRadius: 9, border: "none", background: T.accent, color: "#04110d", fontWeight: 700, fontFamily: MONO, fontSize: 12, cursor: "pointer" }}>Speichern</button>
          </div>
          <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
            <button onClick={exportSaveFile} aria-label="Als Datei exportieren"
              style={{ flex: 1, height: 34, borderRadius: 9, border: `1px solid ${T.border}`, background: T.bg2, color: T.text, fontFamily: MONO, fontSize: 11, cursor: "pointer" }}>⬇ Datei</button>
            <button onClick={() => fileInputRef.current && fileInputRef.current.click()} aria-label="Datei importieren"
              style={{ flex: 1, height: 34, borderRadius: 9, border: `1px solid ${T.border}`, background: T.bg2, color: T.text, fontFamily: MONO, fontSize: 11, cursor: "pointer" }}>⬆ Laden</button>
            <input ref={fileInputRef} type="file" accept=".json,application/json" onChange={importSaveFile} style={{ display: "none" }} aria-label="Spielstand-Datei" />
          </div>
          {/* Slot-Liste: Tipp = laden; ✎ umbenennen; 🗑 loeschen. */}
          <div data-testid="save-slots" style={{ maxHeight: 160, overflowY: "auto", display: "flex", flexDirection: "column", gap: 4 }}>
            {saveSlots.length === 0 && <span style={{ fontSize: 11, color: T.sub, padding: "4px 2px" }}>Noch keine Spielstaende.</span>}
            {saveSlots.map((s) => (
              <div key={s.key} style={{ display: "flex", alignItems: "center", gap: 6, background: T.bg2, border: `1px solid ${T.border}`, borderRadius: 9, padding: "5px 8px" }}>
                <button onClick={() => loadFromSlot(s.key)} aria-label={`Laden ${s.key}`} title="Laden"
                  style={{ flex: 1, minWidth: 0, textAlign: "left", border: "none", background: "transparent", color: T.text, cursor: "pointer", fontFamily: MONO, fontSize: 11, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {s.key}{s.meta && s.meta.gen ? ` · Gen ${s.meta.gen}` : ""}
                </button>
                <button onClick={() => renameSlot(s.key)} aria-label={`Umbenennen ${s.key}`} title="Umbenennen"
                  style={{ width: 30, height: 30, borderRadius: 7, border: `1px solid ${T.border}`, background: "transparent", color: T.sub, cursor: "pointer", fontSize: 12 }}>✎</button>
                <button onClick={() => deleteSlot(s.key)} aria-label={`Loeschen ${s.key}`} title="Loeschen"
                  style={{ width: 30, height: 30, borderRadius: 7, border: "1px solid rgba(224,90,90,0.45)", background: "rgba(224,90,90,0.10)", color: "#FFB3C0", cursor: "pointer", fontSize: 12 }}>🗑</button>
              </div>
            ))}
          </div>
          {saveMsg && <div data-testid="save-msg" style={{ marginTop: 8, fontSize: 11, color: T.sub }}>{saveMsg}</div>}
        </div>
      )}

      <div ref={wrapRef} className="ghx-canvas" style={{ position: "relative", width: "100%", flex: compact ? "1 1 0" : "none", minHeight: compact ? 0 : 360, borderRadius: compact ? 10 : 14, overflow: "hidden", border: `1px solid ${T.border}`, background: T.bg, boxShadow: `0 0 30px rgba(92,240,204,0.06) inset` }}>
        <canvas key={canvasKey} ref={canvasRef} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}
          onContextMenu={(e) => e.preventDefault()}
          style={{ display: "block", touchAction: "none", cursor: brush === "cycle" ? "pointer" : "crosshair" }} />
        {/* v33.0.2: Rahmen-Umriss-Overlay. Liegt über der Feld-Canvas, leitet keine
            Pointer-Events ab (transparent). Nötig, weil im Worker-Modus die Feld-Canvas
            an den Worker übergeben ist und der Worker den dünnen Umriss nicht zeichnet.
            NUR im Worker-Modus gemountet -> im Main-Modus bleibt es bei EINER Canvas
            (Kontrakt/Visual-Baselines unberührt; der Main-Pfad zeichnet den Umriss selbst). */}
        {workerMode && (
          <canvas ref={overlayRef} aria-hidden="true"
            style={{ position: "absolute", inset: 0, zIndex: 5, pointerEvents: "none" }} />
        )}
        {/* AP-3: Long-Press-Farbrad. Radiale 12-Farb-Auswahl, zentriert auf dem
            Druckpunkt; deckt die Leinwand mit einem Abbruch-Layer (Tipp ausserhalb
            schliesst ohne Auswahl). Erscheint NUR bei aktivem Long-Press -> nicht
            Teil der Canvas-Baselines (Rad ist sonst unsichtbar). */}
        {wheel && (
          <div
            data-testid="color-wheel"
            onPointerDown={(e) => { e.stopPropagation(); }}
            onClick={cancelWheel}
            style={{ position: "absolute", inset: 0, zIndex: 30, touchAction: "none", cursor: "pointer" }}
          >
            {ALLCOL.map((c, i) => {
              const ang = (i / 12) * PI2 - Math.PI / 2; // CR (Rot) oben, im Uhrzeigersinn
              const RAD = 76; // Radius des Rads in CSS-Pixeln
              const cx = wheel.x + RAD * Math.cos(ang);
              const cy = wheel.y + RAD * Math.sin(ang);
              return (
                <button
                  key={c}
                  data-color-state={c}
                  aria-label={`Farbe ${NAME[c]}`}
                  title={NAME[c]}
                  onClick={(e) => { e.stopPropagation(); pickWheelColor(c); }}
                  onPointerUp={(e) => { e.stopPropagation(); pickWheelColor(c); }}
                  style={{
                    position: "absolute", left: cx - 17, top: cy - 17, width: 34, height: 34,
                    borderRadius: "50%", background: COLHEX[c], border: "2px solid rgba(255,255,255,0.85)",
                    boxShadow: "0 2px 8px rgba(0,0,0,0.55)", cursor: "pointer", padding: 0, touchAction: "none",
                  }}
                />
              );
            })}
            {/* Mitte: Abbruch-Markierung (zeigt den Druckpunkt; Tipp ausserhalb bricht ab) */}
            <div style={{
              position: "absolute", left: wheel.x - 9, top: wheel.y - 9, width: 18, height: 18,
              borderRadius: "50%", border: "2px solid rgba(255,255,255,0.6)",
              background: "rgba(6,15,18,0.55)", pointerEvents: "none",
            }} />
          </div>
        )}
        {/* v33 PR-B: LINKS-Drawer fuer Farben (1) + Formen/Stempel (2). Ueberlagert nur
            den linken Teil; das Feld bleibt rechts sichtbar (Recherche Thema 1/3).
            Schliessen: Tap auf den Scrim rechts / Griff-zu / aktiven Tab erneut tippen. */}
        {drawer != null && (
          <>
            {/* Scrim NUR im Farben-Modus (Tab 1): Tap ausserhalb schliesst. Im Formen-
                Modus (Tab 2) bleibt das Feld BEWUSST tappbar — ein Tap setzt dort den
                Stempel (Auftrag 6: kein Bestaetigen). Schliessen dann via Griff/✕/Tab. */}
            {drawer === 1 && (
              <div onPointerDown={() => setDrawer(null)} aria-hidden="true"
                style={{ position: "absolute", inset: 0, zIndex: 19, background: "rgba(2,5,8,0.28)" }} />
            )}
            <div role="dialog" aria-label={`Drawer ${drawer === 1 ? "Farben" : "Formen"}`}
              style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: "min(300px, 82%)", zIndex: 20,
                background: "rgba(16,22,30,0.98)", borderRight: `1px solid ${T.accent}`, display: "flex", flexDirection: "column",
                boxShadow: "4px 0 24px rgba(0,0,0,0.5)", touchAction: "pan-y" }}>
              {/* Drawer-Kopf: zwei Untertabs Farben | Formen + Schliessen-Griff */}
              <div style={{ flexShrink: 0, display: "flex", alignItems: "stretch", borderBottom: `1px solid ${T.border}` }}>
                {[[1, "🎨 Farben"], [2, "⬢ Formen"]].map(([id, lab]) => (
                  <button key={id} onClick={() => setDrawer(id)} aria-pressed={drawer === id}
                    aria-label={`Drawer ${id === 1 ? "Farben" : "Formen"}`}
                    style={{ flex: 1, padding: "10px 4px", border: "none", borderRight: `1px solid ${T.border}`,
                      background: drawer === id ? T.bg2 : "transparent", color: drawer === id ? T.accent : T.sub,
                      boxShadow: drawer === id ? `inset 0 -3px 0 ${T.accent}` : "none",
                      fontFamily: MONO, fontSize: 12, fontWeight: 700, cursor: "pointer" }}>{lab}</button>
                ))}
                <button onClick={() => setDrawer(null)} aria-label="Drawer schliessen" title="Schliessen"
                  style={{ width: 40, border: "none", borderLeft: `1px solid ${T.border}`, background: T.panel, color: T.text,
                    fontFamily: MONO, fontWeight: 700, fontSize: 15, cursor: "pointer" }}>&#10094;</button>
              </div>
              <div style={{ flex: "1 1 0", minHeight: 0, overflowY: "auto", padding: "12px 12px 16px", overscrollBehavior: "contain" }}>
                {drawer === 1 && (
                  <div data-drawer="farben">
                    {brushBlock}
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
                  </div>
                )}
                {drawer === 2 && stampDrawerContent}
              </div>
            </div>
          </>
        )}

        {/* v33: Tab-Panel-Overlay. Liegt UEBER dem Feld (Feld bleibt darunter sichtbar,
            Recherche Thema 3/Entscheid 6). Inhalt je Tab steht weiter unten in
            tabPanelContent; Scrim + Tab-Tipp schliessen. */}
        {activeTab != null && (
          <div role="dialog" aria-label={`Panel ${TABS.find((t) => t.id === activeTab)?.label}`}
            style={{ position: "absolute", inset: 0, zIndex: 20, display: "flex", flexDirection: "column",
              background: T.bg }}>
            <div style={{ flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 12px 8px" }}>
              <div style={{ fontSize: 13, fontWeight: 700, fontFamily: MONO, color: T.accent, letterSpacing: "0.04em" }}>
                {TABS.find((t) => t.id === activeTab)?.icon} {activeTab} {TABS.find((t) => t.id === activeTab)?.label}
              </div>
              <button onClick={() => setActiveTab(null)} aria-label="Panel schliessen" title="Schliessen"
                style={{ width: 44, height: 36, borderRadius: 8, cursor: "pointer", fontFamily: MONO, fontWeight: 700, border: `1px solid ${T.border}`, background: T.panel, color: T.text }}>v</button>
            </div>
            <div style={{ flex: "1 1 0", minHeight: 0, overflowY: "auto", padding: "0 12px 14px", overscrollBehavior: "contain" }}>

              {/* ===================== TAB 1 — FARBEN ===================== */}
              {activeTab === 1 && (
                <div data-tab="farben">
                  {/* Pinsel + Swatches + Sekundaer/Tertiaer + Kreis-Stempel (brushBlock) */}
                  {brushBlock}
                  {/* FARBMODUS (Farbenlehre) */}
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
                </div>
              )}

              {/* ===================== TAB 2 — FORMEN ===================== */}
              {activeTab === 2 && (
                <div data-tab="formen">
                  <div style={{ fontSize: 11, color: T.sub, fontFamily: MONO, marginBottom: 6 }}>STEMPEL / FIGUREN</div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 8 }}>
                    <label style={{ fontSize: 11, color: T.sub, fontFamily: MONO }}>Pattern
                      <select value={pattern} onChange={(e) => setPattern(e.target.value)} style={sel}>{Object.keys(PATS).map((k) => <option key={k} value={k}>{k}</option>)}</select>
                    </label>
                    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                      <span style={{ fontSize: 11, color: T.sub, fontFamily: MONO }}>Aktion</span>
                      {btn(doPlace, "Stempel setzen", { padding: "7px 8px" })}
                    </div>
                  </div>
                  {/* Kreis-Stempel (Ring/Scheibe) — gespiegelt aus dem Pinsel-Block fuer Schnellzugriff */}
                  <div style={{ fontSize: 10.5, color: T.sub, opacity: 0.7, fontFamily: MONO, lineHeight: 1.4, marginBottom: 6 }}>
                    Farbkreis-Stempel: 12 Itten-Toene als Ring oder Scheibe an die naechste Tipp-Position setzen.
                  </div>
                  <div style={{ display: "flex", gap: 6, marginBottom: 6 }}>
                    <button onClick={() => placeColorWheel("ring")} style={{ flex: 1, padding: "9px 4px", borderRadius: 9, fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: MONO, border: `1px solid ${T.border}`, background: T.bg2, color: T.accent }}>Ring</button>
                    <button onClick={() => placeColorWheel("disc")} style={{ flex: 1, padding: "9px 4px", borderRadius: 9, fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: MONO, border: `1px solid ${T.border}`, background: T.bg2, color: T.accent }}>Scheibe</button>
                  </div>
                </div>
              )}

              {/* ===================== TAB 3 — HEX-REGELN ===================== */}
              {activeTab === 3 && (
                <div data-tab="hexregeln">{tab3Content}</div>
              )}

              {/* ===================== TAB 4 — PHYSIK ===================== */}
              {activeTab === 4 && (
                <div data-tab="physik">{tab4Content}</div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* v33 (2026-06-08, User1): Feld-Werkzeugleiste UNTER dem Feld. Zoom (−/Fit/+)
          und der Farben/Stempel-Griff wurden aus dem Hexfeld geholt, damit das GANZE
          Feld/der Rahmen immer unverdeckt sichtbar ist. aria-labels unveraendert. */}
      <div style={{ flexShrink: 0, display: "flex", alignItems: "center", gap: 8, marginTop: compact ? 5 : 8, padding: "0 2px" }}>
        {drawer == null && (
          <button onClick={() => setDrawer(1)} aria-label="Farben & Stempel oeffnen" title="Farben & Stempel oeffnen"
            style={{ height: 40, padding: "0 12px", borderRadius: 10, border: `1px solid ${T.border}`,
              background: "rgba(20,27,36,0.92)", color: T.accent, fontSize: 12, fontWeight: 700, fontFamily: MONO,
              cursor: "pointer", display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ fontSize: 13 }}>&#10095;</span> Farben &amp; Stempel
          </button>
        )}
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ fontSize: 10, color: T.sub, fontFamily: MONO, minWidth: 34, textAlign: "right" }}>
            {zoomLbl >= 10 ? zoomLbl.toFixed(0) : zoomLbl.toFixed(1)}x
          </span>
          {[["−", "Verkleinern", () => zoom(1 / 1.3)], ["Fit", "Einpassen", () => fitView()], ["+", "Vergroessern", () => zoom(1.3)]].map(([lab, al, fn], i) => (
            <button key={i} onClick={fn} aria-label={al} title={al} style={{
              width: 40, height: 40, borderRadius: 10, cursor: "pointer", border: `1px solid ${T.border}`,
              background: "rgba(20,27,36,0.92)", color: T.accent, fontSize: lab === "Fit" ? 12 : 19, fontWeight: 700,
              fontFamily: MONO, lineHeight: 1, display: "flex", alignItems: "center", justifyContent: "center",
            }}>{lab}</button>
          ))}
        </div>
      </div>

      {/* v33 STATISTIK-ZEILE (34px, ueber der Steuerung). Gen · Pop · ±Geburten/Tode ·
          Gen/s · Regel-Chip (B/S, aktiv) · Rahmen+Groesse-Chip. Werte aus bestehendem
          State (stats wird pro Generation/throttled gesetzt, nicht pro rAF-Frame —
          Recherche Thema 6). Horizontal scrollbar bei Ueberlauf, kein Umbruch. */}
      <div className="ghx-stats" style={{ flexShrink: 0, height: 34, display: "flex", alignItems: "center", gap: 10, padding: "0 4px",
        marginTop: compact ? 4 : 8, fontFamily: MONO, fontSize: 12, color: T.sub, whiteSpace: "nowrap",
        overflowX: "auto", overflowY: "hidden", borderTop: `1px solid ${T.border}` }}>
        <span>Gen <b style={{ color: T.text }}>{gen}</b></span>
        <span>{stats.rval ? "Aktiv" : "Pop"} <b data-testid="pop" style={{ color: T.text }}>{total.toLocaleString("de-CH")}</b></span>
        {!stats.rval && <span style={{ color: "#6fd098" }}>+{stats.births}</span>}
        {!stats.rval && <span style={{ color: "#e08a8a" }}>−{stats.deaths}</span>}
        <span>{running ? <><b style={{ color: T.accent }}>{stats.sps.toFixed(0)}</b> Gen/s</> : <span style={{ opacity: 0.55 }}>⏸ pausiert</span>}</span>
        <span style={{ background: T.bg2, border: `1px solid ${T.accent}`, color: T.accent, borderRadius: 8, padding: "1px 7px", fontSize: 11 }}>{ruleChip}</span>
        <span style={{ background: T.bg2, border: `1px solid ${T.border}`, color: T.sub, borderRadius: 8, padding: "1px 7px", fontSize: 11 }}>{frameChip}</span>
      </div>

      {/* v33 PR-D: Snapshot-Rueckmeldung (kurz) + Wasserzeichen-Schalter (abschaltbar,
          Recherche Thema 4: Label optional). Erscheint nur nach erster 📷-Aktion. */}
      {snapMsg && (
        <div data-testid="snap-msg" role="status" style={{ flexShrink: 0, display: "flex", alignItems: "center", gap: 10, padding: "2px 8px", fontFamily: MONO, fontSize: 11, color: T.sub, background: T.bg2, borderTop: `1px solid ${T.border}` }}>
          <span>{snapMsg}</span>
          <label style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 4, cursor: "pointer", whiteSpace: "nowrap" }}>
            <input type="checkbox" checked={snapWatermark} onChange={(e) => setSnapWatermark(e.target.checked)}
              aria-label="Wasserzeichen im Snapshot" style={{ cursor: "pointer" }} />
            Wasserzeichen
          </label>
        </div>
      )}

      {/* v33 STEUERUNG UNTEN. Reihe: 1. Figur (disabled, TODO PR-C) · Undo · Redo
          (disabled, TODO PR-C) · PLAY (60px, gruen, zentral) · Schritt · Random · Leeren
          (rot, abgesetzt). Touch-Targets >=48px. Darunter Tempo-Slider (TURBO-Stufe
          erhalten). safe-area-inset-bottom kommt vom Shell-Padding (compact). */}
      <div style={{ flexShrink: 0, paddingTop: compact ? 6 : 8 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6 }}>
          {/* v33 PR-C: "1. Figur" — stellt den Urzustand (Feld vor dem ersten Play)
              wieder her. Aktiv erst, sobald ein Urzustand gesichert wurde. */}
          <button onClick={restoreOrigin} disabled={!hasOrigin}
            aria-label="Zur ersten Figur" title={hasOrigin ? "Zurueck zum Feld vor dem ersten Play" : "1. Figur — erst nach dem ersten Play verfuegbar"}
            style={{ flex: "1 1 0", minWidth: 0, height: 48, borderRadius: 12, border: `1px solid ${T.border}`, background: hasOrigin ? T.panel : T.bg2, color: hasOrigin ? T.text : T.sub, opacity: hasOrigin ? 1 : 0.4, fontFamily: MONO, fontSize: 11, cursor: hasOrigin ? "pointer" : "not-allowed", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", lineHeight: 1.1 }}>
            <span style={{ fontSize: 16 }}>⏮</span><span style={{ fontSize: 8 }}>1. Figur</span>
          </button>
          <button onClick={doUndo} aria-label="Undo" title="Rueckgaengig"
            style={{ flex: "1 1 0", minWidth: 0, height: 48, borderRadius: 12, border: `1px solid ${T.border}`, background: T.panel, color: T.text, fontFamily: MONO, fontSize: 18, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>↶</button>
          {/* TODO PR-C: Redo (Undo-Stack ist aktuell einseitig) — vorerst disabled. */}
          <button disabled aria-label="Redo (kommt in PR-C)" title="Wiederholen — kommt in PR-C"
            style={{ flex: "1 1 0", minWidth: 0, height: 48, borderRadius: 12, border: `1px solid ${T.border}`, background: T.bg2, color: T.sub, opacity: 0.4, fontFamily: MONO, fontSize: 18, cursor: "not-allowed", display: "flex", alignItems: "center", justifyContent: "center" }}>↷</button>
          <button onClick={togglePlay} aria-label={running ? "Pause" : "Start"} title={running ? "Pause" : "Start"}
            style={{ flexShrink: 0, width: 60, height: 60, borderRadius: "50%", border: "none",
              background: running ? "#e05a5a" : T.accent, color: running ? "#2a0707" : "#04110d",
              fontSize: 24, fontWeight: 700, cursor: "pointer", boxShadow: `0 0 18px ${running ? "#e05a5a" : T.accent}66`,
              display: "flex", alignItems: "center", justifyContent: "center" }}>{running ? "❚❚" : "▶"}</button>
          <button onClick={doStep} aria-label="Schritt" title="Ein Schritt"
            style={{ flex: "1 1 0", minWidth: 0, height: 48, borderRadius: 12, border: `1px solid ${T.border}`, background: T.panel, color: T.text, fontFamily: MONO, fontSize: 11, cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", lineHeight: 1.1 }}>
            <span style={{ fontSize: 16 }}>⏭</span><span style={{ fontSize: 8 }}>Schritt</span>
          </button>
          <button onClick={doRandom} aria-label="Random" title="Zufalls-Fuellung"
            style={{ flex: "1 1 0", minWidth: 0, height: 48, borderRadius: 12, border: `1px solid ${T.border}`, background: T.panel, color: T.text, fontFamily: MONO, fontSize: 11, cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", lineHeight: 1.1 }}>
            <span style={{ fontSize: 15 }}>🎲</span><span style={{ fontSize: 8 }}>Random</span>
          </button>
          {/* Leeren rot abgesetzt (Mis-Tap-Schutz, Recherche Thema 2: nicht neben Play) */}
          <button onClick={doClear} aria-label="Leeren" title="Feld leeren"
            style={{ flex: "1 1 0", minWidth: 0, height: 48, borderRadius: 12, border: "1px solid rgba(224,90,90,0.45)", background: "rgba(224,90,90,0.12)", color: "#FFB3C0", fontFamily: MONO, fontSize: 11, cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", lineHeight: 1.1 }}>
            <span style={{ fontSize: 15 }}>🗑</span><span style={{ fontSize: 8 }}>Leeren</span>
          </button>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 9, padding: "0 2px", fontFamily: MONO }}>
          <span style={{ fontSize: 11, color: T.sub, width: 42 }}>Tempo</span>
          <input type="range" min={0} max={SPEEDS.length - 1} value={speedIdx} onChange={(e) => setSpeedIdx(Number(e.target.value))} aria-label="Tempo" style={{ flex: 1, accentColor: T.accent }} />
          <span style={{ fontSize: 11, color: T.text, width: 46, textAlign: "right" }}>{SPLBL[speedIdx]}</span>
        </div>
      </div>

    </div>
  );
}
