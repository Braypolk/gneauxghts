# AI Diff Review — Reworked Plan (structured operations)

Reworks the original "AI Diff Inbox and Inline Review System" plan against the actual
Gneauxghts repo, with one decisive architectural choice: **the AI returns structured
operations against addressable blocks, not full-file rewrites.** Whole-file `newMarkdown`
is retired as the primary model (kept only as a fallback/derived view).

This is still a migration, not a greenfield build — the job lifecycle, inbox, conflict
detection, secret storage, and event plumbing all stay. What changes is the *shape of a
change*: from one opaque file blob to a list of validated block operations.

---

## 0. Why structured operations (and why it's tractable here)

The fear with "structured ops" is that it's a huge new subsystem. In this codebase it isn't,
because **the model already returns structured JSON that gets parsed into typed proposals**:

- Every job already prompts "Return JSON only" and parses via `parse_model_json` into typed
  structs (`CleanUpProposal`, `IntegratePlanResponse`, …) before mapping to `AiChange`
  (`src-tauri/src/ai/mod.rs`, `run_edit_job`/`run_integrate_job`/`run_split_up_job`/`run_custom_advanced_job`).
- So we are **changing the JSON schema and the parse/apply layer**, not adding a new
  generation pipeline. The provider, worker loop, queue, lifecycle, and inbox are untouched.

Benefits over full-file:
- Real per-operation accept/reject (no reconstructing a file from a merge view).
- Smaller, auditable changes; cheaper conflict remapping (anchor a single block, not a file).
- Natural multi-file and agent-neutral semantics.
- Avoids whole-document replacement on apply → preserves editor selection/history far better.

Cost: the model must address blocks reliably, and we must validate/remap operations against
the live file. Both are bounded and testable. We mitigate with a **full-file fallback** that
is immediately decomposed into operations, so a weak model never blocks review.

---

## 1. The new change model

Replace the whole-file `AiChange::UpdateNote { new_title, new_markdown }` with an
operation-based model. Conceptual shape (Rust enum + matching TS union):

```
ChangeProposal {
  thread_id            // = ai_jobs.id (agent-neutral)
  file_path
  base_content_hash    // revision the ops were computed against
  base_block_map       // ordered block ids + hashes captured at generation time
  operations: [ BlockOp ]
  full_file_fallback?  // optional: proposed full markdown, used only if ops can't apply
  summary              // per-file "what changed & why"
}

BlockOp =
  | ReplaceBlock  { block_id, anchor_hash, original_text, new_text }
  | InsertAfter   { block_id, anchor_hash, new_text }
  | InsertBefore  { block_id, anchor_hash, new_text }
  | DeleteBlock   { block_id, anchor_hash, original_text }
  | UpdateMeta    { field, new_value }        // frontmatter/title etc.
  | RenameHeading { block_id, anchor_hash, new_text }

each op also carries: op_id, status (pending|accepted|rejected), confidence
```

Persistence: `proposed_changes` already serializes as `proposed_changes_json TEXT`
(`store.rs:310`) — an **opaque JSON blob** with a `schema_version` helper and additive
`ALTER TABLE` migrations already in use. So the new model fits the existing column with a
schema-version bump; no destructive migration. Per-op accepted/rejected state and audit can
either ride in the same blob (v1) or graduate to a `change_operations` table (later).

---

## 2. Block addressing (the foundation everything rests on)

Before sending a note to the AI, segment its Markdown into **stable, addressable blocks** and
send IDs + hashes + surrounding context. Reuse the existing CM6 markdown infrastructure:

- The decoration host (`markdownExtensions.ts`) already walks the syntax tree via
  `@codemirror/language`'s `syntaxTree`. Reuse the **same Lezer markdown tree** to segment
  into block units: headings/sections, paragraphs, list-item groups, code fences, tables,
  frontmatter. This keeps segmentation consistent between what the editor renders and what
  the AI addresses.
- A `block_id` = stable hash of (normalized block text + ordinal among siblings); `anchor_hash`
  = hash of the block's current text. This is what conflict detection compares on apply.
- Segmentation lives in **one shared TS module** (`blocks/segmentMarkdown.ts`) used by:
  generation packing (what we send the model), the inbox renderer, and the editor overlay.
  The Rust side stores the `base_block_map` so apply can re-segment and remap.

This is the genuinely new engineering. Budget for it explicitly; it's Phase A.

---

## 3. Generation contract (the AI worker change)

Update the prompt + parse layer in `mod.rs`. The model already returns JSON; we change the
schema it must produce and the struct we parse into.

- **Prompt:** send the block-segmented note (ids + text + light context) and instruct the
  model to return a list of operations referencing `block_id`s, NOT a rewritten file. Keep
  the existing "no new facts / return JSON only" guardrails verbatim.
- **Parse:** new typed structs parsed by `parse_model_json` → mapped to `BlockOp[]`.
- **Validate-before-store:** extend `validate_job_changes` to check each op references a real
  `block_id` from the sent map, `anchor_hash` matches, no overlapping ops on the same block,
  and op kind is permitted for the job mode (reuse the delete-restriction pattern already in
  `validate_override_changes`).
- **Full-file fallback:** if the model returns a full rewrite (or ops fail validation badly),
  accept the full markdown but **immediately diff it against the base to derive ReplaceBlock
  ops**, so the user still gets block-level review. Never force all-or-nothing.

