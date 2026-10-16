//! Native effect intents/receipts. Pi alone owns pending reviews and decisions.
use crate::chat_domain::ChatDomain;
use crate::{
    chat::VaultAccess,
    index::AppState,
    proposals::{self, AppliedNoteChange, CommitNoteReviewResult},
    services::note_timeline::{HistoryError, NoteIdentity, PrototypePublicationProof},
};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{fs, path::PathBuf, sync::Mutex};
use tauri::Manager;

static PUBLICATION: Mutex<()> = Mutex::new(());

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct Accepted {
    id: String,
    version: u64,
    kind: String,
    note_id: Option<String>,
    path: String,
    #[serde(default)]
    source_path: Option<String>,
    title: String,
    markdown: String,
    base_hash: Option<String>,
    access: VaultAccess,
    #[serde(default)]
    grants: Vec<String>,
    #[serde(default)]
    promotion: Option<Value>,
}

pub(crate) fn require_access(
    service: &ChatDomain,
    access: &VaultAccess,
    note_id: Option<&str>,
    grants: &[String],
) -> Result<(), String> {
    if grants.len() > 128 {
        return Err("Note grant bound exceeded".into());
    }
    if let Some(id) = note_id {
        if service.excluded_note_ids()?.contains(id)
            || (*access != VaultAccess::Full
                && !grants.iter().any(|grant| grant == id)
                && (*access != VaultAccess::Approved || !service.granted_note_ids()?.contains(id)))
        {
            return Err("Note access changed; review its access again".into());
        }
    }
    Ok(())
}

#[tauri::command]
pub(crate) async fn pi_prepare_review(
    app: tauri::AppHandle,
    title: String,
    markdown: String,
    note_id: Option<String>,
    access: VaultAccess,
    path: Option<String>,
    grants: Option<Vec<String>>,
) -> Result<Value, String> {
    if markdown.len() > 262144 || title.len() > 200 || title.trim().is_empty() {
        return Err("Review exceeds prototype bounds".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        require_access(&app.state::<ChatDomain>(), &access, note_id.as_deref(),grants.as_deref().unwrap_or(&[]))?;
        let root = state.running_vault().root();
        let prepared = if let Some(id) = note_id {
            let source = crate::state::resolve_note_path_by_id(root, &id)?.ok_or("Target note unavailable")?;
            let raw=fs::read_to_string(&source).map_err(|e|e.to_string())?;
            crate::note::reject_chat_projection_write(&raw)?;
            let fallback=source.file_stem().unwrap_or_default().to_string_lossy();
            let (_,base)=crate::note::extract_file_name_title_and_body(&raw,&fallback);
            let markdown=crate::note::normalize_wikilink_markdown(&markdown);
            crate::note::reject_chat_projection_write(&markdown)?;
            let base_hash=crate::semantic::db::content_hash(&raw);
            let target=review_target(root,&source,&title,&markdown,path.as_deref())?;
            let preview=proposals::ProposalPreview{review_id:crate::semantic::db::content_hash(&format!("{}\0{}\0{}",source.display(),base_hash,markdown)),
                note_path:source.to_string_lossy().into_owned(),title:title.clone(),base_content_hash:base_hash.clone(),
                base_editor_markdown:base.clone(),proposed_editor_markdown:markdown.clone(),hunks:proposals::diff_preview_hunks(&base,&markdown)};
            json!({"kind":"update","noteId":id,"title":title,"baseHash":base_hash,
                "suggestedPath":target,"preview":preview,"payload":{"markdown":markdown,"title":title}})
        } else {
            let mut preview = proposals::preview_note_creation(root, &title, &markdown)?;
            if let Some(path) = path { preview.suggested_path = proposals::canonical_agent_commit_target(root, &PathBuf::from(path))?.to_string_lossy().into(); }
            json!({"kind":"create","noteId":null,"title":title,"baseHash":null,
                "suggestedPath":preview.suggested_path,"preview":preview,"payload":{"markdown":markdown,"title":title}})
        };
        if let Some(scope) = crate::pi_prototype_faults::armed("prepared-review", prepared["title"].as_str().unwrap_or("")) {
            crate::pi_prototype_faults::crash("prepared-review", &scope, json!({"prepared":true,"toolReplyDelivered":false,"kind":prepared["kind"]}))?;
        }
        Ok(prepared)
    }).await.map_err(|e| e.to_string())?
}

