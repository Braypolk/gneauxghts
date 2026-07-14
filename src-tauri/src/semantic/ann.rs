use super::{
    activity::BackgroundWorkGate,
    chunking::SemanticChunk,
    db::{
        ann_label_for, for_each_chunk_embedding, load_ann_chunks_for_note,
        load_ann_index_signature, load_ann_source_inventory, load_chunk_embedding_dimensions,
        sum_chunk_text_bytes, AnnIndexSignature, AnnSourceInventory,
    },
    debug::SemanticDebugState,
};
use crate::time::current_time_millis;
use hnswlib_rs::{Cosine, Hnsw, HnswConfig, InMemoryVectorStore, SetOutcome};
use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use std::{
    collections::{HashMap, HashSet},
    fs::{self, File},
    io::{BufReader, BufWriter, Write},
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc, Mutex, RwLock,
    },
    time::{Instant, UNIX_EPOCH},
};

const ANN_SCHEMA_VERSION: u32 = 2;
const ANN_DISTANCE_KIND: &str = "cosine";
const ANN_M: usize = 16;
const ANN_EF_CONSTRUCTION: usize = 200;
const ANN_EF_SEARCH: usize = 64;
const ANN_MIN_CAPACITY: usize = 1024;
const ANN_TOMBSTONE_REBUILD_MIN: usize = 64;
const ANN_TOMBSTONE_REBUILD_MAX: usize = 256;
pub(crate) const ANN_MAX_INCREMENTAL_DOCUMENTS: usize = 128;
pub(crate) const ANN_MAX_INCREMENTAL_CHUNKS: usize = 2_048;
static ANN_GENERATION_COUNTER: AtomicU64 = AtomicU64::new(1);

type AnnGraph = Hnsw<u64, Cosine<f32>>;
type AnnVectors = InMemoryVectorStore<f32>;

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AnnStatusSnapshot {
    pub(crate) loaded: bool,
    pub(crate) dirty: bool,
    pub(crate) rebuild_pending: bool,
    pub(crate) last_dumped_at_millis: Option<u64>,
    pub(crate) indexed_chunks: usize,
}

struct AnnStatusState {
    loaded: bool,
    dirty: bool,
    rebuild_pending: bool,
    last_dumped_at_millis: Option<u64>,
    indexed_chunks: usize,
}

