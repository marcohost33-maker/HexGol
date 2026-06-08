// v33 PR-C: Spielstand-Serialisierung + IndexedDB-Wrapper + Urzustand-Logik.
// Korrektheits-Orakel: bit-exakter Roundtrip ueber ALLE GolHex-Gittergroessen
// (Population + jede einzelne Zelle erhalten), Farb-Erhalt (Zustaende 0..12),
// Format-Validierung (Fail-Closed bei korrupt/zukuenftig), IDB-CRUD via
// fake-indexeddb (DEV-Dep, nicht im Bundle).
import { describe, it, expect, beforeEach } from "vitest";
import "fake-indexeddb/auto"; // setzt globalThis.indexedDB (nur Test-Umgebung)
import { IDBFactory } from "fake-indexeddb";
import { GRID_SIZES } from "../../src/lib/sim-engine.js";
import {
  serializeSave, deserializeSave, chooseBitDepth,
  bytesToBase64, base64ToBytes,
  idbPut, idbGet, idbList, idbDelete, idbRename,
  makeOriginSnapshot, shouldCaptureOrigin,
  SAVE_FORMAT, SAVE_FORMAT_VERSION,
  reloadGuardDecision, MAX_RELOAD_FRAMES,
} from "../../src/lib/savestate.js";

// Deterministisches Pseudo-Gitter (Seed-stabil), Zustaende 0..12 (GolHex-Farben).
function makeGrid(n, seed = 1) {
  const a = new Uint8Array(n);
  let s = (seed * 2654435761) >>> 0;
  for (let i = 0; i < n; i++) {
    s = (s * 1664525 + 1013904223) >>> 0;
    a[i] = s % 13; // 0..12
  }
  return a;
}

describe("Base64 <-> Bytes (chunked, gross-tauglich)", () => {
  it("Roundtrip kleiner Array", () => {
    const u = new Uint8Array([0, 1, 12, 255, 128, 7]);
    expect(base64ToBytes(bytesToBase64(u))).toEqual(u);
  });
  it("Roundtrip 680k Bytes (kein RangeError/Stack-Overflow)", () => {
    const u = makeGrid(680000, 42);
    const back = base64ToBytes(bytesToBase64(u));
    expect(back.length).toBe(680000);
    expect(back).toEqual(u);
  });
});

describe("serialize/deserialize Roundtrip — alle Gittergroessen", () => {
  it.each(GRID_SIZES.map((g, i) => [i, g.l, g.rows, g.cols]))(
    "Groesse #%i (%s) %ix%i: Zellen + Population bit-exakt erhalten",
    (idx, label, rows, cols) => {
      const cells = makeGrid(rows * cols, idx + 7);
      const popBefore = cells.reduce((s, c) => s + (c ? 1 : 0), 0);
      const obj = serializeSave({
        cells,
        meta: { name: "t" + idx, width: cols, height: rows, sizeIdx: idx, ruleIdx: 0, gen: 5 },
      });
      // JSON-Roundtrip (so wie Datei-Export/Import es tut).
      const back = deserializeSave(JSON.parse(JSON.stringify(obj)));
      expect(back.cells.length).toBe(cells.length);
      const popAfter = back.cells.reduce((s, c) => s + (c ? 1 : 0), 0);
      expect(popAfter).toBe(popBefore);
      // Jede Zelle identisch (Farb-Erhalt 0..12).
      expect(back.cells).toEqual(cells);
      expect(back.meta.width).toBe(cols);
      expect(back.meta.height).toBe(rows);
      expect(back.meta.gen).toBe(5);
    }
  );
});

describe("bitDepth / Farbtiefe", () => {
  it("waehlt Uint8 fuer Zustaende <=255", () => {
    expect(chooseBitDepth(new Uint8Array([0, 12, 255]))).toBe(8);
  });
  it("waehlt Uint16 fuer Zustaende >255 und erhaelt sie im Roundtrip", () => {
    const cells = new Uint16Array([0, 300, 65535, 1, 12]);
    expect(chooseBitDepth(cells)).toBe(16);
    const obj = serializeSave({ cells, meta: { width: 5, height: 1, bitDepth: 16 } });
    const back = deserializeSave(JSON.parse(JSON.stringify(obj)));
    expect(Array.from(back.cells)).toEqual([0, 300, 65535, 1, 12]);
  });
});

