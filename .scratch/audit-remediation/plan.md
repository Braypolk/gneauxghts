# Combined audit remediation plan

Date: 2026-10-03. Coordinator: root. Input ledger: [153 named findings](findings.json); original comparison: [audit comparison](../test-suite-audit/sol-comparison.md).

## Execution and delegation

Six active slots: coordinator plus five module agents. Each module agent writes its child issues before code changes, reports discoveries that alter scope, implements its unblocked children, and records exact verification. Child issues use canonical triage Status plus an independent Progress field (planned / investigating / implementing / reviewing / complete). The coordinator owns this plan and the central findings ledger. Other agents own their allocated child issue files and module report.

| Workstream / child issue range | Responsible agent | Scope and concrete deliverables | Dependencies |
| --- | --- | --- | --- |
| Integration and final review, 01–09 | root | Snapshot source audits; reconcile shared existing patches; assign all findings; integrate shared interfaces; complete full checks and independent Standards/Spec reviews | All modules |
| Documents, 20–29 | audit_documents | Conflict recovery; independent workspace oracle; real proposal extension and owner composition harness; normalized adoption; external refresh experiment; post-open navigation; history/contracts | Editor navigation adapter; root source guards |
| Editor/discovery, 30–39 | audit_editor | Reconcile Sol search/related fixes; task lifecycle/admission; Unicode frontend offsets; offscreen navigation; stale clipboard guard; Markdown parser consolidation; real undo/fakes and boundary tests | Documents owns openFlow; root owns Rust search |
| Frontend UI lifetime, 40–49 | audit_ui_semantic | Late chat receipt; staged/partial listener lifetime including AppStore; typed shared test harness; Atlas/Settings races; retention and typography; meaningful privacy/render tests | Root browser lane for required DOM evidence |
| Timeline/persistence, 50–59 | audit_timeline | Typed replay errors; fault-consumer locks; disposable RAII fixtures; production save tests replacing replica; bound schema initialization; retry work; bounded concurrency; threshold fixtures; private storage organization | Shared fixture API to root query tests; root architecture guards |
| Agent/evidence/chat, 60–69 | audit_agent | Cursor capacity/page reuse; overlapping proposal anchors; prepared writer migration; real transactional chat seam; deterministic real tool integration; blocking dispatch; shadow loop removal; measured read/write costs | Semantic/query owners for shared retrieval interface |
| Backend search/contracts, 70–79 | root initially | Unicode byte/scalar mapping; title cache identity and pre-limit kind filtering; real command composition; invalid dates; asset collision verification; wire/event boundary coverage | Timeline fixture helper; agent evidence contract |
| Harness/fitness, 80–89 | root initially | Reconcile Node/Python/native fixes; strict identity/event-aware browser fixture; owned Vite lifecycle; bounded samplers and process helpers; explicit test lanes/CI; semantic grading clarity; AST fitness guards | Module agents supply missing integration scenarios |
| Semantic execution, 90–99 | audit_editor after editor scope | Deadline/interruption scheduling; actual no-walk instrumentation; fixture consolidation; environment restoration; local runtime installer success/failure tests | Agent runtime env helper ownership coordinated |

The ranges may use letter suffixes for sub-issues; each remains a separate file. Cross-cutting source guards (FC/FD/BT/CC/H) are one root workstream. Rust search behavior belongs to root; timeline may supply fixture primitives but does not concurrently edit that file. Shared production files require explicit handoff before another writer starts.

## Ordered phases

1. **Preserve and reconcile.** Keep original reports unchanged, snapshot Sol reports, inspect bounded Sol patches, apply non-overlapping fixes with their regressions, reconcile six overlapping files rather than overwrite. Source patches are not committed automatically.
2. **Verify and fix correctness.** Parallel module agents reproduce asynchronous ordering and boundary cases. Investigations include old external read vs newer save, backend title-only cache reuse/kind filtering, asset path collision, lifecycle latch unwind, and performance claims. Findings go back to root; tickets record changed assumptions before consequential edits.
3. **Repair test confidence.** Use actual production seams and independent expected outcomes. Replace stale replicas and permissive policy-copying fakes before broad refactors. Preserve native durability, browser geometry, permission denial, rollback, identity/provenance and distinct layer contracts.
4. **Consolidate and deepen.** Migrate scenario ownership first, then remove unused writers/helpers, narrow fixture lifetimes, extract coherent private storage and runtime boundaries, and consolidate process/driver mechanics. Avoid generic abstractions or changing accepted semantics for convenience.
5. **Validate and review.** Agents run focused tests; root runs combined frontend/types/harness/Python, Rust ordinary and architecture checks, then browser/native checks needed by changed contracts. Expensive live-provider/scale checks are run only when they supply required evidence; unavailable evidence is reported explicitly. Independent Standards and Spec reviews verify the final combined change; root resolves actionable findings and reruns only affected checks.
6. **Close the ledger.** Every source ID links to a child issue and module outcome. No silent omissions, duplicate counting, speculative performance claims, or unfinished rewrites labelled complete. Final report lists removals, resulting behavior, validation and genuine remaining external constraints.

## Verification gates

