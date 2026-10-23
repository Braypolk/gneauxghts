//! Immutable production-generated reader inputs and a checkpoint-boundary precondition.
use super::*;
use crate::{
    commands::note_persistence,
    test_support::{TestDir, TestVault},
};
use rusqlite::{params, Connection, OpenFlags};
use sha2::{Digest, Sha256};
use std::{
    collections::BTreeMap,
    io::Cursor,
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc,
    },
};

const SCHEMA: u64 = 15;
const ROOT: &str = "/gneauxghts-history-read-fixture";
const DATABASE: &str = ".gneauxghts/history.sqlite3";
const MANIFEST: &str = ".gneauxghts/vault.json";

#[derive(Clone, Copy, Debug)]
pub(super) enum HistoryFixture {
    InventorySparse,
    InventoryDense,
    NineDense,
    RevisionContext,
    CheckpointPrefix,
}

impl HistoryFixture {
    fn name(self) -> &'static str {
        match self {
            Self::InventorySparse => "inventory-sparse",
            Self::InventoryDense => "inventory-dense",
            Self::NineDense => "nine-dense",
            Self::RevisionContext => "revision-context",
            Self::CheckpointPrefix => "checkpoint-prefix",
        }
    }

    // Scenario notes, all notes (including excluded Window), revisions, lifecycle events.
    fn geometry(self) -> (usize, usize, usize, usize) {
        match self {
            Self::InventorySparse => (55, 56, 56, 56),
            Self::InventoryDense => (20, 21, 21, 21),
            Self::NineDense => (9, 10, 118, 10),
            Self::RevisionContext => (1, 1, 80, 8),
            Self::CheckpointPrefix => (1, 1, 127, 1),
        }
    }

    fn recipe(self) -> u32 {
        match self {
            Self::InventoryDense => 2,
            _ => 1,
        }
    }

    fn archive_path(self) -> PathBuf {
        crate::test_support::fixture_path(&format!("history-read/{}.json.zst", self.name()))
    }
}

// Fixed width and stable context keep ratio/accumulated-byte policies below
// their thresholds while every revision still changes authored content.
pub(super) fn checkpoint_body(revision: usize) -> String {
    format!(
        "# Long chain\n\nrevision {revision:03}\n\n{}",
        "Stable unchanged checkpoint context.\n"
            .repeat(64)
            .trim_end()
    )
}

fn assert_checkpoint_prefix(state: &AppState, id: &str) {
    let note = NoteIdentity::new(id);
    let timeline = state.note_timeline();
    let history = timeline.open_history_mode(note.clone());
    let revisions = history.revisions().unwrap();
    assert_eq!(revisions.len(), 127);
    let policy = history_store::checkpoint_policy_for_test(&timeline.runtime.store, &note);
    assert_eq!(policy.len(), 127);
    for (index, revision) in revisions.iter().enumerate() {
        assert_eq!(
            policy.get(revision.identity().as_str()).unwrap(),
            &(
                if index == 0 { "checkpoint" } else { "delta" }.to_owned(),
                index as u64
            ),
            "checkpoint prefix policy at revision {index}"
        );
    }
    for index in [0, 126] {
        assert_eq!(
            history
                .reconstruct(revisions[index].identity())
                .unwrap()
                .body(),
            checkpoint_body(index)
        );
    }
}

#[derive(Serialize, Deserialize)]
struct FixtureFile {
    sha256: String,
    bytes: Vec<u8>,
}

#[derive(Serialize, Deserialize)]
struct Archive {
    recipe: u32,
    schema: u64,
    kind: String,
    geometry: (usize, usize, usize, usize),
    note_ids: Vec<String>,
    // Paths in the database use ROOT; this archive contains no generator temp root.
    files: BTreeMap<String, FixtureFile>,
}

fn digest(bytes: &[u8]) -> String {
    hex::encode(Sha256::digest(bytes))
}

fn allowed_file(name: &str) -> bool {
    name == DATABASE || name == MANIFEST || {
        let path = Path::new(name);
        path.components().count() == 1
            && matches!(
                path.components().next(),
                Some(std::path::Component::Normal(_))
            )
            && path.extension().is_some_and(|extension| extension == "md")
    }
}

