//! Structured block operations — the Rust mirror of the TS `BlockOp`/`ChangeProposal`
//! model in `src/lib/features/notepad/blocks/blockOps.ts`.
//!
//! This is the conceptual model for the migration described in
//! `docs/AI_DIFF_REVIEW_PLAN.md`: AI changes become structured operations against
//! addressable Markdown blocks instead of an opaque whole-file `new_markdown`.
//!
//! Persistence: a `ChangeProposal` serializes inside the EXISTING opaque
//! `proposed_changes_json TEXT` column (see `store.rs`) with a `schema_version`
//! field, so this is an additive schema-version bump — no destructive migration.
//! Old `AiChange` blobs (schema v1) keep deserializing through the legacy path.
//!
//! NOTE (migration status): this module defines the model + validation and is
//! unit-tested in isolation. It is intentionally NOT yet wired into the live
//! generate/validate/apply path in `mod.rs` / `approval_service.rs`; that swap
//! (Phase A.3 Rust apply remap + Phase B generation) is the next step and must be
//! done in an environment with a Rust toolchain so it can be compiled and tested.

// This module defines the structured-operations model but is not yet wired into
// the live generate/validate/apply path (see the module doc). Suppress dead-code
// warnings until Phase A.3/B integration lands.
#![allow(dead_code)]

use super::block_segment::{segment_markdown, Block};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};

/// Current schema version for the structured-operations `ChangeProposal` blob.
/// v1 is the legacy `Vec<AiChange>` shape; v2 is `ChangeProposal`.
pub(crate) const CHANGE_PROPOSAL_SCHEMA_VERSION: u32 = 2;

/// Coarse block kind, mirroring the TS `BlockKind` string union. Serializes as
/// the same lowercase strings the TS side emits so a `base_block_map` captured in
/// TS round-trips through Rust.
#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "camelCase")]
pub(crate) enum BlockKind {
    Heading,
    Paragraph,
    List,
    CodeFence,
    Blockquote,
    Table,
    HorizontalRule,
    Frontmatter,
    Other,
}

impl BlockKind {
    pub(crate) fn as_str(&self) -> &'static str {
        match self {
            BlockKind::Heading => "heading",
            BlockKind::Paragraph => "paragraph",
            BlockKind::List => "list",
            BlockKind::CodeFence => "codeFence",
            BlockKind::Blockquote => "blockquote",
            BlockKind::Table => "table",
            BlockKind::HorizontalRule => "horizontalRule",
            BlockKind::Frontmatter => "frontmatter",
            BlockKind::Other => "other",
        }
    }
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) enum OpStatus {
    Pending,
    Accepted,
    Rejected,
}

/// Block operation, tagged by `kind` to match the TS union exactly.
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub(crate) enum BlockOp {
    ReplaceBlock {
        op_id: String,
        status: OpStatus,
        #[serde(skip_serializing_if = "Option::is_none")]
        confidence: Option<f32>,
        block_id: String,
        anchor_hash: String,
        original_text: String,
        new_text: String,
    },
    InsertAfter {
        op_id: String,
        status: OpStatus,
        #[serde(skip_serializing_if = "Option::is_none")]
        confidence: Option<f32>,
        block_id: String,
        anchor_hash: String,
        new_text: String,
    },
    InsertBefore {
        op_id: String,
        status: OpStatus,
        #[serde(skip_serializing_if = "Option::is_none")]
        confidence: Option<f32>,
        block_id: String,
        anchor_hash: String,
        new_text: String,
    },
    DeleteBlock {
        op_id: String,
        status: OpStatus,
        #[serde(skip_serializing_if = "Option::is_none")]
        confidence: Option<f32>,
        block_id: String,
        anchor_hash: String,
        original_text: String,
    },
    UpdateMeta {
        op_id: String,
        status: OpStatus,
        #[serde(skip_serializing_if = "Option::is_none")]
        confidence: Option<f32>,
        field: String,
        new_value: String,
    },
    RenameHeading {
        op_id: String,
        status: OpStatus,
        #[serde(skip_serializing_if = "Option::is_none")]
        confidence: Option<f32>,
        block_id: String,
        anchor_hash: String,
        new_text: String,
    },
}

impl BlockOp {
    pub(crate) fn op_id(&self) -> &str {
        match self {
            BlockOp::ReplaceBlock { op_id, .. }
            | BlockOp::InsertAfter { op_id, .. }
            | BlockOp::InsertBefore { op_id, .. }
            | BlockOp::DeleteBlock { op_id, .. }
            | BlockOp::UpdateMeta { op_id, .. }
            | BlockOp::RenameHeading { op_id, .. } => op_id,
        }
    }

    /// `(block_id, anchor_hash)` for block-targeted ops; `None` for `UpdateMeta`.
    fn block_target(&self) -> Option<(&str, &str)> {
        match self {
            BlockOp::ReplaceBlock {
                block_id,
                anchor_hash,
                ..
            }
            | BlockOp::InsertAfter {
                block_id,
                anchor_hash,
                ..
            }
            | BlockOp::InsertBefore {
                block_id,
                anchor_hash,
                ..
            }
            | BlockOp::DeleteBlock {
                block_id,
                anchor_hash,
                ..
            }
            | BlockOp::RenameHeading {
                block_id,
                anchor_hash,
                ..
            } => Some((block_id, anchor_hash)),
            BlockOp::UpdateMeta { .. } => None,
        }
    }

    /// Whether this op mutates its target block in place (vs. inserting a sibling).
    /// Two mutating ops on the same block conflict; inserts do not.
    fn is_mutating(&self) -> bool {
        matches!(
            self,
            BlockOp::ReplaceBlock { .. } | BlockOp::DeleteBlock { .. } | BlockOp::RenameHeading { .. }
        )
    }

    pub(crate) fn kind_str(&self) -> &'static str {
        match self {
            BlockOp::ReplaceBlock { .. } => "replaceBlock",
            BlockOp::InsertAfter { .. } => "insertAfter",
            BlockOp::InsertBefore { .. } => "insertBefore",
            BlockOp::DeleteBlock { .. } => "deleteBlock",
            BlockOp::UpdateMeta { .. } => "updateMeta",
            BlockOp::RenameHeading { .. } => "renameHeading",
        }
    }
}

/// A block map entry captured at generation time so apply can re-segment + remap.
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct BlockMapEntry {
    pub(crate) block_id: String,
    pub(crate) anchor_hash: String,
    pub(crate) kind: String,
    pub(crate) ordinal: u32,
}

