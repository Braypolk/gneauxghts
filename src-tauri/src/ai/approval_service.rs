use super::{
    content_hash, current_time_millis, default_summary_for_job, fallback_title_for_path,
    is_valid_note_path, job_status_to_str, load_job, non_empty_summary, notes_root, open_database,
    persist_note, should_skip_job_update, to_detail_item, update_job_status, AiChange, AiJobStatus,
    AiState, ClearInboxResult, InboxItemDetail, ResolvedRememberAction, StoredAiJob,
};
use rusqlite::params;
use std::{
    collections::{HashMap, HashSet},
    fs,
    path::{Path, PathBuf},
};
use tauri::{AppHandle, Emitter};

pub(super) fn approve_inbox_item(ai: &AiState, id: i64) -> Result<Option<InboxItemDetail>, String> {
    let connection = ai.connection()?;
    let Some(job) = load_job(&connection, id)? else {
        return Ok(None);
    };
    if job.status != AiJobStatus::PendingApproval {
        return Ok(Some(to_detail_item(&job)?));
    }

    let updated = apply_pending_job(ai, &job)?;
    ai.emit_inbox_changed()?;
    Ok(Some(to_detail_item(&updated)?))
}

pub(super) fn approve_inbox_item_with_changes(
    ai: &AiState,
    id: i64,
    changes: Vec<AiChange>,
) -> Result<Option<InboxItemDetail>, String> {
    let connection = ai.connection()?;
    let Some(job) = load_job(&connection, id)? else {
        return Ok(None);
    };
    if job.status != AiJobStatus::PendingApproval {
        return Ok(Some(to_detail_item(&job)?));
    }

    if changes.is_empty() {
        let updated = update_job_status(
            &connection,
            job.id,
            AiJobStatus::Rejected,
            Some("Proposal rejected".to_string()),
            job.failure_reason.clone(),
            Some(Vec::new()),
            job.provider_kind.clone(),
            job.model.clone(),
            job.metrics.clone(),
        )?;
        ai.emit_inbox_changed()?;
        return Ok(Some(to_detail_item(&updated)?));
    }

    validate_override_changes(&job, &changes)?;
    let updated = update_job_status(
        &connection,
        job.id,
        AiJobStatus::PendingApproval,
        Some(job.summary.clone()),
        None,
        Some(changes),
        job.provider_kind.clone(),
        job.model.clone(),
        job.metrics.clone(),
    )?;
    let applied = apply_pending_job(ai, &updated)?;
    ai.emit_inbox_changed()?;
    Ok(Some(to_detail_item(&applied)?))
}

pub(super) fn reject_inbox_item(ai: &AiState, id: i64) -> Result<Option<InboxItemDetail>, String> {
    let connection = ai.connection()?;
    let Some(job) = load_job(&connection, id)? else {
        return Ok(None);
    };
    let updated = update_job_status(
        &connection,
        job.id,
        AiJobStatus::Rejected,
        Some("Proposal rejected".to_string()),
        job.failure_reason.clone(),
        Some(job.proposed_changes.clone()),
        job.provider_kind.clone(),
        job.model.clone(),
        job.metrics.clone(),
    )?;
    ai.emit_inbox_changed()?;
    Ok(Some(to_detail_item(&updated)?))
}

pub(super) fn retry_inbox_item(ai: &AiState, id: i64) -> Result<Option<InboxItemDetail>, String> {
    let connection = ai.connection()?;
    let Some(job) = load_job(&connection, id)? else {
        return Ok(None);
    };
    if job.kind.is_exact() {
        return Ok(Some(to_detail_item(&job)?));
    }
    let retry_id = ai.enqueue_job(
        ResolvedRememberAction {
            mode: job.kind.clone(),
            action_id: job.action_id.clone(),
            action_label: job.action_label.clone(),
            action_prompt: job.action_prompt.clone(),
        },
        job.source.clone(),
        job.requires_approval,
        Some(id),
    )?;
    let retried =
        load_job(&connection, retry_id)?.ok_or_else(|| "Retry job disappeared".to_string())?;
    Ok(Some(to_detail_item(&retried)?))
}

