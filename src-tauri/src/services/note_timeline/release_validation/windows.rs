//! Current-policy production-command workloads, never synthetic retained rows.
use super::*;
use std::sync::{
    atomic::{AtomicU64, Ordering},
    Arc,
};

pub(super) struct Clock(AtomicU64);
impl runtime::WindowClock for Clock {
    fn sample(&self) -> Result<runtime::ClockSample, String> {
        let millis = self.0.load(Ordering::SeqCst);
        Ok(runtime::ClockSample {
            continuous_millis: millis,
            wall_millis: 1_780_000_000_000 + millis,
        })
    }
}
pub(super) fn clock(state: &AppState) -> Arc<Clock> {
    let clock = Arc::new(Clock(AtomicU64::new(0)));
    state
        .note_timeline()
        .runtime
        .set_window_clock(clock.clone());
    clock
}
pub(super) fn advance(clock: &Clock, millis: u64) {
    clock.0.fetch_add(millis, Ordering::SeqCst);
}
pub(super) fn seal(state: &AppState, clock: &Clock) {
    advance(clock, editing_window_policy::WINDOW_MILLIS);
    state
        .note_timeline()
        .runtime
        .poll_window_deadlines()
        .unwrap();
}
fn content(geometry: &str, edit: &str, revision: usize) -> String {
    let size = 1024 * 1024;
    if geometry == "repetitive" {
        let text = body(size, revision);
        if edit == "full" && revision % 2 == 1 {
            text.replace('e', "z").replace('a', "x")
        } else {
            text
        }
    } else {
        let mut seed = if edit == "full" {
            revision as u64 + 23
        } else {
            23
        };
        let mut text = (0..size)
            .map(|index| {
                seed = seed.wrapping_mul(6364136223846793005).wrapping_add(1);
                if index % 76 == 75 {
                    '\n'
                } else {
                    char::from(b'a' + ((seed >> 32) % 26) as u8)
                }
            })
            .collect::<String>();
        text.replace_range(0..8, &format!("{revision:08}"));
        text
    }
}
pub(super) fn storage(notes: &Path, name: &str) {
    let path = history_store::history_database_path_for_test(notes);
    let db = rusqlite::Connection::open(&path).unwrap();
    let query = |sql: &str| db.query_row(sql, [], |row| row.get::<_, u64>(0)).unwrap();
    let file =
        |suffix: &str| fs::metadata(format!("{}{suffix}", path.display())).map_or(0, |m| m.len());
    let index_bytes = db.query_row("SELECT coalesce(sum(pgsize),0) FROM dbstat WHERE name IN (SELECT name FROM sqlite_master WHERE type='index')", [], |row| row.get::<_, u64>(0)).ok();
    println!(
        "WINDOW_STORAGE {}",
        serde_json::json!({
            "name": name,
            "revisions": query("SELECT count(*) FROM revisions"),
            "window_evidence": query("SELECT count(*) FROM revision_window_evidence"),
            "pending_windows": query("SELECT count(*) FROM pending_editing_windows"),
            "prepared_intents": query("SELECT count(*) FROM prepared_intents WHERE status='prepared'"),
            "terminal_receipts": query("SELECT count(*) FROM publication_receipts WHERE status!='prepared'"),
            "receipts": query("SELECT count(*) FROM publication_receipts"),
            "revision_payload_bytes": query("SELECT coalesce(sum(length(payload)),0) FROM revisions"),
            "pending_payload_bytes": query("SELECT coalesce(sum(length(payload)),0) FROM pending_editing_windows"),
            "intent_payload_bytes": query("SELECT coalesce(sum(length(authored_payload)),0) FROM prepared_intents"),
            "index_bytes": index_bytes, "index_method": "SQLite dbstat allocated index pages; null if unavailable",
            "main_bytes": file(""), "wal_bytes": file("-wal"), "shm_bytes": file("-shm"),
            "reclaimable_bytes": query("PRAGMA freelist_count") * query("PRAGMA page_size"),
            "actual_device_write_bytes": serde_json::Value::Null,
            "io_limit": "File lengths are allocation, not cumulative writes; command timings include real durable preparation and canonical publication. Device bytes, fsync count, and write amplification were not instrumented."
        })
    );
}
pub(super) fn copy_tree(from: &Path, to: &Path) {
    fs::create_dir_all(to).unwrap();
    for entry in fs::read_dir(from).unwrap() {
        let entry = entry.unwrap();
        let target = to.join(entry.file_name());
        if entry.file_type().unwrap().is_dir() {
            copy_tree(&entry.path(), &target);
        } else {
            fs::copy(entry.path(), target).unwrap();
        }
    }
}