/// Schema-versioned proposed-changes representation. Replaces the opaque
/// whole-file model as primary; `full_file_fallback` is the safety net.
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ChangeProposal {
    pub(crate) schema_version: u32,
    pub(crate) thread_id: i64,
    pub(crate) file_path: String,
    pub(crate) base_content_hash: String,
    pub(crate) base_block_map: Vec<BlockMapEntry>,
    pub(crate) operations: Vec<BlockOp>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) full_file_fallback: Option<String>,
    pub(crate) summary: String,
}

#[derive(Clone, Debug, PartialEq)]
pub(crate) struct ValidationError {
    pub(crate) op_id: String,
    pub(crate) reason: String,
}

/// Validate operations against their base block map — the Rust mirror of the TS
/// `validateOperations`. Returns the list of problems (empty ⇒ valid):
///  - every block-targeted op references a real `block_id`,
///  - `anchor_hash` matches the captured map entry,
///  - no two mutating ops target the same block (overlap),
///  - the op kind is permitted (caller supplies the allow-list for the job mode).
pub(crate) fn validate_operations(
    operations: &[BlockOp],
    base_block_map: &[BlockMapEntry],
    permitted_kinds: &[&str],
) -> Vec<ValidationError> {
    let mut errors = Vec::new();
    let by_id: HashMap<&str, &BlockMapEntry> = base_block_map
        .iter()
        .map(|entry| (entry.block_id.as_str(), entry))
        .collect();
    let mut touched: HashSet<&str> = HashSet::new();

    for op in operations {
        if !permitted_kinds.contains(&op.kind_str()) {
            errors.push(ValidationError {
                op_id: op.op_id().to_string(),
                reason: format!("Operation kind not permitted: {}", op.kind_str()),
            });
            continue;
        }

        let Some((block_id, anchor_hash)) = op.block_target() else {
            // UpdateMeta: validate the field is non-empty.
            if let BlockOp::UpdateMeta { field, .. } = op {
                if field.trim().is_empty() {
                    errors.push(ValidationError {
                        op_id: op.op_id().to_string(),
                        reason: "updateMeta requires a field name".to_string(),
                    });
                }
            }
            continue;
        };

        let Some(entry) = by_id.get(block_id) else {
            errors.push(ValidationError {
                op_id: op.op_id().to_string(),
                reason: format!("Unknown blockId: {block_id}"),
            });
            continue;
        };
        if entry.anchor_hash != anchor_hash {
            errors.push(ValidationError {
                op_id: op.op_id().to_string(),
                reason: format!(
                    "anchorHash mismatch for block {block_id} (proposal computed against a different revision)"
                ),
            });
        }
        if op.is_mutating() {
            if touched.contains(block_id) {
                errors.push(ValidationError {
                    op_id: op.op_id().to_string(),
                    reason: format!("Overlapping operations on block {block_id}"),
                });
            }
            touched.insert(block_id);
        }
    }
    errors
}

/// Permitted op kinds for a job mode. `delete_allowed` mirrors the existing
/// delete-restriction pattern in `validate_job_changes` (only integrate/custom
/// advanced may delete).
pub(crate) fn permitted_kinds_for_mode(delete_allowed: bool) -> Vec<&'static str> {
    let mut kinds = vec![
        "replaceBlock",
        "insertAfter",
        "insertBefore",
        "updateMeta",
        "renameHeading",
    ];
    if delete_allowed {
        kinds.push("deleteBlock");
    }
    kinds
}

/// Result of applying a set of accepted ops against a live document. Mirrors the
/// TS `ApplyResult`.
#[derive(Clone, Debug, PartialEq)]
pub(crate) struct ApplyResult {
    /// New document text after applying accepted, non-stale ops.
    pub(crate) text: String,
    /// opIds skipped because the live block no longer matches `anchor_hash`.
    pub(crate) stale_op_ids: Vec<String>,
    /// opIds that were applied.
    pub(crate) applied_op_ids: Vec<String>,
}

/// The text an op introduces / removes, for building the edit. Mirrors the TS
/// switch in `applyOperations`.
impl BlockOp {
    fn new_text(&self) -> Option<&str> {
        match self {
            BlockOp::ReplaceBlock { new_text, .. }
            | BlockOp::InsertAfter { new_text, .. }
            | BlockOp::InsertBefore { new_text, .. }
            | BlockOp::RenameHeading { new_text, .. } => Some(new_text),
            BlockOp::DeleteBlock { .. } | BlockOp::UpdateMeta { .. } => None,
        }
    }
}

struct Edit {
    from: usize,
    to: usize,
    insert: String,
}

/// Consume up to one trailing newline + following blank line so deleting a block
/// doesn't leave a double blank line. Mirrors the TS `swallowTrailingBlankLine`.
fn swallow_trailing_blank_line(doc: &str, to: usize) -> usize {
    let bytes = doc.as_bytes();
    let mut end = to;
    if end < bytes.len() && bytes[end] == b'\n' {
        end += 1;
        if end < bytes.len() && bytes[end] == b'\n' {
            end += 1;
        }
    }
    end
}

