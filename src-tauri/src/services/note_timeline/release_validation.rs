//! Opt-in release measurements through the real persistence and History Mode seams.
//! Run alone in an optimized build.

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
    let session = outcome.unwrap();
    assert!(
        session.commit_warning.is_none(),
        "unexpected publication warning"
    );
    (
        session.path.unwrap(),
        NoteIdentity::new(session.note_id.unwrap()),
    )
}

// Scale geometry represents explicit retained boundaries under the current policy.
fn save_retained_state(
    state: &AppState,
    title: &str,
    body: String,
    path: Option<String>,
) -> (String, NoteIdentity) {
    let session = crate::test_support::save_and_finalize(state, title.into(), body, path)
        .unwrap()
        .unwrap();
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
    let (large_path, large_id) = save_retained_state(&state, "Large", body(1024 * 1024, 0), None);
    let mut small_edits = Vec::new();
    for revision in 1..=128 {
        measure(&mut small_edits, || {
            save_retained_state(
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

// Only disposable clones from scripts/timeline_fixture.py enter destructive measurements.
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
                };
                let title = format!("Stages {size} {geometry} {edit}");
                let (path, _) = save_retained_state(&state, &title, content(0), None);
                let mut stages = std::collections::BTreeMap::<String, Vec<f64>>::new();
                for revision in 1..=128 {
                    let markdown = content(revision);
                    history_store::begin_append_measurement();
                    let started = Instant::now();
                    save_retained_state(&state, &title, markdown, Some(path.clone()));
                    let elapsed = started.elapsed().as_secs_f64() * 1000.0;
                    let measured = history_store::take_append_measurement();
                    let other = elapsed - measured.iter().map(|(_, value)| value).sum::<f64>();
                    for (name, value) in measured {
                        stages.entry(name.into()).or_default().push(value);
                    }
                    stages
                        .entry("other_command_work".into())
                        .or_default()
                        .push(other);
                    stages.entry("total".into()).or_default().push(elapsed);
                }
                for (stage, mut samples) in stages {
                    report(
                        &format!("write_stage_{size}_{geometry}_{edit}_{stage}"),
                        &mut samples,
                        None,
                    );
                }
            }
        }
    }
    state.note_timeline().clean_close(notes.path()).unwrap();
    crate::state::set_notes_root_override(None).unwrap();
}

mod current_scale;
mod windows;

// Explicit interrupted-source exports are quarantined by the evaluation helper.
// Only production recovery/close may make that copied store portable; this test
// never changes the source or manufactures a clean-close watermark.
#[test]
#[ignore = "explicit isolated Pi evaluation recovery; never an ordinary vault"]
fn evaluation_recover_stopped_copy() {
    let _guard = crate::test_support::lock_test_env();
    let root = std::path::PathBuf::from(
        std::env::var_os("PI_EVALUATION_RECOVERY_ROOT")
            .expect("PI_EVALUATION_RECOVERY_ROOT must select a quarantined export"),
    );
    assert!(root.is_absolute());
    assert_eq!(root.canonicalize().unwrap(), root);
    let marker: serde_json::Value =
        serde_json::from_slice(&fs::read(root.join("pi-stopped-recovery.json")).unwrap()).unwrap();
    assert_eq!(marker["kind"], "gneauxghts-pi-stopped-recovery-v1");
    assert_eq!(marker["root"].as_str(), root.to_str());
    assert!(!root.join("pi-evaluation.json").exists());
    let notes = root.join("PROTOTYPE-wipe-me/vault");
    assert_eq!(notes.canonicalize().unwrap(), notes);
    assert!(root
        .join("note-timeline-history-observations.json")
        .is_file());
    let database = notes.join(".gneauxghts/history.sqlite3");
    let before = {
        let db = rusqlite::Connection::open_with_flags(
            &database,
            rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY,
        )
        .unwrap();
        db.query_row(
            "SELECT vault_id, history_generation, store_instance_id, clean_close_sequence FROM history_metadata WHERE singleton=1",
            [],
            |row| Ok((row.get::<_, String>(0)?, row.get::<_, u64>(1)?, row.get::<_, String>(2)?, row.get::<_, u64>(3)?)),
        ).unwrap()
    };
    crate::state::initialize_app_data_dir(root.clone()).unwrap();
    crate::state::set_notes_root_override(Some(notes.clone())).unwrap();
    let state = state();
    state
        .note_timeline()
        .initialize_existing_notes(&notes)
        .unwrap();
    state.note_timeline().clean_close(&notes).unwrap();
    assert!(state.note_timeline().is_cleanly_closed().unwrap());
    drop(state);
    crate::state::set_notes_root_override(None).unwrap();
    let db = rusqlite::Connection::open_with_flags(
        &database,
        rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY,
    )
    .unwrap();
    let after = db.query_row(
        "SELECT vault_id, history_generation, store_instance_id, clean_close_sequence, portability_state FROM history_metadata WHERE singleton=1",
        [],
        |row| Ok((row.get::<_, String>(0)?, row.get::<_, u64>(1)?, row.get::<_, String>(2)?, row.get::<_, u64>(3)?, row.get::<_, String>(4)?)),
    ).unwrap();
    assert_eq!(
        (&after.0, after.1, &after.2),
        (&before.0, before.1, &before.2)
    );
    assert!(after.3 > before.3);
    assert_eq!(after.4, "portable");
    println!("PI_EVALUATION_RECOVERY {{\"portable\":true,\"identityRetained\":true,\"cleanCloseAdvanced\":true}}");
}
