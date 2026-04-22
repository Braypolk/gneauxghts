use super::{
    AiChange, AiChangePreview, AiDiagnosticsLastRun, AiDiagnosticsMetrics, AiJobStatus,
    AiProviderKind, AiRunMetrics, AiSettings, InboxItemDetail, InboxListItem, RememberMode,
};
use crate::{note, semantic::db::content_hash, time::current_time_millis};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::{
    collections::HashSet,
    fs,
    path::{Path, PathBuf},
};

pub(super) const AI_DB_FILE_NAME: &str = "ai.sqlite3";
const DEFAULT_OPENAI_BASE_URL: &str = "https://api.openai.com/v1";

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(super) struct SourceSnapshot {
    pub(super) path: String,
    pub(super) title: String,
    pub(super) markdown: String,
    pub(super) content_hash: String,
}

#[derive(Clone, Debug)]
pub(super) struct StoredAiSettings {
    pub(super) provider_kind: AiProviderKind,
    pub(super) base_url: String,
    pub(super) model: String,
    pub(super) api_key: Option<String>,
}

#[derive(Clone, Debug)]
pub(super) struct StoredAiJob {
    pub(super) id: i64,
    pub(super) kind: RememberMode,
    pub(super) action_id: String,
    pub(super) action_label: String,
    pub(super) action_prompt: Option<String>,
    pub(super) status: AiJobStatus,
    pub(super) source: SourceSnapshot,
    pub(super) requires_approval: bool,
    pub(super) summary: String,
    pub(super) proposed_changes: Vec<AiChange>,
    pub(super) failure_reason: Option<String>,
    pub(super) provider_kind: Option<AiProviderKind>,
    pub(super) model: Option<String>,
    pub(super) metrics: Option<AiRunMetrics>,
    pub(super) created_at_millis: u64,
    pub(super) updated_at_millis: u64,
    pub(super) retry_of_job_id: Option<i64>,
}

pub(super) fn build_source_snapshot(path: &str, raw_markdown: &str) -> SourceSnapshot {
    SourceSnapshot {
        path: path.to_string(),
        title: fallback_title_for_path(path),
        markdown: body_markdown_from_path_and_raw(path, raw_markdown),
        content_hash: content_hash(raw_markdown),
    }
}

pub(super) fn body_markdown_from_path_and_raw(path: &str, raw_markdown: &str) -> String {
    let fallback_title = fallback_title_for_path(path);
    let (_, body) = note::extract_file_name_title_and_body(raw_markdown, &fallback_title);
    body
}

pub(super) fn fallback_title_for_path(path: &str) -> String {
    Path::new(path)
        .file_stem()
        .unwrap_or_default()
        .to_string_lossy()
        .into_owned()
}

pub(super) fn job_title(job: &StoredAiJob) -> String {
    format!("{}: {}", job.action_label, job.source.title)
}

pub(super) fn default_summary_for_job(job: &StoredAiJob, fallback: &str) -> String {
    if job.kind.is_exact() {
        fallback.to_string()
    } else {
        format!("{fallback} for \"{}\".", job.source.title)
    }
}

pub(super) fn affected_notes(changes: &[AiChange]) -> Vec<String> {
    let mut affected = Vec::new();
    let mut seen = HashSet::new();
    for change in changes {
        let label = match change {
            AiChange::UpdateNote { path, .. } | AiChange::DeleteNote { path, .. } => {
                fallback_title_for_path(path)
            }
            AiChange::CreateNote {
                suggested_title, ..
            } => suggested_title.clone(),
        };
        if seen.insert(label.clone()) {
            affected.push(label);
        }
    }
    affected
}

pub(super) fn sum_metrics(left: AiRunMetrics, right: AiRunMetrics) -> AiRunMetrics {
    AiRunMetrics {
        elapsed_millis: 0,
        prompt_tokens: sum_optional(left.prompt_tokens, right.prompt_tokens),
        completion_tokens: sum_optional(left.completion_tokens, right.completion_tokens),
        total_tokens: sum_optional(left.total_tokens, right.total_tokens),
    }
}