#[test]
#[ignore = "1 MiB actual production saves; run sequentially in release"]
fn release_window_writes() {
    let _guard = crate::test_support::lock_test_env();
    for geometry in ["repetitive", "random"] {
        for edit in ["small", "full"] {
            let name = format!("windows_1mb_{geometry}_{edit}");
            let data = TestDir::new("window-paired-data");
            let notes = TestDir::new("window-paired-vault");
            crate::state::initialize_app_data_dir(data.path().to_path_buf()).unwrap();
            crate::state::set_notes_root_override(Some(notes.path().to_path_buf())).unwrap();
            crate::state::ensure_vault_scaffold(notes.path()).unwrap();
            let state = state();
            let time = clock(&state);
            let (path, note) = save(&state, &name, content(geometry, edit, 0), None);
            storage(notes.path(), &format!("{name}_baseline"));
            let mut saves = Vec::new();
            for revision in 1..=128 {
                let body = content(geometry, edit, revision);
                measure(&mut saves, || save(&state, &name, body, Some(path.clone())));
                advance(&time, 1000);
            }
            report(&format!("{name}_save"), &mut saves, None);
            storage(notes.path(), &format!("{name}_pending"));
            let mut sealing = Vec::new();
            measure(&mut sealing, || seal(&state, &time));
            report(&format!("{name}_seal"), &mut sealing, None);
            let revisions =
                history_store::revisions(&history_store::Store::for_test(), &note).unwrap();
            assert_eq!(revisions.len(), 2);
            assert_eq!(
                history_store::reconstruct(
                    &history_store::Store::for_test(),
                    &note,
                    &revisions.last().unwrap().identity
                )
                .unwrap()
                .body,
                content(geometry, edit, 128)
            );
            assert!(
                history_store::pending_window(&history_store::Store::for_test(), &note)
                    .unwrap()
                    .is_none()
            );
            storage(notes.path(), &format!("{name}_sealed"));
            state.note_timeline().clean_close(notes.path()).unwrap();
            drop(state);
            let started = Instant::now();
            let restarted = self::state();
            let page = restarted
                .note_timeline()
                .open_history_mode(note)
                .page(None, 30)
                .unwrap();
            assert!(!page.records().is_empty());
            report(
                &format!("{name}_cold"),
                &mut [started.elapsed().as_secs_f64() * 1000.0],
                None,
            );
            restarted.note_timeline().clean_close(notes.path()).unwrap();
            storage(notes.path(), &format!("{name}_closed"));
        }
    }
    crate::state::set_notes_root_override(None).unwrap();
}

