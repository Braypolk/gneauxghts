# 12 — Represent proposal review as mounted or suspended

Status: needs-triage
Depends on: 09, 10, 11; fresh triage required
Scope: deferred; excluded from Round 1. Do not implement without a new scope decision after the Round 1 audit.

Read [the spec](../spec.md) and its execution/measurement rules first. Source lines refer to the 2026-09-07 working tree; use named symbols after preceding tickets move them.

## Problem and evidence

Review orchestration coordinates nullable editor, `workingMarkdown`, `suspendedMarkdown`, `hunkSnapshot`, live CodeMirror StateFields, and document state (`src/lib/features/proposals/proposalOrchestration.ts:158`, `:165`, `:235`, `:713`). A suspended snapshot is necessary because a pane adapter can rebind to another document. Keeping every fallback field simultaneously available makes invalid combinations possible.

## Implementation instructions

1. Behind the existing review session/orchestration seam, use a discriminated attachment value: mounted with a validated document/editor binding, or suspended with the sole text/hunk snapshot fallback.
2. Mounted review reads live text/hunks from the validated binding. Capture exactly once when suspending; restore through one implementation when attaching. Retain review/operation identities that reject stale extension callbacks.
3. Delete independent nullable-editor/working/suspended fallback combinations and duplicate capture/restore paths. Do not read a rebound pane adapter as if it still belonged to the review.
4. Keep CodeMirror's range mapping, shared document runtime, necessary sibling-editor synchronization, and reactive `runtimeRevision`. Remove sibling copies only if tests establish that they are truly duplicate authority; this ticket does not replace CodeMirror or invent another review engine.
5. Preserve separation between proposed working content and approved saveable content, including autosave suppression. Keep passive proposal arrival without navigation, one global editable review, and refusal to replace a resolving review. An immutable operation-local capture for an in-flight commit is valid and must retain exact Markdown through remount; it is not another live fallback owner. Do not use ordinary document saves to persist unapproved proposals.

## Acceptance and validation

- Evolve existing `proposalOrchestration.test.ts:286`, `:342`, `:391`, `:438`, `:453`, `:477` around switching note, last review pane closing, remount during Keep All, siblings, proposal replacement, stale callbacks, edits during commit and external conflict.
- No invalid attachment can consult the wrong note's editor. Unmount/remount retains decisions without publishing them.
- Report removed independent fields/fallback branches and actual line delta. If the minimal discriminated union cannot remove duplication after tickets 09–11, record that evidence and stop this ticket's expansion; do not build a broader review rewrite to meet a deletion quota.

## Comments

- Planning baseline: 2026-09-07. Append implementation evidence and resolution here; preserve the measured before/after and review follow-ups.

- Scope revision: deferred by the user's narrowed first-round decision. Retained as investigation/design evidence; ready-for-agent status and the original execution order no longer apply.
