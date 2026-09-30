# Validation

Historical record of the earlier capability refactor. The subsequent [evidence-contract implementation](../evidence-contracts/validation.md) expands retained-history policy under ADR 0009 and adds live evaluation.

## Behavioral coverage

- Explicit date and timestamp inputs, exclusive end boundaries, timezone changes,
  daylight-saving transitions, invalid/reversed dates and nonexistent local times.
- Legacy query metadata converts to explicit ranges without reusing result facts
  or confusing deadline/event dates with recorded text activity.
- Activity discovery followed by provenance reads and an independent search for
  open commitments, preserving exclusions and shared evidence-budget admission.
- A scripted runtime performs discovery, reading, another search, planning and a
  proposal before synthesizing a response; every tool result returns to the model.
- Capability intersections never expand child authority. Research filters may
  narrow inherited dates/folders but cannot widen their underlying allowed scope.
- Research leases permit subsequent invocations while preventing concurrent
  workers; usage accumulates across invocations without double counting updates.

## Checks

- Architecture fitness: 19 passed.
- Frontend agent-event and IPC contracts: 18 passed.
- Native harness TypeScript check: passed.
- Final focused agent-tool tests: 12 passed.
- Full Rust library suite: 667 passed, 0 failed, 15 explicit opt-ins ignored.
- `git diff --check`: passed.

The first broad Rust run passed 663 tests but its existing localhost mock-server
probe could not bind inside the sandbox. That probe passed outside the sandbox;
the final full suite uses the same permission. No production network requests
or user-vault agent runs were performed.

## Limits

Scripted model tests establish execution mechanics, not autonomous model-choice
or answer quality. The native live-model harness and rubrics now match composable
retrieval and synthesis, but were not run. Fifteen live/scale opt-in Rust tests
remain intentionally ignored. Removed historical prose remains unavailable under
ADR 0003; this change does not expand that policy.