pub(super) fn sum_optional(left: Option<u64>, right: Option<u64>) -> Option<u64> {
    match (left, right) {
        (Some(left), Some(right)) => Some(left + right),
        (Some(left), None) => Some(left),
        (None, Some(right)) => Some(right),
        (None, None) => None,
    }
}

pub(super) fn truncate_chars(value: &str, max_chars: usize) -> String {
    value.chars().take(max_chars).collect()
}

pub(super) fn non_empty_summary(summary: String, fallback: String) -> String {
    if summary.trim().is_empty() {
        fallback
    } else {
        summary
    }
}

pub(super) fn normalize_base_url(value: &str) -> String {
    let trimmed = value.trim().trim_end_matches('/');
    if trimmed.is_empty() {
        DEFAULT_OPENAI_BASE_URL.to_string()
    } else {
        trimmed.to_string()
    }
}

pub(super) fn public_ai_settings(settings: StoredAiSettings) -> AiSettings {
    AiSettings {
        provider_kind: settings.provider_kind,
        base_url: settings.base_url,
        model: settings.model,
        api_key_configured: settings
            .api_key
            .as_ref()
            .is_some_and(|value| !value.trim().is_empty()),
    }
}

pub(super) fn to_list_item(job: StoredAiJob) -> InboxListItem {
    InboxListItem {
        id: job.id,
        kind: job.kind.clone(),
        action_label: job.action_label.clone(),
        status: job.status.clone(),
        title: job_title(&job),
        summary: non_empty_summary(job.summary.clone(), default_summary_for_job(&job, "Ready")),
        source_path: job.source.path.clone(),
        source_title: job.source.title.clone(),
        affected_notes: affected_notes(&job.proposed_changes),
        created_at_millis: job.created_at_millis,
        updated_at_millis: job.updated_at_millis,
    }
}

pub(super) fn to_detail_item(job: &StoredAiJob) -> Result<InboxItemDetail, String> {
    Ok(InboxItemDetail {
        id: job.id,
        kind: job.kind.clone(),
        action_label: job.action_label.clone(),
        status: job.status.clone(),
        title: job_title(job),
        summary: non_empty_summary(job.summary.clone(), default_summary_for_job(job, "Ready")),
        source_path: job.source.path.clone(),
        source_title: job.source.title.clone(),
        source_markdown: job.source.markdown.clone(),
        source_content_hash: job.source.content_hash.clone(),
        provider_kind: job.provider_kind.clone(),
        model: job.model.clone(),
        requires_approval: job.requires_approval,
        failure_reason: job.failure_reason.clone(),
        metrics: job.metrics.clone(),
        proposed_changes: job.proposed_changes.clone(),
        change_previews: build_change_previews(&job.proposed_changes)?,
        created_at_millis: job.created_at_millis,
        updated_at_millis: job.updated_at_millis,
    })
}

pub(super) fn build_change_previews(changes: &[AiChange]) -> Result<Vec<AiChangePreview>, String> {
    let mut previews = Vec::new();
    for change in changes {
        match change {
            AiChange::UpdateNote { path, .. } | AiChange::DeleteNote { path, .. } => {
                let path_buf = PathBuf::from(path);
                let (current_title, current_markdown) = if path_buf.is_file() {
                    let raw = fs::read_to_string(&path_buf).map_err(|err| err.to_string())?;
                    let title = fallback_title_for_path(path);
                    let (resolved_title, body) =
                        note::extract_file_name_title_and_body(&raw, &title);
                    (Some(resolved_title), Some(body))
                } else {
                    (None, None)
                };
                previews.push(AiChangePreview {
                    change: change.clone(),
                    current_title,
                    current_markdown,
                });
            }
            AiChange::CreateNote { .. } => previews.push(AiChangePreview {
                change: change.clone(),
                current_title: None,
                current_markdown: None,
            }),
        }
    }
    Ok(previews)
}

