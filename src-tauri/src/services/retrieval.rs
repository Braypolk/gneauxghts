mod search;

use crate::{
    index::AppState,
    note::DocumentKind,
    services::note_timeline::{AllowedScope, CurrentContentIdentity, CurrentContentItem},
};
use std::{collections::HashSet, path::PathBuf};

#[derive(Clone, Debug)]
pub(crate) struct VaultRetrievalItem {
    pub(crate) note_id: String,
    pub(crate) note_path: PathBuf,
    pub(crate) title: String,
    pub(crate) excerpt: String,
    pub(crate) section_label: String,
    pub(crate) score: f32,
}

impl CurrentContentItem for VaultRetrievalItem {
    fn current_note_identity(&self) -> CurrentContentIdentity<'_> {
        CurrentContentIdentity::Note {
            note_id: Some(&self.note_id),
            note_path: self.note_path.to_str(),
        }
    }
}

#[derive(Clone, Copy, Debug, Default)]
pub(crate) struct VaultDateFilters {
    pub(crate) created_after: Option<u64>,
    pub(crate) created_before: Option<u64>,
    pub(crate) updated_after: Option<u64>,
    pub(crate) updated_before: Option<u64>,
}

impl VaultDateFilters {
    fn is_active(self) -> bool {
        self.created_after.is_some()
            || self.created_before.is_some()
            || self.updated_after.is_some()
            || self.updated_before.is_some()
    }
}

fn matches_date_filters(note: &crate::index::IndexedNote, filters: VaultDateFilters) -> bool {
    filters
        .created_after
        .is_none_or(|value| note.created_at_millis >= value)
        && filters
            .created_before
            .is_none_or(|value| note.created_at_millis <= value)
        && filters
            .updated_after
            .is_none_or(|value| note.updated_at_millis >= value)
        && filters
            .updated_before
            .is_none_or(|value| note.updated_at_millis <= value)
}

/// Interactive query search under the native current-content delivery boundary.
pub(crate) fn retrieve_vault_notes(
    state: &AppState,
    query: &str,
    limit: usize,
    allowed_note_ids: Option<&HashSet<String>>,
    excluded_note_ids: &HashSet<String>,
    date_filters: VaultDateFilters,
) -> Result<Vec<VaultRetrievalItem>, String> {
    state
        .note_timeline()
        .current_content(AllowedScope::policy(allowed_note_ids, excluded_note_ids))
        .read(|| {
            retrieve_vault_notes_unchecked(
                state,
                query,
                limit.min(20),
                allowed_note_ids,
                excluded_note_ids,
                date_filters,
                1024,
            )
        })
}

/// The same canonical ranking with a larger bounded work page for authorized
/// consumers that own pagination. Scope and delivery remain native policy.
pub(crate) fn retrieve_scoped_notes(
    state: &AppState,
    query: &str,
    limit: usize,
    allowed_note_ids: Option<&HashSet<String>>,
    excluded_note_ids: &HashSet<String>,
    date_filters: VaultDateFilters,
) -> Result<Vec<VaultRetrievalItem>, String> {
    state
        .note_timeline()
        .current_content(AllowedScope::policy(allowed_note_ids, excluded_note_ids))
        .read_refreshable(|| {
            retrieve_vault_notes_unchecked(
                state,
                query,
                limit.min(4096),
                allowed_note_ids,
                excluded_note_ids,
                date_filters,
                4096,
            )
        })
}

fn retrieve_vault_notes_unchecked(
    state: &AppState,
    query: &str,
    limit: usize,
    allowed_note_ids: Option<&HashSet<String>>,
    excluded_note_ids: &HashSet<String>,
    date_filters: VaultDateFilters,
    query_bytes: usize,
) -> Result<Vec<VaultRetrievalItem>, String> {
    if query.trim().is_empty() && !date_filters.is_active() {
        return Ok(Vec::new());
    }
    let eligible: HashSet<_> = state
        .notes_index
        .lock()
        .map_err(|_| "Notes index unavailable")?
        .entries
        .values()
        .filter(|n| {
            n.document_kind == DocumentKind::Note
                && matches_date_filters(n, date_filters)
                && allowed_note_ids.is_none_or(|ids| ids.contains(&n.note_id))
        })
        .map(|n| n.note_id.clone())
        .collect();
    let eligible = eligible.difference(excluded_note_ids).cloned().collect();
    search::search(state, &eligible, query, limit, query_bytes)
}

#[cfg(test)]
mod tests {
    use super::{matches_date_filters, VaultDateFilters, VaultRetrievalItem};
    use crate::{
        index::build_indexed_note,
        services::note_timeline::{AllowedScope, NoteIdentity},
    };
    use std::{collections::HashSet, path::Path};

