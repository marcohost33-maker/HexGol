// =============================================================================
// GolHex v33 — Muster-Galerie & Presets (Feature 3, v33-Welle 2026-06-09)
//
// PURE Logik (AGENTS.md §2): Preset-Definition -> konkreter Feld-Zustand im
// BESTEHENDEN Speicher-Format (savestate.js `golhex.savestate`), Validierung
// (fail-closed) und Thumbnail-Sampling. Keine React-Imports -> Vitest-testbar.
//
// DESIGN-ENTSCHEID / EHRLICHKEIT (Brief 2026-06-09):
//   Auf der 6-Nachbar-Hex-Topologie existieren die KLASSISCHEN Quadratgitter-
//   Objekte (Conway-Glider, Blinker) NICHT 1:1 — sie sind dort kein periodischer
//   Oszillator/Gleiter. Wir behaupten daher KEINE beruehmten benannten Muster.
//   Jeder Built-in ist ein EHRLICH benannter, reproduzierbarer Start-Seed
//   (konkrete Zell-Positionen + Regel/Groesse/Rahmen). Die Galerie laedt EXAKT
//   diesen Anfangszustand; was daraus entsteht, ist die Dynamik der gewaehlten
//   Hex-Regel (nicht ein vorab behaupteter Endzustand).
//
//   Built-in-Bausteine werden als kompakte 2D-Punktmuster (cube/offset-frei,
//   reine [row,col]-Offsets ab einem Anker) definiert und beim Laden in die
//   Gittermitte gerendert. So sind sie groessen-/rahmen-unabhaengig und bleiben
//   bit-exakt reproduzierbar (kein RNG im Built-in-Pfad).
// =============================================================================

import { serializeSave, deserializeSave } from "./savestate.js";

export const PRESET_FORMAT = "golhex.savestate"; // identisch zum Speicher-Format
export const PRESET_STORAGE_KEY = "golhex.presets.v1"; // localStorage-Schluessel (eigene Presets)
export const PRESET_STORAGE_MAX = 24; // weicher Deckel eigener Presets (Quota-Schutz)

// Farb-Zustand fuer Built-in-Zellen (GolHex 1..12; 1 = erste Itten-Farbe, "blau").
const C1 = 1, C2 = 2, C3 = 3;

// --- Built-in-Muster-Bausteine (reine [drow, dcol]-Offsets ab Ankermitte) ----
// Jeder Eintrag: gewaehlte Regel-Familie + Zell-Offsets. Bewusst KLEIN gehalten,
// damit das Muster in jeder Gittergroesse vollstaendig in die Mitte passt.
//
// `state`-Map (optional) faerbt einzelne Offsets; Default-Zustand ist C1.

/** Symmetrischer 3er-Cluster (zentral) — minimaler lebensfaehiger Hex-Keim. */
const PTS_TRIAD = [
  [0, 0], [0, 1], [1, 0], [1, 1], [0, -1], [-1, 0],
];

/** Diagonale Kette ("Gleit-Keim") — Startseed fuer wandernde Strukturen. */
const PTS_CHAIN = [
  [-2, -2], [-1, -1], [0, 0], [1, 1], [2, 2], [0, -1], [-1, 0],
];

/** Sechseck-Ring (Schnee-/Kristall-Start) — leerer Kern, belegter Ring.
 *  Verifiziert stabil unter H:B2/S35 ueber alle Gittergroessen (kristalliner
 *  Fixzustand, _gridcheck.mjs / Unit-Aliveness-Orakel). */
const PTS_RING = [
  [-2, -1], [-2, 0], [-2, 1], [0, -2], [0, 2], [2, -1], [2, 0], [2, 1],
  [-1, -2], [-1, 2], [1, -2], [1, 2],
];

/** Dichter Block 4x4 (Cluster-Start) — robuster, langlebiger Keim. */
const PTS_BLOCK = (() => {
  const a = [];
  for (let r = -2; r <= 1; r++) for (let c = -2; c <= 1; c++) a.push([r, c]);
  return a;
})();

/** Welle: zwei versetzte Reihen (HQST-/Wellen-Start). */
const PTS_WAVE = [
  [0, -3], [0, -1], [0, 1], [0, 3],
  [1, -2], [1, 0], [1, 2],
  [-1, -2], [-1, 0], [-1, 2],
];

/** Faecher: V-foermig aufgespreizte Doppellinie (Faecher-Start). Verifiziert
 *  lebendig unter H:B2/S23 ueber alle Gittergroessen (_gridcheck.mjs / Orakel). */
