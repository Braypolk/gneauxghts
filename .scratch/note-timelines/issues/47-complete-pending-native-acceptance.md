# Complete the two pending native acceptance checks

Status: ready-for-agent
Depends on: 46

## Acceptance

Finish the two visible native gates left by [issue 43](43-remove-granular-editor-history-compatibility.md): autosave/deadline responsiveness, then optimized current-fixture entry/paging/diff paint. Use the exact resume instructions in [the current-format report](../../../docs/architecture/editing-window-current-format-validation.md), rebuilding changed code first. Run sequentially on an unlocked visible display; retain visibility guards and failed attempts.

## Checks

Record exact commands, build/fixture identity, raw logs, measurements, and gate outcomes in new evidence. Update the current report with honest results while preserving issue 42 historical measurements. This does not stand in for actual process-relaunch coverage in issue 48.

## Resolution

Completed 2026-09-06 on the unchanged issue-46 source baseline. Rebuilt the optimized frontend and native Rust E2E binary, then ran the two exact visible native commands sequentially on an unlocked display. Both passed without product/harness changes or retries: two Editing Window/autosave/deadline tests, then one current-fixture entry/paging/diff test.

The autosave/deadline journey retained real visibility/frame guards, verified twelve canonical saves and deadline sealing, and collected 731 frame gaps (p95 53 ms), twelve input paints (p95 168 ms), and twelve autosave observations (p95 1,281 ms including debounce/polling). These are timing diagnostics with no numerical responsiveness budget. All six fixture paint p95 gates passed the existing strict 250 ms budget: repetitive entry/page/diff 206/55/68 ms; random 174/132/66 ms; five samples each.

[Validation report](../../../docs/architecture/editing-window-native-acceptance-47-validation.md) and [machine-readable evidence](../../../docs/architecture/editing-window-native-acceptance-47-measurements.json) record exact commands, source/build/fixture identity, samples, raw logs and SHA-256 hashes, cleanup, and limits. The sealed schema-13/v2 master (95 revisions, 92 windows, 287 receipts) revalidated unchanged. No repository writes or concurrent checks occurred during runs; isolated apps/listeners/caffeinate exited before evidence writes. The current-format report and issue 43 now reflect completion, preserving earlier failed attempts and all four historical release evidence files.

Actual interrupted-process relaunch is issue 48; 10k/100k retained histories and old-citation navigation remain issues 49–50. No user database/app was reset, deleted, or interrupted. No commit was created. Status retains the repository's canonical `ready-for-agent` convention; this Resolution records completed work pending orchestrator audit.

## Comments

- 2026-09-06: Ordered history-hardening follow-up; run one fresh implementation agent per issue, with orchestrator audit before the next issue.