/// Apply accepted ops as minimal text edits against the live document.
///
/// This is the Rust mirror of the TS `applyOperations` and is the core of the
/// live apply path:
///  - re-segments `live_doc` and remaps each op to a live block by `anchor_hash`
///    (content-stable across reorder/insert), falling back to `block_id`;
///  - skips (marks stale) any op whose target block's live `anchor_hash` no
///    longer matches — a single stale block does NOT fail the whole proposal;
///  - builds edits from the live offsets and applies them right-to-left so
///    earlier offsets stay valid. Minimal targeted edit, never a whole-doc
///    rewrite.
///
/// `accepted_op_ids` selects the subset to apply (empty = accept none). Ops are
/// validated separately; this assumes already-validated ops.
pub(crate) fn apply_operations(
    live_doc: &str,
    operations: &[BlockOp],
    accepted_op_ids: &HashSet<String>,
) -> ApplyResult {
    let live_blocks = segment_markdown(live_doc);
    let mut by_anchor: HashMap<&str, &Block> = HashMap::new();
    let mut by_id: HashMap<&str, &Block> = HashMap::new();
    for block in &live_blocks {
        by_anchor.entry(block.anchor_hash.as_str()).or_insert(block);
        by_id.insert(block.block_id.as_str(), block);
    }

    let mut stale_op_ids: Vec<String> = Vec::new();
    let mut applied_op_ids: Vec<String> = Vec::new();
    let mut edits: Vec<Edit> = Vec::new();

    for op in operations {
        if !accepted_op_ids.contains(op.op_id()) {
            continue;
        }
        // UpdateMeta produces no body edit (title/frontmatter persisted elsewhere),
        // but counts as applied — mirrors the TS contract.
        if matches!(op, BlockOp::UpdateMeta { .. }) {
            applied_op_ids.push(op.op_id().to_string());
            continue;
        }
        let Some((block_id, anchor_hash)) = op.block_target() else {
            continue;
        };

        // Remap: prefer the live block whose anchor matches; fall back to id only
        // if its anchor still holds.
        let target = by_anchor
            .get(anchor_hash)
            .copied()
            .or_else(|| by_id.get(block_id).copied());
        let target = match target {
            Some(block) if block.anchor_hash == anchor_hash => block,
            _ => {
                stale_op_ids.push(op.op_id().to_string());
                continue;
            }
        };

        match op {
            BlockOp::ReplaceBlock { .. } | BlockOp::RenameHeading { .. } => {
                edits.push(Edit {
                    from: target.from,
                    to: target.to,
                    insert: op.new_text().unwrap_or("").to_string(),
                });
            }
            BlockOp::DeleteBlock { .. } => {
                let to = swallow_trailing_blank_line(live_doc, target.to);
                edits.push(Edit {
                    from: target.from,
                    to,
                    insert: String::new(),
                });
            }
            BlockOp::InsertAfter { .. } => {
                edits.push(Edit {
                    from: target.to,
                    to: target.to,
                    insert: format!("\n\n{}", op.new_text().unwrap_or("")),
                });
            }
            BlockOp::InsertBefore { .. } => {
                edits.push(Edit {
                    from: target.from,
                    to: target.from,
                    insert: format!("{}\n\n", op.new_text().unwrap_or("")),
                });
            }
            BlockOp::UpdateMeta { .. } => unreachable!("handled above"),
        }
        applied_op_ids.push(op.op_id().to_string());
    }

    // Apply right-to-left so each edit's offsets remain valid.
    edits.sort_by(|a, b| b.from.cmp(&a.from));
    let mut text = live_doc.to_string();
    for edit in &edits {
        text.replace_range(edit.from..edit.to, &edit.insert);
    }

    ApplyResult {
        text,
        stale_op_ids,
        applied_op_ids,
    }
}

/// Capture the base block map from a freshly segmented document, so apply can
/// re-segment and remap later. Mirrors the TS `toBlockMap`.
pub(crate) fn to_block_map(blocks: &[Block]) -> Vec<BlockMapEntry> {
    blocks
        .iter()
        .map(|block| BlockMapEntry {
            block_id: block.block_id.clone(),
            anchor_hash: block.anchor_hash.clone(),
            kind: block.kind.as_str().to_string(),
            ordinal: block.ordinal,
        })
        .collect()
}

/// Full-file fallback decomposition: given the base document and a proposed full
/// rewrite, derive ops so a model that returns a whole file still yields
/// block-level review. Mirrors the TS `deriveReplaceOps`:
///  - position-aligned pairing of base vs proposed blocks,
///  - text differs at a position → `ReplaceBlock`,
///  - base present / proposed absent → `DeleteBlock`,
///  - proposed present / base absent → `InsertAfter` the last matched base block
///    (or `InsertBefore` the first base block if nothing matched yet).
///
/// `op_id`s are derived deterministically (`derived_1`, `derived_2`, …) so the
/// same base/proposed pair always yields the same proposal — important because
/// this runs on the apply side and must be reproducible.
pub(crate) fn derive_replace_ops(base_doc: &str, proposed_doc: &str) -> Vec<BlockOp> {
    let base_blocks = segment_markdown(base_doc);
    let proposed_blocks = segment_markdown(proposed_doc);
    let mut ops = Vec::new();
    let mut counter = 0u32;
    let mut next_op_id = || {
        counter += 1;
        format!("derived_{counter}")
    };

    let max = base_blocks.len().max(proposed_blocks.len());
    let mut last_matched: Option<(String, String)> = None;

    for i in 0..max {
        let base = base_blocks.get(i);
        let proposed = proposed_blocks.get(i);
        match (base, proposed) {
            (Some(base), Some(proposed)) => {
                if base.text != proposed.text {
                    ops.push(BlockOp::ReplaceBlock {
                        op_id: next_op_id(),
                        status: OpStatus::Pending,
                        confidence: None,
                        block_id: base.block_id.clone(),
                        anchor_hash: base.anchor_hash.clone(),
                        original_text: base.text.clone(),
                        new_text: proposed.text.clone(),
                    });
                }
                last_matched = Some((base.block_id.clone(), base.anchor_hash.clone()));
            }
            (Some(base), None) => {
                ops.push(BlockOp::DeleteBlock {
                    op_id: next_op_id(),
                    status: OpStatus::Pending,
                    confidence: None,
                    block_id: base.block_id.clone(),
                    anchor_hash: base.anchor_hash.clone(),
                    original_text: base.text.clone(),
                });
            }
            (None, Some(proposed)) => {
                if let Some((block_id, anchor_hash)) = last_matched.clone() {
                    ops.push(BlockOp::InsertAfter {
                        op_id: next_op_id(),
                        status: OpStatus::Pending,
                        confidence: None,
                        block_id,
                        anchor_hash,
                        new_text: proposed.text.clone(),
                    });
                } else if let Some(first) = base_blocks.first() {
                    ops.push(BlockOp::InsertBefore {
                        op_id: next_op_id(),
                        status: OpStatus::Pending,
                        confidence: None,
                        block_id: first.block_id.clone(),
                        anchor_hash: first.anchor_hash.clone(),
                        new_text: proposed.text.clone(),
                    });
                }
                // base empty AND no first block ⇒ nothing to anchor to (skip).
            }
            (None, None) => {}
        }
    }
    ops
}

/// Build a schema-v2 `ChangeProposal` from a base document, capturing the base
/// block map so apply can re-segment and remap. Mirrors the TS
/// `buildChangeProposal`.
pub(crate) fn build_change_proposal(
    thread_id: i64,
    file_path: String,
    base_content_hash: String,
    base_doc: &str,
    operations: Vec<BlockOp>,
    summary: String,
    full_file_fallback: Option<String>,
) -> ChangeProposal {
    ChangeProposal {
        schema_version: CHANGE_PROPOSAL_SCHEMA_VERSION,
        thread_id,
        file_path,
        base_content_hash,
        base_block_map: to_block_map(&segment_markdown(base_doc)),
        operations,
        full_file_fallback,
        summary,
    }
}

