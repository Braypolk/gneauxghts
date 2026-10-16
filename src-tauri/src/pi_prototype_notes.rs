//! Domain adapters only: native state holds retrieval cursors/proofs, never chat lifecycle.
use crate::{
    chat::{ChatSource, VaultAccess},
    chat_domain::ChatDomain,
    index::AppState,
    services::evidence::{
        self, check_citation, check_citations, validate_citation, EvidenceSession, PassageCitation,
        ReadRequest, SearchRequest,
    },
};
use serde::Deserialize;
use serde_json::{json, Value};
use std::{
    collections::{HashMap, HashSet},
    sync::{Mutex, OnceLock},
};
use tauri::Manager;
#[path = "pi_prototype_temporal.rs"]
mod temporal;

fn scope(
    service: &ChatDomain,
    access: &VaultAccess,
    grants: &[String],
) -> Result<(Option<HashSet<String>>, HashSet<String>), String> {
    if grants.len() > 128 {
        return Err("Note grant bound exceeded".into());
    }
    let allowed = match access {
        VaultAccess::Full => None,
        VaultAccess::Approved => Some(
            service
                .granted_note_ids()?
                .into_iter()
                .chain(grants.iter().cloned())
                .collect(),
        ),
        VaultAccess::None => Some(grants.iter().cloned().collect()),
    };
    Ok((allowed, service.excluded_note_ids()?))
}

