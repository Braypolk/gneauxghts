//! Domain adapters only: no chat sessions, runs, or approval state are stored here.
use crate::{chat::{ChatService, ChatSource, VaultAccess}, index::AppState,
    services::evidence::{EvidenceSession, ReadRequest, validate_citation}};
use serde_json::{json, Value};
use std::collections::HashSet;
use tauri::Manager;

fn scope(service: &ChatService, access: &VaultAccess) -> Result<(Option<HashSet<String>>, HashSet<String>), String> {
    Ok((match access {
        VaultAccess::Full => None,
        VaultAccess::Approved => Some(service.granted_note_ids()?),
        VaultAccess::None => Some(HashSet::new()),
    }, service.excluded_note_ids()?))
}

#[tauri::command]
pub(crate) async fn pi_admit_answer(app: tauri::AppHandle, raw: String, sources: Vec<ChatSource>, access: VaultAccess) -> Result<Value, String> {
    let sources = pi_validate_sources(app, sources, access).await?;
    let mut references = crate::chat::citations::PassageReferences::default();
    for source in &sources {
        references.register(&source.passage.as_ref().ok_or("Issued passage required")?.id);
    }
    let (text, selected, associations) = crate::chat::structured_answer::render_with_associations(&raw, &references, &sources)?;
    Ok(json!({"text":text,"sources":selected,"associations":associations}))
}

#[tauri::command]
pub(crate) async fn pi_read_note(app: tauri::AppHandle, note_id: String, access: VaultAccess) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        let service = app.state::<ChatService>();
        let (allowed, excluded) = scope(&service, &access)?;
        let mut evidence = EvidenceSession::default();
        let (payload, passages) = evidence.read_request(&state, allowed.as_ref(), &excluded,
            ReadRequest { note_id: Some(note_id), ..Default::default() }).map_err(|e| e.to_string())?;
        let mut sources = Vec::new();
        for (citation, path, title) in passages {
            if validate_citation(&state, &citation, allowed.as_ref(), &excluded).is_none() {
                return Err("Evidence changed before delivery; read again".to_string());
            }
            sources.push(ChatSource { kind: "passage".into(), note_id: Some(citation.note_id.clone()),
                note_path: Some(path.to_string_lossy().into()), title, excerpt: citation.excerpt.clone(),
                url: None, anchor: Some(citation.id.clone()), revision: None, passage: Some(citation) });
        }
        Ok(json!({"payload":payload,"sources":sources}))
    }).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub(crate) async fn pi_validate_sources(app: tauri::AppHandle, sources: Vec<ChatSource>, access: VaultAccess) -> Result<Vec<ChatSource>, String> {
    if sources.len() > 128 { return Err("Evidence bound exceeded".into()); }
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        let (allowed, excluded) = scope(&app.state::<ChatService>(), &access)?;
        sources.into_iter().map(|mut source| {
            let citation = source.passage.as_ref().ok_or("Issued passage required")?;
            let (path, title) = validate_citation(&state, citation, allowed.as_ref(), &excluded)
                .ok_or("Evidence or access changed; read again")?;
            if source.excerpt != citation.excerpt || source.note_id.as_deref() != Some(&citation.note_id) {
                return Err("Evidence binding mismatch".into());
            }
            source.note_path = Some(path.to_string_lossy().into()); source.title = title;
            Ok(source)
        }).collect()
    }).await.map_err(|e| e.to_string())?
}
