# AI Diff Review — Implementation Checklist

Derived from [`AI_DIFF_REVIEW_PLAN.md`](./AI_DIFF_REVIEW_PLAN.md) (canonical). This is the
actionable execution plan: phases, concrete file/module targets, acceptance criteria, and a
test checklist. Check items off as they land.

**Architectural invariants (do not break):**

- Migration, not greenfield. Keep: job lifecycle + `AiJobStatus`, inbox grouping/refresh,
  queue/worker loop (`remember_orchestrator.rs`), provider abstraction (`provider.rs`,
  `complete_json`), secret-storage split, vault-local `.gneauxghts/ai.sqlite3`,
  `StoredAiJob`/`thread_id` model, and the file-level `content_hash` conflict gate.
- The AI change becomes **structured operations against addressable Markdown blocks**, not an
  opaque whole-file `newMarkdown`. Full-file output is a *fallback* that gets decomposed into
  block-replacement ops.
- Avoid whole-document replacement on apply; prefer minimal targeted edits.
- One document model only (CodeMirror / Markdown source of truth). Do **not** introduce a
  second model.
- Editor inline review is **read-only** in v1. No editable-while-pending.

Legend: `[ ]` todo · `[~]` in progress · `[x]` done · `[!]` blocked/deferred (with reason).

---

## Status snapshot (this run)

- [x] Phase A.1 — `blocks/segmentMarkdown.ts` shared segmentation module + tests.
- [x] Phase A.2 (TS half) — `BlockOp` TS union + `ChangeProposal` schema-versioned shape.
- [x] Phase A.3 (TS half) — operation validation + minimal-edit apply helpers + tests.
- [x] Phase A.2/A.3 (Rust half) — `BlockOp`/`ChangeProposal` types + `schema_version`
  behind the existing opaque `proposed_changes_json` column; **Rust segmenter
  (`block_segment.rs`) + `apply_operations` remap + `validate_operations` compile and
  pass tests** (cargo toolchain available).
- [x] Phase A.2/A.3 (Rust bridge) — `change_proposal_from_update_note` /
  `derive_replace_ops` / `build_change_proposal` / `to_block_map` convert a legacy
  whole-file `AiChange::UpdateNote` into a schema-v2 `ChangeProposal` (mirrors the TS
  `deriveReplaceOps`/`buildChangeProposal`). Old v1 `AiChange` blobs are untouched and
  still deserialize.
- [x] **Live apply wiring (this run)** — `apply_job_changes` in `approval_service.rs` now
  applies `AiChange::UpdateNote` bodies through the structured-op bridge
  (`apply_update_note_via_ops`): it derives `ReplaceBlock` ops from the proposed rewrite,
  applies the accepted ops to the live body via `apply_operations` (minimal block-level
  edits, no whole-doc rewrite), and **falls back to the verbatim whole-file body** if any
  op goes stale or the reconstruction doesn't reproduce the proposed body exactly. The
  file-level `content_hash` gate stays as the outer conflict check. Net effect is
  byte-identical to v1 on the happy path; never a partially-applied body.
- [x] **Schema-v2 op storage (this run)** — `proposed_changes_json` now persists a
  shape-detected v2 envelope (`ProposedChangesEnvelope { schemaVersion, changes, proposals }`)
  for new jobs: `changes` is the verbatim v1 `Vec<AiChange>` (all existing consumers untouched),
  `proposals` is the derived `Vec<ChangeProposal>`. Old v1 *array* blobs still deserialize and
  preview/apply exactly (array ⇒ v1, object ⇒ v2). Generation stays whole-file; storage/apply are
  op-native. So **new jobs persist native op proposals, not just apply via derived ops.**
- [x] Phase 0 spike (a) — `@codemirror/merge` `unifiedMergeView` integration, promoted
  straight to a production read-only diff component (no throwaway flag needed).
- [x] Phase C (diff surface) — `ProposalReviewList.svelte` now renders the merge diff with a
  full-file ⇄ changed-regions toggle, preserving the existing full-file approve/reject flow.
- [x] Phase C (UI bridge) — `proposals/diff/proposalAdapter.ts` derives `ChangeProposal`/block
  ops from the current whole-file `ReviewChange` for op-level UI, **without** touching
  persistence (UI-only, placeholder threadId).
