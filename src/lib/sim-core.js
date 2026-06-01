// HQST-Kern — extrahiert aus App.tsx (2026-06-01), unit-getestet.
// Hexagonaler Tight-Binding-Operator + Crank-Nicolson-Integrator (Cayley-Form,
// unitaer/normerhaltend). Reine Funktionen ohne React/DOM. App.tsx IMPORTIERT
// diese (Single Source — kein Copy-Drift); Tests in tests/unit/sim-core.test.js.

// Tight-Binding-Hamiltonoperator: H psi = -J * sum_nachbarn + V * psi  (Grad-6-Hex).
// NL[i*6 .. i*6+5] = Nachbar-Indizes (oder <0 ausserhalb der Domaene/Wand).
export function applyH(re, im, NL, J, V, hRe, hIm) {
  const n = re.length;
  for (let i = 0; i < n; i++) {
    const b = i * 6; let sre = 0, sim = 0;
    for (let k = 0; k < 6; k++) { const j = NL[b + k]; if (j >= 0) { sre += re[j]; sim += im[j]; } }
    hRe[i] = -J * sre + V * re[i]; hIm[i] = -J * sim + V * im[i];
  }
}

// Crank-Nicolson (Cayley-Form, UNITAER): (I + i*a*H) x = b, a = dt/2, geloest per
// Fixpunkt-Iteration. Konvergenz garantiert bei Spektralradius a*||H|| < 1
// (||H|| ~ 6*J fuers Hex-Tight-Binding). TOL=2e-6 ist Float32-gerecht (1e-10 lag
// unter dem Float32-Rausch-Boden ~1e-7 -> Iteration konvergierte nie, lief alle
// 60 Iterationen). Rueckgabe false = Nicht-Konvergenz (Parameter zu gross).
export function solveCN(re, im, NL, J, V, dt, reBuf, imBuf, work) {
  const n = re.length, a = dt / 2;
  const bRe = work.bRe, bIm = work.bIm, hRe = work.hRe, hIm = work.hIm;
  applyH(re, im, NL, J, V, hRe, hIm);
  for (let i = 0; i < n; i++) { bRe[i] = re[i] + a * hIm[i]; bIm[i] = im[i] - a * hRe[i]; }
  let xRe = reBuf, xIm = imBuf;
  for (let i = 0; i < n; i++) { xRe[i] = bRe[i]; xIm[i] = bIm[i]; }
  const MAXIT = 60, TOL = 2e-6; let conv = false;
  for (let it = 0; it < MAXIT; it++) {
    applyH(xRe, xIm, NL, J, V, hRe, hIm);
    let maxd = 0;
    for (let i = 0; i < n; i++) {
      const nxRe = bRe[i] + a * hIm[i], nxIm = bIm[i] - a * hRe[i];
      const d = Math.abs(nxRe - xRe[i]) + Math.abs(nxIm - xIm[i]); if (d > maxd) maxd = d;
      xRe[i] = nxRe; xIm[i] = nxIm;
    }
    if (maxd < TOL) { conv = true; break; }
  }
  return conv;
}
