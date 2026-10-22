# Pilot the lazy regex macro in task-date parsing

Archived execution ticket, 2026-10-21. The original plan and chronological comments below are historical, outside the executable backlog. See the [implementation outcome and verification limits](../../package-capabilities-2026-10-21.md#integration-result).


Historical record: implementation complete; combined acceptance is tracked in the outcome record.
Type: task
Priority: optional cleanup
Depends on: none

## Plan

The three literal patterns in `src-tauri/src/services/task_dates.rs` already use `LazyLock<Regex>`, so regex 1.13's `regex!` offers shorter declarations rather than a new caching/performance benefit. Replace those declarations with private named accessor functions returning the installed macro's regex reference, or inline the macro at each existing unique use if that is clearer. Keep one literal/site per existing reusable pattern; do not duplicate large patterns across call sites. Retain exact pattern bytes and case/Unicode semantics. [Regex 1.13 notes](https://github.com/rust-lang/regex/blob/master/CHANGELOG.md).

Limit the pilot to this file. Leave `index.rs`'s larger task-line parser alone unless a later change already touches it. Do not replace non-regex `OnceLock` maps or add a wrapper framework.

## Acceptance and ownership

Run the existing `services::task_dates` Rust tests and the portable task-date contract checks, including invalid dates, escaped/protected text, duplicate tasks, Unicode, CRLF and multiline code. Verify the static macro declaration available in the pinned Rust/dependency graph; no compiler upgrade. No additional benchmarks or UI tests for a semantics-preserving declaration cleanup. If readability does not improve, keep `LazyLock` and record no change.

## Comments

Optional housekeeping; not a correctness fix or a priority ahead of the user-facing work.

Implementation outcome (2026-10-21): replaced the three `LazyLock<Regex>` declarations with `regex!` directly at their existing single call sites. This removes the separate declarations and unwrap boilerplate without adding named accessors or duplicating patterns. All three literal pattern byte strings are unchanged. Installed regex 1.13.1's macro supplies lazy reuse; there is no performance improvement claim and no dependency/compiler change. Root verification will run the task-date Rust/portable fixture tests alongside the combined native checks.
