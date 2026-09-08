//! Disposable schema-14 scale evidence. No fabricated retained records.
use super::*;

const KIND: &str = "gneauxghts-current-scale-v2";
const REVISIONS: usize = 10_000;
const BYTES: usize = 64 * 1024;

fn validate_disposable_run(path: &Path) -> Result<(), String> {
    let canonical = fs::canonicalize(path).map_err(|e| e.to_string())?;
    let temp = fs::canonicalize(std::env::temp_dir()).map_err(|e| e.to_string())?;
    if canonical != path
        || path.parent() != Some(temp.as_path())
        || !path
            .file_name()
            .and_then(|n| n.to_str())
            .is_some_and(|n| n.starts_with("gneauxghts-timeline-run-"))
    {
        return Err("Scale probe requires a canonical direct disposable temp child".into());
    }
    fn inspect(path: &Path) -> Result<(), String> {
        let kind = fs::symlink_metadata(path)
            .map_err(|e| e.to_string())?
            .file_type();
        if kind.is_symlink() {
            return Err("Scale probe refuses symlinks".into());
        }
        if kind.is_dir() {
            for entry in fs::read_dir(path).map_err(|e| e.to_string())? {
                inspect(&entry.map_err(|e| e.to_string())?.path())?;
            }
        } else if !kind.is_file() {
            return Err("Unsupported fixture file type".into());
        }
        Ok(())
    }
    inspect(path)?;
    for name in ["vault", "data"] {
        if !path.join(name).is_dir() {
            return Err("Missing fixture directory".into());
        }
    }
    Ok(())
}

#[test]
#[cfg(unix)]
fn current_scale_probe_refuses_escaped_fixture_before_initialization() {
    let run = TestDir::new("timeline-run-preflight");
    let root = fs::canonicalize(run.path()).unwrap();
    let external = TestDir::new("scale-external-sentinel");
    fs::write(external.path().join("sentinel"), "untouched").unwrap();
    fs::create_dir(root.join("vault")).unwrap();
    fs::create_dir(root.join("data")).unwrap();
    validate_disposable_run(&root).unwrap();
    for target in [root.join("data/escaped"), root.join("vault/.gneauxghts")] {
        std::os::unix::fs::symlink(external.path(), &target).unwrap();
        assert!(validate_disposable_run(&root)
            .unwrap_err()
            .contains("symlinks"));
        assert_eq!(
            fs::read_to_string(external.path().join("sentinel")).unwrap(),
            "untouched"
        );
        fs::remove_file(target).unwrap();
    }
    let nested = root.join("gneauxghts-timeline-run-nested");
    fs::create_dir(&nested).unwrap();
    assert!(validate_disposable_run(&nested).is_err());
}

fn metric(name: &str, samples: &mut [f64], budget: Option<f64>) -> bool {
    println!(
        "SCALE_SAMPLES {}",
        serde_json::json!({"name":name,"milliseconds":samples})
    );
    report(name, samples, budget)
}

