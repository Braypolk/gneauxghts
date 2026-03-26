use super::{prepare_notes_dir, INTERACTIVE_INDEX_REFRESH_MAX_AGE};
use crate::{
    index::AppState,
    semantic::{
        cluster::cluster_notes,
        db::{
            ensure_schema, load_all_edges, load_all_notes_with_meta,
            load_first_chunk_text_per_note, load_graph_positions, load_note_embeddings,
            open_database, save_graph_positions,
        },
    },
};
use serde::{Deserialize, Serialize};
use std::{
    collections::{HashMap, HashSet},
    fs,
    path::Path,
};
use tauri::State;

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

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GraphPositionEntry {
    path: String,
    x: f64,
    y: f64,
}

#[tauri::command]
pub(crate) fn get_graph_data(
    state: State<'_, AppState>,
    color_group_count: Option<usize>,
) -> Result<GraphData, String> {
    let notes_dir = prepare_notes_dir(false)?;
    let db_path = state
        .semantic
        .db_path()
        .ok_or_else(|| "Semantic search is not available".to_string())?;

    let connection = open_database(&db_path)?;
    ensure_schema(&connection)?;

    let stored_notes = load_all_notes_with_meta(&connection)?;
    if stored_notes.is_empty() {
        return Ok(GraphData {
            nodes: Vec::new(),
            clusters: Vec::new(),
            wikilink_edges: Vec::new(),
            inferred_edges: Vec::new(),
            time_range: (0, 0),
        });
    }

    let embeddings_raw = load_note_embeddings(&connection)?;
    let snippets = load_first_chunk_text_per_note(&connection)?;
    let positions = load_graph_positions(&connection)?;
    let stored_edges = load_all_edges(&connection)?;

    let position_map: HashMap<String, (f64, f64)> = positions
        .into_iter()
        .map(|p| (p.note_path, (p.x, p.y)))
        .collect();

    let indexed_paths: HashSet<String> =
        embeddings_raw.iter().map(|e| e.note_path.clone()).collect();
    let stored_note_map: HashMap<String, _> = stored_notes
        .iter()
        .filter(|n| indexed_paths.contains(&n.path))
        .map(|n| (n.path.clone(), n))
        .collect();

    let embeddings_for_cluster: Vec<(String, Vec<f32>)> = embeddings_raw
        .iter()
        .filter(|e| stored_note_map.contains_key(&e.note_path))
        .map(|e| (e.note_path.clone(), e.embedding.clone()))
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
        color_group_count.unwrap_or(3),
    );

    let path_to_cluster: HashMap<String, usize> = embeddings_for_cluster
        .iter()
        .enumerate()
        .map(|(i, (path, _))| (path.clone(), cluster_result.assignments[i]))
        .collect();

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

    let mut clusters: Vec<GraphCluster> = (0..cluster_result.k)
        .map(|id| {
            let note_count = cluster_result
                .assignments
                .iter()
                .filter(|&&c| c == id)
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
        .collect();
    clusters.retain(|c| c.note_count > 0);

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

    Ok(GraphData {
        nodes,
        clusters,
        wikilink_edges,
        inferred_edges,
        time_range: (time_min, time_max),
    })
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
    notes_dir: &Path,
    valid_notes: &HashMap<String, &crate::semantic::db::StoredNoteWithMeta>,
) -> Result<Vec<WikilinkEdge>, String> {
    let mut index = state
        .notes_index
        .lock()
        .map_err(|_| "Search index lock poisoned".to_string())?;
    index.refresh_if_stale(notes_dir, INTERACTIVE_INDEX_REFRESH_MAX_AGE)?;

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

    for (path, _note) in index.entries.iter() {
        let path_str = path.to_string_lossy().into_owned();
        if !valid_notes.contains_key(&path_str) {
            continue;
        }

        let Ok(markdown) = fs::read_to_string(path) else {
            continue;
        };

        for raw_target in extract_wikilink_targets(&markdown) {
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
