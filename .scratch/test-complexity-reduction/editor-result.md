# Editor/discovery reduction result

Progress: Implemented; focused verification and mutation checks passed. Awaiting coordinator integration/review.

Against the saved current-tree baseline, 13 changed test files shrink from **2387 to 2032 lines (355 fewer)**. No helper file was added or enlarged. The other two changed production files retain their line counts but expose **four fewer functions**: `minimalDocChange`, `isDraftAcknowledged`, `rememberDraft`, and `isDraftCacheMiss` are private. Behavior is unchanged.

The main machinery removed is the fabricated proposal runtime (duplicate hunk DTO and three unsafe document/editor/request casts), duplicated transition scripts, duplicate editor-pane fixtures, and white-box cache priming/inspection. The draft protocol is tested through actual calls. The deletion-to-retained-owner map is in `issues/02-editor.md`.

Unique assertions transferred: complete proposal snapshot and post-resolution hunk count into real orchestration; passive no-focus into the retained workspace composition; exact search payload into cross-endpoint draft acknowledgement; precise concealed marker ranges into the existing command/parser/composed-decoration cases; exact cut result and real undo into existing clipboard-success coverage. Reviewing and conflicted double-discard branches now both execute through the same existing orchestration scenario, preserving their different recovery states. Distinct task and related races, editor batch regressions, image tests, and the recent scroll-restoration regression remain unchanged.

## Verification

Same command before/after:

```sh
pnpm exec vitest run src/lib/features/notepad/editor src/lib/features/notepad/markdown src/lib/features/notepad/images src/lib/features/notepad/search src/lib/features/notepad/related src/lib/features/notepad/wikilinks src/lib/features/tasks src/lib/features/proposals src/lib/features/notepad/orchestration/notepadProposalAdapter.test.ts
```

- Before: 47 files, 356 cases pass; 8.01 seconds, 398ms case time.
- After: 47 files, 334 cases pass; 8.14 seconds, 429ms case time. No speedup claim; parallel collection dominates and timing is noisy.
- Sequential mutation: replace targeted block changes with whole-document replacement → both retained move/caret regressions fail.
- Sequential mutation: disable inline-marker concealment → five retained command/parser/composed-decoration cases fail.
- Both mutations restored immediately; rerun of all three affected test files passes 15 cases. Root was notified before/after mutation window.

Root owns full typecheck and integration. Exact file metrics are in `editor-metrics.json`. Logs are retained alongside this report.
