use super::NoteSession;
use crate::{
    index::AppState,
    note,
    state::{
        db_mark_note_opened, db_prune_note_navigation, db_record_session_restore,
        db_touch_note_activity, is_valid_note_path, read_state_with_lookup,
        resolve_note_path_by_id, touch_recent_note_id, validate_current_path, NoteIdLookup,
        NoteIdPathResolver, PersistedState,
    },
    time::current_time_millis,
};
use std::{fs, path::Path, path::PathBuf};

fn lookup_path_in_index(state: &AppState, note_id: &str) -> Option<PathBuf> {
    state
        .notes_index
        .lock()
        .ok()
        .and_then(|index| index.path_for_note_id(note_id).cloned())
}

struct AppStateNoteIdResolver<'a> {
    state: &'a AppState,
}

impl NoteIdPathResolver for AppStateNoteIdResolver<'_> {
    fn path_for_note_id(&self, note_id: &str) -> Option<PathBuf> {
        self.state
            .notes_index
            .lock()
            .ok()
            .and_then(|index| index.path_for_note_id(note_id).cloned())
    }
}

struct NoteSessionLookup<'a> {
    resolver: Option<AppStateNoteIdResolver<'a>>,
    is_warm: bool,
}

impl<'a> NoteSessionLookup<'a> {
    fn new(app_state: Option<&'a AppState>) -> Self {
        Self {
            resolver: app_state.map(|state| AppStateNoteIdResolver { state }),
            is_warm: app_state
                .map(|state| state.has_warm_notes_index())
                .unwrap_or(false),
        }
    }

    fn strategy(&self) -> NoteIdLookup<'_> {
        match self.resolver.as_ref() {
            Some(resolver) => NoteIdLookup::Index {
                resolver,
                is_warm: self.is_warm,
            },
            None => NoteIdLookup::Disk,
        }
    }
}

/// Reuse the running catalog for UI-state pruning. A cold catalog retains
/// unknown ids; a warm catalog still validates each resolved note path.
pub(super) fn read_state_with_app_index(
    notes_dir: &Path,
    app_state: Option<&AppState>,
) -> Result<PersistedState, String> {
    let lookup_owner = NoteSessionLookup::new(app_state);
    read_state_with_lookup(notes_dir, &lookup_owner.strategy())
}

pub(super) fn resolve_note_path_by_id_with_state(
    state: Option<&AppState>,
    notes_dir: &Path,
    note_id: &str,
) -> Result<Option<PathBuf>, String> {
    if let Some(state) = state {
        if let Some(path) = lookup_path_in_index(state, note_id) {
            if is_valid_note_path(&path, notes_dir)
                && path_matches_note_identity(&path, note_id, Some(state))?
            {
                return Ok(Some(path));
            }
        }
    }
    let path = resolve_note_path_by_id(notes_dir, note_id)?;
    match path {
        Some(path) if path_matches_note_identity(&path, note_id, state)? => Ok(Some(path)),
        _ => Ok(None),
    }
}

/// A path is a hint when the caller retains a logical identity. A distinct
/// embedded identity displaces it; missing metadata can retain established
/// catalog ownership only at the location still admitted by Note Timeline.
fn markdown_matches_note_identity(
    path: &Path,
    markdown: &str,
    note_id: &str,
    state: Option<&AppState>,
) -> Result<bool, String> {
    if let Some(managed) = note::parse_note(markdown)
        .frontmatter
        .managed
        .filter(|managed| !managed.id.trim().is_empty())
    {
        return Ok(managed.id == note_id);
    }
    if let Some(state) = state {
        if let Some(owner) = state.indexed_note_identity(path)? {
            return Ok(owner == note_id
                && state
                    .note_timeline()
                    .admits_retained_note_location(
                        &crate::services::note_timeline::NoteIdentity::new(note_id),
                        path,
                    )
                    .map_err(|error| error.to_string())?);
        }
    }
    Ok(note::note_id_from_path_or_markdown(Some(path), markdown).as_deref() == Some(note_id))
}

fn path_matches_note_identity(
    path: &Path,
    note_id: &str,
    state: Option<&AppState>,
) -> Result<bool, String> {
    match fs::read_to_string(path) {
        Ok(markdown) => markdown_matches_note_identity(path, &markdown, note_id, state),
        Err(_) => Ok(false),
    }
}

fn clear_stale_last_opened_note(state: &mut crate::state::PersistedState, note_id: &str) {
    state.last_opened_note_id = None;
    state
        .recent_note_ids
        .retain(|recent_note_id| recent_note_id != note_id);
}

