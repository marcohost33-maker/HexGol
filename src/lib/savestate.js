// =============================================================================
// GolHex v33 — Spielstand-Speichern (PR-C)
// Pure, framework-freie Serialisierung + IndexedDB-Wrapper. Keine React-Imports,
// damit der Kern (Serialize/Deserialize) in Vitest/jsdom unit-testbar bleibt und
// im Worker oder Node ohne DOM laeuft.
//
// Designentscheide (AGENTS.md §3 "keine schweren Runtime-Deps"):
//   - KEIN browser-fs-access / idb / dexie: eigener duenner IndexedDB-Wrapper
//     (Promise-Huelle um die native API) + eigener Download/Upload-Pfad.
//   - Zellgitter als TypedArray (Uint8Array/Uint16Array je Farbtiefe), NICHT als
//     JSON-Array — 50k..680k Zellen sprengen JSON/localStorage (Recherche Thema 5).
//   - Datei-Format = JSON-Huelle mit Base64-kodierter TypedArray (vorwaerts-
//     kompatibel ueber `version`-Feld; menschenlesbarer Kopf).
//   - IndexedDB speichert die TypedArray NATIV (structured clone) — kein Base64-
//     Overhead im Browser-Store, nur im Datei-Export.
// =============================================================================

export const SAVE_FORMAT = "golhex.savestate";
export const SAVE_FORMAT_VERSION = 1;       // Datei-/Store-Schema-Version
export const SAVE_FILE_EXT = ".golhex.json";
export const IDB_NAME = "golhex-saves";
export const IDB_STORE = "states";          // benannte Slots (Spielstaende)
export const IDB_VERSION = 1;
export const AUTOSAVE_KEY = "__autosave__"; // fester Slot fuer den letzten Stand

// --- Binaer-Serialisierung des Zellgitters -----------------------------------
// Farbtiefe: GolHex nutzt 0..12 (Uint8 reicht). `bitDepth` ist dennoch im Format
// festgehalten, damit ein zukuenftiger >255-Zustandsraum (Uint16) vorwaerts-
// kompatibel geladen werden kann.
//
// Wir serialisieren das ROHE Gitter (kein RLE) als TypedArray. Bei sehr leeren
// Riesengittern waere RLE kompakter, aber: (a) der Roundtrip muss bit-exakt sein,
// (b) Base64 einer Uint8Array(680k) ~ 0.9 MB Text — fuer einen Datei-Export
// vertretbar; im IndexedDB-Store wird die TypedArray ohnehin nativ (binaer)
// abgelegt. Korrektheit vor Kompaktheit (Codie-Prinzip).

/** Maximalwert in einem Array (zur bitDepth-Wahl). */
function maxOf(arr) {
  let m = 0;
  for (let i = 0; i < arr.length; i++) if (arr[i] > m) m = arr[i];
  return m;
}

/**
 * Waehlt die schmalste TypedArray-Sicht, die alle Werte traegt.
 * 8 fuer <=255 (GolHex-Normalfall), sonst 16.
 */
export function chooseBitDepth(cells) {
  return maxOf(cells) > 255 ? 16 : 8;
}

/** Uint8Array -> Base64 (ohne Browser-FileReader, lauft auch in Node/Vitest). */
export function bytesToBase64(u8) {
  // btoa ist String-basiert und bricht bei >~100k Zeichen am Stack — daher
  // chunked. (Verified: 680k Bytes ohne RangeError.)
  let bin = "";
  const CHUNK = 0x8000; // 32k
  for (let i = 0; i < u8.length; i += CHUNK) {
    bin += String.fromCharCode.apply(null, u8.subarray(i, i + CHUNK));
  }
  if (typeof btoa === "function") return btoa(bin);
  // Node-Fallback (Vitest ohne jsdom-btoa / aeltere Umgebungen).
  return Buffer.from(bin, "binary").toString("base64");
}

