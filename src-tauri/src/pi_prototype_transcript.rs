//! Rebuildable Markdown projection of committed Pi state. No conversation lifecycle is stored here.
use crate::{chat::ChatSource, index::AppState};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    fs,
    path::{Path, PathBuf},
    sync::Mutex,
};
use tauri::Manager;

static PUBLICATION: Mutex<()> = Mutex::new(());
#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct Snapshot {
    conversation_id: String,
    title: String,
    created_at_millis: u64,
    messages: Vec<Message>,
    #[serde(default)]
    settled_origins: Vec<Origin>,
}
#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Message {
    id: String,
    role: String,
    status: String,
    content: String,
    #[serde(default)]
    sources: Vec<ChatSource>,
    #[serde(default)]
    attachments: Vec<Attachment>,
}
#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Attachment {
    name: String,
    mime_type: String,
}
#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Origin {
    message_id: String,
    note_id: String,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Status {
    projection_path: String,
    detached: bool,
    conflict: Option<String>,
    warning: Option<String>,
    converted_path: Option<String>,
}
fn identity(id: &str, prefix: &str) -> bool {
    id.strip_prefix(prefix).is_some_and(|tail| {
        !tail.is_empty()
            && !tail.starts_with('0')
            && tail.bytes().all(|b| b.is_ascii_digit())
            && tail.parse::<u64>().is_ok()
    })
}
fn relative(id: &str) -> Result<PathBuf, String> {
    if !identity(id, "pi-") {
        return Err("Invalid Pi conversation identity".into());
    }
    Ok(PathBuf::from("Chats").join("Pi").join(id).join("Origin.md"))
}
fn projection_path(root: &Path, id: &str) -> Result<PathBuf, String> {
    let root = fs::canonicalize(root).map_err(|e| e.to_string())?;
    let mut path = root.clone();
    for component in relative(id)?.components() {
        path.push(component);
        match fs::symlink_metadata(&path) {
            Ok(metadata) if metadata.file_type().is_symlink() => {
                return Err("Transcript locations cannot contain symlinks".into())
            }
            Ok(_) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => return Err(error.to_string()),
        }
    }
    Ok(path)
}
fn ledger(root: &Path) -> Result<Connection, String> {
    let dir = crate::state::vault_data_dir_for(root);
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let db = Connection::open(dir.join("pi-transcripts.sqlite")).map_err(|e| e.to_string())?;
    db.execute_batch("PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; CREATE TABLE IF NOT EXISTS projections(conversation_id TEXT PRIMARY KEY, receipt_hash TEXT, intent_hash TEXT, intent_markdown TEXT, detached INTEGER NOT NULL DEFAULT 0, warning TEXT);").map_err(|e|e.to_string())?;
    Ok(db)
}
fn hash(bytes: &str) -> String {
    crate::semantic::db::content_hash(bytes)
}
fn record(
    db: &Connection,
    id: &str,
) -> Result<
    (
        Option<String>,
        Option<String>,
        Option<String>,
        bool,
        Option<String>,
    ),
    String,
