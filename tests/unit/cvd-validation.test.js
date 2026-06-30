// CVD/WCAG validation oracle for the F10 colorblind-safe encoding.
// Binds rigorous, standards-based checks to the actual palette in cell-style.js:
//   1. WCAG 2.2 §1.4.11 non-text contrast >= 3:1 vs the real render background.
//   2. CVD distinguishability via the Machado et al. 2009 physiological model
//      (deuteranopia / protanopia / tritanopia, severity 1.0) — the correct
//      colour-vision-deficiency simulation (NOT a greyscale proxy).
//   3. Form-cue distinctness (WCAG §1.4.1): the three visible states differ by
//      (fill, stroke, hole) signature, so they are never distinguished by colour
//      alone — the guarantee that survives even total achromatopsia.
// Methodology: WCAG 2.2 1.4.11; Machado, Oliveira & Fernandes 2009; Okabe-Ito CUD.
import { describe, it, expect } from "vitest";
import {
  OKABE_ITO, CVD_STYLE, cellStyle,
  SPECIES_FAMILY, familyOf, familyColor, memberOf, DYING_NEUTRAL,
  formParams, GLYPH_MIN_PX, FORM_MIN_PX,
  GENE_CVD, cividisRGB, cividisCss,
} from "../../src/lib/cell-style.js";

const BG = "#0b0f14"; // App.tsx canvas background (T.bg)

