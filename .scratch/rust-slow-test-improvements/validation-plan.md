# Validation plan

- Saved original binary and source snapshot in baseline.json; root runs workloads sequentially without concurrent tests/builds.
- Baseline three focused tests in one fresh serial process; full original serial library with local socket access. Compilation excluded.
- Build edited library offline with --no-run. Run same three focused tests and compare runtime.
- Cancellation mutation: temporarily omit only replay-loop checkpoint in verify_revision_payloads_cancellable, compile/run exact corrected test expecting assertion failure (Corrupt rather than Unavailable), restore source in finally and rebuild before acceptance.
- Recovery mutation: choose narrow real owner-release mutation after inspecting final hook; preserve probes where possible so failure demonstrates lost lock lifetime rather than missing instrumentation. Bounded worker waits/RAII must avoid hanging even under intentional regression.
- Repeat focused recovery in fresh processes, preserving both schedules per process. Root inspects logs for absence of missing events or panics.
- Compare complete regular and ignored test-name lists against original binary.
- Run full Rust library and architecture fitness after source restoration. No frontend edits; no unrelated frontend/browser/native reruns.
- Independent Standards and Spec review against saved phase snapshot. Record findings, fixes, limits, exact diff and validation.

## Performance follow-up after acceptance run

The first final full serial run passed725 cases but measured100.98s versus original97.99s. Since this conflicts with the large focused improvement, perform one matched original/candidate serial profiling pair with per-test completion timing. This is to distinguish changed-test cost from variation in unaffected tests, not to obtain another green result or cherry-pick a faster total. Retain every result and report the full-run uncertainty candidly.