- [x] **Phase C (op-level accept/reject) — live (this run).** `InboxItemDetail.proposals`
  surfaces the persisted/derived `ChangeProposal`s to the client; `ReviewUpdateChange` now
  carries `ops` + `acceptedOpIds`; `ProposalReviewList.svelte` renders per-op accept/reject
  cards; and approval applies only the accepted op subset by building a partial `newMarkdown`
  through `applyOperations` and routing it through the **existing** `approve_inbox_item_with_changes`
  command (no new table/migration — the smallest-safe route the plan mandates). File-level and
  thread-level accept/reject are preserved.
- [x] **Phase D (read-only pending indicator) — live (this run, modest).** The editor shows a
  non-invasive "AI change pending review" pill (links to the inbox) when the open note's path is
  touched by the active proposal session. Read-only, reuses `getPendingProposalNotice` over the
  existing session store — no new backend calls, no inline review surface.
- [x] **Phase D (read-only in-editor review overlay) — live (this run).** When the open note has a
  pending `updateNote` proposal, the pill reads "Review AI change" and opens a full-pane **read-only**
  overlay that renders the same current→proposed diff as the inbox (reusing `MarkdownDiffView` /
  `@codemirror/merge`), shows accepted/total block-op counts + any rename, and offers Close + "Decide
  in inbox". The overlay makes no decisions and never mutates the document or undo history — accept/
  reject stays in the inbox to honor read-only v1. Driven by `getReviewOverlayModel` over the existing
  `activeProposalSession`; no new backend calls, no editor StateField/decoration. Full inline anchored
  decorations are **deferred** (rationale below).
- [x] Phase B (native op *generation*) — **LIVE for the single-note edit path** (`run_edit_job` →
      `try_native_edit_job` → `reconstruct_from_native_ops`), with the whole-file path preserved as
      the fallback. Multi-note jobs (integrate/custom-advanced/split-up) still generate whole-file.
      See "Phase B — Generation contract" below.

---

## Key file map (existing code this work touches)

| Concern | File |
| --- | --- |
| Change enum (Rust) | `src-tauri/src/ai/mod.rs` (`AiChange`) |
| Change generation (prompts/parse) | `src-tauri/src/ai/mod.rs` (`run_edit_job`, `run_split_up_job`, `run_integrate_job`, `run_custom_advanced_job`) |
| Validate + apply | `src-tauri/src/ai/approval_service.rs` (`validate_job_changes`, `validate_override_changes`, `apply_job_changes`) |
| Persistence / schema | `src-tauri/src/ai/store.rs` (`proposed_changes_json`, `ensure_schema`, `serialize_changes`) |
| Worker loop (untouched) | `src-tauri/src/ai/remember_orchestrator.rs` |
| Provider (untouched) | `src-tauri/src/ai/provider.rs` |
| TS change types | `src/lib/types/ai.ts` (`AiChange`, `AiChangePreview`, `InboxItemDetail`) |
| Review-change model | `src/lib/features/inbox/reviewChanges.ts` |
| Proposal session store | `src/lib/features/proposals/session.ts` |
| Review UI | `src/lib/features/proposals/ProposalReviewList.svelte` |
| Inbox list/store | `src/lib/features/inbox/store.ts`, `listResource.ts` |
| Editor StateField pattern | `src/lib/features/notepad/editor/editor.ts` (`searchQueryField`) |
| Lezer markdown tree | `src/lib/features/notepad/markdown/markdownExtensions.ts`, `markdownLanguage.ts` |
| **NEW** segmentation | `src/lib/features/notepad/blocks/segmentMarkdown.ts` |
| **NEW** block ops | `src/lib/features/notepad/blocks/blockOps.ts` |
| **NEW** merge diff factory | `src/lib/features/proposals/diff/mergeDiffView.ts` |
| **NEW** diff component | `src/lib/features/proposals/diff/MarkdownDiffView.svelte` |
| **NEW** UI proposal adapter | `src/lib/features/proposals/diff/proposalAdapter.ts` |
| Native proposals on detail item | `src-tauri/src/ai/mod.rs` (`InboxItemDetail.proposals`), `store.rs` (`to_detail_item` → `derive_proposals`), `src/lib/types/ai.ts` (`InboxItemDetail.proposals`) |
| Editor pending-proposal pill | `src/lib/features/notepad/NotepadPane.svelte`, `Notepad.svelte` (`getPaneViewModel`), `proposals/session.ts` (`getPendingProposalNotice`) |
| Editor read-only review overlay | `src/lib/features/notepad/NotepadPane.svelte` (overlay + `isReviewOverlayOpen`), `Notepad.svelte` (`reviewOverlay` in `getPaneViewModel`), `proposals/session.ts` (`getReviewOverlayModel`), `proposals/diff/MarkdownDiffView.svelte` (reused) |
| **NEW** native op generation (Phase B) | `src-tauri/src/ai/block_ops.rs` (`NativeOperationInput`, `NativeOpsResponse`, `native_inputs_to_block_ops`, `build_block_listing`, `reconstruct_from_native_ops`), `src-tauri/src/ai/mod.rs` (`try_native_edit_job` wired first in `run_edit_job`, whole-file fallback preserved) |
| **NEW** Rust block ops + apply + bridge | `src-tauri/src/ai/block_ops.rs` |
| **NEW** Rust segmenter | `src-tauri/src/ai/block_segment.rs` |