const PTS_FAN = [
  [-2, -2], [-1, -1], [0, 0], [1, -1], [2, -2], [-1, 1], [-2, 2], [1, 1], [2, 2],
];

// --- Built-in-Preset-Definitionen --------------------------------------------
// id: stabiler Schluessel · name: ehrliches Label · meta: Sim-Parameter
// (ruleIdx bezieht sich auf RULES in sim-engine.js: 0=H:B2/S34, 1=H:B2/S35 Bays,
//  3=H:B3/S34, 6=H:B12/S34). origin: Kurz-Herkunft (UI-Tooltip + Ehrlichkeit).
const BUILTIN_DEFS = [
  {
    id: "triad", name: "Zentral-Cluster",
    ruleIdx: 0, ruleSrc: "std", points: PTS_TRIAD,
    origin: "Einfacher zentraler 6-Zell-Keim · Regel H:B2/S34 (kanonisches Hex-Life). Kein benanntes Klassik-Objekt.",
  },
  {
    id: "chain", name: "Gleit-Keim",
    ruleIdx: 0, ruleSrc: "std", points: PTS_CHAIN,
    origin: "Diagonale Startkette unter H:B2/S34 — ehrlicher Start-Seed, KEIN Conway-Glider (existiert auf Hex nicht).",
  },
  {
    id: "ring", name: "Schnee-Start",
    ruleIdx: 1, ruleSrc: "std", points: PTS_RING,
    origin: "Sechseckiger Ring-Seed unter H:B2/S35 (Carter-Bays, Complex Systems 15:245) — kristalliner Anfangszustand.",
  },
  {
    id: "block", name: "Dicht-Cluster",
    ruleIdx: 6, ruleSrc: "std", points: PTS_BLOCK,
    origin: "Dichter 4x4-Block unter H:B12/S34 — langlebiger Cluster-Keim, ehrlich benannt.",
  },
  {
    id: "wave", name: "Wellen-Start",
    ruleIdx: 10, ruleSrc: "std", points: PTS_WAVE,
    origin: "Versetzte Doppelreihe unter H:B23/S34 — wachsende wellenartige Fronten (Start-Seed, kein behaupteter Endzustand).",
  },
  {
    id: "fan", name: "Faecher-Start",
    ruleIdx: 2, ruleSrc: "std", points: PTS_FAN,
    origin: "V-foermig aufgespreizte Doppellinie unter H:B2/S23 — symmetrischer, wachsender Faecher-Keim.",
  },
];

/**
 * Liefert die Built-in-Definitionsliste (id/name/origin + Regel) OHNE volle
 * Zell-Buffer — fuer die Galerie-Kacheln (Label + Thumbnail-Sampling).
 * @returns {Array<{id:string,name:string,ruleIdx:number,ruleSrc:string,origin:string,points:number[][]}>}
 */
export function builtinDefs() {
  // Defensive Kopie (Aufrufer darf die Offsets nicht mutieren).
  return BUILTIN_DEFS.map((d) => ({ ...d, points: d.points.map((p) => [p[0], p[1]]) }));
}

/**
 * Baut den konkreten Feld-Zustand eines Built-in-Presets fuer eine Zielgroesse.
 * Das Muster wird in die Gittermitte gesetzt; out-of-bounds-Offsets werden
 * geclippt (kleine Gitter bleiben gueltig, keine Index-Fehler).
 * @param {string} id Built-in-id
 * @param {{rows:number, cols:number, sizeIdx?:number}} grid Zielgitter
 * @returns {{cells: Uint8Array, meta: object}} Feld-Zustand (savestate-kompatibel)
 */
export function buildBuiltin(id, grid) {
  const def = BUILTIN_DEFS.find((d) => d.id === id);
  if (!def) throw new Error(`buildBuiltin: unbekanntes Preset "${id}"`);
  const rows = grid && grid.rows | 0, cols = grid && grid.cols | 0;
  if (!(rows > 0) || !(cols > 0)) throw new Error("buildBuiltin: ungueltiges Gitter (rows/cols)");
  const cells = new Uint8Array(rows * cols);
  const cr = (rows / 2) | 0, cc = (cols / 2) | 0;
  for (const [dr, dc] of def.points) {
    const r = cr + dr, c = cc + dc;
    if (r < 0 || r >= rows || c < 0 || c >= cols) continue; // clip (klein-Gitter)
    cells[r * cols + c] = C1;
  }
  const meta = {
    name: def.name, width: cols, height: rows, bitDepth: 8,
    sizeIdx: grid.sizeIdx, frameShape: "box",
    ruleIdx: def.ruleIdx, ruleSrc: def.ruleSrc, watzOnly: false,
    torusOn: false, colorMode: "quad", simMode: "life", seed: 1,
    gen: 0, preset: def.id, builtin: true,
  };
  return { cells, meta };
}

