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

The [bounded native timing sample](../latency-probe/README.md) is complete.
Current activity requests are 97–98% provider/transport time, with milliseconds
spent in search/read tools and conversation polling. Production chat and research
workers already have no cumulative time, model-turn, tool-call or token ceiling;
the five-minute deadline belongs to the diagnostic harness. Avoid speculative
retrieval changes. If a slow request recurs, use the retained
probe to capture its provider intervals, tool durations and IPC costs. The
historical five-minute timeout remains unattributed; long-history scaling and
competing/cold inference are not measured by this small fixture.

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

## Separate native harness observation — 2026-10-10

The [citation reproduction](../citation-entailment/native-validation.md) observed
a Flex provider attempt end after about 6.2 seconds with unknown usage. Its
persisted message status was error, which the native polling helper did not
recognize. Polling continued to 120 seconds and cancellation of the ended request
masked the provider failure. The shared live wait helper and new probe now
recognize error; support33 and TypeScript checks pass. No paid rerun. This is a
demonstrated harness wait in a separate hosted request, not a diagnosis of the
older five-minute local request. Provider/retrieval/UI measurement remains open.

## Current native diagnosis — 2026-10-14

Three fresh conversations on the configured `qwen3.8-27b-gsq-rco` local server
completed in 6.064 seconds (short reply), 74.097 seconds and 37.086 seconds
(independent activity questions). The activity requests made five/four provider
completion calls; 97.91%/96.61% of send-to-terminal observation fell inside those
HTTP intervals. Search/read durations summed to 184/133 ms. Poll medians were
34/33 ms, p95 80/86 ms, with maximum 103/93 ms. Polling overlaps inference and
is not additive to that partition. About 80% of reported activity output tokens
were reasoning; the server's default enabled reasoning was preserved.

This supports local generation/reasoning and repeated model turns as the current
cost, with no reproduced runtime stall. It does not prove the old timeout's
cause: the original model variant and runtime differ, and large histories/cold
loads/concurrent inference were not tested. No production limits, model settings
or storage behavior changed. The original 300-second harness deadline remained.
The opt-in native spec passes all three timing cases; E2E TypeScript checks pass.
See the [report and reproduction](../latency-probe/README.md) for artifacts,
measurement boundaries and preserved uncertainty. Original issue stays open for
the unproven timeout, rather than claiming a speculative performance fix.
