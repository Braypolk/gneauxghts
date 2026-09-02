use super::index_bridge::{
    read_indexed_note_from_path, remove_notes_index_entry, upsert_notes_index_entry,
};
use super::{current_time_millis, ForgottenNoteSummary, RestoredForgottenNote};
use crate::{
    chat::ChatService,
    index::{build_indexed_note, AppState},
    note,
    path_utils::unique_path_in_dir,
    services::note_timeline::{NoteIdentity, NoteLifecycleOperation, NoteTimeline},
    state::{
        forgotten_notes_root, read_state, read_unpruned_state, validate_current_path, write_state,
        write_unpruned_state, ForgottenItemKind, PersistedForgottenNote,
    },
};
use std::{
    collections::HashSet,
    ffi::OsStr,
    fs,
    path::{Path, PathBuf},
};
use tauri::State;

const FORGOTTEN_DAY_MILLIS: u64 = 24 * 60 * 60 * 1000;

#[tauri::command]
pub(crate) fn forget_note(
    state: State<'_, AppState>,
    current_path: Option<String>,
    retention_days: u32,
) -> Result<Option<ForgottenNoteSummary>, String> {
    let notes_dir = super::prepare_notes_dir_with_state(true, Some(&state))?;

    let current_path = validate_current_path(current_path, &notes_dir)?;
    let mut persisted_state = read_state(&notes_dir)?;

    if let Some(note_path) = current_path.as_ref() {
        validate_retention_days(retention_days)?;
        let previous_note = read_indexed_note_from_path(note_path)?;
        let forgotten_dir = forgotten_notes_root(&notes_dir);
        fs::create_dir_all(&forgotten_dir).map_err(|err| err.to_string())?;
        let forgotten_path = resolve_forgotten_target_path(&notes_dir, note_path);
        let forgotten_at_millis = current_time_millis()?;
        let forgotten_at_rfc3339 = note::current_timestamp_rfc3339()?;
        let purge_at_millis = forgotten_at_millis
            .saturating_add(u64::from(retention_days).saturating_mul(FORGOTTEN_DAY_MILLIS));
        let note_markdown = fs::read_to_string(note_path).map_err(|err| err.to_string())?;
        let (forgotten_markdown, note_id) =
            prepare_forgotten_note_markdown(&note_markdown, forgotten_at_rfc3339)?;

        if note_path.exists() {
            let expected_move = crate::vault_watcher::record_expected_move(
                note_path,
                &forgotten_path,
                &forgotten_markdown,
            );
            fs::rename(note_path, &forgotten_path).map_err(|err| err.to_string())?;
            fs::write(&forgotten_path, &forgotten_markdown).map_err(|err| err.to_string())?;
            expected_move.commit();
        }

        let raw_path = note_path.to_string_lossy().into_owned();
        NoteTimeline::new(&state).lifecycle(NoteLifecycleOperation::forgotten(
            NoteIdentity::new(note_id.clone()),
            note_path.clone(),
            forgotten_path.clone(),
            forgotten_at_millis,
        ));
        if persisted_state.last_opened_note_id.as_deref() == Some(note_id.as_str()) {
            persisted_state.last_opened_note_id = None;
        }
        persisted_state
            .recent_note_ids
            .retain(|existing_note_id| existing_note_id != &note_id);
        persisted_state
            .forgotten_notes
            .push(PersistedForgottenNote {
                note_id: Some(note_id.clone()),
                forgotten_path: forgotten_path.to_string_lossy().into_owned(),
                original_path: raw_path.clone(),
                title: previous_note
                    .as_ref()
                    .map(|note| note.title.clone())
                    .unwrap_or_else(|| {
                        note_path
                            .file_stem()
                            .unwrap_or_default()
                            .to_string_lossy()
                            .into_owned()
                    }),
                forgotten_at_millis,
                purge_after_days: retention_days,
                purge_at_millis,
                kind: ForgottenItemKind::Note,
                conversation_id: None,
            });
        state.semantic.queue_delete_note(note_path)?;
        let summary = build_forgotten_note_summary(
            persisted_state
                .forgotten_notes
                .last()
                .expect("forgotten note just inserted"),
        );
        write_state(&notes_dir, &persisted_state)?;
        remove_notes_index_entry(&state, note_path)?;
        return Ok(Some(summary));
    }

    write_state(&notes_dir, &persisted_state)?;
    Ok(None)
}