/// Bridge a legacy whole-file `AiChange::UpdateNote` into a schema-v2
/// `ChangeProposal` by deriving block-replacement ops from the base→proposed
/// diff. This is the back-compat path: a v1 job (or a model that returns a full
/// rewrite) still produces block-level operations for review/apply, while the
/// `full_file_fallback` preserves the exact proposed text as the safety net.
///
/// **Helper-only (not yet live):** the live generate/apply path still rides the
/// whole-file `AiChange` flow in `mod.rs`/`approval_service.rs`. Wiring this into
/// persistence/apply is the next step (see the implementation checklist). Kept
/// pure + tested so the swap is mechanical.
pub(crate) fn change_proposal_from_update_note(
    thread_id: i64,
    file_path: String,
    base_content_hash: String,
    current_markdown: &str,
    proposed_markdown: &str,
    summary: String,
) -> ChangeProposal {
    let operations = derive_replace_ops(current_markdown, proposed_markdown);
    build_change_proposal(
        thread_id,
        file_path,
        base_content_hash,
        current_markdown,
        operations,
        summary,
        Some(proposed_markdown.to_string()),
    )
}

/// Outcome of applying a whole-file `UpdateNote` body through the structured-op
/// path. `text` is the body to persist. `used_structured_ops` is `false` when the
/// structured path declined (e.g. the derived ops didn't reconstruct the proposed
/// body, or a block went stale against the live document) and the caller must fall
/// back to writing `proposed_body` verbatim.
#[derive(Clone, Debug, PartialEq)]
pub(crate) struct UpdateNoteApply {
    pub(crate) text: String,
    pub(crate) used_structured_ops: bool,
    pub(crate) stale_op_ids: Vec<String>,
}

/// Apply a legacy whole-file `UpdateNote` as **minimal block-level edits** instead
/// of overwriting the whole body, while guaranteeing the v1 result byte-for-byte.
///
/// The migration goal is to avoid whole-document replacement on apply. This bridges
/// the v1 contract (`base_body` → `proposed_body`) into structured ops
/// (`derive_replace_ops`), remaps them against the **live** body, and applies only
/// the minimal edits. It is intentionally conservative:
///
///  - If any op goes stale against `live_body` (the live note diverged from the
///    base the proposal was generated against), OR the structured result does not
///    reconstruct `proposed_body` exactly, it returns `used_structured_ops: false`
///    with `text == proposed_body` — i.e. the caller writes the whole-file body,
///    exactly matching v1 behavior. **Never silently writes a wrong body.**
///
/// When `live_body == base_body` (the normal case, already enforced upstream by the
/// file-level `content_hash` gate), accepting all derived ops reproduces
/// `proposed_body` exactly, so the persisted bytes are identical to v1 — but written
/// as targeted block edits rather than a full overwrite.
pub(crate) fn apply_update_note_via_ops(
    base_body: &str,
    proposed_body: &str,
    live_body: &str,
) -> UpdateNoteApply {
    let operations = derive_replace_ops(base_body, proposed_body);
    let accepted: HashSet<String> = operations.iter().map(|op| op.op_id().to_string()).collect();
    let result = apply_operations(live_body, &operations, &accepted);

    // Fail safe: only trust the structured path when nothing went stale AND it
    // reconstructs the intended body exactly. Otherwise fall back to the verbatim
    // whole-file body (v1 behavior).
    if result.stale_op_ids.is_empty() && result.text == proposed_body {
        UpdateNoteApply {
            text: result.text,
            used_structured_ops: true,
            stale_op_ids: Vec::new(),
        }
    } else {
        UpdateNoteApply {
            text: proposed_body.to_string(),
            used_structured_ops: false,
            stale_op_ids: result.stale_op_ids,
        }
    }
}

// ---------------------------------------------------------------------------
// Phase B: native operation generation (parse-only model input)
// ---------------------------------------------------------------------------

/// Model-facing operation shape for **native generation** (Phase B). The model
/// fills these in directly, referencing block IDs + anchor hashes from the block
/// listing we send it. Distinct from `BlockOp` so that:
///  - the model never has to emit a `status` (we always assign `Pending`), and
///  - changing this parse shape can't break `BlockOp`'s strict persistence
///    round-trip (`status` is required there; `OpStatus` has no `Default`).
///
/// `kind`-tagged to match the same camelCase strings as `BlockOp`. Unknown
/// fields are ignored so a model that adds commentary keys still parses.
#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub(crate) enum NativeOperationInput {
    ReplaceBlock {
        block_id: String,
        anchor_hash: String,
        #[serde(default)]
        original_text: String,
        new_text: String,
        #[serde(default)]
        confidence: Option<f32>,
    },
    InsertAfter {
        block_id: String,
        anchor_hash: String,
        new_text: String,
        #[serde(default)]
        confidence: Option<f32>,
    },
    InsertBefore {
        block_id: String,
        anchor_hash: String,
        new_text: String,
        #[serde(default)]
        confidence: Option<f32>,
    },
    DeleteBlock {
        block_id: String,
        anchor_hash: String,
        #[serde(default)]
        original_text: String,
        #[serde(default)]
        confidence: Option<f32>,
    },
    RenameHeading {
        block_id: String,
        anchor_hash: String,
        new_text: String,
        #[serde(default)]
        confidence: Option<f32>,
    },
}

/// The model's native-generation response for a single-note edit: a per-file
/// summary plus a list of typed operations. Parsed via the same
/// `parse_model_json` pattern the whole-file path uses.
#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct NativeOpsResponse {
    pub(crate) summary: String,
    pub(crate) operations: Vec<NativeOperationInput>,
}

