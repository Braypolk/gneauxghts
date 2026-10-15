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
pub(crate) fn pi_validate_review_checkpoint(app:tauri::AppHandle,markdown:String,title:String,path:String,decisions:Value)->Result<(),String> {
    if title.trim().is_empty() || title.len()>200 || markdown.len()>262144 {return Err("Invalid review draft".into());}
    crate::proposals::canonical_agent_commit_target(app.state::<AppState>().running_vault().root(),std::path::Path::new(&path))?;
    crate::chat::note_proposals::validate_decisions(&decisions,&markdown)
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

#[tauri::command]
pub(crate) async fn pi_resolve_passage(app: tauri::AppHandle, source: ChatSource, access: VaultAccess) -> Result<Value,String> {
    let source=pi_validate_sources(app,vec![source],access).await?.pop().ok_or("Source unavailable")?;
    let citation=source.passage.as_ref().ok_or("Issued passage required")?;
    if citation.historical.is_some() { return Err("Open the retained revision through the history UI".into()); }
    let session=crate::commands::read_note_session_from_path(std::path::Path::new(source.note_path.as_deref().ok_or("Source path unavailable")?))?;
    let selection=if citation.location=="body" {
        session.markdown.get(..citation.start).zip(session.markdown.get(..citation.end))
            .map(|(a,b)|json!({"anchor":a.encode_utf16().count(),"head":b.encode_utf16().count()}))
    } else {None};
    Ok(json!({"source":source,"markdown":session.markdown,"selection":selection}))
}
