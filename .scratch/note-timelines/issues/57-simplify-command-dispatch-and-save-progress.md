# Simplify command dispatch and save progress

Status: ready-for-agent

Depends on: 56

## Outcome

Implement [the consolidation plan](../architecture-consolidation-plan.md): one private blocking-command helper owns AppState lookup, spawn_blocking and join failures. Keep typed command names and String/HistoryCommandError contracts. Inline trivial synchronous mirrors; keep meaningful operations as concrete functions accepting their actual dependencies. Do not retain thirty duplicate wrappers merely to avoid updating tests, and do not add a macro/framework. Commands requiring ChatService can remain explicit unless a simpler concrete seam is demonstrated.

The existing persistence controller remains the sole save-progress observer. It validates token, Note Identity, runtime scope and replacement revision; the document operation reducer only stores a small save-wait reason and checks its existing operation token. Preserve immediate save dispatch, delayed serial polling, new-draft handling, authoritative warnings/errors, newer edits and departure barriers. Keep paused issue-55 marks and bootstrap behavior.

## Acceptance

Frontend save/lifecycle/bootstrap tests, typed IPC contracts, ordinary Rust compile, affected command tests and architecture checks pass. Replace tests enforcing repeated spawn_blocking source text with checks of actual shared ownership. A blocked domain operation must leave cheap IPC requests runnable. Do not substitute Tauri command(async) on sync bodies: it uses the ordinary async executor, not the blocking pool. Measure deletions and caller simplification against after56.

## Resolution

Implemented 2026-09-06; frozen for independent final review.

One private `on_app_worker` owns AppState lookup, blocking-pool dispatch, and
join errors for all 32 affected commands. Its outer dispatch error stays separate
from the command's unchanged String or HistoryCommandError result. Removed 27
trivial synchronous mirrors; five substantial forgotten-note, proposal, and chat
operations remain directly testable with concrete `&AppState`/`&ChatService` inputs.
The four ChatService callers capture their existing handle for concrete service
lookup inside that same worker. No second dispatcher, trait, macro, or scheduler
was added. Generic Tauri Runtime parameters let tests cross the actual command
seam with MockRuntime without changing any serialized command arguments/results.
Session and task helpers no longer require Tauri State where dispatch already
provides concrete state. Save result extraction also drops obsolete title/session
clones.

The persistence controller alone owns the delayed 250 ms serial observer and its
operation-token, Note Identity, runtime-scope, and replacement-revision checks.
The document reducer stores only recovery, verification, unavailable, or corrupt
as `SaveWaitReason`, using its existing token check. A ready observation clears
only that presentation reason. Saves still dispatch immediately; their real result
owns completion, warnings, failures, and preservation of newer edits. Existing
draft/new-identity, departure, bootstrap/fallback, and paused UI measurement paths
remain unchanged.

Validation: **69 Rust command tests**, **17 backend architecture tests**, and
**221 frontend tests across 35 files** pass. The frontend run covers document,
persistence/orchestration, workspace, bootstrap, IPC contracts, and architecture.
Svelte check reports **0 errors and 0 warnings**; ordinary cargo check passes
without warnings. The new contention regression holds the real canonical file
mutation owner, observes an entered publication worker, sends an actual mock
Tauri readiness IPC request while publication remains blocked, and then verifies
the canonical save completes after release. Five observer cases assert every
readiness state remains advisory; architecture tests now enforce the shared
worker and keep backend diagnostic identity out of the document reducer.

Logs: `/tmp/issue57-commands.log`, `/tmp/issue57-architecture.log`,
`/tmp/issue57-frontend.log`, `/tmp/issue57-svelte.log`, and
`/tmp/issue57-production-check.log`. Exact-baseline audit and changed-path detail:
`/tmp/issue57-audit.json` (baseline `after56.tgz`).

Compared with that exact baseline: **361 fewer production Rust lines**, **4 fewer
production TypeScript lines**, **143 added test Rust lines**, **30 added test
TypeScript lines**, and **0 tooling changes**. Total Rust decreases by **218**
lines. Counts include comments/blanks and separate inline test modules; test
increase covers real async command invocation and the contention regression,
without removing behavioral cases. Current architecture text changed; all **19**
historical reports and all **13** paused issue-55 paths are byte-identical to the
baseline. No full backend suite, native launch, scale run, fixture generation,
user database operation, or commit was performed.
