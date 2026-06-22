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
import { OKABE_ITO, CVD_STYLE } from "../../src/lib/cell-style.js";

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
