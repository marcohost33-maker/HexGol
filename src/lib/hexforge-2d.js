// =============================================================================
// GolHex — HexForge-2D-Adapter (Issue #128, Erst-Scope)
//
// PURE Logik (AGENTS.md §2): explizite 2D-Silhouette -> reguläres HexGol-Preset
// (Zellmaske im BESTEHENDEN savestate-Format). Keine React-Imports, kein RNG,
// kein Date -> Vitest-testbar und bit-exakt reproduzierbar.
//
// ABGRENZUNG (Nicht-Ziel aus Issue #128): Es werden KEINE 3D-Wireframe-Segmente
// oder glTF-Line-Indizes als Zellen interpretiert. Eingabe ist ausschliesslich
// eine EXPLIZITE planare Silhouette (parametrische Radialfunktion r(theta) in
// normierten Einheiten), die auf die Hex-Zellzentren des Zielgitters gerastert
// wird. Die sechs Startformen (IMG_1177.JPG-Symbole) sind hier als EHRLICH
// parametrische Definitionen hinterlegt — Parameter stehen explizit im Preset
// (kein "sieht ungefähr so aus"-Import ohne Herkunft).
//
// Verbindliche Gates (Issue #128), alle hier implementiert + unit-getestet:
//   - Projektion, Massstab, Zentrum, Rotation, Hex-Ausrichtung explizit im Spec
//   - stabile Zellkoordinaten im bestehenden odd-r/pointy-top-Koordinatensystem
//     (identische Welt-Formeln wie buildNeighbors in sim-engine.js)
//   - Domainmaske aus Zellzentren vs. Silhouette (Punkt-in-Form-Test)
//   - deterministischer Zellmengen-/Preset-Hash (FNV-1a 32 bit)
//   - keine Löcher / getrennten Komponenten ohne explizite Shape-Spezifikation
//     (allowHoles / expectedComponents pro Shape, Default 1 Komponente, 0 Löcher)
//   - Round-trip über das vorhandene .golhex.json-Format (savestate-Hülle)
//   - Zellbudget-Guard mit klarer, typisierter Fehlermeldung (err.code)
// =============================================================================

import { serializeSave, deserializeSave } from "./savestate.js";

export const HEXFORGE_VERSION = 1;          // Spec-Schema-Version (fail-closed beim Import)
export const HEXFORGE_STATE = 1;            // Zell-Zustand der Maske (GolHex-Farbe C1)
export const HEXFORGE_DEFAULT_SCALE = 0.9;  // Anteil der kleineren Welt-Halbachse
export const HEXFORGE_DEFAULT_BUDGET = 90000; // Zell-Deckel (≙ HQST_CELL_CAP; bewusst konservativ)
export const HEXFORGE_ORIENT = "pointy-oddr"; // einzige unterstützte Hex-Ausrichtung (explizit)

const S3 = Math.sqrt(3);
const PI2 = Math.PI * 2;