const hex2rgb = (h) => {
  const n = h.replace("#", "");
  return [0, 2, 4].map((i) => parseInt(n.slice(i, i + 2), 16) / 255);
};
const lin = (c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const delin = (c) => {
  c = Math.min(1, Math.max(0, c));
  return c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055;
};
const relLum = (rgb) => { const r = rgb.map(lin); return 0.2126 * r[0] + 0.7152 * r[1] + 0.0722 * r[2]; };
const contrast = (a, b) => {
  const L1 = relLum(hex2rgb(a)), L2 = relLum(hex2rgb(b));
  const hi = Math.max(L1, L2), lo = Math.min(L1, L2);
  return (hi + 0.05) / (lo + 0.05);
};

// Machado et al. 2009 severity-1.0 matrices, applied to LINEAR rgb.
const MACHADO = {
  deuteranopia: [[0.367322, 0.860646, -0.227968], [0.280085, 0.672501, 0.047413], [-0.011820, 0.042940, 0.968881]],
  protanopia: [[0.152286, 1.052583, -0.204868], [0.114503, 0.786281, 0.099216], [-0.003882, -0.048116, 1.051998]],
  tritanopia: [[1.255528, -0.076749, -0.178779], [-0.078411, 0.930809, 0.147602], [0.004733, 0.691367, 0.303900]],
};
const simulate = (hex, kind) => {
  const r = hex2rgb(hex).map(lin), M = MACHADO[kind];
  return M.map((row) => delin(row[0] * r[0] + row[1] * r[1] + row[2] * r[2]));
};
// sRGB (hex string OR [r,g,b] floats in 0..1) -> CIE Lab (D65), for deltaE76.
const toLab = (srgb) => {
  const r = (typeof srgb === "string" ? hex2rgb(srgb) : srgb).map(lin);
  const X = 0.4124 * r[0] + 0.3576 * r[1] + 0.1805 * r[2];
  const Y = 0.2126 * r[0] + 0.7152 * r[1] + 0.0722 * r[2];
  const Z = 0.0193 * r[0] + 0.1192 * r[1] + 0.9505 * r[2];
  const xyz = [X / 0.95047, Y / 1.0, Z / 1.08883].map((v) => (v > 0.008856 ? Math.cbrt(v) : 7.787 * v + 16 / 116));
  return [116 * xyz[1] - 16, 500 * (xyz[0] - xyz[1]), 200 * (xyz[1] - xyz[2])];
};
const dE = (la, lb) => Math.hypot(la[0] - lb[0], la[1] - lb[1], la[2] - lb[2]);

// The three visible-state colours actually used by the encoding.
const STATE_COLOR = {
  survivor: CVD_STYLE.survivor.fill,
  newborn: CVD_STYLE.newborn.fill,
  dying: CVD_STYLE.dying.stroke,
};

describe("F10 palette is exactly Okabe-Ito (Quella-validated hex)", () => {
  it("uses the canonical Okabe-Ito values, not the erroneous Nature RGB table", () => {
    expect(OKABE_ITO.blue).toBe("#0072B2");
    expect(OKABE_ITO.orange).toBe("#E69F00");
    expect(OKABE_ITO.reddishPurple).toBe("#CC79A7");
    expect(STATE_COLOR.survivor).toBe("#0072B2");
    expect(STATE_COLOR.newborn).toBe("#E69F00");
    expect(STATE_COLOR.dying).toBe("#CC79A7");
  });
});

describe("WCAG 2.2 1.4.11 — non-text contrast >= 3:1 vs render bg", () => {
  for (const [name, color] of Object.entries(STATE_COLOR)) {
    it(`${name} (${color}) has >= 3:1 contrast against ${BG}`, () => {
      expect(contrast(color, BG)).toBeGreaterThanOrEqual(3);
    });
  }
});

describe("CVD distinguishability — Machado 2009, pairwise deltaE76 > 10", () => {
  const pairs = [["survivor", "newborn"], ["survivor", "dying"], ["newborn", "dying"]];
  for (const kind of ["deuteranopia", "protanopia", "tritanopia"]) {
    for (const [a, b] of pairs) {
      it(`${a} vs ${b} stay distinct under ${kind}`, () => {
        // simulate() returns sRGB (delinearised) -> let toLab linearise it (isLinear=false).
        const la = toLab(simulate(STATE_COLOR[a], kind));
        const lb = toLab(simulate(STATE_COLOR[b], kind));
        expect(dE(la, lb)).toBeGreaterThan(10);
      });
    }
  }
});

describe("WCAG 1.4.1 — never colour alone: form cues are pairwise distinct", () => {
  it("survivor/newborn/dying differ by (fill, stroke, hole) signature", () => {
    const sig = (s) => `${s.fill || "-"}|${s.stroke || "-"}|${s.hole ? 1 : 0}`;
    const sigs = ["survivor", "newborn", "dying"].map((k) => sig(CVD_STYLE[k]));
    expect(new Set(sigs).size).toBe(3); // all three distinct beyond colour
  });
  it("survivor is solid fill, newborn punches a hole, dying is ring-only", () => {
    expect(CVD_STYLE.survivor).toMatchObject({ fill: expect.any(String), stroke: null, hole: false });
    expect(CVD_STYLE.newborn).toMatchObject({ fill: expect.any(String), hole: true });
    expect(CVD_STYLE.dying).toMatchObject({ fill: null, stroke: expect.any(String) });
  });
});

// ===========================================================================
// F10-ext (#97/#101): species families + physics gradient + #101 refinements.
// ===========================================================================

const rgbDist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const relLumLin = (rgb01) => 0.2126 * rgb01[0] + 0.7152 * rgb01[1] + 0.0722 * rgb01[2];

describe("Species family mapping (familyOf / member, 12 → 6, deterministic)", () => {
  it("familyOf = floor((id-1)/2) for ids 1..12, -1 for dead/out-of-range", () => {
    const expected = [-1, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5]; // index = colorId 0..12
    for (let id = 0; id <= 12; id++) expect(familyOf(id)).toBe(expected[id]);
    expect(familyOf(13)).toBe(-1);
    expect(familyOf(-3)).toBe(-1);
    expect(familyOf(0)).toBe(-1);
    expect(familyOf(99)).toBe(-1);
  });
  it("memberOf splits the two species inside each family (A=odd id, B=even id)", () => {
    expect([1, 3, 5, 7, 9, 11].map(memberOf)).toEqual([0, 0, 0, 0, 0, 0]);
    expect([2, 4, 6, 8, 10, 12].map(memberOf)).toEqual([1, 1, 1, 1, 1, 1]);
    expect(memberOf(0)).toBe(-1);
    expect(memberOf(13)).toBe(-1);
  });
  it("familyColor returns the 6 family hexes; null for dead/invalid", () => {
    expect(SPECIES_FAMILY).toHaveLength(6);
    expect(familyColor(1)).toBe(SPECIES_FAMILY[0]);
    expect(familyColor(12)).toBe(SPECIES_FAMILY[5]);
    expect(familyColor(0)).toBeNull();
    expect(familyColor(99)).toBeNull();
  });
  it("Marco-Entscheid 2: family 0 (red) uses sky-blue, NOT vermillion", () => {
    expect(SPECIES_FAMILY[0]).toBe(OKABE_ITO.skyBlue);
    expect(SPECIES_FAMILY).not.toContain(OKABE_ITO.vermillion);
  });
});

describe("WCAG 2.2 1.4.11 — each of the 6 families >= 3:1 contrast vs render bg", () => {
  for (let f = 0; f < 6; f++) {
    it(`family ${f} (${SPECIES_FAMILY[f]}) has >= 3:1 contrast against ${BG}`, () => {
      expect(contrast(SPECIES_FAMILY[f], BG)).toBeGreaterThanOrEqual(3);
    });
  }
});

describe("CVD distinguishability — 6 families pairwise Machado deltaE76 > 10", () => {
  for (const kind of ["deuteranopia", "protanopia", "tritanopia"]) {
    for (let a = 0; a < 6; a++) {
      for (let b = a + 1; b < 6; b++) {
        it(`family ${a} vs ${b} stay distinct under ${kind}`, () => {
          const la = toLab(simulate(SPECIES_FAMILY[a], kind));
          const lb = toLab(simulate(SPECIES_FAMILY[b], kind));
          expect(dE(la, lb)).toBeGreaterThan(10);
        });
      }
    }
  }
});

describe("Gene field CVD palette (3 genotypes pairwise Machado-distinct)", () => {
  const genes = [GENE_CVD.AA, GENE_CVD.Aa, GENE_CVD.aa];
  it("avoids vermillion (deuteranopia warm-trio collapse)", () => {
    expect(genes).not.toContain(OKABE_ITO.vermillion);
  });
  for (const kind of ["deuteranopia", "protanopia", "tritanopia"]) {
    const pairs = [["AA", "Aa"], ["AA", "aa"], ["Aa", "aa"]];
    for (const [a, b] of pairs) {
      it(`${a} vs ${b} distinct under ${kind}`, () => {
        const la = toLab(simulate(GENE_CVD[a], kind));
        const lb = toLab(simulate(GENE_CVD[b], kind));
        expect(dE(la, lb)).toBeGreaterThan(10);
      });
    }
  }
});

describe("Physics gradient — cividis is CVD-safe by MONOTONIC LUMINANCE", () => {
  // The achromatopsia/greyscale guarantee for a continuous heatmap: value reads
  // off luminance alone iff luminance is strictly monotone along the ramp.
  it("luminance is strictly increasing across t = 0..1 (51 samples)", () => {
    let prev = -1;
    for (let k = 0; k <= 50; k++) {
      const t = k / 50;
      const lum = relLumLin(cividisRGB(t).map((c) => lin(c / 255)));
      expect(lum).toBeGreaterThan(prev);
      prev = lum;
    }
  });
  it("endpoints are canonical cividis (dark blue → bright yellow)", () => {
    expect(cividisRGB(0)).toEqual([0, 34, 78]);
    expect(cividisRGB(1)).toEqual([255, 234, 70]);
  });
  it("clamps out-of-range / NaN inputs (silent-failure gate)", () => {
    expect(cividisRGB(-5)).toEqual(cividisRGB(0));
    expect(cividisRGB(99)).toEqual(cividisRGB(1));
    expect(cividisRGB(NaN)).toEqual(cividisRGB(0));
    expect(cividisCss(0.5)).toMatch(/^rgb\(\d+,\d+,\d+\)$/);
  });
  it("consecutive cividis samples stay perceptually adjacent (no banding jumps)", () => {
    for (let k = 0; k < 50; k++) {
      const d = rgbDist(cividisRGB(k / 50), cividisRGB((k + 1) / 50));
      expect(d).toBeLessThan(80); // <80/441 max -> smooth ramp, no hard band
    }
  });
});

describe("#101-1 — min-pixel form-cue fallback (graceful degradation)", () => {
  it("modes switch at the documented pxR thresholds", () => {
    expect(formParams(12).mode).toBe("full");
    expect(formParams(6).mode).toBe("full");
    expect(formParams(5).mode).toBe("boosted");
    expect(formParams(FORM_MIN_PX).mode).toBe("boosted");
    expect(formParams(2).mode).toBe("colorOnly");
    expect(formParams(0).mode).toBe("colorOnly");
  });
  it("hole shrinks-then-drops while ring THICKENS as cells get smaller (robustness)", () => {
    const big = formParams(12), mid = formParams(4), tiny = formParams(2);
    // hole fraction grows when boosted (to stay visible), then collapses to 0
    expect(mid.holeScale).toBeGreaterThan(big.holeScale);
    expect(tiny.holeScale).toBe(0);
    // ring width monotonically non-decreasing as pxR shrinks
    expect(mid.ringWidthK).toBeGreaterThanOrEqual(big.ringWidthK);
    expect(tiny.ringWidthK).toBeGreaterThanOrEqual(mid.ringWidthK);
  });
  it("handles invalid pxR (negative / NaN) without throwing", () => {
    expect(formParams(-1).mode).toBe("colorOnly");
    expect(formParams(NaN).mode).toBe("colorOnly");
    expect(formParams(undefined).mode).toBe("colorOnly");
  });
  it("glyph threshold is above the form threshold (glyph is the highest-zoom tier)", () => {
    expect(GLYPH_MIN_PX).toBeGreaterThan(FORM_MIN_PX);
  });
});

describe("#101-2 — toggle atomicity: encoding is a stateless pure fn of the snapshot", () => {
  // A mid-sim CVD toggle cannot produce a torn frame because the per-cell encoding
  // holds NO state: it is a pure function of (colorId, age, ghost). Interleaving
  // cvd on/off calls in any order yields identical per-cell results -> the only
  // thing the toggle changes is the appearance of ONE consistent snapshot, never a
  // mix of two. (The render forces a full redraw on toggle; single-threaded JS
  // applies the config between frames, so a half-encoded frame is impossible.)
  it("familyOf / cellStyle give snapshot-identical results regardless of call order", () => {
    const snap = [0, 1, 4, 7, 12, 9, 3, 0, 11]; // a frozen colour snapshot
    const passA = snap.map((c) => `${familyOf(c)}|${cellStyle({ color: c, age: 2, ghost: 0 }, true).kind}`);
    // interleave a cvd=false call (the "toggle") between every cvd=true call
    const passB = snap.map((c) => {
      cellStyle({ color: c, age: 2, ghost: 0 }, false); // simulate a toggle flip mid-scan
      return `${familyOf(c)}|${cellStyle({ color: c, age: 2, ghost: 0 }, true).kind}`;
    });
    expect(passB).toEqual(passA);
  });
  it("cvd flag never leaks across cells (no shared mutable encoder state)", () => {
    // family of cell N must not depend on whether cell N-1 was encoded cvd or not
    const a = familyOf(5);
    cellStyle({ color: 9, age: 1, ghost: 0 }, true);
    cividisCss(0.3); formParams(2);
    expect(familyOf(5)).toBe(a);
  });
});

describe("Dying-ring family (Marco-Entscheid 3) wiring contract", () => {
  it("DYING_NEUTRAL is the documented Iter#1 fallback (reddish-purple)", () => {
    expect(DYING_NEUTRAL).toBe(OKABE_ITO.reddishPurple);
  });
  it("a dying cell with a recoverable last family resolves to that family colour", () => {
    // caller passes the last live colour-id from the persistent buffer
    expect(familyColor(9)).toBe(SPECIES_FAMILY[4]); // last-known blue species -> blue ring
    expect(familyColor(0) ?? DYING_NEUTRAL).toBe(DYING_NEUTRAL); // no history -> neutral
  });
});
