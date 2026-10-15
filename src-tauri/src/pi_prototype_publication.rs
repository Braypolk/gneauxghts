//! Native effect intents/receipts. Pi alone owns pending reviews and decisions.
use crate::{chat::{ChatService, VaultAccess}, index::AppState,
    proposals::{self, AppliedNoteChange, CommitNoteReviewResult},
    services::note_timeline::{HistoryError, MutationSource, NoteIdentity}};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{fs, path::PathBuf, sync::Mutex};
use tauri::Manager;

static PUBLICATION: Mutex<()> = Mutex::new(());

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all="camelCase", deny_unknown_fields)]
pub(crate) struct Accepted {
    id: String, version: u64, kind: String, note_id: Option<String>, path: String,
    title: String, markdown: String, base_hash: Option<String>, access: VaultAccess,
}

fn require_access(service: &ChatService, access: &VaultAccess, note_id: Option<&str>) -> Result<(), String> {
    if *access == VaultAccess::None { return Err("Vault access is disabled".into()); }
    if let Some(id) = note_id {
        if service.excluded_note_ids()?.contains(id) || (*access == VaultAccess::Approved && !service.granted_note_ids()?.contains(id)) {
            return Err("Note access changed; review its access again".into());
        }
    }
    Ok(())
}

#[tauri::command]
pub(crate) async fn pi_prepare_review(app: tauri::AppHandle, title: String, markdown: String,
    note_id: Option<String>, access: VaultAccess, path: Option<String>) -> Result<Value, String> {
    if markdown.len() > 262144 || title.len() > 200 { return Err("Review exceeds prototype bounds".into()); }
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        require_access(&app.state::<ChatService>(), &access, note_id.as_deref())?;
        let root = state.running_vault().root();
        if let Some(id) = note_id {
            let path = crate::state::resolve_note_path_by_id(root, &id)?.ok_or("Target note unavailable")?;
            let preview = proposals::preview_note_rewrite_from_working(root, &path.to_string_lossy(), None, &markdown)?;
            Ok(json!({"kind":"update","noteId":id,"title":preview.title,"baseHash":preview.base_content_hash,
                "suggestedPath":preview.note_path,"preview":preview,"payload":{"markdown":markdown,"title":title}}))
        } else {
            let mut preview = proposals::preview_note_creation(root, &title, &markdown)?;
            if let Some(path) = path { preview.suggested_path = proposals::canonical_agent_commit_target(root, &PathBuf::from(path))?.to_string_lossy().into(); }
            Ok(json!({"kind":"create","noteId":null,"title":title,"baseHash":null,
                "suggestedPath":preview.suggested_path,"preview":preview,"payload":{"markdown":markdown,"title":title}}))
        }
    }).await.map_err(|e| e.to_string())?
}

fn conflict(message: &str) -> CommitNoteReviewResult {
    CommitNoteReviewResult {status:"conflict".into(),applied:None,note_id:None,committed_markdown:None,commit_warning:None,message:Some(message.into())}
}

#[tauri::command]
pub(crate) async fn pi_publish_review(app: tauri::AppHandle, accepted: Accepted, current_access: Option<VaultAccess>, fault: Option<String>) -> Result<CommitNoteReviewResult, String> {
    if fault.is_some() && std::env::var_os("PI_PROTOTYPE_HTTP_FIXTURE").is_none() { return Err("Fault injection requires the synthetic fixture".into()); }
    tauri::async_runtime::spawn_blocking(move || {if let Some(access)=current_access{require_access(&app.state::<ChatService>(),&access,accepted.note_id.as_deref())?;}publish(&app, accepted, fault.as_deref())}).await.map_err(|e|e.to_string())?
}

