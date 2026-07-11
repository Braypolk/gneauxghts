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
