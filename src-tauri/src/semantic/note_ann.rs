use super::{
    activity::BackgroundWorkGate,
    db::{
        for_each_note_embedding, load_note_ann_embedding_by_label, load_note_ann_index_signature,
        load_note_ann_source_inventory, load_note_embedding_for_path, NoteAnnIndexSignature,
        NoteAnnSourceInventory,
    },
    similarity::cosine_similarity,
};
use crate::time::current_time_millis;
use hnswlib_rs::{Cosine, Hnsw, HnswConfig, InMemoryVectorStore};
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
};

const NOTE_ANN_SCHEMA_VERSION: u32 = 1;
const NOTE_VECTOR_VERSION: &str = "mean-pool-l2-v1";
const NOTE_ANN_DISTANCE_KIND: &str = "cosine";
const NOTE_ANN_M: usize = 16;
const NOTE_ANN_EF_CONSTRUCTION: usize = 200;
const NOTE_ANN_EF_SEARCH: usize = 96;
const NOTE_ANN_MIN_CAPACITY: usize = 1024;
const NOTE_ANN_MAX_INCREMENTAL_NOTES: usize = 128;
const NOTE_ANN_TOMBSTONE_REBUILD_MIN: usize = 64;
const NOTE_ANN_TOMBSTONE_REBUILD_MAX: usize = 256;
static NOTE_ANN_GENERATION_COUNTER: AtomicU64 = AtomicU64::new(1);

type NoteAnnGraph = Hnsw<u64, Cosine<f32>>;
type NoteAnnVectors = InMemoryVectorStore<f32>;

