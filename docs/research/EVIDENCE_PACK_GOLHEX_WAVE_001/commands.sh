#!/usr/bin/env bash
# EVIDENCE_PACK_GOLHEX_WAVE_001 — reproduce the HISTORICAL evidence pack exactly.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

EXPECTED_COMMIT="62a565f316f74ac6057135ab36046a7710c62745"
ACTUAL_COMMIT="$(git rev-parse HEAD)"

if [[ "$ACTUAL_COMMIT" != "$EXPECTED_COMMIT" ]]; then
  cat >&2 <<EOF
EVIDENCE PACK REFUSES TO RUN ON THE WRONG REVISION.
expected: $EXPECTED_COMMIT
actual:   $ACTUAL_COMMIT

This pack is a frozen result set tied to one solver revision. Running it on a
newer checkout would create new evidence while the surrounding claim_decision.md
still names the historical commit. Check out the exact revision (preferably in
a detached worktree) before reproducing this pack.
EOF
  exit 42
fi

if [[ -n "$(git status --porcelain)" ]]; then
  echo "EVIDENCE PACK REFUSES A DIRTY WORKTREE; reproduce from a clean checkout." >&2
  git status --short >&2
  exit 43
fi

PACK="docs/research/EVIDENCE_PACK_GOLHEX_WAVE_001"
mkdir -p "$PACK/logs"

# Record the execution environment of THIS reproduction. This does not rewrite
# environment.lock; it creates run evidence that can be compared with the
# originally recorded environment.
node -e '
  const fs = require("node:fs");
  const cp = require("node:child_process");
  const out = {
    recorded_at_utc: new Date().toISOString(),
    commit: cp.execFileSync("git", ["rev-parse", "HEAD"], {encoding:"utf8"}).trim(),
    node: process.version,
    v8: process.versions.v8,
    platform: process.platform,
    arch: process.arch
  };
  fs.writeFileSync(
    "docs/research/EVIDENCE_PACK_GOLHEX_WAVE_001/logs/reproduction_context.json",
    JSON.stringify(out, null, 2) + "\n"
  );
'

# 1. exact JS dependency graph from the committed lockfile
npm ci

# 2. CI-facing V&V unit gates (part of the required `unit` check)
npx vitest run tests/unit/hqst-vv.test.js

# 3. evidence sweep (drives the SHIPPED solver) -> results/*.csv + results/ed_export.json
node "$PACK/evidence_runner.mjs"        # add --full for the extended grid

# 4. independent numpy/scipy oracle (Hermiticity, exact-CN, expm ED, order) -> results/*.csv
python "$PACK/ed_oracle.py"             # exit 0 = all gates pass

# Append Python/oracle versions to the run context after imports have succeeded.
python - <<'PY'
import json, pathlib, platform, sys
import numpy, scipy
p = pathlib.Path("docs/research/EVIDENCE_PACK_GOLHEX_WAVE_001/logs/reproduction_context.json")
data = json.loads(p.read_text())
data["python"] = platform.python_version()
data["numpy"] = numpy.__version__
data["scipy"] = scipy.__version__
p.write_text(json.dumps(data, indent=2) + "\n")
PY

# 5. checksums over the produced artifacts, including reproduction provenance
( cd "$PACK" && \
  sha256sum results/*.csv results/ed_export.json logs/*.json > checksums.sha256 )

echo "Evidence reproduction complete for $EXPECTED_COMMIT"