// --- Form-Registry -----------------------------------------------------------
// Jede Form ist eine sternförmige (radial eindeutige) Silhouette: innen genau
// dann, wenn dist(Zelle, Zentrum) <= r(theta). Sternförmig => keine Selbst-
// überschneidung möglich; degenerierte Parametrisierungen (r <= 0 irgendwo)
// werden fail-closed abgewiesen (E_DEGENERATE), NaN ebenso (E_PARAM).
//
// params: core = Radius des immer-inneren Kerns (Konnektivitäts-Anker),
//         amp  = 1-core (implizit), exp = Schärfe der Zacken/Lappen,
//         k    = Zackenzahl-Faktor der Winkel-Modulation.
// Alle Defaults sind empirisch über die Gitter S..XL auf 1 Komponente / 0 Löcher
// verifiziert (tests/unit/hexforge-2d.test.js, Gate-Sweep).
const SHAPE_DEFS = [
  {
    id: "rounded-cross", name: "Rund-Kreuz",
    params: { core: 0.36, exp: 1, k: 4 },
    // r = core + (1-core) * (cos(k*t)+1)/2  -> 4 runde Lappen auf den Achsen.
    radial: (t, p) => p.core + (1 - p.core) * Math.pow((Math.cos(p.k * t) + 1) / 2, p.exp),
    allowHoles: false, expectedComponents: 1,
    origin: "Planare Kreuz-Silhouette (IMG_1177 rounded-cross) als parametrische 4-Lappen-Radialform.",
  },
  {
    id: "four-lobe-clover", name: "Kleeblatt-4",
    params: { core: 0.30, exp: 0.7, k: 2 },
    // |cos(2t)|^0.7 -> 4 breite Blätter; core haelt die Blätter am Kern zusammen.
    radial: (t, p) => p.core + (1 - p.core) * Math.pow(Math.abs(Math.cos(p.k * t)), p.exp),
    allowHoles: false, expectedComponents: 1,
    origin: "Vierblättrige Klee-Silhouette (IMG_1177 four-lobe-clover), breite Lappen mit Kern.",
  },
  {
    id: "spiky-rosette", name: "Rosette-8",
    params: { core: 0.42, exp: 2.5, k: 4 },
    // |cos(4t)|^2.5 -> 8 spitze Blütenblätter (Maxima alle 45 Grad).
    radial: (t, p) => p.core + (1 - p.core) * Math.pow(Math.abs(Math.cos(p.k * t)), p.exp),
    allowHoles: false, expectedComponents: 1,
    origin: "Achtzackige Rosetten-Silhouette (IMG_1177 spiky-rosette), spitze Blätter.",
  },
  {
    id: "thin-eight-star", name: "Stern-8 dünn",
    params: { core: 0.30, exp: 6, k: 4 },
    // Hoher Exponent -> dünne Strahlen; core garantiert den verbundenen Kern.
    radial: (t, p) => p.core + (1 - p.core) * Math.pow(Math.abs(Math.cos(p.k * t)), p.exp),
    allowHoles: false, expectedComponents: 1,
    origin: "Dünner 8-Strahlen-Stern (IMG_1177 thin-eight-star), schmale Spitzen.",
  },
  {
    id: "jagged-starburst", name: "Zack-Burst-12",
    params: { core: 0.45, exp: 1, k: 12 },
    // Dreieckswelle (linear gezackt, KEIN cos) -> 12 harte Zacken.
    radial: (t, p) => {
      const u = (t / PI2) * p.k;             // Zahn-Index-Phase
      const tri = 1 - 2 * Math.abs(u - Math.floor(u) - 0.5); // 1 an Zahnmitte, 0 an Kerbe
      return p.core + (1 - p.core) * Math.pow(tri, p.exp);
    },
    allowHoles: false, expectedComponents: 1,
    origin: "Gezackter 12-Zahn-Starburst (IMG_1177 jagged-starburst), lineare Dreieckswelle.",
  },
  {
    id: "radial-burst", name: "Strahlen-16",
    params: { core: 0.55, exp: 1.2, k: 8 },
    // |cos(8t)|^1.2 -> 16 kurze breite Strahlen um einen grossen Kern.
    radial: (t, p) => p.core + (1 - p.core) * Math.pow(Math.abs(Math.cos(p.k * t)), p.exp),
    allowHoles: false, expectedComponents: 1,
    origin: "Sechzehn-Strahlen-Burst (IMG_1177 radial-burst), kurzer Strahlenkranz.",
  },
];
const SHAPE_BY_ID = new Map(SHAPE_DEFS.map((d) => [d.id, d]));

export const HEXFORGE_SHAPE_IDS = SHAPE_DEFS.map((d) => d.id);

/** Galerie-taugliche Definitionsliste (ohne Funktionen mutierbar zu machen). */
export function hexforgeShapes() {
  return SHAPE_DEFS.map((d) => ({
    id: d.id, name: d.name, origin: d.origin,
    params: { ...d.params },
    allowHoles: d.allowHoles, expectedComponents: d.expectedComponents,
  }));
}