> {
    Ok(db.query_row("SELECT receipt_hash,intent_hash,intent_markdown,detached,warning FROM projections WHERE conversation_id=?1",[id],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?,r.get(4)?))).optional().map_err(|e|e.to_string())?.unwrap_or((None,None,None,false,None)))
}
fn file(path: &Path) -> Result<Option<String>, String> {
    match fs::read_to_string(path) {
        Ok(bytes) => Ok(Some(bytes)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}
fn classify(receipt: Option<&str>, bytes: Option<&str>) -> Option<String> {
    match (receipt, bytes) {
        (Some(expected), Some(bytes)) if hash(bytes) == expected => None,
        (Some(_), Some(_)) => Some("edited".into()),
        (Some(_), None) => Some("missing".into()),
        (None, Some(_)) => Some("occupied".into()),
        (None, None) => None,
    }
}
fn recover_intent(db: &Connection, id: &str, path: &Path) -> Result<(), String> {
    let (receipt, intent, markdown, _, _) = record(db, id)?;
    let (Some(intended), Some(markdown)) = (intent, markdown) else {
        return Ok(());
    };
    if hash(&markdown) != intended {
        return Err("Transcript publication intent hash changed".into());
    }
    let current = file(path)?;
    if current
        .as_deref()
        .is_some_and(|bytes| hash(bytes) == intended)
    {
        // This exact derived intent was retained before writing. Identity and bytes
        // are checked; relocation or matching-looking frontmatter alone is insufficient.
        let metadata = crate::note::parse_note(&markdown)
            .frontmatter
            .managed
            .ok_or("Invalid transcript publication intent")?;
        if metadata.chat_id.as_deref() != Some(id) || metadata.id != stable_id(id) {
            return Err("Transcript publication identity changed".into());
        }
        db.execute("UPDATE projections SET receipt_hash=?2,intent_hash=NULL,intent_markdown=NULL,warning=NULL WHERE conversation_id=?1",params![id,intended]).map_err(|e|e.to_string())?;
    } else if classify(receipt.as_deref(), current.as_deref()).is_none() {
        // A failed write left the previous receipt untouched. The next latest
        // committed Pi snapshot can replace this preparation without replay.
        db.execute(
            "UPDATE projections SET intent_hash=NULL,intent_markdown=NULL WHERE conversation_id=?1",
            [id],
        )
        .map_err(|e| e.to_string())?;
    }
    Ok(())
}
fn status_locked(root: &Path, id: &str) -> Result<Status, String> {
    let path = projection_path(root, id)?;
    let db = ledger(root)?;
    recover_intent(&db, id, &path)?;
    let (receipt, _, _, _, warning) = record(&db, id)?;
    let conflict = classify(receipt.as_deref(), file(&path)?.as_deref());
    db.execute(
        "UPDATE projections SET detached=?2 WHERE conversation_id=?1",
        params![id, conflict.is_some()],
    )
    .map_err(|e| e.to_string())?;
    Ok(Status {
        projection_path: path.to_string_lossy().into_owned(),
        detached: conflict.is_some(),
        conflict,
        warning,
        converted_path: None,
    })
}
fn stable_id(id: &str) -> String {
    let mut digest = blake3::Hasher::new();
    digest.update(id.as_bytes());
    digest.update(b"pi-origin-v1");
    format!("CHAT{}", &digest.finalize().to_hex()[..20].to_uppercase())
}
fn label(text: &str) -> String {
    text.replace(['\n', '\r'], " ")
        .replace('[', "(")
        .replace(']', ")")
        .replace('|', "/")
}
fn note_link(
    root: &Path,
    id: &str,
    title: &str,
    lookup: &mut impl FnMut(&str) -> Option<PathBuf>,
    cache: &mut HashMap<String, Option<String>>,
) -> Option<String> {
    let target = cache
        .entry(id.to_string())
        .or_insert_with(|| {
            let path = lookup(id)?;
            let path = fs::canonicalize(path).ok()?;
            if !path.starts_with(root) {
                return None;
            }
            let raw = fs::read_to_string(&path).ok()?;
            if crate::note::document_kind(&raw) != crate::note::DocumentKind::Note
                || crate::note::note_id_from_path_or_markdown(Some(&path), &raw).as_deref()
                    != Some(id)
            {
                return None;
            }
            let relative = path
                .strip_prefix(root)
                .ok()?
                .to_string_lossy()
                .replace('\\', "/");
            let target = relative.strip_suffix(".md").unwrap_or(&relative);
            if target.contains(['[', ']', '\n', '\r', '|']) {
                return None;
            }
            Some(target.to_string())
        })
        .as_deref()?;
    Some(format!("[[{}|{}]]", target, label(title)))
}
/// Passage proofs remain Pi-owned. Markdown receives ordinary display links,
/// never an executable historical proof or a stale absolute source path.
fn display_content(
    root: &Path,
    message: &Message,
    lookup: &mut impl FnMut(&str) -> Option<PathBuf>,
    cache: &mut HashMap<String, Option<String>>,
) -> String {
    use pulldown_cmark::{Event, Parser, Tag};
    let mut edits = Vec::new();
    for (event, range) in Parser::new(&message.content).into_offset_iter() {
        if let Event::Start(Tag::Link { dest_url, .. }) = event {
            if let Some(proof) = dest_url.strip_prefix("passage:") {
                let source = message.sources.iter().find(|source| {
                    source
                        .passage
                        .as_ref()
                        .is_some_and(|passage| passage.id == proof)
                });
                let link = source.and_then(|source| {
                    source
                        .note_id
                        .as_deref()
                        .or_else(|| {
                            source
                                .passage
                                .as_ref()
                                .map(|passage| passage.note_id.as_str())
                        })
                        .and_then(|id| note_link(root, id, &source.title, lookup, cache))
                });
                edits.push((
                    range,
                    link.unwrap_or_else(|| {
                        source
                            .map(|source| format!("{} (source unavailable)", label(&source.title)))
                            .unwrap_or_else(|| "Source unavailable".into())
                    }),
                ));
            }
        }
    }
    let mut content = message.content.clone();
    for (range, replacement) in edits.into_iter().rev() {
        content.replace_range(range, &replacement);
    }
    content
}
#[cfg(test)]
fn render(root: &Path, snapshot: &Snapshot) -> Result<String, String> {
    render_with_lookup(root, snapshot, |id| {
        crate::state::resolve_note_path_by_id(root, id)
            .ok()
            .flatten()
    })
}
fn render_with_lookup(
    root: &Path,
    snapshot: &Snapshot,
    mut lookup: impl FnMut(&str) -> Option<PathBuf>,
) -> Result<String, String> {
    let mut cache = HashMap::new();
    let mut origins: HashMap<&str, Vec<&Origin>> = HashMap::new();
    for origin in &snapshot.settled_origins {
        origins.entry(&origin.message_id).or_default().push(origin);
    }
    relative(&snapshot.conversation_id)?;
    if snapshot.title.len() > 200
        || snapshot.messages.len() > 100000
        || snapshot.settled_origins.len() > 100000
    {
        return Err("Transcript metadata exceeds bounds".into());
    }
    let mut body=format!("---\ngneauxghts:\n  id: {}\n  created_at: {}\n  updated_at: {}\n  trashed_at: null\n  kind: chatTranscript\n  chat_id: {}\n  part: 1\n  projection_hash: managed\n---\n\n# {}\n",stable_id(&snapshot.conversation_id),snapshot.created_at_millis,snapshot.created_at_millis,snapshot.conversation_id,label(&snapshot.title));
    for message in &snapshot.messages {
        if !identity(
            &message.id,
            if message.role == "user" {
                "pi-user-"
            } else {
                "pi-assistant-"
            },
        ) || !matches!(message.role.as_str(), "user" | "assistant")
            || message.content.len() > 1048576
            || message.sources.len() > 128
            || message.attachments.len() > 128
        {
            return Err("Invalid committed transcript message".into());
        }
        let suffix = match message.status.as_str() {
            "completed" => "",
            "cancelled" => " · interrupted",
            "error" => " · failed",
            "pending" | "streaming" => " · pending",
            _ => return Err("Invalid transcript message status".into()),
        };
        body.push_str(&format!(
            "\n## {}{}\n\n{}\n\n^msg_{}\n",
            if message.role == "user" {
                "You"
            } else {
                "Thought partner"
            },
            suffix,
            display_content(root, message, &mut lookup, &mut cache),
            message.id
        ));
        for attachment in &message.attachments {
            body.push_str(&format!(
                "\nAttachment: {} ({})\n",
                label(&attachment.name),
                label(&attachment.mime_type)
            ));
        }
        if !message.sources.is_empty() {
            body.push_str(
                "\nSources (display links; open the conversation for validated passages):\n",
            );
        }
        for source in &message.sources {
            let link = if let Some(id) = source.note_id.as_deref().or_else(|| {
                source
                    .passage
                    .as_ref()
                    .map(|passage| passage.note_id.as_str())
            }) {
                note_link(root, id, &source.title, &mut lookup, &mut cache)
            } else {
                source
                    .url
                    .as_ref()
                    .filter(|url| url.starts_with("https://") || url.starts_with("http://"))
                    .map(|url| {
                        format!(
                            "[{}]({})",
                            label(&source.title),
                            url.replace(')', "%29").replace('\n', "")
                        )
                    })
            };
            body.push_str(&format!(
                "- {}\n",
                link.unwrap_or_else(|| format!("{} (unavailable)", label(&source.title)))
            ));
        }
        for origin in origins.get(message.id.as_str()).into_iter().flatten() {
            if let Some(link) =
                note_link(root, &origin.note_id, "Saved note", &mut lookup, &mut cache)
            {
                body.push_str(&format!("\n{link}\n"));
            }
        }
    }
    Ok(body)
}
fn publish_locked<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    snapshot: &Snapshot,
    force: bool,
) -> Result<Status, String> {
    let state = app.state::<AppState>();
    let root = state.running_vault().root();
    let mut status = status_locked(root, &snapshot.conversation_id)?;
    if status.detached && !force {
        return Ok(status);
    }
    let path = projection_path(root, &snapshot.conversation_id)?;
    let observed = file(&path)?;
    let markdown = render_with_lookup(root, snapshot, |id| {
        state
            .notes_index
            .lock()
            .ok()?
            .get_note_by_note_id(id)
            .filter(|(_, note)| note.document_kind == crate::note::DocumentKind::Note)
            .map(|(path, _)| path.clone())
    })?;
    let intended = hash(&markdown);
    let parent = path.parent().ok_or("Transcript parent unavailable")?;
    fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    // Recheck after directory creation; a symlink must never supply write authority.
    let path = projection_path(root, &snapshot.conversation_id)?;
    let db = ledger(root)?;
    db.execute("INSERT INTO projections(conversation_id,intent_hash,intent_markdown) VALUES(?1,?2,?3) ON CONFLICT(conversation_id) DO UPDATE SET intent_hash=excluded.intent_hash,intent_markdown=excluded.intent_markdown",params![snapshot.conversation_id,intended,markdown]).map_err(|e|e.to_string())?;
    let result = (|| -> Result<(), String> {
        if file(&path)? != observed {
            return Err("Transcript changed during publication; resolve the latest edit".into());
        }
        if observed.as_deref() != Some(markdown.as_str()) {
            let expected = crate::vault_watcher::record_expected_write(&path, &markdown);
            let temporary = path
                .parent()
                .unwrap()
                .join(format!(".Origin-{}.tmp", crate::note::generate_unique_id()));
            // The temporary name is confined to the same checked directory.
            use std::io::Write;
            let mut out = fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(&temporary)
                .map_err(|e| e.to_string())?;
            let write = (|| -> Result<(), String> {
                out.write_all(markdown.as_bytes())
                    .map_err(|e| e.to_string())?;
                out.sync_all().map_err(|e| e.to_string())?;
                fs::rename(&temporary, &path).map_err(|e| e.to_string())?;
                #[cfg(unix)]
                fs::File::open(path.parent().unwrap())
                    .and_then(|directory| directory.sync_all())
                    .map_err(|e| e.to_string())?;
                Ok(())
            })();
            if write.is_err() {
                let _ = fs::remove_file(&temporary);
            }
            write?;
            expected.commit();
        }
        if file(&path)?.as_deref() != Some(markdown.as_str()) {
            return Err("Transcript changed during publication".into());
        }
        db.execute("UPDATE projections SET receipt_hash=?2,intent_hash=NULL,intent_markdown=NULL,detached=0,warning=NULL WHERE conversation_id=?1",params![snapshot.conversation_id,intended]).map_err(|e|e.to_string())?;
        Ok(())
    })();
    if let Err(error) = result {
        let warning = format!("Transcript publication needs retry: {error}");
        let _ = db.execute(
            "UPDATE projections SET warning=?2 WHERE conversation_id=?1",
            params![snapshot.conversation_id, warning],
        );
        status = status_locked(root, &snapshot.conversation_id).unwrap_or(status);
        status.warning = Some(warning);
        return Ok(status);
    }
    status = status_locked(root, &snapshot.conversation_id)?;
    let indexed =
        crate::index::build_indexed_note(&path, &markdown, crate::time::current_time_millis()?);
    if let Err(error) = state.upsert_managed_chat_projection(path.clone(), indexed) {
        let warning = format!("Transcript was published; its index needs retry: {error}");
        let _ = state.mark_notes_index_dirty(&path, "pi-transcript-retry");
        let _ = db.execute(
            "UPDATE projections SET warning=?2 WHERE conversation_id=?1",
            params![snapshot.conversation_id, warning],
        );
        status.warning = Some(warning);
    }
    Ok(status)
}
#[tauri::command]
pub(crate) async fn pi_publish_transcript(
    app: tauri::AppHandle,
    snapshot: Snapshot,
) -> Result<Status, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let _lock = PUBLICATION
            .lock()
            .map_err(|_| "Transcript publication unavailable")?;
        publish_locked(&app, &snapshot, false)
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
pub(crate) fn pi_transcript_status(
    app: tauri::AppHandle,
    conversation_id: String,
) -> Result<Status, String> {
    let _lock = PUBLICATION
        .lock()
        .map_err(|_| "Transcript publication unavailable")?;
    status_locked(
        app.state::<AppState>().running_vault().root(),
        &conversation_id,
    )
}
#[tauri::command]
pub(crate) async fn pi_resolve_transcript_conflict(
    app: tauri::AppHandle,
    snapshot: Snapshot,
    action: String,
) -> Result<Status, String> {
    tauri::async_runtime::spawn_blocking(move||{
        let _lock=PUBLICATION.lock().map_err(|_|"Transcript publication unavailable")?;
        let root=app.state::<AppState>().running_vault().root().to_path_buf();
        let prior=status_locked(&root,&snapshot.conversation_id)?;
        if !prior.detached{return Ok(prior);}
        let converted=match action.as_str(){
            "restoreTranscript"=>None,
            "convertToNote"=>{
                let path=projection_path(&root,&snapshot.conversation_id)?;
                let bytes=file(&path)?.ok_or("The changed transcript was deleted; restore it instead")?;
                let receipt=crate::pi_prototype_publication::convert_transcript(&app,&snapshot.conversation_id,&bytes)?;
                let converted=receipt.applied.and_then(|change|change.path).ok_or("Converted note was not published")?;
                if file(&path)?.as_deref()!=Some(bytes.as_str()){return Ok(Status{converted_path:Some(converted),warning:Some("Converted note was saved; the transcript changed again. Resolve the latest change.".into()),..prior});}
                Some(converted)
            },_=>return Err("Unknown transcript conflict action".into())};
        let mut status=publish_locked(&app,&snapshot,true)?;status.converted_path=converted;Ok(status)
    }).await.map_err(|e|e.to_string())?
}
/// Receipt lookup, never a Markdown scan. Damaged metadata still belongs to its receipted projection.
pub(crate) fn owner_for_path(root: &Path, path: &Path) -> Result<Option<String>, String> {
    let Some(id) = path
        .strip_prefix(root)
        .ok()
        .and_then(|relative| relative.to_str())
        .and_then(|relative| relative.strip_prefix("Chats/Pi/"))
        .and_then(|relative| relative.strip_suffix("/Origin.md"))
    else {
        return Ok(None);
    };
    if relative(id).is_err() {
        return Ok(None);
    }
    let db = ledger(root)?;
    let exists: bool = db
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM projections WHERE conversation_id=?1)",
            [id],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?;
    Ok(exists.then(|| id.to_string()))
}
pub(crate) fn observe(root: &Path, id: &str) -> Result<bool, String> {
    let _lock = PUBLICATION
        .lock()
        .map_err(|_| "Transcript publication unavailable")?;
    Ok(status_locked(root, id)?.detached)
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn publication_observation_and_explicit_restore_preserve_external_edits() {
        let _guard = crate::test_support::lock_test_env();
        let data = crate::test_support::TestDir::new("pi-transcript-app");
        let notes = crate::test_support::TestDir::new("pi-transcript-vault");
        crate::state::initialize_app_data_dir(data.path().to_path_buf()).unwrap();
        crate::state::set_notes_root_override(Some(notes.path().to_path_buf())).unwrap();
        crate::state::ensure_vault_scaffold(notes.path()).unwrap();
        let state = AppState::new(
            crate::semantic::SemanticState::new_disabled("disabled"),
            crate::app::EventBus::disabled(),
        )
        .unwrap();
        let app = tauri::test::mock_builder()
            .manage(state)
            .build(tauri::test::mock_context(tauri::test::noop_assets()))
            .unwrap();
        let mut snapshot = Snapshot {
            conversation_id: "pi-1".into(),
            title: "Chat".into(),
            created_at_millis: 1,
            messages: vec![Message {
                id: "pi-assistant-1".into(),
                role: "assistant".into(),
                status: "completed".into(),
                content: "Original answer".into(),
                sources: vec![],
                attachments: vec![],
            }],
            settled_origins: vec![],
        };
        let initial = publish_locked(app.handle(), &snapshot, false).unwrap();
        assert!(!initial.detached);
        let path = PathBuf::from(initial.projection_path);
        assert!(fs::read_to_string(&path)
            .unwrap()
            .contains("^msg_pi-assistant-1"));
        // Queued own-write observation compares current bytes under the same receipt boundary.
        assert!(!observe(notes.path(), "pi-1").unwrap());
        fs::write(&path, "My external edit").unwrap();
        snapshot.messages[0].content = "Later accepted answer".into();
        let detached = publish_locked(app.handle(), &snapshot, false).unwrap();
        assert_eq!(detached.conflict.as_deref(), Some("edited"));
        assert_eq!(fs::read_to_string(&path).unwrap(), "My external edit");
        assert!(publish_locked(app.handle(), &snapshot, true)
            .unwrap()
            .conflict
            .is_none());
        assert!(fs::read_to_string(&path)
            .unwrap()
            .contains("Later accepted answer"));
        fs::remove_file(&path).unwrap();
        assert_eq!(
            publish_locked(app.handle(), &snapshot, false)
                .unwrap()
                .conflict
                .as_deref(),
            Some("missing")
        );
        assert!(!path.exists());
        assert!(
            !publish_locked(app.handle(), &snapshot, true)
                .unwrap()
                .detached
        );
        crate::state::set_notes_root_override(None).unwrap();
    }
    #[test]
    fn unreceipted_legacy_looking_origin_cannot_be_overwritten_or_imported() {
        let dir = crate::test_support::TestDir::new("pi-transcript-foreign");
        let path = dir.path().join(relative("pi-1").unwrap());
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(
            &path,
            "---\ngneauxghts:\n  kind: chatTranscript\n  chat_id: pi-1\n---\nLegacy",
        )
        .unwrap();
        assert!(owner_for_path(dir.path(), &path).unwrap().is_none());
        let status = status_locked(dir.path(), "pi-1").unwrap();
        assert_eq!(status.conflict.as_deref(), Some("occupied"));
        assert!(owner_for_path(dir.path(), &path).unwrap().is_none());
    }
    #[test]
    fn passage_display_links_follow_current_identity_and_reject_replacements() {
        let dir = crate::test_support::TestDir::new("pi-transcript-sources");
        let source = dir.path().join("Moved source.md");
        fs::write(
            &source,
            crate::note::repair_managed_note_identity("Source body", "source-id").unwrap(),
        )
        .unwrap();
        let message:Message=serde_json::from_value(serde_json::json!({"id":"pi-assistant-1","role":"assistant","status":"completed",
            "content":"Claim [S1](passage:proof)","sources":[{"kind":"passage","noteId":"source-id","notePath":"/old/vault/Source.md","title":"Source","excerpt":"Source body",
                "passage":{"id":"proof","noteId":"source-id","contentHash":"hash","location":"body","start":0,"end":11,"excerpt":"Source body","revisions":[]}}]})).unwrap();
        let snapshot = Snapshot {
            conversation_id: "pi-1".into(),
            title: "Chat".into(),
            created_at_millis: 1,
            messages: vec![message],
            settled_origins: vec![],
        };
        let projected =
            render_with_lookup(dir.path(), &snapshot, |_| Some(source.clone())).unwrap();
        assert!(projected.contains("Claim [[Moved source|Source]]"));
        assert!(!projected.contains("passage:proof"));
        assert!(!projected.contains("/old/vault"));
        fs::write(
            &source,
            crate::note::repair_managed_note_identity("Replacement", "different-id").unwrap(),
        )
        .unwrap();
        let replaced = render_with_lookup(dir.path(), &snapshot, |_| Some(source.clone())).unwrap();
        assert!(replaced.contains("Source (source unavailable)"));
        assert!(!replaced.contains("[[Moved source|Source]]"));
        assert_eq!(snapshot.messages[0].content, "Claim [S1](passage:proof)");
    }
    #[test]
    fn classifications_preserve_external_content_and_missing_receipts() {
        assert_eq!(classify(None, Some("foreign")), Some("occupied".into()));
        assert_eq!(classify(Some(&hash("mine")), None), Some("missing".into()));
        assert_eq!(
            classify(Some(&hash("mine")), Some("edited")),
            Some("edited".into())
        );
        assert_eq!(classify(Some(&hash("mine")), Some("mine")), None);
    }
    #[test]
    fn receipt_failure_recovers_only_the_exact_prepared_publication() {
        let dir = crate::test_support::TestDir::new("pi-transcript-intent");
        let root = dir.path();
        let db = ledger(root).unwrap();
        let path = root.join(relative("pi-1").unwrap());
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        let snapshot = Snapshot {
            conversation_id: "pi-1".into(),
            title: "Test".into(),
            created_at_millis: 1,
            messages: vec![],
            settled_origins: vec![],
        };
        let markdown = render(root, &snapshot).unwrap();
        db.execute(
            "INSERT INTO projections(conversation_id,intent_hash,intent_markdown) VALUES(?1,?2,?3)",
            params!["pi-1", hash(&markdown), markdown],
        )
        .unwrap();
        fs::write(&path, &markdown).unwrap();
        recover_intent(&db, "pi-1", &path).unwrap();
        assert_eq!(record(&db, "pi-1").unwrap().0, Some(hash(&markdown)));
        fs::write(&path, "external").unwrap();
        recover_intent(&db, "pi-1", &path).unwrap();
        assert_eq!(fs::read_to_string(&path).unwrap(), "external");
        assert_eq!(
            classify(record(&db, "pi-1").unwrap().0.as_deref(), Some("external")),
            Some("edited".into())
        );
    }
}