#[test]
#[ignore = "100k current-policy production writes; sequential optimized diagnostic"]
fn release_current_scale_fixture() {
    let _guard = crate::test_support::lock_test_env();
    let count: usize = std::env::var("GNEAUXGHTS_SCALE_NOTES")
        .unwrap()
        .parse()
        .unwrap();
    assert!([1, 901].contains(&count));
    let export = PathBuf::from(std::env::var("GNEAUXGHTS_SCALE_EXPORT").unwrap());
    assert!(!export.exists(), "export must be new and disposable");
    let data = TestDir::new("current-scale-data");
    let notes = TestDir::new("current-scale-vault");
    crate::state::initialize_app_data_dir(data.path().to_path_buf()).unwrap();
    crate::state::set_notes_root_override(Some(notes.path().to_path_buf())).unwrap();
    crate::state::ensure_vault_scaffold(notes.path()).unwrap();
    let state = state();
    let time = windows::clock(&state);
    let started = Instant::now();
    let mut fixture_notes = Vec::new();
    for index in 0..count {
        let retained_count = if index == 0 { REVISIONS } else { 100 };
        let previous_count = if index == 0 {
            0
        } else {
            REVISIONS + (index - 1) * 100
        };
        let title = format!("Scale note {index:02}");
        let (path, id) = save(&state, &title, body(BYTES, 0), None);
        for revision in 1..retained_count {
            let diagnostic = (index == 0 && [1, 1000, 5000, 9999].contains(&revision))
                || ([1, 450, 900].contains(&index) && [1, 50, 99].contains(&revision));
            let mut saves = Vec::new();
            let mut seals = Vec::new();
            measure(&mut saves, || {
                save(
                    &state,
                    &title,
                    body(BYTES, revision * 2 - 1),
                    Some(path.clone()),
                )
            });
            windows::advance(&time, 1000);
            measure(&mut saves, || {
                save(
                    &state,
                    &title,
                    body(BYTES, revision * 2),
                    Some(path.clone()),
                )
            });
            measure(&mut seals, || windows::seal(&state, &time));
            if diagnostic {
                println!(
                    "SCALE_WRITE_SAMPLE {}",
                    serde_json::json!({"note_index":index,"retained_before":revision,"save_ms":saves,"seal_ms":seals,"budget":null})
                );
            }
            if (previous_count + revision + 1) % 1000 == 0 {
                println!(
                    "SCALE_PROGRESS {}",
                    serde_json::json!({"retained":previous_count+revision+1,"target":if count==1 {REVISIONS} else {100_000},"elapsed_seconds":started.elapsed().as_secs_f64()})
                );
            }
        }
        let retained = state
            .note_timeline()
            .open_history_mode(id.clone())
            .revisions()
            .unwrap();
        assert_eq!(retained.len(), retained_count);
        fixture_notes.push(serde_json::json!({"title":title,"noteId":id.as_str(),"revisions":retained_count,"windows":retained_count-1,"saves":2*(retained_count-1),"bytes":BYTES}));
        if index == 0 || index % 100 == 0 {
            windows::storage(notes.path(), &format!("current_scale_note_{index}_open"));
        }
    }
    metric(
        "fixture_generation",
        &mut [started.elapsed().as_secs_f64() * 1000.0],
        None,
    );
    let active_note_id = fixture_notes[0]["noteId"].as_str().unwrap();
    crate::state::db_mark_note_opened(active_note_id).unwrap();
    state.note_timeline().clean_close(notes.path()).unwrap();
    windows::storage(notes.path(), "current_scale_closed");
    fs::write(data.path().join("release-current-scale-fixture.json"), serde_json::to_vec_pretty(&serde_json::json!({"kind":KIND,"activeNoteId":active_note_id,"notes":fixture_notes,"workload":"one 10000-revision note; optionally 900 additional 100-revision notes; each begins with one creation; two distinct ordinary editor production saves per window; fixed continuous deadline; 64 KiB repeated Markdown with changed first line"})).unwrap()).unwrap();
    drop(state);
    windows::copy_tree(notes.path(), &export.join("vault"));
    windows::copy_tree(data.path(), &export.join("data"));
    crate::state::set_notes_root_override(None).unwrap();
}

