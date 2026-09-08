# Test interrupted process recovery and actual relaunch

Status: ready-for-agent
Depends on: 47

## Acceptance

Add and run a disposable-vault harness that interrupts the actual application process at meaningful durable publication/window/recovery boundaries, then launches a fresh process against the same vault. Driver session reconnection and constructing another AppState do not satisfy this ticket.

## Checks

Verify canonical Markdown bytes, pending/prepared recovery, exactly-once finalization, newer external-state ordering, receipt safety, and continued editing after relaunch. Record process identities, interruption points, actual commands/logs, and failures. Never interrupt the user’s app or modify their vault.

## Resolution

Completed 2026-09-06. Added a disposable-vault native process harness and feature-only fault hooks; ordinary builds expose no hook module or additional command DTO. The accepted matrix passed all six cases across 19 distinct native application PIDs and seven exact token/PID acknowledgements, including a fresh startup process interrupted after committed publication recovery before any driver connection.

Verified unchanged canonical bytes across recovery, exact prepared abandonment/finalization, captured pending-window recovery, immutable revision identity and exactly-once sealing, B → retained external C → newer disk D order, receipt/reference safety and bounded retirement after 70 unchanged saves, plus continued saving/finalization that survived another actual restart in every case. The observer inspects stable copied main/WAL files; fresh native processes are the only openers of interrupted originals. No production recovery defect or behavior change was found.

[Validation report](../../../docs/architecture/editing-window-process-relaunch-48-validation.md) and [machine-readable evidence](../../../docs/architecture/editing-window-process-relaunch-48-measurements.json) retain exact commands, source/build identities, every PID/fault/exit, canonical hashes, history results, receipt snapshots, failed attempts, and log hashes. The ordinary non-E2E check and 16 architecture tests passed. An intentional SIGTERM race verified cleanup and rejection of further child creation. All owned processes/listeners stopped before documentation writes.

Three initial environment/observer failures are preserved; only attempt 4 is the six-case pass. Process interruption is not device power-loss proof; exact opaque-token native replay is not claimed. Historical release evidence and the sealed master fixture remain unchanged. Issues 49–50 and deferred work were not started. No user app/database was interrupted/reset/deleted, and no commit was created. Status retains canonical `ready-for-agent`; this Resolution records completion pending orchestrator audit.

## Comments

- 2026-09-06: Ordered history-hardening follow-up; run one fresh implementation agent per issue, with orchestrator audit before the next issue.