fn validate_database(root: &Path, kind: HistoryFixture, ids: &[String]) {
    let db =
        Connection::open_with_flags(root.join(DATABASE), OpenFlags::SQLITE_OPEN_READ_ONLY).unwrap();
    assert_eq!(
        db.query_row("PRAGMA quick_check", [], |r| r.get::<_, String>(0))
            .unwrap(),
        "ok"
    );
    assert!(!db
        .prepare("PRAGMA foreign_key_check")
        .unwrap()
        .exists([])
        .unwrap());
    let metadata: (String, String, u64, u64, String) = db.query_row(
        "SELECT vault_id, history_format, history_generation, schema_version, portability_state FROM history_metadata",
        [], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?)),
    ).unwrap();
    assert_eq!(
        metadata.3, SCHEMA,
        "regenerate reader fixtures for the current history schema"
    );
    assert_eq!(
        metadata.4, "portable",
        "reader fixture must be cleanly closed"
    );
    let manifest: serde_json::Value =
        serde_json::from_slice(&fs::read(root.join(MANIFEST)).unwrap()).unwrap();
    assert_eq!(manifest["vaultId"], metadata.0);
    assert_eq!(manifest["historyFormat"], metadata.1);
    assert_eq!(manifest["historyGeneration"], metadata.2);
    for table in [
        "prepared_intents",
        "publication_renames",
        "pending_window_preparations",
        "pending_editing_windows",
        "pending_observations",
        "pending_deletions",
        "missing_notes",
        "baseline_initialization_failures",
        "deletion_markers",
    ] {
        assert_eq!(
            db.query_row(&format!("SELECT count(*) FROM {table}"), [], |r| r
                .get::<_, usize>(0))
                .unwrap(),
            0,
            "unsettled fixture: {table}"
        );
    }
    assert_eq!(
        db.query_row(
            "SELECT count(*) FROM publication_receipts WHERE live != 0 OR status = 'prepared'",
            [],
            |r| r.get::<_, usize>(0)
        )
        .unwrap(),
        0
    );
    assert_eq!(
        db.query_row("SELECT pending FROM history_reset_rebuild", [], |r| r
            .get::<_, u64>(0))
            .unwrap(),
        0
    );
    let (scenario, notes, revisions, events) = kind.geometry();
    assert_eq!(ids.len(), scenario);
    assert_eq!(ids.iter().collect::<HashSet<_>>().len(), scenario);
    for (table, expected) in [
        ("timeline_heads", notes),
        ("revisions", revisions),
        ("lifecycle_events", events),
    ] {
        assert_eq!(
            db.query_row(&format!("SELECT count(*) FROM {table}"), [], |r| r
                .get::<_, usize>(0))
                .unwrap(),
            expected,
            "fixture geometry: {table}"
        );
    }
    for id in ids {
        let expected = match kind {
            HistoryFixture::NineDense => 13,
            HistoryFixture::RevisionContext => 80,
            HistoryFixture::CheckpointPrefix => 127,
            _ => 1,
        };
        assert_eq!(
            db.query_row(
                "SELECT count(*) FROM revisions WHERE note_id = ?1",
                [id],
                |r| r.get::<_, usize>(0)
            )
            .unwrap(),
            expected
        );
    }
    let mut heads = db
        .prepare("SELECT note_id, current_path FROM timeline_heads")
        .unwrap();
    for row in heads
        .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))
        .unwrap()
    {
        let (id, path) = row.unwrap();
        let path = Path::new(&path);
        assert!(path.starts_with(root), "fixture head outside its root");
        let parsed = crate::note::parse_note(&fs::read_to_string(path).unwrap());
        assert_eq!(parsed.frontmatter.managed.unwrap().id, id);
    }
}

// Only settled test geometry is relocated. Payloads, IDs, times, receipts and hashes stay intact.
fn relocate(root: &Path, from: &Path, to: &Path) {
    let mut db = Connection::open(root.join(DATABASE)).unwrap();
    let tx = db.transaction().unwrap();
    for (table, column) in [
        ("timeline_heads", "current_path"),
        ("lifecycle_events", "path"),
        ("lifecycle_events", "previous_path"),
    ] {
        let values = {
            let mut query = tx
                .prepare(&format!(
                    "SELECT DISTINCT {column} FROM {table} WHERE {column} IS NOT NULL"
                ))
                .unwrap();
            query
                .query_map([], |r| r.get::<_, String>(0))
                .unwrap()
                .collect::<Result<Vec<_>, _>>()
                .unwrap()
        };
        for old in values {
            let relative = Path::new(&old)
                .strip_prefix(from)
                .expect("fixture path must use its declared root");
            assert!(!relative.as_os_str().is_empty());
            assert!(relative
                .components()
                .all(|part| matches!(part, std::path::Component::Normal(_))));
            let new = if to == Path::new(ROOT) {
                // Archives generated on Windows must also be readable on Unix.
                let portable = relative
                    .components()
                    .map(|part| part.as_os_str().to_str().unwrap())
                    .collect::<Vec<_>>()
                    .join("/");
                format!("{ROOT}/{portable}")
            } else {
                to.join(relative).to_string_lossy().into_owned()
            };
            tx.execute(
                &format!("UPDATE {table} SET {column} = ?1 WHERE {column} = ?2"),
                params![new, old],
            )
            .unwrap();
        }
    }
    tx.commit().unwrap();
    // Rebuild the disposable copy so freed SQLite bytes cannot retain the generator's temp path.
    db.execute_batch("VACUUM").unwrap();
    // Close every relocation handle before runtime admission or reading archive bytes.
    db.execute_batch("PRAGMA wal_checkpoint(TRUNCATE)").unwrap();
    db.close().unwrap();
}

