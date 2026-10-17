# Pi rebuild acceptance record

Historical acceptance on 2026-10-16; current owners are described by
[ARCHITECTURE.md](../../../ARCHITECTURE.md) and ADR 0012.

- [Final checks](checks.json): exact current-source test totals, build/typecheck
  results and earlier unchanged-path integration limits.
- [Desktop acceptance](desktop.md): tested behaviors, live versus fixture scope,
  reproduction entry points and repair history.
- [Simulator acceptance](ios.md): actual local-model, publication/restart,
  relocation, interaction and fault scope with explicit limitations.
- [Changed-body recovery receipt](ios/changed-body-recovery.json): four retained
  revisions plus exactly one publication after interruption, without republishing.

Repeated phase snapshots, controller logs, allocation snapshots and earlier
passing-run JSON were pruned after their conclusions were recorded. Artifact IDs,
hashes and temporary paths mentioned in the outcomes identify historical runs;
they are not promises of permanently available raw artifacts. Executable native
fixtures remain in `e2e/specs/native/piChat*.spec.ts`; the shared simulator runner
remains in `scripts/pi-chat/ios-acceptance.mjs`.

Physical-device and live hosted-provider acceptance remain deferred. Source-free
compaction is not a combined long-history note/citation proof. No normalized
performance win, semantic citation entailment or full legacy feature parity is claimed.
