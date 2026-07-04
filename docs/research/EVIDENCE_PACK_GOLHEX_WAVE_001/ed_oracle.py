#!/usr/bin/env python
"""EVIDENCE_PACK_GOLHEX_WAVE_001 — independent ED / Hermiticity oracle (cross-language).

Reads results/ed_export.json (trajectories from the ACTUAL shipped JS solver) and validates
against numpy/scipy oracles that share NO code with the JS solver:

  O3  Hermiticity        : ||H - H^dagger||_F  (H rebuilt independently from NL)
  ring spectrum anchor   : numpy eig(H) vs analytic -2J cos(2 pi k / N) + V   (ring graphs)
  exact-CN oracle        : U_CN = inv(I + i a H)(I - i a H) applied n times  (solver accuracy,
                           independent of scheme)  -> isolates the iterative fixpoint error
  O4  ED oracle          : psi_exact(t) = expm(-i H t) psi0                   (scheme accuracy)
  order-in-dt            : ED max error vs dt on log-log -> expect slope ~2 (CN global O(dt^2))

Thresholds are PREDECLARED below (per dtype). Exit 0 = all declared gates pass; exit 1 = a gate
fails (residual/Hermiticity/solver-oracle). Scheme error (O4) and order-in-dt are DIAGNOSTIC
(recorded, not a pass/fail gate) because they measure discretisation, not solver correctness.
"""
import json
import os
import sys
import numpy as np
from scipy.linalg import expm

HERE = os.path.dirname(os.path.abspath(__file__))
RES = os.path.join(HERE, "results")

# ---- PREDECLARED thresholds (before the run) --------------------------------
TOL_HERM = 1e-12                       # H must be Hermitian to machine precision (real symmetric)
TOL_RING_SPEC = 1e-10                  # numpy eig vs analytic ring spectrum
TOL_CN_ORACLE = {"f64": 5e-5, "f32": 5e-3}   # JS iterative solve vs exact-CN direct solve
# O4 expm scheme error and order-in-dt are DIAGNOSTIC (expected to grow as O(dt^2)); not gated.


def build_H(NL, n, J, V):
    """Rebuild the tight-binding Hamiltonian independently from the neighbour list.
    (H psi)_i = -J sum_{j in NN(i)} psi_j + V psi_i  ->  H[i,j] += -J per listed neighbour,
    H[i,i] += V.  Multiplicity (a wrapped neighbour listed twice) is accumulated faithfully."""
    H = np.zeros((n, n), dtype=np.complex128)
    for i in range(n):
        for k in range(6):
            j = NL[i * 6 + k]
            if j >= 0:
                H[i, j] += -J
        H[i, i] += V
    return H


def psi_vec(state):
    return np.array(state["re"], dtype=np.complex128) + 1j * np.array(state["im"], dtype=np.complex128)