---

## Live vs. helper-only (what is actually wired)

| Capability | Status |
| --- | --- |
| Native op *generation* — single-note edit path (Phase B) | **Live for `run_edit_job`** (CleanUp/Summarize/Outline/ActionItems/Decisions/MeetingNotes/Evergreen/Retitle/StudyGuide + CustomSingleNote). The model is sent the block listing and asked for typed ops; `reconstruct_from_native_ops` validates + applies them to produce `new_markdown`. **Whole-file fallback preserved** — any provider error, parse error, validation failure, stale op, or empty op list falls through to the unchanged whole-file `CleanUpProposal` path. Integrate/custom-advanced/split-up generation remain whole-file (deferred). |
| Live generate (whole-file `AiChange`) | **Live as the fallback** for the edit path + **still primary** for integrate/custom-advanced/split-up (multi-note plan→edit). No prompt churn for those. |
| Live apply of `AiChange::UpdateNote` body | **Live, via the structured-op bridge** (`apply_update_note_via_ops` → `apply_operations`) with verbatim whole-file fallback. Byte-identical to v1 on the happy path. |
| Rust `apply_operations` / `derive_replace_ops` / `validate_operations` | **Live for `UpdateNote` apply** via the bridge, **live at storage time** (ops derived + persisted in the v2 envelope), and **live at generation time** for the edit path (`validate_operations` gates native ops before reconstruction). |
| Rust `change_proposal_from_update_note` (v1 blob → v2 `ChangeProposal`) | **Live at storage time.** Every new `UpdateNote` job now persists a derived `ChangeProposal` in `proposed_changes_json` (see "Schema-v2 storage" below). |
| Schema-v2 `ChangeProposal` storage (in opaque `proposed_changes_json`) | **Live + back-compatible.** New jobs write the v2 envelope; old v1 array blobs still deserialize/preview/apply exactly (shape-detected on read). Round-trip + apply tested. |
| TS diff surface + op adapter (Phase C) | **Live UI** for display. |
| Op-level accept/reject (Phase C) | **Live.** Per-op cards in `ProposalReviewList.svelte`; `ReviewUpdateChange.acceptedOpIds` tracks selection; approval builds a partial body via `applyOperations` and persists through `approve_inbox_item_with_changes` (modified `newMarkdown`, same `path`+`baseContentHash` — accepted by `validate_override_changes`). **No new table/migration.** |
| Native proposals surfaced to client | **Live.** `InboxItemDetail.proposals` (Rust `to_detail_item` → `derive_proposals` over the source body; TS `InboxItemDetail.proposals: ChangeProposal[]`). Old jobs fall back to client-derived ops/whole-file diff. |
| Editor pending-proposal indicator (Phase D) | **Live, read-only.** Pill in `NotepadPane.svelte` driven by `getPendingProposalNotice` over `activeProposalSession`. Shown only while the proposal session is active (it is cleared when the inbox view disposes); no persistence, no inline review. |
| Editor in-editor review overlay (Phase D) | **Live, read-only.** Full-pane overlay in `NotepadPane.svelte` (toggled from the pill via pane-local `isReviewOverlayOpen`) reuses `MarkdownDiffView` to show the open note's current→proposed diff + accepted/total op counts; model from `getReviewOverlayModel`. Decisions routed to inbox ("Decide in inbox"). No StateField, no doc decoration, no mutation of the editing surface or undo history. |
| Inline anchored decorations (Phase D full) | **Deferred.** A mutating `unifiedMergeView` violates read-only v1, and a non-mutating decoration `StateField` would have to track op block ranges across the multi-pane `FileEditorRuntime` root-sync/undo path — high risk for a read-only preview that the overlay already delivers. See "Phase D — Editor inline review" below. |