pub(super) fn build_ai_diagnostics_metrics(jobs: &[StoredAiJob]) -> AiDiagnosticsMetrics {
    let mut metrics = AiDiagnosticsMetrics::default();
    for job in jobs {
        let Some(run_metrics) = job.metrics.as_ref() else {
            continue;
        };
        metrics.run_count += 1;
        let prompt_tokens = run_metrics.prompt_tokens.unwrap_or(0);
        let completion_tokens = run_metrics.completion_tokens.unwrap_or(0);
        let total_tokens = run_metrics
            .total_tokens
            .unwrap_or(prompt_tokens + completion_tokens);
        metrics.prompt_tokens_total += prompt_tokens;
        metrics.completion_tokens_total += completion_tokens;
        metrics.total_tokens_total += total_tokens;
        metrics.prompt_tokens_max = metrics.prompt_tokens_max.max(prompt_tokens);
        metrics.completion_tokens_max = metrics.completion_tokens_max.max(completion_tokens);
        metrics.total_tokens_max = metrics.total_tokens_max.max(total_tokens);
        let should_replace_last_run = match metrics.last_run.as_ref() {
            Some(last_run) => job.updated_at_millis > last_run.updated_at_millis,
            None => true,
        };
        if should_replace_last_run {
            metrics.last_run = Some(AiDiagnosticsLastRun {
                kind: job.kind.clone(),
                action_label: job.action_label.clone(),
                status: job.status.clone(),
                model: job.model.clone(),
                prompt_tokens: run_metrics.prompt_tokens,
                completion_tokens: run_metrics.completion_tokens,
                total_tokens: run_metrics.total_tokens,
                elapsed_millis: run_metrics.elapsed_millis,
                updated_at_millis: job.updated_at_millis,
            });
        }
    }
    metrics
}

pub(super) fn open_database(path: &Path) -> Result<Connection, String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|err| err.to_string())?;
    }
    let connection = Connection::open(path).map_err(|err| err.to_string())?;
    connection
        .pragma_update(None, "journal_mode", "WAL")
        .map_err(|err| err.to_string())?;
    connection
        .pragma_update(None, "synchronous", "NORMAL")
        .map_err(|err| err.to_string())?;
    Ok(connection)
}

pub(super) fn ensure_schema(connection: &Connection) -> Result<(), String> {
    connection
        .execute_batch(
            "
            CREATE TABLE IF NOT EXISTS ai_settings (
                id INTEGER PRIMARY KEY CHECK (id = 1),
                provider_kind TEXT NOT NULL,
                base_url TEXT NOT NULL,
                model TEXT NOT NULL,
                api_key TEXT,
                updated_at_millis INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS ai_jobs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                kind TEXT NOT NULL,
                action_id TEXT NOT NULL DEFAULT '',
                action_label TEXT NOT NULL DEFAULT '',
                action_prompt TEXT,
                status TEXT NOT NULL,
                source_path TEXT NOT NULL,
                source_title TEXT NOT NULL,
                source_markdown TEXT NOT NULL,
                source_content_hash TEXT NOT NULL,
                requires_approval INTEGER NOT NULL,
                summary TEXT NOT NULL DEFAULT '',
                proposed_changes_json TEXT,
                failure_reason TEXT,
                provider_kind TEXT,
                model TEXT,
                metrics_json TEXT,
                retry_of_job_id INTEGER,
                created_at_millis INTEGER NOT NULL,
                updated_at_millis INTEGER NOT NULL
            );
            ",
        )
        .map_err(|err| err.to_string())?;
    ensure_column(
        connection,
        "ALTER TABLE ai_jobs ADD COLUMN action_id TEXT NOT NULL DEFAULT ''",
    )?;
    ensure_column(
        connection,
        "ALTER TABLE ai_jobs ADD COLUMN action_label TEXT NOT NULL DEFAULT ''",
    )?;
    ensure_column(
        connection,
        "ALTER TABLE ai_jobs ADD COLUMN action_prompt TEXT",
    )?;
    Ok(())
}

fn ensure_column(connection: &Connection, statement: &str) -> Result<(), String> {
    match connection.execute(statement, []) {
        Ok(_) => Ok(()),
        Err(err) if err.to_string().contains("duplicate column name") => Ok(()),
        Err(err) => Err(err.to_string()),
    }
}

