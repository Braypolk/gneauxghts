# Frontend performance patch review

Status: complete
Progress: Independent read-only Standards, correctness, and Spec review completed using `.agents/skills/code-review/SKILL.md`. No tests, builds, benchmarks, or source edits performed by reviewer.

## Scope and baseline

Reviewed only the four files in `source-changes.patch`: `vite.config.js`, `document/documentRuntime.ts`, `editor/editorExtensions.ts`, and `editor/editorDocumentRuntime.ts`. Baseline is the saved tree in `baseline.json`: `/var/folders/kt/bvxdjthn7558236cmffqpndm0000gp/T/gneauxghts-perf-baseline-st88quah`. Earlier uncommitted changes are outside this review. Compared the patch and current callers with that snapshot; did not use Git HEAD as the performance baseline.

Spec sources: `spec.md`, `issues/01-root-import-boundary.md` (root import plan), and `experiments.md`. Standards sources: repository `AGENTS.md`, `ARCHITECTURE.md`, applicable committed-adoption/shared-undo-root and retained-review behavior invariants, and code-review skill smell baseline.

## Assessment

**No actionable correctness defect, Standards violation, or unmet behavioral requirement found. Ready for coordinator acceptance.**

- Root construction preserves the exact extension order: `history()`, `imageResizeHistory`, `keymap.of(historyKeymap)`, then `createMarkdownBaseExtensions()`. The review state field is still installed by the same subsequent `StateEffect.appendConfig` transaction. It has not been moved into initial construction, deduplicated, or reordered. Both constructor and history-reset replacement still call the existing private `documentRoot` function.
- The removed `createRootState` export had exactly one caller in the saved baseline. All current references are removed. Pane state construction, pane extensions, history forwarding, and review lifetime code are unchanged. Moving this single private operation to its sole caller removes the root-to-pane import dependency without introducing another interface or owner.
- `DocumentRuntime` calls the identical resource factory through its actual module rather than the broad façade. `editor.ts` continues to re-export that factory and all public editor operations. The existing façade mock in `editorLifecycleController.test.ts` still intercepts lifecycle calls because that controller's façade imports are unchanged; no current mock supplied a substitute `createSharedEditorResources` that the new import would bypass. Type-only imports do not introduce runtime dependencies.
- The only Vite test configuration change is `pool: "threads"`. Installed Vitest 3.2.6 defaults retain isolation (`defaults` has `isolate: true`; `runBaseTests` defaults `poolOptions.threads.isolate` to true and resets mocker/module cache between files). No test include, environment, assertion, worker count, timeout, or isolation override changed. The existing filesystem-using frontend tests read fixtures/source; no changed call path relies on subprocess-only APIs such as `process.chdir`.
- Spec's no-test-removal/no-weakened-assertions requirement is satisfied by this four-file diff. The optimization is supported by the coordinator's controlled isolated-thread repeat measurements; this review makes no new timing claim. The import change also satisfies the independent ownership/dependency correction in its plan.

## Minor cleanup note

`editorExtensions.ts` still imports `createMarkdownBaseExtensions` from `editorShortcuts`, although removing `createRootState` removed its last use in that file. This is nonblocking dead-import cleanup; it does not affect the import graph because the same import declaration still needs the other shortcut factories. No source edit made by reviewer.

## Validation limits

Read coordinator evidence only: recorded final 1,065-case pass and `typecheck.log` with zero Svelte errors/warnings plus successful E2E TypeScript invocation. Inspected installed runner code for isolation rather than relying on an external version assumption. Did not reproduce timings, rerun tests, or make claims about native/backend performance or unrelated existing source changes.

## Coordinator resolution

Removed the unused import noted above. Static import-use inspection found no further dead imports in the three changed files.
