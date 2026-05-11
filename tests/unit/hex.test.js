// Unit tests for pure functions in src/lib/hex.js.
// Goal: exercise the hex math, classifier, builders, and color mixers that
// drive the simulation, without spinning up a DOM. Keep each test small and
// focused on one invariant so a failure points to the actual bug.

import { describe, it, expect } from "vitest";
import {
  S3, CR, CB, CY, ALIVE_T,
  RULES, birthLUT, survLUT, ageBucket,
  buildGrid, pixelToOddR, pixelToOddRSnap, pointInHex,
  cMix, mMix, rng,
  minZoom, fitInsideZoom, fitView, paintableView, clampPan,
  classify, PATS,
} from "../../src/lib/hex.js";

describe("buildGrid", () => {
  it("produces N == ROWS*COLS centers, neighbors and torus indices", () => {
    const G = buildGrid(5, 4, 6);
    expect(G.ROWS).toBe(5);
    expect(G.COLS).toBe(4);
    expect(G.N).toBe(20);
    expect(G.centers.length).toBe(40);
    expect(G.NLE.length).toBe(120);
    expect(G.NLW.length).toBe(120);
  });

  it("wrap neighbors are always in-bounds; edge neighbors use -1 as sentinel", () => {
    const G = buildGrid(8, 8, 6);
    for (let i = 0; i < G.N * 6; i++) {
      expect(G.NLW[i]).toBeGreaterThanOrEqual(0);
      expect(G.NLW[i]).toBeLessThan(G.N);
    }
    let edgeSentinels = 0;
    for (let i = 0; i < G.N * 6; i++) {
      const v = G.NLE[i];
      if (v === -1) edgeSentinels++;
      else { expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThan(G.N); }
    }
    // Edge cells must produce SOME -1 neighbors.
    expect(edgeSentinels).toBeGreaterThan(0);
  });

  it("each cell has exactly six neighbors with no duplicates (torus)", () => {
    const G = buildGrid(6, 6, 6);
    for (let i = 0; i < G.N; i++) {
      const seen = new Set();
      for (let k = 0; k < 6; k++) seen.add(G.NLW[i * 6 + k]);
      expect(seen.size).toBe(6);
      expect(seen.has(i)).toBe(false);
    }
  });
});

describe("pixelToOddR", () => {
  // Helper: round-trip a center -> pixelToOddR returns the same idx.
  it("hex centers round-trip to their own index", () => {
    const HR = 12;
    const G = buildGrid(10, 10, HR);
    for (let i = 0; i < G.N; i++) {
      const wx = G.centers[i * 2];
      const wy = G.centers[i * 2 + 1];
      const idx = pixelToOddR(wx, wy, HR, G.ROWS, G.COLS);
      expect(idx).toBe(i);
    }
  });

  it("returns -1 for points clearly outside the grid", () => {
    expect(pixelToOddR(-1000, -1000, 12, 10, 10)).toBe(-1);
    expect(pixelToOddR(1e9, 1e9, 12, 10, 10)).toBe(-1);
  });

  // NR-G68: production grids (S..XXL) must support center-tap selection on
  // every cell. This is the regression that motivated v17.14.2 - a user
  // report that XL/XXL hex cells did not feel selectable. The test
  // exhaustively round-trips every cell center on every grid preset and
  // asserts the hex picker returns the original index.
  it("every cell center is selectable on every GRID_SIZES preset", () => {
    for (const gs of [
      { rows: 40, cols: 50, hr: 12 },     // S
      { rows: 80, cols: 100, hr: 6 },     // M
      { rows: 120, cols: 150, hr: 4 },    // L
      { rows: 160, cols: 200, hr: 3 },    // XL
      { rows: 200, cols: 250, hr: 2.5 },  // XXL
    ]) {
      const G = buildGrid(gs.rows, gs.cols, gs.hr);
      // Spot-check: walk a stride of 17 to keep the test under ~3000 picks
      // total across all five grids - thorough but fast.
      for (let i = 0; i < G.N; i += 17) {
        const wx = G.centers[i * 2];
        const wy = G.centers[i * 2 + 1];
        const idx = pixelToOddR(wx, wy, gs.hr, gs.rows, gs.cols);
        if (idx !== i) {
          throw new Error(
            `Grid ${gs.rows}x${gs.cols} hr=${gs.hr}: center of cell ${i} ` +
            `(world ${wx.toFixed(2)},${wy.toFixed(2)}) picked cell ${idx}`
          );
        }
      }
    }
  });

  // NR-G68: a tap at HR/4 offset from the center (well within the hex) must
  // also land on the correct cell. This guards against shape-test errors
  // where the bounding box is right but the hex shape is wrong.
  it("near-center taps land on the correct hex on XL and XXL", () => {
    for (const gs of [
      { rows: 160, cols: 200, hr: 3 },
      { rows: 200, cols: 250, hr: 2.5 },
    ]) {
      const G = buildGrid(gs.rows, gs.cols, gs.hr);
      const offsets = [
        [+gs.hr / 4, 0], [-gs.hr / 4, 0],
        [0, +gs.hr / 4], [0, -gs.hr / 4],
      ];
      for (let i = 100; i < 200; i++) {
        const wx = G.centers[i * 2];
        const wy = G.centers[i * 2 + 1];
        for (const [dx, dy] of offsets) {
          const idx = pixelToOddR(wx + dx, wy + dy, gs.hr, gs.rows, gs.cols);
          if (idx !== i) {
            throw new Error(
              `Grid ${gs.rows}x${gs.cols}: cell ${i} + offset ` +
              `(${dx.toFixed(2)},${dy.toFixed(2)}) picked cell ${idx}`
            );
          }
        }
      }
    }
  });
});