pub(super) fn ensure_default_settings(connection: &Connection) -> Result<(), String> {
    let exists = connection
        .query_row("SELECT COUNT(*) FROM ai_settings WHERE id = 1", [], |row| {
            row.get::<_, usize>(0)
        })
        .map_err(|err| err.to_string())?;
    if exists > 0 {
        return Ok(());
    }
    connection
        .execute(
            "INSERT INTO ai_settings (
                id,
                provider_kind,
                base_url,
                model,
                api_key,
                updated_at_millis
             ) VALUES (1, ?1, ?2, ?3, NULL, ?4)",
            params![
                provider_kind_to_str(&AiProviderKind::OpenAiCompatible),
                DEFAULT_OPENAI_BASE_URL,
                "",
                current_time_millis()?,
            ],
        )
        .map_err(|err| err.to_string())?;
    Ok(())
}

pub(super) fn load_settings(connection: &Connection) -> Result<StoredAiSettings, String> {
    connection
        .query_row(
            "SELECT provider_kind, base_url, model, api_key FROM ai_settings WHERE id = 1",
            [],
            |row| {
                let provider_kind = str_to_provider_kind(row.get::<_, String>(0)?.as_str())
                    .map_err(|err| {
                        rusqlite::Error::FromSqlConversionFailure(
                            0,
                            rusqlite::types::Type::Text,
                            Box::new(std::io::Error::new(std::io::ErrorKind::InvalidData, err)),
                        )
                    })?;
                Ok(StoredAiSettings {
                    provider_kind,
                    base_url: row.get(1)?,
                    model: row.get(2)?,
                    api_key: row.get(3)?,
                })
            },
        )
        .map_err(|err| err.to_string())
}

pub(super) fn save_settings(
    connection: &Connection,
    settings: &StoredAiSettings,
) -> Result<(), String> {
    connection
        .execute(
            "UPDATE ai_settings
             SET provider_kind = ?1,
                 base_url = ?2,
                 model = ?3,
                 api_key = ?4,
                 updated_at_millis = ?5
             WHERE id = 1",
            params![
                provider_kind_to_str(&settings.provider_kind),
                settings.base_url,
                settings.model,
                settings.api_key,
                current_time_millis()?,
            ],
        )
        .map_err(|err| err.to_string())?;
    Ok(())
}

pub(super) fn insert_job(connection: &Connection, job: &StoredAiJob) -> Result<i64, String> {
    connection
        .execute(
            "INSERT INTO ai_jobs (
                kind,
                action_id,
                action_label,
                action_prompt,
                status,
                source_path,
                source_title,
                source_markdown,
                source_content_hash,
                requires_approval,
                summary,
                proposed_changes_json,
                failure_reason,
                provider_kind,
                model,
                metrics_json,
                retry_of_job_id,
                created_at_millis,
                updated_at_millis
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19)",
            params![
                remember_mode_to_str(&job.kind),
                job.action_id,
                job.action_label,
                job.action_prompt,
                job_status_to_str(&job.status),
                job.source.path,
                job.source.title,
                job.source.markdown,
                job.source.content_hash,
                if job.requires_approval { 1 } else { 0 },
                job.summary,
                serialize_changes(&job.proposed_changes)?,
                job.failure_reason,
                job.provider_kind.as_ref().map(provider_kind_to_str),
                job.model,
                serialize_metrics(&job.metrics)?,
                job.retry_of_job_id,
                job.created_at_millis,
                job.updated_at_millis,
            ],
        )
        .map_err(|err| err.to_string())?;
    Ok(connection.last_insert_rowid())
}

pub(super) fn list_jobs(connection: &Connection) -> Result<Vec<StoredAiJob>, String> {
    list_jobs_with_filter(connection, true)
}

pub(super) fn list_jobs_including_cancelled(
    connection: &Connection,
) -> Result<Vec<StoredAiJob>, String> {
    list_jobs_with_filter(connection, false)
}

