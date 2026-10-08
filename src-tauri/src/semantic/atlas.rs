mod continuity;
mod geometry;
mod map_store;
mod stable_layout;
pub(crate) use map_store::{AtlasCloudName, AtlasMapStore};
mod publication;
mod query;
use geometry::{
    apply_centrality, apply_umap_layout, boost_links, build_cloud, build_hnsw_knn_rows,
    build_layout_graph, collect_links, finalize_cloud_cores, normalized_embedding,
    place_cloud_first_layout, place_uncached_nodes_from_neighbors, separate_umap_clouds,
};
pub(crate) use query::{frequency_score, recency_score};

use super::{
    atlas_labels::{
        cloud_membership_fingerprint, generate_labels_progressive, medoid_placeholder,
        AtlasLabelNote, LABEL_ALGORITHM_VERSION,
    },
    db::{
        load_atlas_note_embeddings, load_atlas_note_metadata, load_atlas_positions,
        load_edge_generation, open_database, StoredAtlasNoteEmbedding, StoredAtlasNoteMetadata,
    },
    debug::SemanticDebugState,
    embed::EmbeddingProvider,
    indexer::{PendingIndexState, NOTE_PRESENTATION_ALGORITHM_VERSION},
    note_ann::NoteAnnIndexState,
    similarity::atlas_cosine_similarity,
    ActiveSemanticState,
};
use crate::index::normalize_search_text;
use crate::note::DocumentKind;
use crate::state::NoteActivity;
use crate::time::current_time_millis;
use serde::{Deserialize, Serialize};
use std::{
    collections::{HashMap, HashSet},
    path::{Path, PathBuf},
    sync::{Arc, Mutex, Once},
    time::Instant,
};

const CLOUD_MIN_NOTES: usize = 3;
const CHILD_CLOUD_MIN_NOTES: usize = 5;
const TOP_CLOUD_SOFT_MAX: usize = 36;
const SUBCLOUD_PROMOTE_MIN: usize = 8;
const HIGH_AFFINITY_MERGE_THRESHOLD: f32 = 0.62;
const CHILD_PARTITION_SEPARATION_MIN: f32 = 0.22;
const COMMUNITY_EDGE_MIN_STRENGTH: f32 = 0.48;
const KNN_GRAPH_K: usize = 24;
const KNN_MIN_SCORE: f32 = 0.30;
const SEMANTIC_MIN_SCORE: f32 = KNN_MIN_SCORE;
const COMPONENT_MIN_STRENGTH: f32 = 0.30;
const WIKILINK_STRENGTH: f32 = 0.82;
const FOLDER_BOOST: f32 = 0.035;
const NOTE_RADIUS_MIN: f32 = 4.0;
const NOTE_RADIUS_MAX: f32 = 9.0;
const TOP_LEVEL_CLOUD_GAP: f32 = 96.0;
const CHILD_CLOUD_GAP: f32 = 10.0;
const DEFAULT_LAYOUT_PULL: f32 = 1.4;
const LAYOUT_LINKS_PER_NODE: usize = 8;
const LAYOUT_MAX_DEGREE: usize = 14;
const CHILD_TARGET_MAX_NOTES: usize = 16;
const UMAP_ITERATIONS_MAX: usize = 140;
const UMAP_ITERATIONS_BASE: usize = 40;
const UMAP_ITERATIONS_SQRT_SCALE: f32 = 3.0;
/// Bumped when layout/clustering parallelism or iteration budgets change.
const ATLAS_LAYOUT_ALGORITHM_VERSION: u32 = 17;
const DISC_LAYOUT_FULL_PAIR_MAX: usize = 80;
const DISC_LAYOUT_REPULSION_NEIGHBORS: usize = 16;
const ATLAS_CLOUD_ALGORITHM_VERSION: u32 = 2;
const ATLAS_GENERATION_FORMAT_VERSION: u32 = 1;
const ATLAS_SUPERSEDED: &str = "atlas generation superseded";
pub(crate) const ATLAS_DEPENDENCIES_NOT_READY: &str = "Atlas dependencies are not ready";

