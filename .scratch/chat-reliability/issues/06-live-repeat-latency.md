# Bound live request latency and retain timeout diagnostics

Status: needs-triage
Type: task

## Evidence

The repeated native run completed the composer activity answer, exact current
body citation navigation, and a fresh cross-note follow-up. The second independent
activity request did not finish within the test's 300-second request deadline.
The old polling helper did not preserve that in-flight answer, so the cause is
not established. See `../artifacts/native-ui-and-followup-passed.json` for completed requests.

## Next step

The helper now saves partial answer status/events when a request times out.
Run a bounded latency sample against the configured local model, inspect provider
latency and tool steps, and distinguish slow inference from runtime stalls.
Do not increase budgets or change the selected model merely to hide the failure.

## Further observation

The final compact native journey had two transient WebDriver `execute/async`
timeouts during conversation polling. The app remained responsive and recovered;
a one-second sample showed active conversation validation/serialization and no
established mutex deadlock. The full Rust suite ran concurrently, so this run is
not a controlled latency benchmark. All three native requests eventually passed.
Separate polling/validation latency from provider generation in the next sample.

## Cleanup review observation

The September 30 review found repeated full-note revision-header scans in
`activity_history::revision_changes`: it loads all headers to locate a revision,
then `reconstruct_comparison(Parent)` loads them again. Discovery already has the
header from its bounded page, and citation freshness revalidates each admitted
historical passage through this path. This is a concrete avoidable cost, but no
scale reproduction establishes its contribution to the live timeout.

Measure long-note discovery and repeated citation validation separately from
provider generation. Consider a private targeted revision/predecessor comparison
and reuse the already loaded discovery header while preserving lineage,
permission and freshness checks. Keep this storage change separate from the
completed worker milestone.
