# Rig migration evidence

The consolidated [completed-work report](../archive/rig-upgrade-2026-10-11.md)
owns the outcome and limits. This folder retains validation logs, sanitized live
smoke results, before/after source hashes and the upstream migration guide while
they support the dependency transition. No open implementation queue lives here.

- `tests-completed.log`: final upgraded library test binary.
- `architecture.log`: architecture fitness tests.
- `frontend-check.log`: Svelte and E2E TypeScript checks.
- `live-smoke.json`: two opt-in real OpenAI cases; synthetic notes only.
- `baseline-build.log` and baseline test logs: isolated pre-migration source comparison.
- `validation-provenance.json`: upgraded source/toolchain/binary hashes.
- `before-hashes.json`, `migration-files.json`, `baseline-check-provenance.json`: migration attribution.

Earlier failed compile/test logs are diagnostic history. The final report identifies
which failures were fixed and which also reproduce on Rig 0.41.
