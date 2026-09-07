use super::{prepare_notes_dir, INTERACTIVE_INDEX_REFRESH_MAX_AGE};
use crate::{
    index::AppState,
    note::DocumentKind,
    semantic::atlas::{
        AtlasChatVisibilityKey, AtlasGenerationKey, AtlasSearchResponse, VaultAtlasResponse,
    },
    services::note_timeline::{
        AllowedScope, CurrentContentIdentity, CurrentContentItem, CurrentContentProjection,
    },
    state::db_load_note_activity,
};
use std::collections::HashSet;
use tauri::State;

type AtlasChatVisibility = AtlasChatVisibilityKey;

impl CurrentContentItem for crate::semantic::atlas::AtlasNode {
    fn current_note_identity(&self) -> CurrentContentIdentity<'_> {
        if self.document_kind == DocumentKind::Note {
            CurrentContentIdentity::Note {
                note_id: self.note_id.as_deref(),
                note_path: Some(&self.note_path),
            }
        } else {
            CurrentContentIdentity::NonNote
        }
    }
}

impl CurrentContentItem for crate::semantic::atlas::AtlasSearchMatch {
    fn current_note_identity(&self) -> CurrentContentIdentity<'_> {
        if self.document_kind == DocumentKind::Note {
            CurrentContentIdentity::Note {
                note_id: self.note_id.as_deref(),
                note_path: Some(&self.note_path),
            }
        } else {
            CurrentContentIdentity::NonNote
        }
    }
}

impl CurrentContentProjection for VaultAtlasResponse {
    type Item = crate::semantic::atlas::AtlasNode;

    fn retain_current(&mut self, retains: &mut dyn FnMut(&Self::Item) -> bool) {
        self.nodes.retain(retains);
        let node_ids = self
            .nodes
            .iter()
            .map(|node| node.id.as_str())
            .collect::<HashSet<_>>();
        self.links.retain(|link| {
            node_ids.contains(link.source_id.as_str()) && node_ids.contains(link.target_id.as_str())
        });
        for cloud in &mut self.clouds {
            cloud
                .member_node_ids
                .retain(|node_id| node_ids.contains(node_id.as_str()));
            cloud
                .core_node_ids
                .retain(|node_id| node_ids.contains(node_id.as_str()));
            cloud
                .outlier_node_ids
                .retain(|node_id| node_ids.contains(node_id.as_str()));
            cloud
                .representative_node_ids
                .retain(|node_id| node_ids.contains(node_id.as_str()));
            cloud.note_count = cloud.member_node_ids.len();
        }
        self.clouds
            .retain(|cloud| !cloud.member_node_ids.is_empty());
        let cloud_ids = self
            .clouds
            .iter()
            .map(|cloud| cloud.id.clone())
            .collect::<HashSet<_>>();
        for cloud in &mut self.clouds {
            cloud
                .child_cloud_ids
                .retain(|cloud_id| cloud_ids.contains(cloud_id));
        }
    }
}

impl CurrentContentProjection for AtlasSearchResponse {
    type Item = crate::semantic::atlas::AtlasSearchMatch;

    fn retain_current(&mut self, retains: &mut dyn FnMut(&Self::Item) -> bool) {
        self.matches.retain(retains);
    }
}

#[tauri::command]
pub(crate) async fn get_vault_atlas(
    state: State<'_, AppState>,
    chat_visibility: Option<AtlasChatVisibility>,
) -> Result<VaultAtlasResponse, String> {
    let chat_visibility = chat_visibility.unwrap_or_default();
    let generation_key = AtlasGenerationKey { chat_visibility };
    let notes_dir = prepare_notes_dir(false)?;
    state.ensure_interactive_index(
        &notes_dir,
        INTERACTIVE_INDEX_REFRESH_MAX_AGE,
        "get_vault_atlas",
    )?;
    let activity_by_note_id = db_load_note_activity()?;
    let semantic = state.semantic.clone();

    state
        .note_timeline()
        .current_content(AllowedScope::vault())
        .read_async(async move {
            tauri::async_runtime::spawn_blocking(move || {
                semantic.vault_atlas(generation_key, activity_by_note_id)
            })
            .await
            .map_err(|err| err.to_string())?
        })
        .await
}

#[tauri::command]
pub(crate) fn clear_atlas_cache(state: State<'_, AppState>) -> Result<(), String> {
    state.semantic.clear_atlas_cache()
}

