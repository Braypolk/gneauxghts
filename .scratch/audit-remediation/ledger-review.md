# Independent final finding-ledger review

Status: ready-for-agent
Progress: review complete; identified follow-ups in implementation/validation
Reviewer: editor agent; root requested independent ledger review after initial module completion

## Verdict

The 153 numbered source findings are all present exactly once (source+ID) and every referenced source report, outcome report and issue file exists. This does **not** establish complete remediation: multi-part findings and one unnumbered supplement exposed concrete omissions below. Findings.json truthfully says disposition recorded/final integration in progress rather than claiming final acceptance.

## Required corrections and work discovered

1. **AA-14 numerical half was missing.** UI/agent reports and issue 45 covered catalog policy only. Shared and Atlas cosine remained duplicated with different tiny-vector policy and nonfinite score hazards. Root authorized issue 99: shared finite arithmetic with explicit distinct policies and edge tables now passes 123 semantic tests / 2 ignored. Catalog outcomes remain separate. Ledger now also links 99.
2. **AA-12 Atlas decomposition had no disposition.** Chat extraction and frontend harness changes did not address Atlas publication/graph/layout/query ownership. UIX10's rejection of merging ANN adapters is a different proposal. Root assigned 99b to agent owner; owner reports private publication/query/geometry extraction, exact 27 test-body preservation, Atlas 27 / architecture 23 passing. Final combined validation is root-owned.
3. **AA-10 had incorrect bookkeeping, not missing code.** Ledger pointed at ordinary search issue 71 and agent report omitted an explicit AA-10 row. Actual evidence integration lives in issue 61 and `services/evidence/tests.rs::hybrid_composition_merges_agreement_widens_allowed_scope_and_reports_failure`. Inspected that test: real canonical note, lexical agreement, semantic-only match, excluded-neighbor widening, stale bytes, bounded coverage gap, provider-error lexical fallback. Corrected ledger issue link and explicit agent report row under root authorization.
4. **BB-05 deterministic native routing gap.** Root report points to harness-evaluations, whose contract section explicitly delegates task-save source/canonical identity/staged-vault real command/event acceptance back to root and disclaims live-suite substitution. Codec fixtures/browser callbacks are not that boundary. Root has assigned the missing test to UI owner; this review does not count it complete until implementation and real execution evidence appear.
5. **FE-11 and ED05 browser handoffs were unfulfilled.** editor.md delegates computed-style and offscreen-target validation to root. Existing formatting-load checked heading class/geometry, while navigation instrumentation selected an already-rendered first line and counted effects. No representative bold/italic/strike computed-style or actual offscreen reveal check was found. Root assigned targeted browser cases to documents owner.
6. **Unnumbered P2 task-date supplement was absent from 153.** Sol frontend-editor.md final supplement explicitly requests `passage_task_dates` serialization, clipping,16/17 ceiling, UTF8/CRLF and null boundaries. Only unprojectable complete:false existed, while editor.md handed the rest to root. Root assigned 99c to this owner. Treat as additional review work, not silently covered by the shared 23-case authored-date fixture or managed timestamp parser tests.
7. **EH-09 blanket bounded-sampler claim is too broad.** Targeted transient chat/pane loops were repaired, but editor-formatting-load still uses fixed 1200ms rAF-only sampling; window-resize and an earlier pane-animation sampler likewise end only inside rAF callbacks. Route/cleanup samplers have elapsed limits inside rAF but no independent finish timer. Source recommendation says every sampler, and report currently suggests broad completion. Root owns either bounded finish/cleanup or a concrete retained-policy disposition.
8. **EH-10 completion overstates removal.** Root report says no Vite internal dependency-URL coupling, but animation-navigation still discovers/imports Deck via ResourceTiming and a `deck.*core` URL regex. Fixed `/tmp` success screenshots also remain in note-tags and settings, despite issue 83 acceptance saying no assertion-free screenshots in ordinary gate. Clipboard cleanup and navigation module bridge were repaired; remaining instrumentation/artifact choices need implementation or explicit justified disposition. Root notified.

## Large rewrite decisions reviewed

