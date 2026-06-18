use super::{chunking::SemanticChunk, embed::mean_pool, SemanticIndexJob, SemanticSettings};
use crate::time::current_time_millis;
use blake3::hash;
use rusqlite::{params, Connection, OptionalExtension};
use std::{
    cmp::Reverse,
    collections::{BinaryHeap, HashMap, HashSet},
    fs,
    path::Path,
};

const SETTINGS_KEY: &str = "semantic_settings";
const SQLITE_SAFE_VARIABLE_LIMIT: usize = 900;
const SQLITE_SAFE_DOUBLE_IN_LIMIT: usize = SQLITE_SAFE_VARIABLE_LIMIT / 2;

#[derive(Clone)]
pub(crate) struct StoredChunkEmbedding {
    pub(crate) text_hash: String,
    pub(crate) embedding: Vec<f32>,
}

#[derive(Clone)]
pub(crate) struct StoredChunkRow {
    pub(crate) note_path: String,
    pub(crate) note_title: String,
    pub(crate) section_label: String,
    pub(crate) text: String,
    pub(crate) start_line: usize,
    pub(crate) end_line: usize,
    pub(crate) embedding: Vec<f32>,
}

pub(crate) struct StoredNoteEmbedding {
    pub(crate) note_path: String,
    pub(crate) embedding: Vec<f32>,
}

pub(crate) struct StoredRelatedNotePreview {
    pub(crate) note_path: String,
    pub(crate) note_title: String,
    pub(crate) section_label: String,
    pub(crate) text: String,
    pub(crate) start_line: usize,
    pub(crate) end_line: usize,
    pub(crate) score: f32,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct AnnIndexSignature {
    pub(crate) chunk_count: usize,
    pub(crate) max_indexed_at_millis: Option<u64>,
}

#[derive(Clone)]
pub(crate) struct StoredNoteRecord {
    pub(crate) modified_millis: u64,
    pub(crate) content_hash: String,
}

pub(crate) fn open_database(path: &Path) -> Result<Connection, String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|err| err.to_string())?;
    }

    let connection = Connection::open(path).map_err(|err| err.to_string())?;
    connection
        .pragma_update(None, "journal_mode", "WAL")
        .map_err(|err| err.to_string())?;
    connection
        .pragma_update(None, "synchronous", "NORMAL")
        .map_err(|err| err.to_string())?;
    Ok(connection)
}

