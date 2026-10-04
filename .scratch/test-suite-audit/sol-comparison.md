# Comparison with “Audit tests and codebase sol”

Compared on 2026-10-03, before further implementation. This comparison changes audit documentation only. No source/test changes were transferred between worktrees.

## Sources and comparability

- This audit: [index](README.md), [review](review.md), [validation](validation.md); worktree `c74a`.
- Sol chat: `01a10048-5461-7593-973a-0d4b1c12da48`, exact title **Audit tests and codebase sol**; worktree `2ed7`.
- Sol artifacts: [index](/Users/bray.polkinghorne/.codex/worktrees/2ed7/Gneauxghts/.scratch/test-suite-audit/README.md), [review](/Users/bray.polkinghorne/.codex/worktrees/2ed7/Gneauxghts/.scratch/test-suite-audit/review.md), [validation](/Users/bray.polkinghorne/.codex/worktrees/2ed7/Gneauxghts/.scratch/test-suite-audit/validation.md), [coverage ledger](/Users/bray.polkinghorne/.codex/worktrees/2ed7/Gneauxghts/.scratch/test-suite-audit/coverage-ledger.md).

Both worktrees have the same HEAD: `cb4d4c02f0e2c1220d37b281ee300eff1aabf20b`. Both baseline frontend runs found 141 files and 1,007 passing tests. Differences therefore reflect inspection, grouping and subsequent uncommitted patches, rather than different starting versions.

This audit has six module reports and 14 handoff issues. Sol has seven module reports, 83 named findings and 18 handoff tickets, including dated supplementary inspections. Those counts are not a quality score: individual findings overlap, and a ticket can combine several findings. Sol explicitly records that its supplementary inspections followed the first cleanup; they should not be described as all preceding implementation.

Comparison method: read the other chat's completed work and saved reports/review/validation, map findings by behavior rather than title, inspect changed-file overlap and selected production paths/diffs. The late chat receipt, proposal occurrence enumeration and typed replay conversion were rechecked in source; Sol's conflict/error-parser fixes were inspected in its diff. This comparison did not rerun regression suites or independently reproduce every reported defect. Validation results below are the recorded results of each audit.

## Assessment

The audits are complementary. Both identify the same central problem: some tests duplicate policy or setup while failing to exercise actual production coordination. Neither supports deleting large numbers of tests just because several layers describe the same feature. Both recommend repairing test oracles and exercising real owners before splitting large modules.

Sol is stronger on frontend receipt/conflict/navigation interleavings, browser fixture fidelity, obsolete harness behavior and explicit inventory reconciliation. This audit adds important editor, Unicode, evidence-pagination and durable chat findings. Neither report subsumes the other. Use a deduplicated union as the implementation backlog.

## Shared findings, grouped by module

| Module | This audit | Sol | Combined disposition |
| --- | --- | --- | --- |
| Documents/workspace/proposals | FC-01/02/08/10, FC-03/09 | FD-03/04/05/06/07 | Repair the sequence oracle that accepts unexpected exceptions; replace the hardcoded proposal fake with real extension state; build a real-owner composition harness; consolidate adoption mechanics and ineffective assertions. |
| Editor/tasks/discovery | ED-02/03/07/08/09 | FE-01–12 | Fix stale/disposed completions; use real editor state for undo and sibling tests; reconcile duplicated Markdown scans; replace mirrored catalogs with behavior coverage. Sol already fixed search/related invalidation in its worktree. |
| Chat/Atlas/Settings | UIX-02/04/05/06/14 | AA-02/03/04/08/13 | Correct partial listener initialization and stale response admission; stop testing copied AppStore policy; retain useful escaping coverage while strengthening action/privacy assertions. |
| Persistence/timeline | BP-01/02/03/04/07/08/09/10 | BT-01/03/05/06/07/08/09/11; BB-04/06 | Isolate global fixtures, initialize bound schemas once, remove false assertions, bound waits, size default fixtures around actual thresholds, and split private responsibilities without creating another persistence owner. Retry scans and retained watermarks are related but distinct costs. |
| Retrieval/agent/proposals | RETRIEVAL-01, EVIDENCE-04, AGENT-03/04, PROPOSAL-01/02 | AA-05/07/09/10/11; CC-06/07 | Exercise actual adapters and orchestration; reuse reads only within freshness boundaries; retire the duplicate live protocol and unused unprepared writers. Sol adds a concrete proposal ambiguity defect to our general missing-coverage finding. |
| Semantic execution | UIX-08/09/10/11 | AA-06/07/14 | Replace controllable waits, restore global configuration, make scale assertions observe real work, and preserve different ANN/chunk/note contracts. Measure before promising performance gains. |
| Harness/fitness/contracts | H1–H8, BP-06 | EH-01–05/08–12/14; CC-01/02/05; BT-12 | Remove the redundant compiler scan, make source guards less spelling-dependent, admit owned servers only, reject unknown fixture commands, define explicit native/live/scale lanes, and reject impossible calendar dates. |