Apply path (`apply_job_changes` in `approval_service.rs`): instead of `persist_note` with a
whole new markdown, apply accepted ops as **minimal text edits** to the file:
re-read file → re-segment → remap each accepted op's `anchor_hash` to a live range → apply
ranges → write. Keep the existing `content_hash` base check; per-op `anchor_hash` mismatch on
a single block marks just that op stale (not the whole file), which is a strict UX upgrade.

---

## 4. Rendering & review surfaces (shared engine)

One engine, two layouts — unchanged principle, now fed by ops instead of file blobs.

- **Inbox:** thread → files → operations. Each op renders as a calm card (default) with
  before/after for that block plus context, and Accept/Reject. Per-file = accept/reject all
  ops; per-thread = accept/reject all files. Reuse `ProposalReviewList.svelte`'s
  `pathFilter`/`compact`/`minimal` props.
- **Diff rendering:** use `@codemirror/merge` `unifiedMergeView` (new dep) for the
  "show changed regions / full file" views. For a single op, feed it the block's
  original/new; for full-file view, feed file original/proposed-with-accepted-ops-applied.
  `collapseUnchanged` toggles compact ⇄ full file (one flag). `mergeControls` +
  `acceptChunk`/`rejectChunk` give per-region buttons; map those events back to op status.
- **Editor inline review (read-only in v1):** add a proposal `Compartment`+`StateField` in
  `editor.ts` (mirrors existing `searchQueryField`). When a file with pending ops is opened,
  show the ops inline as read-only diff decorations anchored to live block ranges, with
  accept/reject + next/prev wired to the same op-status actions as the inbox. Toggle to exit.
  **Do not promise editable-while-pending in v1** — read-only overlay with explicit toggle.

---

## 5. Phases

### Phase 0 — Two spikes (de-risk the two unknowns), ~1–1.5 days
- (a) `@codemirror/merge` `unifiedMergeView` in one pane: confirm per-chunk accept/reject,
  `collapseUnchanged`, gutter, and `"accept"`/`"revert"` user-event transactions.
- (b) Block segmentation from the Lezer markdown tree: prove stable `block_id`s survive
  realistic edits (reorder, edit-in-place, insert) on sample notes. **This is the riskier
  spike** — if addressing is flaky, fall back to "AI returns full file, we derive ReplaceBlock
  ops" as the default rather than asking the model to address blocks.
- Gate: decide AI-addresses-blocks vs. derive-ops-from-full-file as the v1 default.

### Phase A — Block model + segmentation + apply (backend-heavy)
1. `blocks/segmentMarkdown.ts` shared segmentation (TS) + matching base_block_map capture (Rust).
2. New `BlockOp` change model in Rust enum + TS union; bump `proposed_changes_json` schema_version.
3. Operation validation (extend `validate_job_changes`) + minimal-edit apply in
   `apply_job_changes` with per-op anchor remap and per-op stale marking.
4. Round-trip tests: generate ops → accept none/all/subset → apply → assert file equals expected.

### Phase B — Generation contract
1. Update prompts in `mod.rs` to send segmented blocks and request operations.
2. New parse structs via `parse_model_json` → `BlockOp[]`.
3. Full-file fallback → auto-derive ReplaceBlock ops.
4. Per-file AI summary field surfaced from the job.

### Phase C — Inbox UI on ops
1. Replace `<pre>` panes with `unifiedMergeView` op cards; thread→file→op grouping.
2. Full-file ⇄ changed-regions toggle via `collapseUnchanged`.
3. Per-op / per-file / per-thread accept-reject driven by op status in `proposals/session.ts`.

### Phase D — Editor inline review
1. Proposal `Compartment`+`StateField` in `editor.ts`; anchor ops to live block ranges.
2. Read-only inline diff decorations + accept/reject + next/prev, same actions as inbox.
3. Pending badge + gutter; toggle in/out of review mode.

### Phase E — Polish & safety (optional/deferred)
- Graduate per-op state to a `change_operations` table for richer audit.
- Multi-file "commit accepted together"; preview final accepted-file state.
- Policy auto-apply for low-risk op kinds (formatting/metadata) via existing
  `CleanUpApplyPolicy` seam; content ops always approval-gated.

> Phases A→D are sequential (each depends on the prior). A+B can be built behind a flag while
> the existing full-file path keeps working, then C+D swap the UI over.

---

## 6. Migration & risk

- **Keep both models alive during migration.** The full-file fallback IS the back-compat path:
  old jobs / weak models still produce reviewable ops via derive-from-full-file. Flip the
  default once block addressing proves out in Phase 0(b).
- **Schema:** opaque `proposed_changes_json` + schema_version means no destructive migration;
  old applied/rejected jobs remain readable.
- **Biggest risk = block addressing stability.** Mitigation: Phase 0(b) gate + full-file
  fallback as a permanent safety net, not a temporary one.
- **Apply correctness:** per-op anchor remap is the new sharp edge — cover with the Phase A
  round-trip test matrix (reordered file, edited-adjacent block, deleted target block → stale).
- **Editable-while-pending:** descoped to read-only review in v1.
- **Decoration churn:** keep proposal/op state in a `StateField`/`Compartment`, not recomputed
  from the syntax tree on every `docChanged`.

---

## 7. What stays exactly as-is (do not touch)

Job lifecycle & `AiJobStatus`; queue + worker loop (`remember_orchestrator.rs`); provider
abstraction (`provider.rs`, `complete_json`); secret storage split; inbox grouping/refresh
(`inbox/store.ts`, `listResource.ts`); base-revision `content_hash` file-level conflict gate;
vault-local `.gneauxghts/ai.sqlite3` storage; agent-neutral `StoredAiJob`/`thread_id` model.
