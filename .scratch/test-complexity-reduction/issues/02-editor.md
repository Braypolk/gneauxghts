# Reduce editor and discovery test duplication

Status: ready-for-agent
Progress: Complete; implemented, reviewed, and accepted after combined validation. See ../validation.md.
Type: task

## Baseline and scope

Compare against `../baseline.json`'s saved current-tree snapshot, not Git HEAD. Own editor/runtime, Markdown/images/wiki, tasks/search/related, and proposals TypeScript tests and necessary production interfaces. Documents owner confirms `notepadProposalAdapter.test.ts` and composition proposal acknowledgement cases remain intact. No Rust or browser edits.

## Proposed deletion / retained ownership map

| Delete or narrow | Retained behavioral owner / necessary strengthening | Burden removed |
| --- | --- | --- |
| `proposals/reviewSession.test.ts`: fabricated `reviewRuntime()` and its projection case | Existing `proposalOrchestration.test.ts` “opens the target note…” will assert the complete active snapshot against its real document/CodeMirror runtime; existing mapped-hunk/resolution cases own hunk progress. Retain the small failed-open snapshot case, which is distinct. | ~80 lines, duplicate hunk DTO, three unsafe casts, synthetic document/editor graph. |
| `proposals/proposalOrchestration.test.ts`: passive installation, absent queued target, simple suspend/remount cases | Real `notepad/orchestration/notepadProposalAdapter.test.ts` “installs a passive proposal…”, “keeps an absent target queued…”, “retains review text/hunks…”; existing orchestration departure cases additionally assert working text and pending hunks after remount. Preserve explicit opening case as real session snapshot owner. Add passive no-focus assertion to retained composition only in coordination with documents owner. | ~50 lines of duplicate assertions against navigation spies. |
| `proposals/proposalReviewMachine.test.ts`: opens prepared, conflict/retry, double-discard transition cases | Retained orchestration opening, “recovers a commit conflict…”, and “requires confirmation before dismissing and reloading a conflict” exercise real session state and durable callback boundaries. Retain replace-conflicted, committing/dismissing guard, discard-disarm, and stale-completion cases because branches differ. | ~65 lines of repeated transition scripts. |
| `editor/editorDocumentRuntime.test.ts`: one-pane broadcast, basic shared undo cases | Existing three batch regressions assert pane documents/selections, scroll, exactly-once callbacks, undo/redo and final history exhaustion; identity-adoption test also covers ordinary single-edit shared history. | ~45 lines of duplicate runtime/pane setup. |
| `editor/blockMoveUndo.test.ts`: direct `minimalDocChange` unit suite | Keep both actual keyboard/drag move history regressions. `editorShortcuts.test.ts` unchanged clipboard-success case will assert exact remaining text plus real undo restoration for deletion. The no-op offset shape is an internal representation, not a caller contract. Make `minimalDocChange` private (only external caller is deleted test). | ~30 lines of algorithm-shaped tests and one unnecessary production export. |
| `search/search.test.ts`: separate first-body/second-omitted tests | Existing search→related→retrieval payload case will assert the complete first search payload (not objectContaining), followed by exact body-omitted related/retrieval payloads. `draftRef.test.ts` remains protocol owner. Retain recent-note endpoint test. | ~45 lines of repeated context and invocation setup. |
| `search/draftRef.test.ts`: direct acknowledgement/cache-error internal tests and manual cache priming | Exercise first/second calls through `callWithDraft`, cache-miss string/Error retries, and non-cache failure through that public protocol. Remove `isDraftAcknowledged`, `rememberDraft`, `isDraftCacheMiss` exports; keep hash output/change checks. No new helper/interface. | Three test-only exports, white-box Map-state expectations and manual seeding convention. Net lines may stay similar because string/Error behavior remains explicit. |
| `wikilinks/state.test.ts`: repeated same-body omission payload case | Keep exact initial section payload and no-draft note-only autocomplete/resolution cases. Shared `draftRef` protocol and cross-endpoint search payload case own acknowledgement; actual runtime owns stale insertion/dismissal. Keep state test's pending visibility and wrap-selection branches, absent from runtime test. | ~20 lines of repeated cache protocol fixture. |
| `markdown/markdown.test.ts`: basic bold/strike/highlight/comment/code content/marker cases; duplicate asterisk italic assertion | Existing `inlineFormatSpec.test.ts` traverses actual command→parser→composed decorations→unwrap for each supported format. Strengthen it to assert both concealed delimiter ranges; retain underscore aliases, nesting/triple markers, overlap visibility, selected highlight fill, escape, fence, background parsing and viewport regressions. | ~35 lines of duplicate direct-decorator examples. |
| `search/store.test.ts`: initial empty-fields/$store representation case | Actual searches, recent/pinned loads, and cancellation cases read/write the public reactive fields and verify resulting behavior. Preserve debounce, stale success/error, recent failure/empty distinction, local-vs-backend modes, highlights and pin refresh. | ~10 lines of default-state representation assertions. |

Expected net removal roughly 350–450 maintained test lines, without converting cases to hidden loops or relocating setup. Precise result comes from baseline comparison after implementation; it is not a quota. Entire fabricated proposal runtime removed; four test-only production exports removed. No production behavior change intended.

## Explicit retention decisions

- Preserve ED01 chained start-state transaction batches, asynchronous clipboard ownership, task request lifecycle/reorder/conflict regressions, search/related debounce and disposal races, and MRU/wiki contracts.
- Preserve presentation scheduling unit tests: lifecycle tests mock that boundary, so similar names do not make coverage redundant. Preserve the newly reproduced same-runtime scroll settlement regression.
- Preserve proposal commit acknowledgement and capture-during-remount tests: simple commit callbacks and document acknowledgement are distinct boundaries. Preserve discard-disarm reducer tests not exercised by composed paths.
- Preserve image upload/parser/performance tests and opt-in benchmarks. Tasks and related suites already use concise domain fixtures and adversarial outcomes; no evidence supports removing their tests for a count target.
- Keep `buildRootForwardSpec` annotation test/export this pass: real history tests prove selection/isolation behavior but not every exact userEvent/addToHistory forwarding branch. Removing it now would need replacement coverage rather than eliminate redundancy.
- The Markdown collector remains needed for independent overlap/atomic widget branches; do not invent another shared abstraction just to move its lines.

## Validation

Run the same bounded Vitest directories plus retained notepadProposalAdapter before/after, capture executed case counts and wall time without claiming a speedup from noisy timing. Compare touched source/tests against baseline snapshot. Run focused mutation checks for (1) replacing minimal block change with whole-document replacement and (2) removing concealed inline markers to demonstrate retained coverage rejects the regressions. Restore mutations immediately; never run concurrent mutation checks. Root owns broad typecheck/integration.

## Comments

- Proposal prepared from direct source inspection and prior full module audit; documents owner confirmed retained composition ownership. Coordinator approval required before source edits.
