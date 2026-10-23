//! Private recovery drafts of editor work, never canonical notes or revisions.
use super::AppStateStorage;
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct DraftBackup {
    pub(crate) id: String,
    pub(crate) version: u64,
    pub(crate) title: String,
    pub(crate) markdown: String,
    pub(crate) tags: Vec<String>,
    pub(crate) tags_error: Option<String>,
    pub(crate) source_note_id: Option<String>,
    pub(crate) source_path: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) baseline: Option<DraftContent>,
    #[serde(default)]
    pub(crate) updated_at_millis: u64,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct DraftContent {
    pub(crate) title: String,
    pub(crate) markdown: String,
    pub(crate) tags: Vec<String>,
    pub(crate) tags_error: Option<String>,
}

pub(super) fn ensure_schema(connection: &Connection) -> Result<(), String> {
    connection
        .execute_batch(
            "CREATE TABLE IF NOT EXISTS app_state_draft_backups (
        id TEXT PRIMARY KEY, version INTEGER NOT NULL, payload TEXT,
        updated_at_millis INTEGER NOT NULL
    );",
        )
        .map_err(|error| error.to_string())
}

fn validate(id: &str, version: u64) -> Result<(), String> {
    if id.len() != 36
        || !id.bytes().enumerate().all(|(index, byte)| {
            if [8, 13, 18, 23].contains(&index) {
                byte == b'-'
            } else {
                byte.is_ascii_hexdigit()
            }
        })
    {
        return Err("Invalid draft recovery identifier".into());
    }
    if version == 0 || version > i64::MAX as u64 {
        return Err("Invalid draft recovery version".into());
    }
    Ok(())
}

impl AppStateStorage {
    pub(crate) fn save_draft_backup(&self, mut draft: DraftBackup) -> Result<(), String> {
        validate(&draft.id, draft.version)?;
        draft.updated_at_millis = crate::time::current_time_millis()?;
        let payload = serde_json::to_string(&draft).map_err(|error| error.to_string())?;
        self.with(|connection| {
            connection
                .execute(
                    "INSERT INTO app_state_draft_backups(id,version,payload,updated_at_millis)
                VALUES(?1,?2,?3,?4) ON CONFLICT(id) DO UPDATE SET version=excluded.version,
                payload=excluded.payload,updated_at_millis=excluded.updated_at_millis
                WHERE excluded.version > app_state_draft_backups.version",
                    params![draft.id, draft.version, payload, draft.updated_at_millis],
                )
                .map_err(|error| error.to_string())?;
            Ok(())
        })
    }

    pub(crate) fn list_draft_backups(&self) -> Result<Vec<DraftBackup>, String> {
        self.with(|connection| {
            let mut statement = connection
                .prepare(
                    "SELECT payload FROM app_state_draft_backups
                WHERE payload IS NOT NULL ORDER BY updated_at_millis DESC, id",
                )
                .map_err(|error| error.to_string())?;
            let rows = statement
                .query_map([], |row| row.get::<_, String>(0))
                .map_err(|error| error.to_string())?;
            rows.map(|row| {
                let payload = row.map_err(|error| error.to_string())?;
                serde_json::from_str(&payload)
                    .map_err(|error| format!("Draft recovery data could not be read: {error}"))
            })
            .collect()
        })
    }

    /// A versioned tombstone prevents a late old write from reviving discarded work.
    /// It contains no note content; later edits with a newer version remain eligible.
    pub(crate) fn remove_draft_backup(&self, id: &str, version: u64) -> Result<(), String> {
        validate(id, version)?;
        self.with(|connection| {
            connection
                .execute(
                    "INSERT INTO app_state_draft_backups(id,version,payload,updated_at_millis)
                VALUES(?1,?2,NULL,?3) ON CONFLICT(id) DO UPDATE SET version=excluded.version,
                payload=NULL,updated_at_millis=excluded.updated_at_millis
                WHERE excluded.version >= app_state_draft_backups.version",
                    params![id, version, crate::time::current_time_millis()?],
                )
                .map_err(|error| error.to_string())?;
            Ok(())
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::{lock_test_env, TestDir};

    fn draft(id: &str, version: u64, markdown: &str) -> DraftBackup {
        DraftBackup {
            id: id.into(),
            version,
            title: "".into(),
            markdown: markdown.into(),
            tags: vec!["idea".into()],
            tags_error: None,
            source_note_id: None,
            source_path: None,
            baseline: None,
            updated_at_millis: 0,
        }
    }

    #[test]
    fn saved_bases_round_trip_and_older_backups_remain_readable() {
        let mut backup = draft("0e40068a-e315-4145-876e-8923be451618", 1, "unfinished");
        let legacy = serde_json::to_value(&backup).unwrap();
        assert!(legacy.get("baseline").is_none());
        assert_eq!(
            serde_json::from_value::<DraftBackup>(legacy)
                .unwrap()
                .baseline,
            None
        );
        backup.baseline = Some(DraftContent {
            title: "Saved title".into(),
            markdown: "Saved body".into(),
            tags: vec!["saved".into()],
            tags_error: None,
        });
        assert_eq!(
            serde_json::from_str::<DraftBackup>(&serde_json::to_string(&backup).unwrap()).unwrap(),
            backup
        );
    }

    #[test]
    fn copies_survive_reopen_without_publishing_markdown_and_are_vault_bound() {
        let _guard = lock_test_env();
        let root = TestDir::new("draft-recovery");
        let other = TestDir::new("draft-recovery-other");
        let id = "0e40068a-e315-4145-876e-8923be451618";
        let original;
        {
            let storage = AppStateStorage::bind(root.path()).unwrap();
            storage
                .save_draft_backup(draft(&id, 1, "A fleeting idea"))
                .unwrap();
            original = storage.list_draft_backups().unwrap();
            assert_eq!(original[0].markdown, "A fleeting idea");
            assert!(original[0].updated_at_millis > 0);
        }
        let reopened = AppStateStorage::bind(root.path()).unwrap();
        assert_eq!(reopened.list_draft_backups().unwrap(), original);
        let unrelated = AppStateStorage::bind(other.path()).unwrap();
        assert!(unrelated.list_draft_backups().unwrap().is_empty());
        assert!(std::fs::read_dir(root.path()).unwrap().all(|entry| entry
            .unwrap()
            .path()
            .extension()
            .is_none_or(|extension| extension != "md")));
    }

    #[test]
    fn stale_saves_and_removals_cannot_lose_newer_work_or_revive_a_discard() {
        let _guard = lock_test_env();
        let root = TestDir::new("draft-recovery-order");
        let storage = AppStateStorage::bind(root.path()).unwrap();
        let id = "f2a0d4c7-9781-4848-9c21-2079c1b45b47";
        storage.save_draft_backup(draft(&id, 3, "newer")).unwrap();
        storage.save_draft_backup(draft(&id, 2, "old")).unwrap();
        storage.remove_draft_backup(&id, 2).unwrap();
        assert_eq!(storage.list_draft_backups().unwrap()[0].markdown, "newer");
        storage.remove_draft_backup(&id, 4).unwrap();
        storage.save_draft_backup(draft(&id, 3, "late")).unwrap();
        assert!(storage.list_draft_backups().unwrap().is_empty());
        storage
            .save_draft_backup(draft(&id, 5, "continued"))
            .unwrap();
        assert_eq!(
            storage.list_draft_backups().unwrap()[0].markdown,
            "continued"
        );
    }
}