// --- Typisierte Fehler (fail-closed, klare Meldung + err.code) ---------------
function fail(code, msg) {
  const err = new Error(`hexforge-2d: ${msg}`);
  err.code = code;
  return err;
}

// --- Spec-Normalisierung + Validierung ---------------------------------------
// Ein Spec macht ALLE Projektions-Parameter explizit (Gate 1). Fehlende Felder
// erhalten dokumentierte Defaults; alles Unbekannte/NaN/Unendliche wird
// abgewiesen (fail-closed), nicht still repariert.
const PARAM_BOUNDS = { core: [0, 0.95], exp: [0.05, 32], k: [1, 64] };

/**
 * Normalisiert + validiert einen HexForge-Spec. Wirft typisiert (E_*).
 * @param {{shape:string, scale?:number, rotationDeg?:number,
 *          centerRow?:number|null, centerCol?:number|null,
 *          budget?:number, params?:object, version?:number}} spec
 * @returns {object} eingefrorener, kanonischer Spec
 */
export function normalizeHexForgeSpec(spec) {
  if (!spec || typeof spec !== "object") throw fail("E_PARAM", "Spec fehlt oder ist kein Objekt");
  const version = spec.version == null ? HEXFORGE_VERSION : spec.version;
  if (typeof version !== "number" || !Number.isInteger(version) || version < 1) {
    throw fail("E_VERSION", `ungültige Spec-Version "${spec.version}"`);
  }
  if (version > HEXFORGE_VERSION) {
    throw fail("E_VERSION", `Spec-Version ${version} ist neuer als unterstützt (${HEXFORGE_VERSION}). Bitte GolHex aktualisieren.`);
  }
  const def = SHAPE_BY_ID.get(spec.shape);
  if (!def) throw fail("E_SHAPE", `unbekannte Form "${spec.shape}" (bekannt: ${HEXFORGE_SHAPE_IDS.join(", ")})`);

  const num = (v, name, dflt, min, max) => {
    if (v == null) return dflt;
    if (typeof v !== "number" || !Number.isFinite(v)) throw fail("E_PARAM", `${name} ist nicht endlich (${v})`);
    if (v < min || v > max) throw fail("E_PARAM", `${name}=${v} ausserhalb [${min}, ${max}]`);
    return v;
  };
  const scale = num(spec.scale, "scale", HEXFORGE_DEFAULT_SCALE, 0.01, 1.5);
  const rotationDeg = num(spec.rotationDeg, "rotationDeg", 0, -360, 360);
  const centerRow = spec.centerRow == null ? null : num(spec.centerRow, "centerRow", null, -1e6, 1e6);
  const centerCol = spec.centerCol == null ? null : num(spec.centerCol, "centerCol", null, -1e6, 1e6);
  const budget = num(spec.budget, "budget", HEXFORGE_DEFAULT_BUDGET, 1, 900000);
  // Raster-Versiegelung (Default AN): sternförmige Silhouetten sind einfach
  // zusammenhängend — eingeschlossene Tot-Regionen im Raster sind reine
  // Aliasing-Artefakte an konkaven Kerben und werden deterministisch gefüllt.
  // sealHoles=false schaltet die Versiegelung ab -> strenges E_HOLES-Gate.
  let sealHoles = true;
  if (spec.sealHoles != null) {
    if (typeof spec.sealHoles !== "boolean") throw fail("E_PARAM", `sealHoles muss boolean sein (${spec.sealHoles})`);
    sealHoles = spec.sealHoles;
  }

  // Form-Parameter: Defaults der Registry, Overrides nur für BEKANNTE Schlüssel
  // in dokumentierten Grenzen (fail-closed gegen Tipp-/Injektionsfehler).
  const params = { ...def.params };
  if (spec.params != null) {
    if (typeof spec.params !== "object") throw fail("E_PARAM", "params ist kein Objekt");
    for (const [key, v] of Object.entries(spec.params)) {
      if (!(key in PARAM_BOUNDS)) throw fail("E_PARAM", `unbekannter Form-Parameter "${key}"`);
      const [mn, mx] = PARAM_BOUNDS[key];
      if (typeof v !== "number" || !Number.isFinite(v)) throw fail("E_PARAM", `params.${key} ist nicht endlich (${v})`);
      if (v < mn || v > mx) throw fail("E_PARAM", `params.${key}=${v} ausserhalb [${mn}, ${mx}]`);
      params[key] = v;
    }
  }

  return Object.freeze({
    version, shape: def.id, orient: HEXFORGE_ORIENT,
    scale, rotationDeg, centerRow, centerCol, budget, sealHoles,
    params: Object.freeze(params),
  });
}