impl NativeOperationInput {
    /// Convert to a persistence-grade `BlockOp` with a deterministic op id
    /// (`native_1`, `native_2`, …) and `status: Pending`.
    fn into_block_op(self, op_id: String) -> BlockOp {
        match self {
            NativeOperationInput::ReplaceBlock {
                block_id,
                anchor_hash,
                original_text,
                new_text,
                confidence,
            } => BlockOp::ReplaceBlock {
                op_id,
                status: OpStatus::Pending,
                confidence,
                block_id,
                anchor_hash,
                original_text,
                new_text,
            },
            NativeOperationInput::InsertAfter {
                block_id,
                anchor_hash,
                new_text,
                confidence,
            } => BlockOp::InsertAfter {
                op_id,
                status: OpStatus::Pending,
                confidence,
                block_id,
                anchor_hash,
                new_text,
            },
            NativeOperationInput::InsertBefore {
                block_id,
                anchor_hash,
                new_text,
                confidence,
            } => BlockOp::InsertBefore {
                op_id,
                status: OpStatus::Pending,
                confidence,
                block_id,
                anchor_hash,
                new_text,
            },
            NativeOperationInput::DeleteBlock {
                block_id,
                anchor_hash,
                original_text,
                confidence,
            } => BlockOp::DeleteBlock {
                op_id,
                status: OpStatus::Pending,
                confidence,
                block_id,
                anchor_hash,
                original_text,
            },
            NativeOperationInput::RenameHeading {
                block_id,
                anchor_hash,
                new_text,
                confidence,
            } => BlockOp::RenameHeading {
                op_id,
                status: OpStatus::Pending,
                confidence,
                block_id,
                anchor_hash,
                new_text,
            },
        }
    }
}

/// Convert a list of parsed native inputs into `BlockOp`s with deterministic ids.
pub(crate) fn native_inputs_to_block_ops(inputs: Vec<NativeOperationInput>) -> Vec<BlockOp> {
    inputs
        .into_iter()
        .enumerate()
        .map(|(i, input)| input.into_block_op(format!("native_{}", i + 1)))
        .collect()
}

/// Build the numbered block listing we send the model: one entry per source
/// block with its `blockId`, `anchorHash`, `kind`, and verbatim `text`. The model
/// references these ids/hashes in the operations it returns, so apply/validation
/// can remap them. Returned as JSON values so the caller embeds them in the
/// prompt's `blocks` array.
pub(crate) fn build_block_listing(doc: &str) -> Vec<serde_json::Value> {
    segment_markdown(doc)
        .iter()
        .map(|block| {
            serde_json::json!({
                "blockId": block.block_id,
                "anchorHash": block.anchor_hash,
                "kind": block.kind.as_str(),
                "ordinal": block.ordinal,
                "text": block.text,
            })
        })
        .collect()
}

/// Outcome of a native-op generation attempt for a single note.
#[derive(Clone, Debug, PartialEq)]
pub(crate) struct NativeReconstruct {
    /// The reconstructed proposed markdown (base with all accepted ops applied).
    pub(crate) proposed_markdown: String,
    /// The validated, `Pending` operations (deterministic ids), for persistence.
    pub(crate) operations: Vec<BlockOp>,
    /// The per-file summary the model returned.
    pub(crate) summary: String,
}

/// Reason a native-op generation attempt was rejected, so the caller can fall
/// back to whole-file generation. Carries enough detail for logs/tests.
#[derive(Clone, Debug, PartialEq)]
pub(crate) enum NativeReconstructError {
    /// The model returned no operations (e.g. it opted for the full-file shape,
    /// or judged no change needed). Caller should fall back / treat as no-op.
    NoOperations,
    /// One or more operations failed validation (unknown block, anchor mismatch,
    /// overlap, or a disallowed kind). Caller falls back to whole-file.
    Validation(Vec<ValidationError>),
    /// At least one op went stale when applied against the base document — should
    /// not happen for a self-consistent native response, so we fall back.
    StaleOps(Vec<String>),
}

