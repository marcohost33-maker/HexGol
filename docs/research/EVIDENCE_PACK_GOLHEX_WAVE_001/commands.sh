#!/usr/bin/env bash
# EVIDENCE_PACK_GOLHEX_WAVE_001 — reproduce the frozen historical pack.
#
# The evidence pack was committed one revision AFTER the solver revision it
# evaluates. Therefore this launcher must NOT require HEAD==SOLVER_COMMIT: the
# script itself did not exist there. Instead it creates a detached worktree at
# the historical PACK_COMMIT, proves that no production files changed between
# SOLVER_COMMIT and PACK_COMMIT, executes the historical runner there, and
# compares regenerated outputs against the COMMITTED historical checksums.
set -euo pipefail

ORIGIN_ROOT="$(git rev-parse --show-toplevel)"
PACK_REL="docs/research/EVIDENCE_PACK_GOLHEX_WAVE_001"
PACK_COMMIT="bd79bc45812916504ccc303e0fc018ccea2673eb"
SOLVER_COMMIT="62a565f316f74ac6057135ab36046a7710c62745"
RUN_ID="$(date -u +%Y%m%dT%H%M%SZ)-$$"
OUT_DIR="$ORIGIN_ROOT/$PACK_REL/reproductions/$RUN_ID"
TMP_DIR="$(mktemp -d)"
WORKTREE="$TMP_DIR/hexgol-wave-001"

cleanup() {
  # Fail closed: a worktree that cannot be removed stays registered in the origin
  # repository, so a "PASS" with a dirty cleanup must not exit 0.
  local rc=$?
  if [[ -d "$WORKTREE" ]] && ! git -C "$ORIGIN_ROOT" worktree remove --force "$WORKTREE" >/dev/null 2>&1; then
    echo "Cleanup failed: could not remove detached worktree $WORKTREE" >&2
    [[ $rc -eq 0 ]] && rc=45
  fi
  rm -rf "$TMP_DIR" || { echo "Cleanup failed: could not remove $TMP_DIR" >&2; [[ $rc -eq 0 ]] && rc=45; }
  exit "$rc"
}
trap cleanup EXIT INT TERM

mkdir -p "$OUT_DIR"
export OUT_DIR

for commit in "$PACK_COMMIT" "$SOLVER_COMMIT"; do
  if ! git -C "$ORIGIN_ROOT" cat-file -e "$commit^{commit}" 2>/dev/null; then
    echo "Missing required commit $commit. Fetch repository history before reproducing." >&2
    exit 41
  fi
done

# PACK_COMMIT must be an evidence-only child of the solver revision. If any
# production/test file other than the pack's own V&V test changed, the historical
# result is not cleanly attributable to SOLVER_COMMIT anymore.
# The diff runs on its own line so `set -e` stops on a git failure; only the grep
# "no match" status (1) is tolerated, never a failed diff.
CHANGED="$(git -C "$ORIGIN_ROOT" diff --name-only "$SOLVER_COMMIT" "$PACK_COMMIT" --)"
UNEXPECTED="$(printf '%s\n' "$CHANGED" | grep -Ev "^$PACK_REL/|^tests/unit/hqst-vv\.test\.js$|^$" || [[ $? -eq 1 ]])"
if [[ -n "$UNEXPECTED" ]]; then
  echo "Evidence/solver provenance boundary violated; unexpected files changed:" >&2
  printf '%s\n' "$UNEXPECTED" >&2
  exit 42
fi

git -C "$ORIGIN_ROOT" worktree add --detach "$WORKTREE" "$PACK_COMMIT" >/dev/null
PACK="$WORKTREE/$PACK_REL"

# Independent byte-level guard for the two shipped sources named by the evidence
# pack. This is deliberately narrower and stronger than trusting commit ancestry.
for source in src/lib/sim-core.js src/lib/sim-engine.js; do
  if ! cmp -s \
    <(git -C "$ORIGIN_ROOT" show "$SOLVER_COMMIT:$source") \
    "$WORKTREE/$source"; then
    echo "Historical pack does not contain the claimed solver source: $source" >&2
    exit 43
  fi
done