#[tauri::command]
pub(crate) async fn search_vault_atlas(
    state: State<'_, AppState>,
    query: String,
    chat_visibility: Option<AtlasChatVisibility>,
) -> Result<AtlasSearchResponse, String> {
    let chat_visibility = chat_visibility.unwrap_or_default();
    let generation_key = AtlasGenerationKey { chat_visibility };
    let notes_dir = prepare_notes_dir(false)?;
    state.ensure_interactive_index(
        &notes_dir,
        INTERACTIVE_INDEX_REFRESH_MAX_AGE,
        "search_vault_atlas",
    )?;

    let activity_by_note_id = db_load_note_activity()?;
    let semantic = state.semantic.clone();

    state
        .note_timeline()
        .current_content(AllowedScope::vault())
        .read_async(async move {
            tauri::async_runtime::spawn_blocking(move || {
                semantic.search_vault_atlas(generation_key, query, activity_by_note_id, &notes_dir)
            })
            .await
            .map_err(|err| err.to_string())?
        })
        .await
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        app::EventBus, semantic::SemanticState, services::note_timeline::VaultObservation,
    };

    #[test]
    fn atlas_does_not_deliver_a_match_invalidated_by_a_missing_transition() {
        let _guard = crate::test_support::lock_test_env();
        let app_data = crate::test_support::TestDir::new("atlas-current-content-data");
        crate::state::initialize_app_data_dir(app_data.path().to_path_buf()).unwrap();
        let notes = crate::test_support::TestDir::new("atlas-current-content-notes");
        crate::state::set_notes_root_override(Some(notes.path().to_path_buf())).unwrap();
        crate::state::ensure_vault_scaffold(notes.path()).unwrap();
        let state = AppState::new(
            SemanticState::new_disabled("disabled"),
            EventBus::disabled(),
        )
        .unwrap();
        let created = crate::commands::note_persistence::persist_note_session_with_outcome(
            &state,
            "Missing Atlas note".to_string(),
            "Current Atlas prose".to_string(),
            None,
        )
        .unwrap()
        .unwrap();
        let note_id = created.note_id.unwrap();
        let note_path = created.path.unwrap();

        let delivered = std::thread::scope(|scope| {
            let (query_started, query_is_started) = std::sync::mpsc::sync_channel(0);
            let (release_query, query_released) = std::sync::mpsc::sync_channel(0);
            let stale_note_id = note_id.clone();
            let stale_note_path = note_path.clone();
            let read_state = &state;
            let read = scope.spawn(move || {
                tauri::async_runtime::block_on(
                    read_state
                        .note_timeline()
                        .current_content(AllowedScope::vault())
                        .read_async(async {
                            query_started.send(()).unwrap();
                            query_released.recv().unwrap();
                            Ok(AtlasSearchResponse {
                                status: "ready".to_string(),
                                reason: None,
                                query: "Atlas".to_string(),
                                generated_at_millis: 100,
                                matches: vec![crate::semantic::atlas::AtlasSearchMatch {
                                    note_id: Some(stale_note_id),
                                    note_path: stale_note_path,
                                    document_kind: DocumentKind::Note,
                                    score: 1.0,
                                    semantic_score: 1.0,
                                    lexical_score: 1.0,
                                    structural_score: 1.0,
                                    reason_labels: Vec::new(),
                                }],
                            })
                        }),
                )
            });
            query_is_started.recv().unwrap();
            std::fs::remove_file(&note_path).unwrap();
            state
                .note_timeline()
                .observe(VaultObservation::missing(&note_path, 100))
                .unwrap();
            release_query.send(()).unwrap();
            read.join().unwrap().unwrap()
        });

        assert!(delivered.matches.is_empty());
        let identity_less_stale = state
            .note_timeline()
            .current_content(AllowedScope::vault())
            .read(|| {
                Ok(AtlasSearchResponse {
                    status: "ready".to_string(),
                    reason: None,
                    query: "Atlas".to_string(),
                    generated_at_millis: 101,
                    matches: vec![crate::semantic::atlas::AtlasSearchMatch {
                        note_id: None,
                        note_path,
                        document_kind: DocumentKind::Note,
                        score: 1.0,
                        semantic_score: 1.0,
                        lexical_score: 1.0,
                        structural_score: 1.0,
                        reason_labels: Vec::new(),
                    }],
                })
            })
            .unwrap();
        assert!(identity_less_stale.matches.is_empty());
        crate::state::set_notes_root_override(None).unwrap();
    }
}
