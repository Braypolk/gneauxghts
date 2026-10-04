# Independent Standards review — complexity reduction

Progress: Complete against final source freeze for areas01/03/04/05/06. No source edits by reviewer.

## Scope and sources

Compared current files directly with `/var/folders/kt/bvxdjthn7558236cmffqpndm0000gp/T/gneauxghts-complexity-baseline-2zmbct53`, resolved from `baseline.json`; Git HEAD was not the baseline. Read the reduction spec, plan and proposals01–06. Standards sources: AGENTS.md, issue-tracker/triage conventions, ARCHITECTURE.md canonical ownership and fitness guidance, applicable behavior invariants (pane lifecycle/context, committed adoption, dirty tasks, History, proposal lifecycle), repository code-review and codebase-design skills.

Area02 is this reviewer's implementation and is excluded from independent acceptance here; its independent Spec review is owned separately. This is a source review, not a duplicate execution campaign. Owner logs and coordinator gates supply test/type/build execution evidence.

## Findings

No remaining actionable Standards violation found in reviewed areas01/03/04/05/06. One earlier issue06 correctness detail was reported and fixed: after merging Clear confirmation into the paged History journey, the post-clear wait initially observed an already-absent paging button. Current source waits for the actual `note-alpha-baseline-after-clear` revision before checking output and canonical arguments. Verified correction in `e2e/specs/browser/history-browsing.spec.ts`.

## Maintenance cost and ownership checks

| Area | Source evidence and review conclusion |
| --- | --- |
| 03 Settings/UI | Three single-consumer loader modules are deleted; native call names, typed results, history error normalization and page limit30 move directly into the existing owning store. Two module mocks/four parallel spies disappear; one command response map replaces them without a new framework. Dead semantic presentation logic disappears. Chat helper `Pick` inputs state the data actually consumed and eliminate complete fake DTOs; no casts replace their type requirements. Existing asynchronous admission and destructive action tests remain. This is a smaller interface and fewer interceptions, not relocation. |
| 04 timeline/tasks | Deleted domain methods are cfg(test) synthetic constructors/getters. Typed mutation-source constructors are exercised by the retained durable prepare→publish→read contract. Existing TestVault replaces repeated environment setup/cleanup while preserving lifetime and worker cleanup ownership; restart/damage-sensitive scenarios stay explicit. Beta identity joins retained Alpha/Child reorder assertions. Source scans stop duplicating executable frontend contracts while canonical write/routing prohibitions remain. No new fixture options, support interface or production policy introduced. |
| 05 agent/semantic | Actual provider-driver/read/proposal composition receives the transferred model-history assertion; the synthetic DynamicTool script is gone. Attachment filename/base64, exact prepared bytes and ANN manifest artifact assertions transfer into real existing persistence contracts. The obsolete alternate streaming writer and ignored comparison experiment are removed together. Retrieval loses five impossible-state fields and its dead source-selection branch; serialized command fields remain explicitly None, preserving current wire behavior. Existing TestVault is reused unchanged, including the distinct clear-during-read race that lacked another owner. No numerical/ranking contract changes or new adapter layers. |
| 06 coordinator | Browser dispatch/scroll interception machinery is removed in favor of retained actual offscreen geometry and reduced-motion pane behavior. Clear confirmation assertions are now on one existing mounted journey with an actual completion wait. Narrow/wide and both pane-side boundaries remain; default1440 scenarios remain elsewhere. AST tests stop pinning implementation field lists and reducer spellings while owner separation, external-sync routing and capability-bypass guards remain. Architecture text accurately narrows the guard description. |

No new test/source files or `as unknown`/`as any`/`as never` escapes were found in the completed snapshot diff. The remaining source-level heuristics (names, data clumps, message chains, duplicated switches) do not justify new layers or changes without demonstrated maintenance cost; none is raised as a hard finding. Local response maps and existing vault fixtures are appropriate boundary data, not duplicate domain algorithms.

## Area01 final review

Current workspace tests use the existing real WorkspaceStore/commands/document composition instead of maintaining a second membership/retirement model. Three support lines expose existing departure notification and use the actual conflict guard; no fake transition algorithm is relocated. Persistence fixture input is now a real persisted result converted through the normal snapshot constructor; the old snapshot→result round trip is removed. The small local controller setup supplies repeated real editing-service wiring without a new production seam. History SSR shares explicitly inert callback props, and distinct rendering/admission/stale-response cases remain. Omitted-selected-revision refresh is explicitly retained.

Final chat-adapter changes were inspected after owner freeze: the unused getEditorPaneIds dependency is removed from its type, test and Notepad call site; coordinator/proposal types now select only consumed members. Two whole-module casts disappear, and the fixture uses the real idle proposal session. Four fixture options reduce to the actual single-pane distinction without simulating pane transitions. The consolidated passage test retains exact backend request, current-note open and Unicode occurrence coordinates. No new production runtime behavior or abstraction is introduced.

The barrier retry test was correctly retained after mutation evidence showed persistence queue tests did not own its bounded-repeat behavior; it is not an implemented deletion. The final thirteen Rust TestVault caller conversions were also checked, including preparation failure and exact intent identity.

Owner01 reports 12 focused files/144 passing cases and zero svelte-check errors/warnings; those are owner execution results, not a test run by this reviewer. Coordinator broad gates remain the final integration authority. The Standards review is complete; area02 remains separately independently reviewed as stated above.

## Final verification follow-on: issue07 and History waits

Reviewed the exact final source changes only, without running tests or editing source. Issue07 adds only an explicit blocking mode on each accepted HTTP fixture stream before the existing five-second read timeout. The listener remains nonblocking for bounded accept/stop polling. Native Darwin flag evidence in `07-socket-flags.json` confirms inherited O_NONBLOCK=true and false after the explicit mode switch. Scripted responses, request bounds, probe/cache assertions and production code are unchanged. This directly corrects the observed immediate WouldBlock fixture failure without a retry framework or weaker assertions; no review finding.

Verified both final History wait locations: immediately after Load older click, `loadOlder.waitForExist({ reverse: true })`; only after Confirm clear click, the `note-alpha-baseline-after-clear` revision wait. The pre-clear baseline wait accidentally introduced during correction is absent. Source review approves these final changes; coordinator owns execution results.