### Schema-v2 storage (this run) — native ops persisted alongside v1

`proposed_changes_json` now carries a **shape-detected** payload (`store.rs`):

- **v1 (legacy):** a JSON *array* of `AiChange`. Read unchanged → `Vec<AiChange>`. No native ops.
- **v2 (new):** a JSON *object* `ProposedChangesEnvelope { schemaVersion, changes, proposals }`.
  `changes` is the **verbatim** v1 `Vec<AiChange>` (so every existing consumer — preview,
  inbox `to_detail_item`/`to_list_item`, the whole-file apply gate — is untouched);
  `proposals` is the derived `Vec<ChangeProposal>` (block-replacement ops + base block map +
  `full_file_fallback`).

Both `insert_job` and `update_job_status` now serialize via `serialize_changes_with_base`,
deriving ops from the **job's source-snapshot body** (`SourceSnapshot.markdown`) → the proposed
`new_markdown` with `change_proposal_from_update_note`. **Generation is unchanged** — the model
still returns whole-file rewrites; storage/apply became op-native (the recommended-safe
intermediate). `deserialize_changes` surfaces the v1 changes for all current callers;
`deserialize_proposals` surfaces the native `ChangeProposal`s for op-aware consumers (apply
re-derives live, so stored proposals currently drive preview/audit + future op-level UI).

### Per-op stale and the existing API

