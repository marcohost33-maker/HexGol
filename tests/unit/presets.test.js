// v33 Feature 3 (2026-06-09): Muster-Galerie & Presets.
// Korrektheits-Orakel:
//   - Built-in-Liste nicht leer + jeder Built-in baut einen gueltigen Feld-Zustand.
//   - Preset-Roundtrip: serializePreset -> deserializePreset == Original (bit-exakt).
//   - Validierung fail-closed: kaputte/fremde/zukuenftige Objekte -> isValidPreset=false
//     und deserializePreset wirft (kein stilles Laden).
//   - localStorage-Persistenz: save/load/delete via injizierten Fake-Store
//     (kein globaler Patch), inkl. Limit- und Korruptions-Pfad.
//   - Thumbnail-Sampling: belegte Zellen -> normierte Punkte in [0,1], leeres Feld -> [].
//   - Built-in-Aliveness-Orakel: jeder Built-in lebt nach 20 Generationen der
//     gewaehlten Hex-Regel weiter (keine still sterbenden "interessanten" Muster).
import { describe, it, expect, beforeEach } from "vitest";
import { buildNeighbors, RULES } from "../../src/lib/sim-engine.js";
import {
  builtinDefs, buildBuiltin,
  isValidPreset, serializePreset, deserializePreset,
  loadUserPresets, saveUserPreset, deleteUserPreset,
  sampleThumbnail, THUMB_SAMPLE,
  PRESET_STORAGE_KEY, PRESET_STORAGE_MAX,
} from "../../src/lib/presets.js";
import { serializeSave } from "../../src/lib/savestate.js";

// --- Fake localStorage (injizierbar, kein globaler Patch) --------------------
function makeFakeStore() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)); },
    removeItem: (k) => { map.delete(k); },
    _map: map,
  };
}

// Boolean-Hex-Stepper (6 Nachbarn) ueber die Engine-Nachbarliste (.edge, -1 = Wand).
function stepBS(cells, NL, B, S) {
  const n = cells.length, out = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const base = i * 6; let live = 0;
    for (let k = 0; k < 6; k++) { const j = NL[base + k]; if (j >= 0 && cells[j]) live++; }
    out[i] = cells[i] ? (S.includes(live) ? 1 : 0) : (B.includes(live) ? 1 : 0);
  }
  return out;
}
function pop(c) { let p = 0; for (let i = 0; i < c.length; i++) if (c[i]) p++; return p; }