#[derive(Clone, Debug)]
pub(crate) struct AtlasNoteMetadata {
    pub(crate) note_id: Option<String>,
    pub(crate) note_path: String,
    pub(crate) file_name: String,
    pub(crate) title: String,
    pub(crate) preview: String,
    pub(crate) tags: Vec<String>,
    pub(crate) document_kind: DocumentKind,
    pub(crate) modified_millis: u64,
}

#[derive(Clone, Copy, Debug, Default, Deserialize, Hash, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum AtlasChatVisibilityKey {
    #[default]
    Hidden,
    Remembered,
    All,
}

impl AtlasChatVisibilityKey {
    pub(crate) fn signature_value(self) -> &'static str {
        match self {
            Self::Hidden => "hidden",
            Self::Remembered => "remembered",
            Self::All => "all",
        }
    }
}

#[derive(Clone, Copy, Debug, Default, Hash, PartialEq, Eq)]
pub(crate) struct AtlasGenerationKey {
    pub(crate) chat_visibility: AtlasChatVisibilityKey,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct AtlasLabelRequest {
    pub(crate) structural_generation: String,
    pub(crate) membership_fingerprint: String,
}

const NAVIGATION_ONLY_SEMANTIC_HASH_PREFIX: &str = "navigation-only:";

#[derive(Clone, Debug)]
pub(crate) struct AtlasHardLink {
    pub(crate) source_note_path: String,
    pub(crate) target_note_path: String,
}

/// Apply the caller's visibility policy to durable semantic rows, then add a
/// lightweight conversation node for chat indexes that are visible only by
/// navigation/wikilink structure. The placeholder vector is deterministic and
/// derived from the path—not transcript content—and is never persisted to the
/// semantic database.
fn visible_atlas_notes(
    mut indexed: Vec<StoredAtlasNoteEmbedding>,
    metadata: &HashMap<String, AtlasNoteMetadata>,
    dimensions: usize,
) -> Vec<StoredAtlasNoteEmbedding> {
    indexed.retain(|note| metadata.contains_key(&note.note_path));
    let mut indexed_paths = indexed
        .iter()
        .map(|note| note.note_path.clone())
        .collect::<HashSet<_>>();
    let dimensions = indexed
        .first()
        .map(|note| note.embedding.len())
        .filter(|value| *value > 0)
        .unwrap_or(dimensions.max(1));

    for meta in metadata.values() {
        if meta.document_kind != DocumentKind::ChatIndex
            || !indexed_paths.insert(meta.note_path.clone())
        {
            continue;
        }
        indexed.push(StoredAtlasNoteEmbedding {
            note_path: meta.note_path.clone(),
            note_title: meta.title.clone(),
            modified_millis: meta.modified_millis,
            semantic_input_hash: format!(
                "{NAVIGATION_ONLY_SEMANTIC_HASH_PREFIX}{}",
                meta.note_path
            ),
            structure_hash: format!("navigation-only:{}", meta.note_path),
            created_at: String::new(),
            updated_at: String::new(),
            embedding: navigation_only_embedding(&meta.note_path, dimensions),
        });
    }
    indexed.sort_by(|left, right| left.note_path.cmp(&right.note_path));
    indexed
}

fn navigation_only_embedding(path: &str, dimensions: usize) -> Vec<f32> {
    let mut embedding = vec![0.0; dimensions.max(1)];
    let digest = blake3::hash(path.as_bytes());
    for (offset, byte) in digest.as_bytes().iter().take(4).enumerate() {
        let index = ((*byte as usize) + offset * 67) % embedding.len();
        embedding[index] += 1.0 / (offset as f32 + 1.0);
    }
    embedding
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct VaultAtlasResponse {
    pub(crate) status: String,
    pub(crate) reason: Option<String>,
    #[serde(default)]
    pub(crate) world_layout: bool,
    #[serde(default)]
    pub(crate) name_revision: u64,
    pub(crate) revision: u64,
    pub(crate) generated_at_millis: u64,
    pub(crate) structural_generation: String,
    pub(crate) label_generation: Option<String>,
    pub(crate) published_at_millis: u64,
    pub(crate) stale: bool,
    pub(crate) publish_in_progress: bool,
    pub(crate) nodes: Vec<AtlasNode>,
    pub(crate) links: Vec<AtlasLink>,
    pub(crate) clouds: Vec<AtlasCloud>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AtlasSearchResponse {
    pub(crate) status: String,
    pub(crate) reason: Option<String>,
    pub(crate) query: String,
    pub(crate) generated_at_millis: u64,
    pub(crate) matches: Vec<AtlasSearchMatch>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AtlasSearchMatch {
    pub(crate) note_id: Option<String>,
    pub(crate) note_path: String,
    pub(crate) document_kind: DocumentKind,
    pub(crate) score: f32,
    pub(crate) semantic_score: f32,
    pub(crate) lexical_score: f32,
    pub(crate) structural_score: f32,
    pub(crate) reason_labels: Vec<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AtlasNode {
    pub(crate) id: String,
    pub(crate) note_id: Option<String>,
    pub(crate) note_path: String,
    pub(crate) title: String,
    pub(crate) file_name: String,
    pub(crate) document_kind: DocumentKind,
    pub(crate) x: f32,
    pub(crate) y: f32,
    pub(crate) radius: f32,
    pub(crate) cloud_id: Option<String>,
    pub(crate) parent_cloud_id: Option<String>,
    pub(crate) child_cloud_id: Option<String>,
    pub(crate) cluster_id: Option<String>,
    pub(crate) subcluster_id: Option<String>,
    pub(crate) centrality: f32,
    pub(crate) importance: f32,
    pub(crate) last_viewed_at_millis: Option<u64>,
    #[serde(default)]
    pub(crate) effective_open_count: Option<u64>,
    pub(crate) created_at_millis: u64,
    pub(crate) updated_at_millis: u64,
    pub(crate) preview: String,
    pub(crate) tags: Vec<String>,
    pub(crate) isolated: bool,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AtlasLink {
    pub(crate) id: String,
    pub(crate) source_id: String,
    pub(crate) target_id: String,
    pub(crate) kind: String,
    pub(crate) score: f32,
    pub(crate) strength: f32,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AtlasCloud {
    #[serde(default)]
    pub(crate) user_name: Option<String>,
    #[serde(default)]
    pub(crate) family_id: Option<String>,
    #[serde(default)]
    pub(crate) family_name: Option<String>,
    pub(crate) id: String,
    pub(crate) parent_id: Option<String>,
    pub(crate) level: usize,
    pub(crate) label: Option<String>,
    /// `pending` for a structural placeholder, `topic` for an embedding topic name.
    /// Historical artifacts can contain `keybert` or `medoid`.
    #[serde(default = "default_pending_label_source")]
    pub(crate) label_source: String,
    pub(crate) note_count: usize,
    pub(crate) density: f32,
    pub(crate) color: [u8; 4],
    pub(crate) centroid: [f32; 2],
    pub(crate) radius: f32,
    pub(crate) hull: Vec<[f32; 2]>,
    pub(crate) member_node_ids: Vec<String>,
    pub(crate) core_node_ids: Vec<String>,
    pub(crate) outlier_node_ids: Vec<String>,
    pub(crate) child_cloud_ids: Vec<String>,
    pub(crate) representative_node_ids: Vec<String>,
}

fn default_pending_label_source() -> String {
    "pending".to_string()
}

fn suppress_missing_atlas_nodes(
    response: &mut VaultAtlasResponse,
    eligible: &HashMap<String, AtlasNoteMetadata>,
) {
    let retained_node_ids = response
        .nodes
        .iter()
        .filter(|node| {
            eligible.contains_key(&node.note_path) && Path::new(&node.note_path).is_file()
        })
        .map(|node| node.id.clone())
        .collect::<HashSet<_>>();
    if retained_node_ids.len() == response.nodes.len() {
        return;
    }
    response
        .nodes
        .retain(|node| retained_node_ids.contains(&node.id));
    response.links.retain(|link| {
        retained_node_ids.contains(&link.source_id) && retained_node_ids.contains(&link.target_id)
    });
    for cloud in &mut response.clouds {
        cloud
            .member_node_ids
            .retain(|node_id| retained_node_ids.contains(node_id));
        cloud
            .core_node_ids
            .retain(|node_id| retained_node_ids.contains(node_id));
        cloud
            .outlier_node_ids
            .retain(|node_id| retained_node_ids.contains(node_id));
        cloud
            .representative_node_ids
            .retain(|node_id| retained_node_ids.contains(node_id));
        cloud.note_count = cloud.member_node_ids.len();
        cloud.label = None;
        cloud.label_source = default_pending_label_source();
    }
    response.clouds.retain(|cloud| cloud.note_count > 0);
    let retained_cloud_ids = response
        .clouds
        .iter()
        .map(|cloud| cloud.id.clone())
        .collect::<HashSet<_>>();
    for cloud in &mut response.clouds {
        cloud
            .child_cloud_ids
            .retain(|cloud_id| retained_cloud_ids.contains(cloud_id));
    }
}

#[derive(Clone)]
struct WorkingNode {
    has_semantic_content: bool,
    id: String,
    note_id: Option<String>,
    note_path: String,
    title: String,
    file_name: String,
    preview: String,
    tags: Vec<String>,
    created_at_millis: u64,
    updated_at_millis: u64,
    last_viewed_at_millis: Option<u64>,
    centrality: f32,
    importance: f32,
    embedding: Vec<f32>,
    x: f32,
    y: f32,
    cloud_id: Option<String>,
    parent_cloud_id: Option<String>,
    child_cloud_id: Option<String>,
    isolated: bool,
}

#[derive(Clone)]
struct WorkingLink {
    source_id: String,
    target_id: String,
    kind: String,
    score: f32,
    strength: f32,
}

#[derive(Clone, Debug)]
struct KnnNeighbor {
    index: usize,
    similarity: f32,
    distance: f32,
}

#[derive(Clone, Debug)]
struct LayoutEdge {
    source_id: String,
    target_id: String,
    weight: f32,
}

#[derive(Clone, Debug)]
struct CloudSpec {
    id: String,
    parent_id: Option<String>,
    level: usize,
    member_node_ids: Vec<String>,
    core_node_ids: Vec<String>,
    outlier_node_ids: Vec<String>,
    child_cloud_ids: Vec<String>,
    centroid: [f32; 2],
    radius: f32,
    centrality: f32,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
struct AtlasDependencies {
    source_key: String,
    input_hash: String,
    note_ann_generation: String,
    edge_generation: String,
    edge_algorithm_version: String,
    cloud_algorithm_version: u32,
    layout_algorithm_version: u32,
}

pub(crate) struct AtlasWorkerContext {
    pub(crate) map_store: Arc<AtlasMapStore>,
    pub(crate) db_path: PathBuf,
    pub(crate) cache_dir: PathBuf,
    pub(crate) dimensions: usize,
    pub(crate) provider: Arc<dyn EmbeddingProvider + Send + Sync>,
    pub(crate) debug: Arc<SemanticDebugState>,
    pub(crate) note_ann: Arc<NoteAnnIndexState>,
    pub(crate) pending: Arc<Mutex<PendingIndexState>>,
}

struct PersistedAtlasInputs {
    metadata: HashMap<String, AtlasNoteMetadata>,
    hard_links: Vec<AtlasHardLink>,
    dependencies: AtlasDependencies,
}

fn persisted_atlas_inputs(
    connection: &rusqlite::Connection,
    key: AtlasGenerationKey,
) -> Result<PersistedAtlasInputs, String> {
    let rows = load_atlas_note_metadata(connection)?;
    let visible = rows
        .iter()
        .filter(|row| atlas_row_visible(row, key.chat_visibility))
        .collect::<Vec<_>>();
    let metadata = visible
        .iter()
        .map(|row| {
            let file_name = file_name_for_path(&row.note_path);
            (
                row.note_path.clone(),
                AtlasNoteMetadata {
                    note_id: (!row.note_id.is_empty()).then(|| row.note_id.clone()),
                    note_path: row.note_path.clone(),
                    file_name,
                    title: row.title.clone(),
                    preview: row.preview.clone(),
                    tags: atlas_searchable_tags(
                        row.document_kind,
                        &row.presentation_hash,
                        &row.tags,
                    ),
                    document_kind: row.document_kind,
                    modified_millis: row.modified_millis,
                },
            )
        })
        .collect::<HashMap<_, _>>();
    let hard_links = persisted_hard_links(&rows, &metadata);
    let embeddings = load_atlas_note_embeddings(connection)?;
    let mut source_hasher = blake3::Hasher::new();
    source_hasher.update(key.chat_visibility.signature_value().as_bytes());
    let mut input_hasher = blake3::Hasher::new();
    for row in &visible {
        source_hasher.update(row.note_path.as_bytes());
        input_hasher.update(row.note_path.as_bytes());
        input_hasher.update(row.presentation_hash.as_bytes());
        input_hasher.update(row.note_id.as_bytes());
        input_hasher.update(row.document_kind.as_frontmatter_value().as_bytes());
        input_hasher.update(&row.modified_millis.to_le_bytes());
        for tag in &row.tags {
            input_hasher.update(tag.as_bytes());
        }
        for target in &row.wikilink_targets {
            input_hasher.update(target.as_bytes());
        }
    }
    for note in embeddings
        .iter()
        .filter(|note| metadata.contains_key(&note.note_path))
    {
        input_hasher.update(note.note_path.as_bytes());
        input_hasher.update(note.semantic_input_hash.as_bytes());
        input_hasher.update(note.structure_hash.as_bytes());
    }
    let edge = load_edge_generation(connection)?;
    let dependencies = AtlasDependencies {
        source_key: source_hasher.finalize().to_hex().to_string(),
        input_hash: input_hasher.finalize().to_hex().to_string(),
        note_ann_generation: edge
            .as_ref()
            .map(|value| value.note_ann_generation.clone())
            .unwrap_or_default(),
        edge_generation: edge
            .as_ref()
            .map(|value| value.generation_id.clone())
            .unwrap_or_default(),
        edge_algorithm_version: edge
            .as_ref()
            .map(|value| value.algorithm_version.clone())
            .unwrap_or_default(),
        cloud_algorithm_version: ATLAS_CLOUD_ALGORITHM_VERSION,
        layout_algorithm_version: ATLAS_LAYOUT_ALGORITHM_VERSION,
    };
    Ok(PersistedAtlasInputs {
        metadata,
        hard_links,
        dependencies,
    })
}

fn atlas_row_visible(row: &StoredAtlasNoteMetadata, visibility: AtlasChatVisibilityKey) -> bool {
    match visibility {
        AtlasChatVisibilityKey::Hidden => row.document_kind == DocumentKind::Note,
        AtlasChatVisibilityKey::Remembered => {
            row.document_kind == DocumentKind::Note
                || (row.document_kind == DocumentKind::ChatIndex && row.chunk_count > 0)
        }
        AtlasChatVisibilityKey::All => row.document_kind != DocumentKind::ChatTranscript,
    }
}

const ATLAS_VISIBILITIES_ALL: &[AtlasChatVisibilityKey] = &[
    AtlasChatVisibilityKey::Hidden,
    AtlasChatVisibilityKey::Remembered,
    AtlasChatVisibilityKey::All,
];

/// Remembered + All only. Hidden is notes-only (`atlas_row_visible`), so a
/// ChatRecall-only mutation cannot change Hidden membership or its layout set.
const ATLAS_VISIBILITIES_CHAT_AFFECTED: &[AtlasChatVisibilityKey] = &[
    AtlasChatVisibilityKey::Remembered,
    AtlasChatVisibilityKey::All,
];

/// Which per-visibility atlas rebuilds a semantic mutation batch can affect.
///
/// Notes appear under every visibility filter, so note markdown updates (and
/// deletes/moves, whose document kinds are unknown at enqueue time) require
/// all three variants. ChatRecall updates only touch ChatIndex rows, which
/// Hidden never includes — rebuilding Hidden would be redundant work.
///
/// Non-document jobs (scans, edge refresh, ANN rebuild) should pass
/// `force_all = true` so every ready variant still refreshes.
pub(crate) fn atlas_visibilities_for_mutation_batch(
    has_note_markdown: bool,
    has_chat_recall: bool,
    has_deletes_or_moves: bool,
    force_all: bool,
) -> &'static [AtlasChatVisibilityKey] {
    if force_all || has_note_markdown || has_deletes_or_moves || !has_chat_recall {
        ATLAS_VISIBILITIES_ALL
    } else {
        ATLAS_VISIBILITIES_CHAT_AFFECTED
    }
}

/// True when a structural build for `key` is already covering `epoch` or newer,
/// so re-enqueueing the same visibility would only add redundant queue work.
pub(crate) fn atlas_structural_build_covers_epoch(
    pending: &PendingIndexState,
    key: AtlasGenerationKey,
    epoch: u64,
) -> bool {
    pending
        .atlas_building
        .get(&key)
        .is_some_and(|building| *building >= epoch)
}

fn persisted_hard_links(
    rows: &[StoredAtlasNoteMetadata],
    metadata: &HashMap<String, AtlasNoteMetadata>,
) -> Vec<AtlasHardLink> {
    let mut references = HashMap::new();
    for note in metadata.values() {
        for value in [&note.title, &note.file_name] {
            references.insert(normalize_reference(value), note.note_path.clone());
        }
        references.insert(
            normalize_reference(
                Path::new(&note.file_name)
                    .file_stem()
                    .unwrap_or_default()
                    .to_string_lossy()
                    .as_ref(),
            ),
            note.note_path.clone(),
        );
    }
    let mut seen = HashSet::new();
    let mut links = Vec::new();
    for row in rows {
        let source = if row.document_kind == DocumentKind::ChatTranscript {
            Path::new(&row.note_path)
                .parent()
                .map(|parent| parent.join("Conversation.md"))
                .filter(|path| metadata.contains_key(path.to_string_lossy().as_ref()))
                .map(|path| path.to_string_lossy().into_owned())
        } else {
            metadata
                .contains_key(&row.note_path)
                .then(|| row.note_path.clone())
        };
        let Some(source) = source else {
            continue;
        };
        for target in &row.wikilink_targets {
            let Some(target) = references.get(&normalize_reference(target)) else {
                continue;
            };
            if source == *target {
                continue;
            }
            let pair = if source < *target {
                format!("{source}\0{target}")
            } else {
                format!("{target}\0{source}")
            };
            if seen.insert(pair) {
                links.push(AtlasHardLink {
                    source_note_path: source.clone(),
                    target_note_path: target.clone(),
                });
            }
        }
    }
    links
}

fn normalize_reference(value: &str) -> String {
    let trimmed = value.trim();
    normalize_search_text(
        trimmed
            .strip_suffix(".md")
            .or_else(|| trimmed.strip_suffix(".MD"))
            .unwrap_or(trimmed),
    )
}

fn elapsed_millis(started: Instant) -> u64 {
    started.elapsed().as_millis().min(u128::from(u64::MAX)) as u64
}

fn record_atlas_phase(debug: &super::debug::SemanticDebugState, phase: &str, started: Instant) {
    let duration_millis = elapsed_millis(started);
    debug.record_timing(
        "atlas",
        phase,
        None,
        duration_millis,
        |metrics| match phase {
            "load" => {
                metrics.atlas_load_duration_total_millis += duration_millis;
                metrics.atlas_load_duration_max_millis =
                    metrics.atlas_load_duration_max_millis.max(duration_millis);
            }
            "graph" => {
                metrics.atlas_graph_duration_total_millis += duration_millis;
                metrics.atlas_graph_duration_max_millis =
                    metrics.atlas_graph_duration_max_millis.max(duration_millis);
            }
            "cloud" => {
                metrics.atlas_cloud_duration_total_millis += duration_millis;
                metrics.atlas_cloud_duration_max_millis =
                    metrics.atlas_cloud_duration_max_millis.max(duration_millis);
            }
            "layout" => {
                metrics.atlas_layout_duration_total_millis += duration_millis;
                metrics.atlas_layout_duration_max_millis = metrics
                    .atlas_layout_duration_max_millis
                    .max(duration_millis);
            }
            "persist" => {
                metrics.atlas_persist_duration_total_millis += duration_millis;
                metrics.atlas_persist_duration_max_millis = metrics
                    .atlas_persist_duration_max_millis
                    .max(duration_millis);
            }
            _ => {}
        },
    );
}

fn record_atlas_total(debug: &super::debug::SemanticDebugState, started: Instant, cache_hit: bool) {
    let duration_millis = elapsed_millis(started);
    debug.record_timing(
        "atlas",
        "build_completed",
        Some(format!("cache_hit={cache_hit}")),
        duration_millis,
        |metrics| {
            metrics.atlas_duration_total_millis += duration_millis;
            metrics.atlas_duration_max_millis =
                metrics.atlas_duration_max_millis.max(duration_millis);
        },
    );
}

fn empty_atlas(status: &str, reason: &str, revision: u64) -> Result<VaultAtlasResponse, String> {
    Ok(VaultAtlasResponse {
        world_layout: true,
        name_revision: 0,
        status: status.to_string(),
        reason: Some(reason.to_string()),
        revision,
        generated_at_millis: current_time_millis()?,
        structural_generation: String::new(),
        label_generation: None,
        published_at_millis: 0,
        stale: false,
        publish_in_progress: false,
        nodes: Vec::new(),
        links: Vec::new(),
        clouds: Vec::new(),
    })
}

fn seeded_position(value: &str, index: usize) -> (f32, f32) {
    let hash = stable_hash(value);
    let angle = (hash % 10_000) as f32 / 10_000.0 * std::f32::consts::TAU;
    let radius = 150.0 + ((index as f32).sqrt() * 48.0);
    (angle.cos() * radius, angle.sin() * radius)
}

fn stable_hash(value: &str) -> u64 {
    let mut hash = 1469598103934665603u64;
    for byte in value.as_bytes() {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(1099511628211);
    }
    hash
}

fn ordered_pair(left: String, right: String) -> (String, String) {
    if left <= right {
        (left, right)
    } else {
        (right, left)
    }
}

fn file_name_for_path(note_path: &str) -> String {
    Path::new(note_path)
        .file_name()
        .unwrap_or_default()
        .to_string_lossy()
        .into_owned()
}

fn atlas_searchable_tags(
    document_kind: DocumentKind,
    presentation_hash: &str,
    tags: &[String],
) -> Vec<String> {
    if document_kind == DocumentKind::Note
        && !presentation_hash.starts_with(NOTE_PRESENTATION_ALGORITHM_VERSION)
    {
        // Rows created before authored frontmatter tags may contain body hashtags
        // or unrelated keys. Ignore them while the versioned background reconciliation
        // refreshes the metadata without re-embedding unchanged content.
        return Vec::new();
    }
    tags.to_vec()
}

fn parent_folder(note_path: &str) -> String {
    Path::new(note_path)
        .parent()
        .map(|path| path.to_string_lossy().into_owned())
        .unwrap_or_default()
}

fn ensure_rayon_uses_all_cores() {
    static INIT: Once = Once::new();
    INIT.call_once(|| {
        let threads = std::thread::available_parallelism()
            .map(|value| value.get())
            .unwrap_or(1)
            .max(1);
        // Ignore error if another subsystem already built the global pool.
        let _ = rayon::ThreadPoolBuilder::new()
            .num_threads(threads)
            .thread_name(|index| format!("atlas-rayon-{index}"))
            .build_global();
        eprintln!(
            "[atlas] rayon threads requested={threads} active={}",
            rayon::current_num_threads()
        );
    });
}
