# Consolidate history and persistence ownership

The user authorized redesign from required behavior, including replacement of existing app machinery when that improves the whole architecture. Issue 55 is paused. Root orchestrates; each implementation issue uses a fresh agent, sequentially, with independent review before the next.

## Required behavior

- Canonical Markdown and Note Identity remain authoritative. Durable history preparation precedes every app-owned publication; committed warnings never become retryable write failures.
- Recover interrupted work, then verify only the required note before first use. Unrelated verification cannot hold the file owner or block another target. Trusted writes extend proof.
- Clear, purge, reset and close invalidate/cancel applicable work. Old success and old corruption cannot affect replacement history. Detected current corruption blocks publication until explicit reset.
- Close drains admitted work and settles durable work without completing whole-vault verification. Retain current lock ordering unless a demonstrated defect justifies changing it.
- Targeted metadata writes preserve concurrent navigation/settings updates. Stale lifecycle selections and source bytes cannot erase a recovered note or a newer edit.
- The existing document owner starts saves immediately, adopts authoritative results, preserves newer edits, and gates departure. Readiness is advisory; bootstrap and editor lifecycle retain their own lifetime checks.

## Selected architecture

Three independent read-only designs compared an app-wide actor, complete concrete transactions, and a smaller existing runtime. A global queue was rejected: running verification on it restores unrelated blocking; offloading verification adds job/message machinery. A full merged runtime state was rejected because recovery, operation draining, content freshness, and window deadlines are independent concerns.

1. Keep those existing owners. Replace only verification coordination with an explicit worker phase, scoped per-note proof, and one place to accept completion results. Remove obsolete whole-vault integrity states and redundant scheduling flags. Readiness counts are maintained by the owner, not recomputed on every poll.
2. Keep named Tauri commands and existing error contracts. One private blocking-dispatch helper owns state lookup and worker/join handling; trivial synchronous command mirrors disappear. Substantial domain operations remain directly testable through concrete inputs. The document reducer receives a small save-wait reason, not backend diagnostic state.
3. Deepen concrete canonical publication operations. Editor/task save and forgotten-note lifecycle callers express intent; the existing NoteTimeline/persistence owner contains preparation, publication, abandonment and finalization. Delete caller-supplied callback protocols where the only production implementation is this owner. Preserve specific selection, source-byte, metadata and warning guarantees. ChatService remains the owner of chat lifecycle.

No general scheduler, command macro language, store trait, new mutation owner, durable draft store, compatibility path, or framework. Moving code into a file does not count as simplification. Changes must remove caller obligations, obsolete states, duplicated paths or unnecessary abstraction. Retain outcome tests; replace obsolete source-shape assertions instead of preserving wrappers for tests.

## Sequence and acceptance

| Issue | Outcome |
| --- | --- |
| [56](issues/56-consolidate-history-verification-state.md) | Replace verification coordination and obsolete integrity state. |
| [57](issues/57-simplify-command-dispatch-and-save-progress.md) | Remove repeated command plumbing and backend-diagnostic coupling in document state. |
| [58](issues/58-own-complete-note-publication-transactions.md) | Own complete save/lifecycle transactions and remove caller assembly. |

Compare each issue to its exact workspace snapshot, not HEAD. Before this series: `/tmp/gneauxghts-history-hardening-baseline/before56.tgz` (SHA-256 `582914523377518b8955d0e6aeb9617cbe2e8ddc1606aeed209f3962ef9e6f64`). It includes paused issue-55 instrumentation; preserve it and all historical reports. Earlier 51–54 totals are 3,438 net Rust lines: 1,974 in test/validation modules and 1,464 elsewhere including inline test hooks.

Report net production, test and tooling changes separately, plus concepts and caller protocols removed. A planning estimate is 500–800 fewer production Rust lines across the series, subject to implementation evidence; never remove guarantees, readability or valuable tests to hit a number. Audit the final ownership map and call paths in addition to running relevant backend/frontend/contracts/architecture checks. Native/scale acceptance remains issue 55 and resumes only against the stabilized design.

User databases, immutable masters and historical reports must remain untouched. No commits, DB resets, fixture generation or native launches during consolidation.

## Completion

Issues 56–58 are implemented and independently audited, sequentially. See [the acceptance review](architecture-consolidation-review.md). Actual reduction: 417 production Rust lines and 194 Rust lines overall; the initial 500–800 production-line estimate was not reached. Full automated backend/frontend, contracts and architecture checks passed. Native/scale acceptance remains paused in issue 55 and is not claimed by this consolidation review.