fn touch_note_activity(note_id: &str, count_as_open: bool) {
    if let Ok(now) = current_time_millis() {
        let _ = db_touch_note_activity(note_id, now, count_as_open);
    }
}

fn open_ui_state_already_primary(state: &PersistedState, note_id: &str) -> bool {
    let normalized = note_id.trim();
    if normalized.is_empty() {
        return false;
    }

    state.last_opened_note_id.as_deref() == Some(normalized)
        && state
            .recent_note_ids
            .first()
            .is_some_and(|recent_id| recent_id == normalized)
}

#[cfg(test)]
pub(crate) fn load_note_session_from_notes_dir(notes_dir: &Path) -> Result<NoteSession, String> {
    load_note_session_from_notes_dir_with_state(notes_dir, None)
}

pub(crate) fn load_note_session_from_notes_dir_with_state(
    notes_dir: &Path,
    app_state: Option<&AppState>,
) -> Result<NoteSession, String> {
    let mut persisted = read_state_with_app_index(notes_dir, app_state)?;
    let Some(last_opened_note_id) = persisted.last_opened_note_id.clone() else {
        return Ok(NoteSession::default());
    };

    let Some(note_path) =
        resolve_note_path_by_id_with_state(app_state, notes_dir, &last_opened_note_id)?
    else {
        clear_stale_last_opened_note(&mut persisted, &last_opened_note_id);
        db_prune_note_navigation(std::slice::from_ref(&last_opened_note_id))?;
        return Ok(NoteSession::default());
    };
    if !is_valid_note_path(&note_path, notes_dir) {
        clear_stale_last_opened_note(&mut persisted, &last_opened_note_id);
        db_prune_note_navigation(std::slice::from_ref(&last_opened_note_id))?;
        return Ok(NoteSession::default());
    }

    touch_recent_note_id(&mut persisted, last_opened_note_id.clone());
    // Session restore updates last-viewed without counting as a fresh open,
    // so access frequency reflects intentional note switches.
    touch_note_activity(&last_opened_note_id, false);
    // Row-scoped write of the recents/last-opened only — same rationale as
    // mark_note_opened.
    db_record_session_restore(&last_opened_note_id)?;
    read_note_session_from_path_with_identity(&note_path, Some(&last_opened_note_id), app_state)
}

#[cfg(test)]
pub(crate) fn open_note_from_notes_dir(
    notes_dir: &Path,
    note_id: Option<String>,
    path: Option<String>,
) -> Result<NoteSession, String> {
    open_note_from_notes_dir_with_state(notes_dir, note_id, path, None)
}

pub(crate) fn open_note_from_notes_dir_with_state(
    notes_dir: &Path,
    note_id: Option<String>,
    path: Option<String>,
    app_state: Option<&AppState>,
) -> Result<NoteSession, String> {
    let session = read_note_session_from_notes_dir_with_state(notes_dir, note_id, path, app_state)?;
    let resolved_note_id = session
        .note_id
        .clone()
        .filter(|id| !id.trim().is_empty())
        .ok_or_else(|| "Unable to determine note id".to_string())?;

    let persisted = read_state_with_app_index(notes_dir, app_state)?;
    if open_ui_state_already_primary(&persisted, &resolved_note_id) {
        return Ok(session);
    }

    if let Some(note_id) = session.note_id.as_deref() {
        touch_note_activity(note_id, true);
    }
    // Row-scoped write: only the last_opened_note_id and recents change here.
    // Avoid the full app_state rewrite that previously fired on every note
    // switch and contended with concurrent open/save under rapid switching.
    db_mark_note_opened(&resolved_note_id)?;

    Ok(session)
}

pub(crate) fn read_note_session_from_notes_dir_with_state(
    notes_dir: &Path,
    note_id: Option<String>,
    path: Option<String>,
    app_state: Option<&AppState>,
) -> Result<NoteSession, String> {
    let note_id = note_id.filter(|id| !id.trim().is_empty());
    let note_path =
        resolve_note_path_input_with_state(notes_dir, note_id.clone(), path, app_state)?;
    read_note_session_from_path_with_identity(&note_path, note_id.as_deref(), app_state)
}

#[cfg(test)]
pub(crate) fn read_note_session_from_path(note_path: &Path) -> Result<NoteSession, String> {
    read_note_session_from_path_with_identity(note_path, None, None)
}