pub(super) fn register_forgotten_chat_folder(
    notes_dir: &Path,
    original_path: &Path,
    forgotten_path: &Path,
    title: &str,
    conversation_id: &str,
    retention_days: u32,
) -> Result<ForgottenNoteSummary, String> {
    validate_retention_days(retention_days)?;
    if !original_path.starts_with(notes_dir)
        || original_path.starts_with(forgotten_notes_root(notes_dir))
    {
        return Err("Forgotten note restore path is outside the notes directory".to_string());
    }
    if !forgotten_path.is_dir()
        || !forgotten_path.starts_with(forgotten_notes_root(notes_dir))
        || conversation_id.trim().is_empty()
    {
        return Err("Forgotten chat folder is invalid".to_string());
    }
    let forgotten_at_millis = current_time_millis()?;
    let purge_at_millis = forgotten_at_millis
        .saturating_add(u64::from(retention_days).saturating_mul(FORGOTTEN_DAY_MILLIS));

    let mut persisted_state = read_state(notes_dir)?;
    if persisted_state.last_chat_conversation_id.as_deref() == Some(conversation_id) {
        persisted_state.last_chat_conversation_id = None;
        persisted_state.last_chat_context_note_id = None;
        persisted_state.last_chat_context_note_path = None;
    }
    persisted_state
        .forgotten_notes
        .push(PersistedForgottenNote {
            note_id: None,
            forgotten_path: forgotten_path.to_string_lossy().into_owned(),
            original_path: original_path.to_string_lossy().into_owned(),
            title: title.to_string(),
            forgotten_at_millis,
            purge_after_days: retention_days,
            purge_at_millis,
            kind: ForgottenItemKind::Chat,
            conversation_id: Some(conversation_id.to_string()),
        });
    let summary = build_forgotten_note_summary(
        persisted_state
            .forgotten_notes
            .last()
            .expect("forgotten note just inserted"),
    );
    write_state(notes_dir, &persisted_state)?;
    Ok(summary)
}

#[tauri::command]
pub(crate) fn list_forgotten_notes(
    state: State<'_, AppState>,
) -> Result<Vec<ForgottenNoteSummary>, String> {
    let notes_dir = super::prepare_notes_dir_with_state(true, Some(&state))?;

    let mut forgotten_notes = read_state(&notes_dir)?.forgotten_notes;
    forgotten_notes.sort_by(|left, right| {
        right
            .forgotten_at_millis
            .cmp(&left.forgotten_at_millis)
            .then_with(|| left.title.cmp(&right.title))
    });

    Ok(forgotten_notes
        .iter()
        .map(build_forgotten_note_summary)
        .collect())
}

