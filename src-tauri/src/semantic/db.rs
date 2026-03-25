use super::{
    chunking::SemanticChunk,
    embed::mean_pool,
    SemanticIndexJob, SemanticSettings,
};
use crate::time::current_time_millis;
use blake3::hash;
use rusqlite::{params, Connection, OptionalExtension};
use std::{
    collections::{HashMap, HashSet},
    fs,
    path::Path,
};

const SETTINGS_KEY: &str = "semantic_settings";

#[derive(Clone)]
pub(crate) struct StoredChunkEmbedding {
    pub(crate) text_hash: String,
    pub(crate) embedding: Vec<f32>,
}

#[derive(Clone)]
pub(crate) struct StoredChunkRow {
    pub(crate) ann_label: u64,
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

pub(crate) fn load_chunks_with_embeddings(
    connection: &Connection,
    exclude_note_path: Option<&str>,
) -> Result<Vec<StoredChunkRow>, String> {
    let sql = if exclude_note_path.is_some() {
        "
        SELECT c.ann_label, c.note_path, n.title, c.section_label, c.text, c.start_line, c.end_line, c.embedding_blob
        FROM chunks c
        INNER JOIN notes n ON n.path = c.note_path
        WHERE c.note_path != ?1
        "
    } else {
        "
        SELECT c.ann_label, c.note_path, n.title, c.section_label, c.text, c.start_line, c.end_line, c.embedding_blob
        FROM chunks c
        INNER JOIN notes n ON n.path = c.note_path
        "
    };
    let mut statement = connection.prepare(sql).map_err(|err| err.to_string())?;
    let mut rows = if let Some(excluded) = exclude_note_path {
        statement
            .query(params![excluded])
            .map_err(|err| err.to_string())?
    } else {
        statement.query([]).map_err(|err| err.to_string())?
    };
    let mut chunks = Vec::new();

    while let Some(row) = rows.next().map_err(|err| err.to_string())? {
        chunks.push(StoredChunkRow {
            ann_label: row.get::<_, u64>(0).map_err(|err| err.to_string())?,
            note_path: row.get::<_, String>(1).map_err(|err| err.to_string())?,
            note_title: row.get::<_, String>(2).map_err(|err| err.to_string())?,
            section_label: row.get::<_, String>(3).map_err(|err| err.to_string())?,
            text: row.get::<_, String>(4).map_err(|err| err.to_string())?,
            start_line: row.get::<_, usize>(5).map_err(|err| err.to_string())?,
            end_line: row.get::<_, usize>(6).map_err(|err| err.to_string())?,
            embedding: deserialize_embedding(
                &row.get::<_, Vec<u8>>(7).map_err(|err| err.to_string())?,
            ),
        });
    }

    Ok(chunks)
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
        SELECT c.ann_label, c.note_path, n.title, c.section_label, c.text, c.start_line, c.end_line, c.embedding_blob
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
            ann_label: row.get::<_, u64>(0).map_err(|err| err.to_string())?,
            note_path: row.get::<_, String>(1).map_err(|err| err.to_string())?,
            note_title: row.get::<_, String>(2).map_err(|err| err.to_string())?,
            section_label: row.get::<_, String>(3).map_err(|err| err.to_string())?,
            text: row.get::<_, String>(4).map_err(|err| err.to_string())?,
            start_line: row.get::<_, usize>(5).map_err(|err| err.to_string())?,
            end_line: row.get::<_, usize>(6).map_err(|err| err.to_string())?,
            embedding: deserialize_embedding(
                &row.get::<_, Vec<u8>>(7).map_err(|err| err.to_string())?,
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

pub(crate) fn rebuild_edges(
    connection: &mut Connection,
    neighbors_per_note: usize,
    min_score: f32,
) -> Result<(), String> {
    let notes = load_note_embeddings(connection)?;
    let updated_at_millis = current_time_millis()?;
    let transaction = connection.transaction().map_err(|err| err.to_string())?;
    transaction
        .execute("DELETE FROM edges", [])
        .map_err(|err| err.to_string())?;

    for source in &notes {
        let mut candidates = notes
            .iter()
            .filter(|target| target.note_path != source.note_path)
            .filter_map(|target| {
                let score =
                    super::similarity::cosine_similarity(&source.embedding, &target.embedding);
                if score < min_score {
                    return None;
                }

                Some((target.note_path.clone(), score))
            })
            .collect::<Vec<_>>();

        candidates.sort_by(|left, right| right.1.total_cmp(&left.1));
        candidates.truncate(neighbors_per_note);

        for (target_note_path, score) in candidates {
            let (source_note_path, target_note_path) = if source.note_path <= target_note_path {
                (source.note_path.as_str(), target_note_path.as_str())
            } else {
                (target_note_path.as_str(), source.note_path.as_str())
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
                    params![source_note_path, target_note_path, score, updated_at_millis],
                )
                .map_err(|err| err.to_string())?;
        }
    }

    transaction.commit().map_err(|err| err.to_string())
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

pub(crate) fn load_graph_positions(
    connection: &Connection,
) -> Result<Vec<StoredGraphPosition>, String> {
    let mut statement = connection
        .prepare("SELECT note_path, x, y FROM graph_positions")
        .map_err(|err| err.to_string())?;
    let mut rows = statement.query([]).map_err(|err| err.to_string())?;
    let mut positions = Vec::new();

    while let Some(row) = rows.next().map_err(|err| err.to_string())? {
        positions.push(StoredGraphPosition {
            note_path: row.get::<_, String>(0).map_err(|err| err.to_string())?,
            x: row.get::<_, f64>(1).map_err(|err| err.to_string())?,
            y: row.get::<_, f64>(2).map_err(|err| err.to_string())?,
        });
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

pub(crate) fn load_all_edges(connection: &Connection) -> Result<Vec<StoredEdge>, String> {
    let mut statement = connection
        .prepare("SELECT source_note_path, target_note_path, score FROM edges")
        .map_err(|err| err.to_string())?;
    let mut rows = statement.query([]).map_err(|err| err.to_string())?;
    let mut edges = Vec::new();

    while let Some(row) = rows.next().map_err(|err| err.to_string())? {
        edges.push(StoredEdge {
            source_note_path: row.get::<_, String>(0).map_err(|err| err.to_string())?,
            target_note_path: row.get::<_, String>(1).map_err(|err| err.to_string())?,
            score: row.get::<_, f32>(2).map_err(|err| err.to_string())?,
        });
    }

    Ok(edges)
}

pub(crate) struct StoredNoteWithMeta {
    pub(crate) path: String,
    pub(crate) title: String,
    pub(crate) created_at: String,
    pub(crate) updated_at: String,
    pub(crate) modified_millis: u64,
}

pub(crate) fn load_all_notes_with_meta(
    connection: &Connection,
) -> Result<Vec<StoredNoteWithMeta>, String> {
    let mut statement = connection
        .prepare("SELECT path, title, created_at, updated_at, modified_millis FROM notes")
        .map_err(|err| err.to_string())?;
    let mut rows = statement.query([]).map_err(|err| err.to_string())?;
    let mut notes = Vec::new();

    while let Some(row) = rows.next().map_err(|err| err.to_string())? {
        notes.push(StoredNoteWithMeta {
            path: row.get::<_, String>(0).map_err(|err| err.to_string())?,
            title: row.get::<_, String>(1).map_err(|err| err.to_string())?,
            created_at: row.get::<_, String>(2).map_err(|err| err.to_string())?,
            updated_at: row.get::<_, String>(3).map_err(|err| err.to_string())?,
            modified_millis: row.get::<_, u64>(4).map_err(|err| err.to_string())?,
        });
    }

    Ok(notes)
}

pub(crate) fn load_first_chunk_text_per_note(
    connection: &Connection,
) -> Result<HashMap<String, String>, String> {
    let mut statement = connection
        .prepare(
            "
            SELECT c.note_path, c.text
            FROM chunks c
            INNER JOIN (
                SELECT note_path, MIN(ordinal) AS min_ordinal
                FROM chunks
                GROUP BY note_path
            ) m ON c.note_path = m.note_path AND c.ordinal = m.min_ordinal
            ",
        )
        .map_err(|err| err.to_string())?;
    let mut rows = statement.query([]).map_err(|err| err.to_string())?;
    let mut snippets = HashMap::new();

    while let Some(row) = rows.next().map_err(|err| err.to_string())? {
        snippets.insert(
            row.get::<_, String>(0).map_err(|err| err.to_string())?,
            row.get::<_, String>(1).map_err(|err| err.to_string())?,
        );
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
    use super::ann_label_for;

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
}