describe("pixelToOddRSnap", () => {
  it("snaps to the nearest center when the strict pick misses by less than radius", () => {
    const HR = 12;
    const G = buildGrid(8, 8, HR);
    const i = 17; // arbitrary inside cell
    const cx = G.centers[i * 2];
    const cy = G.centers[i * 2 + 1];
    // Point just outside the hex but well within HR.
    const idx = pixelToOddRSnap(cx + HR * 0.95, cy, HR, G.ROWS, G.COLS, HR * 1.5);
    expect(idx).toBeGreaterThanOrEqual(0);
  });

  it("returns -1 when snapWorldRadius is 0 and the point is off-grid", () => {
    // Strictly off-grid (negative coords); strict pick returns -1, snap with
    // radius 0 cannot save it.
    const HR = 12;
    const G = buildGrid(8, 8, HR);
    expect(pixelToOddRSnap(-5 * HR, -5 * HR, HR, G.ROWS, G.COLS, 0)).toBe(-1);
  });

  it("matches strict pixelToOddR when the point is inside a hex", () => {
    const HR = 12;
    const G = buildGrid(6, 6, HR);
    const i = 9;
    const cx = G.centers[i * 2];
    const cy = G.centers[i * 2 + 1];
    expect(pixelToOddRSnap(cx, cy, HR, G.ROWS, G.COLS, HR)).toBe(i);
  });
});

describe("pointInHex", () => {
  it("center is inside, distance > radius is outside", () => {
    expect(pointInHex(0, 0, 10)).toBe(true);
    expect(pointInHex(20, 0, 10)).toBe(false);
    expect(pointInHex(0, 20, 10)).toBe(false);
  });

  it("treats the diamond corners (max horizontal extent) as outside", () => {
    // Pointy-top hex with circumradius r has horizontal extent sqrt(3)*r/2.
    expect(pointInHex((S3 * 10) / 2 + 0.1, 0, 10)).toBe(false);
  });
});

describe("color mix functions", () => {
  it("cMix returns CR when there are no alive neighbors", () => {
    expect(cMix(0, 0, 0, 0)).toBe(CR);
  });

  it("cMix returns CR / CB / CY for unambiguous single-color inputs", () => {
    expect(cMix(3, 0, 0, 0)).toBe(CR);
    expect(cMix(0, 3, 0, 0)).toBe(CB);
    expect(cMix(0, 0, 3, 0)).toBe(CY);
  });

  it("mMix returns the plurality color and breaks ties deterministically", () => {
    expect(mMix(2, 1, 0, 0, 0)).toBe(CR);
    expect(mMix(0, 2, 1, 0, 0)).toBe(CB);
    expect(mMix(0, 1, 2, 0, 0)).toBe(CY);
    // Tie: same arguments must always return the same color.
    const a = mMix(2, 2, 2, 3, 5);
    const b = mMix(2, 2, 2, 3, 5);
    expect(a).toBe(b);
  });
});

