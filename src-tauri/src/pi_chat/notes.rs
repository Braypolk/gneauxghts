//! Read-only native tools and immutable source receipts. No model argument grants access.
use super::authority::{
    opaque_id, AuthoritySnapshot, AuthorityStore, DomainError, DomainResult, ReadMode, ReadPolicy,
};
use crate::{
    index::AppState,
    services::note_timeline::{AllowedScope, CanonicalNoteRead, NoteIdentity, RevisionCitation},
};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::{collections::HashSet, path::PathBuf};
use tauri::Manager;

#[cfg(test)]
thread_local! {
    static AFTER_CANONICAL_READ: std::cell::RefCell<Option<Box<dyn FnOnce()>>> = Default::default();
    static AFTER_SEARCH_RANKING: std::cell::RefCell<Option<Box<dyn FnOnce()>>> = Default::default();
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
impl ReadSource {
    /// One citation representation, issued by reads and restored by answer admission.
    pub(crate) fn citation(&self) -> String {
        let source = self;
        fn single_line(value: &str) -> String {
            value.split_whitespace().collect::<Vec<_>>().join(" ")
        }
        let title = single_line(&source.title);
        let mut label = if title.is_empty() {
            "Untitled note".into()
        } else {
            title
        };
        if let Some(location) = &source.location {
            let quote = single_line(&location.quote);
            let excerpt: String = quote.chars().take(80).collect();
            label.push_str(&format!(
                " · “{excerpt}{}”",
                if quote.chars().count() > 80 {
                    "…"
                } else {
                    ""
                }
            ));
        }
        let mut escaped = String::new();
        for character in label.chars() {
            if character.is_ascii_punctuation() {
                escaped.push('\\');
            }
            escaped.push(character);
        }
        format!("[Note: {escaped}](gneauxghts-source:{})", source.source_id)
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct NoteRead {
    pub markdown: String,
    pub citation: String,
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
    let (attached, excluded) = search_policy(connection, snapshot)?;
    Ok(AllowedScope::policy(attached.as_ref(), &excluded))
}

fn search_policy(
    connection: &Connection,
    snapshot: &AuthoritySnapshot,
) -> DomainResult<(Option<HashSet<String>>, HashSet<String>)> {
    let mut statement = connection
        .prepare("SELECT note_id FROM chat_note_policies WHERE disposition='excluded'")?;
    let excluded = statement
        .query_map([], |row| row.get::<_, String>(0))?
        .collect::<Result<HashSet<_>, _>>()?;
    let attached = (snapshot.read.mode == ReadMode::AttachedNotesOnly)
        .then(|| snapshot.read.attached_note_ids.iter().cloned().collect());
    Ok((attached, excluded))
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

/// Recover only the exact bytes previously delivered to this conversation.
/// This is not a fresh read receipt: an old edit must never silently rebase.
pub(crate) fn mutation_base(
    state: &AppState,
    store: &AuthorityStore,
    authority_id: &str,
    note_id: &str,
    expected_read_source_id: &str,
) -> DomainResult<NoteRead> {
    validate_selector(note_id)?;
    store.with_authority(authority_id, None, |connection, snapshot| {
        let receipt = receipt_in(connection, snapshot, expected_read_source_id)?;
        if receipt.source.note_id != note_id {
            return Err(DomainError::new(
                "wrong_source",
                "Read this note before editing it.",
            ));
        }
        let canonical = source_navigation_content(state, snapshot, connection, note_id)?;
        if canonical.path != receipt.canonical_path
            || crate::semantic::db::content_hash(&canonical.markdown) != receipt.raw_base_hash
        {
            return Err(DomainError::new(
                "changed_base",
                "The note changed. Read it again before editing.",
            ));
        }
        Ok(NoteRead {
            markdown: crate::note::authored_markdown(&canonical.markdown),
            citation: receipt.source.citation(),
            source: receipt.source,
        })
    })
}

#[tauri::command]
pub(crate) async fn pi_chat_read_mutation_base(
    app: tauri::AppHandle,
    authority_id: String,
    note_id: String,
    expected_read_source_id: String,
) -> DomainResult<NoteRead> {
    tauri::async_runtime::spawn_blocking(move || {
        mutation_base(
            &app.state::<AppState>(),
            &app.state::<AuthorityStore>(),
            &authority_id,
            &note_id,
            &expected_read_source_id,
        )
    })
    .await
    .map_err(|_| DomainError::new("unavailable", "Edit base read was interrupted."))?
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
        citation: source.citation(),
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
    // Cursor binds this exact query/policy and the complete bounded ranking.
    // Re-ranking must never silently shift an offset after notes or model results
    // change. This contains no saved content and grants no note access.
    let fingerprint =
        blake3::hash(format!("{}:{}:{query}", authority_id, lease.snapshot.revision).as_bytes())
            .to_hex()
            .to_string();
    let (offset, previous_results) = match cursor {
        None | Some("") => (0, None),
        Some(value) => {
            let invalid = || DomainError::new("invalid_cursor", "Repeat search without a cursor.");
            if value.len() > 160 {
                return Err(invalid());
            }
            let mut parts = value.split(':');
            let token = parts.next().ok_or_else(invalid)?;
            let results = parts.next().ok_or_else(invalid)?;
            let offset = parts.next().ok_or_else(invalid)?;
            if parts.next().is_some() || results.len() != 64 {
                return Err(invalid());
            }
            if token != fingerprint {
                return Err(DomainError::new(
                    "invalid_cursor",
                    "Search access or query changed. Repeat search without a cursor.",
                ));
            }
            let offset = offset.parse::<usize>().map_err(|_| invalid())?;
            (offset, Some(results))
        }
    };
    let (allowed, excluded) = store.with_authority(
        authority_id,
        Some(lease.snapshot.revision),
        |connection, snapshot| search_policy(connection, snapshot),
    )?;
    // Chat retains its 4096-byte query and 50-item page contract. The shared
    // ranker has one bounded candidate budget; the dock keeps its smaller bounds.
    let mut items: Vec<_> = crate::services::retrieval::retrieve_scoped_notes(
        state,
        query,
        4096,
        allowed.as_ref(),
        &excluded,
        Default::default(),
    )
    .map_err(timeline_error)?
    .into_iter()
    .map(|item| SearchItem {
        note_id: item.note_id,
        title: item.title,
        preview: item.excerpt,
        path: item.note_path,
    })
    .collect();
    #[cfg(test)]
    AFTER_SEARCH_RANKING.with(|hook| {
        if let Some(hook) = hook.borrow_mut().take() {
            hook();
        }
    });
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
    let mut results = blake3::Hasher::new();
    for item in &items {
        for bytes in [
            item.note_id.as_bytes(),
            item.title.as_bytes(),
            item.preview.as_bytes(),
            item.path.as_os_str().as_encoded_bytes(),
        ] {
            results.update(&(bytes.len() as u64).to_le_bytes());
            results.update(bytes);
        }
    }
    let results = results.finalize().to_hex().to_string();
    if previous_results.is_some_and(|previous| previous != results) || offset > items.len() {
        return Err(DomainError::new(
            "invalid_cursor",
            "Search results changed. Repeat search without a cursor.",
        ));
    }
    let has_more = offset.saturating_add(limit) < items.len();
    let items = items.into_iter().skip(offset).take(limit).collect();
    Ok(SearchPage {
        items,
        next_cursor: has_more
            .then(|| format!("{fingerprint}:{results}:{}", offset.saturating_add(limit))),
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
    fn scoped_hybrid_search_retains_chat_bounds_and_stable_pagination() {
        let vault = TestVault::with_notes("pi-scoped-ranked-pages", |root| {
            for index in 0..55 {
                std::fs::write(
                    root.join(format!("Search {index:02}.md")),
                    format!(
                        "---\ngneauxghts:\n  id: search-{index:02}\n  kind: note\n---\n\nneedle paragraph {index:02}"
                    ),
                )
                .unwrap();
            }
        });
        vault
            .state
            .ensure_interactive_index(vault.notes.path(), "pi-search-test")
            .unwrap();
        let (store, authority) = authority(&vault, ReadMode::FullVault, vec![], 1);
        let query = format!("needle{}", " ".repeat(4090));
        let first = search_notes(
            &vault.state,
            &store,
            &authority.authority_id,
            &query,
            Some(50),
            Some(""),
        )
        .unwrap();
        assert_eq!(first.items.len(), 50);
        let cursor = first.next_cursor.as_deref().unwrap();
        let next = search_notes(
            &vault.state,
            &store,
            &authority.authority_id,
            &query,
            Some(50),
            Some(cursor),
        )
        .unwrap();
        assert_eq!(next.items.len(), 5);
        assert!(next.next_cursor.is_none());
        let ids: HashSet<_> = first
            .items
            .iter()
            .chain(&next.items)
            .map(|item| &item.note_id)
            .collect();
        assert_eq!(ids.len(), 55, "pages must not overlap or lose tied results");
        let repeated = search_notes(
            &vault.state,
            &store,
            &authority.authority_id,
            &query,
            Some(50),
            Some(cursor),
        )
        .unwrap();
        assert_eq!(
            repeated
                .items
                .iter()
                .map(|item| &item.note_id)
                .collect::<Vec<_>>(),
            next.items
                .iter()
                .map(|item| &item.note_id)
                .collect::<Vec<_>>(),
        );
        for invalid in ["".to_string(), " ".to_string(), format!("{query}x")] {
            assert_eq!(
                search_notes(
                    &vault.state,
                    &store,
                    &authority.authority_id,
                    &invalid,
                    None,
                    None
                )
                .err()
                .unwrap()
                .code,
                "invalid_query"
            );
        }
        for invalid in [0, 51] {
            assert_eq!(
                search_notes(
                    &vault.state,
                    &store,
                    &authority.authority_id,
                    "needle",
                    Some(invalid),
                    None
                )
                .err()
                .unwrap()
                .code,
                "invalid_limit"
            );
        }
        // A foreign authority and changed exact query cannot reuse this cursor.
        let (_, foreign) = self::authority(&vault, ReadMode::FullVault, vec![], 2);
        for (id, query) in [
            (&foreign.authority_id, query.as_str()),
            (&authority.authority_id, "needle"),
        ] {
            assert_eq!(
                search_notes(&vault.state, &store, id, query, Some(50), Some(cursor))
                    .err()
                    .unwrap()
                    .code,
                "invalid_cursor"
            );
        }
        // The watcher has not observed this edit. Stale lexical candidates must
        // not supply a preview, and a shifted page requires a fresh search.
        let first_path = first.items[0].path.clone();
        let raw = std::fs::read_to_string(&first_path).unwrap();
        std::fs::write(&first_path, raw.replace("needle", "absent")).unwrap();
        assert_eq!(
            search_notes(
                &vault.state,
                &store,
                &authority.authority_id,
                &query,
                Some(50),
                Some(cursor)
            )
            .err()
            .unwrap()
            .code,
            "invalid_cursor"
        );
        let refreshed = search_notes(
            &vault.state,
            &store,
            &authority.authority_id,
            "needle",
            Some(50),
            None,
        )
        .unwrap();
        assert!(refreshed.items.iter().all(|item| item.path != first_path));
        let connection =
            Connection::open(crate::state::vault_data_dir().unwrap().join("ai.sqlite3")).unwrap();
        let receipts: bool = connection
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE name='pi_chat_read_sources')",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert!(
            !receipts,
            "ranked previews must not issue read or citation evidence"
        );
    }

    #[test]
    fn search_rechecks_authority_after_ranking_and_preserves_exact_title_matches() {
        let vault = TestVault::new("pi-ranked-search-admission");
        let exact = saved(&vault, "Inexpensive greenhouse", "A plan for seedlings");
        let other = saved(&vault, "Unrelated", "A separate idea");
        let exact_id = exact.note_id.as_ref().unwrap();
        let (store, authority) = authority(
            &vault,
            ReadMode::AttachedNotesOnly,
            vec![exact_id.clone()],
            1,
        );
        let found = search_notes(
            &vault.state,
            &store,
            &authority.authority_id,
            "Inexpensive greenhouse",
            None,
            None,
        )
        .unwrap();
        assert_eq!(found.items.len(), 1);
        assert_eq!(&found.items[0].note_id, exact_id);
        assert!(search_notes(
            &vault.state,
            &store,
            &authority.authority_id,
            "separate",
            None,
            None
        )
        .unwrap()
        .items
        .is_empty());
        assert_ne!(exact_id, other.note_id.as_ref().unwrap());

        let retiring = store.clone();
        let excluded = exact_id.clone();
        AFTER_SEARCH_RANKING.with(|hook| {
            *hook.borrow_mut() = Some(Box::new(move || {
                retiring.set_exclusion(&excluded, true).unwrap();
            }));
        });
        assert_eq!(
            search_notes(
                &vault.state,
                &store,
                &authority.authority_id,
                "greenhouse",
                None,
                None
            )
            .err()
            .unwrap()
            .code,
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
    fn edit_base_requires_the_exact_issued_note_and_bytes() {
        let vault = TestVault::new("pi-edit-base");
        let note = saved(&vault, "Edit base", "Alpha");
        let other = saved(&vault, "Other note", "Other");
        let id = note.note_id.as_ref().unwrap();
        let (store, authority) = authority(&vault, ReadMode::FullVault, vec![], 1);
        let read = read_note(&vault.state, &store, &authority.authority_id, id).unwrap();
        let base = mutation_base(
            &vault.state,
            &store,
            &authority.authority_id,
            id,
            &read.source.source_id,
        )
        .unwrap();
        assert_eq!(base.markdown, "Alpha");
        assert!(!base.markdown.contains("gneauxghts:"));
        assert_eq!(base.source.source_id, read.source.source_id);
        assert_eq!(
            mutation_base(
                &vault.state,
                &store,
                &authority.authority_id,
                other.note_id.as_ref().unwrap(),
                &read.source.source_id
            )
            .unwrap_err()
            .code,
            "wrong_source"
        );
        assert_eq!(
            mutation_base(
                &vault.state,
                &store,
                &authority.authority_id,
                id,
                "invented-source"
            )
            .unwrap_err()
            .code,
            "unknown_source"
        );
        let foreign = store
            .bind(
                ConversationBinding {
                    conversation_id: 2,
                    provider_session_id: "other-provider".into(),
                },
                ReadPolicy {
                    mode: ReadMode::FullVault,
                    attached_note_ids: vec![],
                },
            )
            .unwrap();
        assert_eq!(
            mutation_base(
                &vault.state,
                &store,
                &foreign.authority_id,
                id,
                &read.source.source_id
            )
            .unwrap_err()
            .code,
            "unknown_source"
        );
        // Even an unrelated change must not silently rebase a targeted edit.
        let path = PathBuf::from(note.path.as_ref().unwrap());
        std::fs::write(&path, format!("{}\nNew human text", read.markdown)).unwrap();
        assert_eq!(
            mutation_base(
                &vault.state,
                &store,
                &authority.authority_id,
                id,
                &read.source.source_id
            )
            .unwrap_err()
            .code,
            "changed_base"
        );
        store.set_exclusion(id, true).unwrap();
        assert!(mutation_base(
            &vault.state,
            &store,
            &authority.authority_id,
            id,
            &read.source.source_id
        )
        .is_err());
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
        assert_eq!(
            mutation_base(
                &vault.state,
                &store,
                &authority.authority_id,
                id,
                &first.source.source_id
            )
            .unwrap_err()
            .code,
            "changed_base"
        );
        assert_eq!(
            mutation_base(
                &vault.state,
                &store,
                &authority.authority_id,
                id,
                &second.source.source_id
            )
            .unwrap()
            .markdown,
            crate::note::authored_markdown(&changed)
        );
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
            .contains(r"[Note: Lantern \[draft\] · “The lantern is \*\*turquoise\*\*\.”]"));
        assert!(admitted[0].contains(&read.citation));
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
        assert!(admitted[0].contains("[Note: Lantern note](gneauxghts-source:"));
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
            assert!(admitted[0].contains(&original.source.source_id));
            let SourceDestination::Note { note_id, limitation, .. } = open_source(&vault.state, &store, &authority.authority_id, &original.source.source_id).unwrap() else {
                panic!("metadata damage must not remove note navigation");
            };
            assert_eq!(note_id, *id);
            assert!(limitation.unwrap().contains("changed since"));
            store.with_authority(&authority.authority_id, None, |connection, snapshot| {
                let receipt = receipt_in(connection, snapshot, &original.source.source_id)?;
                assert!(matches!(&receipt.source.read_state, ReadState::Revision { revision, .. } if revision.revision_id == original_revision_id));
                Ok(())
            }).unwrap();
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
