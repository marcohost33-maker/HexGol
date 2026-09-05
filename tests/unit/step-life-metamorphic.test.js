import { describe, expect, it } from "vitest";
import {
  stepLife,
  buildNeighbors,
  RMETA,
  oddRToCube,
  cubeToOddR,
} from "../../src/lib/sim-engine.js";

function runOne(R, C, NL, mask, col, opts = {}) {
  const N = R * C;
  const gh = new Uint8Array(N);
  const age = new Uint16Array(N);
  const nc = new Uint8Array(N);
  const ng = new Uint8Array(N);
  const na = new Uint16Array(N);
  stepLife({
    col: col.slice(), gh, age, nc, ng, na,
    NL, dmask: mask, meta: RMETA[0], colorMode: "mix",
    a1: false, a2: false, a3: false, a4: false,
    a5: "off", sysT: false, spN: 3, adia: false, tick: 1,
    ...opts,
  });
  return nc;
}

function shiftEvenRows(field, R, C, dr, dc) {
  if ((dr & 1) !== 0) throw new Error("odd-r translation test requires even row shift");
  const out = new Uint8Array(field.length);
  for (let r = 0; r < R; r++) for (let c = 0; c < C; c++) {
    const rr = (r + dr + R) % R;
    const cc = (c + dc + C) % C;
    out[rr * C + cc] = field[r * C + c];
  }
  return out;
}

function rotate60(c) {
  return { x: -c.z, y: -c.x, z: -c.y };
}

function rotateHexField(field, R, C) {
  const out = new Uint8Array(field.length);
  const center = oddRToCube((C - 1) / 2, (R - 1) / 2);
  for (let r = 0; r < R; r++) for (let c = 0; c < C; c++) {
    const value = field[r * C + c];
    if (value === 0) continue;
    const p = oddRToCube(c, r);
    const rel = { x: p.x - center.x, y: p.y - center.y, z: p.z - center.z };
    const rot = rotate60(rel);
    const q = cubeToOddR({ x: rot.x + center.x, y: rot.y + center.y, z: rot.z + center.z });
    if (q.row >= 0 && q.row < R && q.col >= 0 && q.col < C) out[q.row * C + q.col] = value;
  }
  return out;
}

describe("stepLife metamorphic invariants with explicit preconditions", () => {
  it("is translation-equivariant on a toroidal box for parity-preserving translations", () => {
    const R = 18, C = 20;
    const { torus, mask } = buildNeighbors(R, C, "box");
    const col = new Uint8Array(R * C);
    for (const [r, c] of [[2, 2], [2, 3], [3, 2], [8, 10], [9, 10], [9, 11], [14, 4]]) col[r * C + c] = 1;

    const dr = 2, dc = 3; // even dr preserves odd-r row parity
    const direct = runOne(R, C, torus, mask, col);
    const shiftedIn = shiftEvenRows(col, R, C, dr, dc);
    const shiftedOut = runOne(R, C, torus, mask, shiftedIn);

    expect(Array.from(shiftedOut)).toEqual(Array.from(shiftEvenRows(direct, R, C, dr, dc)));
  });

  it("is D6-rotation-equivariant for an isotropic totalistic rule on a hexagonal edge domain", () => {
    const R = 21, C = 21;
    const { edge, mask } = buildNeighbors(R, C, "hexagon");
    const col = new Uint8Array(R * C);
    for (const [r, c] of [[10, 10], [10, 11], [9, 10], [12, 8], [13, 8], [13, 9]]) col[r * C + c] = 1;

    const direct = runOne(R, C, edge, mask, col);
    const rotatedIn = rotateHexField(col, R, C);
    const rotatedOut = runOne(R, C, edge, mask, rotatedIn);

    expect(Array.from(rotatedOut)).toEqual(Array.from(rotateHexField(direct, R, C)));
  });

  it("documents a broken precondition: index-hashed A1 spontaneous seeding is not translation-equivariant", () => {
    const R = 30, C = 32;
    const { torus, mask } = buildNeighbors(R, C, "box");
    const empty = new Uint8Array(R * C);
    const dr = 2, dc = 5;

    const direct = runOne(R, C, torus, mask, empty, { a1: true, tick: 17 });
    const shiftedInput = shiftEvenRows(empty, R, C, dr, dc);
    const shiftedOut = runOne(R, C, torus, mask, shiftedInput, { a1: true, tick: 17 });

    expect(Array.from(shiftedOut)).not.toEqual(Array.from(shiftEvenRows(direct, R, C, dr, dc)));
  });
});
