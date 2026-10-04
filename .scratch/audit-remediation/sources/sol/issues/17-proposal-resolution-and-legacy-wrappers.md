# 17 — Correct proposal ambiguity and retire legacy commit wrappers

Status: ready-for-agent
Type: task
Audit items: CC-06, CC-07

Evidence: [cross-cutting report](../reports/cross-cutting.md), coverage reconciliation supplement. Inspect current source before implementing; baseline references are cb4d4c0.

## Work

Collect every character-boundary text occurrence, including overlapping matches, before filtering by context. Add pure resolver cases for ambiguity, context disambiguation, missing anchors, overlap between edits and Unicode. Keep disk-backed UTF-16 preview and folded-proposal tests. Migrate legacy commit_note_review/creation/creation_at_path tests to production prepared/command routes before removing unused wrappers. Preserve creation target collision semantics chosen by the production command, without reintroducing automatic path selection through an obsolete helper.

## Acceptance and validation

`banana` with oldText `ana` and no context rejects ambiguity; an adequate context selects the intended occurrence. Unicode offsets remain safe and preview hunks stay UTF-16. Exact prepared bytes, stale hashes, fixed note paths/frontmatter, collision rejection and chat recovery retain behavior coverage through production boundaries. Proposal/command/chat targeted tests, Rust format and architecture checks pass.

Read ARCHITECTURE.md and applicable invariants/ADRs before changing publication, ownership or intent coordination. Resolver-only correction does not require a publication redesign. Keep a behavior-to-test replacement map for removed wrappers/cases.