describe("Format-Validierung (Fail-Closed)", () => {
  it("hat korrektes Format-/Versionsfeld", () => {
    const obj = serializeSave({ cells: makeGrid(4), meta: { width: 2, height: 2 } });
    expect(obj.format).toBe(SAVE_FORMAT);
    expect(obj.version).toBe(SAVE_FORMAT_VERSION);
  });
  it("wirft bei unbekanntem Format", () => {
    expect(() => deserializeSave({ format: "fremd", version: 1, cellsB64: "" })).toThrow(/Format/);
  });
  it("wirft bei zukuenftiger Version (vorwaerts-Schutz)", () => {
    expect(() => deserializeSave({ format: SAVE_FORMAT, version: 999, cellsB64: "" })).toThrow(/neuer/);
  });
  it("wirft bei width*height != cells.length (Serialisierung)", () => {
    expect(() => serializeSave({ cells: makeGrid(10), meta: { width: 3, height: 3 } })).toThrow(/width\*height/);
  });
  it("wirft bei cellCount-Mismatch (Korruptions-Gate)", () => {
    const obj = serializeSave({ cells: makeGrid(4), meta: { width: 2, height: 2 } });
    obj.meta.cellCount = 999; // manipuliert
    expect(() => deserializeSave(obj)).toThrow(/korrupt/);
  });
  it("wirft bei fehlenden cells", () => {
    expect(() => serializeSave({ meta: {} })).toThrow(/cells/);
  });
});

describe("Reload-Guard (A-GAP-1 / A-BUG-2: keine rAF-Endlosschleife)", () => {
  it("schreibt sofort, wenn die Buffer-Laenge passt", () => {
    expect(reloadGuardDecision(100, 100, 0)).toBe("write");
  });
  it("versucht erneut, solange die Laenge noch nicht konvergiert ist", () => {
    expect(reloadGuardDecision(0, 100, 0)).toBe("retry");
    expect(reloadGuardDecision(50, 100, 5)).toBe("retry");
  });
  it("bricht ab statt endlos zu pollen, wenn die Laenge nie konvergiert (clamped circleRadius)", () => {
    // Szenario: geladener circleRadius wird auf MAX geklemmt -> Masken-Zellzahl
    // weicht von der gespeicherten ab -> targetLen wird NIE erreicht.
    expect(reloadGuardDecision(900, 1000, MAX_RELOAD_FRAMES)).toBe("abort");
    expect(reloadGuardDecision(900, 1000, MAX_RELOAD_FRAMES + 50)).toBe("abort");
  });
  it("write hat Vorrang vor abort am Limit (Konvergenz im letzten Frame)", () => {
    expect(reloadGuardDecision(1000, 1000, MAX_RELOAD_FRAMES + 99)).toBe("write");
  });
  it("loopt eine inkompatible Last in endlicher Zeit aus (Simulation)", () => {
    // Vollstaendiger Trockenlauf: nie-konvergierende Laenge endet deterministisch
    // mit "abort" nach <= MAX_RELOAD_FRAMES+1 Iterationen (kein Haengen).
    let attempts = 0, decision = "retry", iters = 0;
    while (decision === "retry") {
      decision = reloadGuardDecision(10, 20, attempts); // 10 != 20, konvergiert nie
      if (decision === "retry") attempts++;
      if (++iters > MAX_RELOAD_FRAMES + 5) break; // Sicherheitsnetz fuer den Test selbst
    }
    expect(decision).toBe("abort");
    expect(attempts).toBe(MAX_RELOAD_FRAMES);
  });
});

