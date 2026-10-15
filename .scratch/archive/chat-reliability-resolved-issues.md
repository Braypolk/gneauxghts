# Resolved chat reliability issues

Consolidated 2026-10-14. Only issues 06 (historical latency) and 07 (citation
entailment) remain in the active issue directory. These outcomes describe their
original validation checkpoints. Historical allowance statements are superseded
by [continuous research compaction](continuous-research-compaction.md); they are
not current production quotas. Current contracts belong to architecture docs.


## 01 Native live baseline

The real native composer answer, current body citation navigation, and fresh cross-note follow-up completed against the configured local model. Baseline and semantic review are preserved in [validation](../chat-reliability/validation.md); repeated latency and citation entailment limitations have separate issues 06 and 07.


## 02 Structured tool recovery

Stable failure codes, retryability and recovery actions now originate at validation, freshness, capacity, allowance and research boundaries. One registration adapter returns the safe model payload while retaining private diagnostics. Relevant contract tests and the full 674-test Rust suite pass; see [validation](../chat-reliability/validation.md).


## 03 Budget-safe evidence delivery

Pages are fully prepared and sized before allowance reservation or citation admission, including research envelopes. Useful mixed-page results survive later failures with bounded continuation. Budget and delivery regressions passed after failing before the fix; see [validation](../chat-reliability/validation.md).


## 04 Research reliability

Strict selection remains authoritative: unread IDs and malformed/empty selections
never become sources. Failures return explicit partial outcomes and direct-evidence
recovery; only delivered selected proofs enter parent evidence. The final native
worker returned `partial/empty_selection`; its parent disclosed the failure,
read/cited all three historical changes and both current notes, and correctly
reflected vendor completion and the Rhea task. This establishes recovery success,
not worker success. Worker usefulness is tracked in issue 09. See
[validation](../chat-reliability/validation.md) and `../chat-reliability/artifacts/native-final.json`.


## 05 Preserve follow-ups across managed transcript publication

Publication and conflict checks serialize; queued managed projection observations recheck committed canonical bytes. The production-sink regression passes, genuine external edits still detach, all 56 chat tests pass, and the native fresh cross-note follow-up completed. See [validation](../chat-reliability/validation.md).


## 08 Reduce redundant evidence delivery before increasing allowances

The real timeline regression failed before the change: 192 bytes of current text
required continued expanded-lineage delivery. It now passes with compact reads
by default, optional lineage expansion, and validated historical timing and
activity support intact. The final native follow-up completed both current-note
reads without exhaustion, and research fallback read/cited historical evidence
and the latest cross-note status. Allowances and source admission remain bounded.
All 675 Rust tests pass. See [validation](../chat-reliability/validation.md).


## 09 Make the bounded research worker useful before expanding authority

Completed 2026-09-30. Focused gathering instructions and tool-facing scope now
combine with a schema-backed result formatter, inherited scoped reads, honest
gap handling, counter-only diagnostics and an already-read evidence handoff.
The formatter stays inside the private runtime adapter and grants no executable
authority. The selected model/provider and shared allowances are unchanged.

All five native scenarios pass: current and historical confirmed-note worker
success, broader historical discovery, separate direct fallback and research
composed with independent current-note reads. Rust library checks pass (681),
architecture checks pass (19), and E2E types pass. Valid partial coverage remains
explicit. See [worker validation](../chat-reliability/worker-validation.md) for evidence and limits.


## 10 Investigate three existing evidence regression failures

Found during Rig 0.44 migration on 2026-10-11. All three reproduce with identical
assertions on the isolated pre-migration Rig 0.41 sources and Rust 1.93.1. This
establishes that the migration did not introduce them. Focused diagnosis found
outdated fixture assumptions about continuation pages and the shared allowance;
the production evidence service and limits did not need changes.

### Reproduction

Run each named test with `cargo test --manifest-path src-tauri/Cargo.toml --lib <name> -- --nocapture`.
No model or API requests are involved.

- `evidence_contracts_compact_reads_preserve_proofs_without_expanding_lineage`:
  expected a non-null provenance item, found none.
- `prose_activity_preserves_range_dates_and_late_reports_need_content_search`:
  retrieval returns `EvidenceBudget` before the fixture expects it.
- `weekly_task_evidence_tracks_checkbox_ranges_not_file_or_task_wording_edits`:
  expected one item, found zero.

[Upgrade report](rig-upgrade-2026-10-11.md),
[baseline provenance](../rig-upgrade/baseline-check-provenance.json), and
[baseline compact](../rig-upgrade/baseline-compact.log),
[prose](../rig-upgrade/baseline-prose.log),
[weekly](../rig-upgrade/baseline-weekly.log) logs preserve the evidence.
The isolated source directory is `/tmp/gneaux-rig-041-baseline-check`; it overlays
the exact saved pre-migration files and dependency lockfile onto otherwise
unchanged sources, and uses the existing stable Rust 1.93.1 toolchain.

### Acceptance after triage

Determine the cause of each failure with a focused reproduction. Restore the
intended evidence/provenance and budget contracts, adjusting expectations only
when the current documented behavior warrants it. Confirm the named tests and
relevant evidence suite pass without increasing limits merely to hide failures.

### Answer

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
[completed-work record](completed-work.md#evidence-regression-fixtures).

Final validation: `cargo test --manifest-path src-tauri/Cargo.toml --lib` passes
with **861 passed, 0 failed, 27 ignored**. The run allowed the local HTTP fixture
to bind outside the sandbox; live provider tests stayed ignored. The focused run
passes **3/3**, and `git diff --check` is clean.