// --- Validierung (fail-closed) -----------------------------------------------
// Ein Preset ist gueltig, wenn es exakt eine deserialisierbare savestate-Huelle
// ist (Format/Version korrekt, cellCount == dekodierte Laenge). Kaputte/fremde/
// zukuenftige Objekte werfen via deserializeSave und werden hier als ungueltig
// gemeldet — NICHT still geladen.

/**
 * Prueft, ob `obj` ein gueltiges Preset (savestate-Huelle) ist.
 * @param {any} obj
 * @returns {boolean}
 */
export function isValidPreset(obj) {
  try {
    if (!obj || typeof obj !== "object") return false;
    const { cells, meta } = deserializeSave(obj);
    // Zusatz-Gate: nicht-leeres Gitter mit konsistenter Geometrie.
    const w = meta.width | 0, h = meta.height | 0;
    if (w > 0 && h > 0 && w * h !== cells.length) return false;
    if (cells.length <= 0) return false;
    return true;
  } catch {
    return false;
  }
}

/**
 * Serialisiert einen aktuellen Feld-Zustand zu einem persistierbaren Preset.
 * Reine Huelle um serializeSave + Pflicht-Name. Wirft bei fehlenden Zellen/Name.
 * @param {{name:string, cells:Uint8Array, meta:object}} input
 * @returns {object} savestate-kompatibles Preset-Objekt
 */
export function serializePreset({ name, cells, meta }) {
  const nm = (name || "").trim();
  if (!nm) throw new Error("serializePreset: Name fehlt");
  if (!cells || typeof cells.length !== "number") throw new Error("serializePreset: cells fehlen");
  const obj = serializeSave({ cells, meta: { ...(meta || {}), name: nm } });
  obj.meta.preset = obj.meta.preset || `user:${nm}`;
  obj.meta.builtin = false;
  return obj;
}

/**
 * Inverse zu serializePreset — Roundtrip-Garant. Wirft fail-closed bei Korruption.
 * @param {object} obj
 * @returns {{cells: Uint8Array|Uint16Array, meta: object}}
 */
export function deserializePreset(obj) {
  if (!isValidPreset(obj)) throw new Error("deserializePreset: ungueltiges/korruptes Preset");
  return deserializeSave(obj);
}

// --- localStorage-Persistenz (eigene Presets) --------------------------------
// Eigene Presets werden als JSON-Liste in localStorage gehalten (Schluessel
// PRESET_STORAGE_KEY). Bewusst localStorage (nicht IndexedDB), weil die Galerie-
// Presets klein sind (kleiner zentraler Seed, nicht das ganze Riesen-Gitter)
// und localStorage synchron+einfach ist. `storage` ist injizierbar (Default
// globalThis.localStorage) -> Unit-Test ohne globalen Patch.

function getStore(storeOverride) {
  const s = storeOverride || (typeof globalThis !== "undefined" ? globalThis.localStorage : undefined);
  if (!s) throw new Error("localStorage nicht verfuegbar");
  return s;
}

/**
 * Liest alle eigenen Presets. Korruptes JSON / korrupte Eintraege werden
 * ausgefiltert (fail-closed: lieber weniger als ein kaputtes laden), nicht geworfen.
 * @param {Storage} [storeOverride]
 * @returns {object[]} Liste gueltiger Preset-Objekte
 */
export function loadUserPresets(storeOverride) {
  let raw;
  try { raw = getStore(storeOverride).getItem(PRESET_STORAGE_KEY); }
  catch { return []; }
  if (!raw) return [];
  let arr;
  try { arr = JSON.parse(raw); } catch { return []; }
  if (!Array.isArray(arr)) return [];
  return arr.filter((o) => isValidPreset(o));
}

/**
 * Fuegt ein Preset hinzu (oder ersetzt eines gleichen Namens) und persistiert.
 * Gibt die neue Liste zurueck. Wirft bei ungueltigem Preset oder vollem Deckel.
 * @param {object} preset savestate-kompatibles Preset (aus serializePreset)
 * @param {Storage} [storeOverride]
 * @returns {object[]}
 */
