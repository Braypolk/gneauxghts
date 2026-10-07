//! Disposable image HNSW generations. SQLite owns vectors and occurrences;
//! readers capture one immutable graph and validate candidates against SQLite.
use super::ann_core::{
    allocate_generation_artifacts, desired_capacity, generation_path, load_graph_and_vectors,
    new_hnsw_index, remove_unreferenced_generations, should_rebuild_for_tombstones,
    write_generation_artifacts, write_json_atomic, AnnGraph, AnnVectors, ANN_EF_CONSTRUCTION,
    ANN_M,
};
use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use std::{
    collections::{HashMap, HashSet},
    fs,
    path::PathBuf,
    sync::{Arc, Mutex, RwLock},
};

const EF_SEARCH: usize = 96;
#[derive(Clone, Serialize, Deserialize, PartialEq, Eq)]
struct Source {
    hash: String,
    label: u64,
}
#[derive(Clone, Serialize, Deserialize)]
struct Manifest {
    version: u32,
    representation: String,
    dimensions: usize,
    graph_file: String,
    vectors_file: String,
    source_inventory_file: String,
}
struct Snapshot {
    representation: String,
    sources: Vec<Source>,
    graph: AnnGraph,
    vectors: AnnVectors,
    manifest: Manifest,
}

pub(crate) struct ImageAnnIndex {
    cache: PathBuf,
    current: RwLock<Option<Arc<Snapshot>>>,
    publication: Mutex<()>,
}
impl ImageAnnIndex {
    pub(crate) fn new(cache: PathBuf) -> Self {
        Self {
            cache,
            current: RwLock::new(None),
            publication: Mutex::new(()),
        }
    }
    pub(crate) fn reconcile(
        &self,
        connection: &Connection,
        representation: &str,
        dimensions: usize,
        mut checkpoint: impl FnMut() -> Result<(), String>,
    ) -> Result<(), String> {
        let _publication = self
            .publication
            .lock()
            .map_err(|_| "Image ANN publication unavailable")?;
        let mut statement = connection
            .prepare(
                "SELECT asset_hash FROM image_vectors WHERE representation=?1 ORDER BY asset_hash",
            )
            .map_err(|e| e.to_string())?;
        let hashes = statement
            .query_map([representation], |r| r.get::<_, String>(0))
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;
        // Labels are deterministic within an immutable, sorted inventory, with
        // collision resolution. Queries never infer a label from an asset hash.
        let mut labels = HashSet::new();
        let sources = hashes
            .into_iter()
            .map(|hash| {
                let mut label = u64::from_le_bytes(
                    blake3::hash(hash.as_bytes()).as_bytes()[..8]
                        .try_into()
                        .unwrap(),
                )
                .max(1);
                while !labels.insert(label) {
                    label = label.wrapping_add(1).max(1);
                }
                Source { hash, label }
            })
            .collect::<Vec<_>>();
        if self
            .snapshot()?
            .is_some_and(|s| s.representation == representation && s.sources == sources)
        {
            return Ok(());
        }
        fs::create_dir_all(&self.cache).map_err(|e| e.to_string())?;
        let manifest_path = self.cache.join("image-hnsw.manifest.json");
        if let Ok(snapshot) = self.load(&manifest_path, representation, dimensions, &sources) {
            let previous = fs::read(self.cache.join("image-hnsw.previous.json"))
                .ok()
                .and_then(|b| serde_json::from_slice::<Manifest>(&b).ok());
            self.cleanup(&snapshot.manifest, previous.as_ref());
            *self.current.write().map_err(|_| "Image ANN unavailable")? = Some(Arc::new(snapshot));
            return Ok(());
        }
        let previous = self.snapshot()?;
        let incremental = previous
            .as_ref()
            .filter(|old| old.representation == representation)
            .and_then(|old| {
                let old_sources = old
                    .sources
                    .iter()
                    .map(|s| (&s.hash, s.label))
                    .collect::<HashMap<_, _>>();
                let next_sources = sources
                    .iter()
                    .map(|s| (&s.hash, s.label))
                    .collect::<HashMap<_, _>>();
                let removed = old
                    .sources
                    .iter()
                    .filter(|s| next_sources.get(&s.hash) != Some(&s.label))
                    .collect::<Vec<_>>();
                let added = sources
                    .iter()
                    .filter(|s| old_sources.get(&s.hash) != Some(&s.label))
                    .collect::<Vec<_>>();
                if removed.len() + added.len() > 128
                    || old.graph.len() + added.len() > desired_capacity(old.sources.len())
                {
                    return None;
                }
                let resolve = |name: &str| {
                    generation_path(&self.cache, name, "Invalid image generation path")
                };
                let (graph, vectors) = load_graph_and_vectors(
                    &resolve(&old.manifest.graph_file).ok()?,
                    &resolve(&old.manifest.vectors_file).ok()?,
                    EF_SEARCH,
                    "Image ANN",
                )
                .ok()?;
                for source in removed {
                    graph.delete(&source.label).ok()?;
                }
                if should_rebuild_for_tombstones(&graph) {
                    return None;
                }
                Some((
                    graph,
                    vectors,
                    added.into_iter().cloned().collect::<Vec<_>>(),
                ))
            });
        let (graph, vectors, updates) = incremental.unwrap_or_else(|| {
            let (graph, vectors) = new_hnsw_index(
                dimensions,
                desired_capacity(sources.len()),
                ANN_M,
                ANN_EF_CONSTRUCTION,
                EF_SEARCH,
            );
            (graph, vectors, sources.clone())
        });
        let mut load = connection
            .prepare("SELECT vector FROM image_vectors WHERE asset_hash=?1 AND representation=?2")
            .map_err(|e| e.to_string())?;
        for source in &updates {
            checkpoint()?;
            let blob = load
                .query_row(rusqlite::params![source.hash, representation], |r| {
                    r.get::<_, Vec<u8>>(0)
                })
                .map_err(|e| e.to_string())?;
            let vector = decode_vector(&blob, dimensions)?;
            graph
                .set(&vectors, source.label, &vector)
                .map_err(|e| e.to_string())?;
        }
        checkpoint()?;
        let names = allocate_generation_artifacts("image-hnsw")?;
        write_generation_artifacts(&self.cache, &names, &graph, &vectors, &sources)?;
        let manifest = Manifest {
            version: 1,
            representation: representation.into(),
            dimensions,
            graph_file: names.graph_file,
            vectors_file: names.vectors_file,
            source_inventory_file: names.source_inventory_file,
        };
        // Manifest is the publication point; failures retain the last good graph.
        if let Some(previous) = &previous {
            write_json_atomic(
                &self.cache.join("image-hnsw.previous.json"),
                &previous.manifest,
            )?;
        }
        write_json_atomic(&manifest_path, &manifest)?;
        *self.current.write().map_err(|_| "Image ANN unavailable")? = Some(Arc::new(Snapshot {
            representation: representation.into(),
            sources,
            graph,
            vectors,
            manifest: manifest.clone(),
        }));
        self.cleanup(&manifest, previous.as_ref().map(|s| &s.manifest));
        Ok(())
    }
    fn cleanup(&self, manifest: &Manifest, previous: Option<&Manifest>) {
        let mut keep = HashSet::from([
            "image-hnsw.manifest.json",
            "image-hnsw.previous.json",
            manifest.graph_file.as_str(),
            manifest.vectors_file.as_str(),
            manifest.source_inventory_file.as_str(),
        ]);
        if let Some(previous) = previous {
            keep.extend([
                previous.graph_file.as_str(),
                previous.vectors_file.as_str(),
                previous.source_inventory_file.as_str(),
            ]);
        }
        remove_unreferenced_generations(&self.cache, "image-hnsw.", &keep);
    }
    fn load(
        &self,
        path: &std::path::Path,
        representation: &str,
        dimensions: usize,
        sources: &[Source],
    ) -> Result<Snapshot, String> {
        let manifest: Manifest =
            serde_json::from_slice(&fs::read(path).map_err(|e| e.to_string())?)
                .map_err(|e| e.to_string())?;
        if manifest.version != 1
            || manifest.representation != representation
            || manifest.dimensions != dimensions
        {
            return Err("Image representation changed".into());
        }
        let resolve =
            |name: &str| generation_path(&self.cache, name, "Invalid image generation path");
        let stored: Vec<Source> = serde_json::from_slice(
            &fs::read(resolve(&manifest.source_inventory_file)?).map_err(|e| e.to_string())?,
        )
        .map_err(|e| e.to_string())?;
        if stored != sources {
            return Err("Image source inventory changed".into());
        }
        let (graph, vectors) = load_graph_and_vectors(
            &resolve(&manifest.graph_file)?,
            &resolve(&manifest.vectors_file)?,
            EF_SEARCH,
            "Image ANN",
        )?;
        if graph.live_len() != sources.len() || graph.dim() != dimensions {
            return Err("Image inventory count mismatch".into());
        }
        Ok(Snapshot {
            representation: representation.into(),
            sources: stored,
            graph,
            vectors,
            manifest,
        })
    }
    fn snapshot(&self) -> Result<Option<Arc<Snapshot>>, String> {
        Ok(self
            .current
            .read()
            .map_err(|_| "Image ANN unavailable")?
            .clone())
    }
    /// Filter eligible hashes inside HNSW, before its candidate limit. A large
    /// out-of-scope corpus cannot displace a small matching tagged collection.
    pub(crate) fn candidates(
        &self,
        representation: &str,
        query: &[f32],
        allowed: &HashSet<String>,
        limit: usize,
    ) -> Result<Vec<String>, String> {
        let Some(snapshot) = self
            .snapshot()?
            .filter(|s| s.representation == representation)
        else {
            return Ok(Vec::new());
        };
        if query.len() != snapshot.graph.dim() || allowed.is_empty() || limit == 0 {
            return Ok(Vec::new());
        }
        let by_label = snapshot
            .sources
            .iter()
            .map(|s| (s.label, &s.hash))
            .collect::<HashMap<_, _>>();
        let filter = |label: &u64| by_label.get(label).is_some_and(|h| allowed.contains(*h));
        let hits = snapshot
            .graph
            .search(
                &snapshot.vectors,
                query,
                limit.min(allowed.len()),
                Some(&filter),
            )
            .map_err(|e| e.to_string())?;
        Ok(hits
            .into_iter()
            .filter_map(|hit| by_label.get(&hit.key).map(|h| (*h).clone()))
            .collect())
    }
}
pub(super) fn decode_vector(blob: &[u8], dimensions: usize) -> Result<Vec<f32>, String> {
    if blob.len() != dimensions * 4 {
        return Err("Invalid image vector dimensions".into());
    }
    let vector = blob
        .chunks_exact(4)
        .map(|b| f32::from_le_bytes(b.try_into().unwrap()))
        .collect::<Vec<_>>();
    if vector.iter().any(|v| !v.is_finite()) {
        return Err("Invalid image vector values".into());
    }
    Ok(vector)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    #[ignore = "explicit synthetic image ANN before/after latency probe"]
    fn image_ann_scale_probe() {
        use super::super::similarity::cosine_similarity;
        let temp = crate::test_support::TestDir::new("image-ann-scale");
        let connection = Connection::open_in_memory().unwrap();
        super::super::images::ensure_schema(&connection).unwrap();
        let mut state = 73u64;
        let mut next = || {
            state ^= state << 13;
            state ^= state >> 7;
            state ^= state << 17;
            ((state >> 32) as u32 as f32 / u32::MAX as f32) * 2.0 - 1.0
        };
        let count = 3000usize;
        let dimensions = 768usize;
        let mut queries = Vec::new();
        for i in 0..count {
            let mut vector = (0..dimensions).map(|_| next()).collect::<Vec<_>>();
            super::super::embed::normalize_vector(&mut vector);
            if i % 150 == 0 {
                queries.push(vector.clone());
            }
            let blob: Vec<u8> = vector.iter().flat_map(|v| v.to_le_bytes()).collect();
            connection
                .execute(
                    "INSERT INTO image_vectors VALUES (?1,'bench',?2)",
                    rusqlite::params![format!("image-{i}"), blob],
                )
                .unwrap();
        }
        let ann = ImageAnnIndex::new(temp.path().join("cache"));
        let start = std::time::Instant::now();
        ann.reconcile(&connection, "bench", dimensions, || Ok(()))
            .unwrap();
        let build_ms = start.elapsed().as_secs_f64() * 1000.0;
        let allowed = (0..count).map(|i| format!("image-{i}")).collect();
        let mut before = Vec::new();
        let mut after = Vec::new();
        let mut recall = 0usize;
        for query in queries {
            let start = std::time::Instant::now();
            let mut statement = connection
                .prepare("SELECT asset_hash,vector FROM image_vectors WHERE representation='bench'")
                .unwrap();
            let mut exact = statement
                .query_map([], |r| {
                    Ok((r.get::<_, String>(0)?, r.get::<_, Vec<u8>>(1)?))
                })
                .unwrap()
                .map(|row| {
                    let (hash, blob) = row.unwrap();
                    let vector = decode_vector(&blob, dimensions).unwrap();
                    (hash, cosine_similarity(&query, &vector))
                })
                .collect::<Vec<_>>();
            exact.sort_by(|a, b| b.1.total_cmp(&a.1));
            before.push(start.elapsed().as_secs_f64() * 1000.0);
            let start = std::time::Instant::now();
            let candidates = ann.candidates("bench", &query, &allowed, 128).unwrap();
            let mut ranked = candidates.into_iter().map(|hash| {
                let blob=connection.query_row("SELECT vector FROM image_vectors WHERE asset_hash=?1 AND representation='bench'",[&hash],|r|r.get::<_,Vec<u8>>(0)).unwrap();
                let vector=decode_vector(&blob,dimensions).unwrap();(hash,cosine_similarity(&query,&vector))
            }).collect::<Vec<_>>();
            ranked.sort_by(|a, b| b.1.total_cmp(&a.1));
            after.push(start.elapsed().as_secs_f64() * 1000.0);
            recall += exact[..10]
                .iter()
                .filter(|hit| ranked[..10].iter().any(|found| found.0 == hit.0))
                .count();
        }
        before.sort_by(f64::total_cmp);
        after.sort_by(f64::total_cmp);
        let denominator = before.len() * 10;
        let recall_ratio = recall as f64 / denominator as f64;
        println!(
            "IMAGE_ANN_SCALE {}",
            serde_json::json!({"count":count,"dimensions":dimensions,"queries":before.len(),"candidate_budget":128,"build_ms":build_ms,"exact_p50_ms":before[9],"exact_p95_ms":before[18],"ann_rerank_p50_ms":after[9],"ann_rerank_p95_ms":after[18],"recall_at_10":recall_ratio,"build":"debug","corpus":"deterministic synthetic unit vectors"})
        );
        assert!(recall_ratio >= 0.90, "ANN recall {recall_ratio}");
    }

    #[test]
    fn scoped_retrieval_restart_interruption_and_corrupt_snapshot_recovery() {
        let temp = crate::test_support::TestDir::new("image-ann");
        let connection = Connection::open_in_memory().unwrap();
        super::super::images::ensure_schema(&connection).unwrap();
        for i in 0..1500 {
            let angle = i as f32 * 0.004;
            let vector = [angle.cos(), angle.sin(), 0.0f32];
            let blob: Vec<u8> = vector.iter().flat_map(|v| v.to_le_bytes()).collect();
            connection
                .execute(
                    "INSERT INTO image_vectors VALUES (?1,'70',?2)",
                    rusqlite::params![format!("hash-{i:04}"), blob],
                )
                .unwrap();
        }
        let cache = temp.path().join("cache");
        let ann = ImageAnnIndex::new(cache.clone());
        ann.reconcile(&connection, "70", 3, || Ok(())).unwrap();
        let allowed = ["hash-1499".into()].into_iter().collect();
        assert_eq!(
            ann.candidates("70", &[1., 0., 0.], &allowed, 1).unwrap(),
            vec!["hash-1499"]
        );
        assert!(ann
            .candidates("140", &[1., 0., 0.], &allowed, 1)
            .unwrap()
            .is_empty());
        let all = (0..1500).map(|i| format!("hash-{i:04}")).collect();
        let hits = ann.candidates("70", &[1., 0., 0.], &all, 10).unwrap();
        assert_eq!(hits[0], "hash-0000");
        let restored = ImageAnnIndex::new(cache.clone());
        restored
            .reconcile(&connection, "70", 3, || {
                Err("must load existing generation".into())
            })
            .unwrap();
        assert_eq!(
            restored.candidates("70", &[1., 0., 0.], &all, 10).unwrap(),
            hits
        );
        let before = fs::read(cache.join("image-hnsw.manifest.json")).unwrap();
        connection
            .execute("DELETE FROM image_vectors WHERE asset_hash='hash-0001'", [])
            .unwrap();
        assert!(ann
            .reconcile(&connection, "70", 3, || Err("interrupted".into()))
            .is_err());
        assert_eq!(
            fs::read(cache.join("image-hnsw.manifest.json")).unwrap(),
            before
        );
        assert_eq!(
            ann.candidates("70", &[1., 0., 0.], &allowed, 1).unwrap(),
            vec!["hash-1499"]
        );
        let old_snapshot = ann.snapshot().unwrap().unwrap();
        for i in 2..12 {
            connection
                .execute(
                    "DELETE FROM image_vectors WHERE asset_hash=?1",
                    [format!("hash-{i:04}")],
                )
                .unwrap();
            ann.reconcile(&connection, "70", 3, || Ok(())).unwrap();
        }
        assert_eq!(old_snapshot.sources.len(), 1500);
        assert_eq!(ann.snapshot().unwrap().unwrap().sources.len(), 1489);
        assert!(fs::read_dir(&cache).unwrap().count() <= 8);
        fs::write(cache.join("image-hnsw.manifest.json"), b"corrupt").unwrap();
        let repaired = ImageAnnIndex::new(cache.clone());
        repaired.reconcile(&connection, "70", 3, || Ok(())).unwrap();
        assert_eq!(
            repaired
                .candidates("70", &[1., 0., 0.], &allowed, 1)
                .unwrap(),
            vec!["hash-1499"]
        );
    }
}
