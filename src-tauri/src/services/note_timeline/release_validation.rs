//! Opt-in release measurements through the real persistence and History Mode seams.
//! Run alone in an optimized build; see docs/architecture/note-timeline-release-validation.md.

use super::*;
use crate::{app::EventBus, semantic::SemanticState, test_support::TestDir};
use std::time::Instant;

fn state() -> AppState {
    AppState::new(
        SemanticState::new_disabled("release measurement"),
        EventBus::disabled(),
    )
    .unwrap()
}

fn save(
    state: &AppState,
    title: &str,
    body: String,
    path: Option<String>,
) -> (String, NoteIdentity) {
    let outcome = crate::commands::note_persistence::persist_note_session_with_outcome(
        state,
        title.to_string(),
        body,
        path,
    )
    .unwrap();
    let session = outcome.session.unwrap();
    assert!(
        session.commit_warning.is_none(),
        "unexpected publication warning"
    );
    (
        session.path.unwrap(),
        NoteIdentity::new(session.note_id.unwrap()),
    )
}

fn measure<T>(samples: &mut Vec<f64>, operation: impl FnOnce() -> T) -> T {
    let started = Instant::now();
    let result = operation();
    samples.push(started.elapsed().as_secs_f64() * 1000.0);
    result
}

fn report(name: &str, samples: &mut [f64], budget_ms: Option<f64>) -> bool {
    samples.sort_by(f64::total_cmp);
    let p95 = samples[(samples.len() * 95).div_ceil(100).saturating_sub(1)];
    let passed = budget_ms.is_none_or(|budget| p95 < budget);
    println!(
        "RELEASE_METRIC {}",
        serde_json::json!({
            "name": name, "samples": samples.len(), "p50_ms": samples[samples.len()/2],
            "p95_ms": p95, "max_ms": samples.last(), "budget_ms": budget_ms, "passed": passed,
        })
    );
    passed
}

fn body(size: usize, revision: usize) -> String {
    let mut text = format!("Revision {revision:08}\n");
    while text.len() < size {
        text.push_str(
            "A repeatable Markdown line with enough text to exercise the production codec.\n",
        );
    }
    text.truncate(size);
    text
}

fn measure_large_note(state: &AppState) -> (String, bool) {
    let (large_path, large_id) = save(&state, "Large", body(1024 * 1024, 0), None);
    let mut small_edits = Vec::new();
    for revision in 1..=128 {
        measure(&mut small_edits, || {
            save(
                &state,
                "Large",
                body(1024 * 1024, revision),
                Some(large_path.clone()),
            )
        });
    }
    report("write_1mb_small_edit", &mut small_edits, None);
    let large = state.note_timeline().open_history_mode(large_id.clone());
    let retained = large.revisions().unwrap();
    let mut large_pages = Vec::new();
    let mut large_diffs = Vec::new();
    let mut large_restore = Vec::new();
    for revision in 100..120 {
        measure(&mut large_pages, || large.page(None, 50).unwrap());
        measure(&mut large_diffs, || {
            large
                .diff(
                    retained[revision].identity().as_str(),
                    HistoryDiffComparison::Parent,
                )
                .unwrap()
        });
        let preview = measure(&mut large_restore, || {
            large
                .restore_preview(retained[revision].identity().as_str())
                .unwrap()
        });
        assert_eq!(preview.body(), body(1024 * 1024, revision));
    }
    let mut passed = report("page_50_1mb", &mut large_pages, Some(250.0));
    passed &= report("diff_1mb", &mut large_diffs, Some(250.0));
    passed &= report("restore_preview_1mb", &mut large_restore, Some(1000.0));
    println!(
        "RELEASE_STORAGE {}",
        serde_json::to_string(
            &state
                .note_timeline()
                .note_history_health(&large_id)
                .unwrap()
        )
        .unwrap()
    );

    (large_path, passed)
}

#[test]
#[ignore = "optimized 1 MiB latency diagnostic"]
fn release_large_note_latency() {
    let _guard = crate::test_support::lock_test_env();
    let data = TestDir::new("release-large-data");
    let notes = TestDir::new("release-large-vault");
    crate::state::initialize_app_data_dir(data.path().to_path_buf()).unwrap();
    crate::state::set_notes_root_override(Some(notes.path().to_path_buf())).unwrap();
    crate::state::ensure_vault_scaffold(notes.path()).unwrap();
    let state = state();
    let (_, passed) = measure_large_note(&state);
    state.note_timeline().clean_close(notes.path()).unwrap();
    crate::state::set_notes_root_override(None).unwrap();
    assert!(passed, "large-note latency budget exceeded");
}