fn read_note_session_from_path_with_identity(
    note_path: &Path,
    expected_identity: Option<&str>,
    app_state: Option<&AppState>,
) -> Result<NoteSession, String> {
    let markdown = fs::read_to_string(note_path).map_err(|err| err.to_string())?;
    if let Some(identity) = expected_identity {
        if !markdown_matches_note_identity(note_path, &markdown, identity, app_state)? {
            return Err("Note identity changed while reading; refresh its current location".into());
        }
    }
    let fallback_title = note_path
        .file_stem()
        .unwrap_or_default()
        .to_string_lossy()
        .into_owned();
    let (title, body) = note::extract_file_name_title_and_body(&markdown, &fallback_title);
    let note_id = expected_identity
        .map(str::to_owned)
        .or_else(|| note::note_id_from_path_or_markdown(Some(note_path), &markdown));
    let tags = crate::tags::read_tags(&markdown);
    Ok(NoteSession {
        tags: tags.clone().unwrap_or_default(),
        tags_error: tags.err(),
        note_id,
        title,
        markdown: body,
        path: Some(note_path.to_string_lossy().into_owned()),
        commit_warning: None,
    })
}

pub(crate) fn resolve_note_path_input_with_state(
    notes_dir: &Path,
    note_id: Option<String>,
    path: Option<String>,
    app_state: Option<&AppState>,
) -> Result<PathBuf, String> {
    let note_id = note_id.filter(|id| !id.trim().is_empty());
    let path = path
        .filter(|value| !value.trim().is_empty())
        .map(|value| resolve_note_path_reference(notes_dir, value))
        .transpose()?;
    if let Some(note_path) = validate_current_path(
        path.map(|value| value.to_string_lossy().into_owned()),
        notes_dir,
    )? {
        match note_id.as_deref() {
            None => return Ok(note_path),
            Some(id) if path_matches_note_identity(&note_path, id, app_state)? => {
                return Ok(note_path)
            }
            Some(_) => {}
        }
        // A supplied identity remains authoritative when its former path is
        // absent, occupied by another note, or no longer its durable location.
    }

    if let Some(note_id) = note_id {
        return resolve_note_path_by_id_with_state(app_state, notes_dir, &note_id)?
            .ok_or_else(|| "Missing note path".to_string());
    }

    Err("Missing note path".to_string())
}

