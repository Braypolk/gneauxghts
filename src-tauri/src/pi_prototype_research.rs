//! Read/proof adapters only. Pi tasks own worker execution, history and cancellation.
use crate::{chat_domain::{ChatDomain, VaultAccess}, index::AppState, pi_prototype_notes, services::evidence::SearchRequest};
use serde::Deserialize;
use serde_json::Value;
use tauri::Manager;

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct Selection {
    pub(crate) evidence_ids: Vec<String>,
    pub(crate) gaps: Vec<String>,
}
impl Selection {
    pub(crate) fn validate(&self) -> Result<(), String> {
        if self.evidence_ids.len() > 8 || self.gaps.len() > 4
            || self.evidence_ids.iter().any(|s| s.is_empty() || s.len() > 512)
            || self.evidence_ids.iter().collect::<std::collections::HashSet<_>>().len() != self.evidence_ids.len()
            || self.gaps.iter().any(|s| !["coverage_incomplete", "no_match", "unavailable", "budget_exhausted"].contains(&s.as_str())) {
            return Err("Malformed research handoff".into());
        }
        if self.evidence_ids.is_empty() && self.gaps.is_empty() { return Err("Empty research must report an explicit gap".into()); }
        Ok(())
    }
}

#[tauri::command]
pub(crate) async fn pi_begin_research(app: tauri::AppHandle, parent_session_id: String, worker_session_id: String,
    request: Value, access: VaultAccess, grants: Vec<String>) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        if worker_session_id.len() > 256 || !worker_session_id.starts_with("pi-research:") { return Err("Invalid research invocation".into()); }
        let scope: SearchRequest = serde_json::from_value(request).map_err(|e| e.to_string())?;
        if scope.cursor.is_some() || scope.after.is_some() || scope.before.is_some() { return Err("Research requires explicit tool-facing scope".into()); }
        pi_prototype_notes::begin_research(&app.state::<AppState>(), &app.state::<ChatDomain>(),
            &parent_session_id, &worker_session_id, scope, &access, &grants)
    }).await.map_err(|e|e.to_string())?
}

#[tauri::command]
pub(crate) async fn pi_finish_research(app: tauri::AppHandle, parent_session_id: String, worker_session_id: String,
    selection: Selection, access: VaultAccess, grants: Vec<String>) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || pi_prototype_notes::finish_research(
        &app.state::<AppState>(), &app.state::<ChatDomain>(), &parent_session_id, &worker_session_id, selection, &access, &grants)
    ).await.map_err(|e|e.to_string())?
}

#[tauri::command]
pub(crate) fn pi_release_research(app: tauri::AppHandle, parent_session_id: String, worker_session_id: String) -> Result<(), String> {
    pi_prototype_notes::release_research(&app.state::<AppState>(), &parent_session_id, &worker_session_id)
}
#[tauri::command]
pub(crate) async fn pi_enable_adaptive_evidence(app: tauri::AppHandle, session_id: String,
    access: VaultAccess, grants: Vec<String>) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || pi_prototype_notes::enable_adaptive_evidence(
        &app.state::<AppState>(), &app.state::<ChatDomain>(), &session_id, &access, &grants)
    ).await.map_err(|e|e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn handoff_is_closed_bounded_and_reports_empty_gaps() {
        for input in [r#"{"evidence_ids":[],"gaps":[],"prose":"claims"}"#,
            r#"{"evidence_ids":[],"gaps":[]}"#, r#"{"evidence_ids":["a","a"],"gaps":[]}"#,
            r#"{"evidence_ids":[],"gaps":["invented"]}"#] {
            assert!(serde_json::from_str::<Selection>(input).map_err(|e|e.to_string()).and_then(|s|s.validate()).is_err());
        }
        assert!(serde_json::from_str::<Selection>(r#"{"evidence_ids":["exact"],"gaps":["coverage_incomplete"]}"#).unwrap().validate().is_ok());
    }
}