#[tauri::command]
pub(crate) fn restore_forgotten_notes(
    state: State<'_, AppState>,
    chat_service: State<'_, ChatService>,
    forgotten_paths: Vec<String>,
) -> Result<Vec<RestoredForgottenNote>, String> {
    let notes_dir = super::prepare_notes_dir_with_state(true, Some(&state))?;

    let selected_paths = validate_forgotten_path_inputs(forgotten_paths, &notes_dir)?;
    if selected_paths.is_empty() {
        return Ok(Vec::new());
    }

    let mut persisted_state = read_state(&notes_dir)?;
    let mut restored_notes = Vec::new();
    let mut index = 0usize;

    while index < persisted_state.forgotten_notes.len() {
        if !selected_paths.contains(&persisted_state.forgotten_notes[index].forgotten_path) {
            index += 1;
            continue;
        }

        let forgotten_note = persisted_state.forgotten_notes[index].clone();
        let forgotten_path = PathBuf::from(&forgotten_note.forgotten_path);
        let stored_item_exists = match forgotten_note.kind {
            ForgottenItemKind::Note => forgotten_path.is_file(),
            ForgottenItemKind::Chat => forgotten_path.is_dir(),
        };
        if !stored_item_exists {
            persisted_state.forgotten_notes.remove(index);
            write_state(&notes_dir, &persisted_state)?;
            continue;
        }

        let restored_path = match forgotten_note.kind {
            ForgottenItemKind::Note => {
                let restored_path = resolve_restore_target_path(
                    &notes_dir,
                    Path::new(&forgotten_note.original_path),
                );
                let markdown =
                    fs::read_to_string(&forgotten_path).map_err(|err| err.to_string())?;
                let restored_markdown =
                    note::prepare_note_markdown(&markdown, Some(&markdown), Some(None))?.0;
                let timestamp_millis = current_time_millis()?;
                let expected_move = crate::vault_watcher::record_expected_move(
                    &forgotten_path,
                    &restored_path,
                    &restored_markdown,
                );
                fs::rename(&forgotten_path, &restored_path).map_err(|err| err.to_string())?;
                fs::write(&restored_path, &restored_markdown).map_err(|err| err.to_string())?;
                expected_move.commit();

                if let Some(note_id) =
                    note::note_id_from_path_or_markdown(Some(&restored_path), &restored_markdown)
                {
                    NoteTimeline::new(&state).lifecycle(NoteLifecycleOperation::recovered(
                        NoteIdentity::new(note_id),
                        forgotten_path.clone(),
                        restored_path.clone(),
                        timestamp_millis,
                    ));
                }

                let note = build_indexed_note(&restored_path, &restored_markdown, timestamp_millis);
                upsert_notes_index_entry(&state, restored_path.clone(), note)?;
                state.semantic.queue_note_update(
                    &restored_path,
                    restored_markdown,
                    timestamp_millis,
                )?;
                restored_path
            }
            ForgottenItemKind::Chat => {
                let conversation_id = forgotten_note
                    .conversation_id
                    .as_deref()
                    .ok_or_else(|| "Forgotten chat is missing its conversation id".to_string())?;
                let original_path = PathBuf::from(&forgotten_note.original_path);
                let relocation = chat_service.restore_conversation_folder(
                    conversation_id,
                    &forgotten_path,
                    &original_path,
                )?;
                for path in &relocation.current_paths {
                    let markdown = fs::read_to_string(path).map_err(|error| error.to_string())?;
                    let note = build_indexed_note(path, &markdown, current_time_millis()?);
                    if let Err(error) = state.upsert_managed_chat_projection(path.clone(), note) {
                        eprintln!(
                            "restored chat projection index update failed for {}: {error}",
                            path.display()
                        );
                        let _ = state.mark_notes_index_dirty(path, "restored-chat-retry");
                    }
                }
                if let Err(error) =
                    super::chat_commands::sync_chat_recall(&chat_service, &state, conversation_id)
                {
                    eprintln!(
                        "restored chat semantic recall update failed for {conversation_id}: {error}"
                    );
                }
                original_path
            }
        };

        restored_notes.push(RestoredForgottenNote {
            forgotten_path: forgotten_note.forgotten_path,
            restored_path: restored_path.to_string_lossy().into_owned(),
            title: forgotten_note.title,
            kind: forgotten_item_kind_name(&forgotten_note.kind).to_string(),
            conversation_id: forgotten_note.conversation_id,
        });
        persisted_state.forgotten_notes.remove(index);
        write_state(&notes_dir, &persisted_state)?;
    }

    Ok(restored_notes)
}

#[tauri::command]
pub(crate) fn delete_forgotten_notes(
    state: State<'_, AppState>,
    chat_service: State<'_, ChatService>,
    forgotten_paths: Vec<String>,
) -> Result<(), String> {
    let notes_dir = super::prepare_notes_dir_with_state(true, Some(&state))?;

    let selected_paths = validate_forgotten_path_inputs(forgotten_paths, &notes_dir)?;
    if selected_paths.is_empty() {
        return Ok(());
    }

    let mut persisted_state = read_unpruned_state(&notes_dir)?;
    let mut index = 0usize;

    while index < persisted_state.forgotten_notes.len() {
        if !selected_paths.contains(&persisted_state.forgotten_notes[index].forgotten_path) {
            index += 1;
            continue;
        }

        let forgotten_note = persisted_state.forgotten_notes.remove(index);
        let forgotten_path = PathBuf::from(&forgotten_note.forgotten_path);
        let forgotten_note_id = forgotten_note_identity(&forgotten_note, &forgotten_path);
        if let Some(conversation_id) = forgotten_note.conversation_id.as_deref() {
            chat_service.delete_archived_conversation(conversation_id)?;
        }
        if forgotten_path.exists() {
            remove_forgotten_item_path(&forgotten_path, &forgotten_note.kind)?;
        }
        if let Some(note_id) = forgotten_note_id {
            NoteTimeline::new(&state).lifecycle(NoteLifecycleOperation::purged(
                note_id,
                forgotten_path,
                current_time_millis()?,
            ));
        }
        write_unpruned_state(&persisted_state)?;
    }

    Ok(())
}

