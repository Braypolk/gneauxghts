use super::{
    atlas_labels::{
        cloud_membership_fingerprint, generate_labels_progressive, medoid_placeholder,
        AtlasLabelNote, LABEL_ALGORITHM_VERSION,
    },
    db::{
        load_atlas_note_embeddings, load_atlas_note_metadata, load_atlas_positions,
        load_edge_generation, open_database, save_atlas_positions, StoredAtlasNoteEmbedding,
        StoredAtlasNoteMetadata, StoredAtlasPosition,
    },
    debug::SemanticDebugState,
    embed::{EmbeddingInputKind, EmbeddingProvider},
    indexer::PendingIndexState,
    note_ann::NoteAnnIndexState,
    ActiveSemanticState,
};
use crate::index::normalize_search_text;
use crate::note::DocumentKind;
use crate::state::{effective_open_count, NoteActivity};
use crate::time::current_time_millis;
use hnswlib_rs::{Cosine, Hnsw, HnswConfig, InMemoryVectorStore};
use leiden_rs::{GraphDataBuilder, Leiden, LeidenConfig, QualityType};
use ndarray::Array2;
use rayon::prelude::*;
use serde::{Deserialize, Serialize};
use std::{
    collections::{HashMap, HashSet},
    fs::{self, File},
    io::{BufWriter, Write},
    panic::{catch_unwind, AssertUnwindSafe},
    path::{Path, PathBuf},
    sync::{Arc, Mutex, Once},
    time::Instant,
};
use umap_rs::{GraphParams, OptimizationParams, Umap, UmapConfig};

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
const STALE_DRIFT_DISTANCE: f32 = 420.0;
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
const ATLAS_LAYOUT_ALGORITHM_VERSION: u32 = 16;
const DISC_LAYOUT_FULL_PAIR_MAX: usize = 80;
const DISC_LAYOUT_REPULSION_NEIGHBORS: usize = 16;
const ATLAS_CLOUD_ALGORITHM_VERSION: u32 = 1;
const ATLAS_GENERATION_FORMAT_VERSION: u32 = 1;
const ATLAS_SUPERSEDED: &str = "atlas generation superseded";
pub(crate) const ATLAS_DEPENDENCIES_NOT_READY: &str = "Atlas dependencies are not ready";
const ATLAS_SEARCH_SEMANTIC_WEIGHT: f32 = 0.55;
const ATLAS_SEARCH_LEXICAL_WEIGHT: f32 = 0.25;
const ATLAS_SEARCH_STRUCTURAL_WEIGHT: f32 = 0.10;
const ATLAS_SEARCH_RECENCY_WEIGHT: f32 = 0.07;
const ATLAS_SEARCH_FREQUENCY_WEIGHT: f32 = 0.03;

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
pub(crate) struct VaultAtlasStats {
    pub(crate) note_count: usize,
    pub(crate) cloud_count: usize,
    pub(crate) link_count: usize,
    pub(crate) isolated_count: usize,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct VaultAtlasResponse {
    pub(crate) status: String,
    pub(crate) reason: Option<String>,
    pub(crate) revision: u64,
    pub(crate) generated_at_millis: u64,
    pub(crate) structural_generation: String,
    pub(crate) label_generation: Option<String>,
    pub(crate) published_at_millis: u64,
    pub(crate) stale: bool,
    pub(crate) publish_in_progress: bool,
    pub(crate) stats: VaultAtlasStats,
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
    pub(crate) score: f32,
    pub(crate) semantic_score: f32,
    pub(crate) lexical_score: f32,
    pub(crate) structural_score: f32,
    pub(crate) recency_score: f32,
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
    pub(crate) drift_x: f32,
    pub(crate) drift_y: f32,
    pub(crate) radius: f32,
    pub(crate) cloud_id: Option<String>,
    pub(crate) parent_cloud_id: Option<String>,
    pub(crate) child_cloud_id: Option<String>,
    pub(crate) cluster_id: Option<String>,
    pub(crate) subcluster_id: Option<String>,
    pub(crate) centrality: f32,
    pub(crate) degree: usize,
    pub(crate) importance: f32,
    pub(crate) modified_at_millis: u64,
    pub(crate) last_viewed_at_millis: Option<u64>,
    pub(crate) created_at_millis: u64,
    pub(crate) updated_at_millis: u64,
    pub(crate) stale_score: f32,
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
    pub(crate) id: String,
    pub(crate) parent_id: Option<String>,
    pub(crate) level: usize,
    pub(crate) label: Option<String>,
    pub(crate) label_confidence: f32,
    /// `pending` while waiting for KeyBERT, `keybert` for content labels,
    /// `medoid` when falling back to a representative note title/filename.
    #[serde(default = "default_pending_label_source")]
    pub(crate) label_source: String,
    pub(crate) note_count: usize,
    pub(crate) density: f32,
    pub(crate) color: [u8; 4],
    pub(crate) centroid: [f32; 2],
    pub(crate) label_anchor: [f32; 2],
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

#[derive(Clone)]
struct WorkingNode {
    id: String,
    note_id: Option<String>,
    note_path: String,
    title: String,
    file_name: String,
    preview: String,
    tags: Vec<String>,
    modified_at_millis: u64,
    created_at_millis: u64,
    updated_at_millis: u64,
    last_viewed_at_millis: Option<u64>,
    stale_score: f32,
    centrality: f32,
    degree: usize,
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

type EdgeAdjacency = HashMap<String, Vec<usize>>;

fn build_edge_adjacency(edges: &[LayoutEdge]) -> EdgeAdjacency {
    let mut adjacency = EdgeAdjacency::new();
    for (index, edge) in edges.iter().enumerate() {
        adjacency
            .entry(edge.source_id.clone())
            .or_default()
            .push(index);
        adjacency
            .entry(edge.target_id.clone())
            .or_default()
            .push(index);
    }
    adjacency
}

struct TopGroupPartition {
    members: Vec<String>,
    /// Children already computed for this exact member set; None means assign_clouds must detect.
    precomputed_children: Option<Vec<Vec<String>>>,
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

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct AtlasReadyPointer {
    format_version: u32,
    structural_generation: String,
    target_epoch: u64,
    published_at_millis: u64,
    artifact_file: String,
    dependencies: AtlasDependencies,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
struct AtlasGenerationArtifact {
    response: VaultAtlasResponse,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct AtlasLabelReadyPointer {
    format_version: u32,
    structural_generation: String,
    membership_fingerprint: String,
    algorithm_version: String,
    model_fingerprint: String,
    label_generation: String,
    artifact_file: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct AtlasLabelGenerationArtifact {
    structural_generation: String,
    membership_fingerprint: String,
    algorithm_version: String,
    model_fingerprint: String,
    label_generation: String,
    labels: HashMap<String, AtlasPublishedLabel>,
    /// False while labels are still streaming in; true when the job finished.
    /// Missing on older artifacts — treat as complete.
    #[serde(default = "default_label_artifact_complete")]
    complete: bool,
}

fn default_label_artifact_complete() -> bool {
    true
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct AtlasPublishedLabel {
    label: String,
    confidence: f32,
    #[serde(default = "default_medoid_label_source")]
    source: String,
}

fn default_medoid_label_source() -> String {
    "medoid".to_string()
}

pub(crate) struct AtlasWorkerContext {
    pub(crate) db_path: PathBuf,
    pub(crate) cache_dir: PathBuf,
    pub(crate) dimensions: usize,
    pub(crate) provider: Arc<dyn EmbeddingProvider + Send + Sync>,
    pub(crate) debug: Arc<SemanticDebugState>,
    pub(crate) note_ann: Arc<NoteAnnIndexState>,
    pub(crate) pending: Arc<Mutex<PendingIndexState>>,
}

fn atlas_root(cache_dir: &Path) -> PathBuf {
    cache_dir.join("atlas")
}

fn ready_pointer_path(cache_dir: &Path, key: AtlasGenerationKey) -> PathBuf {
    atlas_root(cache_dir).join(format!(
        "ready-{}.json",
        key.chat_visibility.signature_value()
    ))
}

fn label_ready_pointer_path(cache_dir: &Path, key: AtlasGenerationKey) -> PathBuf {
    atlas_root(cache_dir).join(format!(
        "label-ready-{}.json",
        key.chat_visibility.signature_value()
    ))
}

fn atomic_write_json(path: &Path, value: &impl Serialize) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| "Atlas publication path has no parent".to_string())?;
    fs::create_dir_all(parent).map_err(|err| err.to_string())?;
    let temporary = parent.join(format!(
        ".{}.{}.tmp",
        path.file_name().unwrap_or_default().to_string_lossy(),
        current_time_millis()?
    ));
    let file = File::create(&temporary).map_err(|err| err.to_string())?;
    let mut writer = BufWriter::new(file);
    serde_json::to_writer(&mut writer, value).map_err(|err| err.to_string())?;
    writer.flush().map_err(|err| err.to_string())?;
    writer.get_ref().sync_all().map_err(|err| err.to_string())?;
    drop(writer);
    fs::rename(&temporary, path).map_err(|err| err.to_string())?;
    File::open(parent)
        .and_then(|directory| directory.sync_all())
        .map_err(|err| err.to_string())
}

fn gc_unreferenced_generations(cache_dir: &Path) -> Result<(), String> {
    let root = atlas_root(cache_dir);
    let mut referenced = HashSet::new();
    for visibility in [
        AtlasChatVisibilityKey::Hidden,
        AtlasChatVisibilityKey::Remembered,
        AtlasChatVisibilityKey::All,
    ] {
        if let Ok(pointer) = read_json::<AtlasReadyPointer>(&ready_pointer_path(
            cache_dir,
            AtlasGenerationKey {
                chat_visibility: visibility,
            },
        )) {
            referenced.insert(pointer.artifact_file);
        }
        if let Ok(pointer) = read_json::<AtlasLabelReadyPointer>(&label_ready_pointer_path(
            cache_dir,
            AtlasGenerationKey {
                chat_visibility: visibility,
            },
        )) {
            referenced.insert(pointer.artifact_file);
        }
    }
    let Ok(entries) = fs::read_dir(&root) else {
        return Ok(());
    };
    for entry in entries {
        let entry = entry.map_err(|err| err.to_string())?;
        let name = entry.file_name().to_string_lossy().into_owned();
        if (name.starts_with("generation-") || name.starts_with("label-generation-"))
            && name.ends_with(".json")
            && !referenced.contains(&name)
        {
            fs::remove_file(entry.path()).map_err(|err| err.to_string())?;
        }
    }
    Ok(())
}

fn read_json<T: for<'de> Deserialize<'de>>(path: &Path) -> Result<T, String> {
    let bytes = fs::read(path).map_err(|err| err.to_string())?;
    serde_json::from_slice(&bytes).map_err(|err| err.to_string())
}

fn pointer_is_compatible(
    pointer: &AtlasReadyPointer,
    dependencies: &AtlasDependencies,
    revision: u64,
) -> bool {
    pointer.format_version == ATLAS_GENERATION_FORMAT_VERSION
        && pointer.dependencies == *dependencies
        && pointer.target_epoch >= revision
}

fn label_pointer_is_compatible(
    pointer: &AtlasLabelReadyPointer,
    structural_generation: &str,
    membership_fingerprint: &str,
    model_fingerprint: &str,
) -> bool {
    pointer.format_version == ATLAS_GENERATION_FORMAT_VERSION
        && pointer.structural_generation == structural_generation
        && pointer.membership_fingerprint == membership_fingerprint
        && pointer.algorithm_version == LABEL_ALGORITHM_VERSION
        && pointer.model_fingerprint == model_fingerprint
}

fn request_is_superseded(
    pending: &PendingIndexState,
    generation_key: AtlasGenerationKey,
    target_epoch: u64,
) -> bool {
    pending
        .atlas_requests
        .get(&generation_key)
        .is_some_and(|epoch| *epoch > target_epoch)
}

fn persisted_atlas_inputs(
    connection: &rusqlite::Connection,
    key: AtlasGenerationKey,
) -> Result<
    (
        HashMap<String, AtlasNoteMetadata>,
        Vec<AtlasHardLink>,
        AtlasDependencies,
    ),
    String,
> {
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
                    tags: row.tags.clone(),
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
    Ok((metadata, hard_links, dependencies))
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

impl AtlasWorkerContext {
    pub(crate) fn build_and_publish(
        &self,
        generation_key: AtlasGenerationKey,
        revision: u64,
    ) -> Result<VaultAtlasResponse, String> {
        ensure_rayon_uses_all_cores();
        let activity_by_note_id: HashMap<String, NoteActivity> = HashMap::new();
        let request_started = Instant::now();
        self.debug.record_with_metrics(
            "atlas",
            "build_started",
            Some(format!(
                "chat_visibility={}",
                generation_key.chat_visibility.signature_value()
            )),
            None,
            |metrics| metrics.atlas_request_count += 1,
        );
        let load_started = Instant::now();
        let mut connection = open_database(&self.db_path)?;
        super::ensure_schema(&connection)?;
        let (metadata, hard_links, dependencies) =
            persisted_atlas_inputs(&connection, generation_key)?;
        if dependencies.note_ann_generation.is_empty()
            || self.note_ann.generation_id().as_deref()
                != Some(dependencies.note_ann_generation.as_str())
        {
            return Err(ATLAS_DEPENDENCIES_NOT_READY.to_string());
        }
        let indexed_notes = visible_atlas_notes(
            load_atlas_note_embeddings(&connection)?,
            &metadata,
            self.dimensions,
        );
        if indexed_notes.is_empty() {
            record_atlas_phase(&self.debug, "load", load_started);
            let response = empty_atlas("empty", "No indexed notes are available yet.", revision)?;
            record_atlas_total(&self.debug, request_started, false);
            return Ok(response);
        }

        let layout_pull = DEFAULT_LAYOUT_PULL;
        let positions = load_atlas_positions(&connection)?
            .into_iter()
            .map(|position| (position.note_path, (position.x, position.y)))
            .collect::<HashMap<_, _>>();
        let has_all_cached_positions = indexed_notes
            .iter()
            .all(|note| positions.contains_key(&note.note_path));
        let max_modified = indexed_notes
            .iter()
            .map(|note| note.modified_millis)
            .max()
            .unwrap_or(0);
        record_atlas_phase(&self.debug, "load", load_started);

        let mut nodes = indexed_notes
            .iter()
            .enumerate()
            .map(|(index, note)| {
                let meta = metadata.get(&note.note_path);
                let note_id = meta.and_then(|item| item.note_id.clone());
                let last_viewed = note_id
                    .as_ref()
                    .and_then(|id| activity_by_note_id.get(id))
                    .map(|activity| activity.last_viewed_at_millis);
                let (x, y) = positions
                    .get(&note.note_path)
                    .copied()
                    .unwrap_or_else(|| seeded_position(&note.note_path, index));
                let created_at_millis =
                    parse_rfc3339_millis(&note.created_at).unwrap_or(note.modified_millis);
                let updated_at_millis =
                    parse_rfc3339_millis(&note.updated_at).unwrap_or(note.modified_millis);
                WorkingNode {
                    id: note.note_path.clone(),
                    note_id,
                    note_path: note.note_path.clone(),
                    title: meta
                        .map(|item| item.title.clone())
                        .filter(|title| !title.trim().is_empty())
                        .unwrap_or_else(|| note.note_title.clone()),
                    file_name: meta
                        .map(|item| item.file_name.clone())
                        .unwrap_or_else(|| file_name_for_path(&note.note_path)),
                    preview: meta.map(|item| item.preview.clone()).unwrap_or_default(),
                    tags: meta.map(|item| item.tags.clone()).unwrap_or_default(),
                    modified_at_millis: note.modified_millis,
                    created_at_millis,
                    updated_at_millis,
                    last_viewed_at_millis: last_viewed,
                    stale_score: stale_score(
                        last_viewed.unwrap_or(note.modified_millis),
                        max_modified,
                    ),
                    centrality: 0.0,
                    degree: 0,
                    importance: 0.0,
                    embedding: normalized_embedding(note.embedding.clone()),
                    x,
                    y,
                    cloud_id: None,
                    parent_cloud_id: None,
                    child_cloud_id: None,
                    isolated: true,
                }
            })
            .collect::<Vec<_>>();

        let graph_started = Instant::now();
        let knn_rows = build_hnsw_knn_rows(&nodes);
        self.check_superseded(generation_key, revision)?;
        if !has_all_cached_positions {
            place_uncached_nodes_from_neighbors(&mut nodes, &positions, &knn_rows);
        }
        let mut links = collect_links(&nodes, &knn_rows, hard_links);
        boost_links(&mut links, &nodes);
        apply_centrality(&mut nodes, &links);
        let layout_edges = build_layout_graph(&nodes, &links);
        record_atlas_phase(&self.debug, "graph", graph_started);
        let cloud_started = Instant::now();
        let mut cloud_specs = assign_clouds(&mut nodes, &layout_edges);
        self.check_superseded(generation_key, revision)?;
        record_atlas_phase(&self.debug, "cloud", cloud_started);
        let layout_started = Instant::now();
        let umap_applied = apply_umap_layout(&mut nodes, &knn_rows);
        if umap_applied {
            separate_umap_clouds(&mut nodes, &layout_edges, &mut cloud_specs, layout_pull);
        } else {
            place_cloud_first_layout(&mut nodes, &layout_edges, &mut cloud_specs, layout_pull);
        }
        refresh_cloud_geometry(&mut cloud_specs, &nodes);
        self.check_superseded(generation_key, revision)?;
        record_atlas_phase(&self.debug, "layout", layout_started);
        let cloud_finalize_started = Instant::now();
        finalize_cloud_cores(&nodes, &layout_edges, &mut cloud_specs);
        let mut clouds = cloud_specs
            .par_iter()
            .map(|spec| build_cloud(spec, &nodes, &links))
            .collect::<Vec<_>>();
        clouds.sort_by(|left, right| {
            left.level
                .cmp(&right.level)
                .then_with(|| right.note_count.cmp(&left.note_count))
                .then_with(|| left.id.cmp(&right.id))
        });
        record_atlas_phase(&self.debug, "cloud", cloud_finalize_started);

        let persist_started = Instant::now();
        save_atlas_positions(
            &mut connection,
            &nodes
                .iter()
                .map(|node| StoredAtlasPosition {
                    note_path: node.note_path.clone(),
                    x: node.x,
                    y: node.y,
                })
                .collect::<Vec<_>>(),
        )?;

        let response_nodes = nodes
            .iter()
            .map(|node| {
                let drift = drift_position(node.x, node.y, node.stale_score);
                AtlasNode {
                    id: node.id.clone(),
                    note_id: node.note_id.clone(),
                    note_path: node.note_path.clone(),
                    title: node.title.clone(),
                    file_name: node.file_name.clone(),
                    document_kind: metadata
                        .get(&node.note_path)
                        .map(|meta| meta.document_kind)
                        .unwrap_or_default(),
                    x: node.x,
                    y: node.y,
                    drift_x: drift.0,
                    drift_y: drift.1,
                    radius: NOTE_RADIUS_MIN
                        + (NOTE_RADIUS_MAX - NOTE_RADIUS_MIN) * node.centrality.clamp(0.0, 1.0),
                    cloud_id: node.cloud_id.clone(),
                    parent_cloud_id: node.parent_cloud_id.clone(),
                    child_cloud_id: node.child_cloud_id.clone(),
                    cluster_id: node.cloud_id.clone(),
                    subcluster_id: node.child_cloud_id.clone(),
                    centrality: node.centrality,
                    degree: node.degree,
                    importance: node.importance,
                    modified_at_millis: node.modified_at_millis,
                    last_viewed_at_millis: node.last_viewed_at_millis,
                    created_at_millis: node.created_at_millis,
                    updated_at_millis: node.updated_at_millis,
                    stale_score: node.stale_score,
                    preview: node.preview.clone(),
                    tags: node.tags.clone(),
                    isolated: node.isolated,
                }
            })
            .collect::<Vec<_>>();
        let response_links = links
            .iter()
            .enumerate()
            .map(|(index, link)| AtlasLink {
                id: format!("{}:{}:{index}", link.source_id, link.target_id),
                source_id: link.source_id.clone(),
                target_id: link.target_id.clone(),
                kind: link.kind.clone(),
                score: link.score,
                strength: link.strength,
            })
            .collect::<Vec<_>>();

        record_atlas_phase(&self.debug, "persist", persist_started);

        let published_at_millis = current_time_millis()?;
        let structural_generation = format!(
            "{}-{}",
            revision,
            &blake3::hash(
                format!(
                    "{}\0{}\0{}",
                    dependencies.source_key, dependencies.input_hash, published_at_millis
                )
                .as_bytes()
            )
            .to_hex()[..16]
        );
        let response = VaultAtlasResponse {
            status: "ready".to_string(),
            reason: None,
            revision,
            generated_at_millis: published_at_millis,
            structural_generation: structural_generation.clone(),
            label_generation: None,
            published_at_millis,
            stale: false,
            publish_in_progress: false,
            stats: VaultAtlasStats {
                note_count: response_nodes.len(),
                cloud_count: clouds.len(),
                link_count: response_links.len(),
                isolated_count: response_nodes.iter().filter(|node| node.isolated).count(),
            },
            nodes: response_nodes,
            links: response_links,
            clouds,
        };
        self.check_superseded(generation_key, revision)?;
        let (_, _, current_dependencies) = persisted_atlas_inputs(&connection, generation_key)?;
        if current_dependencies != dependencies {
            return Err(ATLAS_SUPERSEDED.to_string());
        }
        let root = atlas_root(&self.cache_dir);
        fs::create_dir_all(&root).map_err(|err| err.to_string())?;
        let artifact_file = format!(
            "generation-{}-{}.json",
            generation_key.chat_visibility.signature_value(),
            structural_generation
        );
        atomic_write_json(
            &root.join(&artifact_file),
            &AtlasGenerationArtifact {
                response: response.clone(),
            },
        )?;
        self.check_superseded(generation_key, revision)?;
        let pointer = AtlasReadyPointer {
            format_version: ATLAS_GENERATION_FORMAT_VERSION,
            structural_generation,
            target_epoch: revision,
            published_at_millis,
            artifact_file: artifact_file.clone(),
            dependencies,
        };
        atomic_write_json(
            &ready_pointer_path(&self.cache_dir, generation_key),
            &pointer,
        )?;
        let membership_fingerprint =
            cloud_membership_fingerprint(&response.structural_generation, &response.clouds);
        if let Ok(mut pending) = self.pending.lock() {
            pending.atlas_label_requests.insert(
                generation_key,
                AtlasLabelRequest {
                    structural_generation: response.structural_generation.clone(),
                    membership_fingerprint,
                },
            );
        }
        gc_unreferenced_generations(&self.cache_dir)?;
        record_atlas_total(&self.debug, request_started, false);
        Ok(response)
    }

    pub(crate) fn build_and_publish_labels(
        &self,
        generation_key: AtlasGenerationKey,
        request: &AtlasLabelRequest,
    ) -> Result<(), String> {
        ensure_rayon_uses_all_cores();
        let started = Instant::now();
        let pointer_path = ready_pointer_path(&self.cache_dir, generation_key);
        let structural_pointer = read_json::<AtlasReadyPointer>(&pointer_path)?;
        if structural_pointer.structural_generation != request.structural_generation {
            return Err(ATLAS_SUPERSEDED.to_string());
        }
        let root = atlas_root(&self.cache_dir);
        let structural =
            read_json::<AtlasGenerationArtifact>(&root.join(&structural_pointer.artifact_file))?;
        let membership = cloud_membership_fingerprint(
            &structural.response.structural_generation,
            &structural.response.clouds,
        );
        if membership != request.membership_fingerprint {
            return Err(ATLAS_SUPERSEDED.to_string());
        }

        let mut connection = open_database(&self.db_path)?;
        super::ensure_schema(&connection)?;
        let (metadata, _, _) = persisted_atlas_inputs(&connection, generation_key)?;
        let note_embeddings = visible_atlas_notes(
            load_atlas_note_embeddings(&connection)?,
            &metadata,
            self.dimensions,
        )
        .into_iter()
        .map(|note| (note.note_path, normalized_embedding(note.embedding)))
        .collect::<HashMap<_, _>>();

        let generated_at = current_time_millis()?;
        let model_fingerprint = self.provider.model_info().fingerprint();
        let label_generation = format!(
            "{}-{}",
            generated_at,
            &blake3::hash(
                format!(
                    "{}\0{}\0{}\0{}",
                    request.structural_generation,
                    request.membership_fingerprint,
                    model_fingerprint,
                    LABEL_ALGORITHM_VERSION
                )
                .as_bytes()
            )
            .to_hex()[..16]
        );
        let artifact_file = format!(
            "label-generation-{}-{}.json",
            generation_key.chat_visibility.signature_value(),
            label_generation
        );
        let artifact_path = root.join(&artifact_file);
        let published = std::sync::Mutex::new(HashMap::<String, AtlasPublishedLabel>::new());
        let write_artifact = |labels: &HashMap<String, AtlasPublishedLabel>, complete: bool| {
            atomic_write_json(
                &artifact_path,
                &AtlasLabelGenerationArtifact {
                    structural_generation: request.structural_generation.clone(),
                    membership_fingerprint: request.membership_fingerprint.clone(),
                    algorithm_version: LABEL_ALGORITHM_VERSION.to_string(),
                    model_fingerprint: model_fingerprint.clone(),
                    label_generation: label_generation.clone(),
                    labels: labels.clone(),
                    complete,
                },
            )
        };
        write_artifact(&HashMap::new(), false)?;
        atomic_write_json(
            &label_ready_pointer_path(&self.cache_dir, generation_key),
            &AtlasLabelReadyPointer {
                format_version: ATLAS_GENERATION_FORMAT_VERSION,
                structural_generation: request.structural_generation.clone(),
                membership_fingerprint: request.membership_fingerprint.clone(),
                algorithm_version: LABEL_ALGORITHM_VERSION.to_string(),
                model_fingerprint: model_fingerprint.clone(),
                label_generation: label_generation.clone(),
                artifact_file: artifact_file.clone(),
            },
        )?;

        let metrics = {
            let (_, metrics) = generate_labels_progressive(
                &mut connection,
                self.provider.as_ref(),
                &structural.response.clouds,
                &structural.response.nodes,
                &note_embeddings,
                |cloud_id, assignment| {
                    let latest_pointer = read_json::<AtlasReadyPointer>(&pointer_path)?;
                    if latest_pointer.structural_generation != request.structural_generation {
                        let _ = fs::remove_file(&artifact_path);
                        return Err(ATLAS_SUPERSEDED.to_string());
                    }
                    let mut labels = published
                        .lock()
                        .map_err(|_| "Atlas label publish lock poisoned".to_string())?;
                    labels.insert(
                        cloud_id.to_string(),
                        AtlasPublishedLabel {
                            label: assignment.label.clone(),
                            confidence: assignment.confidence,
                            source: assignment.source.as_str().to_string(),
                        },
                    );
                    write_artifact(&labels, false)?;
                    Ok(())
                },
            )?;
            metrics
        };

        let latest_pointer = read_json::<AtlasReadyPointer>(&pointer_path)?;
        if latest_pointer.structural_generation != request.structural_generation {
            let _ = fs::remove_file(&artifact_path);
            return Err(ATLAS_SUPERSEDED.to_string());
        }
        let final_labels = published
            .into_inner()
            .map_err(|_| "Atlas label publish lock poisoned".to_string())?;
        write_artifact(&final_labels, true)?;
        gc_unreferenced_generations(&self.cache_dir)?;
        self.debug.record_timing(
            "atlas_labels",
            "published",
            Some(format!(
                "clouds={} candidates={} unique={} chunks={} selected={} cache_hits={} provider_texts={} batches={} keybert={} medoid_fallbacks={}",
                metrics.cloud_count,
                metrics.candidate_count,
                metrics.unique_candidate_count,
                metrics.chunk_count,
                metrics.selected_chunk_count,
                metrics.cache_hit_count,
                metrics.provider_text_count,
                metrics.provider_batch_count,
                metrics.keybert_label_count,
                metrics.medoid_fallback_count
            )),
            started.elapsed().as_millis().min(u128::from(u64::MAX)) as u64,
            |debug_metrics| {
                debug_metrics.atlas_label_job_count += 1;
                debug_metrics.atlas_label_candidate_total += metrics.candidate_count as u64;
                debug_metrics.atlas_label_cache_hit_total += metrics.cache_hit_count as u64;
                debug_metrics.atlas_label_provider_text_total += metrics.provider_text_count as u64;
            },
        );
        Ok(())
    }

    fn check_superseded(
        &self,
        generation_key: AtlasGenerationKey,
        target_epoch: u64,
    ) -> Result<(), String> {
        let superseded = self
            .pending
            .lock()
            .map(|pending| request_is_superseded(&pending, generation_key, target_epoch))
            .unwrap_or(true);
        if superseded {
            Err(ATLAS_SUPERSEDED.to_string())
        } else {
            Ok(())
        }
    }
}

impl ActiveSemanticState {
    pub(super) fn vault_atlas(
        &self,
        generation_key: AtlasGenerationKey,
        activity_by_note_id: HashMap<String, NoteActivity>,
        revision: u64,
    ) -> Result<VaultAtlasResponse, String> {
        let connection = open_database(&self.db_path)?;
        super::ensure_schema(&connection)?;
        let (_, _, dependencies) = persisted_atlas_inputs(&connection, generation_key)?;
        let pointer_path = ready_pointer_path(&self.atlas_cache_dir, generation_key);
        let pointer = read_json::<AtlasReadyPointer>(&pointer_path).ok();
        let mut published = pointer.as_ref().and_then(|pointer| {
            if pointer.format_version != ATLAS_GENERATION_FORMAT_VERSION {
                return None;
            }
            read_json::<AtlasGenerationArtifact>(
                &atlas_root(&self.atlas_cache_dir).join(&pointer.artifact_file),
            )
            .ok()
            .map(|artifact| artifact.response)
        });
        let compatible = pointer
            .as_ref()
            .is_some_and(|pointer| pointer_is_compatible(pointer, &dependencies, revision));
        let mut label_compatible = false;
        let mut label_complete = false;
        let mut label_request = None;
        let expected_label_model = self.provider.model_info().fingerprint();
        if let Some(response) = &mut published {
            let membership =
                cloud_membership_fingerprint(&response.structural_generation, &response.clouds);
            label_request = Some(AtlasLabelRequest {
                structural_generation: response.structural_generation.clone(),
                membership_fingerprint: membership.clone(),
            });
            if let Ok(label_pointer) = read_json::<AtlasLabelReadyPointer>(
                &label_ready_pointer_path(&self.atlas_cache_dir, generation_key),
            ) {
                if label_pointer_is_compatible(
                    &label_pointer,
                    &response.structural_generation,
                    &membership,
                    &expected_label_model,
                ) {
                    if let Ok(labels) = read_json::<AtlasLabelGenerationArtifact>(
                        &atlas_root(&self.atlas_cache_dir).join(&label_pointer.artifact_file),
                    ) {
                        if labels.structural_generation == response.structural_generation
                            && labels.membership_fingerprint == membership
                            && labels.algorithm_version == LABEL_ALGORITHM_VERSION
                            && labels.model_fingerprint == expected_label_model
                            && labels.label_generation == label_pointer.label_generation
                        {
                            for cloud in &mut response.clouds {
                                if let Some(published) = labels.labels.get(&cloud.id) {
                                    cloud.label = Some(published.label.clone());
                                    cloud.label_confidence = published.confidence;
                                    cloud.label_source = published.source.clone();
                                }
                            }
                            response.label_generation = Some(labels.label_generation);
                            label_compatible = true;
                            label_complete = labels.complete;
                        }
                    }
                }
            }
        }
        let mut pending = self
            .pending
            .lock()
            .map_err(|_| "Semantic pending state lock poisoned".to_string())?;
        let building = pending
            .atlas_building
            .get(&generation_key)
            .is_some_and(|epoch| *epoch >= revision);
        let mut enqueued = false;
        if !compatible && !building {
            pending
                .atlas_requests
                .entry(generation_key)
                .and_modify(|epoch| *epoch = (*epoch).max(revision))
                .or_insert(revision);
            enqueued = true;
        }
        let label_building = pending.atlas_label_building.contains(&generation_key);
        // Re-run labeling when missing/incompatible, or when a partial artifact
        // was left incomplete (e.g. interrupted progressive publish).
        if compatible && !(label_compatible && label_complete) && !label_building {
            if let Some(request) = label_request {
                pending.atlas_label_requests.insert(generation_key, request);
                enqueued = true;
            }
        }
        let queued = pending.atlas_requests.contains_key(&generation_key);
        let label_queued = pending.atlas_label_requests.contains_key(&generation_key);
        drop(pending);
        if enqueued {
            self.request_wake()?;
        }
        if let Some(mut response) = published.take() {
            let max_modified = response
                .nodes
                .iter()
                .map(|node| node.modified_at_millis)
                .max()
                .unwrap_or(0);
            for node in &mut response.nodes {
                let last_viewed = node
                    .note_id
                    .as_ref()
                    .and_then(|id| activity_by_note_id.get(id))
                    .map(|activity| activity.last_viewed_at_millis);
                node.last_viewed_at_millis = last_viewed;
                node.stale_score =
                    stale_score(last_viewed.unwrap_or(node.modified_at_millis), max_modified);
                (node.drift_x, node.drift_y) = drift_position(node.x, node.y, node.stale_score);
            }
            response.status = "ready".to_string();
            response.stale = !compatible;
            response.publish_in_progress = building || queued || label_building || label_queued;
            return Ok(response);
        }
        let mut response =
            empty_atlas("building", "Atlas is building in the background.", revision)?;
        response.publish_in_progress = true;
        Ok(response)
    }

    pub(super) fn search_vault_atlas(
        &self,
        generation_key: AtlasGenerationKey,
        query: String,
        activity_by_note_id: HashMap<String, NoteActivity>,
    ) -> Result<AtlasSearchResponse, String> {
        let trimmed_query = query.trim().to_string();
        if trimmed_query.is_empty() {
            return Ok(AtlasSearchResponse {
                status: "ready".to_string(),
                reason: None,
                query,
                generated_at_millis: current_time_millis()?,
                matches: Vec::new(),
            });
        }

        let connection = open_database(&self.db_path)?;
        super::ensure_schema(&connection)?;
        let (metadata, _, _) = persisted_atlas_inputs(&connection, generation_key)?;
        let indexed_notes = visible_atlas_notes(
            load_atlas_note_embeddings(&connection)?,
            &metadata,
            self.provider.model_info().dimensions,
        );
        if indexed_notes.is_empty() {
            return Ok(AtlasSearchResponse {
                status: "empty".to_string(),
                reason: Some("No indexed notes are available yet.".to_string()),
                query,
                generated_at_millis: current_time_millis()?,
                matches: Vec::new(),
            });
        }

        let query_embedding = self
            .provider
            .embed_texts(&[trimmed_query.clone()], EmbeddingInputKind::Query)
            .ok()
            .and_then(|mut embeddings| embeddings.pop());
        let now = current_time_millis()?;
        let normalized_query = normalize_search_text(&trimmed_query);
        let terms = normalized_query
            .split_whitespace()
            .filter(|term| !term.is_empty())
            .map(|term| term.to_string())
            .collect::<Vec<_>>();

        let mut matches = indexed_notes
            .into_iter()
            .map(|note| {
                let meta = metadata.get(&note.note_path);
                let title = meta
                    .map(|item| item.title.as_str())
                    .filter(|title| !title.trim().is_empty())
                    .unwrap_or(note.note_title.as_str());
                let fallback_file_name = file_name_for_path(&note.note_path);
                let file_name = meta
                    .map(|item| item.file_name.as_str())
                    .unwrap_or(fallback_file_name.as_str());
                let preview = meta.map(|item| item.preview.as_str()).unwrap_or("");
                let tags = meta.map_or(&[] as &[String], |item| item.tags.as_slice());
                let semantic_score = if note
                    .semantic_input_hash
                    .starts_with(NAVIGATION_ONLY_SEMANTIC_HASH_PREFIX)
                {
                    0.0
                } else {
                    query_embedding
                        .as_ref()
                        .map(|embedding| cosine_similarity(embedding, &note.embedding).max(0.0))
                        .unwrap_or(0.0)
                };
                let lexical_score = lexical_note_score(
                    &terms,
                    &[title, file_name, note.note_path.as_str(), preview],
                    tags,
                );
                let structural_score = title_tag_path_score(
                    &normalized_query,
                    &terms,
                    title,
                    file_name,
                    &note.note_path,
                    tags,
                );
                let note_id = meta.and_then(|item| item.note_id.clone());
                let activity = note_id.as_ref().and_then(|id| activity_by_note_id.get(id));
                let last_viewed = activity.map(|item| item.last_viewed_at_millis);
                let open_count = activity.map(|item| item.open_count).unwrap_or(0);
                let recency_score = recency_score(
                    now,
                    last_viewed.unwrap_or(note.modified_millis),
                    note.modified_millis,
                );
                let frequency_score = frequency_score(effective_open_count(
                    open_count,
                    last_viewed.unwrap_or(0),
                    now,
                ));
                let access_score = (0.7 * recency_score + 0.3 * frequency_score).clamp(0.0, 1.0);
                let score = ATLAS_SEARCH_SEMANTIC_WEIGHT * semantic_score
                    + ATLAS_SEARCH_LEXICAL_WEIGHT * lexical_score
                    + ATLAS_SEARCH_STRUCTURAL_WEIGHT * structural_score
                    + ATLAS_SEARCH_RECENCY_WEIGHT * recency_score
                    + ATLAS_SEARCH_FREQUENCY_WEIGHT * frequency_score;
                AtlasSearchMatch {
                    note_id,
                    note_path: note.note_path,
                    score: score.clamp(0.0, 1.0),
                    semantic_score,
                    lexical_score,
                    structural_score,
                    recency_score: access_score,
                    reason_labels: reason_labels(
                        semantic_score,
                        lexical_score,
                        structural_score,
                        access_score,
                    ),
                }
            })
            .filter(|item| {
                item.score > 0.02 || item.lexical_score > 0.0 || item.structural_score > 0.0
            })
            .collect::<Vec<_>>();
        matches.sort_by(|left, right| {
            right
                .score
                .total_cmp(&left.score)
                .then_with(|| left.note_path.cmp(&right.note_path))
        });

        Ok(AtlasSearchResponse {
            status: "ready".to_string(),
            reason: query_embedding.is_none().then(|| {
                "Semantic query embedding unavailable; used lexical and recency scoring."
                    .to_string()
            }),
            query,
            generated_at_millis: now,
            matches,
        })
    }
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
        status: status.to_string(),
        reason: Some(reason.to_string()),
        revision,
        generated_at_millis: current_time_millis()?,
        structural_generation: String::new(),
        label_generation: None,
        published_at_millis: 0,
        stale: false,
        publish_in_progress: false,
        stats: VaultAtlasStats {
            note_count: 0,
            cloud_count: 0,
            link_count: 0,
            isolated_count: 0,
        },
        nodes: Vec::new(),
        links: Vec::new(),
        clouds: Vec::new(),
    })
}

fn collect_links(
    nodes: &[WorkingNode],
    knn_rows: &[Vec<KnnNeighbor>],
    hard_links: Vec<AtlasHardLink>,
) -> Vec<WorkingLink> {
    let node_ids = nodes
        .iter()
        .map(|node| node.id.clone())
        .collect::<HashSet<_>>();
    let mut merged: HashMap<(String, String, String), WorkingLink> = HashMap::new();
    for (source_index, neighbors) in knn_rows.iter().enumerate() {
        let Some(source) = nodes.get(source_index) else {
            continue;
        };
        for neighbor in neighbors {
            let Some(target) = nodes.get(neighbor.index) else {
                continue;
            };
            if source.id == target.id || neighbor.similarity < SEMANTIC_MIN_SCORE {
                continue;
            }
            let (source_id, target_id) = ordered_pair(source.id.clone(), target.id.clone());
            let key = (source_id.clone(), target_id.clone(), "semantic".to_string());
            let strength = normalize_edge_strength(neighbor.similarity);
            merged
                .entry(key)
                .and_modify(|existing| {
                    if neighbor.similarity > existing.score {
                        existing.score = neighbor.similarity;
                        existing.strength = strength;
                    }
                })
                .or_insert(WorkingLink {
                    source_id,
                    target_id,
                    kind: "semantic".to_string(),
                    score: neighbor.similarity,
                    strength,
                });
        }
    }

    for hard_link in hard_links {
        if hard_link.source_note_path == hard_link.target_note_path
            || !node_ids.contains(&hard_link.source_note_path)
            || !node_ids.contains(&hard_link.target_note_path)
        {
            continue;
        }
        let (source_id, target_id) =
            ordered_pair(hard_link.source_note_path, hard_link.target_note_path);
        let link = WorkingLink {
            source_id: source_id.clone(),
            target_id: target_id.clone(),
            kind: "wikilink".to_string(),
            score: 1.0,
            strength: WIKILINK_STRENGTH,
        };
        merged.insert((source_id, target_id, "wikilink".to_string()), link);
    }

    merged.into_values().collect()
}

fn build_hnsw_knn_rows(nodes: &[WorkingNode]) -> Vec<Vec<KnnNeighbor>> {
    let k = KNN_GRAPH_K.min(nodes.len().saturating_sub(1));
    if nodes.len() < 2 || k == 0 {
        return vec![Vec::new(); nodes.len()];
    }
    let Some(dimensions) = nodes
        .iter()
        .map(|node| node.embedding.len())
        .find(|dimensions| *dimensions > 0)
    else {
        return exact_knn_rows(nodes, k);
    };
    if nodes.iter().any(|node| {
        node.embedding.len() != dimensions || node.embedding.iter().any(|value| !value.is_finite())
    }) {
        return exact_knn_rows(nodes, k);
    }

    let capacity = nodes.len().saturating_mul(2).max(1024).next_power_of_two();
    let graph = Hnsw::new(
        Cosine::new(),
        HnswConfig::new(dimensions, capacity)
            .m(16)
            .ef_construction(200)
            .ef_search(k.saturating_mul(4).max(64))
            .seed(ATLAS_LAYOUT_ALGORITHM_VERSION as u64),
    );
    let vectors = InMemoryVectorStore::<f32>::new(dimensions, capacity);
    for (index, node) in nodes.iter().enumerate() {
        if graph
            .set(&vectors, index as u64, node.embedding.as_slice())
            .is_err()
        {
            return exact_knn_rows(nodes, k);
        }
    }

    let rows: Option<Vec<Vec<KnnNeighbor>>> = nodes
        .par_iter()
        .enumerate()
        .map(|(source_index, source)| {
            let hits = graph
                .search(&vectors, source.embedding.as_slice(), k + 1, None)
                .ok()?;
            let mut neighbors = Vec::<KnnNeighbor>::new();
            for hit in hits {
                let target_index = hit.key as usize;
                if target_index == source_index || target_index >= nodes.len() {
                    continue;
                }
                let similarity =
                    cosine_similarity(&source.embedding, &nodes[target_index].embedding);
                push_unique_neighbor(&mut neighbors, target_index, similarity);
            }
            neighbors.sort_by(|left, right| {
                right
                    .similarity
                    .total_cmp(&left.similarity)
                    .then_with(|| nodes[left.index].id.cmp(&nodes[right.index].id))
            });
            neighbors.truncate(k);
            Some(neighbors)
        })
        .collect();
    rows.unwrap_or_else(|| exact_knn_rows(nodes, k))
}

fn exact_knn_rows(nodes: &[WorkingNode], k: usize) -> Vec<Vec<KnnNeighbor>> {
    nodes
        .par_iter()
        .enumerate()
        .map(|(source_index, source)| {
            let mut neighbors = nodes
                .iter()
                .enumerate()
                .filter_map(|(target_index, target)| {
                    if source_index == target_index {
                        return None;
                    }
                    let similarity = cosine_similarity(&source.embedding, &target.embedding);
                    Some(KnnNeighbor {
                        index: target_index,
                        similarity,
                        distance: cosine_distance_for_umap(similarity),
                    })
                })
                .collect::<Vec<_>>();
            neighbors.sort_by(|left, right| {
                right
                    .similarity
                    .total_cmp(&left.similarity)
                    .then_with(|| nodes[left.index].id.cmp(&nodes[right.index].id))
            });
            neighbors.truncate(k);
            neighbors
        })
        .collect()
}

fn push_unique_neighbor(neighbors: &mut Vec<KnnNeighbor>, target_index: usize, similarity: f32) {
    if neighbors
        .iter()
        .any(|neighbor| neighbor.index == target_index)
    {
        return;
    }
    neighbors.push(KnnNeighbor {
        index: target_index,
        similarity,
        distance: cosine_distance_for_umap(similarity),
    });
}

fn cosine_distance_for_umap(similarity: f32) -> f32 {
    (1.0 - similarity.clamp(-1.0, 1.0)).max(0.000_1)
}

fn place_uncached_nodes_from_neighbors(
    nodes: &mut [WorkingNode],
    cached_positions: &HashMap<String, (f32, f32)>,
    knn_rows: &[Vec<KnnNeighbor>],
) {
    let cached_by_index = nodes
        .iter()
        .enumerate()
        .filter_map(|(index, node)| {
            cached_positions
                .get(&node.note_path)
                .copied()
                .map(|pos| (index, pos))
        })
        .collect::<HashMap<_, _>>();
    for index in 0..nodes.len() {
        if cached_positions.contains_key(&nodes[index].note_path) {
            continue;
        }
        let mut weighted_x = 0.0_f32;
        let mut weighted_y = 0.0_f32;
        let mut total_weight = 0.0_f32;
        for neighbor in knn_rows.get(index).into_iter().flatten() {
            let Some((x, y)) = cached_by_index.get(&neighbor.index).copied() else {
                continue;
            };
            let weight = neighbor.similarity.max(0.05);
            weighted_x += x * weight;
            weighted_y += y * weight;
            total_weight += weight;
        }
        if total_weight <= f32::EPSILON {
            continue;
        }
        let angle = stable_angle(&nodes[index].id);
        let jitter = 18.0 + (stable_hash(&nodes[index].id) % 700) as f32 / 100.0;
        nodes[index].x = weighted_x / total_weight + angle.cos() * jitter;
        nodes[index].y = weighted_y / total_weight + angle.sin() * jitter;
    }
}

/// Structural link weights may depend on durable note structure only. Activity
/// is an overlay (drift/staleness/search) and must not perturb graph topology,
/// centrality, clouds, or cached layout.
fn boost_links(links: &mut [WorkingLink], nodes: &[WorkingNode]) {
    let node_by_id = nodes
        .iter()
        .map(|node| (node.id.as_str(), node))
        .collect::<HashMap<_, _>>();
    links.par_iter_mut().for_each(|link| {
        let Some(source) = node_by_id.get(link.source_id.as_str()) else {
            return;
        };
        let Some(target) = node_by_id.get(link.target_id.as_str()) else {
            return;
        };
        if parent_folder(&source.note_path) == parent_folder(&target.note_path) {
            link.strength += FOLDER_BOOST;
        }
        link.strength = link.strength.clamp(0.0, 1.0);
    });
}

fn apply_centrality(nodes: &mut [WorkingNode], links: &[WorkingLink]) {
    let mut totals = HashMap::<String, f32>::new();
    let mut degrees = HashMap::<String, usize>::new();
    for link in links {
        *totals.entry(link.source_id.clone()).or_default() += link.strength;
        *totals.entry(link.target_id.clone()).or_default() += link.strength;
        *degrees.entry(link.source_id.clone()).or_default() += 1;
        *degrees.entry(link.target_id.clone()).or_default() += 1;
    }
    let max_total = totals.values().copied().fold(0.0_f32, f32::max).max(1.0);
    for node in nodes {
        node.centrality = totals.get(&node.id).copied().unwrap_or(0.0) / max_total;
        node.degree = degrees.get(&node.id).copied().unwrap_or(0);
        node.importance = (node.centrality * 0.72
            + (node.degree as f32 / KNN_GRAPH_K as f32) * 0.28)
            .clamp(0.0, 1.0);
    }
}

fn build_layout_graph(nodes: &[WorkingNode], links: &[WorkingLink]) -> Vec<LayoutEdge> {
    let node_ids = nodes
        .iter()
        .map(|node| node.id.clone())
        .collect::<HashSet<_>>();
    let mut by_node = HashMap::<String, Vec<&WorkingLink>>::new();
    for link in links {
        if !node_ids.contains(&link.source_id) || !node_ids.contains(&link.target_id) {
            continue;
        }
        by_node
            .entry(link.source_id.clone())
            .or_default()
            .push(link);
        by_node
            .entry(link.target_id.clone())
            .or_default()
            .push(link);
    }

    let mut ranks = HashMap::<(String, String), (usize, usize)>::new();
    for (node_id, incident_links) in &mut by_node {
        incident_links.sort_by(|left, right| {
            right
                .strength
                .total_cmp(&left.strength)
                .then_with(|| left.source_id.cmp(&right.source_id))
                .then_with(|| left.target_id.cmp(&right.target_id))
        });
        for (rank, link) in incident_links.iter().enumerate() {
            let key = (link.source_id.clone(), link.target_id.clone());
            let entry = ranks.entry(key).or_insert((usize::MAX, usize::MAX));
            if link.source_id == *node_id {
                entry.0 = rank;
            } else {
                entry.1 = rank;
            }
        }
    }

    let mut candidates = links
        .iter()
        .filter(|link| {
            if !node_ids.contains(&link.source_id) || !node_ids.contains(&link.target_id) {
                return false;
            }
            if link.kind == "wikilink" || link.strength >= 0.78 {
                return true;
            }
            ranks
                .get(&(link.source_id.clone(), link.target_id.clone()))
                .is_some_and(|(source_rank, target_rank)| {
                    *source_rank < LAYOUT_LINKS_PER_NODE && *target_rank < LAYOUT_LINKS_PER_NODE
                })
        })
        .collect::<Vec<_>>();
    candidates.sort_by(|left, right| {
        let left_kind = if left.kind == "wikilink" { 1 } else { 0 };
        let right_kind = if right.kind == "wikilink" { 1 } else { 0 };
        right_kind
            .cmp(&left_kind)
            .then_with(|| right.strength.total_cmp(&left.strength))
            .then_with(|| left.source_id.cmp(&right.source_id))
            .then_with(|| left.target_id.cmp(&right.target_id))
    });

    let mut selected = HashMap::<(String, String), f32>::new();
    let mut degrees = HashMap::<String, usize>::new();
    for link in candidates {
        let source_degree = degrees.get(&link.source_id).copied().unwrap_or(0);
        let target_degree = degrees.get(&link.target_id).copied().unwrap_or(0);
        if source_degree >= LAYOUT_MAX_DEGREE || target_degree >= LAYOUT_MAX_DEGREE {
            continue;
        }
        let weight = layout_link_weight(link);
        selected.insert((link.source_id.clone(), link.target_id.clone()), weight);
        degrees.insert(link.source_id.clone(), source_degree + 1);
        degrees.insert(link.target_id.clone(), target_degree + 1);
    }

    let index_by_id = nodes
        .iter()
        .enumerate()
        .map(|(index, node)| (node.id.clone(), index))
        .collect::<HashMap<_, _>>();
    let mut dsu = DisjointSet::new(nodes.len());
    let mut backbone = links
        .iter()
        .filter(|link| link.strength >= COMPONENT_MIN_STRENGTH || link.kind == "wikilink")
        .collect::<Vec<_>>();
    backbone.sort_by(|left, right| {
        right
            .strength
            .total_cmp(&left.strength)
            .then_with(|| left.source_id.cmp(&right.source_id))
            .then_with(|| left.target_id.cmp(&right.target_id))
    });
    for link in backbone {
        let (Some(&source), Some(&target)) = (
            index_by_id.get(&link.source_id),
            index_by_id.get(&link.target_id),
        ) else {
            continue;
        };
        if dsu.union(source, target) {
            let key = (link.source_id.clone(), link.target_id.clone());
            selected
                .entry(key)
                .or_insert_with(|| layout_link_weight(link));
        }
    }

    selected
        .into_iter()
        .map(|((source_id, target_id), weight)| LayoutEdge {
            source_id,
            target_id,
            weight,
        })
        .collect()
}

fn layout_link_weight(link: &WorkingLink) -> f32 {
    if link.kind == "wikilink" {
        (link.strength + 0.22).clamp(0.0, 1.0)
    } else {
        link.strength.clamp(0.0, 1.0)
    }
}

fn connected_components(nodes: &[WorkingNode], edges: &[LayoutEdge]) -> Vec<Vec<String>> {
    let mut adjacency = HashMap::<String, Vec<String>>::new();
    for node in nodes {
        adjacency.entry(node.id.clone()).or_default();
    }
    for edge in edges {
        if edge.weight < COMPONENT_MIN_STRENGTH {
            continue;
        }
        adjacency
            .entry(edge.source_id.clone())
            .or_default()
            .push(edge.target_id.clone());
        adjacency
            .entry(edge.target_id.clone())
            .or_default()
            .push(edge.source_id.clone());
    }

    let mut seen = HashSet::new();
    let mut components = Vec::new();
    for node in nodes {
        if !seen.insert(node.id.clone()) {
            continue;
        }
        let mut stack = vec![node.id.clone()];
        let mut component = Vec::new();
        while let Some(current) = stack.pop() {
            component.push(current.clone());
            if let Some(neighbors) = adjacency.get(&current) {
                for neighbor in neighbors {
                    if seen.insert(neighbor.clone()) {
                        stack.push(neighbor.clone());
                    }
                }
            }
        }
        component.sort();
        components.push(component);
    }
    components
}

fn assign_clouds(nodes: &mut [WorkingNode], edges: &[LayoutEdge]) -> Vec<CloudSpec> {
    let adjacency = build_edge_adjacency(edges);
    let components = connected_components(nodes, edges);
    let mut top_groups = components
        .into_par_iter()
        .flat_map(|component| {
            if component.len() < CLOUD_MIN_NOTES {
                return Vec::new();
            }
            partition_by_content(&component, nodes, edges, &adjacency)
        })
        .collect::<Vec<_>>();
    top_groups = merge_high_affinity_groups(top_groups, nodes, edges, &adjacency);
    let mut top_groups = promote_mature_subclouds(top_groups, nodes, edges, &adjacency, 1);
    top_groups.sort_by(|left, right| {
        group_centrality(&right.members, nodes)
            .total_cmp(&group_centrality(&left.members, nodes))
            .then_with(|| right.members.len().cmp(&left.members.len()))
            .then_with(|| left.members[0].cmp(&right.members[0]))
    });

    let node_index = nodes
        .iter()
        .enumerate()
        .map(|(index, node)| (node.id.clone(), index))
        .collect::<HashMap<_, _>>();

    // Detect child communities in parallel before assigning sequential cloud IDs.
    let prepared = top_groups
        .into_par_iter()
        .map(|top| {
            let group = top.members;
            let child_groups = match top.precomputed_children {
                Some(children) => children,
                None => detect_child_communities(&group, nodes, edges, &adjacency),
            };
            let centrality = group_centrality(&group, nodes);
            let centroid = centroid_for_ids(&group, nodes);
            (group, child_groups, centrality, centroid)
        })
        .collect::<Vec<_>>();

    let mut specs = Vec::<CloudSpec>::new();
    for (cloud_index, (group, child_groups, centrality, centroid)) in
        prepared.into_iter().enumerate()
    {
        let cloud_id = format!("cloud-{}", cloud_index + 1);
        for member_id in &group {
            if let Some(index) = node_index.get(member_id).copied() {
                nodes[index].cloud_id = Some(cloud_id.clone());
                nodes[index].parent_cloud_id = None;
                nodes[index].child_cloud_id = None;
                nodes[index].isolated = false;
            }
        }

        let mut child_cloud_ids = Vec::new();
        let mut child_specs = Vec::new();
        for (child_index, child_group) in child_groups.into_iter().enumerate() {
            let child_id = format!("{cloud_id}-child-{}", child_index + 1);
            for member_id in &child_group {
                if let Some(index) = node_index.get(member_id).copied() {
                    nodes[index].parent_cloud_id = Some(cloud_id.clone());
                    nodes[index].child_cloud_id = Some(child_id.clone());
                }
            }
            child_cloud_ids.push(child_id.clone());
            child_specs.push(CloudSpec {
                id: child_id,
                parent_id: Some(cloud_id.clone()),
                level: 1,
                radius: child_cloud_radius(child_group.len()),
                centrality: group_centrality(&child_group, nodes),
                centroid: centroid_for_ids(&child_group, nodes),
                member_node_ids: child_group,
                core_node_ids: Vec::new(),
                outlier_node_ids: Vec::new(),
                child_cloud_ids: Vec::new(),
            });
        }

        let child_area_radius = child_specs
            .iter()
            .map(|spec| spec.radius * spec.radius)
            .sum::<f32>()
            .sqrt()
            * 1.2;
        specs.push(CloudSpec {
            id: cloud_id,
            parent_id: None,
            level: 0,
            radius: top_cloud_radius(group.len()).max(child_area_radius + 58.0),
            centrality,
            centroid,
            member_node_ids: group,
            core_node_ids: Vec::new(),
            outlier_node_ids: Vec::new(),
            child_cloud_ids,
        });
        specs.extend(child_specs);
    }
    specs
}

fn partition_by_content(
    group: &[String],
    nodes: &[WorkingNode],
    edges: &[LayoutEdge],
    adjacency: &EdgeAdjacency,
) -> Vec<Vec<String>> {
    if group.len() < CLOUD_MIN_NOTES * 2 {
        return vec![group.to_vec()];
    }
    let resolution = structure_based_resolution(group, edges, adjacency);
    let seed = stable_hash(&group.join("\0"));
    let mut groups = leiden_partition_group(group, edges, adjacency, resolution, seed);
    if groups.len() <= 1 {
        groups = leiden_partition_group(
            group,
            edges,
            adjacency,
            (resolution * 1.75).min(4.5),
            seed ^ 0x9e37,
        );
    }
    if groups.len() <= 1 {
        let soft_target = TOP_CLOUD_SOFT_MAX.min(group.len()).max(CLOUD_MIN_NOTES * 2);
        let soft_max = group.len().div_ceil(CLOUD_MIN_NOTES).max(2);
        groups = seeded_partition_group(group, nodes, edges, adjacency, soft_target, soft_max);
    }
    groups = merge_small_groups(groups, nodes, edges, adjacency);
    groups = merge_high_affinity_groups(groups, nodes, edges, adjacency);
    groups.sort_by(|left, right| {
        right
            .len()
            .cmp(&left.len())
            .then_with(|| left.first().cmp(&right.first()))
    });
    if groups.is_empty() {
        vec![group.to_vec()]
    } else {
        groups
    }
}

fn structure_based_resolution(
    group: &[String],
    edges: &[LayoutEdge],
    adjacency: &EdgeAdjacency,
) -> f64 {
    let n = group.len().max(1) as f64;
    let group_set = group.iter().cloned().collect::<HashSet<_>>();
    let mut seen = HashSet::<usize>::new();
    let mut strong_edge_count = 0usize;
    for id in group {
        let Some(edge_indices) = adjacency.get(id) else {
            continue;
        };
        for &edge_index in edge_indices {
            if !seen.insert(edge_index) {
                continue;
            }
            let edge = &edges[edge_index];
            if edge.weight >= COMMUNITY_EDGE_MIN_STRENGTH
                && group_set.contains(&edge.source_id)
                && group_set.contains(&edge.target_id)
                && edge.source_id != edge.target_id
            {
                strong_edge_count += 1;
            }
        }
    }
    let density = (2.0 * strong_edge_count as f64) / (n * (n - 1.0)).max(1.0);
    // Higher resolution → more communities. Dense weak knn graphs need a push.
    let resolution = 1.35 + n.ln() * 0.28 - density * 0.55;
    resolution.clamp(1.1, 4.5)
}

fn partition_group(
    group: &[String],
    nodes: &[WorkingNode],
    edges: &[LayoutEdge],
    adjacency: &EdgeAdjacency,
    target_size: usize,
    max_groups: usize,
) -> Vec<Vec<String>> {
    if group.len() < CLOUD_MIN_NOTES * 2 || max_groups <= 1 {
        return vec![group.to_vec()];
    }
    let desired_groups = group
        .len()
        .div_ceil(target_size.max(CLOUD_MIN_NOTES))
        .clamp(2, max_groups.max(2));
    let resolution = (desired_groups as f64 / group.len().max(1) as f64)
        .mul_add(14.0, 1.1)
        .clamp(1.1, 4.5);
    let seed = stable_hash(&group.join("\0"));
    let mut groups = leiden_partition_group(group, edges, adjacency, resolution, seed);
    if groups.len() <= 1 {
        groups = leiden_partition_group(
            group,
            edges,
            adjacency,
            (resolution * 1.6).min(4.5),
            seed ^ 0x51,
        );
    }
    if groups.len() <= 1 {
        groups = seeded_partition_group(group, nodes, edges, adjacency, target_size, max_groups);
    }
    groups = merge_small_groups(groups, nodes, edges, adjacency);
    groups = merge_high_affinity_groups(groups, nodes, edges, adjacency);
    if max_groups > 0 && groups.len() > max_groups {
        groups = merge_to_target_groups(groups, nodes, edges, adjacency, max_groups);
    }
    groups.sort_by(|left, right| {
        right
            .len()
            .cmp(&left.len())
            .then_with(|| left.first().cmp(&right.first()))
    });
    groups
}

fn leiden_partition_group(
    group: &[String],
    edges: &[LayoutEdge],
    adjacency: &EdgeAdjacency,
    resolution: f64,
    seed: u64,
) -> Vec<Vec<String>> {
    let index_by_id = group
        .iter()
        .enumerate()
        .map(|(index, id)| (id.as_str(), index))
        .collect::<HashMap<_, _>>();
    let mut builder = GraphDataBuilder::new(group.len());
    let mut edge_count = 0usize;
    let mut seen = HashSet::<usize>::new();
    for id in group {
        let Some(edge_indices) = adjacency.get(id) else {
            continue;
        };
        for &edge_index in edge_indices {
            if !seen.insert(edge_index) {
                continue;
            }
            let edge = &edges[edge_index];
            let (Some(&source), Some(&target)) = (
                index_by_id.get(edge.source_id.as_str()),
                index_by_id.get(edge.target_id.as_str()),
            ) else {
                continue;
            };
            if source == target || edge.weight < COMMUNITY_EDGE_MIN_STRENGTH {
                continue;
            }
            if builder
                .add_edge(source, target, f64::from(edge.weight))
                .is_ok()
            {
                edge_count += 1;
            }
        }
    }
    if edge_count == 0 {
        return Vec::new();
    }
    let Ok(graph) = builder.build() else {
        return Vec::new();
    };
    let config = LeidenConfig::builder()
        .quality(QualityType::RBConfiguration)
        .resolution(resolution)
        .max_iterations(24)
        .min_iterations(2)
        .seed(seed)
        // Prefer the parallel local-moving path whenever the group is large
        // enough for leiden-rs (it still requires n >= 100 internally).
        .parallel_local_moving_threshold(1)
        .parallel_aggregation_threshold(1)
        .build();
    let Ok(result) = Leiden::new(config).run(&graph) else {
        return Vec::new();
    };
    let mut by_community = HashMap::<usize, Vec<String>>::new();
    for (index, id) in group.iter().enumerate() {
        by_community
            .entry(result.partition.community_of(index))
            .or_default()
            .push(id.clone());
    }
    let mut groups = by_community.into_values().collect::<Vec<_>>();
    for group in &mut groups {
        group.sort();
    }
    groups.sort_by(|left, right| left[0].cmp(&right[0]));
    groups
}

fn seeded_partition_group(
    group: &[String],
    nodes: &[WorkingNode],
    edges: &[LayoutEdge],
    adjacency: &EdgeAdjacency,
    target_size: usize,
    max_groups: usize,
) -> Vec<Vec<String>> {
    let group_count = group
        .len()
        .div_ceil(target_size.max(CLOUD_MIN_NOTES))
        .clamp(2, max_groups.max(2));
    let seeds = choose_seed_ids(group, nodes, group_count);
    if seeds.len() < 2 {
        return vec![group.to_vec()];
    }
    let node_by_id = nodes
        .iter()
        .map(|node| (node.id.as_str(), node))
        .collect::<HashMap<_, _>>();
    let local_adjacency = adjacency_for_group(group, edges, adjacency);
    let seed_by_label = seeds
        .iter()
        .filter_map(|seed| {
            node_by_id
                .get(seed.as_str())
                .map(|node| (seed.clone(), *node))
        })
        .collect::<HashMap<_, _>>();
    let mut groups = HashMap::<String, Vec<String>>::new();
    for id in group {
        let Some(node) = node_by_id.get(id.as_str()) else {
            continue;
        };
        let label = seeds
            .iter()
            .max_by(|left, right| {
                let left_score =
                    seed_assignment_score(node, left, &seed_by_label, &local_adjacency);
                let right_score =
                    seed_assignment_score(node, right, &seed_by_label, &local_adjacency);
                left_score
                    .total_cmp(&right_score)
                    .then_with(|| right.cmp(left))
            })
            .cloned()
            .unwrap_or_else(|| id.clone());
        groups.entry(label).or_default().push(id.clone());
    }
    let mut groups = groups.into_values().collect::<Vec<_>>();
    for group in &mut groups {
        group.sort();
    }
    groups
}

fn choose_seed_ids(group: &[String], nodes: &[WorkingNode], count: usize) -> Vec<String> {
    let node_by_id = nodes
        .iter()
        .map(|node| (node.id.as_str(), node))
        .collect::<HashMap<_, _>>();
    let mut candidates = group.to_vec();
    candidates.sort_by(|left, right| {
        let left_node = node_by_id.get(left.as_str());
        let right_node = node_by_id.get(right.as_str());
        right_node
            .map(|node| node.centrality)
            .unwrap_or(0.0)
            .total_cmp(&left_node.map(|node| node.centrality).unwrap_or(0.0))
            .then_with(|| left.cmp(right))
    });
    let mut seeds = Vec::<String>::new();
    if let Some(first) = candidates.first() {
        seeds.push(first.clone());
    }
    while seeds.len() < count && seeds.len() < candidates.len() {
        let Some(best) = candidates
            .iter()
            .filter(|candidate| !seeds.contains(candidate))
            .max_by(|left, right| {
                let left_score = seed_spread_score(left, &seeds, &node_by_id);
                let right_score = seed_spread_score(right, &seeds, &node_by_id);
                left_score
                    .total_cmp(&right_score)
                    .then_with(|| right.cmp(left))
            })
        else {
            break;
        };
        seeds.push(best.clone());
    }
    seeds
}

fn seed_spread_score(
    candidate: &str,
    seeds: &[String],
    node_by_id: &HashMap<&str, &WorkingNode>,
) -> f32 {
    let Some(candidate_node) = node_by_id.get(candidate) else {
        return 0.0;
    };
    let min_distance = seeds
        .iter()
        .filter_map(|seed| node_by_id.get(seed.as_str()))
        .map(|seed_node| 1.0 - cosine_similarity(&candidate_node.embedding, &seed_node.embedding))
        .fold(1.0_f32, f32::min);
    min_distance + candidate_node.centrality * 0.35
}

fn seed_assignment_score(
    node: &WorkingNode,
    seed_id: &str,
    seed_by_label: &HashMap<String, &WorkingNode>,
    adjacency: &HashMap<String, Vec<(String, f32)>>,
) -> f32 {
    let semantic = seed_by_label
        .get(seed_id)
        .map(|seed| cosine_similarity(&node.embedding, &seed.embedding))
        .unwrap_or(0.0);
    let direct = adjacency
        .get(&node.id)
        .into_iter()
        .flatten()
        .find_map(|(neighbor, weight)| (neighbor == seed_id).then_some(*weight))
        .unwrap_or(0.0);
    semantic * 0.55 + direct * 0.45
}

fn adjacency_for_group(
    group: &[String],
    edges: &[LayoutEdge],
    adjacency: &EdgeAdjacency,
) -> HashMap<String, Vec<(String, f32)>> {
    let group_set = group.iter().cloned().collect::<HashSet<_>>();
    let mut local = HashMap::<String, Vec<(String, f32)>>::new();
    for id in group {
        local.entry(id.clone()).or_default();
        let Some(edge_indices) = adjacency.get(id) else {
            continue;
        };
        for &edge_index in edge_indices {
            let edge = &edges[edge_index];
            let neighbor = if edge.source_id == *id {
                &edge.target_id
            } else {
                &edge.source_id
            };
            if group_set.contains(neighbor) {
                local
                    .entry(id.clone())
                    .or_default()
                    .push((neighbor.clone(), edge.weight));
            }
        }
    }
    local
}

fn merge_small_groups(
    mut groups: Vec<Vec<String>>,
    nodes: &[WorkingNode],
    edges: &[LayoutEdge],
    adjacency: &EdgeAdjacency,
) -> Vec<Vec<String>> {
    loop {
        let Some((small_index, _)) = groups
            .iter()
            .enumerate()
            .filter(|(_, group)| group.len() < CLOUD_MIN_NOTES)
            .min_by(|left, right| left.1.len().cmp(&right.1.len()))
        else {
            break;
        };
        let small_group = groups.remove(small_index);
        if groups.is_empty() {
            return if small_group.len() >= CLOUD_MIN_NOTES {
                vec![small_group]
            } else {
                Vec::new()
            };
        }
        let target_index = strongest_group_index(&small_group, &groups, nodes, edges, adjacency);
        groups[target_index].extend(small_group);
        groups[target_index].sort();
    }
    groups.retain(|group| group.len() >= CLOUD_MIN_NOTES);
    groups
}

fn merge_to_target_groups(
    mut groups: Vec<Vec<String>>,
    nodes: &[WorkingNode],
    edges: &[LayoutEdge],
    adjacency: &EdgeAdjacency,
    target: usize,
) -> Vec<Vec<String>> {
    if target == 0 {
        return Vec::new();
    }
    while groups.len() > target {
        let mut best_pair = None;
        let mut best_score = f32::MIN;
        for left in 0..groups.len() {
            for right in (left + 1)..groups.len() {
                let score = group_affinity(&groups[left], &groups[right], nodes, edges, adjacency);
                if score > best_score {
                    best_score = score;
                    best_pair = Some((left, right));
                }
            }
        }
        let Some((left, right)) = best_pair else {
            break;
        };
        let mut merged = groups.remove(right);
        groups[left].append(&mut merged);
        groups[left].sort();
    }
    groups
}

fn merge_high_affinity_groups(
    mut groups: Vec<Vec<String>>,
    nodes: &[WorkingNode],
    edges: &[LayoutEdge],
    adjacency: &EdgeAdjacency,
) -> Vec<Vec<String>> {
    loop {
        let mut best_pair = None;
        let mut best_score = f32::MIN;
        for left in 0..groups.len() {
            for right in (left + 1)..groups.len() {
                let score = group_affinity(&groups[left], &groups[right], nodes, edges, adjacency);
                if score >= HIGH_AFFINITY_MERGE_THRESHOLD && score > best_score {
                    best_score = score;
                    best_pair = Some((left, right));
                }
            }
        }
        let Some((left, right)) = best_pair else {
            break;
        };
        let mut merged = groups.remove(right);
        groups[left].append(&mut merged);
        groups[left].sort();
    }
    groups
}

fn promote_mature_subclouds(
    groups: Vec<Vec<String>>,
    nodes: &[WorkingNode],
    edges: &[LayoutEdge],
    adjacency: &EdgeAdjacency,
    remaining_depth: usize,
) -> Vec<TopGroupPartition> {
    groups
        .into_par_iter()
        .flat_map(|group| {
            let child_groups = detect_child_communities(&group, nodes, edges, adjacency);
            let mature: Vec<Vec<String>> = child_groups
                .iter()
                .filter(|child| child.len() >= SUBCLOUD_PROMOTE_MIN)
                .cloned()
                .collect();
            let separation = if child_groups.len() >= 2 {
                partition_separation(&child_groups, edges, adjacency)
            } else {
                0.0
            };
            let should_promote = mature.len() >= 2
                && (group.len() >= TOP_CLOUD_SOFT_MAX
                    || separation >= CHILD_PARTITION_SEPARATION_MIN);

            if !should_promote {
                return vec![TopGroupPartition {
                    members: group,
                    precomputed_children: Some(child_groups),
                }];
            }

            let mature_ids: HashSet<String> = mature.iter().flatten().cloned().collect();
            let leftovers: Vec<String> = group
                .into_iter()
                .filter(|id| !mature_ids.contains(id))
                .collect();

            let mut next_groups = mature;
            if leftovers.len() >= CLOUD_MIN_NOTES {
                next_groups.push(leftovers);
            } else if !leftovers.is_empty() && !next_groups.is_empty() {
                let target =
                    strongest_group_index(&leftovers, &next_groups, nodes, edges, adjacency);
                next_groups[target].extend(leftovers);
                next_groups[target].sort();
            }

            if remaining_depth > 0 {
                promote_mature_subclouds(next_groups, nodes, edges, adjacency, remaining_depth - 1)
            } else {
                next_groups
                    .into_iter()
                    .map(|members| TopGroupPartition {
                        members,
                        precomputed_children: None,
                    })
                    .collect()
            }
        })
        .collect()
}

fn strongest_group_index(
    source: &[String],
    groups: &[Vec<String>],
    nodes: &[WorkingNode],
    edges: &[LayoutEdge],
    adjacency: &EdgeAdjacency,
) -> usize {
    groups
        .iter()
        .enumerate()
        .max_by(|(_, left), (_, right)| {
            let left_score = group_affinity(source, left, nodes, edges, adjacency);
            let right_score = group_affinity(source, right, nodes, edges, adjacency);
            left_score
                .total_cmp(&right_score)
                .then_with(|| right.len().cmp(&left.len()))
        })
        .map(|(index, _)| index)
        .unwrap_or(0)
}

fn group_affinity(
    left: &[String],
    right: &[String],
    nodes: &[WorkingNode],
    edges: &[LayoutEdge],
    adjacency: &EdgeAdjacency,
) -> f32 {
    let left_set = left.iter().cloned().collect::<HashSet<_>>();
    let right_set = right.iter().cloned().collect::<HashSet<_>>();
    let mut bridge_weight = 0.0_f32;
    let mut bridge_count = 0usize;
    let (scan_ids, other_set) = if left.len() <= right.len() {
        (left, &right_set)
    } else {
        (right, &left_set)
    };
    for id in scan_ids {
        let Some(edge_indices) = adjacency.get(id) else {
            continue;
        };
        for &edge_index in edge_indices {
            let edge = &edges[edge_index];
            let neighbor = if edge.source_id == *id {
                &edge.target_id
            } else {
                &edge.source_id
            };
            if !other_set.contains(neighbor) {
                continue;
            }
            let crosses = (left_set.contains(&edge.source_id)
                && right_set.contains(&edge.target_id))
                || (left_set.contains(&edge.target_id) && right_set.contains(&edge.source_id));
            if !crosses {
                continue;
            }
            bridge_weight += edge.weight;
            bridge_count += 1;
        }
    }
    let embedding = group_embedding_similarity(left, right, nodes);
    if bridge_count == 0 {
        // No structural link — only treat near-identical centroids as affinity.
        return if embedding >= 0.92 { embedding } else { 0.0 };
    }
    let mean_bridge = bridge_weight / bridge_count as f32;
    let possible = (left.len() * right.len()).max(1) as f32;
    let density = (bridge_count as f32 / possible).sqrt();
    // Require both strong and relatively dense bridges; sparse knn/wikilink
    // bridges alone should not collapse distinct communities.
    let bridge_score = mean_bridge * density;
    if embedding >= 0.92 && mean_bridge >= 0.55 {
        bridge_score.max(embedding * density.max(0.25))
    } else {
        bridge_score
    }
}

fn group_embedding_similarity(left: &[String], right: &[String], nodes: &[WorkingNode]) -> f32 {
    let node_by_id = nodes
        .iter()
        .map(|node| (node.id.as_str(), node))
        .collect::<HashMap<_, _>>();
    let left_centroid = embedding_centroid(left, &node_by_id);
    let right_centroid = embedding_centroid(right, &node_by_id);
    cosine_similarity(&left_centroid, &right_centroid).max(0.0)
}

fn embedding_centroid(ids: &[String], node_by_id: &HashMap<&str, &WorkingNode>) -> Vec<f32> {
    let Some(dimensions) = ids
        .iter()
        .filter_map(|id| node_by_id.get(id.as_str()))
        .map(|node| node.embedding.len())
        .find(|len| *len > 0)
    else {
        return Vec::new();
    };
    let mut centroid = vec![0.0_f32; dimensions];
    let mut count = 0usize;
    for id in ids {
        let Some(node) = node_by_id.get(id.as_str()) else {
            continue;
        };
        if node.embedding.len() != dimensions {
            continue;
        }
        for (sum, value) in centroid.iter_mut().zip(&node.embedding) {
            *sum += *value;
        }
        count += 1;
    }
    if count > 0 {
        for value in &mut centroid {
            *value /= count as f32;
        }
    }
    centroid
}

fn detect_child_communities(
    parent_group: &[String],
    nodes: &[WorkingNode],
    edges: &[LayoutEdge],
    adjacency: &EdgeAdjacency,
) -> Vec<Vec<String>> {
    if parent_group.len() < CHILD_CLOUD_MIN_NOTES * 2 {
        return Vec::new();
    }
    let target_size = CHILD_TARGET_MAX_NOTES
        .min(parent_group.len())
        .max(CHILD_CLOUD_MIN_NOTES);
    let max_groups = parent_group.len().div_ceil(CHILD_CLOUD_MIN_NOTES).max(2);
    let mut groups = partition_group(
        parent_group,
        nodes,
        edges,
        adjacency,
        target_size,
        max_groups,
    );
    if groups.len() < 2
        || partition_separation(&groups, edges, adjacency) < CHILD_PARTITION_SEPARATION_MIN
    {
        return Vec::new();
    }

    for index in 0..groups.len() {
        let mut retained = Vec::new();
        let mut loose = Vec::new();
        let group = groups[index].clone();
        for id in group {
            let attachment = node_internal_affinity(&id, &groups[index], edges, adjacency);
            if groups[index].len().saturating_sub(loose.len()) > CLOUD_MIN_NOTES
                && attachment < 0.34
            {
                loose.push(id);
            } else {
                retained.push(id);
            }
        }
        groups[index] = retained;
        for loose_id in loose {
            let target =
                strongest_group_index(&[loose_id.clone()], &groups, nodes, edges, adjacency);
            if node_internal_affinity(&loose_id, &groups[target], edges, adjacency) >= 0.5 {
                groups[target].push(loose_id);
                groups[target].sort();
            }
        }
    }
    groups.retain(|group| group.len() >= CLOUD_MIN_NOTES);
    if groups.len() < 2 {
        Vec::new()
    } else {
        groups
    }
}

fn partition_separation(
    groups: &[Vec<String>],
    edges: &[LayoutEdge],
    adjacency: &EdgeAdjacency,
) -> f32 {
    let mut group_by_node = HashMap::<String, usize>::new();
    for (index, group) in groups.iter().enumerate() {
        for id in group {
            group_by_node.insert(id.clone(), index);
        }
    }
    let mut internal = 0.0_f32;
    let mut external = 0.0_f32;
    let mut seen = HashSet::<usize>::new();
    for id in group_by_node.keys() {
        let Some(edge_indices) = adjacency.get(id) else {
            continue;
        };
        for &edge_index in edge_indices {
            if !seen.insert(edge_index) {
                continue;
            }
            let edge = &edges[edge_index];
            let (Some(source), Some(target)) = (
                group_by_node.get(&edge.source_id),
                group_by_node.get(&edge.target_id),
            ) else {
                continue;
            };
            if source == target {
                internal += edge.weight;
            } else {
                external += edge.weight;
            }
        }
    }
    if internal + external <= f32::EPSILON {
        return 0.0;
    }
    internal / (internal + external)
}

fn node_internal_affinity(
    node_id: &str,
    group: &[String],
    edges: &[LayoutEdge],
    adjacency: &EdgeAdjacency,
) -> f32 {
    let group_set = group.iter().cloned().collect::<HashSet<_>>();
    adjacency
        .get(node_id)
        .into_iter()
        .flatten()
        .filter_map(|&edge_index| {
            let edge = &edges[edge_index];
            let neighbor = if edge.source_id == node_id {
                &edge.target_id
            } else {
                &edge.source_id
            };
            group_set.contains(neighbor).then_some(edge.weight)
        })
        .sum()
}

fn group_centrality(group: &[String], nodes: &[WorkingNode]) -> f32 {
    let node_by_id = nodes
        .iter()
        .map(|node| (node.id.as_str(), node))
        .collect::<HashMap<_, _>>();
    let total = group
        .iter()
        .filter_map(|id| node_by_id.get(id.as_str()))
        .map(|node| node.centrality)
        .sum::<f32>();
    total / group.len().max(1) as f32
}

fn centroid_for_ids(ids: &[String], nodes: &[WorkingNode]) -> [f32; 2] {
    let node_by_id = nodes
        .iter()
        .map(|node| (node.id.as_str(), node))
        .collect::<HashMap<_, _>>();
    let refs = ids
        .iter()
        .filter_map(|id| node_by_id.get(id.as_str()).copied())
        .collect::<Vec<_>>();
    centroid(&refs)
}

fn top_cloud_radius(note_count: usize) -> f32 {
    (95.0 + (note_count as f32).sqrt() * 18.0).clamp(125.0, 420.0)
}

fn child_cloud_radius(note_count: usize) -> f32 {
    (38.0 + (note_count as f32).sqrt() * 13.0).clamp(58.0, 180.0)
}

fn apply_umap_layout(nodes: &mut [WorkingNode], knn_rows: &[Vec<KnnNeighbor>]) -> bool {
    let n = nodes.len();
    let Some(dimensions) = nodes
        .iter()
        .map(|node| node.embedding.len())
        .find(|dimensions| *dimensions > 0)
    else {
        return false;
    };
    if n < 4
        || nodes.iter().any(|node| {
            node.embedding.len() != dimensions
                || node.embedding.iter().any(|value| !value.is_finite())
        })
    {
        return false;
    }
    let neighbor_count = KNN_GRAPH_K
        .min(n.saturating_sub(1))
        .clamp(2, n.saturating_sub(1));
    if neighbor_count >= n {
        return false;
    }

    let mut data = Array2::<f32>::zeros((n, dimensions));
    for (row, node) in nodes.iter().enumerate() {
        for (column, value) in node.embedding.iter().enumerate() {
            data[(row, column)] = *value;
        }
    }

    let completed_rows = complete_knn_rows_for_umap(nodes, knn_rows, neighbor_count);
    if completed_rows.iter().any(|row| row.len() != neighbor_count) {
        return false;
    }
    let mut knn_indices = Array2::<u32>::zeros((n, neighbor_count));
    let mut knn_dists = Array2::<f32>::zeros((n, neighbor_count));
    for (row_index, row) in completed_rows.iter().enumerate() {
        for (neighbor_index, neighbor) in row.iter().enumerate() {
            knn_indices[(row_index, neighbor_index)] = neighbor.index as u32;
            knn_dists[(row_index, neighbor_index)] = neighbor.distance;
        }
    }

    let mut init = Array2::<f32>::zeros((n, 2));
    for (index, node) in nodes.iter().enumerate() {
        init[(index, 0)] = node.x / 360.0;
        init[(index, 1)] = node.y / 360.0;
    }

    let mut config = UmapConfig::default();
    config.n_components = 2;
    config.graph = GraphParams {
        n_neighbors: neighbor_count,
        ..Default::default()
    };
    config.optimization = OptimizationParams {
        n_epochs: Some(umap_iterations_for_note_count(n)),
        learning_rate: 0.9,
        negative_sample_rate: 5,
        repulsion_strength: 1.15,
    };

    let result = catch_unwind(AssertUnwindSafe(|| {
        let umap = Umap::new(config);
        let fitted = umap.fit(
            data.view(),
            knn_indices.view(),
            knn_dists.view(),
            init.view(),
        );
        fitted.embedding().to_owned()
    }));
    let Ok(embedding) = result else {
        return false;
    };
    if embedding.nrows() != n
        || embedding.ncols() != 2
        || embedding.iter().any(|value| !value.is_finite())
    {
        return false;
    }
    apply_normalized_embedding(nodes, &embedding);
    true
}

fn umap_iterations_for_note_count(note_count: usize) -> usize {
    let scaled =
        UMAP_ITERATIONS_BASE as f32 + UMAP_ITERATIONS_SQRT_SCALE * (note_count as f32).sqrt();
    (scaled.round() as usize).clamp(UMAP_ITERATIONS_BASE, UMAP_ITERATIONS_MAX)
}

fn complete_knn_rows_for_umap(
    nodes: &[WorkingNode],
    knn_rows: &[Vec<KnnNeighbor>],
    neighbor_count: usize,
) -> Vec<Vec<KnnNeighbor>> {
    let mut completed = knn_rows
        .par_iter()
        .enumerate()
        .map(|(row_index, row)| {
            let mut merged = Vec::<KnnNeighbor>::with_capacity(neighbor_count);
            for neighbor in row {
                if neighbor.index != row_index {
                    push_unique_neighbor(&mut merged, neighbor.index, neighbor.similarity);
                }
                if merged.len() == neighbor_count {
                    break;
                }
            }
            merged.sort_by(|left, right| {
                right
                    .similarity
                    .total_cmp(&left.similarity)
                    .then_with(|| nodes[left.index].id.cmp(&nodes[right.index].id))
            });
            merged.truncate(neighbor_count);
            merged
        })
        .collect::<Vec<_>>();

    let deficient_indices = completed
        .iter()
        .enumerate()
        .filter_map(|(row_index, merged)| {
            if merged.len() < neighbor_count {
                Some(row_index)
            } else {
                None
            }
        })
        .collect::<Vec<_>>();

    if deficient_indices.is_empty() {
        return completed;
    }

    // Exact-fill only rows that HNSW left short — never an unconditional all-pairs pass.
    let exact_rows = exact_knn_rows(nodes, neighbor_count);
    for row_index in deficient_indices {
        let Some(exact_row) = exact_rows.get(row_index) else {
            continue;
        };
        let merged = &mut completed[row_index];
        for neighbor in exact_row {
            push_unique_neighbor(merged, neighbor.index, neighbor.similarity);
            if merged.len() == neighbor_count {
                break;
            }
        }
        merged.sort_by(|left, right| {
            right
                .similarity
                .total_cmp(&left.similarity)
                .then_with(|| nodes[left.index].id.cmp(&nodes[right.index].id))
        });
        merged.truncate(neighbor_count);
    }
    completed
}

fn apply_normalized_embedding(nodes: &mut [WorkingNode], embedding: &Array2<f32>) {
    let min_x = embedding
        .column(0)
        .iter()
        .copied()
        .fold(f32::INFINITY, f32::min);
    let max_x = embedding
        .column(0)
        .iter()
        .copied()
        .fold(f32::NEG_INFINITY, f32::max);
    let min_y = embedding
        .column(1)
        .iter()
        .copied()
        .fold(f32::INFINITY, f32::min);
    let max_y = embedding
        .column(1)
        .iter()
        .copied()
        .fold(f32::NEG_INFINITY, f32::max);
    let width = (max_x - min_x).abs().max(0.000_1);
    let height = (max_y - min_y).abs().max(0.000_1);
    let target_span = (nodes.len() as f32).sqrt().clamp(4.0, 36.0) * 170.0;
    let scale = target_span / width.max(height);
    let center_x = (min_x + max_x) / 2.0;
    let center_y = (min_y + max_y) / 2.0;
    nodes.par_iter_mut().enumerate().for_each(|(index, node)| {
        node.x = (embedding[(index, 0)] - center_x) * scale;
        node.y = (embedding[(index, 1)] - center_y) * scale;
    });
}

fn refresh_cloud_geometry(specs: &mut [CloudSpec], nodes: &[WorkingNode]) {
    let node_by_id = nodes
        .iter()
        .map(|node| (node.id.as_str(), node))
        .collect::<HashMap<_, _>>();
    let updates = specs
        .par_iter()
        .map(|spec| {
            let centroid = centroid_for_ids(&spec.member_node_ids, nodes);
            let member_radius = spec
                .member_node_ids
                .iter()
                .filter_map(|id| node_by_id.get(id.as_str()).copied())
                .map(|node| distance([node.x, node.y], centroid))
                .fold(0.0_f32, f32::max);
            let base = if spec.level == 0 {
                top_cloud_radius(spec.member_node_ids.len())
            } else {
                child_cloud_radius(spec.member_node_ids.len())
            };
            let radius = base.max(member_radius + if spec.level == 0 { 86.0 } else { 44.0 });
            (centroid, radius)
        })
        .collect::<Vec<_>>();
    for (spec, (centroid, radius)) in specs.iter_mut().zip(updates) {
        spec.centroid = centroid;
        spec.radius = radius;
    }
}

fn separate_umap_clouds(
    nodes: &mut [WorkingNode],
    edges: &[LayoutEdge],
    specs: &mut [CloudSpec],
    layout_pull: f32,
) {
    refresh_cloud_geometry(specs, nodes);
    compact_cloud_members(nodes, specs, 0);
    refresh_cloud_geometry(specs, nodes);

    let previous_top_centers = specs
        .iter()
        .filter(|spec| spec.level == 0)
        .map(|spec| (spec.id.clone(), spec.centroid))
        .collect::<HashMap<_, _>>();
    place_top_level_clouds(specs, edges, layout_pull);
    translate_cloud_members(nodes, specs, previous_top_centers, 0);
    refresh_cloud_geometry(specs, nodes);

    compact_cloud_members(nodes, specs, 1);
    refresh_cloud_geometry(specs, nodes);
    separate_child_umap_clouds(nodes, edges, specs);
    refresh_cloud_geometry(specs, nodes);
}

fn compact_cloud_members(nodes: &mut [WorkingNode], specs: &[CloudSpec], level: usize) {
    let node_index = nodes
        .iter()
        .enumerate()
        .map(|(index, node)| (node.id.clone(), index))
        .collect::<HashMap<_, _>>();
    for spec in specs.iter().filter(|spec| spec.level == level) {
        let center = spec.centroid;
        let target_radius = if spec.level == 0 {
            top_cloud_radius(spec.member_node_ids.len()) * 0.58
        } else {
            child_cloud_radius(spec.member_node_ids.len()) * 0.54
        }
        .max(34.0);
        let member_indices = spec
            .member_node_ids
            .iter()
            .filter_map(|id| node_index.get(id).copied())
            .collect::<Vec<_>>();
        let max_distance = member_indices
            .iter()
            .map(|index| distance([nodes[*index].x, nodes[*index].y], center))
            .fold(0.0_f32, f32::max);
        if max_distance <= target_radius || max_distance <= 1.0 {
            continue;
        }
        let scale = target_radius / max_distance;
        for index in member_indices {
            nodes[index].x = center[0] + (nodes[index].x - center[0]) * scale;
            nodes[index].y = center[1] + (nodes[index].y - center[1]) * scale;
        }
    }
}

fn translate_cloud_members(
    nodes: &mut [WorkingNode],
    specs: &[CloudSpec],
    previous_centers: HashMap<String, [f32; 2]>,
    level: usize,
) {
    let node_index = nodes
        .iter()
        .enumerate()
        .map(|(index, node)| (node.id.clone(), index))
        .collect::<HashMap<_, _>>();
    for spec in specs.iter().filter(|spec| spec.level == level) {
        let Some(previous) = previous_centers.get(&spec.id).copied() else {
            continue;
        };
        let delta = [
            spec.centroid[0] - previous[0],
            spec.centroid[1] - previous[1],
        ];
        for member_id in &spec.member_node_ids {
            if let Some(index) = node_index.get(member_id).copied() {
                nodes[index].x += delta[0];
                nodes[index].y += delta[1];
            }
        }
    }
}

fn separate_child_umap_clouds(
    nodes: &mut [WorkingNode],
    edges: &[LayoutEdge],
    specs: &mut [CloudSpec],
) {
    let top_ids = specs
        .iter()
        .filter(|spec| spec.level == 0)
        .map(|spec| spec.id.clone())
        .collect::<Vec<_>>();
    let spec_index = specs
        .iter()
        .enumerate()
        .map(|(index, spec)| (spec.id.clone(), index))
        .collect::<HashMap<_, _>>();
    for top_id in top_ids {
        let Some(&top_index) = spec_index.get(&top_id) else {
            continue;
        };
        let child_indices = specs[top_index]
            .child_cloud_ids
            .iter()
            .filter_map(|id| spec_index.get(id).copied())
            .collect::<Vec<_>>();
        if child_indices.len() < 2 {
            continue;
        }
        let previous_child_centers = child_indices
            .iter()
            .map(|index| (specs[*index].id.clone(), specs[*index].centroid))
            .collect::<HashMap<_, _>>();
        place_child_centers(top_index, &child_indices, specs, edges);
        translate_cloud_members(nodes, specs, previous_child_centers, 1);
    }
}

fn place_cloud_first_layout(
    nodes: &mut [WorkingNode],
    edges: &[LayoutEdge],
    specs: &mut [CloudSpec],
    layout_pull: f32,
) {
    place_top_level_clouds(specs, edges, layout_pull);
    place_child_clouds_and_notes(nodes, edges, specs);
}

fn place_top_level_clouds(specs: &mut [CloudSpec], edges: &[LayoutEdge], layout_pull: f32) {
    let adjacency = build_edge_adjacency(edges);
    let top_indices = specs
        .iter()
        .enumerate()
        .filter(|(_, spec)| spec.level == 0)
        .map(|(index, _)| index)
        .collect::<Vec<_>>();
    if top_indices.is_empty() {
        return;
    }
    let mut order = top_indices.clone();
    order.sort_by(|left, right| {
        specs[*right]
            .centrality
            .total_cmp(&specs[*left].centrality)
            .then_with(|| {
                specs[*right]
                    .member_node_ids
                    .len()
                    .cmp(&specs[*left].member_node_ids.len())
            })
            .then_with(|| specs[*left].id.cmp(&specs[*right].id))
    });

    let mut placed = Vec::<usize>::new();
    for &index in &order {
        if placed.is_empty() {
            specs[index].centroid = [0.0, 0.0];
            placed.push(index);
            continue;
        }
        let related_anchor = related_cloud_anchor(index, &placed, specs, edges, &adjacency);
        let anchor = related_anchor.unwrap_or([0.0, 0.0]);
        let placement_gap = if related_anchor.is_some() {
            TOP_LEVEL_CLOUD_GAP
        } else {
            TOP_LEVEL_CLOUD_GAP + specs[index].radius * 0.35 + 120.0
        };
        specs[index].centroid =
            find_non_overlapping_center(&specs[index], &placed, specs, anchor, placement_gap);
        placed.push(index);
    }

    relax_cloud_centers(
        &top_indices,
        specs,
        edges,
        &adjacency,
        TOP_LEVEL_CLOUD_GAP,
        layout_pull,
        150,
    );
    // Jacobi-style overlap resolve (parallel per iteration). Fewer passes than
    // the old 1200-step Gauss-Seidel loop, which pinned a single core for ages.
    enforce_cloud_non_overlap(&top_indices, specs, TOP_LEVEL_CLOUD_GAP, 360);
    let anchor = order[0];
    let offset = specs[anchor].centroid;
    for &index in &top_indices {
        specs[index].centroid[0] -= offset[0];
        specs[index].centroid[1] -= offset[1];
    }
}

fn related_cloud_anchor(
    index: usize,
    placed: &[usize],
    specs: &[CloudSpec],
    edges: &[LayoutEdge],
    adjacency: &EdgeAdjacency,
) -> Option<[f32; 2]> {
    let mut total_weight = 0.0_f32;
    let mut anchor = [0.0_f32, 0.0_f32];
    for &placed_index in placed {
        let affinity = cloud_affinity(&specs[index], &specs[placed_index], edges, adjacency);
        if affinity <= 0.0 {
            continue;
        }
        total_weight += affinity;
        anchor[0] += specs[placed_index].centroid[0] * affinity;
        anchor[1] += specs[placed_index].centroid[1] * affinity;
    }
    if total_weight <= f32::EPSILON {
        None
    } else {
        Some([anchor[0] / total_weight, anchor[1] / total_weight])
    }
}

fn find_non_overlapping_center(
    spec: &CloudSpec,
    placed: &[usize],
    specs: &[CloudSpec],
    anchor: [f32; 2],
    gap: f32,
) -> [f32; 2] {
    let phase = stable_angle(&spec.id);
    let best = (0..320_u32)
        .into_par_iter()
        .filter_map(|step| {
            let ring = (step / 24) as f32;
            let angle = phase + step as f32 * 2.399_963_1;
            let distance = spec.radius + gap + 70.0 + ring * (spec.radius * 0.22 + 58.0);
            let candidate = [
                anchor[0] + angle.cos() * distance,
                anchor[1] + angle.sin() * distance,
            ];
            if !cloud_center_overlaps(candidate, spec.radius, placed, specs, gap) {
                let score = squared_distance(candidate, anchor)
                    + squared_distance(candidate, [0.0, 0.0]) * 0.08;
                Some((candidate, score))
            } else {
                None
            }
        })
        .min_by(|left, right| {
            left.1
                .total_cmp(&right.1)
                .then_with(|| left.0[0].total_cmp(&right.0[0]))
                .then_with(|| left.0[1].total_cmp(&right.0[1]))
        });
    best.map(|(candidate, _)| candidate).unwrap_or_else(|| {
        let fallback_distance =
            placed.iter().map(|index| specs[*index].radius).sum::<f32>() + spec.radius + gap;
        [
            anchor[0] + phase.cos() * fallback_distance,
            anchor[1] + phase.sin() * fallback_distance,
        ]
    })
}

fn find_non_overlapping_child_center(
    spec: &CloudSpec,
    placed: &[usize],
    specs: &[CloudSpec],
    anchor: [f32; 2],
    parent_center: [f32; 2],
    gap: f32,
) -> [f32; 2] {
    let phase = stable_angle(&spec.id);
    let mut best = None;
    let mut best_score = f32::MAX;
    for step in 0..420 {
        let ring = (step / 36) as f32;
        let angle = phase + step as f32 * 2.399_963_1;
        let distance = spec.radius + gap + 8.0 + ring * 22.0;
        let candidate = [
            anchor[0] + angle.cos() * distance,
            anchor[1] + angle.sin() * distance,
        ];
        if !cloud_center_overlaps(candidate, spec.radius, placed, specs, gap) {
            let score = squared_distance(candidate, anchor)
                + squared_distance(candidate, parent_center) * 0.22;
            if score < best_score {
                best = Some(candidate);
                best_score = score;
            }
        }
    }
    best.unwrap_or_else(|| {
        let fallback_distance =
            placed.iter().map(|index| specs[*index].radius).sum::<f32>() + spec.radius + gap;
        [
            parent_center[0] + phase.cos() * fallback_distance,
            parent_center[1] + phase.sin() * fallback_distance,
        ]
    })
}

fn cloud_center_overlaps(
    center: [f32; 2],
    radius: f32,
    placed: &[usize],
    specs: &[CloudSpec],
    gap: f32,
) -> bool {
    placed.iter().any(|index| {
        let other = &specs[*index];
        distance(center, other.centroid) < radius + other.radius + gap
    })
}

fn cloud_index_pairs(indices: &[usize]) -> Vec<(usize, usize)> {
    let mut pairs = Vec::with_capacity(indices.len().saturating_mul(indices.len()) / 2);
    for left_offset in 0..indices.len() {
        for right_offset in (left_offset + 1)..indices.len() {
            pairs.push((indices[left_offset], indices[right_offset]));
        }
    }
    pairs
}

fn relax_cloud_centers(
    indices: &[usize],
    specs: &mut [CloudSpec],
    edges: &[LayoutEdge],
    adjacency: &EdgeAdjacency,
    gap: f32,
    layout_pull: f32,
    iterations: usize,
) {
    let pairs = cloud_index_pairs(indices);
    for _ in 0..iterations {
        let pair_deltas = pairs
            .par_iter()
            .filter_map(|&(left, right)| {
                let dx = specs[left].centroid[0] - specs[right].centroid[0];
                let dy = specs[left].centroid[1] - specs[right].centroid[1];
                let dist = (dx * dx + dy * dy).sqrt().max(1.0);
                let desired = specs[left].radius + specs[right].radius + gap;
                let mut left_delta = [0.0_f32, 0.0_f32];
                let mut right_delta = [0.0_f32, 0.0_f32];
                if dist < desired {
                    let force = ((desired - dist) / desired).min(1.0) * 16.0;
                    left_delta[0] += dx / dist * force;
                    left_delta[1] += dy / dist * force;
                    right_delta[0] -= dx / dist * force;
                    right_delta[1] -= dy / dist * force;
                }
                let affinity = cloud_affinity(&specs[left], &specs[right], edges, adjacency);
                if affinity > 0.0 && dist > desired + 80.0 {
                    let target = desired + (260.0 - affinity.min(8.0) * 18.0).max(64.0);
                    if dist > target {
                        let force =
                            ((dist - target) / dist) * affinity.min(8.0) * 0.24 * layout_pull;
                        left_delta[0] -= dx / dist * force;
                        left_delta[1] -= dy / dist * force;
                        right_delta[0] += dx / dist * force;
                        right_delta[1] += dy / dist * force;
                    }
                }
                if left_delta == [0.0, 0.0] && right_delta == [0.0, 0.0] {
                    None
                } else {
                    Some((left, left_delta, right, right_delta))
                }
            })
            .collect::<Vec<_>>();

        let mut deltas = HashMap::<usize, [f32; 2]>::new();
        for (left, left_delta, right, right_delta) in pair_deltas {
            add_delta(&mut deltas, left, left_delta);
            add_delta(&mut deltas, right, right_delta);
        }
        for &index in indices {
            let center = specs[index].centroid;
            add_delta(&mut deltas, index, [-center[0] * 0.002, -center[1] * 0.002]);
        }
        for (&index, delta) in &deltas {
            specs[index].centroid[0] += delta[0].clamp(-24.0, 24.0);
            specs[index].centroid[1] += delta[1].clamp(-24.0, 24.0);
        }
    }
}

fn enforce_cloud_non_overlap(
    indices: &[usize],
    specs: &mut [CloudSpec],
    gap: f32,
    iterations: usize,
) {
    let pairs = cloud_index_pairs(indices);
    for _ in 0..iterations {
        let pushes = pairs
            .par_iter()
            .filter_map(|&(left, right)| {
                let dx = specs[left].centroid[0] - specs[right].centroid[0];
                let dy = specs[left].centroid[1] - specs[right].centroid[1];
                let dist = (dx * dx + dy * dy).sqrt().max(1.0);
                let desired = specs[left].radius + specs[right].radius + gap;
                if dist >= desired {
                    return None;
                }
                let push = (desired - dist) / 2.0 + 0.5;
                Some((
                    left,
                    [dx / dist * push, dy / dist * push],
                    right,
                    [-dx / dist * push, -dy / dist * push],
                ))
            })
            .collect::<Vec<_>>();
        if pushes.is_empty() {
            break;
        }
        let mut deltas = HashMap::<usize, [f32; 2]>::new();
        for (left, left_delta, right, right_delta) in pushes {
            add_delta(&mut deltas, left, left_delta);
            add_delta(&mut deltas, right, right_delta);
        }
        for (index, delta) in deltas {
            specs[index].centroid[0] += delta[0];
            specs[index].centroid[1] += delta[1];
        }
    }
}

fn place_child_clouds_and_notes(
    nodes: &mut [WorkingNode],
    edges: &[LayoutEdge],
    specs: &mut [CloudSpec],
) {
    let top_ids = specs
        .iter()
        .filter(|spec| spec.level == 0)
        .map(|spec| spec.id.clone())
        .collect::<Vec<_>>();
    let spec_index = specs
        .iter()
        .enumerate()
        .map(|(index, spec)| (spec.id.clone(), index))
        .collect::<HashMap<_, _>>();
    for top_id in top_ids {
        let Some(&top_index) = spec_index.get(&top_id) else {
            continue;
        };
        let child_indices = specs[top_index]
            .child_cloud_ids
            .iter()
            .filter_map(|id| spec_index.get(id).copied())
            .collect::<Vec<_>>();
        if child_indices.is_empty() {
            layout_notes_in_disc(
                nodes,
                &specs[top_index].member_node_ids,
                specs[top_index].centroid,
                specs[top_index].radius * 0.72,
                edges,
            );
            continue;
        }

        place_child_centers(top_index, &child_indices, specs, edges);
        for &child_index in &child_indices {
            layout_notes_in_disc(
                nodes,
                &specs[child_index].member_node_ids,
                specs[child_index].centroid,
                specs[child_index].radius * 0.62,
                edges,
            );
        }

        let child_members = child_indices
            .iter()
            .flat_map(|index| specs[*index].member_node_ids.iter().cloned())
            .collect::<HashSet<_>>();
        let loose_members = specs[top_index]
            .member_node_ids
            .iter()
            .filter(|id| !child_members.contains(*id))
            .cloned()
            .collect::<Vec<_>>();
        if !loose_members.is_empty() {
            layout_notes_in_disc(
                nodes,
                &loose_members,
                specs[top_index].centroid,
                specs[top_index].radius * 0.78,
                edges,
            );
        }
    }
}

fn place_child_centers(
    parent_index: usize,
    child_indices: &[usize],
    specs: &mut [CloudSpec],
    edges: &[LayoutEdge],
) {
    let adjacency = build_edge_adjacency(edges);
    let parent_center = specs[parent_index].centroid;
    let parent_radius = specs[parent_index].radius;
    let mut order = child_indices.to_vec();
    order.sort_by(|left, right| {
        specs[*right]
            .centrality
            .total_cmp(&specs[*left].centrality)
            .then_with(|| {
                specs[*right]
                    .member_node_ids
                    .len()
                    .cmp(&specs[*left].member_node_ids.len())
            })
            .then_with(|| specs[*left].id.cmp(&specs[*right].id))
    });
    let mut placed = Vec::<usize>::new();
    for &index in &order {
        if placed.is_empty() {
            specs[index].centroid = parent_center;
            placed.push(index);
            continue;
        }
        let anchor =
            related_cloud_anchor(index, &placed, specs, edges, &adjacency).unwrap_or(parent_center);
        let mut center = find_non_overlapping_child_center(
            &specs[index],
            &placed,
            specs,
            anchor,
            parent_center,
            CHILD_CLOUD_GAP,
        );
        let max_dist =
            (parent_radius - specs[index].radius - CHILD_CLOUD_GAP).max(specs[index].radius);
        let from_parent = [center[0] - parent_center[0], center[1] - parent_center[1]];
        let dist = (from_parent[0] * from_parent[0] + from_parent[1] * from_parent[1]).sqrt();
        if dist > max_dist && dist > 1.0 {
            center = [
                parent_center[0] + from_parent[0] / dist * max_dist,
                parent_center[1] + from_parent[1] / dist * max_dist,
            ];
        }
        specs[index].centroid = center;
        placed.push(index);
    }
    relax_cloud_centers(
        child_indices,
        specs,
        edges,
        &adjacency,
        CHILD_CLOUD_GAP,
        0.72,
        90,
    );
    compact_child_centers(parent_index, child_indices, specs);
    enforce_cloud_non_overlap(child_indices, specs, CHILD_CLOUD_GAP, 90);
}

fn compact_child_centers(parent_index: usize, child_indices: &[usize], specs: &mut [CloudSpec]) {
    let parent_center = specs[parent_index].centroid;
    let parent_radius = specs[parent_index].radius;
    let max_extent = child_indices
        .iter()
        .map(|index| distance(specs[*index].centroid, parent_center) + specs[*index].radius)
        .fold(0.0_f32, f32::max);
    let target_extent = parent_radius * 0.68;
    if max_extent <= target_extent || max_extent <= 1.0 {
        return;
    }
    let scale = (target_extent / max_extent).clamp(0.72, 1.0);
    for &index in child_indices {
        specs[index].centroid = [
            parent_center[0] + (specs[index].centroid[0] - parent_center[0]) * scale,
            parent_center[1] + (specs[index].centroid[1] - parent_center[1]) * scale,
        ];
    }
}

fn layout_notes_in_disc(
    nodes: &mut [WorkingNode],
    member_ids: &[String],
    center: [f32; 2],
    radius: f32,
    edges: &[LayoutEdge],
) {
    let node_index = nodes
        .iter()
        .enumerate()
        .map(|(index, node)| (node.id.clone(), index))
        .collect::<HashMap<_, _>>();
    let mut members = member_ids
        .iter()
        .filter_map(|id| node_index.get(id).copied())
        .collect::<Vec<_>>();
    members.sort_by(|left, right| nodes[*left].id.cmp(&nodes[*right].id));
    if members.is_empty() {
        return;
    }
    let inner_radius = radius.max(36.0);
    let count = members.len().max(1) as f32;
    for (ordinal, &index) in members.iter().enumerate() {
        let phase = stable_angle(&nodes[index].id);
        let angle = phase + ordinal as f32 * 2.399_963_1;
        let normalized = ((ordinal + 1) as f32 / (count + 1.0)).sqrt();
        let jitter = 0.72 + ((stable_hash(&nodes[index].id) >> 16) % 1000) as f32 / 1000.0 * 0.22;
        let distance = inner_radius * normalized * jitter;
        nodes[index].x = center[0] + angle.cos() * distance;
        nodes[index].y = center[1] + angle.sin() * distance;
    }

    let member_set = member_ids.iter().cloned().collect::<HashSet<_>>();
    let local_edges = edges
        .iter()
        .filter(|edge| member_set.contains(&edge.source_id) && member_set.contains(&edge.target_id))
        .collect::<Vec<_>>();
    for _ in 0..54 {
        let mut deltas = HashMap::<usize, [f32; 2]>::new();
        apply_disc_repulsion(nodes, &members, &mut deltas);
        for edge in &local_edges {
            let (Some(&source), Some(&target)) = (
                node_index.get(&edge.source_id),
                node_index.get(&edge.target_id),
            ) else {
                continue;
            };
            let dx = nodes[target].x - nodes[source].x;
            let dy = nodes[target].y - nodes[source].y;
            let dist = (dx * dx + dy * dy).sqrt().max(1.0);
            let desired = 34.0 + (1.0 - edge.weight) * 58.0;
            let force = (dist - desired) * 0.018 * edge.weight;
            add_delta(&mut deltas, source, [dx / dist * force, dy / dist * force]);
            add_delta(
                &mut deltas,
                target,
                [-dx / dist * force, -dy / dist * force],
            );
        }
        for &index in &members {
            let dx = nodes[index].x - center[0];
            let dy = nodes[index].y - center[1];
            let dist = (dx * dx + dy * dy).sqrt().max(1.0);
            if dist > inner_radius {
                let force = (dist - inner_radius) * 0.22;
                add_delta(&mut deltas, index, [-dx / dist * force, -dy / dist * force]);
            }
        }
        for (&index, delta) in &deltas {
            nodes[index].x += delta[0].clamp(-8.0, 8.0);
            nodes[index].y += delta[1].clamp(-8.0, 8.0);
        }
    }
}

fn apply_disc_repulsion(
    nodes: &[WorkingNode],
    members: &[usize],
    deltas: &mut HashMap<usize, [f32; 2]>,
) {
    if members.len() <= DISC_LAYOUT_FULL_PAIR_MAX {
        let pairs = (0..members.len())
            .flat_map(|left_offset| {
                ((left_offset + 1)..members.len())
                    .map(move |right_offset| (members[left_offset], members[right_offset]))
            })
            .collect::<Vec<_>>();
        let pair_deltas = pairs
            .par_iter()
            .filter_map(|&(left, right)| {
                let dx = nodes[left].x - nodes[right].x;
                let dy = nodes[left].y - nodes[right].y;
                let dist = (dx * dx + dy * dy).sqrt().max(1.0);
                let desired = nodes[left].centrality.max(nodes[right].centrality) * 3.0 + 18.0;
                if dist >= desired {
                    return None;
                }
                let force = (desired - dist) * 0.18;
                Some((
                    left,
                    [dx / dist * force, dy / dist * force],
                    right,
                    [-dx / dist * force, -dy / dist * force],
                ))
            })
            .collect::<Vec<_>>();
        for (left, left_delta, right, right_delta) in pair_deltas {
            add_delta(deltas, left, left_delta);
            add_delta(deltas, right, right_delta);
        }
        return;
    }

    // Large clouds: only repel against nearest spatial neighbors instead of all pairs.
    let nearest_deltas = members
        .par_iter()
        .enumerate()
        .map(|(left_offset, &left)| {
            let mut nearest = members
                .iter()
                .enumerate()
                .filter(|(right_offset, _)| *right_offset != left_offset)
                .map(|(_, &right)| {
                    let dx = nodes[left].x - nodes[right].x;
                    let dy = nodes[left].y - nodes[right].y;
                    (right, dx * dx + dy * dy)
                })
                .collect::<Vec<_>>();
            nearest.sort_by(|a, b| a.1.total_cmp(&b.1).then_with(|| a.0.cmp(&b.0)));
            nearest.truncate(DISC_LAYOUT_REPULSION_NEIGHBORS);
            let mut local = Vec::new();
            for (right, _) in nearest {
                // Only emit each unordered pair once to avoid double-counting.
                if left >= right {
                    continue;
                }
                let dx = nodes[left].x - nodes[right].x;
                let dy = nodes[left].y - nodes[right].y;
                let dist = (dx * dx + dy * dy).sqrt().max(1.0);
                let desired = nodes[left].centrality.max(nodes[right].centrality) * 3.0 + 18.0;
                if dist < desired {
                    let force = (desired - dist) * 0.18;
                    local.push((
                        left,
                        [dx / dist * force, dy / dist * force],
                        right,
                        [-dx / dist * force, -dy / dist * force],
                    ));
                }
            }
            local
        })
        .flatten()
        .collect::<Vec<_>>();
    for (left, left_delta, right, right_delta) in nearest_deltas {
        add_delta(deltas, left, left_delta);
        add_delta(deltas, right, right_delta);
    }
}

fn finalize_cloud_cores(nodes: &[WorkingNode], edges: &[LayoutEdge], specs: &mut [CloudSpec]) {
    let adjacency = build_edge_adjacency(edges);
    let node_by_id = nodes
        .iter()
        .map(|node| (node.id.as_str(), node))
        .collect::<HashMap<_, _>>();
    let cores = specs
        .par_iter()
        .map(|spec| {
            let members = spec
                .member_node_ids
                .iter()
                .filter_map(|id| node_by_id.get(id.as_str()).copied())
                .collect::<Vec<_>>();
            if members.is_empty() {
                return (Vec::new(), Vec::new());
            }
            let mut distances = members
                .iter()
                .map(|node| {
                    let dx = node.x - spec.centroid[0];
                    let dy = node.y - spec.centroid[1];
                    (node.id.clone(), (dx * dx + dy * dy).sqrt())
                })
                .collect::<Vec<_>>();
            distances.sort_by(|left, right| {
                left.1
                    .total_cmp(&right.1)
                    .then_with(|| left.0.cmp(&right.0))
            });
            let threshold = robust_distance_threshold(&distances);
            let mut core = Vec::new();
            let mut outliers = Vec::new();
            for (id, dist) in distances {
                let affinity =
                    node_internal_affinity(&id, &spec.member_node_ids, edges, &adjacency);
                if spec.member_node_ids.len().saturating_sub(outliers.len()) > CLOUD_MIN_NOTES
                    && dist > threshold
                    && affinity < 0.55
                {
                    outliers.push(id);
                } else {
                    core.push(id);
                }
            }
            if core.len() < CLOUD_MIN_NOTES {
                (spec.member_node_ids.clone(), Vec::new())
            } else {
                (core, outliers)
            }
        })
        .collect::<Vec<_>>();
    for (spec, (core, outliers)) in specs.iter_mut().zip(cores) {
        spec.core_node_ids = core;
        spec.outlier_node_ids = outliers;
    }
}

fn robust_distance_threshold(distances: &[(String, f32)]) -> f32 {
    if distances.len() < 5 {
        return f32::MAX;
    }
    let q1 = distances[distances.len() / 4].1;
    let q3 = distances[(distances.len() * 3) / 4].1;
    let iqr = (q3 - q1).max(24.0);
    q3 + iqr * 1.35
}

fn build_cloud(spec: &CloudSpec, nodes: &[WorkingNode], links: &[WorkingLink]) -> AtlasCloud {
    let member_set = spec.member_node_ids.iter().cloned().collect::<HashSet<_>>();
    let core_set = if spec.core_node_ids.is_empty() {
        member_set.clone()
    } else {
        spec.core_node_ids.iter().cloned().collect::<HashSet<_>>()
    };
    let members = nodes
        .iter()
        .filter(|node| member_set.contains(&node.id))
        .collect::<Vec<_>>();
    let core_members = nodes
        .iter()
        .filter(|node| core_set.contains(&node.id))
        .collect::<Vec<_>>();
    let note_count = members.len();
    let density = cloud_density(links, &member_set, note_count);
    let label_members = if core_members.is_empty() {
        members.clone()
    } else {
        core_members.clone()
    };
    let label_notes = label_members
        .iter()
        .map(|node| AtlasLabelNote {
            id: node.id.clone(),
            title: node.title.clone(),
            tags: node.tags.clone(),
            embedding: node.embedding.clone(),
        })
        .collect::<Vec<_>>();
    let label_refs = label_notes.iter().collect::<Vec<_>>();
    let label = medoid_placeholder(&label_refs);
    let representative_node_ids = {
        let mut ranked = members.iter().copied().collect::<Vec<_>>();
        ranked.sort_by(|left, right| {
            right
                .centrality
                .total_cmp(&left.centrality)
                .then_with(|| left.title.cmp(&right.title))
        });
        ranked
            .into_iter()
            .take(5)
            .map(|node| node.id.clone())
            .collect::<Vec<_>>()
    };

    AtlasCloud {
        id: spec.id.clone(),
        parent_id: spec.parent_id.clone(),
        level: spec.level,
        label,
        label_confidence: 0.0,
        label_source: "pending".to_string(),
        note_count,
        density,
        color: cloud_color(&spec.id, spec.level),
        centroid: spec.centroid,
        label_anchor: cloud_label_anchor(spec, &members),
        radius: spec.radius,
        hull: blob_hull(&spec.id, &label_members, spec.centroid, spec.radius),
        member_node_ids: spec.member_node_ids.clone(),
        core_node_ids: spec.core_node_ids.clone(),
        outlier_node_ids: spec.outlier_node_ids.clone(),
        child_cloud_ids: spec.child_cloud_ids.clone(),
        representative_node_ids,
    }
}

fn cloud_color(id: &str, level: usize) -> [u8; 4] {
    const PALETTE: [[u8; 3]; 8] = [
        [255, 198, 58],
        [72, 202, 86],
        [43, 169, 255],
        [176, 103, 255],
        [0, 205, 225],
        [255, 92, 105],
        [255, 145, 49],
        [140, 220, 255],
    ];
    let color = PALETTE[(stable_hash(id) as usize) % PALETTE.len()];
    let alpha = if level == 0 { 118 } else { 72 };
    [color[0], color[1], color[2], alpha]
}

fn cloud_label_anchor(spec: &CloudSpec, members: &[&WorkingNode]) -> [f32; 2] {
    if members.is_empty() {
        return spec.centroid;
    }
    let angle = stable_angle(&spec.id);
    let offset = if spec.level == 0 {
        spec.radius * 0.42
    } else {
        spec.radius * 0.34
    };
    [
        spec.centroid[0] + angle.cos() * offset,
        spec.centroid[1] + angle.sin() * offset,
    ]
}

fn cloud_affinity(
    left: &CloudSpec,
    right: &CloudSpec,
    edges: &[LayoutEdge],
    adjacency: &EdgeAdjacency,
) -> f32 {
    let left_members = left.member_node_ids.iter().cloned().collect::<HashSet<_>>();
    let right_members = right
        .member_node_ids
        .iter()
        .cloned()
        .collect::<HashSet<_>>();
    let (scan_ids, other_set) = if left.member_node_ids.len() <= right.member_node_ids.len() {
        (&left.member_node_ids, &right_members)
    } else {
        (&right.member_node_ids, &left_members)
    };
    let mut total = 0.0_f32;
    for id in scan_ids {
        let Some(edge_indices) = adjacency.get(id) else {
            continue;
        };
        for &edge_index in edge_indices {
            let edge = &edges[edge_index];
            let neighbor = if edge.source_id == *id {
                &edge.target_id
            } else {
                &edge.source_id
            };
            if other_set.contains(neighbor) {
                total += edge.weight;
            }
        }
    }
    total
}

fn add_delta(deltas: &mut HashMap<usize, [f32; 2]>, index: usize, delta: [f32; 2]) {
    let entry = deltas.entry(index).or_insert([0.0, 0.0]);
    entry[0] += delta[0];
    entry[1] += delta[1];
}

fn cosine_similarity(left: &[f32], right: &[f32]) -> f32 {
    if left.is_empty() || right.is_empty() || left.len() != right.len() {
        return 0.0;
    }
    let mut dot = 0.0_f32;
    let mut left_norm = 0.0_f32;
    let mut right_norm = 0.0_f32;
    for (left_value, right_value) in left.iter().zip(right) {
        dot += left_value * right_value;
        left_norm += left_value * left_value;
        right_norm += right_value * right_value;
    }
    if left_norm <= f32::EPSILON || right_norm <= f32::EPSILON {
        return 0.0;
    }
    (dot / (left_norm.sqrt() * right_norm.sqrt())).clamp(-1.0, 1.0)
}

fn normalized_embedding(mut embedding: Vec<f32>) -> Vec<f32> {
    let norm = embedding
        .iter()
        .map(|value| value * value)
        .sum::<f32>()
        .sqrt();
    if norm <= f32::EPSILON {
        return embedding;
    }
    for value in &mut embedding {
        *value /= norm;
    }
    embedding
}

fn stable_angle(value: &str) -> f32 {
    (stable_hash(value) % 10_000) as f32 / 10_000.0 * std::f32::consts::TAU
}

fn distance(left: [f32; 2], right: [f32; 2]) -> f32 {
    squared_distance(left, right).sqrt()
}

fn squared_distance(left: [f32; 2], right: [f32; 2]) -> f32 {
    let dx = left[0] - right[0];
    let dy = left[1] - right[1];
    dx * dx + dy * dy
}

struct DisjointSet {
    parent: Vec<usize>,
    rank: Vec<u8>,
}

impl DisjointSet {
    fn new(size: usize) -> Self {
        Self {
            parent: (0..size).collect(),
            rank: vec![0; size],
        }
    }

    fn find(&mut self, value: usize) -> usize {
        if self.parent[value] != value {
            self.parent[value] = self.find(self.parent[value]);
        }
        self.parent[value]
    }

    fn union(&mut self, left: usize, right: usize) -> bool {
        let mut left_root = self.find(left);
        let mut right_root = self.find(right);
        if left_root == right_root {
            return false;
        }
        if self.rank[left_root] < self.rank[right_root] {
            std::mem::swap(&mut left_root, &mut right_root);
        }
        self.parent[right_root] = left_root;
        if self.rank[left_root] == self.rank[right_root] {
            self.rank[left_root] += 1;
        }
        true
    }
}

fn centroid(nodes: &[&WorkingNode]) -> [f32; 2] {
    if nodes.is_empty() {
        return [0.0, 0.0];
    }
    let (x, y) = nodes.iter().fold((0.0, 0.0), |(sum_x, sum_y), node| {
        (sum_x + node.x, sum_y + node.y)
    });
    [x / nodes.len() as f32, y / nodes.len() as f32]
}

fn blob_hull(
    seed: &str,
    nodes: &[&WorkingNode],
    centroid: [f32; 2],
    max_radius: f32,
) -> Vec<[f32; 2]> {
    const POINTS: usize = 48;
    let base_radius = nodes
        .iter()
        .map(|node| {
            let dx = node.x - centroid[0];
            let dy = node.y - centroid[1];
            (dx * dx + dy * dy).sqrt()
        })
        .fold(76.0_f32, f32::max);
    let padding = 52.0 + (nodes.len() as f32).sqrt() * 4.0;
    let seed_phase = (stable_hash(seed) % 10_000) as f32 / 10_000.0 * std::f32::consts::TAU;

    (0..POINTS)
        .map(|index| {
            let angle = index as f32 / POINTS as f32 * std::f32::consts::TAU;
            let directional_extent = nodes
                .iter()
                .map(|node| {
                    let dx = node.x - centroid[0];
                    let dy = node.y - centroid[1];
                    let projection = dx * angle.cos() + dy * angle.sin();
                    projection.max(0.0)
                })
                .fold(base_radius * 0.58, f32::max);
            let wobble = 1.0
                + 0.1 * (angle * 2.0 + seed_phase).sin()
                + 0.07 * (angle * 3.0 + seed_phase * 0.7).cos()
                + 0.04 * (angle * 5.0 + seed_phase * 1.3).sin();
            let radius = ((directional_extent + padding) * wobble.clamp(0.86, 1.18))
                .min(max_radius.max(80.0));
            [
                centroid[0] + angle.cos() * radius,
                centroid[1] + angle.sin() * radius,
            ]
        })
        .collect()
}

fn cloud_density(links: &[WorkingLink], member_ids: &HashSet<String>, note_count: usize) -> f32 {
    if note_count < 2 {
        return 0.0;
    }
    let internal = links
        .iter()
        .filter(|link| member_ids.contains(&link.source_id) && member_ids.contains(&link.target_id))
        .count() as f32;
    let possible = (note_count * (note_count - 1) / 2).max(1) as f32;
    (internal / possible).clamp(0.0, 1.0)
}

fn parse_rfc3339_millis(value: &str) -> Option<u64> {
    let value = value.trim();
    if value.len() < 20 {
        return None;
    }
    let year = value.get(0..4)?.parse::<i64>().ok()?;
    let month = value.get(5..7)?.parse::<i64>().ok()?;
    let day = value.get(8..10)?.parse::<i64>().ok()?;
    let hour = value.get(11..13)?.parse::<i64>().ok()?;
    let minute = value.get(14..16)?.parse::<i64>().ok()?;
    let second = value.get(17..19)?.parse::<i64>().ok()?;
    if value.as_bytes().get(4) != Some(&b'-')
        || value.as_bytes().get(7) != Some(&b'-')
        || value.as_bytes().get(10) != Some(&b'T')
        || value.as_bytes().get(13) != Some(&b':')
        || value.as_bytes().get(16) != Some(&b':')
        || !(1..=12).contains(&month)
        || !(1..=31).contains(&day)
        || !(0..=23).contains(&hour)
        || !(0..=59).contains(&minute)
        || !(0..=60).contains(&second)
    {
        return None;
    }
    let days = days_from_civil(year, month, day);
    let seconds = days
        .checked_mul(86_400)?
        .checked_add(hour.checked_mul(3_600)?)?
        .checked_add(minute.checked_mul(60)?)?
        .checked_add(second)?;
    u64::try_from(seconds).ok()?.checked_mul(1_000)
}

fn days_from_civil(year: i64, month: i64, day: i64) -> i64 {
    let year = year - i64::from(month <= 2);
    let era = if year >= 0 { year } else { year - 399 } / 400;
    let yoe = year - era * 400;
    let month = month + if month > 2 { -3 } else { 9 };
    let doy = (153 * month + 2) / 5 + day - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146_097 + doe - 719_468
}

fn stale_score(last_activity: u64, max_modified: u64) -> f32 {
    if max_modified == 0 || last_activity >= max_modified {
        return 0.0;
    }
    let month = 1000.0 * 60.0 * 60.0 * 24.0 * 30.0;
    ((max_modified - last_activity) as f32 / month).clamp(0.0, 1.0)
}

fn drift_position(x: f32, y: f32, stale_score: f32) -> (f32, f32) {
    let length = (x * x + y * y).sqrt().max(1.0);
    let drift = STALE_DRIFT_DISTANCE * stale_score * stale_score;
    (x + x / length * drift, y + y / length * drift)
}

fn normalize_edge_strength(score: f32) -> f32 {
    ((score - SEMANTIC_MIN_SCORE) / (0.82 - SEMANTIC_MIN_SCORE)).clamp(0.15, 0.9)
}

fn lexical_note_score(terms: &[String], text_parts: &[&str], tags: &[String]) -> f32 {
    if terms.is_empty() {
        return 0.0;
    }
    let haystack = normalize_search_text(&format!("{} {}", text_parts.join(" "), tags.join(" ")));
    let matched = terms
        .iter()
        .filter(|term| {
            haystack
                .split_whitespace()
                .any(|word| word == term.as_str())
                || haystack.contains(term.as_str())
        })
        .count();
    let coverage = matched as f32 / terms.len().max(1) as f32;
    let phrase_bonus = if haystack.contains(&terms.join(" ")) {
        0.18
    } else {
        0.0
    };
    (coverage + phrase_bonus).clamp(0.0, 1.0)
}

fn title_tag_path_score(
    normalized_query: &str,
    terms: &[String],
    title: &str,
    file_name: &str,
    note_path: &str,
    tags: &[String],
) -> f32 {
    if normalized_query.is_empty() {
        return 0.0;
    }
    let title = normalize_search_text(title);
    let file_name = normalize_search_text(file_name);
    let note_path = normalize_search_text(note_path);
    let tags = normalize_search_text(&tags.join(" "));
    let exact = [
        (title.contains(normalized_query), 0.48_f32),
        (tags.contains(normalized_query), 0.28_f32),
        (file_name.contains(normalized_query), 0.18_f32),
        (note_path.contains(normalized_query), 0.12_f32),
    ]
    .into_iter()
    .filter_map(|(matched, weight)| matched.then_some(weight))
    .sum::<f32>();
    let term_hits = terms
        .iter()
        .map(|term| {
            if title.contains(term) {
                0.12
            } else if tags.contains(term) {
                0.1
            } else if file_name.contains(term) || note_path.contains(term) {
                0.05
            } else {
                0.0
            }
        })
        .sum::<f32>();
    (exact + term_hits).clamp(0.0, 1.0)
}

pub(crate) fn recency_score(now: u64, last_activity: u64, modified: u64) -> f32 {
    let activity = last_activity.max(modified);
    if activity >= now {
        return 1.0;
    }
    let ninety_days = 1000.0 * 60.0 * 60.0 * 24.0 * 90.0;
    (1.0 - (now - activity) as f32 / ninety_days).clamp(0.0, 1.0)
}

/// Diminishing returns on open count: ~0.5 around 7 opens, ~1.0 around 54.
pub(crate) fn frequency_score(open_count: u64) -> f32 {
    ((open_count as f32).ln_1p() / 4.0).clamp(0.0, 1.0)
}

fn reason_labels(
    semantic_score: f32,
    lexical_score: f32,
    structural_score: f32,
    access_score: f32,
) -> Vec<String> {
    let mut labels = Vec::new();
    if semantic_score >= 0.55 {
        labels.push("Semantic match".to_string());
    }
    if lexical_score >= 0.45 {
        labels.push("Text match".to_string());
    }
    if structural_score >= 0.28 {
        labels.push("Title/tag/path match".to_string());
    }
    if access_score >= 0.72 {
        labels.push("Recent or accessed".to_string());
    }
    labels
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

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn test_dir(label: &str) -> PathBuf {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock")
            .as_nanos();
        let path = std::env::temp_dir().join(format!("gneauxghts-atlas-{label}-{unique}"));
        fs::create_dir_all(&path).expect("create test directory");
        path
    }

    fn test_dependencies(source_key: &str, input_hash: &str) -> AtlasDependencies {
        AtlasDependencies {
            source_key: source_key.to_string(),
            input_hash: input_hash.to_string(),
            note_ann_generation: "ann-1".to_string(),
            edge_generation: "edge-1".to_string(),
            edge_algorithm_version: "edge-v1".to_string(),
            cloud_algorithm_version: ATLAS_CLOUD_ALGORITHM_VERSION,
            layout_algorithm_version: ATLAS_LAYOUT_ALGORITHM_VERSION,
        }
    }

    #[test]
    fn atomic_publication_keeps_previous_generation_until_pointer_flip() {
        let cache = test_dir("atomic");
        let key = AtlasGenerationKey::default();
        let root = atlas_root(&cache);
        let old_artifact = AtlasGenerationArtifact {
            response: empty_atlas("ready", "", 1).expect("old response"),
        };
        let new_artifact = AtlasGenerationArtifact {
            response: empty_atlas("ready", "", 2).expect("new response"),
        };
        atomic_write_json(&root.join("generation-hidden-old.json"), &old_artifact)
            .expect("old artifact");
        atomic_write_json(
            &ready_pointer_path(&cache, key),
            &AtlasReadyPointer {
                format_version: ATLAS_GENERATION_FORMAT_VERSION,
                structural_generation: "old".to_string(),
                target_epoch: 1,
                published_at_millis: 1,
                artifact_file: "generation-hidden-old.json".to_string(),
                dependencies: test_dependencies("hidden", "old"),
            },
        )
        .expect("old pointer");
        atomic_write_json(&root.join("generation-hidden-new.json"), &new_artifact)
            .expect("new artifact");
        let before: AtlasReadyPointer =
            read_json(&ready_pointer_path(&cache, key)).expect("read old pointer");
        assert_eq!(before.structural_generation, "old");

        let mut next = before;
        next.structural_generation = "new".to_string();
        next.target_epoch = 2;
        next.artifact_file = "generation-hidden-new.json".to_string();
        atomic_write_json(&ready_pointer_path(&cache, key), &next).expect("flip pointer");
        let after: AtlasReadyPointer =
            read_json(&ready_pointer_path(&cache, key)).expect("read new pointer");
        assert_eq!(after.structural_generation, "new");
        fs::remove_dir_all(cache).expect("cleanup");
    }

    #[test]
    fn compatibility_rejects_input_and_algorithm_changes() {
        let current = test_dependencies("remembered:set-a", "input-a");
        assert_eq!(current, current.clone());
        let mut changed_set = current.clone();
        changed_set.source_key = "remembered:set-b".to_string();
        assert_ne!(current, changed_set);
        let mut changed_layout = current.clone();
        changed_layout.layout_algorithm_version += 1;
        assert_ne!(current, changed_layout);
        let mut changed_edge = current.clone();
        changed_edge.edge_generation = "edge-2".to_string();
        assert_ne!(current, changed_edge);
    }

    #[test]
    fn warm_generation_is_served_stale_while_new_epoch_builds() {
        let dependencies = test_dependencies("hidden", "input");
        let pointer = AtlasReadyPointer {
            format_version: ATLAS_GENERATION_FORMAT_VERSION,
            structural_generation: "generation-1".to_string(),
            target_epoch: 4,
            published_at_millis: 10,
            artifact_file: "generation-hidden-1.json".to_string(),
            dependencies: dependencies.clone(),
        };
        assert!(pointer_is_compatible(&pointer, &dependencies, 4));
        assert!(!pointer_is_compatible(&pointer, &dependencies, 5));
        let mut changed = dependencies.clone();
        changed.input_hash = "edited".to_string();
        assert!(!pointer_is_compatible(&pointer, &changed, 4));
    }

    #[test]
    fn label_pointer_requires_current_algorithm_and_model() {
        let mut pointer = AtlasLabelReadyPointer {
            format_version: ATLAS_GENERATION_FORMAT_VERSION,
            structural_generation: "structure-1".to_string(),
            membership_fingerprint: "members-1".to_string(),
            algorithm_version: LABEL_ALGORITHM_VERSION.to_string(),
            model_fingerprint: "model-1".to_string(),
            label_generation: "labels-1".to_string(),
            artifact_file: "labels.json".to_string(),
        };
        assert!(label_pointer_is_compatible(
            &pointer,
            "structure-1",
            "members-1",
            "model-1"
        ));
        pointer.algorithm_version = "old-algorithm".to_string();
        assert!(!label_pointer_is_compatible(
            &pointer,
            "structure-1",
            "members-1",
            "model-1"
        ));
        pointer.algorithm_version = LABEL_ALGORITHM_VERSION.to_string();
        pointer.model_fingerprint = "model-2".to_string();
        assert!(!label_pointer_is_compatible(
            &pointer,
            "structure-1",
            "members-1",
            "model-1"
        ));
    }

    #[test]
    fn label_artifact_complete_defaults_true_for_legacy_payloads() {
        let legacy = serde_json::json!({
            "structuralGeneration": "structure-1",
            "membershipFingerprint": "members-1",
            "algorithmVersion": LABEL_ALGORITHM_VERSION,
            "modelFingerprint": "model-1",
            "labelGeneration": "labels-1",
            "labels": {
                "cloud-a": { "label": "garden", "confidence": 0.9, "source": "keybert" }
            }
        });
        let artifact: AtlasLabelGenerationArtifact =
            serde_json::from_value(legacy).expect("legacy artifact");
        assert!(artifact.complete);
        assert_eq!(artifact.labels.len(), 1);

        let incomplete = AtlasLabelGenerationArtifact {
            structural_generation: "structure-1".to_string(),
            membership_fingerprint: "members-1".to_string(),
            algorithm_version: LABEL_ALGORITHM_VERSION.to_string(),
            model_fingerprint: "model-1".to_string(),
            label_generation: "labels-1".to_string(),
            labels: HashMap::from([(
                "cloud-a".to_string(),
                AtlasPublishedLabel {
                    label: "garden".to_string(),
                    confidence: 0.9,
                    source: "keybert".to_string(),
                },
            )]),
            complete: false,
        };
        let encoded = serde_json::to_value(&incomplete).expect("encode");
        assert_eq!(encoded["complete"], false);
        let roundtrip: AtlasLabelGenerationArtifact =
            serde_json::from_value(encoded).expect("roundtrip");
        assert!(!roundtrip.complete);
    }

    #[test]
    fn variant_targets_coalesce_to_newest_epoch() {
        let key = AtlasGenerationKey {
            chat_visibility: AtlasChatVisibilityKey::Remembered,
        };
        let mut pending = PendingIndexState::default();
        for epoch in [3, 8, 5] {
            pending
                .atlas_requests
                .entry(key)
                .and_modify(|target| *target = (*target).max(epoch))
                .or_insert(epoch);
        }
        assert_eq!(pending.atlas_requests.get(&key), Some(&8));
        pending.atlas_building.insert(key, 8);
        assert!(pending
            .atlas_building
            .get(&key)
            .is_some_and(|epoch| *epoch >= 8));
        assert!(request_is_superseded(&pending, key, 7));
        assert!(!request_is_superseded(&pending, key, 8));
    }

    #[test]
    fn atlas_visibilities_for_mutation_batch_skips_hidden_for_chat_recall_only() {
        assert_eq!(
            atlas_visibilities_for_mutation_batch(false, true, false, false),
            [
                AtlasChatVisibilityKey::Remembered,
                AtlasChatVisibilityKey::All,
            ]
        );
        assert_eq!(
            atlas_visibilities_for_mutation_batch(true, false, false, false),
            [
                AtlasChatVisibilityKey::Hidden,
                AtlasChatVisibilityKey::Remembered,
                AtlasChatVisibilityKey::All,
            ]
        );
        assert_eq!(
            atlas_visibilities_for_mutation_batch(true, true, false, false),
            [
                AtlasChatVisibilityKey::Hidden,
                AtlasChatVisibilityKey::Remembered,
                AtlasChatVisibilityKey::All,
            ]
        );
        assert_eq!(
            atlas_visibilities_for_mutation_batch(false, true, true, false),
            [
                AtlasChatVisibilityKey::Hidden,
                AtlasChatVisibilityKey::Remembered,
                AtlasChatVisibilityKey::All,
            ]
        );
        assert_eq!(
            atlas_visibilities_for_mutation_batch(false, false, false, true),
            [
                AtlasChatVisibilityKey::Hidden,
                AtlasChatVisibilityKey::Remembered,
                AtlasChatVisibilityKey::All,
            ]
        );
    }

    #[test]
    fn atlas_structural_build_covers_epoch_skips_redundant_enqueue() {
        let key = AtlasGenerationKey {
            chat_visibility: AtlasChatVisibilityKey::Hidden,
        };
        let mut pending = PendingIndexState::default();
        assert!(!atlas_structural_build_covers_epoch(&pending, key, 4));
        pending.atlas_building.insert(key, 4);
        assert!(atlas_structural_build_covers_epoch(&pending, key, 4));
        assert!(atlas_structural_build_covers_epoch(&pending, key, 3));
        assert!(!atlas_structural_build_covers_epoch(&pending, key, 5));
    }

    #[test]
    fn persisted_visibility_variants_distinguish_remembered_chat_set() {
        let row = |path: &str, kind, chunk_count| StoredAtlasNoteMetadata {
            note_path: path.to_string(),
            title: path.to_string(),
            modified_millis: 1,
            document_kind: kind,
            note_id: String::new(),
            preview: String::new(),
            tags: Vec::new(),
            wikilink_targets: Vec::new(),
            chunk_count,
            presentation_hash: format!("presentation-{path}"),
        };
        let note = row("note.md", DocumentKind::Note, 1);
        let remembered = row("remembered.md", DocumentKind::ChatIndex, 2);
        let navigation_only = row("navigation.md", DocumentKind::ChatIndex, 0);
        let transcript = row("transcript.md", DocumentKind::ChatTranscript, 4);
        assert!(atlas_row_visible(&note, AtlasChatVisibilityKey::Hidden));
        assert!(!atlas_row_visible(
            &remembered,
            AtlasChatVisibilityKey::Hidden
        ));
        assert!(atlas_row_visible(
            &remembered,
            AtlasChatVisibilityKey::Remembered
        ));
        assert!(!atlas_row_visible(
            &navigation_only,
            AtlasChatVisibilityKey::Remembered
        ));
        assert!(atlas_row_visible(
            &navigation_only,
            AtlasChatVisibilityKey::All
        ));
        assert!(!atlas_row_visible(&transcript, AtlasChatVisibilityKey::All));
    }

    #[test]
    fn gc_preserves_every_referenced_variant_and_removes_orphans() {
        let cache = test_dir("gc");
        let root = atlas_root(&cache);
        fs::create_dir_all(&root).expect("atlas root");
        for visibility in [
            AtlasChatVisibilityKey::Hidden,
            AtlasChatVisibilityKey::Remembered,
            AtlasChatVisibilityKey::All,
        ] {
            let name = format!("generation-{}-kept.json", visibility.signature_value());
            fs::write(root.join(&name), b"{}").expect("artifact");
            atomic_write_json(
                &ready_pointer_path(
                    &cache,
                    AtlasGenerationKey {
                        chat_visibility: visibility,
                    },
                ),
                &AtlasReadyPointer {
                    format_version: ATLAS_GENERATION_FORMAT_VERSION,
                    structural_generation: "kept".to_string(),
                    target_epoch: 1,
                    published_at_millis: 1,
                    artifact_file: name,
                    dependencies: test_dependencies(visibility.signature_value(), "input"),
                },
            )
            .expect("pointer");
        }
        fs::write(root.join("generation-hidden-orphan.json"), b"{}").expect("orphan");
        gc_unreferenced_generations(&cache).expect("gc");
        assert!(!root.join("generation-hidden-orphan.json").exists());
        assert!(root.join("generation-hidden-kept.json").exists());
        assert!(root.join("generation-remembered-kept.json").exists());
        assert!(root.join("generation-all-kept.json").exists());
        fs::remove_dir_all(cache).expect("cleanup");
    }

    #[test]
    fn complete_knn_rows_for_umap_keeps_full_rows_without_exact_fill() {
        let nodes = vec![
            test_node("a", "Alpha", 0.0, 0.0),
            test_node("b", "Beta", 1.0, 0.0),
            test_node("c", "Gamma", 0.0, 1.0),
            test_node("d", "Delta", 1.0, 1.0),
        ];
        let knn_rows = vec![
            vec![
                KnnNeighbor {
                    index: 1,
                    similarity: 0.9,
                    distance: 0.1,
                },
                KnnNeighbor {
                    index: 2,
                    similarity: 0.8,
                    distance: 0.2,
                },
            ],
            vec![
                KnnNeighbor {
                    index: 0,
                    similarity: 0.9,
                    distance: 0.1,
                },
                KnnNeighbor {
                    index: 3,
                    similarity: 0.7,
                    distance: 0.3,
                },
            ],
            vec![
                KnnNeighbor {
                    index: 0,
                    similarity: 0.8,
                    distance: 0.2,
                },
                KnnNeighbor {
                    index: 3,
                    similarity: 0.75,
                    distance: 0.25,
                },
            ],
            vec![
                KnnNeighbor {
                    index: 1,
                    similarity: 0.7,
                    distance: 0.3,
                },
                KnnNeighbor {
                    index: 2,
                    similarity: 0.75,
                    distance: 0.25,
                },
            ],
        ];
        let completed = complete_knn_rows_for_umap(&nodes, &knn_rows, 2);
        assert_eq!(completed.len(), 4);
        for (index, row) in completed.iter().enumerate() {
            assert_eq!(row.len(), 2, "row {index} should stay complete");
            let mut got = row
                .iter()
                .map(|neighbor| neighbor.index)
                .collect::<Vec<_>>();
            let mut expected = knn_rows[index]
                .iter()
                .map(|neighbor| neighbor.index)
                .collect::<Vec<_>>();
            got.sort_unstable();
            expected.sort_unstable();
            assert_eq!(got, expected, "row {index} should keep HNSW neighbors");
        }
    }

    #[test]
    fn umap_iterations_scale_with_note_count() {
        assert!(umap_iterations_for_note_count(1) >= UMAP_ITERATIONS_BASE);
        assert!(umap_iterations_for_note_count(10_000) <= UMAP_ITERATIONS_MAX);
        assert!(umap_iterations_for_note_count(400) < UMAP_ITERATIONS_MAX);
        assert!(umap_iterations_for_note_count(400) > umap_iterations_for_note_count(16));
    }

    #[test]
    fn atlas_visibility_filters_hidden_chat_rows_and_adds_navigation_only_chats() {
        let stored = vec![
            StoredAtlasNoteEmbedding {
                note_path: "/vault/note.md".to_string(),
                note_title: "Note".to_string(),
                modified_millis: 1,
                semantic_input_hash: "note-hash".to_string(),
                structure_hash: "note-structure".to_string(),
                created_at: String::new(),
                updated_at: String::new(),
                embedding: vec![1.0, 0.0, 0.0],
            },
            StoredAtlasNoteEmbedding {
                note_path: "/vault/Chats/remembered/Conversation.md".to_string(),
                note_title: "Remembered".to_string(),
                modified_millis: 1,
                semantic_input_hash: "recall-hash".to_string(),
                structure_hash: "recall-structure".to_string(),
                created_at: String::new(),
                updated_at: String::new(),
                embedding: vec![0.0, 1.0, 0.0],
            },
        ];
        let note_meta = AtlasNoteMetadata {
            note_id: Some("note".to_string()),
            note_path: "/vault/note.md".to_string(),
            file_name: "note.md".to_string(),
            title: "Note".to_string(),
            preview: String::new(),
            tags: Vec::new(),
            document_kind: DocumentKind::Note,
            modified_millis: 1,
        };
        let hidden = visible_atlas_notes(
            stored.clone(),
            &HashMap::from([(note_meta.note_path.clone(), note_meta.clone())]),
            3,
        );
        assert_eq!(hidden.len(), 1);
        assert_eq!(hidden[0].note_path, "/vault/note.md");

        let chat_meta = AtlasNoteMetadata {
            note_id: Some("chat".to_string()),
            note_path: "/vault/Chats/new/Conversation.md".to_string(),
            file_name: "Conversation.md".to_string(),
            title: "New chat".to_string(),
            preview: String::new(),
            tags: Vec::new(),
            document_kind: DocumentKind::ChatIndex,
            modified_millis: 2,
        };
        let all = visible_atlas_notes(
            stored,
            &HashMap::from([
                (note_meta.note_path.clone(), note_meta),
                (chat_meta.note_path.clone(), chat_meta),
            ]),
            3,
        );
        assert_eq!(all.len(), 2);
        let chat = all
            .iter()
            .find(|note| note.note_title == "New chat")
            .expect("navigation-only chat");
        assert!(chat
            .semantic_input_hash
            .starts_with(NAVIGATION_ONLY_SEMANTIC_HASH_PREFIX));
    }

    fn test_node(id: &str, title: &str, x: f32, y: f32) -> WorkingNode {
        WorkingNode {
            id: id.to_string(),
            note_id: Some(id.to_string()),
            note_path: format!("/vault/{id}.md"),
            title: title.to_string(),
            file_name: format!("{id}.md"),
            preview: String::new(),
            tags: Vec::new(),
            modified_at_millis: 100,
            created_at_millis: 100,
            updated_at_millis: 100,
            last_viewed_at_millis: None,
            stale_score: 0.0,
            centrality: 0.5,
            degree: 0,
            importance: 0.0,
            embedding: vec![x, y, 1.0],
            x,
            y,
            cloud_id: None,
            parent_cloud_id: None,
            child_cloud_id: None,
            isolated: true,
        }
    }

    fn test_edge(source: &str, target: &str, weight: f32) -> LayoutEdge {
        LayoutEdge {
            source_id: source.to_string(),
            target_id: target.to_string(),
            weight,
        }
    }

    fn test_working_link(source: &str, target: &str, strength: f32) -> WorkingLink {
        WorkingLink {
            source_id: source.to_string(),
            target_id: target.to_string(),
            kind: "semantic".to_string(),
            score: strength,
            strength,
        }
    }

    fn test_cloud_spec(id: &str, radius: f32, centrality: f32, members: &[&str]) -> CloudSpec {
        CloudSpec {
            id: id.to_string(),
            parent_id: None,
            level: 0,
            member_node_ids: members.iter().map(|member| member.to_string()).collect(),
            core_node_ids: Vec::new(),
            outlier_node_ids: Vec::new(),
            child_cloud_ids: Vec::new(),
            centroid: [0.0, 0.0],
            radius,
            centrality,
        }
    }

    fn assert_specs_do_not_overlap(specs: &[CloudSpec], level: usize, gap: f32) {
        let specs = specs
            .iter()
            .filter(|spec| spec.level == level)
            .collect::<Vec<_>>();
        for left in 0..specs.len() {
            for right in (left + 1)..specs.len() {
                let dist = distance(specs[left].centroid, specs[right].centroid);
                let required = specs[left].radius + specs[right].radius + gap - 0.5;
                assert!(
                    dist >= required,
                    "{} and {} overlap: dist={dist}, required={required}",
                    specs[left].id,
                    specs[right].id
                );
            }
        }
    }

    #[test]
    fn stale_score_uses_recent_activity_as_zero_and_old_activity_as_outer_pull() {
        assert_eq!(stale_score(100, 100), 0.0);
        assert!(stale_score(0, 1000 * 60 * 60 * 24 * 45) > 0.9);
    }

    #[test]
    fn activity_does_not_change_structural_link_strength() {
        let mut recent_nodes = [test_node("a", "A", 0.0, 0.0), test_node("b", "B", 1.0, 0.0)];
        recent_nodes[0].note_path = "folder/a.md".to_string();
        recent_nodes[1].note_path = "folder/b.md".to_string();
        recent_nodes[0].stale_score = 0.0;
        recent_nodes[1].stale_score = 0.0;
        let mut stale_nodes = recent_nodes.clone();
        stale_nodes[0].stale_score = 1.0;
        stale_nodes[1].stale_score = 1.0;
        let mut recent_links = vec![test_working_link("a", "b", 0.5)];
        let mut stale_links = recent_links.clone();

        boost_links(&mut recent_links, &recent_nodes);
        boost_links(&mut stale_links, &stale_nodes);

        assert_eq!(recent_links[0].strength, stale_links[0].strength);
        assert_eq!(recent_links[0].strength, 0.5 + FOLDER_BOOST);
    }

    #[test]
    fn connected_components_respects_minimum_link_strength() {
        let nodes = [
            test_node("a", "A", 0.0, 0.0),
            test_node("b", "B", 1.0, 0.0),
            test_node("c", "C", 100.0, 0.0),
        ];
        let links = [
            LayoutEdge {
                source_id: "a".to_string(),
                target_id: "b".to_string(),
                weight: COMPONENT_MIN_STRENGTH,
            },
            LayoutEdge {
                source_id: "b".to_string(),
                target_id: "c".to_string(),
                weight: COMPONENT_MIN_STRENGTH - 0.01,
            },
        ];

        let mut components = connected_components(&nodes, &links);
        components.sort_by_key(|component| component.len());

        assert_eq!(components.len(), 2);
        assert_eq!(components[0], vec!["c".to_string()]);
        assert_eq!(components[1].len(), 2);
    }

    #[test]
    fn many_topic_clusters_become_many_top_clouds() {
        let mut nodes = Vec::new();
        let mut edges = Vec::new();
        for cluster in 0..12 {
            for ordinal in 0..20 {
                let id = format!("c{cluster:02}-{ordinal:02}");
                let mut node =
                    test_node(&id, &format!("Cluster {cluster} Note {ordinal}"), 0.0, 0.0);
                let mut embedding = vec![0.0_f32; 12];
                embedding[cluster] = 1.0;
                embedding.push(ordinal as f32 / 20.0);
                node.embedding = embedding;
                node.centrality = if ordinal == 0 { 1.0 } else { 0.45 };
                nodes.push(node);
                if ordinal > 0 {
                    edges.push(test_edge(
                        &format!("c{cluster:02}-{:02}", ordinal - 1),
                        &id,
                        0.82,
                    ));
                }
                if ordinal > 1 {
                    edges.push(test_edge(
                        &format!("c{cluster:02}-{:02}", ordinal - 2),
                        &id,
                        0.72,
                    ));
                }
            }
        }

        let mut specs = assign_clouds(&mut nodes, &edges);
        let top_level_count = specs.iter().filter(|spec| spec.level == 0).count();
        assert!(
            top_level_count >= 10,
            "expected content-driven top clouds near cluster count, got {top_level_count}"
        );
        place_cloud_first_layout(&mut nodes, &edges, &mut specs, DEFAULT_LAYOUT_PULL);
        assert_specs_do_not_overlap(&specs, 0, TOP_LEVEL_CLOUD_GAP);
    }

    #[test]
    fn weak_bridges_do_not_collapse_distinct_topics() {
        let mut nodes = Vec::new();
        let mut edges = Vec::new();
        for topic in 0..4 {
            for ordinal in 0..12 {
                let id = format!("t{topic}-{ordinal:02}");
                let mut node = test_node(&id, &format!("Topic {topic} Note {ordinal}"), 0.0, 0.0);
                // Orthogonal-ish topic axes so embedding similarity across topics stays low.
                let mut embedding = vec![0.0_f32; 4];
                embedding[topic] = 1.0;
                embedding.push(ordinal as f32 / 12.0);
                node.embedding = embedding;
                node.centrality = if ordinal == 0 { 1.0 } else { 0.4 };
                nodes.push(node);
                if ordinal > 0 {
                    edges.push(test_edge(
                        &format!("t{topic}-{:02}", ordinal - 1),
                        &id,
                        0.88,
                    ));
                }
                if ordinal > 1 {
                    edges.push(test_edge(
                        &format!("t{topic}-{:02}", ordinal - 2),
                        &id,
                        0.78,
                    ));
                }
            }
        }
        // Sparse weak bridges — previously these summed past the merge threshold.
        edges.push(test_edge("t0-00", "t1-00", 0.34));
        edges.push(test_edge("t1-00", "t2-00", 0.34));
        edges.push(test_edge("t2-00", "t3-00", 0.34));
        edges.push(test_edge("t0-05", "t2-05", 0.32));

        let specs = assign_clouds(&mut nodes, &edges);
        let top_level_count = specs.iter().filter(|spec| spec.level == 0).count();
        assert!(
            top_level_count >= 3,
            "weak bridges should not collapse 4 topics into {top_level_count} clouds"
        );
    }

    #[test]
    fn large_parent_forms_subclouds_when_topics_separate() {
        let mut nodes = Vec::new();
        let mut edges = Vec::new();
        for topic in 0..2 {
            for ordinal in 0..14 {
                let id = format!("s{topic}-{ordinal:02}");
                let mut node = test_node(&id, &format!("Sub {topic} Note {ordinal}"), 0.0, 0.0);
                let mut embedding = vec![0.0_f32; 2];
                embedding[topic] = 1.0;
                embedding.push(ordinal as f32 / 14.0);
                node.embedding = embedding;
                node.centrality = 0.5;
                nodes.push(node);
                if ordinal > 0 {
                    edges.push(test_edge(&format!("s{topic}-{:02}", ordinal - 1), &id, 0.9));
                }
                if ordinal > 1 {
                    edges.push(test_edge(
                        &format!("s{topic}-{:02}", ordinal - 2),
                        &id,
                        0.82,
                    ));
                }
            }
        }
        edges.push(test_edge("s0-00", "s1-00", 0.5));
        edges.push(test_edge("s0-03", "s1-03", 0.48));

        let specs = assign_clouds(&mut nodes, &edges);
        let top = specs.iter().filter(|spec| spec.level == 0).count();
        let children = specs.iter().filter(|spec| spec.level == 1).count();
        assert!(
            top >= 2 || children >= 2,
            "expected either promoted top clouds or subclouds, got top={top} children={children}"
        );
    }

    #[test]
    fn mature_subclouds_promote_to_top_level_when_parent_is_large() {
        let mut nodes = Vec::new();
        let mut edges = Vec::new();
        for topic in 0..3 {
            for ordinal in 0..18 {
                let id = format!("t{topic}-{ordinal:02}");
                let mut node = test_node(&id, &format!("Topic {topic} Note {ordinal}"), 0.0, 0.0);
                node.embedding = vec![topic as f32 * 10.0, ordinal as f32 / 18.0, 1.0];
                node.centrality = if ordinal == 0 { 1.0 } else { 0.4 };
                nodes.push(node);
                if ordinal > 0 {
                    edges.push(test_edge(&format!("t{topic}-{:02}", ordinal - 1), &id, 0.9));
                }
                if ordinal > 1 {
                    edges.push(test_edge(&format!("t{topic}-{:02}", ordinal - 2), &id, 0.8));
                }
            }
        }
        // Weak bridges so the whole set is one component but topics stay separable.
        edges.push(test_edge("t0-00", "t1-00", 0.32));
        edges.push(test_edge("t1-00", "t2-00", 0.32));

        let specs = assign_clouds(&mut nodes, &edges);
        let top_level_count = specs.iter().filter(|spec| spec.level == 0).count();
        assert!(
            top_level_count >= 2,
            "expected promotion into multiple top clouds, got {top_level_count}"
        );
    }

    #[test]
    fn coherent_group_without_separable_children_stays_one_top_cloud() {
        let mut nodes = Vec::new();
        let mut edges = Vec::new();
        for ordinal in 0..24 {
            let id = format!("n{ordinal:02}");
            let mut node = test_node(&id, &format!("Note {ordinal}"), 0.0, 0.0);
            // Near-identical embeddings — one coherent topic.
            node.embedding = vec![1.0, 0.02 * (ordinal as f32), 0.5];
            node.centrality = if ordinal == 0 { 1.0 } else { 0.5 };
            nodes.push(node);
        }
        // Dense clique so Leiden sees one community.
        for left in 0..nodes.len() {
            for right in (left + 1)..nodes.len() {
                edges.push(test_edge(
                    &nodes[left].id,
                    &nodes[right].id,
                    0.9 - ((right - left) as f32) * 0.005,
                ));
            }
        }

        let specs = assign_clouds(&mut nodes, &edges);
        let top_level_count = specs.iter().filter(|spec| spec.level == 0).count();
        assert_eq!(
            top_level_count, 1,
            "coherent dense topic should remain one top cloud"
        );
    }

    #[test]
    fn umap_cloud_separation_repacks_interleaved_clusters() {
        let mut nodes = Vec::new();
        let mut specs = Vec::new();
        let mut edges = Vec::new();
        for cluster in 0..5 {
            let cloud_id = format!("cloud-{}", cluster + 1);
            let mut member_ids = Vec::new();
            for ordinal in 0..12 {
                let id = format!("c{cluster}-{ordinal}");
                let angle = (ordinal as f32 / 12.0) * std::f32::consts::TAU;
                let mut node = test_node(
                    &id,
                    &format!("Cluster {cluster}"),
                    angle.cos() * (80.0 + cluster as f32 * 3.0),
                    angle.sin() * (80.0 + cluster as f32 * 3.0),
                );
                node.cloud_id = Some(cloud_id.clone());
                node.isolated = false;
                member_ids.push(id.clone());
                nodes.push(node);
                if ordinal > 0 {
                    edges.push(test_edge(&format!("c{cluster}-{}", ordinal - 1), &id, 0.86));
                }
            }
            specs.push(CloudSpec {
                id: cloud_id,
                parent_id: None,
                level: 0,
                member_node_ids: member_ids,
                core_node_ids: Vec::new(),
                outlier_node_ids: Vec::new(),
                child_cloud_ids: Vec::new(),
                centroid: [0.0, 0.0],
                radius: 160.0,
                centrality: 1.0 - cluster as f32 * 0.1,
            });
        }

        separate_umap_clouds(&mut nodes, &edges, &mut specs, DEFAULT_LAYOUT_PULL);

        assert_specs_do_not_overlap(&specs, 0, TOP_LEVEL_CLOUD_GAP);
    }

    #[test]
    fn strongly_linked_clouds_are_closer_but_do_not_overlap() {
        let mut specs = vec![
            test_cloud_spec("a", 120.0, 1.0, &["a1", "a2", "a3"]),
            test_cloud_spec("b", 120.0, 0.8, &["b1", "b2", "b3"]),
            test_cloud_spec("c", 120.0, 0.2, &["c1", "c2", "c3"]),
        ];
        let edges = [test_edge("a1", "b1", 0.95)];

        place_top_level_clouds(&mut specs, &edges, DEFAULT_LAYOUT_PULL);

        assert_specs_do_not_overlap(&specs, 0, TOP_LEVEL_CLOUD_GAP);
        let linked_distance = distance(specs[0].centroid, specs[1].centroid);
        let unlinked_distance = distance(specs[0].centroid, specs[2].centroid);
        assert!(linked_distance < unlinked_distance);
    }

    #[test]
    fn child_clouds_inside_parent_do_not_overlap() {
        let mut specs = vec![
            CloudSpec {
                id: "parent".to_string(),
                parent_id: None,
                level: 0,
                member_node_ids: vec![
                    "a1".to_string(),
                    "a2".to_string(),
                    "a3".to_string(),
                    "b1".to_string(),
                    "b2".to_string(),
                    "b3".to_string(),
                ],
                core_node_ids: Vec::new(),
                outlier_node_ids: Vec::new(),
                child_cloud_ids: vec!["child-a".to_string(), "child-b".to_string()],
                centroid: [0.0, 0.0],
                radius: 310.0,
                centrality: 1.0,
            },
            CloudSpec {
                id: "child-a".to_string(),
                parent_id: Some("parent".to_string()),
                level: 1,
                member_node_ids: vec!["a1".to_string(), "a2".to_string(), "a3".to_string()],
                core_node_ids: Vec::new(),
                outlier_node_ids: Vec::new(),
                child_cloud_ids: Vec::new(),
                centroid: [0.0, 0.0],
                radius: 105.0,
                centrality: 0.8,
            },
            CloudSpec {
                id: "child-b".to_string(),
                parent_id: Some("parent".to_string()),
                level: 1,
                member_node_ids: vec!["b1".to_string(), "b2".to_string(), "b3".to_string()],
                core_node_ids: Vec::new(),
                outlier_node_ids: Vec::new(),
                child_cloud_ids: Vec::new(),
                centroid: [0.0, 0.0],
                radius: 105.0,
                centrality: 0.7,
            },
        ];
        let child_indices = [1, 2];

        place_child_centers(0, &child_indices, &mut specs, &[]);

        assert_specs_do_not_overlap(&specs, 1, CHILD_CLOUD_GAP);
        for child in specs.iter().filter(|spec| spec.level == 1) {
            assert!(distance(specs[0].centroid, child.centroid) + child.radius <= specs[0].radius);
        }
    }

    #[test]
    fn far_weak_outlier_does_not_expand_cloud_core() {
        let nodes = [
            test_node("a", "Core Alpha", 0.0, 0.0),
            test_node("b", "Core Beta", 12.0, 0.0),
            test_node("c", "Core Gamma", 0.0, 12.0),
            test_node("d", "Core Delta", 14.0, 10.0),
            test_node("outlier", "Outlier", 1000.0, 1000.0),
        ];
        let edges = [
            test_edge("a", "b", 0.8),
            test_edge("a", "c", 0.8),
            test_edge("b", "d", 0.8),
        ];
        let mut specs = vec![CloudSpec {
            id: "cloud".to_string(),
            parent_id: None,
            level: 0,
            member_node_ids: nodes.iter().map(|node| node.id.clone()).collect(),
            core_node_ids: Vec::new(),
            outlier_node_ids: Vec::new(),
            child_cloud_ids: Vec::new(),
            centroid: [0.0, 0.0],
            radius: 220.0,
            centrality: 1.0,
        }];

        finalize_cloud_cores(&nodes, &edges, &mut specs);

        assert!(specs[0].outlier_node_ids.contains(&"outlier".to_string()));
        assert!(!specs[0].core_node_ids.contains(&"outlier".to_string()));
    }

    #[test]
    fn layout_graph_keeps_dense_edges_under_degree_cap() {
        let nodes = (0..60)
            .map(|index| {
                let mut node = test_node(&format!("n{index:02}"), "Node", 0.0, 0.0);
                node.embedding = vec![index as f32, 1.0];
                node
            })
            .collect::<Vec<_>>();
        let mut links = Vec::new();
        for left in 0..nodes.len() {
            for right in (left + 1)..nodes.len() {
                links.push(test_working_link(
                    &nodes[left].id,
                    &nodes[right].id,
                    0.55 + ((left + right) % 10) as f32 * 0.02,
                ));
            }
        }

        let layout_edges = build_layout_graph(&nodes, &links);

        let max_expected = nodes.len() * (LAYOUT_MAX_DEGREE / 2 + 1);
        assert!(
            layout_edges.len() <= max_expected,
            "{} edges exceeded cap {max_expected}",
            layout_edges.len()
        );
    }

    #[test]
    fn highest_centrality_cloud_starts_at_origin() {
        let mut specs = vec![
            test_cloud_spec("low", 90.0, 0.1, &["low-a", "low-b", "low-c"]),
            test_cloud_spec("high", 90.0, 1.0, &["high-a", "high-b", "high-c"]),
            test_cloud_spec("mid", 90.0, 0.5, &["mid-a", "mid-b", "mid-c"]),
        ];

        place_top_level_clouds(&mut specs, &[], DEFAULT_LAYOUT_PULL);

        let high = specs.iter().find(|spec| spec.id == "high").unwrap();
        assert!(distance(high.centroid, [0.0, 0.0]) < 1.0);
        for spec in specs.iter().filter(|spec| spec.id != "high") {
            assert!(distance(spec.centroid, [0.0, 0.0]) > 1.0);
        }
    }
}
