use serde_json::Value;
use std::{
    fs,
    path::{Path, PathBuf},
    sync::{Mutex, MutexGuard},
    time::{SystemTime, UNIX_EPOCH},
};

static TEST_ENV_GUARD: Mutex<()> = Mutex::new(());

/// Serialize tests that mutate process-wide path configuration. Recovering a
/// poisoned lock keeps one assertion failure from cascading into unrelated
/// failures in every later test that needs the same shared environment.
pub(crate) fn lock_test_env() -> TestEnvGuard {
    let lock = TEST_ENV_GUARD
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    TestEnvGuard {
        _paths: crate::state::TestPathSnapshot::capture(),
        _lock: lock,
    }
}

/// Restores composition inputs before unlocking, including during unwinding.
/// Global fault hooks still require serialization; this is not parallel isolation.
pub(crate) struct TestEnvGuard {
    _paths: crate::state::TestPathSnapshot,
    _lock: MutexGuard<'static, ()>,
}

impl Drop for TestEnvGuard {
    fn drop(&mut self) {
        self._paths.restore();
        crate::app::lifecycle::clear_restart_hook_for_test();
        crate::state::clear_note_publication_failure_for_test();
        crate::services::note_timeline::clear_history_fault_for_test();
    }
}

pub(crate) struct TestVault {
    pub(crate) state: std::sync::Arc<crate::index::AppState>,
    pub(crate) notes: TestDir,
    pub(crate) data: TestDir,
    _guard: TestEnvGuard,
}

impl TestVault {
    pub(crate) fn new(label: &str) -> Self {
        Self::with_notes(label, |_| {})
    }

    pub(crate) fn with_notes(label: &str, initialize: impl FnOnce(&Path)) -> Self {
        let guard = lock_test_env();
        let data = TestDir::new(&format!("{label}-data"));
        let notes = TestDir::new(label);
        crate::state::initialize_app_data_dir(data.path().to_path_buf()).unwrap();
        crate::state::set_notes_root_override(Some(notes.path().to_path_buf())).unwrap();
        initialize(notes.path());
        let state = crate::index::AppState::new(
            crate::semantic::SemanticState::new_disabled("test vault"),
            crate::app::EventBus::disabled(),
        )
        .unwrap();
        Self {
            state: std::sync::Arc::new(state),
            notes,
            data,
            _guard: guard,
        }
    }
}

impl Drop for TestVault {
    fn drop(&mut self) {
        let _ = self.state.stop_rebuildable_projection_work();
    }
}

/// Release a worker gate before a scoped thread is joined, including after an assertion panics.
pub(crate) struct ReleaseOnDrop(Option<std::sync::mpsc::Sender<()>>);
impl ReleaseOnDrop {
    pub(crate) fn new(sender: std::sync::mpsc::Sender<()>) -> Self {
        Self(Some(sender))
    }
    pub(crate) fn release(&mut self) {
        if let Some(sender) = self.0.take() {
            let _ = sender.send(());
        }
    }
}
impl Drop for ReleaseOnDrop {
    fn drop(&mut self) {
        self.release();
    }
}

// Each fixture step deliberately ends an Editing Window. Autosave/window
// coalescing tests use the production command directly in editing_window_capture.
pub(crate) fn save_and_finalize(
    state: &crate::index::AppState,
    title: String,
    markdown: String,
    path: Option<String>,
) -> Result<Option<crate::commands::NoteSession>, crate::services::note_timeline::HistoryError> {
    let outcome = crate::commands::note_persistence::persist_note_session_with_outcome(
        state, title, markdown, path,
    )?;
    if let Some(session) = outcome.as_ref().filter(|s| s.commit_warning.is_none()) {
        if let Some(id) = &session.note_id {
            state
                .note_timeline()
                .finalize_editing_window(&crate::services::note_timeline::NoteIdentity::new(id))?;
        }
    }
    Ok(outcome)
}

pub(crate) struct TestDir {
    path: PathBuf,
}