fn validate_retention_days(retention_days: u32) -> Result<(), String> {
    match retention_days {
        1 | 7 | 30 => Ok(()),
        _ => Err("Unsupported forgotten note retention window".to_string()),
    }
}

fn prepare_forgotten_note_markdown(
    note_markdown: &str,
    forgotten_at_rfc3339: String,
) -> Result<(String, String), String> {
    let (forgotten_markdown, metadata) = note::prepare_note_markdown(
        note_markdown,
        Some(note_markdown),
        Some(Some(forgotten_at_rfc3339)),
    )?;
    Ok((forgotten_markdown, metadata.id))
}

pub(super) fn build_forgotten_note_summary(
    forgotten_note: &PersistedForgottenNote,
) -> ForgottenNoteSummary {
    ForgottenNoteSummary {
        forgotten_path: forgotten_note.forgotten_path.clone(),
        original_path: forgotten_note.original_path.clone(),
        title: forgotten_note.title.clone(),
        file_name: Path::new(&forgotten_note.original_path)
            .file_stem()
            .unwrap_or_else(|| OsStr::new("untitled"))
            .to_string_lossy()
            .into_owned(),
        forgotten_at_millis: forgotten_note.forgotten_at_millis,
        purge_after_days: forgotten_note.purge_after_days,
        purge_at_millis: forgotten_note.purge_at_millis,
        kind: forgotten_item_kind_name(&forgotten_note.kind).to_string(),
        conversation_id: forgotten_note.conversation_id.clone(),
    }
}

fn validate_forgotten_path_inputs(
    forgotten_paths: Vec<String>,
    notes_dir: &Path,
) -> Result<HashSet<String>, String> {
    let forgotten_root = forgotten_notes_root(notes_dir);
    let mut selected = HashSet::new();

    for raw_path in forgotten_paths {
        let path = PathBuf::from(&raw_path);
        if !path.starts_with(&forgotten_root) {
            return Err("Forgotten note path is outside the forgotten notes directory".to_string());
        }
        if path == forgotten_root {
            return Err("The forgotten items directory cannot be selected".to_string());
        }
        selected.insert(raw_path);
    }

    Ok(selected)
}

pub(super) fn resolve_forgotten_target_path(notes_dir: &Path, original_path: &Path) -> PathBuf {
    unique_path_in_dir(
        &forgotten_notes_root(notes_dir),
        original_path
            .file_name()
            .unwrap_or_else(|| OsStr::new("Untitled Note.md")),
        "Untitled Note",
    )
}

fn resolve_restore_target_path(notes_dir: &Path, original_path: &Path) -> PathBuf {
    if original_path.parent() == Some(notes_dir) && !original_path.exists() {
        return original_path.to_path_buf();
    }

    unique_path_in_dir(
        notes_dir,
        original_path
            .file_name()
            .unwrap_or_else(|| OsStr::new("Untitled Note.md")),
        "Untitled Note",
    )
}

