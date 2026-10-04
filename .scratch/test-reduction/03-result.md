# 03 — Timeline backend reduction result

Status: ready-for-agent
Progress: Approved source deletions complete and frozen; combined Rust compilation and execution owned by coordinator.
Owner: audit_timeline

Implemented all 13 deletions approved in [03-timeline-audit.md](03-timeline-audit.md). Exact names and paths are recorded in [03-deletions.json](03-deletions.json); the complete comparison against this phase's current-tree snapshot is [03.patch](03.patch), with file metrics in [03-metrics.json](03-metrics.json). Git HEAD was not used as the baseline.

## Exact scope and reduction

- 13 executable tests removed, comprising 384 physical lines of test attributes and bodies.
- 5 now-unreferenced `cfg(test)` accessors removed: `ObservationReceipt::{source,observed_at_millis,modified_at_millis}` and `NoteMutationResult::{payload_version,source}`.
- Empty policy test module and adjacent whitespace removed. Total net reduction: **425 physical lines across 13 files**.
- No production edits, new tests, relocated assertions, new helpers, fixture replacements or cosmetic test merging. `ObservationReceipt::{kind,path,previous_path}` remain because identity/reattachment tests still use them. No import removal was necessary after static inspection.

The removed integration work includes the redundant 80-save editor scenario and a fabricated task-shaped generic delivery race. Runtime improvement is not claimed without a measured comparison.

## Retained behavior owners

The audit's exact surviving-owner matrix remains authoritative. Retained coverage includes real authored-source routing, target verification and writer admission, close barriers, corruption/replay typing, transactional rollback and indeterminate publication, durable observation/lifecycle records, task relocation and literal transforms, actual history command product states, note open row-scoped preservation, and canonical forgotten-note recovery.

The exact 63/64/65/66 receipt boundary, 128-replay threshold, provenance/restore/restart contracts and all evidence, task-date and catalog cases remain. The backend owner explicitly confirmed that `services/retrieval.rs::retrieval_scope_and_clear_invalidation_are_applied_at_delivery` stays; reference inspection confirms it remains the generic clear-during-read race owner after the fabricated task mirror deletion. Architecture fitness is owned separately by the backend agent.

## Verification

Static checks confirm all 13 approved test names existed in the snapshot and are absent now; the changed-file executable test-name differences match the approved list, with no added cases. Each current file's lines are a subsequence of its baseline lines, establishing deletion-only source changes. The initial reference inspection missed retained `reattached.path()` and `reattached.previous_path()` calls. Coordinator compilation caught these two missing test-only methods; both were restored exactly from the snapshot without changing the assertions. Distinct same-named production methods remain untouched. Surviving critical race, receipt-threshold and retrieval owners were verified by name. The policy file's trailing blank line was removed following coordinator diff-check feedback.

No Cargo command was run by this owner during implementation. Source freeze was sent to the coordinator and independent reviewer, allowing one combined build after both backend owners finished. The initial combined compile failed with E0599 on those two accessors; `.scratch/test-reduction/rust-full.log` preserves that failure. The corrected source was frozen again for the coordinator rerun. Final compilation/runtime results will be recorded by the coordinator; static checks alone are not reported as executable validation.
