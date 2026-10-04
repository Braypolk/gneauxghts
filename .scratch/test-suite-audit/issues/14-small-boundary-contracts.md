# Calendar parsing, assets and weak assertions

Status: ready-for-agent

## Audit sources

reports/backend-persistence-and-timeline.md BP-06; reports/ui-settings-and-indexing.md UIX-04/07/12

## Problem and intended result

Managed timestamps accept nonexistent dates; some SSR assertions lack forbidden input; asset path selection may race with publication.

## Acceptance and replacement coverage

Calendar literal vectors reject February 31/April 31 and cover leap boundaries while retaining exact-Z contract. Remove vacuous render assertions or supply real forbidden input at the correct boundary. Confirm overlapping asset command reachability before changing it; if concurrent, reserve via create-new/retry and test distinct same-name bytes.

## Constraints and handoff

Asset race is a hypothesis about reachable concurrency, not a proven user-visible overwrite. Keep malicious-source escaping tests and meaningful error-normalization adapters.

Read the linked module report and architecture invariants before implementation. Audit baseline is `cb4d4c02f0e2c1220d37b281ee300eff1aabf20b`; verify current callers and line locations again. See `../review.md` for initial implementation scope; avoid repeating completed work.
