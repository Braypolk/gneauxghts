use super::{prepare_notes_dir, INTERACTIVE_INDEX_REFRESH_MAX_AGE};
use crate::{
    index::AppState,
    semantic::{
        cluster::cluster_notes,
        db::{
            ensure_schema, load_all_edges_for_notes, load_all_notes_with_meta_for_paths,
            load_first_chunk_text_per_note_for_paths, load_graph_positions_for_notes,
            load_note_embeddings, open_database, save_graph_positions, StoredNoteWithMeta,
        },
    },
};
use serde::{Deserialize, Serialize};
use std::{
    collections::{HashMap, HashSet},
    path::Path,
    sync::{LazyLock, Mutex},
};
use tauri::State;

const GRAPH_CLUSTER_CACHE_LIMIT: usize = 6;
const GRAPH_DATA_CACHE_LIMIT: usize = 6;

static GRAPH_CLUSTER_CACHE: LazyLock<Mutex<Vec<GraphClusterCacheEntry>>> =
    LazyLock::new(|| Mutex::new(Vec::new()));
static GRAPH_DATA_CACHE: LazyLock<Mutex<Vec<GraphDataCacheEntry>>> =
    LazyLock::new(|| Mutex::new(Vec::new()));

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GraphNode {
    path: String,
    title: String,
    snippet: String,
    cluster_id: usize,
    created_at_millis: u64,
    modified_millis: u64,
    x_hint: Option<f64>,
    y_hint: Option<f64>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GraphCluster {
    id: usize,
    label: String,
    note_count: usize,
    color_index: usize,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GraphEdge {
    source: String,
    target: String,
    score: f32,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct WikilinkEdge {
    source: String,
    target: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GraphData {
    nodes: Vec<GraphNode>,
    clusters: Vec<GraphCluster>,
    wikilink_edges: Vec<WikilinkEdge>,
    inferred_edges: Vec<GraphEdge>,
    time_range: (u64, u64),
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GraphDataMetadata {
    semantic_revision: u64,
    notes_revision: u64,
    color_group_count: usize,
    invalidation_epoch: u64,
    refreshed: bool,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GraphPositionEntry {
    path: String,
    x: f64,
    y: f64,
}

#[derive(Clone)]
struct GraphClusterCacheEntry {
    revision: u64,
    color_group_count: usize,
    assignments: HashMap<String, usize>,
    clusters: Vec<GraphCluster>,
}

#[derive(Clone)]
struct GraphDataCacheEntry {
    semantic_revision: u64,
    notes_revision: u64,
    color_group_count: usize,
    data: GraphData,
}

#[tauri::command]
pub(crate) fn get_graph_data_metadata(
    state: State<'_, AppState>,
    color_group_count: Option<usize>,
) -> Result<GraphDataMetadata, String> {
    let requested_color_group_count = color_group_count.unwrap_or(3);
    let notes_dir = prepare_notes_dir(false)?;
    let refresh_outcome = state.ensure_interactive_index(
        &notes_dir,
        INTERACTIVE_INDEX_REFRESH_MAX_AGE,
        "graph_metadata",
    )?;
    Ok(GraphDataMetadata {
        semantic_revision: state.semantic.current_index_revision(),
        notes_revision: refresh_outcome.revision,
        color_group_count: requested_color_group_count,
        invalidation_epoch: refresh_outcome.epoch,
        refreshed: refresh_outcome.used_full_refresh || refresh_outcome.changed,
    })
}

#[tauri::command]
pub(crate) fn get_graph_data(
    state: State<'_, AppState>,
    color_group_count: Option<usize>,
) -> Result<GraphData, String> {
    let requested_color_group_count = color_group_count.unwrap_or(3);
    let notes_dir = prepare_notes_dir(false)?;
    let db_path = state
        .semantic
        .db_path()
        .ok_or_else(|| "Semantic search is not available".to_string())?;

    let notes_revision = state
        .ensure_interactive_index(
            &notes_dir,
            INTERACTIVE_INDEX_REFRESH_MAX_AGE,
            "graph_payload",
        )?
        .revision;
    let semantic_revision = state.semantic.current_index_revision();
    if let Some(cached) = lookup_graph_data_cache(
        semantic_revision,
        notes_revision,
        requested_color_group_count,
    )? {
        return Ok(cached.data);
    }

    let connection = open_database(&db_path)?;
    ensure_schema(&connection)?;

    let embeddings_raw = load_note_embeddings(&connection)?;
    if embeddings_raw.is_empty() {
        return Ok(GraphData {
            nodes: Vec::new(),
            clusters: Vec::new(),
            wikilink_edges: Vec::new(),
            inferred_edges: Vec::new(),
            time_range: (0, 0),
        });
    }

    let note_paths: Vec<String> = embeddings_raw
        .iter()
        .map(|embedding| embedding.note_path.clone())
        .collect();

    let stored_note_map = load_all_notes_with_meta_for_paths(&connection, &note_paths)?;
    if stored_note_map.is_empty() {
        return Ok(GraphData {
            nodes: Vec::new(),
            clusters: Vec::new(),
            wikilink_edges: Vec::new(),
            inferred_edges: Vec::new(),
            time_range: (0, 0),
        });
    }

    let snippets = load_first_chunk_text_per_note_for_paths(&connection, &note_paths)?;
    let positions = load_graph_positions_for_notes(&connection, &note_paths)?;
    let stored_edges = load_all_edges_for_notes(&connection, &note_paths)?;

    let position_map: HashMap<String, (f64, f64)> = positions
        .into_iter()
        .map(|p| (p.note_path, (p.x, p.y)))
        .collect();

    let embeddings_for_cluster: Vec<(String, Vec<f32>)> = embeddings_raw
        .into_iter()
        .filter(|embedding| stored_note_map.contains_key(&embedding.note_path))
        .map(|embedding| (embedding.note_path, embedding.embedding))
        .collect();

    let note_titles: HashMap<String, String> = embeddings_for_cluster
        .iter()
        .filter_map(|(path, _)| {
            let title = stored_note_map.get(path)?.title.clone();
            Some((path.clone(), title))
        })
        .collect();

    let note_snippets: HashMap<String, String> = embeddings_for_cluster
        .iter()
        .filter_map(|(path, _)| {
            let text = snippets.get(path)?.clone();
            Some((path.clone(), text))
        })
        .collect();

    let provider = state.semantic.embedding_provider();
    let model = provider.as_ref().map(|provider| provider.model_info());
    let cached_clusters =
        lookup_graph_cluster_cache(semantic_revision, requested_color_group_count)?;
    let (path_to_cluster, mut clusters) = if let Some(cached) = cached_clusters {
        (cached.assignments, cached.clusters)
    } else {
        if !embeddings_for_cluster.is_empty() && model.as_ref().is_some_and(|model| !model.ready) {
            let is_loading = model.as_ref().is_some_and(|model| model.loading);
            let reason = model
                .as_ref()
                .and_then(|model| model.error.clone())
                .unwrap_or_else(|| {
                    model
                        .as_ref()
                        .map(|model| model.status.clone())
                        .unwrap_or_else(|| "Embedding model is not ready".to_string())
                });
            let message = if is_loading {
                format!(
                    "Map calculations are waiting for the embedding model to finish loading. {reason}"
                )
            } else {
                format!("Map calculations are unavailable because the embedding model is not ready. {reason}")
            };
            return Err(message);
        }

        let embed_fn = provider.as_ref().map(|p| {
            let p = p.clone();
            move |texts: &[String]| -> Result<Vec<Vec<f32>>, String> {
                p.embed_texts(texts, crate::semantic::embed::EmbeddingInputKind::Document)
            }
        });

        let cluster_result = cluster_notes(
            &embeddings_for_cluster,
            &note_titles,
            &note_snippets,
            embed_fn
                .as_ref()
                .map(|f| f as &crate::semantic::cluster::EmbedFn),
            requested_color_group_count,
        );

        let assignments: HashMap<String, usize> = embeddings_for_cluster
            .iter()
            .enumerate()
            .map(|(index, (path, _))| (path.clone(), cluster_result.assignments[index]))
            .collect();

        let clusters = (0..cluster_result.k)
            .map(|id| {
                let note_count = cluster_result
                    .assignments
                    .iter()
                    .filter(|&&cluster_id| cluster_id == id)
                    .count();
                GraphCluster {
                    id,
                    label: cluster_result
                        .labels
                        .get(id)
                        .cloned()
                        .unwrap_or_else(|| "Notes".to_string()),
                    note_count,
                    color_index: cluster_result.color_groups.get(id).copied().unwrap_or(0),
                }
            })
            .filter(|cluster| cluster.note_count > 0)
            .collect::<Vec<_>>();

        store_graph_cluster_cache(GraphClusterCacheEntry {
            revision: semantic_revision,
            color_group_count: requested_color_group_count,
            assignments: assignments.clone(),
            clusters: clusters.clone(),
        })?;

        (assignments, clusters)
    };

    let mut time_min = u64::MAX;
    let mut time_max = 0u64;

    let nodes: Vec<GraphNode> = embeddings_for_cluster
        .iter()
        .filter_map(|(path, _)| {
            let note_meta = stored_note_map.get(path)?;
            let cluster_id = *path_to_cluster.get(path)?;
            let snippet_raw = snippets.get(path).cloned().unwrap_or_default();
            let snippet = truncate_snippet(&snippet_raw, 120);
            let created_at_millis =
                parse_rfc3339_to_millis(&note_meta.created_at).unwrap_or(note_meta.modified_millis);
            let pos = position_map.get(path);

            if created_at_millis > 0 {
                time_min = time_min.min(created_at_millis);
                time_max = time_max.max(created_at_millis);
            }

            Some(GraphNode {
                path: path.clone(),
                title: note_meta.title.clone(),
                snippet,
                cluster_id,
                created_at_millis,
                modified_millis: note_meta.modified_millis,
                x_hint: pos.map(|(x, _)| *x),
                y_hint: pos.map(|(_, y)| *y),
            })
        })
        .collect();

    if time_min > time_max {
        time_min = 0;
        time_max = 0;
    }

    clusters.retain(|cluster| cluster.note_count > 0);

    let inferred_edges: Vec<GraphEdge> = stored_edges
        .into_iter()
        .filter(|e| {
            stored_note_map.contains_key(&e.source_note_path)
                && stored_note_map.contains_key(&e.target_note_path)
        })
        .map(|e| GraphEdge {
            source: e.source_note_path,
            target: e.target_note_path,
            score: e.score,
        })
        .collect();

    let wikilink_edges = extract_wikilinks(&state, &notes_dir, &stored_note_map)?;

    let graph_data = GraphData {
        nodes,
        clusters,
        wikilink_edges,
        inferred_edges,
        time_range: (time_min, time_max),
    };

    let _ = store_graph_data_cache(GraphDataCacheEntry {
        semantic_revision,
        notes_revision,
        color_group_count: requested_color_group_count,
        data: graph_data.clone(),
    });

    Ok(graph_data)
}

#[tauri::command]
pub(crate) fn save_graph_node_positions(
    state: State<'_, AppState>,
    positions: Vec<GraphPositionEntry>,
) -> Result<(), String> {
    let db_path = state
        .semantic
        .db_path()
        .ok_or_else(|| "Semantic search is not available".to_string())?;

    let mut connection = open_database(&db_path)?;
    ensure_schema(&connection)?;

    let entries: Vec<(String, f64, f64)> =
        positions.into_iter().map(|p| (p.path, p.x, p.y)).collect();
    save_graph_positions(&mut connection, &entries)
}

fn extract_wikilinks(
    state: &State<'_, AppState>,
    _notes_dir: &Path,
    valid_notes: &HashMap<String, StoredNoteWithMeta>,
) -> Result<Vec<WikilinkEdge>, String> {
    let index = state
        .notes_index
        .lock()
        .map_err(|_| "Search index lock poisoned".to_string())?;

    let title_to_path: HashMap<String, String> = index
        .entries
        .iter()
        .flat_map(|(path, note)| {
            let path_str = path.to_string_lossy().into_owned();
            let mut mappings = vec![
                (note.title_lower.clone(), path_str.clone()),
                (note.file_name_lower.clone(), path_str.clone()),
            ];
            let file_stem_lower = note
                .file_name
                .strip_suffix(".md")
                .or_else(|| note.file_name.strip_suffix(".MD"))
                .unwrap_or(&note.file_name)
                .to_lowercase();
            mappings.push((file_stem_lower, path_str));
            mappings
        })
        .collect();

    let mut edges = Vec::new();
    let mut seen = HashSet::new();

    for (path, note) in index.entries.iter() {
        let path_str = path.to_string_lossy().into_owned();
        if !valid_notes.contains_key(&path_str) {
            continue;
        }

        for raw_target in extract_note_wikilink_targets(note) {
            if raw_target.is_empty() {
                continue;
            }

            let normalized = raw_target.to_lowercase();
            if let Some(target_path) = title_to_path.get(&normalized) {
                if target_path != &path_str && valid_notes.contains_key(target_path) {
                    let key = if path_str < *target_path {
                        (path_str.clone(), target_path.clone())
                    } else {
                        (target_path.clone(), path_str.clone())
                    };
                    if seen.insert(key) {
                        edges.push(WikilinkEdge {
                            source: path_str.clone(),
                            target: target_path.clone(),
                        });
                    }
                }
            }
        }
    }

    Ok(edges)
}

fn extract_note_wikilink_targets(note: &crate::index::IndexedNote) -> Vec<String> {
    let mut targets = extract_wikilink_targets(&note.title);
    for paragraph in &note.paragraphs {
        targets.extend(extract_wikilink_targets(&paragraph.text));
    }
    targets
}

fn lookup_graph_cluster_cache(
    revision: u64,
    color_group_count: usize,
) -> Result<Option<GraphClusterCacheEntry>, String> {
    let cache = GRAPH_CLUSTER_CACHE
        .lock()
        .map_err(|_| "Graph cache lock poisoned".to_string())?;
    Ok(cache
        .iter()
        .find(|entry| entry.revision == revision && entry.color_group_count == color_group_count)
        .cloned())
}

fn lookup_graph_data_cache(
    semantic_revision: u64,
    notes_revision: u64,
    color_group_count: usize,
) -> Result<Option<GraphDataCacheEntry>, String> {
    let cache = GRAPH_DATA_CACHE
        .lock()
        .map_err(|_| "Graph cache lock poisoned".to_string())?;
    Ok(cache
        .iter()
        .find(|entry| {
            entry.semantic_revision == semantic_revision
                && entry.notes_revision == notes_revision
                && entry.color_group_count == color_group_count
        })
        .cloned())
}

fn store_graph_cluster_cache(entry: GraphClusterCacheEntry) -> Result<(), String> {
    let mut cache = GRAPH_CLUSTER_CACHE
        .lock()
        .map_err(|_| "Graph cache lock poisoned".to_string())?;
    cache.retain(|existing| {
        !(existing.revision == entry.revision
            && existing.color_group_count == entry.color_group_count)
    });
    cache.insert(0, entry);
    if cache.len() > GRAPH_CLUSTER_CACHE_LIMIT {
        cache.truncate(GRAPH_CLUSTER_CACHE_LIMIT);
    }
    Ok(())
}

fn store_graph_data_cache(entry: GraphDataCacheEntry) -> Result<(), String> {
    let mut cache = GRAPH_DATA_CACHE
        .lock()
        .map_err(|_| "Graph cache lock poisoned".to_string())?;
    cache.retain(|existing| {
        !(existing.semantic_revision == entry.semantic_revision
            && existing.notes_revision == entry.notes_revision
            && existing.color_group_count == entry.color_group_count)
    });
    cache.insert(0, entry);
    if cache.len() > GRAPH_DATA_CACHE_LIMIT {
        cache.truncate(GRAPH_DATA_CACHE_LIMIT);
    }
    Ok(())
}

fn extract_wikilink_targets(markdown: &str) -> Vec<String> {
    let mut targets = Vec::new();
    let bytes = markdown.as_bytes();
    let len = bytes.len();
    let mut i = 0;

    while i + 1 < len {
        if bytes[i] == b'[' && bytes[i + 1] == b'[' {
            i += 2;
            let start = i;
            while i < len && bytes[i] != b']' && bytes[i] != b'|' && bytes[i] != b'#' {
                i += 1;
            }
            if i > start {
                let target = &markdown[start..i];
                let trimmed = target.trim();
                if !trimmed.is_empty() {
                    targets.push(trimmed.to_string());
                }
            }
        } else {
            i += 1;
        }
    }

    targets
}

fn truncate_snippet(text: &str, max_chars: usize) -> String {
    let cleaned = text
        .lines()
        .filter(|line| {
            let trimmed = line.trim();
            !trimmed.starts_with('#') && !trimmed.is_empty()
        })
        .collect::<Vec<_>>()
        .join(" ");

    if cleaned.len() <= max_chars {
        cleaned
    } else {
        let truncated: String = cleaned.chars().take(max_chars).collect();
        format!("{truncated}...")
    }
}

fn parse_rfc3339_to_millis(timestamp: &str) -> Option<u64> {
    let trimmed = timestamp.trim();
    if trimmed.is_empty() {
        return None;
    }

    let parts: Vec<&str> = trimmed.split('T').collect();
    if parts.len() != 2 {
        return None;
    }

    let date_parts: Vec<&str> = parts[0].split('-').collect();
    if date_parts.len() != 3 {
        return None;
    }
    let year: i64 = date_parts[0].parse().ok()?;
    let month: i64 = date_parts[1].parse().ok()?;
    let day: i64 = date_parts[2].parse().ok()?;

    let time_str = parts[1].trim_end_matches('Z');
    let time_parts: Vec<&str> = time_str.split(':').collect();
    if time_parts.len() < 3 {
        return None;
    }
    let hour: i64 = time_parts[0].parse().ok()?;
    let minute: i64 = time_parts[1].parse().ok()?;
    let second: i64 = time_parts[2].split('.').next()?.parse().ok()?;

    let days = days_from_civil(year, month, day);
    let total_seconds = days * 86_400 + hour * 3_600 + minute * 60 + second;
    Some((total_seconds * 1_000) as u64)
}

fn days_from_civil(year: i64, month: i64, day: i64) -> i64 {
    let y = if month <= 2 { year - 1 } else { year };
    let m = if month <= 2 { month + 9 } else { month - 3 };
    let era = if y >= 0 { y } else { y - 399 } / 400;
    let yoe = y - era * 400;
    let doy = (153 * m + 2) / 5 + day - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146_097 + doe - 719_468
}
