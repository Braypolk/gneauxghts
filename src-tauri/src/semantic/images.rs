//! Image work is derived from current ordinary notes by the semantic worker.
//! Cache identity includes bytes, model, preprocessing, and vision budget.
use super::{
    db::{content_hash, load_note_record},
    embed::EmbeddingProvider,
    image_inventory,
    similarity::cosine_similarity,
};
use crate::asset_paths::resolve_asset_image_path;
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::{collections::HashSet, fs, io::Read, path::Path, sync::Arc};

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ImageMatch {
    pub(crate) note_id: String,
    pub(crate) note_path: String,
    pub(crate) note_title: String,
    pub(crate) note_hash: String,
    pub(crate) asset_name: String,
    pub(crate) asset_hash: String,
    pub(crate) source_start: usize,
    pub(crate) source_end: usize,
    pub(crate) score: f32,
}

#[derive(Default, Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ImageCoverage {
    pub(crate) indexed: usize,
    pub(crate) failed: usize,
    pub(crate) unsupported: usize,
}

pub(super) fn ensure_schema(connection: &Connection) -> Result<(), String> {
    connection
        .execute_batch(
            "CREATE TABLE IF NOT EXISTS image_vectors (
        asset_hash TEXT NOT NULL, representation TEXT NOT NULL, vector BLOB NOT NULL,
        PRIMARY KEY(asset_hash, representation));
        CREATE TABLE IF NOT EXISTS image_occurrences (
        note_path TEXT NOT NULL REFERENCES notes(path) ON DELETE CASCADE ON UPDATE CASCADE,
        source_start INTEGER NOT NULL, source_end INTEGER NOT NULL, note_hash TEXT NOT NULL,
        asset_name TEXT NOT NULL, asset_hash TEXT NOT NULL, representation TEXT NOT NULL,
        error TEXT, PRIMARY KEY(note_path, source_start));
        CREATE INDEX IF NOT EXISTS image_reverse_references ON image_occurrences(asset_name);",
        )
        .map_err(|e| e.to_string())
}

pub(super) fn coverage(
    connection: &Connection,
    representation: &str,
) -> Result<ImageCoverage, String> {
    ensure_schema(connection)?;
    connection.query_row("SELECT COALESCE(SUM(error IS NULL),0), COALESCE(SUM(error IS NOT NULL AND error NOT LIKE '[unsupported]%'),0), COALESCE(SUM(error LIKE '[unsupported]%'),0) FROM image_occurrences WHERE representation=?1", [representation], |r| Ok(ImageCoverage { indexed: r.get(0)?, failed: r.get(1)?, unsupported: r.get(2)? })).map_err(|e| e.to_string())
}

pub(crate) fn read_asset(root: &Path, name: &str) -> Result<Vec<u8>, String> {
    let path = resolve_asset_image_path(&root.join("assets"), name)?;
    let file = fs::File::open(path).map_err(|e| e.to_string())?;
    let mut bytes = Vec::new();
    file.take((super::image_input::MAX_ENCODED_BYTES + 1) as u64)
        .read_to_end(&mut bytes)
        .map_err(|e| e.to_string())?;
    if bytes.len() > super::image_input::MAX_ENCODED_BYTES {
        return Err("Image exceeds the 20 MiB limit.".into());
    }
    Ok(bytes)
}

