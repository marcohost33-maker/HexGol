import { describe, it, expect } from "vitest";
import {
  oddRToCube, cubeToOddR, hexDist, CUBE_DIRS,
  cubeRing, cubeDisk, kColorByIndex, sectorByAngle,
} from "../../src/lib/hex-geom.js";

// Portiert aus den Drive-Verifikations-Skripten (G:\...\0HexGol):
//   - "golhex test hex corners.js"   -> hexagon-corners / mask-BBox
//   - "golhex test outlines real.js" -> Umriss-Geometrie konsistent mit Maske
// Diese pruefen die GEOMETRIE-Orakel des v31-Hexagon-/Dreieck-Rahmens unabhaengig
// (kein Render, keine React-DOM). Quelle der Funktionen: src/lib/hex-geom.js
// (dieselbe Single-Source, die App.tsx fuer Maske + Umriss benutzt).

const S3 = Math.sqrt(3);
const wx = (r, c) => (c + ((r & 1) ? 0.5 : 0)) * S3;
const wy = (r) => r * 1.5;

// Spiegelt App.tsx buildNeighbors (hexagon-Maske) + drawFrame (hexagon-Umriss).
function hexFrame(R, C) {
  const cr = (R - 1) / 2, cc = (C - 1) / 2;
  const centerCube = oddRToCube(cc, cr);
  const hexRad = Math.min(Math.floor((R - 1) / 2), Math.floor((C - 1) / 2));
  // Umriss-Ecken (drawFrame): hexRad Schritte in den 6 Wuerfel-Richtungen.
  const corners = [];
  for (let k = 0; k < 6; k++) {
    const cube = {
      x: centerCube.x + hexRad * CUBE_DIRS[k].x,
      y: centerCube.y + hexRad * CUBE_DIRS[k].y,
      z: centerCube.z + hexRad * CUBE_DIRS[k].z,
    };
    const off = cubeToOddR(cube);
    corners.push([wx(off.row, off.col), wy(off.row), hexDist(cube, centerCube)]);
  }
  // Maske (buildNeighbors): alle Zellen mit hexDist <= hexRad.
  let mMinX = Infinity, mMaxX = -Infinity, mMinY = Infinity, mMaxY = -Infinity, count = 0;
  for (let r = 0; r < R; r++) for (let c = 0; c < C; c++) {
    if (hexDist(oddRToCube(c, r), centerCube) <= hexRad) {
      mMinX = Math.min(mMinX, wx(r, c)); mMaxX = Math.max(mMaxX, wx(r, c));
      mMinY = Math.min(mMinY, wy(r)); mMaxY = Math.max(mMaxY, wy(r)); count++;
    }
  }
  let cMinX = Infinity, cMaxX = -Infinity, cMinY = Infinity, cMaxY = -Infinity;
  for (const [x, y] of corners) { cMinX = Math.min(cMinX, x); cMaxX = Math.max(cMaxX, x); cMinY = Math.min(cMinY, y); cMaxY = Math.max(cMaxY, y); }
  return { corners, hexRad, count,
    maskBBox: [mMaxX - mMinX, mMaxY - mMinY], cornerBBox: [cMaxX - cMinX, cMaxY - cMinY] };
}

describe("hex-geom: Wuerfelkoordinaten (Red Blob Games)", () => {
  it("oddRToCube/cubeToOddR sind invers (Roundtrip)", () => {
    for (let r = 0; r < 17; r++) for (let c = 0; c < 17; c++) {
      const back = cubeToOddR(oddRToCube(c, r));
      expect(back.row).toBe(r); expect(back.col).toBe(c);
    }
  });
  it("Wuerfel-Invariante x+y+z=0 gilt fuer oddRToCube", () => {
    for (let r = 0; r < 13; r++) for (let c = 0; c < 13; c++) {
      const q = oddRToCube(c, r); expect(q.x + q.y + q.z).toBe(0);
    }
  });
  it("CUBE_DIRS sind 6 Einheits-Hex-Schritte (hexDist=1, Summe=0)", () => {
    expect(CUBE_DIRS).toHaveLength(6);
    for (const d of CUBE_DIRS) {
      expect(d.x + d.y + d.z).toBe(0);
      expect(hexDist(d, { x: 0, y: 0, z: 0 })).toBe(1);
    }
  });
});

