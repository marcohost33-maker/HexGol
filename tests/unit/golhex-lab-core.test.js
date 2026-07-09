import { describe, expect, it } from "vitest";
import {
  buildHexPrismStack,
  collatzClassOdd,
  compareStates,
  explicitDiffusionDtMax,
  hashFloat64Bits,
  hashQuantizedState,
  hexDiskCellCount,
  hexPrismGeometry,
  stepConservativeDiffusion,
  totalContent,
  v2BigInt,
} from "../../src/lib/golhex-lab-core.js";

function centerIndex(world, layer = 0) {
  return world.indexByCoord.get(`0,0,${layer}`);
}

describe("GolHex Lab — exact integer layers", () => {
  it("computes v2 and exact Collatz classes with BigInt", () => {
    expect(v2BigInt(40n)).toBe(3);
    expect(collatzClassOdd(1n)).toBe(2);
    expect(collatzClassOdd(3n)).toBe(1);
    expect(collatzClassOdd(5n)).toBe(4);
    expect(collatzClassOdd(7n)).toBe(1);
    expect(collatzClassOdd(9n)).toBe(2);
    expect(collatzClassOdd(13n)).toBe(3);
    expect(() => collatzClassOdd(4n)).toThrow(/positive odd/);
  });

  it("accepts exact large integer strings and rejects unsafe Number inputs", () => {
    expect(collatzClassOdd("9007199254740993")).toBe(2);
    expect(() => collatzClassOdd(Number.MAX_SAFE_INTEGER + 2)).toThrow(/safe integer/);
  });
});

describe("GolHex Lab — dense axial prism stack", () => {
  it("uses the exact hex-disk count", () => {
    expect(hexDiskCellCount(0)).toBe(1);
    expect(hexDiskCellCount(2)).toBe(19);
    expect(hexDiskCellCount(4)).toBe(61);
    expect(buildHexPrismStack({ radius: 4, layers: 3 }).count).toBe(183);
  });

  it("has six lateral neighbors and, in a middle layer, two vertical neighbors", () => {
    const one = buildHexPrismStack({ radius: 2, layers: 1 });
    const c1 = centerIndex(one);
    expect(Array.from(one.neighbors.slice(c1 * 8, c1 * 8 + 8)).filter((x) => x >= 0)).toHaveLength(6);

    const three = buildHexPrismStack({ radius: 2, layers: 3 });
    const c3 = centerIndex(three, 1);
    expect(Array.from(three.neighbors.slice(c3 * 8, c3 * 8 + 8)).filter((x) => x >= 0)).toHaveLength(8);
  });
});

describe("GolHex Lab — prism geometry and conservative transport", () => {
  it("derives finite-volume geometry from edge length and height", () => {
    const g = hexPrismGeometry({ edgeLength: 2, height: 3 });
    expect(g.baseArea).toBeCloseTo(6 * Math.sqrt(3), 14);
    expect(g.volume).toBeCloseTo(18 * Math.sqrt(3), 14);
    expect(g.lateralFaceArea).toBe(6);
    expect(g.lateralCenterDistance).toBeCloseTo(2 * Math.sqrt(3), 14);
    expect(g.verticalCenterDistance).toBe(3);
  });

  it("preserves total content and sixfold symmetry for a center impulse", () => {
    const world = buildHexPrismStack({ radius: 2, layers: 1 });
    const geometry = hexPrismGeometry({ edgeLength: 1, height: 1 });
    const field = new Float64Array(world.count);
    const center = centerIndex(world);
    field[center] = 1;
    const before = totalContent(field, geometry.volume);
    const dtMax = explicitDiffusionDtMax({ world, geometry, diffusivity: 0.25 });
    const { out } = stepConservativeDiffusion({
      world, geometry, field, diffusivity: 0.25, dt: dtMax * 0.25,
    });
    const after = totalContent(out, geometry.volume);
    expect(after).toBeCloseTo(before, 14);
    expect(Math.min(...out)).toBeGreaterThanOrEqual(-1e-15);

    const lateral = Array.from(world.neighbors.slice(center * 8, center * 8 + 6)).map((i) => out[i]);
    lateral.forEach((value) => expect(value).toBeCloseTo(lateral[0], 14));
    expect(out[center]).toBeLessThan(1);
  });

  it("uses the derived vertical/lateral conductance ratio and remains conservative in 3D", () => {
    const world = buildHexPrismStack({ radius: 1, layers: 3 });
    const geometry = hexPrismGeometry({ edgeLength: 1, height: 1 });
    const field = new Float64Array(world.count);
    const center = centerIndex(world, 1);
    field[center] = 1;
    const before = totalContent(field, geometry.volume);
    const dtMax = explicitDiffusionDtMax({ world, geometry, diffusivity: 0.1 });
    const { out } = stepConservativeDiffusion({
      world, geometry, field, diffusivity: 0.1, dt: dtMax * 0.1,
    });
    expect(totalContent(out, geometry.volume)).toBeCloseTo(before, 14);

    const base = center * 8;
    const lateralValue = out[world.neighbors[base]];
    const belowValue = out[world.neighbors[base + 6]];
    const aboveValue = out[world.neighbors[base + 7]];
    expect(aboveValue).toBeCloseTo(belowValue, 14);
    expect(aboveValue / lateralValue).toBeCloseTo(
      geometry.verticalGeometricConductance / geometry.lateralGeometricConductance,
      13,
    );
  });

  it("fails closed for an explicit step above the positivity bound", () => {
    const world = buildHexPrismStack({ radius: 1, layers: 1 });
    const geometry = hexPrismGeometry({ edgeLength: 1, height: 1 });
    const field = new Float64Array(world.count);
    const dtMax = explicitDiffusionDtMax({ world, geometry, diffusivity: 1 });
    expect(() => stepConservativeDiffusion({ world, geometry, field, diffusivity: 1, dt: dtMax * 1.001 }))
      .toThrow(/positivity bound/);
  });

  it("reports differences and stable fingerprints", () => {
    const a = new Float64Array([0, 1, 2]);
    const b = new Float64Array([0, 1 + 1e-13, 2]);
    expect(compareStates(a, b).maxAbs).toBeGreaterThan(0);
    expect(hashFloat64Bits(a)).toBe(hashFloat64Bits(a.slice()));
    expect(hashQuantizedState(a, 1e-12)).toBe(hashQuantizedState(b, 1e-12));
  });

  it("fails closed for non-finite comparisons and unsafe quantisation ranges", () => {
    expect(() => compareStates(new Float64Array([Number.NaN]), new Float64Array([0])))
      .toThrow(/not finite/);
    expect(() => hashQuantizedState(new Float64Array([1e12]), 1e-12))
      .toThrow(/safe-integer range/);
  });
});