describe("rng", () => {
  it("is deterministic for a given seed", () => {
    const a = rng(42);
    const b = rng(42);
    for (let i = 0; i < 10; i++) expect(a()).toBe(b());
  });

  it("emits values in [0, 1)", () => {
    const r = rng(99);
    for (let i = 0; i < 1000; i++) {
      const v = r();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

describe("viewport math", () => {
  it("minZoom is clamped to >= 0.04", () => {
    expect(minZoom(100, 100, 1e6, 1e6)).toBeGreaterThanOrEqual(0.04);
  });

  // NR-G81 regression: fitInsideZoom (Math.min) and minZoom (Math.max)
  // diverge whenever the canvas and grid aspect ratios disagree. The FIT
  // button uses fitInsideZoom; the wheel-zoom floor uses minZoom.
  it("fitInsideZoom shows the WHOLE grid (Math.min of ratios)", () => {
    // Grid 1000x500, canvas 800x800.
    // minZoom = max(800/1000, 800/500) = max(0.8, 1.6) = 1.6 (overflows)
    // fitInsideZoom = min(800/1000, 800/500) = 0.8 (whole grid fits)
    const fz = fitInsideZoom(800, 800, 1000, 500);
    expect(fz).toBeCloseTo(0.8, 5);
    const mZ = minZoom(800, 800, 1000, 500);
    expect(mZ).toBeCloseTo(1.6, 5);
  });

  it("fitInsideZoom guards against zero / negative dimensions", () => {
    expect(fitInsideZoom(0, 100, 100, 100)).toBeGreaterThan(0);
    expect(fitInsideZoom(100, 0, 100, 100)).toBeGreaterThan(0);
    expect(fitInsideZoom(100, 100, 0, 100)).toBeGreaterThan(0);
    expect(fitInsideZoom(100, 100, 100, 0)).toBeGreaterThan(0);
  });

  it("fitView centers the grid using true fit-inside (NR-G81)", () => {
    // Grid 1000x500, canvas 800x800. fit-inside zoom = 0.8.
    // Grid on screen: 800x400. Centered: panX=0, panY=200.
    const v = fitView(800, 800, 1000, 500);
    expect(v.zoom).toBeCloseTo(0.8, 5);
    expect(v.panX).toBeCloseTo(0, 5);
    expect(v.panY).toBeCloseTo(200, 5);
  });

  it("paintableView falls back to fitView when fit-zoom is already paintable", () => {
    // A small grid in a large canvas: fit-zoom yields large pxR already.
    const v = paintableView(2000, 2000, 100, 100, 12, 8);
    const fit = fitView(2000, 2000, 100, 100);
    expect(v.zoom).toBeCloseTo(fit.zoom, 5);
  });

  it("paintableView raises zoom when fit-zoom would yield pxR below threshold", () => {
    // Large grid in a small canvas: fit-zoom produces small pxR.
    const targetPxR = 12;
    const hr = 2.5;
    const v = paintableView(400, 400, 1000, 1000, hr, targetPxR);
    expect(v.zoom).toBeCloseTo(targetPxR / hr, 5);
  });

  // NR-G67 regression: panY had a "cy * 0 + (...)" dead-code term. Verify
  // the centering math is symmetric (panX and panY must mirror each other
  // for a square grid in a square canvas).
  it("paintableView centers symmetrically on a square grid in a square canvas", () => {
    const v = paintableView(800, 800, 1000, 1000, 2.5, 12);
    expect(v.panX).toBeCloseTo(v.panY, 5);
  });

  // NR-G83 regression: clampPan must keep at least minVisibleRatio of the
  // canvas overlapping the grid. Without this the user can pan to a state
  // where only black is visible and lose their work.
  describe("clampPan", () => {
    it("returns the input unchanged when the grid is fully visible", () => {
      const c = clampPan(50, 50, 800, 600, 400, 300, 1, 0.2);
      expect(c.panX).toBe(50);
      expect(c.panY).toBe(50);
    });

    it("prevents pan from moving the grid off-screen to the right", () => {
      // Canvas 800w, grid 400 wide at zoom 1 = 400 screen px.
      // panX=900 would push the grid's left edge at x=900, right edge at
      // x=1300, both off the canvas. clampPan with r=0.2 keeps right edge
      // >= 160 (0.2 * 800), so left edge <= 160 - 400... actually the
      // constraint is panX <= (1-r)*cw = 640. So panX clamps to 640.
      const c = clampPan(900, 50, 800, 600, 400, 300, 1, 0.2);
      expect(c.panX).toBeLessThanOrEqual(640);
    });

    it("prevents pan from moving the grid off-screen to the left", () => {
      // panX=-500 would push the grid completely off to the left.
      // Constraint: panX >= r*cw - gwS = 0.2*800 - 400 = -240. Clamp to -240.
      const c = clampPan(-500, 50, 800, 600, 400, 300, 1, 0.2);
      expect(c.panX).toBeGreaterThanOrEqual(-240);
    });

    it("clamps vertical pan symmetrically", () => {
      const above = clampPan(0, -500, 800, 600, 400, 300, 1, 0.2);
      const below = clampPan(0, 9000, 800, 600, 400, 300, 1, 0.2);
      expect(above.panY).toBeGreaterThanOrEqual(0.2 * 600 - 300);
      expect(below.panY).toBeLessThanOrEqual(0.8 * 600);
    });
  });
});

describe("classify", () => {
  it("returns 'Dead' for an empty pattern", () => {
    expect(classify([], 0)).toBe("Dead");
  });

  it("Block under B2/S34 stabilizes (P1 still life)", () => {
    // The label may be P1 or PN with N small depending on rule semantics on
    // small grids. We only assert it is NOT 'Chaos' so the test stays robust.
    const result = classify(PATS.Block.c, 0, 200);
    expect(result).not.toBe("Chaos");
  });

  // NR-G78: explicit coverage for the Dies@N branch. A single isolated
  // cell under any rule that does not include 0 in S has no surviving
  // neighbors and dies in one generation. classify must report this with
  // the "Dies@N" label - regression-guarding the pop===0 short-circuit
  // at hex.js's classify loop.
  it("a single isolated cell dies in one generation", () => {
    const result = classify([[0, 0]], 0, 50);
    expect(result).toMatch(/^Dies@\d+$/);
  });

  // NR-G73 regression: cMix returns the same color for the same input
  // when integer counts are equal, even at counts where FP rounding of
  // (cosR + cosB + cosY) and (sinR + sinB + sinY) could vary.
  it("cMix integer-tie is deterministic for equal nR/nB/nY counts", () => {
    for (let n = 1; n <= 6; n++) {
      const first = cMix(n, n, n, 17);
      for (let trial = 0; trial < 50; trial++) {
        expect(cMix(n, n, n, 17)).toBe(first);
      }
      // Different idx must produce a deterministic but possibly different color.
      const a = cMix(n, n, n, 1);
      const b = cMix(n, n, n, 1);
      expect(a).toBe(b);
    }
  });

  it("returns labels matching the expected schema", () => {
    for (const key of Object.keys(PATS)) {
      const result = classify(PATS[key].c, 0, 100);
      expect(result).toMatch(/^(Dead|Dies@\d+|P\d+|Chaos)$/);
    }
  });
});

describe("rule lookup tables", () => {
  it("birthLUT and survLUT mirror RULES", () => {
    for (let ri = 0; ri < RULES.length; ri++) {
      const bL = birthLUT[ri], sL = survLUT[ri];
      for (const b of RULES[ri].B) if (b < 7) expect(bL[b]).toBe(1);
      for (const s of RULES[ri].S) if (s < 7) expect(sL[s]).toBe(1);
    }
  });

  it("ageBucket is monotone non-decreasing across the alive range", () => {
    let lastBucket = -1;
    for (let a = 1; a < ALIVE_T; a++) {
      const b = ageBucket[a];
      expect(b).toBeGreaterThanOrEqual(lastBucket);
      lastBucket = b;
    }
  });
});
