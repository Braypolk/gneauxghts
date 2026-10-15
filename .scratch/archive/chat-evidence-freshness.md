# False evidence-change rejection

2026-10-14: corrected three reproducible ways unchanged notes could be reported
as changed during an answer. This is separate from citation entailment and the
chat-to-note transfer work.

## Reported run and limits of retained evidence

The user's latest failed run, `run_c401006151dea6230490`, contains the exact error
“Current note evidence changed during this answer. Search again to verify it.”
Search succeeded, a first read delivered three passages from two notes, and a
later read returned an evidence-staleness error. The next pre-inference check
stopped the run. Rig's stop wrapper describes this as cancellation; that does not
mean the user pressed Stop.

Read-only inspection of saved chat/history metadata found an observation for an
unmanaged legacy note during that request, with a filesystem modification time
from months earlier. No ordinary Markdown file's current modification time falls
inside the request window. The failed structured answer retains no source rows
or in-memory search bindings, so the exact predicate that failed in the original
process cannot be reconstructed conclusively from the saved data. The observation
is consistent with the reproduced bookkeeping invalidation; file timestamps alone
cannot prove that no earlier edit ever occurred.

## Reproductions and correction

Three focused regressions failed before correction:

1. Assigning a stable internal identity to an unrelated legacy note, through
   NoteTimeline observation followed by catalog/index admission, invalidated an
   earlier full-vault search even though every file's bytes stayed unchanged.
2. Changing only a file timestamp invalidated a search. Conversely, comparing
   only index digests and file signatures could miss same-size edits with retained
   timestamps while the index had not refreshed.
3. A citation check overlapping an active current-content operation immediately
   rejected unchanged evidence. The operation did not have to edit that source.

`services/evidence.rs::fingerprint` now hashes actual file bytes and paths in the
current permitted scope. Internal legacy identity assignment, timestamp-only
updates and derived-index refresh do not alter that content binding. Changed
embedded identity, content, path, additions/removals and scope changes still alter
it. Admitted citations separately enforce their exact source identity.

`validate_citation` now crosses NoteTimeline's existing refreshable current-content
read. It waits for internal settlement and repeats the entire canonical identity,
content, exact excerpt and retained-proof validation. It does not retry an old
snapshot or weaken access/freshness checks. Failure to settle still fails closed.
The fallback error now says evidence could not be reverified, rather than
asserting that the user changed a note when the validator cannot establish that.
A controlled concurrent regression proves unchanged evidence survives settlement
and a real edit during the same wait is rejected.

The production-tool regression exercises find_notes, read_notes, legacy
observation/catalog admission, another read and the same validate_context boundary
used before the next model request. It asserts unchanged evidence remains usable.
No provider inference or real-vault writes were needed to reproduce the bug.

## Validation

- Before correction: timestamp-only and legacy-identity search tests failed on
  their intended freshness assertions; the concurrent settlement test failed on
  immediate rejection of unchanged evidence.
- After correction: focused search regressions pass, including a same-size edit
  with unchanged timestamp that must still invalidate the search.
- `cargo test --manifest-path src-tauri/Cargo.toml --lib`: 910 passed, 31 ignored;
  includes real tool continuation, controlled concurrent settlement, genuine edits,
  excluded/revoked sources, retained-proof clearing and structured streaming.
- `cargo test --manifest-path src-tauri/Cargo.toml --test architecture_fitness --test runtime_lifetime`:
  21 architecture checks and one runtime lifetime check passed.
- `git diff --check`: passed.

Current ownership and the invariant are recorded in ARCHITECTURE.md and
`docs/architecture/behavior-invariants.md`. No changes are committed by this fix.