fn review_target(
    root: &std::path::Path,
    source: &std::path::Path,
    title: &str,
    markdown: &str,
    requested: Option<&str>,
) -> Result<String, String> {
    if let Some(path) = requested {
        return proposals::canonical_agent_commit_target(root, &PathBuf::from(path))
            .map(|p| p.to_string_lossy().into_owned());
    }
    let stem = crate::state::derive_file_stem_from_title_and_markdown(title, markdown);
    let parent = source.parent().ok_or("Missing note parent")?;
    let candidate = parent.join(format!("{stem}.md"));
    let mut target = candidate.clone();
    let mut suffix = 2;
    while target != source && target.symlink_metadata().is_ok() {
        target = parent.join(format!("{stem} {suffix}.md"));
        suffix += 1;
    }
    proposals::canonical_agent_commit_target(root, &target)
        .map(|p| p.to_string_lossy().into_owned())
}

fn conflict(message: &str) -> CommitNoteReviewResult {
    CommitNoteReviewResult {
        status: "conflict".into(),
        applied: None,
        note_id: None,
        committed_markdown: None,
        commit_warning: None,
        message: Some(message.into()),
    }
}

fn matches_effect(path: &std::path::Path, raw: &str, identity: &str, intended: &str) -> bool {
    crate::note::parse_note(raw)
        .frontmatter
        .managed
        .as_ref()
        .is_some_and(|m| m.id == identity)
        && proposals::editor_visible_content_hash(path, raw) == intended
}

#[tauri::command]
pub(crate) async fn pi_publish_review(
    app: tauri::AppHandle,
    accepted: Accepted,
    current_access: Option<VaultAccess>,
    current_grants: Option<Vec<String>>,
    fault: Option<String>,
) -> Result<CommitNoteReviewResult, String> {
    if fault.is_some() && std::env::var_os("PI_PROTOTYPE_HTTP_FIXTURE").is_none() {
        return Err("Fault injection requires the synthetic fixture".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        if let Some(access) = current_access {
            require_access(
                &app.state::<ChatDomain>(),
                &access,
                accepted.note_id.as_deref(),
                current_grants.as_deref().unwrap_or(&[]),
            )?;
        } else {
            return Err("Current review access is required".into());
        }
        publish(&app, accepted, fault.as_deref())
    })
    .await
    .map_err(|e| e.to_string())?
}

