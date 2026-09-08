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
pub(crate) fn lock_test_env() -> MutexGuard<'static, ()> {
    TEST_ENV_GUARD
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
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
