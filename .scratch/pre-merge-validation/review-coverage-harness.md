# Pre-merge coverage and harness review

Date: 2026-10-03
Reviewer: audit_ui_semantic (independent review; no source edits or execution)
Baseline: `cb4d4c02f0e2c1220d37b281ee300eff1aabf20b` to current working tree, including intentional new files.

## Outcome

One actionable harness finding remains at this checkpoint. No additional missing behavioral owner was found in the deletion/replacement reconciliation and current assertion samples below. This is a bounded source review, not a new passing acceptance result. Root owns execution and clean-checkout/package verification.

### P2 — Forced native-suite cancellation loses ownership of descendants

**Spec/correctness**, `e2e/support/nativeSuite.mjs:20–23,30–33`.

The native-suite wrapper sends TERM/INT to the WDIO launcher PID and, after ten seconds, SIGKILL to that PID alone. If launcher shutdown stalls, the fallback necessarily bypasses its `onComplete` cleanup. The embedded native app is a separate child: the installed `@wdio/tauri-service/dist/esm/index.js:1606–1614` calls `spawn(..., detached: false)`, and its `onComplete` stops embedded processes at lines 2698–2710. Killing its parent PID does not kill that app. The suite can therefore return cancellation with the native app still running; the next run encounters its occupied driver port or stale fixture owner. Vite is different: viteServer.ts already registers independent SIGTERM/SIGINT cleanup, so an asynchronously stalled service onComplete does not establish a Vite leak. A wholly blocked launcher event loop is outside this bounded finding.

This is not a request to kill listeners by port or name. Preserve explicit ownership across forced launcher termination, for example an owned launcher process group for inherited native/worker descendants while retaining the existing direct Vite signal cleanup. Verify the smallest change against actual process evidence before adding another ownership abstraction. Add a focused process fixture that stalls launcher cleanup with a live descendant/resource, cancels the suite, and requires the native descendant to exit while an unrelated sentinel remains alive. `nativeLifecycle.test.mjs:11–29` currently proves only graceful child exit with code zero and no second spec; it does not cover the forced branch. The failure path is established from code/OS process semantics; no reproduction was run under this review's no-execution constraint.

Applicable requirement: pre-merge spec, “Tests use only disposable vaults and owned servers/processes”; earlier execution-lane and lifecycle remediation require bounded cleanup. Root was notified before this report.

## Reconciliation across phases

The phase baselines are successive working-tree snapshots, not HEAD. Their reductions must not be summed as a net baseline test-count reduction: initial remediation and architecture work also added meaningful cases. I reconciled the saved phase maps with the integrated file inventory and sampled current surviving assertions. This does not claim line-by-line rereading of every removed case in the entire 290-file change.

| Phase | Ledger and measured disposition | Current integrated reconciliation |
| --- | --- | --- |
| Initial audit/remediation | `audit-remediation/{documents,ui,agent,harness-documents,harness-evaluations}.md`; per-finding issues | Fake controller/module tests replaced by real owner composition; native command/event acceptance added; all removed whole modules accounted for below. Browser split is scenario movement, not deletion. |
| Complexity reduction | `test-complexity-reduction/issues/01–07`, `reduction.json`, `validation.md` | 45 frontend, nine ordinary Rust and four browser executions removed in that phase; dead forwarding/fixture layers removed. One obsolete opt-in Rust benchmark retired. Saved maps identify retained owners and intentional low-value detection losses. |
| Architecture simplification | `architecture-simplification/{documents-implementation,ui-implementation,backend-result}.md`, issue01/04/05/06/07/08 | Obsolete callback protocol suites replaced by session/aggregate/document-review operations. Current tests still use actual workspace/document/editor owners rather than reproducing removed state policy in fakes. Added race fixes remain. |
| Final test reduction | `test-reduction/01–06` audit/result maps, `changes.json`, `source-changes.patch`, independent reviews | 97 executable cases: workspace34, editor16, UI22, timeline13, other backend/architecture10, browser/native2. Five duplicate inline-format fixture rows explicitly are not counted as cases. Two files deleted, five unused Rust test-only accessors removed; compile-required receipt getters were restored. No production edits or skip substitution in that phase. |
| Rust slow-test improvements | Both slow-test phase specs, fixture recipes, prior independent Spec reports | Workload setup reduced while boundary assertions remain. Archive-prefix checkpoint test exercises live writes127–139, requires exact delta127/checkpoint128/deltas129–139, and reopens for reconstruction. These are fixture substitutions, not removals or ignored default correctness cases. |