The persisted job model only carries job-level status (`Applied`/`Stale`/`Failed`), not
per-op state — there is no schema/UI surface for "op 3 of 5 went stale". Representing
per-op stale would require the `change_operations` table (Phase E) plus UI work. Until
then the live bridge **fails safe**: if any derived op goes stale against the live body
(or the reconstructed body doesn't byte-match the proposed body), it discards the
structured result and writes the verbatim whole-file body — exactly the v1 outcome, never
a partially-applied note. The outer file-level `content_hash` gate still surfaces
whole-file drift as the existing job-level `Stale`.

---

## Phase 0 — De-risking spikes

### 0(a) `@codemirror/merge` spike  ✅ (promoted to production)
- [x] Add `@codemirror/merge` dependency (`^6.12.2`).
- [x] Stand up `unifiedMergeView`. Rather than a throwaway flag, this landed directly as a
      reusable read-only component: `diff/mergeDiffView.ts` (factory) + `diff/MarkdownDiffView.svelte`
      (Svelte 5 wrapper with `$effect`-based mount/teardown — no detached-view leak).
- [x] `collapseUnchanged`, gutter, and inline change highlighting wired and themed to the app's
      CSS vars. `mergeControls: false` — accept/reject stays on the inbox's own buttons (review is
      read-only in v1; CodeMirror's per-chunk controls would mutate the doc).
- Acceptance: ✅ renders current→proposed inline; toggle switches full-file ⇄ changed-regions.
  *Note:* per-chunk `acceptChunk`/`rejectChunk` intentionally NOT used (would mutate; v1 is
  read-only). Per-op accept will be driven by op `status`, not CodeMirror controls.

### 0(b) Block segmentation spike  ✅ (folded into Phase A.1 this run)
- [x] Segment a note from the Lezer markdown tree into addressable blocks.
- [x] Prove `block_id`s survive realistic edits (edit-in-place, insert, reorder) on sample notes.
- [x] **Gate decision:** with stable ordinal+anchor IDs proven, AI-addresses-blocks is viable;
      full-file→derive-ops remains the permanent fallback (see `deriveReplaceOps`).

---

## Phase A — Block model + segmentation + apply

### A.1 Segmentation (`blocks/segmentMarkdown.ts`)  ✅
- [x] `Block` model: `{ blockId, anchorHash, from, to, kind, text, ordinal }`.
- [x] `segmentMarkdown(doc): Block[]` walks the Lezer markdown tree (`@codemirror/lang-markdown`
      via `EditorState` + `ensureSyntaxTree`, the same approach as `markdown.test.ts`) and emits
      top-level block units: headings, paragraphs, list groups, code fences, blockquotes,
      tables, frontmatter, horizontal rules.
- [x] `blockId = hash(normalizedText + ":" + ordinalAmongSiblings)`; `anchorHash = hash(text)`.
- [x] Pure, runtime-neutral (no DOM/view) so it runs in node tests and can be reused by
      generation packing, the inbox renderer, and the editor overlay.
- Acceptance: ✅ same input → identical block list; documented hashing.

### A.2 BlockOp change model
- [x] TS union (`blocks/blockOps.ts`): `ReplaceBlock | InsertAfter | InsertBefore | DeleteBlock
      | UpdateMeta | RenameHeading`, each with `opId`, `status`, `confidence`.
- [x] TS `ChangeProposal` container: `threadId`, `filePath`, `baseContentHash`, `baseBlockMap`,
      `operations`, `fullFileFallback?`, `summary`, `schemaVersion`.
- [x] Rust mirror: `BlockOp` enum + `ChangeProposal` struct in `src-tauri/src/ai/block_ops.rs`,
      `#[serde(tag = "kind")]` to match the TS union, serialized inside the existing opaque
      `proposed_changes_json` column with a `schema_version` field. **No destructive migration.**
      Compiles + serde round-trip tested (`change_proposal_round_trips_through_json`).
- [x] Wire `AiChange::UpdateNote` ↔ `ChangeProposal` (`change_proposal_from_update_note`) so a
      v1 whole-file blob decomposes into v2 block ops; old blobs still deserialize untouched.
      **Helper-only — not yet on the live persistence/apply path** (see "live vs helper-only").

### A.3 Validation + apply
- [x] TS validation (`blockOps.ts` `validateOperations`): every op references a real `blockId`
      in `baseBlockMap`, `anchorHash` matches, no two ops target the same block, op kind permitted.
- [x] TS apply (`applyOperations`): accept none / all / subset → produce minimal text edits;
      per-op stale detection when a block's live `anchorHash` no longer matches.
- [x] `deriveReplaceOps(base, proposedFull)`: decompose a full-file fallback into `ReplaceBlock`
      ops by segment-diffing base vs proposed. **Rust mirror landed** (`derive_replace_ops`,
      deterministic op-ids, tested).
- [x] Rust segmenter `block_segment.rs` (blank-line boundaries, atomic fenced code, FNV-1a
      `anchor_hash` byte-compatible with TS — golden values locked). Documented compatibility
      boundary (NOT a Lezer port; remap keys on `anchor_hash`, not `block_id` parity).
- [x] Rust `apply_operations`: re-segment live doc → remap each accepted op by `anchor_hash`
      (fallback `block_id`) → minimal right-to-left edits → never a whole-doc rewrite. Per-op
      `anchor_hash` mismatch marks just that op stale (proposal not failed).
- [x] **Live wiring (done):** `apply_job_changes` in `approval_service.rs` applies
      `AiChange::UpdateNote` bodies through `apply_update_note_via_ops` (derive ops → accept all
      → `apply_operations`), keeping the file-level `content_hash` base check as the outer gate.
      Fails safe to the verbatim whole-file body if any op is stale or the reconstruction does
      not reproduce the proposed body — so the result is byte-identical to v1 on the happy path
      and never partially applied. Per-op stale cannot be surfaced through the current job-level
      API (see "Per-op stale and the existing API"); documented and handled by safe fallback.

### A.4 Round-trip tests
- [x] TS: generate ops → accept none/all/subset → apply → assert file equals expected.
- [x] TS: reordered file, edited-adjacent block, deleted-target block → stale.
- [x] Rust: mirrored the matrix in `block_ops.rs` tests — accept none/all/subset, insert-after,
      delete + trailing-blank swallow, reorder remap, edited-adjacent → stale, deleted-target →
      stale, bridge round-trip (derived ops reproduce the proposed file). `cargo test --lib
      ai::block` → 29 passed.
- [x] Rust: live `apply_job_changes` integration tests in `approval_service.rs` —
      `live_apply_updates_note_body_to_proposed_body` (structured apply produces the proposed
      body), `live_apply_no_op_change_keeps_body_byte_identical` (identity), and
      `live_apply_fails_stale_when_file_changed_after_snapshot` (file-level drift → `ApplyError::Stale`,
      fails safe). Plus block-level `live_apply_*` tests in `block_ops.rs` covering structured-vs-fallback
      selection. `cargo test --lib ai::approval_service` → 5 passed; `cargo test --lib ai::block` → 33 passed.

---

## Phase B — Generation contract (`src-tauri/src/ai/mod.rs`)
> **Native op generation is LIVE for the single-note edit path (this run); whole-file
> generation is preserved as the fallback and remains primary for multi-note jobs.**
> `run_edit_job` now tries native ops first (`try_native_edit_job`): it sends the model the
> block listing (`build_block_listing`) and asks for typed operations referencing
> `blockId`+`anchorHash`, parses them via the existing `parse_model_json` pattern
> (`NativeOpsResponse`), then `reconstruct_from_native_ops` **validates** (`validate_operations`
> + `permitted_kinds_for_mode(false)` — no deletes on the edit path) and **applies**
> (`apply_operations`) the ops against the source to produce `new_markdown`. The result is
> emitted as a standard `AiChange::UpdateNote`, so **all downstream storage/preview/apply is
> unchanged** (storage still derives + persists schema-v2 proposals from base→proposed).
>
> **The whole-file fallback is never removed.** Any of: provider error on the native call,
> JSON parse failure, validation error, stale op, an empty op list, or an empty note →
> `try_native_edit_job` returns `None` and `run_edit_job` falls through to the unchanged
> `complete_json` → `parse_model_json::<CleanUpProposal>` whole-file path. So a model that
> ignores the op schema and returns a rewrite still works exactly as before.
- [x] **Storage emits/persists native ops.** New `UpdateNote` jobs persist a derived
      `ChangeProposal` in the v2 envelope; v1 array blobs still deserialize/preview/apply exactly.
      Tests: `ai::store::proposed_changes_storage_tests` (v1 unchanged, v2 round-trip, v2 applies
      through `apply_operations`, delete-only carries no ops). `cargo test --lib ai::store` → 5 passed.
- [x] **Edit-path prompt sends block-segmented note + requests operations (this run).**
      `try_native_edit_job` builds a `blocks` array (`blockId`/`anchorHash`/`kind`/`ordinal`/`text`)
      and an `operations` outputSchema; reuses the per-mode `EditPromptProfile.system_prompt`+`rules`
      verbatim ("no new facts / return JSON only") plus three op-specific rules. Split/integrate/
      custom-advanced builders still send whole-file (deferred — multi-note plan→edit is higher risk).
- [x] **New parse structs via `parse_model_json` → `BlockOp[]` (this run).**
      `NativeOperationInput` (parse-only, no `status`; deny-nothing unknown fields) +
      `NativeOpsResponse { summary, operations }`; `native_inputs_to_block_ops` assigns
      `status: Pending` and deterministic `native_N` ids. Kept separate from `BlockOp` so the
      strict persistence round-trip (`OpStatus` has no `Default`) can't break.
- [x] **Validation reused for generation (this run).** `reconstruct_from_native_ops` runs
      `validate_operations` against the freshly segmented base block map with
      `permitted_kinds_for_mode(false)` (edit path may not delete), then `apply_operations`;
      a stale op or any validation error aborts → whole-file fallback.
- [x] **Full-file fallback preserved (this run).** Native attempt failure (parse/validation/
      stale/empty) falls through to the unchanged whole-file path; storage then `deriveReplaceOps`
      so the user still gets block-level review either way. Never all-or-nothing.
- [x] **Per-file AI `summary` surfaced.** `NativeOpsResponse.summary` flows into the
      `GeneratedProposal.summary` on the native path (same field the whole-file path uses).
- [ ] **Deferred:** native op generation for integrate / custom-advanced / split-up (multi-note
      plan→edit). These keep whole-file generation; storage/apply remain op-native via derived ops.

**Tests (this run, no live model calls):**
- `ai::block_ops::tests` native-op unit tests (parse from model JSON shape, `Pending` status +
  deterministic ids, valid reconstruct, empty/unknown-block/stale-anchor/disallowed-delete →
  fallback errors, block-listing shape). `cargo test --lib ai::block_ops` → 34 passed.
- `ai::tests::native_edit_generation` integration tests with a scripted in-memory
  `GenerationProvider`: native path reconstructs the body as an `UpdateNote`; empty ops → whole-file
  fallback; invalid op → whole-file fallback. `cargo test --lib ai::` → 65 passed.

## Phase C — Inbox UI on ops
- [x] Replace `<pre>` whole-file panes in `ProposalReviewList.svelte` with `unifiedMergeView`
      (`MarkdownDiffView`). The existing per-file accept/reject buttons and `pathFilter`/
      `compact`/`minimal` props are preserved; the legacy full-file `AiChange` flow is untouched.
- [x] Full-file ⇄ changed-regions toggle via `collapseUnchanged` (per-change, defaults to
      changed-regions).
- [x] UI bridge (`proposalAdapter.ts`): `ReviewChange` → `ChangeProposal` + `BlockOpView[]`
      (before/after pairs) via `deriveReplaceOps`, ready for op cards. **UI-only, no persistence
      change.** Unit-tested (`proposalAdapter.test.ts`).
- [x] Op-card layout (render `BlockOpView[]` as individual accept/reject cards). Live in
      `ProposalReviewList.svelte`: each `updateNote` change shows a "Block edits · X/Y accepted"
      section with per-op Accept/Reject + before/after text. Op views are derived against
      `currentMarkdown` so the cards and the merge diff describe the same edit.
- [x] Per-op / per-file accept-reject driven by op selection in `proposals/session.ts`.
      `ReviewUpdateChange` carries `ops` + `acceptedOpIds`; `toggleProposalOp` / `setAllProposalOps`
      mutate the set; `approvedMarkdownForUpdate` turns the accepted subset into the body to apply
      (all → verbatim proposed; subset → `applyOperations` partial merge; none + title unchanged →
      change dropped). Approval rides the **existing** `approve_inbox_item_with_changes` payload —
      no backend/DB change. Native proposals are surfaced via `InboxItemDetail.proposals` for
      op-aware consumers; old jobs fall back to client-derived ops. Tests:
      `reviewChanges.test.ts`, `session.test.ts`, `proposalAdapter.test.ts`.

## Phase D — Editor inline review (read-only v1)
- [x] **Modest pending indicator (this run).** A read-only "AI change pending review" pill in
      `NotepadPane.svelte`, computed in `Notepad.svelte`'s `getPaneViewModel` via
      `getPendingProposalNotice(activeProposalSession, paneDocument.currentNotePath)`. Clicking it
      navigates to `/inbox`. Non-invasive: no editor StateField, no doc decorations, no inline
      mutation. Tested (`getPendingProposalNotice` in `session.test.ts`).
      *Caveat:* the proposal session is owned by the inbox view and cleared on its dispose, so the
      pill is live while the inbox is active (e.g. a split pane). Persisting a pending-set
      independent of the inbox view is deferred.
- [x] **Read-only in-editor review overlay (this run).** The pill now reads "Review AI change" when
      the open note has a pending `updateNote` proposal and opens a full-pane **read-only** overlay
      (`NotepadPane.svelte`, pane-local `isReviewOverlayOpen`). The overlay reuses `MarkdownDiffView`
      (the same `@codemirror/merge` renderer the inbox uses) to show the open note's current→proposed
      diff, plus accepted/total block-op counts and any rename. Model comes from
      `getReviewOverlayModel(activeProposalSession, currentNotePath)` — the **same** proposal/op state
      the inbox uses; the overlay reflects op-level rejections made in the inbox in its counts.
      Decisions are routed to the inbox ("Decide in inbox" → `/inbox`); the overlay never mutates the
      document, selection, or undo history. The overlay auto-closes when the note swaps or the
      proposal clears (a `$effect` resets the flag when `reviewOverlay` is `null`). Tested:
      `getReviewOverlayModel` in `session.test.ts` (model shape, op-count reflection, null cases).
- [ ] **Full inline anchored decorations — deferred (serious attempt assessed, then chosen against).**
      Goal was a proposal `Compartment`/`StateField` in `editor.ts` (mirror `searchQueryField`) that
      anchors ops to live block ranges and paints read-only inline diff decorations with in-editor
      accept/reject + next/prev. **Why deferred:** (1) the natural inline-diff tool, `unifiedMergeView`,
      *mutates the document* (it inserts the proposed text as a tracked change), which directly
      violates the read-only-v1 / no-editable-while-pending constraint; (2) a strictly non-mutating
      decoration `StateField` would still have to keep op→block-range anchors stable across the
      multi-pane `FileEditorRuntime`, where the headless root view owns undo history and every
      pane's `docChanged` transaction is forwarded/broadcast to the root and sibling panes
      (`dispatchFromPane`/`broadcastTransactions`) — mapping decoration ranges correctly through that
      sync path, while a pending proposal is shown, is exactly the kind of undo/selection regression
      the task says to avoid. The full-pane overlay delivers the same read-only current→proposed review
      against the identical proposal state with **zero** risk to the editing/undo path, so it is the
      strongest safe alternative for this pass. Inline decorations remain the natural next slice once
      op generation is native (Phase B) and the anchor-remap matrix (Phase A.4) is exercised in-editor.
- [ ] Gutter + toggle in/out of full review mode. *Deferred (depends on inline decorations above).*

## Phase E — Polish & safety (deferred)
- [ ] Graduate per-op state to a `change_operations` table for richer audit.
- [ ] Multi-file "commit accepted together"; preview final accepted-file state.
- [ ] Policy auto-apply for low-risk op kinds via the existing `CleanUpApplyPolicy` seam.

---

## Migration & risk notes
- Both models stay alive during migration; the full-file fallback **is** the back-compat path.
- Opaque `proposed_changes_json` + `schema_version` ⇒ no destructive migration; old
  applied/rejected jobs stay readable. Old `AiChange` blobs must still deserialize.
- Biggest risk = block-addressing stability → mitigated by Phase 0(b) gate + permanent
  full-file fallback.
- Apply correctness (per-op anchor remap) is the new sharp edge → Phase A.4 matrix.

## Sandbox / environment notes
- **Cargo toolchain now available** (rustc/cargo 1.96 + GTK/webkit/soup dev libs installed).
  The Rust block path now compiles and is tested: `cd src-tauri && source $HOME/.cargo/env &&
  cargo test --lib ai::block` → **29 passed** (8 segmenter + 21 block_ops incl. apply + bridge).
  `cargo test --lib ai::` → **53 passed** (latest run; includes 7 `ai::store` storage tests — 2 new
  `derive_proposals` tests this run asserting the detail item surfaces one proposal per `UpdateNote`).
- **Pre-existing Rust failures (not from this work):** `cargo test --lib` shows 6 failures in
  `semantic::chunking`, `lexical`, `index`, `search`, `commands` — the `project-atlas.*.json`
  expectation fixtures describe an `## Overview`-headed, blank-line-stripped markdown variant
  that no longer matches `test-fixtures/project-atlas.md` on disk (fixture drift). None of these
  modules touch `ai::block*`; the `ai::` suite is fully green. Left untouched (out of scope; the
  fixtures need regenerating by whoever owns the chunker).
- No Tauri/browser runtime → the merge diff component is verified by `vitest` (adapter logic) and
  types only; the rendered `unifiedMergeView` is still **not** visually exercised in-app. Manual
  inbox smoke test (open a proposal, toggle full-file ⇄ changed-regions, accept/reject) still
  recommended on a machine with the Tauri dev server.
- TS suite: `npx vitest run` → **21 files / 144 passed** (latest run; +`reviewChanges.test.ts` 10,
  +`session.test.ts` 13 — 3 new `getReviewOverlayModel` tests for the Phase D overlay this run —
  plus the op-aware additions to `proposalAdapter.test.ts`). (The
  macOS AppleDouble `._*` junk files were deleted, so the `--exclude '**/._*'` workaround is no
  longer needed — they were also what broke the earlier Tauri build via `capabilities/._default.json`.)
- `npx svelte-check` still reports the same 10 pre-existing `number`→`Timeout` errors in unrelated
  stores (search/settings/bottomBar) from `@types/node` resolution — **0 in any new file**.
