# Concrete Pi editing cleanup — 2026-10-17

Historical implementation and verification below. Its v2 review migration and
retired-create decoder were subsequently removed after the user deleted older
chats; see [remaining compatibility cleanup](pi-chat-compatibility-removal.md).

Completed the three authorized changes from the
[post-slice assessment](pi-editing-architecture-review.md). Publication phases,
native effect ownership, atomic child continuation, editor leases and lifetime,
canonical adoption and reconciliation retain their existing flow.

## Changes

- Removed agent-create mutations/grants and the unused
  `NoteTimeline::create_note_with_proof` entry point. Removed create-only parent
  admission and the impossible occupied-target publication result. Ordinary note
  creation and its genuine optional no-op result remain supported. Native and
  simulator publication fixtures now use saved-note updates. Retired create
  payloads are decoded solely to recover retained results/proof; unpublished
  create intents return `operation_retired` and cannot write.
- Seeded `EditReviewDoc` in the existing atomic child-task creation commit.
  New publication task inputs contain references and the approval hash, without
  duplicate title/patch data. The review document remains working state cleared
  by approve/discard/stop. Live v2 task inputs migrate through a transient
  checkpoint into the review document, preserving an existing decision.
- Used public Pi `createEditTool().prepareArguments` for JSON-string, singleton
  and top-level edit-shape repair before domain-schema validation. Exact string
  note/read-source identifiers and the prohibition on arbitrary paths remain
  enforced. No private upstream import or copied repair logic was introduced.

The current ownership contract is documented in
[ARCHITECTURE.md](../../ARCHITECTURE.md#external-effects-and-lifetime),
[behavior invariants](../../docs/architecture/behavior-invariants.md#agent-publication)
and [ADR 0012](../../docs/adr/0012-found-ordinary-chat-on-pi.md).
No broader publication-boundary redesign was justified.

## Verification

- Affected chat/frontend architecture suite: **235 tests passed** in 24 files.
  Covers exact review, discard/stop, restart, interrupted effects, argument repair,
  invalid domain identifiers/paths and live v2 pending/discarded review migration.
- Full Rust library suite: **635 passed, 19 ignored**. Ordinary creation,
  history/restore, update authority and retained proof recovery remain covered.
  The new retained-create compatibility test proves proof recovery and rejection
  of unpublished retired mutations without another canonical write.
- Native architecture fitness: **19 passed**; the update-only capability check
  replaces the former requirement to retain agent creation.
- Real macOS native acceptance: **12 passed** across editing and publication
  suites, with `GNEAUX_PI_PROCESS_RESTART=1`. Includes exact approval, direct edit,
  discard/stop, pending review restart, Temporary grant reopen/noninheritance,
  changed base, grant revocation, dirty editor, lost acknowledgement recovery
  and Settings remount/canonical adoption. Uses generated disposable vault notes.
- Svelte diagnostics: **0 errors, 0 warnings**. E2E TypeScript checks passed.
- Fixture/support and simulator command gate: **40 tests passed**.
- Independent Standards and Spec reviews found no remaining actionable findings.
  Review baseline was a pre-cleanup file snapshot, isolating this work from the
  already dirty checkout. No unrelated changes were staged or reset.

The `pnpm check` wrapper exited at `svelte-kit sync` without diagnostics in this
shell. Direct Svelte and E2E TypeScript checks passed. Native restart emitted the
known WebDriver session-cleanup warnings; the embedded driver completed both
suites successfully. No physical-device or new live-provider validation is claimed.
