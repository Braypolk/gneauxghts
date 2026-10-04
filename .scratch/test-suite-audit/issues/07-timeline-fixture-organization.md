# Note Timeline fixture organization and bounded stress cases

Status: needs-triage

## Audit sources

reports/backend-persistence-and-timeline.md BP-08/09/10; reports/backend-agent-and-evidence.md EVIDENCE-03

## Problem and intended result

Timeline test modules mix capture, lifecycle, evidence, storage and scheduler behavior; ordinary receipt stress duplicates release-scale geometry.

## Acceptance and replacement coverage

Group by behavior owner with explicit save versus save-and-finalize helpers. Move evidence contracts to evidence owner while retaining timeline proof tests. Receipt-bound unit case crosses its actual 64-item boundary; release 300-save and 10k/100k workloads remain opt-in. Preserve 140-revision checkpoint case that crosses 128.

## Constraints and handoff

No blanket reduction of corruption/restore/replay cases. Update qualified test filters and runner scripts when replacing include! with Rust modules.

Read the linked module report and architecture invariants before implementation. Audit baseline is `cb4d4c02f0e2c1220d37b281ee300eff1aabf20b`; verify current callers and line locations again. See `../review.md` for initial implementation scope; avoid repeating completed work.