pub(crate) fn ensure_schema(connection: &Connection) -> Result<(), String> {
    connection
        .execute_batch(
            "
            CREATE TABLE IF NOT EXISTS notes (
                path TEXT PRIMARY KEY,
                title TEXT NOT NULL,
                modified_millis INTEGER NOT NULL,
                content_hash TEXT NOT NULL,
                chunk_count INTEGER NOT NULL,
                indexed_at_millis INTEGER NOT NULL,
                created_at TEXT NOT NULL DEFAULT '',
                updated_at TEXT NOT NULL DEFAULT ''
            );

            CREATE TABLE IF NOT EXISTS chunks (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                note_path TEXT NOT NULL,
                ordinal INTEGER NOT NULL,
                ann_label INTEGER,
                section_label TEXT NOT NULL,
                text TEXT NOT NULL,
                text_hash TEXT NOT NULL,
                start_line INTEGER NOT NULL,
                end_line INTEGER NOT NULL,
                embedding_blob BLOB NOT NULL,
                embedding_dim INTEGER NOT NULL,
                indexed_at_millis INTEGER NOT NULL,
                UNIQUE(note_path, ordinal)
            );

            CREATE TABLE IF NOT EXISTS note_embeddings (
                note_path TEXT PRIMARY KEY,
                embedding_blob BLOB NOT NULL,
                embedding_dim INTEGER NOT NULL,
                indexed_at_millis INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS edges (
                source_note_path TEXT NOT NULL,
                target_note_path TEXT NOT NULL,
                score REAL NOT NULL,
                updated_at_millis INTEGER NOT NULL,
                PRIMARY KEY(source_note_path, target_note_path)
            );

            CREATE TABLE IF NOT EXISTS settings (
                key TEXT PRIMARY KEY,
                value_json TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS index_jobs (
                id INTEGER PRIMARY KEY,
                status TEXT NOT NULL,
                scanned_count INTEGER NOT NULL,
                embedded_count INTEGER NOT NULL,
                error_text TEXT,
                started_at_millis INTEGER NOT NULL,
                updated_at_millis INTEGER NOT NULL
            );
            ",
        )
        .map_err(|err| err.to_string())?;

    migrate_chunk_ann_labels(connection)?;
    migrate_note_columns(connection)?;
    migrate_graph_positions(connection)
}

pub(crate) fn load_semantic_settings(
    connection: &Connection,
) -> Result<Option<SemanticSettings>, String> {
    connection
        .query_row(
            "SELECT value_json FROM settings WHERE key = ?1",
            params![SETTINGS_KEY],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(|err| err.to_string())?
        .map(|value_json| serde_json::from_str(&value_json).map_err(|err| err.to_string()))
        .transpose()
}

pub(crate) fn save_semantic_settings(
    connection: &Connection,
    settings: &SemanticSettings,
) -> Result<(), String> {
    let value_json = serde_json::to_string(settings).map_err(|err| err.to_string())?;
    connection
        .execute(
            "
            INSERT INTO settings (key, value_json)
            VALUES (?1, ?2)
            ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json
            ",
            params![SETTINGS_KEY, value_json],
        )
        .map_err(|err| err.to_string())?;
    Ok(())
}

pub(crate) fn load_stored_note_records(
    connection: &Connection,
) -> Result<HashMap<String, StoredNoteRecord>, String> {
    let mut statement = connection
        .prepare("SELECT path, modified_millis, content_hash FROM notes")
        .map_err(|err| err.to_string())?;
    let mut rows = statement.query([]).map_err(|err| err.to_string())?;
    let mut notes = HashMap::new();

    while let Some(row) = rows.next().map_err(|err| err.to_string())? {
        notes.insert(
            row.get::<_, String>(0).map_err(|err| err.to_string())?,
            StoredNoteRecord {
                modified_millis: row.get::<_, u64>(1).map_err(|err| err.to_string())?,
                content_hash: row.get::<_, String>(2).map_err(|err| err.to_string())?,
            },
        );
    }

    Ok(notes)
}

pub(crate) fn load_note_record(
    connection: &Connection,
    note_path: &str,
) -> Result<Option<StoredNoteRecord>, String> {
    connection
        .query_row(
            "
            SELECT modified_millis, content_hash
            FROM notes
            WHERE path = ?1
            ",
            params![note_path],
            |row| {
                Ok(StoredNoteRecord {
                    modified_millis: row.get(0)?,
                    content_hash: row.get(1)?,
                })
            },
        )
        .optional()
        .map_err(|err| err.to_string())
}

pub(crate) fn load_existing_chunk_embeddings(
    connection: &Connection,
    note_path: &str,
) -> Result<HashMap<usize, StoredChunkEmbedding>, String> {
    let mut statement = connection
        .prepare(
            "
            SELECT ordinal, text_hash, embedding_blob
            FROM chunks
            WHERE note_path = ?1
            ",
        )
        .map_err(|err| err.to_string())?;
    let mut rows = statement
        .query(params![note_path])
        .map_err(|err| err.to_string())?;
    let mut chunks = HashMap::new();

    while let Some(row) = rows.next().map_err(|err| err.to_string())? {
        let ordinal = row.get::<_, usize>(0).map_err(|err| err.to_string())?;
        let text_hash = row.get::<_, String>(1).map_err(|err| err.to_string())?;
        let embedding_blob = row.get::<_, Vec<u8>>(2).map_err(|err| err.to_string())?;
        chunks.insert(
            ordinal,
            StoredChunkEmbedding {
                text_hash,
                embedding: deserialize_embedding(&embedding_blob),
            },
        );
    }

    Ok(chunks)
}

#[allow(clippy::too_many_arguments)]
pub(crate) fn upsert_note_chunks(
    connection: &mut Connection,
    note_path: &str,
    title: &str,
    modified_millis: u64,
    content_hash: &str,
    created_at: &str,
    updated_at: &str,
    chunks: &[SemanticChunk],
    embeddings: &[Vec<f32>],
) -> Result<(), String> {
    let indexed_at_millis = current_time_millis()?;
    let transaction = connection.transaction().map_err(|err| err.to_string())?;
    transaction
        .execute(
            "DELETE FROM chunks WHERE note_path = ?1",
            params![note_path],
        )
        .map_err(|err| err.to_string())?;

    for (chunk, embedding) in chunks.iter().zip(embeddings.iter()) {
        let ann_label = ann_label_for(note_path, chunk.ordinal);
        transaction
            .execute(
                "
                INSERT INTO chunks (
                    note_path,
                    ordinal,
                    ann_label,
                    section_label,
                    text,
                    text_hash,
                    start_line,
                    end_line,
                    embedding_blob,
                    embedding_dim,
                    indexed_at_millis
                )
                VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
                ",
                params![
                    note_path,
                    chunk.ordinal,
                    ann_label,
                    chunk.section_label,
                    chunk.text,
                    chunk.text_hash,
                    chunk.start_line,
                    chunk.end_line,
                    serialize_embedding(embedding),
                    embedding.len(),
                    indexed_at_millis,
                ],
            )
            .map_err(|err| err.to_string())?;
    }

    transaction
        .execute(
            "
            INSERT INTO notes (
                path,
                title,
                modified_millis,
                content_hash,
                chunk_count,
                indexed_at_millis,
                created_at,
                updated_at
            )
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
            ON CONFLICT(path) DO UPDATE SET
                title = excluded.title,
                modified_millis = excluded.modified_millis,
                content_hash = excluded.content_hash,
                chunk_count = excluded.chunk_count,
                indexed_at_millis = excluded.indexed_at_millis,
                created_at = excluded.created_at,
                updated_at = excluded.updated_at
            ",
            params![
                note_path,
                title,
                modified_millis,
                content_hash,
                chunks.len(),
                indexed_at_millis,
                created_at,
                updated_at,
            ],
        )
        .map_err(|err| err.to_string())?;

    let note_embedding = mean_pool(embeddings);
    transaction
        .execute(
            "
            INSERT INTO note_embeddings (note_path, embedding_blob, embedding_dim, indexed_at_millis)
            VALUES (?1, ?2, ?3, ?4)
            ON CONFLICT(note_path) DO UPDATE SET
                embedding_blob = excluded.embedding_blob,
                embedding_dim = excluded.embedding_dim,
                indexed_at_millis = excluded.indexed_at_millis
            ",
            params![
                note_path,
                serialize_embedding(&note_embedding),
                note_embedding.len(),
                indexed_at_millis,
            ],
        )
        .map_err(|err| err.to_string())?;
    transaction.commit().map_err(|err| err.to_string())
}

pub(crate) fn delete_note(connection: &mut Connection, note_path: &str) -> Result<(), String> {
    let transaction = connection.transaction().map_err(|err| err.to_string())?;
    transaction
        .execute(
            "DELETE FROM chunks WHERE note_path = ?1",
            params![note_path],
        )
        .map_err(|err| err.to_string())?;
    transaction
        .execute(
            "DELETE FROM note_embeddings WHERE note_path = ?1",
            params![note_path],
        )
        .map_err(|err| err.to_string())?;
    transaction
        .execute("DELETE FROM notes WHERE path = ?1", params![note_path])
        .map_err(|err| err.to_string())?;
    transaction
        .execute(
            "DELETE FROM edges WHERE source_note_path = ?1 OR target_note_path = ?1",
            params![note_path],
        )
        .map_err(|err| err.to_string())?;
    transaction.commit().map_err(|err| err.to_string())
}

/// Re-key every stored row for a note from `old_path` to `new_path` without
/// recomputing any embeddings. Used when a note is renamed/moved on disk: the
/// content is unchanged, so the existing chunk and note embeddings are reused
/// verbatim (zero embedding-server calls).
///
/// The `chunks.ann_label` is derived from the note path (see [`ann_label_for`]),
/// so each chunk row is re-stamped with a label for the new path. Because the
/// ANN labels change, callers MUST trigger an ANN rebuild afterwards. Edges are
/// dropped here and regenerated by the normal edge-rebuild pass.
///
/// Returns `Ok(false)` if `old_path` has no stored note row (nothing to move),
/// in which case the caller should fall back to a normal index of `new_path`.
pub(crate) fn move_note(
    connection: &mut Connection,
    old_path: &str,
    new_path: &str,
) -> Result<bool, String> {
    if old_path == new_path {
        return Ok(false);
    }
    let transaction = connection.transaction().map_err(|err| err.to_string())?;

    let note_exists = transaction
        .query_row(
            "SELECT 1 FROM notes WHERE path = ?1",
            params![old_path],
            |_| Ok(()),
        )
        .optional()
        .map_err(|err| err.to_string())?
        .is_some();
    if !note_exists {
        return Ok(false);
    }

    // Clear any rows already sitting at the destination path so the re-key
    // cannot collide with a stale entry (e.g. a prior note that lived there).
    transaction
        .execute("DELETE FROM chunks WHERE note_path = ?1", params![new_path])
        .map_err(|err| err.to_string())?;
    transaction
        .execute(
            "DELETE FROM note_embeddings WHERE note_path = ?1",
            params![new_path],
        )
        .map_err(|err| err.to_string())?;
    transaction
        .execute("DELETE FROM notes WHERE path = ?1", params![new_path])
        .map_err(|err| err.to_string())?;

    transaction
        .execute(
            "UPDATE notes SET path = ?2 WHERE path = ?1",
            params![old_path, new_path],
        )
        .map_err(|err| err.to_string())?;
    transaction
        .execute(
            "UPDATE note_embeddings SET note_path = ?2 WHERE note_path = ?1",
            params![old_path, new_path],
        )
        .map_err(|err| err.to_string())?;

    // Re-key chunks one ordinal at a time so each row gets an ann_label that
    // matches its new path.
    {
        let mut select = transaction
            .prepare("SELECT ordinal FROM chunks WHERE note_path = ?1")
            .map_err(|err| err.to_string())?;
        let ordinals = select
            .query_map(params![old_path], |row| row.get::<_, usize>(0))
            .map_err(|err| err.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|err| err.to_string())?;
        for ordinal in ordinals {
            let new_label = ann_label_for(new_path, ordinal);
            transaction
                .execute(
                    "UPDATE chunks SET note_path = ?2, ann_label = ?3 WHERE note_path = ?1 AND ordinal = ?4",
                    params![old_path, new_path, new_label, ordinal],
                )
                .map_err(|err| err.to_string())?;
        }
    }

    // Edges reference the old path on either side; drop them so the edge
    // rebuild regenerates correct links for the new path.
    transaction
        .execute(
            "DELETE FROM edges WHERE source_note_path = ?1 OR target_note_path = ?1",
            params![old_path],
        )
        .map_err(|err| err.to_string())?;

    transaction.commit().map_err(|err| err.to_string())?;
    Ok(true)
}

/// A single chunk's ANN identity plus its embedding, without the chunk text.
/// Used by the streaming ANN rebuild so the full corpus text is never
/// materialized in host memory just to (re)build the vector graph.
pub(crate) struct ChunkEmbeddingRow {
    pub(crate) ann_label: u64,
    pub(crate) note_path: String,
    pub(crate) section_label: String,
    pub(crate) embedding: Vec<f32>,
}

/// Embedding dimension of the first chunk, or `None` when there are no chunks.
pub(crate) fn load_chunk_embedding_dimensions(
    connection: &Connection,
) -> Result<Option<usize>, String> {
    connection
        .query_row("SELECT embedding_dim FROM chunks LIMIT 1", [], |row| {
            row.get::<_, usize>(0)
        })
        .optional()
        .map_err(|err| err.to_string())
}

/// Stream every chunk embedding through `handle`, one row at a time. Only one
/// embedding vector is resident at once (plus whatever the callback retains),
/// which keeps the ANN rebuild's transient memory close to the size of the
/// graph it is filling rather than 2x (graph + a materialized row Vec).
pub(crate) fn for_each_chunk_embedding<F>(
    connection: &Connection,
    mut handle: F,
) -> Result<(), String>
where
    F: FnMut(ChunkEmbeddingRow) -> Result<(), String>,
{
    let mut statement = connection
        .prepare(
            "
            SELECT ann_label, note_path, section_label, embedding_blob
            FROM chunks
            ",
        )
        .map_err(|err| err.to_string())?;
    let mut rows = statement.query([]).map_err(|err| err.to_string())?;

    while let Some(row) = rows.next().map_err(|err| err.to_string())? {
        let chunk = ChunkEmbeddingRow {
            ann_label: row.get::<_, u64>(0).map_err(|err| err.to_string())?,
            note_path: row.get::<_, String>(1).map_err(|err| err.to_string())?,
            section_label: row.get::<_, String>(2).map_err(|err| err.to_string())?,
            embedding: deserialize_embedding(
                &row.get::<_, Vec<u8>>(3).map_err(|err| err.to_string())?,
            ),
        };
        handle(chunk)?;
    }

    Ok(())
}

pub(crate) fn load_chunks_by_ann_labels(
    connection: &Connection,
    labels: &[u64],
) -> Result<Vec<StoredChunkRow>, String> {
    if labels.is_empty() {
        return Ok(Vec::new());
    }

    let mut seen = HashSet::new();
    let filtered_labels = labels
        .iter()
        .copied()
        .filter(|label| seen.insert(*label))
        .collect::<Vec<_>>();
    let placeholders = std::iter::repeat_n("?", filtered_labels.len())
        .collect::<Vec<_>>()
        .join(", ");
    let sql = format!(
        "
        SELECT c.note_path, n.title, c.section_label, c.text, c.start_line, c.end_line, c.embedding_blob
        FROM chunks c
        INNER JOIN notes n ON n.path = c.note_path
        WHERE c.ann_label IN ({placeholders})
        "
    );
    let mut statement = connection.prepare(&sql).map_err(|err| err.to_string())?;
    let params = rusqlite::params_from_iter(filtered_labels.iter());
    let mut rows = statement.query(params).map_err(|err| err.to_string())?;
    let mut chunks = Vec::new();

    while let Some(row) = rows.next().map_err(|err| err.to_string())? {
        chunks.push(StoredChunkRow {
            note_path: row.get::<_, String>(0).map_err(|err| err.to_string())?,
            note_title: row.get::<_, String>(1).map_err(|err| err.to_string())?,
            section_label: row.get::<_, String>(2).map_err(|err| err.to_string())?,
            text: row.get::<_, String>(3).map_err(|err| err.to_string())?,
            start_line: row.get::<_, usize>(4).map_err(|err| err.to_string())?,
            end_line: row.get::<_, usize>(5).map_err(|err| err.to_string())?,
            embedding: deserialize_embedding(
                &row.get::<_, Vec<u8>>(6).map_err(|err| err.to_string())?,
            ),
        });
    }

    Ok(chunks)
}

pub(crate) fn load_note_chunk_labels(
    connection: &Connection,
    note_path: &str,
) -> Result<HashSet<u64>, String> {
    let mut statement = connection
        .prepare("SELECT ann_label FROM chunks WHERE note_path = ?1")
        .map_err(|err| err.to_string())?;
    let mut rows = statement
        .query(params![note_path])
        .map_err(|err| err.to_string())?;
    let mut labels = HashSet::new();

    while let Some(row) = rows.next().map_err(|err| err.to_string())? {
        labels.insert(row.get::<_, u64>(0).map_err(|err| err.to_string())?);
    }

    Ok(labels)
}

/// Total byte length of all chunk text. Computed in SQLite (O(1) host memory)
/// purely so the profiling layer can report corpus text size `T`.
pub(crate) fn sum_chunk_text_bytes(connection: &Connection) -> Result<u64, String> {
    connection
        .query_row(
            "SELECT COALESCE(SUM(LENGTH(text)), 0) FROM chunks",
            [],
            |row| row.get::<_, i64>(0),
        )
        .map(|bytes| bytes.max(0) as u64)
        .map_err(|err| err.to_string())
}

pub(crate) fn load_ann_index_signature(
    connection: &Connection,
) -> Result<AnnIndexSignature, String> {
    let chunk_count = connection
        .query_row("SELECT COUNT(*) FROM chunks", [], |row| {
            row.get::<_, usize>(0)
        })
        .map_err(|err| err.to_string())?;
    let max_indexed_at_millis = connection
        .query_row("SELECT MAX(indexed_at_millis) FROM chunks", [], |row| {
            row.get::<_, Option<u64>>(0)
        })
        .map_err(|err| err.to_string())?;

    Ok(AnnIndexSignature {
        chunk_count,
        max_indexed_at_millis,
    })
}

pub(crate) fn load_note_embeddings(
    connection: &Connection,
) -> Result<Vec<StoredNoteEmbedding>, String> {
    let mut statement = connection
        .prepare(
            "
            SELECT n.path, e.embedding_blob
            FROM note_embeddings e
            INNER JOIN notes n ON n.path = e.note_path
            ",
        )
        .map_err(|err| err.to_string())?;
    let mut rows = statement.query([]).map_err(|err| err.to_string())?;
    let mut notes = Vec::new();

    while let Some(row) = rows.next().map_err(|err| err.to_string())? {
        notes.push(StoredNoteEmbedding {
            note_path: row.get::<_, String>(0).map_err(|err| err.to_string())?,
            embedding: deserialize_embedding(
                &row.get::<_, Vec<u8>>(1).map_err(|err| err.to_string())?,
            ),
        });
    }

    Ok(notes)
}

/// Profiling counters describing a single `rebuild_edges` pass. Returned so the
/// indexer can fold them into the semantic debug metrics without coupling this
/// module to the debug state.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub(crate) struct EdgeRebuildStats {
    pub(crate) note_count: usize,
    pub(crate) edge_count: usize,
    pub(crate) dimensions: usize,
    /// Pairwise cosine comparisons performed (`O(N^2)`); surfaced so the cost of
    /// the brute-force pass is visible as the vault grows.
    pub(crate) comparisons: u64,
}

pub(crate) fn rebuild_edges(
    connection: &mut Connection,
    neighbors_per_note: usize,
    min_score: f32,
) -> Result<EdgeRebuildStats, String> {
    // NOTE: This recomputes all pairwise note similarities, so wall-clock cost is
    // O(N^2 * D). Peak host memory is bounded: note embeddings are O(N * D) and
    // each source keeps only its top-K neighbors (O(K)) via the bounded heap
    // below, rather than collecting every above-threshold candidate. If N grows
    // large enough that the quadratic compute dominates, the next step is to
    // reuse the note-level ANN neighbors instead of brute force; `EdgeRebuildStats`
    // exists to make that threshold observable before it bites.
    let notes = load_note_embeddings(connection)?;
    let dimensions = notes.first().map(|note| note.embedding.len()).unwrap_or(0);
    let mut comparisons = 0u64;
    let updated_at_millis = current_time_millis()?;
    let transaction = connection.transaction().map_err(|err| err.to_string())?;
    transaction
        .execute("DELETE FROM edges", [])
        .map_err(|err| err.to_string())?;

    let mut heap: BinaryHeap<Reverse<ScoredNeighbor>> = BinaryHeap::new();
    for source in &notes {
        heap.clear();
        for target in &notes {
            if target.note_path == source.note_path {
                continue;
            }
            comparisons += 1;
            let score = super::similarity::cosine_similarity(&source.embedding, &target.embedding);
            if score < min_score {
                continue;
            }

            // Keep only the best `neighbors_per_note` neighbors so per-source
            // memory stays O(K) regardless of how many targets clear the
            // threshold. The min-heap evicts the current weakest neighbor once
            // it is full.
            if heap.len() < neighbors_per_note {
                heap.push(Reverse(ScoredNeighbor {
                    score,
                    note_path: target.note_path.clone(),
                }));
            } else if let Some(Reverse(weakest)) = heap.peek() {
                if score > weakest.score {
                    heap.pop();
                    heap.push(Reverse(ScoredNeighbor {
                        score,
                        note_path: target.note_path.clone(),
                    }));
                }
            }
        }

        for Reverse(neighbor) in heap.drain() {
            let (source_note_path, target_note_path) = if source.note_path <= neighbor.note_path {
                (source.note_path.as_str(), neighbor.note_path.as_str())
            } else {
                (neighbor.note_path.as_str(), source.note_path.as_str())
            };
            transaction
                .execute(
                    "
                    INSERT INTO edges (source_note_path, target_note_path, score, updated_at_millis)
                    VALUES (?1, ?2, ?3, ?4)
                    ON CONFLICT(source_note_path, target_note_path) DO UPDATE SET
                        score = max(edges.score, excluded.score),
                        updated_at_millis = excluded.updated_at_millis
                    ",
                    params![
                        source_note_path,
                        target_note_path,
                        neighbor.score,
                        updated_at_millis
                    ],
                )
                .map_err(|err| err.to_string())?;
        }
    }

    let edge_count = transaction
        .query_row("SELECT COUNT(*) FROM edges", [], |row| {
            row.get::<_, usize>(0)
        })
        .map_err(|err| err.to_string())?;
    transaction.commit().map_err(|err| err.to_string())?;
    Ok(EdgeRebuildStats {
        note_count: notes.len(),
        edge_count,
        dimensions,
        comparisons,
    })
}

#[derive(Clone, Debug)]
struct ScoredNeighbor {
    score: f32,
    note_path: String,
}

impl PartialEq for ScoredNeighbor {
    fn eq(&self, other: &Self) -> bool {
        self.score == other.score && self.note_path == other.note_path
    }
}

impl Eq for ScoredNeighbor {}

impl PartialOrd for ScoredNeighbor {
    fn partial_cmp(&self, other: &Self) -> Option<std::cmp::Ordering> {
        Some(self.cmp(other))
    }
}

impl Ord for ScoredNeighbor {
    fn cmp(&self, other: &Self) -> std::cmp::Ordering {
        // Order by score first (NaN-safe via total_cmp), then by path so the
        // ordering is total and deterministic for the heap.
        self.score
            .total_cmp(&other.score)
            .then_with(|| self.note_path.cmp(&other.note_path))
    }
}

pub(crate) fn count_indexed_items(
    connection: &Connection,
) -> Result<(usize, usize, Option<u64>), String> {
    let indexed_notes = connection
        .query_row("SELECT COUNT(*) FROM notes", [], |row| {
            row.get::<_, usize>(0)
        })
        .map_err(|err| err.to_string())?;
    let indexed_chunks = connection
        .query_row("SELECT COUNT(*) FROM chunks", [], |row| {
            row.get::<_, usize>(0)
        })
        .map_err(|err| err.to_string())?;
    let last_indexed_at_millis = connection
        .query_row("SELECT MAX(indexed_at_millis) FROM notes", [], |row| {
            row.get::<_, Option<u64>>(0)
        })
        .map_err(|err| err.to_string())?;
    Ok((indexed_notes, indexed_chunks, last_indexed_at_millis))
}

pub(crate) fn insert_job(
    connection: &Connection,
    status: &str,
    scanned_count: usize,
    embedded_count: usize,
    error_text: Option<&str>,
) -> Result<i64, String> {
    let now = current_time_millis()?;
    let job_id = now as i64;
    connection
        .execute(
            "
            INSERT INTO index_jobs (
                id,
                status,
                scanned_count,
                embedded_count,
                error_text,
                started_at_millis,
                updated_at_millis
            )
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6)
            ",
            params![
                job_id,
                status,
                scanned_count,
                embedded_count,
                error_text,
                now
            ],
        )
        .map_err(|err| err.to_string())?;
    Ok(job_id)
}

pub(crate) fn update_job(
    connection: &Connection,
    job_id: i64,
    status: &str,
    scanned_count: usize,
    embedded_count: usize,
    error_text: Option<&str>,
) -> Result<(), String> {
    let now = current_time_millis()?;
    connection
        .execute(
            "
            UPDATE index_jobs
            SET status = ?2,
                scanned_count = ?3,
                embedded_count = ?4,
                error_text = ?5,
                updated_at_millis = ?6
            WHERE id = ?1
            ",
            params![
                job_id,
                status,
                scanned_count,
                embedded_count,
                error_text,
                now
            ],
        )
        .map_err(|err| err.to_string())?;
    Ok(())
}

pub(crate) fn load_latest_job(connection: &Connection) -> Result<Option<SemanticIndexJob>, String> {
    connection
        .query_row(
            "
            SELECT id, status, scanned_count, embedded_count, error_text, started_at_millis, updated_at_millis
            FROM index_jobs
            ORDER BY updated_at_millis DESC
            LIMIT 1
            ",
            [],
            |row| {
                Ok(SemanticIndexJob {
                    id: row.get(0)?,
                    status: row.get(1)?,
                    scanned_count: row.get(2)?,
                    embedded_count: row.get(3)?,
                    error_text: row.get(4)?,
                    started_at_millis: row.get(5)?,
                    updated_at_millis: row.get(6)?,
                })
            },
        )
        .optional()
        .map_err(|err| err.to_string())
}

pub(crate) fn load_related_note_previews(
    connection: &Connection,
    note_path: &str,
    limit: usize,
) -> Result<Vec<StoredRelatedNotePreview>, String> {
    let mut statement = connection
        .prepare(
            "
            SELECT
                n.path,
                n.title,
                COALESCE((
                    SELECT c.section_label
                    FROM chunks c
                    WHERE c.note_path = n.path
                    ORDER BY CASE WHEN c.section_label = 'Title' THEN 1 ELSE 0 END, c.ordinal
                    LIMIT 1
                ), 'Title'),
                COALESCE((
                    SELECT c.text
                    FROM chunks c
                    WHERE c.note_path = n.path
                    ORDER BY CASE WHEN c.section_label = 'Title' THEN 1 ELSE 0 END, c.ordinal
                    LIMIT 1
                ), n.title),
                COALESCE((
                    SELECT c.start_line
                    FROM chunks c
                    WHERE c.note_path = n.path
                    ORDER BY CASE WHEN c.section_label = 'Title' THEN 1 ELSE 0 END, c.ordinal
                    LIMIT 1
                ), 1),
                COALESCE((
                    SELECT c.end_line
                    FROM chunks c
                    WHERE c.note_path = n.path
                    ORDER BY CASE WHEN c.section_label = 'Title' THEN 1 ELSE 0 END, c.ordinal
                    LIMIT 1
                ), 1),
                e.score
            FROM edges e
            INNER JOIN notes n
                ON n.path = CASE
                    WHEN e.source_note_path = ?1 THEN e.target_note_path
                    ELSE e.source_note_path
                END
            WHERE e.source_note_path = ?1 OR e.target_note_path = ?1
            ORDER BY e.score DESC, n.title ASC, n.path ASC
            LIMIT ?2
            ",
        )
        .map_err(|err| err.to_string())?;
    let mut rows = statement
        .query(params![note_path, limit.max(1)])
        .map_err(|err| err.to_string())?;
    let mut previews = Vec::new();

    while let Some(row) = rows.next().map_err(|err| err.to_string())? {
        previews.push(StoredRelatedNotePreview {
            note_path: row.get::<_, String>(0).map_err(|err| err.to_string())?,
            note_title: row.get::<_, String>(1).map_err(|err| err.to_string())?,
            section_label: row.get::<_, String>(2).map_err(|err| err.to_string())?,
            text: row.get::<_, String>(3).map_err(|err| err.to_string())?,
            start_line: row.get::<_, usize>(4).map_err(|err| err.to_string())?,
            end_line: row.get::<_, usize>(5).map_err(|err| err.to_string())?,
            score: row.get::<_, f32>(6).map_err(|err| err.to_string())?,
        });
    }

    Ok(previews)
}

pub(crate) fn content_hash(markdown: &str) -> String {
    hash(markdown.as_bytes()).to_hex().to_string()
}

pub(crate) fn ann_label_for(note_path: &str, ordinal: usize) -> u64 {
    let raw = hash(format!("{note_path}::{ordinal}").as_bytes())
        .as_bytes()
        .to_owned();
    u64::from_le_bytes([
        raw[0], raw[1], raw[2], raw[3], raw[4], raw[5], raw[6], raw[7],
    ]) & i64::MAX as u64
}

fn serialize_embedding(values: &[f32]) -> Vec<u8> {
    values
        .iter()
        .flat_map(|value| value.to_le_bytes())
        .collect::<Vec<_>>()
}

fn deserialize_embedding(blob: &[u8]) -> Vec<f32> {
    blob.chunks_exact(4)
        .map(|chunk| f32::from_le_bytes([chunk[0], chunk[1], chunk[2], chunk[3]]))
        .collect()
}

fn migrate_chunk_ann_labels(connection: &Connection) -> Result<(), String> {
    if !has_column(connection, "chunks", "ann_label")? {
        connection
            .execute("ALTER TABLE chunks ADD COLUMN ann_label INTEGER", [])
            .map_err(|err| err.to_string())?;
    }

    let mut statement = connection
        .prepare("SELECT id, note_path, ordinal FROM chunks WHERE ann_label IS NULL")
        .map_err(|err| err.to_string())?;
    let rows = statement
        .query_map([], |row| {
            Ok((
                row.get::<_, i64>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, usize>(2)?,
            ))
        })
        .map_err(|err| err.to_string())?;

    for row in rows {
        let (id, note_path, ordinal) = row.map_err(|err| err.to_string())?;
        let ann_label = ann_label_for(&note_path, ordinal);
        connection
            .execute(
                "UPDATE chunks SET ann_label = ?1 WHERE id = ?2",
                params![ann_label, id],
            )
            .map_err(|err| err.to_string())?;
    }

    connection
        .execute(
            "CREATE UNIQUE INDEX IF NOT EXISTS idx_chunks_ann_label ON chunks(ann_label)",
            [],
        )
        .map_err(|err| err.to_string())?;
    Ok(())
}

fn migrate_note_columns(connection: &Connection) -> Result<(), String> {
    if !has_column(connection, "notes", "created_at")? {
        connection
            .execute(
                "ALTER TABLE notes ADD COLUMN created_at TEXT NOT NULL DEFAULT ''",
                [],
            )
            .map_err(|err| err.to_string())?;
    }

    if !has_column(connection, "notes", "updated_at")? {
        connection
            .execute(
                "ALTER TABLE notes ADD COLUMN updated_at TEXT NOT NULL DEFAULT ''",
                [],
            )
            .map_err(|err| err.to_string())?;
    }

    Ok(())
}

fn migrate_graph_positions(connection: &Connection) -> Result<(), String> {
    connection
        .execute_batch(
            "
            CREATE TABLE IF NOT EXISTS graph_positions (
                note_path TEXT PRIMARY KEY,
                x REAL NOT NULL,
                y REAL NOT NULL,
                updated_at_millis INTEGER NOT NULL
            );
            ",
        )
        .map_err(|err| err.to_string())
}

pub(crate) struct StoredGraphPosition {
    pub(crate) note_path: String,
    pub(crate) x: f64,
    pub(crate) y: f64,
}

pub(crate) fn load_graph_positions_for_notes(
    connection: &Connection,
    note_paths: &[String],
) -> Result<Vec<StoredGraphPosition>, String> {
    if note_paths.is_empty() {
        return Ok(Vec::new());
    }

    let mut positions = Vec::new();

    for paths_chunk in note_paths.chunks(SQLITE_SAFE_VARIABLE_LIMIT) {
        let placeholders = std::iter::repeat_n("?", paths_chunk.len())
            .collect::<Vec<_>>()
            .join(", ");
        let sql = format!(
            "SELECT note_path, x, y FROM graph_positions WHERE note_path IN ({placeholders})"
        );
        let mut statement = connection.prepare(&sql).map_err(|err| err.to_string())?;
        let params = rusqlite::params_from_iter(paths_chunk.iter());
        let mut rows = statement.query(params).map_err(|err| err.to_string())?;

        while let Some(row) = rows.next().map_err(|err| err.to_string())? {
            positions.push(StoredGraphPosition {
                note_path: row.get::<_, String>(0).map_err(|err| err.to_string())?,
                x: row.get::<_, f64>(1).map_err(|err| err.to_string())?,
                y: row.get::<_, f64>(2).map_err(|err| err.to_string())?,
            });
        }
    }

    Ok(positions)
}

pub(crate) fn save_graph_positions(
    connection: &mut Connection,
    positions: &[(String, f64, f64)],
) -> Result<(), String> {
    let updated_at_millis = current_time_millis()?;
    let transaction = connection.transaction().map_err(|err| err.to_string())?;

    for (note_path, x, y) in positions {
        transaction
            .execute(
                "
                INSERT INTO graph_positions (note_path, x, y, updated_at_millis)
                VALUES (?1, ?2, ?3, ?4)
                ON CONFLICT(note_path) DO UPDATE SET
                    x = excluded.x,
                    y = excluded.y,
                    updated_at_millis = excluded.updated_at_millis
                ",
                params![note_path, x, y, updated_at_millis],
            )
            .map_err(|err| err.to_string())?;
    }

    transaction.commit().map_err(|err| err.to_string())
}

pub(crate) struct StoredEdge {
    pub(crate) source_note_path: String,
    pub(crate) target_note_path: String,
    pub(crate) score: f32,
}

pub(crate) fn load_all_edges_for_notes(
    connection: &Connection,
    note_paths: &[String],
) -> Result<Vec<StoredEdge>, String> {
    if note_paths.is_empty() {
        return Ok(Vec::new());
    }

    let mut edges = Vec::new();

    if note_paths.len() <= SQLITE_SAFE_DOUBLE_IN_LIMIT {
        let placeholders = std::iter::repeat_n("?", note_paths.len())
            .collect::<Vec<_>>()
            .join(", ");
        let sql = format!(
            "
            SELECT source_note_path, target_note_path, score
            FROM edges
            WHERE source_note_path IN ({placeholders})
              AND target_note_path IN ({placeholders})
            "
        );
        let mut statement = connection.prepare(&sql).map_err(|err| err.to_string())?;
        let params = rusqlite::params_from_iter(note_paths.iter().chain(note_paths.iter()));
        let mut rows = statement.query(params).map_err(|err| err.to_string())?;

        while let Some(row) = rows.next().map_err(|err| err.to_string())? {
            edges.push(StoredEdge {
                source_note_path: row.get::<_, String>(0).map_err(|err| err.to_string())?,
                target_note_path: row.get::<_, String>(1).map_err(|err| err.to_string())?,
                score: row.get::<_, f32>(2).map_err(|err| err.to_string())?,
            });
        }
    } else {
        let valid_paths: HashSet<&str> = note_paths.iter().map(String::as_str).collect();
        let mut statement = connection
            .prepare("SELECT source_note_path, target_note_path, score FROM edges")
            .map_err(|err| err.to_string())?;
        let mut rows = statement.query([]).map_err(|err| err.to_string())?;

        while let Some(row) = rows.next().map_err(|err| err.to_string())? {
            let source_note_path = row.get::<_, String>(0).map_err(|err| err.to_string())?;
            let target_note_path = row.get::<_, String>(1).map_err(|err| err.to_string())?;
            if valid_paths.contains(source_note_path.as_str())
                && valid_paths.contains(target_note_path.as_str())
            {
                edges.push(StoredEdge {
                    source_note_path,
                    target_note_path,
                    score: row.get::<_, f32>(2).map_err(|err| err.to_string())?,
                });
            }
        }
    }

    Ok(edges)
}

pub(crate) struct StoredNoteWithMeta {
    pub(crate) title: String,
    pub(crate) created_at: String,
    pub(crate) modified_millis: u64,
}

pub(crate) fn load_all_notes_with_meta_for_paths(
    connection: &Connection,
    note_paths: &[String],
) -> Result<HashMap<String, StoredNoteWithMeta>, String> {
    if note_paths.is_empty() {
        return Ok(HashMap::new());
    }

    let mut notes = HashMap::new();

    for paths_chunk in note_paths.chunks(SQLITE_SAFE_VARIABLE_LIMIT) {
        let placeholders = std::iter::repeat_n("?", paths_chunk.len())
            .collect::<Vec<_>>()
            .join(", ");
        let sql = format!(
            "
            SELECT path, title, created_at, modified_millis
            FROM notes
            WHERE path IN ({placeholders})
            "
        );
        let mut statement = connection.prepare(&sql).map_err(|err| err.to_string())?;
        let params = rusqlite::params_from_iter(paths_chunk.iter());
        let mut rows = statement.query(params).map_err(|err| err.to_string())?;

        while let Some(row) = rows.next().map_err(|err| err.to_string())? {
            let path = row.get::<_, String>(0).map_err(|err| err.to_string())?;
            notes.insert(
                path.clone(),
                StoredNoteWithMeta {
                    title: row.get::<_, String>(1).map_err(|err| err.to_string())?,
                    created_at: row.get::<_, String>(2).map_err(|err| err.to_string())?,
                    modified_millis: row.get::<_, u64>(3).map_err(|err| err.to_string())?,
                },
            );
        }
    }

    Ok(notes)
}

pub(crate) fn load_first_chunk_text_per_note_for_paths(
    connection: &Connection,
    note_paths: &[String],
) -> Result<HashMap<String, String>, String> {
    if note_paths.is_empty() {
        return Ok(HashMap::new());
    }

    let mut snippets = HashMap::new();

    for paths_chunk in note_paths.chunks(SQLITE_SAFE_VARIABLE_LIMIT) {
        let placeholders = std::iter::repeat_n("?", paths_chunk.len())
            .collect::<Vec<_>>()
            .join(", ");
        let sql = format!(
            "
            SELECT c.note_path, c.text
            FROM chunks c
            INNER JOIN (
                SELECT note_path, MIN(ordinal) AS min_ordinal
                FROM chunks
                GROUP BY note_path
            ) m ON c.note_path = m.note_path AND c.ordinal = m.min_ordinal
            WHERE c.note_path IN ({placeholders})
            "
        );
        let mut statement = connection.prepare(&sql).map_err(|err| err.to_string())?;
        let params = rusqlite::params_from_iter(paths_chunk.iter());
        let mut rows = statement.query(params).map_err(|err| err.to_string())?;

        while let Some(row) = rows.next().map_err(|err| err.to_string())? {
            snippets.insert(
                row.get::<_, String>(0).map_err(|err| err.to_string())?,
                row.get::<_, String>(1).map_err(|err| err.to_string())?,
            );
        }
    }

    Ok(snippets)
}

fn has_column(
    connection: &Connection,
    table_name: &str,
    column_name: &str,
) -> Result<bool, String> {
    let pragma = format!("PRAGMA table_info({table_name})");
    let mut statement = connection.prepare(&pragma).map_err(|err| err.to_string())?;
    let mut rows = statement.query([]).map_err(|err| err.to_string())?;

    while let Some(row) = rows.next().map_err(|err| err.to_string())? {
        let existing_name = row.get::<_, String>(1).map_err(|err| err.to_string())?;
        if existing_name == column_name {
            return Ok(true);
        }
    }

    Ok(false)
}

#[cfg(test)]
mod tests {
    use super::{
        ann_label_for, ensure_schema, for_each_chunk_embedding, open_database, rebuild_edges,
        sum_chunk_text_bytes, upsert_note_chunks,
    };
    use crate::semantic::chunking::SemanticChunk;
    use blake3::hash;
    use rusqlite::Connection;
    use std::{
        fs,
        path::PathBuf,
        time::{SystemTime, UNIX_EPOCH},
    };

    #[test]
    fn ann_labels_are_stable_for_same_chunk_identity() {
        let first = ann_label_for("notes/project.md", 3);
        let second = ann_label_for("notes/project.md", 3);
        assert_eq!(first, second);
    }

    #[test]
    fn ann_labels_change_when_path_or_ordinal_changes() {
        let baseline = ann_label_for("notes/project.md", 3);
        assert_ne!(baseline, ann_label_for("notes/project.md", 4));
        assert_ne!(baseline, ann_label_for("notes/other.md", 3));
    }

    #[test]
    fn ann_labels_fit_in_sqlite_integer_range() {
        let label = ann_label_for("notes/project.md", 3);
        assert!(label <= i64::MAX as u64);
    }

    #[test]
    fn rebuild_edges_bounds_neighbors_per_note_and_reports_stats() {
        let temp = TestDb::new("edges-bounded");
        let mut connection = temp.connection();
        // Eight identical-direction notes: every pair has cosine ~1.0, so without
        // the top-K bound this would form the complete graph (8*7/2 = 28 edges).
        let note_count = 8usize;
        let neighbors_per_note = 2usize;
        for index in 0..note_count {
            seed_note(
                &mut connection,
                &format!("notes/dense-{index}.md"),
                &[1.0, 0.0],
            );
        }

        let stats = rebuild_edges(&mut connection, neighbors_per_note, 0.5).expect("rebuild edges");
        assert_eq!(stats.note_count, note_count);
        assert_eq!(stats.dimensions, 2);
        // N sources each comparing against the other N-1.
        assert_eq!(stats.comparisons, (note_count * (note_count - 1)) as u64);

        // Each source emits at most K edges (the per-source heap is capped at K),
        // so the canonical-deduped edge set can never exceed N*K. Crucially this is
        // far below the complete graph (28) that an unbounded rebuild would store,
        // which is the memory/row blow-up the bound exists to prevent.
        assert!(stats.edge_count > 0);
        assert!(
            stats.edge_count <= note_count * neighbors_per_note,
            "edge_count {} exceeded N*K bound {}",
            stats.edge_count,
            note_count * neighbors_per_note
        );
        assert!(
            stats.edge_count < note_count * (note_count - 1) / 2,
            "edge_count {} should be well below the complete graph",
            stats.edge_count
        );
    }

    #[test]
    fn rebuild_edges_respects_min_score_threshold() {
        let temp = TestDb::new("edges-threshold");
        let mut connection = temp.connection();
        // Orthogonal notes: cosine similarity is 0, below any positive threshold.
        seed_note(&mut connection, "notes/a.md", &[1.0, 0.0]);
        seed_note(&mut connection, "notes/b.md", &[0.0, 1.0]);

        let stats = rebuild_edges(&mut connection, 4, 0.5).expect("rebuild edges");
        assert_eq!(stats.note_count, 2);
        assert_eq!(stats.edge_count, 0, "orthogonal notes must not be linked");
    }

    #[test]
    fn streaming_chunk_loader_visits_every_chunk_without_text() {
        let temp = TestDb::new("stream-chunks");
        let mut connection = temp.connection();
        seed_note(&mut connection, "notes/one.md", &[1.0, 0.0]);
        seed_note(&mut connection, "notes/two.md", &[0.0, 1.0]);

        let mut count = 0usize;
        for_each_chunk_embedding(&connection, |row| {
            count += 1;
            assert_eq!(row.embedding.len(), 2);
            Ok(())
        })
        .expect("stream chunks");
        assert_eq!(count, 2);

        // The corpus text is still queryable for profiling even though the
        // streaming loader never materializes it.
        assert!(sum_chunk_text_bytes(&connection).expect("sum text bytes") > 0);
    }

    fn seed_note(connection: &mut Connection, note_path: &str, embedding: &[f32]) {
        let chunk = SemanticChunk {
            ordinal: 0,
            section_label: "Body".to_string(),
            text: format!("text for {note_path}"),
            text_hash: hash(note_path.as_bytes()).to_hex().to_string(),
            start_line: 1,
            end_line: 1,
        };
        upsert_note_chunks(
            connection,
            note_path,
            "Seed",
            1,
            "seed-hash",
            "2026-01-01T00:00:00Z",
            "2026-01-01T00:00:00Z",
            &[chunk],
            &[embedding.to_vec()],
        )
        .expect("seed note");
    }

    struct TestDb {
        path: PathBuf,
    }

    impl TestDb {
        fn new(label: &str) -> Self {
            let unique = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("system time")
                .as_nanos();
            let dir = std::env::temp_dir().join(format!("gneauxghts-db-{label}-{unique}"));
            fs::create_dir_all(&dir).expect("create temp dir");
            Self {
                path: dir.join("semantic.sqlite3"),
            }
        }

        fn connection(&self) -> Connection {
            let connection = open_database(&self.path).expect("open database");
            ensure_schema(&connection).expect("ensure schema");
            connection
        }
    }

    impl Drop for TestDb {
        fn drop(&mut self) {
            if let Some(parent) = self.path.parent() {
                let _ = fs::remove_dir_all(parent);
            }
        }
    }
}