pub(super) fn clear_inbox(ai: &AiState) -> Result<ClearInboxResult, String> {
    let connection = ai.connection()?;
    let now = current_time_millis()?;
    let cancelled_jobs = connection
        .execute(
            "UPDATE ai_jobs
             SET status = ?1,
                 summary = COALESCE(NULLIF(summary, ''), 'Job cancelled'),
                 updated_at_millis = ?2
             WHERE status IN ('queued', 'running')",
            params![job_status_to_str(&AiJobStatus::Cancelled), now],
        )
        .map_err(|err| err.to_string())?;
    let removed_jobs = connection
        .execute(
            "DELETE FROM ai_jobs
             WHERE status IN ('applied', 'failed', 'stale', 'rejected')",
            [],
        )
        .map_err(|err| err.to_string())?;
    ai.emit_inbox_changed()?;
    Ok(ClearInboxResult {
        cancelled_jobs,
        removed_jobs,
    })
}

pub(super) fn apply_pending_job(ai: &AiState, job: &StoredAiJob) -> Result<StoredAiJob, String> {
    apply_pending_job_inner(&ai.db_path, &ai.app_handle, job)
}

pub(super) fn apply_pending_job_inner(
    db_path: &Path,
    app_handle: &AppHandle,
    job: &StoredAiJob,
) -> Result<StoredAiJob, String> {
    let connection = open_database(db_path)?;
    super::ensure_schema(&connection)?;
    if should_skip_job_update(&connection, job.id)? {
        return load_job(&connection, job.id)?
            .ok_or_else(|| "Inbox item disappeared before apply".to_string());
    }
    match apply_job_changes(job) {
        Ok(()) => update_job_status(
            &connection,
            job.id,
            AiJobStatus::Applied,
            Some(non_empty_summary(
                job.summary.clone(),
                default_summary_for_job(job, "Applied"),
            )),
            None,
            Some(job.proposed_changes.clone()),
            job.provider_kind.clone(),
            job.model.clone(),
            job.metrics.clone(),
        ),
        Err(ApplyError::Stale(reason)) => update_job_status(
            &connection,
            job.id,
            AiJobStatus::Stale,
            Some("Proposal went stale".to_string()),
            Some(reason),
            Some(job.proposed_changes.clone()),
            job.provider_kind.clone(),
            job.model.clone(),
            job.metrics.clone(),
        ),
        Err(ApplyError::Failed(reason)) => update_job_status(
            &connection,
            job.id,
            AiJobStatus::Failed,
            Some("Applying the proposal failed".to_string()),
            Some(reason),
            Some(job.proposed_changes.clone()),
            job.provider_kind.clone(),
            job.model.clone(),
            job.metrics.clone(),
        ),
    }
    .inspect(|_| {
        let _ = emit_inbox_changed(app_handle);
    })
}

pub(super) fn validate_job_changes(job: &StoredAiJob, changes: &[AiChange]) -> Result<(), String> {
    let mut update_paths = HashSet::new();
    let mut delete_paths = HashSet::new();
    for change in changes {
        match change {
            AiChange::UpdateNote { path, .. } => {
                if !update_paths.insert(path.clone()) {
                    return Err("Duplicate updateNote paths are not allowed.".to_string());
                }
            }
            AiChange::CreateNote { .. } => {}
            AiChange::DeleteNote { path, .. } => {
                if !job.kind.is_integrate_mode() && !job.kind.is_custom_advanced_mode() {
                    return Err("deleteNote is only allowed for integrate jobs.".to_string());
                }
                if path != &job.source.path {
                    return Err("deleteNote may only target the source note in v1.".to_string());
                }
                if !delete_paths.insert(path.clone()) {
                    return Err("Duplicate deleteNote paths are not allowed.".to_string());
                }
            }
        }
    }
    Ok(())
}

