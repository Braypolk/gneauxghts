use crate::{
    note,
    semantic::db::content_hash,
    services::note_timeline::NoteMutationWarning,
    state::{atomic_write_note, is_forgotten_note_path, is_valid_note_path},
    vault_watcher,
};
use serde::{Deserialize, Serialize};
use std::{
    fs,
    io::Write,
    path::{Path, PathBuf},
};

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AppliedNoteChange {
    pub(crate) kind: String,
    pub(crate) path: Option<String>,
    pub(crate) previous_path: Option<String>,
}

/// Untrusted edit input used only for preview. Positions are always derived by
/// Rust; the model never gets to provide offsets or a content hash.
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub(crate) enum ProposedTextEdit {
    Replace {
        old_text: Option<String>,
        new_text: String,
        context_before: Option<String>,
        context_after: Option<String>,
    },
    Insert {
        new_text: String,
        context_before: Option<String>,
        context_after: Option<String>,
    },
    Append {
        new_text: String,
    },
    Prepend {
        new_text: String,
    },
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ProposalPreviewHunk {
    pub(crate) id: String,
    /// UTF-16 offsets, matching CodeMirror's document coordinate system.
    pub(crate) base_from: usize,
    pub(crate) base_to: usize,
    pub(crate) proposed_from: usize,
    pub(crate) proposed_to: usize,
    pub(crate) old_text: String,
    pub(crate) new_text: String,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ProposalPreview {
    pub(crate) review_id: String,
    pub(crate) note_path: String,
    pub(crate) title: String,
    pub(crate) base_content_hash: String,
    pub(crate) base_editor_markdown: String,
    pub(crate) proposed_editor_markdown: String,
    pub(crate) hunks: Vec<ProposalPreviewHunk>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CreationProposalPreview {
    pub(crate) review_id: String,
    pub(crate) suggested_path: String,
    pub(crate) title: String,
    pub(crate) proposed_editor_markdown: String,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CommitNoteReviewResult {
    pub(crate) status: String,
    pub(crate) applied: Option<AppliedNoteChange>,
    pub(crate) message: Option<String>,
    pub(crate) commit_warning: Option<NoteMutationWarning>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct AgentProposalCommitPlan {
    pub(crate) target_path: PathBuf,
    pub(crate) intended_editor_content_hash: String,
}

#[derive(Clone, Debug)]
struct ResolvedTextEdit {
    from: usize,
    to: usize,
    old_text: String,
    new_text: String,
}

pub(crate) fn preview_note_change(
    notes_dir: &Path,
    path: &str,
    edits: &[ProposedTextEdit],
) -> Result<ProposalPreview, String> {
    preview_note_change_from_working(notes_dir, path, None, edits)
}

pub(crate) fn preview_note_rewrite(
    notes_dir: &Path,
    path: &str,
    markdown: &str,
) -> Result<ProposalPreview, String> {
    preview_note_rewrite_from_working(notes_dir, path, None, markdown)
}

/// Replace the complete editor body of a note, then build the same review
/// preview used by targeted edits. When a pending proposal exists, `working_body`
/// is its current unapproved body; the resulting diff still compares against
/// the authoritative note on disk.
pub(crate) fn preview_note_rewrite_from_working(
    notes_dir: &Path,
    path: &str,
    working_body: Option<&str>,
    markdown: &str,
) -> Result<ProposalPreview, String> {
    if markdown.trim().is_empty() {
        return Err("A complete rewrite cannot be empty.".to_string());
    }

    let note_path = validate_existing_note_path(notes_dir, path)?;
    reject_chat_projection_path(&note_path)?;
    let raw = fs::read_to_string(&note_path).map_err(|err| err.to_string())?;
    let fallback_title = note_path
        .file_stem()
        .unwrap_or_default()
        .to_string_lossy()
        .into_owned();
    let (title, base) = note::extract_file_name_title_and_body(&raw, &fallback_title);
    let working = working_body.unwrap_or(&base);
    if markdown == working {
        return Err("The proposed rewrite does not change the current note.".to_string());
    }

    let hunks = diff_preview_hunks(&base, markdown);
    if hunks.is_empty() {
        return Err("The combined proposal does not change the note.".to_string());
    }

    let base_hash = content_hash(&raw);
    Ok(ProposalPreview {
        review_id: content_hash(&format!("{}\0{}\0{}", path, base_hash, markdown)),
        note_path: note_path.to_string_lossy().into_owned(),
        title,
        base_content_hash: base_hash,
        base_editor_markdown: base,
        proposed_editor_markdown: markdown.to_string(),
        hunks,
    })
}

/// Apply new edits to an uncommitted working body, then rebuild one combined
/// preview against the authoritative note on disk. This lets later agent runs
/// fold into an unresolved proposal without treating the proposal as saved.
pub(crate) fn preview_note_change_from_working(
    notes_dir: &Path,
    path: &str,
    working_body: Option<&str>,
    edits: &[ProposedTextEdit],
) -> Result<ProposalPreview, String> {
    let note_path = validate_existing_note_path(notes_dir, path)?;
    reject_chat_projection_path(&note_path)?;
    let raw = fs::read_to_string(&note_path).map_err(|err| err.to_string())?;
    let fallback_title = note_path
        .file_stem()
        .unwrap_or_default()
        .to_string_lossy()
        .into_owned();
    let (title, base) = note::extract_file_name_title_and_body(&raw, &fallback_title);
    let working = working_body.unwrap_or(&base);
    let resolved = resolve_text_edits(working, edits)?;

    let mut proposed = working.to_string();
    for edit in resolved.iter().rev() {
        proposed.replace_range(edit.from..edit.to, &edit.new_text);
    }

    let hunks = if working_body.is_some() {
        diff_preview_hunks(&base, &proposed)
    } else {
        let mut delta_utf16: isize = 0;
        resolved
            .iter()
            .enumerate()
            .map(|(index, edit)| {
                let base_from = utf16_len(&base[..edit.from]);
                let base_to = utf16_len(&base[..edit.to]);
                let proposed_from = (base_from as isize + delta_utf16) as usize;
                let proposed_to = proposed_from + utf16_len(&edit.new_text);
                delta_utf16 += utf16_len(&edit.new_text) as isize - (base_to - base_from) as isize;
                ProposalPreviewHunk {
                    id: format!("hunk-{}", index + 1),
                    base_from,
                    base_to,
                    proposed_from,
                    proposed_to,
                    old_text: edit.old_text.clone(),
                    new_text: edit.new_text.clone(),
                }
            })
            .collect::<Vec<_>>()
    };
    if hunks.is_empty() {
        return Err("The combined proposal does not change the note.".to_string());
    }

    let base_hash = content_hash(&raw);
    Ok(ProposalPreview {
        review_id: content_hash(&format!("{}\0{}\0{}", path, base_hash, proposed)),
        note_path: note_path.to_string_lossy().into_owned(),
        title,
        base_content_hash: base_hash,
        base_editor_markdown: base,
        proposed_editor_markdown: proposed,
        hunks,
    })
}

/// Produce stable, line-oriented review hunks for a combined working copy.
/// Small changed regions use LCS so independent edits remain independent
/// review hunks. Very large regions degrade to one bounded hunk rather than
/// allocating an unbounded matrix.
fn diff_preview_hunks(base: &str, proposed: &str) -> Vec<ProposalPreviewHunk> {
    if base == proposed {
        return Vec::new();
    }
    let base_lines = line_ranges(base);
    let proposed_lines = line_ranges(proposed);
    let matrix_cells = (base_lines.len() + 1).saturating_mul(proposed_lines.len() + 1);
    if matrix_cells > 2_000_000 {
        return vec![preview_hunk_from_ranges(
            1,
            base,
            proposed,
            0,
            base.len(),
            0,
            proposed.len(),
        )];
    }

    let width = proposed_lines.len() + 1;
    let mut lcs = vec![0u32; (base_lines.len() + 1) * width];
    for left in (0..base_lines.len()).rev() {
        for right in (0..proposed_lines.len()).rev() {
            let index = left * width + right;
            lcs[index] = if base_lines[left].2 == proposed_lines[right].2 {
                lcs[(left + 1) * width + right + 1] + 1
            } else {
                lcs[(left + 1) * width + right].max(lcs[left * width + right + 1])
            };
        }
    }

    let mut matches = Vec::new();
    let (mut left, mut right) = (0usize, 0usize);
    while left < base_lines.len() && right < proposed_lines.len() {
        if base_lines[left].2 == proposed_lines[right].2 {
            matches.push((left, right));
            left += 1;
            right += 1;
        } else if lcs[(left + 1) * width + right] >= lcs[left * width + right + 1] {
            left += 1;
        } else {
            right += 1;
        }
    }

    let mut hunks = Vec::new();
    let (mut base_cursor, mut proposed_cursor) = (0usize, 0usize);
    for (match_base, match_proposed) in matches
        .into_iter()
        .chain(std::iter::once((base_lines.len(), proposed_lines.len())))
    {
        if base_cursor < match_base || proposed_cursor < match_proposed {
            let base_from = line_start(&base_lines, base_cursor, base.len());
            let base_to = line_start(&base_lines, match_base, base.len());
            let proposed_from = line_start(&proposed_lines, proposed_cursor, proposed.len());
            let proposed_to = line_start(&proposed_lines, match_proposed, proposed.len());
            hunks.push(preview_hunk_from_ranges(
                hunks.len() + 1,
                base,
                proposed,
                base_from,
                base_to,
                proposed_from,
                proposed_to,
            ));
        }
        base_cursor = match_base.saturating_add(1);
        proposed_cursor = match_proposed.saturating_add(1);
    }
    hunks
}

fn line_ranges(value: &str) -> Vec<(usize, usize, &str)> {
    let mut lines = Vec::new();
    let mut start = 0usize;
    for (offset, character) in value.char_indices() {
        if character == '\n' {
            let end = offset + character.len_utf8();
            lines.push((start, end, &value[start..end]));
            start = end;
        }
    }
    if start < value.len() {
        lines.push((start, value.len(), &value[start..]));
    }
    lines
}

fn line_start(lines: &[(usize, usize, &str)], index: usize, fallback: usize) -> usize {
    lines.get(index).map(|line| line.0).unwrap_or(fallback)
}

fn preview_hunk_from_ranges(
    index: usize,
    base: &str,
    proposed: &str,
    mut base_from: usize,
    mut base_to: usize,
    mut proposed_from: usize,
    mut proposed_to: usize,
) -> ProposalPreviewHunk {
    let prefix = common_prefix_bytes(
        &base[base_from..base_to],
        &proposed[proposed_from..proposed_to],
    );
    base_from += prefix;
    proposed_from += prefix;
    let suffix = common_suffix_bytes(
        &base[base_from..base_to],
        &proposed[proposed_from..proposed_to],
    );
    base_to -= suffix;
    proposed_to -= suffix;
    ProposalPreviewHunk {
        id: format!("hunk-{index}"),
        base_from: utf16_len(&base[..base_from]),
        base_to: utf16_len(&base[..base_to]),
        proposed_from: utf16_len(&proposed[..proposed_from]),
        proposed_to: utf16_len(&proposed[..proposed_to]),
        old_text: base[base_from..base_to].to_string(),
        new_text: proposed[proposed_from..proposed_to].to_string(),
    }
}

fn common_prefix_bytes(left: &str, right: &str) -> usize {
    left.char_indices()
        .zip(right.chars())
        .take_while(|((_, left), right)| *left == *right)
        .map(|((offset, character), _)| offset + character.len_utf8())
        .last()
        .unwrap_or(0)
}

fn common_suffix_bytes(left: &str, right: &str) -> usize {
    left.char_indices()
        .rev()
        .zip(right.chars().rev())
        .take_while(|((_, left), right)| *left == *right)
        .map(|((offset, _), _)| left.len() - offset)
        .last()
        .unwrap_or(0)
}

#[cfg_attr(not(test), allow(dead_code))]
pub(crate) fn commit_note_review(
    notes_dir: &Path,
    path: String,
    expected_base_hash: String,
    markdown: String,
) -> Result<CommitNoteReviewResult, String> {
    let note_path = validate_existing_note_path(notes_dir, &path)?;
    let raw = fs::read_to_string(&note_path).map_err(|err| err.to_string())?;
    if content_hash(&raw) != expected_base_hash {
        return Ok(CommitNoteReviewResult {
            status: "conflict".to_string(),
            applied: None,
            message: Some("Note changed on disk.".to_string()),
            commit_warning: None,
        });
    }
    // A reviewed body is deliberately written back to the existing file. The
    // generic update path may derive a new filename from the title/body; that
    // is correct for ordinary saves but violates the review contract.
    let normalized = note::normalize_wikilink_markdown(&markdown);
    note::reject_chat_projection_write(&normalized)?;
    let prepared = note::prepare_note_markdown(&normalized, Some(&raw), Some(None))?.0;
    let expected_write = vault_watcher::record_expected_write(&note_path, &prepared);
    atomic_write_note(&note_path, prepared.as_bytes())?;
    expected_write.commit();
    Ok(CommitNoteReviewResult {
        status: "committed".to_string(),
        applied: Some(AppliedNoteChange {
            kind: "updateNote".to_string(),
            path: Some(note_path.to_string_lossy().into_owned()),
            previous_path: Some(note_path.to_string_lossy().into_owned()),
        }),
        message: None,
        commit_warning: None,
    })
}

pub(crate) fn plan_agent_update_commit(
    notes_dir: &Path,
    path: &str,
    markdown: &str,
) -> Result<AgentProposalCommitPlan, String> {
    let target_path = validate_existing_note_path(notes_dir, path)?;
    let normalized = note::normalize_wikilink_markdown(markdown);
    note::reject_chat_projection_write(&normalized)?;
    Ok(AgentProposalCommitPlan {
        intended_editor_content_hash: editor_visible_content_hash(&target_path, &normalized),
        target_path,
    })
}

pub(crate) fn preview_note_creation(
    notes_dir: &Path,
    title: &str,
    markdown: &str,
) -> Result<CreationProposalPreview, String> {
    let title = title.trim();
    if title.is_empty() {
        return Err("A title is required for a new note.".to_string());
    }
    let normalized = note::normalize_wikilink_markdown(markdown);
    note::reject_chat_projection_write(&normalized)?;
    let stem = crate::state::derive_file_stem_from_title_and_markdown(title, &normalized);
    let path = unique_creation_path(notes_dir, &stem);
    Ok(CreationProposalPreview {
        review_id: content_hash(&format!("create\0{}\0{}", path.display(), normalized)),
        suggested_path: path.to_string_lossy().into_owned(),
        title: title.to_string(),
        proposed_editor_markdown: normalized,
    })
}

pub(crate) fn plan_agent_creation_commit(
    notes_dir: &Path,
    suggested_path: &str,
    markdown: &str,
) -> Result<AgentProposalCommitPlan, String> {
    let target_path = canonical_agent_commit_target(notes_dir, Path::new(suggested_path))?;
    let normalized = note::normalize_wikilink_markdown(markdown);
    note::reject_chat_projection_write(&normalized)?;
    Ok(AgentProposalCommitPlan {
        intended_editor_content_hash: editor_visible_content_hash(&target_path, &normalized),
        target_path,
    })
}

#[cfg_attr(not(test), allow(dead_code))]
pub(crate) fn commit_note_creation(
    notes_dir: &Path,
    title: String,
    markdown: String,
) -> Result<CommitNoteReviewResult, String> {
    let preview = preview_note_creation(notes_dir, &title, &markdown)?;
    let stem = crate::state::derive_file_stem_from_title_and_markdown(
        &title,
        &preview.proposed_editor_markdown,
    );
    let prepared =
        note::prepare_note_markdown(&preview.proposed_editor_markdown, None, Some(None))?.0;
    let path = loop {
        let candidate = unique_creation_path(notes_dir, &stem);
        let expected_write = vault_watcher::record_expected_write(&candidate, &prepared);
        match create_note_without_overwrite(&candidate, prepared.as_bytes()) {
            Ok(()) => {
                expected_write.commit();
                break candidate;
            }
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(error) => return Err(error.to_string()),
        }
    };
    Ok(CommitNoteReviewResult {
        status: "committed".to_string(),
        applied: Some(AppliedNoteChange {
            kind: "createNote".to_string(),
            path: Some(path.to_string_lossy().into_owned()),
            previous_path: None,
        }),
        message: None,
        commit_warning: None,
    })
}

pub(crate) fn commit_note_creation_at_path(
    notes_dir: &Path,
    target_path: &Path,
    title: String,
    markdown: String,
) -> Result<CommitNoteReviewResult, String> {
    if title.trim().is_empty() {
        return Err("A title is required for a new note.".to_string());
    }
    let target_path = canonical_agent_commit_target(notes_dir, target_path)?;
    let normalized = note::normalize_wikilink_markdown(&markdown);
    note::reject_chat_projection_write(&normalized)?;
    let prepared = note::prepare_note_markdown(&normalized, None, Some(None))?.0;
    let expected_write = vault_watcher::record_expected_write(&target_path, &prepared);
    match create_note_without_overwrite(&target_path, prepared.as_bytes()) {
        Ok(()) => {
            expected_write.commit();
            Ok(CommitNoteReviewResult {
                status: "committed".to_string(),
                applied: Some(AppliedNoteChange {
                    kind: "createNote".to_string(),
                    path: Some(target_path.to_string_lossy().into_owned()),
                    previous_path: None,
                }),
                message: None,
                commit_warning: None,
            })
        }
        Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {
            Ok(CommitNoteReviewResult {
                status: "conflict".to_string(),
                applied: None,
                message: Some(
                    "The proposed creation path is now occupied; review the proposal again."
                        .to_string(),
                ),
                commit_warning: None,
            })
        }
        Err(error) => Err(error.to_string()),
    }
}

pub(crate) fn editor_visible_content_hash(path: &Path, canonical_markdown: &str) -> String {
    let fallback_title = path
        .file_stem()
        .map(|stem| stem.to_string_lossy().into_owned())
        .unwrap_or_default();
    let normalized = note::normalize_wikilink_markdown(canonical_markdown);
    let prepared_body = note::parse_note(&normalized)
        .body
        .trim_start_matches('\n')
        .to_string();
    let (_, editor_markdown) =
        note::extract_file_name_title_and_body(&prepared_body, &fallback_title);
    content_hash(&editor_markdown)
}

fn create_note_without_overwrite(path: &Path, contents: &[u8]) -> std::io::Result<()> {
    let mut file = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(path)?;
    if let Err(error) = file.write_all(contents).and_then(|_| file.sync_all()) {
        drop(file);
        let _ = fs::remove_file(path);
        return Err(error);
    }
    Ok(())
}

pub(crate) fn canonical_agent_commit_target(
    notes_dir: &Path,
    path: &Path,
) -> Result<PathBuf, String> {
    let notes_dir = fs::canonicalize(notes_dir).map_err(|error| error.to_string())?;
    let parent = path
        .parent()
        .ok_or_else(|| "Creation target has no parent directory".to_string())?;
    let parent = fs::canonicalize(parent).map_err(|error| error.to_string())?;
    let file_name = path
        .file_name()
        .ok_or_else(|| "Creation target has no file name".to_string())?;
    let target = parent.join(file_name);
    if !target.starts_with(&notes_dir)
        || is_forgotten_note_path(&target, &notes_dir)
        || !target
            .extension()
            .is_some_and(|extension| extension.eq_ignore_ascii_case("md"))
    {
        return Err(format!("Invalid note path: {}", path.display()));
    }
    Ok(target)
}

fn unique_creation_path(notes_dir: &Path, stem: &str) -> PathBuf {
    let base = if stem.trim().is_empty() {
        "Untitled"
    } else {
        stem
    };
    let mut candidate = notes_dir.join(format!("{base}.md"));
    let mut suffix = 2usize;
    while candidate.exists() {
        candidate = notes_dir.join(format!("{base} {suffix}.md"));
        suffix += 1;
    }
    candidate
}

fn resolve_text_edits(
    base: &str,
    edits: &[ProposedTextEdit],
) -> Result<Vec<ResolvedTextEdit>, String> {
    if edits.is_empty() {
        return Err("Proposal contains no edits.".to_string());
    }
    let mut resolved = Vec::with_capacity(edits.len());
    for edit in edits {
        let (old_text, new_text, before, after, insertion) = match edit {
            ProposedTextEdit::Replace {
                old_text,
                new_text,
                context_before,
                context_after,
            } => {
                let old_text = old_text
                    .as_deref()
                    .filter(|value| !value.is_empty())
                    .ok_or_else(|| "Replace edits must include non-empty oldText.".to_string())?;
                (
                    old_text,
                    new_text.as_str(),
                    context_before.as_deref(),
                    context_after.as_deref(),
                    false,
                )
            }
            ProposedTextEdit::Insert {
                new_text,
                context_before,
                context_after,
            } => {
                if context_before.as_deref().unwrap_or("").is_empty()
                    && context_after.as_deref().unwrap_or("").is_empty()
                {
                    return Err("Insert edits require contextBefore or contextAfter.".to_string());
                }
                (
                    "",
                    new_text.as_str(),
                    context_before.as_deref(),
                    context_after.as_deref(),
                    true,
                )
            }
            ProposedTextEdit::Append { new_text } => {
                if new_text.is_empty() {
                    return Err("Append edits must include non-empty newText.".to_string());
                }
                if base.ends_with(new_text) {
                    return Err(
                        "Could not apply safely: appended text is already present.".to_string()
                    );
                }
                resolved.push(ResolvedTextEdit {
                    from: base.len(),
                    to: base.len(),
                    old_text: String::new(),
                    new_text: new_text.clone(),
                });
                continue;
            }
            ProposedTextEdit::Prepend { new_text } => {
                if new_text.is_empty() {
                    return Err("Prepend edits must include non-empty newText.".to_string());
                }
                if base.starts_with(new_text) {
                    return Err(
                        "Could not apply safely: prepended text is already present.".to_string()
                    );
                }
                resolved.push(ResolvedTextEdit {
                    from: 0,
                    to: 0,
                    old_text: String::new(),
                    new_text: new_text.clone(),
                });
                continue;
            }
        };
        let candidates = if insertion {
            string_boundaries(base)
                .into_iter()
                .filter(|pos| context_matches(base, *pos, before, after))
                .collect::<Vec<_>>()
        } else {
            find_all(base, old_text)
                .into_iter()
                .filter(|pos| {
                    context_matches(base, *pos, before, None)
                        && context_after_matches(base, *pos + old_text.len(), after)
                })
                .collect::<Vec<_>>()
        };
        if candidates.len() != 1 {
            return Err(if candidates.is_empty() {
                "Could not apply safely: edit target was not found.".to_string()
            } else {
                "Could not apply safely: edit target is ambiguous.".to_string()
            });
        }
        let from = candidates[0];
        if insertion && !new_text.is_empty() && base[from..].starts_with(new_text) {
            return Err("Could not apply safely: inserted text is already present.".to_string());
        }
        resolved.push(ResolvedTextEdit {
            from,
            to: if insertion {
                from
            } else {
                from + old_text.len()
            },
            old_text: old_text.to_string(),
            new_text: new_text.to_string(),
        });
    }
    resolved.sort_by_key(|edit| (edit.from, edit.to));
    for pair in resolved.windows(2) {
        if let [left, right] = pair {
            if right.from < left.to
                || (right.from == left.from && (left.from == left.to || right.from == right.to))
            {
                return Err("Could not apply safely: edits overlap.".to_string());
            }
        }
    }
    Ok(resolved)
}

fn context_matches(base: &str, pos: usize, before: Option<&str>, after: Option<&str>) -> bool {
    before
        .map(|value| base[..pos].ends_with(value))
        .unwrap_or(true)
        && after
            .map(|value| base[pos..].starts_with(value))
            .unwrap_or(true)
}

fn context_after_matches(base: &str, pos: usize, after: Option<&str>) -> bool {
    after
        .map(|value| base[pos..].starts_with(value))
        .unwrap_or(true)
}

fn find_all(haystack: &str, needle: &str) -> Vec<usize> {
    haystack
        .match_indices(needle)
        .map(|(offset, _)| offset)
        .collect()
}

fn string_boundaries(value: &str) -> Vec<usize> {
    let mut positions = value
        .char_indices()
        .map(|(offset, _)| offset)
        .collect::<Vec<_>>();
    positions.push(value.len());
    positions
}

fn utf16_len(value: &str) -> usize {
    value.encode_utf16().count()
}

fn validate_existing_note_path(notes_dir: &Path, path: &str) -> Result<PathBuf, String> {
    let notes_dir = fs::canonicalize(notes_dir).map_err(|err| err.to_string())?;
    let note_path = fs::canonicalize(path).map_err(|err| err.to_string())?;
    if !is_valid_note_path(&note_path, &notes_dir) {
        return Err(format!("Invalid note path: {path}"));
    }
    if !note_path.is_file() {
        return Err(format!("Note does not exist: {path}"));
    }
    Ok(note_path)
}

fn reject_chat_projection_path(path: &Path) -> Result<(), String> {
    let markdown = fs::read_to_string(path).map_err(|err| err.to_string())?;
    note::reject_chat_projection_write(&markdown)
}

#[cfg(test)]
mod tests {
    use super::{
        commit_note_creation, commit_note_review, preview_note_change,
        preview_note_change_from_working, preview_note_creation, preview_note_rewrite,
        preview_note_rewrite_from_working, ProposedTextEdit,
    };
    use crate::{
        semantic::db::content_hash,
        state::initialize_app_data_dir,
        test_support::{lock_test_env, TestDir},
    };
    use std::fs;

    fn setup(name: &str) -> TestDir {
        TestDir::new(name)
    }

    fn write_note(dir: &TestDir, file_name: &str, body: &str) -> (String, String) {
        let path = dir.path().join(file_name);
        fs::write(&path, body).expect("write note");
        (path.to_string_lossy().into_owned(), content_hash(body))
    }

    #[test]
    fn previews_editable_body_without_writing_and_uses_utf16_offsets() {
        let _guard = lock_test_env();
        let app_data = TestDir::new("proposal-preview-app-data");
        initialize_app_data_dir(app_data.path().to_path_buf()).expect("app data");
        let dir = setup("proposal-preview");
        let (path, _) = write_note(&dir, "Emoji.md", "# Emoji\n\nA 😀 old\n");

        let preview = preview_note_change(
            dir.path(),
            &path,
            &[ProposedTextEdit::Replace {
                old_text: Some("old".to_string()),
                new_text: "new".to_string(),
                context_before: None,
                context_after: None,
            }],
        )
        .expect("preview");

        assert_eq!(preview.base_editor_markdown, "A 😀 old");
        assert_eq!(preview.proposed_editor_markdown, "A 😀 new");
        assert_eq!(preview.hunks[0].base_from, "A 😀 ".encode_utf16().count());
        assert!(fs::read_to_string(&path).expect("read").contains("old"));
    }

    #[test]
    fn previews_anchor_based_insert_at_the_end_of_a_note() {
        let _guard = lock_test_env();
        let app_data = TestDir::new("proposal-append-app-data");
        initialize_app_data_dir(app_data.path().to_path_buf()).expect("app data");
        let dir = setup("proposal-append");
        let (path, _) = write_note(
            &dir,
            "Fixture.md",
            "# Fixture\n\n- basil\n- tomato\n- cheese\n- dough\n- salami\n",
        );

        let preview = preview_note_change(
            dir.path(),
            &path,
            &[ProposedTextEdit::Insert {
                new_text: "\n- pizza\n- caprese salad\n- grilled cheese\n- pasta with tomato sauce\n- bruschetta"
                    .to_string(),
                context_before: Some("- salami".to_string()),
                context_after: None,
            }],
        )
        .expect("preview");

        assert!(preview
            .proposed_editor_markdown
            .contains("- salami\n- pizza"));
        assert_eq!(preview.hunks.len(), 1);
        assert!(fs::read_to_string(path)
            .expect("read")
            .ends_with("- salami\n"));
    }

    #[test]
    fn previews_append_and_prepend_without_boundary_anchors() {
        let _guard = lock_test_env();
        let app_data = TestDir::new("proposal-boundary-app-data");
        initialize_app_data_dir(app_data.path().to_path_buf()).expect("app data");
        let dir = setup("proposal-boundary");
        let (path, _) = write_note(&dir, "Fixture.md", "# Fixture\n\nBody\n");

        let appended = preview_note_change(
            dir.path(),
            &path,
            &[ProposedTextEdit::Append {
                new_text: "\n\n## Summary\n- Point".to_string(),
            }],
        )
        .expect("append preview");
        assert_eq!(
            appended.proposed_editor_markdown,
            "Body\n\n## Summary\n- Point"
        );

        let prepended = preview_note_change(
            dir.path(),
            &path,
            &[ProposedTextEdit::Prepend {
                new_text: "Context\n\n".to_string(),
            }],
        )
        .expect("prepend preview");
        assert_eq!(prepended.proposed_editor_markdown, "Context\n\nBody");
    }

    #[test]
    fn null_replace_old_text_deserializes_then_returns_actionable_validation() {
        let edit: ProposedTextEdit = serde_json::from_value(serde_json::json!({
            "kind": "replace",
            "oldText": null,
            "newText": "Replacement"
        }))
        .expect("schema-permitted null should deserialize");

        let error = super::resolve_text_edits("Original", &[edit]).expect_err("invalid replace");
        assert_eq!(error, "Replace edits must include non-empty oldText.");
    }

    #[test]
    fn repeated_insert_proposals_do_not_duplicate_existing_text() {
        let _guard = lock_test_env();
        let app_data = TestDir::new("proposal-repeat-insert-app-data");
        initialize_app_data_dir(app_data.path().to_path_buf()).expect("app data");
        let dir = setup("proposal-repeat-insert");
        let (path, _) = write_note(&dir, "Fixture.md", "# Fixture\n\n- salami\n- pizza\n");

        let error = preview_note_change(
            dir.path(),
            &path,
            &[ProposedTextEdit::Insert {
                new_text: "\n- pizza".to_string(),
                context_before: Some("- salami".to_string()),
                context_after: None,
            }],
        )
        .expect_err("duplicate insert should be rejected");

        assert_eq!(
            error,
            "Could not apply safely: inserted text is already present."
        );
    }

    #[test]
    fn later_edits_fold_into_one_preview_against_the_saved_note() {
        let _guard = lock_test_env();
        let app_data = TestDir::new("proposal-fold-app-data");
        initialize_app_data_dir(app_data.path().to_path_buf()).expect("app data");
        let dir = setup("proposal-fold");
        let (path, _) = write_note(
            &dir,
            "Plan.md",
            "# Plan\n\n## Summary\nOld summary\n\nTags: alpha beta\n",
        );
        let first = preview_note_change(
            dir.path(),
            &path,
            &[ProposedTextEdit::Replace {
                old_text: Some("Old summary".to_string()),
                new_text: "New summary".to_string(),
                context_before: None,
                context_after: None,
            }],
        )
        .expect("first preview");

        let folded = preview_note_change_from_working(
            dir.path(),
            &path,
            Some(&first.proposed_editor_markdown),
            &[ProposedTextEdit::Replace {
                old_text: Some(" beta".to_string()),
                new_text: String::new(),
                context_before: Some("Tags: alpha".to_string()),
                context_after: None,
            }],
        )
        .expect("folded preview");

        assert!(folded.proposed_editor_markdown.contains("New summary"));
        assert!(folded.proposed_editor_markdown.contains("Tags: alpha"));
        assert!(!folded.proposed_editor_markdown.contains("beta"));
        assert_eq!(folded.base_editor_markdown, first.base_editor_markdown);
        assert_eq!(folded.base_content_hash, first.base_content_hash);
        assert_eq!(folded.hunks.len(), 2);
        assert_eq!(folded.hunks[0].old_text, "Old");
        assert_eq!(folded.hunks[0].new_text, "New");
        assert_eq!(folded.hunks[1].old_text, " beta");
        assert_eq!(folded.hunks[1].new_text, "");
    }

    #[test]
    fn complete_rewrite_builds_a_review_without_writing() {
        let _guard = lock_test_env();
        let app_data = TestDir::new("proposal-rewrite-app-data");
        initialize_app_data_dir(app_data.path().to_path_buf()).expect("app data");
        let dir = setup("proposal-rewrite");
        let (path, hash) = write_note(
            &dir,
            "Call Notes.md",
            "# Call Notes\n\nrough intro\n\n- first point\n- second point\n",
        );

        let markdown = "Clear introduction.\n\n## Key points\n\n- First point\n- Second point";
        let preview = preview_note_rewrite(dir.path(), &path, markdown).expect("rewrite preview");

        assert_eq!(preview.base_content_hash, hash);
        assert_eq!(
            preview.base_editor_markdown,
            "rough intro\n\n- first point\n- second point"
        );
        assert_eq!(preview.proposed_editor_markdown, markdown);
        assert!(!preview.hunks.is_empty());
        assert!(fs::read_to_string(&path)
            .expect("read")
            .contains("rough intro"));
    }

    #[test]
    fn complete_rewrite_folds_over_pending_work_and_rejects_noops() {
        let _guard = lock_test_env();
        let app_data = TestDir::new("proposal-rewrite-fold-app-data");
        initialize_app_data_dir(app_data.path().to_path_buf()).expect("app data");
        let dir = setup("proposal-rewrite-fold");
        let (path, _) = write_note(&dir, "Plan.md", "# Plan\n\nOriginal body\n");
        let working = "Pending summary\n\nOriginal body";
        let markdown = "## Summary\n\nPending summary\n\n## Details\n\nOriginal body";

        let preview = preview_note_rewrite_from_working(dir.path(), &path, Some(working), markdown)
            .expect("folded rewrite");

        assert_eq!(preview.base_editor_markdown, "Original body");
        assert_eq!(preview.proposed_editor_markdown, markdown);
        assert!(!preview.hunks.is_empty());
        assert!(preview.proposed_editor_markdown.contains("Pending summary"));
        assert_eq!(
            preview_note_rewrite_from_working(dir.path(), &path, Some(markdown), markdown)
                .expect_err("unchanged rewrite"),
            "The proposed rewrite does not change the current note."
        );
        assert_eq!(
            preview_note_rewrite(dir.path(), &path, " \n ").expect_err("empty rewrite"),
            "A complete rewrite cannot be empty."
        );
    }

    #[test]
    fn creation_commit_recalculates_a_unique_path_and_never_overwrites() {
        let root = TestDir::new("proposal-create-unique");
        fs::write(root.path().join("Checklist.md"), "existing").unwrap();
        let preview = preview_note_creation(root.path(), "Checklist", "- [ ] First").unwrap();
        assert!(preview.suggested_path.ends_with("Checklist 2.md"));

        // A file can appear after preview; commit must calculate uniqueness again.
        fs::write(root.path().join("Checklist 2.md"), "appeared later").unwrap();
        let committed = commit_note_creation(
            root.path(),
            "Checklist".to_string(),
            "- [ ] First".to_string(),
        )
        .unwrap();
        let path = committed.applied.unwrap().path.unwrap();
        assert!(path.ends_with("Checklist 3.md"));
        assert_eq!(
            fs::read_to_string(root.path().join("Checklist.md")).unwrap(),
            "existing"
        );
        assert_eq!(
            fs::read_to_string(root.path().join("Checklist 2.md")).unwrap(),
            "appeared later"
        );
    }

    #[test]
    fn commit_review_returns_conflict_without_overwriting() {
        let _guard = lock_test_env();
        let app_data = TestDir::new("proposal-review-commit-app-data");
        initialize_app_data_dir(app_data.path().to_path_buf()).expect("app data");
        let dir = setup("proposal-review-commit");
        let (path, hash) = write_note(&dir, "Review.md", "# Review\n\nOld");
        fs::write(&path, "# Review\n\nExternal").expect("external change");

        let result =
            commit_note_review(dir.path(), path.clone(), hash, "New".to_string()).expect("result");
        assert_eq!(result.status, "conflict");
        assert!(fs::read_to_string(path).expect("read").contains("External"));
    }

    #[test]
    fn commit_review_preserves_existing_path_and_frontmatter() {
        let _guard = lock_test_env();
        let app_data = TestDir::new("proposal-review-fixed-path-app-data");
        initialize_app_data_dir(app_data.path().to_path_buf()).expect("app data");
        let dir = setup("proposal-review-fixed-path");
        let raw = "---\ncustom: keep\n---\n# Display title\n\nOld";
        let (path, hash) = write_note(&dir, "Stable Path.md", raw);

        let result =
            commit_note_review(dir.path(), path.clone(), hash, "New".to_string()).expect("commit");

        assert_eq!(result.status, "committed");
        assert_eq!(
            result.applied.and_then(|applied| applied.path),
            Some(
                fs::canonicalize(&path)
                    .expect("canonical path")
                    .to_string_lossy()
                    .into_owned()
            )
        );
        assert!(std::path::Path::new(&path).exists());
        assert!(!dir.path().join("Display title.md").exists());
        let saved = fs::read_to_string(path).expect("saved");
        assert!(saved.contains("custom: keep"));
        assert!(saved.ends_with("New"));
    }
}
