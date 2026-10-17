# Shared search and hashing cleanup — 2026-10-16

The user authorized the remaining shared evidence-module extraction before merging.
This follow-up replaces the retained search dependency; it does not change Pi's
runtime or native permission/publication owners. No commit, merge or push is part
of this cleanup.

## Implementation

- `services/retrieval.rs` retains the small typed interactive-query interface and
  native `CurrentContentAccess` delivery boundary. Its private `search` module
  owns lexical/semantic passage ranking, overlap fusion, distinct-note selection,
  bounded canonical previews and before/after external-byte validation.
- `services/content_hash.rs` preserves the exact previous authored-body/unmanaged-
  properties hash. Pi reads and citation navigation only change their import.
  Managed metadata remains excluded; body and user-property changes remain visible.
- Removed `EvidenceSession`, worker forks/reserves, model evidence budgets,
  search/read continuation protocols, inventory/grouping, interpretation guidance,
  old passage citations/admission/navigation, agent error/recovery types and retired
  model fixtures. Removed unused passage deadline presentation; ordinary authored
  deadline parsing and task mutation remain.
- Model-preview budgets and JSON cursor round trips no longer control interactive
  search. It still returns at most 20 distinct notes with bounded previews and
  bounded candidate work. Semantic failures retain usable lexical results.
- Found and fixed an existing pending-index gap while testing: the old picker
  queried lexical projection only, so recent catalog notes could disappear until
  background indexing caught up. The extracted path now combines current indexed
  passages with catalog paragraphs for pending notes, using one lexical snapshot.
  Catalog relevance is converted to the existing ordinary-search score unit before
  merging with BM25. Scope is applied before indexed collection and catalog matching.
- Retained native NoteTimeline history/provenance capabilities. Ported useful
  lineage, checkbox status, clock uncertainty, retained-change proof validation,
  exclusions, clear-history invalidation and canonical read settlement tests to
  those native interfaces. Retired tests assert old model protocols and are removed;
  passing fewer tests is not presented as greater coverage.

Independent Standards and Spec reviews found two issues in the new fallback:
paragraph recovery could select an earlier paragraph in the same section, and
catalog/indexed scores used incompatible units. Both are corrected and covered by
regressions; both reviewers verified the corrections with no remaining findings.

## Validation

| Check | Result |
| --- | --- |
| Rust unit suite | 673 passed, 19 existing ignored, zero failed |
| Rust integration suites | 24 passed, zero failed |
| Native ordinary chat, including query-search IPC and process reopen | 12 passed |
| Native publication, including lost acknowledgement/reconciliation and process reopen | 6 passed |
| Native sanitized adapter diagnostics | 2 passed |
| Native standard compaction and Stop joining background work | 2 passed |
| E2E TypeScript check | Passed |
| Formatting of changed Rust module trees, `git diff --check` | Passed |

The native build used isolated binary SHA-256
`79d79db84311c649f3e76d913a6d330270ec9a27e70ba3e6bc5c66b64ac777d3`.
Native specs ran separately through `runNativeSpecs`, with real process-reopen
cases enabled. Driver/reconnect warnings alone are not acceptance results.

The full `cargo test` command completed the unit/integration targets successfully,
then failed during Rustdoc compilation because concurrent Atlas cleanup removed
`atlas_structural_build_covers_epoch` while the indexer still imported it. A global
format check similarly encountered an intermediate Atlas syntax error. Those edits
belong to another active chat in this same worktree and were left intact. Changed
cleanup module trees pass their targeted format check. These results prove the
compiled cleanup snapshot, not the later combined checkout: rerun the full build,
checks and doc tests after parallel cleanup settles before merging.

That combined-check limitation is now resolved by
[the combined merge-readiness pass](pi-combined-merge-readiness.md), including
successful full Rust/doc checks and current browser/native validation.

Relative to the pre-cleanup snapshot, Rust service sources/tests alone gained
1,009 lines and removed 6,517 (5,508 fewer net); this includes obsolete model-protocol
tests and the new direct native regressions. Additional lexical fallback code is
outside that service-only count. Removed JSON model fixtures are also outside it.
These are source-size observations, not resource or coverage claims.

Native acceptance uses generated disposable vaults and a freshly built isolated
binary. It does not write the ordinary vault or replace the user's running app.
This cleanup makes no new storage, IPC, latency, physical-iOS or live-hosted claim.
