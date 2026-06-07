import { describe, it, expect } from "vitest";
import { supportsOffscreenWorker } from "../../src/lib/worker-support.js";

// AP-1 Silent-Failure-Gate: Feature-Detection muss den NEGATIV-Fall sauber
// behandeln (fail-closed). Wir injizieren ein kuenstliches Globals-Objekt, um
// jede Browser-Kombination deterministisch ohne echtes DOM zu pruefen.

function fakeEnv({ offscreen = true, worker = true, transfer = true } = {}) {
  const env = {};
  if (offscreen) env.OffscreenCanvas = function OffscreenCanvas() {};
  if (worker) env.Worker = function Worker() {};
  env.HTMLCanvasElement = function HTMLCanvasElement() {};
  if (transfer) env.HTMLCanvasElement.prototype.transferControlToOffscreen = function () {};
  return env;
}

describe("supportsOffscreenWorker (feature detection, fail-closed)", () => {
  it("true when OffscreenCanvas + Worker + transferControlToOffscreen all present", () => {
    expect(supportsOffscreenWorker(fakeEnv())).toBe(true);
  });

  it("false when OffscreenCanvas is missing (old Safari)", () => {
    expect(supportsOffscreenWorker(fakeEnv({ offscreen: false }))).toBe(false);
  });

  it("false when Worker is missing", () => {
    expect(supportsOffscreenWorker(fakeEnv({ worker: false }))).toBe(false);
  });

  it("false when transferControlToOffscreen is missing", () => {
    expect(supportsOffscreenWorker(fakeEnv({ transfer: false }))).toBe(false);
  });

  it("false on a completely empty environment (no globals at all)", () => {
    expect(supportsOffscreenWorker({})).toBe(false);
  });

  it("false when HTMLCanvasElement exists but has no prototype.transfer", () => {
    const env = { OffscreenCanvas: function () {}, Worker: function () {}, HTMLCanvasElement: function () {} };
    expect(supportsOffscreenWorker(env)).toBe(false);
  });

  it("does not throw and returns boolean for a hostile env (getter throws)", () => {
    const env = {};
    Object.defineProperty(env, "OffscreenCanvas", { get() { throw new Error("boom"); } });
    const r = supportsOffscreenWorker(env);
    expect(typeof r).toBe("boolean");
    expect(r).toBe(false);
  });
});