#[derive(Default)]
struct Retrieval {
    evidence: EvidenceSession,
    temporal: Option<temporal::Temporal>,
    context: Vec<PassageCitation>,
    whole_notes: HashMap<String, String>,
    worker: Option<WorkerScope>,
    read_ids: HashSet<String>,
    read_hints: HashMap<String, Value>,
}
struct WorkerScope {
    parent: String,
    ids: HashSet<String>,
    request: SearchRequest,
    period: Option<evidence::query::ResolvedPeriod>,
}
// This is a bounded cache of native retrieval capabilities only. Pi persists the
// authored context, grants, issued sources and decisions; an expired cursor fails.
fn retrievals() -> &'static Mutex<HashMap<String, Retrieval>> {
    static CACHE: OnceLock<Mutex<HashMap<String, Retrieval>>> = OnceLock::new();
    CACHE.get_or_init(Default::default)
}
fn key(state: &AppState, id: &str) -> String {
    format!("{}:{id}", state.running_vault().root().display())
}
fn check(
    state: &AppState,
    session: &Retrieval,
    allowed: Option<&HashSet<String>>,
    excluded: &HashSet<String>,
) -> Result<(), String> {
    let restricted = session.worker.as_ref().map(|worker| worker.ids.iter()
        .filter(|id| allowed.is_none_or(|ids| ids.contains(*id))).cloned().collect::<HashSet<_>>());
    let allowed = restricted.as_ref().or(allowed);
    if !session.evidence.check_current(state, allowed, excluded)
        .map_err(|reason| format!("Evidence validation unavailable: {reason}"))? {
        return Err("Evidence, context or access changed; retry with fresh context".into());
    }
    for citation in &session.context {
        if check_citation(state, citation, allowed, excluded)
            .map_err(|reason| format!("Context validation unavailable: {reason}"))?.is_none() {
            return Err("Evidence, context or access changed; retry with fresh context".into());
        }
    }
    Ok(())
}
fn canonical(
    state: &AppState,
    id: &str,
    allowed: Option<&HashSet<String>>,
    excluded: &HashSet<String>,
) -> Result<(String, String, PassageCitation), String> {
    if excluded.contains(id) || allowed.is_some_and(|a| !a.contains(id)) {
        return Err("Note is excluded or not allowed".into());
    }
    let (path, title) = state
        .notes_index
        .lock()
        .map_err(|_| "Notes index unavailable")?
        .get_note_by_note_id(id)
        .filter(|(_, n)| n.document_kind == crate::note::DocumentKind::Note)
        .map(|(p, n)| (p.clone(), n.title.clone()))
        .ok_or("Note unavailable")?;
    let raw = std::fs::read_to_string(path).map_err(|_| "Note unavailable")?;
    let body = crate::note::parse_note(&raw).body.to_string();
    let citation = PassageCitation {
        id: format!("context:{id}"),
        note_id: id.into(),
        content_hash: evidence::canonical_content_hash(&raw),
        location: "body".into(),
        start: 0,
        end: body.len(),
        excerpt: body.clone(),
        revisions: vec![],
        historical: None,
    };
    validate_citation(state, &citation, allowed, excluded)
        .ok_or("Canonical note changed; retry")?;
    Ok((body, title, citation))
}
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct ContinuityReference { note_id: String, title: String, #[serde(skip)] path: std::path::PathBuf }
impl crate::services::note_timeline::CurrentContentItem for ContinuityReference {
    fn current_note_identity(&self) -> crate::services::note_timeline::CurrentContentIdentity<'_> {
        crate::services::note_timeline::CurrentContentIdentity::Note {note_id:Some(&self.note_id),note_path:self.path.to_str()}
    }
}
fn continuity_references(state:&AppState,note_ids:&[String],allowed:Option<&HashSet<String>>,excluded:&HashSet<String>) -> Result<Vec<ContinuityReference>,String> {
    use std::io::Read;
    if note_ids.len()>16 || note_ids.iter().any(|id|id.is_empty()||id.len()>512){return Err("Continuity reference bound exceeded".into());}
    let timeline=state.note_timeline();
    timeline.current_content(crate::services::note_timeline::AllowedScope::policy(allowed,excluded)).read_refreshable(||{
        let index=state.notes_index.lock().map_err(|_|"Notes index unavailable")?;let mut references=Vec::new();let mut seen=HashSet::new();
        for id in note_ids {
            if !seen.insert(id) || excluded.contains(id)||allowed.is_some_and(|ids|!ids.contains(id)){continue;}
            let Some((path,note))=index.get_note_by_note_id(id).filter(|(_,note)|note.document_kind==crate::note::DocumentKind::Note) else{continue;};
            // Read only a bounded metadata prefix. An index/path hit is never an
            // identity substitute when canonical managed metadata changed.
            let Ok(file)=std::fs::File::open(path) else{continue;};let mut prefix=String::new();
            if file.take(65536).read_to_string(&mut prefix).is_err(){continue;}
            let parsed=crate::note::parse_note(&prefix);
            if !parsed.frontmatter.managed.as_ref().is_some_and(|m|m.id==*id&&m.kind==crate::note::DocumentKind::Note&&m.trashed_at.is_none()){continue;}
            let title=note.title.chars().take(128).collect::<String>();
            references.push(ContinuityReference{note_id:id.clone(),title,path:path.clone()});
        }
        Ok(references)
    })
}
/** Discovery metadata only: no passage, excerpt, path, citation or grant is returned. */
#[tauri::command]
pub(crate) async fn pi_continuity_references(app:tauri::AppHandle,note_ids:Vec<String>,access:VaultAccess,grants:Vec<String>) -> Result<Value,String> {
    tauri::async_runtime::spawn_blocking(move||{
        let (allowed,excluded)=scope(&app.state::<ChatDomain>(),&access,&grants)?;
        let references=continuity_references(&app.state::<AppState>(),&note_ids,allowed.as_ref(),&excluded)?;
        serde_json::to_value(references).map_err(|_|"Continuity references unavailable".into())
    }).await.map_err(|_|"Continuity references unavailable")?
}
fn canonical_raw_hash(
    state: &AppState,
    id: &str,
    allowed: Option<&HashSet<String>>,
    excluded: &HashSet<String>,
) -> Result<String, String> {
    let (_, _, binding) = canonical(state, id, allowed, excluded)?;
    let path = state
        .notes_index
        .lock()
        .map_err(|_| "Notes index unavailable")?
        .get_note_by_note_id(id)
        .map(|(p, _)| p.clone())
        .ok_or("Note unavailable")?;
    let raw = std::fs::read_to_string(path).map_err(|_| "Note unavailable")?;
    if evidence::canonical_content_hash(&raw) != binding.content_hash {
        return Err("Canonical note changed; read it again".into());
    }
    validate_citation(state, &binding, allowed, excluded)
        .ok_or("Canonical note changed; read it again")?;
    Ok(crate::semantic::db::content_hash(&raw))
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ContextInput {
    #[serde(default)]
    selected_context: Vec<Selection>,
    active_note: Option<ActiveHint>,
    expected_context: Option<Vec<Value>>,
    date_time_context: Option<crate::chat::date_time::DateTimeContext>,
    expected_temporal: Option<temporal::Temporal>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Selection {
    note_id: String,
    start_line: Option<usize>,
    end_line: Option<usize>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ActiveHint {
    note_id: Option<String>,
    selection: Option<String>,
}

#[tauri::command]
pub(crate) async fn pi_prepare_evidence(
    app: tauri::AppHandle,
    input: ContextInput,
    access: VaultAccess,
    grants: Option<Vec<String>>,
) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move|| {
        let state=app.state::<AppState>();let service=app.state::<ChatDomain>();
        if input.selected_context.len()>8 {return Err("Include up to eight notes per message".into());}
        if access==VaultAccess::None && !input.selected_context.is_empty() {return Err("Enable vault access before including note context".into());}
        let mut grants=grants.unwrap_or_default();
        for item in &input.selected_context {if !grants.contains(&item.note_id){grants.push(item.note_id.clone());}}
        let (allowed,excluded)=scope(&service,&access,&grants)?;
        let temporal=temporal::Temporal::admit(input.date_time_context,input.expected_temporal,chrono::Utc::now())?;
        let prepared_temporal=temporal.prepared()?;
        let mut session=Retrieval::default();session.evidence.anchor=temporal.anchor()?;session.temporal=Some(temporal);
        let mut context=Vec::new();
        for item in &input.selected_context {
            let (body,title,binding)=canonical(&state,&item.note_id,allowed.as_ref(),&excluded)?;
            let (start,end)=selected_range(&body,item.start_line,item.end_line)?;
            let excerpt=&body[start..end];
            let selector=session.evidence.register_body_selection(&state,&item.note_id,excerpt,Some(start)).map_err(|e|e.to_string())?;
            let shown=session.evidence.admit_context(excerpt,2400).map_err(|e|e.to_string())?;
            let metadata=json!({"kind":"selected_excerpt","contentHash":binding.content_hash,"noteId":item.note_id,"title":evidence::bounded(&title,256),"excerpt":shown,
                "complete":shown==excerpt,"read":selector,"wholeNoteRead":{"note_id":item.note_id},
                "meaning":"Canonical selected context; registration is not a citable read. For excerpt-only requests use the exact read selector; other whole-note facts remain unknown."});
            session.evidence.admit_context(&metadata.to_string(),metadata.to_string().len()).map_err(|e|e.to_string())?;
            context.push(metadata);session.context.push(binding);
        }
        if let Some(hint)=input.active_note {
            if let Some(id)=hint.note_id.filter(|id|!excluded.contains(id)&&allowed.as_ref().is_none_or(|a|a.contains(id))) {
                // Ignore supplied working body, title, path and hash entirely.
                let (body,title,binding)=canonical(&state,&id,allowed.as_ref(),&excluded)?;
                let mut metadata=json!({"kind":"adjacent_editor_hint","contentHash":binding.content_hash,"noteId":id,"title":evidence::bounded(&title,256),
                    "meaning":"Adjacent canonical note identity is a relevance hint, not read evidence. Unsaved and pending proposal text is unavailable as evidence."});
                if let Some(selection)=hint.selection.filter(|s|!s.trim().is_empty()) {
                    match session.evidence.register_body_selection(&state,&id,&selection,None) {
                        Ok(selector)=> {metadata["selection"]=json!(evidence::bounded(&selection,480));metadata["selectionRead"]=selector;metadata["selectionComplete"]=json!(selection.len()<=480);},
                        Err(_)=> {metadata["selectionUnavailable"]=json!(true);metadata["meaning"]=json!("Adjacent note hint only. The selected working text has no exact canonical range; do not substitute a whole-note read for an excerpt-only request.");}
                    }
                }
                let _=body;session.evidence.admit_context(&metadata.to_string(),metadata.to_string().len()).map_err(|e|e.to_string())?;
                context.push(metadata);session.context.push(binding);
            }
        }
        if let Some(expected)=input.expected_context {
            for previous in expected {
                let id=previous["noteId"].as_str().ok_or("Stored context identity unavailable")?;
                let current=session.context.iter().find(|c|c.note_id==id).ok_or("Original context is no longer allowed")?;
                if previous["contentHash"].as_str()!=Some(current.content_hash.as_str()) {return Err("Original context changed; start a fresh message".into());}
            }
        }
        check(&state,&session,allowed.as_ref(),&excluded)?;
        let id=crate::note::generate_unique_id();let mut cache=retrievals().lock().map_err(|_|"Evidence cache unavailable")?;
        if cache.len()>=128 {return Err("Native evidence cursor capacity reached; close an active request".into());}
        cache.insert(key(&state,&id),session);
        Ok(json!({"sessionId":id,"context":context,"grants":grants,"selectedNoteIds":input.selected_context.iter().map(|s|&s.note_id).collect::<Vec<_>>(),"temporal":prepared_temporal}))
    }).await.map_err(|e|e.to_string())?
}
fn selected_range(
    body: &str,
    start: Option<usize>,
    end: Option<usize>,
) -> Result<(usize, usize), String> {
    let start = start.unwrap_or(1);
    let end = end.unwrap_or_else(|| body.lines().count());
    if start == 0 || end < start {
        return Err("Selected line range is invalid".into());
    }
    let mut from = 0;
    let mut to = 0;
    let mut found = false;
    for (index, line) in body.split_inclusive('\n').enumerate() {
        if index + 1 < start {
            from += line.len();
        }
        if index + 1 <= end {
            to += line.len();
        }
        if index + 1 == start {
            found = true;
        }
    }
    if !found || body[from..to].trim().is_empty() {
        return Err("Selected canonical range is unavailable".into());
    }
    if to - from > 12000 {
        return Err("Selected range exceeds 12000 bytes; select a smaller range".into());
    }
    Ok((from, to))
}

#[tauri::command]
pub(crate) async fn pi_release_evidence(
    app: tauri::AppHandle,
    session_id: String,
) -> Result<(), String> {
    let mut cache = retrievals().lock().map_err(|_| "Evidence cache unavailable")?;
    let state = app.state::<AppState>();
    cache.retain(|_, session| session.worker.as_ref().is_none_or(|w| w.parent != session_id));
    cache.remove(&key(&state, &session_id));
    Ok(())
}
#[tauri::command]
pub(crate) async fn pi_validate_evidence(
    app: tauri::AppHandle,
    session_id: String,
    access: VaultAccess,
    grants: Option<Vec<String>>,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        let (allowed, excluded) = scope(
            &app.state::<ChatDomain>(),
            &access,
            &grants.unwrap_or_default(),
        )?;
        let cache = retrievals()
            .lock()
            .map_err(|_| "Evidence cache unavailable")?;
        let session = cache
            .get(&key(&state, &session_id))
            .ok_or("Evidence cursor expired after restart; Retry explicitly")?;
        check(&state, session, allowed.as_ref(), &excluded)
    })
    .await
    .map_err(|e| e.to_string())?
}
fn sources(
    state: &AppState,
    passages: Vec<(PassageCitation, std::path::PathBuf, String)>,
    allowed: Option<&HashSet<String>>,
    excluded: &HashSet<String>,
) -> Result<Vec<ChatSource>, String> {
    passages
        .into_iter()
        .map(|(citation, _, _)| {
            let (path, title) = validate_citation(state, &citation, allowed, excluded)
                .ok_or("Evidence changed before delivery; read again")?;
            Ok(ChatSource {
                kind: "passage".into(),
                note_id: Some(citation.note_id.clone()),
                note_path: Some(path.to_string_lossy().into()),
                title,
                excerpt: citation.excerpt.clone(),
                url: None,
                anchor: Some(citation.id.clone()),
                revision: None,
                passage: Some(citation),
            })
        })
        .collect()
}

