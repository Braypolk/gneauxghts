//! Read-only native tools and immutable source receipts. No model argument grants access.
use super::authority::{
    opaque_id, AuthoritySnapshot, AuthorityStore, DomainError, DomainResult, ReadMode, ReadPolicy,
};
use crate::{
    index::AppState,
    services::note_timeline::{
        AllowedScope, CanonicalNoteRead, CurrentContentIdentity, CurrentContentItem, NoteIdentity,
        RevisionCitation,
    },
};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::{collections::HashSet, path::PathBuf};
use tauri::Manager;

#[cfg(test)]
thread_local! {
    static AFTER_CANONICAL_READ: std::cell::RefCell<Option<Box<dyn FnOnce()>>> = Default::default();
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub(crate) enum ReadState {
    Revision {
        revision: RevisionCitation,
        #[serde(rename = "contentHash")]
        content_hash: String,
    },
    Observed {
        #[serde(rename = "contentHash")]
        content_hash: String,
        #[serde(rename = "observedAtMillis")]
        observed_at_millis: u64,
    },
}
#[derive(Clone, Debug, Deserialize, Serialize)]
pub(crate) struct SourceLocation {
    pub quote: String,
}
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ReadSource {
    pub source_id: String,
    pub note_id: String,
    pub title: String,
    pub read_state: ReadState,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub location: Option<SourceLocation>,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct NoteRead {
    pub markdown: String,
    pub source: ReadSource,
}
/// Private exact file proof for publication; never serialized into model output.
pub(crate) struct ReadReceipt {
    pub source: ReadSource,
    pub raw_base_hash: String,
    pub canonical_path: PathBuf,
}

fn unavailable() -> DomainError {
    DomainError::new(
        "unavailable_note",
        "Note is unavailable or outside this conversation's allowed notes.",
    )
}
fn stale() -> DomainError {
    DomainError::new(
        "stale_read",
        "Current notes changed during the read. Read the note again.",
    )
}
fn timeline_error(_: impl std::fmt::Display) -> DomainError {
    DomainError::new(
        "note_read",
        "Canonical note read is unavailable. Retry after notes finish updating.",
    )
}
fn validate_selector(id: &str) -> DomainResult<()> {
    if id.is_empty()
        || id.len() > 512
        || id.chars().any(char::is_control)
        || id.contains('/')
        || id.contains('\\')
        || id == "."
        || id == ".."
    {
        return Err(DomainError::new(
            "invalid_note",
            "Use an exact Note Identity returned by search, not a path.",
        ));
    }
    Ok(())
}
pub(crate) fn allows_read(snapshot: &AuthoritySnapshot, note_id: &str) -> bool {
    snapshot.read.mode == ReadMode::FullVault
        || snapshot
            .read
            .attached_note_ids
            .iter()
            .any(|id| id == note_id)
}
fn schema(connection: &Connection) -> DomainResult<()> {
    connection.execute_batch("CREATE TABLE IF NOT EXISTS pi_chat_read_sources (
        source_id TEXT PRIMARY KEY, authority_id TEXT NOT NULL REFERENCES pi_chat_authorities(authority_id),
        source_json TEXT NOT NULL, raw_base_hash TEXT NOT NULL, canonical_path TEXT NOT NULL);")?;
    Ok(())
}
pub(crate) fn scope(
    connection: &Connection,
    snapshot: &AuthoritySnapshot,
) -> DomainResult<AllowedScope> {
    let mut statement = connection
        .prepare("SELECT note_id FROM chat_note_policies WHERE disposition='excluded'")?;
    let excluded = statement
        .query_map([], |row| row.get::<_, String>(0))?
        .collect::<Result<HashSet<_>, _>>()?;
    let attached = (snapshot.read.mode == ReadMode::AttachedNotesOnly)
        .then(|| snapshot.read.attached_note_ids.iter().cloned().collect());
    Ok(AllowedScope::policy(attached.as_ref(), &excluded))
}

/// Caller holds AuthorityStore::with_authority. No current-file hash check: an
/// issued source remains historical after an edit. Publication checks raw proof.
pub(crate) fn receipt_in(
    connection: &Connection,
    snapshot: &AuthoritySnapshot,
    source_id: &str,
) -> DomainResult<ReadReceipt> {
    schema(connection)?;
    let row: Option<(String, String, String)> = connection.query_row(
        "SELECT source_json,raw_base_hash,canonical_path FROM pi_chat_read_sources WHERE source_id=?1 AND authority_id=?2",
        params![source_id, snapshot.authority_id], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?))).optional()?;
    let (json, raw_base_hash, path) = row.ok_or_else(|| {
        DomainError::new(
            "unknown_source",
            "This source was not issued to this conversation.",
        )
    })?;
    let source: ReadSource = serde_json::from_str(&json)
        .map_err(|_| DomainError::new("storage", "Read source metadata is unavailable."))?;
    if !allows_read(snapshot, &source.note_id)
        || AuthorityStore::excluded_in(connection, &source.note_id)?
    {
        return Err(unavailable());
    }
    Ok(ReadReceipt {
        source,
        raw_base_hash,
        canonical_path: path.into(),
    })
}