#[test]
#[ignore = "fresh OS process against a marked disposable current-scale clone"]
fn release_current_scale_probe() {
    let _guard = crate::test_support::lock_test_env();
    let run = PathBuf::from(std::env::var("GNEAUXGHTS_SCALE_RUN").unwrap());
    validate_disposable_run(&run).unwrap();
    let marker: serde_json::Value =
        serde_json::from_slice(&fs::read(run.join("run.json")).unwrap()).unwrap();
    assert_eq!(marker["kind"], KIND);
    let manifest: serde_json::Value = serde_json::from_slice(
        &fs::read(run.join("data/release-current-scale-fixture.json")).unwrap(),
    )
    .unwrap();
    assert_eq!(manifest["kind"], KIND);
    let notes = run.join("vault");
    crate::state::initialize_app_data_dir(run.join("data")).unwrap();
    crate::state::set_notes_root_override(Some(notes.clone())).unwrap();
    let fixture_notes = manifest["notes"].as_array().unwrap();
    let id = NoteIdentity::new(fixture_notes[0]["noteId"].as_str().unwrap());
    println!(
        "SCALE_PROCESS {}",
        serde_json::json!({"pid":std::process::id(),"scope":"fresh Rust test process, production runtime recovery and target-note verification; warm OS caches; no native IPC or paint"})
    );
    let started = Instant::now();
    let state = state();
    let first = state
        .note_timeline()
        .open_history_mode(id.clone())
        .page(None, 30)
        .unwrap();
    assert_eq!(first.records().len(), 30);
    metric(
        "fresh_process_first_recovered_page",
        &mut [started.elapsed().as_secs_f64() * 1000.0],
        None,
    );
    assert_eq!(
        history_store::integrity_snapshot_count(),
        0,
        "foreground first page must not attest unrelated history"
    );
    measure_background(&state, &id, started);
    let mut passed = true;
    for (note_index, note) in fixture_notes
        .iter()
        .enumerate()
        .filter(|(i, _)| [0, 1, fixture_notes.len() / 2, fixture_notes.len() - 1].contains(i))
    {
        let retained_count = note["revisions"].as_u64().unwrap() as usize;
        println!(
            "SCALE_REPRESENTATIVE {}",
            serde_json::json!({"note_index":note_index,"note":note["title"],"revisions":retained_count,"total_notes":fixture_notes.len()})
        );
        let id = NoteIdentity::new(note["noteId"].as_str().unwrap());
        let history = state.note_timeline().open_history_mode(id.clone());
        let revisions = history.revisions().unwrap();
        assert_eq!(revisions.len(), retained_count);
        for index in [0, retained_count - 1] {
            assert_eq!(
                history
                    .reconstruct(&revisions[index].identity)
                    .unwrap()
                    .body(),
                body(BYTES, index * 2)
            );
        }
        // Traverse every record using actual cursors. Retain one bounded old-page
        // cursor for steady-state paging; this is not old-citation navigation.
        let mut cursor = None;
        let mut deep_cursor = None;
        let mut records = 0;
        let cursor_started = Instant::now();
        let mut page_calls = 0;
        loop {
            let page = history.page(cursor.as_deref(), 30).unwrap();
            page_calls += 1;
            records += page.records().len();
            cursor = page.next_cursor().map(str::to_string);
            if records >= retained_count * 9 / 10 && deep_cursor.is_none() {
                deep_cursor = cursor.clone();
            }
            if cursor.is_none() {
                break;
            }
        }
        assert_eq!(
            records,
            retained_count + 1,
            "creation lifecycle event is an additional record"
        );
        println!(
            "SCALE_CURSOR_SETUP {}",
            serde_json::json!({"note":note["title"],"page_calls":page_calls,"records":records,"elapsed_ms":cursor_started.elapsed().as_secs_f64()*1000.0,"scope":"full sequential traversal including locating the old-page cursor; excluded from steady-state deep-page samples"})
        );
        let mut entry = Vec::new();
        let mut pages = Vec::new();
        let mut deep = Vec::new();
        let mut diffs = Vec::new();
        let mut reconstruction = Vec::new();
        let mut preview = Vec::new();
        for sample in 0..20 {
            let index = 1 + sample * (retained_count - 3) / 19;
            let revision = &revisions[index].identity;
            println!(
                "SCALE_SELECTION {}",
                serde_json::json!({"note":note["title"],"sample":sample,"zero_based_revision_index":index,"revision_id":revision.as_str(),"body_revision":index*2})
            );
            measure(&mut entry, || {
                let h = state.note_timeline().open_history_mode(id.clone());
                h.page(None, 30).unwrap();
                h.diff(
                    revisions.last().unwrap().identity.as_str(),
                    HistoryDiffComparison::Parent,
                )
                .unwrap();
            });
            measure(&mut pages, || history.page(None, 30).unwrap());
            measure(&mut deep, || {
                history.page(deep_cursor.as_deref(), 30).unwrap()
            });
            measure(&mut diffs, || {
                history
                    .diff(revision.as_str(), HistoryDiffComparison::Parent)
                    .unwrap()
            });
            let rebuilt = measure(&mut reconstruction, || {
                history.reconstruct(revision).unwrap()
            });
            let restored = measure(&mut preview, || {
                history.restore_preview(revision.as_str()).unwrap()
            });
            assert_eq!(rebuilt.body(), body(BYTES, index * 2));
            assert_eq!(restored.body(), rebuilt.body());
        }
        for (name, samples, budget) in [
            ("entry_page_and_diff", &mut entry, 250.0),
            ("page_30", &mut pages, 250.0),
            ("deep_page_30", &mut deep, 250.0),
            ("diff", &mut diffs, 250.0),
            ("reconstruct", &mut reconstruction, 1000.0),
            ("restore_preview", &mut preview, 1000.0),
        ] {
            passed &= metric(
                &format!("{}_{}", note["title"].as_str().unwrap(), name),
                samples,
                Some(budget),
            );
        }
    }
    windows::storage(&notes, "probe_open");
    state.note_timeline().clean_close(&notes).unwrap();
    windows::storage(&notes, "probe_closed");
    crate::state::set_notes_root_override(None).unwrap();
    assert!(passed, "current-format scale backend budget exceeded");
}