export function saveUserPreset(preset, storeOverride) {
  if (!isValidPreset(preset)) throw new Error("saveUserPreset: ungueltiges Preset");
  const store = getStore(storeOverride);
  const list = loadUserPresets(store);
  const name = (preset.meta && preset.meta.name) || "";
  const idx = list.findIndex((p) => p.meta && p.meta.name === name);
  if (idx >= 0) list[idx] = preset;
  else {
    if (list.length >= PRESET_STORAGE_MAX) {
      const err = new Error(`Preset-Limit erreicht (${PRESET_STORAGE_MAX}). Loesche ein eigenes Preset.`);
      err.code = "LIMIT";
      throw err;
    }
    list.push(preset);
  }
  try { store.setItem(PRESET_STORAGE_KEY, JSON.stringify(list)); }
  catch (e) {
    if (e && (e.name === "QuotaExceededError" || /quota/i.test(String(e.message || e)))) {
      const err = new Error("Speicher voll (Quota). Loesche eigene Presets.");
      err.code = "QUOTA";
      throw err;
    }
    throw e;
  }
  return list;
}

/**
 * Loescht ein eigenes Preset per Name und persistiert. Gibt die neue Liste zurueck.
 * @param {string} name
 * @param {Storage} [storeOverride]
 * @returns {object[]}
 */
export function deleteUserPreset(name, storeOverride) {
  const store = getStore(storeOverride);
  const list = loadUserPresets(store).filter((p) => !(p.meta && p.meta.name === name));
  try { store.setItem(PRESET_STORAGE_KEY, JSON.stringify(list)); } catch { /* still: Lesepfad filtert */ }
  return list;
}

// --- Thumbnail-Sampling (rahmenfreie Mini-Vorschau) --------------------------
// Erzeugt aus einem Feld-Zustand eine kompakte Punktliste fuer die Galerie-
// Kachel: belegte Zellen werden in eine `out` x `out`-Box (Default 5x5 Raster
// -> wenige Dots wie im Mockup) gesampelt. Reine Geometrie, kein Canvas (die UI
// rendert die zurueckgegebenen normierten Punkte selbst -> SVG/divs).

export const THUMB_SAMPLE = 7; // Sampling-Aufloesung (NxN Buckets)

/**
 * Sampelt belegte Zellen eines Feld-Zustands auf ein NxN-Punktraster (normiert
 * auf 0..1). Dedupliziert pro Bucket (max N*N Punkte) -> wenige distinct Dots.
 * @param {{cells: Uint8Array|Uint16Array, meta:{width:number,height:number}}} state
 * @param {number} [n=THUMB_SAMPLE]
 * @returns {Array<{x:number, y:number, s:number}>} normierte Punkte (s = Zustand)
 */
export function sampleThumbnail(state, n = THUMB_SAMPLE) {
  const cells = state && state.cells;
  const w = state && state.meta && state.meta.width | 0;
  const h = state && state.meta && state.meta.height | 0;
  if (!cells || !(w > 0) || !(h > 0)) return [];
  const N = Math.max(1, n | 0);
  // Bounding-Box der belegten Zellen finden -> Muster fuellt die Kachel aus,
  // statt als winziger Mittelpunkt zu verschwinden.
  let minR = h, maxR = -1, minC = w, maxC = -1, any = false;
  for (let r = 0; r < h; r++) {
    for (let c = 0; c < w; c++) {
      if (cells[r * w + c]) {
        any = true;
        if (r < minR) minR = r; if (r > maxR) maxR = r;
        if (c < minC) minC = c; if (c > maxC) maxC = c;
      }
    }
  }
  if (!any) return [];
  const spanR = Math.max(1, maxR - minR), spanC = Math.max(1, maxC - minC);
  const seen = new Map(); // bucketKey -> {x,y,s}
  for (let r = minR; r <= maxR; r++) {
    for (let c = minC; c <= maxC; c++) {
      const s = cells[r * w + c];
      if (!s) continue;
      const bx = Math.min(N - 1, Math.floor(((c - minC) / spanC) * N));
      const by = Math.min(N - 1, Math.floor(((r - minR) / spanR) * N));
      const key = by * N + bx;
      if (!seen.has(key)) {
        seen.set(key, { x: (bx + 0.5) / N, y: (by + 0.5) / N, s });
      }
    }
  }
  return Array.from(seen.values());
}

// Re-Export der Built-in-Farbkonstanten fuer Tests/Tooling.
export const PRESET_DEFAULT_STATE = C1;