pub(super) fn load(kind: HistoryFixture) -> (TestVault, Vec<String>) {
    let compressed = fs::read(kind.archive_path()).expect("missing history reader fixture; run the explicit ignored generator documented in history-read/README.md");
    let archive: Archive =
        serde_json::from_slice(&zstd::stream::decode_all(Cursor::new(compressed)).unwrap())
            .unwrap();
    assert_eq!(
        archive.recipe,
        kind.recipe(),
        "regenerate stale reader fixture recipe"
    );
    assert_eq!(archive.schema, SCHEMA);
    assert_eq!(archive.kind, kind.name());
    assert_eq!(archive.geometry, kind.geometry());
    assert!(archive.files.contains_key(DATABASE) && archive.files.contains_key(MANIFEST));
    assert_eq!(archive.files.len(), kind.geometry().1 + 2);
    let fixture = TestVault::with_notes(kind.name(), |notes| {
        for (name, file) in &archive.files {
            assert!(allowed_file(name), "unexpected reader fixture file: {name}");
            assert_eq!(
                digest(&file.bytes),
                file.sha256,
                "reader fixture digest: {name}"
            );
            let path = notes.join(name);
            fs::create_dir_all(path.parent().unwrap()).unwrap();
            fs::write(path, &file.bytes).unwrap();
        }
        relocate(notes, Path::new(ROOT), notes);
        validate_database(notes, kind, &archive.note_ids);
    });
    // Materialize the fixture's derived index in one real batch, then let the
    // normal queued projections complete their task/generation bookkeeping.
    let foreground = fixture.state.foreground_guard();
    fixture
        .state
        .prewarm_notes_index(fixture.notes.path())
        .unwrap();
    fixture
        .state
        .lexical
        .sync_with_notes_index(&fixture.state.notes_index.lock().unwrap().entries)
        .unwrap();
    drop(foreground);
    fixture
        .state
        .background_index_queue
        .wait_until_idle_for_test();
    for id in &archive.note_ids {
        assert!(fixture
            .state
            .notes_index
            .lock()
            .unwrap()
            .get_note_by_note_id(id)
            .is_some());
    }
    if matches!(kind, HistoryFixture::CheckpointPrefix) {
        assert_checkpoint_prefix(&fixture.state, &archive.note_ids[0]);
    }
    (fixture, archive.note_ids)
}

fn save(
    state: &AppState,
    title: &str,
    body: String,
    path: Option<String>,
) -> crate::commands::NoteSession {
    let saved =
        note_persistence::persist_note_session_with_outcome(state, title.into(), body, path)
            .unwrap()
            .unwrap();
    assert!(
        saved.commit_warning.is_none(),
        "fixture generation must not accept degraded publication"
    );
    saved
}