// --- Welt-Geometrie (IDENTISCH zu sim-engine.buildNeighbors) ------------------
// pointy-top odd-r: wx = (col + 0.5*(row ungerade)) * sqrt(3), wy = row * 1.5.
// Diese Formeln sind bewusst dupliziert-minimal (2 Zeilen) statt sim-engine zu
// importieren: sim-engine zieht die volle Regel-Maschinerie nach sich; der
// Adapter bleibt ein Blattmodul. Paritäts-Test deckt Drift ab.
const wx = (r, c) => (c + ((r & 1) ? 0.5 : 0)) * S3;
const wy = (r) => r * 1.5;

// Winkel-Konvention des Repos (hex-geom.angleOf): oben = 0, im Uhrzeigersinn.
function angleTopCW(dx, dy) {
  let ang = -(Math.atan2(dy, dx) + Math.PI / 2);
  ang %= PI2; if (ang < 0) ang += PI2;
  return ang;
}

// --- Masken-Analyse: Komponenten + Löcher (odd-r 6-Nachbarschaft) ------------
const ODD_OFF = [[-1, 0], [-1, 1], [0, -1], [0, 1], [1, 0], [1, 1]];
const EVEN_OFF = [[-1, -1], [-1, 0], [0, -1], [0, 1], [1, -1], [1, 0]];

/**
 * Zählt Zusammenhangskomponenten der lebenden Zellen und eingeschlossene
 * Loch-Regionen (tote Regionen ohne Kontakt zum Gitterrand). Reine Analyse,
 * auch für Tests mit synthetischen Masken exportiert.
 * @param {Uint8Array} cells Länge R*C (0 = tot, sonst lebendig)
 * @returns {{cellCount:number, components:number, holes:number}}
 */
export function analyzeHexMask(cells, R, C) {
  if (!cells || cells.length !== R * C) throw fail("E_PARAM", "analyzeHexMask: cells passt nicht zu R*C");
  const seen = new Uint8Array(R * C);
  const stack = [];
  const flood = (start, wantLive) => {
    stack.length = 0; stack.push(start); seen[start] = 1;
    while (stack.length) {
      const i = stack.pop();
      const r = (i / C) | 0, c = i % C;
      const offs = (r & 1) ? ODD_OFF : EVEN_OFF;
      for (const [dr, dc] of offs) {
        const nr = r + dr, nc = c + dc;
        if (nr < 0 || nr >= R || nc < 0 || nc >= C) continue;
        const ni = nr * C + nc;
        if (seen[ni]) continue;
        if (!!cells[ni] !== wantLive) continue;
        seen[ni] = 1; stack.push(ni);
      }
    }
  };
  let cellCount = 0;
  for (let i = 0; i < cells.length; i++) if (cells[i]) cellCount++;
  // 1) Tote Rand-Region(en) fluten -> was danach tot + ungesehen ist, ist Loch.
  for (let r = 0; r < R; r++) {
    for (let c = 0; c < C; c++) {
      if (r !== 0 && r !== R - 1 && c !== 0 && c !== C - 1) continue;
      const i = r * C + c;
      if (!cells[i] && !seen[i]) flood(i, false);
    }
  }
  let holes = 0;
  for (let i = 0; i < cells.length; i++) {
    if (!cells[i] && !seen[i]) { holes++; flood(i, false); }
  }
  // 2) Lebende Komponenten zählen.
  let components = 0;
  for (let i = 0; i < cells.length; i++) {
    if (cells[i] && !seen[i]) { components++; flood(i, true); }
  }
  return { cellCount, components, holes };
}