The final reduction ledger explicitly acknowledges discarded trivia rather than claiming equivalent coverage: catalog alias spellings, simple forwarding equality, exact spare ANN capacity, static app title and constructor/getter echoes. Those are approved maintenance tradeoffs. Distinct wire transformations, actual permissions/privacy, stale reply/error schedules, corruption, rollback/restart, selection/undo and platform rendering remain separate owners.

### Every whole test module removed against HEAD

The diff contains sixteen whole test-module deletions. All have a disposition:

| Deleted module (paths relative to repository) | Surviving owner / intentional retirement |
| --- | --- |
| `e2e/specs/browser/document-and-pane.spec.ts` | Seven independently seeded specs: workspace-document-lifecycle, workspace-editor-layout, workspace-pinned-notes, history-entry-and-return, history-citations, history-browsing, settings-history-maintenance. Current title scan locates every original literal-named case; the single renamed paging/return/restart case remains in history-browsing. Three layout rows remain a table. Original split ledger records117/117 moved expectations; later browser removals are separately mapped. |
| `src-tauri/src/services/evidence/live_evaluation.rs` | Obsolete independent raw-HTTP/tool loop archived as historical material, not represented as production runtime acceptance. Current runtime tests and six explicitly configured native live suites use the actual AgentRuntime/IPC seam. Fixed-evidence grading remains separate. |
| `notepad/editor/indentConfig.test.ts` | Direct CodeMirror facet/default trivia retired; actual indentation/outdent/undo/caret commands remain. |
| `notepad/images/imagePerformance.test.ts` | Reference reuse retained in `imageEmbedWidgets.test.ts` with selection/source transitions and independent pane lifetime. Removed repeated selection loop had no latency budget; no performance equivalence is claimed. |
| `notepad/orchestration/noteCommandController.test.ts` | `notepadComposition.test.ts`: independent/shared-document opens, failed save admission, proposal readback, canonical mismatch/conflict, Remember/MRU and rendered-readiness separation. |
| `notepad/orchestration/documentDepartureController.test.ts` | `notepadWorkspaceSession.test.ts` plus composition/persistence: assigned identity before finalization/cursor, serialized sibling departures, failed prerequisite/retry and last-editor semantics. |
| `notepad/orchestration/locationHistoryController.test.ts` | Workspace-session previous/explicit/beside-editor chat restoration, missing target fallback, seed retry, overlapping restore success/failure and MRU cleanup. |
| `notepad/orchestration/paneCommandController.test.ts` | Workspace-session picker currentness/no-target and pane/store composition; obsolete callback forwarding retired. |
| `notepad/orchestration/paneCommandGroup.test.ts` | Session's complete command operations and real pane lifecycle/composition; eliminated group wrapper protocol has no independent behavior owner. |
| `notepad/orchestration/paneNavigationTransitionPipeline.test.ts` | Real session departure order, admission, stale load rejection, failure cleanup and pending disposal; eliminated phase-callback spelling/order is intentionally retired. |
| `notepad/orchestration/paneSessionController.test.ts` | Session destination/adoption and chat context restoration plus composed pane lifecycle. |
| `notepad/workspace/paneCapabilityWiring.test.ts` | Consolidated AST ownership/permission checks in `architectureFitness.test.ts`; scanner mutation cases still reject reversed/bracket/local-alias violations and ignore comments/shadowed variables. |
| `settings/ForgottenNotesPanel.svelte.test.ts` | Mounted Settings destructive confirmation/purge with command evidence; store recovery/mutation tests. Exact duplicate explanatory prose deliberately retired. |
| `settings/MissingNotesPanel.svelte.test.ts` | Mounted retained history paging/recovery preserves canonical neighbor and destination identity; store pagination/stale-error/delete/recovery tests. Duplicate initial prose retired. |
| `settings/refreshCoordinator.test.ts` | Coordinator forwarding layer removed; real Settings visibility/command routing and stale slice/lifetime cases exercise its owner. |
| `settings/semanticStatus.test.ts` | Dead semanticStatusLabel removed; actual SemanticSettingsPanel readiness/retry rendering covers remaining predicate, including exhausted retry. |

