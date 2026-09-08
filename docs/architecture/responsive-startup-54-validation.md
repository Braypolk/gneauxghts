# Responsive startup and save readiness: issue 54 validation

2026-09-06. Implementation is compared with the exact post-issue-53 snapshot at
`/tmp/gneauxghts-history-hardening-baseline/after53.tgz`, not the repository HEAD.
Issue 55 owns authentic scale measurements and browser/native acceptance. No
native application was launched and no user database was read, reset, or converted
for this work. Existing History Mode visual changes and historical reports remain
unchanged.

## Workspace and save behavior

Canonical bootstrap and fallback session restoration skip forgotten-item cleanup.
Their existing last-opened Note Identity lookup, including a cold vault-walk
fallback, runs on a blocking worker through an owned Tauri AppHandle. Foreground
index guards remain inside that worker. Backend setup and the existing background
maintenance loop retain their ownership.

The document persistence controller starts the actual save immediately. After
250 ms it may observe the cheap readiness IPC, serially, only while that same
operation is pending. The operation token, document identity, runtime scope, and
replacement revision correlate observations. Completion, failure, invalidation,
or replacement cannot let a late observation overwrite a newer operation. An
observer failure cannot reject a save or replace its authoritative committed
warning. There is no preflight admission or second publication queue.

Waiting guidance uses the existing document operation machine and document status
view model. Editors and titles remain editable; no waiting overlay appears for
ordinary fast saves. A draft without a Note Identity can report recovery or a
history error, but cannot claim its generated target is being checked. A clean
canonical document remains clean independently of history verification. New typing
during a delayed save remains dirty, adopts the committed identity, and flows into
the existing coalesced followup save. Navigation waits for that drain and retains
the workspace when a required save fails.

AppStore starts listener attachment and canonical payload retrieval together and
settles both before returning or entering fallback. Per-field event counters
prevent an older payload from overwriting a newer event. A partial listener
failure is logged while successful subscriptions remain active; disposal cleans
up resolved and late subscriptions. Mount revisions guard delayed bootstrap,
fallback, editor setup, refresh, navigation, focus, and workspace subscriptions.
There is no additional runtime snapshot command or reconciliation subsystem.

## Blocking command and metadata boundaries

The concrete save, task mutation, History Mode/citation, history diagnostic and
recovery, proposal commit, forgotten-item, and chat-archive IPC entry points move
their existing synchronous work into `spawn_blocking`. Managed AppState and, where
needed, ChatService are obtained inside the owned-handle closure. Synchronous
helpers remain the focused test seam. The readiness IPC only parses an optional
provided identity and reads runtime state; it performs no SQL, path resolution,
or verification. Exit and vault switching retain their existing close transition.

Async lifecycle commands exposed aggregate app-state read/write races. Forgotten
metadata now uses row-scoped insertion, exact-record deletion, and conditional
restore-path updates under the existing state database lock. Staging occurs
inside the timeline's existing publication closure, before the file move. Known
publication failure rolls back only that staged record; indeterminate publication
retains its recovery evidence. Navigation pruning follows canonical publication,
with committed warnings for later bookkeeping failure. Cleanup checks completed
recovery under the existing file owner, and destination availability is rechecked
there before moving a file. Forget and restore compare the exact pre-preparation
source bytes again under that owner before staging metadata, so a concurrent save
cannot be replaced by stale lifecycle bytes; metadata repair remains separate from
that equality baseline. No state database lock spans history or file work.

Selected note purges validate both the retained current path and the exact selected
forgotten record after recovery, under the timeline's existing deletion owner.
This rejects a stale selection after restore, including restore followed by
forgetting again at the same path. Generic purge of an already missing source
remains supported. Chat archive/restore and chat or identityless-file purge share
the existing file owner for relocation, metadata validation and destructive work.
Conversation deletion cannot precede selection validation. Committed chat restore
bookkeeping failures retain a warning.

Restore, delete, cleanup, and archive cannot replace unrelated forgotten records
or workspace preferences from an old aggregate snapshot. Bootstrap stale-ID and
recent-search pruning remove only the observed IDs, and a delayed session restore
cannot replace a newer explicit selection. Whole aggregate app-state writers
remain available only for test fixture setup.

These changes preserve [ADR 0008](../adr/0008-verify-target-note-history-before-background-coverage.md):
a ready note may save before unrelated corruption is discovered; discovered
corruption blocks new publication. The backend still performs mandatory durable
preparation and owns every actual admission decision.

## Validation evidence