- Each concrete bug: failing regression or direct reproduction before fix when practicable; passing regression after.
- Each deletion: call-site inventory and a named remaining/replacement behavior owner.
- Each performance change: work-count/timing evidence tied to the changed mechanism; cold/warm suite comparisons are insufficient.
- Each asynchronous owner: late success, late failure, replacement/disposal, and partial resource acquisition where relevant.
- Each persistence change: retained identity, rollback/committed-warning distinction, restart recovery and currentness preserved.
- Each issue: exact changed paths, tests, unresolved constraints and cross-module follow-ups recorded in its module report.

## Progress

- Source audit snapshot and 153-entry input ledger written.
- Five module assignments dispatched; their child plans precede implementation.
- No added requirement for repeated user approval. Routine decisions stay with the assigned agent and coordinator within the requested scope.


## Integration discoveries and scope updates

- Actual document composition reproduced stale external reads overwriting a newer
  saved baseline and proposal navigation creating an extra pane; both now have
  owner-level regressions and fixes (documents report).
- Independent Spec review found pending task navigation still bypassed verified
  text resolution when it had a line hint. That path now verifies the full
  document and has stale/missing-hint regressions.
- Task matching measurement confirmed 500,500 candidate comparisons for 1,000
  tasks (~176 ms per debug matching pass). Timeline owner is implementing keyed
  candidates with retained independent linear equivalence tests; this is a
  measured follow-up, not a speculative rewrite.
- Strict browser fixture exposed missing finalize/model-capability contracts and
  an invalid inert reset URL. Explicit contracts and Vite reset middleware now
  replace those permissive assumptions. Chat controls pass4/4; full run pending.
- Frontend combined gate passed152files/1,156tests. First combined Rust run passed
  734, with one stale source-shape guard after module extraction and one sandbox
  localhost-bind denial. The bind test passes with localhost access; module owner
  is replacing the stale guard. Final combined validation follows remaining edits.
- Owned server tests now cover cancellation during readiness as well as foreign
  listeners, child failure, wrong identity, hung response and idempotent teardown.

- Further independent review confirmed both semantic and lexical candidate limits
  could discard ordinary notes before kind filtering. Semantic eligibility now
  precedes scoring; issue98 verifies/fixes the indexed lexical collector as well.
- The managed timestamp grammar now rejects signed numeric fields and second60;
  both are outside the app-emitted whole-second grammar. Explicit regressions
  include pre-epoch leap-second rollover.
- Agent correctness review discovered historical retry-of-retry could select the
  nearest preceding user while retaining a different original run context. Agent
  owner is addressing durable user/run lineage in child65b before final native gate.
- Harness correctness review discovered cancellation during pending startup could
  exit before joined child shutdown. Timeline owner now implements a shared owner
  with a joined admission/stop lifetime (child80b) and cancellation regressions.
- Latest combined checks:152frontend files/1,161tests,19Node support checks,743Rust
  tests pass (16explicit opt-ins ignored). All26browser spec files passed across
  full and targeted reruns. Final new review fixes require affected checks.

- Child65b is fixed and independently re-reviewed: historical retries and checkpoint
  branches preserve the original durable user/context mapping; missing lineage
  fails closed. Chat59tests pass including the new regressions.
- Native E2E feature build passed and pinned a dedicated debug binary for dev
  port1433. Native smoke is next, using driver4448 and disposable fixture roots.

## Final ledger reconciliation

A line-by-line cross-check found incomplete subclaims under AA12/AA14 (Rust Atlas extraction and cosine policy), BB05 (real native event routing), FE11/ED05 (computed typography and offscreen navigation), EH09/EH10 (remaining sampler deadlines and successful-run artifacts), and an unnumbered task-date supplement. Children99/99b–99f and owner-created boundary tickets explicitly close these instead of treating the top-level labels as sufficient. The coordinator retains final native/integration ownership.

Native acceptance exposed real harness startup ordering: concurrent WDIO service hooks launched Tauri before Vite. Child80c now orders server readiness before app launch and reverses cleanup. The resulting timeline failures exposed stale test readiness assumptions; the timeline owner is repairing waits against actual diff/page completion, retaining assertions. The latest Rust suite passed746 with one old chat-indexing test using the now note-only ordinary search API; its indexing contract is being moved to the actual cross-kind evidence query.

## Final integration checkpoint

The final Rust suite passes752tests with16explicit opt-ins ignored. All seven native smoke files have passing executions (13cases total; one sustained measurement intentionally skipped in smoke), and the actual two-process restart runner passes. New rendered task navigation exposed a detached scroll-restoration race; child83e fixes the completion barrier and passes both the red/green unit regression and real offscreen browser case. Independent late review confirms Atlas function/test preservation and scroll ownership. The remaining retarget-animation assertion is being checked against recorded animation geometry rather than relaxed. Final frontend/support/types and ledger closure follow that acceptance.

## Completion

All six phases are complete. All153 numbered inputs plus the unnumbered task-date
supplement are resolved through86 persisted issues and module outcomes. Root
reviewed cross-module handoffs and independent Standards, Spec, ledger, production,
harness and late-change reviews; actionable findings were fixed and revalidated.
The final retarget measurement correction passed8/8 without a production change.
Final combined frontend1,162/support32, Rust752, types and production compilation
pass; browser/native/restart acceptance is complete as recorded in validation.md.
No required implementation is left delegated or pending. Explicit external/live/
scale opt-ins are documented as unexecuted evidence, not implied successes.