pub(super) fn validate_override_changes(
    job: &StoredAiJob,
    changes: &[AiChange],
) -> Result<(), String> {
    validate_job_changes(job, changes)?;

    let mut original_updates = HashMap::<&str, &str>::new();
    let mut original_deletes = HashMap::<&str, &str>::new();
    let mut original_creates = HashSet::<(&str, &str)>::new();
    for change in &job.proposed_changes {
        match change {
            AiChange::UpdateNote {
                path,
                base_content_hash,
                ..
            } => {
                original_updates.insert(path.as_str(), base_content_hash.as_str());
            }
            AiChange::CreateNote {
                suggested_title,
                markdown,
            } => {
                original_creates.insert((suggested_title.as_str(), markdown.as_str()));
            }
            AiChange::DeleteNote {
                path,
                base_content_hash,
            } => {
                original_deletes.insert(path.as_str(), base_content_hash.as_str());
            }
        }
    }

    for change in changes {
        match change {
            AiChange::UpdateNote {
                path,
                base_content_hash,
                ..
            } => {
                let Some(expected_hash) = original_updates.get(path.as_str()) else {
                    return Err(format!(
                        "Edited approval may only update notes from the original proposal: {path}"
                    ));
                };
                if expected_hash != &base_content_hash.as_str() {
                    return Err(format!(
                        "Edited approval must preserve the original base content hash for {path}"
                    ));
                }
            }
            AiChange::CreateNote {
                suggested_title,
                markdown,
            } => {
                if !original_creates.contains(&(suggested_title.as_str(), markdown.as_str())) {
                    return Err(
                        "Edited approval may only keep or drop createNote proposals as-is."
                            .to_string(),
                    );
                }
            }
            AiChange::DeleteNote {
                path,
                base_content_hash,
            } => {
                let Some(expected_hash) = original_deletes.get(path.as_str()) else {
                    return Err(format!(
                        "Edited approval may only delete notes from the original proposal: {path}"
                    ));
                };
                if expected_hash != &base_content_hash.as_str() {
                    return Err(format!(
                        "Edited approval must preserve the original base content hash for {path}"
                    ));
                }
            }
        }
    }

    Ok(())
}

fn apply_job_changes(job: &StoredAiJob) -> Result<(), ApplyError> {
    let notes_dir = notes_root().map_err(ApplyError::Failed)?;
    let raw_source_markdown =
        fs::read_to_string(&job.source.path).map_err(|err| ApplyError::Stale(err.to_string()))?;
    if content_hash(&raw_source_markdown) != job.source.content_hash {
        return Err(ApplyError::Stale(
            "The source note changed after the AI job was created.".to_string(),
        ));
    }

    let mut validated_updates = Vec::new();
    let mut validated_deletes = Vec::new();
    for change in &job.proposed_changes {
        match change {
            AiChange::UpdateNote {
                path,
                base_content_hash,
                ..
            } => {
                let path_buf = PathBuf::from(path);
                if !is_valid_note_path(&path_buf, &notes_dir) || !path_buf.is_file() {
                    return Err(ApplyError::Stale(format!("Note no longer exists: {path}")));
                }
                let current = fs::read_to_string(&path_buf)
                    .map_err(|err| ApplyError::Stale(err.to_string()))?;
                if content_hash(&current) != *base_content_hash {
                    return Err(ApplyError::Stale(format!(
                        "Note changed since the proposal was generated: {path}"
                    )));
                }
                validated_updates.push((change.clone(), path_buf));
            }
            AiChange::CreateNote { .. } => {}
            AiChange::DeleteNote {
                path,
                base_content_hash,
            } => {
                let path_buf = PathBuf::from(path);
                if !is_valid_note_path(&path_buf, &notes_dir) || !path_buf.is_file() {
                    return Err(ApplyError::Stale(format!("Note no longer exists: {path}")));
                }
                let current = fs::read_to_string(&path_buf)
                    .map_err(|err| ApplyError::Stale(err.to_string()))?;
                if content_hash(&current) != *base_content_hash {
                    return Err(ApplyError::Stale(format!(
                        "Note changed since the proposal was generated: {path}"
                    )));
                }
                validated_deletes.push(path_buf);
            }
        }
    }

    for change in &job.proposed_changes {
        match change {
            AiChange::UpdateNote {
                path,
                new_title,
                new_markdown,
                ..
            } => {
                let current_path = PathBuf::from(path);
                let resolved_title = if new_title.trim().is_empty() {
                    fallback_title_for_path(path)
                } else {
                    new_title.clone()
                };
                persist_note(
                    &notes_dir,
                    &resolved_title,
                    new_markdown,
                    Some(current_path.as_path()),
                )
                .map_err(ApplyError::Failed)?
                .ok_or_else(|| ApplyError::Failed("Failed to persist updated note.".to_string()))?;
            }
            AiChange::CreateNote {
                suggested_title,
                markdown,
            } => {
                persist_note(&notes_dir, suggested_title, markdown, None)
                    .map_err(ApplyError::Failed)?
                    .ok_or_else(|| ApplyError::Failed("Failed to create new note.".to_string()))?;
            }
            AiChange::DeleteNote { path, .. } => {
                fs::remove_file(path).map_err(|err| ApplyError::Failed(err.to_string()))?;
            }
        }
    }

    let _ = validated_updates;
    let _ = validated_deletes;
    Ok(())
}

