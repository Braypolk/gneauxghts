# Second-pass decision: stop broad test deletion

Progress: Complete. No additional source changes recommended or made.

A bounded independent cross-layer follow-up did not establish another meaningful reduction. The previous97-case/1,835-line cut remains intact. This is not a claim that every remaining test is indispensable; it is a judgment that the newly inspected candidates do not justify another broad deletion pass.

## Why stop

- Remaining low-level layers still contain unique failed-open recovery, omitted-revision paging, stale operation admission, save-queue and independent state-model checks. Larger integration fixtures do not assert those same outcomes.
- Similar Rust helpers often distinguish legacy serde defaults, startup intervals, optional field serialization, conservative capability policy, or post-commit failure honesty. Deleting them as duplicates would discard those requirements.
- Remaining architecture checks mostly cover entrypoint admission and forbidden write/privacy bypasses. A success test for one caller does not establish the absence of bypasses in every caller.
- A few same-branch table rows and repeated banned strings could be trimmed, but doing so would remove no layer, helper or substantial setup. That would have little maintenance value.

## Evidence and limits

[Frontend independent audit](frontend-audit.md), [backend independent audit](backend-audit.md), and [coordinator inspection](root-audit.md) record concrete candidate/survivor comparisons and limits. Both independent reviewers recommend zero additional cuts. Source-diff SHA256 remained4810e01b23d0fafaaf77c4d5b50b855bacc2d5a1e2f78e2a8ba05686ab952a16 when regenerating the completed first-pass patch, confirming no new source change. No tests rerun for a documentation-only assessment; previous acceptance remains the current source's evidence.

No speed claim. Prior frontend test-body time was4.38s aggregate against19.39s wall time with collection/transform overhead and concurrent typechecking. Those parallel timing categories are not additive; profiling would be needed before optimizing them. Rust library execution was114.53s and has not been profiled here. The next worthwhile test work would target a measured setup/IO/import bottleneck or a specific flaky/expensive fixture, rather than a lower case count.
