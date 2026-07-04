#!/usr/bin/env bash
# EVIDENCE_PACK_GOLHEX_WAVE_001 — reproduce from a clean checkout.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

# 1. deps
npm install

# 2. CI-facing V&V unit gates (part of the required `unit` check)
npx vitest run tests/unit/hqst-vv.test.js

# 3. evidence sweep (drives the SHIPPED solver) -> results/*.csv + results/ed_export.json
node docs/research/EVIDENCE_PACK_GOLHEX_WAVE_001/evidence_runner.mjs        # add --full for the extended grid

# 4. independent numpy/scipy oracle (Hermiticity, exact-CN, expm ED, order) -> results/*.csv
python docs/research/EVIDENCE_PACK_GOLHEX_WAVE_001/ed_oracle.py             # exit 0 = all gates pass

# 5. checksums over the produced artifacts
( cd docs/research/EVIDENCE_PACK_GOLHEX_WAVE_001 && \
  sha256sum results/*.csv results/ed_export.json logs/*.json > checksums.sha256 )