    #[test]
    fn date_filters_use_created_and_updated_frontmatter_independently() {
        let markdown = "---\ngneauxghts:\n  id: dated-note\n  created_at: 2026-01-01T00:00:00Z\n  updated_at: 2026-02-01T00:00:00Z\n---\n\nBody";
        let note = build_indexed_note(Path::new("dated.md"), markdown, 42);
        let january_15 = crate::note::parse_rfc3339_millis("2026-01-15T00:00:00Z");

        assert!(matches_date_filters(
            &note,
            VaultDateFilters {
                created_before: january_15,
                updated_after: january_15,
                ..VaultDateFilters::default()
            }
        ));
        assert!(!matches_date_filters(
            &note,
            VaultDateFilters {
                created_after: january_15,
                ..VaultDateFilters::default()
            }
        ));
    }

    #[test]
    fn retrieval_scope_and_clear_invalidation_are_applied_at_delivery() {
        let vault = crate::test_support::TestVault::new("retrieval-current-content");
        let state = &vault.state;
        let created = crate::commands::note_persistence::persist_note_session_with_outcome(
            &state,
            "Scoped retrieval".to_string(),
            "Current private prose".to_string(),
            None,
        )
        .unwrap()
        .unwrap();
        let note_id = NoteIdentity::new(created.note_id.unwrap());
        let note_path = created.path.unwrap();
        let item = || VaultRetrievalItem {
            note_id: note_id.as_str().to_string(),
            note_path: note_path.clone().into(),
            title: "Scoped retrieval".to_string(),
            excerpt: "Current private prose".to_string(),
            section_label: String::new(),
            score: 1.0,
        };

        let delivered = std::thread::scope(|scope| {
            let (query_started, query_is_started) = std::sync::mpsc::sync_channel(0);
            let (release_query, query_released) = std::sync::mpsc::sync_channel(0);
            let read_state = &state;
            let allowed_note_id = note_id.as_str().to_string();
            let read = scope.spawn(move || {
                read_state
                    .note_timeline()
                    .current_content(AllowedScope::policy(
                        Some(&HashSet::from([allowed_note_id])),
                        &HashSet::new(),
                    ))
                    .read(|| {
                        query_started.send(()).unwrap();
                        query_released.recv().unwrap();
                        Ok(vec![item()])
                    })
            });
            query_is_started.recv().unwrap();
            state.note_timeline().clear_note_history(&note_id).unwrap();
            release_query.send(()).unwrap();
            read.join().unwrap().unwrap()
        });
        assert!(delivered.is_empty());

        let excluded = state
            .note_timeline()
            .current_content(AllowedScope::policy(
                None,
                &HashSet::from([note_id.as_str().to_string()]),
            ))
            .read(|| Ok(vec![item()]))
            .unwrap();
        assert!(excluded.is_empty());
    }
}

#[cfg(test)]
mod adapter_tests {
    use super::*;
    #[test]
    fn actual_picker_pages_passages_into_unique_allowed_notes_and_applies_metadata_dates() {
        let vault = crate::test_support::TestVault::new("retrieval-adapter");
        let first = crate::commands::note_persistence::persist_note_session_with_outcome(
            &vault.state,
            "First".into(),
            (0..30)
                .map(|i| format!("needle paragraph number {i} with distinct words"))
                .collect::<Vec<_>>()
                .join("\n\n"),
            None,
        )
        .unwrap()
        .unwrap();
        let second = crate::commands::note_persistence::persist_note_session_with_outcome(
            &vault.state,
            "Second".into(),
            "needle separate note".into(),
            None,
        )
        .unwrap()
        .unwrap();
        vault
            .state
            .lexical
            .sync_with_notes_index(&vault.state.notes_index.lock().unwrap().entries)
            .unwrap();
        let all = retrieve_vault_notes(
            &vault.state,
            "needle",
            20,
            None,
            &HashSet::new(),
            Default::default(),
        )
        .unwrap();
        assert_eq!(all.len(), 2);
        assert_eq!(
            all.iter()
                .map(|n| n.note_id.clone())
                .collect::<HashSet<_>>(),
            HashSet::from([
                first.note_id.clone().unwrap(),
                second.note_id.clone().unwrap()
            ])
        );
        let excluded = HashSet::from([first.note_id.unwrap()]);
        let filtered = retrieve_vault_notes(
            &vault.state,
            "needle",
            20,
            None,
            &excluded,
            VaultDateFilters {
                updated_after: Some(1),
                ..Default::default()
            },
        )
        .unwrap();
        assert_eq!(filtered.len(), 1);
        assert_eq!(filtered[0].note_id, second.note_id.unwrap());
        assert!(retrieve_vault_notes(
            &vault.state,
            "needle",
            20,
            None,
            &HashSet::new(),
            VaultDateFilters {
                created_before: Some(1),
                ..Default::default()
            }
        )
        .unwrap()
        .is_empty());
    }
}
