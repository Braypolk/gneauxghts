# Preserve Markdown edge cases in deadline edits

Status: resolved
Type: task

## Scope

Review all date changes against HEAD `ef6fed5` and the feature specification. Preserve trailing Markdown hardbreak whitespace, reference-link labels, and code spans that close on a continuation line. Keep review fixes within date functionality.

## Acceptance

Shared Rust/TypeScript fixtures prove protection and exact whitespace preservation; editor, backend, browser, type and build checks pass. Record final review readiness without merging.

## Comments

September 30, 2026: user asked whether cleanup was needed before merge; review identified concrete preservation defects.

## Answer

Completed independent Standards and Spec reviews of `git diff HEAD` plus untracked date files against baseline `ef6fed5`. Fixed Markdown hardbreak preservation, balanced reference/inline-link labels (including escaped and code-covered brackets), and code/link spans continuing beyond a task marker line. The picker reports a visible error if a canonical suffix would remain inside unfinished code/link text. Shared frontend/backend fixtures cover all reported parser cases.

Fixed `h24` midnight chip round trips and completion toggling for every newly projected task marker. The task-list page now closes its body-mounted picker when unmounted. Reviewers verified their corrections; neither axis retains an actionable finding. No broad refactor needed, and no merge performed.

See [validation](../validation.md) for the checks and native-UI limitation.
