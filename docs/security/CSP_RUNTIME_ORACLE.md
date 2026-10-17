# CSP runtime oracle — scope and limits

Issue: #176.

## What this layer proves

`tests/e2e/csp-runtime.spec.ts` runs the production Vite bundle in Chromium while injecting the exact `Content-Security-Policy` declared in `public/_headers` into the top-level document response. The listener is installed before application scripts run and fails the Playwright test on any `securitypolicyviolation` event observed on that startup/navigation path.

The test also requires the application root to mount. That counter-check matters: "zero violations" is not useful evidence if the page never executed.

Because `e2e` is a required check on the protected `main` branch, this runtime oracle becomes a merge gate once the PR lands.

## What this layer does not prove

A clean browser run is not a proof that the policy permits every possible application path. It observes only the behavior exercised by the test. Lazy routes, feature flags, rare error paths, workers created only after interaction, and future dynamic content require additional representative flows or static analysis.

It also does not replace static policy analysis. A policy can be wider than necessary while producing zero runtime violations. Conversely, a page can avoid a prohibited path during one run. Therefore issue #176 remains open until the hand-written HTML/CSP partial-parser responsibility is reduced or replaced by standards-based parsing/policy analysis and the adversarial corpus is retained.

## Layered target architecture

1. **Static structure:** standards-based HTML parsing; no regex reconstruction of HTML tokenization/tree construction.
2. **Static CSP semantics:** evaluate each resource against the directive that actually governs it; do not use one global safe-scheme list as an authorization model.
3. **Runtime differential:** Chromium with the production header and representative application flows; collect CSP violation events.
4. **Adversarial regression corpus:** retain the previously found `data-src`, inline-handler, entity-decoding, unterminated-script and directive-mismatch cases as permanent negative tests.

The layers answer different questions and must not be collapsed into a single PASS label.
