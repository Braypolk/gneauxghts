# 04 — Make native performance comparisons reliable under focus interruptions

Status: needs-triage
Scope: deferred validation/tooling investigation

Read [the checkpoint](../spec.md). This is a measurement limitation, not evidence
that the parser or note persistence is incorrect.

## Current gap

Native syntax checks and selected focused timing phases pass, but repeated focus
loss prevented a complete giant-quote/typing baseline-candidate-baseline sequence.
The cancelled first invocation also left partial output. A later script timeout
was followed by overlapping fixture work; that output is excluded. The final
harness stops on non-focus failures and separates short measurement phases.

## Questions and possible directions

Use an available desktop or isolated graphical session to obtain uninterrupted
comparisons. Consider better recording of phase, focus loss and cancellation;
ensure setup, timers and animation-frame waits have bounded owned lifetimes.
Do not weaken visibility/focus checks, silently rerun timed scripts through a
reserved outer `error` payload, refocus during a timed phase, or accept output
from work continuing after a timeout.

## Evidence needed to close

Complete matched one/two-pane A/B/A giant-edit and queued-typing phases, keeping
all correctness assertions. Inject timeout/cancellation only if changing lifetime
handling, and show pending work cannot mutate a subsequent fixture. Preserve real
app IPC, disposable vaults and owned cleanup. Distinguish programmatic RAF timing
from physical input/paint verification. Foreground work still follows the
repository's explicit focus authorization rule.

## Evidence

[Native limitations and reproduction](../../archive/visible-range-markdown/synchronous-paragraph-optimization.md).
Selected local failed-run logs are retained under that report's evidence folder.