#[test]
#[ignore = "100 production windows on a fresh note alongside retained 10k history"]
fn release_current_scale_write_probe() {
    let _guard = crate::test_support::lock_test_env();
    let run = PathBuf::from(std::env::var("GNEAUXGHTS_SCALE_RUN").unwrap());
    validate_disposable_run(&run).unwrap();
    let marker: serde_json::Value =
        serde_json::from_slice(&fs::read(run.join("run.json")).unwrap()).unwrap();
    assert_eq!(marker["kind"], KIND);
    let workload: serde_json::Value = serde_json::from_slice(
        &fs::read(run.join("data/release-current-scale-fixture.json")).unwrap(),
    )
    .unwrap();
    assert_eq!(workload["kind"], KIND);
    crate::state::initialize_app_data_dir(run.join("data")).unwrap();
    let notes = run.join("vault");
    crate::state::set_notes_root_override(Some(notes.clone())).unwrap();
    let state = state();
    let time = windows::clock(&state);
    let (path, id) = save(&state, "Scale write probe", body(BYTES, 0), None);
    let mut saves = Vec::new();
    let mut seals = Vec::new();
    for revision in 1..=100 {
        measure(&mut saves, || {
            save(
                &state,
                "Scale write probe",
                body(BYTES, revision * 2 - 1),
                Some(path.clone()),
            )
        });
        windows::advance(&time, 1000);
        measure(&mut saves, || {
            save(
                &state,
                "Scale write probe",
                body(BYTES, revision * 2),
                Some(path.clone()),
            )
        });
        measure(&mut seals, || windows::seal(&state, &time));
    }
    metric("write_probe_save", &mut saves, None);
    metric("write_probe_seal", &mut seals, None);
    let history = state.note_timeline().open_history_mode(id);
    let revisions = history.revisions().unwrap();
    assert_eq!(revisions.len(), 101);
    assert_eq!(
        history
            .reconstruct(&revisions.last().unwrap().identity)
            .unwrap()
            .body(),
        body(BYTES, 200)
    );
    state.note_timeline().clean_close(&notes).unwrap();
    crate::state::set_notes_root_override(None).unwrap();
}