fn list_jobs_with_filter(
    connection: &Connection,
    hide_cancelled: bool,
) -> Result<Vec<StoredAiJob>, String> {
    let filter_clause = if hide_cancelled {
        "WHERE status != 'cancelled'"
    } else {
        ""
    };
    let mut statement = connection
        .prepare(&format!(
            "SELECT
                id,
                kind,
                action_id,
                action_label,
                action_prompt,
                status,
                source_path,
                source_title,
                source_markdown,
                source_content_hash,
                requires_approval,
                summary,
                proposed_changes_json,
                failure_reason,
                provider_kind,
                model,
                metrics_json,
                retry_of_job_id,
                created_at_millis,
                updated_at_millis
             FROM ai_jobs
             {filter_clause}
             ORDER BY updated_at_millis DESC, id DESC"
        ))
        .map_err(|err| err.to_string())?;
    let rows = statement
        .query_map([], row_to_job)
        .map_err(|err| err.to_string())?;
    let mut jobs = Vec::new();
    for row in rows {
        jobs.push(row.map_err(|err| err.to_string())?);
    }
    Ok(jobs)
}

pub(super) fn load_job(connection: &Connection, id: i64) -> Result<Option<StoredAiJob>, String> {
    connection
        .query_row(
            "SELECT
                id,
                kind,
                action_id,
                action_label,
                action_prompt,
                status,
                source_path,
                source_title,
                source_markdown,
                source_content_hash,
                requires_approval,
                summary,
                proposed_changes_json,
                failure_reason,
                provider_kind,
                model,
                metrics_json,
                retry_of_job_id,
                created_at_millis,
                updated_at_millis
             FROM ai_jobs
             WHERE id = ?1",
            params![id],
            row_to_job,
        )
        .optional()
        .map_err(|err| err.to_string())
}

pub(super) fn claim_next_queued_job(db_path: &Path) -> Result<Option<StoredAiJob>, String> {
    let connection = open_database(db_path)?;
    ensure_schema(&connection)?;
    let Some(job) = connection
        .query_row(
            "SELECT
                id,
                kind,
                action_id,
                action_label,
                action_prompt,
                status,
                source_path,
                source_title,
                source_markdown,
                source_content_hash,
                requires_approval,
                summary,
                proposed_changes_json,
                failure_reason,
                provider_kind,
                model,
                metrics_json,
                retry_of_job_id,
                created_at_millis,
                updated_at_millis
             FROM ai_jobs
             WHERE status = 'queued'
             ORDER BY created_at_millis ASC, id ASC
             LIMIT 1",
            [],
            row_to_job,
        )
        .optional()
        .map_err(|err| err.to_string())?
    else {
        return Ok(None);
    };

    let updated = update_job_status(
        &connection,
        job.id,
        AiJobStatus::Running,
        Some("AI job is running".to_string()),
        None,
        Some(job.proposed_changes.clone()),
        job.provider_kind.clone(),
        job.model.clone(),
        job.metrics.clone(),
    )?;
    Ok(Some(updated))
}

#[allow(clippy::too_many_arguments)]
pub(super) fn update_job_status(
    connection: &Connection,
    id: i64,
    status: AiJobStatus,
    summary: Option<String>,
    failure_reason: Option<String>,
    proposed_changes: Option<Vec<AiChange>>,
    provider_kind: Option<AiProviderKind>,
    model: Option<String>,
    metrics: Option<AiRunMetrics>,
) -> Result<StoredAiJob, String> {
    let current = load_job(connection, id)?.ok_or_else(|| "Inbox item not found".to_string())?;
    let next_summary = summary.unwrap_or(current.summary);
    let next_failure_reason = failure_reason.or(current.failure_reason);
    let next_changes = proposed_changes.unwrap_or(current.proposed_changes);
    let next_provider_kind = provider_kind.or(current.provider_kind);
    let next_model = model.or(current.model);
    let next_metrics = metrics.or(current.metrics);
    let now = current_time_millis()?;

    connection
        .execute(
            "UPDATE ai_jobs
             SET status = ?2,
                 summary = ?3,
                 failure_reason = ?4,
                 proposed_changes_json = ?5,
                 provider_kind = ?6,
                 model = ?7,
                 metrics_json = ?8,
                 updated_at_millis = ?9
             WHERE id = ?1",
            params![
                id,
                job_status_to_str(&status),
                next_summary,
                next_failure_reason,
                serialize_changes(&next_changes)?,
                next_provider_kind.as_ref().map(provider_kind_to_str),
                next_model,
                serialize_metrics(&next_metrics)?,
                now,
            ],
        )
        .map_err(|err| err.to_string())?;

    load_job(connection, id)?.ok_or_else(|| "Inbox item disappeared after update".to_string())
}

