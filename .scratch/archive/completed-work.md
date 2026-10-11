# Completed development work

Consolidated October 10, 2026. These are historical outcomes and validation
limits, not descriptions of the current implementation or an executable backlog.
Use [ARCHITECTURE.md](../../ARCHITECTURE.md), [behavior invariants](../../docs/architecture/behavior-invariants.md)
and the applicable [ADRs](../../docs/adr/) for current contracts. Recheck code
before reusing an old design or measurement.

The original tracked records are available at Git commit
`1060abba3358ed704ab6e20e82732316b9de5b82`, under their former
`.scratch/<section-name>/` directories. For example:

```sh
git show 1060abba3358ed704ab6e20e82732316b9de5b82:.scratch/test-reduction/validation.md
```

The responsive-screen records were untracked; their final result and limits are
summarized below, and their capture scripts remain available. The temporary
pre-cleanup recovery snapshot and the older retired-worktree scratch archive
were removed at the user's request. Active investigation evidence was retained.

## answer-evidence

Removed the dedicated source-preview workflow and reused answer evidence
disclosure for literal validated excerpts. Rust, frontend, browser and type
checks passed in that phase. Passage validity did not establish answer entailment;
the open [citation investigation](../chat-reliability/issues/07-citation-entailment.md)
owns the continuing quality work. Earlier native startup failures were later
superseded by the chat reliability milestone.

## architecture-simplification

Completed the workspace, proposal/editor, timeline publication, chat, semantic
scheduling and Settings ownership simplification. The phase reported 2,953 fewer
source lines with frontend, Rust, browser and native acceptance. Initial Map and
native input failures did not reproduce; their causes were unproven. Live-provider
and release/performance lanes were not run. The old designs describe that phase,
not every subsequent implementation change.

## atlas-naming

The user approved the experimental topic labeler and its promotion on October 4.
The Jina-based frozen-membership benchmark was historical comparison evidence;
its runtime and naming-version details are not current provider guidance.

## atlas-prototype

The Fusion renderer was promoted from prototype to the main Map. Eight earlier
comparison views and their switcher were retired. Prototype-only routing and
pre-continuity layout descriptions are superseded. Consult the current
[Atlas product contract](../../docs/features/atlas.md).

## atlas-continuity

Implemented durable cloud identity/names, retained geography, publication guards,
local layout, transitions and the subsequently recorded geometry/routing fixes.
Automated validation passed; the original full live desktop/provider usability
smoke was not performed. Some later private-fixture replays superseded earlier
fixture measurements; those numbers are not general quality guarantees.
The lasting storage decision is [ADR 0010](../../docs/adr/0010-retain-atlas-geography-outside-derived-caches.md).

## audit-remediation

The combined finding ledger recorded reviewed dispositions for all 153 named
findings and the task-date supplement across 86 issue files. Concrete defects
and justified refactors were implemented; rejected proposals had explicit
dispositions. Final frontend, Rust, architecture, browser and native integration
passed in that phase. Live/scale/performance opt-ins were outside its acceptance.
The old tickets' triage labels did not represent unfinished implementation work.

## chat-date-context

Connected authored dates and task deadlines to ordinary chat and research,
including turn-local locale/timezone context and canonical deadline evidence.
Offline and synthetic native checks passed after corrections. This did not prove
general semantic entailment; that limitation continues in the open citation work.

## chat-tool-failures

Preserved safe recovery instructions through tool dispatch and corrected activity
accounting; targeted runtime/tool and architecture checks passed. The original
conversation was not rerun, and its lost error reasons could not be reconstructed.
This was a feedback fix, not proof that every retrieval failure was corrected.

## composable-agent-capabilities

Completed explicit temporal ranges, capability composition and repeated bounded
research with deterministic coverage. Subsequent evidence contracts and ordinary
answer disclosure superseded parts of the initial policy. Scripted tools proved
mechanics; live-model selection quality was not established by that phase.

## cursor-stability

Completed the browser harness correction and review; all 110 headless cases passed
at that checkpoint. The earlier selection timeout's cause remained unproven.
Native macOS WebKit was not run. Passing reruns were not treated as a causal fix.

## date-functionality

Implemented editable fixed date/time insertion and calendar-only task deadlines.
Browser interaction, Rust and frontend checks passed; the sandbox-blocked local
server test passed on its permitted rerun. Native UI journeys were not run in
that phase. Locale changes can leave older date text as ordinary editable Markdown.

## evidence-contracts

Implemented scoped retained authored changes, temporal-support metadata,
continuations and validated revision navigation. [ADR 0009](../../docs/adr/0009-allow-scoped-retained-activity-evidence.md)
records the retained-history decision. Subsequent reliability work changed read
defaults; the old report's default-provenance description is superseded. Temporal
proof and citation resolution did not establish semantic entailment.