// Füllt alle toten Regionen OHNE Randkontakt (eingeschlossen) mit HEXFORGE_STATE.
// Deterministisch (reine Flutung, keine Reihenfolge-Abhängigkeit im Ergebnis).
// Gibt die Anzahl gefüllter Zellen zurück.
function sealEnclosedDead(cells, R, C) {
  const border = new Uint8Array(R * C);
  const stack = [];
  for (let r = 0; r < R; r++) {
    for (let c = 0; c < C; c++) {
      if (r !== 0 && r !== R - 1 && c !== 0 && c !== C - 1) continue;
      const i = r * C + c;
      if (!cells[i] && !border[i]) { border[i] = 1; stack.push(i); }
    }
  }
  while (stack.length) {
    const i = stack.pop();
    const r = (i / C) | 0, c = i % C;
    const offs = (r & 1) ? ODD_OFF : EVEN_OFF;
    for (const [dr, dc] of offs) {
      const nr = r + dr, nc = c + dc;
      if (nr < 0 || nr >= R || nc < 0 || nc >= C) continue;
      const ni = nr * C + nc;
      if (cells[ni] || border[ni]) continue;
      border[ni] = 1; stack.push(ni);
    }
  }
  let sealed = 0;
  for (let i = 0; i < cells.length; i++) {
    if (!cells[i] && !border[i]) { cells[i] = HEXFORGE_STATE; sealed++; }
  }
  return sealed;
}

