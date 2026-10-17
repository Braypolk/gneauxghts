//! The sole native access-policy owner. Pi stores only opaque references.
use rusqlite::{params, Connection, OptionalExtension, Transaction};
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    sync::{Arc, Mutex, OnceLock, Weak},
};

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DomainError {
    pub code: String,
    pub message: String,
}
impl DomainError {
    pub(crate) fn new(code: &str, message: &str) -> Self {
        Self {
            code: code.into(),
            message: message.into(),
        }
    }
}
impl std::fmt::Display for DomainError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(&self.message)
    }
}
impl std::error::Error for DomainError {}
impl From<rusqlite::Error> for DomainError {
    fn from(_: rusqlite::Error) -> Self {
        Self::new("storage", "Chat access storage is unavailable.")
    }
}
pub(crate) type DomainResult<T> = Result<T, DomainError>;
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) enum ReadMode {
    FullVault,
    AttachedNotesOnly,
}
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct ReadPolicy {
    pub mode: ReadMode,
    pub attached_note_ids: Vec<String>,
}
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct ConversationBinding {
    pub conversation_id: u64,
    pub provider_session_id: String,
}
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) enum WriteOperation {
    Create,
    Update,
}
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct NoteScope {
    pub note_ids: Vec<String>,
    pub folders: Vec<String>,
}
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", tag = "duration", deny_unknown_fields)]
pub(crate) enum WriteGrant {
    Off,
    Temporary {
        #[serde(rename = "conversationId")]
        conversation_id: u64,
        operations: Vec<WriteOperation>,
        scope: NoteScope,
    },
    Always {
        operations: Vec<WriteOperation>,
        scope: NoteScope,
    },
}
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct WritePolicy {
    pub grant: WriteGrant,
    pub review_before_applying: bool,
}
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AuthoritySnapshot {
    pub authority_id: String,
    pub revision: u64,
    pub read: ReadPolicy,
    pub write: WritePolicy,
    pub retired: bool,
}
#[derive(Clone, Debug)]
pub(crate) struct AuthorityLease {
    pub snapshot: AuthoritySnapshot,
    pub binding: ConversationBinding,
}
#[derive(Clone)]
pub(crate) struct AuthorityStore {
    path: PathBuf,
    effect_gate: Arc<Mutex<()>>,
}