#[test]
#[ignore = "issue 50 direct citation probes on admitted current-format disposable clones"]
fn release_current_scale_citation_probe() {
    let _guard = crate::test_support::lock_test_env();
    let run = PathBuf::from(std::env::var("GNEAUXGHTS_SCALE_RUN").unwrap());
    validate_disposable_run(&run).unwrap();
    let marker: serde_json::Value =
        serde_json::from_slice(&fs::read(run.join("run.json")).unwrap()).unwrap();
    assert_eq!(marker["kind"], KIND);
    let manifest: serde_json::Value = serde_json::from_slice(
        &fs::read(run.join("data/release-current-scale-fixture.json")).unwrap(),
    )
    .unwrap();
    assert_eq!(manifest["kind"], KIND);
    crate::state::initialize_app_data_dir(run.join("data")).unwrap();
    let notes = run.join("vault");
    crate::state::set_notes_root_override(Some(notes.clone())).unwrap();
    let start = Instant::now();
    let (state, startup_work) = history_store::sql_work::measure(|| {
        let state = state();
        let hot_id = NoteIdentity::new(manifest["notes"][0]["noteId"].as_str().unwrap());
        state
            .note_timeline()
            .open_history_mode(hot_id)
            .page(None, 30)
            .unwrap();
        state
    });
    println!(
        "CITATION_STARTUP {}",
        serde_json::json!({"pid": std::process::id(), "notes":manifest["notes"].as_array().unwrap().len(), "sql_work":startup_work, "elapsed_ms":start.elapsed().as_secs_f64()*1000.0, "scope":"fresh production recovery and hot-note verification; warm OS caches; foreground SQL only"})
    );
    assert_eq!(history_store::integrity_snapshot_count(), 0);
    let hot_id = NoteIdentity::new(manifest["notes"][0]["noteId"].as_str().unwrap());
    measure_background(&state, &hot_id, start);
    let plan = history_store::sql_work::successor_plan(&state.note_timeline().runtime.store);
    assert!(plan
        .iter()
        .any(|step| step.contains("SEARCH revisions USING INDEX revisions_by_predecessor")));
    assert!(plan
        .iter()
        .any(|step| step
            .contains("SEARCH lifecycle_events USING INDEX lifecycle_events_by_predecessor")));
    assert!(!plan
        .iter()
        .any(|step| step.contains("SCAN revisions") || step.contains("SCAN lifecycle_events")));
    println!("CITATION_QUERY_PLAN {}", serde_json::json!(plan));
    let mut samples = Vec::new();
    for (note_index, note) in manifest["notes"]
        .as_array()
        .unwrap()
        .iter()
        .enumerate()
        .filter(|(i, _)| [0, 1, 450, 900].contains(i))
    {
        let id = NoteIdentity::new(note["noteId"].as_str().unwrap());
        let history = state.note_timeline().open_history_mode(id.clone());
        // Selection and independent expected lineage are untimed fixture setup.
        // The production context request receives only Note + Revision Identity.
        let revisions = history.revisions().unwrap();
        for index in [
            0,
            1,
            50,
            revisions.len() / 2,
            revisions.len() - 2,
            revisions.len() - 1,
        ] {
            let revision = revisions[index].identity.as_str();
            for sample in 0..5 {
                let start = Instant::now();
                let (page, work) = history_store::sql_work::measure(|| {
                    history.revision_context(revision, None).unwrap()
                });
                let elapsed = start.elapsed().as_secs_f64() * 1000.0;
                assert!(page.records.len() <= 31);
                assert!(page
                    .records
                    .iter()
                    .any(|record| record.revision_id() == Some(revision)));
                assert!(
                    work.vm_steps < 100_000,
                    "bounded context SQL exceeded work allowance: {work:?}"
                );
                assert!(
                    work.fullscan_steps < 100,
                    "context must not scan retained tables: {work:?}"
                );
                let start = Instant::now();
                history
                    .diff(revision, HistoryDiffComparison::Parent)
                    .unwrap();
                let diff_ms = start.elapsed().as_secs_f64() * 1000.0;
                assert_eq!(
                    history
                        .reconstruct(&revisions[index].identity)
                        .unwrap()
                        .body(),
                    body(BYTES, index * 2)
                );
                let mut nearby = Vec::new();
                for (direction, cursor) in [
                    ("older", page.next_cursor.as_deref()),
                    ("newer", page.previous_cursor.as_deref()),
                ] {
                    if let Some(cursor) = cursor {
                        let (neighbor, query) = history_store::sql_work::measure(|| {
                            history.revision_context(revision, Some(cursor)).unwrap()
                        });
                        assert!(neighbor.records.len() <= 31);
                        assert!(
                            query.vm_steps < 100_000 && query.fullscan_steps < 100,
                            "{query:?}"
                        );
                        assert!(neighbor.records.iter().all(|record| !page
                            .records
                            .iter()
                            .any(|old| old.record_id() == record.record_id())));
                        nearby.push(serde_json::json!({"direction": direction, "rows":neighbor.records.len(), "sql_work":query}));
                    }
                }
                samples.push(serde_json::json!({"note_index": note_index, "note_id":id.as_str(), "revision_index":index, "revision_id":revision, "retained_revisions":revisions.len(), "sample":sample, "context_ms":elapsed, "diff_ms":diff_ms, "entry_ms":elapsed+diff_ms, "rows":page.records.len(), "context_bytes":serde_json::to_vec(&page).unwrap().len(), "target_record":page.records.iter().find(|r| r.revision_id()==Some(revision)).unwrap(), "sql_work":work, "nearby":nearby}));
            }
        }
        assert!(matches!(
            history.revision_context("missing", None),
            Err(HistoryError::Missing(_))
        ));
    }
    println!("CITATION_SAMPLES {}", serde_json::json!(samples));
    state.note_timeline().clean_close(&notes).unwrap();
    crate::state::set_notes_root_override(None).unwrap();
}

