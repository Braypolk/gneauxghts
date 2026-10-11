# Investigate three existing evidence regression failures

Status: resolved

Found during Rig 0.44 migration on 2026-10-11. All three reproduce with identical
assertions on the isolated pre-migration Rig 0.41 sources and Rust 1.93.1. This
establishes that the migration did not introduce them. Focused diagnosis found
outdated fixture assumptions about continuation pages and the shared allowance;
the production evidence service and limits did not need changes.

## Reproduction

Run each named test with `cargo test --manifest-path src-tauri/Cargo.toml --lib <name> -- --nocapture`.
No model or API requests are involved.

- `evidence_contracts_compact_reads_preserve_proofs_without_expanding_lineage`:
  expected a non-null provenance item, found none.
- `prose_activity_preserves_range_dates_and_late_reports_need_content_search`:
  retrieval returns `EvidenceBudget` before the fixture expects it.
- `weekly_task_evidence_tracks_checkbox_ranges_not_file_or_task_wording_edits`:
  expected one item, found zero.

[Upgrade report](../../archive/rig-upgrade-2026-10-11.md),
[baseline provenance](../../rig-upgrade/baseline-check-provenance.json), and
[baseline compact](../../rig-upgrade/baseline-compact.log),
[prose](../../rig-upgrade/baseline-prose.log),
[weekly](../../rig-upgrade/baseline-weekly.log) logs preserve the evidence.
The isolated source directory is `/tmp/gneaux-rig-041-baseline-check`; it overlays
the exact saved pre-migration files and dependency lockfile onto otherwise
unchanged sources, and uses the existing stable Rust 1.93.1 toolchain.

## Acceptance after triage

Determine the cause of each failure with a focused reproduction. Restore the
intended evidence/provenance and budget contracts, adjusting expectations only
when the current documented behavior warrants it. Confirm the named tests and
relevant evidence suite pass without increasing limits merely to hide failures.

## Answer

The provenance and weekly-task fixtures assumed the first read page contained
the requested passage. The documented read protocol can first deliver
interpretation guidance with a continuation: the expanded provenance read
returned a title while its body remained pending; the weekly read returned a
guidance-only page. Neither result admitted the pending passage as a source.
The tests now follow the real continuation, validate every delivered citation,
check each page against `READ_BYTES`, and require complete delivery. Expanded
provenance overhead is measured across all pages rather than just its bootstrap.

The prose fixture read all nine surviving word-level activity fragments before
attempting its separate late-report check. That exhaustive inspection consumed
22,212 of the 24,000 shared bytes before the late-report search; the resulting
budget error was correct. The fixture retains that exhaustive temporal check,
then starts a focused session that selects the two action fragments and retrieves
the late report within the same allowance. It still verifies the authored event
date and excludes removed historical prose. The first full-suite run also exposed
an ordering-sensitive assumption in that new selection: the default eight-result
search page could omit one action among nine fragments. The focused selection
now follows search continuations before reading the two chosen excerpts.
No budget was increased.

Temporary diagnostics reproduced all three failures before correction; the
three corrected tests pass together. These are deterministic service tests and
make no model/API requests. Full-suite validation is recorded in the
[completed-work record](../../archive/completed-work.md#evidence-regression-fixtures).

Final validation: `cargo test --manifest-path src-tauri/Cargo.toml --lib` passes
with **861 passed, 0 failed, 27 ignored**. The run allowed the local HTTP fixture
to bind outside the sandbox; live provider tests stayed ignored. The focused run
passes **3/3**, and `git diff --check` is clean.
