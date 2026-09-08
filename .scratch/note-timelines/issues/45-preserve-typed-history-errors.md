# Preserve typed history errors without diagnostic rescans

Status: ready-for-agent
Depends on: 44

## Acceptance

Carry closed typed failures from their owning boundary instead of converting them to strings and rescanning vault health to rediscover their kind. Keep diagnostic causes in backend logs and the stable public error/message/recovery-action contract.

## Checks

Exercise unavailable, corrupt, stale, ineligible, missing, and invalid-request outcomes through production command paths. Prove ordinary failure translation does not trigger another exhaustive health scan. Preserve mandatory history preparation, committed-result warnings, recovery retry, and latched corruption.

## Resolution

Implemented 2026-09-06. The existing closed `HistoryError` now survives private storage, reconstruction, recovery, capture, and role-limited read paths. `history_failure` is a pure conversion: it never opens the store or requests health diagnostics. SQLite error codes, malformed codecs, retained header/lineage invariants, and Editing Window evidence are classified where detected. The public command state, stable message, recovery action, and backend-only diagnostic causes remain unchanged.

Corruption encountered after cached attestation latches the runtime gate for History Mode, Missing Note browsing, current-content provenance/activity/citation delivery, preparation/capture, and deadline recovery. Deadline aggregation preserves corruption while finishing independent due notes. Transient recovery stays retryable; mandatory preparation, exact canonical-byte preservation on rejected saves, and committed-result warnings remain covered. Storage fault construction stays behind closed `cfg(test)` scenarios in the private store.

Five added regression tests exercise production command and capture paths. Their cases cover all six requested error categories; unchanged integrity/health scan counters during ordinary translation and after read-time corruption; malformed database bytes, checkpoints, validly encoded deltas with inconsistent lengths, window/reciprocal evidence, payload versions, predecessor/lineage/ancestry defects; current-content and Missing Note delivery; and deadline finalization with another healthy due note. They verify that the next canonical save remains blocked without changing Markdown.

Validation passed on the final source:

- `cargo test --manifest-path src-tauri/Cargo.toml history_ -- --test-threads=1`: 58 tests and 3 selected architecture checks passed.
- `cargo test --manifest-path src-tauri/Cargo.toml -- --test-threads=1`: 525 passed, 4 existing release diagnostics ignored; all 16 architecture tests passed; no failures or warnings.
- `cargo check --manifest-path src-tauri/Cargo.toml --features e2e-wdio --tests`: passed without warnings.
- `git diff --check`: passed.

Execution logs: `/tmp/issue45-history.log`, `/tmp/issue45-full.log`, and `/tmp/issue45-e2e-check.log`. Native UI acceptance and process-restart checks were not run here. Issue 46's selected-vault context change and deferrals 22/24–26 remain unchanged. No commit was created.

## Comments

- 2026-09-06: Ordered history-hardening follow-up; run one fresh implementation agent per issue, with orchestrator audit before the next issue.