fn restrict_worker_range(request: &mut SearchRequest, inherited: &SearchRequest) -> Result<(), String> {
    if inherited.after.is_some_and(|n| request.after.is_some_and(|v| v < n))
        || inherited.before.is_some_and(|n| request.before.is_some_and(|v| v > n)) {
        return Err("Research query exceeds its inherited activity range".into());
    }
    request.after = request.after.or(inherited.after);
    request.before = request.before.or(inherited.before);
    request.range_timezone = request.range_timezone.clone().or(inherited.range_timezone.clone());
    request.include_history |= inherited.include_history;
    request.folder = request.folder.clone().or(inherited.folder.clone());
    Ok(())
}

pub(crate) fn begin_research(state: &AppState, service: &ChatDomain, parent_id: &str,
    worker_id: &str, mut request: SearchRequest, access: &VaultAccess, grants: &[String]) -> Result<Value, String> {
    let (allowed, excluded) = scope(service, access, grants)?;
    let mut cache = retrievals().lock().map_err(|_| "Evidence cache unavailable")?;
    if cache.values().any(|s| s.worker.as_ref().is_some_and(|w| w.parent == parent_id)) {
        return Err("Another research worker is active".into());
    }
    if worker_id == parent_id || cache.contains_key(&key(state, worker_id)) { return Err("Research invocation already exists".into()); }
    let parent = cache.get(&key(state, parent_id)).ok_or("Parent evidence expired; Retry explicitly")?;
    if parent.worker.is_some() { return Err("Research workers cannot delegate".into()); }
    check(state, parent, allowed.as_ref(), &excluded)?;
    let range = request.activity_range.clone();
    let period = parent.evidence.normalize_request(&mut request).map_err(|e| e.to_string())?;
    let ids = evidence::scope_ids(state, allowed.as_ref(), &excluded, &request).map_err(|e| e.to_string())?;
    let anchor = parent.evidence.anchor.label();
    let temporal = parent.temporal.clone();
    let prepared_temporal = temporal.as_ref().map(|value|value.prepared()).transpose()?;
    let child = parent.evidence.fork_for_period(period.is_some());
    let hints: Vec<Value> = if period.is_some() { vec![] } else { parent.read_hints.values()
        .filter(|hint|hint["noteId"].as_str().is_some_and(|id|ids.contains(id))).take(8).cloned().collect() };
    let scope_note_count = ids.len();
    let prompt_scope = json!({"note_ids":request.note_ids,"folder":request.folder,"activity_range":range,"include_history":request.include_history});
    request.activity_range = range;
    cache.insert(key(state, worker_id), Retrieval { evidence: child, temporal,
        worker: Some(WorkerScope { parent: parent_id.into(), ids, request, period }), ..Default::default() });
    Ok(json!({"sessionId":worker_id,"scope":prompt_scope,"referenceInstant":anchor,"temporal":prepared_temporal,"discoveryHints":hints,"scopeNoteCount":scope_note_count}))
}