/// Host attachment admission checks saved canonical identity, never editor data.
pub(crate) fn validate_attachments(
    state: &AppState,
    store: &AuthorityStore,
    read: &ReadPolicy,
) -> DomainResult<()> {
    for id in &read.attached_note_ids {
        validate_selector(id)?;
        if store.is_excluded(id)? {
            return Err(unavailable());
        }
        state
            .note_timeline()
            .current_content(AllowedScope::vault())
            .read_note(&NoteIdentity::new(id))
            .map_err(|_| unavailable())?;
    }
    Ok(())
}
pub(crate) fn validate_source_note(
    state: &AppState,
    snapshot: &AuthoritySnapshot,
    connection: &Connection,
    note_id: &str,
) -> DomainResult<()> {
    source_navigation_note(state, snapshot, connection, note_id).map(|_| ())
}
pub(crate) fn source_navigation_note(
    state: &AppState,
    snapshot: &AuthoritySnapshot,
    connection: &Connection,
    note_id: &str,
) -> DomainResult<PathBuf> {
    source_navigation_content(state, snapshot, connection, note_id).map(|read| read.path)
}
pub(crate) fn source_navigation_content(
    state: &AppState,
    snapshot: &AuthoritySnapshot,
    connection: &Connection,
    note_id: &str,
) -> DomainResult<CanonicalNoteRead> {
    if !allows_read(snapshot, note_id) || AuthorityStore::excluded_in(connection, note_id)? {
        return Err(unavailable());
    }
    let read = state
        .note_timeline()
        .current_content(scope(connection, snapshot)?)
        .read_note(&NoteIdentity::new(note_id))
        .map_err(|_| unavailable())?;
    Ok(read)
}

#[cfg(test)]
pub(crate) fn read_note(
    state: &AppState,
    store: &AuthorityStore,
    authority_id: &str,
    note_id: &str,
) -> DomainResult<NoteRead> {
    read_note_at(state, store, authority_id, note_id, None)
}
pub(crate) fn read_note_at(
    state: &AppState,
    store: &AuthorityStore,
    authority_id: &str,
    note_id: &str,
    quote: Option<&str>,
) -> DomainResult<NoteRead> {
    validate_selector(note_id)?;
    let lease = store.lease(authority_id)?;
    let allowed = store.with_authority(
        authority_id,
        Some(lease.snapshot.revision),
        |connection, snapshot| {
            if !allows_read(snapshot, note_id) || AuthorityStore::excluded_in(connection, note_id)?
            {
                return Err(unavailable());
            }
            scope(connection, snapshot)
        },
    )?;
    let timeline = state.note_timeline();
    let access = timeline.current_content(allowed);
    let id = NoteIdentity::new(note_id);
    let canonical = access.read_note(&id).map_err(timeline_error)?;
    let location = quote.map(|quote| {
        if quote.trim().is_empty() || quote.chars().count() > 4096 || !unique_quote(&canonical.markdown, quote) {
            return Err(DomainError::new("invalid_citation_location", "Use an exact, unique quote from this note's current Markdown. Include more context if the quote repeats."));
        }
        Ok(SourceLocation { quote: quote.into() })
    }).transpose()?;
    #[cfg(test)]
    AFTER_CANONICAL_READ.with(|hook| {
        if let Some(callback) = hook.borrow_mut().take() {
            callback();
        }
    });
    let content_hash = crate::services::content_hash::canonical_content_hash(&canonical.markdown);
    let read_state = match canonical.revision.clone() {
        Some(revision) => ReadState::Revision {
            revision,
            content_hash,
        },
        None => ReadState::Observed {
            content_hash,
            observed_at_millis: crate::time::current_time_millis().unwrap_or(0),
        },
    };
    let source = ReadSource {
        source_id: opaque_id()?,
        note_id: note_id.into(),
        title: canonical.title.clone(),
        read_state,
        location,
    };
    let raw_base_hash = crate::semantic::db::content_hash(&canonical.markdown);
    store.with_authority(authority_id, Some(lease.snapshot.revision), |connection, snapshot| {
        if !allows_read(snapshot, note_id) || AuthorityStore::excluded_in(connection, note_id)? { return Err(unavailable()); }
        if !access.validate_note_read(&id, &canonical).map_err(timeline_error)? { return Err(stale()); }
        schema(connection)?;
        connection.execute("INSERT INTO pi_chat_read_sources(source_id,authority_id,source_json,raw_base_hash,canonical_path) VALUES(?1,?2,?3,?4,?5)",
            params![source.source_id, authority_id, serde_json::to_string(&source).map_err(|_| DomainError::new("storage", "Read metadata is unavailable."))?, raw_base_hash, canonical.path.to_string_lossy()])?;
        Ok(())
    })?;
    Ok(NoteRead {
        markdown: canonical.markdown,
        source,
    })
}

