# Typecheck contract (#169)

HexGol uses Vite for bundling. Vite transpiles TypeScript/TSX but does not perform
whole-program type checking, so a green Vite build alone is not evidence that
`@types/react` or `@types/react-dom` are sound.

## Phase 1 gate

`npm test` now runs:

```
npm run typecheck
vitest run
```

`npm run typecheck` executes TypeScript with `tsconfig.typecheck.json` and
`noEmit: true`.

The initial scope intentionally includes:

- `src/App.tsx` — the production TSX surface;
- `tests/types/**/*.ts` — explicit type-package contracts.

JavaScript imported by `App.tsx` is allowed so the TSX surface can be checked,
but `checkJs` is still false. Turning on `checkJs` for the legacy JS graph is
a separate migration phase, not hidden debt inside #169.

## Why skipLibCheck is false

Issue #169 exists because type-definition updates previously had no failing
surface. Skipping declaration-file checking would weaken precisely that
contract, so this gate checks declaration files.

## Negative controls

`tests/types/react-types-contract.ts` contains `@ts-expect-error` probes for
React intrinsic props and `react-dom/client` options. They are intentional:
if those declarations disappear or collapse to `any`, the directives become
unused and TypeScript makes the gate red.

## Non-claims

This first gate does not claim full strict typing of the historical JavaScript
engine. `strict` is deliberately false in phase 1. The next migration steps
are:

1. make the existing TS/TSX surface clean under this compiler contract;
2. enable stricter flags incrementally with measured error counts;
3. turn on `checkJs` per module/subtree, not globally in one unreviewable jump.