#[test]
#[ignore = "production-write window fixture with injected continuous clock"]
fn release_window_fixture() {
    let _guard = crate::test_support::lock_test_env();
    let data = TestDir::new("window-fixture-data");
    let notes = TestDir::new("window-fixture-vault");
    crate::state::initialize_app_data_dir(data.path().to_path_buf()).unwrap();
    crate::state::set_notes_root_override(Some(notes.path().to_path_buf())).unwrap();
    crate::state::ensure_vault_scaffold(notes.path()).unwrap();
    let state = state();
    let time = clock(&state);
    let (path, note) = save(&state, "Twelve windows", body(1024, 0), None);
    for window in 0..12 {
        for index in 0..300 {
            save(
                &state,
                "Twelve windows",
                body(1024, 1 + window * 300 + index),
                Some(path.clone()),
            );
            advance(&time, 1000);
        }
        // Observe pending state without invoking a read boundary. Deadline poll
        // is the same mutation-barrier callback used by the production scheduler.
        assert_eq!(
            history_store::revisions(&history_store::Store::for_test(), &note)
                .unwrap()
                .len(),
            window + 1
        );
        assert!(
            history_store::pending_window(&history_store::Store::for_test(), &note)
                .unwrap()
                .is_some()
        );
        state
            .note_timeline()
            .runtime
            .poll_window_deadlines()
            .unwrap();
        let retained = history_store::revisions(&history_store::Store::for_test(), &note).unwrap();
        assert_eq!(retained.len(), window + 2);
        assert_eq!(
            history_store::reconstruct(
                &history_store::Store::for_test(),
                &note,
                &retained.last().unwrap().identity
            )
            .unwrap()
            .body,
            body(1024, (window + 1) * 300)
        );
        assert!(
            history_store::pending_window(&history_store::Store::for_test(), &note)
                .unwrap()
                .is_none()
        );
        assert!(
            history_store::prepared_intent_count(&history_store::Store::for_test(), "finalized")
                <= (64 + window + 2) as u64
        );
        storage(
            notes.path(),
            &format!(
                "count_after_{}_windows_{}_saves",
                window + 1,
                (window + 1) * 300
            ),
        );
    }
    let mut fixture_notes = vec![
        serde_json::json!({"title":"Twelve windows", "noteId":note.as_str(), "saves":3600, "windows":12, "bytes":1024}),
    ];
    let mut passed = true;
    for geometry in ["repetitive", "random"] {
        let title = format!("Window {geometry} 1mb");
        let (path, id) = save(&state, &title, content(geometry, "small", 0), None);
        let mut saves = Vec::new();
        let mut seals = Vec::new();
        for window in 0..40 {
            for index in 0..3 {
                let body = content(geometry, "small", 1 + window * 3 + index);
                measure(&mut saves, || {
                    save(&state, &title, body, Some(path.clone()))
                });
                advance(&time, 1000);
            }
            measure(&mut seals, || seal(&state, &time));
        }
        report(&format!("fixture_{geometry}_1mb_save"), &mut saves, None);
        report(&format!("fixture_{geometry}_1mb_seal"), &mut seals, None);
        let history = state.note_timeline().open_history_mode(id.clone());
        let retained = history.revisions().unwrap();
        assert_eq!(retained.len(), 41);
        let mut pages = Vec::new();
        let mut diffs = Vec::new();
        let mut restores = Vec::new();
        let mut rebuilds = Vec::new();
        for index in 1..21 {
            measure(&mut pages, || history.page(None, 30).unwrap());
            measure(&mut diffs, || {
                history
                    .diff(
                        retained[index].identity.as_str(),
                        HistoryDiffComparison::Parent,
                    )
                    .unwrap()
            });
            let rebuilt = measure(&mut rebuilds, || {
                history.reconstruct(&retained[index].identity).unwrap()
            });
            let preview = measure(&mut restores, || {
                history
                    .restore_preview(retained[index].identity.as_str())
                    .unwrap()
            });
            assert_eq!(rebuilt.body(), content(geometry, "small", index * 3));
            assert_eq!(preview.body(), rebuilt.body());
        }
        passed &= report(
            &format!("window_{geometry}_page_30_1mb"),
            &mut pages,
            Some(250.0),
        );
        passed &= report(
            &format!("window_{geometry}_diff_1mb"),
            &mut diffs,
            Some(250.0),
        );
        passed &= report(
            &format!("window_{geometry}_reconstruct_1mb"),
            &mut rebuilds,
            Some(1000.0),
        );
        passed &= report(
            &format!("window_{geometry}_restore_preview_1mb"),
            &mut restores,
            Some(1000.0),
        );
        fixture_notes.push(serde_json::json!({"title":title,"noteId":id.as_str(),"saves":120,"windows":40,"bytes":1048576}));
    }
    storage(notes.path(), "window_fixture_sealed");
    state.note_timeline().clean_close(notes.path()).unwrap();
    fs::write(
        data.path().join("release-window-fixture.json"),
        serde_json::to_vec_pretty(
            &serde_json::json!({"kind":"gneauxghts-editing-window-v3", "notes":fixture_notes}),
        )
        .unwrap(),
    )
    .unwrap();
    if let Ok(export) = std::env::var("GNEAUXGHTS_WINDOW_FIXTURE_EXPORT") {
        copy_tree(notes.path(), &PathBuf::from(&export).join("vault"));
        copy_tree(data.path(), &PathBuf::from(&export).join("data"));
    }
    crate::state::set_notes_root_override(None).unwrap();
    assert!(passed, "window fixture warm backend budget exceeded");
}