/** Base64 -> Uint8Array. */
export function base64ToBytes(b64) {
  let bin;
  if (typeof atob === "function") bin = atob(b64);
  else bin = Buffer.from(b64, "base64").toString("binary");
  const u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  return u8;
}

/**
 * Verpackt ein Gitter (Uint8Array|Uint16Array, Laenge rows*cols) + Meta in ein
 * vorwaertskompatibles, JSON-serialisierbares Spielstand-Objekt mit Base64-Zellen.
 * @param {{cells: Uint8Array|Uint16Array, meta: object}} input
 * @returns {object} datei-/JSON-taugliches Spielstand-Objekt
 */
export function serializeSave({ cells, meta }) {
  if (!cells || typeof cells.length !== "number") {
    throw new Error("serializeSave: cells (TypedArray) fehlt");
  }
  const m = meta || {};
  const w = m.width | 0, h = m.height | 0;
  if (w > 0 && h > 0 && w * h !== cells.length) {
    throw new Error(`serializeSave: width*height (${w}*${h}=${w * h}) != cells.length (${cells.length})`);
  }
  const bitDepth = m.bitDepth || chooseBitDepth(cells);
  // Auf Uint8 normalisieren fuer Base64; bei 16 bit zwei Bytes/Zelle (little-endian).
  let bytes;
  if (bitDepth === 16) {
    const u16 = cells instanceof Uint16Array ? cells : Uint16Array.from(cells);
    bytes = new Uint8Array(u16.buffer.slice(0, u16.length * 2));
  } else {
    bytes = cells instanceof Uint8Array ? cells : Uint8Array.from(cells);
  }
  return {
    format: SAVE_FORMAT,
    version: SAVE_FORMAT_VERSION,
    meta: {
      name: m.name || "",
      ts: m.ts || Date.now(),
      width: w, height: h,
      bitDepth,
      cellCount: cells.length,
      // Sim-Parameter fuer korrekte Rehydration (alle optional/abwaertskompatibel):
      sizeIdx: m.sizeIdx, frameShape: m.frameShape, circleRadius: m.circleRadius,
      ruleIdx: m.ruleIdx, ruleSrc: m.ruleSrc, watzOnly: m.watzOnly,
      torusOn: m.torusOn, boundaryMode: m.boundaryMode,
      colorMode: m.colorMode, simMode: m.simMode, rvalRule: m.rvalRule,
      seed: m.seed, gen: m.gen | 0, zoom: m.zoom,
      // HexForge-2D-Herkunft (Issue #128): expliziter Silhouetten-Spec + Hash.
      // Optional/abwaertskompatibel: fehlt bei normalen Spielstaenden (undefined
      // faellt beim JSON-Export weg); deserializeSave reicht meta unveraendert durch.
      hexforge: m.hexforge,
    },
    cellsB64: bytesToBase64(bytes),
  };
}

/**
 * Inverse zu serializeSave. Validiert Format/Version und liefert
 * { cells: Uint8Array|Uint16Array, meta }.
 * @param {object} obj geladenes Spielstand-Objekt (aus Datei oder IDB-Export)
 */
export function deserializeSave(obj) {
  if (!obj || typeof obj !== "object") throw new Error("deserializeSave: kein Objekt");
  if (obj.format !== SAVE_FORMAT) {
    throw new Error(`deserializeSave: unbekanntes Format "${obj.format}" (erwartet "${SAVE_FORMAT}")`);
  }
  if (typeof obj.version !== "number" || obj.version < 1) {
    throw new Error(`deserializeSave: ungueltige version "${obj.version}"`);
  }
  if (obj.version > SAVE_FORMAT_VERSION) {
    throw new Error(`deserializeSave: Datei-Version ${obj.version} ist neuer als unterstuetzt (${SAVE_FORMAT_VERSION}). Bitte GolHex aktualisieren.`);
  }
  const meta = obj.meta || {};
  const bytes = base64ToBytes(obj.cellsB64 || "");
  let cells;
  if (meta.bitDepth === 16) {
    // Bytes (little-endian) -> Uint16Array. Buffer-Kopie, damit byteOffset 0.
    const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    cells = new Uint16Array(buf);
  } else {
    cells = bytes;
  }
  // Konsistenz: cellCount muss zur dekodierten Laenge passen (Korruptions-Gate).
  if (typeof meta.cellCount === "number" && meta.cellCount !== cells.length) {
    throw new Error(`deserializeSave: cellCount ${meta.cellCount} != dekodierte Laenge ${cells.length} (korrupt)`);
  }
  return { cells, meta };
}

