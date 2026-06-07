import { useState, useCallback, useEffect, useRef } from "react";
// Sim-Engine (pure, worker-importfaehig) - aus dieser Datei extrahiert (AP-1).
import {
  S3, PI2, PI3, C0, CR, CRO, CO, CYO, CY, CYG, CG, CBG, CB, CBV, CV, CRV,
  PRIMARY, ALLCOL, CYCLE, T, COLA, COLHEX,
  NAME, COSH, SINH, hueToState, GRID_SIZES, SPEEDS, SPLBL,
  DENS, MAX_UNDO, RULES, RMETA, hexClass2, INT_RULES, INT_META, WATZ_META,
  PATS, AXIOMS, PAD, clamp, hexCenter, pixelToOddR, worldSize, buildNeighbors,
  hash2, rng, birthColorQuad, cMixVec, mMixCnt, driftHue, RVAL_RULES, stepReiter, stepWater,
  SOLVERS, mkHqstWork, stepHQST, rvalColor, stepCollatz,
  collatzColor, G_AA, G_Aa, G_aa, genotype, stepGenes, geneColor,
  oddRToCube, cubeToOddR, hexDist, CUBE_DIRS,
} from "./lib/sim-engine.js";
import { renderRaster } from "./lib/raster-render.js"; // geteilter Raster-Pfad (Worker + Main)
import { supportsOffscreenWorker } from "./lib/worker-support.js"; // Feature-Detection (fail-closed)
// Re-Export der von den Unit-Tests importierten Engine-Funktionen, damit die
// bestehenden Test-Importpfade (tests/unit/*.test.js -> "../../src/App.tsx")
// unveraendert weiterlaufen (PR#41-Kontrakt, named exports, export-only).
export { buildNeighbors, mkHqstWork, stepHQST };

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
  // AP-1 OffscreenCanvas-Worker (Stufe 1): Sim + Raster-Render off-main-thread.
  // Feature-detektiert (fail-closed) + OPT-IN: Default AUS, damit der bewaehrte
  // Haupt-Thread-Pfad (inkl. aller Gesten/Path2D-Detail/inkrementell) unveraendert
  // laeuft. Ist OffscreenCanvas nicht verfuegbar (alte Browser/Safari), bleibt der
  // Schalter ausgeblendet und der Main-Thread-Pfad ist der Fallback.
  const [workerSupported] = useState(() => supportsOffscreenWorker());
  const [workerMode, setWorkerMode] = useState(false);
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
  const wrapRef = useRef(null);
  const undoRef = useRef([]);

  const cfg = useRef({ ruleIdx, torusOn, ax, a5, R, C, watzOnly, ruleSrc });
  useEffect(() => { cfg.current = { ruleIdx, torusOn, ax: { ...ax, colorMode }, a5, R, C, watzOnly, ruleSrc, sysT: sysTheory, sysSp: sysSetpoint, openSys, solverId, bcMode: boundaryMode }; }, [ruleIdx, torusOn, ax, a5, R, C, watzOnly, colorMode, ruleSrc, sysTheory, sysSetpoint, openSys, solverId, boundaryMode]);
  const runRef = useRef(running); useEffect(() => { runRef.current = running; }, [running]);
  const spRef = useRef(SPEEDS[speedIdx]); useEffect(() => { spRef.current = SPEEDS[speedIdx]; }, [speedIdx]);
  const brushRef = useRef(brush); useEffect(() => { brushRef.current = brush; }, [brush]);
  const simRef = useRef(simMode); useEffect(() => { simRef.current = simMode; }, [simMode]);
  const frameRef = useRef(frameShape); useEffect(() => { frameRef.current = frameShape; }, [frameShape]);
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
    neighRef.current = buildNeighbors(R, C, frameShape);
    // Randzellen-Zahl GENAU HIER berechnen, wo das Feld neu entsteht (frischer Wert,
    // keine Render-Reihenfolge-Falle). Speist die transparente Randanzeige.
    { const nb = neighRef.current; let bc = 0; const bd = nb.bnd; for (let i = 0; i < bd.length; i++) if (bd[i]) bc++; setBoundaryStat({ count: bc, total: nb.inCount || 0 }); }
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

  // AP-1: aktuellen Engine-Config-Snapshot fuer den Worker bauen (Spiegel von
  // cfg.current). Reine Daten (struktur-klonbar), kein Funktions-/Ref-Inhalt.
  const buildWorkerCfg = useCallback(() => ({
    ruleIdx, torusOn,
    ax: { ...ax, colorMode },
    a5, watzOnly, ruleSrc, solverId,
    sysT: sysTheory, sysSp: sysSetpoint, bcMode: boundaryMode, openSys,
  }), [ruleIdx, torusOn, ax, colorMode, a5, watzOnly, ruleSrc, solverId, sysTheory, sysSetpoint, boundaryMode, openSys]);

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
      const wrap = wrapRef.current;
      const cw = wrap ? wrap.clientWidth : canvas.clientWidth;
      const ch = Math.min(Math.round(window.innerHeight * 0.5), 540);
      canvas.style.width = cw + "px"; canvas.style.height = ch + "px";
      canvas.width = Math.round(cw * dpr); canvas.height = Math.round(ch * dpr);
      const off = canvas.transferControlToOffscreen();
      worker = new Worker(new URL("./worker/render-worker.js", import.meta.url), { type: "module" });
      workerRef.current = worker;
      worker.onmessage = (e) => {
        const m = e.data;
        if (m.type === "ready") { workerActiveRef.current = true; }
        else if (m.type === "telemetry") {
          setGen(m.tick);
          spsRef.current = m.sps;
          if (m.solverWarn) setSolverWarn(true);
          if (m.diverged) { setSolverDiverged(true); setRunning(false); }
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
        R, C, hr: HR, shape: frameShape, dpr,
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
        const conv = stepHQST(fieldRef.current, fieldImRef.current, NL, 0.15, 0.0, 0.5, fBufRef.current, fBufImRef.current, hqstWorkRef.current, cfg.current.solverId);
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
          // Schranke 1e4: normerhaltende Wellen bleiben O(1); ein Anwachsen auf
          // >1e4 ist eindeutig Verfahrensdivergenz (CN/RK4 bleiben weit darunter).
          if (bad || maxA > 1e4) {
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
    const ctx = canvas.getContext("2d", { alpha: false }); // konsistent mit draw() (opak)
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
    const ctx = canvas.getContext("2d", { alpha: false });
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
    const radPx = Math.min(halfW, halfH) * hr; // Welt-Radius * hr = Pixel
    if (sh === "circle") {
      ctx.beginPath(); ctx.arc(ctr.x, ctr.y, radPx, 0, PI2); ctx.stroke();
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

  // --- Loop -----------------------------------------------------------------
  useEffect(() => {
    let raf, last = performance.now(), acc = 0;
    const loop = (now) => {
      const dt = now - last; last = now;
      // Worker aktiv: Sim + Render laufen off-main-thread -> Main-Loop macht hier
      // nichts (kein Doppel-Step, kein Doppel-Render auf der transferierten Canvas).
      if (workerActiveRef.current) { raf = requestAnimationFrame(loop); return; }
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
  }, [step, draw]);

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
      const cw = wrap.clientWidth, ch = Math.min(Math.round(window.innerHeight * 0.5), 540);
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
    solverWarnRef.current = false; setSolverWarn(false);
    solverDivergedRef.current = false; setSolverDiverged(false);
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

  return (
    <div style={{ fontFamily: DISP, background: `radial-gradient(120% 80% at 50% 0%, ${T.bg2} 0%, ${T.bg} 70%)`, minHeight: "100%", color: T.text, padding: "12px 12px 26px", boxSizing: "border-box", overscrollBehavior: "contain", touchAction: "pan-y" }}>
      {/* Globale UI-Standards (WCAG 2.2): jeder Button mindestens 44px Touch-Target,
          sichtbarer Fokusring fuer Tastaturbedienung, leichtes Hover/Active-Feedback.
          Schieberegler beanspruchen ihre Bedienachse: touch-action verhindert, dass
          das Ziehen am Regler stattdessen die Seite scrollt (MDN: touch-action ist
          die Schnittmenge von Element + Vorfahren). overscroll-behavior unterbindet
          das Fortpflanzen einer Geste auf Pull-to-Refresh/Zurueck-Wischen. */}
      <style>{`
        button { min-height: 44px; }
        button:focus-visible { outline: 2px solid ${T.accent}; outline-offset: 2px; }
        button:active { transform: translateY(1px); }
        input[type="range"] { min-height: 32px; touch-action: none; }
        input:focus-visible, select:focus-visible { outline: 2px solid ${T.accent}; outline-offset: 2px; }
        @media (prefers-reduced-motion: reduce) { * { transition: none !important; } }
      `}</style>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 8 }}>
        <div style={{ fontSize: 20, fontWeight: 700, letterSpacing: "0.04em" }}>
          <span style={{ color: T.accent, textShadow: `0 0 18px ${T.accent}66` }}>Gol</span><span style={{ color: T.text }}>Hex</span>
          <span style={{ color: T.sub, fontSize: 12, marginLeft: 8, fontFamily: MONO }}>v31</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 11, color: T.sub, fontFamily: MONO }}>Coworker Research</span>
          <button onClick={closeApp} aria-label="App schliessen" title="Schliessen"
            style={{ width: 44, height: 44, borderRadius: 8, cursor: "pointer", lineHeight: 1,
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

      <div ref={wrapRef} style={{ position: "relative", width: "100%", borderRadius: 14, overflow: "hidden", border: `1px solid ${T.border}`, background: T.bg, boxShadow: `0 0 30px rgba(92,240,204,0.06) inset` }}>
        <canvas key={canvasKey} ref={canvasRef} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}
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
        {/* Randbedingung transparent machen: bei berandeten Formen (oder Rechteck
            ohne Torus) wirkt an den Randzellen die feste Wand (Null-Randbedingung,
            fehlende Nachbarn zaehlen als tot - kanonisch korrekt). Beim Torus gibt
            es keinen Rand (periodisch). */}
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
        {/* Wahl der Randbedingung - nur sinnvoll im booleschen Modus an einer
            echten Wand (nicht im Torus, wo es keinen Rand gibt). Standard "null"
            erhaelt das bisherige Verhalten exakt; "adiabatic" reflektiert. */}
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
        {btn(doClear, "Leeren", { flex: "1 1 70px", color: "#FFB3C0", borderColor: "rgba(255,51,85,0.28)" })}
        {btn(doUndo, "Undo", { flex: "1 1 60px" })}
      </div>

      {/* AP-1: OffscreenCanvas-Worker (Stufe 1) - nur sichtbar, wenn der Browser
          OffscreenCanvas + transferControlToOffscreen + Worker unterstuetzt.
          Opt-in (Default AUS); abgeschaltet laeuft der bewaehrte Main-Thread-Pfad. */}
      {workerSupported && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10, fontFamily: MONO, fontSize: 11, color: T.sub }}>
          <button
            onClick={() => { setRunning(false); setWorkerMode((v) => !v); setCanvasKey((k) => k + 1); }}
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
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 4 }}>
              {[["box", "Rechteck"], ["circle", "Kreis"], ["hexagon", "Hexagon"], ["triangle", "Dreieck"]].map(([k, lab]) => (
                <button key={k} onClick={() => setFrameShape(k)} style={{
                  flex: "1 1 40%", padding: "8px 6px", borderRadius: 9, fontSize: 11.5, fontWeight: 700, cursor: "pointer", fontFamily: MONO,
                  border: frameShape === k ? `1px solid ${T.accent}` : "1px solid rgba(92,240,204,0.14)",
                  background: frameShape === k ? "rgba(92,240,204,0.12)" : T.bg2, color: frameShape === k ? T.accent : T.sub,
                }}>{lab}</button>
              ))}
            </div>
            <div style={{ fontSize: 10, color: T.sub, opacity: 0.7, fontFamily: MONO, lineHeight: 1.4 }}>
              {frameShape === "circle"
                ? (torusOn ? "Kreis + Torus: antipodale Identifikation (reelle projektive Ebene, RP2). Reflexionsfrei, aber nicht-orientierbar - Muster kehren am Rand spiegelverkehrt zurueck (Moebius-Eigenschaft)." : "Kreis + Rand: harte runde Wand, Null-Fluss (Neumann), massenerhaltend.")
                : frameShape === "hexagon"
                ? "Hexagon: exaktes regelmaessiges Sechseck via Hex-Distanz (Wuerfelkoordinaten), die natuerliche Form des Hexgitters. Berandet (Neumann-Wand), kein Torus - die Form kachelt das Gitter nicht periodisch sauber."
                : frameShape === "triangle"
                ? "Dreieck: gleichseitig (Spitze oben) via Schnittmenge dreier Halbebenen. Berandet (Neumann-Wand), kein Torus. Eckzellen haben wenige Nachbarn - sichtbar staerkere Randdynamik."
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