## image-interactions

Implemented image selection, source editing, resizing, clipboard operations and
viewer navigation using the existing document runtime and editor transactions.
The final validation superseded the initial spec's claim that no implementation
had occurred. Product behavior belongs in the
[image behavior invariants](../../docs/architecture/behavior-invariants.md#image-interactions),
not the original video-derived plan.

## intermittent-ui

Corrected a reproduced delayed-navigation/search-focus race and listener cleanup.
The cursor investigation was bounded and its historical cause remained unproven;
the subsequent cursor harness milestone recorded later verification.

## merge-main

Completed the recorded integration/review pass, preserving Open File Location
and the accepted Atlas work. Browser startup and host-sleep interruptions limited
individual runs. Its old branch/fast-forward handoff is historical, not an
instruction to merge today's working tree.

## pre-merge-validation

Completed a disposable-checkout integration and validation pass, correcting
split-capacity, navigation and harness defects. The final browser run passed
26 files/109 cases and the native restart journey passed. Earlier intermittent
browser failures remained documented; later investigations did not establish
every original cause. Old branch positions and proposed merge actions are stale.

## responsive-screens

All 23 recorded issues received implementations, covering container bounds,
short-window scrolling, retained compact pane rails and accessible task ordering.
Permanent regressions remain in the browser suite; optional
[capture scripts](../responsive-screens/README.md) can generate fresh images.
The original broad pass plus focused reruns verified the affected files; it was
not a second complete-suite run. Narrow viewport checks used desktop Chromium,
not real mobile keyboards, safe areas or Safari. Superseded screenshots and
intermediate measurements were pruned.

## rust-history-fixtures

Introduced portable prebuilt histories for reader tests while keeping writer,
corruption and recovery scenarios on real writes. Corrected a reproduced paging
assumption without weakening exact-content assertions. Subsequent slow-test work
changed some fixture sizes, so initial archive counts and timings are historical.
Current regeneration instructions live with the checked-in
[fixtures](../../src-tauri/test-fixtures/history-read/README.md).

## rust-slow-tests

Completed read-only serial profiling and ranked six targets. A sandbox-blocked
localhost probe passed separately with socket access. The later two implementation
phases addressed all six targets; the old recommendations are not an open backlog.
Serial suite timings cannot be compared directly with concurrent or isolated runs.

## rust-slow-test-improvements

Implemented the first three targets: smaller pending-search setup, deterministic
verification cancellation and controlled recovery ownership schedules. Independent
review, mutation checks and scoped validation passed. These changes reduced
incidental work; they did not establish every workload's throughput.

## rust-slow-tests-remaining

Completed the other three targets: dense inventory pagination, checkpoint-chain
setup and storage reclamation. Distinct paging, source-admission, checkpoint and
recovery assertions were retained. No production freshness cache or query policy
was introduced. All six identified targets were complete across the two phases.

## test-complexity-reduction

Completed the second complexity pass with review and combined verification.
The phase reported 2,262 fewer maintained source lines, six deleted files and
reduced case counts. Frontend timings did not demonstrate a runtime speedup.
Later architecture and test work superseded its source inventory.

## test-performance

Accepted the isolated Vitest thread pool and narrower document import path.
The exact frontend case inventory was retained. Rejected Rust experiments were
restored; expensive reader setup was addressed in later fixture work. Measurements
were machine/process-specific and were not general performance guarantees.

## test-reduction

Removed 97 executable cases, 1,835 test/support lines and two files after mapping
redundant coverage and reviewing distinct behavior boundaries. Relevant unit,
type, browser and native checks passed. The rest of the graphical suite was not
rerun in that test-only phase; no general runtime improvement was claimed.

## test-reduction-second

The bounded follow-up recommended stopping broad deletion and made no further
source changes. Inspected remaining cases covered distinct recovery, paging,
admission and ownership behavior. This was not a claim that every test would
remain indispensable forever.

## test-suite-audit

The initial audit and Sol comparison produced overlapping findings and a larger
handoff. Their statements that the combined work was unassembled and issues were
still open were superseded by the combined audit-remediation acceptance above.
The original static audit was not live/browser/native validation.

## gemma-multimodal-search

The original llama.cpp deployment proposal was superseded by the approved
LiteRT implementation. Its dependent runtime plan is retired, not ready for
execution. Current implementation and release limits remain in the
[Gemma record](../embeddinggemma-2/spec.md); current provider ownership is in
ARCHITECTURE.md. Speculative audio/video extensions were not implemented by this
proposal and are not an automatically approved backlog.
