//! Shared HNSW graph/vector store lifecycle for chunk ANN and note ANN.
//!
//! Chunk and note indexes keep separate adapters (manifest schemas, DB loaders,
//! search/upsert APIs). This module owns the duplicated machinery: capacity,
//! tombstone rebuild thresholds, atomic persist/load, generation ids, and
//! unreferenced-generation cleanup.

use crate::time::current_time_millis;
use hnswlib_rs::{Cosine, Hnsw, HnswConfig, InMemoryVectorStore};
use serde::Serialize;
use std::{
    collections::HashSet,
    fs::{self, File},
    io::{BufReader, BufWriter, Write},
    path::{Path, PathBuf},
    sync::atomic::{AtomicU64, Ordering},
    time::UNIX_EPOCH,
};

pub(crate) type AnnGraph = Hnsw<u64, Cosine<f32>>;
pub(crate) type AnnVectors = InMemoryVectorStore<f32>;

pub(crate) const ANN_DISTANCE_KIND: &str = "cosine";
pub(crate) const ANN_M: usize = 16;
pub(crate) const ANN_EF_CONSTRUCTION: usize = 200;
pub(crate) const ANN_MIN_CAPACITY: usize = 1024;
pub(crate) const ANN_TOMBSTONE_REBUILD_MIN: usize = 64;
pub(crate) const ANN_TOMBSTONE_REBUILD_MAX: usize = 256;

static ANN_GENERATION_COUNTER: AtomicU64 = AtomicU64::new(1);

#[derive(Clone, Debug)]
pub(crate) struct GenerationArtifactNames {
    pub(crate) generation: String,
    pub(crate) graph_file: String,
    pub(crate) vectors_file: String,
    pub(crate) source_inventory_file: String,
}

pub(crate) fn new_hnsw_index(
    dimensions: usize,
    max_nodes: usize,
    m: usize,
    ef_construction: usize,
    ef_search: usize,
) -> (AnnGraph, AnnVectors) {
    let graph = Hnsw::new(
        Cosine::new(),
        HnswConfig::new(dimensions, max_nodes)
            .m(m)
            .ef_construction(ef_construction)
            .ef_search(ef_search),
    );
    let vectors = InMemoryVectorStore::<f32>::new(dimensions, max_nodes);
    (graph, vectors)
}

pub(crate) fn desired_capacity(item_count: usize) -> usize {
    item_count
        .saturating_mul(2)
        .max(ANN_MIN_CAPACITY)
        .next_power_of_two()
}

pub(crate) fn should_rebuild_for_tombstones(graph: &AnnGraph) -> bool {
    let deleted = graph.deleted_len();
    if deleted == 0 {
        return false;
    }
    let live = graph.live_len().max(1);
    deleted >= ANN_TOMBSTONE_REBUILD_MAX
        || (deleted >= ANN_TOMBSTONE_REBUILD_MIN && deleted.saturating_mul(4) >= live)
}

pub(crate) fn generation_path(
    cache_dir: &Path,
    file_name: &str,
    invalid_message: &str,
) -> Result<PathBuf, String> {
    let path = Path::new(file_name);
    if file_name.is_empty() || path.components().count() != 1 {
        return Err(invalid_message.to_string());
    }
    Ok(cache_dir.join(path))
}

pub(crate) fn load_graph_and_vectors(
    graph_path: &Path,
    vectors_path: &Path,
    ef_search: usize,
    mismatch_context: &str,
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
            "{mismatch_context} graph/vector count mismatch: graph={} vectors={vector_count}",
            graph.len()
        ));
    }
    Ok((graph, vectors))
}

pub(crate) fn allocate_generation_artifacts(file_stem: &str) -> Result<GenerationArtifactNames, String> {
    let generation = format!(
        "{}-{}",
        current_time_millis()?,
        ANN_GENERATION_COUNTER.fetch_add(1, Ordering::AcqRel)
    );
    Ok(GenerationArtifactNames {
        graph_file: format!("{file_stem}.{generation}.snapshot"),
        vectors_file: format!("{file_stem}.{generation}.vectors"),
        source_inventory_file: format!("{file_stem}.{generation}.sources.json"),
        generation,
    })
}

pub(crate) fn write_generation_artifacts<S: Serialize>(
    cache_dir: &Path,
    names: &GenerationArtifactNames,
    graph: &AnnGraph,
    vectors: &AnnVectors,
    sources: &S,
) -> Result<(), String> {
    write_atomic(&cache_dir.join(&names.graph_file), |writer| {
        graph.save_to(writer).map_err(|err| err.to_string())
    })?;
    write_atomic(&cache_dir.join(&names.vectors_file), |writer| {
        vectors
            .save_to(writer, graph.len())
            .map_err(|err| err.to_string())
    })?;
    write_json_atomic(&cache_dir.join(&names.source_inventory_file), sources)?;
    Ok(())
}

pub(crate) fn write_json_atomic<T: Serialize>(path: &Path, value: &T) -> Result<(), String> {
    write_atomic(path, |writer| {
        serde_json::to_writer_pretty(writer, value).map_err(|err| err.to_string())
    })
}

pub(crate) fn remove_unreferenced_generations(
    cache_dir: &Path,
    file_prefix: &str,
    keep: &HashSet<&str>,
) {
    let Ok(entries) = fs::read_dir(cache_dir) else {
        return;
    };
    for entry in entries.flatten() {
        let name = entry.file_name();
        let Some(name) = name.to_str() else { continue };
        if name.starts_with(file_prefix) && !keep.contains(name) {
            let _ = fs::remove_file(entry.path());
        }
    }
}

pub(crate) fn write_atomic<F>(path: &Path, write: F) -> Result<(), String>
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

pub(crate) fn file_timestamp_millis(path: &Path) -> Result<u64, String> {
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
    use super::{desired_capacity, should_rebuild_for_tombstones, ANN_MIN_CAPACITY, ANN_TOMBSTONE_REBUILD_MIN};
    use hnswlib_rs::{Cosine, Hnsw, HnswConfig, InMemoryVectorStore};

    #[test]
    fn capacity_is_next_power_of_two_above_baseline() {
        assert_eq!(desired_capacity(0), ANN_MIN_CAPACITY);
        assert_eq!(desired_capacity(1), ANN_MIN_CAPACITY);
        assert_eq!(desired_capacity(ANN_MIN_CAPACITY), ANN_MIN_CAPACITY * 2);
    }

    #[test]
    fn tombstone_threshold_ignores_empty_deleted_set() {
        let capacity = (ANN_TOMBSTONE_REBUILD_MIN + 8).next_power_of_two();
        let graph = Hnsw::new(
            Cosine::new(),
            HnswConfig::new(2, capacity)
                .m(8)
                .ef_construction(32)
                .ef_search(16),
        );
        let vectors = InMemoryVectorStore::<f32>::new(2, capacity);
        graph.set(&vectors, 1u64, &[1.0, 0.0]).expect("insert");
        assert!(!should_rebuild_for_tombstones(&graph));
        for label in 2u64..=(ANN_TOMBSTONE_REBUILD_MIN as u64 + 1) {
            graph
                .set(&vectors, label, &[0.0, 1.0])
                .expect("insert tombstone candidate");
            graph.delete(&label).expect("delete");
        }
        assert!(should_rebuild_for_tombstones(&graph));
    }
}