impl TestDir {
    pub(crate) fn new(label: &str) -> Self {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time")
            .as_nanos();
        let path = std::env::temp_dir().join(format!("gneauxghts-{label}-{unique}"));
        fs::create_dir_all(&path).expect("create temp dir");
        let path = fs::canonicalize(path).expect("canonicalize temp dir");
        Self { path }
    }

    pub(crate) fn path(&self) -> &Path {
        &self.path
    }
}

impl Drop for TestDir {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.path);
    }
}

pub(crate) fn fixture_path(relative_path: &str) -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("test-fixtures")
        .join(relative_path)
}

pub(crate) fn load_fixture(relative_path: &str) -> String {
    fs::read_to_string(fixture_path(relative_path)).expect("read fixture")
}

pub(crate) fn load_json_fixture(relative_path: &str) -> Value {
    serde_json::from_str(&load_fixture(relative_path)).expect("parse json fixture")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{app::PrepareRestartReceipt, semantic::SemanticSettings};

    #[test]
    fn environment_guard_restores_paths_and_faults_after_unwind() {
        let before = {
            let _guard = lock_test_env();
            crate::state::TestPathSnapshot::capture()
        };
        let result = std::panic::catch_unwind(|| {
            let _guard = lock_test_env();
            let paths = TestDir::new("unwind-test-environment");
            crate::state::initialize_app_data_dir(paths.path().to_path_buf()).unwrap();
            crate::state::initialize_documents_dir(paths.path().to_path_buf()).unwrap();
            crate::state::set_notes_root_override(Some(paths.path().to_path_buf())).unwrap();
            crate::state::inject_note_publication_failure_once();
            let mut abandoned_hook = crate::services::note_timeline::AFTER_FORGET_METADATA_STAGED
                .lock()
                .unwrap();
            *abandoned_hook = Some(Box::new(|| {}));
            panic!("exercise fixture unwinding");
        });
        assert!(result.is_err());
        let _guard = lock_test_env();
        let after = crate::state::TestPathSnapshot::capture();
        assert_eq!(before, after);
        assert!(crate::services::note_timeline::AFTER_FORGET_METADATA_STAGED
            .lock()
            .unwrap()
            .is_none());
        let notes = TestDir::new("after-unwind-publication");
        crate::state::atomic_create_note(&notes.path().join("After.md"), b"after unwind").unwrap();
    }

    #[test]
    fn releasing_gate_on_controller_unwind_does_not_strand_scoped_worker() {
        let (release_tx, release_rx) = std::sync::mpsc::channel();
        let (done_tx, done_rx) = std::sync::mpsc::channel();
        let result = std::panic::catch_unwind(|| {
            std::thread::scope(|scope| {
                let _release = ReleaseOnDrop::new(release_tx);
                scope.spawn(move || {
                    release_rx
                        .recv_timeout(std::time::Duration::from_secs(2))
                        .unwrap();
                    done_tx.send(()).unwrap();
                });
                panic!("controller assertion failed before release");
            })
        });
        assert!(result.is_err());
        done_rx
            .recv_timeout(std::time::Duration::from_secs(2))
            .unwrap();
    }

    #[test]
    fn representative_command_payloads_use_production_serde_contracts() {
        let fixture = load_json_fixture("contracts/command-payloads.json");
        let commands = fixture["commands"]
            .as_object()
            .expect("commands fixture object");

        let settings: SemanticSettings =
            serde_json::from_value(commands["set_semantic_settings"]["args"]["settings"].clone())
                .expect("semantic settings arguments deserialize");
        assert_eq!(
            serde_json::to_value(settings).expect("semantic settings serialize"),
            commands["set_semantic_settings"]["result"],
        );
        let restart = PrepareRestartReceipt::ready();
        assert_eq!(
            serde_json::to_value(restart).expect("restart receipt serializes"),
            commands["prepare_restart"]["result"],
        );

        for command in [
            "save_note",
            "save_task_note",
            "clear_last_opened_note",
            "prepare_restart",
            "chat_send_message",
            "commit_agent_proposal",
            "set_semantic_settings",
            "get_semantic_status",
            "retry_semantic_index",
        ] {
            assert!(commands.contains_key(command), "missing {command} fixture");
        }
    }
}