pub(super) fn cleanup_expired_forgotten_notes(
    notes_dir: &Path,
    state: &AppState,
) -> Result<(), String> {
    let now = current_time_millis()?;
    let mut persisted_state = read_unpruned_state(notes_dir)?;
    let original_len = persisted_state.forgotten_notes.len();
    let mut kept_notes = Vec::with_capacity(original_len);

    for forgotten_note in persisted_state.forgotten_notes.drain(..) {
        let forgotten_path = PathBuf::from(&forgotten_note.forgotten_path);
        if forgotten_note.purge_at_millis <= now {
            let forgotten_note_id = forgotten_note_identity(&forgotten_note, &forgotten_path);
            if let Some(conversation_id) = forgotten_note.conversation_id.as_deref() {
                ChatService::delete_persisted_conversation(
                    &crate::state::vault_data_dir()?,
                    conversation_id,
                )?;
            }
            if forgotten_path.exists() {
                remove_forgotten_item_path(&forgotten_path, &forgotten_note.kind)?;
            }
            if let Some(note_id) = forgotten_note_id {
                NoteTimeline::new(state).lifecycle(NoteLifecycleOperation::purged(
                    note_id,
                    forgotten_path,
                    now,
                ));
            }
            continue;
        }
        kept_notes.push(forgotten_note);
    }

    if kept_notes.len() != original_len {
        persisted_state.forgotten_notes = kept_notes;
        write_unpruned_state(&persisted_state)?;
    }

    Ok(())
}

fn forgotten_note_identity(
    forgotten_note: &PersistedForgottenNote,
    forgotten_path: &Path,
) -> Option<NoteIdentity> {
    if forgotten_note.kind != ForgottenItemKind::Note {
        return None;
    }
    if let Some(note_id) = forgotten_note
        .note_id
        .as_deref()
        .filter(|note_id| !note_id.trim().is_empty())
    {
        return Some(NoteIdentity::new(note_id));
    }
    let markdown = fs::read_to_string(forgotten_path).ok()?;
    note::note_id_from_path_or_markdown(Some(forgotten_path), &markdown).map(NoteIdentity::new)
}

fn forgotten_item_kind_name(kind: &ForgottenItemKind) -> &'static str {
    match kind {
        ForgottenItemKind::Note => "note",
        ForgottenItemKind::Chat => "chat",
    }
}