Evidence-supported retained designs: editor full-decoration rebuild after scoped 1.70ms single-pane/3.43ms double-pane benchmark (viewport trigger removed); chat delta durability retained after connection reuse 78ms→9ms comparison; timeline transaction owner retained while codec extracted; global fixture lock retained because actual process-wide inputs remain; catalog watermarks retained with measured memory lower bound and stale-job regression; distinct ANN adapters/providers retained because manifests and failure behaviors differ. These are reasoned dispositions, not size-only deferrals. Atlas decomposition was the silent exception and is now 99b.

## Audit method and scope

Compared finding headings/bold IDs across all 13 source reports with all 153 source+ID rows; checked path existence and report references. Read module outcome tables and issue outcomes; resolved compressed ID ranges (AA03–04, FE01–03, FE04–06), so literal-string misses there are not omissions. Deep sampled implementation for cross-owned semantic/Atlas/catalog, actual evidence hybrid seam, root lexical/semantic candidate admission and native/browser harness boundary claims. Existing independent spec/standards/harness review reports were read as evidence, not treated as blanket proof of every line. No independent native/browser run was launched by this ledger review; root owns current integration. Apart from separately authorized 99 and AA10 bookkeeping, no production edits were made as review activity.

Canonical Status and separate Progress fields are present in issues. Many Progress fields explicitly remain reviewing or integration-pending; this is consistent with current work, not a hidden complete claim. Module reports carry older validation snapshots; use validation.md for final execution rather than summing overlapping targeted counts.

## Source accounting

| Source report | Numbered source findings | Ledger rows |
| --- | ---: | ---: |
| `.scratch/audit-remediation/sources/sol/reports/agent-app.md` | 14 | 14 |
| `.scratch/audit-remediation/sources/sol/reports/backend-boundaries-supplement.md` | 7 | 7 |
| `.scratch/audit-remediation/sources/sol/reports/backend-timeline.md` | 14 | 14 |
| `.scratch/audit-remediation/sources/sol/reports/cross-cutting.md` | 7 | 7 |
| `.scratch/audit-remediation/sources/sol/reports/e2e-harness.md` | 16 | 16 |
| `.scratch/audit-remediation/sources/sol/reports/frontend-documents.md` | 11 | 11 |
| `.scratch/audit-remediation/sources/sol/reports/frontend-editor.md` | 14 | 14 |
| `.scratch/test-suite-audit/reports/backend-agent-and-evidence.md` | 16 | 16 |
| `.scratch/test-suite-audit/reports/backend-persistence-and-timeline.md` | 10 | 10 |
| `.scratch/test-suite-audit/reports/editor-and-discovery.md` | 10 | 10 |
| `.scratch/test-suite-audit/reports/frontend-coordination.md` | 12 | 12 |
| `.scratch/test-suite-audit/reports/harness-and-suite.md` | 8 | 8 |
| `.scratch/test-suite-audit/reports/ui-settings-and-indexing.md` | 14 | 14 |

## Complete 153-row reference check

Every row below has an existing outcome report and issue reference. “Recorded” means a documented disposition was found; exceptions above override it and require their explicit follow-up. It is not an independently rerun acceptance result.