fn publish(app: &tauri::AppHandle, accepted: Accepted, fault: Option<&str>) -> Result<CommitNoteReviewResult,String> {
    let _serial = PUBLICATION.lock().map_err(|_| "Publication lock poisoned")?;
    if accepted.id.len() > 80 || accepted.markdown.len() > 262144 || accepted.title.trim().is_empty() { return Err("Invalid accepted review".into()); }
    let state = app.state::<AppState>();
    require_access(&app.state::<ChatService>(), &accepted.access, accepted.note_id.as_deref())?;
    let root = state.running_vault().root();
    let path = proposals::canonical_agent_commit_target(root, &PathBuf::from(&accepted.path))?;
    let hash = crate::semantic::db::content_hash(&serde_json::to_string(&accepted).map_err(|e|e.to_string())?);
    let key = format!("{}:{}",accepted.id,accepted.version);
    let ledger_path = crate::state::app_data_dir()?.join("PROTOTYPE-wipe-me/publication-receipts.sqlite");
    let ledger = Connection::open(ledger_path).map_err(|e|e.to_string())?;
    ledger.execute_batch("PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; CREATE TABLE IF NOT EXISTS effects(id TEXT PRIMARY KEY,payload_hash TEXT NOT NULL,note_id TEXT NOT NULL,target_path TEXT NOT NULL,intended_hash TEXT NOT NULL,receipt TEXT);").map_err(|e|e.to_string())?;
    let prior:Option<(String,String,String,String,Option<String>)> = ledger.query_row("SELECT payload_hash,note_id,target_path,intended_hash,receipt FROM effects WHERE id=?1",[&key],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?,r.get(4)?))).optional().map_err(|e|e.to_string())?;
    let fresh_intent=prior.is_none();
    let identity = if let Some((prior_hash,id,target,intended,receipt)) = prior {
        if prior_hash != hash || target != path.to_string_lossy() { return Err("Accepted payload differs from native intent".into()); }
        if let Some(receipt) = receipt { return serde_json::from_str(&receipt).map_err(|e|e.to_string()); }
        // NoteTimeline recovers its own retained publication intents before the
        // authoritative read. Identity AND exact accepted editor bytes must match.
        state.note_timeline().retry_history_recovery(root).map_err(|e|e.to_string())?;
        if let Ok(raw) = fs::read_to_string(&path) {
            let actual_id = crate::note::parse_note(&raw).frontmatter.managed.map(|m|m.id);
            if actual_id.as_deref() == Some(&id) && proposals::editor_visible_content_hash(&path,&raw) == intended {
                let session = crate::commands::read_note_session_from_path(&path)?;
                let receipt = CommitNoteReviewResult {status:"committed".into(),note_id:Some(id),
                    committed_markdown:Some(session.markdown),commit_warning:session.commit_warning,message:None,
                    applied:Some(AppliedNoteChange{kind:if accepted.kind=="create" {"createNote"} else {"updateNote"}.into(),path:Some(path.to_string_lossy().into()),previous_path:None})};
                ledger.execute("UPDATE effects SET receipt=?2 WHERE id=?1",params![key,serde_json::to_string(&receipt).map_err(|e|e.to_string())?]).map_err(|e|e.to_string())?;
                return Ok(receipt);
            }
        }
        id
    } else {
        let id = accepted.note_id.clone().unwrap_or_else(crate::note::generate_unique_id);
        ledger.execute("INSERT INTO effects VALUES(?1,?2,?3,?4,?5,NULL)",params![key,hash,id,path.to_string_lossy(),proposals::editor_visible_content_hash(&path,&accepted.markdown)]).map_err(|e|e.to_string())?;
        id
    };
    if fault == Some("after-intent") && fresh_intent { std::process::abort(); }
    let timeline = state.note_timeline();
    let outcome = if accepted.kind == "create" {
        timeline.create_prototype_note_at(&path,&accepted.markdown,&NoteIdentity::new(identity))
    } else if accepted.kind == "update" {
        let expected = accepted.base_hash.as_ref().ok_or("Missing accepted base hash")?;
        timeline.edit_note(MutationSource::AcceptedChatProposal,&path,Some(&NoteIdentity::new(identity)),|current| {
            if crate::semantic::db::content_hash(current) != *expected { return Err(HistoryError::Stale("Target changed; review refreshed content and Keep again".into())); }
            Ok(accepted.markdown.clone())
        }).map(Some)
    } else { return Err("Unsupported proposal kind".into()); };
    let outcome = match outcome {
        Ok(Some(value)) => value,
        Ok(None) => return Ok(conflict("Creation destination occupied; review again")),
        Err(HistoryError::Stale(message)) => return Ok(conflict(&message)),
        Err(error) => return Err(error.to_string()),
    };
    if fault == Some("after-publication") { std::process::abort(); }
    let session = crate::commands::note_persistence::build_note_session_from_mutation(&outcome);
    let receipt = CommitNoteReviewResult {status:"committed".into(),note_id:session.note_id,
        committed_markdown:Some(session.markdown),commit_warning:session.commit_warning,message:None,
        applied:Some(AppliedNoteChange{kind:if accepted.kind=="create" {"createNote"} else {"updateNote"}.into(),path:session.path,previous_path:None})};
    ledger.execute("UPDATE effects SET receipt=?2 WHERE id=?1",params![key,serde_json::to_string(&receipt).map_err(|e|e.to_string())?]).map_err(|e|e.to_string())?;
    if fault == Some("after-receipt") { std::process::abort(); }
    Ok(receipt)
}
