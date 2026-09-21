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
    pub(crate) lexical_score: Option<f32>,
    pub(crate) semantic_score: Option<f32>,
    pub(crate) start_line: Option<usize>,
    pub(crate) end_line: Option<usize>,
    pub(crate) block_anchor: Option<String>,
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

/// Compatibility adapter for interactive note selection. Agent search/read
/// uses EvidenceSession directly so coverage and activity semantics remain explicit.
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
                limit,
                allowed_note_ids,
                excluded_note_ids,
                date_filters,
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
) -> Result<Vec<VaultRetrievalItem>, String> {
    use super::evidence::{EvidenceSession, SearchMode, SearchRequest};
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
    let mut evidence = EvidenceSession::default();
    let page = evidence.search(
        state,
        Some(&eligible),
        excluded_note_ids,
        SearchRequest {
            query: if query.trim().is_empty() {
                ".*".into()
            } else {
                query.into()
            },
            mode: if query.trim().is_empty() {
                SearchMode::Regex
            } else {
                SearchMode::Hybrid
            },
            limit: Some(limit.clamp(1, 20)),
            ..Default::default()
        },
    )?;
    let index = state
        .notes_index
        .lock()
        .map_err(|_| "Notes index unavailable")?;
    let mut results = Vec::new();
    for item in page["items"].as_array().into_iter().flatten() {
        let Some((path, n)) = item["noteId"]
            .as_str()
            .and_then(|id| index.get_note_by_note_id(id))
        else {
            continue;
        };
        results.push(VaultRetrievalItem {
            note_id: n.note_id.clone(),
            note_path: path.clone(),
            title: n.title.clone(),
            excerpt: item["preview"].as_str().unwrap_or_default().into(),
            section_label: item["section"].as_str().unwrap_or_default().into(),
            score: item["score"].as_f64().unwrap_or_default() as f32,
            lexical_score: None,
            semantic_score: None,
            start_line: None,
            end_line: None,
            block_anchor: None,
        });
    }
    Ok(results)
}

#[cfg(test)]
mod tests {
    use super::{matches_date_filters, VaultDateFilters, VaultRetrievalItem};
    use crate::{
        app::EventBus,
        index::{build_indexed_note, AppState},
        semantic::SemanticState,
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
        let _guard = crate::test_support::lock_test_env();
        let app_data = crate::test_support::TestDir::new("retrieval-current-content-data");
        crate::state::initialize_app_data_dir(app_data.path().to_path_buf()).unwrap();
        let notes = crate::test_support::TestDir::new("retrieval-current-content-notes");
        crate::state::set_notes_root_override(Some(notes.path().to_path_buf())).unwrap();
        crate::state::ensure_vault_scaffold(notes.path()).unwrap();
        let state = AppState::new(
            SemanticState::new_disabled("disabled"),
            EventBus::disabled(),
        )
        .unwrap();
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
            lexical_score: Some(1.0),
            semantic_score: None,
            start_line: Some(1),
            end_line: Some(1),
            block_anchor: None,
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
        crate::state::set_notes_root_override(None).unwrap();
    }
}