The frontend paths in this table are beneath `src/lib/features/`. Source-only deleted facades/loaders are accounted for in their phase designs and do not hide additional test files. `scripts/history_index_baseline.py` is byte-identical to `scripts/archive/history_index_baseline.py` in the current tree; it is explicitly archived rather than silently lost.

## Current assertion samples

I inspected current bodies and their setup boundaries, not only historical reports:

- `notepadWorkspaceSession.test.ts` constructs real composition and disposes it. It asserts saved canonical identity before cursor capture, finalization failure leaves the editor/conversation unchanged, same-pane supersession binds only the newest document, pending reads cannot bind after disposal, and review presentation rechecks capacity after waiting. Typed terminal I/O/presentation spies do not implement workspace membership policy.
- `notepadProposalAdapter.test.ts` retains actual runtime review ownership through route teardown/remount; an in-flight commit settles once and preserves newer edits. Disk reload targets reviewed A while visible B remains unchanged; no proposed text is saved; failed disk read and later typing retain protected review content. Terminal save failure retains the exact document/runtime rather than discarding unsaved bytes. These replace several lower-level happy-path cases without losing failure or identity outcomes.
- `history-browsing.spec.ts` still verifies real paging, read-only history, clear completion, exact restored editor selection/scroll and absence of History after reload. `history-controls.spec.ts` independently verifies naming remains bound to the captured row and pending restore blocks Escape/exit, while cancellation emits no restore command.
- `settings-history-maintenance.spec.ts` opens destructive confirmation, checks irreversibility wording and actual clear/delete commands; recovery checks the recovered path and unchanged other-note path. These are actual mounted replacements for the two removed SSR modules.
- `imageEmbedWidgets.test.ts` checks the exact same inventory reference after a selection/source change and distinct pane lifetime/source state; it is not merely a parser self-comparison.
- Chat lifecycle/event suites retain real-controller listener acquisition/disposal and terminal admission scenarios; failed-open machine recovery remains. Aggregate tests cover late receipts/retained terminal events and reentrant selection. Shared API fakes remain fail-fast and typed. Frontend AST tests still prohibit mirrored backend fields and direct membership/permission writes; removed exact helper call counts are not safety requirements.
- `native/command-events.spec.ts` uses real native invoke and the production AppStore event consumer. It compares saved note identity/path/title/revision, taskAction history body, taskMutation source/document kind, full staged VaultInfo equality and a canonical save remaining in the running vault. This is stronger than codec-only/browser-fake mapping; those other boundaries remain distinct.
- Slow Rust fixture assertion inspection is captured in this reviewer's earlier `rust-slow-test-improvements/review-spec.md` and `rust-slow-tests-remaining/review-spec.md`. Those reports include actual archive digest/SQLite metadata inspection, not only generator claims. No fresh archive extraction or Rust execution was performed in this pre-merge review.

## Default execution and packaging