// --- Deterministischer Hash (FNV-1a 32 bit) ----------------------------------
function fnv1a(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

// Kanonische Spec-Signatur: Zahlen auf 1e-6 gerundet (stabil gegen JSON-Noise,
// NICHT gegen andere Math-Implementierungen — Hash-Garantie gilt pro Engine,
// die Golden-Tests laufen in der CI-Node-Engine).
function specSignature(spec, R, C) {
  const f = (x) => Math.round(x * 1e6) / 1e6;
  const p = Object.keys(spec.params).sort().map((k) => `${k}=${f(spec.params[k])}`).join(",");
  return `hexforge:v${spec.version}|${spec.shape}|${spec.orient}|s=${f(spec.scale)}|rot=${f(spec.rotationDeg)}`
    + `|cr=${spec.centerRow == null ? "auto" : f(spec.centerRow)}|cc=${spec.centerCol == null ? "auto" : f(spec.centerCol)}`
    + `|seal=${spec.sealHoles ? 1 : 0}|grid=${R}x${C}|${p}`;
}

/**
 * Deterministischer Preset-Hash über Spec-Signatur + sortierte Zellliste.
 * @param {object} spec normalisierter Spec
 * @param {Uint8Array} cells Maske (R*C)
 * @returns {string} 8-stelliger Hex-Hash
 */
export function hexforgeHash(spec, cells, R, C) {
  let acc = fnv1a(specSignature(spec, R, C));
  // Zellindizes in fester Reihenfolge (row-major, aufsteigend) einmischen.
  for (let i = 0; i < cells.length; i++) {
    if (cells[i]) {
      acc = (Math.imul(acc ^ i, 0x01000193) >>> 0);
    }
  }
  return acc.toString(16).padStart(8, "0");
}

// --- Rasterung: Silhouette -> Zellmaske --------------------------------------
/**
 * Rastert eine HexForge-Silhouette auf das Zielgitter und erzwingt alle Gates.
 * @param {object} rawSpec HexForge-Spec (siehe normalizeHexForgeSpec)
 * @param {{rows:number, cols:number}} grid Zielgitter
 * @returns {{cells:Uint8Array, spec:object, hash:string,
 *            stats:{cellCount:number, components:number, holes:number}}}
 */
export function rasterizeHexForge(rawSpec, grid) {
  const spec = normalizeHexForgeSpec(rawSpec);
  const R = grid && grid.rows | 0, C = grid && grid.cols | 0;
  if (!(R > 0) || !(C > 0)) throw fail("E_PARAM", "ungültiges Gitter (rows/cols)");
  if (R * C > 900000) throw fail("E_BUDGET", `Gitter ${R}x${C} übersteigt die Allokationsgrenze (900000 Zellen)`);
  const def = SHAPE_BY_ID.get(spec.shape);

  // Degenerations-Gate: Radialfunktion muss überall strikt > 0 und endlich sein
  // (deckt "leere/degenerierte Silhouette" + parametrische Selbst-Degeneration ab).
  const PROBE = 720;
  for (let i = 0; i < PROBE; i++) {
    const rB = def.radial((i / PROBE) * PI2, spec.params);
    if (!Number.isFinite(rB) || rB <= 0) {
      throw fail("E_DEGENERATE", `Silhouette degeneriert: r(theta)=${rB} bei theta=${((i / PROBE) * 360).toFixed(1)}°`);
    }
  }

  // Projektion (explizit, Gate 1): Zentrum in Gitterschritten (Default Mitte),
  // Welt-Radius = scale * kleinere Halbachse der Zellzentren-Bounding-Box
  // (identische halfW/halfH-Formeln wie buildNeighbors).
  const cr = spec.centerRow == null ? (R - 1) / 2 : spec.centerRow;
  const cc = spec.centerCol == null ? (C - 1) / 2 : spec.centerCol;
  const cx = wx(cr, cc), cy = wy(cr);
  const halfW = ((C - 1) * S3) / 2 + S3 / 2;
  const halfH = ((R - 1) * 1.5) / 2 + 1.0;
  const worldR = spec.scale * Math.min(halfW, halfH);
  const rotRad = (spec.rotationDeg * Math.PI) / 180;

  const cells = new Uint8Array(R * C);
  let count = 0;
  for (let r = 0; r < R; r++) {
    for (let c = 0; c < C; c++) {
      const dx = wx(r, c) - cx, dy = wy(r) - cy;
      const rho = Math.hypot(dx, dy) / worldR;
      // Hüllkreis-Skip: radial() ist per Konstruktion <= 1 (core <= 0.95,
      // Modulation in [0,1]) -> ausserhalb rho > 1 ist nie innen.
      if (rho > 1) continue;
      const theta = rho === 0 ? 0 : angleTopCW(dx, dy);
      // Rotation der Silhouette um rotationDeg im Uhrzeigersinn.
      let t = theta - rotRad;
      t %= PI2; if (t < 0) t += PI2;
      if (rho <= def.radial(t, spec.params)) {
        cells[r * C + c] = HEXFORGE_STATE;
        count++;
        if (count > spec.budget) {
          throw fail("E_BUDGET", `Zellbudget überschritten (> ${spec.budget} Zellen). scale verkleinern oder budget erhöhen.`);
        }
      }
    }
  }
  if (count === 0) {
    throw fail("E_EMPTY", `leere Silhouette: kein Zellzentrum innerhalb der Form (scale=${spec.scale}, Gitter ${R}x${C})`);
  }

  // Raster-Versiegelung: eingeschlossene Tot-Regionen füllen (nur Aliasing-
  // Artefakte — die sternförmige Silhouette selbst ist einfach zusammenhängend).
  // Anzahl wird ehrlich in stats.sealed ausgewiesen und geht in den Hash ein
  // (Versiegelung ist Teil der deterministischen Projektion).
  let sealed = 0;
  if (spec.sealHoles) {
    sealed = sealEnclosedDead(cells, R, C);
    count += sealed;
    if (count > spec.budget) {
      throw fail("E_BUDGET", `Zellbudget überschritten (> ${spec.budget} Zellen inkl. Versiegelung).`);
    }
  }

  const stats = analyzeHexMask(cells, R, C);
  stats.sealed = sealed;
  if (!def.allowHoles && stats.holes > 0) {
    throw fail("E_HOLES", `${stats.holes} eingeschlossene Loch-Region(en), Form "${spec.shape}" erlaubt keine Löcher`);
  }
  if (stats.components !== def.expectedComponents) {
    throw fail("E_COMPONENTS", `${stats.components} Komponenten statt ${def.expectedComponents} (Form "${spec.shape}"). Parameter/scale prüfen.`);
  }

  return { cells, spec, hash: hexforgeHash(spec, cells, R, C), stats };
}

// --- Preset-Bau (savestate-kompatibel, Roundtrip-garantiert) ------------------
/**
 * Baut den konkreten Feld-Zustand (cells + meta) für den App-Ladepfad
 * (applyLoadedState) — analog presets.buildBuiltin.
 * @param {string} shapeId eine der HEXFORGE_SHAPE_IDS
 * @param {{rows:number, cols:number, sizeIdx?:number}} grid
 * @param {object} [overrides] optionale Spec-Felder (scale/rotationDeg/...)
 */
export function buildHexForgeState(shapeId, grid, overrides) {
  const { cells, spec, hash, stats } = rasterizeHexForge({ ...(overrides || {}), shape: shapeId }, grid);
  const def = SHAPE_BY_ID.get(spec.shape);
  const meta = {
    name: `HexForge ${def.name}`, width: grid.cols | 0, height: grid.rows | 0, bitDepth: 8,
    sizeIdx: grid.sizeIdx, frameShape: "box",
    ruleIdx: 0, ruleSrc: "std", watzOnly: false,
    torusOn: false, colorMode: "quad", simMode: "life", seed: 1,
    gen: 0, preset: `hexforge:${spec.shape}`, builtin: true,
    hexforge: { ...spec, params: { ...spec.params }, hash, cellCount: stats.cellCount },
  };
  return { cells, meta, hash, stats };
}

/**
 * Serialisiert eine HexForge-Form als .golhex.json-Preset (savestate-Hülle).
 * Roundtrip: deserializeHexForgePreset(serializeHexForgePreset(...)) ist
 * bit-exakt (Unit-Test).
 */
export function serializeHexForgePreset(shapeId, grid, overrides) {
  const { cells, meta } = buildHexForgeState(shapeId, grid, overrides);
  const obj = serializeSave({ cells, meta });
  // preset/builtin liegen (wie in presets.js) ausserhalb des serializeSave-
  // Whitelists und werden nach der Hülle gesetzt.
  obj.meta.preset = meta.preset;
  obj.meta.builtin = true;
  return obj;
}

/**
 * Lädt ein HexForge-Preset fail-closed: savestate-Gate (Format/Version/
 * cellCount) + HexForge-Spec-Versions-Gate + Hash-Reverifikation.
 * @param {object} obj geparstes .golhex.json-Objekt
 * @returns {{cells:Uint8Array, meta:object}}
 */
export function deserializeHexForgePreset(obj) {
  const { cells, meta } = deserializeSave(obj); // wirft bei Format/Versions-/Korruptionsfehlern
  const hf = meta && meta.hexforge;
  if (!hf || typeof hf !== "object") throw fail("E_PARAM", "kein HexForge-Preset (meta.hexforge fehlt)");
  if (typeof hf.version !== "number" || hf.version > HEXFORGE_VERSION) {
    throw fail("E_VERSION", `HexForge-Version ${hf && hf.version} nicht unterstützt (max ${HEXFORGE_VERSION}). Bitte GolHex aktualisieren.`);
  }
  // Hash-Reverifikation: Zellliste muss zum eingebetteten Hash passen (Korruptions-
  // Gate über das savestate-Gate hinaus). Spec wird dafür renormalisiert.
  const spec = normalizeHexForgeSpec(hf);
  const R = meta.height | 0, C = meta.width | 0;
  const expect = hexforgeHash(spec, cells, R, C);
  if (hf.hash !== expect) {
    throw fail("E_HASH", `Preset-Hash ${hf.hash} != berechnet ${expect} (Zellen oder Spec verändert)`);
  }
  return { cells, meta };
}