pub(crate) fn finish_research(state: &AppState, service: &ChatDomain, parent_id: &str,
    worker_id: &str, selection: crate::pi_prototype_research::Selection, access: &VaultAccess, grants: &[String]) -> Result<Value, String> {
    selection.validate()?;
    let (allowed, excluded) = scope(service, access, grants)?;
    let mut cache = retrievals().lock().map_err(|_| "Evidence cache unavailable")?;
    // Remove on every terminal handoff, including validation failure. It never owns a grant.
    let worker = cache.remove(&key(state, worker_id)).ok_or("Research evidence expired; Retry explicitly")?;
    let binding = worker.worker.as_ref().ok_or("Not a research worker")?;
    if binding.parent != parent_id { return Err("Research belongs to another request".into()); }
    let restricted: HashSet<_> = binding.ids.iter().filter(|id| allowed.as_ref().is_none_or(|a| a.contains(*id))).cloned().collect();
    check(state, &worker, Some(&restricted), &excluded)?;
    if selection.evidence_ids.iter().any(|id| !worker.read_ids.contains(id)) { return Err("Research selected unknown or unread evidence".into()); }
    let parent = cache.get_mut(&key(state, parent_id)).ok_or("Parent evidence expired; Retry explicitly")?;
    check(state, parent, allowed.as_ref(), &excluded)?;
    parent.evidence.accept_selected(&worker.evidence, &selection.evidence_ids, &[]);
    let (payload, passages) = parent.evidence.read_research(state, Some(&restricted), &excluded,
        &selection.evidence_ids, binding.period.clone(), selection.gaps).map_err(|e| e.to_string())?;
    let admitted = sources(state, passages, allowed.as_ref(), &excluded)?;
    parent.evidence.record_delivery(&admitted.iter().filter_map(|s|s.passage.clone()).collect::<Vec<_>>());
    check(state, parent, allowed.as_ref(), &excluded)?;
    Ok(json!({"payload":payload,"sources":admitted}))
}