impl Default for AnnStatusState {
    fn default() -> Self {
        Self {
            loaded: false,
            dirty: true,
            rebuild_pending: true,
            last_dumped_at_millis: None,
            indexed_chunks: 0,
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AnnManifest {
    schema_version: u32,
    distance_kind: String,
    dimensions: usize,
    m: usize,
    ef_construction: usize,
    ef_search: usize,
    max_nodes: usize,
    chunk_count: usize,
    max_indexed_at_millis: Option<u64>,
    generation: String,
    graph_file: String,
    vectors_file: String,
    source_inventory_file: String,
}

struct AnnSnapshot {
    graph: AnnGraph,
    vectors: AnnVectors,
    manifest: AnnManifest,
}

pub(crate) struct AnnIndexState {
    dimensions: usize,
    cache_dir: PathBuf,
    manifest_path: PathBuf,
    current: RwLock<Option<Arc<AnnSnapshot>>>,
    status: Mutex<AnnStatusState>,
    debug: Arc<SemanticDebugState>,
}

impl AnnIndexState {
    pub(crate) fn new(
        cache_dir: PathBuf,
        dimensions: usize,
        debug: Arc<SemanticDebugState>,
    ) -> Result<Self, String> {
        fs::create_dir_all(&cache_dir).map_err(|err| err.to_string())?;
        // Vault-local, rebuildable HNSW generations under
        // `<vault>/.gneauxghts/cache`. The manifest atomically selects the
        // only complete generation readers may load.
        Ok(Self {
            dimensions,
            cache_dir: cache_dir.clone(),
            manifest_path: cache_dir.join("hnsw.manifest.json"),
            current: RwLock::new(None),
            status: Mutex::new(AnnStatusState::default()),
            debug,
        })
    }

    pub(crate) fn initialize(&self, connection: &Connection) -> Result<(), String> {
        let signature = load_ann_index_signature(connection)?;
        match self.try_load_snapshot(connection, &signature) {
            Ok(true) => Ok(()),
            Ok(false) => {
                self.mark_rebuild_pending("ann_manifest_mismatch");
                Ok(())
            }
            Err(error) => {
                self.mark_rebuild_pending("ann_load_failed");
                self.debug.record_with_metrics(
                    "ann",
                    "load_failed",
                    Some(error),
                    None,
                    |metrics| metrics.ann_load_failure_count += 1,
                );
                Ok(())
            }
        }
    }

    pub(crate) fn status_snapshot(&self) -> AnnStatusSnapshot {
        if let Ok(status) = self.status.lock() {
            return AnnStatusSnapshot {
                loaded: status.loaded,
                dirty: status.dirty,
                rebuild_pending: status.rebuild_pending,
                last_dumped_at_millis: status.last_dumped_at_millis,
                indexed_chunks: status.indexed_chunks,
            };
        }

        AnnStatusSnapshot {
            loaded: false,
            dirty: true,
            rebuild_pending: true,
            last_dumped_at_millis: None,
            indexed_chunks: 0,
        }
    }

    pub(crate) fn search(
        &self,
        query_embedding: &[f32],
        candidate_k: usize,
    ) -> Result<Vec<u64>, String> {
        let snapshot = self
            .current
            .read()
            .map_err(|_| "ANN snapshot lock poisoned".to_string())?
            .clone();
        let Some(snapshot) = snapshot else {
            return Ok(Vec::new());
        };
        if snapshot.graph.live_len() == 0 {
            return Ok(Vec::new());
        }

        let hits = snapshot
            .graph
            .search(&snapshot.vectors, query_embedding, candidate_k.max(1), None)
            .map_err(|err| err.to_string())?;
        Ok(hits.into_iter().map(|hit| hit.key).collect())
    }

    pub(crate) fn apply_note_upsert(
        &self,
        stable_note_label: u64,
        previous_labels: &HashSet<u64>,
        chunks: &[SemanticChunk],
        embeddings: &[Vec<f32>],
    ) -> Result<bool, String> {
        let snapshot = self
            .current
            .read()
            .map_err(|_| "ANN snapshot lock poisoned".to_string())?
            .clone();
        let Some(snapshot) = snapshot else {
            self.mark_rebuild_pending("ann_snapshot_missing_for_upsert");
            return Ok(false);
        };

        let next_labels = chunks
            .iter()
            .map(|chunk| ann_label_for(stable_note_label, chunk.ordinal))
            .collect::<HashSet<_>>();

        for removed_label in previous_labels.difference(&next_labels) {
            snapshot
                .graph
                .delete(removed_label)
                .map_err(|err| err.to_string())?;
        }

        if should_rebuild_for_tombstones(&snapshot.graph) {
            self.mark_rebuild_pending("ann_tombstone_compaction_needed");
            return Ok(false);
        }

        let mut touched = previous_labels.len() != next_labels.len();
        for (chunk, embedding) in chunks.iter().zip(embeddings.iter()) {
            let label = ann_label_for(stable_note_label, chunk.ordinal);
            match snapshot
                .graph
                .set(&snapshot.vectors, label, embedding.as_slice())
            {
                Ok(SetOutcome::Inserted | SetOutcome::Resurrected | SetOutcome::Updated) => {
                    touched = true;
                }
                Err(error) => {
                    self.mark_rebuild_pending("ann_set_failed");
                    self.debug.record_with_metrics(
                        "ann",
                        "incremental_set_failed",
                        Some(error.to_string()),
                        None,
                        |metrics| metrics.ann_update_failure_count += 1,
                    );
                    return Ok(false);
                }
            }
        }

        if touched {
            self.set_status(
                true,
                false,
                false,
                snapshot.graph.live_len(),
                self.status_snapshot().last_dumped_at_millis,
            );
        }

        Ok(true)
    }

    pub(crate) fn apply_note_delete(&self, labels: &HashSet<u64>) -> Result<bool, String> {
        let snapshot = self
            .current
            .read()
            .map_err(|_| "ANN snapshot lock poisoned".to_string())?
            .clone();
        let Some(snapshot) = snapshot else {
            self.mark_rebuild_pending("ann_snapshot_missing_for_delete");
            return Ok(false);
        };

        for label in labels {
            snapshot
                .graph
                .delete(label)
                .map_err(|err| err.to_string())?;
        }

        if should_rebuild_for_tombstones(&snapshot.graph) {
            self.mark_rebuild_pending("ann_tombstone_compaction_needed");
            return Ok(false);
        }

        self.set_status(
            true,
            false,
            false,
            snapshot.graph.live_len(),
            self.status_snapshot().last_dumped_at_millis,
        );
        Ok(true)
    }

    #[cfg(test)]
    pub(crate) fn rebuild_from_connection(&self, connection: &Connection) -> Result<(), String> {
        self.rebuild_from_connection_with_gate(connection, None, false, None)
    }

    pub(crate) fn rebuild_from_connection_with_gate(
        &self,
        connection: &Connection,
        gate: Option<&BackgroundWorkGate>,
        automatic: bool,
        progress: Option<&dyn Fn(usize, usize)>,
    ) -> Result<(), String> {
        let started_at = Instant::now();
        let signature = load_ann_index_signature(connection)?;
        let dimensions = load_chunk_embedding_dimensions(connection)?
            .filter(|dimensions| *dimensions > 0)
            .unwrap_or_else(|| self.dimensions.max(1));
        let manifest = self.manifest_for_signature(&signature, dimensions);
        let (graph, vectors) = build_snapshot_streaming(
            connection,
            &manifest,
            gate,
            automatic,
            progress,
            signature.chunk_count,
        )?;

        let sources = load_ann_source_inventory(connection)?;
        let manifest = self.persist_parts(&graph, &vectors, &manifest, &sources)?;
        let dumped_at =
            file_timestamp_millis(&self.manifest_path).or_else(|_| current_time_millis())?;
        let snapshot = Arc::new(AnnSnapshot {
            graph,
            vectors,
            manifest,
        });

        {
            let mut current = self
                .current
                .write()
                .map_err(|_| "ANN snapshot lock poisoned".to_string())?;
            *current = Some(snapshot);
        }
        self.set_status(true, false, false, signature.chunk_count, Some(dumped_at));

        let text_bytes = sum_chunk_text_bytes(connection).unwrap_or(0);
        let chunk_count = signature.chunk_count as u64;
        let dimensions = dimensions as u64;
        let elapsed = started_at.elapsed().as_millis().min(u128::from(u64::MAX)) as u64;
        self.debug.record_timing(
            "ann",
            "rebuild_completed",
            Some(format!(
                "chunks={chunk_count} dim={dimensions} textBytes={text_bytes}"
            )),
            elapsed,
            |metrics| {
                metrics.ann_rebuild_count += 1;
                metrics.ann_rebuild_chunk_count = chunk_count;
                metrics.ann_rebuild_text_bytes = text_bytes;
                metrics.ann_rebuild_duration_total_millis += elapsed;
                metrics.ann_rebuild_duration_max_millis =
                    metrics.ann_rebuild_duration_max_millis.max(elapsed);
            },
        );
        self.debug.sample_rss("ann", "rebuild_completed");
        Ok(())
    }

    pub(crate) fn persist_current(&self, connection: &Connection) -> Result<(), String> {
        let snapshot = self
            .current
            .read()
            .map_err(|_| "ANN snapshot lock poisoned".to_string())?
            .clone();
        let Some(snapshot) = snapshot else {
            return Ok(());
        };

        let signature = load_ann_index_signature(connection)?;
        let mut manifest = snapshot.manifest.clone();
        manifest.chunk_count = signature.chunk_count;
        manifest.max_indexed_at_millis = signature.max_indexed_at_millis;
        let sources = load_ann_source_inventory(connection)?;
        let _published_manifest =
            self.persist_parts(&snapshot.graph, &snapshot.vectors, &manifest, &sources)?;
        let dumped_at =
            file_timestamp_millis(&self.manifest_path).or_else(|_| current_time_millis())?;
        self.set_status(true, false, false, signature.chunk_count, Some(dumped_at));
        Ok(())
    }

    pub(crate) fn needs_rebuild(&self) -> bool {
        self.status
            .lock()
            .map(|status| status.dirty || status.rebuild_pending)
            .unwrap_or(true)
    }

    fn manifest_for_signature(
        &self,
        signature: &AnnIndexSignature,
        dimensions: usize,
    ) -> AnnManifest {
        AnnManifest {
            schema_version: ANN_SCHEMA_VERSION,
            distance_kind: ANN_DISTANCE_KIND.to_string(),
            dimensions,
            m: ANN_M,
            ef_construction: ANN_EF_CONSTRUCTION,
            ef_search: ANN_EF_SEARCH,
            max_nodes: desired_capacity(signature.chunk_count),
            chunk_count: signature.chunk_count,
            max_indexed_at_millis: signature.max_indexed_at_millis,
            generation: String::new(),
            graph_file: String::new(),
            vectors_file: String::new(),
            source_inventory_file: String::new(),
        }
    }

    fn try_load_snapshot(
        &self,
        connection: &Connection,
        signature: &AnnIndexSignature,
    ) -> Result<bool, String> {
        if !self.manifest_path.is_file() {
            return Ok(false);
        }
        let bytes = fs::read(&self.manifest_path).map_err(|err| err.to_string())?;
        let mut manifest =
            serde_json::from_slice::<AnnManifest>(&bytes).map_err(|err| err.to_string())?;
        if !self.manifest_compatible(&manifest) {
            return Ok(false);
        }
        let graph_path = self.generation_path(&manifest.graph_file)?;
        let vectors_path = self.generation_path(&manifest.vectors_file)?;
        let inventory_path = self.generation_path(&manifest.source_inventory_file)?;
        let stored_sources = serde_json::from_reader::<_, Vec<AnnSourceInventory>>(BufReader::new(
            File::open(inventory_path).map_err(|err| err.to_string())?,
        ))
        .map_err(|err| err.to_string())?;
        let current_sources = load_ann_source_inventory(connection)?;
        let (graph, vectors) =
            load_graph_and_vectors(&graph_path, &vectors_path, manifest.ef_search)?;

        let exact_signature = manifest.chunk_count == signature.chunk_count
            && manifest.max_indexed_at_millis == signature.max_indexed_at_millis
            && stored_sources == current_sources;
        if exact_signature {
            self.install_loaded_snapshot(graph, vectors, manifest, false, signature.chunk_count)?;
            return Ok(true);
        }

        let delta = source_delta(&stored_sources, &current_sources);
        if delta.document_count <= ANN_MAX_INCREMENTAL_DOCUMENTS
            && delta.chunk_count <= ANN_MAX_INCREMENTAL_CHUNKS
            && signature.chunk_count <= manifest.max_nodes
        {
            reconcile_snapshot_delta(connection, &graph, &vectors, &delta)?;
            if !should_rebuild_for_tombstones(&graph) {
                manifest.chunk_count = signature.chunk_count;
                manifest.max_indexed_at_millis = signature.max_indexed_at_millis;
                let published =
                    self.persist_parts(&graph, &vectors, &manifest, &current_sources)?;
                self.install_loaded_snapshot(
                    graph,
                    vectors,
                    published,
                    false,
                    signature.chunk_count,
                )?;
                self.debug.record_with_metrics(
                    "ann",
                    "incremental_recovery_completed",
                    Some(format!(
                        "documents={} chunks={}",
                        delta.document_count, delta.chunk_count
                    )),
                    None,
                    |_| {},
                );
                return Ok(true);
            }
        }

        // The structurally valid generation remains queryable. Candidate
        // labels are hydrated from current SQLite rows, so stale/deleted
        // entries cannot surface while the idle rebuild is pending.
        let live_len = graph.live_len();
        self.install_loaded_snapshot(graph, vectors, manifest, true, live_len)?;
        Ok(true)
    }

    fn manifest_compatible(&self, manifest: &AnnManifest) -> bool {
        manifest.schema_version == ANN_SCHEMA_VERSION
            && manifest.distance_kind == ANN_DISTANCE_KIND
            && manifest.dimensions == self.dimensions
            && manifest.m == ANN_M
            && manifest.ef_construction == ANN_EF_CONSTRUCTION
            && manifest.ef_search == ANN_EF_SEARCH
            && manifest.max_nodes >= manifest.chunk_count
    }

    fn generation_path(&self, file_name: &str) -> Result<PathBuf, String> {
        let path = Path::new(file_name);
        if file_name.is_empty() || path.components().count() != 1 {
            return Err("Invalid ANN generation file name".to_string());
        }
        Ok(self.cache_dir.join(path))
    }

    fn install_loaded_snapshot(
        &self,
        graph: AnnGraph,
        vectors: AnnVectors,
        manifest: AnnManifest,
        stale: bool,
        indexed_chunks: usize,
    ) -> Result<(), String> {
        let dumped_at = file_timestamp_millis(&self.manifest_path).ok();
        let live_len = graph.live_len();
        let mut current = self
            .current
            .write()
            .map_err(|_| "ANN snapshot lock poisoned".to_string())?;
        *current = Some(Arc::new(AnnSnapshot {
            graph,
            vectors,
            manifest,
        }));
        drop(current);
        self.set_status(true, stale, stale, indexed_chunks.min(live_len), dumped_at);
        self.debug
            .record_with_metrics("ann", "load_completed", None, None, |metrics| {
                metrics.ann_load_success_count += 1;
            });
        Ok(())
    }

    fn mark_rebuild_pending(&self, reason: &str) {
        if let Ok(mut status) = self.status.lock() {
            status.dirty = true;
            status.rebuild_pending = true;
        }
        self.debug.record_with_metrics(
            "ann",
            "rebuild_pending",
            Some(reason.to_string()),
            None,
            |metrics| metrics.ann_rebuild_pending_count += 1,
        );
    }

    pub(crate) fn request_rebuild(&self, reason: &str) {
        self.mark_rebuild_pending(reason);
    }

    fn set_status(
        &self,
        loaded: bool,
        dirty: bool,
        rebuild_pending: bool,
        indexed_chunks: usize,
        last_dumped_at_millis: Option<u64>,
    ) {
        if let Ok(mut status) = self.status.lock() {
            status.loaded = loaded;
            status.dirty = dirty;
            status.rebuild_pending = rebuild_pending;
            status.indexed_chunks = indexed_chunks;
            status.last_dumped_at_millis = last_dumped_at_millis;
        }
    }

    fn persist_parts(
        &self,
        graph: &AnnGraph,
        vectors: &AnnVectors,
        manifest: &AnnManifest,
        sources: &[AnnSourceInventory],
    ) -> Result<AnnManifest, String> {
        let generation = format!(
            "{}-{}",
            current_time_millis()?,
            ANN_GENERATION_COUNTER.fetch_add(1, Ordering::AcqRel)
        );
        let graph_file = format!("hnsw.{generation}.snapshot");
        let vectors_file = format!("hnsw.{generation}.vectors");
        let source_inventory_file = format!("hnsw.{generation}.sources.json");
        let graph_path = self.cache_dir.join(&graph_file);
        let vectors_path = self.cache_dir.join(&vectors_file);
        let sources_path = self.cache_dir.join(&source_inventory_file);

        write_atomic(&graph_path, |writer| {
            graph.save_to(writer).map_err(|err| err.to_string())
        })?;
        write_atomic(&vectors_path, |writer| {
            vectors
                .save_to(writer, graph.len())
                .map_err(|err| err.to_string())
        })?;
        write_atomic(&sources_path, |writer| {
            serde_json::to_writer_pretty(writer, sources).map_err(|err| err.to_string())
        })?;
        let mut published = manifest.clone();
        published.schema_version = ANN_SCHEMA_VERSION;
        published.generation = generation;
        published.graph_file = graph_file;
        published.vectors_file = vectors_file;
        published.source_inventory_file = source_inventory_file;
        write_atomic(&self.manifest_path, |writer| {
            serde_json::to_writer_pretty(writer, &published).map_err(|err| err.to_string())
        })?;
        self.remove_unreferenced_generations(&published);
        Ok(published)
    }

    fn remove_unreferenced_generations(&self, manifest: &AnnManifest) {
        let keep = [
            manifest.graph_file.as_str(),
            manifest.vectors_file.as_str(),
            manifest.source_inventory_file.as_str(),
            "hnsw.manifest.json",
        ]
        .into_iter()
        .collect::<HashSet<_>>();
        let Ok(entries) = fs::read_dir(&self.cache_dir) else {
            return;
        };
        for entry in entries.flatten() {
            let name = entry.file_name();
            let Some(name) = name.to_str() else { continue };
            if name.starts_with("hnsw.") && !keep.contains(name) {
                let _ = fs::remove_file(entry.path());
            }
        }
    }
}

struct SourceDelta {
    changes: Vec<(Option<AnnSourceInventory>, Option<AnnSourceInventory>)>,
    document_count: usize,
    chunk_count: usize,
}

fn source_delta(stored: &[AnnSourceInventory], current: &[AnnSourceInventory]) -> SourceDelta {
    let stored_by_path = stored
        .iter()
        .cloned()
        .map(|source| (source.path.clone(), source))
        .collect::<HashMap<_, _>>();
    let current_by_path = current
        .iter()
        .cloned()
        .map(|source| (source.path.clone(), source))
        .collect::<HashMap<_, _>>();
    let mut paths = stored_by_path
        .keys()
        .chain(current_by_path.keys())
        .cloned()
        .collect::<HashSet<_>>()
        .into_iter()
        .collect::<Vec<_>>();
    paths.sort();
    let mut changes = Vec::new();
    let mut chunk_count = 0usize;
    for path in paths {
        let before = stored_by_path.get(&path).cloned();
        let after = current_by_path.get(&path).cloned();
        if before == after {
            continue;
        }
        chunk_count = chunk_count.saturating_add(
            before
                .as_ref()
                .map(|source| source.chunk_count)
                .unwrap_or(0)
                .max(after.as_ref().map(|source| source.chunk_count).unwrap_or(0)),
        );
        changes.push((before, after));
    }
    SourceDelta {
        document_count: changes.len(),
        chunk_count,
        changes,
    }
}

fn reconcile_snapshot_delta(
    connection: &Connection,
    graph: &AnnGraph,
    vectors: &AnnVectors,
    delta: &SourceDelta,
) -> Result<(), String> {
    for (before, after) in &delta.changes {
        let old_count = before
            .as_ref()
            .map(|source| source.chunk_count)
            .unwrap_or(0);
        let new_count = after.as_ref().map(|source| source.chunk_count).unwrap_or(0);
        let source = after.as_ref().or(before.as_ref()).expect("delta source");
        let path = source.path.as_str();
        let stable_note_label = source.stable_ann_label;
        if after.is_none() {
            for ordinal in 0..old_count {
                graph
                    .delete(&ann_label_for(stable_note_label, ordinal))
                    .map_err(|err| err.to_string())?;
            }
            continue;
        }
        for ordinal in new_count..old_count {
            graph
                .delete(&ann_label_for(stable_note_label, ordinal))
                .map_err(|err| err.to_string())?;
        }
        for chunk in load_ann_chunks_for_note(connection, path)? {
            graph
                .set(
                    vectors,
                    ann_label_for(stable_note_label, chunk.ordinal),
                    chunk.embedding.as_slice(),
                )
                .map_err(|err| err.to_string())?;
        }
    }
    Ok(())
}

fn load_graph_and_vectors(
    graph_path: &Path,
    vectors_path: &Path,
    ef_search: usize,
) -> Result<(AnnGraph, AnnVectors), String> {
    let graph_file = File::open(graph_path).map_err(|err| err.to_string())?;
    let mut graph_reader = BufReader::new(graph_file);
    let graph = Hnsw::load_from(Cosine::new(), &mut graph_reader).map_err(|err| err.to_string())?;
    graph.set_ef_search(ef_search);
    let vectors_file = File::open(vectors_path).map_err(|err| err.to_string())?;
    let mut vectors_reader = BufReader::new(vectors_file);
    let (vectors, vector_count) = InMemoryVectorStore::<f32>::load_from(&mut vectors_reader)
        .map_err(|err| err.to_string())?;
    if vector_count != graph.len() {
        return Err(format!(
            "ANN graph/vector count mismatch: graph={} vectors={vector_count}",
            graph.len()
        ));
    }
    Ok((graph, vectors))
}

/// Build the HNSW graph and vector store by streaming chunk embeddings straight
/// from SQLite. Unlike collecting a `Vec<StoredChunkRow>` first, this keeps only
/// the graph plus one embedding row resident at a time, and never loads chunk
/// text into memory at all.
fn build_snapshot_streaming(
    connection: &Connection,
    manifest: &AnnManifest,
    gate: Option<&BackgroundWorkGate>,
    automatic: bool,
    progress: Option<&dyn Fn(usize, usize)>,
    total: usize,
) -> Result<(AnnGraph, AnnVectors), String> {
    let graph = Hnsw::new(
        Cosine::new(),
        HnswConfig::new(manifest.dimensions, manifest.max_nodes)
            .m(manifest.m)
            .ef_construction(manifest.ef_construction)
            .ef_search(manifest.ef_search),
    );
    let vectors = InMemoryVectorStore::<f32>::new(manifest.dimensions, manifest.max_nodes);
    let mut seen_labels = HashSet::new();
    let mut processed = 0usize;

    for_each_chunk_embedding(connection, |row| {
        if processed % 64 == 0 {
            if let Some(gate) = gate {
                if automatic {
                    gate.wait_for_automatic_idle();
                } else {
                    gate.checkpoint_manual_pause();
                }
            }
        }
        processed = processed.saturating_add(1);
        if processed % 64 == 0 {
            if let Some(progress) = progress {
                progress(processed, total);
            }
        }
        if row.embedding.len() != manifest.dimensions {
            return Err(format!(
                "ANN embedding dimension mismatch for {}:{} expected={} actual={}",
                row.note_path,
                row.section_label,
                manifest.dimensions,
                row.embedding.len()
            ));
        }
        if !seen_labels.insert(row.ann_label) {
            return Err(format!("ANN label collision for {}", row.ann_label));
        }
        graph
            .set(&vectors, row.ann_label, row.embedding.as_slice())
            .map(|_| ())
            .map_err(|err| err.to_string())
    })?;

    if let Some(progress) = progress {
        progress(processed, total);
    }

    Ok((graph, vectors))
}

fn desired_capacity(chunk_count: usize) -> usize {
    let baseline = chunk_count.saturating_mul(2).max(ANN_MIN_CAPACITY);
    baseline.next_power_of_two()
}

fn should_rebuild_for_tombstones(graph: &AnnGraph) -> bool {
    let deleted = graph.deleted_len();
    if deleted == 0 {
        return false;
    }

    let live = graph.live_len().max(1);
    deleted >= ANN_TOMBSTONE_REBUILD_MAX
        || (deleted >= ANN_TOMBSTONE_REBUILD_MIN && deleted.saturating_mul(4) >= live)
}

fn write_atomic<F>(path: &Path, write: F) -> Result<(), String>
where
    F: FnOnce(&mut BufWriter<File>) -> Result<(), String>,
{
    let tmp_path = path.with_extension("tmp");
    let file = File::create(&tmp_path).map_err(|err| err.to_string())?;
    let mut writer = BufWriter::new(file);
    write(&mut writer)?;
    writer.flush().map_err(|err| err.to_string())?;
    writer.get_ref().sync_all().map_err(|err| err.to_string())?;
    drop(writer);
    fs::rename(&tmp_path, path).map_err(|err| err.to_string())?;
    if let Some(parent) = path.parent() {
        File::open(parent)
            .and_then(|directory| directory.sync_all())
            .map_err(|err| err.to_string())?;
    }
    Ok(())
}

fn file_timestamp_millis(path: &Path) -> Result<u64, String> {
    let modified = fs::metadata(path)
        .map_err(|err| err.to_string())?
        .modified()
        .map_err(|err| err.to_string())?
        .duration_since(UNIX_EPOCH)
        .map_err(|err| err.to_string())?
        .as_millis();
    Ok(modified.min(u128::from(u64::MAX)) as u64)
}

#[cfg(test)]
mod tests {
    use super::{AnnIndexState, ANN_TOMBSTONE_REBUILD_MIN};
    use crate::semantic::{
        chunking::SemanticChunk,
        db::{
            ensure_schema, load_note_chunk_labels, open_database, upsert_note_chunks,
            SemanticNoteMetadata,
        },
        debug::SemanticDebugState,
    };
    use blake3::hash;
    use std::{
        fs,
        path::{Path, PathBuf},
        sync::Arc,
        time::{SystemTime, UNIX_EPOCH},
    };

    #[test]
    fn defaults_to_warming_state_before_initialize_runs() {
        // Startup-latency change: ANN snapshot load now happens on a
        // background thread, so a freshly constructed `AnnIndexState`
        // must report a "warming up" status (`loaded=false`,
        // `rebuild_pending=true`) and `search` must return an empty
        // result set instead of panicking. Search and related callers
        // already key off these flags to fall through to a "still
        // warming" UI message.
        let temp = TestDir::new("ann-warming");
        let semantic_dir = temp.path().join("semantic");
        let ann = AnnIndexState::new(semantic_dir, 3, Arc::new(SemanticDebugState::new()))
            .expect("create ann");

        let status = ann.status_snapshot();
        assert!(!status.loaded, "warming state must report loaded=false");
        assert!(
            status.rebuild_pending,
            "warming state must request a rebuild so the worker repopulates",
        );
        assert_eq!(status.indexed_chunks, 0);

        let hits = ann
            .search(&[1.0, 0.0, 0.0], 8)
            .expect("search must succeed even when ANN is still warming");
        assert!(hits.is_empty(), "search returns empty until snapshot loads");
    }

    #[test]
    fn initialize_loads_matching_persisted_ann_snapshot() {
        let temp = TestDir::new("ann-load");
        let semantic_dir = temp.path().join("semantic");
        let db_path = semantic_dir.join("semantic.sqlite3");
        let mut connection = open_database(&db_path).expect("open database");
        ensure_schema(&connection).expect("ensure schema");
        seed_chunks(&mut connection, "notes/reload.md", 6, 3).expect("seed chunks");

        let debug = Arc::new(SemanticDebugState::new());
        let ann = AnnIndexState::new(semantic_dir.clone(), 3, debug.clone()).expect("create ann");
        ann.rebuild_from_connection(&connection)
            .expect("rebuild ann from db");

        let reloaded =
            AnnIndexState::new(semantic_dir, 3, debug).expect("create reloaded ann state");
        reloaded.initialize(&connection).expect("initialize ann");
        let status = reloaded.status_snapshot();
        assert!(status.loaded);
        assert_eq!(status.indexed_chunks, 6);
        assert!(!reloaded
            .search(&[1.0, 0.0, 0.0], 8)
            .expect("ann search")
            .is_empty());
    }

    #[test]
    fn initialize_recovers_small_sqlite_delta_without_full_rebuild() {
        let temp = TestDir::new("ann-delta-recovery");
        let cache_dir = temp.path().join("cache");
        let db_path = temp.path().join("semantic.sqlite3");
        let mut connection = open_database(&db_path).expect("open database");
        ensure_schema(&connection).expect("ensure schema");
        seed_chunks(&mut connection, "notes/first.md", 3, 3).expect("seed first");
        let initial = AnnIndexState::new(cache_dir.clone(), 3, Arc::new(SemanticDebugState::new()))
            .expect("create initial ann");
        initial
            .rebuild_from_connection(&connection)
            .expect("publish initial");

        seed_chunks(&mut connection, "notes/second.md", 4, 3).expect("seed delta");
        let debug = Arc::new(SemanticDebugState::new());
        let recovered = AnnIndexState::new(cache_dir, 3, debug.clone()).expect("create recovered");
        recovered.initialize(&connection).expect("recover delta");
        let status = recovered.status_snapshot();
        assert!(status.loaded);
        assert!(!status.dirty);
        assert!(!status.rebuild_pending);
        assert_eq!(status.indexed_chunks, 7);
        assert_eq!(
            debug
                .snapshot()
                .expect("debug snapshot")
                .metrics
                .ann_rebuild_count,
            0
        );
    }

    #[test]
    fn incomplete_unreferenced_generation_cannot_replace_last_good_snapshot() {
        let temp = TestDir::new("ann-interrupted-generation");
        let cache_dir = temp.path().join("cache");
        let db_path = temp.path().join("semantic.sqlite3");
        let mut connection = open_database(&db_path).expect("open database");
        ensure_schema(&connection).expect("ensure schema");
        seed_chunks(&mut connection, "notes/good.md", 3, 3).expect("seed chunks");
        let initial = AnnIndexState::new(cache_dir.clone(), 3, Arc::new(SemanticDebugState::new()))
            .expect("create initial");
        initial
            .rebuild_from_connection(&connection)
            .expect("publish good generation");
        fs::write(cache_dir.join("hnsw.interrupted.snapshot"), b"partial")
            .expect("write partial generation");

        let recovered = AnnIndexState::new(cache_dir, 3, Arc::new(SemanticDebugState::new()))
            .expect("create recovered");
        recovered
            .initialize(&connection)
            .expect("load referenced generation");
        assert!(recovered.status_snapshot().loaded);
        assert_eq!(recovered.status_snapshot().indexed_chunks, 3);
    }

    #[test]
    fn snapshot_persists_as_manifest_referenced_generation() {
        let temp = TestDir::new("ann-snapshot-path");
        let cache_dir = temp.path().join("cache");
        let db_path = temp.path().join("semantic.sqlite3");
        let mut connection = open_database(&db_path).expect("open database");
        ensure_schema(&connection).expect("ensure schema");
        seed_chunks(&mut connection, "notes/snap.md", 4, 3).expect("seed chunks");

        let ann = AnnIndexState::new(cache_dir.clone(), 3, Arc::new(SemanticDebugState::new()))
            .expect("create ann");
        ann.rebuild_from_connection(&connection)
            .expect("rebuild ann from db");

        let manifest_path = cache_dir.join("hnsw.manifest.json");
        let manifest: super::AnnManifest =
            serde_json::from_slice(&fs::read(&manifest_path).expect("read manifest"))
                .expect("parse v2 manifest");
        assert_eq!(manifest.schema_version, 2);
        assert!(cache_dir.join(manifest.graph_file).is_file());
        assert!(cache_dir.join(manifest.vectors_file).is_file());
        assert!(cache_dir.join(manifest.source_inventory_file).is_file());
    }

    #[test]
    fn incremental_deletes_request_rebuild_once_tombstones_accumulate() {
        let temp = TestDir::new("ann-tombstones");
        let semantic_dir = temp.path().join("semantic");
        let db_path = semantic_dir.join("semantic.sqlite3");
        let mut connection = open_database(&db_path).expect("open database");
        ensure_schema(&connection).expect("ensure schema");
        seed_chunks(
            &mut connection,
            "notes/churn.md",
            ANN_TOMBSTONE_REBUILD_MIN + 4,
            3,
        )
        .expect("seed chunks");

        let ann = AnnIndexState::new(semantic_dir, 3, Arc::new(SemanticDebugState::new()))
            .expect("create ann");
        ann.rebuild_from_connection(&connection)
            .expect("rebuild ann from db");

        let labels = load_note_chunk_labels(&connection, "notes/churn.md").expect("load labels");
        let deleted_labels = labels.into_iter().take(ANN_TOMBSTONE_REBUILD_MIN).collect();

        let should_continue_incrementally = ann
            .apply_note_delete(&deleted_labels)
            .expect("apply note delete");
        assert!(!should_continue_incrementally);

        let status = ann.status_snapshot();
        assert!(status.rebuild_pending);
        assert!(ann.needs_rebuild());
    }

    fn seed_chunks(
        connection: &mut rusqlite::Connection,
        note_path: &str,
        chunk_count: usize,
        dimensions: usize,
    ) -> Result<(), String> {
        let chunks = (0..chunk_count)
            .map(|ordinal| SemanticChunk {
                ordinal,
                section_label: format!("Section {}", ordinal + 1),
                text: format!("chunk {ordinal}"),
                text_hash: hash(format!("chunk {ordinal}").as_bytes())
                    .to_hex()
                    .to_string(),
                start_line: ordinal + 1,
                end_line: ordinal + 1,
                block_anchor: None,
            })
            .collect::<Vec<_>>();
        let embeddings = (0..chunk_count)
            .map(|ordinal| {
                let mut vector = vec![0.0; dimensions];
                vector[ordinal % dimensions] = ordinal as f32 + 1.0;
                vector
            })
            .collect::<Vec<_>>();
        upsert_note_chunks(
            connection,
            note_path,
            "Seed Note",
            1,
            "seed-hash",
            "2026-01-01T00:00:00Z",
            "2026-01-01T00:00:00Z",
            crate::note::DocumentKind::Note,
            &SemanticNoteMetadata::default(),
            &chunks,
            &embeddings,
        )
    }

    struct TestDir {
        path: PathBuf,
    }

    impl TestDir {
        fn new(label: &str) -> Self {
            let unique = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("system time")
                .as_nanos();
            let path = std::env::temp_dir().join(format!("gneauxghts-{label}-{unique}"));
            fs::create_dir_all(&path).expect("create temp dir");
            Self { path }
        }

        fn path(&self) -> &Path {
            &self.path
        }
    }

    impl Drop for TestDir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.path);
        }
    }
}