# Record the environment OUTSIDE the frozen worktree. Reproduction metadata is
# new evidence and must never overwrite WAVE_001's historical logs/results.
{
  printf '{\n'
  printf '  "run_id": "%s",\n' "$RUN_ID"
  printf '  "recorded_at_utc": "%s",\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  printf '  "pack_commit": "%s",\n' "$PACK_COMMIT"
  printf '  "solver_commit": "%s",\n' "$SOLVER_COMMIT"
  printf '  "launcher_commit": "%s",\n' "$(git -C "$ORIGIN_ROOT" rev-parse HEAD)"
  printf '  "launcher_dirty": %s,\n' "$([[ -n "$(git -C "$ORIGIN_ROOT" status --porcelain -- "$PACK_REL/commands.sh")" ]] && echo true || echo false)"
  printf '  "launcher_sha256": "%s",\n' "$(sha256sum "$ORIGIN_ROOT/$PACK_REL/commands.sh" | cut -d' ' -f1)"
  printf '  "node": "%s",\n' "$(node --version)"
  printf '  "npm": "%s",\n' "$(npm --version)"
  printf '  "python": "%s"\n' "$(python --version 2>&1 | sed 's/^Python //')"
  printf '}\n'
} > "$OUT_DIR/reproduction_context.json"

python - <<'PY'
import json
import os
from pathlib import Path
p = Path(os.environ["OUT_DIR"]) / "reproduction_context.json"
data = json.loads(p.read_text())
try:
    import numpy
    data["numpy"] = numpy.__version__
except Exception as exc:
    data["numpy_error"] = repr(exc)
try:
    import scipy
    data["scipy"] = scipy.__version__
except Exception as exc:
    data["scipy_error"] = repr(exc)
p.write_text(json.dumps(data, indent=2) + "\n")
PY

cd "$WORKTREE"

# 1. Exact JavaScript dependency graph from PACK_COMMIT's committed lockfile.
npm ci

# 2. Historical CI-facing solver V&V gates.
npx vitest run tests/unit/hqst-vv.test.js | tee "$OUT_DIR/hqst-vv.test.log"

# 3. Historical evidence sweep against the shipped solver sources.
node "$PACK_REL/evidence_runner.mjs" | tee "$OUT_DIR/evidence-runner.log"

# 4. Independent Python/numpy/scipy oracle.
python "$PACK_REL/ed_oracle.py" | tee "$OUT_DIR/ed-oracle.log"

# 5. Strong reproduction check: DO NOT regenerate the manifest. Verify the newly
# generated outputs against the historical checksums committed in PACK_COMMIT.
# The verdict rests on the NUMERICAL artifacts (results/*) only. The two
# logs/*_summary.json files embed runtime versions (node, numpy, scipy), so on any
# host with other versions they differ although every number is identical; they
# are compared separately and reported as provenance drift, never as a FAIL.
(
  cd "$PACK"
  grep -E '[ *]results/' checksums.sha256 > "$OUT_DIR/checksums.numeric.sha256"
  grep -Ev '[ *]results/' checksums.sha256 > "$OUT_DIR/checksums.provenance.sha256"
  sha256sum -c "$OUT_DIR/checksums.numeric.sha256"
) | tee "$OUT_DIR/checksums.verify.txt"
PROVENANCE=SAME
( cd "$PACK" && sha256sum -c "$OUT_DIR/checksums.provenance.sha256" ) \
  > "$OUT_DIR/checksums.provenance.txt" 2>&1 || PROVENANCE=DRIFT

# 6. Catch tracked numerical outputs that are not covered by checksums.sha256.
# A byte-identical reproduction leaves results/ in the historical worktree clean.
if ! git diff --exit-code -- "$PACK_REL/results" > "$OUT_DIR/historical-output.diff"; then
  echo "Reproduction produced tracked result bytes different from PACK_COMMIT." >&2
  echo "See: $OUT_DIR/historical-output.diff" >&2
  exit 44
fi
git diff -- "$PACK_REL/logs" > "$OUT_DIR/provenance-logs.diff" || true

cat > "$OUT_DIR/VERDICT.txt" <<EOF
PASS
pack_commit=$PACK_COMMIT
solver_commit=$SOLVER_COMMIT
historical_numeric_checksums=PASS
tracked_result_diff=EMPTY
runtime_provenance=$PROVENANCE
EOF

echo "Historical evidence reproduction PASS"
echo "Audit record: $OUT_DIR"