pub(crate) fn release_research(state: &AppState, parent_id: &str, worker_id: &str) -> Result<(), String> {
    let mut cache = retrievals().lock().map_err(|_| "Evidence cache unavailable")?;
    let entry = key(state, worker_id);
    if cache.get(&entry).is_some_and(|s|s.worker.as_ref().is_some_and(|w|w.parent == parent_id)) {cache.remove(&entry);}
    Ok(())
}
pub(crate) fn enable_adaptive_evidence(state: &AppState, service: &ChatDomain, session_id: &str,
    access: &VaultAccess, grants: &[String]) -> Result<(), String> {
    let (allowed, excluded) = scope(service, access, grants)?;
    let cache = retrievals().lock().map_err(|_| "Evidence cache unavailable")?;
    let session = cache.get(&key(state, session_id)).ok_or("Evidence expired; Retry explicitly")?;
    if session.worker.is_some() {return Err("Workers cannot renew the parent's evidence allowance".into());}
    check(state, session, allowed.as_ref(), &excluded)?;
    // Per-envelope reads stay bounded. Rolling context replaces cumulative quotas.
    session.evidence.configure_allowance(Some(usize::MAX));
    Ok(())
}
#[tauri::command]
pub(crate) async fn pi_evidence_operation(
    app: tauri::AppHandle,
    session_id: String,
    operation: String,
    request: Value,
    access: VaultAccess,
    grants: Option<Vec<String>>,
) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        let (mut allowed, excluded) = scope(
            &app.state::<ChatDomain>(),
            &access,
            &grants.unwrap_or_default(),
        )?;
        let mut cache = retrievals()
            .lock()
            .map_err(|_| "Evidence cache unavailable")?;
        let session = cache
            .get_mut(&key(&state, &session_id))
            .ok_or("Evidence cursor expired after restart; Retry explicitly")?;
        if let Some(worker) = &session.worker {
            allowed = Some(worker.ids.iter().filter(|id| allowed.as_ref().is_none_or(|a| a.contains(*id))).cloned().collect());
        }
        check(&state, session, allowed.as_ref(), &excluded)?;
        let (payload, passages) = match operation.as_str() {
            "read" => {
                let mut request = serde_json::from_value::<ReadRequest>(request).map_err(|e| e.to_string())?;
                if let Some(worker) = &session.worker {
                    if request.cursor.is_none() {
                        request.activity_range = request.activity_range.or(worker.request.activity_range.clone());
                        let mut bounds = SearchRequest { activity_range: request.activity_range.clone(), ..Default::default() };
                        session.evidence.normalize_request(&mut bounds).map_err(|e| e.to_string())?;
                        restrict_worker_range(&mut bounds, &worker.request)?;
                    }
                }
                session.evidence.read_request(
                    &state,
                    allowed.as_ref(),
                    &excluded,
                    request,
                )
                .map_err(|e| e.to_string())?
            },
            "search" | "activity" => {
                let mut request =
                    serde_json::from_value::<SearchRequest>(request).map_err(|e| e.to_string())?;
                if let Some(cursor) = request.cursor.clone() {
                    request = session
                        .evidence
                        .resume_search(&cursor, operation == "activity")
                        .map_err(|e| e.to_string())?;
                } else if let Some(worker) = &session.worker {
                    session.evidence.normalize_request(&mut request).map_err(|e| e.to_string())?;
                    restrict_worker_range(&mut request, &worker.request)?;
                }
                let payload = if operation == "activity" {
                    let range = session
                        .evidence
                        .normalize_request(&mut request)
                        .map_err(|e| e.to_string())?;
                    let resolved = range
                        .or_else(|| {
                            request.after.zip(request.before).map(|(after, before)| {
                                evidence::query::ResolvedPeriod {
                                    after,
                                    before,
                                    timezone: request.range_timezone.clone().unwrap_or_else(|| {
                                        session.evidence.anchor.timezone.clone()
                                    }),
                                    label: "Retained activity interval".into(),
                                }
                            })
                        })
                        .ok_or("Activity requires an explicit start/end range")?;
                    session
                        .evidence
                        .activity_page(
                            &state,
                            allowed.as_ref(),
                            &excluded,
                            request.clone(),
                            resolved,
                        )
                        .map_err(|e| e.to_string())?
                } else {
                    session
                        .evidence
                        .search(&state, allowed.as_ref(), &excluded, request.clone())
                        .map_err(|e| e.to_string())?
                };
                session
                    .evidence
                    .remember_search(&payload, request, operation == "activity");
                (payload, vec![])
            }
            _ => return Err("Unsupported evidence operation".into()),
        };
        check(&state, session, allowed.as_ref(), &excluded)?;
        let admitted = sources(&state, passages, allowed.as_ref(), &excluded)?;
        session.read_ids.extend(admitted.iter().filter_map(|s| s.passage.as_ref().map(|p| p.id.clone())));
        for source in &admitted {if let Some(passage)=&source.passage {session.read_hints.insert(passage.id.clone(),
            json!({"evidenceId":passage.id,"noteId":passage.note_id,"title":evidence::bounded(&source.title,256)}));}}
        if payload["coverage"]["wholeNoteComplete"] == true {
            if let Some(id) = payload["coverage"]["noteId"].as_str() {
                let raw_hash = canonical_raw_hash(&state, id, allowed.as_ref(), &excluded)?;
                check(&state, session, allowed.as_ref(), &excluded)?;
                session.whole_notes.insert(id.into(), raw_hash);
            }
        }
        session.evidence.record_delivery(
            &admitted
                .iter()
                .filter_map(|s| s.passage.clone())
                .collect::<Vec<_>>(),
        );
        Ok(json!({"payload":payload,"sources":admitted}))
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
pub(crate) async fn pi_validate_proposal_evidence(
    app: tauri::AppHandle,
    session_id: String,
    note_id: String,
    access: VaultAccess,
    grants: Option<Vec<String>>,
) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        let (allowed, excluded) = scope(
            &app.state::<ChatDomain>(),
            &access,
            &grants.unwrap_or_default(),
        )?;
        let cache = retrievals()
            .lock()
            .map_err(|_| "Evidence cache unavailable")?;
        let session = cache
            .get(&key(&state, &session_id))
            .ok_or("Canonical read expired; read the target again")?;
        check(&state, session, allowed.as_ref(), &excluded)?;
        let base_hash = session
            .whole_notes
            .get(&note_id)
            .ok_or("A complete current canonical note read is required before replacement")?;
        if &canonical_raw_hash(&state, &note_id, allowed.as_ref(), &excluded)? != base_hash {
            return Err("Canonical replacement target changed; read it again".into());
        }
        check(&state, session, allowed.as_ref(), &excluded)?;
        Ok(json!({"baseHash":base_hash}))
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
pub(crate) async fn pi_discover_notes(
    app: tauri::AppHandle,
    query: String,
    note_id: Option<String>,
) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move|| {
        if query.len()>1024 {return Err("Discovery query exceeds 1024 bytes".into());}
        let excluded=app.state::<ChatDomain>().excluded_note_ids()?;let state=app.state::<AppState>();
        let index=state.notes_index.lock().map_err(|_|"Notes index unavailable")?;let query=query.to_lowercase();
        let mut items=index.entries.values().filter(|n|n.document_kind==crate::note::DocumentKind::Note&&!excluded.contains(&n.note_id)&&note_id.as_ref().is_none_or(|id|id==&n.note_id)&&n.title.to_lowercase().contains(&query))
            .map(|n|json!({"noteId":n.note_id,"title":evidence::bounded(&n.title,256)})).collect::<Vec<_>>();
        items.sort_by_key(|v|v["title"].as_str().unwrap_or_default().to_string());let has_more=items.len()>20;items.truncate(20);
        Ok(json!({"items":items,"hasMore":has_more,"coverage":{"kind":"canonical_title_discovery","bodySearch":"unavailable_without_access"},"meaning":"Names only; these are not read evidence. Request access before canonical reads."}))
    }).await.map_err(|e|e.to_string())?
}