describe("Built-in-Galerie", () => {
  it("Liste ist nicht leer und traegt stabile id/name/origin", () => {
    const defs = builtinDefs();
    expect(defs.length).toBeGreaterThanOrEqual(4);
    expect(defs.length).toBeLessThanOrEqual(8);
    for (const d of defs) {
      expect(typeof d.id).toBe("string");
      expect(d.id.length).toBeGreaterThan(0);
      expect(typeof d.name).toBe("string");
      expect(d.name.length).toBeGreaterThan(0);
      expect(typeof d.origin).toBe("string"); // Ehrlichkeits-Herkunft Pflicht
      expect(d.origin.length).toBeGreaterThan(10);
      expect(typeof d.ruleIdx).toBe("number");
      expect(RULES[d.ruleIdx]).toBeTruthy(); // gueltiger Regel-Index
    }
    // ids eindeutig
    const ids = defs.map((d) => d.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("builtinDefs() liefert eine defensive Kopie (Aufrufer kann nicht mutieren)", () => {
    const a = builtinDefs();
    a[0].points[0][0] = 9999;
    const b = builtinDefs();
    expect(b[0].points[0][0]).not.toBe(9999);
  });

  it("buildBuiltin erzeugt einen gueltigen, nicht-leeren Feld-Zustand", () => {
    for (const d of builtinDefs()) {
      const state = buildBuiltin(d.id, { rows: 40, cols: 40, sizeIdx: 0 });
      expect(state.cells.length).toBe(40 * 40);
      expect(pop(state.cells)).toBeGreaterThan(0);
      expect(state.meta.width).toBe(40);
      expect(state.meta.height).toBe(40);
      expect(state.meta.ruleIdx).toBe(d.ruleIdx);
      expect(state.meta.simMode).toBe("life");
      expect(state.meta.builtin).toBe(true);
      // Als Preset serialisierbar -> gueltig.
      const obj = serializeSave({ cells: state.cells, meta: state.meta });
      expect(isValidPreset(obj)).toBe(true);
    }
  });

  it("buildBuiltin clippt out-of-bounds-Offsets auf kleinen Gittern (keine Index-Fehler)", () => {
    // Sehr kleines Gitter: einige Offsets fallen raus -> bleibt gueltig, pop>0.
    const state = buildBuiltin("chain", { rows: 6, cols: 6 });
    expect(state.cells.length).toBe(36);
    expect(pop(state.cells)).toBeGreaterThan(0);
  });

  it("buildBuiltin wirft fail-closed bei unbekannter id / ungueltigem Gitter", () => {
    expect(() => buildBuiltin("gibtsnicht", { rows: 10, cols: 10 })).toThrow();
    expect(() => buildBuiltin("triad", { rows: 0, cols: 10 })).toThrow();
    expect(() => buildBuiltin("triad", { rows: 10, cols: -1 })).toThrow();
  });

  // KORREKTHEITS-ORAKEL (Codie-Prinzip, Brief-Ehrlichkeit): kein Built-in darf
  // sofort verloeschen. Wir spielen den realen Engine-Schritt 20 Generationen und
  // verlangen, dass das Muster unter SEINER Regel weiterlebt. Deterministisch
  // (fester Seed, fixe Geometrie) -> reproduzierbar.
  it.each(builtinDefs().map((d) => [d.id, d.ruleIdx, d.name]))(
    "Built-in '%s' (rule#%i, %s) lebt nach 20 Generationen weiter",
    (id, ruleIdx) => {
      const rows = 40, cols = 40;
      const NL = buildNeighbors(rows, cols, "box").edge;
      const rule = RULES[ruleIdx];
      let cells = buildBuiltin(id, { rows, cols }).cells;
      // auf 0/1 normalisieren (Built-in nutzt Farbzustand C1)
      const c = new Uint8Array(cells.length);
      for (let i = 0; i < cells.length; i++) c[i] = cells[i] ? 1 : 0;
      let cur = c;
      for (let g = 0; g < 20; g++) cur = stepBS(cur, NL, rule.B, rule.S);
      expect(pop(cur)).toBeGreaterThan(0);
    }
  );
});

describe("Preset Serialize/Deserialize Roundtrip", () => {
  it("serializePreset -> deserializePreset ist bit-exakt", () => {
    const state = buildBuiltin("block", { rows: 80, cols: 100, sizeIdx: 1 });
    const obj = serializePreset({ name: "Mein Block", cells: state.cells, meta: state.meta });
    // JSON-Roundtrip (wie localStorage-Persistenz es tut).
    const back = deserializePreset(JSON.parse(JSON.stringify(obj)));
    expect(back.cells.length).toBe(state.cells.length);
    expect(back.cells).toEqual(state.cells);
    expect(back.meta.name).toBe("Mein Block");
    expect(back.meta.ruleIdx).toBe(state.meta.ruleIdx);
    expect(back.meta.builtin).toBe(false);
  });

  it("serializePreset wirft bei fehlendem Namen / fehlenden Zellen (fail-closed)", () => {
    const state = buildBuiltin("triad", { rows: 40, cols: 50 });
    expect(() => serializePreset({ name: "", cells: state.cells, meta: state.meta })).toThrow();
    expect(() => serializePreset({ name: "  ", cells: state.cells, meta: state.meta })).toThrow();
    expect(() => serializePreset({ name: "x", cells: null, meta: state.meta })).toThrow();
  });
});

describe("Validierung fail-closed", () => {
  it("isValidPreset lehnt Nicht-Objekte / falsches Format / Korruptes ab", () => {
    expect(isValidPreset(null)).toBe(false);
    expect(isValidPreset(42)).toBe(false);
    expect(isValidPreset({})).toBe(false);
    expect(isValidPreset({ format: "fremdes-format", version: 1 })).toBe(false);
    // gueltige Huelle, dann cellCount-Mismatch -> korrupt
    const state = buildBuiltin("triad", { rows: 40, cols: 50 });
    const good = serializeSave({ cells: state.cells, meta: state.meta });
    const corrupt = JSON.parse(JSON.stringify(good));
    corrupt.meta.cellCount = (corrupt.meta.cellCount || state.cells.length) + 1;
    expect(isValidPreset(corrupt)).toBe(false);
    // zukuenftige Version -> abgelehnt
    const future = JSON.parse(JSON.stringify(good));
    future.version = 99;
    expect(isValidPreset(future)).toBe(false);
  });

  it("deserializePreset wirft bei ungueltigem Preset (kein stilles Laden)", () => {
    expect(() => deserializePreset({ format: "x", version: 1 })).toThrow();
    expect(() => deserializePreset(null)).toThrow();
  });
});

describe("Eigene Presets — localStorage-Persistenz", () => {
  let store;
  beforeEach(() => { store = makeFakeStore(); });

  function mkPreset(name) {
    const state = buildBuiltin("fan", { rows: 40, cols: 50 });
    return serializePreset({ name, cells: state.cells, meta: state.meta });
  }

  it("leerer Store -> leere Liste", () => {
    expect(loadUserPresets(store)).toEqual([]);
  });

  it("save -> load Roundtrip (Reihenfolge + Inhalt)", () => {
    saveUserPreset(mkPreset("A"), store);
    saveUserPreset(mkPreset("B"), store);
    const list = loadUserPresets(store);
    expect(list.map((p) => p.meta.name)).toEqual(["A", "B"]);
    // Persistierter Eintrag bleibt ein gueltiges Preset.
    expect(list.every(isValidPreset)).toBe(true);
  });

  it("gleicher Name ersetzt (kein Duplikat)", () => {
    saveUserPreset(mkPreset("A"), store);
    saveUserPreset(mkPreset("A"), store);
    expect(loadUserPresets(store).length).toBe(1);
  });

  it("delete entfernt per Name", () => {
    saveUserPreset(mkPreset("A"), store);
    saveUserPreset(mkPreset("B"), store);
    const after = deleteUserPreset("A", store);
    expect(after.map((p) => p.meta.name)).toEqual(["B"]);
    expect(loadUserPresets(store).map((p) => p.meta.name)).toEqual(["B"]);
  });

  it("saveUserPreset wirft bei ungueltigem Preset", () => {
    expect(() => saveUserPreset({ format: "x", version: 1 }, store)).toThrow();
  });

  it("Limit-Deckel greift fail-closed (code LIMIT)", () => {
    for (let i = 0; i < PRESET_STORAGE_MAX; i++) saveUserPreset(mkPreset("P" + i), store);
    let err;
    try { saveUserPreset(mkPreset("zuviel"), store); } catch (e) { err = e; }
    expect(err).toBeTruthy();
    expect(err.code).toBe("LIMIT");
    expect(loadUserPresets(store).length).toBe(PRESET_STORAGE_MAX);
  });

  it("korruptes JSON im Store -> leere Liste (kein Wurf, kein Garbage)", () => {
    store.setItem(PRESET_STORAGE_KEY, "{kaputt");
    expect(loadUserPresets(store)).toEqual([]);
    // Nicht-Array
    store.setItem(PRESET_STORAGE_KEY, JSON.stringify({ not: "array" }));
    expect(loadUserPresets(store)).toEqual([]);
    // Array mit einem kaputten + einem guten Eintrag -> nur der gute ueberlebt
    store.setItem(PRESET_STORAGE_KEY, JSON.stringify([{ format: "x" }, mkPreset("ok")]));
    const list = loadUserPresets(store);
    expect(list.length).toBe(1);
    expect(list[0].meta.name).toBe("ok");
  });
});

describe("Thumbnail-Sampling", () => {
  it("belegte Zellen -> normierte Punkte in [0,1], leeres Feld -> []", () => {
    const state = buildBuiltin("ring", { rows: 40, cols: 50 });
    const pts = sampleThumbnail(state);
    expect(pts.length).toBeGreaterThan(0);
    expect(pts.length).toBeLessThanOrEqual(THUMB_SAMPLE * THUMB_SAMPLE);
    for (const p of pts) {
      expect(p.x).toBeGreaterThanOrEqual(0); expect(p.x).toBeLessThanOrEqual(1);
      expect(p.y).toBeGreaterThanOrEqual(0); expect(p.y).toBeLessThanOrEqual(1);
      expect(p.s).toBeGreaterThan(0);
    }
    // leeres Feld
    const empty = { cells: new Uint8Array(40 * 50), meta: { width: 50, height: 40 } };
    expect(sampleThumbnail(empty)).toEqual([]);
    // defensiv: kaputte Eingabe
    expect(sampleThumbnail(null)).toEqual([]);
    expect(sampleThumbnail({ cells: null, meta: {} })).toEqual([]);
  });

  it("Buckets sind dedupliziert (max NxN Punkte, distinct Positionen)", () => {
    const state = buildBuiltin("block", { rows: 40, cols: 50 });
    const pts = sampleThumbnail(state, 5);
    expect(pts.length).toBeLessThanOrEqual(25);
    const keys = new Set(pts.map((p) => `${p.x},${p.y}`));
    expect(keys.size).toBe(pts.length); // keine doppelten Positionen
  });
});
