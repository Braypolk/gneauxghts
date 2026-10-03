# Verify the complete image interaction journey and document ownership

Status: resolved
Type: task
Depends on: 01, 02, 03, 04, 05, 06

## Scope

Complete the acceptance matrix and browser/native validation in [the specification](../spec.md). Extend browser IPC fixtures with real image assets, delayed/error states, and images below the fold. Exercise the recorded recipe and Citrus flow through the actual Svelte/CodeMirror application, including source preview and shared-pane behavior.

Run targeted checks as features land, then one full integration pass. Add native checks only where real clipboard, filesystem, WebKit capture, or persisted reopening changes the evidence. Measure resource retention and large-note interactions before recommending transport changes.

## Main files

- `src/lib/e2e/browserBackend.ts`
- New `e2e/specs/browser/image-interactions.spec.ts` and focused native image cases.
- Focused image/runtime/transient tests and Rust asset/reference tests.
- `ARCHITECTURE.md`, applicable behavior invariants, and user-facing shortcut documentation.

## Acceptance

- `pnpm check`, relevant Vitest/Rust tests, and real browser image/cursor/selection-menu journeys pass.
- Real native evidence establishes clipboard import/cut, pointer cancellation, and persistence/reopen behavior on macOS.
- Images in inline prose, lists, quotes, tables, read-only states, missing/error states, and narrow panes remain usable.
- All state ownership and canonical write-path constraints are covered; an ADR is added only for an actual lasting tradeoff.
- Record actual commands, results, measured behavior, and unverified limits in a validation file. Passing headless decoration tests alone is not completion evidence.

## Comments

The investigation baseline is 15 passing existing tests; it does not certify these proposed behaviors.

## Answer

Added browser image/error/delay fixtures, focused image/parser/cache/geometry/runtime tests, ten real browser image journeys, native WebKit import/cut/cancel/persistence coverage, and the 500-image inventory probe. Updated user shortcuts, ownership map and behavior invariants. Final commands, results, review fixes, measurements and automation limits are recorded in ../validation.md.

Evidence: [implementation validation](../validation.md).