pub(super) fn should_skip_job_update(connection: &Connection, id: i64) -> Result<bool, String> {
    let Some(job) = load_job(connection, id)? else {
        return Ok(true);
    };
    Ok(job.status == AiJobStatus::Cancelled)
}

fn row_to_job(row: &rusqlite::Row<'_>) -> rusqlite::Result<StoredAiJob> {
    let kind_text = row.get::<_, String>(1)?;
    let status_text = row.get::<_, String>(5)?;
    let provider_kind = row
        .get::<_, Option<String>>(14)?
        .map(|value| str_to_provider_kind(value.as_str()))
        .transpose()
        .map_err(|err| {
            rusqlite::Error::FromSqlConversionFailure(
                14,
                rusqlite::types::Type::Text,
                Box::new(std::io::Error::new(std::io::ErrorKind::InvalidData, err)),
            )
        })?;
    let proposed_changes_json = row.get::<_, Option<String>>(12)?;
    let metrics_json = row.get::<_, Option<String>>(16)?;
    Ok(StoredAiJob {
        id: row.get(0)?,
        kind: str_to_remember_mode(kind_text.as_str()).map_err(|err| {
            rusqlite::Error::FromSqlConversionFailure(
                1,
                rusqlite::types::Type::Text,
                Box::new(std::io::Error::new(std::io::ErrorKind::InvalidData, err)),
            )
        })?,
        action_id: row.get(2)?,
        action_label: row.get(3)?,
        action_prompt: row.get(4)?,
        status: str_to_job_status(status_text.as_str()).map_err(|err| {
            rusqlite::Error::FromSqlConversionFailure(
                5,
                rusqlite::types::Type::Text,
                Box::new(std::io::Error::new(std::io::ErrorKind::InvalidData, err)),
            )
        })?,
        source: SourceSnapshot {
            path: row.get(6)?,
            title: row.get(7)?,
            markdown: row.get(8)?,
            content_hash: row.get(9)?,
        },
        requires_approval: row.get::<_, i64>(10)? == 1,
        summary: row.get(11)?,
        proposed_changes: deserialize_changes(proposed_changes_json.as_deref()).map_err(|err| {
            rusqlite::Error::FromSqlConversionFailure(
                12,
                rusqlite::types::Type::Text,
                Box::new(std::io::Error::new(std::io::ErrorKind::InvalidData, err)),
            )
        })?,
        failure_reason: row.get(13)?,
        provider_kind,
        model: row.get(15)?,
        metrics: deserialize_metrics(metrics_json.as_deref()).map_err(|err| {
            rusqlite::Error::FromSqlConversionFailure(
                16,
                rusqlite::types::Type::Text,
                Box::new(std::io::Error::new(std::io::ErrorKind::InvalidData, err)),
            )
        })?,
        retry_of_job_id: row.get(17)?,
        created_at_millis: row.get(18)?,
        updated_at_millis: row.get(19)?,
    })
}

fn serialize_changes(changes: &[AiChange]) -> Result<Option<String>, String> {
    if changes.is_empty() {
        return Ok(None);
    }
    serde_json::to_string(changes)
        .map(Some)
        .map_err(|err| err.to_string())
}

fn deserialize_changes(value: Option<&str>) -> Result<Vec<AiChange>, String> {
    match value {
        Some(value) => serde_json::from_str(value).map_err(|err| err.to_string()),
        None => Ok(Vec::new()),
    }
}