pub(crate) fn opaque_id() -> DomainResult<String> {
    let mut bytes = [0u8; 24];
    getrandom::fill(&mut bytes)
        .map_err(|_| DomainError::new("unavailable", "Unable to create chat authority."))?;
    Ok(bytes.iter().map(|b| format!("{b:02x}")).collect())
}
fn normalize_read(mut read: ReadPolicy) -> DomainResult<ReadPolicy> {
    if read.attached_note_ids.iter().any(|id| {
        id.is_empty()
            || id.len() > 512
            || id.chars().any(char::is_control)
            || id.contains('/')
            || id.contains('\\')
            || id == "."
            || id == ".."
    }) {
        return Err(DomainError::new(
            "invalid_policy",
            "Invalid attached note identity.",
        ));
    }
    read.attached_note_ids.sort();
    read.attached_note_ids.dedup();
    Ok(read)
}
pub(super) fn load(connection: &Connection, id: &str) -> DomainResult<AuthoritySnapshot> {
    let row: Option<(u64, String, bool, String, String, bool)> = connection
        .query_row(
            "SELECT a.revision,a.read_json,a.retired,a.write_json,v.grant_json,v.review_before_applying FROM pi_chat_authorities a CROSS JOIN pi_chat_vault_write v WHERE a.authority_id=?1 AND v.singleton=1",
            [id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?)),
        )
        .optional()?;
    let (revision, read, retired, write, vault_grant, review_before_applying) =
        row.ok_or_else(|| {
            DomainError::new(
                "missing_authority",
                "This conversation has no access authority.",
            )
        })?;
    let mut grant: WriteGrant = serde_json::from_str(&write)
        .map_err(|_| DomainError::new("storage", "Conversation write grant is invalid."))?;
    if matches!(grant, WriteGrant::Off) {
        grant = serde_json::from_str(&vault_grant)
            .map_err(|_| DomainError::new("storage", "Vault write policy is invalid."))?;
    }
    let write = WritePolicy {
        grant,
        review_before_applying,
    };
    Ok(AuthoritySnapshot {
        authority_id: id.into(),
        revision,
        read: serde_json::from_str(&read)
            .map_err(|_| DomainError::new("storage", "Chat access policy is invalid."))?,
        write,
        retired,
    })
}
fn require_current(snapshot: &AuthoritySnapshot, expected: Option<u64>) -> DomainResult<()> {
    if snapshot.retired {
        return Err(DomainError::new(
            "retired_authority",
            "This conversation's access was retired. Start a new conversation.",
        ));
    }
    if expected.is_some_and(|revision| revision != snapshot.revision) {
        return Err(DomainError::new(
            "stale_authority",
            "Chat access changed. Refresh before trying again.",
        ));
    }
    Ok(())
}
fn validate_write_scope(operations: &[WriteOperation], scope: &NoteScope) -> DomainResult<()> {
    if operations.is_empty()
        || (scope.note_ids.is_empty() && scope.folders.is_empty())
        || scope.note_ids.iter().any(|id| {
            id.is_empty()
                || id.len() > 512
                || id.contains('/')
                || id.contains('\\')
                || id.chars().any(char::is_control)
        })
    {
        return Err(DomainError::new(
            "invalid_policy",
            "Choose explicit write operations and note or folder scope.",
        ));
    }
    for folder in &scope.folders {
        let path = Path::new(folder);
        if path.is_absolute()
            || path.components().any(|c| {
                !matches!(
                    c,
                    std::path::Component::Normal(_) | std::path::Component::CurDir
                )
            })
            || folder.contains('\\')
        {
            return Err(DomainError::new(
                "invalid_policy",
                "Write folders must be relative to this vault.",
            ));
        }
    }
    Ok(())
}
impl AuthorityStore {
    pub(crate) fn new(data_dir: &Path) -> DomainResult<Self> {
        // All handles for this vault share policy/effect serialization, including reopen tests.
        static GATES: OnceLock<Mutex<HashMap<PathBuf, Weak<Mutex<()>>>>> = OnceLock::new();
        let path = std::fs::canonicalize(data_dir)
            .map_err(|_| DomainError::new("storage", "Vault data is unavailable."))?
            .join("ai.sqlite3");
        let effect_gate = {
            let mut gates = GATES
                .get_or_init(Default::default)
                .lock()
                .map_err(|_| DomainError::new("unavailable", "Authority owner is unavailable."))?;
            let gate = gates
                .get(&path)
                .and_then(Weak::upgrade)
                .unwrap_or_else(|| Arc::new(Mutex::new(())));
            gates.insert(path.clone(), Arc::downgrade(&gate));
            gate
        };
        let store = Self { path, effect_gate };
        store.connection()?.execute_batch(
            "PRAGMA journal_mode=WAL;
            CREATE TABLE IF NOT EXISTS pi_chat_authorities (
              authority_id TEXT PRIMARY KEY, conversation_id INTEGER NOT NULL UNIQUE,
              provider_session_id TEXT NOT NULL UNIQUE, revision INTEGER NOT NULL,
              read_json TEXT NOT NULL, retired INTEGER NOT NULL DEFAULT 0);",
        )?;
        // Compatible migration of the read-only foundation; default remains Off/review-on.
        let connection = store.connection()?;
        let exists: bool = connection
            .prepare("PRAGMA table_info(pi_chat_authorities)")?
            .query_map([], |row| row.get::<_, String>(1))?
            .collect::<Result<Vec<_>, _>>()?
            .iter()
            .any(|name| name == "write_json");
        if !exists {
            connection.execute_batch("ALTER TABLE pi_chat_authorities ADD COLUMN write_json TEXT NOT NULL DEFAULT '{\"duration\":\"off\"}';")?;
        }
        connection.execute_batch("CREATE TABLE IF NOT EXISTS pi_chat_vault_write(singleton INTEGER PRIMARY KEY CHECK(singleton=1),grant_json TEXT NOT NULL,review_before_applying INTEGER NOT NULL DEFAULT 1);
            INSERT OR IGNORE INTO pi_chat_vault_write(singleton,grant_json) VALUES(1,'{\"duration\":\"off\"}');")?;
        let has_review = connection
            .prepare("PRAGMA table_info(pi_chat_vault_write)")?
            .query_map([], |r| r.get::<_, String>(1))?
            .collect::<Result<Vec<_>, _>>()?
            .iter()
            .any(|name| name == "review_before_applying");
        if !has_review {
            connection.execute_batch("ALTER TABLE pi_chat_vault_write ADD COLUMN review_before_applying INTEGER NOT NULL DEFAULT 1;")?;
        }
        // Earlier read-only foundations had no grant. Normalize the development
        // policy wrapper to the sole conversation grant; review is always vault-owned.
        let rows = connection
            .prepare("SELECT authority_id,write_json FROM pi_chat_authorities")?
            .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))?
            .collect::<Result<Vec<_>, _>>()?;
        for (id, json) in rows {
            if let Ok(policy) = serde_json::from_str::<WritePolicy>(&json) {
                connection.execute(
                    "UPDATE pi_chat_authorities SET write_json=?2 WHERE authority_id=?1",
                    params![
                        id,
                        serde_json::to_string(&policy.grant).map_err(|_| DomainError::new(
                            "storage",
                            "Invalid conversation grant."
                        ))?
                    ],
                )?;
            }
        }
        Ok(store)
    }
    /// Policy changes and actual effects share this owner. No SQLite transaction spans filesystem IO.
    pub(crate) fn with_effect<T>(
        &self,
        operation: impl FnOnce() -> DomainResult<T>,
    ) -> DomainResult<T> {
        let _guard = self
            .effect_gate
            .lock()
            .map_err(|_| DomainError::new("unavailable", "Authority owner is unavailable."))?;
        operation()
    }
    pub(crate) fn require_running_vault(
        &self,
        vault: &crate::state::RunningVault,
    ) -> DomainResult<()> {
        let current = std::fs::canonicalize(vault.data_dir())
            .map_err(|_| DomainError::new("vault_mismatch", "Running Vault is unavailable."))?
            .join("ai.sqlite3");
        if current != self.path {
            return Err(DomainError::new(
                "vault_mismatch",
                "This authority belongs to another Running Vault.",
            ));
        }
        Ok(())
    }
    pub(super) fn connection(&self) -> DomainResult<Connection> {
        let connection = Connection::open(&self.path)?;
        connection.busy_timeout(std::time::Duration::from_secs(5))?;
        connection.execute_batch("PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON;")?;
        Ok(connection)
    }
    pub(crate) fn snapshot_for_binding(
        &self,
        binding: &ConversationBinding,
    ) -> DomainResult<Option<AuthoritySnapshot>> {
        let connection = self.connection()?;
        let existing:Option<(String,String)>=connection.query_row("SELECT authority_id,provider_session_id FROM pi_chat_authorities WHERE conversation_id=?1",[binding.conversation_id],|r|Ok((r.get(0)?,r.get(1)?))).optional()?;
        match existing {
            None => Ok(None),
            Some((id, provider)) if provider == binding.provider_session_id => {
                Ok(Some(load(&connection, &id)?))
            }
            Some(_) => Err(DomainError::new(
                "foreign_authority",
                "Conversation provider identity changed.",
            )),
        }
    }
    pub(crate) fn snapshot(&self, id: &str) -> DomainResult<AuthoritySnapshot> {
        load(&self.connection()?, id)
    }
    /// Run receipt/intent admission with current policy under the same native transaction.
    pub(crate) fn with_authority<T>(
        &self,
        id: &str,
        expected: Option<u64>,
        operation: impl FnOnce(&Transaction<'_>, &AuthoritySnapshot) -> DomainResult<T>,
    ) -> DomainResult<T> {
        self.with_effect(|| self.with_authority_locked(id, expected, operation))
    }
    pub(super) fn with_authority_locked<T>(
        &self,
        id: &str,
        expected: Option<u64>,
        operation: impl FnOnce(&Transaction<'_>, &AuthoritySnapshot) -> DomainResult<T>,
    ) -> DomainResult<T> {
        let mut connection = self.connection()?;
        let transaction =
            connection.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
        let snapshot = load(&transaction, id)?;
        require_current(&snapshot, expected)?;
        let result = operation(&transaction, &snapshot)?;
        transaction.commit()?;
        Ok(result)
    }
    pub(crate) fn lease(&self, id: &str) -> DomainResult<AuthorityLease> {
        let connection = self.connection()?;
        let snapshot = load(&connection, id)?;
        require_current(&snapshot, None)?;
        let binding = connection.query_row("SELECT conversation_id,provider_session_id FROM pi_chat_authorities WHERE authority_id=?1", [id],
            |row| Ok(ConversationBinding { conversation_id: row.get(0)?, provider_session_id: row.get(1)? }))?;
        Ok(AuthorityLease { snapshot, binding })
    }
    pub(crate) fn validate_lease(&self, lease: &AuthorityLease) -> DomainResult<()> {
        let snapshot = self.snapshot(&lease.snapshot.authority_id)?;
        require_current(&snapshot, Some(lease.snapshot.revision))
    }
    pub(crate) fn validate_binding(
        &self,
        id: &str,
        binding: &ConversationBinding,
    ) -> DomainResult<AuthorityLease> {
        let lease = self.lease(id)?;
        if lease.binding.conversation_id != binding.conversation_id
            || lease.binding.provider_session_id != binding.provider_session_id
        {
            return Err(DomainError::new(
                "foreign_authority",
                "Conversation authority does not match its provider identity.",
            ));
        }
        Ok(lease)
    }
    pub(crate) fn is_excluded(&self, note_id: &str) -> DomainResult<bool> {
        Self::excluded_in(&self.connection()?, note_id)
    }
    pub(crate) fn excluded_in(connection: &Connection, note_id: &str) -> DomainResult<bool> {
        Ok(connection.query_row("SELECT EXISTS(SELECT 1 FROM chat_note_policies WHERE note_id=?1 AND disposition='excluded')", [note_id], |row| row.get(0))?)
    }
    fn validate_attachments_in(connection: &Connection, read: &ReadPolicy) -> DomainResult<()> {
        for id in &read.attached_note_ids {
            if Self::excluded_in(connection, id)? {
                return Err(DomainError::new(
                    "excluded_note",
                    "An attached note is excluded. Remove it before continuing.",
                ));
            }
        }
        Ok(())
    }
    pub(crate) fn set_write(
        &self,
        id: &str,
        expected: u64,
        write: WritePolicy,
    ) -> DomainResult<AuthoritySnapshot> {
        self.with_effect(|| self.with_authority_locked(id,Some(expected),|tx,_| {
            let conversation:u64 = tx.query_row("SELECT conversation_id FROM pi_chat_authorities WHERE authority_id=?1",[id],|r|r.get(0))?;
            match &write.grant {
                WriteGrant::Off=>{},
                WriteGrant::Temporary{conversation_id,operations,scope}=>{
                    if *conversation_id != conversation { return Err(DomainError::new("foreign_grant","Temporary write authority belongs to another conversation.")); }
                    validate_write_scope(operations,scope)?;
                },
                WriteGrant::Always{operations,scope}=>validate_write_scope(operations,scope)?,
            }
            let (old_vault,old_review):(String,bool)=tx.query_row("SELECT grant_json,review_before_applying FROM pi_chat_vault_write WHERE singleton=1",[],|r|Ok((r.get(0)?,r.get(1)?)))?;
            let vault = match &write.grant { WriteGrant::Always{..}=>serde_json::to_string(&write.grant), WriteGrant::Off=>serde_json::to_string(&WriteGrant::Off), _=>Ok(old_vault.clone()) }
                .map_err(|_|DomainError::new("invalid_policy","Invalid write policy."))?;
            if vault != old_vault || old_review != write.review_before_applying {
                tx.execute("UPDATE pi_chat_vault_write SET grant_json=?1,review_before_applying=?2 WHERE singleton=1",params![vault,write.review_before_applying])?;
                // One vault grant, no copied rows. All pending intents revalidate revisions.
                tx.execute("UPDATE pi_chat_authorities SET revision=revision+1 WHERE authority_id<>?1",[id])?;
            }
            let retained=if matches!(write.grant,WriteGrant::Always{..}) { WriteGrant::Off } else {write.grant.clone()};
            let json=serde_json::to_string(&retained).map_err(|_|DomainError::new("invalid_policy","Invalid write policy."))?;
            tx.execute("UPDATE pi_chat_authorities SET revision=revision+1,write_json=?2 WHERE authority_id=?1",params![id,json])?;
            load(tx,id)
        }))
    }
    pub(crate) fn bind(
        &self,
        binding: ConversationBinding,
        read: ReadPolicy,
    ) -> DomainResult<AuthoritySnapshot> {
        self.with_effect(|| self.bind_locked(binding, read))
    }
    fn bind_locked(
        &self,
        binding: ConversationBinding,
        read: ReadPolicy,
    ) -> DomainResult<AuthoritySnapshot> {
        if binding.conversation_id == 0
            || binding.conversation_id > 9_007_199_254_740_991
            || binding.provider_session_id.is_empty()
            || binding.provider_session_id.len() > 256
        {
            return Err(DomainError::new(
                "invalid_binding",
                "Invalid Pi conversation identity.",
            ));
        }
        let read = normalize_read(read)?;
        let mut connection = self.connection()?;
        let transaction =
            connection.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
        let existing: Option<(String, String)> = transaction.query_row("SELECT authority_id,provider_session_id FROM pi_chat_authorities WHERE conversation_id=?1", [binding.conversation_id], |row| Ok((row.get(0)?, row.get(1)?))).optional()?;
        if let Some((id, session)) = existing {
            if session != binding.provider_session_id {
                return Err(DomainError::new(
                    "foreign_authority",
                    "Conversation provider identity changed.",
                ));
            }
            return load(&transaction, &id); // Never resurrect a retired binding or inherit a new grant.
        }
        Self::validate_attachments_in(&transaction, &read)?;
        let id = opaque_id()?;
        let json = serde_json::to_string(&read)
            .map_err(|_| DomainError::new("invalid_policy", "Invalid read policy."))?;
        transaction.execute("INSERT INTO pi_chat_authorities(authority_id,conversation_id,provider_session_id,revision,read_json,write_json) VALUES(?1,?2,?3,1,?4,'{\"duration\":\"off\"}')", params![id,binding.conversation_id,binding.provider_session_id,json])?;
        let snapshot = load(&transaction, &id)?;
        transaction.commit()?;
        Ok(snapshot)
    }
    pub(crate) fn set_read(
        &self,
        id: &str,
        expected: u64,
        read: ReadPolicy,
    ) -> DomainResult<AuthoritySnapshot> {
        self.with_effect(|| self.set_read_locked(id, expected, read))
    }
    fn set_read_locked(
        &self,
        id: &str,
        expected: u64,
        read: ReadPolicy,
    ) -> DomainResult<AuthoritySnapshot> {
        let read = normalize_read(read)?;
        self.with_authority_locked(id, Some(expected), |transaction, old| {
            Self::validate_attachments_in(transaction, &read)?;
            let restricted = old.read.mode == ReadMode::FullVault && read.mode == ReadMode::AttachedNotesOnly
                || old.read.mode == ReadMode::AttachedNotesOnly && read.mode == ReadMode::AttachedNotesOnly
                    && old.read.attached_note_ids.iter().any(|note| !read.attached_note_ids.contains(note));
            let json = serde_json::to_string(&read).map_err(|_| DomainError::new("invalid_policy", "Invalid read policy."))?;
            transaction.execute("UPDATE pi_chat_authorities SET revision=revision+1,read_json=?2,retired=?3 WHERE authority_id=?1", params![id,json,restricted])?;
            load(transaction, id)
        })
    }
    pub(crate) fn retire(&self, id: &str, expected: u64) -> DomainResult<()> {
        self.with_effect(|| self.retire_locked(id, expected))
    }
    fn retire_locked(&self, id: &str, expected: u64) -> DomainResult<()> {
        let mut connection = self.connection()?;
        let transaction = connection.transaction()?;
        let snapshot = load(&transaction, id)?;
        if snapshot.revision != expected {
            return Err(DomainError::new(
                "stale_authority",
                "Chat access changed. Refresh before trying again.",
            ));
        }
        if !snapshot.retired {
            transaction.execute("UPDATE pi_chat_authorities SET retired=1,revision=revision+1 WHERE authority_id=?1", [id])?;
        }
        transaction.commit()?;
        Ok(())
    }
    pub(crate) fn set_exclusion(&self, note_id: &str, excluded: bool) -> DomainResult<Vec<String>> {
        self.with_effect(|| self.set_exclusion_locked(note_id, excluded))
    }
    fn set_exclusion_locked(&self, note_id: &str, excluded: bool) -> DomainResult<Vec<String>> {
        if note_id.is_empty() || note_id.len() > 512 {
            return Err(DomainError::new("invalid_note", "Invalid note identity."));
        }
        let mut connection = self.connection()?;
        let transaction =
            connection.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
        let was_excluded = Self::excluded_in(&transaction, note_id)?;
        if excluded {
            transaction.execute("INSERT INTO chat_note_policies(note_id,disposition,title,updated_at_millis) VALUES(?1,'excluded','',?2) ON CONFLICT(note_id) DO UPDATE SET disposition='excluded',updated_at_millis=excluded.updated_at_millis", params![note_id,crate::time::current_time_millis().unwrap_or(0)])?;
        } else {
            transaction.execute(
                "DELETE FROM chat_note_policies WHERE note_id=?1 AND disposition='excluded'",
                [note_id],
            )?;
        }
        let mut retired = Vec::new();
        if excluded && !was_excluded {
            let mut query = transaction
                .prepare("SELECT authority_id FROM pi_chat_authorities WHERE retired=0")?;
            let ids = query
                .query_map([], |row| row.get::<_, String>(0))?
                .collect::<Result<Vec<_>, _>>()?;
            drop(query);
            for id in ids {
                let snapshot = load(&transaction, &id)?;
                if snapshot.read.mode == ReadMode::FullVault
                    || snapshot
                        .read
                        .attached_note_ids
                        .iter()
                        .any(|note| note == note_id)
                {
                    transaction.execute("UPDATE pi_chat_authorities SET retired=1,revision=revision+1 WHERE authority_id=?1", [&id])?;
                    retired.push(id);
                }
            }
        }
        transaction.commit()?;
        Ok(retired)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn store() -> (crate::test_support::TestDir, AuthorityStore) {
        let dir = crate::test_support::TestDir::new(&format!(
            "pi-chat-authority-{}",
            opaque_id().unwrap()
        ));
        Connection::open(dir.path().join("ai.sqlite3")).unwrap().execute_batch("CREATE TABLE IF NOT EXISTS chat_note_policies(note_id TEXT PRIMARY KEY,disposition TEXT NOT NULL,title TEXT NOT NULL,updated_at_millis INTEGER NOT NULL)").unwrap();
        let store = AuthorityStore::new(dir.path()).unwrap();
        (dir, store)
    }
    fn binding(id: u64) -> ConversationBinding {
        ConversationBinding {
            conversation_id: id,
            provider_session_id: format!("session-{id}"),
        }
    }
    fn policy(mode: ReadMode, ids: &[&str]) -> ReadPolicy {
        ReadPolicy {
            mode,
            attached_note_ids: ids.iter().map(|id| id.to_string()).collect(),
        }
    }
    #[test]
    fn restart_reacquires_binding_without_resurrecting_retired_authority() {
        let (dir, store) = store();
        let original = store
            .bind(binding(1), policy(ReadMode::FullVault, &[]))
            .unwrap();
        store
            .retire(&original.authority_id, original.revision)
            .unwrap();
        let reopened = AuthorityStore::new(dir.path()).unwrap();
        let same = reopened
            .bind(binding(1), policy(ReadMode::FullVault, &["new"]))
            .unwrap();
        assert_eq!(same.authority_id, original.authority_id);
        assert!(same.retired);
        assert_eq!(
            reopened
                .validate_binding(&same.authority_id, &binding(1))
                .unwrap_err()
                .code,
            "retired_authority"
        );
    }
    #[test]
    fn widening_revises_lease_but_restriction_retires_entire_context() {
        let (_dir, store) = store();
        let initial = store
            .bind(binding(1), policy(ReadMode::AttachedNotesOnly, &["one"]))
            .unwrap();
        let lease = store.lease(&initial.authority_id).unwrap();
        let widened = store
            .set_read(&initial.authority_id, 1, policy(ReadMode::FullVault, &[]))
            .unwrap();
        assert!(!widened.retired);
        assert_eq!(
            store.validate_lease(&lease).unwrap_err().code,
            "stale_authority"
        );
        let restricted = store
            .set_read(
                &initial.authority_id,
                2,
                policy(ReadMode::AttachedNotesOnly, &["one"]),
            )
            .unwrap();
        assert!(restricted.retired);
        assert_eq!(
            store.lease(&initial.authority_id).unwrap_err().code,
            "retired_authority"
        );
    }
    #[test]
    fn exclusions_and_affected_authority_retirement_commit_together() {
        let (_dir, store) = store();
        let full = store
            .bind(binding(1), policy(ReadMode::FullVault, &[]))
            .unwrap();
        let attached = store
            .bind(binding(2), policy(ReadMode::AttachedNotesOnly, &["one"]))
            .unwrap();
        let other = store
            .bind(binding(3), policy(ReadMode::AttachedNotesOnly, &["two"]))
            .unwrap();
        let retired = store.set_exclusion("one", true).unwrap();
        assert!(retired.contains(&full.authority_id) && retired.contains(&attached.authority_id));
        assert!(!retired.contains(&other.authority_id));
        assert!(store.is_excluded("one").unwrap());
        store.set_exclusion("one", false).unwrap();
        assert!(store.snapshot(&full.authority_id).unwrap().retired);
        assert!(!store.is_excluded("one").unwrap());
    }
    #[test]
    fn foreign_binding_and_stale_atomic_receipt_admission_fail_closed() {
        let (_dir, store) = store();
        let authority = store
            .bind(binding(1), policy(ReadMode::FullVault, &[]))
            .unwrap();
        assert_eq!(
            store
                .validate_binding(&authority.authority_id, &binding(2))
                .unwrap_err()
                .code,
            "foreign_authority"
        );
        assert_eq!(
            store
                .with_authority(&authority.authority_id, Some(42), |_, _| Ok(()))
                .unwrap_err()
                .code,
            "stale_authority"
        );
        let result: DomainResult<()> =
            store.with_authority(&authority.authority_id, Some(1), |tx, _| {
                tx.execute(
                    "INSERT INTO chat_note_policies VALUES('one','excluded','',0)",
                    [],
                )?;
                Err(DomainError::new("blocked", "Injected receipt rejection"))
            });
        assert!(result.is_err());
        assert!(!store.is_excluded("one").unwrap());
    }
}