| Source finding | Owner | Outcome report | Issues |
| --- | --- | --- | --- |
| local CHAT-01 | agent | agent.md | 65-chat-admission-terminal, 65b-retry-lineage |
| local CHAT-02 | agent | agent.md | 66-chat-storage-tests |
| local CHAT-03 | agent | agent.md | 66-chat-storage-tests |
| local CHAT-04 | agent | agent.md | 66-chat-storage-tests |
| local CHAT-05 | agent | agent.md | 67-streaming-measurement |
| local EVIDENCE-01 | agent | agent.md | 60-evidence-continuations |
| local EVIDENCE-02 | agent | agent.md | 60-evidence-continuations |
| local EVIDENCE-03 | agent | agent.md | 61-evidence-snapshots-tests |
| local EVIDENCE-04 | agent | agent.md | 61-evidence-snapshots-tests |
| local RETRIEVAL-01 | agent | agent.md | 62-interactive-retrieval |
| local AGENT-01 | agent | agent.md | 68-agent-tool-context |
| local AGENT-02 | agent | agent.md | 68-agent-tool-context |
| local AGENT-03 | agent | agent.md | 69-runtime-harness |
| local AGENT-04 | agent | agent.md | 69-runtime-harness |
| local PROPOSAL-01 | agent | agent.md | 64-prepared-proposal-writers |
| local PROPOSAL-02 | agent | agent.md | 63-proposal-edits |
| local BP-01 | timeline | timeline.md | 50-fixture-lifetime |
| local BP-02 | timeline | timeline.md | 51-production-save-tests |
| local BP-03 | timeline | timeline.md | 52-task-schema |
| local BP-04 | timeline | timeline.md | 54-task-and-provenance-oracles |
| local BP-05 | timeline | timeline.md | 54b-task-match-candidate-index |
| local BP-06 | root | root.md | 72-small-backend-contracts |
| local BP-07 | timeline | timeline.md | 53-catalog-retries |
| local BP-08 | timeline | timeline.md | 56-default-volume |
| local BP-09 | timeline | timeline.md | 55-bounded-concurrency |
| local BP-10 | timeline | timeline.md | 58-private-timeline-modules, 59b-rust-architecture-source-scoping |
| local ED-01 | editor | editor.md | 35-editor-test-seams, 39-editor-verification-and-disposition |
| local ED-02 | editor | editor.md | 31-task-lifetime-projections |
| local ED-03 | editor | editor.md | 30-discovery-admission |
| local ED-04 | editor | editor.md | 33-unicode-discovery-navigation |
| local ED-05 | editor | editor.md | 21-navigation-target-admission |
| local ED-06 | editor | editor.md | 34-clipboard-and-markdown-context |
| local ED-07 | editor | editor.md | 36-decoration-work-and-catalogs |
| local ED-08 | editor | editor.md | 35-editor-test-seams, 37-image-jobs-and-scale |
| local ED-09 | editor | editor.md | 38-mru-and-wikilink-contracts |
| local ED-10 | ui | ui.md | 40-app-listener-lifetime |
| local FC-01 | documents | documents.md | 22-sequence-reference-oracle |
| local FC-02 | documents | documents.md | 23-document-adoption-and-refresh |
| local FC-03 | documents | documents.md | 29-cleanup-and-disposition |
| local FC-04 | documents | documents.md | 29-cleanup-and-disposition |
| local FC-05 | documents | documents.md | 23-document-adoption-and-refresh |
| local FC-06 | documents | documents.md | 29-cleanup-and-disposition |
| local FC-07 | documents | documents.md | 29-cleanup-and-disposition |
| local FC-08 | documents | documents.md | 24-real-command-composition |
| local FC-09 | documents | documents.md | 29-cleanup-and-disposition |
| local FC-10 | documents | documents.md | 25-real-proposal-adapter |
| local FC-11 | documents | documents.md | 25-real-proposal-adapter |
| local FC-12 | documents | documents.md | 27-history-interaction-coverage |
| local H1 | root | root.md | 84-fitness-contracts |
| local H2 | root | root.md | 84a-frontend-architecture-guards |
| local H3 | root | root.md | 82-execution-lanes |
| local H4 | root | root.md | 81-browser-fixture |
| local H5 | root | root.md | 80-harness-lifecycle |
| local H6 | root | root.md | 82-execution-lanes |
| local H7 | root | root.md | 83-browser-scenarios, 83a-browser-scenario-isolation |
| local H8 | root | root.md | 82-execution-lanes |
| local UIX-01 | root | root.md | 70-search-unicode |
| local UIX-02 | ui | ui.md | 41-chat-admission |
| local UIX-03 | ui | ui.md | 44-frontend-test-seams |
| local UIX-04 | ui | ui.md | 44-frontend-test-seams |
| local UIX-05 | ui | ui.md | 43-settings-admission |
| local UIX-06 | ui | ui.md | 43-settings-admission |
| local UIX-07 | ui | ui.md | 45-settings-boundaries |
| local UIX-08 | semantic | semantic.md | 90-semantic-retry-scheduling, 96-semantic-review |
| local UIX-09 | semantic | semantic.md | 91-semantic-work-oracle |
| local UIX-10 | semantic | semantic.md | 92-semantic-fixtures |
| local UIX-11 | semantic | semantic.md | 93-semantic-configuration |
| local UIX-12 | root | root.md | 72-small-backend-contracts |
| local UIX-13 | semantic | semantic.md | 94-semantic-installer |
| local UIX-14 | ui | ui.md | 42-atlas-lifetime |
| sol AA-01 | ui | ui.md | 41-chat-admission |
| sol AA-02 | ui | ui.md | 41-chat-admission |
| sol AA-03 | ui | ui.md | 42-atlas-lifetime |
| sol AA-04 | ui | ui.md | 42-atlas-lifetime |
| sol AA-05 | agent | agent.md | 62-interactive-retrieval |
| sol AA-09 | agent | agent.md | 61-evidence-snapshots-tests |
| sol AA-10 | agent | agent.md | 61-evidence-snapshots-tests |
| sol AA-06 | semantic | semantic.md | 95-semantic-concurrency-tests, 96-semantic-review |
| sol AA-07 | semantic | semantic.md | 69-runtime-harness, 93-semantic-configuration |
| sol AA-08 | ui | ui.md | 40-app-listener-lifetime, 43-settings-admission |
| sol AA-11 | agent | agent.md | 69-runtime-harness |
| sol AA-12 | ui | ui.md | 44-frontend-test-seams, 66-chat-storage-tests |
| sol AA-13 | ui | ui.md | 44-frontend-test-seams |
| sol AA-14 | ui | ui.md | 45-settings-boundaries, 99-cosine-domain-policies |
| sol BB-01 | root | root.md | 71-search-command-composition |
| sol BB-02 | root | root.md | 97-semantic-note-kind-admission, 98-lexical-note-kind-admission |
| sol BB-03 | root | root.md | 71-search-command-composition |
| sol BB-04 | timeline | timeline.md | 55-bounded-concurrency |
| sol BB-05 | root | root.md | 72-small-backend-contracts, 83b-native-evaluation-harness |
| sol BB-06 | timeline | timeline.md | 50-fixture-lifetime, 59-command-fixtures-refresh |
| sol BB-07 | timeline | timeline.md | 59-command-fixtures-refresh |
| sol BT-01 | timeline | timeline.md | 50-fixture-lifetime |
| sol BT-02 | timeline | timeline.md | 51-production-save-tests |
| sol BT-03 | timeline | timeline.md | 50-fixture-lifetime |
| sol BT-04 | timeline | timeline.md | 53-catalog-retries |
| sol BT-05 | timeline | timeline.md | 52-task-schema |
| sol BT-06 | timeline | timeline.md | 53-catalog-retries |
| sol BT-07 | timeline | timeline.md | 54-task-and-provenance-oracles |
| sol BT-08 | timeline | timeline.md | 55-bounded-concurrency |
| sol BT-09 | timeline | timeline.md | 56-default-volume |
| sol BT-10 | timeline | timeline.md | 57-typed-observation-errors |
| sol BT-11 | timeline | timeline.md | 58-private-timeline-modules |
| sol BT-12 | timeline | timeline.md | 59b-rust-architecture-source-scoping, 84-fitness-contracts |
| sol BT-13 | timeline | timeline.md | 59-command-fixtures-refresh |
| sol BT-14 | timeline | timeline.md | 59-command-fixtures-refresh |
| sol CC-01 | root | root.md | 84-fitness-contracts, 84a-frontend-architecture-guards |
| sol CC-02 | root | root.md | 84-fitness-contracts |
| sol CC-03 | documents | documents.md | 20-conflict-and-history-contracts |
| sol CC-04 | documents | documents.md | 20-conflict-and-history-contracts |
| sol CC-05 | root | root.md | 72-small-backend-contracts |
| sol CC-06 | agent | agent.md | 63-proposal-edits |
| sol CC-07 | agent | agent.md | 64-prepared-proposal-writers |
| sol EH-01 | root | root.md | 82-execution-lanes |
| sol EH-02 | root | root.md | 82-execution-lanes |
| sol EH-03 | root | root.md | 82-execution-lanes |
| sol EH-04 | root | root.md | 80-harness-lifecycle |
| sol EH-05 | root | root.md | 81-browser-fixture |
| sol EH-06 | root | root.md | 81-browser-fixture |
| sol EH-07 | root | root.md | 81-browser-fixture |
| sol EH-08 | root | root.md | 83-browser-scenarios, 83a-browser-scenario-isolation |
| sol EH-09 | root | root.md | 83-browser-scenarios |
| sol EH-10 | root | root.md | 83d-chat-instrumentation |
| sol EH-11 | root | root.md | 82-execution-lanes |
| sol EH-12 | root | root.md | 80-harness-lifecycle |
| sol EH-13 | root | root.md | 82-execution-lanes |
| sol EH-14 | root | root.md | 83b-native-evaluation-harness |
| sol EH-15 | root | root.md | 80-harness-lifecycle |
| sol EH-16 | root | root.md | 82-execution-lanes |
| sol FD-01 | documents | documents.md | 20-conflict-and-history-contracts |
| sol FD-02 | documents | documents.md | 21-navigation-target-admission |
| sol FD-03 | documents | documents.md | 22-sequence-reference-oracle |
| sol FD-04 | documents | documents.md | 25-real-proposal-adapter |
| sol FD-05 | documents | documents.md | 24-real-command-composition |
| sol FD-06 | documents | documents.md | 23-document-adoption-and-refresh |
| sol FD-07 | documents | documents.md | 29-cleanup-and-disposition |
| sol FD-08 | documents | documents.md | 26-async-completion-and-history-leases |
| sol FD-09 | root | root.md | 28-capability-fitness-reconciliation, 84-fitness-contracts, 84a-frontend-architecture-guards |
| sol FD-10 | documents | documents.md | 26-async-completion-and-history-leases |
| sol FD-11 | documents | documents.md | 27-history-interaction-coverage |
| sol FE-01 | editor | editor.md | 30-discovery-admission, 39-editor-verification-and-disposition |
| sol FE-02 | editor | editor.md | 30-discovery-admission |
| sol FE-03 | editor | editor.md | 30-discovery-admission |
| sol FE-04 | editor | editor.md | 31-task-lifetime-projections |
| sol FE-05 | editor | editor.md | 31-task-lifetime-projections |
| sol FE-06 | editor | editor.md | 32-task-mutation-contracts |
| sol FE-07 | editor | editor.md | 34-clipboard-and-markdown-context |
| sol FE-08 | editor | editor.md | 35-editor-test-seams |
| sol FE-09 | editor | editor.md | 35-editor-test-seams |
| sol FE-10 | editor | editor.md | 36-decoration-work-and-catalogs |
| sol FE-11 | editor | editor.md | 36-decoration-work-and-catalogs |
| sol FE-12 | editor | editor.md | 37-image-jobs-and-scale |
| sol FE-13 | ui | ui.md | 46-preference-behavior |
| sol FE-14 | ui | ui.md | 46-preference-behavior |

