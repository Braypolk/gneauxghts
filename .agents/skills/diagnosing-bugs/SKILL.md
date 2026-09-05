---
name: diagnosing-bugs
description: Diagnose hard bugs and performance regressions using reproducible evidence and focused experiments. Use for debugging failures, incorrect behavior, or slowness.
---

# Diagnosing Bugs

Find a reliable signal for the reported failure, use it to distinguish causes,
and verify the correction on the original path. Scale the investigation to the
uncertainty. When an earlier review already established the cause and a failing
reproduction, reuse that evidence and proceed to the fix.

## Establish the failure

Inspect relevant code, logs, domain context, and ADRs to understand the call path
and choose a useful reproduction. Code inspection and reproduction may iterate;
a runnable test is not a prerequisite for reading the implementation.

Prefer the smallest agent-runnable check that can expose the user's symptom:

- An existing failing test, or a focused integration test.
- A CLI or request script with known input and an asserted outcome.
- A browser/native journey when the defect depends on the actual UI lifecycle.
- A replay or temporary harness when the ordinary entry point is unavailable.

For concurrency or intermittent bugs, control scheduling, time, inputs, or
failure injection where feasible. Otherwise record the reproduction frequency
and use bounded repeated runs. For performance bugs, measure the relevant
operation before changing it.

Confirm that the failure is the reported symptom, rather than a setup error.
Reduce unrelated inputs when that materially sharpens the signal; exhaustive
minimization is unnecessary once the cause can be distinguished reliably.

If reproduction is unavailable, continue useful read-only investigation and
identify the missing evidence. Ask for access or information only when needed
to proceed. Label hypotheses and unverified fixes clearly.

## Distinguish causes

When the cause is uncertain, identify plausible competing explanations and
choose the next probe for its ability to distinguish them. Use as many
hypotheses as the evidence warrants; a demonstrated cause needs no artificial
alternatives. Share the leading hypothesis and consequential uncertainty when
useful to the user, then continue without a routine approval checkpoint.

Use targeted logs, debugger inspection, query plans, or profiling. Each probe
should answer a specific question. Change one relevant variable per experiment
where feasible and record what the result rules in or out. If repeated probes
provide no new information, revisit the reproduction or request the missing
evidence instead of repeating the same experiment.

Keep secrets out of commands and artifacts; use environment variables and
redact sensitive output. Give temporary instrumentation a distinctive prefix
so cleanup is verifiable.

## Fix and verify

Use a regression test that reaches the actual bug pattern. Keep the participants
responsible for state and ordering real; use controlled dependencies to expose
the failure. A helper test is insufficient when callers can bypass the helper.
When necessary, pair it with one targeted check through the production path.
Use the `tdd` skill for test-design guidance when implementing a test-first fix.

1. Establish a failing result for the specific defect when feasible.
2. Apply a focused correction through the existing architecture.
3. Verify the focused regression and original user scenario.
4. Run affected checks and repository-required gates. Repeat or broaden only
   for new changes, failures, or unresolved concerns.

Separate application defects from test-environment failures. Fix a demonstrated
harness problem when necessary to validate the task, preserving the assertion
of intended behavior. An unrelated failure should be reported with evidence
rather than silently turning the task into a general test-suite cleanup.

## Finish

Remove temporary instrumentation and retain only useful regressions or clearly
identified diagnostic evidence. Report the cause, correction, relevant checks,
and remaining uncertainty. Completion requires evidence for the requested
behavior, not merely a passing new test or an exhausted investigation budget.
