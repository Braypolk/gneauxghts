---
name: tdd
description: Test-driven development for feature work and bug fixes. Use when the user requests test-first development, red-green-refactor, or integration tests.
---

# Test-Driven Development

Work in small behavior slices: demonstrate a failure, implement the correction,
then simplify while keeping the test green. Match the scope to the requested
behavior and the consequences of getting it wrong.

## Choose the test surface

Use the relevant domain context and ADRs when they affect the change. Choose an
existing interface that exercises the behavior under test. State the choice
briefly for substantial work and proceed within the user's authorization.
Ask only when missing product intent or a consequential interface decision
cannot be resolved from the task and repository. An established test surface
or an already demonstrated reproduction needs no renewed confirmation.

For coordination bugs, trace the production call path before choosing the
smallest useful test. Include the real participants whose ordering or state
causes the failure. If a focused test bypasses a relevant caller, lifecycle
step, or persistence boundary, add a targeted integration check through that
path. Test size alone does not establish confidence.

Prefer caller-visible outcomes. Storage integrity, migration, and recovery
work may also need direct assertions on persisted bytes, schema, or foreign
keys: use them when those are the contract under test, and verify ordinary
read/recovery behavior as well. Keep internal test helpers private.

Consult [tests.md](tests.md) for assertion examples and
[mocking.md](mocking.md) when selecting substitutes. Use `codebase-design` when
an interface decision is actually in scope; ordinary test additions need no
separate architecture exercise.

## Run the loop

1. Choose one behavior or regression. Reuse an existing failing test or
   reproduction when it reaches the actual defect.
2. Run the test and establish that it fails for the expected reason. When the
   original failure cannot be executed, distinguish observed evidence from an
   unverified regression test; never claim a red run that did not happen.
3. Make the smallest coherent implementation change. Include necessary
   integration wiring so a local green test does not leave the real path broken.
4. Run the focused test. Refactor locally when it removes duplication or
   clarifies the change, keeping the behavior green.
5. Run affected integration checks and repository-required gates. Broaden or
   repeat checks when new changes, failures, or unresolved risks justify it.
   Finish once the requested behavior and relevant gates are verified.

Independent fixes may each use this loop; avoid a speculative batch of tests
for an interface that is still changing. Optional cleanup outside the requested
behavior belongs in a separate finding, not an expanding implementation task.

## Quality checks

- Expected values come from the requirement or an independent known result.
- Assertions establish a behavior, rather than echoing the implementation.
- Mocks retain the interaction responsible for the bug.
- Validation covers the original failure path, not just the newly written helper.
- Report the behavior changed, meaningful validation, and any remaining limits.