describe("hex corners (portiert): Hexagon-Umriss == Maske", () => {
  // Kernorakel aus "golhex test hex corners.js": die aus den Wuerfel-Richtungen
  // abgeleiteten Ecken liegen exakt auf dem Maskenrand -> Ecken-BBox == Masken-BBox.
  // (FIX-Beleg: die fruehere trigonometrische Naeherung ergab BBox-Verhaeltnis
  //  0.87 statt 1.155 und schnitt die Maske ab.)
  for (const [R, C] of [[41, 41], [31, 41], [51, 51], [21, 33]]) {
    it(`R=${R} C=${C}: Ecken-BBox == Masken-BBox`, () => {
      const f = hexFrame(R, C);
      expect(Math.abs(f.cornerBBox[0] - f.maskBBox[0])).toBeLessThan(0.01);
      expect(Math.abs(f.cornerBBox[1] - f.maskBBox[1])).toBeLessThan(0.01);
    });
  }
  it("alle 6 Ecken liegen exakt auf dem Rand (hexDist == hexRad)", () => {
    const f = hexFrame(41, 41);
    for (const [, , d] of f.corners) expect(d).toBe(f.hexRad);
  });
  it("Maske ist eine zentrierte Hexzahl 1+3r(r+1) (exakt, keine Naeherung)", () => {
    for (const [R, C] of [[41, 41], [51, 51], [33, 33]]) {
      const f = hexFrame(R, C);
      expect(f.count).toBe(1 + 3 * f.hexRad * (f.hexRad + 1));
    }
  });
});

// ===========================================================================
// v33 Stempel-Primitive (Ring/Disk/k-Faerbung). Unabhaengiges Orakel je Aussage
// (Red Blob Games: Ring(n)=6n, Disk(n)=1+3n(n+1)). AGENTS.md DoD#4: Geometrie-
// Aenderung -> passende Unit-Tests. Inkl. Negativ-/Edge-Inputs (Silent-Failure-Gate).
// ===========================================================================
const CENTER = oddRToCube(20, 20); // beliebiges Zentrum, n>0 vom Rand entkoppelt

describe("cubeRing (Red Blob): Ring(n) hat genau 6n Zellen", () => {
  for (let n = 1; n <= 6; n++) {
    it(`Ring ${n}: Laenge == 6*${n} == ${6 * n}`, () => {
      expect(cubeRing(CENTER, n)).toHaveLength(6 * n);
    });
    it(`Ring ${n}: ALLE Zellen haben hexDist == ${n} (Symmetrie)`, () => {
      for (const cell of cubeRing(CENTER, n)) expect(hexDist(cell, CENTER)).toBe(n);
    });
  }
  it("Ring-Zellen sind paarweise verschieden (keine Doppel)", () => {
    const r = cubeRing(CENTER, 4);
    const keys = new Set(r.map((c) => `${c.x},${c.y},${c.z}`));
    expect(keys.size).toBe(r.length);
  });
  it("aufeinanderfolgende Ring-Zellen sind Nachbarn (hexDist 1, geschlossener Umlauf)", () => {
    const r = cubeRing(CENTER, 3);
    for (let i = 0; i < r.length; i++) {
      const a = r[i], b = r[(i + 1) % r.length];
      expect(hexDist(a, b)).toBe(1); // zusammenhaengend -> Sektoren sind zusammenhaengend
    }
  });
  // Edge/Negativ (Silent-Failure-Gate):
  it("Ring 0 == nur das Zentrum; Ring -1/-3 == leer (kein crash, kein garbage)", () => {
    expect(cubeRing(CENTER, 0)).toHaveLength(1);
    expect(hexDist(cubeRing(CENTER, 0)[0], CENTER)).toBe(0);
    expect(cubeRing(CENTER, -1)).toHaveLength(0);
    expect(cubeRing(CENTER, -3)).toHaveLength(0);
  });
});

