# Open the workspace with explicit save readiness

Status: ready-for-agent
Depends on: 53

## Acceptance

Restore the normal workspace and canonical Markdown without waiting for whole-vault history verification. Route unavoidable startup work off the interactive path and expose the existing timeline readiness through document/save behavior. Saving begins once recovery and the edited note's verification finish, independently of unrelated background checks. Never show unsaved or queued edits as saved.

Use existing workspace/document/save owners. Preserve edits, retries, departure barriers, focus, selection and scroll. Do not create a durable draft subsystem or silently save outside history. Display concise user-facing waiting/error guidance where readiness affects a save; do not expose database internals. History Mode and citation entry still require the selected note's recovered/verified history.

## Design guidance

Measure synchronous Tauri setup separately from `bootstrap_app`, canonical session restoration and history readiness; the prior native ~15-second interval includes more than the ~7-second history scan. Bootstrap currently enters forgotten-note cleanup and may wait on its mutex; cold note-ID lookup can walk the vault; event listener setup precedes session application. Remove/offload unnecessary foreground cleanup and add mount/request correlation before applying delayed bootstrap results. Keep authoritative save admission in the backend; UI readiness snapshots never authorize writes by themselves.

## Checks

Delayed background verification must leave workspace display and eligible interaction responsive. Test immediate typing/autosave, note/pane switching while readiness is pending, startup/recovery failure, late corruption, retry, exit/close and reentry. Assert no false saved state, lost working draft, stale response or history bypass. Exercise real browser/native bootstrap and distinguish first paint, usable workspace, active-note save readiness and full background verification completion.

## Comments

- 2026-09-06: User-facing startup improvement follows the explicit note-scoped verification contract from issue 53.
- 2026-09-06: Read-only frontend design: start the actual save through `persistenceController.persistNote` immediately and observe cheap readiness only while that existing operation is pending. Token-correlated progress belongs in the existing document operation machine; stop observation in `finally`, ignore stale/scope-mismatched results, and never let advisory observer failures replace the authoritative save result. Keep `DocumentRuntime` coalescing, newer-draft preservation and departure promises. Present restrained waiting text through the existing document-status view model and `ExternalConflictResolver`, without disabling editing or creating another readiness owner. New drafts can observe vault recovery until a Note Identity exists. A clean canonical document can remain saved while history verification is pending.
- 2026-09-06: Bootstrap audit correction: the forgotten-cleanup throttle mutex is brief; the synchronous cleanup/recovery it triggers is the delay. Both `bootstrap_app` and fallback `load_note_session` currently request cleanup. Skip it on these canonical session paths. Cold pruning already retains unknown IDs without repeated disk walks; only resolving the last-opened Note Identity may fall back to a vault walk. Preserve that fallback off the interactive command thread. Add lifecycle/request correlation after awaited bootstrap and fallback before applying a session, asset state or listeners; test unmount/reentry and stale completion.


## Resolution

Implemented 2026-09-06. Canonical bootstrap and fallback skip synchronous forgotten
cleanup and run unavoidable session work on blocking workers. Listener admission
runs alongside payload loading; generation and mount correlation prevent stale
application after disposal or reentry. Saves begin immediately through the
existing persistence owner and receive delayed, token-correlated advisory readiness
guidance without disabling editing, authorizing writes, losing newer drafts or
replacing committed warnings. Concrete history-waiting IPC commands run off the
interactive thread.

Independent Standards and Spec audits also exposed concurrency hazards in the
newly asynchronous lifecycle commands. Exact forgotten-row updates, source-byte
revalidation and selected-record/path checks now protect saves, restore, deletion
and cleanup under existing database/file/timeline owners. Chat transitions use the
same file owner through relocation and destructive bookkeeping. Both final audits
cleared the implementation.

Validation: full frontend 829 passed; full Rust library 569 passed, 9 ignored;
focused lifecycle races 17 passed; architecture 17 passed; ordinary Rust compile
without warnings; Svelte 0 errors and 0 warnings; explicit shared contracts passed.
See [validation evidence](../../../docs/architecture/responsive-startup-54-validation.md)
for logs, earlier-stage results and the corrected pre-existing race-test assertion.
No native application or user database was accessed. Authentic browser/native and
scale latency acceptance remains assigned to issue 55; no debug-test duration is
claimed as startup latency. No commit was created.

- 2026-09-06 orchestrator audit: both independent reviews cleared the final concurrency corrections. Verified 569 backend tests, 829 frontend tests, 17 lifecycle regressions and 17 architecture checks, plus clean production/Svelte/contracts checks. All 18 earlier validation/measurement reports remain byte-identical to after53. Final snapshot records the test-only lifecycle wrapper and corrected race/architecture assertions after the full-suite source stage. Approved sequential handoff to issue 55.
