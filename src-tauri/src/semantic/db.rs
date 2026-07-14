use super::{chunking::SemanticChunk, embed::mean_pool, SemanticIndexJob, SemanticSettings};
use crate::{note::DocumentKind, time::current_time_millis};
use blake3::hash;
use hnswlib_rs::{Cosine, Hnsw, HnswConfig, InMemoryVectorStore};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::{
    cmp::Reverse,
    collections::{BinaryHeap, HashMap, HashSet},
    fs,
    path::Path,
};

const SETTINGS_KEY: &str = "semantic_settings";
const EDGE_CORPUS_SIGNATURE_KEY: &str = "edge_corpus_signature";
pub(crate) const EDGE_ALGORITHM_VERSION: &str = "semantic-cosine-topk-v2";
pub(crate) const EDGE_FULL_RECONCILE_INTERVAL_MILLIS: u64 = 24 * 60 * 60 * 1_000;
pub(crate) const EDGE_MAX_INCREMENTAL_REPAIRS: usize = 100;
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
    pub(crate) document_kind: DocumentKind,
    pub(crate) block_anchor: Option<String>,
}

pub(crate) struct StoredNoteEmbedding {
    pub(crate) note_path: String,
    pub(crate) embedding: Vec<f32>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct NoteAnnSourceInventory {
    pub(crate) path: String,
    pub(crate) semantic_input_hash: String,
    pub(crate) document_kind: String,
    pub(crate) stable_ann_label: u64,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct NoteAnnIndexSignature {
    pub(crate) note_count: usize,
    pub(crate) max_indexed_at_millis: Option<u64>,
    pub(crate) identities_valid: bool,
}

pub(crate) struct NoteEmbeddingRow {
    pub(crate) stable_ann_label: u64,
    pub(crate) note_path: String,
    pub(crate) semantic_input_hash: String,
    pub(crate) embedding: Vec<f32>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct EdgeGenerationState {
    pub(crate) generation_id: String,
    pub(crate) provenance: String,
    pub(crate) note_ann_generation: String,
    pub(crate) model_signature: String,
    pub(crate) algorithm_version: String,
    pub(crate) completed_at_millis: u64,
    pub(crate) last_full_reconcile_at_millis: u64,
    pub(crate) incremental_repairs: usize,
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub(crate) struct EdgeRepairStats {
    pub(crate) dirty_count: usize,
    pub(crate) affected_count: usize,
    pub(crate) edge_count: usize,
    pub(crate) comparisons: u64,
}

#[derive(Clone)]
pub(crate) struct StoredAtlasNoteEmbedding {
    pub(crate) note_path: String,
    pub(crate) note_title: String,
    pub(crate) modified_millis: u64,
    pub(crate) semantic_input_hash: String,
    pub(crate) structure_hash: String,
    pub(crate) created_at: String,
    pub(crate) updated_at: String,
    pub(crate) embedding: Vec<f32>,
}

#[derive(Clone)]
pub(crate) struct StoredAtlasNoteMetadata {
    pub(crate) note_path: String,
    pub(crate) title: String,
    pub(crate) modified_millis: u64,
    pub(crate) document_kind: DocumentKind,
    pub(crate) note_id: String,
    pub(crate) preview: String,
    pub(crate) tags: Vec<String>,
    pub(crate) wikilink_targets: Vec<String>,
    pub(crate) chunk_count: usize,
    pub(crate) presentation_hash: String,
}

#[derive(Clone)]
pub(crate) struct StoredAtlasPosition {
    pub(crate) note_path: String,
    pub(crate) x: f32,
    pub(crate) y: f32,
}

pub(crate) struct StoredRelatedNotePreview {
    pub(crate) note_path: String,
    pub(crate) note_title: String,
    pub(crate) section_label: String,
    pub(crate) text: String,
    pub(crate) start_line: usize,
    pub(crate) end_line: usize,
    pub(crate) score: f32,
    pub(crate) document_kind: DocumentKind,
    pub(crate) block_anchor: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct AnnIndexSignature {
    pub(crate) chunk_count: usize,
    pub(crate) max_indexed_at_millis: Option<u64>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AnnSourceInventory {
    pub(crate) path: String,
    pub(crate) content_hash: String,
    pub(crate) document_kind: String,
    pub(crate) chunk_count: usize,
    pub(crate) stable_ann_label: u64,
}

pub(crate) struct StoredAnnChunk {
    pub(crate) ordinal: usize,
    pub(crate) embedding: Vec<f32>,
}

#[derive(Clone)]
pub(crate) struct StoredNoteRecord {
    pub(crate) modified_millis: u64,
    pub(crate) content_hash: String,
    pub(crate) semantic_input_hash: String,
    pub(crate) structure_hash: String,
    pub(crate) presentation_hash: String,
    pub(crate) stable_ann_label: u64,
    pub(crate) document_kind: DocumentKind,
}

#[derive(Clone, Debug, Default)]
pub(crate) struct SemanticNoteMetadata {
    pub(crate) semantic_input_hash: String,
    pub(crate) structure_hash: String,
    pub(crate) presentation_hash: String,
    pub(crate) note_id: String,
    pub(crate) preview: String,
    pub(crate) tags_json: String,
    pub(crate) wikilink_targets_json: String,
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
                updated_at TEXT NOT NULL DEFAULT '',
                document_kind TEXT NOT NULL DEFAULT 'note',
                semantic_input_hash TEXT NOT NULL DEFAULT '',
                structure_hash TEXT NOT NULL DEFAULT '',
                presentation_hash TEXT NOT NULL DEFAULT '',
                stable_ann_label INTEGER NOT NULL,
                note_id TEXT NOT NULL DEFAULT '',
                preview TEXT NOT NULL DEFAULT '',
                tags_json TEXT NOT NULL DEFAULT '[]',
                wikilink_targets_json TEXT NOT NULL DEFAULT '[]'
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
                block_anchor TEXT,
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
                generation_id TEXT NOT NULL DEFAULT '',
                provenance TEXT NOT NULL DEFAULT 'legacy',
                PRIMARY KEY(source_note_path, target_note_path)
            );

            CREATE TABLE IF NOT EXISTS edge_dirty_notes (
                note_path TEXT PRIMARY KEY,
                reason TEXT NOT NULL,
                enqueued_at_millis INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS edge_generation (
                singleton INTEGER PRIMARY KEY CHECK(singleton = 1),
                generation_id TEXT NOT NULL,
                provenance TEXT NOT NULL,
                note_ann_generation TEXT NOT NULL,
                model_signature TEXT NOT NULL,
                algorithm_version TEXT NOT NULL,
                completed_at_millis INTEGER NOT NULL,
                last_full_reconcile_at_millis INTEGER NOT NULL,
                incremental_repairs INTEGER NOT NULL
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

            CREATE TABLE IF NOT EXISTS atlas_positions (
                note_path TEXT PRIMARY KEY,
                x REAL NOT NULL,
                y REAL NOT NULL,
                updated_at_millis INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS atlas_label_embeddings (
                normalized_phrase TEXT NOT NULL,
                model_fingerprint TEXT NOT NULL,
                algorithm_version TEXT NOT NULL,
                embedding_blob BLOB NOT NULL,
                embedding_dim INTEGER NOT NULL,
                updated_at_millis INTEGER NOT NULL,
                PRIMARY KEY(normalized_phrase, model_fingerprint, algorithm_version)
            );
            ",
        )
        .map_err(|err| err.to_string())?;

    migrate_note_columns(connection)?;
    let stable_ann_labels_added = migrate_semantic_foundation_columns(connection)?;
    migrate_chunk_ann_labels(connection, stable_ann_labels_added)?;
    migrate_semantic_document_columns(connection)?;
    migrate_edge_columns(connection)
}

pub(crate) fn load_atlas_label_embeddings(
    connection: &Connection,
    normalized_phrases: &[String],
    model_fingerprint: &str,
    algorithm_version: &str,
) -> Result<HashMap<String, Vec<f32>>, String> {
    let mut statement = connection
        .prepare(
            "
            SELECT embedding_blob, embedding_dim
            FROM atlas_label_embeddings
            WHERE normalized_phrase = ?1
              AND model_fingerprint = ?2
              AND algorithm_version = ?3
            ",
        )
        .map_err(|err| err.to_string())?;
    let mut output = HashMap::new();
    for phrase in normalized_phrases {
        let row = statement
            .query_row(
                params![phrase, model_fingerprint, algorithm_version],
                |row| Ok((row.get::<_, Vec<u8>>(0)?, row.get::<_, usize>(1)?)),
            )
            .optional()
            .map_err(|err| err.to_string())?;
        if let Some((blob, dimensions)) = row {
            let embedding = deserialize_embedding(&blob);
            if embedding.len() == dimensions {
                output.insert(phrase.clone(), embedding);
            }
        }
    }
    Ok(output)
}

pub(crate) fn save_atlas_label_embeddings(
    connection: &mut Connection,
    rows: &[(String, Vec<f32>)],
    model_fingerprint: &str,
    algorithm_version: &str,
) -> Result<(), String> {
    if rows.is_empty() {
        return Ok(());
    }
    let now = current_time_millis()?;
    let transaction = connection.transaction().map_err(|err| err.to_string())?;
    {
        let mut statement = transaction
            .prepare(
                "
                INSERT INTO atlas_label_embeddings (
                    normalized_phrase, model_fingerprint, algorithm_version,
                    embedding_blob, embedding_dim, updated_at_millis
                ) VALUES (?1, ?2, ?3, ?4, ?5, ?6)
                ON CONFLICT(normalized_phrase, model_fingerprint, algorithm_version)
                DO UPDATE SET
                    embedding_blob = excluded.embedding_blob,
                    embedding_dim = excluded.embedding_dim,
                    updated_at_millis = excluded.updated_at_millis
                ",
            )
            .map_err(|err| err.to_string())?;
        for (phrase, embedding) in rows {
            statement
                .execute(params![
                    phrase,
                    model_fingerprint,
                    algorithm_version,
                    serialize_embedding(embedding),
                    embedding.len(),
                    now
                ])
                .map_err(|err| err.to_string())?;
        }
    }
    transaction.commit().map_err(|err| err.to_string())
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
        .prepare(
            "SELECT path, modified_millis, content_hash, semantic_input_hash,
                    structure_hash, presentation_hash, stable_ann_label, document_kind
             FROM notes",
        )
        .map_err(|err| err.to_string())?;
    let mut rows = statement.query([]).map_err(|err| err.to_string())?;
    let mut notes = HashMap::new();

    while let Some(row) = rows.next().map_err(|err| err.to_string())? {
        notes.insert(
            row.get::<_, String>(0).map_err(|err| err.to_string())?,
            StoredNoteRecord {
                modified_millis: row.get::<_, u64>(1).map_err(|err| err.to_string())?,
                content_hash: row.get::<_, String>(2).map_err(|err| err.to_string())?,
                semantic_input_hash: row.get::<_, String>(3).map_err(|err| err.to_string())?,
                structure_hash: row.get::<_, String>(4).map_err(|err| err.to_string())?,
                presentation_hash: row.get::<_, String>(5).map_err(|err| err.to_string())?,
                stable_ann_label: row.get::<_, u64>(6).map_err(|err| err.to_string())?,
                document_kind: DocumentKind::from_frontmatter_value(
                    &row.get::<_, String>(7).map_err(|err| err.to_string())?,
                ),
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
            SELECT modified_millis, content_hash, semantic_input_hash,
                   structure_hash, presentation_hash, stable_ann_label, document_kind
            FROM notes
            WHERE path = ?1
            ",
            params![note_path],
            |row| {
                Ok(StoredNoteRecord {
                    modified_millis: row.get(0)?,
                    content_hash: row.get(1)?,
                    semantic_input_hash: row.get(2)?,
                    structure_hash: row.get(3)?,
                    presentation_hash: row.get(4)?,
                    stable_ann_label: row.get(5)?,
                    document_kind: DocumentKind::from_frontmatter_value(&row.get::<_, String>(6)?),
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
    document_kind: DocumentKind,
    metadata: &SemanticNoteMetadata,
    chunks: &[SemanticChunk],
    embeddings: &[Vec<f32>],
) -> Result<(), String> {
    let indexed_at_millis = current_time_millis()?;
    let transaction = connection.transaction().map_err(|err| err.to_string())?;
    let previous_hashes = transaction
        .query_row(
            "SELECT semantic_input_hash, structure_hash FROM notes WHERE path = ?1",
            [note_path],
            |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
        )
        .optional()
        .map_err(|err| err.to_string())?;
    if previous_hashes
        .as_ref()
        .is_none_or(|(semantic, structure)| {
            semantic != &metadata.semantic_input_hash || structure != &metadata.structure_hash
        })
    {
        enqueue_edge_dirty_with_neighbors(&transaction, note_path, "note-upsert")?;
    }
    let stable_ann_label = transaction
        .query_row(
            "SELECT stable_ann_label FROM notes WHERE path = ?1",
            [note_path],
            |row| row.get::<_, u64>(0),
        )
        .optional()
        .map_err(|err| err.to_string())?
        .filter(|label| *label > 0)
        .map(Ok)
        .unwrap_or_else(|| allocate_stable_ann_label(&transaction, note_path))?;
    transaction
        .execute(
            "DELETE FROM chunks WHERE note_path = ?1",
            params![note_path],
        )
        .map_err(|err| err.to_string())?;

    for (chunk, embedding) in chunks.iter().zip(embeddings.iter()) {
        let ann_label = ann_label_for(stable_ann_label, chunk.ordinal);
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
                    indexed_at_millis,
                    block_anchor
                )
                VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)
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
                    chunk.block_anchor,
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
                updated_at,
                document_kind,
                semantic_input_hash,
                structure_hash,
                presentation_hash,
                stable_ann_label,
                note_id,
                preview,
                tags_json,
                wikilink_targets_json
            )
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17)
            ON CONFLICT(path) DO UPDATE SET
                title = excluded.title,
                modified_millis = excluded.modified_millis,
                content_hash = excluded.content_hash,
                chunk_count = excluded.chunk_count,
                indexed_at_millis = excluded.indexed_at_millis,
                created_at = excluded.created_at,
                updated_at = excluded.updated_at,
                document_kind = excluded.document_kind,
                semantic_input_hash = excluded.semantic_input_hash,
                structure_hash = excluded.structure_hash,
                presentation_hash = excluded.presentation_hash,
                note_id = excluded.note_id,
                preview = excluded.preview,
                tags_json = excluded.tags_json,
                wikilink_targets_json = excluded.wikilink_targets_json
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
                document_kind.as_frontmatter_value(),
                metadata.semantic_input_hash,
                metadata.structure_hash,
                metadata.presentation_hash,
                stable_ann_label,
                metadata.note_id,
                metadata.preview,
                metadata.tags_json,
                metadata.wikilink_targets_json,
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
    enqueue_edge_dirty_with_neighbors(&transaction, note_path, "note-delete")?;
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
/// The note's stable ANN identity and every `chunks.ann_label` are intentionally
/// preserved across the move. Edges are dropped here and regenerated by the
/// normal edge-rebuild pass.
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
    enqueue_edge_dirty_with_neighbors(&transaction, old_path, "note-move-source")?;
    enqueue_edge_dirty_with_neighbors(&transaction, new_path, "note-move-target")?;

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

    transaction
        .execute(
            "UPDATE chunks SET note_path = ?2 WHERE note_path = ?1",
            params![old_path, new_path],
        )
        .map_err(|err| err.to_string())?;

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

fn enqueue_edge_dirty_with_neighbors(
    connection: &Connection,
    note_path: &str,
    reason: &str,
) -> Result<(), String> {
    let now = current_time_millis()?;
    connection
        .execute(
            "INSERT INTO edge_dirty_notes (note_path, reason, enqueued_at_millis)
             VALUES (?1, ?2, ?3)
             ON CONFLICT(note_path) DO UPDATE SET
                reason = excluded.reason,
                enqueued_at_millis = excluded.enqueued_at_millis",
            params![note_path, reason, now],
        )
        .map_err(|err| err.to_string())?;
    connection
        .execute(
            "INSERT INTO edge_dirty_notes (note_path, reason, enqueued_at_millis)
             SELECT CASE
                        WHEN source_note_path = ?1 THEN target_note_path
                        ELSE source_note_path
                    END,
                    'former-neighbor',
                    ?2
             FROM edges
             WHERE source_note_path = ?1 OR target_note_path = ?1
             ON CONFLICT(note_path) DO UPDATE SET
                enqueued_at_millis = excluded.enqueued_at_millis",
            params![note_path, now],
        )
        .map_err(|err| err.to_string())?;
    Ok(())
}

#[allow(clippy::too_many_arguments)]
pub(crate) fn update_moved_note_metadata(
    connection: &Connection,
    note_path: &str,
    title: &str,
    modified_millis: u64,
    content_hash: &str,
    created_at: &str,
    updated_at: &str,
    document_kind: DocumentKind,
    metadata: &SemanticNoteMetadata,
) -> Result<(), String> {
    connection
        .execute(
            "UPDATE notes SET
                title = ?2,
                modified_millis = ?3,
                content_hash = ?4,
                created_at = ?5,
                updated_at = ?6,
                document_kind = ?7,
                semantic_input_hash = ?8,
                structure_hash = ?9,
                presentation_hash = ?10,
                note_id = ?11,
                preview = ?12,
                tags_json = ?13,
                wikilink_targets_json = ?14
             WHERE path = ?1",
            params![
                note_path,
                title,
                modified_millis,
                content_hash,
                created_at,
                updated_at,
                document_kind.as_frontmatter_value(),
                metadata.semantic_input_hash,
                metadata.structure_hash,
                metadata.presentation_hash,
                metadata.note_id,
                metadata.preview,
                metadata.tags_json,
                metadata.wikilink_targets_json,
            ],
        )
        .map_err(|err| err.to_string())?;
    Ok(())
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
        SELECT c.note_path, n.title, c.section_label, c.text, c.start_line, c.end_line,
               c.embedding_blob, n.document_kind, c.block_anchor
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
            document_kind: DocumentKind::from_frontmatter_value(
                &row.get::<_, String>(7).map_err(|err| err.to_string())?,
            ),
            block_anchor: row
                .get::<_, Option<String>>(8)
                .map_err(|err| err.to_string())?,
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

pub(crate) fn load_ann_source_inventory(
    connection: &Connection,
) -> Result<Vec<AnnSourceInventory>, String> {
    let mut statement = connection
        .prepare(
            "SELECT path, content_hash, document_kind, chunk_count, stable_ann_label
             FROM notes ORDER BY path",
        )
        .map_err(|err| err.to_string())?;
    let rows = statement
        .query_map([], |row| {
            Ok(AnnSourceInventory {
                path: row.get(0)?,
                content_hash: row.get(1)?,
                document_kind: row.get(2)?,
                chunk_count: row.get(3)?,
                stable_ann_label: row.get(4)?,
            })
        })
        .map_err(|err| err.to_string())?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|err| err.to_string())
}

pub(crate) fn semantic_corpus_signature(connection: &Connection) -> Result<String, String> {
    let inventory = load_ann_source_inventory(connection)?;
    let serialized = serde_json::to_string(&inventory).map_err(|err| err.to_string())?;
    Ok(content_hash(&serialized))
}

pub(crate) fn edges_are_stale_for_model(
    connection: &Connection,
    expected_model_signature: Option<&str>,
) -> Result<bool, String> {
    edges_are_stale_for_compatibility(connection, expected_model_signature, None)
}

pub(crate) fn edges_are_stale_for_generation(
    connection: &Connection,
    expected_model_signature: &str,
    expected_note_ann_generation: Option<&str>,
) -> Result<bool, String> {
    edges_are_stale_for_compatibility(
        connection,
        Some(expected_model_signature),
        expected_note_ann_generation,
    )
}

fn edges_are_stale_for_compatibility(
    connection: &Connection,
    expected_model_signature: Option<&str>,
    expected_note_ann_generation: Option<&str>,
) -> Result<bool, String> {
    if edge_dirty_count(connection)? > 0 {
        return Ok(true);
    }
    let current = semantic_corpus_signature(connection)?;
    let stored = connection
        .query_row(
            "SELECT value_json FROM settings WHERE key = ?1",
            [EDGE_CORPUS_SIGNATURE_KEY],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(|err| err.to_string())?;
    if stored.as_deref() != Some(current.as_str()) {
        return Ok(true);
    }
    let Some(generation) = load_edge_generation(connection)? else {
        return Ok(true);
    };
    if generation.algorithm_version != EDGE_ALGORITHM_VERSION
        || generation.generation_id.is_empty()
        || generation.note_ann_generation.is_empty()
        || generation.model_signature.is_empty()
        || expected_model_signature.is_some_and(|expected| generation.model_signature != expected)
        || expected_note_ann_generation
            .is_some_and(|expected| generation.note_ann_generation != expected)
    {
        return Ok(true);
    }
    let now = current_time_millis()?;
    Ok(now.saturating_sub(generation.last_full_reconcile_at_millis)
        >= EDGE_FULL_RECONCILE_INTERVAL_MILLIS
        || generation.incremental_repairs >= EDGE_MAX_INCREMENTAL_REPAIRS)
}

fn save_edge_corpus_signature(connection: &Connection) -> Result<(), String> {
    let signature = semantic_corpus_signature(connection)?;
    connection
        .execute(
            "INSERT INTO settings (key, value_json) VALUES (?1, ?2)
             ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json",
            params![EDGE_CORPUS_SIGNATURE_KEY, signature],
        )
        .map_err(|err| err.to_string())?;
    Ok(())
}

pub(crate) fn edge_dirty_count(connection: &Connection) -> Result<usize, String> {
    connection
        .query_row("SELECT COUNT(*) FROM edge_dirty_notes", [], |row| {
            row.get(0)
        })
        .map_err(|err| err.to_string())
}

pub(crate) fn load_edge_generation(
    connection: &Connection,
) -> Result<Option<EdgeGenerationState>, String> {
    connection
        .query_row(
            "SELECT generation_id, provenance, note_ann_generation, model_signature,
                    algorithm_version, completed_at_millis, last_full_reconcile_at_millis,
                    incremental_repairs
             FROM edge_generation WHERE singleton = 1",
            [],
            |row| {
                Ok(EdgeGenerationState {
                    generation_id: row.get(0)?,
                    provenance: row.get(1)?,
                    note_ann_generation: row.get(2)?,
                    model_signature: row.get(3)?,
                    algorithm_version: row.get(4)?,
                    completed_at_millis: row.get(5)?,
                    last_full_reconcile_at_millis: row.get(6)?,
                    incremental_repairs: row.get(7)?,
                })
            },
        )
        .optional()
        .map_err(|err| err.to_string())
}

pub(crate) fn edge_generation_requires_full_rebuild(
    connection: &Connection,
    note_ann_generation: &str,
    model_signature: &str,
) -> Result<bool, String> {
    let Some(generation) = load_edge_generation(connection)? else {
        return Ok(true);
    };
    let now = current_time_millis()?;
    Ok(generation.algorithm_version != EDGE_ALGORITHM_VERSION
        || generation.model_signature != model_signature
        || generation.note_ann_generation.is_empty()
        || note_ann_generation.is_empty()
        || generation.note_ann_generation != note_ann_generation
        || now.saturating_sub(generation.last_full_reconcile_at_millis)
            >= EDGE_FULL_RECONCILE_INTERVAL_MILLIS
        || generation.incremental_repairs >= EDGE_MAX_INCREMENTAL_REPAIRS)
}

fn next_edge_generation_id(provenance: &str) -> Result<String, String> {
    Ok(format!("{provenance}-{}", current_time_millis()?))
}

fn save_edge_generation(
    connection: &Connection,
    generation_id: &str,
    provenance: &str,
    note_ann_generation: &str,
    model_signature: &str,
    last_full_reconcile_at_millis: u64,
    incremental_repairs: usize,
) -> Result<(), String> {
    let completed_at_millis = current_time_millis()?;
    connection
        .execute(
            "INSERT INTO edge_generation (
                singleton, generation_id, provenance, note_ann_generation, model_signature,
                algorithm_version, completed_at_millis, last_full_reconcile_at_millis,
                incremental_repairs
             ) VALUES (1, ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
             ON CONFLICT(singleton) DO UPDATE SET
                generation_id = excluded.generation_id,
                provenance = excluded.provenance,
                note_ann_generation = excluded.note_ann_generation,
                model_signature = excluded.model_signature,
                algorithm_version = excluded.algorithm_version,
                completed_at_millis = excluded.completed_at_millis,
                last_full_reconcile_at_millis = excluded.last_full_reconcile_at_millis,
                incremental_repairs = excluded.incremental_repairs",
            params![
                generation_id,
                provenance,
                note_ann_generation,
                model_signature,
                EDGE_ALGORITHM_VERSION,
                completed_at_millis,
                last_full_reconcile_at_millis,
                incremental_repairs,
            ],
        )
        .map_err(|err| err.to_string())?;
    Ok(())
}

pub(crate) fn load_ann_chunks_for_note(
    connection: &Connection,
    note_path: &str,
) -> Result<Vec<StoredAnnChunk>, String> {
    let mut statement = connection
        .prepare("SELECT ordinal, embedding_blob FROM chunks WHERE note_path = ?1 ORDER BY ordinal")
        .map_err(|err| err.to_string())?;
    let rows = statement
        .query_map([note_path], |row| {
            let blob: Vec<u8> = row.get(1)?;
            Ok(StoredAnnChunk {
                ordinal: row.get(0)?,
                embedding: deserialize_embedding(&blob),
            })
        })
        .map_err(|err| err.to_string())?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|err| err.to_string())
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

pub(crate) fn load_note_ann_index_signature(
    connection: &Connection,
) -> Result<NoteAnnIndexSignature, String> {
    connection
        .query_row(
            "
            SELECT COUNT(*), MAX(e.indexed_at_millis),
                   COALESCE(MIN(CASE
                       WHEN n.stable_ann_label > 0
                        AND n.semantic_input_hash <> ''
                        AND e.embedding_dim > 0 THEN 1
                       ELSE 0
                   END), 1)
            FROM note_embeddings e
            INNER JOIN notes n ON n.path = e.note_path
            ",
            [],
            |row| {
                Ok(NoteAnnIndexSignature {
                    note_count: row.get(0)?,
                    max_indexed_at_millis: row.get(1)?,
                    identities_valid: row.get::<_, i64>(2)? == 1,
                })
            },
        )
        .map_err(|err| err.to_string())
}

pub(crate) fn load_note_ann_source_inventory(
    connection: &Connection,
) -> Result<Vec<NoteAnnSourceInventory>, String> {
    let mut statement = connection
        .prepare(
            "
            SELECT n.path, n.semantic_input_hash, n.document_kind, n.stable_ann_label
            FROM note_embeddings e
            INNER JOIN notes n ON n.path = e.note_path
            ORDER BY n.path
            ",
        )
        .map_err(|err| err.to_string())?;
    let rows = statement
        .query_map([], |row| {
            Ok(NoteAnnSourceInventory {
                path: row.get(0)?,
                semantic_input_hash: row.get(1)?,
                document_kind: row.get(2)?,
                stable_ann_label: row.get(3)?,
            })
        })
        .map_err(|err| err.to_string())?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|err| err.to_string())
}

pub(crate) fn for_each_note_embedding<F>(
    connection: &Connection,
    mut handle: F,
) -> Result<(), String>
where
    F: FnMut(NoteEmbeddingRow) -> Result<(), String>,
{
    let mut statement = connection
        .prepare(
            "
            SELECT n.stable_ann_label, n.path, n.semantic_input_hash, e.embedding_blob
            FROM note_embeddings e
            INNER JOIN notes n ON n.path = e.note_path
            ORDER BY n.path
            ",
        )
        .map_err(|err| err.to_string())?;
    let mut rows = statement.query([]).map_err(|err| err.to_string())?;
    while let Some(row) = rows.next().map_err(|err| err.to_string())? {
        handle(NoteEmbeddingRow {
            stable_ann_label: row.get(0).map_err(|err| err.to_string())?,
            note_path: row.get(1).map_err(|err| err.to_string())?,
            semantic_input_hash: row.get(2).map_err(|err| err.to_string())?,
            embedding: deserialize_embedding(
                &row.get::<_, Vec<u8>>(3).map_err(|err| err.to_string())?,
            ),
        })?;
    }
    Ok(())
}

pub(crate) fn load_note_embedding_for_path(
    connection: &Connection,
    note_path: &str,
) -> Result<Option<NoteEmbeddingRow>, String> {
    connection
        .query_row(
            "
            SELECT n.stable_ann_label, n.path, n.semantic_input_hash, e.embedding_blob
            FROM note_embeddings e
            INNER JOIN notes n ON n.path = e.note_path
            WHERE n.path = ?1
            ",
            [note_path],
            |row| {
                Ok(NoteEmbeddingRow {
                    stable_ann_label: row.get(0)?,
                    note_path: row.get(1)?,
                    semantic_input_hash: row.get(2)?,
                    embedding: deserialize_embedding(&row.get::<_, Vec<u8>>(3)?),
                })
            },
        )
        .optional()
        .map_err(|err| err.to_string())
}

pub(crate) fn load_note_ann_embedding_by_label(
    connection: &Connection,
    stable_ann_label: u64,
) -> Result<Option<NoteEmbeddingRow>, String> {
    connection
        .query_row(
            "
            SELECT n.stable_ann_label, n.path, n.semantic_input_hash, e.embedding_blob
            FROM notes n
            INNER JOIN note_embeddings e ON e.note_path = n.path
            WHERE n.stable_ann_label = ?1
            ",
            [stable_ann_label],
            |row| {
                Ok(NoteEmbeddingRow {
                    stable_ann_label: row.get(0)?,
                    note_path: row.get(1)?,
                    semantic_input_hash: row.get(2)?,
                    embedding: deserialize_embedding(&row.get::<_, Vec<u8>>(3)?),
                })
            },
        )
        .optional()
        .map_err(|err| err.to_string())
}

pub(crate) fn load_atlas_note_embeddings(
    connection: &Connection,
) -> Result<Vec<StoredAtlasNoteEmbedding>, String> {
    let mut statement = connection
        .prepare(
            "
            SELECT n.path, n.title, n.modified_millis, n.semantic_input_hash,
                   n.structure_hash, n.created_at, n.updated_at, e.embedding_blob
            FROM note_embeddings e
            INNER JOIN notes n ON n.path = e.note_path
            ORDER BY n.title ASC, n.path ASC
            ",
        )
        .map_err(|err| err.to_string())?;
    let mut rows = statement.query([]).map_err(|err| err.to_string())?;
    let mut notes = Vec::new();

    while let Some(row) = rows.next().map_err(|err| err.to_string())? {
        notes.push(StoredAtlasNoteEmbedding {
            note_path: row.get::<_, String>(0).map_err(|err| err.to_string())?,
            note_title: row.get::<_, String>(1).map_err(|err| err.to_string())?,
            modified_millis: row.get::<_, u64>(2).map_err(|err| err.to_string())?,
            semantic_input_hash: row.get::<_, String>(3).map_err(|err| err.to_string())?,
            structure_hash: row.get::<_, String>(4).map_err(|err| err.to_string())?,
            created_at: row.get::<_, String>(5).map_err(|err| err.to_string())?,
            updated_at: row.get::<_, String>(6).map_err(|err| err.to_string())?,
            embedding: deserialize_embedding(
                &row.get::<_, Vec<u8>>(7).map_err(|err| err.to_string())?,
            ),
        });
    }

    Ok(notes)
}

pub(crate) fn load_atlas_note_metadata(
    connection: &Connection,
) -> Result<Vec<StoredAtlasNoteMetadata>, String> {
    let mut statement = connection
        .prepare(
            "SELECT path, title, modified_millis, document_kind, note_id, preview,
                    tags_json, wikilink_targets_json, chunk_count, presentation_hash
             FROM notes
             ORDER BY path ASC",
        )
        .map_err(|err| err.to_string())?;
    let rows = statement
        .query_map([], |row| {
            let document_kind = row.get::<_, String>(3)?;
            let tags_json = row.get::<_, String>(6)?;
            let wikilinks_json = row.get::<_, String>(7)?;
            Ok(StoredAtlasNoteMetadata {
                note_path: row.get(0)?,
                title: row.get(1)?,
                modified_millis: row.get(2)?,
                document_kind: DocumentKind::from_frontmatter_value(&document_kind),
                note_id: row.get(4)?,
                preview: row.get(5)?,
                tags: serde_json::from_str(&tags_json).unwrap_or_default(),
                wikilink_targets: serde_json::from_str(&wikilinks_json).unwrap_or_default(),
                chunk_count: row.get(8)?,
                presentation_hash: row.get(9)?,
            })
        })
        .map_err(|err| err.to_string())?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|err| err.to_string())
}

pub(crate) fn load_atlas_positions(
    connection: &Connection,
) -> Result<Vec<StoredAtlasPosition>, String> {
    let mut statement = connection
        .prepare("SELECT note_path, x, y FROM atlas_positions")
        .map_err(|err| err.to_string())?;
    let rows = statement
        .query_map([], |row| {
            Ok(StoredAtlasPosition {
                note_path: row.get(0)?,
                x: row.get(1)?,
                y: row.get(2)?,
            })
        })
        .map_err(|err| err.to_string())?;

    let mut positions = Vec::new();
    for row in rows {
        positions.push(row.map_err(|err| err.to_string())?);
    }
    Ok(positions)
}

pub(crate) fn save_atlas_positions(
    connection: &mut Connection,
    positions: &[StoredAtlasPosition],
) -> Result<(), String> {
    let now = current_time_millis()?;
    let transaction = connection.transaction().map_err(|err| err.to_string())?;
    for position in positions {
        transaction
            .execute(
                "
                INSERT INTO atlas_positions (note_path, x, y, updated_at_millis)
                VALUES (?1, ?2, ?3, ?4)
                ON CONFLICT(note_path) DO UPDATE SET
                    x = excluded.x,
                    y = excluded.y,
                    updated_at_millis = excluded.updated_at_millis
                ",
                params![position.note_path, position.x, position.y, now],
            )
            .map_err(|err| err.to_string())?;
    }
    transaction.commit().map_err(|err| err.to_string())
}

pub(crate) fn clear_atlas_cache(connection: &Connection) -> Result<(), String> {
    connection
        .execute("DELETE FROM atlas_positions", [])
        .map_err(|err| err.to_string())?;
    connection
        .execute(
            "DELETE FROM settings WHERE key IN ('atlas_layout_signature', 'atlas_graph_snapshot')",
            [],
        )
        .map_err(|err| err.to_string())?;
    Ok(())
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

#[cfg(test)]
pub(crate) fn rebuild_edges(
    connection: &mut Connection,
    neighbors_per_note: usize,
    min_score: f32,
) -> Result<EdgeRebuildStats, String> {
    rebuild_edges_with_checkpoint(connection, neighbors_per_note, min_score, |_, _| {})
}

pub(crate) fn rebuild_edges_with_checkpoint<F>(
    connection: &mut Connection,
    neighbors_per_note: usize,
    min_score: f32,
    checkpoint: F,
) -> Result<EdgeRebuildStats, String>
where
    F: FnMut(usize, usize),
{
    rebuild_edges_with_provenance(
        connection,
        neighbors_per_note,
        min_score,
        "",
        "legacy",
        checkpoint,
    )
}

pub(crate) fn rebuild_edges_with_provenance<F>(
    connection: &mut Connection,
    neighbors_per_note: usize,
    min_score: f32,
    note_ann_generation: &str,
    model_signature: &str,
    mut checkpoint: F,
) -> Result<EdgeRebuildStats, String>
where
    F: FnMut(usize, usize),
{
    // NOTE: This recomputes all pairwise note similarities, so wall-clock cost is
    // O(N^2 * D). Peak host memory is bounded: note embeddings are O(N * D) and
    // each source keeps only its top-K neighbors (O(K)) via the bounded heap
    // below, rather than collecting every above-threshold candidate. If N grows
    // large enough that the quadratic compute dominates, the next step is to
    // reuse the note-level ANN neighbors instead of brute force; `EdgeRebuildStats`
    // exists to make that threshold observable before it bites.
    let notes = load_note_embeddings(connection)?;
    if notes.len() >= 750 {
        return rebuild_edges_with_hnsw(
            connection,
            notes,
            neighbors_per_note,
            min_score,
            note_ann_generation,
            model_signature,
            &mut checkpoint,
        );
    }
    let dimensions = notes.first().map(|note| note.embedding.len()).unwrap_or(0);
    let mut comparisons = 0u64;
    let mut heap: BinaryHeap<Reverse<ScoredNeighbor>> = BinaryHeap::new();
    let mut next_edges = HashMap::<(String, String), f32>::new();
    for (source_index, source) in notes.iter().enumerate() {
        if source_index % 64 == 0 {
            checkpoint(source_index, notes.len());
        }
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
            next_edges
                .entry((source_note_path.to_string(), target_note_path.to_string()))
                .and_modify(|score| *score = score.max(neighbor.score))
                .or_insert(neighbor.score);
        }
    }
    checkpoint(notes.len(), notes.len());
    let updated_at_millis = current_time_millis()?;
    let generation_id = next_edge_generation_id("full")?;
    let transaction = connection.transaction().map_err(|err| err.to_string())?;
    transaction
        .execute("DELETE FROM edges", [])
        .map_err(|err| err.to_string())?;
    for ((source, target), score) in &next_edges {
        transaction
            .execute(
                "INSERT INTO edges (
                    source_note_path, target_note_path, score, updated_at_millis,
                    generation_id, provenance
                 ) VALUES (?1, ?2, ?3, ?4, ?5, 'full')",
                params![source, target, score, updated_at_millis, generation_id],
            )
            .map_err(|err| err.to_string())?;
    }
    transaction
        .execute("DELETE FROM edge_dirty_notes", [])
        .map_err(|err| err.to_string())?;
    save_edge_generation(
        &transaction,
        &generation_id,
        "full",
        note_ann_generation,
        model_signature,
        updated_at_millis,
        0,
    )?;
    let edge_count = next_edges.len();
    transaction.commit().map_err(|err| err.to_string())?;
    save_edge_corpus_signature(connection)?;
    Ok(EdgeRebuildStats {
        note_count: notes.len(),
        edge_count,
        dimensions,
        comparisons,
    })
}

fn rebuild_edges_with_hnsw(
    connection: &mut Connection,
    notes: Vec<StoredNoteEmbedding>,
    neighbors_per_note: usize,
    min_score: f32,
    note_ann_generation: &str,
    model_signature: &str,
    checkpoint: &mut impl FnMut(usize, usize),
) -> Result<EdgeRebuildStats, String> {
    let dimensions = notes.first().map(|note| note.embedding.len()).unwrap_or(0);
    if notes.is_empty() || dimensions == 0 {
        let transaction = connection.transaction().map_err(|err| err.to_string())?;
        transaction
            .execute("DELETE FROM edges", [])
            .map_err(|err| err.to_string())?;
        transaction
            .execute("DELETE FROM edge_dirty_notes", [])
            .map_err(|err| err.to_string())?;
        let generation_id = next_edge_generation_id("full")?;
        let now = current_time_millis()?;
        save_edge_generation(
            &transaction,
            &generation_id,
            "full",
            note_ann_generation,
            model_signature,
            now,
            0,
        )?;
        transaction.commit().map_err(|err| err.to_string())?;
        save_edge_corpus_signature(connection)?;
        return Ok(EdgeRebuildStats::default());
    }

    let capacity = notes.len().saturating_mul(2).max(1024).next_power_of_two();
    let graph = Hnsw::new(
        Cosine::new(),
        HnswConfig::new(dimensions, capacity)
            .m(16)
            .ef_construction(200)
            .ef_search(neighbors_per_note.saturating_mul(4).max(64)),
    );
    let vectors = InMemoryVectorStore::<f32>::new(dimensions, capacity);
    for (index, note) in notes.iter().enumerate() {
        if index % 64 == 0 {
            checkpoint(index, notes.len());
        }
        graph
            .set(&vectors, index as u64, note.embedding.as_slice())
            .map(|_| ())
            .map_err(|err| err.to_string())?;
    }

    let mut next_edges = HashMap::<(String, String), f32>::new();
    let mut comparisons = 0u64;
    for (source_index, source) in notes.iter().enumerate() {
        if source_index % 64 == 0 {
            checkpoint(source_index, notes.len());
        }
        let hits = graph
            .search(
                &vectors,
                source.embedding.as_slice(),
                neighbors_per_note.saturating_add(1).max(2),
                None,
            )
            .map_err(|err| err.to_string())?;
        for hit in hits {
            let target_index = hit.key as usize;
            if target_index == source_index || target_index >= notes.len() {
                continue;
            }
            comparisons += 1;
            let target = &notes[target_index];
            let score = super::similarity::cosine_similarity(&source.embedding, &target.embedding);
            if score < min_score {
                continue;
            }
            let (source_note_path, target_note_path) = if source.note_path <= target.note_path {
                (source.note_path.as_str(), target.note_path.as_str())
            } else {
                (target.note_path.as_str(), source.note_path.as_str())
            };
            next_edges
                .entry((source_note_path.to_string(), target_note_path.to_string()))
                .and_modify(|existing| *existing = existing.max(score))
                .or_insert(score);
        }
    }
    checkpoint(notes.len(), notes.len());
    let updated_at_millis = current_time_millis()?;
    let generation_id = next_edge_generation_id("full")?;
    let transaction = connection.transaction().map_err(|err| err.to_string())?;
    transaction
        .execute("DELETE FROM edges", [])
        .map_err(|err| err.to_string())?;
    for ((source, target), score) in &next_edges {
        transaction
            .execute(
                "INSERT INTO edges (
                    source_note_path, target_note_path, score, updated_at_millis,
                    generation_id, provenance
                 ) VALUES (?1, ?2, ?3, ?4, ?5, 'full')",
                params![source, target, score, updated_at_millis, generation_id],
            )
            .map_err(|err| err.to_string())?;
    }
    transaction
        .execute("DELETE FROM edge_dirty_notes", [])
        .map_err(|err| err.to_string())?;
    save_edge_generation(
        &transaction,
        &generation_id,
        "full",
        note_ann_generation,
        model_signature,
        updated_at_millis,
        0,
    )?;
    let edge_count = next_edges.len();
    transaction.commit().map_err(|err| err.to_string())?;
    save_edge_corpus_signature(connection)?;
    Ok(EdgeRebuildStats {
        note_count: notes.len(),
        edge_count,
        dimensions,
        comparisons,
    })
}

pub(crate) fn repair_dirty_edges<F>(
    connection: &mut Connection,
    neighbors_per_note: usize,
    min_score: f32,
    candidate_k: usize,
    note_ann_generation: &str,
    model_signature: &str,
    mut ann_candidates: F,
) -> Result<EdgeRepairStats, String>
where
    F: FnMut(&Connection, &str, usize) -> Result<Vec<String>, String>,
{
    let dirty_paths = load_dirty_edge_paths(connection)?;
    if dirty_paths.is_empty() {
        return Ok(EdgeRepairStats::default());
    }

    let mut affected = dirty_paths.iter().cloned().collect::<HashSet<_>>();
    for path in &dirty_paths {
        affected.extend(load_stored_edge_neighbors(connection, path)?);
        if load_note_embedding_for_path(connection, path)?.is_some() {
            affected.extend(ann_candidates(connection, path, candidate_k)?);
        }
    }

    let mut next_edges = HashMap::<(String, String), f32>::new();
    let mut comparisons = 0u64;
    for source_path in affected.clone() {
        let Some(source) = load_note_embedding_for_path(connection, &source_path)? else {
            continue;
        };
        let mut candidates = ann_candidates(connection, &source_path, candidate_k)?;
        candidates.extend(
            load_stored_edge_neighbors(connection, &source_path)?
                .into_iter()
                .filter(|path| path != &source_path),
        );
        let mut seen = HashSet::new();
        let mut scored = Vec::new();
        for target_path in candidates {
            if target_path == source_path || !seen.insert(target_path.clone()) {
                continue;
            }
            let Some(target) = load_note_embedding_for_path(connection, &target_path)? else {
                continue;
            };
            comparisons += 1;
            let score = super::similarity::cosine_similarity(&source.embedding, &target.embedding);
            if score >= min_score {
                scored.push(ScoredNeighbor {
                    score,
                    note_path: target_path,
                });
            }
        }
        scored.sort_by(|left, right| {
            right
                .score
                .total_cmp(&left.score)
                .then_with(|| left.note_path.cmp(&right.note_path))
        });
        scored.truncate(neighbors_per_note);
        for neighbor in scored {
            let key = if source_path <= neighbor.note_path {
                (source_path.clone(), neighbor.note_path)
            } else {
                (neighbor.note_path, source_path.clone())
            };
            next_edges
                .entry(key)
                .and_modify(|score| *score = score.max(neighbor.score))
                .or_insert(neighbor.score);
        }
    }

    let previous_generation = load_edge_generation(connection)?;
    let incremental_repairs = previous_generation
        .as_ref()
        .map(|generation| generation.incremental_repairs.saturating_add(1))
        .unwrap_or(1);
    let last_full_reconcile_at_millis = previous_generation
        .as_ref()
        .map(|generation| generation.last_full_reconcile_at_millis)
        .unwrap_or(0);
    let generation_id = next_edge_generation_id("incremental")?;
    let updated_at_millis = current_time_millis()?;
    let transaction = connection.transaction().map_err(|err| err.to_string())?;
    for source in &affected {
        transaction
            .execute(
                "DELETE FROM edges WHERE source_note_path = ?1 OR target_note_path = ?1",
                [source],
            )
            .map_err(|err| err.to_string())?;
    }
    for ((source, target), score) in &next_edges {
        transaction
            .execute(
                "INSERT INTO edges (
                    source_note_path, target_note_path, score, updated_at_millis,
                    generation_id, provenance
                 ) VALUES (?1, ?2, ?3, ?4, ?5, 'incremental')
                 ON CONFLICT(source_note_path, target_note_path) DO UPDATE SET
                    score = MAX(edges.score, excluded.score),
                    updated_at_millis = excluded.updated_at_millis,
                    generation_id = excluded.generation_id,
                    provenance = excluded.provenance",
                params![source, target, score, updated_at_millis, generation_id],
            )
            .map_err(|err| err.to_string())?;
    }
    transaction
        .execute("DELETE FROM edge_dirty_notes", [])
        .map_err(|err| err.to_string())?;
    save_edge_generation(
        &transaction,
        &generation_id,
        "incremental",
        note_ann_generation,
        model_signature,
        last_full_reconcile_at_millis,
        incremental_repairs,
    )?;
    let edge_count = next_edges.len();
    transaction.commit().map_err(|err| err.to_string())?;
    save_edge_corpus_signature(connection)?;
    Ok(EdgeRepairStats {
        dirty_count: dirty_paths.len(),
        affected_count: affected.len(),
        edge_count,
        comparisons,
    })
}

fn load_dirty_edge_paths(connection: &Connection) -> Result<Vec<String>, String> {
    let mut statement = connection
        .prepare("SELECT note_path FROM edge_dirty_notes ORDER BY note_path")
        .map_err(|err| err.to_string())?;
    let paths = statement
        .query_map([], |row| row.get(0))
        .map_err(|err| err.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|err| err.to_string())?;
    Ok(paths)
}

fn load_stored_edge_neighbors(
    connection: &Connection,
    note_path: &str,
) -> Result<Vec<String>, String> {
    let mut statement = connection
        .prepare(
            "SELECT CASE
                        WHEN source_note_path = ?1 THEN target_note_path
                        ELSE source_note_path
                    END
             FROM edges
             WHERE source_note_path = ?1 OR target_note_path = ?1",
        )
        .map_err(|err| err.to_string())?;
    let neighbors = statement
        .query_map([note_path], |row| row.get(0))
        .map_err(|err| err.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|err| err.to_string())?;
    Ok(neighbors)
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

pub(crate) fn mark_running_jobs_interrupted(connection: &Connection) -> Result<usize, String> {
    let now = current_time_millis()?;
    connection
        .execute(
            "UPDATE index_jobs
             SET status = 'interrupted',
                 error_text = COALESCE(error_text, 'Interrupted before completion'),
                 updated_at_millis = ?1
             WHERE status = 'running'",
            [now],
        )
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
                n.document_kind,
                (
                    SELECT c.block_anchor
                    FROM chunks c
                    WHERE c.note_path = n.path
                    ORDER BY CASE WHEN c.section_label = 'Title' THEN 1 ELSE 0 END, c.ordinal
                    LIMIT 1
                ),
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
            document_kind: DocumentKind::from_frontmatter_value(
                &row.get::<_, String>(6).map_err(|err| err.to_string())?,
            ),
            block_anchor: row
                .get::<_, Option<String>>(7)
                .map_err(|err| err.to_string())?,
            score: row.get::<_, f32>(8).map_err(|err| err.to_string())?,
        });
    }

    Ok(previews)
}

pub(crate) fn content_hash(markdown: &str) -> String {
    hash(markdown.as_bytes()).to_hex().to_string()
}

pub(crate) fn ann_label_for(stable_note_label: u64, ordinal: usize) -> u64 {
    let raw = hash(format!("{stable_note_label}::{ordinal}").as_bytes())
        .as_bytes()
        .to_owned();
    u64::from_le_bytes([
        raw[0], raw[1], raw[2], raw[3], raw[4], raw[5], raw[6], raw[7],
    ]) & i64::MAX as u64
}

fn allocate_stable_ann_label(connection: &Connection, note_path: &str) -> Result<u64, String> {
    for nonce in 0u64.. {
        let digest = hash(format!("stable-note\0{note_path}\0{nonce}").as_bytes());
        let bytes = digest.as_bytes();
        let candidate = u64::from_le_bytes([
            bytes[0], bytes[1], bytes[2], bytes[3], bytes[4], bytes[5], bytes[6], bytes[7],
        ]) & i64::MAX as u64;
        if candidate == 0 {
            continue;
        }
        let exists = connection
            .query_row(
                "SELECT 1 FROM notes WHERE stable_ann_label = ?1",
                [candidate],
                |_| Ok(()),
            )
            .optional()
            .map_err(|err| err.to_string())?
            .is_some();
        if !exists {
            return Ok(candidate);
        }
    }
    unreachable!("u63 ANN label space exhausted")
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

fn migrate_chunk_ann_labels(connection: &Connection, restamp_all: bool) -> Result<(), String> {
    if !has_column(connection, "chunks", "ann_label")? {
        connection
            .execute("ALTER TABLE chunks ADD COLUMN ann_label INTEGER", [])
            .map_err(|err| err.to_string())?;
    }

    let mut statement = connection
        .prepare(
            "SELECT c.id, n.stable_ann_label, c.ordinal
             FROM chunks c
             INNER JOIN notes n ON n.path = c.note_path
             WHERE ?1 OR c.ann_label IS NULL",
        )
        .map_err(|err| err.to_string())?;
    let rows = statement
        .query_map([restamp_all], |row| {
            Ok((
                row.get::<_, i64>(0)?,
                row.get::<_, u64>(1)?,
                row.get::<_, usize>(2)?,
            ))
        })
        .map_err(|err| err.to_string())?;

    for row in rows {
        let (id, stable_note_label, ordinal) = row.map_err(|err| err.to_string())?;
        let ann_label = ann_label_for(stable_note_label, ordinal);
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

/// Adds persisted indexing identities without deriving legacy Atlas results.
/// Empty hashes are deliberate migration sentinels: the next filesystem scan
/// sees them as dirty and reconciles each note from the real indexing inputs.
fn migrate_semantic_foundation_columns(connection: &Connection) -> Result<bool, String> {
    for (name, declaration) in [
        ("semantic_input_hash", "TEXT NOT NULL DEFAULT ''"),
        ("structure_hash", "TEXT NOT NULL DEFAULT ''"),
        ("presentation_hash", "TEXT NOT NULL DEFAULT ''"),
        ("note_id", "TEXT NOT NULL DEFAULT ''"),
        ("preview", "TEXT NOT NULL DEFAULT ''"),
        ("tags_json", "TEXT NOT NULL DEFAULT '[]'"),
        ("wikilink_targets_json", "TEXT NOT NULL DEFAULT '[]'"),
    ] {
        if !has_column(connection, "notes", name)? {
            connection
                .execute(
                    &format!("ALTER TABLE notes ADD COLUMN {name} {declaration}"),
                    [],
                )
                .map_err(|err| err.to_string())?;
        }
    }

    let stable_added = !has_column(connection, "notes", "stable_ann_label")?;
    if stable_added {
        connection
            .execute(
                "ALTER TABLE notes ADD COLUMN stable_ann_label INTEGER NOT NULL DEFAULT 0",
                [],
            )
            .map_err(|err| err.to_string())?;
    }
    let paths = {
        let mut statement = connection
            .prepare("SELECT path FROM notes WHERE stable_ann_label = 0")
            .map_err(|err| err.to_string())?;
        let paths = statement
            .query_map([], |row| row.get::<_, String>(0))
            .map_err(|err| err.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|err| err.to_string())?;
        paths
    };
    for path in paths {
        let label = allocate_stable_ann_label(connection, &path)?;
        connection
            .execute(
                "UPDATE notes SET stable_ann_label = ?1 WHERE path = ?2",
                params![label, path],
            )
            .map_err(|err| err.to_string())?;
    }
    connection
        .execute(
            "CREATE UNIQUE INDEX IF NOT EXISTS idx_notes_stable_ann_label
             ON notes(stable_ann_label)",
            [],
        )
        .map_err(|err| err.to_string())?;
    Ok(stable_added)
}

fn migrate_semantic_document_columns(connection: &Connection) -> Result<(), String> {
    if !has_column(connection, "notes", "document_kind")? {
        connection
            .execute(
                "ALTER TABLE notes ADD COLUMN document_kind TEXT NOT NULL DEFAULT 'note'",
                [],
            )
            .map_err(|err| err.to_string())?;
    }
    if !has_column(connection, "chunks", "block_anchor")? {
        connection
            .execute("ALTER TABLE chunks ADD COLUMN block_anchor TEXT", [])
            .map_err(|err| err.to_string())?;
    }
    Ok(())
}

fn migrate_edge_columns(connection: &Connection) -> Result<(), String> {
    if !has_column(connection, "edges", "generation_id")? {
        connection
            .execute(
                "ALTER TABLE edges ADD COLUMN generation_id TEXT NOT NULL DEFAULT ''",
                [],
            )
            .map_err(|err| err.to_string())?;
    }
    if !has_column(connection, "edges", "provenance")? {
        connection
            .execute(
                "ALTER TABLE edges ADD COLUMN provenance TEXT NOT NULL DEFAULT 'legacy'",
                [],
            )
            .map_err(|err| err.to_string())?;
    }
    Ok(())
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
        ann_label_for, clear_atlas_cache, delete_note, edge_dirty_count,
        edge_generation_requires_full_rebuild, edges_are_stale_for_generation,
        edges_are_stale_for_model, ensure_schema, for_each_chunk_embedding, load_dirty_edge_paths,
        mark_running_jobs_interrupted, move_note, open_database, rebuild_edges,
        rebuild_edges_with_provenance, repair_dirty_edges, save_atlas_positions,
        sum_chunk_text_bytes, upsert_note_chunks, SemanticNoteMetadata, StoredAtlasPosition,
    };
    use crate::note::DocumentKind;
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
        let first = ann_label_for(42, 3);
        let second = ann_label_for(42, 3);
        assert_eq!(first, second);
    }

    #[test]
    fn ann_labels_change_when_note_identity_or_ordinal_changes() {
        let baseline = ann_label_for(42, 3);
        assert_ne!(baseline, ann_label_for(42, 4));
        assert_ne!(baseline, ann_label_for(43, 3));
    }

    #[test]
    fn ann_labels_fit_in_sqlite_integer_range() {
        let label = ann_label_for(u64::MAX, usize::MAX);
        assert!(label <= i64::MAX as u64);
    }

    #[test]
    fn moving_a_note_preserves_stable_and_chunk_ann_labels() {
        let temp = TestDb::new("stable-label-move");
        let mut connection = temp.connection();
        seed_note(&mut connection, "notes/old.md", &[1.0, 0.0]);
        let before: (u64, u64) = connection
            .query_row(
                "SELECT n.stable_ann_label, c.ann_label
                 FROM notes n JOIN chunks c ON c.note_path = n.path
                 WHERE n.path = 'notes/old.md'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .expect("labels before move");

        assert!(move_note(&mut connection, "notes/old.md", "archive/new.md").expect("move"));
        let after: (u64, u64) = connection
            .query_row(
                "SELECT n.stable_ann_label, c.ann_label
                 FROM notes n JOIN chunks c ON c.note_path = n.path
                 WHERE n.path = 'archive/new.md'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .expect("labels after move");

        assert_eq!(before, after);
        assert!(after.0 <= i64::MAX as u64);
        assert!(after.1 <= i64::MAX as u64);
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
    fn incremental_edge_repair_preserves_unrelated_and_repairs_reverse_neighbors() {
        let temp = TestDb::new("edges-incremental");
        let mut connection = temp.connection();
        seed_note_version(&mut connection, "a.md", &[1.0, 0.0, 0.0], "a-v1");
        seed_note_version(&mut connection, "b.md", &[0.99, 0.01, 0.0], "b-v1");
        seed_note_version(&mut connection, "c.md", &[0.0, 1.0, 0.0], "c-v1");
        seed_note_version(&mut connection, "d.md", &[0.0, 0.0, 1.0], "d-v1");
        seed_note_version(&mut connection, "e.md", &[0.0, 0.0, 0.99], "e-v1");
        rebuild_edges_with_provenance(&mut connection, 1, 0.8, "note-gen-1", "model-v1", |_, _| {})
            .expect("full edge generation");
        let unrelated_before: (f32, String) = connection
            .query_row(
                "SELECT score, generation_id FROM edges
                 WHERE source_note_path = 'd.md' AND target_note_path = 'e.md'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .expect("unrelated edge");
        assert!(!edges_are_stale_for_model(&connection, Some("model-v1")).expect("fresh"));
        assert!(edges_are_stale_for_generation(
            &connection,
            "model-v1",
            Some("different-note-generation")
        )
        .expect("generation mismatch"));

        seed_note_version(&mut connection, "a.md", &[0.0, 1.0, 0.0], "a-v2");
        assert!(edges_are_stale_for_model(&connection, Some("model-v1")).expect("dirty stale"));
        let mut searched = Vec::new();
        let stats = repair_dirty_edges(
            &mut connection,
            1,
            0.8,
            8,
            "note-gen-2",
            "model-v1",
            |_, path, _| {
                searched.push(path.to_string());
                Ok(match path {
                    "a.md" => vec!["c.md".to_string()],
                    "b.md" => vec!["a.md".to_string(), "c.md".to_string()],
                    "c.md" => vec!["a.md".to_string(), "b.md".to_string()],
                    _ => Vec::new(),
                })
            },
        )
        .expect("incremental repair");

        assert!(stats.affected_count >= 3);
        assert!(searched.iter().any(|path| path == "c.md"));
        let old_edge_count: usize = connection
            .query_row(
                "SELECT COUNT(*) FROM edges
                 WHERE source_note_path = 'a.md' AND target_note_path = 'b.md'",
                [],
                |row| row.get(0),
            )
            .expect("old edge count");
        let new_edge_count: usize = connection
            .query_row(
                "SELECT COUNT(*) FROM edges
                 WHERE source_note_path = 'a.md' AND target_note_path = 'c.md'",
                [],
                |row| row.get(0),
            )
            .expect("new edge count");
        let unrelated_after: (f32, String) = connection
            .query_row(
                "SELECT score, generation_id FROM edges
                 WHERE source_note_path = 'd.md' AND target_note_path = 'e.md'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .expect("preserved unrelated edge");
        assert_eq!(old_edge_count, 0);
        assert_eq!(new_edge_count, 1);
        assert_eq!(unrelated_before, unrelated_after);
        assert!(!edges_are_stale_for_model(&connection, Some("model-v1")).expect("repaired"));
    }

    #[test]
    fn deletes_and_moves_enqueue_paths_and_former_neighbors() {
        let temp = TestDb::new("edges-delete-move");
        let mut connection = temp.connection();
        seed_note_version(&mut connection, "a.md", &[1.0, 0.0], "a-v1");
        seed_note_version(&mut connection, "b.md", &[1.0, 0.0], "b-v1");
        rebuild_edges_with_provenance(&mut connection, 1, 0.8, "note-gen-1", "model-v1", |_, _| {})
            .expect("full edges");

        delete_note(&mut connection, "a.md").expect("delete");
        let deleted_dirty = load_dirty_edge_paths(&connection).expect("delete dirties");
        assert!(deleted_dirty.contains(&"a.md".to_string()));
        assert!(deleted_dirty.contains(&"b.md".to_string()));
        assert_eq!(edge_dirty_count(&connection).expect("dirty count"), 2);

        rebuild_edges_with_provenance(&mut connection, 1, 0.8, "note-gen-2", "model-v1", |_, _| {})
            .expect("reconcile delete");
        seed_note_version(&mut connection, "c.md", &[1.0, 0.0], "c-v1");
        rebuild_edges_with_provenance(&mut connection, 1, 0.8, "note-gen-3", "model-v1", |_, _| {})
            .expect("edges before move");
        assert!(move_note(&mut connection, "c.md", "moved.md").expect("move"));
        let moved_dirty = load_dirty_edge_paths(&connection).expect("move dirties");
        assert!(moved_dirty.contains(&"c.md".to_string()));
        assert!(moved_dirty.contains(&"moved.md".to_string()));
        assert!(moved_dirty.contains(&"b.md".to_string()));
    }

    #[test]
    fn startup_marks_abandoned_running_jobs_interrupted() {
        let test_db = TestDb::new("interrupted-job");
        let connection = open_database(&test_db.path).expect("open db");
        ensure_schema(&connection).expect("schema");
        connection.execute(
            "INSERT INTO index_jobs (id, status, scanned_count, embedded_count, started_at_millis, updated_at_millis)
             VALUES (1, 'running', 3, 2, 1, 1)",
            [],
        ).expect("insert running job");
        assert_eq!(
            mark_running_jobs_interrupted(&connection).expect("interrupt jobs"),
            1
        );
        let status: String = connection
            .query_row("SELECT status FROM index_jobs WHERE id = 1", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(status, "interrupted");
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

    #[test]
    fn clear_atlas_cache_removes_positions_and_legacy_settings() {
        let temp = TestDb::new("atlas-cache-clear");
        let mut connection = temp.connection();
        save_atlas_positions(
            &mut connection,
            &[StoredAtlasPosition {
                note_path: "notes/one.md".to_string(),
                x: 1.0,
                y: 2.0,
            }],
        )
        .expect("save positions");
        connection
            .execute(
                "INSERT INTO settings (key, value_json) VALUES
                 ('atlas_layout_signature', '\"sig-v1\"'),
                 ('atlas_graph_snapshot', '{}')",
                [],
            )
            .expect("seed legacy settings");

        clear_atlas_cache(&connection).expect("clear atlas cache");

        let position_count: i64 = connection
            .query_row("SELECT COUNT(*) FROM atlas_positions", [], |row| row.get(0))
            .expect("count positions");
        let settings_count: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM settings WHERE key IN ('atlas_layout_signature', 'atlas_graph_snapshot')",
                [],
                |row| row.get(0),
            )
            .expect("count settings");
        assert_eq!(position_count, 0);
        assert_eq!(settings_count, 0);
    }

    #[test]
    fn note_ann_generation_mismatch_forces_full_edge_rebuild() {
        let temp = TestDb::new("edge-generation-mismatch");
        let mut connection = temp.connection();
        seed_note(&mut connection, "notes/one.md", &[1.0, 0.0]);
        rebuild_edges_with_provenance(&mut connection, 4, 0.5, "note-ann-1", "model-v1", |_, _| {})
            .expect("seed edge generation");

        assert!(
            !edge_generation_requires_full_rebuild(&connection, "note-ann-1", "model-v1")
                .expect("matching generation")
        );
        assert!(
            edge_generation_requires_full_rebuild(&connection, "note-ann-2", "model-v1")
                .expect("mismatched generation")
        );
    }

    fn seed_note(connection: &mut Connection, note_path: &str, embedding: &[f32]) {
        seed_note_version(connection, note_path, embedding, "seed-v1");
    }

    fn seed_note_version(
        connection: &mut Connection,
        note_path: &str,
        embedding: &[f32],
        semantic_version: &str,
    ) {
        let chunk = SemanticChunk {
            ordinal: 0,
            section_label: "Body".to_string(),
            text: format!("text for {note_path}"),
            text_hash: hash(note_path.as_bytes()).to_hex().to_string(),
            start_line: 1,
            end_line: 1,
            block_anchor: None,
        };
        upsert_note_chunks(
            connection,
            note_path,
            "Seed",
            1,
            "seed-hash",
            "2026-01-01T00:00:00Z",
            "2026-01-01T00:00:00Z",
            DocumentKind::Note,
            &SemanticNoteMetadata {
                semantic_input_hash: semantic_version.to_string(),
                structure_hash: format!("structure-{note_path}"),
                presentation_hash: format!("presentation-{note_path}"),
                ..SemanticNoteMetadata::default()
            },
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
