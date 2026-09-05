# Test-suite usefulness audit

Follow-up: the four agreed pre–Phase 4 corrections are complete. See [test-hardening results](hardening.md). The findings and counts below preserve the original audit snapshot.

The suite mostly protects worthwhile behavior. The strongest improvement is to repair a small set of tests that can pass while their advertised behavior is broken. Broad deletion is not supported by this audit. Five individual cases can be removed with existing coverage preserved; further consolidation needs replacement assertions first.

## Scope and evidence

Reviewed the current working tree at HEAD `14e29d6`, including the earlier Phase 1–3 fixes. This audit changes only audit artifacts; production and test files were preserved. Deliberate regressions ran in an isolated temporary copy.

| Layer | Cases on this macOS checkout | Execution evidence |
| --- | ---: | --- |
| Frontend, 122 files | 770 | Fresh audit run: all passed; no pending/todo cases |
| Rust unit tests, 46 source files | 447 | Earlier fix-validation run: passed; not rerun for this audit |
| Rust architecture fitness | 15 | Earlier fix-validation run: passed |
| Browser journeys | 9 | Earlier fix-validation run: passed |
| Native journeys | 7 | Earlier fix-validation run: passed |
| Total | 1,248 | Not a single fresh combined run |

Rust source contains one additional Linux-only RSS test. Desktop results do not validate the iOS-specific branch in configuration tests. Frontend cases include parameterized expansions and frontend architecture checks.

Every test-bearing frontend/Rust file was inventoried. The 103 ordinary frontend files received purpose-level review: 15 full reads, 14 focused scenario reviews, and 74 samples. The remaining 19 frontend files cover rendering, reactive stores, architecture, and cross-language contracts. Rust bodies were sampled across every test-bearing source file, with suspect scenarios traced into production. Large suites were not exhaustively traced assertion by assertion. “Keep” means no concrete removal candidate was established, not proof that every assertion is necessary.

Detailed inventories: [frontend review](frontend-review.md) and [backend review](backend-review.md). Earlier validation results are recorded in the [Phase 1–3 fixes](../note-timelines/reviews/phase-1-3-final/fixes.md). Disposable logs, patches, and the generated JSON inventory were removed during pre-commit cleanup.

## Highest-value corrections

### 1. Architecture guard permits the forbidden state it claims to reject

`src/lib/architectureFitness.test.ts:209` uses `not.toEqual(arrayContaining([...seven forbidden fields]))`. That rejects all seven fields appearing together, rather than rejecting each forbidden field individually.

**Confirmed regression probe:** adding `controllerLifecycle = 'ready'` to the production controller in the isolated copy still passed all nine architecture tests. Both baseline and modified runs passed. Assert an empty intersection with the forbidden set, or individual absence. Keep the ownership rule.


### 2. Settings routing test cannot distinguish swapped destinations

`src/lib/features/settings/refreshCoordinator.test.ts:27` invokes both `vault` and `forgetting`, then checks aggregate loader counts. **Confirmed regression probe:** swapping the production branches still passed all three tests. Give each section a fresh fixture and assert its selected loader and absence of unrelated calls.


The probes use a minimal Node Vitest configuration in a copied workspace. They establish that these particular assertions miss these particular changes; they are not a full mutation score.

### 3. Several tests construct the desired behavior instead of exercising its owner

| Test | Coverage limit | Correction |
| --- | --- | --- |
| `blockMoveUndo.test.ts:67` | A helper constructs the minimal CodeMirror transaction; neither block-move action is called. A regression in production movement can leave it green. | Invoke a real block-move action, then assert text and undo/redo caret position. Retain the three focused diff-helper cases. No browser/native block-move-plus-undo replacement was found. |
| `semantic/atlas.rs:4544` | The test itself writes artifacts and switches the pointer in the desired order. | Exercise production publication with an interruption/failure, then use the ordinary reader to prove the previous generation remains available. |
| Search/task/Atlas/retrieval invalidation tests | These directly call the current-content capability with constructed results. They establish capability races, but not that the named consumer uses it correctly. | Retain the race evidence and exercise the real consumer delivery paths. Use existing seams; avoid adding public interfaces only for tests. |

Exact paths, surviving coverage, and implementation entry points are recorded in the detailed reviews. These are coverage limitations, not evidence that the current production behavior is broken.

### 4. Timer and shared-environment fixtures need realistic isolation

