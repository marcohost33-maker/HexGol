import { describe, it, expect } from "vitest";
import {
  buildNeighbors, circleGridDims, GRID_SIZES,
  CELL_CAP, CIRCLE_CELL_CAP, MAX_CIRCLE_RADIUS, DEFAULT_CIRCLE_RADIUS, HQST_CELL_CAP,
} from "../../src/lib/sim-engine.js";

// AP-2: Maximal-Groessen + expliziter Kreis-Radius. Inklusive Negativ-/Edge-Inputs
// (Silent-Failure-Gate): radius<=0, NaN, > Maximum werden fail-closed behandelt.

describe("AP-2 GRID_SIZES Ausbau bis 500x500", () => {
  it("enthaelt eine 500x500-Stufe (250'000 Zellen)", () => {
    const max = GRID_SIZES[GRID_SIZES.length - 1];
    expect(max.rows).toBe(500);
    expect(max.cols).toBe(500);
    expect(max.rows * max.cols).toBe(250000);
  });
  it("alle Stufen monoton wachsend in Zellzahl", () => {
    for (let i = 1; i < GRID_SIZES.length; i++) {
      const prev = GRID_SIZES[i - 1].rows * GRID_SIZES[i - 1].cols;
      const cur = GRID_SIZES[i].rows * GRID_SIZES[i].cols;
      expect(cur).toBeGreaterThan(prev);
    }
  });
  it("Quadrat-Maximum == CELL_CAP", () => {
    const max = GRID_SIZES[GRID_SIZES.length - 1];
    expect(max.rows * max.cols).toBe(CELL_CAP);
  });
});

describe("AP-2 Caps + Marco-Vorgaben", () => {
  it("Default-Kreis-Radius=250, Max=500", () => {
    expect(DEFAULT_CIRCLE_RADIUS).toBe(250);
    expect(MAX_CIRCLE_RADIUS).toBe(500);
  });
  it("HQST_CELL_CAP < CELL_CAP (HQST faengt frueher zu sperren an)", () => {
    expect(HQST_CELL_CAP).toBeLessThan(CELL_CAP);
  });
});

describe("AP-2 circleGridDims (Bounding-Gitter aus explizitem Radius)", () => {
  it("r=250 (Default) liefert ein Gitter, das den Kreis traegt", () => {
    const d = circleGridDims(250);
    expect(d.radius).toBe(250);
    expect(d.rows).toBe(2 * 250 + 1);
    expect(d.rows * d.cols).toBeLessThanOrEqual(CIRCLE_CELL_CAP);
  });
  it("r=500 (Max) Bounding-Box <= CIRCLE_CELL_CAP", () => {
    const d = circleGridDims(500);
    expect(d.radius).toBe(500);
    expect(d.rows * d.cols).toBeLessThanOrEqual(CIRCLE_CELL_CAP);
  });
  it("klemmt r > MAX_CIRCLE_RADIUS auf das Maximum (fail-closed)", () => {
    expect(circleGridDims(9999).radius).toBe(MAX_CIRCLE_RADIUS);
  });
  it("Edge: r<=0 / NaN -> mindestens 1 (kein 0-Gitter, kein Crash)", () => {
    expect(circleGridDims(0).radius).toBe(1);
    expect(circleGridDims(-50).radius).toBe(1);
    expect(circleGridDims(NaN).radius).toBe(1);
  });
});

describe("AP-2 buildNeighbors mit explizitem Kreis-Radius (opts)", () => {
  it("rueckwaerts-kompatibel: ohne opts == eingeschriebenes Maximum", () => {
    const a = buildNeighbors(41, 41, "circle");
    const b = buildNeighbors(41, 41, "circle", {});
    expect(b.inCount).toBe(a.inCount);
  });
  it("kleinerer expliziter Radius -> weniger In-Domaenen-Zellen", () => {
    const big = buildNeighbors(81, 81, "circle"); // max eingeschrieben
    const small = buildNeighbors(81, 81, "circle", { circleRadius: 10 });
    expect(small.inCount).toBeGreaterThan(0);
    expect(small.inCount).toBeLessThan(big.inCount);
  });
  it("Edge: circleRadius ueber Maximum klemmt auf eingeschriebenes Maximum", () => {
    const clamped = buildNeighbors(41, 41, "circle", { circleRadius: 99999 });
    const max = buildNeighbors(41, 41, "circle");
    expect(clamped.inCount).toBe(max.inCount);
  });
  it("Edge: circleRadius<=0 / NaN -> faellt auf Maximum zurueck (kein leeres Gitter)", () => {
    const zero = buildNeighbors(41, 41, "circle", { circleRadius: 0 });
    const nan = buildNeighbors(41, 41, "circle", { circleRadius: NaN });
    const max = buildNeighbors(41, 41, "circle");
    expect(zero.inCount).toBe(max.inCount);
    expect(nan.inCount).toBe(max.inCount);
  });
  it("500x500 box instanziiert (Maske voll, kein Crash)", () => {
    const nb = buildNeighbors(500, 500, "box");
    expect(nb.inCount).toBe(250000);
    expect(nb.mask.length).toBe(250000);
  });
  it("Kreis r=500 instanziiert + Scheibe nicht leer", () => {
    const d = circleGridDims(500);
    const nb = buildNeighbors(d.rows, d.cols, "circle", { circleRadius: 500 });
    expect(nb.inCount).toBeGreaterThan(500000); // ~680k gemessen
    expect(nb.inCount).toBeLessThan(d.rows * d.cols); // < Bounding-Box
  });
});
