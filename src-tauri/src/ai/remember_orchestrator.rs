use super::{
    build_provider, default_summary_for_job, ensure_schema, load_settings, non_empty_summary,
    open_database, should_skip_job_update, update_job_status, AiJobStatus, AiRunMetrics, AppHandle,
    StoredAiJob,
};
use std::{
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        mpsc::Receiver,
        Arc,
    },
    thread,
    time::Instant,
};
use tauri::{Emitter, Manager};

pub(super) enum WorkerSignal {
    Wake,
}

pub(super) fn spawn_worker(
    app_handle: AppHandle,
    db_path: PathBuf,
    signal_rx: Receiver<WorkerSignal>,
    wake_pending: Arc<AtomicBool>,
) -> Result<(), String> {
    thread::Builder::new()
        .name("ai-job-worker".to_string())
        .spawn(move || worker_loop(app_handle, db_path, signal_rx, wake_pending))
        .map_err(|err| err.to_string())?;
    Ok(())
}

fn worker_loop(
    app_handle: AppHandle,
    db_path: PathBuf,
    signal_rx: Receiver<WorkerSignal>,
    wake_pending: Arc<AtomicBool>,
) {
    while signal_rx.recv().is_ok() {
        wake_pending.store(false, Ordering::Release);
        loop {
            match super::claim_next_queued_job(&db_path) {
                Ok(Some(job)) => {
                    if let Err(error) = process_job(&app_handle, &db_path, job) {
                        eprintln!("ai job worker error: {error}");
                    }
                }
                Ok(None) => break,
                Err(error) => {
                    eprintln!("ai job queue error: {error}");
                    break;
                }
            }
        }
    }
}

fn process_job(app_handle: &AppHandle, db_path: &Path, job: StoredAiJob) -> Result<(), String> {
    let started_at = Instant::now();
    let connection = open_database(db_path)?;
    ensure_schema(&connection)?;
    let settings = load_settings(&connection)?;
    let provider = build_provider(&settings)?;
    let proposal = if job.kind.is_exact() {
        return Ok(());
    } else if job.kind.is_edit_mode() {
        super::run_edit_job(&job, provider.as_ref())
    } else if job.kind.is_split_mode() {
        super::run_split_up_job(app_handle, &job, provider.as_ref())
    } else if job.kind.is_custom_advanced_mode() {
        super::run_custom_advanced_job(app_handle, &job, provider.as_ref())
    } else {
        super::run_integrate_job(app_handle, &job, provider.as_ref())
    };

    match proposal {
        Ok(mut proposal) => {
            if should_skip_job_update(&connection, job.id)? {
                return Ok(());
            }
            proposal.metrics.elapsed_millis =
                started_at.elapsed().as_millis().min(u128::from(u64::MAX)) as u64;
            super::approval_service::validate_job_changes(&job, &proposal.changes)?;
            if job.requires_approval {
                let updated = update_job_status(
                    &connection,
                    job.id,
                    AiJobStatus::PendingApproval,
                    Some(non_empty_summary(
                        proposal.summary,
                        default_summary_for_job(&job, "Proposal ready"),
                    )),
                    None,
                    Some(proposal.changes),
                    Some(proposal.provider_kind),
                    Some(proposal.model),
                    Some(proposal.metrics),
                )?;
                emit_inbox_changed(app_handle)?;
                let _ = updated;
            } else {
                if should_skip_job_update(&connection, job.id)? {
                    return Ok(());
                }
                let pending = update_job_status(
                    &connection,
                    job.id,
                    AiJobStatus::Running,
                    Some(non_empty_summary(
                        proposal.summary.clone(),
                        default_summary_for_job(&job, "Applying proposal"),
                    )),
                    None,
                    Some(proposal.changes.clone()),
                    Some(proposal.provider_kind.clone()),
                    Some(proposal.model.clone()),
                    Some(proposal.metrics.clone()),
                )?;
                let applied = super::approval_service::apply_pending_job_inner(
                    db_path, app_handle, &pending,
                )?;
                let _ = applied;
                emit_inbox_changed(app_handle)?;
            }
        }
        Err(error) => {
            if should_skip_job_update(&connection, job.id)? {
                return Ok(());
            }
            update_job_status(
                &connection,
                job.id,
                AiJobStatus::Failed,
                Some(non_empty_summary(
                    error.clone(),
                    default_summary_for_job(&job, "AI job failed"),
                )),
                Some(error),
                None,
                Some(provider.provider_kind()),
                Some(load_settings(&connection)?.model),
                Some(AiRunMetrics {
                    elapsed_millis: started_at.elapsed().as_millis().min(u128::from(u64::MAX))
                        as u64,
                    prompt_tokens: None,
                    completion_tokens: None,
                    total_tokens: None,
                }),
            )?;
            emit_inbox_changed(app_handle)?;
        }
    }

    Ok(())
}

fn emit_inbox_changed(app_handle: &AppHandle) -> Result<(), String> {
    if let Some(app_data) = app_handle.try_state::<crate::app::AppData>() {
        app_data.events.inbox_changed();
        Ok(())
    } else {
        app_handle
            .emit(
                super::INBOX_CHANGED_EVENT,
                serde_json::json!({ "updated": true }),
            )
            .map_err(|err| err.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::WorkerSignal;

    #[test]
    fn worker_signal_wake_is_constructible() {
        let signal = WorkerSignal::Wake;
        match signal {
            WorkerSignal::Wake => {}
        }
    }
}
