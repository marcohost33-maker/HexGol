// =============================================================================
// Unit-Tests HexForge-2D-Adapter (Issue #128, Erst-Scope).
//
// Deckt die verbindlichen Gates aus dem Issue ab:
//   - Golden-Presets: deterministische Hashes + Zellzahlen für alle 6 Startformen
//     auf zwei Referenzgittern (S 40x50, M 80x100) — Regressionsschutz gegen
//     jede stillschweigende Geometrie-/Projektionsänderung.
//   - Determinismus: identische Parameter -> identischer Hash (mehrfach).
//   - Konnektivitäts-/Loch-Gate über alle Formen und Gitter S..3XL.
//   - Round-trip über das vorhandene .golhex.json-Format (savestate-Hülle),
//     inkl. Galerie-Kompatibilität (isValidPreset).
//   - Negative Tests: leere/degenerierte Silhouette, NaN, Budget-Überschreitung,
//     getrennte Komponenten, Löcher bei sealHoles=false, Hash-Korruption,
//     Import einer neueren/inkompatiblen Preset-Version.
// =============================================================================
import { describe, it, expect } from "vitest";
import {
  HEXFORGE_VERSION, HEXFORGE_SHAPE_IDS, HEXFORGE_DEFAULT_BUDGET,
  hexforgeShapes, normalizeHexForgeSpec, analyzeHexMask, hexforgeHash,
  rasterizeHexForge, buildHexForgeState,
  serializeHexForgePreset, deserializeHexForgePreset,
} from "../../src/lib/hexforge-2d.js";
import { isValidPreset } from "../../src/lib/presets.js";
import { SAVE_FORMAT_VERSION, bytesToBase64 } from "../../src/lib/savestate.js";

const S = { rows: 40, cols: 50 };
const M = { rows: 80, cols: 100 };

// Golden-Werte (erzeugt mit dem Adapter selbst, Gate-Sweep 2026-08-11; danach
// eingefroren — jede Abweichung ist eine BEWUSSTE Projektionsänderung und muss
// hier begründet nachgezogen werden).
const GOLDEN = {
  "rounded-cross":    { S: { cells: 468, hash: "698468db" }, M: { cells: 1826,  hash: "f301916d" } },
  "four-lobe-clover": { S: { cells: 596, hash: "dc158bd8" }, M: { cells: 2362,  hash: "92ab1734" } },
  "spiky-rosette":    { S: { cells: 456, hash: "ffbd24f9" }, M: { cells: 1832,  hash: "5acaacb5" } },
  "thin-eight-star":  { S: { cells: 284, hash: "cf949fa8" }, M: { cells: 1182,  hash: "516b7ad9" } },
  "jagged-starburst": { S: { cells: 497, hash: "79b76919" }, M: { cells: 1966,  hash: "7cc03ce1" } },
  "radial-burst":     { S: { cells: 630, hash: "ec146251" }, M: { cells: 2476,  hash: "68b4fe08" } },
};

describe("hexforge-2d: Registry + Spec-Normalisierung", () => {
  it("kennt genau die 6 Startformen aus Issue #128", () => {
    expect(HEXFORGE_SHAPE_IDS).toEqual([
      "rounded-cross", "four-lobe-clover", "spiky-rosette",
      "thin-eight-star", "jagged-starburst", "radial-burst",
    ]);
    const defs = hexforgeShapes();
    expect(defs).toHaveLength(6);
    for (const d of defs) {
      expect(d.expectedComponents).toBe(1);
      expect(d.allowHoles).toBe(false);
      expect(d.origin.length).toBeGreaterThan(10);
    }
  });

  it("macht alle Projektionsparameter explizit (Defaults dokumentiert)", () => {
    const spec = normalizeHexForgeSpec({ shape: "rounded-cross" });
    expect(spec.orient).toBe("pointy-oddr");
    expect(spec.scale).toBeCloseTo(0.9);
    expect(spec.rotationDeg).toBe(0);
    expect(spec.centerRow).toBeNull(); // null = Gittermitte (explizite Konvention)
    expect(spec.budget).toBe(HEXFORGE_DEFAULT_BUDGET);
    expect(spec.sealHoles).toBe(true);
    expect(spec.version).toBe(HEXFORGE_VERSION);
    expect(Object.isFrozen(spec)).toBe(true);
  });

  it("weist unbekannte Form, NaN und Out-of-Range fail-closed ab", () => {
    expect(() => normalizeHexForgeSpec({ shape: "hexagon-3d" })).toThrowError(/unbekannte Form/);
    expect(() => normalizeHexForgeSpec({ shape: "rounded-cross", scale: NaN })).toThrowError(/nicht endlich/);
    expect(() => normalizeHexForgeSpec({ shape: "rounded-cross", scale: 7 })).toThrowError(/ausserhalb/);
    expect(() => normalizeHexForgeSpec({ shape: "rounded-cross", params: { evil: 1 } })).toThrowError(/unbekannter Form-Parameter/);
    expect(() => normalizeHexForgeSpec({ shape: "rounded-cross", params: { core: NaN } })).toThrowError(/nicht endlich/);
    expect(() => normalizeHexForgeSpec({ shape: "rounded-cross", sealHoles: "ja" })).toThrowError(/boolean/);
  });

  it("weist eine neuere Spec-Version ab (E_VERSION)", () => {
    try {
      normalizeHexForgeSpec({ shape: "rounded-cross", version: HEXFORGE_VERSION + 1 });
      expect.unreachable("muss werfen");
    } catch (e) {
      expect(e.code).toBe("E_VERSION");
      expect(e.message).toMatch(/aktualisieren/);
    }
  });
});