#[tauri::command]
pub(crate) fn pi_validate_review_checkpoint(
    app: tauri::AppHandle,
    markdown: String,
    title: String,
    path: String,
    decisions: Value,
) -> Result<(), String> {
    if title.trim().is_empty() || title.len() > 200 || markdown.len() > 262144 {
        return Err("Invalid review draft".into());
    }
    crate::proposals::canonical_agent_commit_target(
        app.state::<AppState>().running_vault().root(),
        std::path::Path::new(&path),
    )?;
    crate::chat::note_proposals::validate_decisions(&decisions, &markdown)
}
#[tauri::command]
pub(crate) async fn pi_admit_answer(
    app: tauri::AppHandle,
    raw: String,
    sources: Vec<ChatSource>,
    access: VaultAccess,
    grants: Option<Vec<String>>,
    structured: Option<bool>,
) -> Result<Value, String> {
    let sources = pi_validate_sources(app, sources, access, grants).await?;
    let mut references = crate::chat::citations::PassageReferences::default();
    if structured == Some(false) {
        if !sources.is_empty() {
            return Err("Note evidence requires structured answer admission".into());
        }
        if raw.trim().is_empty() || raw.len() > 262144 {
            return Err("Invalid plain answer".into());
        }
        if references.render(&raw, &[]) != raw {
            return Err("Unissued note citation in plain answer".into());
        }
        return Ok(json!({"text":raw,"sources":[],"associations":[]}));
    }
    for source in &sources {
        references.register(&source.passage.as_ref().ok_or("Issued passage required")?.id);
    }
    let (text, selected, associations) =
        crate::chat::structured_answer::render_with_associations(&raw, &references, &sources)?;
    Ok(json!({"text":text,"sources":selected,"associations":associations}))
}
// Compatibility for the original canonical-read fixture. New tools use the
// request-scoped operation so cursors, aggregate allowance and proofs survive.
#[tauri::command]
pub(crate) async fn pi_read_note(
    app: tauri::AppHandle,
    note_id: String,
    access: VaultAccess,
    grants: Option<Vec<String>>,
) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move|| {
        let state=app.state::<AppState>();let (allowed,excluded)=scope(&app.state::<ChatDomain>(),&access,&grants.unwrap_or_default())?;
        let mut evidence=EvidenceSession::default();let (payload,passages)=evidence.read_request(&state,allowed.as_ref(),&excluded,ReadRequest {note_id:Some(note_id),..Default::default()}).map_err(|e|e.to_string())?;
        Ok(json!({"payload":payload,"sources":sources(&state,passages,allowed.as_ref(),&excluded)?}))
    }).await.map_err(|e|e.to_string())?
}
#[tauri::command]
pub(crate) async fn pi_validate_sources(
    app: tauri::AppHandle,
    sources: Vec<ChatSource>,
    access: VaultAccess,
    grants: Option<Vec<String>>,
) -> Result<Vec<ChatSource>, String> {
    if sources.len() > 128 {
        return Err("Evidence bound exceeded".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        let (allowed, excluded) = scope(
            &app.state::<ChatDomain>(),
            &access,
            &grants.unwrap_or_default(),
        )?;
        validate_source_batch(&state, sources, allowed.as_ref(), &excluded)
    })
    .await
    .map_err(|e| e.to_string())?
}