Finding identifiers refer to the baseline reports. Similar rows do not imply every subcase is identical or already fixed.

## Additional findings from Sol to carry forward

These were absent as concrete findings here, or materially sharpen this audit's broader recommendations.

| Module / Sol ID | Additional finding | Status in Sol worktree |
| --- | --- | --- |
| Chat AA-01 | A delayed send receipt unconditionally replaces an assistant already advanced by events and restores `activeRequestId`, even after the machine rejects late acceptance. Can erase output/evidence or revive a completed request. | Open; source path rechecked during comparison. |
| Documents FD-01 | Initial or rollback editor replacement rejection leaves an external conflict in `applyingExternal`, blocking both choices. | Fixed, with rejection and superseding-conflict regressions recorded. |
| Navigation FD-02 | Recent Task opens note B then checks the captured identity of previous note A, preventing cross-note task focus. | Open; report traces real context construction. Complements our offscreen/coordinate findings. |
| Contracts CC-03 | `value in COMMAND_FAILURES` admits inherited keys into a closed error vocabulary. | Fixed using own-property membership and malformed-input tests. |
| Proposals CC-06 | Non-overlapping `match_indices` treats `ana` in `banana` as unique, or misses a context-selected overlapping occurrence. | Open; standalone probe recorded by Sol, implementation rechecked here. |
| Timeline BT-10 | String formatting converts typed replay errors such as Corrupt/Stale into Unavailable. Existing `with_context` preserves classification. | Open; conversion path rechecked. Do not infer that every inner corruption latch is bypassed. |
| Search BB-01/02/03 | Result-cache keys omit title; eligible-note filtering follows result truncation; a purported concurrent search test fabricates results at the lower CurrentContent boundary. | Open. Add deterministic command reproductions before cache/ranking changes; title omission is not yet an interactive reproduction. |
| Persistence BT-01/02/04/13 | Unguarded canonical writers can consume another test's global fault; a test-only save implementation differs from production; a catalog test manually performs the projection it claims to test; a damaged-metadata test starts with repaired metadata. | Identified writer locks and manual second projection fixed. Replica migration and metadata oracle remain open. |
| Browser fixture EH-05/06/07 | Event handlers never deliver events; a held save targets mutable active state rather than its command identity; an unused large-history branch has no scenario owner. | Open. These are fixture defects, not evidence of an equivalent production save bug. |
| Native/evaluation EH-11/13 | Default native functional tests include a 1 MiB observational workload without a performance threshold; source-request evaluation incorrectly requires empty streaming content. | Obsolete streaming assertion and historical wording fixed; workload classification remains open. |
| Python EH-15 | SQLite connection context managers commit/rollback but do not close connections. | Fixed in fixture script/tests; warning-strict suite recorded. |
| Lifecycle/wire BB-04/05/07 | Restart test can deadlock during unwinding before latch release; fixture presence is weaker than actual dispatch/event coverage; a legacy refresh-age argument and associated waiting are obsolete. | Open; deliberately hanging the test was not attempted. |
| Smaller coverage gaps FE-13/14, FD-08/10, CC-04, AA-14 | Retention queue and typography persistence/CSS, task-date clipping/serialization, microtask polling, global navigation-history suppression, fixture exhaustiveness and duplicated catalog/numerical policy. | Open; several are coverage/design questions rather than demonstrated defects. |