describe("hexforge-2d: Golden-Presets (Determinismus-Anker)", () => {
  for (const id of HEXFORGE_SHAPE_IDS) {
    it(`${id}: exakte Zellzahl + Hash auf S und M`, () => {
      for (const [label, grid] of [["S", S], ["M", M]]) {
        const { stats, hash } = rasterizeHexForge({ shape: id }, grid);
        expect(stats.cellCount, `${id}/${label} Zellzahl`).toBe(GOLDEN[id][label].cells);
        expect(hash, `${id}/${label} Hash`).toBe(GOLDEN[id][label].hash);
        expect(stats.components).toBe(1);
        expect(stats.holes).toBe(0);
      }
    });
  }

  it("identische Parameter -> identischer Hash (3 Läufe)", () => {
    const runs = [1, 2, 3].map(() => rasterizeHexForge({ shape: "spiky-rosette", rotationDeg: 15 }, M).hash);
    expect(runs[0]).toBe(runs[1]);
    expect(runs[1]).toBe(runs[2]);
  });

  it("Rotation/Scale/Versiegelung gehen in den Hash ein", () => {
    const base = rasterizeHexForge({ shape: "rounded-cross" }, S).hash;
    expect(rasterizeHexForge({ shape: "rounded-cross", rotationDeg: 30 }, S).hash).not.toBe(base);
    expect(rasterizeHexForge({ shape: "rounded-cross", scale: 0.7 }, S).hash).not.toBe(base);
  });
});

describe("hexforge-2d: Konnektivitäts-/Loch-Gates", () => {
  it("alle 6 Formen: 1 Komponente, 0 Löcher über S..3XL", () => {
    const grids = [S, M, { rows: 120, cols: 150 }, { rows: 160, cols: 200 }, { rows: 200, cols: 250 }, { rows: 300, cols: 300 }];
    for (const id of HEXFORGE_SHAPE_IDS) {
      for (const g of grids) {
        const { stats } = rasterizeHexForge({ shape: id }, g);
        expect(stats.components, `${id} ${g.rows}x${g.cols}`).toBe(1);
        expect(stats.holes, `${id} ${g.rows}x${g.cols}`).toBe(0);
      }
    }
  });

  it("analyzeHexMask erkennt synthetische Mehr-Komponenten und Löcher", () => {
    // Zwei getrennte Blobs auf 10x10.
    const two = new Uint8Array(100);
    two[1 * 10 + 1] = 1; two[8 * 10 + 8] = 1;
    expect(analyzeHexMask(two, 10, 10)).toEqual({ cellCount: 2, components: 2, holes: 0 });
    // Hex-Ring um (3,3) auf odd-r: Zentrum tot, 6 Nachbarn lebendig -> 1 Loch.
    const ring = new Uint8Array(64);
    // Reihe 3 ist ungerade -> odd-Offsets [-1,0],[-1,1],[0,-1],[0,1],[1,0],[1,1]
    for (const [dr, dc] of [[-1, 0], [-1, 1], [0, -1], [0, 1], [1, 0], [1, 1]]) {
      ring[(3 + dr) * 8 + (3 + dc)] = 1;
    }
    const a = analyzeHexMask(ring, 8, 8);
    expect(a.components).toBe(1);
    expect(a.holes).toBe(1);
  });

  it("sealHoles=false lässt das strenge Loch-Gate greifen (E_HOLES)", () => {
    // four-lobe-clover rastert auf M mit 2 Pinhole-Artefakten (Gate-Sweep).
    try {
      rasterizeHexForge({ shape: "four-lobe-clover", sealHoles: false }, M);
      expect.unreachable("muss werfen");
    } catch (e) {
      expect(e.code).toBe("E_HOLES");
    }
    // Mit Versiegelung (Default): exakt diese 2 Zellen werden gefüllt + ausgewiesen.
    const { stats } = rasterizeHexForge({ shape: "four-lobe-clover" }, M);
    expect(stats.sealed).toBe(2);
    expect(stats.holes).toBe(0);
  });

  it("getrennte Komponenten werden abgewiesen (E_COMPONENTS)", () => {
    try {
      // Winziger Kern (0.02) trennt die dünnen Strahlen vom Zentrum.
      rasterizeHexForge({ shape: "thin-eight-star", params: { core: 0.02 } }, M);
      expect.unreachable("muss werfen");
    } catch (e) {
      expect(e.code).toBe("E_COMPONENTS");
    }
  });
});

