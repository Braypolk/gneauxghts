# Date test integration review

Status: ready-for-agent
Progress: Read-only review complete; root owns integration and execution.

## Scope and evidence

Reviewed all eleven tracked uncommitted date files in `/Users/bray.polkinghorne/Documents/code/personal/Gneauxghts` using its working-tree diff, then compared affected tests with the cleanup worktree. User subsequently authorized including all eleven files. Read the repository code-review skill; spec sources are the changed date feature documentation and behavior invariants. Inspected the TypeScript/Rust transforms, editor picker and decoration lifecycle, floating reference, picker component/close owner, shared contract consumers, open-document mutation boundary, and browser journeys. No tests, builds, or production/source edits were performed by this reviewer.

## Integration findings

1. **Required expectation updates in cleanup-only Rust tests.** `src-tauri/src/services/task_mutation.rs:224` in `pure_transform_dispatches_each_mutation_kind` expects `Ship it @due(...)` after adding a new deadline. New production behavior emits `Ship it due @due(...)`. The prepared-document expectation at line 321 also needs this wording; main's patch covers the old location of that latter case, but not the cleanup-added dispatch test. Keep both boundary cases and update their expected result. Main's `task_dates.rs` Real/Review expectations and `due-date-scroll.spec.ts:46` update are likewise necessary.

2. **Preserve the cleanup fixture when merging the new editor cases.** Cleanup `taskDateExtension.test.ts:14–17` already uses `createCommandView` and direct `undo(view)`/`redo(view)`. Main still has the earlier copied, cast EditorView fake with a custom state/dispatch/undo path. Add the two new cases onto the cleanup fixture; do not replace it with main's whole file. The shared fixture admits real CodeMirror transactions and verifies their starting state, so retaining it avoids recreating test machinery and weakening command fidelity. Its `focus` is already a spy; the new focus assertion can use it directly.

3. **Retain real browser synchronization at the new journey's transitions.** Main `dates.spec.ts:230–264` waits for saved outputs, but moves from Apply directly to a new `editorText` fixture after only the saved-content wait. Backend persistence and picker unmount are different boundaries (`dateTimePicker.ts` closes via asynchronous `unmount`). Explicitly wait for the picker to disappear after Apply, as existing date journeys do, before replacing the fixture. Before opening the first newly added task picker, establish the authored fixture through the existing saved-state helper. Prefer exact full-body equality for the new authored-wording outcomes, since substring checks cannot exclude unwanted extra suffix text. This is a bounded readiness/oracle improvement, not a reproduced production defect or reason for new timing sleeps.

No confirmed production correctness defect found in the date patch. Updating the first valid annotation in place while deleting later annotations backwards preserves offsets in both implementations. Existing annotation ISO selection is computed relative to the selected task line. Removing the widget on selection is supported by the floating reference's text-position fallback. Closing before dispatch prevents the view plugin's edit-in-note close from competing with a committing picker.

## Coverage ownership and retention

| New/affected coverage | Decision and reason |
| --- | --- |
| Shared `task-dates.json` authored `due`, existing DUE, custom wording, in-place first annotation, duplicate consolidation, hardbreak rows | Keep. The same fixtures execute through TypeScript and Rust consumers; this is the least costly cross-language contract owner. Some rows overlap simple addition, but uppercase/trailing whitespace, first-position duplicate consolidation, punctuation and Unicode encode distinct edge behavior. Do not expand these combinations into UI cases. |
| `keeps custom wording through date changes and removal, with undo` | Keep. Shared fixtures do not exercise editor commit transactions or two isolated undo units. Existing slash-add undo covers a different admission path. |
| `selects only an existing nested deadline for typing, preserving neighboring dates and undo` | Keep. It verifies line-relative ISO selection, no mutation merely on opening, `editInNote`, focus request, parent preservation and typed undo. Browser coverage uses a top-level task and does not replace this nested offset oracle. |
| New browser authored-wording journey | Keep one case. It validates actual native selection, real editor focus, hidden textbox, real typing, popup dismissal and persistence, plus calendar Apply with no authored `due` prefix inserted into an existing deadline. Unit mocks cannot validate these browser boundaries. |
| Existing inline-date direct typing journey | Keep. Its localized date spelling, inline date parser/formatter and replacement offsets differ from portable `@due(ISO)` annotation handling. Similar UI assertions do not make it redundant. |
| Existing slash cancel/add/remove/undo journey | Keep. Slash cancellation/token handling and Remove button wiring are absent from the new direct-typing journey. New case title's “removed wording” means an absent authored prefix, not deadline removal; rename for clarity if editing it. |
| Existing task-list picker/filter journey | Keep. The list still requires the date textbox; editor-only `editInNote` must not spread into that separate mutation boundary. |
| Existing due-date scroll journey | Keep unchanged geometry/focus assertions, update addition wording only. It exercises real scrolling with a remote caret and close/focus restoration, not merely a duplicate deadline transformation. |

`openDocumentTaskMutation.test.ts:199` fabricates a prepared body without authored `due`. This is an opaque backend response used to test typed payload forwarding and ordinary saving, not an assertion of the date formatter's output. It is not a failing expectation or a reason to import parsing into the mutation boundary. Updating the fake wording for readability is optional and outside this review's requested source scope.

## Validation recommendation and limits

After integration, run the existing shared TypeScript/Rust date contract consumers, editor task-date cases, and Rust task mutation tests. Then run the actual date and due-date-scroll browser journeys with their assertions retained. Main's additional menu `outline-none` change is unrelated to date behavior but explicitly included by the user's eleven-file authorization; no test expansion is warranted for that styling token. No claim is made that the new browser cases pass: root controls all execution.

## Authorized integration follow-up — source frozen

After root merged main's eleven files, made only the authorized test adjustments:

- `dates.spec.ts`: renamed the new case to distinguish absent authored wording from deadline removal; added exact full-body persistence admission for its initial fixture; replaced its six substring outcome/fixture checks with exact full-body checks; awaited picker removal after both calendar Apply actions. Native ISO selection, editor focus, hidden textbox, selection-panel dismissal, real typing/undo, chip label and no-reinserted-wording assertions remain. Existing journeys and all scroll/geometry assertions remain unchanged.
- `taskDateExtension.test.ts`: verified the auto-merge retained `createCommandView`, direct `undo(view)`/`redo(view)`, and all four tests. Removed the redundant `spyOn` wrapping the helper's existing `focus` spy and asserted that spy directly. No custom EditorView fake was reintroduced.
- `task_mutation.rs`: corrected the cleanup-only pure-transform addition expectation to `Ship it due @due(...)`. Verified the prepared-working-document expectation already acquired the same correction in the merge and still retains the neighboring child deadline verbatim.
- `due-date-scroll.spec.ts`: verified the addition expectation was already merged; made no changes.

Ran only scoped `git diff --check` (clean). No tests, builds, staging or commits. No production behavior changes. Root owns all validation and integration. Source is frozen for that validation.
