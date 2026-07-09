import { describe, expect, it } from "vitest";
import {
  buildHexPrismStack,
  compareStates,
  hexPrismGeometry,
  stepConservativeDiffusion,
  totalContent,
} from "../../src/lib/golhex-lab-core.js";

function runExplicit({ world, geometry, initial, diffusivity, finalTime, steps, sourceAt = null }) {
  const dt = finalTime / steps;
  let state = initial.slice();
  for (let n = 0; n < steps; n++) {
    const source = sourceAt ? sourceAt(n * dt) : null;
    state = stepConservativeDiffusion({
      world,
      geometry,
      field: state,
      diffusivity,
      dt,
      source,
    }).out;
  }
  return state;
}

function observedOrder(coarseError, fineError) {
  return Math.log(coarseError / fineError) / Math.log(2);
}

describe("GolHex H1 topology verification fixtures", () => {
  it("has reciprocal, unique, non-self neighbours", () => {
    const world = buildHexPrismStack({ radius: 4, layers: 3 });
    for (let i = 0; i < world.count; i++) {
      const listed = Array.from(world.neighbors.slice(i * 8, i * 8 + 8)).filter((j) => j >= 0);
      expect(new Set(listed).size).toBe(listed.length);
      expect(listed).not.toContain(i);
      for (const j of listed) {
        const reverse = Array.from(world.neighbors.slice(j * 8, j * 8 + 8));
        expect(reverse).toContain(i);
      }
    }
  });
});

describe("GolHex H1 scalar diffusion verification fixtures", () => {
  it("keeps a constant field invariant", () => {
    const world = buildHexPrismStack({ radius: 4, layers: 3 });
    const geometry = hexPrismGeometry({ edgeLength: 0.02, height: 0.015 });
    const field = new Float64Array(world.count).fill(7.25);
    const before = totalContent(field, geometry.volume);
    const { out } = stepConservativeDiffusion({
      world,
      geometry,
      field,
      diffusivity: 0.003,
      dt: 0.001,
    });
    expect(compareStates(field, out).maxAbs).toBe(0);
    expect(totalContent(out, geometry.volume)).toBe(before);
  });

  it("shows first-order time convergence against the analytic two-cell solution", () => {
    const world = buildHexPrismStack({ radius: 0, layers: 2 });
    const geometry = hexPrismGeometry({ edgeLength: 1, height: 1 });
    const diffusivity = 0.2;
    const finalTime = 1;
    const initial = new Float64Array([1, 0]);
    const couplingRate = diffusivity * geometry.verticalGeometricConductance / geometry.volume;
    const exactDifference = Math.exp(-2 * couplingRate * finalTime);
    const exact = new Float64Array([
      0.5 + 0.5 * exactDifference,
      0.5 - 0.5 * exactDifference,
    ]);

    const errors = [20, 40, 80].map((steps) => compareStates(
      runExplicit({ world, geometry, initial, diffusivity, finalTime, steps }),
      exact,
    ).l2);

    expect(errors[1]).toBeLessThan(errors[0]);
    expect(errors[2]).toBeLessThan(errors[1]);
    expect(observedOrder(errors[0], errors[1])).toBeGreaterThan(0.9);
    expect(observedOrder(errors[0], errors[1])).toBeLessThan(1.1);
    expect(observedOrder(errors[1], errors[2])).toBeGreaterThan(0.9);
    expect(observedOrder(errors[1], errors[2])).toBeLessThan(1.1);
  });

  it("shows first-order convergence for a manufactured time-dependent field", () => {
    const world = buildHexPrismStack({ radius: 1, layers: 1 });
    const geometry = hexPrismGeometry({ edgeLength: 1, height: 1 });
    const diffusivity = 0.15;
    const finalTime = 0.5;
    const offset = 5;
    const g = new Float64Array(world.count);
    for (let i = 0; i < world.count; i++) g[i] = 0.2 * world.q[i] - 0.15 * world.r[i] + 0.05 * i;

    const exactAt = (time) => {
      const decay = Math.exp(-time);
      const result = new Float64Array(world.count);
      for (let i = 0; i < world.count; i++) result[i] = offset + decay * g[i];
      return result;
    };

    const sourceAt = (time) => {
      const exact = exactAt(time);
      // Applying one algebraic dt=1 step and subtracting the input yields L(exact).
      // Stability is irrelevant here because no iterative advancement is performed.
      const operatorApplied = stepConservativeDiffusion({
        world,
        geometry,
        field: exact,
        diffusivity,
        dt: 1,
        enforceStableStep: false,
      }).out;
      const source = new Float64Array(world.count);
      const decay = Math.exp(-time);
      for (let i = 0; i < world.count; i++) {
        const spatialRate = operatorApplied[i] - exact[i];
        const exactDerivative = -decay * g[i];
        source[i] = exactDerivative - spatialRate;
      }
      return source;
    };

    const initial = exactAt(0);
    const exactFinal = exactAt(finalTime);
    const errors = [20, 40, 80].map((steps) => compareStates(
      runExplicit({ world, geometry, initial, diffusivity, finalTime, steps, sourceAt }),
      exactFinal,
    ).rms);

    expect(errors[1]).toBeLessThan(errors[0]);
    expect(errors[2]).toBeLessThan(errors[1]);
    expect(observedOrder(errors[0], errors[1])).toBeGreaterThan(0.85);
    expect(observedOrder(errors[0], errors[1])).toBeLessThan(1.15);
    expect(observedOrder(errors[1], errors[2])).toBeGreaterThan(0.85);
    expect(observedOrder(errors[1], errors[2])).toBeLessThan(1.15);
  });
});