// --- Reload-Guard (Audit A-GAP-1 / A-BUG-2) ----------------------------------
// applyLoadedState pollt per requestAnimationFrame, bis der reallokierte Zell-
// Buffer die geladene Laenge erreicht. Wenn die Ziel-Laenge nie konvergiert
// (z.B. circleRadius wird beim Laden auf MAX_CIRCLE_RADIUS geklemmt -> Masken-
// Zellzahl weicht ab), lief der rAF-Loop frueher UNENDLICH ohne Abbruch.
// Diese reine Funktion kapselt die Schleifen-Entscheidung -> unit-testbar.
export const MAX_RELOAD_FRAMES = 180; // ~3 s @60fps, dann fail-closed statt haengen

/**
 * Entscheidet pro rAF-Tick, ob geschrieben/erneut versucht/abgebrochen wird.
 * @param {number} currentLen aktuelle Buffer-Laenge
 * @param {number} targetLen erwartete (geladene) Laenge
 * @param {number} attempts bisherige Versuche (0-basiert)
 * @param {number} [maxFrames=MAX_RELOAD_FRAMES]
 * @returns {"write"|"retry"|"abort"}
 */
export function reloadGuardDecision(currentLen, targetLen, attempts, maxFrames = MAX_RELOAD_FRAMES) {
  if (currentLen === targetLen) return "write";
  if (attempts >= maxFrames) return "abort";
  return "retry";
}

// --- IndexedDB-Wrapper (duenn, Promise-basiert) -------------------------------
// Speichert pro Slot { key (Name), cells (TypedArray nativ), meta }. KEINE Lib.
// `indexedDB`-Quelle ist injizierbar (Default: globalThis.indexedDB) — so kann
// der Unit-Test fake-indexeddb reinreichen, ohne globale Patches.

function getIDB(idbOverride) {
  const idb = idbOverride || (typeof globalThis !== "undefined" ? globalThis.indexedDB : undefined);
  if (!idb) throw new Error("IndexedDB nicht verfuegbar");
  return idb;
}