#[test]
#[ignore = "small authentic schema-14 fixture and allocation evidence"]
fn release_compact_publication_fixture() {
    let _guard = crate::test_support::lock_test_env();
    let export = PathBuf::from(std::env::var("GNEAUXGHTS_COMPACT_FIXTURE_EXPORT").unwrap());
    let temp = fs::canonicalize(std::env::temp_dir()).unwrap();
    assert_eq!(export.parent(), Some(temp.as_path()));
    assert!(export
        .file_name()
        .unwrap()
        .to_str()
        .unwrap()
        .starts_with("gneauxghts-compact-issue52-"));
    assert!(!export.exists(), "never overwrite a fixture");
    let data = TestDir::new("compact-publication-data");
    let notes = TestDir::new("compact-publication-vault");
    crate::state::initialize_app_data_dir(data.path().to_path_buf()).unwrap();
    crate::state::set_notes_root_override(Some(notes.path().to_path_buf())).unwrap();
    let state = state();
    let time = clock(&state);
    let mut samples = Vec::new();
    let mut identities = Vec::new();
    for n in 0..3 {
        let title = format!("Compact note {n}");
        let (path, note) = save(&state, &title, body(4096, 0), None);
        for window in 0..4 {
            for publication in 1..=25 {
                measure(&mut samples, || {
                    save(
                        &state,
                        &title,
                        body(4096, window * 25 + publication),
                        Some(path.clone()),
                    )
                });
                advance(&time, 1000);
            }
            seal(&state, &time);
        }
        let history = state.note_timeline().open_history_mode(note.clone());
        let retained = history.revisions().unwrap();
        assert_eq!(retained.len(), 5);
        for (index, revision) in retained.iter().enumerate() {
            assert_eq!(
                history.reconstruct(revision.identity()).unwrap().body(),
                body(4096, index * 25)
            );
        }
        identities.push(serde_json::json!({"note":note.as_str(),"revisions":retained.iter().map(|r|r.identity().as_str()).collect::<Vec<_>>()}));
    }
    report("compact_4kb_production_save_debug", &mut samples, None);
    state.note_timeline().clean_close(notes.path()).unwrap();
    storage(notes.path(), "compact_issue52_3_notes_300_saves_12_windows");
    let db =
        rusqlite::Connection::open(history_store::history_database_path_for_test(notes.path()))
            .unwrap();
    for table in [
        "prepared_intents",
        "pending_window_preparations",
        "pending_editing_windows",
    ] {
        assert_eq!(
            db.query_row(&format!("SELECT count(*) FROM {table}"), [], |r| r
                .get::<_, u64>(0))
                .unwrap(),
            0
        );
    }
    assert_eq!(
        db.query_row("SELECT count(*) FROM publication_receipts", [], |r| r
            .get::<_, u64>(0))
            .unwrap(),
        207
    );
    assert!(db
        .prepare("PRAGMA foreign_key_check")
        .unwrap()
        .query([])
        .unwrap()
        .next()
        .unwrap()
        .is_none());
    drop(db);
    copy_tree(notes.path(), &export.join("vault"));
    copy_tree(data.path(), &export.join("data"));
    fs::write(export.join("compact-fixture.json"), serde_json::to_vec_pretty(&serde_json::json!({"kind":"gneauxghts-compact-publication-smoke-v1","schema":14,"identities":identities})).unwrap()).unwrap();
    println!("COMPACT_FIXTURE {}", export.display());
    crate::state::set_notes_root_override(None).unwrap();
}