pub(crate) fn unique_quote(markdown: &str, quote: &str) -> bool {
    if quote.is_empty() {
        return false;
    }
    let Some(at) = markdown.find(quote) else {
        return false;
    };
    // Include overlapping matches; byte offsets advance at a UTF-8 boundary.
    let next = at + markdown[at..].chars().next().unwrap().len_utf8();
    !markdown[next..].contains(quote)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SearchItem {
    pub note_id: String,
    pub title: String,
    pub preview: String,
    #[serde(skip)]
    path: PathBuf,
}
impl CurrentContentItem for SearchItem {
    fn current_note_identity(&self) -> CurrentContentIdentity<'_> {
        CurrentContentIdentity::Note {
            note_id: Some(&self.note_id),
            note_path: self.path.to_str(),
        }
    }
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SearchPage {
    pub items: Vec<SearchItem>,
    pub next_cursor: Option<String>,
}

pub(crate) fn search_notes(
    state: &AppState,
    store: &AuthorityStore,
    authority_id: &str,
    query: &str,
    limit: Option<usize>,
    cursor: Option<&str>,
) -> DomainResult<SearchPage> {
    if query.trim().is_empty() || query.len() > 4096 {
        return Err(DomainError::new(
            "invalid_query",
            "Supply nonempty search text.",
        ));
    }
    let limit = limit.unwrap_or(12);
    if !(1..=50).contains(&limit) {
        return Err(DomainError::new(
            "invalid_limit",
            "Search limit must be between 1 and 50.",
        ));
    }
    let lease = store.lease(authority_id)?;
    // Cursor is an offset bound to this exact query, policy revision and authority.
    // It grants no note access and is checked against the current result page.
    let fingerprint =
        blake3::hash(format!("{}:{}:{query}", authority_id, lease.snapshot.revision).as_bytes())
            .to_hex()
            .to_string();
    let offset = match cursor {
        None => 0,
        Some(value) => {
            let (token, offset) = value.split_once(':').ok_or_else(|| {
                DomainError::new("invalid_cursor", "Repeat search without a cursor.")
            })?;
            if token != fingerprint {
                return Err(DomainError::new(
                    "invalid_cursor",
                    "Search access or query changed. Repeat search without a cursor.",
                ));
            }
            offset
                .parse::<usize>()
                .map_err(|_| DomainError::new("invalid_cursor", "Invalid search cursor."))?
        }
    };
    let allowed = store.with_authority(
        authority_id,
        Some(lease.snapshot.revision),
        |connection, snapshot| scope(connection, snapshot),
    )?;
    let normalized = crate::index::normalize_search_text(query.trim());
    let terms = normalized.split_whitespace().collect::<Vec<_>>();
    let timeline = state.note_timeline();
    let access = timeline.current_content(allowed);
    let mut items = access
        .read_refreshable(|| {
            // Release the catalog before entering its canonical read owner.
            let candidates = {
                let index = state
                    .notes_index
                    .lock()
                    .map_err(|_| "Notes index is unavailable".to_string())?;
                index
                    .entries
                    .iter()
                    .filter(|(path, note)| {
                        note.document_kind == crate::note::DocumentKind::Note
                            && !crate::search::search_note(Some(path), note, &normalized, &terms)
                                .is_empty()
                    })
                    .map(|(path, note)| (path.clone(), note.note_id.clone()))
                    .collect::<Vec<_>>()
            };
            let mut matches = Vec::new();
            for (path, note_id) in candidates {
                let canonical = match access.read_note(&NoteIdentity::new(&note_id)) {
                    Ok(read) => read,
                    Err(crate::services::note_timeline::HistoryError::Ineligible(_)) => continue,
                    Err(error) => return Err(error.into()),
                };
                if canonical.path != path {
                    continue;
                }
                // The index discovers candidates; preview text comes from their
                // canonical saved bytes, never a stale cached paragraph or editor.
                let current = crate::index::build_indexed_note(&path, &canonical.markdown, 0);
                let Some(best) =
                    crate::search::search_note(Some(&path), &current, &normalized, &terms)
                        .into_iter()
                        .max_by_key(|hit| hit.score)
                else {
                    continue;
                };
                matches.push((
                    best.score,
                    SearchItem {
                        note_id,
                        title: canonical.title,
                        preview: best.result.excerpt,
                        path,
                    },
                ));
            }
            matches.sort_by(|a, b| b.0.cmp(&a.0).then_with(|| a.1.note_id.cmp(&b.1.note_id)));
            Ok(matches
                .into_iter()
                .map(|(_, item)| item)
                .collect::<Vec<_>>())
        })
        .map_err(timeline_error)?;
    store.with_authority(
        authority_id,
        Some(lease.snapshot.revision),
        |connection, snapshot| {
            // Current policy applies to final search delivery, never just discovery.
            let mut admitted = Vec::new();
            for item in items.drain(..) {
                if allows_read(snapshot, &item.note_id)
                    && !AuthorityStore::excluded_in(connection, &item.note_id)?
                {
                    admitted.push(item);
                }
            }
            items = admitted;
            Ok(())
        },
    )?;
    let has_more = offset.saturating_add(limit) < items.len();
    let items = items.into_iter().skip(offset).take(limit).collect();
    Ok(SearchPage {
        items,
        next_cursor: has_more.then(|| format!("{fingerprint}:{}", offset.saturating_add(limit))),
    })
}

#[tauri::command]
pub(crate) async fn pi_chat_read_note(
    app: tauri::AppHandle,
    authority_id: String,
    note_id: String,
    quote: Option<String>,
) -> DomainResult<NoteRead> {
    tauri::async_runtime::spawn_blocking(move || {
        read_note_at(
            &app.state::<AppState>(),
            &app.state::<AuthorityStore>(),
            &authority_id,
            &note_id,
            quote.as_deref(),
        )
    })
    .await
    .map_err(|_| DomainError::new("unavailable", "Note read was interrupted."))?
}
#[tauri::command]
pub(crate) async fn pi_chat_search_notes(
    app: tauri::AppHandle,
    authority_id: String,
    query: String,
    limit: Option<usize>,
    cursor: Option<String>,
) -> DomainResult<SearchPage> {
    tauri::async_runtime::spawn_blocking(move || {
        search_notes(
            &app.state::<AppState>(),
            &app.state::<AuthorityStore>(),
            &authority_id,
            &query,
            limit,
            cursor.as_deref(),
        )
    })
    .await
    .map_err(|_| DomainError::new("unavailable", "Note search was interrupted."))?
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        commands::note_persistence::persist_note_session_with_outcome,
        pi_chat::authority::ConversationBinding,
        test_support::{save_and_finalize, TestVault},
    };

    fn authority(
        _vault: &TestVault,
        mode: ReadMode,
        ids: Vec<String>,
        conversation_id: u64,
    ) -> (AuthorityStore, AuthoritySnapshot) {
        let data = crate::state::vault_data_dir().unwrap();
        let _configuration = crate::chat_domain::ChatDomain::new(data.clone()).unwrap();
        let store = AuthorityStore::new(&data).unwrap();
        let binding = store
            .bind(
                ConversationBinding {
                    conversation_id,
                    provider_session_id: format!("provider-{conversation_id}"),
                },
                ReadPolicy {
                    mode,
                    attached_note_ids: ids,
                },
            )
            .unwrap();
        (store, binding)
    }
    fn saved(vault: &TestVault, title: &str, body: &str) -> crate::commands::NoteSession {
        save_and_finalize(&vault.state, title.into(), body.into(), None)
            .unwrap()
            .unwrap()
    }

    #[test]
    fn canonical_reads_preserve_pending_windows_and_historical_receipts() {
        let vault = TestVault::new("pi-canonical-read");
        let note = saved(&vault, "Read source", "Original saved text");
        let id = note.note_id.as_deref().unwrap();
        let (store, authority) = authority(&vault, ReadMode::FullVault, vec![], 1);
        let first = read_note(&vault.state, &store, &authority.authority_id, id).unwrap();
        assert!(matches!(
            first.source.read_state,
            ReadState::Revision { .. }
        ));
        let history_db = Connection::open(
            crate::state::vault_data_dir()
                .unwrap()
                .join("history.sqlite3"),
        )
        .unwrap();
        let before: u64 = history_db
            .query_row(
                "SELECT COUNT(*) FROM revisions WHERE note_id=?1",
                [id],
                |row| row.get(0),
            )
            .unwrap();
        persist_note_session_with_outcome(
            &vault.state,
            "Read source".into(),
            "Pending saved endpoint".into(),
            note.path.clone(),
        )
        .unwrap();
        let pending = read_note(&vault.state, &store, &authority.authority_id, id).unwrap();
        assert!(pending.markdown.contains("Pending saved endpoint"));
        assert!(matches!(
            pending.source.read_state,
            ReadState::Observed { .. }
        ));
        let after: u64 = history_db
            .query_row(
                "SELECT COUNT(*) FROM revisions WHERE note_id=?1",
                [id],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(
            before, after,
            "read must not manufacture a finalized revision"
        );
        assert!(history_db
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM pending_editing_windows WHERE note_id=?1)",
                [id],
                |row| row.get::<_, bool>(0)
            )
            .unwrap());
        store
            .with_authority(&authority.authority_id, None, |connection, snapshot| {
                let old = receipt_in(connection, snapshot, &first.source.source_id)?;
                assert_eq!(
                    serde_json::to_value(old.source).unwrap(),
                    serde_json::to_value(&first.source).unwrap()
                );
                let receipt = receipt_in(connection, snapshot, &pending.source.source_id)?;
                assert_eq!(
                    receipt.canonical_path,
                    PathBuf::from(note.path.as_ref().unwrap())
                );
                assert_eq!(
                    receipt.raw_base_hash,
                    crate::semantic::db::content_hash(&pending.markdown)
                );
                assert!(!serde_json::to_string(&pending)
                    .unwrap()
                    .contains("rawBaseHash"));
                Ok(())
            })
            .unwrap();
    }

    #[test]
    fn policy_filters_search_attachment_reads_and_foreign_receipts() {
        let vault = TestVault::new("pi-read-policy");
        let first = saved(&vault, "Permitted", "needle first");
        let second = saved(&vault, "Other", "needle second");
        let id = first.note_id.as_ref().unwrap();
        let other = second.note_id.as_ref().unwrap();
        let (store, restricted) =
            authority(&vault, ReadMode::AttachedNotesOnly, vec![id.clone()], 1);
        let hits = search_notes(
            &vault.state,
            &store,
            &restricted.authority_id,
            "needle",
            None,
            None,
        )
        .unwrap();
        assert_eq!(
            hits.items
                .iter()
                .map(|item| &item.note_id)
                .collect::<Vec<_>>(),
            vec![id]
        );
        assert!(!serde_json::to_string(&hits).unwrap().contains("sourceId"));
        assert!(!serde_json::to_string(&hits)
            .unwrap()
            .contains(vault.notes.path().to_str().unwrap()));
        assert_eq!(
            read_note(&vault.state, &store, &restricted.authority_id, other)
                .unwrap_err()
                .code,
            "unavailable_note"
        );
        for invalid in ["../Permitted.md", "Permitted.md/path", "", ".."] {
            assert_eq!(
                read_note(&vault.state, &store, &restricted.authority_id, invalid)
                    .unwrap_err()
                    .code,
                "invalid_note"
            );
        }
        assert!(read_note(&vault.state, &store, &restricted.authority_id, "unknown-id").is_err());
        let read = read_note(&vault.state, &store, &restricted.authority_id, id).unwrap();
        let (_, foreign) = authority(&vault, ReadMode::FullVault, vec![], 2);
        let error = store
            .with_authority(&foreign.authority_id, None, |connection, snapshot| {
                receipt_in(connection, snapshot, &read.source.source_id).map(|_| ())
            })
            .unwrap_err();
        assert_eq!(error.code, "unknown_source");
        let all = search_notes(
            &vault.state,
            &store,
            &foreign.authority_id,
            "needle",
            Some(1),
            None,
        )
        .unwrap();
        let cursor = all.next_cursor.unwrap();
        let next = search_notes(
            &vault.state,
            &store,
            &foreign.authority_id,
            "needle",
            Some(1),
            Some(&cursor),
        )
        .unwrap();
        assert_eq!(next.items.len(), 1);
        assert!(next.next_cursor.is_none());
        assert_ne!(all.items[0].note_id, next.items[0].note_id);
        assert_eq!(
            search_notes(
                &vault.state,
                &store,
                &foreign.authority_id,
                "different query",
                Some(1),
                Some(&cursor)
            )
            .err()
            .unwrap()
            .code,
            "invalid_cursor"
        );
        vault
            .state
            .note_timeline()
            .forget_note(&PathBuf::from(second.path.as_ref().unwrap()), 7)
            .unwrap();
        assert!(read_note(&vault.state, &store, &foreign.authority_id, other).is_err());
        assert!(validate_attachments(
            &vault.state,
            &store,
            &ReadPolicy {
                mode: ReadMode::AttachedNotesOnly,
                attached_note_ids: vec![other.clone()]
            }
        )
        .is_err());
        store.set_exclusion(id, true).unwrap();
        assert_eq!(
            validate_attachments(
                &vault.state,
                &store,
                &ReadPolicy {
                    mode: ReadMode::FullVault,
                    attached_note_ids: vec![id.clone()]
                }
            )
            .unwrap_err()
            .code,
            "unavailable_note"
        );
        assert_eq!(
            read_note(&vault.state, &store, &restricted.authority_id, id)
                .unwrap_err()
                .code,
            "retired_authority"
        );
        let reopened = AuthorityStore::new(&crate::state::vault_data_dir().unwrap()).unwrap();
        assert_eq!(
            reopened.lease(&restricted.authority_id).unwrap_err().code,
            "retired_authority"
        );
    }

    #[test]
    fn retirement_between_canonical_read_and_receipt_delivery_denies_output() {
        let vault = TestVault::new("pi-read-retirement-race");
        let note = saved(&vault, "Race", "private text");
        let id = note.note_id.as_ref().unwrap();
        let (store, authority) = authority(&vault, ReadMode::FullVault, vec![], 1);
        let retiring = store.clone();
        let excluded = id.clone();
        AFTER_CANONICAL_READ.with(|hook| {
            *hook.borrow_mut() = Some(Box::new(move || {
                retiring.set_exclusion(&excluded, true).unwrap();
            }))
        });
        let error = read_note(&vault.state, &store, &authority.authority_id, id).unwrap_err();
        assert_eq!(error.code, "retired_authority");
        let connection =
            Connection::open(crate::state::vault_data_dir().unwrap().join("ai.sqlite3")).unwrap();
        let receipt_table: bool = connection
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE name='pi_chat_read_sources')",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert!(
            !receipt_table,
            "retired delivery must not issue a source receipt"
        );
    }

    #[test]
    fn raw_replacement_proof_detects_metadata_only_changes_and_missing_identity() {
        let vault = TestVault::new("pi-read-raw-proof");
        let note = saved(&vault, "Raw", "Same authored text");
        let id = note.note_id.as_ref().unwrap();
        let path = PathBuf::from(note.path.as_ref().unwrap());
        let (store, authority) = authority(&vault, ReadMode::FullVault, vec![], 1);
        let first = read_note(&vault.state, &store, &authority.authority_id, id).unwrap();
        let raw = std::fs::read_to_string(&path).unwrap();
        let changed = raw.replacen(
            "gneauxghts:\n",
            "gneauxghts:\n  unusedManagedField: value\n",
            1,
        );
        assert_ne!(raw, changed);
        std::fs::write(&path, &changed).unwrap();
        let second = read_note(&vault.state, &store, &authority.authority_id, id).unwrap();
        let hash = |source: &ReadSource| match &source.read_state {
            ReadState::Revision { content_hash, .. } | ReadState::Observed { content_hash, .. } => {
                content_hash.clone()
            }
        };
        assert_eq!(hash(&first.source), hash(&second.source));
        store
            .with_authority(&authority.authority_id, None, |connection, snapshot| {
                assert_ne!(
                    receipt_in(connection, snapshot, &first.source.source_id)?.raw_base_hash,
                    receipt_in(connection, snapshot, &second.source.source_id)?.raw_base_hash
                );
                Ok(())
            })
            .unwrap();
        std::fs::write(&path, changed.replace(id, "another-native-identity")).unwrap();
        assert!(read_note(&vault.state, &store, &authority.authority_id, id).is_err());
        assert!(search_notes(
            &vault.state,
            &store,
            &authority.authority_id,
            "Same authored",
            None,
            None
        )
        .unwrap()
        .items
        .is_empty());
        std::fs::remove_file(path).unwrap();
        assert!(read_note(&vault.state, &store, &authority.authority_id, id).is_err());
    }

    #[test]
    fn passage_citations_require_exact_unique_text_and_follow_current_note_content() {
        use crate::pi_chat::citations::{
            admit_answers, open_source, AnswerSegment, AnswerSegments, SourceDestination,
        };
        let vault = TestVault::new("pi-passage-citation-navigation");
        let note = saved(
            &vault,
            "Lantern [draft]",
            "😀 Intro\n\nThe lantern is **turquoise**.\n\nEnd.",
        );
        let id = note.note_id.as_ref().unwrap();
        let path = PathBuf::from(note.path.as_ref().unwrap());
        let (store, authority) = authority(&vault, ReadMode::FullVault, vec![], 1);
        let quote = "The lantern is **turquoise**.";
        for invalid in ["invented quote", " "] {
            assert_eq!(
                read_note_at(
                    &vault.state,
                    &store,
                    &authority.authority_id,
                    id,
                    Some(invalid)
                )
                .unwrap_err()
                .code,
                "invalid_citation_location"
            );
        }
        let read = read_note_at(
            &vault.state,
            &store,
            &authority.authority_id,
            id,
            Some(quote),
        )
        .unwrap();
        let admitted = admit_answers(
            &vault.state,
            &store,
            &authority.authority_id,
            &ConversationBinding {
                conversation_id: 1,
                provider_session_id: "provider-1".into(),
            },
            vec![AnswerSegments {
                segments: vec![AnswerSegment {
                    text: "Claim ".into(),
                    sources: vec![read.source.source_id.clone()],
                }],
            }],
        )
        .unwrap();
        assert!(admitted[0]
            .markdown
            .contains(r"[Note: Lantern \[draft\] · “The lantern is \*\*turquoise\*\*\.”]"));
        let destination = || {
            open_source(
                &vault.state,
                &store,
                &authority.authority_id,
                &read.source.source_id,
            )
            .unwrap()
        };
        assert!(
            matches!(destination(), SourceDestination::Note { location: Some(location), limitation: None, .. } if location.quote == quote)
        );
        // Moving the unchanged exact passage still targets it; removing or duplicating
        // it opens the note with a warning, never a stale line or historical revision.
        std::fs::write(
            &path,
            read.markdown
                .replace("😀 Intro", "😀 Extra intro\nMore lines"),
        )
        .unwrap();
        assert!(
            matches!(destination(), SourceDestination::Note { location: Some(location), limitation: Some(_), .. } if location.quote == quote)
        );
        for body in [
            read.markdown.replace(quote, "The lantern is blue."),
            format!("{}\n{quote}", read.markdown),
        ] {
            std::fs::write(&path, &body).unwrap();
            assert!(matches!(
                destination(),
                SourceDestination::Note {
                    location: None,
                    limitation: Some(_),
                    ..
                }
            ));
        }
        assert_eq!(
            read_note_at(
                &vault.state,
                &store,
                &authority.authority_id,
                id,
                Some(quote)
            )
            .unwrap_err()
            .code,
            "invalid_citation_location"
        );
        assert!(!unique_quote("aaa", "aa"));
        assert!(!unique_quote("😀😀😀", "😀😀"));
    }

    #[test]
    fn retained_read_citation_names_and_opens_the_note() {
        use crate::pi_chat::citations::{
            admit_answers, open_source, AnswerSegment, AnswerSegments, SourceDestination,
        };
        let vault = TestVault::new("pi-note-citation-navigation");
        let note = saved(&vault, "Lantern note", "The lantern is turquoise.");
        let id = note.note_id.as_ref().unwrap();
        let (store, authority) = authority(&vault, ReadMode::FullVault, vec![], 1);
        let read = read_note(&vault.state, &store, &authority.authority_id, id).unwrap();
        assert!(matches!(read.source.read_state, ReadState::Revision { .. }));
        let admitted = admit_answers(
            &vault.state,
            &store,
            &authority.authority_id,
            &ConversationBinding {
                conversation_id: 1,
                provider_session_id: "provider-1".into(),
            },
            vec![AnswerSegments {
                segments: vec![AnswerSegment {
                    text: "Turquoise ".into(),
                    sources: vec![read.source.source_id.clone()],
                }],
            }],
        )
        .unwrap();
        assert!(admitted[0]
            .markdown
            .contains("[Note: Lantern note](gneauxghts-source:"));
        assert!(
            matches!(open_source(&vault.state, &store, &authority.authority_id, &read.source.source_id).unwrap(), SourceDestination::Note { note_id, .. } if note_id == *id)
        );
    }

    #[test]
    fn known_note_metadata_damage_preserves_search_attachments_and_historical_sources() {
        use crate::pi_chat::citations::{
            admit_answers, open_source, AnswerSegment, AnswerSegments, SourceDestination,
        };
        use crate::services::note_timeline::VaultObservation;

        let vault = TestVault::new("pi-read-damaged-identity");
        let note = saved(&vault, "Known", "needle Original retained text");
        let id = note.note_id.as_ref().unwrap();
        let path = PathBuf::from(note.path.as_ref().unwrap());
        let (store, authority) =
            authority(&vault, ReadMode::AttachedNotesOnly, vec![id.clone()], 1);
        let original = read_note(&vault.state, &store, &authority.authority_id, id).unwrap();
        let ReadState::Revision { revision, .. } = &original.source.read_state else {
            panic!("creation must retain its revision");
        };
        let original_revision_id = revision.revision_id.clone();
        let policy = ReadPolicy {
            mode: ReadMode::AttachedNotesOnly,
            attached_note_ids: vec![id.clone()],
        };

        for (index, damaged) in [
            "needle External text without metadata",
            "---\ngneauxghts:\n  id:\n  kind: note\n---\n\nneedle External text with damaged identity",
        ]
        .into_iter()
        .enumerate()
        {
            std::fs::write(&path, damaged).unwrap();
            vault
                .state
                .note_timeline()
                .observe(VaultObservation::external_edit(
                    path.clone(),
                    42 + index as u64,
                    None,
                ))
                .unwrap();
            vault
                .state
                .upsert_note_indexes(
                    path.clone(),
                    crate::index::build_indexed_note(&path, damaged, 42 + index as u64),
                )
                .unwrap();
            assert_eq!(vault.state.indexed_note_identity(&path).unwrap().as_deref(), Some(id.as_str()));
            validate_attachments(&vault.state, &store, &policy).unwrap();
            let read = read_note(&vault.state, &store, &authority.authority_id, id).unwrap();
            assert_eq!(read.markdown, damaged);
            assert_eq!(read.source.note_id, *id);
            let hits = search_notes(&vault.state, &store, &authority.authority_id, "needle External", None, None).unwrap();
            assert_eq!(hits.items.len(), 1);
            assert_eq!(hits.items[0].note_id, *id);
            assert!(hits.items[0].preview.contains("External text"));
            assert_eq!(std::fs::read_to_string(&path).unwrap(), damaged, "reads must not repair metadata");

            let admitted = admit_answers(
                &vault.state,
                &store,
                &authority.authority_id,
                &ConversationBinding { conversation_id: 1, provider_session_id: "provider-1".into() },
                vec![AnswerSegments { segments: vec![AnswerSegment { text: "Earlier read ".into(), sources: vec![original.source.source_id.clone()] }] }],
            ).unwrap();
            assert_eq!(admitted[0].sources.len(), 1);
            let SourceDestination::Note { note_id, limitation, .. } = open_source(&vault.state, &store, &authority.authority_id, &original.source.source_id).unwrap() else {
                panic!("metadata damage must not remove note navigation");
            };
            assert_eq!(note_id, *id);
            assert!(limitation.unwrap().contains("changed since"));
            assert!(matches!(&admitted[0].sources[0].read_state, ReadState::Revision { revision, .. } if revision.revision_id == original_revision_id));
        }

        // An external endpoint not yet captured is a read state, not a newly
        // invented immutable revision. Its citation still opens the current note.
        let uncaptured = "needle Uncaptured endpoint without metadata";
        std::fs::write(&path, uncaptured).unwrap();
        let read = read_note(&vault.state, &store, &authority.authority_id, id).unwrap();
        assert!(matches!(read.source.read_state, ReadState::Observed { .. }));
        let SourceDestination::Note { limitation, .. } = open_source(
            &vault.state,
            &store,
            &authority.authority_id,
            &read.source.source_id,
        )
        .unwrap() else {
            panic!("an uncaptured read must not acquire a revision destination");
        };
        assert!(
            limitation.is_none(),
            "an unchanged observed read opens the note without a warning"
        );
    }

    #[test]
    fn present_conflicting_identity_and_trash_remain_unavailable() {
        use crate::pi_chat::citations::{open_source, SourceDestination};

        let vault = TestVault::new("pi-read-conflicting-identity");
        let note = saved(&vault, "Known", "needle Saved text");
        let id = note.note_id.as_ref().unwrap();
        let path = PathBuf::from(note.path.as_ref().unwrap());
        let (store, authority) = authority(&vault, ReadMode::FullVault, vec![], 1);
        let source = read_note(&vault.state, &store, &authority.authority_id, id)
            .unwrap()
            .source;
        let original = std::fs::read_to_string(&path).unwrap();
        for rejected in [
            original.replace(id, "another-native-identity"),
            original.replace("trashed_at: null", "trashed_at: 2026-10-16T00:00:00Z"),
            "---\ngneauxghts:\n  id:\n  trashed_at: 2026-10-16T00:00:00Z\n---\n\nneedle Saved text"
                .into(),
        ] {
            assert_ne!(original, rejected);
            std::fs::write(&path, &rejected).unwrap();
            assert!(read_note(&vault.state, &store, &authority.authority_id, id).is_err());
            assert!(validate_attachments(
                &vault.state,
                &store,
                &ReadPolicy {
                    mode: ReadMode::FullVault,
                    attached_note_ids: vec![id.clone()]
                }
            )
            .is_err());
            assert!(search_notes(
                &vault.state,
                &store,
                &authority.authority_id,
                "needle",
                None,
                None
            )
            .unwrap()
            .items
            .is_empty());
            assert!(matches!(
                open_source(
                    &vault.state,
                    &store,
                    &authority.authority_id,
                    &source.source_id
                )
                .unwrap(),
                SourceDestination::Unavailable { .. }
            ));
        }
    }

    #[test]
    fn metadata_damage_between_canonical_read_and_delivery_issues_no_receipt() {
        let vault = TestVault::new("pi-read-metadata-race");
        let note = saved(&vault, "Race", "needle Saved text");
        let id = note.note_id.as_ref().unwrap();
        let path = PathBuf::from(note.path.as_ref().unwrap());
        let (store, authority) = authority(&vault, ReadMode::FullVault, vec![], 1);
        AFTER_CANONICAL_READ.with(|hook| {
            *hook.borrow_mut() = Some(Box::new(move || {
                std::fs::write(path, "needle Replacement without metadata").unwrap();
            }));
        });
        assert_eq!(
            read_note(&vault.state, &store, &authority.authority_id, id)
                .unwrap_err()
                .code,
            "stale_read"
        );
        store
            .with_authority(&authority.authority_id, None, |connection, _| {
                schema(connection)?;
                let receipts: u64 = connection.query_row(
                    "SELECT COUNT(*) FROM pi_chat_read_sources",
                    [],
                    |row| row.get(0),
                )?;
                assert_eq!(receipts, 0);
                Ok(())
            })
            .unwrap();
        assert!(read_note(&vault.state, &store, &authority.authority_id, id)
            .unwrap()
            .markdown
            .contains("Replacement without metadata"));
    }
}