#[derive(Clone, Debug)]
#[allow(dead_code)]
pub(crate) struct NoteAnnMatch {
    pub(crate) stable_ann_label: u64,
    pub(crate) note_path: String,
    pub(crate) score: f32,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct NoteAnnStatusSnapshot {
    pub(crate) loaded: bool,
    pub(crate) dirty: bool,
    pub(crate) rebuild_pending: bool,
    pub(crate) indexed_notes: usize,
    pub(crate) generation_id: Option<String>,
}

struct NoteAnnStatusState {
    loaded: bool,
    dirty: bool,
    rebuild_pending: bool,
    indexed_notes: usize,
    generation_id: Option<String>,
}

impl Default for NoteAnnStatusState {
    fn default() -> Self {
        Self {
            loaded: false,
            dirty: true,
            rebuild_pending: true,
            indexed_notes: 0,
            generation_id: None,
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct NoteAnnManifest {
    schema_version: u32,
    vector_version: String,
    model_signature: String,
    distance_kind: String,
    dimensions: usize,
    m: usize,
    ef_construction: usize,
    ef_search: usize,
    max_nodes: usize,
    note_count: usize,
    max_indexed_at_millis: Option<u64>,
    generation: String,
    graph_file: String,
    vectors_file: String,
    source_inventory_file: String,
}

#[derive(Default)]
struct NotePathInventory {
    by_label: HashMap<u64, String>,
    by_path: HashMap<String, u64>,
}

impl NotePathInventory {
    fn from_sources(sources: &[NoteAnnSourceInventory]) -> Self {
        let mut inventory = Self::default();
        for source in sources {
            inventory
                .by_label
                .insert(source.stable_ann_label, source.path.clone());
            inventory
                .by_path
                .insert(source.path.clone(), source.stable_ann_label);
        }
        inventory
    }
}

struct NoteAnnSnapshot {
    graph: NoteAnnGraph,
    vectors: NoteAnnVectors,
    manifest: NoteAnnManifest,
    paths: RwLock<NotePathInventory>,
}

pub(crate) struct NoteAnnIndexState {
    dimensions: usize,
    model_signature: String,
    cache_dir: PathBuf,
    manifest_path: PathBuf,
    current: RwLock<Option<Arc<NoteAnnSnapshot>>>,
    status: Mutex<NoteAnnStatusState>,
}

impl NoteAnnIndexState {
    pub(crate) fn new(
        cache_dir: PathBuf,
        dimensions: usize,
        model_signature: String,
    ) -> Result<Self, String> {
        fs::create_dir_all(&cache_dir).map_err(|err| err.to_string())?;
        Ok(Self {
            dimensions,
            model_signature,
            manifest_path: cache_dir.join("note-hnsw.manifest.json"),
            cache_dir,
            current: RwLock::new(None),
            status: Mutex::new(NoteAnnStatusState::default()),
        })
    }

    pub(crate) fn initialize(&self, connection: &Connection) -> Result<(), String> {
        let signature = load_note_ann_index_signature(connection)?;
        if !signature.identities_valid {
            self.request_rebuild();
            return Ok(());
        }
        if !self.try_load_snapshot(connection, &signature)? {
            self.request_rebuild();
        }
        Ok(())
    }

    pub(crate) fn status_snapshot(&self) -> NoteAnnStatusSnapshot {
        self.status
            .lock()
            .map(|status| NoteAnnStatusSnapshot {
                loaded: status.loaded,
                dirty: status.dirty,
                rebuild_pending: status.rebuild_pending,
                indexed_notes: status.indexed_notes,
                generation_id: status.generation_id.clone(),
            })
            .unwrap_or(NoteAnnStatusSnapshot {
                loaded: false,
                dirty: true,
                rebuild_pending: true,
                indexed_notes: 0,
                generation_id: None,
            })
    }

    pub(crate) fn needs_rebuild(&self) -> bool {
        self.status
            .lock()
            .map(|status| status.dirty || status.rebuild_pending)
            .unwrap_or(true)
    }

    pub(crate) fn generation_id(&self) -> Option<String> {
        self.status_snapshot().generation_id
    }

    pub(crate) fn model_signature(&self) -> &str {
        &self.model_signature
    }

    pub(crate) fn request_rebuild(&self) {
        if let Ok(mut status) = self.status.lock() {
            status.dirty = true;
            status.rebuild_pending = true;
        }
    }

    pub(crate) fn search(
        &self,
        connection: &Connection,
        query_embedding: &[f32],
        candidate_k: usize,
        limit: usize,
        exclude_path: Option<&str>,
    ) -> Result<Vec<NoteAnnMatch>, String> {
        if query_embedding.len() != self.dimensions || limit == 0 {
            return Ok(Vec::new());
        }
        let snapshot = self.snapshot()?;
        let Some(snapshot) = snapshot else {
            return Ok(Vec::new());
        };
        if snapshot.graph.live_len() == 0 {
            return Ok(Vec::new());
        }
        let hits = snapshot
            .graph
            .search(
                &snapshot.vectors,
                query_embedding,
                candidate_k.max(limit).max(1),
                None,
            )
            .map_err(|err| err.to_string())?;
        let paths = snapshot
            .paths
            .read()
            .map_err(|_| "Note ANN path inventory lock poisoned".to_string())?;
        let mut matches = Vec::new();
        for hit in hits {
            let Some(mapped_path) = paths.by_label.get(&hit.key) else {
                continue;
            };
            if exclude_path == Some(mapped_path.as_str()) {
                continue;
            }
            let Some(row) = load_note_ann_embedding_by_label(connection, hit.key)? else {
                continue;
            };
            if row.note_path != *mapped_path || row.embedding.len() != self.dimensions {
                continue;
            }
            matches.push(NoteAnnMatch {
                stable_ann_label: hit.key,
                note_path: row.note_path,
                score: cosine_similarity(query_embedding, &row.embedding),
            });
        }
        matches.sort_by(|left, right| {
            right
                .score
                .total_cmp(&left.score)
                .then_with(|| left.note_path.cmp(&right.note_path))
        });
        matches.truncate(limit);
        Ok(matches)
    }

    pub(crate) fn neighbors_for_note(
        &self,
        connection: &Connection,
        note_path: &str,
        candidate_k: usize,
        limit: usize,
    ) -> Result<Vec<NoteAnnMatch>, String> {
        let Some(note) = load_note_embedding_for_path(connection, note_path)? else {
            return Ok(Vec::new());
        };
        self.search(
            connection,
            &note.embedding,
            candidate_k.saturating_add(1),
            limit,
            Some(note_path),
        )
    }

    pub(crate) fn apply_note_upsert(
        &self,
        connection: &Connection,
        note_path: &str,
    ) -> Result<bool, String> {
        let Some(note) = load_note_embedding_for_path(connection, note_path)? else {
            self.request_rebuild();
            return Ok(false);
        };
        if note.stable_ann_label == 0
            || note.semantic_input_hash.is_empty()
            || note.embedding.len() != self.dimensions
        {
            self.request_rebuild();
            return Ok(false);
        }
        let Some(snapshot) = self.snapshot()? else {
            self.request_rebuild();
            return Ok(false);
        };
        if snapshot.graph.live_len() >= snapshot.manifest.max_nodes
            && !snapshot
                .paths
                .read()
                .map_err(|_| "Note ANN path inventory lock poisoned".to_string())?
                .by_label
                .contains_key(&note.stable_ann_label)
        {
            self.request_rebuild();
            return Ok(false);
        }
        snapshot
            .graph
            .set(
                &snapshot.vectors,
                note.stable_ann_label,
                note.embedding.as_slice(),
            )
            .map_err(|err| err.to_string())?;
        {
            let mut paths = snapshot
                .paths
                .write()
                .map_err(|_| "Note ANN path inventory lock poisoned".to_string())?;
            if let Some(previous) = paths
                .by_label
                .insert(note.stable_ann_label, note.note_path.clone())
            {
                paths.by_path.remove(&previous);
            }
            paths
                .by_path
                .insert(note.note_path.clone(), note.stable_ann_label);
        }
        self.set_live_status(&snapshot, false);
        Ok(true)
    }

    pub(crate) fn apply_note_delete(&self, stable_ann_label: u64) -> Result<bool, String> {
        if stable_ann_label == 0 {
            self.request_rebuild();
            return Ok(false);
        }
        let Some(snapshot) = self.snapshot()? else {
            self.request_rebuild();
            return Ok(false);
        };
        snapshot
            .graph
            .delete(&stable_ann_label)
            .map_err(|err| err.to_string())?;
        if let Ok(mut paths) = snapshot.paths.write() {
            if let Some(path) = paths.by_label.remove(&stable_ann_label) {
                paths.by_path.remove(&path);
            }
        }
        if should_rebuild_for_tombstones(&snapshot.graph) {
            self.request_rebuild();
            return Ok(false);
        }
        self.set_live_status(&snapshot, false);
        Ok(true)
    }

    pub(crate) fn apply_note_move(
        &self,
        stable_ann_label: u64,
        old_path: &str,
        new_path: &str,
    ) -> Result<bool, String> {
        if stable_ann_label == 0 {
            self.request_rebuild();
            return Ok(false);
        }
        let Some(snapshot) = self.snapshot()? else {
            self.request_rebuild();
            return Ok(false);
        };
        let mut paths = snapshot
            .paths
            .write()
            .map_err(|_| "Note ANN path inventory lock poisoned".to_string())?;
        if paths.by_label.get(&stable_ann_label).map(String::as_str) != Some(old_path) {
            self.request_rebuild();
            return Ok(false);
        }
        paths.by_path.remove(old_path);
        paths.by_path.insert(new_path.to_string(), stable_ann_label);
        paths
            .by_label
            .insert(stable_ann_label, new_path.to_string());
        drop(paths);
        self.set_live_status(&snapshot, false);
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
        let signature = load_note_ann_index_signature(connection)?;
        if !signature.identities_valid {
            self.request_rebuild();
            return Err(
                "Note ANN cannot publish while semantic hashes or stable labels are empty"
                    .to_string(),
            );
        }
        let manifest = self.manifest_for_signature(&signature);
        let (graph, vectors) =
            build_snapshot_streaming(connection, &manifest, gate, automatic, progress)?;
        let sources = load_note_ann_source_inventory(connection)?;
        validate_sources(&sources)?;
        let manifest = self.persist_parts(&graph, &vectors, &manifest, &sources)?;
        self.install_snapshot(graph, vectors, manifest, sources, false)?;
        Ok(())
    }

    pub(crate) fn persist_current(&self, connection: &Connection) -> Result<(), String> {
        let Some(snapshot) = self.snapshot()? else {
            return Ok(());
        };
        let signature = load_note_ann_index_signature(connection)?;
        if !signature.identities_valid {
            self.request_rebuild();
            return Ok(());
        }
        let sources = load_note_ann_source_inventory(connection)?;
        validate_sources(&sources)?;
        let mut manifest = snapshot.manifest.clone();
        manifest.note_count = signature.note_count;
        manifest.max_indexed_at_millis = signature.max_indexed_at_millis;
        let published =
            self.persist_parts(&snapshot.graph, &snapshot.vectors, &manifest, &sources)?;
        let (graph, vectors) = clone_graph_and_vectors(&self.cache_dir, &published)?;
        self.install_snapshot(graph, vectors, published, sources, false)
    }

    fn snapshot(&self) -> Result<Option<Arc<NoteAnnSnapshot>>, String> {
        self.current
            .read()
            .map_err(|_| "Note ANN snapshot lock poisoned".to_string())
            .map(|snapshot| snapshot.clone())
    }

    fn try_load_snapshot(
        &self,
        connection: &Connection,
        signature: &NoteAnnIndexSignature,
    ) -> Result<bool, String> {
        if !self.manifest_path.is_file() {
            return Ok(false);
        }
        let manifest: NoteAnnManifest =
            serde_json::from_slice(&fs::read(&self.manifest_path).map_err(|err| err.to_string())?)
                .map_err(|err| err.to_string())?;
        if !self.manifest_compatible(&manifest) {
            return Ok(false);
        }
        let stored_sources = self.read_sources(&manifest)?;
        validate_sources(&stored_sources)?;
        let current_sources = load_note_ann_source_inventory(connection)?;
        validate_sources(&current_sources)?;
        let (graph, vectors) = load_graph_and_vectors(
            &self.generation_path(&manifest.graph_file)?,
            &self.generation_path(&manifest.vectors_file)?,
            manifest.ef_search,
        )?;
        if manifest.note_count == signature.note_count
            && manifest.max_indexed_at_millis == signature.max_indexed_at_millis
            && stored_sources == current_sources
        {
            self.install_snapshot(graph, vectors, manifest, current_sources, false)?;
            return Ok(true);
        }
        let delta = source_delta(&stored_sources, &current_sources);
        if delta.len() <= NOTE_ANN_MAX_INCREMENTAL_NOTES
            && signature.note_count <= manifest.max_nodes
        {
            reconcile_delta(connection, &graph, &vectors, &delta)?;
            if !should_rebuild_for_tombstones(&graph) {
                let mut next_manifest = manifest;
                next_manifest.note_count = signature.note_count;
                next_manifest.max_indexed_at_millis = signature.max_indexed_at_millis;
                let published =
                    self.persist_parts(&graph, &vectors, &next_manifest, &current_sources)?;
                self.install_snapshot(graph, vectors, published, current_sources, false)?;
                return Ok(true);
            }
        }
        self.install_snapshot(graph, vectors, manifest, stored_sources, true)?;
        Ok(true)
    }

    fn manifest_for_signature(&self, signature: &NoteAnnIndexSignature) -> NoteAnnManifest {
        NoteAnnManifest {
            schema_version: NOTE_ANN_SCHEMA_VERSION,
            vector_version: NOTE_VECTOR_VERSION.to_string(),
            model_signature: self.model_signature.clone(),
            distance_kind: NOTE_ANN_DISTANCE_KIND.to_string(),
            dimensions: self.dimensions,
            m: NOTE_ANN_M,
            ef_construction: NOTE_ANN_EF_CONSTRUCTION,
            ef_search: NOTE_ANN_EF_SEARCH,
            max_nodes: desired_capacity(signature.note_count),
            note_count: signature.note_count,
            max_indexed_at_millis: signature.max_indexed_at_millis,
            generation: String::new(),
            graph_file: String::new(),
            vectors_file: String::new(),
            source_inventory_file: String::new(),
        }
    }

    fn manifest_compatible(&self, manifest: &NoteAnnManifest) -> bool {
        manifest.schema_version == NOTE_ANN_SCHEMA_VERSION
            && manifest.vector_version == NOTE_VECTOR_VERSION
            && manifest.model_signature == self.model_signature
            && manifest.distance_kind == NOTE_ANN_DISTANCE_KIND
            && manifest.dimensions == self.dimensions
            && manifest.m == NOTE_ANN_M
            && manifest.ef_construction == NOTE_ANN_EF_CONSTRUCTION
            && manifest.ef_search == NOTE_ANN_EF_SEARCH
            && manifest.max_nodes >= manifest.note_count
    }

    fn install_snapshot(
        &self,
        graph: NoteAnnGraph,
        vectors: NoteAnnVectors,
        manifest: NoteAnnManifest,
        sources: Vec<NoteAnnSourceInventory>,
        stale: bool,
    ) -> Result<(), String> {
        let live_len = graph.live_len();
        let generation = manifest.generation.clone();
        let snapshot = Arc::new(NoteAnnSnapshot {
            graph,
            vectors,
            manifest,
            paths: RwLock::new(NotePathInventory::from_sources(&sources)),
        });
        *self
            .current
            .write()
            .map_err(|_| "Note ANN snapshot lock poisoned".to_string())? = Some(snapshot);
        if let Ok(mut status) = self.status.lock() {
            status.loaded = true;
            status.dirty = stale;
            status.rebuild_pending = stale;
            status.indexed_notes = live_len;
            status.generation_id = Some(generation);
        }
        Ok(())
    }

    fn set_live_status(&self, snapshot: &NoteAnnSnapshot, stale: bool) {
        if let Ok(mut status) = self.status.lock() {
            status.loaded = true;
            status.dirty = stale;
            status.rebuild_pending = stale;
            status.indexed_notes = snapshot.graph.live_len();
            status.generation_id = Some(snapshot.manifest.generation.clone());
        }
    }

    fn persist_parts(
        &self,
        graph: &NoteAnnGraph,
        vectors: &NoteAnnVectors,
        manifest: &NoteAnnManifest,
        sources: &[NoteAnnSourceInventory],
    ) -> Result<NoteAnnManifest, String> {
        let generation = format!(
            "{}-{}",
            current_time_millis()?,
            NOTE_ANN_GENERATION_COUNTER.fetch_add(1, Ordering::AcqRel)
        );
        let graph_file = format!("note-hnsw.{generation}.snapshot");
        let vectors_file = format!("note-hnsw.{generation}.vectors");
        let source_inventory_file = format!("note-hnsw.{generation}.sources.json");
        write_atomic(&self.cache_dir.join(&graph_file), |writer| {
            graph.save_to(writer).map_err(|err| err.to_string())
        })?;
        write_atomic(&self.cache_dir.join(&vectors_file), |writer| {
            vectors
                .save_to(writer, graph.len())
                .map_err(|err| err.to_string())
        })?;
        write_atomic(&self.cache_dir.join(&source_inventory_file), |writer| {
            serde_json::to_writer_pretty(writer, sources).map_err(|err| err.to_string())
        })?;
        let mut published = manifest.clone();
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

    fn read_sources(
        &self,
        manifest: &NoteAnnManifest,
    ) -> Result<Vec<NoteAnnSourceInventory>, String> {
        serde_json::from_reader(BufReader::new(
            File::open(self.generation_path(&manifest.source_inventory_file)?)
                .map_err(|err| err.to_string())?,
        ))
        .map_err(|err| err.to_string())
    }

    fn generation_path(&self, file_name: &str) -> Result<PathBuf, String> {
        let path = Path::new(file_name);
        if file_name.is_empty() || path.components().count() != 1 {
            return Err("Invalid note ANN generation file name".to_string());
        }
        Ok(self.cache_dir.join(path))
    }

    fn remove_unreferenced_generations(&self, manifest: &NoteAnnManifest) {
        let keep = [
            manifest.graph_file.as_str(),
            manifest.vectors_file.as_str(),
            manifest.source_inventory_file.as_str(),
            "note-hnsw.manifest.json",
        ]
        .into_iter()
        .collect::<HashSet<_>>();
        let Ok(entries) = fs::read_dir(&self.cache_dir) else {
            return;
        };
        for entry in entries.flatten() {
            let name = entry.file_name();
            let Some(name) = name.to_str() else { continue };
            if name.starts_with("note-hnsw.") && !keep.contains(name) {
                let _ = fs::remove_file(entry.path());
            }
        }
    }
}

fn clone_graph_and_vectors(
    cache_dir: &Path,
    manifest: &NoteAnnManifest,
) -> Result<(NoteAnnGraph, NoteAnnVectors), String> {
    load_graph_and_vectors(
        &cache_dir.join(&manifest.graph_file),
        &cache_dir.join(&manifest.vectors_file),
        manifest.ef_search,
    )
}

fn load_graph_and_vectors(
    graph_path: &Path,
    vectors_path: &Path,
    ef_search: usize,
) -> Result<(NoteAnnGraph, NoteAnnVectors), String> {
    let mut graph_reader = BufReader::new(File::open(graph_path).map_err(|err| err.to_string())?);
    let graph = Hnsw::load_from(Cosine::new(), &mut graph_reader).map_err(|err| err.to_string())?;
    graph.set_ef_search(ef_search);
    let mut vectors_reader =
        BufReader::new(File::open(vectors_path).map_err(|err| err.to_string())?);
    let (vectors, vector_count) = InMemoryVectorStore::<f32>::load_from(&mut vectors_reader)
        .map_err(|err| err.to_string())?;
    if vector_count != graph.len() {
        return Err("Note ANN graph/vector count mismatch".to_string());
    }
    Ok((graph, vectors))
}

fn build_snapshot_streaming(
    connection: &Connection,
    manifest: &NoteAnnManifest,
    gate: Option<&BackgroundWorkGate>,
    automatic: bool,
    progress: Option<&dyn Fn(usize, usize)>,
) -> Result<(NoteAnnGraph, NoteAnnVectors), String> {
    let graph = Hnsw::new(
        Cosine::new(),
        HnswConfig::new(manifest.dimensions, manifest.max_nodes)
            .m(manifest.m)
            .ef_construction(manifest.ef_construction)
            .ef_search(manifest.ef_search),
    );
    let vectors = InMemoryVectorStore::<f32>::new(manifest.dimensions, manifest.max_nodes);
    let mut seen = HashSet::new();
    let mut processed = 0usize;
    for_each_note_embedding(connection, |row| {
        if processed % 64 == 0 {
            if let Some(gate) = gate {
                if automatic {
                    gate.wait_for_automatic_idle();
                } else {
                    gate.checkpoint_manual_pause();
                }
            }
        }
        if row.stable_ann_label == 0 || row.semantic_input_hash.is_empty() {
            return Err(format!("Invalid note ANN identity for {}", row.note_path));
        }
        if row.embedding.len() != manifest.dimensions {
            return Err(format!("Note ANN dimension mismatch for {}", row.note_path));
        }
        if !seen.insert(row.stable_ann_label) {
            return Err(format!("Duplicate note ANN label {}", row.stable_ann_label));
        }
        graph
            .set(&vectors, row.stable_ann_label, row.embedding.as_slice())
            .map_err(|err| err.to_string())?;
        processed += 1;
        if processed % 64 == 0 {
            if let Some(progress) = progress {
                progress(processed, manifest.note_count);
            }
        }
        Ok(())
    })?;
    if let Some(progress) = progress {
        progress(processed, manifest.note_count);
    }
    Ok((graph, vectors))
}

fn validate_sources(sources: &[NoteAnnSourceInventory]) -> Result<(), String> {
    if sources
        .iter()
        .any(|source| source.stable_ann_label == 0 || source.semantic_input_hash.is_empty())
    {
        return Err("Note ANN source inventory contains an empty identity".to_string());
    }
    Ok(())
}

fn source_delta(
    stored: &[NoteAnnSourceInventory],
    current: &[NoteAnnSourceInventory],
) -> Vec<(
    Option<NoteAnnSourceInventory>,
    Option<NoteAnnSourceInventory>,
)> {
    let stored = stored
        .iter()
        .cloned()
        .map(|source| (source.stable_ann_label, source))
        .collect::<HashMap<_, _>>();
    let current = current
        .iter()
        .cloned()
        .map(|source| (source.stable_ann_label, source))
        .collect::<HashMap<_, _>>();
    let mut labels = stored
        .keys()
        .chain(current.keys())
        .copied()
        .collect::<HashSet<_>>()
        .into_iter()
        .collect::<Vec<_>>();
    labels.sort_unstable();
    labels
        .into_iter()
        .filter_map(|label| {
            let before = stored.get(&label).cloned();
            let after = current.get(&label).cloned();
            (before != after).then_some((before, after))
        })
        .collect()
}

fn reconcile_delta(
    connection: &Connection,
    graph: &NoteAnnGraph,
    vectors: &NoteAnnVectors,
    delta: &[(
        Option<NoteAnnSourceInventory>,
        Option<NoteAnnSourceInventory>,
    )],
) -> Result<(), String> {
    for (before, after) in delta {
        if after.is_none() {
            graph
                .delete(&before.as_ref().expect("before source").stable_ann_label)
                .map_err(|err| err.to_string())?;
            continue;
        }
        let source = after.as_ref().expect("after source");
        let note = load_note_embedding_for_path(connection, &source.path)?
            .ok_or_else(|| format!("Missing note embedding for {}", source.path))?;
        graph
            .set(vectors, source.stable_ann_label, note.embedding.as_slice())
            .map_err(|err| err.to_string())?;
    }
    Ok(())
}

fn desired_capacity(note_count: usize) -> usize {
    note_count
        .saturating_mul(2)
        .max(NOTE_ANN_MIN_CAPACITY)
        .next_power_of_two()
}

fn should_rebuild_for_tombstones(graph: &NoteAnnGraph) -> bool {
    let deleted = graph.deleted_len();
    let live = graph.live_len().max(1);
    deleted >= NOTE_ANN_TOMBSTONE_REBUILD_MAX
        || (deleted >= NOTE_ANN_TOMBSTONE_REBUILD_MIN && deleted.saturating_mul(4) >= live)
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

#[cfg(test)]
mod tests {
    use super::NoteAnnIndexState;
    use crate::semantic::{
        chunking::SemanticChunk,
        db::{
            ensure_schema, move_note, open_database, update_moved_note_metadata,
            upsert_note_chunks, SemanticNoteMetadata,
        },
    };
    use std::{
        fs,
        path::{Path, PathBuf},
        time::{SystemTime, UNIX_EPOCH},
    };

    #[test]
    fn persisted_generation_loads_and_queries_with_exact_scores() {
        let temp = TestDir::new("note-ann-load");
        let mut connection = database(&temp);
        seed(&mut connection, "notes/a.md", &[1.0, 0.0], "hash-a");
        seed(&mut connection, "notes/b.md", &[0.8, 0.2], "hash-b");
        seed(&mut connection, "notes/c.md", &[0.0, 1.0], "hash-c");
        let ann = state(&temp);
        ann.rebuild_from_connection(&connection).expect("rebuild");
        let generation = ann.generation_id().expect("generation");

        let reloaded = state(&temp);
        reloaded.initialize(&connection).expect("initialize");
        assert_eq!(
            reloaded.generation_id().as_deref(),
            Some(generation.as_str())
        );
        let hits = reloaded
            .search(&connection, &[1.0, 0.0], 8, 2, None)
            .expect("query");
        assert_eq!(hits[0].note_path, "notes/a.md");
        assert!((hits[0].score - 1.0).abs() < 0.0001);
    }

    #[test]
    fn startup_recovers_small_sqlite_delta() {
        let temp = TestDir::new("note-ann-recovery");
        let mut connection = database(&temp);
        seed(&mut connection, "notes/a.md", &[1.0, 0.0], "hash-a");
        let initial = state(&temp);
        initial
            .rebuild_from_connection(&connection)
            .expect("initial rebuild");
        seed(&mut connection, "notes/b.md", &[0.0, 1.0], "hash-b");

        let recovered = state(&temp);
        recovered.initialize(&connection).expect("recover");
        let status = recovered.status_snapshot();
        assert!(status.loaded);
        assert!(!status.rebuild_pending);
        assert_eq!(status.indexed_notes, 2);
    }

    #[test]
    fn rename_updates_inventory_without_changing_generation_or_identity() {
        let temp = TestDir::new("note-ann-rename");
        let mut connection = database(&temp);
        seed(&mut connection, "notes/old.md", &[1.0, 0.0], "hash-a");
        let label: u64 = connection
            .query_row(
                "SELECT stable_ann_label FROM notes WHERE path = 'notes/old.md'",
                [],
                |row| row.get(0),
            )
            .expect("label");
        let ann = state(&temp);
        ann.rebuild_from_connection(&connection).expect("rebuild");
        let generation = ann.generation_id();
        assert!(move_note(&mut connection, "notes/old.md", "notes/new.md").expect("move"));
        update_moved_note_metadata(
            &connection,
            "notes/new.md",
            "New",
            1,
            "content",
            "",
            "",
            crate::note::DocumentKind::Note,
            &metadata("hash-a"),
        )
        .expect("metadata");
        assert!(ann
            .apply_note_move(label, "notes/old.md", "notes/new.md")
            .expect("apply move"));
        assert_eq!(ann.generation_id(), generation);
        let hits = ann
            .neighbors_for_note(&connection, "notes/new.md", 8, 4)
            .expect("neighbors");
        assert!(hits.is_empty());
        assert!(!ann.needs_rebuild());
    }

    #[test]
    fn empty_semantic_identity_never_becomes_current() {
        let temp = TestDir::new("note-ann-invalid");
        let mut connection = database(&temp);
        seed(&mut connection, "notes/a.md", &[1.0, 0.0], "");
        let ann = state(&temp);
        assert!(ann.rebuild_from_connection(&connection).is_err());
        assert!(!ann.status_snapshot().loaded);
        assert!(ann.needs_rebuild());
    }

    #[test]
    fn empty_stable_label_never_becomes_current() {
        let temp = TestDir::new("note-ann-invalid-label");
        let mut connection = database(&temp);
        seed(&mut connection, "notes/a.md", &[1.0, 0.0], "hash-a");
        connection
            .execute(
                "UPDATE notes SET stable_ann_label = 0 WHERE path = 'notes/a.md'",
                [],
            )
            .expect("clear stable label");
        let ann = state(&temp);
        assert!(ann.rebuild_from_connection(&connection).is_err());
        assert!(!ann.status_snapshot().loaded);
        assert!(ann.needs_rebuild());
    }

    #[test]
    fn incomplete_unreferenced_generation_does_not_replace_manifest() {
        let temp = TestDir::new("note-ann-interrupted");
        let mut connection = database(&temp);
        seed(&mut connection, "notes/a.md", &[1.0, 0.0], "hash-a");
        let initial = state(&temp);
        initial
            .rebuild_from_connection(&connection)
            .expect("rebuild");
        fs::write(
            temp.path().join("cache/note-hnsw.interrupted.snapshot"),
            b"partial",
        )
        .expect("partial");
        let recovered = state(&temp);
        recovered.initialize(&connection).expect("load");
        assert!(recovered.status_snapshot().loaded);
        assert_eq!(recovered.status_snapshot().indexed_notes, 1);
    }

    fn state(temp: &TestDir) -> NoteAnnIndexState {
        NoteAnnIndexState::new(temp.path().join("cache"), 2, "mock-model-v1".to_string())
            .expect("state")
    }

    fn database(temp: &TestDir) -> rusqlite::Connection {
        let connection = open_database(&temp.path().join("semantic.sqlite3")).expect("database");
        ensure_schema(&connection).expect("schema");
        connection
    }

    fn metadata(hash: &str) -> SemanticNoteMetadata {
        SemanticNoteMetadata {
            semantic_input_hash: hash.to_string(),
            structure_hash: "structure".to_string(),
            presentation_hash: "presentation".to_string(),
            ..SemanticNoteMetadata::default()
        }
    }

    fn seed(
        connection: &mut rusqlite::Connection,
        path: &str,
        embedding: &[f32],
        semantic_hash: &str,
    ) {
        upsert_note_chunks(
            connection,
            path,
            path,
            1,
            "content",
            "",
            "",
            crate::note::DocumentKind::Note,
            &metadata(semantic_hash),
            &[SemanticChunk {
                ordinal: 0,
                section_label: "Body".to_string(),
                text: path.to_string(),
                text_hash: "text".to_string(),
                start_line: 1,
                end_line: 1,
                block_anchor: None,
            }],
            &[embedding.to_vec()],
        )
        .expect("seed");
    }

    struct TestDir {
        path: PathBuf,
    }

    impl TestDir {
        fn new(label: &str) -> Self {
            let unique = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("time")
                .as_nanos();
            let path = std::env::temp_dir().join(format!("gneauxghts-{label}-{unique}"));
            fs::create_dir_all(path.join("cache")).expect("temp");
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