Primary Sol sources: [documents](/Users/bray.polkinghorne/.codex/worktrees/2ed7/Gneauxghts/.scratch/test-suite-audit/reports/frontend-documents.md), [editor](/Users/bray.polkinghorne/.codex/worktrees/2ed7/Gneauxghts/.scratch/test-suite-audit/reports/frontend-editor.md), [agent/app](/Users/bray.polkinghorne/.codex/worktrees/2ed7/Gneauxghts/.scratch/test-suite-audit/reports/agent-app.md), [timeline](/Users/bray.polkinghorne/.codex/worktrees/2ed7/Gneauxghts/.scratch/test-suite-audit/reports/backend-timeline.md), [backend supplement](/Users/bray.polkinghorne/.codex/worktrees/2ed7/Gneauxghts/.scratch/test-suite-audit/reports/backend-boundaries-supplement.md), [cross-cutting](/Users/bray.polkinghorne/.codex/worktrees/2ed7/Gneauxghts/.scratch/test-suite-audit/reports/cross-cutting.md), [harness](/Users/bray.polkinghorne/.codex/worktrees/2ed7/Gneauxghts/.scratch/test-suite-audit/reports/e2e-harness.md).

## Additional findings from this audit to retain

| Module / this audit ID | Additional evidence or recommendation | Status here |
| --- | --- | --- |
| Editor ED-01 | Sibling synchronization maps every transaction in a batch from the same original pane state. Real CodeMirror reproduction establishes the failure; chained states preserve the batch and undo behavior. | Fixed with regressions. Sol noted fake/runtime weakness but did not identify this concrete defect. |
| Search UIX-01 / ED-04 | Rust lowercasing changes UTF-8 byte coordinates before slicing original text; frontend highlights mix UTF-16 offsets with code points. Concrete Unicode examples establish failures. | Open; preserve both backend panic and frontend highlighting cases. |
| Editor/navigation ED-05/06 | Offscreen destinations rely on visible DOM; clipboard await can delete the newly current block after copying a different block. | Open. Separate from Sol's captured pre-open identity defect. |
| AppStore ED-10 | Staged listeners leak when disposal occurs between partial attachment and remaining initialization. Production-method controlled probes establish two interleavings. | Open. Important qualification to Sol's recommendation to reuse the AppStore listener pattern. |
| Evidence EVIDENCE-01/02 | Capacity check rejects continuation of an already issued 32nd search cursor; inventory pages recreate searches and retain unnecessary intermediate data. | Open; preserve same-session pagination regression recipes. |
| Durable chat CHAT-01/04/05 | Admission spans autocommitted records before complete run context; terminal persistence failures need direct coverage; connection policy is inconsistent; every delta rewrites accumulated output. | Open. Failure boundaries need actual operation tests; streaming cost is unmeasured. Ordinary archived deletion already enables foreign keys—do not claim that path leaks. |
| Agent AGENT-01/02 | Real tools need a deterministic app-owned context seam; synchronous tool work should consistently use existing blocking dispatch. | Open; deeper than merely retiring the shadow evaluation loop. |
| Cleanup FC-04/06/07/12, BP-05 | Suite-owned registry runtimes leak; three pane helpers are test-only; an orphan branch is unreachable; SSR assertions duplicate; TaskRecord construction repeats. | Bounded cleanup implemented here. Quadratic task matching remains a profiling question. |
| Architecture H1 | The compiler test's path filter constructs a double slash and scans no source files. Independent compiler proof shows the ordinary typecheck still rejects removed typed fields. | Removed. Additional evidence beyond Sol's redundancy argument. |
| Semantic/assets UIX-09/12/13 | A 20k fixture does not observe the alleged no-walk work; potential asset check/write collision needs dispatch evidence; installer lacks cheap deterministic failure/success cases. | Open; asset concurrency remains a hypothesis, not a confirmed race. |

