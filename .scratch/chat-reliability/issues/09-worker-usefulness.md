# Make the bounded research worker useful before expanding authority

Status: resolved
Type: task

## Evidence

Final native research resolved the correct two-note scope without an invented
folder, but returned `partial/empty_selection` with zero read passages. Earlier
runs returned `invalid_json` or `empty_scope`. The parent direct fallback now
fulfills the temporal and current cross-note request with valid citations.
Worker success itself has not been demonstrated in this scenario.

## Next step

Inspect the worker's registered evidence tools and actual first completion
request, retaining private text inside isolated diagnostics. Add counters for
issued tool calls/read results and compare a minimal discovery/read/selection
question against the same model/provider. Determine whether this is model
behavior, instruction conflict, or runtime configuration. Improve the contract
with a focused regression, then require at least one actually read selected
passage in a native worker-success case. Keep separate direct-fallback coverage.
Do not accept unread IDs, salvage arbitrary prose as evidence, widen scope,
change provider routing, or increase allowances to conceal the failure.

## Answer

Completed 2026-09-30. Focused gathering instructions and tool-facing scope now
combine with a schema-backed result formatter, inherited scoped reads, honest
gap handling, counter-only diagnostics and an already-read evidence handoff.
The formatter stays inside the private runtime adapter and grants no executable
authority. The selected model/provider and shared allowances are unchanged.

All five native scenarios pass: current and historical confirmed-note worker
success, broader historical discovery, separate direct fallback and research
composed with independent current-note reads. Rust library checks pass (681),
architecture checks pass (19), and E2E types pass. Valid partial coverage remains
explicit. See [worker validation](../worker-validation.md) for evidence and limits.