- `pnpm test` now executes Node support tests before Vitest. The new CI workflow installs frozen dependencies, runs frontend/typechecks/support, Python with ResourceWarning as an error, and macOS Rust library plus architecture tests. It does not pretend browser/native/live/provider gates ran in CI; root's pre-merge execution supplies the graphical gates. There was no prior workflow removed to downgrade.
- Native smoke grows from the former three-spec command chain to seven deterministic files, each in a fresh WDIO invocation. Browser specs are still discovered by the complete browser glob. No `.only` or unexplained skip was found in the reviewed browser/default harness changes.
- The sustained1MiB native editing sampler intentionally moved from default native execution to the explicit measurement lane, as approved in issue82. It had no latency threshold; its output now correctly says observation-only. The functional Editing Window case remains in smoke. Chat-typing's explicit delay prerequisite and live-provider opt-ins remain explicit; this is a documented execution change, not a hidden full-suite pass. Live artifacts distinguish structural success from `semanticGrading.status = not_run`.
- New ignored Rust scale diagnostics are additive, not converted default correctness tests: task candidate-work timing and the semantic20k distribution. The latter has a default corpus-independent SQL-work regression. Fixture generation is deliberately ignored and checked-in archives are required; ordinary consumers fail if missing/stale rather than rebuilding or skipping.
- Five `src-tauri/test-fixtures/history-read/*.json.zst` files and their README/generator must be included as intentional new merge inputs. `fixture_path` resolves against compile-time `CARGO_MANIFEST_DIR`, not an agent's checkout. Archives contain declared synthetic root paths rebased into a fresh TestVault, allowlisted files, digests and schema/recipe validation. No agent-local path is needed to consume them. Clean-checkout execution is still root's separate acceptance obligation.
- Native binary admission requires an E2E-feature manifest/hash and compiled markers; debug port selection is checked. Fresh native builds are required by root's spec. Native fixtures use owned OS temporary roots; workers may reuse but cannot delete the launcher fixture and symlink aliases are rejected. Scale fixtures require an explicit marker.
- Source/script scan found no checkout-specific `/Users/...` or `/var/folders/...` dependency in the reviewed executable harness. A `/tmp/result.json` string is confined to live-artifact unit-test configuration, not production fixture input. Diagnostic reports retain historical local paths as evidence; they are not runtime dependencies.
- Exclude generated `scripts/**/__pycache__/*.pyc` and raw local outputs from the proposed merge as the pre-merge spec states. New source, workflow, support tests, docs and fixture archives are intentional inputs. This review did not stage files or certify root's eventual packaging manifest.

## Other process/lifetime checks

`ownedServer` refuses a foreign occupied port, admits only its nonce endpoint, bounds hung HTTP requests, stops its own process group, and cleans failed startup. Current support tests cover foreign server preservation, identity mismatch/hung fetch, cancellation and TERM-resistant children. The root-level restart/process-relaunch runners independently retain exact owned child PIDs, verify listener PID and canonical disposable vault before writes, and exercise real shutdown/relaunch rather than reloading a webview. Their cleanup does not discover and kill arbitrary listeners. Native service setup awaits Vite before application startup and joins cleanup on failure; preparation/cleanup failures are fatal. These strong local ownership paths do not resolve the outer nativeSuite forced-cancellation gap above.

Browser reset uses an inert same-origin E2E document before clearing storage and mounting fresh owners, preventing old persistence callbacks from repopulating storage during reset. Animation/measurement callbacks now have independent deadlines, exactly-once completion and frame/listener cleanup; required motion/selection/geometry assertions remain. Independent live/provider grading remains unexecuted and is not inferred from support tests.

## Coverage and review limits

Read-only static inspection; no build, test, UI launch, signal experiment, install or source edit by this reviewer. Reviewed complete harness/module deletion inventory, phase deletion maps, relevant current test bodies, CI/package entry points, new support implementations/tests, driver service lifecycle, fixture paths/recipes and script changes. Detailed current assertion sampling concentrated on data loss/identity, destructive history, stale/lifetime races, native dispatch, process ownership and portable inputs; every individual assertion in every changed test was not reread. Earlier phase counts and mutation results are attributed to their saved evidence, not claimed as freshly reproduced here.

Readiness: resolve or explicitly disposition the P2 cancellation ownership finding, then combine this review with root's clean-checkout and full execution evidence. No further coverage blocker was identified within the stated scope.

## Issue03 correction checkpoint

Root reproduced the inherited native-listener leak using the actual wrapper (`native-cancel-before.log`); Vite's independent cleanup and foreign sentinel preservation behaved correctly. Under explicit follow-up authorization, the reviewer then implemented the narrow Unix launcher-group correction in issue03 and strengthened the existing fast cancellation case. This was a separate correction phase after the read-only review, not a claim that this reviewer remained independent of that fix. Exact diff: `native-cancellation-fix.patch`. Audit_agent owns independent fix review, and root owns forced/ordinary execution. Windows remains PID-only; no broader platform guarantee is claimed. Final readiness depends on those results, not only the static correction.
