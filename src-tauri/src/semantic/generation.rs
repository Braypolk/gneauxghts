//! One compatible provider/database/ANN bundle is composed for a vault lifetime.
//! This owner withholds semantic reads until startup reconciliation and snapshot
//! publication finish. Durable staging rows resume by representation + source.
use super::db::{content_hash, load_stored_note_records};
use rusqlite::Connection;
use std::{
    fs,
    path::Path,
    sync::{
        atomic::{AtomicBool, Ordering},
        Mutex, RwLock, RwLockReadGuard, RwLockWriteGuard,
    },
};

pub(crate) struct SemanticGeneration {
    representation: String,
    readers: RwLock<()>,
    sources: Mutex<Option<crate::services::note_timeline::SemanticSourceAdmission>>,
    active: AtomicBool,
    scan_complete: AtomicBool,
    recall_complete: AtomicBool,
}
impl SemanticGeneration {
    pub(crate) fn staging(connection: &Connection, representation: String) -> Result<Self, String> {
        connection.execute_batch("CREATE TABLE IF NOT EXISTS semantic_generation (singleton INTEGER PRIMARY KEY CHECK(singleton=1), representation TEXT NOT NULL, state TEXT NOT NULL)").map_err(|e| e.to_string())?;
        let stored = connection.query_row(
            "SELECT representation FROM semantic_generation WHERE singleton=1",
            [],
            |r| r.get::<_, String>(0),
        );
        match stored {
            Ok(identity) if identity != representation => return Err(
                "Semantic generation representation mismatch; retained vectors cannot be reused."
                    .into(),
            ),
            Err(rusqlite::Error::QueryReturnedNoRows) => {
                connection
                    .execute(
                        "INSERT INTO semantic_generation VALUES (1,?1,'staging')",
                        [&representation],
                    )
                    .map_err(|e| e.to_string())?;
            }
            Err(e) => return Err(e.to_string()),
            _ => {}
        }
        // Even a prior completed generation must reconcile current source bytes
        // before this process admits reads. No second model is loaded.
        connection
            .execute(
                "UPDATE semantic_generation SET state='staging' WHERE singleton=1",
                [],
            )
            .map_err(|e| e.to_string())?;
        Ok(Self {
            representation,
            readers: RwLock::new(()),
            sources: Mutex::new(None),
            active: AtomicBool::new(false),
            scan_complete: AtomicBool::new(false),
            recall_complete: AtomicBool::new(false),
        })
    }
    #[cfg(test)]
    pub(crate) fn ready_for_test() -> Self {
        Self {
            representation: "test".into(),
            readers: RwLock::new(()),
            sources: Mutex::new(None),
            active: AtomicBool::new(true),
            scan_complete: AtomicBool::new(true),
            recall_complete: AtomicBool::new(true),
        }
    }
    pub(crate) fn is_active(&self) -> bool {
        self.active.load(Ordering::Acquire)
    }
    pub(crate) fn bind_sources(
        &self,
        sources: crate::services::note_timeline::SemanticSourceAdmission,
    ) {
        *self.sources.lock().unwrap() = Some(sources);
    }
    pub(crate) fn require_active(&self) -> Result<RwLockReadGuard<'_, ()>, String> {
        let lease = self
            .readers
            .read()
            .map_err(|_| "Semantic generation unavailable")?;
        if self.is_active() {
            Ok(lease)
        } else {
            Err(
                "Local search is rebuilding a compatible generation. Keyword search is available."
                    .into(),
            )
        }
    }
    pub(crate) fn scan_finished(&self) {
        self.scan_complete.store(true, Ordering::Release);
    }
    pub(crate) fn recall_finished(&self) {
        self.recall_complete.store(true, Ordering::Release);
    }
    pub(crate) fn exclusive_rebuild(&self) -> Result<RwLockWriteGuard<'_, ()>, String> {
        self.readers
            .write()
            .map_err(|_| "Semantic generation unavailable".into())
    }
    pub(crate) fn reconciliation_complete(&self) -> bool {
        self.scan_complete.load(Ordering::Acquire) && self.recall_complete.load(Ordering::Acquire)
    }
    pub(crate) fn rebuilding(&self) {
        self.active.store(false, Ordering::Release);
        self.scan_complete.store(false, Ordering::Release);
    }
    /// Source reads happen outside the producer queue. The prepared proof is
    /// checked by NoteTimeline at the short atomic publication point.
    pub(crate) fn prepare_activation(
        &self,
        connection: &Connection,
        root: &Path,
        snapshots_ready: bool,
    ) -> Result<ActivationPreparation, String> {
        if self.is_active() || !self.reconciliation_complete() || !snapshots_ready {
            return Ok(ActivationPreparation::Waiting);
        }
        let sources = self
            .sources
            .lock()
            .map_err(|_| "Source admission unavailable")?
            .clone();
        let version = if let Some(admission) = &sources {
            let Some(version) = admission.capture()? else {
                return Ok(ActivationPreparation::Waiting);
            };
            Some(version)
        } else {
            #[cfg(not(test))]
            return Ok(ActivationPreparation::Waiting);
            #[cfg(test)]
            None
        };
        let stored = load_stored_note_records(connection)?;
        let mut seen = std::collections::HashSet::new();
        for path in crate::path_utils::collect_markdown_files_recursively(root)? {
            let markdown = fs::read_to_string(&path).map_err(|e| e.to_string())?;
            let key = path.to_string_lossy().into_owned();
            if stored
                .get(&key)
                .is_none_or(|row| row.content_hash != content_hash(&markdown))
            {
                return Ok(ActivationPreparation::StaleSources);
            }
            seen.insert(key);
        }
        if stored.keys().any(|path| !seen.contains(path)) {
            return Ok(ActivationPreparation::StaleSources);
        }
        Ok(ActivationPreparation::Ready(PreparedActivation {
            sources,
            version,
        }))
    }
    /// Worker owns the drained producer queue only during this short commit.
    pub(crate) fn publish(
        &self,
        connection: &Connection,
        proof: PreparedActivation,
    ) -> Result<bool, String> {
        let _readers = self
            .readers
            .write()
            .map_err(|_| "Semantic generation unavailable")?;
        if !self.reconciliation_complete() {
            return Ok(false);
        }
        let publish = || {
            connection.execute("UPDATE semantic_generation SET state='active' WHERE singleton=1 AND representation=?1", [&self.representation]).map_err(|e| e.to_string())?;
            self.active.store(true, Ordering::Release);
            Ok(())
        };
        match (proof.sources, proof.version) {
            (Some(admission), Some(version)) => admission.publish_if_current(version, publish),
            _ => {
                publish()?;
                Ok(true)
            }
        }
    }
}
pub(crate) enum ActivationPreparation {
    Waiting,
    StaleSources,
    Ready(PreparedActivation),
}
pub(crate) struct PreparedActivation {
    sources: Option<crate::services::note_timeline::SemanticSourceAdmission>,
    version: Option<crate::services::note_timeline::SemanticSourceVersion>,
}