fn resolve_note_path_reference(notes_dir: &Path, value: String) -> Result<PathBuf, String> {
    let path = PathBuf::from(value);
    if path.is_absolute() {
        return Ok(path);
    }
    if path.components().any(|component| {
        matches!(
            component,
            std::path::Component::ParentDir
                | std::path::Component::RootDir
                | std::path::Component::Prefix(_)
        )
    }) {
        return Err("Current note path is outside the notes directory".to_string());
    }
    Ok(notes_dir.join(path))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        services::note_timeline::{MutationSource, NoteIdentity},
        test_support::TestVault,
    };

    fn saved(fixture: &TestVault) -> (PathBuf, String, String) {
        let result = fixture
            .state
            .note_timeline()
            .save_note(MutationSource::Editor, "Original", "Original body", None)
            .unwrap()
            .unwrap();
        (
            result.path().to_path_buf(),
            result.note_id().as_str().into(),
            result.canonical_markdown().into(),
        )
    }

    fn rename(fixture: &TestVault, source: &Path, destination: &Path, identity: &str, raw: &str) {
        fixture
            .state
            .note_timeline()
            .rename_note_with_proof(
                source,
                destination,
                &NoteIdentity::new(identity),
                &crate::semantic::db::content_hash(raw),
                &|_| Ok(()),
            )
            .unwrap();
    }

    #[test]
    fn identity_reads_and_opens_follow_rename_when_old_path_is_a_foreign_note() {
        let fixture = TestVault::new("session-rename-foreign-path");
        let (source, identity, raw) = saved(&fixture);
        let destination = fixture.notes.path().join("Renamed.md");
        rename(&fixture, &source, &destination, &identity, &raw);
        let foreign = note::prepare_note_markdown("Foreign body", None, Some(None))
            .unwrap()
            .0;
        fs::write(&source, &foreign).unwrap();
        for state in [None, Some(fixture.state.as_ref())] {
            let resolved = resolve_note_path_input_with_state(
                fixture.notes.path(),
                Some(identity.clone()),
                Some(source.to_string_lossy().into()),
                state,
            )
            .unwrap();
            assert_eq!(
                resolved, destination,
                "a supplied identity owns the read, not its former path hint"
            );
            let read = read_note_session_from_notes_dir_with_state(
                fixture.notes.path(),
                Some(identity.clone()),
                Some(source.to_string_lossy().into()),
                state,
            )
            .unwrap();
            assert_eq!(read.note_id.as_deref(), Some(identity.as_str()));
            assert_eq!(
                read.path.as_deref(),
                Some(destination.to_string_lossy().as_ref())
            );
            assert_eq!(read.markdown, "Original body");
            let opened = open_note_from_notes_dir_with_state(
                fixture.notes.path(),
                Some(identity.clone()),
                Some(source.to_string_lossy().into()),
                state,
            )
            .unwrap();
            assert_eq!(opened.note_id.as_deref(), Some(identity.as_str()));
            assert_eq!(opened.markdown, "Original body");
        }
        assert!(
            read_note_session_from_path_with_identity(
                &source,
                Some(&identity),
                Some(&fixture.state)
            )
            .is_err(),
            "a replacement after path resolution must fail closed at the read boundary"
        );
        assert_eq!(fs::read_to_string(&source).unwrap(), foreign);
        assert_eq!(fs::read_to_string(&destination).unwrap(), raw);
        let path_only = open_note_from_notes_dir_with_state(
            fixture.notes.path(),
            None,
            Some(source.to_string_lossy().into()),
            Some(&fixture.state),
        )
        .unwrap();
        assert_eq!(
            path_only.markdown, "Foreign body",
            "path-only navigation still opens that exact file"
        );
    }

    #[test]
    fn warm_index_cannot_rebind_renamed_identity_to_managed_or_unmanaged_old_path_replacement() {
        for managed_replacement in [false, true] {
            let fixture = TestVault::new("session-rename-stale-index");
            let (source, identity, raw) = saved(&fixture);
            fixture
                .state
                .prewarm_notes_index(fixture.notes.path())
                .unwrap();
            assert!(fixture.state.has_warm_notes_index());
            let stale = crate::index::build_indexed_note(&source, &raw, 0);
            let destination = fixture.notes.path().join("Renamed.md");
            rename(&fixture, &source, &destination, &identity, &raw);
            let foreign = if managed_replacement {
                note::prepare_note_markdown("Foreign body", None, Some(None))
                    .unwrap()
                    .0
            } else {
                "Unmanaged replacement".into()
            };
            fs::write(&source, &foreign).unwrap();
            {
                let mut index = fixture.state.notes_index.lock().unwrap();
                index.remove_note(&destination);
                index.upsert_note(source.clone(), stale);
                assert_eq!(index.path_for_note_id(&identity), Some(&source));
            }
            let resolved = resolve_note_path_by_id_with_state(
                Some(&fixture.state),
                fixture.notes.path(),
                &identity,
            )
            .unwrap();
            assert_eq!(resolved.as_deref(), Some(destination.as_path()));
            let opened = open_note_from_notes_dir_with_state(
                fixture.notes.path(),
                Some(identity.clone()),
                Some(source.to_string_lossy().into()),
                Some(&fixture.state),
            )
            .unwrap();
            assert_eq!(opened.note_id.as_deref(), Some(identity.as_str()));
            assert_eq!(
                opened.path.as_deref(),
                Some(destination.to_string_lossy().as_ref())
            );
            assert_eq!(opened.markdown, "Original body");
            assert_eq!(fs::read_to_string(source).unwrap(), foreign);
            assert_eq!(fs::read_to_string(destination).unwrap(), raw);
        }
    }

    #[test]
    fn identity_read_keeps_metadata_loss_continuity_at_its_current_catalog_and_history_location() {
        let fixture = TestVault::new("session-current-metadata-loss");
        let (source, identity, _) = saved(&fixture);
        let without_metadata = "External edit without managed metadata";
        fs::write(&source, without_metadata).unwrap();
        let read = read_note_session_from_notes_dir_with_state(
            fixture.notes.path(),
            Some(identity.clone()),
            Some(source.to_string_lossy().into()),
            Some(&fixture.state),
        )
        .unwrap();
        assert_eq!(read.note_id.as_deref(), Some(identity.as_str()));
        assert_eq!(read.markdown, without_metadata);
        let opened = open_note_from_notes_dir_with_state(
            fixture.notes.path(),
            Some(identity.clone()),
            None,
            Some(&fixture.state),
        )
        .unwrap();
        assert_eq!(opened.note_id.as_deref(), Some(identity.as_str()));
        assert_eq!(
            opened.path.as_deref(),
            Some(source.to_string_lossy().as_ref())
        );
        assert_eq!(
            fs::read_to_string(&source).unwrap(),
            without_metadata,
            "ordinary reads do not repair canonical bytes"
        );
    }
}