| Check | Result | Log |
| --- | --- | --- |
| Full frontend suite after final frontend changes | 829 passed across 124 files | `/tmp/issue54-frontend-final.log` |
| Focused save, lifecycle, AppStore, status and contract checks before the final partial-listener adjustment | 39 passed across 6 files | `/tmp/issue54-focused-audit.log` |
| Final focused lifecycle, metadata, source-byte and stale-purge races | 17 passed; 2.25 s | `/tmp/issue54-forgotten-selection-final-2.log` |
| Full Rust library before the metadata concurrency correction | 563 passed, 9 ignored; 81.25 s | `/tmp/issue54-backend-final.log` |
| Full Rust library after metadata changes, before source-byte and purge safety fixes | 566 passed, 9 ignored; 81.20 s | `/tmp/issue54-backend-concurrency-final.log` |
| Full Rust library after lifecycle safety fixes, before race-test assertion correction | 568 passed, 1 failed, 9 ignored; 104.36 s | `/tmp/issue54-backend-release-freeze.log` |
| Focused watcher/initializer race after assertion correction | Passed, plus 5 passing repeat runs | `/tmp/issue54-baseline-race-final.log`, `/tmp/issue54-baseline-race-repeat.log` |
| Final Rust library | 569 passed, 0 failed, 9 ignored; 109.28 s | `/tmp/issue54-backend-final-verified.log` |
| Ordinary non-test Rust compile | Passed without warnings | `/tmp/issue54-cargo-check-verified.log` |
| Architecture fitness | 17 passed | `/tmp/issue54-architecture-final-verified.log` |
| Svelte/TypeScript check | 0 errors, 0 warnings | `/tmp/issue54-svelte-check-final.log` |
| Explicit timeline contract gate | 4 TypeScript tests and 1 Rust test passed; readiness Rust fixture also covered by full library gate | `/tmp/issue54-contracts-final.log` |

The focused lifecycle interleaving pauses an actual forget after metadata staging,
starts cleanup and an actual chat archive, and independently changes navigation,
pins, hidden and collapsed notes, order and chat location before injecting
publication failure. Cleanup and archive wait while staging is live; archive then
succeeds. Only the failed operation's row is rolled back; preferences, selection,
canonical bytes and recovery semantics survive. Additional tests reject stale row
rollback and destination replacement after move planning.

A production interleaving saves newer Markdown after forget reads its source and
before lifecycle admission, proving stale forget cannot replace the newer bytes.
Other interleavings pause actual selected deletion or expiry cleanup, restore the
selected note/chat, optionally forget/archive it again at the same path, and then
resume the stale purge. Canonical files, note history, conversation records and
new forgotten metadata survive. Existing damaged-metadata repair, missing-source
purge and lifecycle recovery tests remain in the final backend gate.

Frontend regressions cover serial delayed observations, old results after
completion/failure/invalidation/new operations, changed scope/revision/identity,
observer failure alongside authoritative save failure or a committed warning,
null-ID recovery guidance, typing during a save, assigned-ID followup saves,
navigation success and failure, delayed bootstrap and fallback after unmount,
reentry, listener admission before failed-payload fallback, newer event snapshots,
and disposal of late listeners. The full suite includes existing pane departure,
workspace persistence, History Mode/citation, selection and conflict tests.

The full backend gate exposed an existing race-test assertion that required the
watcher to establish the baseline first. The actual race permits the initializer
to win, in which case known-since time comes from its clock instead of the
watcher's synthetic observation time. The test now accepts those two bounded
evidence sources while requiring one baseline, the correct source and exact
reconstructed content. No production behavior changed for this correction. The generic lifecycle wrapper
now used only by fixtures is compiled only for tests. The architecture assertion
was updated from its former generic purge call to the guarded selected-forgotten
entry; its initial literal mismatch is retained in
`/tmp/issue54-architecture-verified.log`.

A cold-backend regression restores canonical Markdown from both bootstrap paths
while the history store contains damaged retained payloads. Its readiness remains
RecoveryPending and scan counters do not advance. Shared Rust/TypeScript fixtures
pin every readiness state and nullable correlated snapshot field. Architecture
fitness asserts the exported waiting command routes are off-thread and the cheap
readiness observer has no history-admission or filesystem path.

## Review and measurement limits

Independent Standards and Spec audits identified the partial-listener, null-ID
guidance, additional waiting-command, lifecycle metadata concurrency, source-byte
and stale-purge issues addressed above. Both final bounded audits cleared the
frozen implementation without remaining actionable findings. The final gate
results are recorded in the validation table.

Earlier intermediate logs remain under `/tmp/issue54-*`, including the first
concurrency-test compile failure for a scoped-channel capture and intermediate
race-test fixture corrections (valid expiry timestamps and recovering a forgotten
note before entering History Mode). No test duration in
this report is a startup latency claim. Synchronous Tauri setup, first paint,
canonical workspace usability, target save admission and background completion
must still be measured separately by issue 55 on authentic current-format
histories and an isolated, visible, focused native app.