Sources: the six [local module reports](README.md#module-reports), with reproduction artifacts and confidence limits linked there.

## Recommendations to reconcile, rather than copy verbatim

1. **AppStore is not yet a safe listener-lifetime template.** Sol AA-02 recommends its aggregate admission pattern. ED-10 demonstrates leaks in that implementation. Keep attempt-local acquisition, cleanup and shared initialization concepts, but prove all acquisition/disposal interleavings before reusing the implementation.
2. **Keep cheap sequence coverage while fixing its oracle.** Sol suggests replacing repetitive triples with stronger model/longer-sequence coverage. This audit measured the existing suites at roughly 165/182 ms. The swallowed-error oracle must change; deleting the matrices is not a high-value speed optimization by itself. Compare meaningful transition/outcome coverage first.
3. **Incremental editor decoration work needs measurement.** Sol proposes broader incremental recomputation; this audit emphasizes semantic/parser correctness and measuring actual decoration work first. Implement a demonstrated bottleneck without losing whole-document or viewport behavior.
4. **Choose one ordinary harness gate.** This worktree exposes `test:support`; Sol exposes and includes its support gate in ordinary `pnpm test`. Sol's integration better closes accidental omission. Preserve the expensive build-artifact probe as a separate command; avoid two equivalent support aliases unless needed for compatibility.
5. **Native coverage needs an explicit manifest, not an unrestricted glob.** Both find missing deterministic coverage; live/model/scale tests intentionally remain opt-in. Neither audit executed native/browser validation, so neither proves broader native enrollment is currently green.
6. **Do not interpret file splitting as removal of an owner.** Both preserve NoteTimeline, SQLite transaction locality, runtime permissions, document identity and operation admission. Shared fixture mechanics and private modules are appropriate; another public storage/mutation abstraction is not justified by these audits.

## Implementation overlap and validation

Both patches remain uncommitted in separate worktrees. Six tracked files are modified in both:

- `e2e/README.md`
- `package.json`
- `src-tauri/src/services/task_mutation.rs`
- `src/lib/architectureFitness.test.ts`
- `src/lib/features/notepad/document/documentEditingService.test.ts`
- `src/lib/features/notepad/pane/paneTransientUiController.test.ts`

Shared edits include removing the compiler scan, the fake task failure case and ineffective assertions. Reconcile these changes once. Retain this worktree's literal task-output oracle alongside Sol's missing writer lock. Package/README changes require a deliberate unified gate. The other changed paths do not overlap textually, but still require integration tests after combining.

| Check | This worktree | Sol worktree |
| --- | --- | --- |
| Frontend after cleanup | 141 files / 1,008 passing tests | 141 files / 1,030 passing tests |
| Types | Svelte and E2E checks pass | Svelte and E2E checks pass |
| Rust | Final full run plus isolated sandbox-blocked localhost retry: 710 library + 19 architecture pass; 16 ignored | Full baseline 711 library + 19 architecture pass; after cleanup 34 affected tests pass; false duplicate removed; 16 ignored |
| Cheap Node / Python | 8 / 8 pass | 8 / 8 pass; Python warnings elevated |
| Browser/native/live/scale | Not executed | Not executed |

The frontend test-count difference reflects different regressions added, not a comparable coverage percentage. Cold/warm timing differences do not establish a controlled speedup. Sol also records pre-existing formatting differences in five untouched Rust files. The combined patch has not been assembled or validated.

## Unified order for subsequent work

1. Reconcile the existing bounded patches, retaining both sets of regressions and a single support gate. Review the combined diff and run the relevant combined checks.
2. Address concrete correctness failures in cohesive modules: chat receipt/listener lifetime and AppStore; Unicode search and proposal ambiguity; evidence continuation/page reuse; task/navigation/clipboard admission; typed replay errors and backend search composition.
3. Repair misleading tests before large extractions: sequence oracle, proposal extension fake, actual retrieval/search command boundaries, damaged metadata, and production save/admission/finalization rather than test-only replicas.
4. Consolidate explicit Rust fixtures and bound storage, remove obsolete writers after migrating behavior coverage, then extract private timeline/chat responsibilities and a deterministic real-tool test seam.
5. Rewrite the browser fixture and owned process/frame helpers, define execution lanes/CI, and make performance changes against measurements. Run native/browser evidence where the affected contracts require it.

This order is a combined recommendation, not a claim the work has been completed. No additional product decision or approval was inferred from this comparison request; further implementation was paused to perform this comparison first.
