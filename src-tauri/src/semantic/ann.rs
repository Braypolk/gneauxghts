use super::{
    chunking::SemanticChunk,
    db::{
        ann_label_for, load_ann_index_signature, load_chunks_with_embeddings, AnnIndexSignature,
        StoredChunkRow,
    },
    debug::SemanticDebugState,
};
use crate::time::current_time_millis;
use hnswlib_rs::{Cosine, Hnsw, HnswConfig, InMemoryVectorStore, SetOutcome};
use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use std::{
    collections::HashSet,
    fs::{self, File},
    io::{BufReader, BufWriter, Write},
    path::{Path, PathBuf},
    sync::{Arc, Mutex, RwLock},
    time::{Instant, UNIX_EPOCH},
};

const ANN_SCHEMA_VERSION: u32 = 1;
const ANN_DISTANCE_KIND: &str = "cosine";
const ANN_M: usize = 16;
const ANN_EF_CONSTRUCTION: usize = 200;
const ANN_EF_SEARCH: usize = 64;
const ANN_MIN_CAPACITY: usize = 1024;
const ANN_TOMBSTONE_REBUILD_MIN: usize = 64;
const ANN_TOMBSTONE_REBUILD_MAX: usize = 256;

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
}

struct AnnSnapshot {
    graph: AnnGraph,
    vectors: AnnVectors,
    manifest: AnnManifest,
}

pub(crate) struct AnnIndexState {
    dimensions: usize,
    graph_path: PathBuf,
    vectors_path: PathBuf,
    manifest_path: PathBuf,
    current: RwLock<Option<Arc<AnnSnapshot>>>,
    status: Mutex<AnnStatusState>,
    debug: Arc<SemanticDebugState>,
}

impl AnnIndexState {
    pub(crate) fn new(
        semantic_dir: PathBuf,
        dimensions: usize,
        debug: Arc<SemanticDebugState>,
    ) -> Result<Self, String> {
        fs::create_dir_all(&semantic_dir).map_err(|err| err.to_string())?;
        Ok(Self {
            dimensions,
            graph_path: semantic_dir.join("semantic.ann.hnsw"),
            vectors_path: semantic_dir.join("semantic.ann.vecs"),
            manifest_path: semantic_dir.join("semantic.ann.manifest.json"),
            current: RwLock::new(None),
            status: Mutex::new(AnnStatusState::default()),
            debug,
        })
    }

    pub(crate) fn initialize(&self, connection: &Connection) -> Result<(), String> {
        let signature = load_ann_index_signature(connection)?;
        match self.try_load_snapshot(&signature) {
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
        note_path: &Path,
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

        let raw_note_path = note_path.to_string_lossy().into_owned();
        let next_labels = chunks
            .iter()
            .map(|chunk| ann_label_for(&raw_note_path, chunk.ordinal))
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
            let label = ann_label_for(&raw_note_path, chunk.ordinal);
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

    pub(crate) fn rebuild_from_connection(&self, connection: &Connection) -> Result<(), String> {
        let started_at = Instant::now();
        let signature = load_ann_index_signature(connection)?;
        let rows = load_chunks_with_embeddings(connection, None)?;
        let manifest =
            self.manifest_for_signature(&signature, infer_dimensions(&rows, self.dimensions));
        let (graph, vectors) = build_snapshot(&rows, &manifest)?;

        self.persist_parts(&graph, &vectors, &manifest)?;
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

        let elapsed = started_at.elapsed().as_millis().min(u128::from(u64::MAX)) as u64;
        self.debug
            .record_timing("ann", "rebuild_completed", None, elapsed, |metrics| {
                metrics.ann_rebuild_count += 1;
                metrics.ann_rebuild_duration_total_millis += elapsed;
                metrics.ann_rebuild_duration_max_millis =
                    metrics.ann_rebuild_duration_max_millis.max(elapsed);
            });
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
        self.persist_parts(&snapshot.graph, &snapshot.vectors, &manifest)?;
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
        }
    }

    fn try_load_snapshot(&self, signature: &AnnIndexSignature) -> Result<bool, String> {
        if !self.manifest_path.is_file()
            || !self.graph_path.is_file()
            || !self.vectors_path.is_file()
        {
            return Ok(false);
        }

        let manifest_file = File::open(&self.manifest_path).map_err(|err| err.to_string())?;
        let manifest = serde_json::from_reader::<_, AnnManifest>(BufReader::new(manifest_file))
            .map_err(|err| err.to_string())?;
        if manifest.schema_version != ANN_SCHEMA_VERSION
            || manifest.distance_kind != ANN_DISTANCE_KIND
            || manifest.dimensions != self.dimensions
            || manifest.m != ANN_M
            || manifest.ef_construction != ANN_EF_CONSTRUCTION
            || manifest.ef_search != ANN_EF_SEARCH
            || manifest.chunk_count != signature.chunk_count
            || manifest.max_indexed_at_millis != signature.max_indexed_at_millis
        {
            return Ok(false);
        }

        let graph_file = File::open(&self.graph_path).map_err(|err| err.to_string())?;
        let mut graph_reader = BufReader::new(graph_file);
        let graph =
            Hnsw::load_from(Cosine::new(), &mut graph_reader).map_err(|err| err.to_string())?;
        graph.set_ef_search(manifest.ef_search);

        let vectors_file = File::open(&self.vectors_path).map_err(|err| err.to_string())?;
        let mut vectors_reader = BufReader::new(vectors_file);
        let (vectors, vector_count) = InMemoryVectorStore::<f32>::load_from(&mut vectors_reader)
            .map_err(|err| err.to_string())?;
        if vector_count != graph.len() {
            return Err(format!(
                "ANN graph/vector count mismatch: graph={} vectors={vector_count}",
                graph.len()
            ));
        }

        let dumped_at = file_timestamp_millis(&self.manifest_path).ok();
        {
            let mut current = self
                .current
                .write()
                .map_err(|_| "ANN snapshot lock poisoned".to_string())?;
            *current = Some(Arc::new(AnnSnapshot {
                graph,
                vectors,
                manifest,
            }));
        }
        self.set_status(true, false, false, signature.chunk_count, dumped_at);
        self.debug
            .record_with_metrics("ann", "load_completed", None, None, |metrics| {
                metrics.ann_load_success_count += 1;
            });
        Ok(true)
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
    ) -> Result<(), String> {
        write_atomic(&self.graph_path, |writer| {
            graph.save_to(writer).map_err(|err| err.to_string())
        })?;
        write_atomic(&self.vectors_path, |writer| {
            vectors
                .save_to(writer, graph.len())
                .map_err(|err| err.to_string())
        })?;
        write_atomic(&self.manifest_path, |writer| {
            serde_json::to_writer_pretty(writer, manifest).map_err(|err| err.to_string())
        })?;
        Ok(())
    }
}

fn build_snapshot(
    rows: &[StoredChunkRow],
    manifest: &AnnManifest,
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

    for row in rows {
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
            .map_err(|err| err.to_string())?;
    }

    Ok((graph, vectors))
}

fn infer_dimensions(rows: &[StoredChunkRow], fallback: usize) -> usize {
    rows.first()
        .map(|row| row.embedding.len())
        .filter(|dimensions| *dimensions > 0)
        .unwrap_or(fallback.max(1))
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
    fs::rename(&tmp_path, path).map_err(|err| err.to_string())
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
        db::{ensure_schema, load_note_chunk_labels, open_database, upsert_note_chunks},
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
