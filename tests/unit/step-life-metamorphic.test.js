import { describe, expect, it } from "vitest";
import { stepLife, buildNeighbors, RMETA } from "../../src/lib/sim-engine.js";

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

function seed(field, C, cells) {
  for (const [r, c, state = 1] of cells) field[r * C + c] = state;
  return field;
}

describe("stepLife conditional translation invariant", () => {
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

  it("fails fast when the odd-r parity precondition is violated", () => {
    const R = 18, C = 20;
    const field = new Uint8Array(R * C);
    expect(() => translateEvenRows(field, R, C, 1, 0)).toThrow(/even dr/);
  });

  it("keeps a non-vacuous negative control: index-hashed A1 seeding breaks translation equivariance", () => {
    const R = 30, C = 32;
    const { torus, mask } = buildNeighbors(R, C, "box");
    const empty = new Uint8Array(R * C);
    const dr = 2, dc = 5;

    const direct = runOne(R, C, torus, mask, empty, { a1: true, tick: 17 });
    const transformedInput = translateEvenRows(empty, R, C, dr, dc);
    const transformedOutput = runOne(R, C, torus, mask, transformedInput, { a1: true, tick: 17 });

    expect(direct.some((value) => value !== 0)).toBe(true);
    expect(Array.from(transformedOutput)).not.toEqual(
      Array.from(translateEvenRows(direct, R, C, dr, dc)),
    );
  });
});