pub(super) fn reconcile(
    connection: &mut Connection,
    root: &Path,
    provider: &Arc<dyn EmbeddingProvider + Send + Sync>,
    ann: &super::image_ann::ImageAnnIndex,
    mut checkpoint: impl FnMut() -> Result<(), String>,
) -> Result<usize, String> {
    let Some(representation) = provider.image_representation() else {
        return Ok(0);
    };
    ensure_schema(connection)?;
    let notes = {
        let mut statement = connection
            .prepare("SELECT path,content_hash FROM notes WHERE document_kind='note'")
            .map_err(|e| e.to_string())?;
        let rows = statement
            .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))
            .map_err(|e| e.to_string())?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?
    };
    let mut embedded_count = 0;
    for (path, note_hash) in notes {
        checkpoint()?;
        if provider.image_representation().as_deref() != Some(&representation) {
            return Err(
                "Image detail changed during indexing; the new profile will be retried.".into(),
            );
        }
        let Ok(markdown) = fs::read_to_string(&path) else {
            continue;
        };
        if content_hash(&markdown) != note_hash || !crate::note::semantic_recall_eligible(&markdown)
        {
            continue;
        }
        let mut inventory = Vec::new();
        for occurrence in image_inventory::parse(&editor_body(&markdown, &path)) {
            checkpoint()?;
            let mut asset_hash = String::new();
            let result = (|| {
                let extension = Path::new(&occurrence.asset)
                    .extension()
                    .unwrap_or_default()
                    .to_string_lossy()
                    .to_ascii_lowercase();
                if !matches!(extension.as_str(), "png" | "jpg" | "jpeg" | "webp") {
                    return Err(
                        "[unsupported] Image search supports PNG, JPEG and static WebP.".into(),
                    );
                }
                let bytes = read_asset(root, &occurrence.asset)?;
                asset_hash = blake3::hash(&bytes).to_hex().to_string();
                let cached: bool = connection.query_row("SELECT EXISTS(SELECT 1 FROM image_vectors WHERE asset_hash=?1 AND representation=?2)", params![asset_hash, representation], |r| r.get(0)).map_err(|e| e.to_string())?;
                if !cached {
                    let vector = provider.embed_image(&bytes)?;
                    if provider.image_representation().as_deref() != Some(&representation) {
                        return Err("Image detail changed before publication.".into());
                    }
                    if blake3::hash(&read_asset(root, &occurrence.asset)?)
                        .to_hex()
                        .as_str()
                        != asset_hash
                    {
                        return Err("Image changed during indexing.".into());
                    }
                    let blob: Vec<u8> = vector.iter().flat_map(|v| v.to_le_bytes()).collect();
                    connection
                        .execute(
                            "INSERT OR IGNORE INTO image_vectors VALUES (?1,?2,?3)",
                            params![asset_hash, representation, blob],
                        )
                        .map_err(|e| e.to_string())?;
                    embedded_count += 1;
                }
                Ok::<_, String>(())
            })();
            inventory.push((occurrence, asset_hash, result.err()));
        }
        // Validate both source bytes and the durable text source before one
        // transaction replaces this note's occurrence inventory.
        if fs::read_to_string(&path)
            .map(|m| content_hash(&m))
            .ok()
            .as_deref()
            != Some(&note_hash)
            || load_note_record(connection, &path)?.is_none_or(|n| n.content_hash != note_hash)
            || provider.image_representation().as_deref() != Some(&representation)
        {
            continue;
        }
        let transaction = connection.transaction().map_err(|e| e.to_string())?;
        transaction
            .execute("DELETE FROM image_occurrences WHERE note_path=?1", [&path])
            .map_err(|e| e.to_string())?;
        for (occurrence, hash, error) in inventory {
            transaction
                .execute(
                    "INSERT INTO image_occurrences VALUES (?1,?2,?3,?4,?5,?6,?7,?8)",
                    params![
                        path,
                        occurrence.from,
                        occurrence.to,
                        note_hash,
                        occurrence.asset,
                        hash,
                        representation,
                        error
                    ],
                )
                .map_err(|e| e.to_string())?;
        }
        transaction.commit().map_err(|e| e.to_string())?;
    }
    // Occurrences are eligibility; orphan vectors are only disposable caches.
    connection.execute("DELETE FROM image_vectors WHERE NOT EXISTS (SELECT 1 FROM image_occurrences o WHERE o.asset_hash=image_vectors.asset_hash AND o.representation=image_vectors.representation)", []).map_err(|e| e.to_string())?;
    ann.reconcile(
        connection,
        &representation,
        provider.model_info().dimensions,
        checkpoint,
    )?;
    Ok(embedded_count)
}