describe("cubeDisk (Red Blob): Disk(n) hat genau 1+3n(n+1) Zellen", () => {
  for (let n = 0; n <= 5; n++) {
    it(`Disk ${n}: Laenge == 1+3*${n}*${n + 1} == ${1 + 3 * n * (n + 1)}`, () => {
      expect(cubeDisk(CENTER, n)).toHaveLength(1 + 3 * n * (n + 1));
    });
    it(`Disk ${n}: ALLE Zellen haben hexDist <= ${n}`, () => {
      for (const cell of cubeDisk(CENTER, n)) expect(hexDist(cell, CENTER)).toBeLessThanOrEqual(n);
    });
  }
  it("Disk == Vereinigung der Ringe 0..n (Konsistenz mit cubeRing)", () => {
    const n = 4;
    let sum = 1;
    for (let k = 1; k <= n; k++) sum += cubeRing(CENTER, k).length;
    expect(cubeDisk(CENTER, n)).toHaveLength(sum);
  });
});

describe("kColorByIndex: symmetrische k-Faerbung des Rings (restfrei)", () => {
  // 6n ist fuer JEDES n durch 1,2,3,6 teilbar -> jeder Sektor exakt 6n/k Zellen.
  for (const n of [1, 2, 3, 4]) {
    for (const k of [1, 2, 3]) {
      it(`Ring ${n}, ${k} Farben: jeder Sektor hat exakt ${(6 * n) / k} Zellen`, () => {
        const len = 6 * n;
        const sectorOf = kColorByIndex(len, k);
        const counts = new Array(k).fill(0);
        for (let i = 0; i < len; i++) counts[sectorOf(i)]++;
        for (const c of counts) expect(c).toBe((6 * n) / k);
        // restfrei: Summe == len, keine Farbe ausserhalb 0..k-1
        expect(counts.reduce((a, b) => a + b, 0)).toBe(len);
      });
    }
  }
  it("k=1 -> alles Farbe 0; k<=0 wird als 1 behandelt (kein Index-Out-of-Range)", () => {
    const sectorOf = kColorByIndex(18, 1);
    for (let i = 0; i < 18; i++) expect(sectorOf(i)).toBe(0);
    const z = kColorByIndex(18, 0);
    for (let i = 0; i < 18; i++) expect(z(i)).toBe(0);
  });
  it("Sektoren sind zusammenhaengend (Index-Bloecke, kein Reissverschluss)", () => {
    const n = 3, k = 3, len = 6 * n, per = len / k;
    const sectorOf = kColorByIndex(len, k);
    for (let i = 0; i < len; i++) expect(sectorOf(i)).toBe(Math.floor(i / per));
  });
});

describe("sectorByAngle (Disk-Faerbung): Winkel-Sektoren, Zentrum stabil", () => {
  const S3 = Math.sqrt(3);
  const wx = (r, c) => (c + ((r & 1) ? 0.5 : 0)) * S3;
  const wy = (r) => r * 1.5;
  it("Zentrum -> immer Sektor 0 (kein NaN aus atan2(0,0))", () => {
    for (const k of [1, 2, 3]) expect(sectorByAngle(CENTER, CENTER, k, wx, wy)).toBe(0);
  });
  it("Sektor-Index immer in [0, k-1] fuer eine ganze Disk", () => {
    for (const k of [2, 3, 6]) {
      for (const cell of cubeDisk(CENTER, 4)) {
        const s = sectorByAngle(cell, CENTER, k, wx, wy);
        expect(s).toBeGreaterThanOrEqual(0);
        expect(s).toBeLessThanOrEqual(k - 1);
      }
    }
  });
  it("k=1 -> Sektor 0 fuer alle Zellen", () => {
    for (const cell of cubeDisk(CENTER, 3)) expect(sectorByAngle(cell, CENTER, 1, wx, wy)).toBe(0);
  });
});
