# Integrate editor date conventions and deadlines with chat

Status: resolved
Type: task

The editor resolves dates through Intl and stores deadlines as `@due(YYYY-MM-DD)`.
Chat had only a timezone reference, no numeric-date convention, no shared date
instructions and no structured deadline metadata in ordinary reads. The API
and real timeline read regressions reproduced those gaps. Implement the
[spec](../spec.md), preserving reviewed edits and composable evidence contracts.

## Answer

Implemented optional turn-local editor conventions on sends/retries, inherited
parent/research reference semantics, canonical bounded deadline reads with exact
checkbox text, and existing reviewed edit composition. No new workflow tool or
persistence schema. Independent review found and verified a coverage omission
fix for unprojectable checkbox lines. Full backend, frontend, architecture and
native validation passed; earlier model-summary failures and the final corrected
answers are recorded in [validation](../validation.md).

## Comments

2026-09-30: Complete against [spec](../spec.md). General model semantic entailment
remains the existing separate follow-up; current settings are never authoring
provenance for older numeric dates.