function openDB(idbOverride) {
  return new Promise((resolve, reject) => {
    const idb = getIDB(idbOverride);
    const req = idb.open(IDB_NAME, IDB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(IDB_STORE)) {
        db.createObjectStore(IDB_STORE, { keyPath: "key" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error("IndexedDB open fehlgeschlagen"));
  });
}

function tx(db, mode) {
  const t = db.transaction(IDB_STORE, mode);
  return { store: t.objectStore(IDB_STORE), done: new Promise((res, rej) => { t.oncomplete = () => res(); t.onerror = () => rej(t.error); t.onabort = () => rej(t.error || new Error("IDB tx abort")); }) };
}

/**
 * Speichert/ueberschreibt einen Slot. cells wird NATIV (structured clone) abgelegt
 * — kein Base64 im Browser-Store. Quota-Fehler werden als typisierter Error
 * weitergereicht (Aufrufer zeigt User-Hinweis).
 */
export async function idbPut({ key, cells, meta }, idbOverride) {
  if (!key) throw new Error("idbPut: key fehlt");
  const db = await openDB(idbOverride);
  try {
    const { store, done } = tx(db, "readwrite");
    // Kopie der TypedArray, damit der laufende Sim-Buffer nicht referenziert wird
    // (sonst speichert IDB spaeter veraenderte Zellen).
    const copy = cells.slice();
    store.put({ key, cells: copy, meta: { ...meta, ts: meta.ts || Date.now() } });
    try {
      await done;
    } catch (e) {
      if (e && (e.name === "QuotaExceededError" || /quota/i.test(String(e.message || e)))) {
        const err = new Error("Speicher voll (QuotaExceeded). Loesche alte Spielstaende.");
        err.code = "QUOTA";
        throw err;
      }
      throw e;
    }
    return true;
  } finally {
    db.close();
  }
}

/** Liefert einen Slot { key, cells, meta } oder null. */
export async function idbGet(key, idbOverride) {
  const db = await openDB(idbOverride);
  try {
    const { store } = tx(db, "readonly");
    return await new Promise((res, rej) => {
      const r = store.get(key);
      r.onsuccess = () => res(r.result || null);
      r.onerror = () => rej(r.error);
    });
  } finally {
    db.close();
  }
}

/** Liste aller Slots als [{ key, meta }] (ohne die schweren Zell-Buffer). */
export async function idbList(idbOverride) {
  const db = await openDB(idbOverride);
  try {
    const { store } = tx(db, "readonly");
    return await new Promise((res, rej) => {
      const out = [];
      const r = store.openCursor();
      r.onsuccess = () => {
        const cur = r.result;
        if (cur) {
          const v = cur.value;
          out.push({ key: v.key, meta: v.meta || {} });
          cur.continue();
        } else {
          out.sort((a, b) => (b.meta.ts || 0) - (a.meta.ts || 0));
          res(out);
        }
      };
      r.onerror = () => rej(r.error);
    });
  } finally {
    db.close();
  }
}

/** Loescht einen Slot. */
export async function idbDelete(key, idbOverride) {
  const db = await openDB(idbOverride);
  try {
    const { store, done } = tx(db, "readwrite");
    store.delete(key);
    await done;
    return true;
  } finally {
    db.close();
  }
}

/** Benennt einen Slot um (get -> put neuer key -> delete alter key). */
export async function idbRename(oldKey, newKey, idbOverride) {
  if (!newKey) throw new Error("idbRename: neuer Name fehlt");
  if (oldKey === newKey) return true;
  const rec = await idbGet(oldKey, idbOverride);
  if (!rec) throw new Error(`idbRename: Slot "${oldKey}" nicht gefunden`);
  await idbPut({ key: newKey, cells: rec.cells, meta: { ...rec.meta, name: newKey } }, idbOverride);
  await idbDelete(oldKey, idbOverride);
  return true;
}

// --- "1. Figur" / Urzustand (pure Snapshot-Logik) ----------------------------
// Der Urzustand ist der Feldzustand UNMITTELBAR vor dem ersten Play-Druck eines
// Laufes. Klar getrennt von Undo/Redo (das ist ein Stack je Mal-/Step-Aktion).
//
// Reine, framework-freie Helfer, damit die Logik (wann gesetzt / wann verworfen)
// unit-testbar ist. Der React-Teil haelt nur einen Ref auf das Ergebnis.

/**
 * Erzeugt einen tiefen, eingefrorenen Urzustand-Snapshot. cells/ghost/age werden
 * kopiert (slice), Meta flach uebernommen. Rueckgabe ist read-only fuer den Aufrufer.
 */
export function makeOriginSnapshot({ cells, ghost, age, field, fieldIm, meta }) {
  return {
    cells: cells ? cells.slice() : null,
    ghost: ghost ? ghost.slice() : null,
    age: age ? age.slice() : null,
    field: field ? field.slice() : null,
    fieldIm: fieldIm ? fieldIm.slice() : null,
    meta: { ...(meta || {}) },
  };
}

/**
 * Entscheidet, ob beim Play-Druck ein NEUER Urzustand gesetzt werden soll.
 * Genau dann, wenn noch keiner existiert (erstes Play seit Leeren/Neusetzen).
 * @param {object|null} current bestehender Urzustand-Slot (oder null)
 * @returns {boolean}
 */
export function shouldCaptureOrigin(current) {
  return current == null;
}