fn emit_inbox_changed(app_handle: &AppHandle) -> Result<(), String> {
    app_handle
        .emit(
            super::INBOX_CHANGED_EVENT,
            serde_json::json!({ "updated": true }),
        )
        .map_err(|err| err.to_string())
}

enum ApplyError {
    Stale(String),
    Failed(String),
}

#[cfg(test)]
mod tests {
    use super::{validate_job_changes, validate_override_changes};
    use crate::ai::{AiChange, AiJobStatus, RememberMode, SourceSnapshot, StoredAiJob};

    #[test]
    fn delete_note_is_rejected_for_cleanup_jobs() {
        let job = StoredAiJob {
            id: 1,
            kind: RememberMode::CleanUp,
            action_id: "cleanUp".to_string(),
            action_label: "Clean Up".to_string(),
            action_prompt: None,
            status: AiJobStatus::Queued,
            source: SourceSnapshot {
                path: "/tmp/Source.md".to_string(),
                title: "Source".to_string(),
                markdown: "Body".to_string(),
                content_hash: "hash".to_string(),
            },
            requires_approval: false,
            summary: String::new(),
            proposed_changes: Vec::new(),
            failure_reason: None,
            provider_kind: None,
            model: None,
            metrics: None,
            created_at_millis: 0,
            updated_at_millis: 0,
            retry_of_job_id: None,
        };
        let error = validate_job_changes(
            &job,
            &[AiChange::DeleteNote {
                path: "/tmp/Source.md".to_string(),
                base_content_hash: "hash".to_string(),
            }],
        )
        .expect_err("cleanup delete should fail");
        assert!(error.contains("deleteNote"));
    }

    #[test]
    fn validate_override_changes_rejects_unknown_update_paths() {
        let job = StoredAiJob {
            id: 1,
            kind: RememberMode::Integrate,
            action_id: "integrate".to_string(),
            action_label: "Integrate".to_string(),
            action_prompt: None,
            status: AiJobStatus::PendingApproval,
            source: SourceSnapshot {
                path: "/notes/source.md".to_string(),
                title: "Source".to_string(),
                markdown: "Body".to_string(),
                content_hash: "source-hash".to_string(),
            },
            requires_approval: true,
            summary: String::new(),
            proposed_changes: vec![AiChange::UpdateNote {
                path: "/notes/target.md".to_string(),
                base_content_hash: "target-hash".to_string(),
                new_title: "Target".to_string(),
                new_markdown: "proposed".to_string(),
            }],
            failure_reason: None,
            provider_kind: None,
            model: None,
            metrics: None,
            created_at_millis: 0,
            updated_at_millis: 0,
            retry_of_job_id: None,
        };

        let error = validate_override_changes(
            &job,
            &[AiChange::UpdateNote {
                path: "/notes/other.md".to_string(),
                base_content_hash: "target-hash".to_string(),
                new_title: "Other".to_string(),
                new_markdown: "edited".to_string(),
            }],
        )
        .expect_err("reject unknown path");
        assert!(error.contains("original proposal"));
    }
}