fn publish<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    accepted: Accepted,
    fault: Option<&str>,
) -> Result<CommitNoteReviewResult, String> {
    let _serial = PUBLICATION
        .lock()
        .map_err(|_| "Publication lock poisoned")?;
    if accepted.id.len() > 80
        || accepted.version == 0
        || accepted.markdown.len() > 262144
        || accepted.title.len() > 200
        || accepted.title.trim().is_empty()
        || !matches!(accepted.kind.as_str(), "create" | "update")
        || (accepted.kind == "create" && accepted.note_id.is_some())
        || (accepted.kind == "update" && accepted.note_id.is_none())
    {
        return Err("Invalid accepted review".into());
    }
    let state = app.state::<AppState>();
    require_access(
        &app.state::<ChatDomain>(),
        &accepted.access,
        accepted.note_id.as_deref(),
        &accepted.grants,
    )?;
    let root = state.running_vault().root();
    // Keep the exact accepted payload/hash immutable. Only its native location
    // interpretation changes, under roots previously bound to this vault identity.
    let locations = crate::pi_prototype_relocation::Locations::bind(root)?;
    let path = proposals::canonical_agent_commit_target(root, &locations.resolve(&PathBuf::from(&accepted.path))?)?;
    let source = accepted.source_path.as_deref().map(PathBuf::from).unwrap_or_else(|| PathBuf::from(&accepted.path));
    let source = locations.resolve(&source)?;
    let source = proposals::canonical_agent_commit_target(root, &source)?;
    let hash = crate::semantic::db::content_hash(
        &serde_json::to_string(&accepted).map_err(|e| e.to_string())?,
    );
    let key = format!("{}:{}", accepted.id, accepted.version);
    let ledger_path =
        crate::state::app_data_dir()?.join("PROTOTYPE-wipe-me/publication-receipts.sqlite");
    let ledger = Connection::open(ledger_path).map_err(|e| e.to_string())?;
    ledger.execute_batch("PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; CREATE TABLE IF NOT EXISTS effects(id TEXT PRIMARY KEY,payload_hash TEXT NOT NULL,note_id TEXT NOT NULL,target_path TEXT NOT NULL,intended_hash TEXT NOT NULL,receipt TEXT);").map_err(|e|e.to_string())?;
    let has_proof: bool = ledger
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM pragma_table_info('effects') WHERE name='proof')",
            [],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;
    if !has_proof {
        ledger
            .execute("ALTER TABLE effects ADD COLUMN proof TEXT", [])
            .map_err(|e| e.to_string())?;
    }
    let prior:Option<(String,String,String,String,Option<String>,Option<String>)> = ledger.query_row("SELECT payload_hash,note_id,target_path,intended_hash,receipt,proof FROM effects WHERE id=?1",[&key],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?,r.get(4)?,r.get(5)?))).optional().map_err(|e|e.to_string())?;
    let fresh_intent = prior.is_none();
    let identity = if let Some((prior_hash, id, target, intended, receipt, proof)) = prior {
        if prior_hash != hash || locations.resolve(&PathBuf::from(&target))? != path {
            return Err("Accepted payload differs from native intent".into());
        }
        if let Some(receipt) = receipt {
            let value: Value = serde_json::from_str(&receipt).map_err(|e| e.to_string())?;
            return serde_json::from_value(locations.display_json(value)).map_err(|e|e.to_string());
        }
        // NoteTimeline recovers its own retained publication intents before the
        // authoritative read. Identity AND exact accepted editor bytes must match.
        state
            .note_timeline()
            .retry_history_recovery(root)
            .map_err(|e| e.to_string())?;
        if let Some(proof) = proof {
            let proof: PrototypePublicationProof =
                serde_json::from_str(&proof).map_err(|e| e.to_string())?;
            let recovered = match state.note_timeline()
                .recover_prototype_publication_at(&proof, &locations.resolve(proof.location())?) {
                Ok(value) => value,
                Err(HistoryError::Stale(message)) => return Ok(conflict(&message)),
                Err(error) => return Err(error.to_string()),
            };
            if let Some(outcome) = recovered {
                if outcome.note_id().as_str() != id
                    || outcome.path() != path
                    || proposals::editor_visible_content_hash(&path, outcome.canonical_markdown())
                        != intended
                {
                    return Err(
                        "Retained publication proof differs from native accepted intent".into(),
                    );
                }
                let session =
                    crate::commands::note_persistence::build_note_session_from_mutation(&outcome);
                let receipt = CommitNoteReviewResult {
                    status: "committed".into(),
                    note_id: session.note_id,
                    committed_markdown: Some(session.markdown),
                    commit_warning: session.commit_warning,
                    message: None,
                    applied: Some(AppliedNoteChange {
                        kind: if accepted.kind == "create" {
                            "createNote"
                        } else {
                            "updateNote"
                        }
                        .into(),
                        path: session.path,
                        previous_path: (source != path)
                            .then(|| source.to_string_lossy().into_owned()),
                    }),
                };
                ledger
                    .execute(
                        "UPDATE effects SET receipt=?2,proof=NULL WHERE id=?1",
                        params![
                            key,
                            serde_json::to_string(&receipt).map_err(|e| e.to_string())?
                        ],
                    )
                    .map_err(|e| e.to_string())?;
                return Ok(receipt);
            }
        }
        if let Ok(raw) = fs::read_to_string(&path) {
            if matches_effect(&path, &raw, &id, &intended) {
                let session = crate::commands::read_note_session_from_path(&path)?;
                let receipt = CommitNoteReviewResult {
                    status: "committed".into(),
                    note_id: Some(id),
                    committed_markdown: Some(session.markdown),
                    commit_warning: session.commit_warning,
                    message: None,
                    applied: Some(AppliedNoteChange {
                        kind: if accepted.kind == "create" {
                            "createNote"
                        } else {
                            "updateNote"
                        }
                        .into(),
                        path: Some(path.to_string_lossy().into()),
                        previous_path: (source != path)
                            .then(|| source.to_string_lossy().into_owned()),
                    }),
                };
                ledger
                    .execute(
                        "UPDATE effects SET receipt=?2,proof=NULL WHERE id=?1",
                        params![
                            key,
                            serde_json::to_string(&receipt).map_err(|e| e.to_string())?
                        ],
                    )
                    .map_err(|e| e.to_string())?;
                return Ok(receipt);
            }
        }
        // An existing intent with neither a receipt nor matching canonical
        // bytes is uncertain. Only a provably untouched base may be attempted
        // again; later ordinary edits must never be overwritten by replay.
        if accepted.kind == "create" {
            if path.symlink_metadata().is_ok() {
                return Err("Native publication cannot yet be reconciled; canonical destination differs from the accepted intent".into());
            }
        } else {
            let untouched = fs::read_to_string(&source).ok().is_some_and(|raw| {
                crate::note::parse_note(&raw)
                    .frontmatter
                    .managed
                    .as_ref()
                    .is_some_and(|m| m.id == id)
                    && accepted.base_hash.as_deref()
                        == Some(crate::semantic::db::content_hash(&raw).as_str())
            });
            if !untouched {
                return Err("Native publication cannot yet be reconciled; canonical target changed after the accepted intent".into());
            }
        }
        id
    } else {
        let id = accepted
            .note_id
            .clone()
            .unwrap_or_else(crate::note::generate_unique_id);
        ledger
            .execute(
                "INSERT INTO effects(id,payload_hash,note_id,target_path,intended_hash,receipt) VALUES(?1,?2,?3,?4,?5,NULL)",
                params![
                    key,
                    hash,
                    id,
                    path.to_string_lossy(),
                    proposals::editor_visible_content_hash(&path, &accepted.markdown)
                ],
            )
            .map_err(|e| e.to_string())?;
        id
    };
    if fault == Some("after-intent") && fresh_intent {
        std::process::abort();
    }
    // NoteTimeline verifies this reviewed source location as well as identity
    // and exact base. Resolving by identity here would silently approve a later
    // independent move back to the previously reviewed destination.
    let timeline = state.note_timeline();
    let record_proof = |proof: &PrototypePublicationProof| -> Result<(), HistoryError> {
        let proof =
            serde_json::to_string(proof).map_err(|error| HistoryError::from(error.to_string()))?;
        ledger
            .execute(
                "UPDATE effects SET proof=?2 WHERE id=?1",
                params![key, proof],
            )
            .map_err(|error| HistoryError::from(error.to_string()))?;
        Ok(())
    };
    let outcome = if accepted.kind == "create" {
        timeline.create_prototype_note_with_proof(
            &path,
            &accepted.markdown,
            &NoteIdentity::new(identity),
            &record_proof,
        )
    } else if accepted.kind == "update" {
        let expected = accepted
            .base_hash
            .as_ref()
            .ok_or("Missing accepted base hash")?;
        timeline
            .edit_prototype_note_with_proof(
                &source,
                &path,
                &NoteIdentity::new(identity),
                expected,
                &accepted.markdown,
                Some(&record_proof),
            )
            .map(Some)
    } else {
        return Err("Unsupported proposal kind".into());
    };
    let outcome = match outcome {
        Ok(Some(value)) => value,
        Ok(None) => return Ok(conflict("Creation destination occupied; review again")),
        Err(HistoryError::Stale(message)) => return Ok(conflict(&message)),
        Err(error) => return Err(error.to_string()),
    };
    if fault == Some("after-publication") {
        std::process::abort();
    }
    if fault == Some("receipt-write") {
        return Err("Synthetic native receipt persistence failure after publication".into());
    }
    let session = crate::commands::note_persistence::build_note_session_from_mutation(&outcome);
    let receipt = CommitNoteReviewResult {
        status: "committed".into(),
        note_id: session.note_id,
        committed_markdown: Some(session.markdown),
        commit_warning: session.commit_warning,
        message: None,
        applied: Some(AppliedNoteChange {
            kind: if accepted.kind == "create" {
                "createNote"
            } else {
                "updateNote"
            }
            .into(),
            path: session.path,
            previous_path: (source != path).then(|| source.to_string_lossy().into_owned()),
        }),
    };
    ledger
        .execute(
            "UPDATE effects SET receipt=?2,proof=NULL WHERE id=?1",
            params![
                key,
                serde_json::to_string(&receipt).map_err(|e| e.to_string())?
            ],
        )
        .map_err(|e| e.to_string())?;
    if fault == Some("after-receipt") {
        std::process::abort();
    }
    Ok(receipt)
}


