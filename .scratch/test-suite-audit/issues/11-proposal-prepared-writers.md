# Remove unused proposal writers and replace preview test setup

Status: ready-for-agent

## Audit sources

reports/backend-agent-and-evidence.md PROPOSAL-01/02

## Problem and intended result

Three unprepared commit APIs have only test callers and keep an obsolete alternate write route alive. Preview tests unnecessarily acquire global setup.

## Acceptance and replacement coverage

Reconfirm all callers; migrate recovery fixtures and canonical prepared writer cases through correct preparation. Delete unprepared wrappers and obsolete unique-path commit policy test. Add literal edit ambiguity/overlap and hunk reconstructability cases, including Unicode and bounded fallback. Remove globals only from verified pure/read-only preview paths.

## Constraints and handoff

Do not weaken durable fixed-target collision handling, exact prepared bytes, or status convergence after a committed write.

Read the linked module report and architecture invariants before implementation. Audit baseline is `cb4d4c02f0e2c1220d37b281ee300eff1aabf20b`; verify current callers and line locations again. See `../review.md` for initial implementation scope; avoid repeating completed work.