- `src/lib/features/notepad/search/store.test.ts:23`: the timer fake stores one callback, returns a constant ID, and does not cancel anything. The debounce scenario only sends one input. Use functioning fake timers to send a burst and prove only the final request runs; advance time after clearing to prove cancellation.
- `src-tauri/src/semantic/debug.rs:302` and `:333`: two tests mutate `GNEAUXGHTS_PROFILE_RSS` without shared serialization. One can enable profiling while the other expects it disabled. Combine the scenarios or use a common guard with panic-safe restoration. This is a source-level race, not an observed flake in this audit.

## Concrete removal and consolidation candidates

| Candidate | Disposition | Coverage that survives |
| --- | --- | --- |
| Three parameterized cases in `HistoryMode.svelte.test.ts:102` | Remove. They server-render a captured view state and compare it with the same aliased object; they do not exercise editor departure/return. | Read-only rendering remains in the next case. Browser selection-restoration journey covers collapsed, forward, and reversed selections after history refresh; native history journey also covers restoration. |
| Shared-alias case in `documentState.sequence.test.ts:368` | Remove one. The test calls adoption once itself and observes three references to the same object. | `documentState.test.ts:270` covers snapshot/revision behavior; `notepadRefreshController.test.ts:95` exercises actual refresh deduplication across panes. Keep generated transition sequences. |
| Algorithm spelling in `semantic/atlas_labels.rs:1531` | Remove one. Checking that a version constant contains `chunk-keybert` does not verify selection or compatibility. | Real label-generation cases and `label_pointer_requires_current_algorithm_and_model` cover those behaviors. |
| Dependency equality in `semantic/atlas.rs:4586` | Consolidate after moving source/layout/edge rejection cases into the real pointer compatibility test at `:4601`. | Production compatibility behavior becomes stronger; one fewer test afterward. |
| Fake-editing success in `notepadTaskMutationAdapter.test.ts:85` | Consolidate only after the integrated scenario retains task-versus-editor save attribution and no-extra-autosave coverage. | The integrated scenario already exercises real editing and persistence; currently its shared save spy loses a useful distinction. |

Also strengthen the task transform test's expected Markdown: `services/task_mutation.rs:330` computes it with the same helper used by production. It still verifies dispatch, so retain that purpose and use independent literal outputs.

## Architecture and rendering checks

The frontend architecture suite and 15 Rust fitness tests mix useful ownership/import constraints with fragile source-string assertions. Exact whitespace, variable spellings, old-name bans, field order, and documentation phrases can fail harmless refactors or pass text that is never executed. Preserve enforceable boundaries; trim incidental spellings and prefer syntax-aware checks where needed. Do not replace all of this with a new testing framework. The coordinator routing source check is not an established exact duplicate and should not simply be deleted.

Server-render tests remain useful for role-specific content, read-only controls, conditional health/recovery guidance, accessible states, and Markdown rendering. They do not prove clicks, keyboard behavior, or state transitions. In particular:

- `ChatMessage.svelte.test.ts:95` checks absence of `private reasoning payload`, but the fixture never supplies that payload. Remove the vacuous assertion or test the actual filtering boundary.
- The expanded-session render case in `HistoryEditingSession.svelte.test.ts` verifies an expanded projection, not preservation across a refresh. The browser journey owns that transition.
- Exact Tailwind class assertions in `ChatPanel.svelte.test.ts` are not evidence that overflow works in a browser.

The other inspected rendering suites—model selector, ChatMarkdown, HistoryDiff, conflict resolver, Forgotten/Missing notes, and history/semantic settings—have distinct rendering contracts worth retaining. Reactive app-settings, note-store, and chat-coordinator tests exercise real acknowledgement, identity, and coordination behavior despite their `.svelte.test.ts` suffix. Shared Rust/TypeScript IPC fixtures also earn their place: the compiler cannot verify command names and casing across that boundary.

## What to keep and how to proceed

Retain real CodeMirror/history tests, stale-result and state-machine sequences, persistence conflicts, crash/restart/migration cases, identity and retention cases, shared IPC contracts, and browser/native integration. Similar setup does not make different failure guarantees redundant. Browser journeys use a substituted backend; native journeys verify real persistence and lifecycle. Their overlap is often intentional.

Recommended order: repair the two confirmed blind spots and nondeterministic fixtures; replace synthetic production-path coverage; remove the five safe cases; then consolidate the conditional candidates. Test count may stay similar or increase where integration is missing. Avoid generic fixture frameworks or broad rewrites.

The visible GitHub workflow set only contains documentation automation. `pnpm test` runs frontend tests, not Rust or UI journeys. Keep the separate regression commands explicit in the development/release process; adding CI is a separate decision, not part of this audit.