fn serialize_metrics(metrics: &Option<AiRunMetrics>) -> Result<Option<String>, String> {
    match metrics {
        Some(metrics) => serde_json::to_string(metrics)
            .map(Some)
            .map_err(|err| err.to_string()),
        None => Ok(None),
    }
}

fn deserialize_metrics(value: Option<&str>) -> Result<Option<AiRunMetrics>, String> {
    match value {
        Some(value) => serde_json::from_str(value)
            .map(Some)
            .map_err(|err| err.to_string()),
        None => Ok(None),
    }
}

pub(super) fn remember_mode_to_str(mode: &RememberMode) -> &'static str {
    match mode {
        RememberMode::Exact => "exact",
        RememberMode::CleanUp => "cleanUp",
        RememberMode::Summarize => "summarize",
        RememberMode::Outline => "outline",
        RememberMode::ActionItems => "actionItems",
        RememberMode::Decisions => "decisions",
        RememberMode::MeetingNotes => "meetingNotes",
        RememberMode::Evergreen => "evergreen",
        RememberMode::Retitle => "retitle",
        RememberMode::StudyGuide => "studyGuide",
        RememberMode::SplitUp => "splitUp",
        RememberMode::Integrate => "integrate",
        RememberMode::CustomSingleNote => "customSingleNote",
        RememberMode::CustomAdvanced => "customAdvanced",
    }
}

pub(super) fn str_to_remember_mode(value: &str) -> Result<RememberMode, String> {
    match value {
        "exact" => Ok(RememberMode::Exact),
        "cleanUp" => Ok(RememberMode::CleanUp),
        "summarize" => Ok(RememberMode::Summarize),
        "outline" => Ok(RememberMode::Outline),
        "actionItems" => Ok(RememberMode::ActionItems),
        "decisions" => Ok(RememberMode::Decisions),
        "meetingNotes" => Ok(RememberMode::MeetingNotes),
        "evergreen" => Ok(RememberMode::Evergreen),
        "retitle" => Ok(RememberMode::Retitle),
        "studyGuide" => Ok(RememberMode::StudyGuide),
        "splitUp" => Ok(RememberMode::SplitUp),
        "integrate" => Ok(RememberMode::Integrate),
        "customSingleNote" => Ok(RememberMode::CustomSingleNote),
        "customAdvanced" => Ok(RememberMode::CustomAdvanced),
        _ => Err(format!("Unknown remember mode: {value}")),
    }
}

pub(super) fn job_status_to_str(status: &AiJobStatus) -> &'static str {
    match status {
        AiJobStatus::Queued => "queued",
        AiJobStatus::Running => "running",
        AiJobStatus::PendingApproval => "pendingApproval",
        AiJobStatus::Applied => "applied",
        AiJobStatus::Rejected => "rejected",
        AiJobStatus::Failed => "failed",
        AiJobStatus::Stale => "stale",
        AiJobStatus::Cancelled => "cancelled",
    }
}

pub(super) fn str_to_job_status(value: &str) -> Result<AiJobStatus, String> {
    match value {
        "queued" => Ok(AiJobStatus::Queued),
        "running" => Ok(AiJobStatus::Running),
        "pendingApproval" => Ok(AiJobStatus::PendingApproval),
        "applied" => Ok(AiJobStatus::Applied),
        "rejected" => Ok(AiJobStatus::Rejected),
        "failed" => Ok(AiJobStatus::Failed),
        "stale" => Ok(AiJobStatus::Stale),
        "cancelled" => Ok(AiJobStatus::Cancelled),
        _ => Err(format!("Unknown ai job status: {value}")),
    }
}

pub(super) fn provider_kind_to_str(value: &AiProviderKind) -> &'static str {
    match value {
        AiProviderKind::OpenAiCompatible => "openAiCompatible",
        AiProviderKind::LlamaServer => "llamaServer",
    }
}

pub(super) fn str_to_provider_kind(value: &str) -> Result<AiProviderKind, String> {
    match value {
        "openAiCompatible" => Ok(AiProviderKind::OpenAiCompatible),
        "llamaServer" => Ok(AiProviderKind::LlamaServer),
        _ => Err(format!("Unknown ai provider kind: {value}")),
    }
}
