# Search coordinates and offscreen navigation

Status: needs-triage

## Audit sources

reports/editor-and-discovery.md ED-04/05; reports/ui-settings-and-indexing.md UIX-01

## Problem and intended result

Rust lowercase byte offsets can split original UTF-8; frontend current-note highlights use UTF-16 while rendering consumes code points. Search/related/wikilink navigation depends on visible DOM and ignores offscreen targets.

## Acceptance and replacement coverage

First define each boundary unit (UTF-8, UTF-16, Unicode scalar, canonical vs editor line). Reproduce İé plus a long body, emoji before a match, trimming/cropping, repeated text and offscreen targets. Retain semantic/title-only remembered position behavior; validate current document identity/content before focusing.

## Constraints and handoff

Stage Unicode preview/highlight fixes before replacing DOM-based navigation. Keep exact current-passage citation navigation separate unless its contracts match.

Read the linked module report and architecture invariants before implementation. Audit baseline is `cb4d4c02f0e2c1220d37b281ee300eff1aabf20b`; verify current callers and line locations again. See `../review.md` for initial implementation scope; avoid repeating completed work.
