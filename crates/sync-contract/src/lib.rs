use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RequestMagicLinkRequest {
    pub email: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RequestMagicLinkResponse {
    pub accepted: bool,
    pub expires_at: String,
    pub magic_link_token: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CompleteMagicLinkRequest {
    pub email: String,
    pub magic_link_token: String,
    pub device_id: String,
    pub device_name: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthSession {
    pub session_token: String,
    pub user_id: String,
    pub vault_id: String,
    pub device_id: String,
    pub expires_at: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteHead {
    pub note_id: String,
    pub revision: i64,
    pub relative_path: String,
    pub content_hash: String,
    pub trashed_at: Option<String>,
    pub updated_at: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GetManifestResponse {
    pub vault_id: String,
    pub cursor: i64,
    pub notes: Vec<NoteHead>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GetNoteResponse {
    pub note: RemoteHead,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncChange {
    pub cursor: i64,
    pub kind: SyncChangeKind,
    pub note_id: String,
    pub revision: Option<i64>,
    pub relative_path: Option<String>,
    pub content_hash: Option<String>,
    pub trashed_at: Option<String>,
    pub updated_at: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum SyncChangeKind {
    Upsert,
    Trash,
    Restore,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PullChangesResponse {
    pub vault_id: String,
    pub cursor: i64,
    pub changes: Vec<SyncChange>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PushNoteSnapshotRequest {
    pub note_id: String,
    pub base_revision: Option<i64>,
    pub relative_path: String,
    pub markdown: String,
    pub content_hash: String,
    pub updated_at: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteHead {
    pub note_id: String,
    pub revision: i64,
    pub relative_path: String,
    pub markdown: String,
    pub content_hash: String,
    pub trashed_at: Option<String>,
    pub updated_at: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum PushNoteSnapshotStatus {
    Accepted,
    Conflict,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PushNoteSnapshotResponse {
    pub status: PushNoteSnapshotStatus,
    pub current_revision: i64,
    pub cursor: i64,
    pub remote_head: Option<RemoteHead>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum TrashAction {
    Trash,
    Restore,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PushTrashEventRequest {
    pub note_id: String,
    pub base_revision: Option<i64>,
    pub action: TrashAction,
    pub relative_path: String,
    pub markdown: String,
    pub content_hash: String,
    pub updated_at: String,
    pub trashed_at: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PushTrashEventResponse {
    pub status: PushNoteSnapshotStatus,
    pub current_revision: i64,
    pub cursor: i64,
    pub remote_head: Option<RemoteHead>,
}