describe("hexforge-2d: Negative Silhouetten (fail-closed)", () => {
  it("leere Silhouette -> E_EMPTY (Zentrum ausserhalb des Gitters)", () => {
    try {
      rasterizeHexForge({ shape: "thin-eight-star", scale: 0.02, centerRow: -80, centerCol: -80 }, S);
      expect.unreachable("muss werfen");
    } catch (e) {
      expect(e.code).toBe("E_EMPTY");
    }
  });

  it("degenerierte Silhouette (r(theta)=0) -> E_DEGENERATE", () => {
    try {
      rasterizeHexForge({ shape: "jagged-starburst", params: { core: 0 } }, S);
      expect.unreachable("muss werfen");
    } catch (e) {
      expect(e.code).toBe("E_DEGENERATE");
    }
  });

  it("Zellbudget-Guard -> E_BUDGET mit klarer Meldung", () => {
    try {
      rasterizeHexForge({ shape: "rounded-cross", budget: 10 }, S);
      expect.unreachable("muss werfen");
    } catch (e) {
      expect(e.code).toBe("E_BUDGET");
      expect(e.message).toMatch(/Zellbudget/);
    }
  });

  it("Gitter über der Allokationsgrenze -> E_BUDGET", () => {
    expect(() => rasterizeHexForge({ shape: "rounded-cross" }, { rows: 1000, cols: 1000 }))
      .toThrowError(/Allokationsgrenze/);
  });
});

describe("hexforge-2d: Roundtrip über .golhex.json (savestate-Hülle)", () => {
  it("serialize -> JSON -> deserialize ist bit-exakt, Hash verifiziert", () => {
    for (const id of HEXFORGE_SHAPE_IDS) {
      const obj = serializeHexForgePreset(id, { ...S, sizeIdx: 0 });
      const json = JSON.parse(JSON.stringify(obj)); // Datei-Roundtrip
      const { cells, meta } = deserializeHexForgePreset(json);
      const direct = buildHexForgeState(id, { ...S, sizeIdx: 0 });
      expect(Array.from(cells)).toEqual(Array.from(direct.cells));
      expect(meta.hexforge.hash).toBe(direct.hash);
      expect(meta.hexforge.cellCount).toBe(direct.stats.cellCount);
      expect(meta.preset).toBe(`hexforge:${id}`);
    }
  });

  it("HexForge-Presets sind galerie-kompatibel (isValidPreset)", () => {
    const obj = serializeHexForgePreset("rounded-cross", { ...S, sizeIdx: 0 });
    expect(isValidPreset(obj)).toBe(true);
  });

  it("Zell-Korruption wird am Hash erkannt (E_HASH)", () => {
    const obj = serializeHexForgePreset("spiky-rosette", { ...S, sizeIdx: 0 });
    const json = JSON.parse(JSON.stringify(obj));
    // Eine Zelle kippen, cellCount unverändert lassen -> savestate-Gate blind,
    // HexForge-Hash-Gate muss greifen.
    const { cells, meta } = deserializeHexForgePreset(json);
    const flipped = cells.slice();
    flipped[0] = flipped[0] ? 0 : 1;
    const reser = JSON.parse(JSON.stringify(serializeHexForgePreset("spiky-rosette", { ...S, sizeIdx: 0 })));
    // Manipulierte Zellen einschleusen (Base64 der gekippten Maske).
    reser.cellsB64 = bytesToBase64(flipped);
    try {
      deserializeHexForgePreset(reser);
      expect.unreachable("muss werfen");
    } catch (e) {
      expect(e.code).toBe("E_HASH");
    }
    expect(meta).toBeTruthy();
  });

  it("neuere HexForge-Version wird beim Import abgewiesen (E_VERSION)", () => {
    const obj = JSON.parse(JSON.stringify(serializeHexForgePreset("radial-burst", { ...S, sizeIdx: 0 })));
    obj.meta.hexforge.version = HEXFORGE_VERSION + 1;
    try {
      deserializeHexForgePreset(obj);
      expect.unreachable("muss werfen");
    } catch (e) {
      expect(e.code).toBe("E_VERSION");
    }
  });

  it("neuere savestate-Datei-Version wird abgewiesen (bestehendes Gate)", () => {
    const obj = JSON.parse(JSON.stringify(serializeHexForgePreset("radial-burst", { ...S, sizeIdx: 0 })));
    obj.version = SAVE_FORMAT_VERSION + 1;
    expect(() => deserializeHexForgePreset(obj)).toThrowError(/neuer als unterstuetzt/);
  });

  it("Nicht-HexForge-savestate wird abgewiesen (meta.hexforge fehlt)", () => {
    const obj = JSON.parse(JSON.stringify(serializeHexForgePreset("radial-burst", { ...S, sizeIdx: 0 })));
    delete obj.meta.hexforge;
    expect(() => deserializeHexForgePreset(obj)).toThrowError(/kein HexForge-Preset/);
  });
});
