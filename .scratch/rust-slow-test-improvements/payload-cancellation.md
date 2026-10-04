# Payload cancellation correction

Status: ready-for-agent
Progress: Source complete and frozen for coordinator validation. No tests/builds run by this agent.

Only `src-tauri/src/services/note_timeline/history_store/verification.rs::tests::long_note_verification_checks_cancellation_between_payloads` changed. The test name and production verifier remain unchanged. Canonical creation plus two real saves/finalizations now produce three revisions instead of thirteen.

The test asserts the exact revision count and verifies the intact chain successfully. It then replaces exactly the second revision payload with invalid bytes, selecting that revision by its base relation to the root revision rather than timestamps or query order. Uncancelled verification must return typed `HistoryError::Corrupt`, establishing that replay reaches the deliberate corruption.

The callback permits the three header-enumeration checks and the first payload replay, then returns cancellation on the second replay check. The cancelled verification must return `HistoryError::Unavailable` at exactly that count. A comment records why the boundary is five checks. Removing replay-loop checks leaves only the three enumeration callbacks before replay reads the corrupt second payload, so the result becomes Corrupt and the Unavailable assertion must fail. This closes the prior gap where callback five merely interrupted enumeration of thirteen headers.

No new production hooks, phase interfaces, stores or fixtures were added. No edits were made to `history_store.rs`; root owns the temporary mutation there. `rustfmt` and scoped `git diff --check` passed. Expected validation: unchanged test passes; removing replay-loop cancellation makes it fail; restore source, recompile and rerun; record timing separately from compilation. These runtime results remain pending with coordinator.

## Final coordinator acceptance

All 725 library tests and 21 architecture checks pass, with unchanged inventory. Targeted comparisons and repetitions pass; mutation-sensitivity checks fail as intended and all sources are restored. Exact timing and full-suite variability are in README.md. Implementation is complete.