pub(super) fn search(
    ann: &super::image_ann::ImageAnnIndex,
    connection: &Connection,
    root: &Path,
    representation: &str,
    query: &[f32],
    allowed: Option<&HashSet<String>>,
    minimum_score: f32,
    limit: usize,
) -> Result<Vec<ImageMatch>, String> {
    if limit == 0 {
        return Ok(Vec::new());
    }
    ensure_schema(connection)?;
    // Read small occurrence metadata; vector bytes are fetched only for ANN
    // candidates. Scope enters before the graph's candidate limit.
    let mut statement = connection.prepare("SELECT n.note_id,n.path,n.title,o.note_hash,o.asset_name,o.asset_hash,o.source_start,o.source_end
        FROM image_occurrences o JOIN notes n ON n.path=o.note_path
        WHERE o.representation=?1 AND o.error IS NULL AND n.content_hash=o.note_hash AND n.document_kind='note'").map_err(|e| e.to_string())?;
    let rows = statement
        .query_map([representation], |r| {
            Ok(ImageMatch {
                note_id: r.get(0)?,
                note_path: r.get(1)?,
                note_title: r.get(2)?,
                note_hash: r.get(3)?,
                asset_name: r.get(4)?,
                asset_hash: r.get(5)?,
                source_start: r.get(6)?,
                source_end: r.get(7)?,
                score: 0.0,
            })
        })
        .map_err(|e| e.to_string())?;
    let mut occurrences = std::collections::HashMap::<String, Vec<ImageMatch>>::new();
    for row in rows {
        let item = row.map_err(|e| e.to_string())?;
        if allowed.is_none_or(|paths| paths.contains(&item.note_path)) {
            occurrences
                .entry(item.asset_hash.clone())
                .or_default()
                .push(item);
        }
    }
    let eligible = occurrences.keys().cloned().collect::<HashSet<_>>();
    let mut budget = limit.saturating_mul(8).max(96).min(eligible.len());
    let mut load = connection
        .prepare("SELECT vector FROM image_vectors WHERE asset_hash=?1 AND representation=?2")
        .map_err(|e| e.to_string())?;
    loop {
        let hashes = ann.candidates(representation, query, &eligible, budget)?;
        let mut candidates = Vec::new();
        for hash in hashes {
            let blob = load
                .query_row(params![hash, representation], |r| r.get::<_, Vec<u8>>(0))
                .map_err(|e| e.to_string())?;
            let vector = super::image_ann::decode_vector(&blob, query.len())?;
            let score = cosine_similarity(query, &vector);
            if score.is_finite() && score >= minimum_score {
                for item in &occurrences[&hash] {
                    let mut item = item.clone();
                    item.score = score;
                    candidates.push(item);
                }
            }
        }
        candidates.sort_by(|a, b| {
            b.score
                .total_cmp(&a.score)
                .then(a.note_path.cmp(&b.note_path))
                .then(a.source_start.cmp(&b.source_start))
        });
        let admitted_count = candidates.len();
        let mut seen = HashSet::new();
        let mut results = Vec::new();
        for item in candidates {
            let key = (item.note_path.clone(), item.asset_hash.clone());
            if !seen.contains(&key) && is_current(root, &item) {
                seen.insert(key);
                results.push(item);
                if results.len() >= limit.min(20) {
                    break;
                }
            }
        }
        if results.len() >= limit.min(20)
            || budget >= eligible.len().min(1024)
            || admitted_count == 0
        {
            return Ok(results);
        }
        budget = budget.saturating_mul(2).min(eligible.len()).min(1024);
    }
}

pub(crate) fn is_current(root: &Path, item: &ImageMatch) -> bool {
    if crate::state::is_forgotten_note_path(Path::new(&item.note_path), root) {
        return false;
    }
    let Ok(markdown) = fs::read_to_string(&item.note_path) else {
        return false;
    };
    let contained = Path::new(&item.note_path)
        .canonicalize()
        .ok()
        .zip(root.canonicalize().ok())
        .is_some_and(|(p, r)| p.starts_with(r));
    contained
        && crate::note::semantic_recall_eligible(&markdown)
        && content_hash(&markdown) == item.note_hash
        && image_inventory::parse(&editor_body(&markdown, &item.note_path))
            .iter()
            .any(|o| {
                o.asset == item.asset_name && o.from == item.source_start && o.to == item.source_end
            })
        && read_asset(root, &item.asset_name)
            .is_ok_and(|b| blake3::hash(&b).to_hex().as_str() == item.asset_hash)
}

pub(crate) fn editor_body(markdown: &str, path: &str) -> String {
    let fallback = Path::new(path)
        .file_stem()
        .unwrap_or_default()
        .to_string_lossy();
    crate::note::extract_file_name_title_and_body(markdown, &fallback).1
}

#[cfg(test)]
mod tests {
    use super::super::{
        db::{self, SemanticNoteMetadata},
        embed::{EmbeddingInputKind, ModelInfo},
    };
    use super::*;
    use std::sync::{
        atomic::{AtomicUsize, Ordering},
        Mutex,
    };
    struct Provider {
        profile: Mutex<String>,
        images: AtomicUsize,
    }
    impl EmbeddingProvider for Provider {
        fn prepare(&self) -> Result<(), String> {
            Ok(())
        }
        fn shutdown(&self) {}
        fn embed_texts(
            &self,
            _: &[String],
            _: EmbeddingInputKind,
        ) -> Result<Vec<Vec<f32>>, String> {
            panic!("image reconciliation must not embed text")
        }
        fn embed_image(&self, bytes: &[u8]) -> Result<Vec<f32>, String> {
            if bytes == b"bad" {
                return Err("corrupt image".into());
            }
            self.images.fetch_add(1, Ordering::Relaxed);
            Ok(vec![1.0, 0.0, 0.0])
        }
        fn image_representation(&self) -> Option<String> {
            Some(self.profile.lock().unwrap().clone())
        }
        fn model_info(&self) -> ModelInfo {
            ModelInfo {
                id: "test".into(),
                label: "test".into(),
                dimensions: 3,
                runtime_binary_path: None,
                model_path: None,
                model_repo_id: "test".into(),
                available: true,
                loading: false,
                ready: true,
                status: "ready".into(),
                error: None,
            }
        }
    }
    fn seed(connection: &mut Connection, path: &Path, markdown: &str) {
        fs::write(path, markdown).unwrap();
        db::upsert_note_chunks(
            connection,
            &path.to_string_lossy(),
            "Images",
            1,
            &content_hash(markdown),
            "",
            "",
            crate::note::DocumentKind::Note,
            &SemanticNoteMetadata::default(),
            &[],
            &[],
        )
        .unwrap();
    }
    #[test]
    fn duplicate_bytes_profile_switch_asset_replacement_and_deletion() {
        let temp = crate::test_support::TestDir::new("image-index");
        let root = temp.path();
        fs::create_dir(root.join("assets")).unwrap();
        fs::write(root.join("assets/a.png"), b"same image").unwrap();
        fs::write(root.join("assets/b.png"), b"same image").unwrap();
        fs::write(root.join("assets/bad.png"), b"bad").unwrap();
        let path = root.join("Images.md");
        let markdown = "# Images\n\n😀 ![[a.png]] ![[b.png]] ![[bad.png]]";
        let mut connection = db::open_database(&root.join("index.sqlite3")).unwrap();
        db::ensure_schema(&connection).unwrap();
        seed(&mut connection, &path, markdown);
        let concrete = Arc::new(Provider {
            profile: Mutex::new("70".into()),
            images: AtomicUsize::new(0),
        });
        let provider: Arc<dyn EmbeddingProvider + Send + Sync> = concrete.clone();
        let ann = super::super::image_ann::ImageAnnIndex::new(root.join("image-cache"));
        assert_eq!(
            reconcile(&mut connection, root, &provider, &ann, || Ok(())).unwrap(),
            1
        );
        assert_eq!(concrete.images.load(Ordering::Relaxed), 1);
        let covered = coverage(&connection, "70").unwrap();
        assert_eq!((covered.indexed, covered.failed), (2, 1));
        let results = search(
            &ann,
            &connection,
            root,
            "70",
            &[1.0, 0.0, 0.0],
            None,
            0.25,
            12,
        )
        .unwrap();
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].source_start, 3);
        let allowed = HashSet::new();
        assert!(search(
            &ann,
            &connection,
            root,
            "70",
            &[1.0, 0.0, 0.0],
            Some(&allowed),
            0.25,
            12
        )
        .unwrap()
        .is_empty());
        assert_eq!(
            reconcile(&mut connection, root, &provider, &ann, || Ok(())).unwrap(),
            0
        );
        *concrete.profile.lock().unwrap() = "140".into();
        assert_eq!(
            reconcile(&mut connection, root, &provider, &ann, || Ok(())).unwrap(),
            1
        );
        assert_eq!(coverage(&connection, "70").unwrap().indexed, 0);
        fs::write(root.join("assets/a.png"), b"new bytes").unwrap();
        assert!(!is_current(root, &results[0]));
        assert_eq!(
            reconcile(&mut connection, root, &provider, &ann, || Ok(())).unwrap(),
            1
        );
        assert_eq!(
            search(
                &ann,
                &connection,
                root,
                "140",
                &[1.0, 0.0, 0.0],
                None,
                0.25,
                12
            )
            .unwrap()
            .len(),
            2
        );
        // A removed occurrence is unavailable before the worker catches up.
        fs::write(&path, "# Images\n\nNo images").unwrap();
        assert!(search(
            &ann,
            &connection,
            root,
            "140",
            &[1.0, 0.0, 0.0],
            None,
            0.25,
            12
        )
        .unwrap()
        .is_empty());
        db::delete_note(&mut connection, &path.to_string_lossy()).unwrap();
        reconcile(&mut connection, root, &provider, &ann, || Ok(())).unwrap();
        assert_eq!(coverage(&connection, "140").unwrap().indexed, 0);
        assert_eq!(
            connection
                .query_row("SELECT COUNT(*) FROM image_vectors", [], |r| r
                    .get::<_, usize>(0))
                .unwrap(),
            0
        );
    }
}