// cfg(test) deliberately disables automatic workers. Enable the real production
// worker explicitly and observe completion; do not mistake deterministic fixtures
// for production scheduling. All times share this process's monotonic Instant.
fn measure_background(state: &AppState, id: &NoteIdentity, started: Instant) {
    let before = state.note_timeline().history_readiness(Some(id)).unwrap();
    assert_eq!(before.state, HistoryReadinessState::Ready);
    println!(
        "SCALE_READINESS {}",
        serde_json::json!({"elapsed_ms":started.elapsed().as_secs_f64()*1000.0,"snapshot":before,"phase":"target-ready-before-worker"})
    );
    state.note_timeline().runtime.start_history_verification();
    let mut previous = started.elapsed().as_secs_f64() * 1000.0;
    loop {
        let snapshot = state.note_timeline().history_readiness(Some(id)).unwrap();
        let elapsed = started.elapsed().as_secs_f64() * 1000.0;
        assert!(!matches!(
            snapshot.state,
            HistoryReadinessState::Corrupt | HistoryReadinessState::Unavailable
        ));
        assert!(!snapshot.background_unavailable);
        if snapshot.background_complete {
            println!(
                "SCALE_BACKGROUND {}",
                serde_json::json!({"completion_observed_ms":elapsed,"previous_incomplete_observation_ms":previous,"sampling_interval_ms":10,"snapshot":snapshot,"scope":"real worker explicitly enabled after first target-page admission; process monotonic clock; completion observation bound"})
            );
            break;
        }
        assert!(
            started.elapsed().as_secs() < 180,
            "background coverage stalled"
        );
        previous = elapsed;
        std::thread::sleep(std::time::Duration::from_millis(10));
    }
}