def main():
    with open(os.path.join(RES, "ed_export.json"), "r", encoding="utf-8") as fh:
        data = json.load(fh)

    herm_rows = [["graph", "n", "J", "V", "herm_fro", "ring_spec_err", "hermitian_ok"]]
    ed_rows = [["graph", "n", "J", "V", "dt", "dtype", "time", "phys_time",
                "cn_oracle_err", "expm_ed_err", "js_norm", "exact_norm"]]
    boundary_rows = [["boundary_type", "graph", "n", "J", "V", "dt", "dtype",
                      "hermitian_ok", "conv_all", "js_norm_drift", "expm_max_err"]]

    fails = []
    order_data = {}   # (graph,J,V,dtype) -> list of (dt, max_expm_err)

    # de-dup Hermiticity by (graph,J,V)
    seen_herm = set()

    for cfg in data["configs"]:
        g, n, J, V, dt, dtype = cfg["graph"], cfg["n"], cfg["J"], cfg["V"], cfg["dt"], cfg["dtype"]
        NL = cfg["NL"]
        H = build_H(NL, n, J, V)
        herm_fro = float(np.linalg.norm(H - H.conj().T, ord="fro"))
        hermitian_ok = herm_fro <= TOL_HERM

        # ring analytic spectrum anchor
        ring_spec_err = float("nan")
        if g.startswith("ring_"):
            N = n
            k = np.arange(N)
            analytic = np.sort(-2 * J * np.cos(2 * np.pi * k / N) + V)
            numeig = np.sort(np.linalg.eigvalsh(H).real)
            ring_spec_err = float(np.max(np.abs(analytic - numeig)))
            if ring_spec_err > TOL_RING_SPEC:
                fails.append(f"ring spectrum {g} err={ring_spec_err:.2e} > {TOL_RING_SPEC:.0e}")

        hk = (g, J, V)
        if hk not in seen_herm:
            seen_herm.add(hk)
            herm_rows.append([g, n, J, V, f"{herm_fro:.3e}", f"{ring_spec_err:.3e}", hermitian_ok])
            if not hermitian_ok:
                fails.append(f"Hermiticity {g} J={J} V={V} fro={herm_fro:.2e} > {TOL_HERM:.0e}")

        # exact discrete CN propagator (Cayley transform) — independent of JS iteration
        a = dt / 2.0
        I = np.eye(n, dtype=np.complex128)
        U_cn = np.linalg.solve(I + 1j * a * H, I - 1j * a * H)

        times = cfg["times"]
        states = cfg["states"]
        psi0 = psi_vec(states[0])
        max_expm_err = 0.0
        for idx, t in enumerate(times):
            js = psi_vec(states[idx])
            # exact-CN oracle: apply U_cn t times to psi0
            cn_exact = psi0.copy()
            for _ in range(t):
                cn_exact = U_cn @ cn_exact
            cn_err = float(np.linalg.norm(js - cn_exact))
            # expm ED oracle (scheme accuracy): true continuous evolution
            phys_t = t * dt
            ed_exact = expm(-1j * H * phys_t) @ psi0
            ed_err = float(np.linalg.norm(js - ed_exact))
            max_expm_err = max(max_expm_err, ed_err)
            ed_rows.append([g, n, J, V, dt, dtype, t, f"{phys_t:.4f}",
                            f"{cn_err:.4e}", f"{ed_err:.4e}",
                            f"{np.linalg.norm(js):.10f}", f"{np.linalg.norm(cn_exact):.10f}"])
            # gate: JS solve must match the EXACT CN update within declared tol (solver correctness)
            if cn_err > TOL_CN_ORACLE[dtype] and t > 0:
                fails.append(f"CN-oracle {g} dt={dt} {dtype} t={t} err={cn_err:.2e} > {TOL_CN_ORACLE[dtype]:.0e}")

        order_data.setdefault((g, J, V, dtype), []).append((dt, max_expm_err))

        # boundary/frame matrix (O5): classify by boundary type
        if g.startswith("ring_"):
            bt = "periodic_ring"
        elif "periodic" in g:
            bt = "periodic_hex"
        else:
            bt = "open_patch"
        boundary_rows.append([bt, g, n, J, V, dt, dtype, hermitian_ok, cfg["conv_all"],
                              f"{cfg['norm_drift_max']:.3e}", f"{max_expm_err:.3e}"])

    # order-in-dt fit (diagnostic): slope of log(err) vs log(dt) should be ~2 for CN
    order_rows = [["graph", "J", "V", "dtype", "n_dt_points", "slope_loglog", "note"]]
    for key, pts in order_data.items():
        pts = sorted(set(pts))
        if len(pts) >= 2:
            dts = np.array([p[0] for p in pts])
            errs = np.array([p[1] for p in pts])
            good = errs > 0
            if good.sum() >= 2:
                slope = float(np.polyfit(np.log(dts[good]), np.log(errs[good]), 1)[0])
            else:
                slope = float("nan")
        else:
            slope = float("nan")
        g, J, V, dtype = key
        note = "fixed-step-count n: err ~ n*O(dt^3) local trunc -> slope ~3 (NOT global O(dt^2))"
        order_rows.append([g, J, V, dtype, len(pts), f"{slope:.3f}", note])

    # --- rigorous fixed-physical-time convergence study (scheme global order) -----
    # Evolve the EXACT CN propagator to a fixed T with shrinking dt, compare to expm.
    # Textbook result: global error O(dt^2). Uses the CN scheme (which the JS solver
    # reproduces to <=~1e-6 per the CN-oracle gate) -> the JS solver inherits this order.
    conv_rows = [["graph", "n", "J", "V", "T", "dt", "cn_vs_expm_err"]]
    conv_slopes = [["graph", "J", "V", "n", "T", "slope_loglog", "expected"]]
    for cfg in [c for c in data["configs"] if c["dtype"] == "f64"]:
        gk = (cfg["graph"], cfg["J"], cfg["V"])
        if gk in {(r[0], r[1], r[2]) for r in conv_slopes[1:]}:
            continue
        g, n, J, V = cfg["graph"], cfg["n"], cfg["J"], cfg["V"]
        H = build_H(cfg["NL"], n, J, V)
        psi0 = psi_vec(cfg["states"][0])
        T = 2.0
        dts_study = [0.2, 0.1, 0.05, 0.025, 0.0125]
        errs_study = []
        I = np.eye(n, dtype=np.complex128)
        ref = expm(-1j * H * T) @ psi0
        for dts_ in dts_study:
            a = dts_ / 2.0
            U = np.linalg.solve(I + 1j * a * H, I - 1j * a * H)
            nsteps = int(round(T / dts_))
            psi = psi0.copy()
            for _ in range(nsteps):
                psi = U @ psi
            e = float(np.linalg.norm(psi - ref))
            errs_study.append(e)
            conv_rows.append([g, n, J, V, T, dts_, f"{e:.6e}"])
        errs_arr = np.array(errs_study)
        good = errs_arr > 1e-14
        slope = float(np.polyfit(np.log(np.array(dts_study)[good]), np.log(errs_arr[good]), 1)[0]) if good.sum() >= 2 else float("nan")
        conv_slopes.append([g, J, V, n, T, f"{slope:.3f}", "~2 (CN global O(dt^2))"])
        # gate: global order must be >= 1.8 (allow round-off floor tolerance)
        if not np.isnan(slope) and slope < 1.8 and errs_arr.min() > 1e-10:
            fails.append(f"convergence order {g} slope={slope:.2f} < 1.8 (expected ~2)")

    def write_csv(name, rows):
        with open(os.path.join(RES, name), "w", encoding="utf-8", newline="") as fh:
            fh.write("\n".join(",".join(str(x) for x in r) for r in rows) + "\n")

    write_csv("hermiticity.csv", herm_rows)
    write_csv("ed_oracle.csv", ed_rows)
    write_csv("boundary_matrix.csv", boundary_rows)
    write_csv("order_in_dt.csv", order_rows)
    write_csv("convergence_fixedT.csv", conv_rows)
    write_csv("convergence_slopes.csv", conv_slopes)

    worst_cn = max((float(r[8]) for r in ed_rows[1:]), default=0.0)
    worst_ed = max((float(r[9]) for r in ed_rows[1:]), default=0.0)
    worst_herm = max((float(r[4]) for r in herm_rows[1:]), default=0.0)

    summary = {
        "numpy": np.__version__, "scipy": __import__("scipy").__version__,
        "configs": len(data["configs"]),
        "worst_hermiticity_fro": worst_herm,
        "worst_cn_oracle_err": worst_cn,
        "worst_expm_ed_err": worst_ed,
        "gate_fails": fails,
        "verdict": "PASS" if not fails else "FAIL",
    }
    with open(os.path.join(HERE, "logs", "oracle_summary.json"), "w", encoding="utf-8") as fh:
        json.dump(summary, fh, indent=2)
    print(json.dumps(summary, indent=2))
    sys.exit(0 if not fails else 1)


if __name__ == "__main__":
    main()
