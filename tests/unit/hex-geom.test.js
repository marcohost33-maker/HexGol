import { describe, it, expect } from "vitest";
import { oddRToCube, cubeToOddR, hexDist, CUBE_DIRS } from "../../src/lib/hex-geom.js";

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
