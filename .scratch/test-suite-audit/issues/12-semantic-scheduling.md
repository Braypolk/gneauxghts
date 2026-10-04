# Semantic scheduling, scale observability and Atlas internals

Status: needs-triage

## Audit sources

reports/ui-settings-and-indexing.md UIX-08/09/10/13

## Problem and intended result

Worker retries use real sleeps and long functions combine scheduling/execution. Large no-walk fixture does not measure reads. Installer success is only an ignored external-archive check.

## Acceptance and replacement coverage

Introduce private deadline/wait seam and prove retry decisions with fake time plus one real wake/shutdown integration. Instrument rows/work for no-walk claims; retain last-good generations and update/delete/move merge matrix. Add tiny local installer publication/cleanup/timeout tests. Group Atlas internals by publication/ranking/layout/labels without new public owners.

## Constraints and handoff

Do not collapse chunk ANN and note ANN contracts. Measure baseline before moving default scale cases; avoid a generic universal search abstraction.

Read the linked module report and architecture invariants before implementation. Audit baseline is `cb4d4c02f0e2c1220d37b281ee300eff1aabf20b`; verify current callers and line locations again. See `../review.md` for initial implementation scope; avoid repeating completed work.
