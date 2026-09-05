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

// odd-r offset coordinates are not invariant under an arbitrary row shift.
// An even row translation preserves row parity; with an even-height toroidal box
// the modulo seam preserves it too, making this an actual graph automorphism.
function translateEvenRows(field, R, C, dr, dc) {
  if ((dr & 1) !== 0 || (R & 1) !== 0) {
    throw new Error("translation oracle requires even dr and even torus height");
  }
  const out = new Uint8Array(field.length);
  for (let r = 0; r < R; r++) for (let c = 0; c < C; c++) {
    const rr = (r + dr + R) % R;
    const cc = (c + dc + C) % C;
    out[rr * C + cc] = field[r * C + c];
  }
  return out;
}

function transformHexField(field, R, C, cubeTransform) {
  if ((R & 1) === 0 || (C & 1) === 0) {
    throw new Error("D6 oracle requires an odd-sized, centered hex domain");
  }
  const out = new Uint8Array(field.length);
  const center = oddRToCube((C - 1) / 2, (R - 1) / 2);

  for (let r = 0; r < R; r++) for (let c = 0; c < C; c++) {
    const value = field[r * C + c];
    if (value === 0) continue;
    const p = oddRToCube(c, r);
    const rel = {
      x: p.x - center.x,
      y: p.y - center.y,
      z: p.z - center.z,
    };
    const moved = cubeTransform(rel);
    const q = cubeToOddR({
      x: moved.x + center.x,
      y: moved.y + center.y,
      z: moved.z + center.z,
    });
    if (q.row < 0 || q.row >= R || q.col < 0 || q.col >= C) {
      throw new Error("D6 transform escaped symmetric hex domain");
    }
    out[q.row * C + q.col] = value;
  }
  return out;
}

// Standard cube-coordinate D6 generators around the origin.
const ROTATE_60 = ({ x, y, z }) => ({ x: -z, y: -x, z: -y });
const REFLECT_YZ = ({ x, y, z }) => ({ x, y: z, z: y });

function seed(field, C, cells) {
  for (const [r, c, state = 1] of cells) field[r * C + c] = state;
  return field;
}

describe("stepLife conditional metamorphic invariants", () => {
  it("commutes with parity-preserving translation on an even toroidal box", () => {
    const R = 18, C = 20;
    const { torus, mask } = buildNeighbors(R, C, "box");
    const col = seed(new Uint8Array(R * C), C, [
      [2, 2], [2, 3], [3, 2], [8, 10], [9, 10], [9, 11], [14, 4],
    ]);
    const dr = 2, dc = 3;

    const direct = runOne(R, C, torus, mask, col);
    const transformedInput = translateEvenRows(col, R, C, dr, dc);
    const transformedOutput = runOne(R, C, torus, mask, transformedInput);

    expect(Array.from(transformedOutput)).toEqual(
      Array.from(translateEvenRows(direct, R, C, dr, dc)),
    );
  });

  it("commutes with 60-degree rotation for an isotropic rule on a symmetric hex domain", () => {
    const R = 21, C = 21;
    const { edge, mask } = buildNeighbors(R, C, "hexagon");
    const col = seed(new Uint8Array(R * C), C, [
      [10, 10], [10, 11], [9, 10], [12, 8], [13, 8], [13, 9],
    ]);

    const direct = runOne(R, C, edge, mask, col);
    const transformedInput = transformHexField(col, R, C, ROTATE_60);
    const transformedOutput = runOne(R, C, edge, mask, transformedInput);

    expect(Array.from(transformedOutput)).toEqual(
      Array.from(transformHexField(direct, R, C, ROTATE_60)),
    );
  });

  it("commutes with reflection for an isotropic rule on a symmetric hex domain", () => {
    const R = 21, C = 21;
    const { edge, mask } = buildNeighbors(R, C, "hexagon");
    const col = seed(new Uint8Array(R * C), C, [
      [10, 10], [9, 10], [8, 10], [12, 9], [12, 10], [13, 10],
    ]);

    const direct = runOne(R, C, edge, mask, col);
    const transformedInput = transformHexField(col, R, C, REFLECT_YZ);
    const transformedOutput = runOne(R, C, edge, mask, transformedInput);

    expect(Array.from(transformedOutput)).toEqual(
      Array.from(transformHexField(direct, R, C, REFLECT_YZ)),
    );
  });

  it("keeps a negative control: index-hashed A1 seeding breaks translation equivariance", () => {
    const R = 30, C = 32;
    const { torus, mask } = buildNeighbors(R, C, "box");
    const empty = new Uint8Array(R * C);
    const dr = 2, dc = 5;

    const direct = runOne(R, C, torus, mask, empty, { a1: true, tick: 17 });
    const transformedInput = translateEvenRows(empty, R, C, dr, dc);
    const transformedOutput = runOne(R, C, torus, mask, transformedInput, { a1: true, tick: 17 });

    expect(Array.from(transformedOutput)).not.toEqual(
      Array.from(translateEvenRows(direct, R, C, dr, dc)),
    );
  });
});
