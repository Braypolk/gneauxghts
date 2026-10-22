# Use argument-specific mocks in one branching test fixture

Archived execution ticket, 2026-10-21. The original plan and chronological comments below are historical, outside the executable backlog. See the [implementation outcome and verification limits](../../package-capabilities-2026-10-21.md#integration-result).


Historical record: implementation complete; combined acceptance is tracked in the outcome record.
Type: task
Priority: optional cleanup
Depends on: none

## Plan

In `src/lib/features/notepad/orchestration/notepadComposition.test.ts`, pilot the installed Vitest 5 conditional mock API in “refreshes distinct shared documents independently.” Register `vi.when(spy, { onUnmatched: 'throw' }).calledWith('a').thenReturn(left.promise)` and the corresponding `b`/right branch after checking the actual fixture signature. Preserve the exact controlled promise returned; do not substitute a newly resolved value. Enumerate every legitimate fixture call before rejecting unmatched arguments. Inspect installed declarations and the [conditional mock documentation](https://vitest.dev/guide/recipes/conditional-mocking) before changing signatures.

Retain deferred promises and call ordering in race tests. Do not replace sequence-dependent behavior with a static argument table or reset a shared fixture midway through an operation. Ensure conditional registrations are torn down with the existing test lifecycle and Vitest's current mock-history behavior. This is a one-file pilot, not a repository-wide rewrite.

## Acceptance and ownership

Own that test file only. Run its existing stale-read/save/identity/composition cases and typecheck. No application files or browser/native runs are needed for a test-only readability change. If the new form is less clear or changes asynchronous behavior, retain the current branch and record a no-change result. Run serially with a full-suite performance measurement to avoid distorting timing; source edits are independent of other tickets.

## Comments

No current correctness defect or speed improvement is claimed.

Implementation outcome (2026-10-21): the pilot uses a scoped `using` registration with exhaustive tuples `('a', '/vault/a.md')` and `('b', '/vault/b.md')`, matching the actual two-argument session API. `thenReturn` retains each exact deferred promise and the existing right-before-left completion assertions. Disposal restores the prior mock implementation at test exit before the existing fixture cleanup. Unmatched identities or paths now fail explicitly instead of silently taking the right branch. Checked the installed Vitest 5.0.5 declarations/implementation and [official recipe](https://vitest.dev/guide/recipes/conditional-mocking).

Focused verification: all 13 tests in `notepadComposition.test.ts` passed, including the independent refresh race, trailing reread, stale-read, save-failure and identity cases. The combined run also passed the ten Related and two standalone header cases (25 total). Typechecking is part of integrating-task verification.