/// Explicit user conversion reuses the native canonical effect receipt boundary.
/// Repeated conversion of the same external bytes joins its original publication.
pub(crate) fn convert_transcript<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    conversation_id: &str,
    bytes: &str,
) -> Result<CommitNoteReviewResult, String> {
    let markdown = crate::note::strip_frontmatter(bytes);
    let digest = crate::semantic::db::content_hash(bytes);
    let id = format!("pi-convert-{}-{}", conversation_id, &digest[..24]);
    let title = crate::proposal_policy::first_heading(&markdown)
        .unwrap_or_else(||"Converted chat".into()).chars().take(200).collect::<String>();
    let root = app.state::<AppState>().running_vault().root().to_path_buf();
    let ledger_path = crate::state::app_data_dir()?.join("PROTOTYPE-wipe-me/publication-receipts.sqlite");
    let prior = if ledger_path.exists() {
        let db = Connection::open(&ledger_path).map_err(|e|e.to_string())?;
        db.query_row("SELECT target_path FROM effects WHERE id=?1",[format!("{}:1",id)],|row|row.get::<_,String>(0)).optional().map_err(|e|e.to_string())?
    } else {None};
    let path = match prior {Some(path)=>path,None=>proposals::preview_note_creation(&root,&title,&markdown)?.suggested_path};
    publish(app, Accepted{id,version:1,kind:"create".into(),note_id:None,path,source_path:None,
        title,markdown,base_hash:None,access:VaultAccess::None,grants:vec![],promotion:None},None)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn missing_native_receipt_recovers_original_publication_after_later_ordinary_edit() {
        let _guard = crate::test_support::lock_test_env();
        let data = crate::test_support::TestDir::new("pi-receipt-intervening-edit-data");
        let notes = crate::test_support::TestDir::new("pi-receipt-intervening-edit-vault");
        crate::state::initialize_app_data_dir(data.path().to_path_buf()).unwrap();
        crate::state::set_notes_root_override(Some(notes.path().to_path_buf())).unwrap();
        crate::state::ensure_vault_scaffold(notes.path()).unwrap();
        fs::create_dir_all(data.path().join("PROTOTYPE-wipe-me")).unwrap();
        let state = AppState::new(
            crate::semantic::SemanticState::new_disabled("disabled"),
            crate::app::EventBus::disabled(),
        )
        .unwrap();
        let domain = ChatDomain::new(
            notes.path().to_path_buf(),
            crate::state::vault_data_dir_for(notes.path()),
        )
        .unwrap();
        let app = tauri::test::mock_builder()
            .manage(state)
            .manage(domain)
            .build(tauri::test::mock_context(tauri::test::noop_assets()))
            .unwrap();
        let path = notes.path().join("Reviewed.md");
        let accepted = Accepted {
            id: "pi-review-100".into(),
            version: 1,
            kind: "create".into(),
            note_id: None,
            path: path.to_string_lossy().into_owned(),
            source_path: None,
            title: "Reviewed".into(),
            markdown: "Reviewed body".into(),
            base_hash: None,
            access: VaultAccess::None,
            grants: vec![],
            promotion: None,
        };
        let error = publish(app.handle(), accepted.clone(), Some("receipt-write")).unwrap_err();
        assert!(error.contains("receipt persistence failure"));
        let initial = fs::read_to_string(&path).unwrap();
        let identity = crate::note::parse_note(&initial)
            .frontmatter
            .managed
            .unwrap()
            .id;
        app.state::<AppState>()
            .note_timeline()
            .edit_note(
                crate::services::note_timeline::MutationSource::Editor,
                &path,
                Some(&NoteIdentity::new(identity.clone())),
                |raw| Ok(raw.replace("Reviewed body", "Later ordinary edit")),
            )
            .unwrap();
        let later = fs::read_to_string(&path).unwrap();
        let ledger = Connection::open(
            data.path()
                .join("PROTOTYPE-wipe-me/publication-receipts.sqlite"),
        )
        .unwrap();
        let proof_json: String = ledger
            .query_row(
                "SELECT proof FROM effects WHERE id='pi-review-100:1'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        let mut forged: Value = serde_json::from_str(&proof_json).unwrap();
        forged["canonicalMarkdown"] = json!("Forged accepted bytes");
        let forged: PrototypePublicationProof = serde_json::from_value(forged).unwrap();
        assert!(app
            .state::<AppState>()
            .note_timeline()
            .recover_prototype_publication(&forged)
            .is_err());
        assert_eq!(fs::read_to_string(&path).unwrap(), later);
        let receipt = publish(app.handle(), accepted.clone(), None).unwrap();
        assert_eq!(receipt.status, "committed");
        assert_eq!(receipt.note_id.as_deref(), Some(identity.as_str()));
        assert_eq!(receipt.committed_markdown.as_deref(), Some("Reviewed body"));
        assert_eq!(fs::read_to_string(&path).unwrap(), later);
        assert_eq!(publish(app.handle(), accepted, None).unwrap(), receipt);
        assert_eq!(fs::read_to_string(&path).unwrap(), later);
        let ledger = Connection::open(
            data.path()
                .join("PROTOTYPE-wipe-me/publication-receipts.sqlite"),
        )
        .unwrap();
        let proof: Option<String> = ledger
            .query_row(
                "SELECT proof FROM effects WHERE id='pi-review-100:1'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert!(
            proof.is_none(),
            "temporary canonical proof bytes retire after adapter receipt"
        );
        crate::state::set_notes_root_override(None).unwrap();
    }
    #[test]
    fn relocated_uncertain_keep_recovers_proof_without_changing_accepted_hash_or_replaying() {
        let _guard=crate::test_support::lock_test_env();
        let data=crate::test_support::TestDir::new("pi-receipt-move-app");
        let old=crate::test_support::TestDir::new("pi-receipt-move-old");
        let destination=crate::test_support::TestDir::new("pi-receipt-move-new");
        crate::state::initialize_app_data_dir(data.path().to_path_buf()).unwrap();
        crate::state::set_notes_root_override(Some(old.path().to_path_buf())).unwrap();
        crate::state::ensure_vault_scaffold(old.path()).unwrap();
        let state=AppState::new(crate::semantic::SemanticState::new_disabled("disabled"),crate::app::EventBus::disabled()).unwrap();
        let domain=ChatDomain::new(old.path().to_path_buf(),crate::state::vault_data_dir_for(old.path())).unwrap();
        let app=tauri::test::mock_builder().manage(state).manage(domain).build(tauri::test::mock_context(tauri::test::noop_assets())).unwrap();
        let accepted=Accepted{id:"pi-review-200".into(),version:1,kind:"create".into(),note_id:None,
            path:old.path().join("Reviewed.md").to_string_lossy().into_owned(),source_path:None,title:"Reviewed".into(),
            markdown:"Reviewed body".into(),base_hash:None,access:VaultAccess::None,grants:vec![],promotion:None};
        let exact=serde_json::to_string(&accepted).unwrap();let original_hash=crate::semantic::db::content_hash(&exact);
        assert!(publish(app.handle(),accepted.clone(),Some("receipt-write")).is_err());
        let path=PathBuf::from(&accepted.path);
        app.state::<AppState>().note_timeline().edit_note(crate::services::note_timeline::MutationSource::Editor,&path,None,
            |raw|Ok(raw.replace("Reviewed body","Later ordinary edit"))).unwrap();
        let later=fs::read_to_string(&path).unwrap();
        drop(app);
        let moved=destination.path().join("Vault");fs::rename(old.path(),&moved).unwrap();
        crate::state::set_notes_root_override(Some(moved.clone())).unwrap();
        let state=AppState::new(crate::semantic::SemanticState::new_disabled("disabled"),crate::app::EventBus::disabled()).unwrap();
        let domain=ChatDomain::new(moved.clone(),crate::state::vault_data_dir_for(&moved)).unwrap();
        let app=tauri::test::mock_builder().manage(state).manage(domain).build(tauri::test::mock_context(tauri::test::noop_assets())).unwrap();
        let receipt=publish(app.handle(),accepted.clone(),None).unwrap();
        assert_eq!(receipt.status,"committed");assert_eq!(receipt.committed_markdown.as_deref(),Some("Reviewed body"));
        assert_eq!(receipt.applied.as_ref().unwrap().path.as_deref(),Some(moved.join("Reviewed.md").to_str().unwrap()));
        assert_eq!(fs::read_to_string(moved.join("Reviewed.md")).unwrap(),later);
        assert_eq!(serde_json::to_string(&accepted).unwrap(),exact);
        let ledger=Connection::open(data.path().join("PROTOTYPE-wipe-me/publication-receipts.sqlite")).unwrap();
        let stored:String=ledger.query_row("SELECT payload_hash FROM effects WHERE id='pi-review-200:1'",[],|row|row.get(0)).unwrap();
        assert_eq!(stored,original_hash);
        assert_eq!(publish(app.handle(),accepted,None).unwrap(),receipt);
        crate::state::set_notes_root_override(None).unwrap();
    }
    #[test]
    fn recovery_requires_exact_note_identity_and_editor_payload() {
        let path = PathBuf::from("/vault/Plan.md");
        let raw = "---\ngneauxghts:\n  id: intended-id\n  kind: note\n---\n\nReviewed body";
        let hash = proposals::editor_visible_content_hash(&path, raw);
        assert!(matches_effect(&path, raw, "intended-id", &hash));
        assert!(!matches_effect(&path, raw, "unrelated-id", &hash));
        assert!(!matches_effect(
            &path,
            &raw.replace("Reviewed body", "Later ordinary edit"),
            "intended-id",
            &hash
        ));
    }
    #[test]
    fn reviewed_location_is_independent_of_title_and_occupied_rename_gets_a_suggestion() {
        let notes = crate::test_support::TestDir::new("pi-review-target");
        let source = notes.path().join("Old.md");
        fs::write(&source, "Body").unwrap();
        fs::write(notes.path().join("Renamed.md"), "Occupied").unwrap();
        let target = review_target(notes.path(), &source, "Renamed", "Body", None).unwrap();
        assert!(target.ends_with("Renamed 2.md"));
        let custom = notes.path().join("Location.md");
        assert_eq!(
            review_target(
                notes.path(),
                &source,
                "Independent title",
                "Body",
                Some(custom.to_str().unwrap())
            )
            .unwrap(),
            custom.to_string_lossy()
        );
        assert!(!custom.exists());
    }
}

#[cfg(test)]
#[path = "pi_prototype_publication_location_tests.rs"]
mod location_tests;
