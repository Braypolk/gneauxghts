# Wait for completed native history transitions and use cross-kind catalog evidence

Status: ready-for-agent
Progress: complete
Owner: audit_timeline

## Evidence before edits

Native smoke3 (validation/native-smoke-3.log) now reaches the real application. Two restore cases click Restore immediately after selecting a revision; selection starts an asynchronous diff and disables Restore, so native click is a no-op. The missing-note paging case waits for `Load older history` text to disappear; that happens when the label changes to `Loading older history…`, before the loaded page is published. Failure diagnostics subsequently show all33records and the creation revision.

Rust final review: only catalog managed-chat test failed (746passed/1failed/16ignored). Issue98 intentionally restricts ordinary search to Note documents before collection. Managed chat publication must instead be asserted via the production cross-kind `evidence_matches` API scoped by its ID, while retaining removal and task-projection invariants.

## Plan

Wait for selected revision identity, completed diff and enabled Restore before native clicks. Wait for pager record-count growth plus completed loading, preserving all existing body/properties/undo/selection/scroll/recovery assertions. Use the catalog evidence API and exact expected chat passage for indexing and removal, retain ordinary-note exclusion assertion. No production change justified by current evidence. Run E2E types and focused Rust catalog test; root runs native acceptance sequentially.

## Outcome

Native spec now waits for completed paging (record-count increase plus settled busy state) and selected revision identity/diff completion before clicking enabled Restore. Missing-note paging waits for actual appended records, not the temporary label replacement. All prior body, unmanaged-properties, undo, selection, focus, scroll and recovery assertions remain.

Catalog test now asserts Note-only search excludes managed chats, scoped evidence_matches returns exactly the expected identity and `Managed chat lexical body` passage, and catalog removal removes that passage/count while retaining the ordinary task projection.

`cargo test --manifest-path src-tauri/Cargo.toml --offline --lib services::note_catalog::tests::managed_chat_updates_lexical_search_without_changing_task_projection -- --exact`: 1passed, 764filtered, 0.06s. E2E TypeScript and scoped diff check passed. No production change. Source frozen and handed to root for sequential native acceptance; native pass is not claimed here.

## Editing-window native follow-up (before edits)

Smoke4 confirms lifecycle3/3 and timeline4/4 passing, then editing-windows fails opening Revision name via native doubleClick. The shipped selected-version panel already exposes a visible Rename button; the journey asserts revision naming, not double-click event synthesis. Use that explicit action, wait for displayed/enabled name input and Add name, and apply the same settled selection/diff wait before this journey's later restore. Preserve naming, endpoint, two-pane restoration and undo assertions. No production change; root retains native execution ownership.

Editing-window follow-up implemented using the visible Rename action and explicit form/restore readiness; E2E types and scoped diff check passed. Root received source freeze before rerun. The opt-in measurement sampler is separately owned by audit_ui_semantic under99f and was not changed by this follow-up.