#[derive(Clone, Copy, Debug, serde::Serialize, serde::Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) enum NextProvider {
    Gemma,
    Jina,
}
pub(crate) fn next_provider(vault_data: &Path) -> Result<NextProvider, String> {
    let path = vault_data.join("semantic-provider.json");
    match fs::read(path) {
        Ok(bytes) => serde_json::from_slice(&bytes).map_err(|e| e.to_string()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(NextProvider::Gemma),
        Err(e) => Err(e.to_string()),
    }
}
pub(crate) fn stage_provider(vault_data: &Path, provider: NextProvider) -> Result<(), String> {
    if provider == NextProvider::Jina && !vault_data.join("semantic.sqlite3").is_file() {
        return Err("No previous Jina generation is available in this vault.".into());
    }
    super::ann_core::write_json_atomic(&vault_data.join("semantic-provider.json"), &provider)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn activate(
        generation: &SemanticGeneration,
        connection: &Connection,
        root: &Path,
        ready: bool,
    ) -> bool {
        match generation
            .prepare_activation(connection, root, ready)
            .unwrap()
        {
            ActivationPreparation::Ready(proof) => generation.publish(connection, proof).unwrap(),
            _ => false,
        }
    }
    #[test]
    fn rebuild_waits_for_admitted_readers_and_rejects_a_prepared_activation() {
        let temp = crate::test_support::TestDir::new("semantic-generation-readers");
        let connection = super::super::db::open_database(&temp.path().join("g.sqlite3")).unwrap();
        super::super::db::ensure_schema(&connection).unwrap();
        let generation =
            std::sync::Arc::new(SemanticGeneration::staging(&connection, "gemma".into()).unwrap());
        generation.scan_finished();
        generation.recall_finished();
        let ActivationPreparation::Ready(proof) = generation
            .prepare_activation(&connection, temp.path(), true)
            .unwrap()
        else {
            panic!("prepared");
        };
        generation.rebuilding();
        assert!(!generation.publish(&connection, proof).unwrap());
        generation.scan_finished();
        assert!(activate(&generation, &connection, temp.path(), true));
        let lease = generation.require_active().unwrap();
        let other = generation.clone();
        let (started_rx, started) = {
            let (tx, rx) = std::sync::mpsc::channel();
            (rx, tx)
        };
        let (done_tx, done_rx) = std::sync::mpsc::channel();
        let worker = std::thread::spawn(move || {
            started.send(()).unwrap();
            other.rebuilding();
            let _exclusive = other.exclusive_rebuild().unwrap();
            done_tx.send(()).unwrap();
        });
        started_rx.recv().unwrap();
        assert!(matches!(
            done_rx.try_recv(),
            Err(std::sync::mpsc::TryRecvError::Empty)
        ));
        drop(lease);
        done_rx.recv().unwrap();
        worker.join().unwrap();
        assert!(generation.require_active().is_err());
    }

    #[test]
    fn staged_generations_require_source_reconciliation_and_never_mix_same_dimension_models() {
        let temp = crate::test_support::TestDir::new("semantic-generation");
        let path = temp.path().join("g.sqlite3");
        let connection = super::super::db::open_database(&path).unwrap();
        super::super::db::ensure_schema(&connection).unwrap();
        let generation = SemanticGeneration::staging(&connection, "gemma-a".into()).unwrap();
        generation.scan_finished();
        assert!(!activate(&generation, &connection, temp.path(), true));
        generation.recall_finished();
        assert!(!activate(&generation, &connection, temp.path(), false));
        fs::write(
            temp.path().join("new.md"),
            "# New\n\nArrived during migration",
        )
        .unwrap();
        assert!(!activate(&generation, &connection, temp.path(), true));
        fs::remove_file(temp.path().join("new.md")).unwrap();
        assert!(activate(&generation, &connection, temp.path(), true));
        let resumed = SemanticGeneration::staging(&connection, "gemma-a".into()).unwrap();
        assert!(!resumed.is_active());
        assert!(SemanticGeneration::staging(&connection, "gemma-b".into()).is_err());
        assert_eq!(
            connection
                .query_row("SELECT representation FROM semantic_generation", [], |r| {
                    r.get::<_, String>(0)
                })
                .unwrap(),
            "gemma-a"
        );
        fs::write(
            temp.path().join("semantic.sqlite3"),
            b"retained legacy generation",
        )
        .unwrap();
        stage_provider(temp.path(), NextProvider::Jina).unwrap();
        assert!(matches!(
            next_provider(temp.path()).unwrap(),
            NextProvider::Jina
        ));
        assert_eq!(
            fs::read(temp.path().join("semantic.sqlite3")).unwrap(),
            b"retained legacy generation"
        );
    }
}