fn remove_forgotten_item_path(path: &Path, kind: &ForgottenItemKind) -> Result<(), String> {
    match kind {
        ForgottenItemKind::Note => fs::remove_file(path).map_err(|error| error.to_string()),
        ForgottenItemKind::Chat => fs::remove_dir_all(path).map_err(|error| error.to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        state::set_notes_root_override,
        test_support::{lock_test_env, TestDir},
    };

    #[test]
    fn chat_folder_uses_the_forgotten_item_recovery_lifecycle() {
        let _guard = lock_test_env();
        let root = TestDir::new("forgotten-chat-folder");
        set_notes_root_override(Some(root.path().to_path_buf())).expect("override notes root");
        let original_path = root.path().join("Chats").join("2026-07-28-chat");
        let forgotten_path = root.path().join(".forgotten").join("2026-07-28-chat");
        fs::create_dir_all(&forgotten_path).expect("create forgotten chat folder");
        fs::write(forgotten_path.join("Conversation.md"), "# Release planning")
            .expect("write conversation index");
        fs::write(forgotten_path.join("Part 001.md"), "## You\n\nShip it")
            .expect("write transcript part");

        let summary = register_forgotten_chat_folder(
            root.path(),
            &original_path,
            &forgotten_path,
            "Release planning",
            "conversation-1",
            7,
        )
        .expect("register forgotten chat folder");

        assert!(forgotten_path.starts_with(root.path().join(".forgotten")));
        assert!(forgotten_path.is_dir());
        assert_eq!(summary.original_path, original_path.to_string_lossy());
        assert_eq!(summary.purge_after_days, 7);
        assert_eq!(summary.kind, "chat");
        assert_eq!(summary.conversation_id.as_deref(), Some("conversation-1"));

        let persisted_state = read_state(root.path()).expect("read forgotten note state");
        assert_eq!(persisted_state.forgotten_notes.len(), 1);
        assert_eq!(
            persisted_state.forgotten_notes[0].forgotten_path,
            forgotten_path.to_string_lossy()
        );
        assert_eq!(
            persisted_state.forgotten_notes[0].kind,
            ForgottenItemKind::Chat
        );

        set_notes_root_override(None).expect("clear notes root override");
    }

    #[test]
    fn expired_chat_folder_deletes_the_archive_and_conversation_history() {
        let _guard = lock_test_env();
        let root = TestDir::new("expired-forgotten-chat-folder");
        set_notes_root_override(Some(root.path().to_path_buf())).expect("override notes root");
        let data_dir = root.path().join(".gneauxghts");
        fs::create_dir_all(&data_dir).expect("create vault data");
        let service =
            ChatService::new(root.path().to_path_buf(), data_dir).expect("create chat service");
        let conversation = service
            .create_conversation(Some("Temporary chat".to_string()), None)
            .expect("create conversation");
        let snapshot = service
            .forgotten_folder_snapshot(&conversation.summary.id)
            .expect("load folder snapshot");
        let forgotten_root = forgotten_notes_root(root.path());
        fs::create_dir_all(&forgotten_root).expect("create forgotten root");
        let forgotten_path = resolve_forgotten_target_path(root.path(), &snapshot.original_path);
        service
            .archive_conversation_folder(&conversation.summary.id, &forgotten_path)
            .expect("archive conversation folder");
        register_forgotten_chat_folder(
            root.path(),
            &snapshot.original_path,
            &forgotten_path,
            &snapshot.title,
            &conversation.summary.id,
            1,
        )
        .expect("register forgotten chat");

        let mut persisted_state = read_state(root.path()).expect("read forgotten state");
        persisted_state.forgotten_notes[0].forgotten_at_millis = 0;
        persisted_state.forgotten_notes[0].purge_at_millis = 0;
        write_state(root.path(), &persisted_state).expect("expire forgotten chat");

        let app_data = TestDir::new("expired-forgotten-chat-app-data");
        crate::state::initialize_app_data_dir(app_data.path().to_path_buf())
            .expect("initialize app data");
        let state = AppState::new(
            crate::semantic::SemanticState::new_disabled("disabled"),
            crate::app::EventBus::disabled(),
        )
        .expect("construct app state");
        cleanup_expired_forgotten_notes(root.path(), &state).expect("clean up expired chat");

        assert!(!forgotten_path.exists());
        assert!(service.get_conversation(&conversation.summary.id).is_err());
        assert!(read_state(root.path())
            .expect("read cleaned state")
            .forgotten_notes
            .is_empty());

        set_notes_root_override(None).expect("clear notes root override");
    }

    #[test]
    fn persisted_identity_survives_an_unreadable_forgotten_note() {
        let forgotten_note = PersistedForgottenNote {
            forgotten_path: "/vault/.forgotten/Missing.md".to_string(),
            original_path: "/vault/Missing.md".to_string(),
            title: "Missing".to_string(),
            forgotten_at_millis: 10,
            purge_after_days: 7,
            purge_at_millis: 20,
            kind: ForgottenItemKind::Note,
            conversation_id: None,
            note_id: Some("forgotten-note-1".to_string()),
        };

        assert_eq!(
            forgotten_note_identity(&forgotten_note, Path::new(&forgotten_note.forgotten_path)),
            Some(NoteIdentity::new("forgotten-note-1"))
        );
    }

    #[test]
    fn forgetting_an_unmanaged_note_uses_the_generated_managed_identity() {
        let (forgotten_markdown, note_id) = prepare_forgotten_note_markdown(
            "# Existing note\n\nBody",
            "2026-09-01T12:00:00.000Z".to_string(),
        )
        .expect("prepare forgotten note");

        assert!(!note_id.is_empty());
        assert_eq!(
            note::parse_note(&forgotten_markdown)
                .frontmatter
                .managed
                .map(|metadata| metadata.id),
            Some(note_id)
        );
    }

    #[test]
    fn forget_and_recovery_preserve_the_same_managed_note_identity() {
        let original =
            "---\ngneauxghts:\n  id: lifecycle-note-1\n  kind: note\n---\n\nLifecycle body";
        let (forgotten_markdown, forgotten_id) =
            prepare_forgotten_note_markdown(original, "2026-09-01T12:00:00.000Z".to_string())
                .expect("prepare forgotten note");
        let restored_markdown =
            note::prepare_note_markdown(&forgotten_markdown, Some(&forgotten_markdown), Some(None))
                .expect("prepare recovered note")
                .0;

        assert_eq!(forgotten_id, "lifecycle-note-1");
        assert_eq!(
            note::note_id_from_path_or_markdown(None, &restored_markdown).as_deref(),
            Some("lifecycle-note-1")
        );
        assert!(note::parse_note(&restored_markdown)
            .frontmatter
            .managed
            .expect("managed metadata")
            .trashed_at
            .is_none());
    }
}
