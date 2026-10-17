//! Retained chat configuration and access policy. No conversation, run or review lifecycle.
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::{path::PathBuf, sync::Arc};
const DEFAULT_MODEL: &str = "gpt-5.6-terra";
const DEFAULT_LOCAL_MODEL: &str = "";
const DEFAULT_LOCAL_BASE_URL: &str = "http://localhost:1234/v1";
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) enum VaultAccess {
    None,
    Full,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) enum ChatServiceTier {
    Standard,
    Flex,
}

impl ChatServiceTier {
    pub(crate) fn as_str(&self) -> &'static str {
        match self {
            Self::Standard => "standard",
            Self::Flex => "flex",
        }
    }

    pub(crate) fn parse(value: &str) -> Self {
        match value {
            "flex" => Self::Flex,
            _ => Self::Standard,
        }
    }
}

impl VaultAccess {
    pub(crate) fn as_str(&self) -> &'static str {
        match self {
            Self::None => "none",
            Self::Full => "full",
        }
    }

    pub(crate) fn parse(value: &str) -> Self {
        match value {
            "none" => Self::None,
            "full" => Self::Full,
            _ => Self::None,
        }
    }
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ChatDefaults {
    pub(crate) provider: String,
    pub(crate) model: String,
    #[serde(default = "default_openai_model")]
    pub(crate) openai_model: String,
    #[serde(default = "default_local_model")]
    pub(crate) local_model: String,
    #[serde(default = "default_local_base_url")]
    pub(crate) local_base_url: String,
    #[serde(default = "default_reasoning_effort")]
    pub(crate) reasoning_effort: String,
    pub(crate) service_tier: ChatServiceTier,
    pub(crate) default_access: VaultAccess,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ChatSettings {
    pub(crate) provider: String,
    pub(crate) model: String,
    #[serde(default = "default_openai_model")]
    pub(crate) openai_model: String,
    #[serde(default = "default_local_model")]
    pub(crate) local_model: String,
    #[serde(default = "default_local_base_url")]
    pub(crate) local_base_url: String,
    #[serde(default = "default_reasoning_effort")]
    pub(crate) reasoning_effort: String,
    pub(crate) service_tier: ChatServiceTier,
    pub(crate) default_access: VaultAccess,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LocalModelCapabilitySelection {
    pub(crate) images: bool,
    pub(crate) tools: bool,
    pub(crate) audio: bool,
    pub(crate) video: bool,
    pub(crate) reasoning_effort: String,
}

impl Default for LocalModelCapabilitySelection {
    fn default() -> Self {
        Self {
            images: false,
            tools: true,
            audio: false,
            video: false,
            reasoning_effort: DEFAULT_REASONING_EFFORT.to_string(),
        }
    }
}

impl Default for ChatSettings {
    fn default() -> Self {
        Self {
            provider: "openai".to_string(),
            model: DEFAULT_MODEL.to_string(),
            openai_model: DEFAULT_MODEL.to_string(),
            local_model: DEFAULT_LOCAL_MODEL.to_string(),
            local_base_url: DEFAULT_LOCAL_BASE_URL.to_string(),
            reasoning_effort: DEFAULT_REASONING_EFFORT.to_string(),
            service_tier: ChatServiceTier::Standard,
            default_access: VaultAccess::Full,
        }
    }
}

fn default_openai_model() -> String {
    DEFAULT_MODEL.to_string()
}

fn default_local_model() -> String {
    DEFAULT_LOCAL_MODEL.to_string()
}

fn default_local_base_url() -> String {
    DEFAULT_LOCAL_BASE_URL.to_string()
}

pub(crate) const DEFAULT_REASONING_EFFORT: &str = "medium";

fn default_reasoning_effort() -> String {
    DEFAULT_REASONING_EFFORT.to_string()
}

pub(crate) fn validate_reasoning_effort(value: &str) -> Result<&str, String> {
    let value = value.trim();
    if crate::provider_config::local_reasoning::valid_option(value) {
        Ok(value)
    } else {
        Err("Reasoning setting must be a nonempty identifier of at most 64 characters".to_string())
    }
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ChatNotePolicy {
    pub(crate) note_id: String,
    pub(crate) note_path: Option<String>,
    pub(crate) title: String,
    pub(crate) disposition: String,
    pub(crate) updated_at_millis: u64,
}

#[derive(Clone)]
pub(crate) struct ChatDomain {
    inner: Arc<ChatDomainInner>,
}
struct ChatDomainInner {
    db_path: PathBuf,
}
impl ChatDomain {
    pub(crate) fn new(vault_data_dir: PathBuf) -> Result<Self, String> {
        std::fs::create_dir_all(&vault_data_dir).map_err(|e| e.to_string())?;
        let service = Self {
            inner: Arc::new(ChatDomainInner {
                db_path: vault_data_dir.join("ai.sqlite3"),
            }),
        };
        service.initialize()?;
        Ok(service)
    }
    fn connection(&self) -> Result<Connection, String> {
        Connection::open(&self.inner.db_path).map_err(|e| e.to_string())
    }
    fn initialize(&self) -> Result<(), String> {
        let connection = self.connection()?;
        connection.execute_batch("PRAGMA journal_mode=WAL;
          CREATE TABLE IF NOT EXISTS chat_settings (
            id INTEGER PRIMARY KEY CHECK(id=1), provider TEXT NOT NULL, model TEXT NOT NULL,
            openai_model TEXT NOT NULL DEFAULT 'gpt-5.6-terra', local_model TEXT NOT NULL DEFAULT '',
            local_base_url TEXT NOT NULL DEFAULT 'http://localhost:1234/v1',
            reasoning_effort TEXT NOT NULL DEFAULT 'medium', service_tier TEXT NOT NULL DEFAULT 'standard',
            default_access TEXT NOT NULL);
          CREATE TABLE IF NOT EXISTS chat_note_policies (note_id TEXT PRIMARY KEY, disposition TEXT NOT NULL CHECK(disposition = 'excluded'), title TEXT NOT NULL DEFAULT '', updated_at_millis INTEGER NOT NULL);
          CREATE TABLE IF NOT EXISTS chat_composer_drafts (slot TEXT PRIMARY KEY,body TEXT NOT NULL,updated_at_millis INTEGER NOT NULL);
          CREATE TABLE IF NOT EXISTS chat_local_model_capabilities (model TEXT PRIMARY KEY, images INTEGER NOT NULL DEFAULT 0,tools INTEGER NOT NULL DEFAULT 1,audio INTEGER NOT NULL DEFAULT 0,video INTEGER NOT NULL DEFAULT 0,reasoning_effort TEXT NOT NULL DEFAULT 'medium',updated_at_millis INTEGER NOT NULL);
        ").map_err(|e|e.to_string())?;
        connection.execute("INSERT OR IGNORE INTO chat_settings(id,provider,model,default_access) VALUES(1,'openai',?1,'full')",[DEFAULT_MODEL]).map_err(|e|e.to_string())?;
        Ok(())
    }
    pub(crate) fn get_settings(&self) -> Result<ChatSettings, String> {
        self.connection()?
            .query_row(
                "SELECT provider, model, openai_model, local_model, local_base_url,
                        reasoning_effort, service_tier, default_access
                 FROM chat_settings WHERE id = 1",
                [],
                |row| {
                    Ok(ChatSettings {
                        provider: row.get(0)?,
                        model: row.get(1)?,
                        openai_model: row.get(2)?,
                        local_model: row.get(3)?,
                        local_base_url: row.get(4)?,
                        reasoning_effort: row.get(5)?,
                        service_tier: ChatServiceTier::parse(&row.get::<_, String>(6)?),
                        default_access: VaultAccess::parse(&row.get::<_, String>(7)?),
                    })
                },
            )
            .map_err(|error| error.to_string())
    }

    pub(crate) fn set_defaults(&self, settings: ChatDefaults) -> Result<ChatSettings, String> {
        let model = settings.model.trim();
        if model.is_empty() {
            return Err("A model is required".to_string());
        }
        if settings.provider != "openai" && settings.provider != "local" {
            return Err("Provider must be openai or local".to_string());
        }
        let reasoning_effort = validate_reasoning_effort(&settings.reasoning_effort)?;
        crate::provider_config::validate_local_base_url(&settings.local_base_url)?;
        self.connection()?
            .execute(
                "UPDATE chat_settings
                 SET provider = ?1, model = ?2, openai_model = ?3, local_model = ?4,
                     local_base_url = ?5, reasoning_effort = ?6, service_tier = ?7,
                     default_access = ?8
                 WHERE id = 1",
                params![
                    settings.provider,
                    model,
                    settings.openai_model.trim(),
                    settings.local_model.trim(),
                    settings.local_base_url.trim(),
                    reasoning_effort,
                    settings.service_tier.as_str(),
                    settings.default_access.as_str()
                ],
            )
            .map_err(|error| error.to_string())?;
        self.get_settings()
    }

    pub(crate) fn local_model_capabilities(
        &self,
        model: &str,
    ) -> Result<LocalModelCapabilitySelection, String> {
        let model = model.trim();
        if model.is_empty() {
            return Ok(LocalModelCapabilitySelection::default());
        }
        self.connection()?
            .query_row(
                "SELECT images, tools, audio, video, reasoning_effort
                 FROM chat_local_model_capabilities WHERE model = ?1",
                [model],
                |row| {
                    Ok(LocalModelCapabilitySelection {
                        images: row.get::<_, i64>(0)? != 0,
                        tools: row.get::<_, i64>(1)? != 0,
                        audio: row.get::<_, i64>(2)? != 0,
                        video: row.get::<_, i64>(3)? != 0,
                        reasoning_effort: row.get(4)?,
                    })
                },
            )
            .optional()
            .map(|selection| selection.unwrap_or_default())
            .map_err(|error| error.to_string())
    }

    pub(crate) fn set_local_model_capabilities(
        &self,
        model: &str,
        mut capabilities: LocalModelCapabilitySelection,
    ) -> Result<LocalModelCapabilitySelection, String> {
        let model = model.trim();
        if model.is_empty() {
            return Err("A local model is required".to_string());
        }
        capabilities.reasoning_effort =
            validate_reasoning_effort(&capabilities.reasoning_effort)?.to_string();
        self.connection()?
            .execute(
                "INSERT INTO chat_local_model_capabilities
                   (model, images, tools, audio, video, reasoning_effort, updated_at_millis)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
                 ON CONFLICT(model) DO UPDATE SET
                   images = excluded.images,
                   tools = excluded.tools,
                   audio = excluded.audio,
                   video = excluded.video,
                   reasoning_effort = excluded.reasoning_effort,
                   updated_at_millis = excluded.updated_at_millis",
                params![
                    model,
                    capabilities.images,
                    capabilities.tools,
                    capabilities.audio,
                    capabilities.video,
                    capabilities.reasoning_effort,
                    to_i64(now_millis())?
                ],
            )
            .map_err(|error| error.to_string())?;
        Ok(capabilities)
    }

    /// Unsent composer text for a slot. A slot is either a conversation or a
    /// pane that has not created its conversation yet.
    pub(crate) fn get_composer_draft(&self, slot: &str) -> Result<String, String> {
        let slot = normalize_composer_draft_slot(slot)?;
        self.connection()?
            .query_row(
                "SELECT body FROM chat_composer_drafts WHERE slot = ?1",
                [&slot],
                |row| row.get::<_, String>(0),
            )
            .optional()
            .map(|body| body.unwrap_or_default())
            .map_err(|error| error.to_string())
    }

    pub(crate) fn set_composer_draft(&self, slot: &str, body: &str) -> Result<(), String> {
        let slot = normalize_composer_draft_slot(slot)?;
        let connection = self.connection()?;

        // An empty draft is an absence, not a value worth keeping around.
        if body.is_empty() {
            connection
                .execute("DELETE FROM chat_composer_drafts WHERE slot = ?1", [&slot])
                .map(|_| ())
                .map_err(|error| error.to_string())
        } else {
            connection
                .execute(
                    "INSERT INTO chat_composer_drafts (slot, body, updated_at_millis)
                     VALUES (?1, ?2, ?3)
                     ON CONFLICT(slot) DO UPDATE SET body = excluded.body,
                       updated_at_millis = excluded.updated_at_millis",
                    params![slot, body, to_i64(now_millis())?],
                )
                .map(|_| ())
                .map_err(|error| error.to_string())
        }
    }

    pub(crate) fn list_note_policies(&self) -> Result<Vec<ChatNotePolicy>, String> {
        let connection = self.connection()?;
        let mut statement = connection
            .prepare(
                "SELECT note_id, title, disposition, updated_at_millis
                 FROM chat_note_policies WHERE disposition='excluded' ORDER BY title",
            )
            .map_err(|error| error.to_string())?;
        let rows = statement
            .query_map([], |row| {
                Ok(ChatNotePolicy {
                    note_id: row.get(0)?,
                    note_path: None,
                    title: row.get(1)?,
                    disposition: row.get(2)?,
                    updated_at_millis: row.get::<_, i64>(3)?.max(0) as u64,
                })
            })
            .map_err(|error| error.to_string())?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|error| error.to_string())
    }
}
fn now_millis() -> u64 {
    crate::time::current_time_millis().unwrap_or_default()
}
fn to_i64(value: u64) -> Result<i64, String> {
    i64::try_from(value).map_err(|_| "Timestamp out of range".into())
}
const MAX_COMPOSER_DRAFT_SLOT_LEN: usize = 200;

fn normalize_composer_draft_slot(slot: &str) -> Result<String, String> {
    let slot = slot.trim();
    if slot.is_empty() {
        return Err("Composer draft slot is required".to_string());
    }
    if slot.len() > MAX_COMPOSER_DRAFT_SLOT_LEN {
        return Err("Composer draft slot is too long".to_string());
    }
    Ok(slot.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn configuration_exposes_only_supported_access_and_preserves_exclusions() {
        let root = crate::test_support::TestDir::new("chat-current-configuration");
        let domain = ChatDomain::new(root.path().join("data")).unwrap();
        let settings = serde_json::to_value(domain.get_settings().unwrap()).unwrap();
        assert_eq!(settings["defaultAccess"], "full");
        assert!(settings.get("webAccess").is_none());
        assert!(settings.get("atlasVisibility").is_none());
        assert!(serde_json::from_value::<VaultAccess>(serde_json::json!("approved")).is_err());
        assert!(serde_json::from_value::<VaultAccess>(serde_json::json!("limited")).is_err());
        assert_eq!(VaultAccess::parse("unknown"), VaultAccess::None);

        let connection = domain.connection().unwrap();
        assert!(connection
            .execute(
                "INSERT INTO chat_note_policies VALUES('approved-note','approved','',0)",
                []
            )
            .is_err());
        connection
            .execute(
                "INSERT INTO chat_note_policies VALUES('private-note','excluded','Private',0)",
                [],
            )
            .unwrap();
        let policies = domain.list_note_policies().unwrap();
        assert_eq!(policies.len(), 1);
        assert_eq!(policies[0].note_id, "private-note");
        assert_eq!(policies[0].disposition, "excluded");
    }

    #[test]
    fn retained_configuration_never_initializes_lifecycle_tables() {
        let root = crate::test_support::TestDir::new("chat-domain-retained");
        let domain = ChatDomain::new(root.path().join("data")).unwrap();
        domain
            .set_composer_draft("pane:one", "Unsent text")
            .unwrap();

        let connection = domain.connection().unwrap();
        let mut stmt = connection
            .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
            .unwrap();
        let tables = stmt
            .query_map([], |r| r.get::<_, String>(0))
            .unwrap()
            .collect::<Result<Vec<_>, _>>()
            .unwrap();
        assert_eq!(
            tables,
            vec![
                "chat_composer_drafts",
                "chat_local_model_capabilities",
                "chat_note_policies",
                "chat_settings"
            ]
        );
        drop(domain);
        let domain = ChatDomain::new(root.path().join("data")).unwrap();
        assert_eq!(
            domain.get_composer_draft("pane:one").unwrap(),
            "Unsent text"
        );
    }
}
