# Validate current-format 10k and 100k retained histories

Status: ready-for-agent
Depends on: 48

## Acceptance

Create disposable schema-13 fixtures with 10,000 and 100,000 retained revisions using the current Editing Window/action contract. Keep fixture generation and markers reproducible; do not relabel old schemas or recreate retired granular Editor history.

## Checks

Verify record/window/receipt counts and reconstruction integrity. Measure cold process reopen/recovery, history entry/paging/diff, reconstruction/restore preview, storage including WAL/SHM, and bounded memory where available. Retain workload, sample counts, budgets, exact logs, failed measurements, and hardware/cache limitations. Separate backend timing from native paint evidence.

## Resolution

Completed 2026-09-06. Built authentic disposable schema-13 masters with 10,000 revisions in one note and 100,000 across 901 notes through two production saves per Editing Window. Verified exact revision/window/event/publication/receipt counts, full-vault reconstruction integrity, expected sampled creation/old/middle/latest content, and unchanged sealed master hashes.

All defined gates passed across six actual fresh backend processes and two native paint runs. The 100k fresh-process recovery/attestation cost is about 7.2 seconds and is reported separately from warm budgets; worst backend entry/page/diff p95 remained under 40 ms, reconstruction/preview under 10 ms, and native entry/page/diff under 124 ms. Full old-cursor traversal, storage main/WAL/SHM, observed memory, exact workload/sample identities, generation cost, raw metric arrays, commands/build/source hashes, failed attempts and hardware/cache limits are retained in the [validation report](../../../docs/architecture/current-format-large-history-49-validation.md) and [machine-readable evidence](../../../docs/architecture/current-format-large-history-49-measurements.json).

A demonstrated production pending-intent scan was fixed with a derived partial index after current-format admission, preserving the direct orphan-preparation guard; red/green corruption regression and before/after production write diagnostics passed. The fixture helper now groups per-note intent counts once. Shared native build/admission protects WDIO, process-relaunch and scale entry points from ordinary Cargo overwrites using isolated profile-specific copied binaries and manifests.

An initial wrong-binary harness launch performed normal startup against user data. Metadata file mtimes changed; no Markdown mtime matched the interval, but no before hashes exist. No test save/history IPC reached that app, and no inspection opened/reset/reverted/deleted user databases. The precise incident and owned-process cleanup evidence are preserved prominently; later isolated runs passed with admitted artifacts and actual visible/focused frames.

195 focused Rust tests, 16 architecture checks, ordinary cargo check, eight Python and seven Node safeguard tests, optimized build and all accepted scale probes passed. All owned native/Vite processes and listeners were absent before documentation writes. Historical release/47/48 evidence and the issue-43 master remain unchanged. Issue 50 and deferred work were not started; no commit was created. Status retains canonical `ready-for-agent`; this Resolution records completion pending orchestrator audit.

## Comments

- 2026-09-06: Ordered history-hardening follow-up; run one fresh implementation agent per issue, with orchestrator audit before the next issue.

- 2026-09-06: Orchestrator review and independent Standards/Spec audits passed with no remaining findings; implementation and final evidence frozen for the after-49 snapshot.