fn generate(kind: HistoryFixture) {
    let data = TestDir::new("history-reader-generator-data");
    let notes = TestDir::new("history-reader-generator-notes");
    crate::state::initialize_app_data_dir(data.path().to_path_buf()).unwrap();
    crate::state::set_notes_root_override(Some(notes.path().to_path_buf())).unwrap();
    let state = AppState::new(
        crate::semantic::SemanticState::new_disabled("reader fixture generator"),
        crate::app::EventBus::disabled(),
    )
    .unwrap();
    let mut ids = Vec::new();
    let clock = Arc::new(AtomicU64::new(1_000_000));
    if matches!(
        kind,
        HistoryFixture::InventorySparse
            | HistoryFixture::InventoryDense
            | HistoryFixture::NineDense
    ) {
        save(&state, "Window", "A".into(), None);
        let sampled = clock.clone();
        state
            .note_timeline()
            .runtime
            .set_window_admission_provider(Arc::new(move |pending| {
                let wall = sampled.load(Ordering::SeqCst);
                Ok(history_store::WindowAdmission {
                    window_id: pending.map(|w| w.window_id.clone()),
                    elapsed_millis: pending.map_or(0, |w| wall - w.evidence.first_wall_millis),
                    wall_millis: wall,
                    clock_discontinuity: false,
                })
            }));
    }
    // Only derived intermediate lexical work coalesces; every canonical save stays real.
    let foreground = state.foreground_guard();
    match kind {
        HistoryFixture::InventorySparse | HistoryFixture::InventoryDense => {
            for i in 0..kind.geometry().0 {
                let body = format!(
                    "Unique inventory content {i}. {}",
                    if matches!(kind, HistoryFixture::InventoryDense) {
                        "Long but current note content. ".repeat(400)
                    } else {
                        String::new()
                    }
                );
                ids.push(
                    save(&state, &format!("Inventory {i}"), body, None)
                        .note_id
                        .unwrap(),
                );
            }
        }
        HistoryFixture::NineDense => {
            for i in 0..9 {
                let title = format!("Dense inventory {i}");
                let mut body = "Background context that was already present. ".repeat(80);
                let note = save(&state, &title, body.clone(), None);
                let id = note.note_id.unwrap();
                for j in 0..12 {
                    clock.store(1_000_000 + j * 10_000, Ordering::SeqCst);
                    body.push_str(&format!("\n\nRecorded finding {j}."));
                    save(&state, &title, body.clone(), note.path.clone());
                    state
                        .note_timeline()
                        .finalize_editing_window(&NoteIdentity::new(&id))
                        .unwrap();
                }
                ids.push(id);
            }
        }
        HistoryFixture::CheckpointPrefix => {
            let mut path = None;
            for revision in 0..127 {
                let saved = crate::test_support::save_and_finalize(
                    &state,
                    "Long Chain".into(),
                    checkpoint_body(revision),
                    path,
                )
                .unwrap()
                .unwrap();
                assert!(saved.commit_warning.is_none());
                if revision == 0 {
                    ids.push(saved.note_id.clone().unwrap());
                }
                path = saved.path;
            }
            assert_checkpoint_prefix(&state, &ids[0]);
        }
        HistoryFixture::RevisionContext => {
            let first = crate::test_support::save_and_finalize(
                &state,
                "Context 0".into(),
                "first".into(),
                None,
            )
            .unwrap()
            .unwrap();
            ids.push(first.note_id.unwrap());
            let mut path = first.path;
            for i in 1..80 {
                let saved = crate::test_support::save_and_finalize(
                    &state,
                    format!("Context {}", i / 10),
                    format!("body {i}"),
                    path,
                )
                .unwrap()
                .unwrap();
                assert!(saved.commit_warning.is_none());
                path = saved.path;
            }
        }
    }
    drop(foreground);
    state.background_index_queue.wait_until_idle_for_test();
    state.note_timeline().clean_close(notes.path()).unwrap();
    state.stop_rebuildable_projection_work().unwrap();
    drop(state);
    validate_database(notes.path(), kind, &ids);
    let wal = notes.path().join(format!("{DATABASE}-wal"));
    assert!(
        fs::metadata(wal).map_or(true, |m| m.len() == 0),
        "clean fixture cannot depend on WAL"
    );

    // Normalize a disposable export, never the source runtime or authored bytes.
    let export = TestDir::new("history-reader-export");
    let mut names = vec![MANIFEST.to_string(), DATABASE.to_string()];
    for entry in fs::read_dir(notes.path()).unwrap() {
        let entry = entry.unwrap();
        assert!(!entry.file_type().unwrap().is_symlink());
        if entry
            .path()
            .extension()
            .is_some_and(|extension| extension == "md")
        {
            names.push(entry.file_name().into_string().unwrap());
        }
    }
    for name in &names {
        let destination = export.path().join(name);
        fs::create_dir_all(destination.parent().unwrap()).unwrap();
        fs::copy(notes.path().join(name), destination).unwrap();
    }
    relocate(export.path(), notes.path(), Path::new(ROOT));
    let files = names
        .into_iter()
        .map(|name| {
            let bytes = fs::read(export.path().join(&name)).unwrap();
            (
                name,
                FixtureFile {
                    sha256: digest(&bytes),
                    bytes,
                },
            )
        })
        .collect();
    let archive = Archive {
        recipe: kind.recipe(),
        schema: SCHEMA,
        kind: kind.name().into(),
        geometry: kind.geometry(),
        note_ids: ids,
        files,
    };
    let bytes =
        zstd::stream::encode_all(Cursor::new(serde_json::to_vec(&archive).unwrap()), 3).unwrap();
    fs::write(kind.archive_path(), bytes).unwrap();
}

#[test]
#[ignore = "explicitly regenerate checked-in reader archives through canonical publication and clean close"]
fn regenerate_history_read_fixtures() {
    let _guard = crate::test_support::lock_test_env();
    for kind in [
        HistoryFixture::InventorySparse,
        HistoryFixture::InventoryDense,
        HistoryFixture::NineDense,
        HistoryFixture::RevisionContext,
        HistoryFixture::CheckpointPrefix,
    ] {
        generate(kind);
    }
}
