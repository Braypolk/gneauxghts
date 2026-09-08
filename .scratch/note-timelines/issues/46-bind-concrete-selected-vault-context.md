# Bind history work to a concrete selected-vault context

Status: ready-for-agent
Depends on: 45

## Acceptance

Make the selected vault and its concrete private history-store context explicit where background and recovery work currently rediscovers global selection. Bind admitted work and callbacks to their original vault/store generation; keep SQLite details behind NoteTimeline. Do not introduce a generic store interface, a multi-vault feature, or change mandatory history save-failure policy.

## Checks

Exercise admitted work, window deadlines, recovery, clean close, and vault switch against disposable vaults. Prove stale work cannot write to or finalize a newly selected vault. Preserve the existing ownership and lock ordering contracts.

## Resolution

Implemented 2026-09-06. `AppState` composes one concrete private `history_store::Store` before starting background workers. `NoteTimelineRuntime` owns its selected vault root, configured vault data directory, app-local observation directory, and vault identity/generation. Storage operations receive that context explicitly; connection-local codecs remain private functions. No generic storage interface or live multi-vault feature was introduced.

History reads, cursor generation, asset/current-content eligibility, baseline initialization, retained observation/deletion recovery, Editing Window deadlines, reset, and clean close use the bound context. Recovery reopens the database belonging to its supplied connection with read/write-only flags. Runtime scheduler clones share the context; prepared-intent abandonment retains a snapshot of its original scope. Explicit reset advances the runtime for future work while old intent callbacks remain stale. Canonical and lifecycle admission validate paths against the bound vault before publication, callbacks, or staging, accepting canonical aliases while rejecting symlink escapes. The native corruption-injection wrapper also receives its AppState's bound context.

Eight disposable two-vault regressions deliberately reuse Note Identity and relative paths. They exercise admitted publication and abandonment after root/app-data selection changes; stale new-command and lifecycle rejection; deadlines, History Mode reads and retryable clean close; unresolved publication recovery; exact retained observations despite newer disk bytes; staged deletion recovery; old reset callbacks and new-generation deadlines; and canonical-path aliases/symlink escape. They verify the other vault's pending endpoint, Markdown, and app-local observations are unchanged where applicable. Existing mandatory history preparation, typed failures, committed warnings, ownership and lock ordering remain covered.

Integration followup: the new composition I/O exposed an existing background-index race. The worker checked foreground activity before waiting for a job, then applied newly arrived work without checking again. Moving context composition before worker startup restored appropriate initialization order but did not fix that race. The worker now rechecks after waking and before dequeue, releases the queue lock while backing off, retains queued work for coalescing, and lets a front-of-queue Shutdown proceed. The existing regression now synchronizes with the worker's idle wait and deterministically failed before this correction, then passed. Production backoff duration and test timeouts were not increased.

Validation:

- `cargo test --manifest-path src-tauri/Cargo.toml --lib services::note_timeline -- --test-threads=1`: 191 passed, 4 existing release diagnostics ignored. Log: `/tmp/issue46-focused3.log`.
- `cargo test --manifest-path src-tauri/Cargo.toml index::tests::background_queue_yields_to_foreground_then_drains -- --exact --test-threads=1`: deterministic regression passed after the queue correction. Red/green evidence: `/tmp/issue46-queue-deterministic-red.log`, `/tmp/issue46-queue-deterministic-green.log`. Initial full-run and isolated failure evidence: `/tmp/issue46-full-rust.log`, `/tmp/issue46-queue-repeat.log`.
- `cargo test --manifest-path src-tauri/Cargo.toml -- --test-threads=1`: final runtime/source passed 533 unit tests and all 16 backend architecture checks; 4 existing release diagnostics ignored; no warnings or failures. Log: `/tmp/issue46-full-rust-final.log`.
- `pnpm test -- src/lib/architectureFitness.test.ts`: this invocation ran the full frontend suite, including architecture fitness; 122 files / 797 tests passed. Log: `/tmp/issue46-frontend-architecture.log`. No frontend production changes.
- `cargo check --manifest-path src-tauri/Cargo.toml --features e2e-wdio --tests`: passed without warnings after propagating the bound AppState into the native-only corruption wrapper. Log: `/tmp/issue46-e2e-check-passed.log`.
- `cargo test --manifest-path src-tauri/Cargo.toml --lib commands::history_commands::tests::production_history_reads_preserve_and_latch_corruption_after_attestation -- --exact --test-threads=1`: passed after that native-wrapper propagation. Log: `/tmp/issue46-history-command-final.log`.
- `git diff --check`: passed.

The runtime ownership fitness assertions were updated for explicit composition and finalization arguments and now also verify the private shared Store and worker clone. Architecture and behavior-invariant documentation describe the bound scope and restart-only switching. No native/browser acceptance was run, no historical measurement evidence was changed, no user database was reset or deleted, and no commit was created. Issues 47 onward and deferred 22/24–26 remain outside this change.

## Comments

- 2026-09-06: Ordered history-hardening follow-up; run one fresh implementation agent per issue, with orchestrator audit before the next issue.