pub(crate) fn validate_source_batch(
    state: &AppState,
    sources: Vec<ChatSource>,
    allowed: Option<&HashSet<String>>,
    excluded: &HashSet<String>,
) -> Result<Vec<ChatSource>, String> {
    if sources.len() > 128 {
        return Err("Evidence bound exceeded".into());
    }
    let citations = sources
        .iter()
        .map(|source| {
            let citation = source.passage.as_ref().ok_or("Issued passage required")?;
            if source.excerpt != citation.excerpt
                || source.note_id.as_deref() != Some(citation.note_id.as_str())
            {
                return Err("Evidence binding mismatch");
            }
            Ok(citation)
        })
        .collect::<Result<Vec<_>, &str>>()?;
    let bindings = check_citations(state, &citations, allowed, excluded)
        .map_err(|reason| format!("Evidence validation unavailable: {reason}"))?
        .ok_or("Evidence or access changed; read again")?;
    if bindings.len() != sources.len() {
        return Err("Evidence or access changed; read again".into());
    }
    // Publish refreshed destinations only after the complete, ordered source
    // set passed canonical, proof and scope validation at one generation.
    Ok(sources
        .into_iter()
        .zip(bindings)
        .map(|(mut source, (path, title))| {
            source.note_path = Some(path.to_string_lossy().into());
            source.title = title;
            source
        })
        .collect())
}
#[tauri::command]
pub(crate) async fn pi_resolve_passage(
    app: tauri::AppHandle,
    source: ChatSource,
    access: VaultAccess,
    grants: Option<Vec<String>>,
) -> Result<Value, String> {
    let source = pi_validate_sources(app, vec![source], access, grants)
        .await?
        .pop()
        .ok_or("Source unavailable")?;
    let citation = source.passage.as_ref().ok_or("Issued passage required")?;
    if let Some(proof) = &citation.historical {
        return Ok(
            json!({"source":source,"markdown":"","selection":null,"historicalRevisionId":proof.content_revision_id}),
        );
    }
    let raw = std::fs::read_to_string(
        source
            .note_path
            .as_deref()
            .ok_or("Source path unavailable")?,
    )
    .map_err(|_| "Note unavailable")?;
    if evidence::canonical_content_hash(&raw) != citation.content_hash {
        return Err("Passage changed before navigation".into());
    }
    let (markdown, selection) = evidence::editor_passage_navigation(&raw, &source.title, citation);
    Ok(json!({"source":source,"markdown":markdown,"selection":selection}))
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn evidence_check_distinguishes_unsettled_reads_from_changed_passages() {
        let vault = crate::test_support::TestVault::new("pi-evidence-validation-reason");
        let saved = crate::test_support::save_and_finalize(
            &vault.state, "Stable source".into(), "Canonical evidence".into(), None,
        ).unwrap().unwrap();
        let id = saved.note_id.unwrap();
        let excluded = HashSet::new();
        let mut session = Retrieval::default();
        let (_, passages) = session.evidence.read_request(&vault.state, None, &excluded,
            ReadRequest { note_id: Some(id), ..Default::default() }).unwrap();
        session.evidence.record_delivery(&passages.into_iter().map(|(citation, _, _)| citation).collect::<Vec<_>>());
        assert!(check(&vault.state, &session, None, &excluded).is_ok());
        let mutation = crate::services::note_timeline::hold_current_content_mutation_for_test(&vault.state);
        assert_eq!(check(&vault.state, &session, None, &excluded).unwrap_err(),
            "Evidence validation unavailable: Current notes are still updating; retry the read");
        drop(mutation);
        assert!(check(&vault.state, &session, None, &excluded).is_ok());
        let path = saved.path.unwrap();
        let raw = std::fs::read_to_string(&path).unwrap();
        std::fs::write(path, raw.replace("Canonical evidence", "Changed evidence")).unwrap();
        assert_eq!(check(&vault.state, &session, None, &excluded).unwrap_err(),
            "Evidence, context or access changed; retry with fresh context");
    }

    #[test]
    fn context_check_distinguishes_unsettled_reads_from_changed_context() {
        let vault = crate::test_support::TestVault::new("pi-context-validation-reason");
        let saved = crate::test_support::save_and_finalize(
            &vault.state, "Adjacent source".into(), "Canonical context".into(), None,
        ).unwrap().unwrap();
        let excluded = HashSet::new();
        let (_, _, citation) = canonical(&vault.state, &saved.note_id.unwrap(), None, &excluded).unwrap();
        let session = Retrieval { context: vec![citation], ..Default::default() };
        let mutation = crate::services::note_timeline::hold_current_content_mutation_for_test(&vault.state);
        assert_eq!(check(&vault.state, &session, None, &excluded).unwrap_err(),
            "Context validation unavailable: Current notes are still updating; retry the read");
        drop(mutation);
        assert!(check(&vault.state, &session, None, &excluded).is_ok());
        let path = saved.path.unwrap();
        let raw = std::fs::read_to_string(&path).unwrap();
        std::fs::write(path, raw.replace("Canonical context", "Changed context")).unwrap();
        assert_eq!(check(&vault.state, &session, None, &excluded).unwrap_err(),
            "Evidence, context or access changed; retry with fresh context");
    }
    #[test]
    fn continuity_is_current_identity_metadata_without_source_or_permission_authority() {
        let vault=crate::test_support::TestVault::new("pi-continuity");
        let note=crate::test_support::save_and_finalize(&vault.state,"Private Identity".into(),"Old secret excerpt must never be returned".into(),None).unwrap().unwrap();
        let id=note.note_id.unwrap();let ids=vec![id.clone()];let empty=HashSet::new();
        let references=continuity_references(&vault.state,&ids,None,&empty).unwrap();
        let value=serde_json::to_value(references).unwrap();
        assert_eq!(value,json!([{"noteId":id,"title":"Private Identity"}]));
        assert!(continuity_references(&vault.state,&ids,Some(&empty),&empty).unwrap().is_empty());
        assert!(continuity_references(&vault.state,&ids,None,&HashSet::from([id.clone()])).unwrap().is_empty());
        let path=vault.state.notes_index.lock().unwrap().get_note_by_note_id(&id).unwrap().0.clone();
        let raw=std::fs::read_to_string(&path).unwrap();
        std::fs::write(&path,raw.replace(&id,"another-canonical-identity")).unwrap();
        assert!(continuity_references(&vault.state,&ids,None,&empty).unwrap().is_empty());
        assert!(continuity_references(&vault.state,&vec![id;17],None,&empty).is_err());
    }
    #[test]
    fn research_inherits_period_and_cannot_widen_it() {
        let parent = SearchRequest { after: Some(100), before: Some(200), include_history: true,
            folder: Some("Work".into()), ..Default::default() };
        let mut omitted = SearchRequest::default();
        restrict_worker_range(&mut omitted, &parent).unwrap();
        assert_eq!(omitted.after, Some(100));assert_eq!(omitted.before, Some(200));
        assert_eq!(omitted.folder.as_deref(), Some("Work"));assert!(omitted.include_history);
        for (after, before) in [(Some(99), None), (None, Some(201))] {
            let mut wider = SearchRequest { after, before, ..Default::default() };
            assert!(restrict_worker_range(&mut wider, &parent).is_err());
        }
        let mut narrower = SearchRequest { after: Some(110), before: Some(190), ..Default::default() };
        restrict_worker_range(&mut narrower, &parent).unwrap();
        assert_eq!((narrower.after, narrower.before), (Some(110), Some(190)));
    }
    #[test]
    fn selected_ranges_preserve_empty_lines_and_exact_occurrences() {
        let body = "first\n\nsame\n\nsame\n";
        let (start, end) = selected_range(body, Some(2), Some(3)).unwrap();
        assert_eq!(&body[start..end], "\nsame\n");
        let (start, end) = selected_range(body, Some(5), Some(5)).unwrap();
        assert_eq!(&body[start..end], "same\n");
        assert!(selected_range(body, Some(0), Some(2)).is_err());
        assert!(selected_range(body, Some(7), None).is_err());
    }
}