describe("IndexedDB-Slots (fake-indexeddb)", () => {
  beforeEach(() => {
    // Frische DB je Test (deterministisch, keine Slot-Lecks zwischen Tests).
    globalThis.indexedDB = new IDBFactory();
  });

  it("put -> get liefert identische Zellen", async () => {
    const cells = makeGrid(100, 3);
    await idbPut({ key: "slotA", cells, meta: { name: "slotA", width: 10, height: 10 } });
    const rec = await idbGet("slotA");
    expect(rec).not.toBeNull();
    expect(new Uint8Array(rec.cells)).toEqual(cells);
    expect(rec.meta.name).toBe("slotA");
  });

  it("put kopiert die TypedArray (spaetere Mutation des Sim-Buffers wirkt nicht)", async () => {
    const cells = makeGrid(20, 9);
    await idbPut({ key: "iso", cells, meta: { width: 20, height: 1 } });
    cells[0] = cells[0] ^ 7; // Sim-Buffer nach dem Speichern aendern
    const rec = await idbGet("iso");
    expect(rec.cells[0]).not.toBe(cells[0]);
  });

  it("list ist nach Zeitstempel absteigend sortiert + ohne Doppel", async () => {
    await idbPut({ key: "a", cells: makeGrid(4), meta: { name: "a", ts: 100 } });
    await idbPut({ key: "b", cells: makeGrid(4), meta: { name: "b", ts: 300 } });
    await idbPut({ key: "c", cells: makeGrid(4), meta: { name: "c", ts: 200 } });
    const list = await idbList();
    expect(list.map((x) => x.key)).toEqual(["b", "c", "a"]);
  });

  it("ueberschreiben behaelt einen Eintrag (kein Duplikat)", async () => {
    await idbPut({ key: "dup", cells: makeGrid(4, 1), meta: { name: "dup" } });
    await idbPut({ key: "dup", cells: makeGrid(4, 2), meta: { name: "dup" } });
    const list = await idbList();
    expect(list.filter((x) => x.key === "dup").length).toBe(1);
  });

  it("delete entfernt den Slot", async () => {
    await idbPut({ key: "del", cells: makeGrid(4), meta: { name: "del" } });
    await idbDelete("del");
    expect(await idbGet("del")).toBeNull();
  });

  it("rename verschiebt Zellen + Meta auf neuen Key", async () => {
    const cells = makeGrid(16, 5);
    await idbPut({ key: "old", cells, meta: { name: "old", width: 4, height: 4 } });
    await idbRename("old", "neu");
    expect(await idbGet("old")).toBeNull();
    const rec = await idbGet("neu");
    expect(new Uint8Array(rec.cells)).toEqual(cells);
    expect(rec.meta.name).toBe("neu");
  });

  it("IDB-Speicher -> deserialize-faehiger Export-Roundtrip", async () => {
    const cells = makeGrid(64, 11);
    await idbPut({ key: "exp", cells, meta: { name: "exp", width: 8, height: 8, gen: 3 } });
    const rec = await idbGet("exp");
    const fileObj = serializeSave({ cells: new Uint8Array(rec.cells), meta: rec.meta });
    const back = deserializeSave(JSON.parse(JSON.stringify(fileObj)));
    expect(back.cells).toEqual(cells);
  });
});

describe("Urzustand / 1. Figur (pure Logik)", () => {
  it("makeOriginSnapshot kopiert tief (keine Alias-Mutation)", () => {
    const cells = makeGrid(9, 2);
    const snap = makeOriginSnapshot({ cells, meta: { gen: 0, ruleIdx: 1 } });
    cells[0] = cells[0] ^ 255; // Original mutieren
    expect(snap.cells[0]).not.toBe(cells[0]);
    expect(snap.meta.ruleIdx).toBe(1);
  });

  it("shouldCaptureOrigin: setzt nur, wenn noch keiner existiert", () => {
    expect(shouldCaptureOrigin(null)).toBe(true);
    expect(shouldCaptureOrigin(undefined)).toBe(true);
    expect(shouldCaptureOrigin({ cells: new Uint8Array(4) })).toBe(false);
  });

  it("Restore-Semantik: Snapshot == Feld vor erstem Play, unabhaengig von spaeteren Steps", () => {
    // Simuliert: setze Figur -> snapshot -> 'laufe' (mutiere) -> restore.
    const field = makeGrid(25, 4);
    const origin = makeOriginSnapshot({ cells: field, meta: { gen: 0 } });
    // 'Steps' veraendern das Feld:
    for (let i = 0; i < field.length; i++) field[i] = (field[i] + 5) % 13;
    // Restore = origin zurueckschreiben:
    const restored = origin.cells.slice();
    expect(restored).not.toEqual(field); // Feld hat sich bewegt
    // Population des Urzustands wieder hergestellt:
    const popOrigin = origin.cells.reduce((s, c) => s + (c ? 1 : 0), 0);
    const popRestored = restored.reduce((s, c) => s + (c ? 1 : 0), 0);
    expect(popRestored).toBe(popOrigin);
  });
});
