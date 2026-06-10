import { describe, it, expect } from "vitest";
import { shouldStartPan, isInsideDomain, decideCloseAction } from "../../src/lib/ui-gestures.js";

// Frame-pan hit-test (Marco bug 2026-06-09: touch in the black margin around the
// framed field must NOT start a pan / move the frame).
describe("shouldStartPan / isInsideDomain — frame hit-test", () => {
  // box-frame mask: all cells inside the rectangular grid are in-domain.
  const boxMask = new Uint8Array([1, 1, 1, 1]);
  // non-box mask (e.g. circle/hexagon): corner cells are OUTSIDE the frame.
  const circleMask = new Uint8Array([0, 1, 1, 0]);

  it("touch outside the grid (idx === -1) never pans", () => {
    expect(shouldStartPan(-1, boxMask)).toBe(false);
    expect(shouldStartPan(-1, null)).toBe(false);
  });

  it("touch on an in-domain cell pans", () => {
    expect(shouldStartPan(0, boxMask)).toBe(true);
    expect(shouldStartPan(1, circleMask)).toBe(true);
  });

  it("touch on an in-grid but out-of-frame cell (black corner) does NOT pan", () => {
    // circleMask: idx 0 and 3 are inside the rectangular grid but outside the
    // circle frame -> black corner -> frame must stay fixed.
    expect(shouldStartPan(0, circleMask)).toBe(false);
    expect(shouldStartPan(3, circleMask)).toBe(false);
  });

  it("null/absent mask treats any in-grid cell as inside (box default)", () => {
    expect(shouldStartPan(0, null)).toBe(true);
    expect(shouldStartPan(7, undefined)).toBe(true);
  });

  // --- STALE-MASK-GATE (iOS-Haertung 2026-06-10, Bug 2): eine Maske, deren Laenge
  // nicht zum aktuellen Gitter (gridLen=R*C) passt, ist stale -> fail closed.
  it("Maske mit falscher Laenge (stale, Frame-/Groessen-Wechsel) pant NICHT", () => {
    const staleMask = new Uint8Array(4).fill(1); // alte 2x2-Box-Maske, alle in-domain
    // Neues Gitter hat 9 Zellen (3x3) -> Laenge passt nicht -> kein Pan, obwohl
    // mask[idx]===1 (sonst wuerde der Rahmen faelschlich verschoben).
    expect(shouldStartPan(0, staleMask, 9)).toBe(false);
    expect(shouldStartPan(3, staleMask, 9)).toBe(false);
  });

  it("Maske mit passender Laenge (gridLen) pant normal", () => {
    const boxMask9 = new Uint8Array(9).fill(1);
    expect(shouldStartPan(0, boxMask9, 9)).toBe(true);
    expect(shouldStartPan(8, boxMask9, 9)).toBe(true);
  });

  it("null-Maske + gridLen pant normal (Box-Default, keine Maske noetig)", () => {
    expect(shouldStartPan(5, null, 9)).toBe(true); // box: keine Maske -> in-grid = inside
    expect(shouldStartPan(-1, null, 9)).toBe(false); // off-grid bleibt blockiert
  });

  // --- Silent-Failure-Gate: invalid / edge inputs must fail closed (no pan) ---
  it("NaN / non-integer / out-of-range indices fail closed", () => {
    expect(isInsideDomain(NaN, boxMask)).toBe(false);
    expect(isInsideDomain(1.5, boxMask)).toBe(false);
    expect(isInsideDomain(-2, boxMask)).toBe(false);
    expect(isInsideDomain(99, boxMask)).toBe(false); // beyond mask length (stale grid)
    expect(isInsideDomain(undefined, boxMask)).toBe(false);
  });
});

// Platform-honest close dispatch (Marco bug 2026-06-09: closing only showed an
// image instead of actually closing).
describe("decideCloseAction — platform-honest close", () => {
  it("standalone/installed app closes for real (no fallback image)", () => {
    expect(decideCloseAction({ standalone: true, historyLength: 1 })).toBe("close");
    expect(decideCloseAction({ standalone: true, historyLength: 5 })).toBe("close");
  });

  it("in-app launcher (history depth, not standalone) goes back", () => {
    expect(decideCloseAction({ standalone: false, historyLength: 3 })).toBe("back");
  });

  it("plain browser tab (no standalone, no history) shows honest fallback", () => {
    expect(decideCloseAction({ standalone: false, historyLength: 1 })).toBe("fallback");
    expect(decideCloseAction({ standalone: false, historyLength: 0 })).toBe("fallback");
  });

  // --- Silent-Failure-Gate: malformed env must not throw, must fail to fallback ---
  it("missing / malformed env defaults to fallback (never throws)", () => {
    expect(decideCloseAction(undefined)).toBe("fallback");
    expect(decideCloseAction(null)).toBe("fallback");
    expect(decideCloseAction({})).toBe("fallback");
    expect(decideCloseAction({ historyLength: NaN })).toBe("fallback");
  });
});