#[test]
#[ignore = "100,000 durable revisions; run explicitly with --release --ignored --nocapture"]
fn release_scale_and_availability() {
    let _guard = crate::test_support::lock_test_env();
    let app_data = TestDir::new("release-scale-data");
    let notes = TestDir::new("release-scale-vault");
    crate::state::initialize_app_data_dir(app_data.path().to_path_buf()).unwrap();
    crate::state::set_notes_root_override(Some(notes.path().to_path_buf())).unwrap();
    crate::state::ensure_vault_scaffold(notes.path()).unwrap();

    // A real baseline scan: existing managed Markdown, no synthetic database rows.
    for index in 0..1_000 {
        fs::write(
            notes.path().join(format!("Seed {index}.md")),
            format!(
                "---\ngneauxghts:\n  id: release-seed-{index}\n  kind: note\n---\n\n{}",
                body(if index == 0 { 64 * 1024 } else { 1024 }, 0),
            ),
        )
        .unwrap();
    }
    let state = state();
    let mut scan = Vec::new();
    let progress = measure(&mut scan, || {
        state
            .note_timeline()
            .initialize_existing_notes(notes.path())
            .unwrap()
    });
    assert_eq!(progress.baseline_revisions(), 1_000);
    assert_eq!(progress.failed_notes(), 0);
    report("baseline_1000_notes", &mut scan, None);

    let hot_path = notes
        .path()
        .join("Seed 0.md")
        .to_string_lossy()
        .into_owned();
    let mut early_writes = Vec::new();
    let mut late_writes = Vec::new();
    let mut ignored_samples = Vec::new();
    for revision in 1..10_000 {
        let samples = if revision <= 100 {
            &mut early_writes
        } else if revision >= 9_900 {
            &mut late_writes
        } else {
            &mut ignored_samples
        };
        measure(samples, || {
            save(
                &state,
                "Seed 0",
                body(64 * 1024, revision),
                Some(hot_path.clone()),
            )
        });
        if revision % 1_000 == 0 {
            println!("RELEASE_PROGRESS hot_note_revisions={}", revision + 1);
        }
    }
    report("write_64k_early", &mut early_writes, None);
    report("write_64k_at_10000", &mut late_writes, None);

    // 1,000 baselines + 9,999 hot-note edits + 89,001 distributed edits = 100,000.
    let mut vault_writes = Vec::new();
    for revision in 1..=89_001 {
        let index = 1 + (revision - 1) % 99;
        let title = format!("Seed {index}");
        let path = notes
            .path()
            .join(format!("{title}.md"))
            .to_string_lossy()
            .into_owned();
        let started = Instant::now();
        save(&state, &title, body(1024, revision), Some(path));
        if revision > 88_901 {
            vault_writes.push(started.elapsed().as_secs_f64() * 1000.0);
        }
        if revision % 10_000 == 0 {
            println!("RELEASE_PROGRESS vault_revisions={}", 10_999 + revision);
        }
    }
    report("write_1k_at_100000", &mut vault_writes, None);
    if let Ok(export) = std::env::var("GNEAUXGHTS_RELEASE_FIXTURE_EXPORT") {
        state.note_timeline().clean_close(notes.path()).unwrap();
        fn copy_tree(from: &Path, to: &Path) {
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
        copy_tree(notes.path(), &PathBuf::from(&export).join("vault"));
        copy_tree(app_data.path(), &PathBuf::from(&export).join("data"));
        crate::state::set_notes_root_override(None).unwrap();
        return;
    }
    let passed = measure_scale_reads_and_recovery(state, notes.path());
    crate::state::set_notes_root_override(None).unwrap();
    assert!(
        passed,
        "release latency budget exceeded; inspect RELEASE_METRIC output"
    );
}

// Only disposable clones from scripts/timeline_fixture.py enter destructive measurements.
#[test]
#[ignore = "requires a verified disposable 100,000-revision fixture clone"]
fn release_retained_scale_latency() {
    let _guard = crate::test_support::lock_test_env();
    let run = PathBuf::from(std::env::var("GNEAUXGHTS_RELEASE_SCALE_RUN").expect("use scripts/timeline_fixture.py run"))
        .canonicalize().unwrap();
    assert_eq!(run.parent(), Some(std::env::temp_dir().canonicalize().unwrap().as_path()));
    assert!(run.file_name().unwrap().to_str().unwrap().starts_with("gneauxghts-timeline-run-"));
    let marker: serde_json::Value = serde_json::from_slice(&fs::read(run.join("run.json")).unwrap()).unwrap();
    assert_eq!(marker["kind"], "gneauxghts-production-scale-v1");
    let notes = run.join("vault");
    let data = run.join("data");
    crate::state::initialize_app_data_dir(data).unwrap();
    crate::state::set_notes_root_override(Some(notes.clone())).unwrap();
    let started = Instant::now();
    let state = state();
    // Include first-access integrity/recovery work in a separate cold metric.
    let page = state
        .note_timeline()
        .open_history_mode(NoteIdentity::new("release-seed-0"))
        .page(None, 50)
        .unwrap();
    assert_eq!(page.records().len(), 50);
    report(
        "fixture_first_page_including_integrity",
        &mut [started.elapsed().as_secs_f64() * 1000.0],
        None,
    );
    let passed = measure_scale_reads_and_recovery(state, &notes);
    crate::state::set_notes_root_override(None).unwrap();
    assert!(
        passed,
        "release latency budget exceeded; inspect RELEASE_METRIC output"
    );
}

fn measure_scale_reads_and_recovery(state: AppState, notes: &Path) -> bool {
    let hot_id = NoteIdentity::new("release-seed-0");
    // Validate fixture geometry directly. Calling note health 1,000 times would
    // repeat the whole-store SQLite quick_check 1,000 times before timing reads.
    let connection =
        rusqlite::Connection::open(history_store::history_database_path_for_test(notes)).unwrap();
    let count: u64 = connection
        .query_row("SELECT COUNT(*) FROM revisions", [], |row| row.get(0))
        .unwrap();
    drop(connection);
    assert_eq!(count, 100_000);
    let hot = state.note_timeline().open_history_mode(hot_id.clone());
    let revisions = hot.revisions().unwrap();
    assert_eq!(revisions.len(), 10_000);
    let mut pages = Vec::new();
    let mut diffs = Vec::new();
    let mut reconstruction = Vec::new();
    let mut restore = Vec::new();
    let mut cursor = None;
    let mut seen_records = HashSet::new();
    let mut seen_revisions = HashSet::new();
    for index in 0..=200 {
        let page = measure(&mut pages, || hot.page(cursor.as_deref(), 50).unwrap());
        assert!(!page.records().is_empty(), "scale page cannot be empty");
        for record in page.records() {
            assert!(
                seen_records.insert(record.record_id().to_string()),
                "repeated history page"
            );
            if let Some(id) = record.revision_id() {
                seen_revisions.insert(id.to_string());
            }
        }
        cursor = page.next_cursor().map(str::to_string);
        if index < 200 && index % 10 == 0 {
            let selected = &revisions[index * 49];
            let rebuilt = measure(&mut reconstruction, || {
                hot.reconstruct(selected.identity()).unwrap()
            });
            assert_eq!(rebuilt.body(), body(64 * 1024, index * 49));
            measure(&mut diffs, || {
                hot.diff(selected.identity().as_str(), HistoryDiffComparison::Parent)
                    .unwrap()
            });
            let preview = measure(&mut restore, || {
                hot.restore_preview(selected.identity().as_str()).unwrap()
            });
            assert_eq!(preview.body(), rebuilt.body());
        }
        if cursor.is_none() {
            break;
        }
    }
    assert!(cursor.is_none(), "paging must exhaust the retained history");
    assert_eq!(
        seen_revisions,
        revisions
            .iter()
            .map(|revision| revision.identity().as_str().to_string())
            .collect()
    );
    let mut passed = report("page_50_across_10000", &mut pages, Some(250.0));
    passed &= report("diff_64k", &mut diffs, Some(250.0));
    passed &= report("reconstruct_deep_64k", &mut reconstruction, Some(1000.0));
    passed &= report("restore_preview_64k", &mut restore, Some(1000.0));

    let (large_path, large_passed) = measure_large_note(&state);
    passed &= large_passed;

    let mut replacements = Vec::new();
    for revision in 0..20 {
        // Deterministic random ASCII, with the same approximate line length as
        // the small-edit fixture. Generate outside the timed save operation.
        let mut seed = 23_u64 + revision;
        let replacement = (0..1024 * 1024)
            .map(|index| {
                seed = seed.wrapping_mul(6364136223846793005).wrapping_add(1);
                if index % 76 == 75 {
                    '\n'
                } else {
                    char::from(b'a' + ((seed >> 32) % 26) as u8)
                }
            })
            .collect::<String>();
        measure(&mut replacements, || {
            save(&state, "Large", replacement, Some(large_path.clone()))
        });
    }
    report("write_1mb_full_replacement", &mut replacements, None);

    let before_failure = fs::read(&large_path).unwrap();
    let mut preparation_failure = Vec::new();
    history_store::inject_fault_once(history_store::FaultPoint::Prepare);
    let error = measure(&mut preparation_failure, || {
        crate::commands::note_persistence::persist_note_session_with_outcome(
            &state,
            "Large".into(),
            "unsaved draft".into(),
            Some(large_path.clone()),
        )
        .unwrap_err()
    });
    assert!(error.contains("injected history preparation failure"));
    assert_eq!(fs::read(&large_path).unwrap(), before_failure);
    report(
        "preparation_failure_at_scale",
        &mut preparation_failure,
        None,
    );
    save(&state, "Large", "retried draft".into(), Some(large_path));

    let mut close = Vec::new();
    measure(&mut close, || {
        state.note_timeline().clean_close(notes).unwrap()
    });
    report("clean_close_at_scale", &mut close, None);
    drop(state);
    let restarted = self::state();
    let mut restart = Vec::new();
    let page = measure(&mut restart, || {
        restarted
            .note_timeline()
            .open_history_mode(hot_id.clone())
            .page(None, 50)
            .unwrap()
    });
    assert_eq!(page.records().len(), 50);
    report("restart_first_page_including_integrity", &mut restart, None);
    assert_eq!(
        restarted
            .note_timeline()
            .open_history_mode(hot_id.clone())
            .revisions()
            .unwrap()
            .len(),
        10_000
    );
    restarted
        .note_timeline()
        .clear_note_history(&hot_id)
        .unwrap();
    let mut compaction = Vec::new();
    let receipt = measure(&mut compaction, || {
        restarted
            .note_timeline()
            .compact_history_storage(256 * 1024)
            .unwrap()
    });
    assert!(receipt.reclaimed_bytes() <= 256 * 1024);
    assert_eq!(
        restarted
            .note_timeline()
            .open_history_mode(hot_id)
            .revisions()
            .unwrap()
            .len(),
        1
    );
    report("bounded_compaction_256k", &mut compaction, None);
    restarted.note_timeline().clean_close(notes).unwrap();
    passed
}

#[test]
#[ignore = "optimized paired write-stage diagnostic"]
fn release_write_stages() {
    let _guard = crate::test_support::lock_test_env();
    let data = TestDir::new("release-stages-data");
    let notes = TestDir::new("release-stages-vault");
    crate::state::initialize_app_data_dir(data.path().to_path_buf()).unwrap();
    crate::state::set_notes_root_override(Some(notes.path().to_path_buf())).unwrap();
    crate::state::ensure_vault_scaffold(notes.path()).unwrap();
    let state = state();
    for size in [64 * 1024, 1024 * 1024] {
        for geometry in ["repetitive", "random"] {
            for edit in ["small", "full"] {
                let content = |revision| {
                    if geometry == "repetitive" {
                        let mut text = body(size, revision);
                        if edit == "full" && revision % 2 == 1 {
                            text = text.replace('e', "z").replace('a', "x");
                        }
                        text
                    } else {
                        let mut seed = if edit == "full" { revision as u64 + 23 } else { 23 };
                        let mut text = (0..size).map(|index| {
                            seed = seed.wrapping_mul(6364136223846793005).wrapping_add(1);
                            if index % 76 == 75 { '\n' } else { char::from(b'a' + ((seed >> 32) % 26) as u8) }
                        }).collect::<String>();
                        text.replace_range(0..8, &format!("{revision:08}"));
                        text
                    }
                };
                let title = format!("Stages {size} {geometry} {edit}");
                let (path, _) = save(&state, &title, content(0), None);
                let mut stages = std::collections::BTreeMap::<String, Vec<f64>>::new();
                for revision in 1..=128 {
                    let markdown = content(revision);
                    history_store::begin_append_measurement();
                    let started = Instant::now();
                    save(&state, &title, markdown, Some(path.clone()));
                    let elapsed = started.elapsed().as_secs_f64() * 1000.0;
                    let measured = history_store::take_append_measurement();
                    let other = elapsed - measured.iter().map(|(_, value)| value).sum::<f64>();
                    for (name, value) in measured {
                        stages.entry(name.into()).or_default().push(value);
                    }
                    stages.entry("other_command_work".into()).or_default().push(other);
                    stages.entry("total".into()).or_default().push(elapsed);
                }
                for (stage, mut samples) in stages {
                    report(&format!("write_stage_{size}_{geometry}_{edit}_{stage}"), &mut samples, None);
                }
            }
        }
    }
    state.note_timeline().clean_close(notes.path()).unwrap();
    crate::state::set_notes_root_override(None).unwrap();
}
