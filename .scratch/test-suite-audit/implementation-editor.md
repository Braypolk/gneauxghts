# ED-01 implementation: shared editor transaction batches

Status: implemented; focused validation passed
Audit gate: `review.md` was persisted and read before these edits.
Scope: only `src/lib/features/notepad/editor/editorDocumentRuntime.ts` and `editorDocumentRuntime.test.ts`. Baseline findings report remains unchanged.

## Change

Sibling pane broadcasts now construct each CodeMirror transaction from the preceding sibling transaction's resulting state. The source pane/root already processed batches sequentially; the correction makes the sibling path obey the same change-set/start-state contract without changing ownership, selection restoration, history annotations, callback frequency, or viewport preservation.

The runtime test harness now rejects transactions that do not start at its current EditorState, routes dispatched changes back through the real runtime, and simulates viewport movement during document updates so preservation assertions test actual protection. One parameterized owner-level scenario covers successive insertions, same-length replacements, and edits interleaved with leading/middle/trailing selection-only transactions. It checks source/sibling Markdown, independent selections, both scroll axes, one revision/callback per batch, separately isolated undo steps from the sibling, and redo from the source. Existing identity-adoption and Version Restore tests remain.

## Validation

Before changing production code, all three new batch cases failed at the strengthened start-state check while the ten existing runtime cases passed. After correction, the first run exposed an incorrect new test expectation: CodeMirror leaves a passive caret before an insertion exactly at that caret, so the sibling ends at 5 rather than 6. The test was corrected to preserve that existing behavior; no production selection policy was changed.

Final command:

```sh
pnpm exec vitest run src/lib/features/notepad/editor/editorDocumentRuntime.test.ts src/lib/features/notepad/images/imageCommands.test.ts src/lib/features/notepad/editor/undoSelection.test.ts
```

Result: 3 files, 26 tests passed (13 runtime, 5 image commands, 8 undo-selection). `git diff --check` passed for both edited files.

No full suite, browser, native, or separate TypeScript check was run by this subtask; combined validation remains with root. No broad test migration or unrelated audit findings were implemented.