## Follow-up accounting after review

| Source scope | Issue / outcome | Validation and remaining owner |
| --- | --- | --- |
| AA-10 evidence composition |61; ledger link and explicit agent.md row corrected | Existing production-seam regression inspected; no source rewrite needed |
| AA-14 numerical policies |99; semantic.md |123semantic tests pass /2ignored; named finite policies implemented |
| AA-12 Atlas decomposition |99b; agent.md | Agent reports27Atlas/23architecture pass, exact test-body parity; root combined build |
| Unnumbered Sol frontend-editor task-date P2 supplement |99c; semantic.md |9task-date tests pass, test-only coverage; production retained |
| BB-05 command/event routing | Root assigned UI owner | Must append actual native execution before acceptance |
| FE-11 computed styles / ED05 offscreen reveal | Root assigned documents owner | Must append actual browser execution before acceptance |
| EH-09 remaining samplers |99d; root | Review gap acknowledged; implementation/validation in progress |
| EH-10 routine success artifacts / remaining Deck dependency |99e and root disposition | Do not retain blanket no-coupling claim without addressing Deck path |

The complete table above captures ledger references at review time; root is updating newly discovered99b+ child links in the central ledger. Supplemental99c is deliberately shown separately so153 numbered records are not misrepresented as exhaustive source scope. No remaining unindexed numbered source finding was found.

## Coordinator closure of all eight review gaps

All follow-ups now have implementation and acceptance:99 numerical policy;99b
Atlas extraction; AA10 bookkeeping;83c-native-command-event-contracts2/2;
83e rendered typography5/5 and real offscreen navigation3/3 plus the actual scroll
barrier fix;99c task-date9/9;99d browser sampler acceptance including corrected
retarget geometry8/8;99f native callback lifecycle4/4;99e failure-only screenshots
and explicit browser module imports in83e. The final combined gates pass, as
recorded in validation.md. The preceding review observations are historical
evidence of what was found, not outstanding work. All153 input rows remain and
the unnumbered supplement stays explicitly identified.