/// Validate native operations against the base document and reconstruct the
/// proposed markdown by applying them. This is the heart of Phase B native
/// generation: it never trusts the model's op list blindly —
///  - operations are validated against the freshly segmented base block map
///    (`validate_operations` + `permitted_kinds_for_mode`),
///  - then applied to the base via the same `apply_operations` used live,
///  - any stale op (anchor no longer matches the base) aborts the attempt.
///
/// On any failure it returns a `NativeReconstructError` so the caller can fall
/// back to whole-file generation. On success the reconstructed markdown is the
/// authoritative proposed body — downstream storage/preview/apply is unchanged
/// (it still rides the `AiChange::UpdateNote { new_markdown }` flow).
pub(crate) fn reconstruct_from_native_ops(
    base_doc: &str,
    response: NativeOpsResponse,
    delete_allowed: bool,
) -> Result<NativeReconstruct, NativeReconstructError> {
    if response.operations.is_empty() {
        return Err(NativeReconstructError::NoOperations);
    }

    let operations = native_inputs_to_block_ops(response.operations);
    let base_block_map = to_block_map(&segment_markdown(base_doc));
    let permitted = permitted_kinds_for_mode(delete_allowed);

    let errors = validate_operations(&operations, &base_block_map, &permitted);
    if !errors.is_empty() {
        return Err(NativeReconstructError::Validation(errors));
    }

    let accepted: HashSet<String> = operations.iter().map(|op| op.op_id().to_string()).collect();
    let result = apply_operations(base_doc, &operations, &accepted);
    if !result.stale_op_ids.is_empty() {
        return Err(NativeReconstructError::StaleOps(result.stale_op_ids));
    }

    Ok(NativeReconstruct {
        proposed_markdown: result.text,
        operations,
        summary: response.summary,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn entry(block_id: &str, anchor: &str) -> BlockMapEntry {
        BlockMapEntry {
            block_id: block_id.to_string(),
            anchor_hash: anchor.to_string(),
            kind: "paragraph".to_string(),
            ordinal: 0,
        }
    }

    fn replace(op_id: &str, block_id: &str, anchor: &str) -> BlockOp {
        BlockOp::ReplaceBlock {
            op_id: op_id.to_string(),
            status: OpStatus::Pending,
            confidence: None,
            block_id: block_id.to_string(),
            anchor_hash: anchor.to_string(),
            original_text: "old".to_string(),
            new_text: "new".to_string(),
        }
    }

    #[test]
    fn valid_op_passes() {
        let map = vec![entry("b_1", "h1")];
        let ops = vec![replace("op1", "b_1", "h1")];
        assert!(validate_operations(&ops, &map, &permitted_kinds_for_mode(false)).is_empty());
    }

    #[test]
    fn unknown_block_id_is_rejected() {
        let map = vec![entry("b_1", "h1")];
        let ops = vec![replace("op1", "b_missing", "h1")];
        let errors = validate_operations(&ops, &map, &permitted_kinds_for_mode(false));
        assert_eq!(errors.len(), 1);
        assert!(errors[0].reason.contains("Unknown blockId"));
    }

    #[test]
    fn anchor_hash_mismatch_is_rejected() {
        let map = vec![entry("b_1", "h1")];
        let ops = vec![replace("op1", "b_1", "stale")];
        let errors = validate_operations(&ops, &map, &permitted_kinds_for_mode(false));
        assert!(errors[0].reason.contains("anchorHash mismatch"));
    }

    #[test]
    fn overlapping_mutations_are_rejected() {
        let map = vec![entry("b_1", "h1")];
        let ops = vec![replace("op1", "b_1", "h1"), replace("op2", "b_1", "h1")];
        let errors = validate_operations(&ops, &map, &permitted_kinds_for_mode(false));
        assert!(errors.iter().any(|e| e.reason.contains("Overlapping")));
    }

    #[test]
    fn delete_blocked_unless_permitted() {
        let map = vec![entry("b_1", "h1")];
        let ops = vec![BlockOp::DeleteBlock {
            op_id: "op1".to_string(),
            status: OpStatus::Pending,
            confidence: None,
            block_id: "b_1".to_string(),
            anchor_hash: "h1".to_string(),
            original_text: "old".to_string(),
        }];
        assert!(!validate_operations(&ops, &map, &permitted_kinds_for_mode(false)).is_empty());
        assert!(validate_operations(&ops, &map, &permitted_kinds_for_mode(true)).is_empty());
    }

    #[test]
    fn change_proposal_round_trips_through_json() {
        let proposal = ChangeProposal {
            schema_version: CHANGE_PROPOSAL_SCHEMA_VERSION,
            thread_id: 7,
            file_path: "/notes/x.md".to_string(),
            base_content_hash: "abc".to_string(),
            base_block_map: vec![entry("b_1", "h1")],
            operations: vec![replace("op1", "b_1", "h1")],
            full_file_fallback: None,
            summary: "s".to_string(),
        };
        let json = serde_json::to_string(&proposal).expect("serialize");
        // The TS union discriminant must be present so both ends agree.
        assert!(json.contains("\"kind\":\"replaceBlock\""));
        assert!(json.contains("\"schemaVersion\":2"));
        let parsed: ChangeProposal = serde_json::from_str(&json).expect("deserialize");
        assert_eq!(parsed, proposal);
    }

    // --- apply_operations: exercises the real Rust segmenter end-to-end. These
    // mirror the TS blockOps.test.ts apply matrix. ---

    const DOC: &str = "# Title\n\nFirst paragraph.\n\nSecond paragraph.\n\nThird paragraph.\n";

    fn ids(slice: &[&str]) -> HashSet<String> {
        slice.iter().map(|s| s.to_string()).collect()
    }

    /// Build a ReplaceBlock op targeting block `index` of `doc`, computed against
    /// that doc's segmentation (so anchor_hash matches).
    fn replace_op_for_block(doc: &str, index: usize, new_text: &str) -> BlockOp {
        let block = &segment_markdown(doc)[index];
        BlockOp::ReplaceBlock {
            op_id: format!("op_{index}"),
            status: OpStatus::Pending,
            confidence: None,
            block_id: block.block_id.clone(),
            anchor_hash: block.anchor_hash.clone(),
            original_text: block.text.clone(),
            new_text: new_text.to_string(),
        }
    }

    #[test]
    fn apply_accept_none_returns_doc_unchanged() {
        let op = replace_op_for_block(DOC, 1, "changed");
        let result = apply_operations(DOC, &[op], &ids(&[]));
        assert_eq!(result.text, DOC);
        assert!(result.applied_op_ids.is_empty());
    }

    #[test]
    fn apply_accept_all_applies_every_op_as_minimal_edits() {
        let op1 = replace_op_for_block(DOC, 1, "First paragraph EDITED.");
        let op3 = replace_op_for_block(DOC, 3, "Third paragraph EDITED.");
        let accepted = ids(&["op_1", "op_3"]);
        let result = apply_operations(DOC, &[op1, op3], &accepted);
        assert!(result.text.contains("First paragraph EDITED."));
        assert!(result.text.contains("Third paragraph EDITED."));
        // Untouched block preserved exactly.
        assert!(result.text.contains("Second paragraph."));
        assert!(result.stale_op_ids.is_empty());
        assert_eq!(result.applied_op_ids.len(), 2);
    }

    #[test]
    fn apply_accept_subset_applies_only_selected() {
        let op1 = replace_op_for_block(DOC, 1, "First paragraph EDITED.");
        let op3 = replace_op_for_block(DOC, 3, "Third paragraph EDITED.");
        let result = apply_operations(DOC, &[op1, op3], &ids(&["op_3"]));
        assert!(result.text.contains("First paragraph.")); // unchanged
        assert!(result.text.contains("Third paragraph EDITED."));
        assert_eq!(result.applied_op_ids, vec!["op_3".to_string()]);
    }

    #[test]
    fn apply_does_not_whole_doc_rewrite() {
        let op = replace_op_for_block(DOC, 1, "First paragraph EDITED.");
        let result = apply_operations(DOC, &[op], &ids(&["op_1"]));
        let expected = DOC.replace("First paragraph.", "First paragraph EDITED.");
        assert_eq!(result.text, expected);
    }

    #[test]
    fn apply_insert_after_target() {
        let block = &segment_markdown(DOC)[1];
        let op = BlockOp::InsertAfter {
            op_id: "op_ins".to_string(),
            status: OpStatus::Pending,
            confidence: None,
            block_id: block.block_id.clone(),
            anchor_hash: block.anchor_hash.clone(),
            new_text: "Inserted paragraph.".to_string(),
        };
        let result = apply_operations(DOC, &[op], &ids(&["op_ins"]));
        assert!(result
            .text
            .contains("First paragraph.\n\nInserted paragraph."));
    }

    #[test]
    fn apply_delete_block_and_trailing_blank_line() {
        let block = &segment_markdown(DOC)[1];
        let op = BlockOp::DeleteBlock {
            op_id: "op_del".to_string(),
            status: OpStatus::Pending,
            confidence: None,
            block_id: block.block_id.clone(),
            anchor_hash: block.anchor_hash.clone(),
            original_text: block.text.clone(),
        };
        let result = apply_operations(DOC, &[op], &ids(&["op_del"]));
        assert!(!result.text.contains("First paragraph."));
        assert!(result.text.contains("Second paragraph."));
        // No leftover triple newline.
        assert!(!result.text.contains("\n\n\n"));
    }

    #[test]
    fn apply_marks_edited_adjacent_block_stale_applies_rest() {
        let op1 = replace_op_for_block(DOC, 1, "First paragraph EDITED.");
        let op3 = replace_op_for_block(DOC, 3, "Third paragraph EDITED.");
        // The user edited the FIRST paragraph after the proposal was generated.
        let live_doc = DOC.replace("First paragraph.", "First paragraph (user touched).");
        let result = apply_operations(&live_doc, &[op1, op3], &ids(&["op_1", "op_3"]));
        assert_eq!(result.stale_op_ids, vec!["op_1".to_string()]);
        assert_eq!(result.applied_op_ids, vec!["op_3".to_string()]);
        assert!(result.text.contains("Third paragraph EDITED."));
        assert!(result.text.contains("First paragraph (user touched)."));
    }

    #[test]
    fn apply_remaps_by_content_after_reorder() {
        let op3 = replace_op_for_block(DOC, 3, "Third paragraph EDITED.");
        // Move the third paragraph above the second; anchor_hash still matches.
        let live_doc =
            "# Title\n\nFirst paragraph.\n\nThird paragraph.\n\nSecond paragraph.\n".to_string();
        let result = apply_operations(&live_doc, &[op3], &ids(&["op_3"]));
        assert!(result.stale_op_ids.is_empty());
        assert!(result.text.contains("Third paragraph EDITED."));
    }

    #[test]
    fn apply_marks_deleted_target_stale() {
        let op3 = replace_op_for_block(DOC, 3, "Third paragraph EDITED.");
        // The third paragraph was removed from the live doc entirely.
        let live_doc = "# Title\n\nFirst paragraph.\n\nSecond paragraph.\n".to_string();
        let result = apply_operations(&live_doc, &[op3], &ids(&["op_3"]));
        assert_eq!(result.stale_op_ids, vec!["op_3".to_string()]);
        assert!(result.applied_op_ids.is_empty());
        assert_eq!(result.text, live_doc); // untouched
    }

    // --- bridge: AiChange::UpdateNote (whole-file) -> ChangeProposal (v2). ---

    #[test]
    fn derive_replace_ops_emits_replace_for_changed_block_only() {
        let proposed = DOC.replace("Second paragraph.", "Second paragraph EDITED.");
        let ops = derive_replace_ops(DOC, &proposed);
        assert_eq!(ops.len(), 1);
        match &ops[0] {
            BlockOp::ReplaceBlock {
                original_text,
                new_text,
                ..
            } => {
                assert_eq!(original_text, "Second paragraph.");
                assert_eq!(new_text, "Second paragraph EDITED.");
            }
            other => panic!("expected ReplaceBlock, got {other:?}"),
        }
    }

    #[test]
    fn derive_replace_ops_is_deterministic() {
        let proposed = DOC.replace("First paragraph.", "First X.");
        let a = derive_replace_ops(DOC, &proposed);
        let b = derive_replace_ops(DOC, &proposed);
        assert_eq!(a, b);
        assert_eq!(a[0].op_id(), "derived_1");
    }

    #[test]
    fn derive_replace_ops_handles_appended_block() {
        let proposed = format!("{DOC}\nFourth paragraph.\n");
        let ops = derive_replace_ops(DOC, &proposed);
        assert_eq!(ops.len(), 1);
        assert!(matches!(ops[0], BlockOp::InsertAfter { .. }));
    }

    #[test]
    fn derive_replace_ops_handles_removed_block() {
        let proposed = DOC.replace("\n\nThird paragraph.\n", "\n");
        let ops = derive_replace_ops(DOC, &proposed);
        assert_eq!(ops.len(), 1);
        assert!(matches!(ops[0], BlockOp::DeleteBlock { .. }));
    }

    #[test]
    fn bridge_round_trips_proposed_file_via_apply() {
        // The derived ops, accepted in full and applied against the unchanged base,
        // must reproduce the proposed file exactly — the back-compat guarantee.
        let proposed = DOC
            .replace("First paragraph.", "First paragraph EDITED.")
            .replace("Third paragraph.", "Third paragraph EDITED.");
        let proposal = change_proposal_from_update_note(
            42,
            "/notes/x.md".to_string(),
            "base-hash".to_string(),
            DOC,
            &proposed,
            "summary".to_string(),
        );
        assert_eq!(proposal.schema_version, CHANGE_PROPOSAL_SCHEMA_VERSION);
        assert_eq!(proposal.full_file_fallback.as_deref(), Some(proposed.as_str()));
        assert!(!proposal.base_block_map.is_empty());

        let all: HashSet<String> =
            proposal.operations.iter().map(|op| op.op_id().to_string()).collect();
        let result = apply_operations(DOC, &proposal.operations, &all);
        assert!(result.stale_op_ids.is_empty());
        assert_eq!(result.text, proposed);
    }

    #[test]
    fn bridge_proposal_serializes_with_schema_version_and_fallback() {
        let proposed = DOC.replace("First paragraph.", "First X.");
        let proposal = change_proposal_from_update_note(
            1,
            "/n.md".to_string(),
            "h".to_string(),
            DOC,
            &proposed,
            "s".to_string(),
        );
        let json = serde_json::to_string(&proposal).expect("serialize");
        assert!(json.contains("\"schemaVersion\":2"));
        assert!(json.contains("\"fullFileFallback\""));
        let parsed: ChangeProposal = serde_json::from_str(&json).expect("deserialize");
        assert_eq!(parsed, proposal);
    }

    // --- live apply bridge: apply_update_note_via_ops ---

    #[test]
    fn live_apply_uses_structured_ops_and_matches_v1_when_unchanged() {
        // The normal case: live body == base body (content_hash gate passed).
        let proposed = DOC
            .replace("First paragraph.", "First paragraph EDITED.")
            .replace("Third paragraph.", "Third paragraph EDITED.");
        let outcome = apply_update_note_via_ops(DOC, &proposed, DOC);
        assert!(outcome.used_structured_ops);
        assert!(outcome.stale_op_ids.is_empty());
        // Byte-identical to the v1 whole-file body.
        assert_eq!(outcome.text, proposed);
    }

    #[test]
    fn live_apply_no_op_change_is_identity() {
        let outcome = apply_update_note_via_ops(DOC, DOC, DOC);
        assert!(outcome.used_structured_ops);
        assert_eq!(outcome.text, DOC);
    }

    #[test]
    fn live_apply_falls_back_to_whole_file_when_block_is_stale() {
        // The live note diverged from the base after the proposal was generated:
        // one of the target blocks no longer matches by anchor. The structured path
        // must DECLINE and hand back the verbatim proposed body (v1 behavior),
        // never a partially-applied body.
        let proposed = DOC
            .replace("First paragraph.", "First paragraph EDITED.")
            .replace("Third paragraph.", "Third paragraph EDITED.");
        let live = DOC.replace("First paragraph.", "First paragraph (user touched live).");
        let outcome = apply_update_note_via_ops(DOC, &proposed, &live);
        assert!(!outcome.used_structured_ops);
        assert_eq!(outcome.text, proposed); // whole-file fallback
        assert!(!outcome.stale_op_ids.is_empty());
    }

    #[test]
    fn live_apply_handles_append_and_delete_round_trip() {
        // Proposed adds a block and removes another; round-trip must reconstruct it.
        let proposed = "# Title\n\nFirst paragraph.\n\nThird paragraph.\n\nFourth paragraph.\n";
        let outcome = apply_update_note_via_ops(DOC, proposed, DOC);
        assert!(outcome.used_structured_ops);
        assert_eq!(outcome.text, proposed);
    }

    // --- Phase B: native operation generation (parse -> validate -> reconstruct) ---

    /// Build a model `replaceBlock` native input targeting block `index` of `doc`,
    /// computed against that doc's segmentation (so anchorHash matches).
    fn native_replace(doc: &str, index: usize, new_text: &str) -> NativeOperationInput {
        let block = &segment_markdown(doc)[index];
        NativeOperationInput::ReplaceBlock {
            block_id: block.block_id.clone(),
            anchor_hash: block.anchor_hash.clone(),
            original_text: block.text.clone(),
            new_text: new_text.to_string(),
            confidence: None,
        }
    }

    #[test]
    fn native_response_parses_from_model_json_shape() {
        let block = &segment_markdown(DOC)[1];
        let payload = serde_json::json!({
            "summary": "Tightened the first paragraph.",
            "operations": [
                {
                    "kind": "replaceBlock",
                    "blockId": block.block_id,
                    "anchorHash": block.anchor_hash,
                    "newText": "First paragraph EDITED."
                }
            ]
        })
        .to_string();
        let response: NativeOpsResponse = serde_json::from_str(&payload).expect("parse");
        assert_eq!(response.operations.len(), 1);
        assert_eq!(response.summary, "Tightened the first paragraph.");
    }

    #[test]
    fn native_inputs_get_pending_status_and_deterministic_ids() {
        let inputs = vec![
            native_replace(DOC, 1, "A."),
            native_replace(DOC, 3, "B."),
        ];
        let ops = native_inputs_to_block_ops(inputs);
        assert_eq!(ops[0].op_id(), "native_1");
        assert_eq!(ops[1].op_id(), "native_2");
        for op in &ops {
            assert!(matches!(op, BlockOp::ReplaceBlock { status: OpStatus::Pending, .. }));
        }
    }

    #[test]
    fn reconstruct_applies_valid_native_ops() {
        let response = NativeOpsResponse {
            summary: "edit".to_string(),
            operations: vec![
                native_replace(DOC, 1, "First paragraph EDITED."),
                native_replace(DOC, 3, "Third paragraph EDITED."),
            ],
        };
        let out = reconstruct_from_native_ops(DOC, response, false).expect("reconstruct");
        assert!(out.proposed_markdown.contains("First paragraph EDITED."));
        assert!(out.proposed_markdown.contains("Third paragraph EDITED."));
        assert!(out.proposed_markdown.contains("Second paragraph.")); // untouched
        assert_eq!(out.operations.len(), 2);
        assert_eq!(out.operations[0].op_id(), "native_1");
    }

    #[test]
    fn reconstruct_rejects_empty_op_list_for_fallback() {
        let response = NativeOpsResponse {
            summary: "no change".to_string(),
            operations: vec![],
        };
        assert_eq!(
            reconstruct_from_native_ops(DOC, response, false),
            Err(NativeReconstructError::NoOperations)
        );
    }

    #[test]
    fn reconstruct_rejects_unknown_block_for_fallback() {
        let response = NativeOpsResponse {
            summary: "edit".to_string(),
            operations: vec![NativeOperationInput::ReplaceBlock {
                block_id: "b_does_not_exist".to_string(),
                anchor_hash: "deadbeef".to_string(),
                original_text: String::new(),
                new_text: "X.".to_string(),
                confidence: None,
            }],
        };
        let err = reconstruct_from_native_ops(DOC, response, false).unwrap_err();
        assert!(matches!(err, NativeReconstructError::Validation(_)));
    }

    #[test]
    fn reconstruct_rejects_stale_anchor_for_fallback() {
        // Real block id, but a stale anchor hash — validation fails (anchor mismatch).
        let block = &segment_markdown(DOC)[1];
        let response = NativeOpsResponse {
            summary: "edit".to_string(),
            operations: vec![NativeOperationInput::ReplaceBlock {
                block_id: block.block_id.clone(),
                anchor_hash: "00000000".to_string(),
                original_text: String::new(),
                new_text: "X.".to_string(),
                confidence: None,
            }],
        };
        let err = reconstruct_from_native_ops(DOC, response, false).unwrap_err();
        assert!(matches!(err, NativeReconstructError::Validation(_)));
    }

    #[test]
    fn reconstruct_rejects_delete_when_not_permitted() {
        let block = &segment_markdown(DOC)[1];
        let response = NativeOpsResponse {
            summary: "edit".to_string(),
            operations: vec![NativeOperationInput::DeleteBlock {
                block_id: block.block_id.clone(),
                anchor_hash: block.anchor_hash.clone(),
                original_text: block.text.clone(),
                confidence: None,
            }],
        };
        // delete_allowed = false (single-note edit path) ⇒ validation rejects.
        let err = reconstruct_from_native_ops(DOC, response.clone(), false).unwrap_err();
        assert!(matches!(err, NativeReconstructError::Validation(_)));
        // delete_allowed = true (integrate/custom-advanced) ⇒ accepted.
        let out = reconstruct_from_native_ops(DOC, response, true).expect("reconstruct");
        assert!(!out.proposed_markdown.contains("First paragraph."));
    }

    #[test]
    fn build_block_listing_emits_ids_and_anchors() {
        let listing = build_block_listing(DOC);
        assert_eq!(listing.len(), segment_markdown(DOC).len());
        let first = &listing[0];
        assert!(first.get("blockId").and_then(|v| v.as_str()).is_some());
        assert!(first.get("anchorHash").and_then(|v| v.as_str()).is_some());
        assert!(first.get("text").and_then(|v| v.as_str()).is_some());
    }

    #[test]
    fn build_block_listing_is_empty_for_empty_doc() {
        assert!(build_block_listing("").is_empty());
    }
}
