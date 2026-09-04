// Canonical ordinary-note mutation, observation, lifecycle, and role-limited
// history boundary. Storage and post-publication coordination remain private
// implementation details so callers depend only on the closed domain contract.
#![allow(dead_code)]

mod history_store;
mod post_publication;
mod runtime;

use self::post_publication::{PublicationIssue, PublicationOutcome, PublicationStage};
pub(crate) use self::runtime::NoteTimelineRuntime;
use self::runtime::{
    CurrentContentMutationGuard, CurrentContentVersion, OperationGuard, RecoveryIntegrity,
};
use crate::{
    index::{build_indexed_note, AppState, NoteTimelineOwnerToken},
    path_utils::{collect_markdown_files_recursively, unique_path_in_dir},
};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD as BASE64_URL_SAFE, Engine as _};
use serde::{Deserialize, Serialize};
use similar::{capture_diff_slices, Algorithm, DiffOp};
use std::{
    collections::{HashMap, HashSet},
    fs,
    path::{Path, PathBuf},
};

pub(crate) const BACKGROUND_HISTORY_COMPACTION_BUDGET_BYTES: u64 = 256 * 1024;
const RECOVERY_DAY_MILLIS: u64 = 24 * 60 * 60 * 1_000;

pub(crate) fn ensure_vault_scaffold(
    vault_root: &Path,
) -> Result<crate::state::VaultManifest, String> {
    crate::state::ensure_vault_scaffold_for_history(
        vault_root,
        history_store::HISTORY_FORMAT,
        history_store::INITIAL_HISTORY_GENERATION,
    )
}

macro_rules! identity_type {
    ($name:ident) => {
        #[derive(Clone, Debug, PartialEq, Eq, Hash)]
        pub(crate) struct $name(String);
    };
}

identity_type!(NoteIdentity);
identity_type!(RevisionIdentity);
identity_type!(LifecycleEventIdentity);
identity_type!(TurnIdentity);
identity_type!(DeletionOperationIdentity);

impl NoteIdentity {
    pub(crate) fn new(value: impl Into<String>) -> Self {
        Self(value.into())
    }

    pub(crate) fn as_str(&self) -> &str {
        &self.0
    }
}

impl TurnIdentity {
    pub(crate) fn new(value: impl Into<String>) -> Self {
        Self(value.into())
    }
}

impl RevisionIdentity {
    fn issue() -> Self {
        Self(crate::note::generate_unique_id())
    }

    pub(crate) fn from_persisted(value: impl Into<String>) -> Self {
        Self(value.into())
    }

    pub(crate) fn as_str(&self) -> &str {
        &self.0
    }
}

impl LifecycleEventIdentity {
    fn issue() -> Self {
        Self(crate::note::generate_unique_id())
    }

    fn from_persisted(value: impl Into<String>) -> Self {
        Self(value.into())
    }
}

impl DeletionOperationIdentity {
    fn issue() -> Self {
        Self(crate::note::generate_unique_id())
    }

    fn from_persisted(value: impl Into<String>) -> Self {
        Self(value.into())
    }

    pub(crate) fn as_str(&self) -> &str {
        &self.0
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum PayloadVersion {
    V1,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) enum TimelineRecordIdentity {
    Revision(RevisionIdentity),
    LifecycleEvent(LifecycleEventIdentity),
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum LifecycleEventKind {
    Created,
    Renamed,
    Moved,
    Forgotten,
    Recovered,
    Missing,
    Reattached,
    Purged,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum MutationSource {
    Editor,
    TaskAction,
    AcceptedChatProposal,
    ExternalEdit,
    VersionRestore,
    NoteCreation,
    BaselineInitialization,
    RecoveryReconciliation,
}

impl MutationSource {
    fn as_storage_value(self) -> &'static str {
        match self {
            Self::Editor => "editor",
            Self::TaskAction => "taskAction",
            Self::AcceptedChatProposal => "acceptedChatProposal",
            Self::ExternalEdit => "externalEdit",
            Self::VersionRestore => "versionRestore",
            Self::NoteCreation => "noteCreation",
            Self::BaselineInitialization => "baselineInitialization",
            Self::RecoveryReconciliation => "recoveryReconciliation",
        }
    }

    fn from_storage_value(value: &str) -> Option<Self> {
        match value {
            "editor" => Some(Self::Editor),
            "taskAction" => Some(Self::TaskAction),
            "acceptedChatProposal" => Some(Self::AcceptedChatProposal),
            "externalEdit" => Some(Self::ExternalEdit),
            "versionRestore" => Some(Self::VersionRestore),
            "noteCreation" => Some(Self::NoteCreation),
            "baselineInitialization" => Some(Self::BaselineInitialization),
            "recoveryReconciliation" => Some(Self::RecoveryReconciliation),
            _ => None,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum MutationWarningStage {
    CanonicalRead,
    CatalogUpsert,
    TaskProjectionUpsert,
    CatalogRemove,
    TaskProjectionRemove,
    TaskViewRefresh,
    SemanticUpdate,
    SemanticMove,
    DirtyRecovery,
    HistoryFinalization,
    Revision,
}

impl From<PublicationStage> for MutationWarningStage {
    fn from(stage: PublicationStage) -> Self {
        match stage {
            PublicationStage::CanonicalRead => Self::CanonicalRead,
            PublicationStage::CatalogUpsert => Self::CatalogUpsert,
            PublicationStage::TaskProjectionUpsert => Self::TaskProjectionUpsert,
            PublicationStage::CatalogRemove => Self::CatalogRemove,
            PublicationStage::TaskProjectionRemove => Self::TaskProjectionRemove,
            PublicationStage::SemanticUpdate => Self::SemanticUpdate,
            PublicationStage::SemanticMove => Self::SemanticMove,
            PublicationStage::DirtyRecovery => Self::DirtyRecovery,
            PublicationStage::HistoryFinalization => Self::HistoryFinalization,
            PublicationStage::Revision => Self::Revision,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct NoteTimelineIssue {
    stage: MutationWarningStage,
    message: String,
}

impl NoteTimelineIssue {
    pub(crate) fn stage(&self) -> MutationWarningStage {
        self.stage
    }

    pub(crate) fn message(&self) -> &str {
        &self.message
    }
}

impl From<PublicationIssue> for NoteTimelineIssue {
    fn from(issue: PublicationIssue) -> Self {
        Self {
            stage: issue.stage.into(),
            message: issue.message,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct NoteMutationWarning {
    #[serde(skip)]
    payload_version: PayloadVersion,
    message: String,
    issues: Vec<NoteTimelineIssue>,
}

impl NoteMutationWarning {
    pub(crate) fn payload_version(&self) -> PayloadVersion {
        self.payload_version
    }

    pub(crate) fn message(&self) -> &str {
        &self.message
    }

    pub(crate) fn issues(&self) -> &[NoteTimelineIssue] {
        &self.issues
    }

    pub(crate) fn single(
        stage: MutationWarningStage,
        message: String,
        issue_message: String,
    ) -> Self {
        Self {
            payload_version: PayloadVersion::V1,
            message,
            issues: vec![NoteTimelineIssue {
                stage,
                message: issue_message,
            }],
        }
    }

    pub(crate) fn merge(&mut self, other: Self) {
        self.message = format!("{}; {}", self.message, other.message);
        self.issues.extend(other.issues);
    }
}

fn merge_note_mutation_warning(
    warning: &mut Option<NoteMutationWarning>,
    stage: MutationWarningStage,
    message: &str,
    issue: String,
) {
    let next = NoteMutationWarning::single(stage, message.to_string(), issue);
    match warning {
        Some(warning) => warning.merge(next),
        None => *warning = Some(next),
    }
}

fn merge_optional_note_mutation_warning(
    mut warning: Option<NoteMutationWarning>,
    other: Option<NoteMutationWarning>,
) -> Option<NoteMutationWarning> {
    if let Some(other) = other {
        match &mut warning {
            Some(warning) => warning.merge(other),
            None => warning = Some(other),
        }
    }
    warning
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct NoteMutationResult {
    payload_version: PayloadVersion,
    source: MutationSource,
    note_id: NoteIdentity,
    path: PathBuf,
    canonical_markdown: String,
    diagnostics: Vec<NoteTimelineIssue>,
    warning: Option<NoteMutationWarning>,
}

impl NoteMutationResult {
    fn from_publication(source: MutationSource, outcome: PublicationOutcome) -> Self {
        let warning = outcome
            .required_consistency_warning()
            .map(|warning| NoteMutationWarning {
                payload_version: PayloadVersion::V1,
                message: warning.message,
                issues: warning.issues.into_iter().map(Into::into).collect(),
            });
        Self {
            payload_version: PayloadVersion::V1,
            source,
            note_id: NoteIdentity::new(outcome.note_id),
            path: outcome.path,
            canonical_markdown: outcome.canonical_markdown,
            diagnostics: outcome.issues.into_iter().map(Into::into).collect(),
            warning,
        }
    }

    pub(crate) fn payload_version(&self) -> PayloadVersion {
        self.payload_version
    }

    pub(crate) fn source(&self) -> MutationSource {
        self.source
    }

    pub(crate) fn note_id(&self) -> &NoteIdentity {
        &self.note_id
    }

    pub(crate) fn path(&self) -> &Path {
        &self.path
    }

    pub(crate) fn canonical_markdown(&self) -> &str {
        &self.canonical_markdown
    }

    pub(crate) fn warning(&self) -> Option<&NoteMutationWarning> {
        self.warning.as_ref()
    }

    pub(crate) fn diagnostics(&self) -> &[NoteTimelineIssue] {
        &self.diagnostics
    }

    pub(crate) fn report_degraded(&self, source: &str) {
        for issue in &self.diagnostics {
            eprintln!(
                "{source} committed {} but post-commit {:?} degraded: {}",
                self.path.display(),
                issue.stage,
                issue.message
            );
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct NoteRevisionHeader {
    identity: RevisionIdentity,
    note_identity: NoteIdentity,
    predecessor: Option<TimelineRecordIdentity>,
    payload_version: PayloadVersion,
    source: MutationSource,
    time_evidence: RevisionTimeEvidence,
    content_hash: String,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum RevisionTimeEvidence {
    Baseline {
        known_since_millis: u64,
    },
    Committed {
        committed_at_millis: u64,
    },
    Observed {
        observed_at_millis: u64,
        modified_at_millis: Option<u64>,
    },
}

impl NoteRevisionHeader {
    fn issue(
        note_identity: NoteIdentity,
        predecessor: Option<TimelineRecordIdentity>,
        payload_version: PayloadVersion,
        source: MutationSource,
    ) -> Self {
        Self {
            identity: RevisionIdentity::issue(),
            note_identity,
            predecessor,
            payload_version,
            source,
            time_evidence: RevisionTimeEvidence::Committed {
                committed_at_millis: 0,
            },
            content_hash: String::new(),
        }
    }

    pub(crate) fn predecessor(&self) -> Option<&TimelineRecordIdentity> {
        self.predecessor.as_ref()
    }

    pub(crate) fn identity(&self) -> &RevisionIdentity {
        &self.identity
    }

    pub(crate) fn source(&self) -> MutationSource {
        self.source
    }

    pub(crate) fn content_hash(&self) -> &str {
        &self.content_hash
    }

    pub(crate) fn time_evidence(&self) -> RevisionTimeEvidence {
        self.time_evidence
    }

    pub(crate) fn committed_at_millis(&self) -> Option<u64> {
        match self.time_evidence {
            RevisionTimeEvidence::Committed {
                committed_at_millis,
            } => Some(committed_at_millis),
            RevisionTimeEvidence::Baseline { .. } | RevisionTimeEvidence::Observed { .. } => None,
        }
    }

    pub(crate) fn observed_at_millis(&self) -> Option<u64> {
        match self.time_evidence {
            RevisionTimeEvidence::Observed {
                observed_at_millis, ..
            } => Some(observed_at_millis),
            RevisionTimeEvidence::Baseline { .. } | RevisionTimeEvidence::Committed { .. } => None,
        }
    }

    pub(crate) fn modified_at_millis(&self) -> Option<u64> {
        match self.time_evidence {
            RevisionTimeEvidence::Observed {
                modified_at_millis, ..
            } => modified_at_millis,
            RevisionTimeEvidence::Baseline { .. } | RevisionTimeEvidence::Committed { .. } => None,
        }
    }

    pub(crate) fn known_since_millis(&self) -> Option<u64> {
        match self.time_evidence {
            RevisionTimeEvidence::Baseline { known_since_millis } => Some(known_since_millis),
            RevisionTimeEvidence::Committed { .. } | RevisionTimeEvidence::Observed { .. } => None,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum BaselineInitializationPhase {
    NotStarted,
    Initializing,
    Complete,
    Degraded,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct BaselineInitializationProgress {
    phase: BaselineInitializationPhase,
    discovered_notes: u64,
    baseline_revisions: u64,
    ready_notes: u64,
    failed_notes: u64,
    last_error: Option<String>,
}

impl BaselineInitializationProgress {
    pub(crate) fn phase(&self) -> BaselineInitializationPhase {
        self.phase
    }

    pub(crate) fn discovered_notes(&self) -> u64 {
        self.discovered_notes
    }

    pub(crate) fn baseline_revisions(&self) -> u64 {
        self.baseline_revisions
    }

    pub(crate) fn ready_notes(&self) -> u64 {
        self.ready_notes
    }

    pub(crate) fn failed_notes(&self) -> u64 {
        self.failed_notes
    }

    pub(crate) fn last_error(&self) -> Option<&str> {
        self.last_error.as_deref()
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) enum NoteBaselineInitializationState {
    Uninitialized,
    Failed { error: String },
    Initialized { known_since_millis: Option<u64> },
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct HistoryResetReceipt {
    operation_id: String,
    previous_generation: u64,
    generation: u64,
    reset_at_millis: u64,
    initialization: BaselineInitializationProgress,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum HistoryDeletionKind {
    // Individual revisions are deliberately absent: only whole-scope
    // boundaries can delete retained authored states. Named Revision labels
    // remain independent records and can be removed without this vocabulary.
    Clear,
    Purge,
}

impl HistoryDeletionKind {
    fn as_storage_value(self) -> &'static str {
        match self {
            Self::Clear => "clear",
            Self::Purge => "purge",
        }
    }

    fn from_storage_value(value: &str) -> Option<Self> {
        match value {
            "clear" => Some(Self::Clear),
            "purge" => Some(Self::Purge),
            _ => None,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) enum DeletionScope {
    Note(NoteIdentity),
    Vault(String),
}

impl DeletionScope {
    fn storage_parts(&self) -> (&'static str, &str) {
        match self {
            Self::Note(note_id) => ("note", note_id.as_str()),
            Self::Vault(vault_id) => ("vault", vault_id),
        }
    }

    fn from_storage_parts(kind: &str, identity: String) -> Result<Self, String> {
        match kind {
            "note" => Ok(Self::Note(NoteIdentity::new(identity))),
            "vault" => Ok(Self::Vault(identity)),
            _ => Err(format!("Unknown deletion marker scope `{kind}`")),
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct DeletionMarker {
    payload_version: PayloadVersion,
    operation_id: DeletionOperationIdentity,
    scope: DeletionScope,
    kind: HistoryDeletionKind,
    occurred_at_millis: u64,
    history_generation: u64,
}

impl DeletionMarker {
    fn issue(
        scope: DeletionScope,
        kind: HistoryDeletionKind,
        occurred_at_millis: u64,
        history_generation: u64,
    ) -> Self {
        Self {
            payload_version: PayloadVersion::V1,
            operation_id: DeletionOperationIdentity::issue(),
            scope,
            kind,
            occurred_at_millis,
            history_generation,
        }
    }

    pub(crate) fn payload_version(&self) -> PayloadVersion {
        self.payload_version
    }

    pub(crate) fn operation_id(&self) -> &DeletionOperationIdentity {
        &self.operation_id
    }

    pub(crate) fn scope(&self) -> &DeletionScope {
        &self.scope
    }

    pub(crate) fn kind(&self) -> HistoryDeletionKind {
        self.kind
    }

    pub(crate) fn occurred_at_millis(&self) -> u64 {
        self.occurred_at_millis
    }

    pub(crate) fn history_generation(&self) -> u64 {
        self.history_generation
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct HistoryDeletionReceipt {
    marker: DeletionMarker,
    baseline_note_ids: Vec<NoteIdentity>,
}

#[derive(Clone, Debug)]
struct HistoryClearBaseline {
    note_id: NoteIdentity,
    path: PathBuf,
    canonical_markdown: String,
}

#[derive(Clone, Debug)]
enum ExistingBaselineCandidate {
    Active {
        path: PathBuf,
    },
    Forgotten {
        path: PathBuf,
        note_id: Option<NoteIdentity>,
        original_path: PathBuf,
        forgotten_at_millis: u64,
    },
    Missing {
        record: MissingNoteRecord,
        canonical_markdown: String,
    },
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum BaselineInitializationHistory {
    SettleExistingStore,
    RebuildReplacementStore,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum ResetHistorySource {
    RequireReadableStore,
    PreserveWhenReadable,
}

impl ExistingBaselineCandidate {
    fn path(&self) -> &Path {
        match self {
            Self::Active { path } | Self::Forgotten { path, .. } => path,
            Self::Missing { record, .. } => record.path(),
        }
    }

    fn canonical_markdown(&self) -> Option<&str> {
        match self {
            Self::Missing {
                canonical_markdown, ..
            } => Some(canonical_markdown),
            Self::Active { .. } | Self::Forgotten { .. } => None,
        }
    }

    fn retained_note_id(&self) -> Option<NoteIdentity> {
        match self {
            Self::Active { .. } => None,
            Self::Forgotten { note_id, .. } => note_id.clone(),
            Self::Missing { record, .. } => Some(record.note_id().clone()),
        }
    }

    fn is_inactive(&self) -> bool {
        !matches!(self, Self::Active { .. })
    }

    fn record_inactive_lifecycle(&self, note_id: &NoteIdentity) -> Result<(), String> {
        match self {
            Self::Active { .. } => Ok(()),
            Self::Forgotten {
                path,
                original_path,
                forgotten_at_millis,
                ..
            } => history_store::record_observed_lifecycle_event(
                note_id,
                LifecycleEventKind::Forgotten,
                Some(original_path),
                path,
                *forgotten_at_millis,
            ),
            Self::Missing { record, .. } => {
                history_store::record_observed_missing_lifecycle_event(record)
            }
        }
    }
}

impl HistoryDeletionReceipt {
    pub(crate) fn scope(&self) -> &DeletionScope {
        self.marker.scope()
    }

    pub(crate) fn kind(&self) -> HistoryDeletionKind {
        self.marker.kind()
    }

    pub(crate) fn marker(&self) -> &DeletionMarker {
        &self.marker
    }

    pub(crate) fn baseline_note_ids(&self) -> &[NoteIdentity] {
        &self.baseline_note_ids
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct HistoryStorageUsage {
    allocated_bytes: u64,
    reclaimable_bytes: u64,
}

impl HistoryStorageUsage {
    pub(crate) fn allocated_bytes(&self) -> u64 {
        self.allocated_bytes
    }

    pub(crate) fn reclaimable_bytes(&self) -> u64 {
        self.reclaimable_bytes
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum HistoryHealthState {
    Healthy,
    Initializing,
    Degraded,
    Warning,
    Unavailable,
    Corrupt,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum HistoryIntegrityState {
    Verified,
    Unavailable,
    Corrupt,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum NoteHistoryHealthState {
    Healthy,
    Initializing,
    Degraded,
    Unavailable,
    Corrupt,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct NoteHistoryHealth {
    note_id: String,
    state: NoteHistoryHealthState,
    revision_count: u64,
    lifecycle_event_count: u64,
    revision_payload_bytes: u64,
}

impl NoteHistoryHealth {
    pub(crate) fn state(&self) -> NoteHistoryHealthState {
        self.state
    }

    pub(crate) fn revision_count(&self) -> u64 {
        self.revision_count
    }

    pub(crate) fn lifecycle_event_count(&self) -> u64 {
        self.lifecycle_event_count
    }

    pub(crate) fn revision_payload_bytes(&self) -> u64 {
        self.revision_payload_bytes
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct HistoryHealthReport {
    state: HistoryHealthState,
    integrity: HistoryIntegrityState,
    initialization: BaselineInitializationProgress,
    #[serde(skip_serializing_if = "Option::is_none")]
    storage: Option<HistoryStorageUsage>,
    pending_repairs: u64,
    can_retry: bool,
    can_reset: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    last_reset: Option<HistoryResetReceipt>,
}

impl HistoryHealthReport {
    pub(crate) fn state(&self) -> HistoryHealthState {
        self.state
    }

    pub(crate) fn integrity(&self) -> HistoryIntegrityState {
        self.integrity
    }

    pub(crate) fn initialization(&self) -> &BaselineInitializationProgress {
        &self.initialization
    }

    pub(crate) fn storage(&self) -> Option<&HistoryStorageUsage> {
        self.storage.as_ref()
    }

    pub(crate) fn can_retry(&self) -> bool {
        self.can_retry
    }

    pub(crate) fn can_reset(&self) -> bool {
        self.can_reset
    }

    pub(crate) fn last_reset(&self) -> Option<&HistoryResetReceipt> {
        self.last_reset.as_ref()
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct HistoryCompactionReceipt {
    before: HistoryStorageUsage,
    after: HistoryStorageUsage,
}

impl HistoryCompactionReceipt {
    pub(crate) fn before(&self) -> &HistoryStorageUsage {
        &self.before
    }

    pub(crate) fn after(&self) -> &HistoryStorageUsage {
        &self.after
    }

    pub(crate) fn reclaimed_bytes(&self) -> u64 {
        self.before
            .allocated_bytes
            .saturating_sub(self.after.allocated_bytes)
    }
}

impl HistoryResetReceipt {
    pub(crate) fn operation_id(&self) -> &str {
        &self.operation_id
    }

    pub(crate) fn previous_generation(&self) -> u64 {
        self.previous_generation
    }

    pub(crate) fn generation(&self) -> u64 {
        self.generation
    }

    pub(crate) fn reset_at_millis(&self) -> u64 {
        self.reset_at_millis
    }

    pub(crate) fn initialization(&self) -> &BaselineInitializationProgress {
        &self.initialization
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct LifecycleEventHeader {
    identity: LifecycleEventIdentity,
    note_identity: NoteIdentity,
    predecessor: Option<TimelineRecordIdentity>,
    payload_version: PayloadVersion,
    kind: LifecycleEventKind,
    occurred_at_millis: u64,
    previous_path: Option<PathBuf>,
    path: Option<PathBuf>,
}

impl LifecycleEventHeader {
    fn issue(
        note_identity: NoteIdentity,
        predecessor: Option<TimelineRecordIdentity>,
        payload_version: PayloadVersion,
        kind: LifecycleEventKind,
    ) -> Self {
        Self {
            identity: LifecycleEventIdentity::issue(),
            note_identity,
            predecessor,
            payload_version,
            kind,
            occurred_at_millis: 0,
            previous_path: None,
            path: None,
        }
    }

    pub(crate) fn payload_version(&self) -> PayloadVersion {
        self.payload_version
    }

    pub(crate) fn kind(&self) -> LifecycleEventKind {
        self.kind
    }

    pub(crate) fn identity(&self) -> &LifecycleEventIdentity {
        &self.identity
    }

    pub(crate) fn occurred_at_millis(&self) -> u64 {
        self.occurred_at_millis
    }

    pub(crate) fn previous_path(&self) -> Option<&Path> {
        self.previous_path.as_deref()
    }

    pub(crate) fn path(&self) -> Option<&Path> {
        self.path.as_deref()
    }
}

impl LifecycleEventKind {
    fn as_storage_value(self) -> &'static str {
        match self {
            Self::Created => "created",
            Self::Renamed => "renamed",
            Self::Moved => "moved",
            Self::Forgotten => "forgotten",
            Self::Recovered => "recovered",
            Self::Missing => "missing",
            Self::Reattached => "reattached",
            Self::Purged => "purged",
        }
    }

    fn from_storage_value(value: &str) -> Option<Self> {
        match value {
            "created" => Some(Self::Created),
            "renamed" => Some(Self::Renamed),
            "moved" => Some(Self::Moved),
            "forgotten" => Some(Self::Forgotten),
            "recovered" => Some(Self::Recovered),
            "missing" => Some(Self::Missing),
            "reattached" => Some(Self::Reattached),
            "purged" => Some(Self::Purged),
            _ => None,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct ReconstructedNoteRevision {
    unmanaged_frontmatter: Option<String>,
    body: String,
}

pub(crate) struct PreparedHistoryIntent {
    value: String,
    operation: Option<OperationGuard>,
    current_content_mutation: Option<CurrentContentMutationGuard>,
}

impl std::fmt::Debug for PreparedHistoryIntent {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_tuple("PreparedHistoryIntent")
            .field(&self.value)
            .finish()
    }
}

impl PartialEq for PreparedHistoryIntent {
    fn eq(&self, other: &Self) -> bool {
        self.value == other.value
    }
}

impl Eq for PreparedHistoryIntent {}

impl PreparedHistoryIntent {
    fn from_persisted(value: String) -> Self {
        Self {
            value,
            operation: None,
            current_content_mutation: None,
        }
    }

    fn as_str(&self) -> &str {
        &self.value
    }

    fn with_runtime_leases(
        mut self,
        operation: OperationGuard,
        current_content_mutation: CurrentContentMutationGuard,
    ) -> Self {
        self.operation = Some(operation);
        self.current_content_mutation = Some(current_content_mutation);
        self
    }

    pub(crate) fn abandon(self) -> Result<(), String> {
        history_store::abandon_publication(&self)
    }

    pub(crate) fn abandon_after_publication_failure(self, publication_error: String) -> String {
        match self.abandon() {
            Ok(()) => publication_error,
            Err(abandon_error) => format!(
                "{publication_error}; additionally failed to abandon its prepared Note Revision: {abandon_error}"
            ),
        }
    }

    #[cfg(test)]
    pub(crate) fn for_test(value: &str) -> Self {
        Self {
            value: value.to_string(),
            operation: None,
            current_content_mutation: None,
        }
    }
}

#[derive(Debug)]
pub(crate) struct PreparedRevisionPublication {
    canonical_markdown: String,
    history_intent: PreparedHistoryIntent,
}

impl PreparedRevisionPublication {
    pub(crate) fn canonical_markdown(&self) -> &str {
        &self.canonical_markdown
    }

    pub(crate) fn into_parts(self) -> (String, PreparedHistoryIntent) {
        (self.canonical_markdown, self.history_intent)
    }

    fn with_runtime_leases(
        mut self,
        operation: OperationGuard,
        current_content_mutation: CurrentContentMutationGuard,
    ) -> Self {
        self.history_intent = self
            .history_intent
            .with_runtime_leases(operation, current_content_mutation);
        self
    }

    #[cfg(test)]
    pub(crate) fn for_test(markdown: &str, history_intent: &str) -> Self {
        Self {
            canonical_markdown: markdown.to_string(),
            history_intent: PreparedHistoryIntent::for_test(history_intent),
        }
    }
}

impl ReconstructedNoteRevision {
    pub(crate) fn unmanaged_frontmatter(&self) -> Option<&str> {
        self.unmanaged_frontmatter.as_deref()
    }

    pub(crate) fn body(&self) -> &str {
        &self.body
    }
}

pub(crate) struct NoteMutation {
    source: MutationSource,
    history_intent: PreparedHistoryIntent,
    path: PathBuf,
    previous_path: Option<PathBuf>,
    fallback_markdown: String,
}

impl NoteMutation {
    pub(crate) fn editor(
        history_intent: PreparedHistoryIntent,
        path: PathBuf,
        previous_path: Option<PathBuf>,
        fallback_markdown: String,
    ) -> Self {
        Self::with_source(
            MutationSource::Editor,
            history_intent,
            path,
            previous_path,
            fallback_markdown,
        )
    }

    pub(crate) fn task_action(
        history_intent: PreparedHistoryIntent,
        path: PathBuf,
        previous_path: Option<PathBuf>,
        fallback_markdown: String,
    ) -> Self {
        Self::with_source(
            MutationSource::TaskAction,
            history_intent,
            path,
            previous_path,
            fallback_markdown,
        )
    }

    pub(crate) fn accepted_chat_proposal(
        history_intent: PreparedHistoryIntent,
        path: PathBuf,
        previous_path: Option<PathBuf>,
        fallback_markdown: String,
    ) -> Self {
        Self::with_source(
            MutationSource::AcceptedChatProposal,
            history_intent,
            path,
            previous_path,
            fallback_markdown,
        )
    }

    pub(crate) fn version_restore(
        history_intent: PreparedHistoryIntent,
        path: PathBuf,
        previous_path: Option<PathBuf>,
        fallback_markdown: String,
    ) -> Self {
        Self::with_source(
            MutationSource::VersionRestore,
            history_intent,
            path,
            previous_path,
            fallback_markdown,
        )
    }

    pub(crate) fn note_creation(
        history_intent: PreparedHistoryIntent,
        path: PathBuf,
        previous_path: Option<PathBuf>,
        fallback_markdown: String,
    ) -> Self {
        Self::with_source(
            MutationSource::NoteCreation,
            history_intent,
            path,
            previous_path,
            fallback_markdown,
        )
    }

    pub(crate) fn baseline_initialization(
        history_intent: PreparedHistoryIntent,
        path: PathBuf,
        previous_path: Option<PathBuf>,
        fallback_markdown: String,
    ) -> Self {
        Self::with_source(
            MutationSource::BaselineInitialization,
            history_intent,
            path,
            previous_path,
            fallback_markdown,
        )
    }

    pub(crate) fn recovery_reconciliation(
        history_intent: PreparedHistoryIntent,
        path: PathBuf,
        previous_path: Option<PathBuf>,
        fallback_markdown: String,
    ) -> Self {
        Self::with_source(
            MutationSource::RecoveryReconciliation,
            history_intent,
            path,
            previous_path,
            fallback_markdown,
        )
    }

    fn with_source(
        source: MutationSource,
        history_intent: PreparedHistoryIntent,
        path: PathBuf,
        previous_path: Option<PathBuf>,
        fallback_markdown: String,
    ) -> Self {
        Self {
            source,
            history_intent,
            path,
            previous_path,
            fallback_markdown,
        }
    }

    pub(crate) fn source(&self) -> MutationSource {
        self.source
    }

    pub(crate) fn path(&self) -> &Path {
        &self.path
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct VaultObservation {
    source: VaultObservationSource,
    kind: VaultObservationKind,
    path: PathBuf,
    previous_path: Option<PathBuf>,
    observed_at_millis: u64,
    modified_at_millis: Option<u64>,
    canonical_markdown: Option<String>,
    missing_retention_days: Option<u32>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum VaultObservationKind {
    CanonicalState,
    ReconciliationScan,
    Lifecycle(LifecycleEventKind),
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum VaultObservationSource {
    Watcher,
    Reconciliation,
}

impl VaultObservation {
    pub(crate) fn external_edit(
        path: PathBuf,
        observed_at_millis: u64,
        modified_at_millis: Option<u64>,
    ) -> Self {
        Self::canonical_state(
            VaultObservationSource::Watcher,
            path,
            observed_at_millis,
            modified_at_millis,
        )
    }

    pub(crate) fn reconciled_state(
        path: PathBuf,
        observed_at_millis: u64,
        modified_at_millis: Option<u64>,
    ) -> Self {
        Self::canonical_state(
            VaultObservationSource::Reconciliation,
            path,
            observed_at_millis,
            modified_at_millis,
        )
    }

    pub(crate) fn reconciliation_scan(vault_root: PathBuf, observed_at_millis: u64) -> Self {
        Self {
            source: VaultObservationSource::Reconciliation,
            kind: VaultObservationKind::ReconciliationScan,
            path: vault_root,
            previous_path: None,
            observed_at_millis,
            modified_at_millis: None,
            canonical_markdown: None,
            missing_retention_days: None,
        }
    }

    fn canonical_state(
        source: VaultObservationSource,
        path: PathBuf,
        observed_at_millis: u64,
        modified_at_millis: Option<u64>,
    ) -> Self {
        Self {
            source,
            kind: VaultObservationKind::CanonicalState,
            path,
            previous_path: None,
            observed_at_millis,
            modified_at_millis,
            canonical_markdown: None,
            missing_retention_days: None,
        }
    }

    pub(crate) fn with_canonical_markdown(mut self, markdown: String) -> Self {
        self.canonical_markdown = Some(markdown);
        self
    }

    pub(crate) fn renamed(
        previous_path: impl Into<PathBuf>,
        path: impl Into<PathBuf>,
        observed_at_millis: u64,
    ) -> Self {
        Self::lifecycle(
            VaultObservationSource::Watcher,
            LifecycleEventKind::Renamed,
            path.into(),
            Some(previous_path.into()),
            observed_at_millis,
        )
    }

    pub(crate) fn moved(
        previous_path: impl Into<PathBuf>,
        path: impl Into<PathBuf>,
        observed_at_millis: u64,
    ) -> Self {
        Self::lifecycle(
            VaultObservationSource::Watcher,
            LifecycleEventKind::Moved,
            path.into(),
            Some(previous_path.into()),
            observed_at_millis,
        )
    }

    pub(crate) fn missing(path: impl Into<PathBuf>, observed_at_millis: u64) -> Self {
        Self::lifecycle(
            VaultObservationSource::Watcher,
            LifecycleEventKind::Missing,
            path.into(),
            None,
            observed_at_millis,
        )
    }

    pub(crate) fn reconciled_missing(path: impl Into<PathBuf>, observed_at_millis: u64) -> Self {
        Self::lifecycle(
            VaultObservationSource::Reconciliation,
            LifecycleEventKind::Missing,
            path.into(),
            None,
            observed_at_millis,
        )
    }

    fn lifecycle(
        source: VaultObservationSource,
        kind: LifecycleEventKind,
        path: PathBuf,
        previous_path: Option<PathBuf>,
        observed_at_millis: u64,
    ) -> Self {
        Self {
            source,
            kind: VaultObservationKind::Lifecycle(kind),
            path,
            previous_path,
            observed_at_millis,
            modified_at_millis: None,
            canonical_markdown: None,
            missing_retention_days: None,
        }
    }

    pub(crate) fn source(&self) -> VaultObservationSource {
        self.source
    }

    pub(crate) fn kind(&self) -> VaultObservationKind {
        self.kind
    }

    pub(crate) fn path(&self) -> &Path {
        &self.path
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct NoteLifecycleOperation {
    kind: LifecycleEventKind,
    note_id: NoteIdentity,
    path: PathBuf,
    previous_path: Option<PathBuf>,
    occurred_at_millis: u64,
}

impl NoteLifecycleOperation {
    pub(crate) fn forgotten(
        note_id: NoteIdentity,
        previous_path: PathBuf,
        path: PathBuf,
        occurred_at_millis: u64,
    ) -> Self {
        Self::new(
            LifecycleEventKind::Forgotten,
            note_id,
            path,
            Some(previous_path),
            occurred_at_millis,
        )
    }

    pub(crate) fn recovered(
        note_id: NoteIdentity,
        previous_path: PathBuf,
        path: PathBuf,
        occurred_at_millis: u64,
    ) -> Self {
        Self::new(
            LifecycleEventKind::Recovered,
            note_id,
            path,
            Some(previous_path),
            occurred_at_millis,
        )
    }

    pub(crate) fn purged(note_id: NoteIdentity, path: PathBuf, occurred_at_millis: u64) -> Self {
        Self::new(
            LifecycleEventKind::Purged,
            note_id,
            path,
            None,
            occurred_at_millis,
        )
    }

    fn new(
        kind: LifecycleEventKind,
        note_id: NoteIdentity,
        path: PathBuf,
        previous_path: Option<PathBuf>,
        occurred_at_millis: u64,
    ) -> Self {
        Self {
            kind,
            note_id,
            path,
            previous_path,
            occurred_at_millis,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct LifecycleReceipt {
    kind: LifecycleEventKind,
    note_id: NoteIdentity,
    path: PathBuf,
    previous_path: Option<PathBuf>,
    occurred_at_millis: u64,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct MissingNoteRecord {
    note_id: NoteIdentity,
    path: PathBuf,
    title: String,
    missing_at_millis: u64,
    retention_days: u32,
    purge_at_millis: u64,
}

impl MissingNoteRecord {
    fn captured(
        note_id: NoteIdentity,
        path: PathBuf,
        missing_at_millis: u64,
        retention_days: u32,
    ) -> Self {
        let title = path
            .file_stem()
            .unwrap_or_default()
            .to_string_lossy()
            .into_owned();
        Self {
            note_id,
            path,
            title,
            missing_at_millis,
            retention_days,
            purge_at_millis: missing_at_millis
                .saturating_add(u64::from(retention_days).saturating_mul(RECOVERY_DAY_MILLIS)),
        }
    }

    pub(crate) fn note_id(&self) -> &NoteIdentity {
        &self.note_id
    }

    pub(crate) fn path(&self) -> &Path {
        &self.path
    }

    pub(crate) fn title(&self) -> &str {
        &self.title
    }

    pub(crate) fn missing_at_millis(&self) -> u64 {
        self.missing_at_millis
    }

    pub(crate) fn retention_days(&self) -> u32 {
        self.retention_days
    }

    pub(crate) fn purge_at_millis(&self) -> u64 {
        self.purge_at_millis
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct LifecyclePublicationResult {
    receipt: LifecycleReceipt,
    commit_warning: Option<NoteMutationWarning>,
}

pub(crate) enum LifecyclePublicationFailure {
    NotPublished(String),
    Indeterminate(String),
}

impl LifecyclePublicationFailure {
    pub(crate) fn not_published(message: String) -> Self {
        Self::NotPublished(message)
    }

    pub(crate) fn indeterminate(message: String) -> Self {
        Self::Indeterminate(message)
    }
}

impl LifecyclePublicationResult {
    pub(crate) fn receipt(&self) -> &LifecycleReceipt {
        &self.receipt
    }

    pub(crate) fn commit_warning(&self) -> Option<&NoteMutationWarning> {
        self.commit_warning.as_ref()
    }
}

impl LifecycleReceipt {
    pub(crate) fn kind(&self) -> LifecycleEventKind {
        self.kind
    }

    pub(crate) fn note_id(&self) -> &NoteIdentity {
        &self.note_id
    }

    pub(crate) fn path(&self) -> &Path {
        &self.path
    }

    pub(crate) fn previous_path(&self) -> Option<&Path> {
        self.previous_path.as_deref()
    }

    pub(crate) fn occurred_at_millis(&self) -> u64 {
        self.occurred_at_millis
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct AllowedScope {
    note_ids: Option<HashSet<NoteIdentity>>,
    excluded_note_ids: HashSet<NoteIdentity>,
}

impl AllowedScope {
    pub(crate) fn vault() -> Self {
        Self {
            note_ids: None,
            excluded_note_ids: HashSet::new(),
        }
    }

    pub(crate) fn policy(
        allowed_note_ids: Option<&HashSet<String>>,
        excluded_note_ids: &HashSet<String>,
    ) -> Self {
        Self {
            note_ids: allowed_note_ids
                .map(|note_ids| note_ids.iter().cloned().map(NoteIdentity::new).collect()),
            excluded_note_ids: excluded_note_ids
                .iter()
                .cloned()
                .map(NoteIdentity::new)
                .collect(),
        }
    }

    pub(crate) fn only(note_id: NoteIdentity) -> Self {
        Self {
            note_ids: Some(HashSet::from([note_id])),
            excluded_note_ids: HashSet::new(),
        }
    }

    fn allows(&self, note_id: &NoteIdentity) -> bool {
        !self.excluded_note_ids.contains(note_id)
            && self
                .note_ids
                .as_ref()
                .is_none_or(|note_ids| note_ids.contains(note_id))
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct ExplicitRestoreGrant {
    turn_id: TurnIdentity,
    note_id: NoteIdentity,
    revision_id: RevisionIdentity,
}

impl ExplicitRestoreGrant {
    fn new(turn_id: TurnIdentity, note_id: NoteIdentity, revision_id: RevisionIdentity) -> Self {
        Self {
            turn_id,
            note_id,
            revision_id,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct HistoryModeGrant {
    note_id: NoteIdentity,
}

impl HistoryModeGrant {
    fn authorized(note_id: NoteIdentity) -> Self {
        Self { note_id }
    }
}

pub(crate) struct HistoryModeAccess<'a> {
    state: &'a AppState,
    note_id: NoteIdentity,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct HistoryRestorePreview {
    revision_id: String,
    current_authored_content_hash: String,
    unmanaged_frontmatter: Option<String>,
    body: String,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct HistoryRestoreResult {
    revision_id: RevisionIdentity,
    mutation: NoteMutationResult,
}

impl HistoryRestoreResult {
    pub(crate) fn revision_id(&self) -> &RevisionIdentity {
        &self.revision_id
    }

    pub(crate) fn mutation(&self) -> &NoteMutationResult {
        &self.mutation
    }
}

impl HistoryRestorePreview {
    pub(crate) fn revision_id(&self) -> &str {
        &self.revision_id
    }

    pub(crate) fn current_authored_content_hash(&self) -> &str {
        &self.current_authored_content_hash
    }

    pub(crate) fn unmanaged_frontmatter(&self) -> Option<&str> {
        self.unmanaged_frontmatter.as_deref()
    }

    pub(crate) fn body(&self) -> &str {
        &self.body
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum HistoryModeRevisionTimeKind {
    KnownSince,
    Committed,
    Observed,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub(crate) enum HistoryModeRecord {
    Revision {
        record_id: String,
        revision_id: String,
        source: MutationSource,
        occurred_at_millis: u64,
        timeline_ordinal: usize,
        time_kind: HistoryModeRevisionTimeKind,
        modified_at_millis: Option<u64>,
        editing_session_id: Option<String>,
        revision_label: Option<String>,
        line_count: usize,
        character_count: usize,
    },
    LifecycleEvent {
        record_id: String,
        event_id: String,
        event_kind: LifecycleEventKind,
        occurred_at_millis: u64,
        timeline_ordinal: usize,
        previous_path: Option<String>,
        path: Option<String>,
    },
}

impl HistoryModeRecord {
    pub(crate) fn record_id(&self) -> &str {
        match self {
            Self::Revision { record_id, .. } | Self::LifecycleEvent { record_id, .. } => record_id,
        }
    }

    pub(crate) fn revision_id(&self) -> Option<&str> {
        match self {
            Self::Revision { revision_id, .. } => Some(revision_id),
            Self::LifecycleEvent { .. } => None,
        }
    }

    pub(crate) fn revision_label(&self) -> Option<&str> {
        match self {
            Self::Revision { revision_label, .. } => revision_label.as_deref(),
            Self::LifecycleEvent { .. } => None,
        }
    }

    fn occurred_at_millis(&self) -> u64 {
        match self {
            Self::Revision {
                occurred_at_millis, ..
            }
            | Self::LifecycleEvent {
                occurred_at_millis, ..
            } => *occurred_at_millis,
        }
    }

    fn set_timeline_ordinal(&mut self, timeline_ordinal: usize) {
        match self {
            Self::Revision {
                timeline_ordinal: ordinal,
                ..
            }
            | Self::LifecycleEvent {
                timeline_ordinal: ordinal,
                ..
            } => *ordinal = timeline_ordinal,
        }
    }
}

const EDITING_SESSION_IDLE_MILLIS: u64 = 5 * 60 * 1_000;

fn assign_editing_sessions(records: &mut [HistoryModeRecord]) {
    let mut current_session: Option<(MutationSource, u64, String)> = None;

    for record in records.iter_mut().rev() {
        match record {
            HistoryModeRecord::LifecycleEvent { .. } => current_session = None,
            HistoryModeRecord::Revision {
                revision_id,
                source,
                occurred_at_millis,
                editing_session_id,
                ..
            } => {
                if *source == MutationSource::VersionRestore {
                    *editing_session_id = None;
                    current_session = None;
                    continue;
                }

                let session_id = current_session
                    .as_ref()
                    .filter(|(session_source, previous_millis, _)| {
                        session_source == source
                            && occurred_at_millis.saturating_sub(*previous_millis)
                                < EDITING_SESSION_IDLE_MILLIS
                    })
                    .map(|(_, _, session_id)| session_id.clone())
                    .unwrap_or_else(|| revision_id.clone());
                *editing_session_id = Some(session_id.clone());
                current_session = Some((*source, *occurred_at_millis, session_id));
            }
        }
    }
}

fn record_identity_value(identity: &TimelineRecordIdentity) -> String {
    match identity {
        TimelineRecordIdentity::Revision(identity) => identity.0.clone(),
        TimelineRecordIdentity::LifecycleEvent(identity) => identity.0.clone(),
    }
}

fn order_history_mode_records(
    records: Vec<(HistoryModeRecord, Option<String>)>,
) -> Result<Vec<HistoryModeRecord>, String> {
    let record_count = records.len();
    let mut by_predecessor = HashMap::with_capacity(record_count);
    for (record, predecessor_id) in records {
        if by_predecessor.insert(predecessor_id, record).is_some() {
            return Err("Note Timeline record lineage is branched".to_string());
        }
    }

    let mut ordered = Vec::with_capacity(record_count);
    let mut predecessor_id = None;
    while let Some(mut record) = by_predecessor.remove(&predecessor_id) {
        record.set_timeline_ordinal(ordered.len());
        predecessor_id = Some(record.record_id().to_string());
        ordered.push(record);
    }
    if !by_predecessor.is_empty() {
        return Err("Note Timeline record lineage is missing or disconnected".to_string());
    }

    ordered.reverse();
    assign_editing_sessions(&mut ordered);
    Ok(ordered)
}

fn authored_content_counts(revision: &ReconstructedNoteRevision) -> (usize, usize) {
    let frontmatter = revision
        .unmanaged_frontmatter
        .as_deref()
        .unwrap_or_default();
    (
        frontmatter.lines().count() + revision.body.lines().count(),
        frontmatter.chars().count() + revision.body.chars().count(),
    )
}

fn project_revision_header(
    revision: NoteRevisionHeader,
    revision_label: Option<String>,
    timeline_ordinal: usize,
    counts: (usize, usize),
) -> HistoryModeRecord {
    let revision_id = revision.identity.0;
    let (occurred_at_millis, time_kind, modified_at_millis) = match revision.time_evidence {
        RevisionTimeEvidence::Baseline { known_since_millis } => (
            known_since_millis,
            HistoryModeRevisionTimeKind::KnownSince,
            None,
        ),
        RevisionTimeEvidence::Committed {
            committed_at_millis,
        } => (
            committed_at_millis,
            HistoryModeRevisionTimeKind::Committed,
            None,
        ),
        RevisionTimeEvidence::Observed {
            observed_at_millis,
            modified_at_millis,
        } => (
            observed_at_millis,
            HistoryModeRevisionTimeKind::Observed,
            modified_at_millis,
        ),
    };
    HistoryModeRecord::Revision {
        record_id: revision_id.clone(),
        revision_id,
        source: revision.source,
        occurred_at_millis,
        timeline_ordinal,
        time_kind,
        modified_at_millis,
        editing_session_id: None,
        revision_label,
        line_count: counts.0,
        character_count: counts.1,
    }
}

fn project_lifecycle_header(
    event: LifecycleEventHeader,
    timeline_ordinal: usize,
) -> HistoryModeRecord {
    let event_id = event.identity.0;
    HistoryModeRecord::LifecycleEvent {
        record_id: event_id.clone(),
        event_id,
        event_kind: event.kind,
        occurred_at_millis: event.occurred_at_millis,
        timeline_ordinal,
        previous_path: event
            .previous_path
            .map(|path| path.to_string_lossy().into_owned()),
        path: event.path.map(|path| path.to_string_lossy().into_owned()),
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct HistoryModePage {
    records: Vec<HistoryModeRecord>,
    next_cursor: Option<String>,
}

const MISSING_HISTORY_CURSOR_VERSION: u8 = 1;
pub(crate) const MISSING_HISTORY_CURSOR_ERROR: &str =
    "Missing Note history continuation is stale or belongs to another Note Timeline";

/// Opaque continuation bound to one vault generation and Note Timeline. It
/// names the next predecessor directly, so it remains valid across restart.
#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct MissingHistoryCursor {
    version: u8,
    vault_id: String,
    history_generation: u64,
    note_id: String,
    next_record_kind: MissingHistoryCursorRecordKind,
    next_record_id: String,
    next_timeline_ordinal: usize,
}

#[derive(Clone, Copy, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
enum MissingHistoryCursorRecordKind {
    Revision,
    LifecycleEvent,
}

impl MissingHistoryCursor {
    fn decode(encoded: &str) -> Result<Self, String> {
        let bytes = BASE64_URL_SAFE
            .decode(encoded)
            .map_err(|_| MISSING_HISTORY_CURSOR_ERROR.to_string())?;
        serde_json::from_slice(&bytes).map_err(|_| MISSING_HISTORY_CURSOR_ERROR.to_string())
    }

    fn encode(&self) -> Result<String, String> {
        serde_json::to_vec(self)
            .map(|bytes| BASE64_URL_SAFE.encode(bytes))
            .map_err(|error| format!("Encode Missing Note history continuation: {error}"))
    }

    fn record_identity(&self) -> TimelineRecordIdentity {
        match self.next_record_kind {
            MissingHistoryCursorRecordKind::Revision => TimelineRecordIdentity::Revision(
                RevisionIdentity::from_persisted(self.next_record_id.clone()),
            ),
            MissingHistoryCursorRecordKind::LifecycleEvent => {
                TimelineRecordIdentity::LifecycleEvent(LifecycleEventIdentity::from_persisted(
                    self.next_record_id.clone(),
                ))
            }
        }
    }

    fn for_record(
        note_id: &NoteIdentity,
        vault_id: &str,
        history_generation: u64,
        record: &TimelineRecordIdentity,
        next_timeline_ordinal: usize,
    ) -> Self {
        let (next_record_kind, next_record_id) = match record {
            TimelineRecordIdentity::Revision(identity) => {
                (MissingHistoryCursorRecordKind::Revision, identity.0.clone())
            }
            TimelineRecordIdentity::LifecycleEvent(identity) => (
                MissingHistoryCursorRecordKind::LifecycleEvent,
                identity.0.clone(),
            ),
        };
        Self {
            version: MISSING_HISTORY_CURSOR_VERSION,
            vault_id: vault_id.to_string(),
            history_generation,
            note_id: note_id.as_str().to_string(),
            next_record_kind,
            next_record_id,
            next_timeline_ordinal,
        }
    }
}

impl HistoryModePage {
    pub(crate) fn records(&self) -> &[HistoryModeRecord] {
        &self.records
    }

    pub(crate) fn next_cursor(&self) -> Option<&str> {
        self.next_cursor.as_deref()
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct HistoryModeRevision {
    revision_id: String,
    unmanaged_frontmatter: Option<String>,
    body: String,
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum HistoryDiffComparison {
    Parent,
    Current,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum HistoryDiffLineKind {
    Context,
    Added,
    Removed,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct HistoryDiffLine {
    kind: HistoryDiffLineKind,
    text: String,
    old_line_number: Option<usize>,
    new_line_number: Option<usize>,
}

impl HistoryDiffLine {
    fn kind(&self) -> HistoryDiffLineKind {
        self.kind
    }

    fn text(&self) -> &str {
        &self.text
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct HistoryModeDiff {
    revision_id: String,
    comparison: HistoryDiffComparison,
    from_revision_id: Option<String>,
    to_revision_id: String,
    body_lines: Vec<HistoryDiffLine>,
    properties_lines: Vec<HistoryDiffLine>,
    missing_assets: Vec<String>,
}

impl HistoryModeDiff {
    fn comparison(&self) -> HistoryDiffComparison {
        self.comparison
    }

    fn from_revision_id(&self) -> Option<&str> {
        self.from_revision_id.as_deref()
    }

    fn to_revision_id(&self) -> &str {
        &self.to_revision_id
    }

    fn body_lines(&self) -> &[HistoryDiffLine] {
        &self.body_lines
    }

    fn properties_lines(&self) -> &[HistoryDiffLine] {
        &self.properties_lines
    }

    fn missing_assets(&self) -> &[String] {
        &self.missing_assets
    }
}

fn diff_lines(old: &str, new: &str) -> Vec<HistoryDiffLine> {
    let old_lines = old.split_inclusive('\n').collect::<Vec<_>>();
    let new_lines = new.split_inclusive('\n').collect::<Vec<_>>();
    let mut lines = Vec::new();
    for operation in capture_diff_slices(Algorithm::Myers, &old_lines, &new_lines) {
        match operation {
            DiffOp::Equal {
                old_index,
                new_index,
                len,
            } => {
                for offset in 0..len {
                    lines.push(HistoryDiffLine {
                        kind: HistoryDiffLineKind::Context,
                        text: old_lines[old_index + offset].to_string(),
                        old_line_number: Some(old_index + offset + 1),
                        new_line_number: Some(new_index + offset + 1),
                    });
                }
            }
            DiffOp::Delete {
                old_index, old_len, ..
            } => append_removed_lines(&mut lines, &old_lines, old_index, old_len),
            DiffOp::Insert {
                new_index, new_len, ..
            } => append_added_lines(&mut lines, &new_lines, new_index, new_len),
            DiffOp::Replace {
                old_index,
                old_len,
                new_index,
                new_len,
            } => {
                append_removed_lines(&mut lines, &old_lines, old_index, old_len);
                append_added_lines(&mut lines, &new_lines, new_index, new_len);
            }
        }
    }
    lines
}

fn append_removed_lines(
    lines: &mut Vec<HistoryDiffLine>,
    source: &[&str],
    start: usize,
    len: usize,
) {
    lines.extend((0..len).map(|offset| HistoryDiffLine {
        kind: HistoryDiffLineKind::Removed,
        text: source[start + offset].to_string(),
        old_line_number: Some(start + offset + 1),
        new_line_number: None,
    }));
}

fn append_added_lines(lines: &mut Vec<HistoryDiffLine>, source: &[&str], start: usize, len: usize) {
    lines.extend((0..len).map(|offset| HistoryDiffLine {
        kind: HistoryDiffLineKind::Added,
        text: source[start + offset].to_string(),
        old_line_number: None,
        new_line_number: Some(start + offset + 1),
    }));
}

fn strip_inline_code(line: &str) -> String {
    let mut visible = String::with_capacity(line.len());
    let mut delimiter_width = 0;
    let mut chars = line.chars().peekable();
    while let Some(character) = chars.next() {
        if character == '`' {
            let mut width = 1;
            while chars.peek() == Some(&'`') {
                chars.next();
                width += 1;
            }
            if delimiter_width == 0 {
                delimiter_width = width;
            } else if delimiter_width == width {
                delimiter_width = 0;
            }
        } else if delimiter_width == 0 {
            visible.push(character);
        }
    }
    visible
}

fn binary_asset_name(target: &str) -> Option<String> {
    let target = target
        .trim()
        .trim_matches(['<', '>'])
        .split(['|', '#', '?'])
        .next()
        .unwrap_or_default()
        .trim()
        .replace("\\(", "(")
        .replace("\\)", ")");
    if target.is_empty() || target.contains(':') {
        return None;
    }
    let mut components = Path::new(&target)
        .components()
        .map(|component| match component {
            std::path::Component::Normal(component) => component.to_str(),
            _ => None,
        })
        .collect::<Option<Vec<_>>>()?;
    if components.first() == Some(&"assets") {
        components.remove(0);
    }
    if components.is_empty() {
        return None;
    }
    let extension = Path::new(components.last()?)
        .extension()
        .and_then(|extension| extension.to_str())?
        .to_ascii_lowercase();
    if matches!(extension.as_str(), "md" | "markdown") {
        return None;
    }
    Some(components.join("/"))
}

fn balanced_markdown_destination(target: &str) -> Option<(&str, usize)> {
    let mut depth = 1;
    let mut escaped = false;
    for (index, character) in target.char_indices() {
        if escaped {
            escaped = false;
            continue;
        }
        match character {
            '\\' => escaped = true,
            '(' => depth += 1,
            ')' => {
                depth -= 1;
                if depth == 0 {
                    return Some((&target[..index], index + character.len_utf8()));
                }
            }
            _ => {}
        }
    }
    None
}

fn referenced_binary_assets(markdown: &str) -> Vec<String> {
    let mut assets = HashSet::new();
    let mut in_fence = false;
    for line in markdown.lines() {
        let trimmed = line.trim_start();
        if trimmed.starts_with("```") || trimmed.starts_with("~~~") {
            in_fence = !in_fence;
            continue;
        }
        if in_fence {
            continue;
        }
        let visible = strip_inline_code(line);
        let mut remainder = visible.as_str();
        while let Some(start) = remainder.find("[[") {
            let target = &remainder[start + 2..];
            let Some(end) = target.find("]]") else {
                break;
            };
            if let Some(file_name) = binary_asset_name(&target[..end]) {
                assets.insert(file_name);
            }
            remainder = &target[end + 2..];
        }
        let mut remainder = visible.as_str();
        while let Some(start) = remainder.find("](") {
            let target = &remainder[start + 2..];
            let Some((destination, consumed)) = balanced_markdown_destination(target) else {
                break;
            };
            let destination = destination.trim();
            let destination = if let Some(stripped) = destination.strip_prefix('<') {
                stripped.split('>').next().unwrap_or_default()
            } else {
                destination
                    .split_ascii_whitespace()
                    .next()
                    .unwrap_or_default()
            };
            if let Some(file_name) = binary_asset_name(destination) {
                assets.insert(file_name);
            }
            remainder = &target[consumed..];
        }
    }
    let mut assets = assets.into_iter().collect::<Vec<_>>();
    assets.sort();
    assets
}

fn missing_binary_assets(markdown: &str) -> Result<Vec<String>, String> {
    let assets_dir = crate::state::notes_root()?.join("assets");
    Ok(referenced_binary_assets(markdown)
        .into_iter()
        .filter(|file_name| !assets_dir.join(file_name).is_file())
        .collect())
}

impl HistoryModeRevision {
    pub(crate) fn unmanaged_frontmatter(&self) -> Option<&str> {
        self.unmanaged_frontmatter.as_deref()
    }

    pub(crate) fn body(&self) -> &str {
        &self.body
    }
}

fn require_recovered_note(note_id: &NoteIdentity) -> Result<(), String> {
    if history_store::missing_note(note_id)?.is_some() {
        return Err("Recover the missing note before accessing its Note Timeline".to_string());
    }
    let Some(path) = history_store::current_path(note_id)? else {
        return Ok(());
    };
    let notes_root = crate::state::notes_root()?;
    if crate::state::is_forgotten_note_path(&path, &notes_root) {
        return Err("Recover the forgotten note before accessing its Note Timeline".to_string());
    }
    Ok(())
}

fn canonical_markdown_for_recovered_note(
    note_id: &NoteIdentity,
    retained: &ReconstructedNoteRevision,
) -> Result<String, String> {
    let (template, _) = crate::note::prepare_note_markdown("", None, Some(None))?;
    let template = crate::note::repair_managed_note_identity(&template, note_id.as_str())?;
    crate::note::replace_authored_content(
        &template,
        retained.unmanaged_frontmatter(),
        retained.body(),
    )
}

fn prepare_recovered_note_access(
    state: &AppState,
    note_id: &NoteIdentity,
) -> Result<OperationGuard, String> {
    let timeline = state.note_timeline();
    let operation = timeline.runtime.begin_operation()?;
    timeline.runtime.with_observation_replay(|| {
        timeline.recover_pending_deletions()?;
        timeline.replay_retained_observations(None)?;
        timeline.ensure_history_recovered(RecoveryIntegrity::Exhaustive)?;
        require_recovered_note(note_id)
    })?;
    Ok(operation)
}

impl HistoryModeAccess<'_> {
    pub(crate) fn note_id(&self) -> &NoteIdentity {
        &self.note_id
    }

    fn prepare_access(&self) -> Result<OperationGuard, String> {
        prepare_recovered_note_access(self.state, &self.note_id)
    }

    pub(crate) fn revisions(&self) -> Result<Vec<NoteRevisionHeader>, String> {
        let _operation = self.prepare_access()?;
        history_store::revisions(&self.note_id)
    }

    pub(crate) fn lifecycle_events(&self) -> Result<Vec<LifecycleEventHeader>, String> {
        let _operation = self.prepare_access()?;
        history_store::lifecycle_events(&self.note_id)
    }

    pub(crate) fn reconstruct(
        &self,
        revision_id: &RevisionIdentity,
    ) -> Result<ReconstructedNoteRevision, String> {
        let _operation = self.prepare_access()?;
        history_store::reconstruct(&self.note_id, revision_id)
    }

    pub(crate) fn page(
        &self,
        cursor: Option<&str>,
        limit: usize,
    ) -> Result<HistoryModePage, String> {
        let _operation = self.prepare_access()?;
        self.page_retained(cursor, limit)
    }

    fn page_retained(&self, cursor: Option<&str>, limit: usize) -> Result<HistoryModePage, String> {
        let revisions = history_store::revisions(&self.note_id)?;
        let revision_labels = history_store::revision_labels(&self.note_id)?;
        let lifecycle_events = history_store::lifecycle_events(&self.note_id)?;
        let mut projected_records = Vec::with_capacity(revisions.len() + lifecycle_events.len());
        for revision in revisions {
            let revision_id = revision.identity.0.clone();
            let predecessor_id = revision.predecessor.as_ref().map(record_identity_value);
            projected_records.push((
                project_revision_header(
                    revision,
                    revision_labels.get(&revision_id).cloned(),
                    0,
                    (0, 0),
                ),
                predecessor_id,
            ));
        }
        projected_records.extend(lifecycle_events.into_iter().map(|event| {
            let predecessor_id = event.predecessor.as_ref().map(record_identity_value);
            (project_lifecycle_header(event, 0), predecessor_id)
        }));
        let records = order_history_mode_records(projected_records)?;

        let start = match cursor {
            Some(cursor) => records
                .iter()
                .position(|record| record.record_id() == cursor)
                .map(|index| index + 1)
                .ok_or_else(|| "History page cursor is no longer available".to_string())?,
            None => 0,
        };
        let end = start.saturating_add(limit.clamp(1, 100)).min(records.len());
        let mut page_records = records[start..end].to_vec();
        for record in &mut page_records {
            if let HistoryModeRecord::Revision {
                revision_id,
                line_count,
                character_count,
                ..
            } = record
            {
                let reconstructed = history_store::reconstruct(
                    &self.note_id,
                    &RevisionIdentity::from_persisted(revision_id.as_str()),
                )?;
                (*line_count, *character_count) = authored_content_counts(&reconstructed);
            }
        }
        let next_cursor = (end < records.len())
            .then(|| {
                page_records
                    .last()
                    .map(|record| record.record_id().to_string())
            })
            .flatten();
        Ok(HistoryModePage {
            records: page_records,
            next_cursor,
        })
    }

    pub(crate) fn revision(&self, revision_id: &str) -> Result<HistoryModeRevision, String> {
        let reconstructed = self.reconstruct(&RevisionIdentity::from_persisted(revision_id))?;
        Ok(HistoryModeRevision {
            revision_id: revision_id.to_string(),
            unmanaged_frontmatter: reconstructed.unmanaged_frontmatter,
            body: reconstructed.body,
        })
    }

    fn current_restore_state(&self) -> Result<(PathBuf, String, String), String> {
        let path = history_store::current_path(&self.note_id)?
            .ok_or_else(|| "This Note Timeline has no current path to restore".to_string())?;
        let canonical = fs::read_to_string(&path)
            .map_err(|error| format!("Read current note before Version Restore: {error}"))?;
        let current_note_id = crate::note::parse_note(&canonical)
            .frontmatter
            .managed
            .map(|metadata| metadata.id)
            .filter(|identity| !identity.trim().is_empty())
            .ok_or_else(|| "Current note has no managed Note Identity".to_string())?;
        if current_note_id != self.note_id.as_str() {
            return Err("Current note identity no longer matches this Note Timeline".to_string());
        }
        let hash = history_store::authored_content_hash(&canonical);
        let retained_hash = history_store::current_content_hash(&self.note_id)?
            .ok_or_else(|| "This Note Timeline has no current authored state".to_string())?;
        if hash != retained_hash {
            return Err(
                "Current authored content has not been captured by the Note Timeline; retry after synchronization"
                    .to_string(),
            );
        }
        Ok((path, canonical, hash))
    }

    pub(crate) fn restore_preview(
        &self,
        revision_id: &str,
    ) -> Result<HistoryRestorePreview, String> {
        let _operation = self.prepare_access()?;
        let (_, _, current_authored_content_hash) = self.current_restore_state()?;
        let selected_id = RevisionIdentity::from_persisted(revision_id.trim());
        let selected = history_store::reconstruct(&self.note_id, &selected_id)?;
        Ok(HistoryRestorePreview {
            revision_id: selected_id.0,
            current_authored_content_hash,
            unmanaged_frontmatter: selected.unmanaged_frontmatter,
            body: selected.body,
        })
    }

    pub(crate) fn confirm_restore(
        &self,
        revision_id: &str,
        expected_current_authored_content_hash: &str,
    ) -> Result<HistoryRestoreResult, String> {
        if expected_current_authored_content_hash.trim().is_empty() {
            return Err("Version Restore confirmation requires its preview hash".to_string());
        }
        crate::state::with_note_file_mutation(|| {
            let _operation = self.prepare_access()?;
            let timeline = self.state.note_timeline();
            let (path, current, current_hash) = self.current_restore_state()?;
            if current_hash != expected_current_authored_content_hash {
                return Err(
                    "Current authored content changed after this restore preview was created"
                        .to_string(),
                );
            }
            let selected = history_store::reconstruct(
                &self.note_id,
                &RevisionIdentity::from_persisted(revision_id.trim()),
            )?;
            let selected_authored_hash = history_store::authored_parts_hash(
                selected.unmanaged_frontmatter(),
                selected.body(),
            );
            let replacement = crate::note::replace_authored_content(
                &current,
                selected.unmanaged_frontmatter(),
                selected.body(),
            )?;
            let replacement_hash = history_store::authored_content_hash(&replacement);
            if replacement_hash != selected_authored_hash {
                return Err(
                    "Version Restore could not preserve the selected authored content exactly"
                        .to_string(),
                );
            }
            if replacement_hash == current_hash {
                return Err(
                    "Selected revision already matches current authored content".to_string()
                );
            }
            let prepared = timeline.prepare_exact_revision_publication(
                MutationSource::VersionRestore,
                &path,
                Some(&path),
                Some(&self.note_id),
                &replacement,
            )?;
            if history_store::authored_content_hash(prepared.canonical_markdown())
                != selected_authored_hash
            {
                return Err(prepared.into_parts().1.abandon_after_publication_failure(
                    "Version Restore preparation changed the selected authored content".to_string(),
                ));
            }
            let still_current = fs::read_to_string(&path)
                .map_err(|error| format!("Recheck current note before Version Restore: {error}"))?;
            if history_store::authored_content_hash(&still_current)
                != expected_current_authored_content_hash
            {
                return Err(prepared.into_parts().1.abandon_after_publication_failure(
                    "Current authored content changed while Version Restore was being prepared"
                        .to_string(),
                ));
            }
            let (canonical_markdown, history_intent) = prepared.into_parts();
            let restored_revision_id =
                match history_store::publication_revision_identity(&history_intent) {
                    Ok(revision_id) => revision_id,
                    Err(error) => {
                        return Err(history_intent.abandon_after_publication_failure(error));
                    }
                };
            let expected_write =
                crate::vault_watcher::record_expected_write(&path, &canonical_markdown);
            if let Err(error) =
                crate::state::atomic_write_note(&path, canonical_markdown.as_bytes())
            {
                return Err(history_intent.abandon_after_publication_failure(error));
            }
            expected_write.commit();
            Ok(HistoryRestoreResult {
                revision_id: restored_revision_id,
                mutation: timeline.mutate(NoteMutation::version_restore(
                    history_intent,
                    path.clone(),
                    Some(path),
                    canonical_markdown,
                )),
            })
        })
    }

    pub(crate) fn name_revision(
        &self,
        revision_id: &RevisionIdentity,
        label: &str,
    ) -> Result<(), String> {
        let label = label.trim();
        if label.is_empty() {
            return Err("A Named Revision label cannot be empty".to_string());
        }
        self.mutate_revision_label(revision_id, |note_id, revision_id| {
            history_store::name_revision(note_id, revision_id, label)
        })
    }

    fn mutate_revision_label(
        &self,
        revision_id: &RevisionIdentity,
        mutation: impl FnOnce(&NoteIdentity, &RevisionIdentity) -> Result<(), String>,
    ) -> Result<(), String> {
        let _operation = self.prepare_access()?;
        mutation(&self.note_id, revision_id)
    }

    pub(crate) fn remove_revision_name(
        &self,
        revision_id: &RevisionIdentity,
    ) -> Result<(), String> {
        self.mutate_revision_label(revision_id, history_store::remove_revision_name)
    }

    pub(crate) fn diff(
        &self,
        revision_id: &str,
        comparison: HistoryDiffComparison,
    ) -> Result<HistoryModeDiff, String> {
        let _operation = self.prepare_access()?;
        let revision_id = RevisionIdentity::from_persisted(revision_id);
        let revisions = history_store::revisions(&self.note_id)?;
        let selected_index = revisions
            .iter()
            .position(|revision| revision.identity() == &revision_id)
            .ok_or_else(|| "Selected Note Revision is no longer available".to_string())?;
        let selected = history_store::reconstruct(&self.note_id, &revision_id)?;
        let (from_revision_id, to_revision_id, from, to) = match comparison {
            HistoryDiffComparison::Parent => {
                let parent = selected_index
                    .checked_sub(1)
                    .map(|index| {
                        let identity = revisions[index].identity();
                        history_store::reconstruct(&self.note_id, identity)
                            .map(|revision| (Some(identity.0.clone()), revision))
                    })
                    .transpose()?;
                let (from_revision_id, from) = parent.unwrap_or((
                    None,
                    ReconstructedNoteRevision {
                        unmanaged_frontmatter: None,
                        body: String::new(),
                    },
                ));
                (
                    from_revision_id,
                    revision_id.0.clone(),
                    from,
                    selected.clone(),
                )
            }
            HistoryDiffComparison::Current => {
                let current_id = revisions
                    .last()
                    .map(NoteRevisionHeader::identity)
                    .ok_or_else(|| "No current Note Revision is available".to_string())?;
                let current = history_store::reconstruct(&self.note_id, current_id)?;
                (
                    Some(revision_id.0.clone()),
                    current_id.0.clone(),
                    selected.clone(),
                    current,
                )
            }
        };
        let old_properties = from.unmanaged_frontmatter.as_deref().unwrap_or_default();
        let new_properties = to.unmanaged_frontmatter.as_deref().unwrap_or_default();
        Ok(HistoryModeDiff {
            revision_id: revision_id.0,
            comparison,
            from_revision_id,
            to_revision_id,
            body_lines: diff_lines(&from.body, &to.body),
            properties_lines: diff_lines(old_properties, new_properties),
            missing_assets: missing_binary_assets(&selected.body)?,
        })
    }
}

pub(crate) struct CurrentContentAccess<'a> {
    state: &'a AppState,
    runtime: &'a NoteTimelineRuntime,
    scope: AllowedScope,
}

pub(crate) trait CurrentContentProjection {
    fn retain_current(&mut self, eligibility: &CurrentContentEligibility<'_>);
    fn invalidate(&mut self);
}

pub(crate) trait CurrentContentItem {
    fn current_content_reference(&self) -> CurrentContentReference<'_>;
}

pub(crate) enum CurrentContentReference<'a> {
    OrdinaryNote {
        note_id: Option<&'a str>,
        note_path: Option<&'a str>,
    },
    NonNote,
}

impl<'a> CurrentContentReference<'a> {
    pub(crate) fn ordinary_note(note_id: Option<&'a str>, note_path: Option<&'a str>) -> Self {
        Self::OrdinaryNote { note_id, note_path }
    }

    pub(crate) fn non_note() -> Self {
        Self::NonNote
    }
}

impl<T: CurrentContentItem> CurrentContentProjection for Vec<T> {
    fn retain_current(&mut self, eligibility: &CurrentContentEligibility<'_>) {
        eligibility.retain_items(self);
    }

    fn invalidate(&mut self) {
        self.clear();
    }
}

pub(crate) struct CurrentContentEligibility<'a> {
    scope: &'a AllowedScope,
    active_notes: HashMap<String, PathBuf>,
    active_paths: HashMap<PathBuf, String>,
}

impl CurrentContentEligibility<'_> {
    fn allows_note(&self, note_id: Option<&str>, note_path: Option<&str>) -> bool {
        let path = note_path.map(PathBuf::from);
        let resolved_note_id = note_id.map(str::to_string).or_else(|| {
            path.as_ref()
                .and_then(|path| self.active_paths.get(path).cloned())
        });
        let Some(resolved_note_id) = resolved_note_id else {
            return false;
        };
        let identity = NoteIdentity::new(resolved_note_id.clone());
        if !self.scope.allows(&identity) {
            return false;
        }
        let Some(active_path) = self.active_notes.get(&resolved_note_id) else {
            return false;
        };
        path.as_ref().is_none_or(|path| path == active_path)
    }

    pub(crate) fn retains<T: CurrentContentItem>(&self, item: &T) -> bool {
        match item.current_content_reference() {
            CurrentContentReference::OrdinaryNote { note_id, note_path } => {
                self.allows_note(note_id, note_path)
            }
            CurrentContentReference::NonNote => true,
        }
    }

    pub(crate) fn retain_items<T: CurrentContentItem>(&self, items: &mut Vec<T>) {
        items.retain(|item| self.retains(item));
    }
}

impl CurrentContentAccess<'_> {
    fn prepare_read(&self) -> Result<(OperationGuard, CurrentContentVersion), String> {
        let operation = self.runtime.begin_operation()?;
        let timeline = NoteTimeline {
            state: self.state,
            runtime: self.runtime,
        };
        let version = self.runtime.with_observation_replay(|| {
            timeline.recover_pending_deletions()?;
            self.runtime.current_content_version()
        })?;
        Ok((operation, version))
    }

    fn eligibility(&self) -> Result<CurrentContentEligibility<'_>, String> {
        let notes_root = crate::state::notes_root()?;
        let index = self
            .state
            .notes_index
            .lock()
            .map_err(|_| "Notes index lock poisoned".to_string())?;
        let mut active_notes = HashMap::new();
        let mut active_paths = HashMap::new();
        for (path, note) in &index.entries {
            if note.document_kind != crate::note::DocumentKind::Note
                || !path.starts_with(&notes_root)
                || crate::state::is_forgotten_note_path(path, &notes_root)
                || !path.is_file()
            {
                continue;
            }
            active_notes.insert(note.note_id.clone(), path.clone());
            active_paths.insert(path.clone(), note.note_id.clone());
        }
        Ok(CurrentContentEligibility {
            scope: &self.scope,
            active_notes,
            active_paths,
        })
    }

    fn finish_read<T: CurrentContentProjection>(
        &self,
        version: CurrentContentVersion,
        mut projection: T,
    ) -> Result<T, String> {
        projection.retain_current(&self.eligibility()?);
        if !self.runtime.current_content_is_current(version)? {
            projection.invalidate();
        }
        Ok(projection)
    }

    pub(crate) fn read<T: CurrentContentProjection>(
        &self,
        query: impl FnOnce() -> Result<T, String>,
    ) -> Result<T, String> {
        let (_operation, version) = self.prepare_read()?;
        let projection = query()?;
        self.finish_read(version, projection)
    }

    pub(crate) async fn read_async<T, F>(&self, query: F) -> Result<T, String>
    where
        T: CurrentContentProjection,
        F: std::future::Future<Output = Result<T, String>>,
    {
        let (_operation, version) = self.prepare_read()?;
        let projection = query.await?;
        self.finish_read(version, projection)
    }

    pub(crate) fn allows(&self, note_id: &NoteIdentity) -> bool {
        self.eligibility()
            .map(|eligibility| eligibility.allows_note(Some(note_id.as_str()), None))
            .unwrap_or(false)
    }
}

pub(crate) struct AgentRestoreAccess<'a> {
    _state: &'a AppState,
    grant: ExplicitRestoreGrant,
}

impl AgentRestoreAccess<'_> {
    pub(crate) fn turn_id(&self) -> &TurnIdentity {
        &self.grant.turn_id
    }

    pub(crate) fn note_id(&self) -> &NoteIdentity {
        &self.grant.note_id
    }

    pub(crate) fn revision_id(&self) -> &RevisionIdentity {
        &self.grant.revision_id
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct ObservationReceipt {
    source: VaultObservationSource,
    kind: VaultObservationKind,
    path: PathBuf,
    previous_path: Option<PathBuf>,
    observed_at_millis: u64,
    modified_at_millis: Option<u64>,
    commit_warning: Option<NoteMutationWarning>,
}

impl ObservationReceipt {
    pub(crate) fn source(&self) -> VaultObservationSource {
        self.source
    }

    pub(crate) fn kind(&self) -> VaultObservationKind {
        self.kind
    }

    pub(crate) fn path(&self) -> &Path {
        &self.path
    }

    pub(crate) fn previous_path(&self) -> Option<&Path> {
        self.previous_path.as_deref()
    }

    pub(crate) fn observed_at_millis(&self) -> u64 {
        self.observed_at_millis
    }

    pub(crate) fn modified_at_millis(&self) -> Option<u64> {
        self.modified_at_millis
    }

    pub(crate) fn commit_warning(&self) -> Option<&NoteMutationWarning> {
        self.commit_warning.as_ref()
    }
}

pub(crate) struct NoteTimeline<'a> {
    state: &'a AppState,
    runtime: &'a NoteTimelineRuntime,
}

fn require_active_vault_root(requested_root: &Path) -> Result<PathBuf, String> {
    let active_root = crate::state::vault_root()?;
    let active_identity = fs::canonicalize(&active_root).unwrap_or_else(|_| active_root.clone());
    let requested_identity =
        fs::canonicalize(requested_root).unwrap_or_else(|_| requested_root.to_path_buf());
    if requested_identity != active_identity {
        return Err(format!(
            "Note Timeline vault root mismatch: requested {} but active vault is {}",
            requested_root.display(),
            active_root.display()
        ));
    }
    Ok(active_root)
}

#[cfg(test)]
static FAIL_NEXT_PURGE_STAGE: std::sync::atomic::AtomicBool =
    std::sync::atomic::AtomicBool::new(false);
#[cfg(test)]
static FAIL_NEXT_PURGE_PROJECTION_CLEANUP: std::sync::atomic::AtomicBool =
    std::sync::atomic::AtomicBool::new(false);

fn stage_note_for_purge(path: &Path, staged_path: &Path) -> std::io::Result<()> {
    #[cfg(test)]
    if FAIL_NEXT_PURGE_STAGE.swap(false, std::sync::atomic::Ordering::SeqCst) {
        return Err(std::io::Error::other("injected purge staging failure"));
    }
    fs::rename(path, staged_path)
}

impl<'a> NoteTimeline<'a> {
    pub(crate) fn bind(
        state: &'a AppState,
        runtime: &'a NoteTimelineRuntime,
        _owner: NoteTimelineOwnerToken,
    ) -> Self {
        Self { state, runtime }
    }

    pub(crate) fn is_cleanly_closed(&self) -> Result<bool, String> {
        self.runtime.is_cleanly_closed()
    }

    fn ensure_history_recovered(&self, integrity: RecoveryIntegrity) -> Result<(), String> {
        self.runtime.ensure_history_recovered(integrity, || {
            history_store::recover_pending()?;
            self.recover_pending_deletions()
        })
    }

    pub(crate) fn clean_close(&self, vault_root: &Path) -> Result<(), String> {
        let vault_root = require_active_vault_root(vault_root)?;
        crate::state::with_note_file_mutation(|| {
            self.runtime.close_operations(|| {
                self.runtime.with_observation_replay(|| {
                    self.recover_pending_deletions()?;
                    self.replay_retained_observations(None)?;
                    self.ensure_history_recovered(RecoveryIntegrity::Exhaustive)?;
                    crate::state::read_vault_manifest_for(&vault_root)?
                        .ok_or_else(|| "Clean close requires a vault manifest".to_string())?;
                    history_store::clean_close()
                })
            })
        })
    }

    fn with_settled_history_mutation<T>(
        &self,
        operation: impl FnOnce() -> Result<T, String>,
    ) -> Result<T, String> {
        self.runtime.with_observation_replay(|| {
            self.recover_pending_deletions()?;
            self.replay_retained_observations(None)?;
            self.ensure_history_recovered(RecoveryIntegrity::Exhaustive)?;
            operation()
        })
    }

    fn begin_current_content_mutation(&self) -> Result<CurrentContentMutationGuard, String> {
        let mutation = self.runtime.begin_current_content_mutation()?;
        crate::commands::search_commands::invalidate_result_caches();
        Ok(mutation)
    }

    fn recover_pending_deletions(&self) -> Result<(), String> {
        for pending in history_store::pending_deletions_for_recovery()? {
            if !pending.finalized && !pending.staged_path.exists() && pending.path.exists() {
                history_store::abandon_note_purge(&pending.operation_id)?;
                continue;
            }
            self.remove_purged_note_projections(&pending.note_id, &pending.path)?;
            if !pending.finalized {
                history_store::finalize_note_purge(&pending.operation_id)?;
            }
            history_store::complete_note_purge(&pending.operation_id)?;
        }
        Ok(())
    }

    fn purge_note_under_mutation_boundary(
        &self,
        note_id: &NoteIdentity,
        path: &Path,
        occurred_at_millis: u64,
    ) -> Result<(), String> {
        let manifest = crate::state::read_vault_manifest_for(&crate::state::vault_root()?)?
            .ok_or_else(|| "History purge requires a vault manifest".to_string())?;
        let marker = DeletionMarker::issue(
            DeletionScope::Note(note_id.clone()),
            HistoryDeletionKind::Purge,
            occurred_at_millis,
            manifest.history_generation,
        );
        let staged_path = history_store::prepare_note_purge(note_id, path, &marker)?;
        let expected_removal = crate::vault_watcher::record_expected_removal(path);
        match stage_note_for_purge(path, &staged_path) {
            Ok(()) => expected_removal.commit(),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound && !path.exists() => {}
            Err(error) => {
                return match history_store::abandon_note_purge(marker.operation_id()) {
                    Ok(()) => Err(format!(
                        "Stage canonical note before purging its timeline {}: {error}",
                        path.display()
                    )),
                    Err(abandon_error) => Err(format!(
                        "Stage canonical note before purging its timeline {}: {error}; abandon prepared purge: {abandon_error}",
                        path.display()
                    )),
                };
            }
        }
        self.remove_purged_note_projections(note_id, path)?;
        history_store::finalize_note_purge(marker.operation_id())?;
        history_store::complete_note_purge(marker.operation_id())
    }

    fn purge_missing_note_under_mutation_boundary(
        &self,
        note_id: &NoteIdentity,
        path: &Path,
        occurred_at_millis: u64,
    ) -> Result<(), String> {
        let manifest = crate::state::read_vault_manifest_for(&crate::state::vault_root()?)?
            .ok_or_else(|| "History purge requires a vault manifest".to_string())?;
        let marker = DeletionMarker::issue(
            DeletionScope::Note(note_id.clone()),
            HistoryDeletionKind::Purge,
            occurred_at_millis,
            manifest.history_generation,
        );
        history_store::prepare_note_purge(note_id, path, &marker)?;
        self.remove_purged_note_projections(note_id, path)?;
        history_store::finalize_note_purge(marker.operation_id())?;
        history_store::complete_note_purge(marker.operation_id())
    }

    fn remove_purged_note_projections(
        &self,
        note_id: &NoteIdentity,
        path: &Path,
    ) -> Result<(), String> {
        #[cfg(test)]
        if FAIL_NEXT_PURGE_PROJECTION_CLEANUP.swap(false, std::sync::atomic::Ordering::SeqCst) {
            return Err("injected purge projection cleanup interruption".to_string());
        }
        let indexed_identity = self.state.indexed_note_identity(path)?;
        if indexed_identity
            .as_deref()
            .is_none_or(|indexed_note_id| indexed_note_id == note_id.as_str())
        {
            self.state.remove_note_indexes(path)?;
        }
        self.state
            .semantic
            .purge_note_projection(path, note_id.as_str())?;
        Ok(())
    }

    pub(crate) fn initialize_existing_notes(
        &self,
        vault_root: &Path,
    ) -> Result<BaselineInitializationProgress, String> {
        self.initialize_existing_notes_with_candidates(
            vault_root,
            Vec::new(),
            BaselineInitializationHistory::SettleExistingStore,
        )
    }

    fn initialize_existing_notes_with_candidates(
        &self,
        vault_root: &Path,
        additional_candidates: Vec<ExistingBaselineCandidate>,
        history: BaselineInitializationHistory,
    ) -> Result<BaselineInitializationProgress, String> {
        let _operation = self.runtime.begin_operation()?;
        let vault_root = require_active_vault_root(vault_root)?;
        if history == BaselineInitializationHistory::SettleExistingStore {
            self.recover_retained_observations()?;
            self.ensure_history_recovered(RecoveryIntegrity::Exhaustive)?;
        }
        let mut progress = BaselineInitializationProgress {
            phase: BaselineInitializationPhase::Initializing,
            discovered_notes: 0,
            baseline_revisions: 0,
            ready_notes: 0,
            failed_notes: 0,
            last_error: None,
        };
        history_store::store_baseline_initialization_progress(&progress)?;
        let mut candidates = collect_markdown_files_recursively(&vault_root)?
            .into_iter()
            .map(|path| ExistingBaselineCandidate::Active { path })
            .collect::<Vec<_>>();
        candidates.extend(
            crate::state::read_state(&vault_root)?
                .forgotten_notes
                .into_iter()
                .filter(|forgotten| forgotten.kind == crate::state::ForgottenItemKind::Note)
                .map(|forgotten| ExistingBaselineCandidate::Forgotten {
                    path: PathBuf::from(forgotten.forgotten_path),
                    note_id: forgotten.note_id.map(NoteIdentity::new),
                    original_path: PathBuf::from(forgotten.original_path),
                    forgotten_at_millis: forgotten.forgotten_at_millis,
                }),
        );
        candidates.extend(additional_candidates);
        candidates.sort_by(|left, right| left.path().cmp(right.path()));
        for candidate in candidates {
            let path = candidate.path().to_path_buf();
            let markdown = match candidate
                .canonical_markdown()
                .map(str::to_owned)
                .map(Ok)
                .unwrap_or_else(|| fs::read_to_string(&path).map_err(|error| error.to_string()))
            {
                Ok(markdown) => markdown,
                Err(error) => {
                    progress.failed_notes += 1;
                    progress.last_error = Some(format!(
                        "Read existing note {} for baseline: {error}",
                        path.display()
                    ));
                    history_store::store_baseline_initialization_progress(&progress)?;
                    continue;
                }
            };
            let parsed = crate::note::parse_note(&markdown);
            let metadata = parsed.frontmatter.managed.as_ref();
            if metadata.is_some_and(|metadata| metadata.kind.is_chat_projection()) {
                continue;
            }
            let retained_note_id = candidate.retained_note_id();
            if metadata.is_none() && retained_note_id.is_none() {
                continue;
            }
            progress.discovered_notes += 1;
            let embedded_note_id = metadata.and_then(|metadata| {
                (!metadata.id.trim().is_empty()).then(|| NoteIdentity::new(metadata.id.clone()))
            });
            let mut resolved_note_id = None;
            let initialized = (|| {
                if retained_note_id.is_some()
                    && embedded_note_id.is_some()
                    && retained_note_id != embedded_note_id
                {
                    return Err(
                        "Inactive note state identity does not match its canonical Markdown"
                            .to_string(),
                    );
                }
                let persisted_path_identity = history_store::note_identity_for_current_path(&path)?;
                let note_id = match persisted_path_identity.or(retained_note_id.clone()) {
                    Some(note_id) => note_id,
                    None => {
                        let historical_owner = embedded_note_id
                            .as_ref()
                            .map(history_store::current_path)
                            .transpose()?
                            .flatten();
                        NoteIdentity::new(self.state.resolve_observed_note_identity(
                            &path,
                            &markdown,
                            historical_owner.as_deref(),
                        )?)
                    }
                };
                resolved_note_id = Some(note_id.clone());
                let known_since_millis = crate::time::current_time_millis().map_err(|error| {
                    format!("Issue Baseline Revision known-since time: {error}")
                })?;
                let baseline_inserted = history_store::record_baseline_revision_if_absent(
                    &note_id,
                    &path,
                    &markdown,
                    known_since_millis,
                )?;
                if candidate.is_inactive() {
                    if baseline_inserted || history_store::lifecycle_events(&note_id)?.is_empty() {
                        candidate.record_inactive_lifecycle(&note_id)?;
                    }
                }
                history_store::clear_baseline_initialization_failure(&note_id)?;
                let ready = matches!(
                    history_store::note_baseline_initialization_state(&note_id)?,
                    NoteBaselineInitializationState::Initialized {
                        known_since_millis: Some(_)
                    }
                );
                Ok::<_, String>(ready)
            })();
            match initialized {
                Ok(true) => {
                    progress.baseline_revisions += 1;
                    progress.ready_notes += 1;
                }
                Ok(false) => progress.ready_notes += 1,
                Err(error) => {
                    progress.failed_notes += 1;
                    progress.last_error = Some(format!(
                        "Initialize existing note {}: {error}",
                        path.display()
                    ));
                    if let Some(note_id) = resolved_note_id.as_ref().or(embedded_note_id.as_ref()) {
                        history_store::record_baseline_initialization_failure(
                            note_id,
                            &path,
                            progress.last_error.as_deref().unwrap_or("Baseline failed"),
                        )?;
                    }
                }
            }
            history_store::store_baseline_initialization_progress(&progress)?;
        }
        progress.phase = if progress.failed_notes == 0 {
            BaselineInitializationPhase::Complete
        } else {
            BaselineInitializationPhase::Degraded
        };
        history_store::store_baseline_initialization_progress(&progress)?;
        Ok(progress)
    }

    pub(crate) fn baseline_initialization_progress(
        &self,
    ) -> Result<BaselineInitializationProgress, String> {
        let _operation = self.runtime.begin_operation()?;
        history_store::baseline_initialization_progress()
    }

    pub(crate) fn note_baseline_initialization_state(
        &self,
        note_id: &NoteIdentity,
    ) -> Result<NoteBaselineInitializationState, String> {
        let _operation = self.runtime.begin_operation()?;
        history_store::note_baseline_initialization_state(note_id)
    }

    pub(crate) fn reset_history(&self, vault_root: &Path) -> Result<HistoryResetReceipt, String> {
        self.reset_history_from(vault_root, ResetHistorySource::RequireReadableStore)
    }

    fn reset_history_from(
        &self,
        vault_root: &Path,
        source: ResetHistorySource,
    ) -> Result<HistoryResetReceipt, String> {
        let vault_root = require_active_vault_root(vault_root)?;
        crate::state::with_note_file_mutation(|| {
            let _operation = self.runtime.begin_operation()?;
            self.runtime.with_observation_replay(|| {
                let preserve_old_store = source == ResetHistorySource::RequireReadableStore
                    || history_store::store_is_queryable_for_reset();
                let recoverable_missing = if preserve_old_store {
                    self.recover_pending_deletions()?;
                    self.replay_retained_observations(None)?;
                    history_store::recover_pending()?;
                    self.recoverable_missing_baseline_candidates()?
                } else {
                    Vec::new()
                };
                let (previous_generation, generation, operation_id, reset_at_millis) =
                    history_store::reset_history_store(&vault_root)?;
                self.runtime.begin_history_replacement()?;
                let initialization = match self.initialize_existing_notes_with_candidates(
                    &vault_root,
                    recoverable_missing,
                    BaselineInitializationHistory::RebuildReplacementStore,
                ) {
                    Ok(initialization)
                        if initialization.phase() == BaselineInitializationPhase::Complete =>
                    {
                        initialization
                    }
                    Ok(initialization) => {
                        self.runtime.fail_history_replacement()?;
                        return Err(format!(
                            "History reset replacement did not rebuild completely: {}",
                            initialization
                                .last_error()
                                .unwrap_or("one or more Baseline Revisions failed")
                        ));
                    }
                    Err(error) => {
                        self.runtime.fail_history_replacement()?;
                        return Err(format!(
                            "History reset replacement did not rebuild completely: {error}"
                        ));
                    }
                };
                if let Err(error) = history_store::complete_history_reset_rebuild() {
                    self.runtime.fail_history_replacement()?;
                    return Err(format!(
                        "History reset replacement could not be made available: {error}"
                    ));
                }
                self.runtime.complete_history_replacement()?;
                Ok(HistoryResetReceipt {
                    operation_id,
                    previous_generation,
                    generation,
                    reset_at_millis,
                    initialization,
                })
            })
        })
    }

    fn recoverable_missing_baseline_candidates(
        &self,
    ) -> Result<Vec<ExistingBaselineCandidate>, String> {
        // Reset can retain a Missing Note only when its latest authored state
        // still reconstructs and verifies. It must never invent replacement
        // content from an unavailable or corrupt revision.
        let missing_notes = history_store::missing_notes()
            .map_err(|error| format!("Read Missing Notes before history reset: {error}"))?;
        missing_notes
            .into_iter()
            .map(|missing| {
                let retained =
                    history_store::reconstruct_latest(missing.note_id()).map_err(|error| {
                        format!(
                            "Reconstruct Missing Note {} before history reset: {error}",
                            missing.note_id().as_str()
                        )
                    })?;
                let canonical_markdown =
                    canonical_markdown_for_recovered_note(missing.note_id(), &retained).map_err(
                        |error| {
                            format!(
                                "Canonicalize Missing Note {} before history reset: {error}",
                                missing.note_id().as_str()
                            )
                        },
                    )?;
                Ok(ExistingBaselineCandidate::Missing {
                    record: missing,
                    canonical_markdown,
                })
            })
            .collect()
    }

    pub(crate) fn latest_history_reset(&self) -> Result<Option<HistoryResetReceipt>, String> {
        let _operation = self.runtime.begin_operation()?;
        let Some((operation_id, previous_generation, generation, reset_at_millis)) =
            history_store::latest_history_reset()?
        else {
            return Ok(None);
        };
        Ok(Some(HistoryResetReceipt {
            operation_id,
            previous_generation,
            generation,
            reset_at_millis,
            initialization: history_store::baseline_initialization_progress()?,
        }))
    }

    pub(crate) fn history_health(&self) -> Result<HistoryHealthReport, String> {
        let _operation = self.runtime.begin_operation()?;
        let health = self.runtime.history_health_snapshot()?;
        let initialization = match &health {
            history_store::HistoryStoreHealth::Available(snapshot) => {
                snapshot.initialization.clone()
            }
            history_store::HistoryStoreHealth::Unavailable
            | history_store::HistoryStoreHealth::Corrupt => BaselineInitializationProgress {
                phase: BaselineInitializationPhase::NotStarted,
                discovered_notes: 0,
                baseline_revisions: 0,
                ready_notes: 0,
                failed_notes: 0,
                last_error: None,
            },
        };
        let last_reset = history_store::latest_history_reset().ok().flatten().map(
            |(operation_id, previous_generation, generation, reset_at_millis)| {
                HistoryResetReceipt {
                    operation_id,
                    previous_generation,
                    generation,
                    reset_at_millis,
                    initialization: initialization.clone(),
                }
            },
        );
        let report = match health {
            history_store::HistoryStoreHealth::Available(snapshot) => {
                let state = if snapshot.pending_repairs > 0 {
                    HistoryHealthState::Warning
                } else {
                    match snapshot.initialization.phase {
                        BaselineInitializationPhase::NotStarted
                        | BaselineInitializationPhase::Initializing => {
                            HistoryHealthState::Initializing
                        }
                        BaselineInitializationPhase::Degraded => HistoryHealthState::Degraded,
                        BaselineInitializationPhase::Complete => HistoryHealthState::Healthy,
                    }
                };
                HistoryHealthReport {
                    state,
                    integrity: HistoryIntegrityState::Verified,
                    initialization: snapshot.initialization,
                    storage: Some(snapshot.storage),
                    pending_repairs: snapshot.pending_repairs,
                    can_retry: matches!(
                        state,
                        HistoryHealthState::Warning | HistoryHealthState::Degraded
                    ),
                    can_reset: false,
                    last_reset,
                }
            }
            history_store::HistoryStoreHealth::Unavailable => HistoryHealthReport {
                state: HistoryHealthState::Unavailable,
                integrity: HistoryIntegrityState::Unavailable,
                initialization,
                storage: None,
                pending_repairs: 0,
                can_retry: true,
                can_reset: true,
                last_reset,
            },
            history_store::HistoryStoreHealth::Corrupt => HistoryHealthReport {
                state: HistoryHealthState::Corrupt,
                integrity: HistoryIntegrityState::Corrupt,
                initialization,
                storage: None,
                pending_repairs: 0,
                can_retry: true,
                can_reset: true,
                last_reset,
            },
        };
        Ok(report)
    }

    pub(crate) fn note_history_health(
        &self,
        note_id: &NoteIdentity,
    ) -> Result<NoteHistoryHealth, String> {
        let _operation = self.runtime.begin_operation()?;
        let (state, revision_count, lifecycle_event_count, revision_payload_bytes) =
            match self.runtime.note_history_health_snapshot(note_id)? {
                history_store::NoteHistoryStoreHealth::Available(snapshot) => {
                    let state = match snapshot.initialization {
                        NoteBaselineInitializationState::Uninitialized => {
                            NoteHistoryHealthState::Initializing
                        }
                        NoteBaselineInitializationState::Failed { .. } => {
                            NoteHistoryHealthState::Degraded
                        }
                        NoteBaselineInitializationState::Initialized { .. } => {
                            NoteHistoryHealthState::Healthy
                        }
                    };
                    (
                        state,
                        snapshot.revision_count,
                        snapshot.lifecycle_event_count,
                        snapshot.revision_payload_bytes,
                    )
                }
                history_store::NoteHistoryStoreHealth::Unavailable => {
                    (NoteHistoryHealthState::Unavailable, 0, 0, 0)
                }
                history_store::NoteHistoryStoreHealth::Corrupt => {
                    (NoteHistoryHealthState::Corrupt, 0, 0, 0)
                }
            };
        Ok(NoteHistoryHealth {
            note_id: note_id.as_str().to_string(),
            state,
            revision_count,
            lifecycle_event_count,
            revision_payload_bytes,
        })
    }

    pub(crate) fn retry_history_recovery(
        &self,
        vault_root: &Path,
    ) -> Result<HistoryHealthReport, String> {
        let vault_root = require_active_vault_root(vault_root)?;
        {
            let _operation = self.runtime.begin_operation()?;
            self.runtime.with_observation_replay(|| {
                self.recover_pending_deletions()?;
                self.replay_retained_observations(None)?;
                self.runtime.retry_history_recovery(|| {
                    history_store::recover_pending()?;
                    self.recover_pending_deletions()
                })
            })?;
        }
        if matches!(
            self.history_health()?.state(),
            HistoryHealthState::Initializing | HistoryHealthState::Degraded
        ) {
            self.initialize_existing_notes(&vault_root)?;
        }
        self.history_health()
    }

    pub(crate) fn reset_corrupt_history(
        &self,
        vault_root: &Path,
        confirmed: bool,
    ) -> Result<HistoryResetReceipt, String> {
        if !confirmed {
            return Err("Corrupt history reset requires explicit confirmation".to_string());
        }
        let health = self.history_health()?;
        if !matches!(
            health.state(),
            HistoryHealthState::Corrupt | HistoryHealthState::Unavailable
        ) {
            return Err(
                "History reset is available only when history is corrupt or unavailable"
                    .to_string(),
            );
        }
        self.reset_history_from(vault_root, ResetHistorySource::PreserveWhenReadable)
    }

    pub(crate) fn trust_and_migrate_legacy_history(&self, vault_root: &Path) -> Result<(), String> {
        let vault_root = require_active_vault_root(vault_root)?;
        crate::state::with_note_file_mutation(|| {
            let _operation = self.runtime.begin_operation()?;
            self.runtime.with_observation_replay(|| {
                let manifest =
                    crate::state::read_vault_manifest_for(&vault_root)?.ok_or_else(|| {
                        "Legacy history recovery requires a vault manifest".to_string()
                    })?;
                history_store::trust_legacy_store_for_migration(&manifest)?;
                history_store::baseline_initialization_progress().map(|_| ())
            })
        })
    }

    pub(crate) fn clear_note_history(
        &self,
        note_id: &NoteIdentity,
    ) -> Result<HistoryDeletionReceipt, String> {
        crate::state::with_note_file_mutation(|| {
            let _operation = self.runtime.begin_operation()?;
            let _current_content_mutation = self.begin_current_content_mutation()?;
            self.with_settled_history_mutation(|| {
                require_recovered_note(note_id)?;
                let path = history_store::current_path(note_id)?
                    .ok_or_else(|| "Cannot clear an unknown Note Timeline".to_string())?;
                let canonical_markdown = fs::read_to_string(&path).map_err(|error| {
                    format!(
                        "Read current canonical note before clearing history {}: {error}",
                        path.display()
                    )
                })?;
                let occurred_at_millis = crate::time::current_time_millis()
                    .map_err(|error| format!("Issue history clear time: {error}"))?;
                let manifest = crate::state::read_vault_manifest_for(&crate::state::vault_root()?)?
                    .ok_or_else(|| "History clear requires a vault manifest".to_string())?;
                let marker = DeletionMarker::issue(
                    DeletionScope::Note(note_id.clone()),
                    HistoryDeletionKind::Clear,
                    occurred_at_millis,
                    manifest.history_generation,
                );
                history_store::clear_note_history(note_id, &path, &canonical_markdown, &marker)?;
                Ok(HistoryDeletionReceipt {
                    marker,
                    baseline_note_ids: vec![note_id.clone()],
                })
            })
        })
    }

    pub(crate) fn clear_vault_history(
        &self,
        vault_root: &Path,
    ) -> Result<HistoryDeletionReceipt, String> {
        let vault_root = require_active_vault_root(vault_root)?;
        crate::state::with_note_file_mutation(|| {
            let _operation = self.runtime.begin_operation()?;
            let _current_content_mutation = self.begin_current_content_mutation()?;
            self.with_settled_history_mutation(|| {
                let mut seeds = Vec::new();
                let mut seen_note_ids = HashSet::new();
                for path in collect_markdown_files_recursively(&vault_root)? {
                    let canonical_markdown = fs::read_to_string(&path).map_err(|error| {
                        format!(
                            "Read active canonical note before clearing vault history {}: {error}",
                            path.display()
                        )
                    })?;
                    let parsed = crate::note::parse_note(&canonical_markdown);
                    let managed_metadata = parsed.frontmatter.managed;
                    if managed_metadata
                        .as_ref()
                        .is_some_and(|metadata| metadata.kind.is_chat_projection())
                    {
                        continue;
                    }
                    let historical_note_id = history_store::note_identity_for_current_path(&path)?;
                    let embedded_note_id = managed_metadata
                        .as_ref()
                        .map(|metadata| metadata.id.as_str())
                        .filter(|note_id| !note_id.trim().is_empty())
                        .map(NoteIdentity::new);
                    let note_id = match historical_note_id.or(embedded_note_id) {
                        Some(note_id) => note_id,
                        None if managed_metadata.is_none() => continue,
                        None => {
                            return Err(format!(
                            "Active note {} has no stable Note Identity for vault history clear",
                            path.display()
                        ));
                        }
                    };
                    if !seen_note_ids.insert(note_id.clone()) {
                        return Err(format!(
                        "Multiple active notes claim Note Identity {} during vault history clear",
                        note_id.as_str()
                    ));
                    }
                    seeds.push(HistoryClearBaseline {
                        note_id,
                        path,
                        canonical_markdown,
                    });
                }
                let occurred_at_millis = crate::time::current_time_millis()
                    .map_err(|error| format!("Issue vault history clear time: {error}"))?;
                let manifest = crate::state::read_vault_manifest_for(&vault_root)?
                    .ok_or_else(|| "Vault history clear requires a vault manifest".to_string())?;
                let marker = DeletionMarker::issue(
                    DeletionScope::Vault(manifest.vault_id),
                    HistoryDeletionKind::Clear,
                    occurred_at_millis,
                    manifest.history_generation,
                );
                history_store::clear_vault_history(&seeds, &marker)?;
                Ok(HistoryDeletionReceipt {
                    marker,
                    baseline_note_ids: seeds.into_iter().map(|seed| seed.note_id).collect(),
                })
            })
        })
    }

    pub(crate) fn deletion_markers(&self) -> Result<Vec<DeletionMarker>, String> {
        let _operation = self.runtime.begin_operation()?;
        self.recover_retained_observations()?;
        self.ensure_history_recovered(RecoveryIntegrity::Exhaustive)?;
        history_store::deletion_markers()
    }

    pub(crate) fn history_storage_usage(&self) -> Result<HistoryStorageUsage, String> {
        let _operation = self.runtime.begin_operation()?;
        self.recover_retained_observations()?;
        self.ensure_history_recovered(RecoveryIntegrity::Exhaustive)?;
        history_store::storage_usage()
    }

    pub(crate) fn compact_history_storage(
        &self,
        maximum_reclaim_bytes: u64,
    ) -> Result<HistoryCompactionReceipt, String> {
        crate::state::with_note_file_mutation(|| {
            let _operation = self.runtime.begin_operation()?;
            self.with_settled_history_mutation(|| {
                let before = history_store::storage_usage()?;
                history_store::compact(maximum_reclaim_bytes)?;
                let after = history_store::storage_usage()?;
                Ok(HistoryCompactionReceipt { before, after })
            })
        })
    }

    /// Prepare user-authored Markdown for an app-owned publication while
    /// preserving the identity already owned by the logical note. Callers
    /// provide continuity evidence; the timeline keeps the repair policy
    /// and metadata representation private.
    pub(crate) fn prepare_publication(
        &self,
        continuity_path: Option<&Path>,
        retained_identity: Option<&NoteIdentity>,
        markdown: &str,
    ) -> Result<String, String> {
        let _operation = self.runtime.begin_operation()?;
        let catalog_identity = continuity_path
            .map(|path| self.state.indexed_note_identity(path))
            .transpose()?
            .flatten();
        let retained_identity = retained_identity
            .map(NoteIdentity::as_str)
            .filter(|note_id| !note_id.trim().is_empty());
        if let (Some(retained), Some(catalog)) = (retained_identity, catalog_identity.as_deref()) {
            if retained != catalog {
                return Err(format!(
                    "Note identity continuity conflict: retained identity {retained} does not match catalog identity {catalog}."
                ));
            }
        }
        let historical_identity = if catalog_identity.is_none() && retained_identity.is_none() {
            continuity_path
                .map(history_store::note_identity_for_current_path)
                .transpose()?
                .flatten()
        } else {
            None
        };
        let authoritative_identity = catalog_identity
            .as_deref()
            .or(retained_identity)
            .or_else(|| historical_identity.as_ref().map(NoteIdentity::as_str));
        let embedded_identity = crate::note::parse_note(markdown)
            .frontmatter
            .managed
            .map(|metadata| metadata.id);

        match authoritative_identity {
            Some(note_id) if embedded_identity.as_deref() != Some(note_id) => {
                crate::note::repair_managed_note_identity(markdown, note_id)
            }
            _ => Ok(markdown.to_string()),
        }
    }

    /// Durably prepare one app-owned authored-state mutation before its
    /// canonical Markdown is published. The returned bytes include the
    /// timeline-owned identity and are the only bytes the caller may publish.
    pub(crate) fn prepare_revision_publication(
        &self,
        source: MutationSource,
        target_path: &Path,
        continuity_path: Option<&Path>,
        retained_identity: Option<&NoteIdentity>,
        markdown: &str,
    ) -> Result<PreparedRevisionPublication, String> {
        let operation = self.runtime.begin_operation()?;
        let current_content_mutation = self.begin_current_content_mutation()?;
        self.recover_retained_observations()?;
        self.ensure_history_recovered(RecoveryIntegrity::Exhaustive)?;
        let identity_prepared =
            self.prepare_publication(continuity_path, retained_identity, markdown)?;
        let existing_markdown = target_path
            .is_file()
            .then(|| fs::read_to_string(target_path))
            .transpose()
            .map_err(|error| error.to_string())?;
        let canonical = crate::note::prepare_note_markdown(
            &identity_prepared,
            existing_markdown.as_deref(),
            Some(None),
        )?
        .0;
        self.prepare_canonical_revision_publication(source, target_path, continuity_path, canonical)
            .map(|prepared| prepared.with_runtime_leases(operation, current_content_mutation))
    }

    fn prepare_exact_revision_publication(
        &self,
        source: MutationSource,
        target_path: &Path,
        continuity_path: Option<&Path>,
        retained_identity: Option<&NoteIdentity>,
        markdown: &str,
    ) -> Result<PreparedRevisionPublication, String> {
        let operation = self.runtime.begin_operation()?;
        let current_content_mutation = self.begin_current_content_mutation()?;
        self.recover_retained_observations()?;
        self.ensure_history_recovered(RecoveryIntegrity::Exhaustive)?;
        let canonical = self.prepare_publication(continuity_path, retained_identity, markdown)?;
        self.prepare_canonical_revision_publication(source, target_path, continuity_path, canonical)
            .map(|prepared| prepared.with_runtime_leases(operation, current_content_mutation))
    }

    fn prepare_canonical_revision_publication(
        &self,
        source: MutationSource,
        target_path: &Path,
        continuity_path: Option<&Path>,
        canonical: String,
    ) -> Result<PreparedRevisionPublication, String> {
        let baseline_markdown = continuity_path
            .filter(|path| path.is_file())
            .map(fs::read_to_string)
            .transpose()
            .map_err(|error| format!("Read canonical state before Baseline Revision: {error}"))?;
        let baseline_known_since = baseline_markdown
            .as_ref()
            .map(|_| crate::time::current_time_millis())
            .transpose()
            .map_err(|error| format!("Issue Baseline Revision known-since time: {error}"))?;
        let history_intent = history_store::prepare_publication(
            source,
            target_path,
            &canonical,
            if continuity_path.is_none() {
                history_store::PublicationIntentKind::Create
            } else {
                history_store::PublicationIntentKind::Update
            },
            baseline_markdown
                .as_deref()
                .map(|canonical_markdown| history_store::BaselineSeed {
                    path: continuity_path.expect("baseline requires continuity path"),
                    canonical_markdown,
                    known_since_millis: baseline_known_since
                        .expect("baseline Markdown requires known-since time"),
                }),
        )?;
        Ok(PreparedRevisionPublication {
            canonical_markdown: canonical,
            history_intent,
        })
    }

    pub(crate) fn mutate(&self, mutation: NoteMutation) -> NoteMutationResult {
        let NoteMutation {
            source,
            history_intent,
            path,
            previous_path,
            fallback_markdown,
        } = mutation;
        let canonical_read = fs::read_to_string(&path);
        let history_error = match canonical_read.as_deref() {
            Ok(canonical) => {
                history_store::finalize_publication(&history_intent, source, &path, canonical).err()
            }
            Err(error) => Some(format!(
                "Read authoritative Markdown before history finalization: {error}"
            )),
        };
        let mut outcome = post_publication::synchronize_canonical_file(
            self.state,
            path,
            previous_path,
            fallback_markdown,
        );
        if let Some(error) = history_error {
            outcome.record_issue(PublicationStage::HistoryFinalization, error);
        }
        NoteMutationResult::from_publication(source, outcome)
    }

    pub(crate) fn observe(
        &self,
        observation: VaultObservation,
    ) -> Result<ObservationReceipt, String> {
        let _operation = self.runtime.begin_operation()?;
        let _current_content_mutation = self.begin_current_content_mutation()?;
        self.runtime.with_observation_replay(|| {
            self.recover_pending_deletions()?;
            let observation = self.capture_observed_markdown(observation)?;
            if observation.kind == VaultObservationKind::ReconciliationScan {
                self.replay_retained_observations(None)?;
                return self.apply_observation(observation);
            }

            let requested_sequence = history_store::retain_observation(&observation)?;
            self.replay_retained_observations(Some(requested_sequence))?
                .ok_or_else(|| {
                    format!(
                        "Retained Note Timeline observation {requested_sequence} was not replayed"
                    )
                })
        })
    }

    fn recover_retained_observations(&self) -> Result<(), String> {
        self.runtime.with_observation_replay(|| {
            self.recover_pending_deletions()?;
            self.replay_retained_observations(None).map(|_| ())
        })
    }

    fn replay_retained_observations(
        &self,
        requested_sequence: Option<i64>,
    ) -> Result<Option<ObservationReceipt>, String> {
        let mut requested_receipt = None;
        for retained in history_store::retained_observations()? {
            let receipt = self
                .apply_observation(retained.observation)
                .map_err(|error| {
                    format!(
                        "Replay retained Note Timeline observation {}: {error}",
                        retained.sequence
                    )
                })?;
            history_store::acknowledge_observation(retained.sequence)?;
            if requested_sequence == Some(retained.sequence) {
                requested_receipt = Some(receipt);
            }
        }
        Ok(requested_receipt)
    }

    fn capture_observed_markdown(
        &self,
        mut observation: VaultObservation,
    ) -> Result<VaultObservation, String> {
        let requires_markdown = matches!(observation.kind, VaultObservationKind::CanonicalState)
            || matches!(
                observation.kind,
                VaultObservationKind::Lifecycle(
                    LifecycleEventKind::Renamed | LifecycleEventKind::Moved
                )
            );
        if requires_markdown && observation.canonical_markdown.is_none() {
            observation.canonical_markdown =
                Some(fs::read_to_string(&observation.path).map_err(|error| {
                    format!(
                        "Capture observed canonical note {}: {error}",
                        observation.path.display()
                    )
                })?);
        }
        if observation.kind == VaultObservationKind::Lifecycle(LifecycleEventKind::Missing)
            && observation.missing_retention_days.is_none()
        {
            observation.missing_retention_days =
                Some(crate::state::forgotten_note_retention_days()?);
        }
        Ok(observation)
    }

    fn apply_observation(
        &self,
        observation: VaultObservation,
    ) -> Result<ObservationReceipt, String> {
        let VaultObservation {
            source,
            mut kind,
            path,
            mut previous_path,
            observed_at_millis,
            modified_at_millis,
            canonical_markdown,
            missing_retention_days,
        } = observation;
        let mut lifecycle_projection_warning = None;
        match kind {
            VaultObservationKind::ReconciliationScan => {
                self.ensure_history_recovered(RecoveryIntegrity::Exhaustive)?;
            }
            VaultObservationKind::Lifecycle(LifecycleEventKind::Missing) => {
                self.ensure_history_recovered(RecoveryIntegrity::Exhaustive)?;
                let note_id = self
                    .state
                    .detach_indexed_note_identity(&path)?
                    .map(NoteIdentity::new)
                    .or(history_store::note_identity_for_current_path(&path)?);
                if let Some(note_id) = note_id {
                    let retention_days = missing_retention_days.ok_or_else(|| {
                        "Missing Note observation has no captured retention setting".to_string()
                    })?;
                    let missing_record = MissingNoteRecord::captured(
                        note_id.clone(),
                        path.clone(),
                        observed_at_millis,
                        retention_days,
                    );
                    history_store::record_observed_missing_lifecycle_event(&missing_record)?;
                    lifecycle_projection_warning = self.synchronize_missing_projection(&path);
                }
            }
            VaultObservationKind::CanonicalState => {
                let markdown = canonical_markdown.map(Ok).unwrap_or_else(|| {
                    fs::read_to_string(&path).map_err(|error| {
                        format!("Read observed canonical note {}: {error}", path.display())
                    })
                })?;
                self.ensure_history_recovered(RecoveryIntegrity::Exhaustive)?;
                let embedded_note_id = crate::note::parse_note(&markdown)
                    .frontmatter
                    .managed
                    .map(|metadata| NoteIdentity::new(metadata.id))
                    .filter(|identity| !identity.as_str().trim().is_empty());
                let historical_path = embedded_note_id
                    .as_ref()
                    .map(history_store::current_path)
                    .transpose()?
                    .flatten();
                let identity_history = historical_path.as_deref().filter(|historical_path| {
                    source == VaultObservationSource::Reconciliation || *historical_path == path
                });
                let note_id = self.state.resolve_observed_note_identity(
                    &path,
                    &markdown,
                    identity_history,
                )?;
                if let Some(previous_path) = historical_path.as_deref().filter(|previous_path| {
                    source == VaultObservationSource::Reconciliation
                        && *previous_path != path
                        && !previous_path.exists()
                }) {
                    let relocation = if previous_path.parent() == path.parent() {
                        LifecycleEventKind::Renamed
                    } else {
                        LifecycleEventKind::Moved
                    };
                    history_store::record_observed_lifecycle_event(
                        &NoteIdentity::new(note_id.clone()),
                        relocation,
                        Some(previous_path),
                        &path,
                        observed_at_millis,
                    )?;
                }
                if history_store::baseline_initialization_progress()?.phase()
                    != BaselineInitializationPhase::Complete
                {
                    history_store::record_baseline_revision_if_absent(
                        &NoteIdentity::new(note_id.clone()),
                        &path,
                        &markdown,
                        observed_at_millis,
                    )?;
                }
                history_store::record_external_revision(
                    &NoteIdentity::new(note_id.clone()),
                    &path,
                    &markdown,
                    observed_at_millis,
                    modified_at_millis,
                )?;
                let mut missing_path = self
                    .state
                    .prepare_safe_note_identity_reattachment(&path, note_id.as_str())?;
                if missing_path.is_none() {
                    missing_path =
                        history_store::missing_note(&NoteIdentity::new(note_id.clone()))?
                            .filter(|missing| missing.path() == path)
                            .map(|missing| missing.path().to_path_buf());
                }
                if let Some(missing_path) = missing_path {
                    kind = VaultObservationKind::Lifecycle(LifecycleEventKind::Reattached);
                    previous_path = Some(missing_path);
                    history_store::record_observed_lifecycle_event(
                        &NoteIdentity::new(note_id),
                        LifecycleEventKind::Reattached,
                        previous_path.as_deref(),
                        &path,
                        observed_at_millis,
                    )?;
                }
            }
            VaultObservationKind::Lifecycle(
                LifecycleEventKind::Renamed | LifecycleEventKind::Moved,
            ) => {
                if let Some(previous_path) = previous_path.as_deref() {
                    let markdown = canonical_markdown.map(Ok).unwrap_or_else(|| {
                        fs::read_to_string(&path).map_err(|error| {
                            format!("Read observed moved note {}: {error}", path.display())
                        })
                    })?;
                    self.ensure_history_recovered(RecoveryIntegrity::Exhaustive)?;
                    let transferred = self
                        .state
                        .prepare_note_identity_transfer(previous_path, &path)?;
                    let note_id = match transferred {
                        Some(note_id) => note_id,
                        None => self
                            .state
                            .resolve_observed_note_identity(&path, &markdown, None)?,
                    };
                    let lifecycle_kind = match kind {
                        VaultObservationKind::Lifecycle(kind) => kind,
                        _ => unreachable!("matched lifecycle observation"),
                    };
                    history_store::record_observed_lifecycle_event(
                        &NoteIdentity::new(note_id),
                        lifecycle_kind,
                        Some(previous_path),
                        &path,
                        observed_at_millis,
                    )?;
                }
            }
            VaultObservationKind::Lifecycle(
                kind @ (LifecycleEventKind::Forgotten | LifecycleEventKind::Recovered),
            ) => {
                if !path.exists()
                    && previous_path
                        .as_deref()
                        .is_some_and(|previous_path| previous_path.exists())
                {
                    return Ok(ObservationReceipt {
                        source,
                        kind: VaultObservationKind::Lifecycle(kind),
                        path,
                        previous_path,
                        observed_at_millis,
                        modified_at_millis,
                        commit_warning: None,
                    });
                }
                let intended_markdown = canonical_markdown.ok_or_else(|| {
                    "App-owned lifecycle observation is missing intended canonical Markdown"
                        .to_string()
                })?;
                let mut published_markdown = fs::read_to_string(&path).map_err(|error| {
                    format!(
                        "Read app-owned lifecycle publication {}: {error}",
                        path.display()
                    )
                })?;
                let mut authoritative_authored_edit = false;
                if published_markdown != intended_markdown {
                    let intended_note_id = crate::note::parse_note(&intended_markdown)
                        .frontmatter
                        .managed
                        .map(|metadata| metadata.id)
                        .filter(|note_id| !note_id.trim().is_empty());
                    let published_note_id = crate::note::parse_note(&published_markdown)
                        .frontmatter
                        .managed
                        .map(|metadata| metadata.id)
                        .filter(|note_id| !note_id.trim().is_empty());
                    if intended_note_id.is_none() || intended_note_id != published_note_id {
                        return Err(format!(
                            "App-owned lifecycle publication at {} does not match its durable intent",
                            path.display()
                        ));
                    }
                    if history_store::authored_content_hash(&published_markdown)
                        == history_store::authored_content_hash(&intended_markdown)
                    {
                        crate::state::atomic_write_note(&path, intended_markdown.as_bytes())
                            .map_err(|error| {
                                format!(
                                    "Repair app-owned lifecycle publication {}: {error}",
                                    path.display()
                                )
                            })?;
                        published_markdown = intended_markdown;
                    } else {
                        authoritative_authored_edit = true;
                    }
                }
                self.ensure_history_recovered(RecoveryIntegrity::Exhaustive)?;
                let note_id = crate::note::parse_note(&published_markdown)
                    .frontmatter
                    .managed
                    .map(|metadata| NoteIdentity::new(metadata.id))
                    .filter(|identity| !identity.as_str().trim().is_empty())
                    .ok_or_else(|| {
                        "App-owned lifecycle publication requires a managed Note Identity"
                            .to_string()
                    })?;
                history_store::record_observed_lifecycle_event(
                    &note_id,
                    kind,
                    previous_path.as_deref(),
                    &path,
                    observed_at_millis,
                )?;
                if authoritative_authored_edit {
                    let authoritative_observed_at_millis = crate::time::current_time_millis()
                        .map_err(|error| {
                            format!(
                                "Issue external lifecycle-recovery observation time for {}: {error}",
                                path.display()
                            )
                        })?;
                    history_store::record_external_revision(
                        &note_id,
                        &path,
                        &published_markdown,
                        authoritative_observed_at_millis,
                        modified_at_millis,
                    )?;
                    merge_note_mutation_warning(
                        &mut lifecycle_projection_warning,
                        MutationWarningStage::HistoryFinalization,
                        "The note lifecycle changed and a newer external edit was preserved",
                        format!(
                            "Authoritative authored content at {} differed from its retained lifecycle publication",
                            path.display()
                        ),
                    );
                }
                lifecycle_projection_warning = match kind {
                    LifecycleEventKind::Forgotten => {
                        let projection_warning = previous_path
                            .as_deref()
                            .and_then(|path| self.synchronize_forgotten_projection(path));
                        merge_optional_note_mutation_warning(
                            lifecycle_projection_warning,
                            projection_warning,
                        )
                    }
                    LifecycleEventKind::Recovered => merge_optional_note_mutation_warning(
                        lifecycle_projection_warning,
                        self.synchronize_recovered_projection(
                            &path,
                            published_markdown.clone(),
                            observed_at_millis,
                        ),
                    ),
                    _ => None,
                };
            }
            _ => {}
        }
        Ok(ObservationReceipt {
            source,
            kind,
            path,
            previous_path,
            observed_at_millis,
            modified_at_millis,
            commit_warning: lifecycle_projection_warning,
        })
    }

    pub(crate) fn lifecycle(
        &self,
        operation: NoteLifecycleOperation,
    ) -> Result<LifecycleReceipt, String> {
        let NoteLifecycleOperation {
            kind,
            note_id,
            path,
            previous_path,
            occurred_at_millis,
        } = operation;
        if kind != LifecycleEventKind::Purged {
            return Err(
                "Forgotten and Recovered transitions require lifecycle publication".to_string(),
            );
        }
        crate::state::with_note_file_mutation(|| {
            let _timeline_operation = self.runtime.begin_operation()?;
            let _current_content_mutation = self.begin_current_content_mutation()?;
            self.with_settled_history_mutation(|| {
                self.purge_note_under_mutation_boundary(&note_id, &path, occurred_at_millis)
            })
        })?;
        Ok(LifecycleReceipt {
            kind,
            note_id,
            path,
            previous_path,
            occurred_at_millis,
        })
    }

    /// Durably retain, publish, and finalize one app-owned Forgotten or
    /// Recovered transition while holding the timeline mutation/replay seam.
    pub(crate) fn publish_lifecycle(
        &self,
        operation: NoteLifecycleOperation,
        canonical_markdown: &str,
        publish: impl FnOnce() -> Result<(), LifecyclePublicationFailure>,
    ) -> Result<LifecyclePublicationResult, String> {
        crate::state::with_note_file_mutation(|| {
            let _timeline_operation = self.runtime.begin_operation()?;
            let _current_content_mutation = self.begin_current_content_mutation()?;
            self.runtime.with_observation_replay(|| {
                self.recover_pending_deletions()?;
                self.replay_retained_observations(None)?;
                self.ensure_history_recovered(RecoveryIntegrity::Exhaustive)?;
                self.publish_lifecycle_under_mutation_boundary(
                    operation,
                    canonical_markdown,
                    publish,
                )
            })
        })
    }

    fn publish_lifecycle_under_mutation_boundary(
        &self,
        operation: NoteLifecycleOperation,
        canonical_markdown: &str,
        publish: impl FnOnce() -> Result<(), LifecyclePublicationFailure>,
    ) -> Result<LifecyclePublicationResult, String> {
        if !matches!(
            operation.kind,
            LifecycleEventKind::Forgotten | LifecycleEventKind::Recovered
        ) {
            return Err(
                "Only Forgotten or Recovered lifecycle publications can be prepared".to_string(),
            );
        }
        let embedded_note_id = crate::note::parse_note(canonical_markdown)
            .frontmatter
            .managed
            .map(|metadata| metadata.id)
            .filter(|note_id| !note_id.trim().is_empty())
            .ok_or_else(|| {
                "Lifecycle publication preparation requires a managed Note Identity".to_string()
            })?;
        if embedded_note_id != operation.note_id.as_str() {
            return Err(
                "Lifecycle publication identity does not match its Note Timeline".to_string(),
            );
        }

        let observation = VaultObservation::lifecycle(
            VaultObservationSource::Reconciliation,
            operation.kind,
            operation.path.clone(),
            operation.previous_path.clone(),
            operation.occurred_at_millis,
        )
        .with_canonical_markdown(canonical_markdown.to_string());
        let sequence = history_store::retain_observation(&observation)?;
        let (commit_warning, publication_indeterminate) = match publish() {
            Ok(()) => {
                let warning = match self.replay_retained_observations(Some(sequence)) {
                    Ok(Some(receipt)) => receipt.commit_warning().cloned(),
                    Ok(None) => Some(NoteMutationWarning::single(
                        MutationWarningStage::HistoryFinalization,
                        "The note lifecycle changed, but its Note Timeline record is awaiting recovery"
                            .to_string(),
                        format!("Retained lifecycle observation {sequence} was not replayed"),
                    )),
                    Err(error) => Some(NoteMutationWarning::single(
                        MutationWarningStage::HistoryFinalization,
                        "The note lifecycle changed, but its Note Timeline record is awaiting recovery"
                            .to_string(),
                        error,
                    )),
                };
                (warning, false)
            }
            Err(LifecyclePublicationFailure::NotPublished(error)) => {
                return Err(match history_store::acknowledge_observation(sequence) {
                    Ok(()) => error,
                    Err(abandon_error) => format!(
                        "{error}; additionally failed to abandon its lifecycle intent: {abandon_error}"
                    ),
                });
            }
            Err(LifecyclePublicationFailure::Indeterminate(error)) => (
                Some(NoteMutationWarning::single(
                    MutationWarningStage::HistoryFinalization,
                    "The note lifecycle publication is awaiting recovery".to_string(),
                    error,
                )),
                true,
            ),
        };
        if publication_indeterminate {
            let _ = self
                .state
                .mark_notes_index_dirty(&operation.path, "lifecycle-publication-retry");
            if let Some(previous_path) = operation.previous_path.as_deref() {
                let _ = self
                    .state
                    .mark_notes_index_dirty(previous_path, "lifecycle-publication-retry");
            }
        }
        Ok(LifecyclePublicationResult {
            receipt: LifecycleReceipt {
                kind: operation.kind,
                note_id: operation.note_id,
                path: operation.path,
                previous_path: operation.previous_path,
                occurred_at_millis: operation.occurred_at_millis,
            },
            commit_warning,
        })
    }

    pub(crate) fn recover_lifecycle_publications(&self) -> Result<(), String> {
        let _timeline_operation = self.runtime.begin_operation()?;
        self.runtime.with_observation_replay(|| {
            self.recover_pending_deletions()?;
            self.replay_retained_observations(None).map(|_| ())
        })
    }

    fn synchronize_forgotten_projection(&self, path: &Path) -> Option<NoteMutationWarning> {
        self.synchronize_inactive_projection(path, LifecycleEventKind::Forgotten)
    }

    fn synchronize_missing_projection(&self, path: &Path) -> Option<NoteMutationWarning> {
        self.synchronize_inactive_projection(path, LifecycleEventKind::Missing)
    }

    fn synchronize_inactive_projection(
        &self,
        path: &Path,
        kind: LifecycleEventKind,
    ) -> Option<NoteMutationWarning> {
        let (lifecycle_label, retry_label) = match kind {
            LifecycleEventKind::Forgotten => ("forgotten", "forgotten-note"),
            LifecycleEventKind::Missing => ("missing", "missing-note"),
            _ => unreachable!("only inactive lifecycle events remove current projections"),
        };
        let mut warning = None;
        let warning_message =
            format!("The note was {lifecycle_label} with incomplete search synchronization");
        if let Err(error) = self.state.semantic.queue_delete_note(path) {
            merge_note_mutation_warning(
                &mut warning,
                MutationWarningStage::SemanticUpdate,
                &warning_message,
                error,
            );
            let _ = self
                .state
                .mark_notes_index_dirty(path, &format!("{retry_label}-semantic-retry"));
        }
        if let Err(error) = self.state.remove_note_indexes(path) {
            merge_note_mutation_warning(
                &mut warning,
                MutationWarningStage::CatalogRemove,
                &warning_message,
                error,
            );
            let _ = self
                .state
                .mark_notes_index_dirty(path, &format!("{retry_label}-catalog-retry"));
        }
        warning
    }

    pub(crate) fn missing_notes(&self) -> Result<Vec<MissingNoteRecord>, String> {
        let _operation = self.runtime.begin_operation()?;
        self.recover_retained_observations()?;
        self.ensure_history_recovered(RecoveryIntegrity::Bounded)?;
        history_store::missing_notes()
    }

    pub(crate) fn missing_note_history_page(
        &self,
        note_id: NoteIdentity,
        cursor: Option<&str>,
        limit: usize,
    ) -> Result<HistoryModePage, String> {
        let _operation = self.runtime.begin_operation()?;
        self.recover_retained_observations()?;
        self.ensure_history_recovered(RecoveryIntegrity::Bounded)?;
        let manifest = crate::state::read_vault_manifest_for(&crate::state::vault_root()?)?
            .ok_or_else(|| "Missing Note history requires a vault manifest".to_string())?;
        let continuation = cursor.map(MissingHistoryCursor::decode).transpose()?;
        if continuation.as_ref().is_some_and(|continuation| {
            continuation.version != MISSING_HISTORY_CURSOR_VERSION
                || continuation.vault_id != manifest.vault_id
                || continuation.note_id != note_id.as_str()
                || continuation.history_generation != manifest.history_generation
        }) {
            return Err(MISSING_HISTORY_CURSOR_ERROR.to_string());
        }
        if history_store::missing_note(&note_id)?.is_none() {
            return Err(if continuation.is_some() {
                MISSING_HISTORY_CURSOR_ERROR.to_string()
            } else {
                "Missing Note is no longer available for recovery".to_string()
            });
        }
        let start = continuation
            .as_ref()
            .map(MissingHistoryCursor::record_identity);
        let page = match history_store::bounded_timeline_page(&note_id, start, limit)? {
            history_store::BoundedTimelinePageRead::Page(page) => page,
            history_store::BoundedTimelinePageRead::CursorUnavailable => {
                return Err(MISSING_HISTORY_CURSOR_ERROR.to_string())
            }
        };
        // Ordinary History Mode ordinals are oldest-first before its records
        // are reversed. Carrying the next absolute ordinal keeps each bounded
        // slice in that same deterministic order without loading older rows.
        let first_ordinal = match &continuation {
            Some(continuation) if continuation.next_timeline_ordinal < page.total_records => {
                continuation.next_timeline_ordinal
            }
            Some(_) => return Err(MISSING_HISTORY_CURSOR_ERROR.to_string()),
            None => page.total_records.saturating_sub(1),
        };
        let record_count = page.records.len();
        let mut records = Vec::with_capacity(record_count);
        for (index, record) in page.records.into_iter().enumerate() {
            let timeline_ordinal = first_ordinal.saturating_sub(index);
            let projected = match record {
                history_store::BoundedTimelineRecord::Revision { header, label } => {
                    let revision_id = header.identity.clone();
                    let reconstructed = history_store::reconstruct(&note_id, &revision_id)?;
                    project_revision_header(
                        header,
                        label,
                        timeline_ordinal,
                        authored_content_counts(&reconstructed),
                    )
                }
                history_store::BoundedTimelineRecord::LifecycleEvent(event) => {
                    project_lifecycle_header(event, timeline_ordinal)
                }
            };
            records.push(projected);
        }
        let next_cursor = match page.next_record {
            Some(next_record) => {
                let next_ordinal = first_ordinal.checked_sub(record_count).ok_or_else(|| {
                    "Note Timeline record count does not match its lineage".to_string()
                })?;
                Some(
                    MissingHistoryCursor::for_record(
                        &note_id,
                        &manifest.vault_id,
                        manifest.history_generation,
                        &next_record,
                        next_ordinal,
                    )
                    .encode()?,
                )
            }
            None => None,
        };
        Ok(HistoryModePage {
            records,
            next_cursor,
        })
    }

    pub(crate) fn recover_missing_note(
        &self,
        note_id: NoteIdentity,
    ) -> Result<LifecyclePublicationResult, String> {
        crate::state::with_note_file_mutation(|| {
            let _operation = self.runtime.begin_operation()?;
            self.with_settled_history_mutation(|| {
                let recovered_at_millis = crate::time::current_time_millis()?;
                let missing = history_store::missing_note(&note_id)?.ok_or_else(|| {
                    "Missing Note is no longer available for recovery".to_string()
                })?;
                if missing.purge_at_millis() <= recovered_at_millis {
                    self.purge_missing_note_under_mutation_boundary(
                        &note_id,
                        missing.path(),
                        recovered_at_millis,
                    )?;
                    return Err(
                        "Missing Note recovery deadline expired; its timeline was permanently purged"
                            .to_string(),
                    );
                }
                let retained = history_store::reconstruct_latest(&note_id)?;
                let canonical = canonical_markdown_for_recovered_note(&note_id, &retained)?;
                let preferred_path = missing.path().to_path_buf();
                let target_path = if preferred_path.exists() {
                    unique_path_in_dir(
                        preferred_path.parent().unwrap_or_else(|| Path::new(".")),
                        preferred_path.file_name().unwrap_or_default(),
                        "Recovered Note",
                    )
                } else {
                    preferred_path.clone()
                };
                if let Some(parent) = target_path.parent() {
                    fs::create_dir_all(parent).map_err(|error| {
                        format!(
                            "Create Missing Note recovery directory {}: {error}",
                            parent.display()
                        )
                    })?;
                }
                self.publish_lifecycle_under_mutation_boundary(
                    NoteLifecycleOperation::recovered(
                        note_id,
                        preferred_path,
                        target_path.clone(),
                        recovered_at_millis,
                    ),
                    &canonical,
                    || {
                        let expected = crate::vault_watcher::record_expected_write(
                            &target_path,
                            &canonical,
                        );
                        crate::state::atomic_create_note(&target_path, canonical.as_bytes())
                            .map_err(LifecyclePublicationFailure::not_published)?;
                        expected.commit();
                        Ok(())
                    },
                )
            })
        })
    }

    pub(crate) fn purge_expired_missing_notes(&self, now_millis: u64) -> Result<(), String> {
        crate::state::with_note_file_mutation(|| {
            let _operation = self.runtime.begin_operation()?;
            self.with_settled_history_mutation(|| {
                for missing in history_store::missing_notes()?
                    .into_iter()
                    .filter(|missing| missing.purge_at_millis() <= now_millis)
                {
                    self.purge_missing_note_under_mutation_boundary(
                        missing.note_id(),
                        missing.path(),
                        now_millis,
                    )?;
                }
                Ok(())
            })
        })
    }

    pub(crate) fn purge_missing_notes(
        &self,
        note_ids: &[NoteIdentity],
        occurred_at_millis: u64,
    ) -> Result<(), String> {
        let selected = note_ids
            .iter()
            .map(|note_id| note_id.as_str())
            .collect::<HashSet<_>>();
        crate::state::with_note_file_mutation(|| {
            let _operation = self.runtime.begin_operation()?;
            self.with_settled_history_mutation(|| {
                let missing = history_store::missing_notes()?;
                for note_id in note_ids {
                    if !missing.iter().any(|missing| missing.note_id() == note_id) {
                        return Err(format!(
                            "Missing Note {} is no longer available for deletion",
                            note_id.as_str()
                        ));
                    }
                }
                for missing in missing
                    .into_iter()
                    .filter(|missing| selected.contains(missing.note_id().as_str()))
                {
                    self.purge_missing_note_under_mutation_boundary(
                        missing.note_id(),
                        missing.path(),
                        occurred_at_millis,
                    )?;
                }
                Ok(())
            })
        })
    }

    fn synchronize_recovered_projection(
        &self,
        path: &Path,
        canonical_markdown: String,
        modified_at_millis: u64,
    ) -> Option<NoteMutationWarning> {
        let mut warning = None;
        let note = build_indexed_note(path, &canonical_markdown, modified_at_millis);
        if let Err(error) = self.state.upsert_note_indexes(path.to_path_buf(), note) {
            merge_note_mutation_warning(
                &mut warning,
                MutationWarningStage::CatalogUpsert,
                "The note was recovered with incomplete search synchronization",
                error,
            );
            let _ = self
                .state
                .mark_notes_index_dirty(path, "recovered-note-catalog-retry");
        }
        if let Err(error) =
            self.state
                .semantic
                .queue_note_update(path, canonical_markdown, modified_at_millis)
        {
            merge_note_mutation_warning(
                &mut warning,
                MutationWarningStage::SemanticUpdate,
                "The note was recovered with incomplete search synchronization",
                error,
            );
            let _ = self
                .state
                .mark_notes_index_dirty(path, "recovered-note-semantic-retry");
        }
        warning
    }

    pub(crate) fn history_mode(&self, grant: HistoryModeGrant) -> HistoryModeAccess<'a> {
        HistoryModeAccess {
            state: self.state,
            note_id: grant.note_id,
        }
    }

    pub(crate) fn open_history_mode(&self, note_id: NoteIdentity) -> HistoryModeAccess<'a> {
        self.history_mode(HistoryModeGrant::authorized(note_id))
    }

    pub(crate) fn current_content(&self, scope: AllowedScope) -> CurrentContentAccess<'a> {
        CurrentContentAccess {
            state: self.state,
            runtime: self.runtime,
            scope,
        }
    }

    pub(crate) fn agent_restore(
        &self,
        grant: ExplicitRestoreGrant,
    ) -> Result<AgentRestoreAccess<'a>, String> {
        let _operation = prepare_recovered_note_access(self.state, &grant.note_id)?;
        Ok(AgentRestoreAccess {
            _state: self.state,
            grant,
        })
    }
}

#[cfg(test)]
pub(crate) fn reset_history_integrity_snapshot_count_for_test() {
    history_store::reset_integrity_snapshot_count();
}

#[cfg(test)]
pub(crate) fn history_integrity_snapshot_count_for_test() -> usize {
    history_store::integrity_snapshot_count()
}

#[cfg(test)]
pub(crate) fn inject_history_finalization_failure_once() {
    history_store::inject_fault_once(history_store::FaultPoint::Finalize);
}

#[cfg(test)]
pub(crate) fn prepared_history_intent_count_for_test(status: &str) -> u64 {
    history_store::prepared_intent_count(status)
}

#[cfg(test)]
pub(crate) fn retained_observation_count_for_test() -> u64 {
    history_store::retained_observation_count()
}

#[cfg(test)]
pub(crate) fn reconstructed_revision_bodies_for_test(
    state: &AppState,
    note_id: &str,
) -> Result<Vec<String>, String> {
    let timeline = state.note_timeline();
    let history = timeline.history_mode(HistoryModeGrant::authorized(NoteIdentity::new(note_id)));
    history
        .revisions()?
        .into_iter()
        .map(|revision| {
            history
                .reconstruct(revision.identity())
                .map(|revision| revision.body().to_string())
        })
        .collect()
}

#[cfg(test)]
pub(crate) fn inject_history_recovery_failure_once() {
    history_store::inject_fault_once(history_store::FaultPoint::Recover);
}

#[cfg(test)]
pub(crate) fn inject_history_baseline_failure_once() {
    history_store::inject_fault_once(history_store::FaultPoint::Baseline);
}

#[cfg(test)]
pub(crate) fn corrupt_note_revision_payload_for_test(note_id: &NoteIdentity) {
    history_store::replace_revision_payload_version(note_id, 99);
}

#[cfg(test)]
pub(crate) fn replace_one_revision_source_for_test(
    note_id: &NoteIdentity,
    revision_id: &RevisionIdentity,
    source: &str,
) {
    history_store::replace_one_revision_source(note_id, revision_id, source);
}

#[cfg(test)]
pub(crate) fn inject_history_deletion_failure_once() {
    history_store::inject_fault_once(history_store::FaultPoint::Deletion);
}

#[cfg(test)]
pub(crate) fn inject_history_clean_close_failure_once() {
    history_store::inject_fault_once(history_store::FaultPoint::Close);
}

#[cfg(test)]
pub(crate) fn inject_lifecycle_finalization_failure_once() {
    history_store::inject_fault_once(history_store::FaultPoint::Lifecycle);
}

#[cfg(test)]
fn inject_purge_staging_failure_once() {
    FAIL_NEXT_PURGE_STAGE.store(true, std::sync::atomic::Ordering::SeqCst);
}

#[cfg(test)]
fn inject_purge_projection_cleanup_failure_once() {
    FAIL_NEXT_PURGE_PROJECTION_CLEANUP.store(true, std::sync::atomic::Ordering::SeqCst);
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{app::EventBus, index::AppState, semantic::SemanticState};
    use std::{
        fs,
        path::PathBuf,
        sync::{mpsc, Arc, Barrier},
        thread,
        time::Duration,
    };

    struct TestCurrentContentItem {
        note_id: String,
        note_path: String,
    }

    impl CurrentContentItem for TestCurrentContentItem {
        fn current_content_reference(&self) -> CurrentContentReference<'_> {
            CurrentContentReference::ordinary_note(Some(&self.note_id), Some(&self.note_path))
        }
    }

    fn copy_file(source: &Path, destination: &Path) {
        if let Some(parent) = destination.parent() {
            fs::create_dir_all(parent).unwrap();
        }
        fs::copy(source, destination).unwrap();
    }

    fn prepare_test_history(
        source: MutationSource,
        path: &Path,
        markdown: &str,
    ) -> PreparedHistoryIntent {
        crate::state::ensure_vault_scaffold(&crate::state::vault_root().expect("test vault root"))
            .expect("test vault scaffold");
        history_store::prepare_publication(
            source,
            path,
            markdown,
            if source == MutationSource::NoteCreation {
                history_store::PublicationIntentKind::Create
            } else {
                history_store::PublicationIntentKind::Update
            },
            None,
        )
        .expect("prepare test history intent")
    }

    fn projected_revision(
        revision_id: &str,
        source: MutationSource,
        occurred_at_millis: u64,
    ) -> HistoryModeRecord {
        HistoryModeRecord::Revision {
            record_id: revision_id.to_string(),
            revision_id: revision_id.to_string(),
            source,
            occurred_at_millis,
            timeline_ordinal: 0,
            time_kind: HistoryModeRevisionTimeKind::Committed,
            modified_at_millis: None,
            editing_session_id: None,
            revision_label: None,
            line_count: 0,
            character_count: 0,
        }
    }

    fn editing_session_id(record: &HistoryModeRecord) -> Option<&str> {
        match record {
            HistoryModeRecord::Revision {
                editing_session_id, ..
            } => editing_session_id.as_deref(),
            HistoryModeRecord::LifecycleEvent { .. } => None,
        }
    }

    #[test]
    fn named_revisions_survive_restart_allow_duplicates_and_never_change_content() {
        let _guard = crate::test_support::lock_test_env();
        let app_data = crate::test_support::TestDir::new("timeline-named-revisions-app-data");
        crate::state::initialize_app_data_dir(app_data.path().to_path_buf()).unwrap();
        let notes = crate::test_support::TestDir::new("timeline-named-revisions-notes");
        crate::state::set_notes_root_override(Some(notes.path().to_path_buf())).unwrap();
        crate::state::ensure_vault_scaffold(notes.path()).unwrap();
        let state = AppState::new(
            SemanticState::new_disabled("disabled"),
            EventBus::disabled(),
        )
        .unwrap();
        let created = crate::commands::note_persistence::persist_note_session_with_outcome(
            &state,
            "Named history".to_string(),
            "First state".to_string(),
            None,
        )
        .unwrap()
        .session
        .unwrap();
        let note_id = NoteIdentity::new(created.note_id.unwrap());
        let path = PathBuf::from(created.path.unwrap());
        crate::commands::note_persistence::persist_note_session_with_outcome(
            &state,
            "Named history".to_string(),
            "Second state".to_string(),
            Some(path.to_string_lossy().into_owned()),
        )
        .unwrap();

        let history = state.note_timeline().open_history_mode(note_id.clone());
        let revisions = history.revisions().unwrap();
        let first_id = revisions[0].identity().0.clone();
        let second_id = revisions[1].identity().0.clone();
        let bodies_before = revisions
            .iter()
            .map(|revision| history.reconstruct(revision.identity()).unwrap().body)
            .collect::<Vec<_>>();
        history
            .name_revision(&RevisionIdentity::from_persisted(&first_id), "Milestone")
            .unwrap();
        history
            .name_revision(&RevisionIdentity::from_persisted(&second_id), "Milestone")
            .unwrap();

        let restarted = AppState::new(
            SemanticState::new_disabled("disabled"),
            EventBus::disabled(),
        )
        .unwrap();
        let restarted_history = restarted.note_timeline().open_history_mode(note_id);
        let page = restarted_history.page(None, 100).unwrap();
        assert_eq!(
            page.records()
                .iter()
                .filter_map(HistoryModeRecord::revision_label)
                .collect::<Vec<_>>(),
            vec!["Milestone", "Milestone"]
        );

        restarted_history
            .name_revision(&RevisionIdentity::from_persisted(&first_id), "Foundation")
            .unwrap();
        restarted_history
            .remove_revision_name(&RevisionIdentity::from_persisted(&second_id))
            .unwrap();
        let page = restarted_history.page(None, 100).unwrap();
        assert_eq!(
            page.records()
                .iter()
                .filter_map(HistoryModeRecord::revision_label)
                .collect::<Vec<_>>(),
            vec!["Foundation"]
        );
        let revisions_after = restarted_history.revisions().unwrap();
        assert_eq!(
            revisions_after
                .iter()
                .map(|revision| restarted_history
                    .reconstruct(revision.identity())
                    .unwrap()
                    .body)
                .collect::<Vec<_>>(),
            bodies_before
        );
        assert_eq!(
            revisions_after
                .iter()
                .map(|revision| revision.identity().0.clone())
                .collect::<Vec<_>>(),
            vec![first_id, second_id]
        );
        crate::state::set_notes_root_override(None).unwrap();
    }

    #[test]
    fn editing_sessions_split_at_the_five_minute_boundary() {
        let mut records = vec![
            projected_revision("revision-4", MutationSource::Editor, 899_001),
            projected_revision("revision-3", MutationSource::Editor, 599_000),
            projected_revision("revision-2", MutationSource::Editor, 299_000),
            projected_revision("revision-1", MutationSource::Editor, 0),
        ];

        assign_editing_sessions(&mut records);

        assert_eq!(editing_session_id(&records[3]), Some("revision-1"));
        assert_eq!(editing_session_id(&records[2]), Some("revision-1"));
        assert_eq!(editing_session_id(&records[1]), Some("revision-3"));
        assert_eq!(editing_session_id(&records[0]), Some("revision-4"));
    }

    #[test]
    fn editing_sessions_split_on_source_lifecycle_and_version_restore_boundaries() {
        let mut records = vec![
            projected_revision("revision-6", MutationSource::TaskAction, 300_000),
            projected_revision("restore", MutationSource::VersionRestore, 240_000),
            projected_revision("revision-5", MutationSource::TaskAction, 180_000),
            HistoryModeRecord::LifecycleEvent {
                record_id: "event-1".to_string(),
                event_id: "event-1".to_string(),
                event_kind: LifecycleEventKind::Renamed,
                occurred_at_millis: 150_000,
                timeline_ordinal: 0,
                previous_path: Some("/vault/Before.md".to_string()),
                path: Some("/vault/After.md".to_string()),
            },
            projected_revision("revision-3", MutationSource::TaskAction, 120_000),
            projected_revision("revision-2", MutationSource::TaskAction, 60_000),
            projected_revision("revision-1", MutationSource::Editor, 0),
        ];
        let revision_ids_before = records
            .iter()
            .filter_map(HistoryModeRecord::revision_id)
            .map(str::to_string)
            .collect::<Vec<_>>();

        assign_editing_sessions(&mut records);

        assert_eq!(editing_session_id(&records[6]), Some("revision-1"));
        assert_eq!(editing_session_id(&records[5]), Some("revision-2"));
        assert_eq!(editing_session_id(&records[4]), Some("revision-2"));
        assert_eq!(editing_session_id(&records[2]), Some("revision-5"));
        assert_eq!(editing_session_id(&records[1]), None);
        assert_eq!(editing_session_id(&records[0]), Some("revision-6"));
        assert_eq!(
            records
                .iter()
                .filter_map(HistoryModeRecord::revision_id)
                .collect::<Vec<_>>(),
            revision_ids_before
                .iter()
                .map(String::as_str)
                .collect::<Vec<_>>()
        );
    }

    #[test]
    fn revision_summaries_count_unicode_authored_content_deterministically() {
        let revision = ReconstructedNoteRevision {
            unmanaged_frontmatter: Some("project: atlas\n".to_string()),
            body: "Hello 🌍\nagain".to_string(),
        };

        assert_eq!(authored_content_counts(&revision), (3, 28));
        assert_eq!(
            authored_content_counts(&ReconstructedNoteRevision {
                unmanaged_frontmatter: None,
                body: String::new(),
            }),
            (0, 0)
        );
    }

    #[test]
    fn historical_diffs_compare_parent_and_current_authored_state_and_report_missing_assets() {
        let _guard = crate::test_support::lock_test_env();
        let app_data = crate::test_support::TestDir::new("timeline-diff-app-data");
        crate::state::initialize_app_data_dir(app_data.path().to_path_buf()).unwrap();
        let notes = crate::test_support::TestDir::new("timeline-diff-notes");
        crate::state::set_notes_root_override(Some(notes.path().to_path_buf())).unwrap();
        crate::state::ensure_vault_scaffold(notes.path()).unwrap();
        fs::create_dir_all(notes.path().join("assets")).unwrap();
        fs::write(notes.path().join("assets/present.png"), b"image").unwrap();
        fs::write(notes.path().join("assets/present.pdf"), b"pdf").unwrap();
        let state = AppState::new(
            SemanticState::new_disabled("disabled"),
            EventBus::disabled(),
        )
        .unwrap();

        let first = "---\nproject: atlas\n---\n\nKept\nRemoved\n*old*\n";
        let created = crate::commands::note_persistence::persist_note_session_with_outcome(
            &state,
            "Diff note".to_string(),
            first.to_string(),
            None,
        )
        .unwrap()
        .session
        .unwrap();
        let path = created.path.clone().unwrap();
        let note_id = NoteIdentity::new(created.note_id.unwrap());
        let second = "---\nproject: zeus\n---\n\nKept\nInserted\n**new**\n![[present.png]]\n![[present.pdf]]\n![[missing.png|320]]\n![[missing.pdf]]\n[recording](assets/missing.mp3)\n[workbook](assets/report(2026).xlsx)\n`![[inline-code.zip]]`\n```md\n![[fenced-code.wav]]\n```\n";
        crate::commands::note_persistence::persist_note_session_with_outcome(
            &state,
            "Diff note".to_string(),
            second.to_string(),
            Some(path.clone()),
        )
        .unwrap();
        let current = "---\nproject: zeus\nstatus: current\n---\n\nKept\nCurrent ending\n";
        crate::commands::note_persistence::persist_note_session_with_outcome(
            &state,
            "Diff note".to_string(),
            current.to_string(),
            Some(path),
        )
        .unwrap();

        let history = state
            .note_timeline()
            .history_mode(HistoryModeGrant::authorized(note_id));
        let revisions = history.revisions().unwrap();
        assert_eq!(revisions.len(), 3);
        let selected_id = revisions[1].identity();

        let parent = history
            .diff(&selected_id.0, HistoryDiffComparison::Parent)
            .unwrap();
        assert_eq!(parent.comparison(), HistoryDiffComparison::Parent);
        assert_eq!(
            parent.from_revision_id(),
            Some(revisions[0].identity().0.as_str())
        );
        assert_eq!(parent.to_revision_id(), revisions[1].identity().0.as_str());
        assert!(parent.body_lines().iter().any(|line| {
            line.kind() == HistoryDiffLineKind::Removed && line.text() == "Removed\n"
        }));
        assert!(parent.body_lines().iter().any(|line| {
            line.kind() == HistoryDiffLineKind::Added && line.text() == "Inserted\n"
        }));
        assert!(parent.properties_lines().iter().any(|line| {
            line.kind() == HistoryDiffLineKind::Removed && line.text() == "project: atlas\n"
        }));
        assert!(parent.properties_lines().iter().any(|line| {
            line.kind() == HistoryDiffLineKind::Added && line.text() == "project: zeus\n"
        }));
        assert_eq!(
            parent.missing_assets(),
            &[
                "missing.mp3".to_string(),
                "missing.pdf".to_string(),
                "missing.png".to_string(),
                "report(2026).xlsx".to_string()
            ]
        );
        assert!(parent
            .body_lines()
            .iter()
            .all(|line| !line.text().contains("gneauxghts")));
        assert!(parent
            .properties_lines()
            .iter()
            .all(|line| !line.text().contains("gneauxghts")
                && !line.text().contains("created_at")
                && !line.text().contains("updated_at")));

        let current_diff = history
            .diff(&selected_id.0, HistoryDiffComparison::Current)
            .unwrap();
        assert_eq!(
            current_diff.from_revision_id(),
            Some(revisions[1].identity().0.as_str())
        );
        assert_eq!(
            current_diff.to_revision_id(),
            revisions[2].identity().0.as_str()
        );
        assert!(current_diff.body_lines().iter().any(|line| {
            line.kind() == HistoryDiffLineKind::Added && line.text() == "Current ending\n"
        }));
        assert!(current_diff.properties_lines().iter().any(|line| {
            line.kind() == HistoryDiffLineKind::Added && line.text() == "status: current\n"
        }));
        assert_eq!(
            current_diff.missing_assets(),
            &[
                "missing.mp3".to_string(),
                "missing.pdf".to_string(),
                "missing.png".to_string(),
                "report(2026).xlsx".to_string()
            ]
        );

        crate::state::set_notes_root_override(None).unwrap();
    }

    #[test]
    fn historical_line_diffs_cover_empty_content_without_inventing_lines() {
        assert!(diff_lines("", "").is_empty());
        assert_eq!(
            diff_lines("", "First line without a newline"),
            vec![HistoryDiffLine {
                kind: HistoryDiffLineKind::Added,
                text: "First line without a newline".to_string(),
                old_line_number: None,
                new_line_number: Some(1),
            }]
        );
        assert_eq!(
            diff_lines("Last content\n", ""),
            vec![HistoryDiffLine {
                kind: HistoryDiffLineKind::Removed,
                text: "Last content\n".to_string(),
                old_line_number: Some(1),
                new_line_number: None,
            }]
        );
    }

    #[test]
    fn timeline_order_and_session_boundaries_follow_predecessors_at_timestamp_ties() {
        let ordered = order_history_mode_records(vec![
            (
                projected_revision("z-first", MutationSource::Editor, 100),
                None,
            ),
            (
                HistoryModeRecord::LifecycleEvent {
                    record_id: "a-event".to_string(),
                    event_id: "a-event".to_string(),
                    event_kind: LifecycleEventKind::Renamed,
                    occurred_at_millis: 100,
                    timeline_ordinal: 0,
                    previous_path: Some("/vault/Before.md".to_string()),
                    path: Some("/vault/After.md".to_string()),
                },
                Some("z-first".to_string()),
            ),
            (
                projected_revision("m-last", MutationSource::Editor, 100),
                Some("a-event".to_string()),
            ),
        ])
        .unwrap();

        assert_eq!(
            ordered
                .iter()
                .map(HistoryModeRecord::record_id)
                .collect::<Vec<_>>(),
            vec!["m-last", "a-event", "z-first"]
        );
        assert_eq!(editing_session_id(&ordered[2]), Some("z-first"));
        assert_eq!(editing_session_id(&ordered[0]), Some("m-last"));
    }

    #[test]
    fn editor_mutation_assigns_its_closed_source() {
        let mutation = NoteMutation::editor(
            PreparedHistoryIntent::for_test("editor-intent"),
            PathBuf::from("/vault/Note.md"),
            None,
            "# Note\n\nBody".to_string(),
        );

        assert_eq!(mutation.source(), MutationSource::Editor);
        assert_eq!(mutation.path(), PathBuf::from("/vault/Note.md"));
    }

    #[test]
    fn typed_entrypoints_cover_the_closed_mutation_source_vocabulary() {
        let path = PathBuf::from("/vault/Note.md");
        let markdown = "# Note\n\nBody".to_string();
        let mutations = [
            NoteMutation::task_action(
                PreparedHistoryIntent::for_test("task-intent"),
                path.clone(),
                None,
                markdown.clone(),
            ),
            NoteMutation::accepted_chat_proposal(
                PreparedHistoryIntent::for_test("proposal-intent"),
                path.clone(),
                None,
                markdown.clone(),
            ),
            NoteMutation::version_restore(
                PreparedHistoryIntent::for_test("restore-intent"),
                path.clone(),
                None,
                markdown.clone(),
            ),
            NoteMutation::note_creation(
                PreparedHistoryIntent::for_test("creation-intent"),
                path.clone(),
                None,
                markdown.clone(),
            ),
            NoteMutation::baseline_initialization(
                PreparedHistoryIntent::for_test("baseline-intent"),
                path.clone(),
                None,
                markdown.clone(),
            ),
            NoteMutation::recovery_reconciliation(
                PreparedHistoryIntent::for_test("recovery-intent"),
                path.clone(),
                None,
                markdown.clone(),
            ),
        ];

        assert_eq!(
            mutations.map(|mutation| mutation.source()),
            [
                MutationSource::TaskAction,
                MutationSource::AcceptedChatProposal,
                MutationSource::VersionRestore,
                MutationSource::NoteCreation,
                MutationSource::BaselineInitialization,
                MutationSource::RecoveryReconciliation,
            ]
        );
        let observation = VaultObservation::external_edit(path, 42, Some(41));
        assert_eq!(observation.source(), VaultObservationSource::Watcher);
        assert_eq!(observation.kind(), VaultObservationKind::CanonicalState);
        let reconciled =
            VaultObservation::reconciled_state(PathBuf::from("/vault/Reconciled.md"), 43, Some(40));
        assert_eq!(reconciled.source(), VaultObservationSource::Reconciliation);
        let scan = VaultObservation::reconciliation_scan(PathBuf::from("/vault"), 44);
        assert_eq!(scan.source(), VaultObservationSource::Reconciliation);
        assert_eq!(scan.kind(), VaultObservationKind::ReconciliationScan);

        let lifecycle = [
            VaultObservation::renamed("/vault/Old.md", "/vault/New.md", 43),
            VaultObservation::moved("/vault/New.md", "/vault/Folder/New.md", 44),
            VaultObservation::missing("/vault/Folder/New.md", 45),
        ];
        assert_eq!(
            lifecycle.map(|observation| observation.kind()),
            [
                VaultObservationKind::Lifecycle(LifecycleEventKind::Renamed),
                VaultObservationKind::Lifecycle(LifecycleEventKind::Moved),
                VaultObservationKind::Lifecycle(LifecycleEventKind::Missing),
            ]
        );
    }

    #[test]
    fn publication_rejects_retained_identity_that_conflicts_with_catalog_owner() {
        let state = AppState::new(
            SemanticState::new_disabled("disabled"),
            EventBus::disabled(),
        )
        .expect("construct app state");
        let path = PathBuf::from("/vault/Current.md");
        let canonical = "---\ngneauxghts:\n  id: current-owner\n  kind: note\n---\n\nCurrent";
        state.notes_index.lock().unwrap().upsert_note(
            path.clone(),
            crate::index::build_indexed_note(&path, canonical, 41),
        );

        let error = state
            .note_timeline()
            .prepare_publication(
                Some(&path),
                Some(&NoteIdentity::new("stale-proposal-owner")),
                "Proposed authored content",
            )
            .expect_err("conflicting continuity evidence must not publish");

        assert!(error.contains("identity continuity conflict"));
        assert_eq!(
            state.indexed_note_identity(&path).unwrap().as_deref(),
            Some("current-owner")
        );
    }

    #[test]
    fn mutate_preserves_the_authoritative_publication_outcome() {
        let _guard = crate::test_support::lock_test_env();
        let app_data = crate::test_support::TestDir::new("timeline-pass-through-app-data");
        crate::state::initialize_app_data_dir(app_data.path().to_path_buf()).unwrap();
        let notes = crate::test_support::TestDir::new("timeline-pass-through-notes");
        crate::state::set_notes_root_override(Some(notes.path().to_path_buf())).unwrap();
        let note_path = notes.path().join("Note.md");
        let markdown = "---\ngneauxghts:\n  id: note-1\n  kind: note\n---\n\n# Note\n\nBody";
        fs::write(&note_path, markdown).expect("write canonical note");
        let state = AppState::new(
            SemanticState::new_disabled("disabled"),
            EventBus::disabled(),
        )
        .expect("construct app state");
        let history_intent = prepare_test_history(MutationSource::Editor, &note_path, markdown);

        let outcome = state.note_timeline().mutate(NoteMutation::editor(
            history_intent,
            note_path.clone(),
            None,
            markdown.to_string(),
        ));

        assert_eq!(outcome.payload_version(), PayloadVersion::V1);
        assert_eq!(outcome.source(), MutationSource::Editor);
        assert_eq!(outcome.note_id(), &NoteIdentity::new("note-1"));
        assert_eq!(outcome.path(), note_path);
        assert_eq!(outcome.canonical_markdown(), markdown);
        assert_eq!(outcome.warning(), None);
    }

    #[test]
    fn meaningful_commits_reconstruct_exact_authored_states_after_restart() {
        let _guard = crate::test_support::lock_test_env();
        let app_data = crate::test_support::TestDir::new("timeline-history-app-data");
        crate::state::initialize_app_data_dir(app_data.path().to_path_buf()).unwrap();
        let notes = crate::test_support::TestDir::new("timeline-history-notes");
        crate::state::set_notes_root_override(Some(notes.path().to_path_buf())).unwrap();
        crate::state::ensure_vault_scaffold(notes.path()).unwrap();
        let state = AppState::new(
            SemanticState::new_disabled("disabled"),
            EventBus::disabled(),
        )
        .unwrap();

        let first = "---\r\nproject: atlas\r\n---\r\n\r\nHello, 🌍\r\n";
        let before_publication = crate::time::current_time_millis().unwrap();
        let created = crate::commands::note_persistence::persist_note_session_with_outcome(
            &state,
            "Timeline".to_string(),
            first.to_string(),
            None,
        )
        .unwrap()
        .session
        .unwrap();
        let note_id = NoteIdentity::new(created.note_id.clone().unwrap());
        let path = created.path.clone().unwrap();

        // A managed timestamp refresh with identical authored content is not
        // a second revision.
        crate::commands::note_persistence::persist_note_session_with_outcome(
            &state,
            "Timeline".to_string(),
            first.to_string(),
            Some(path.clone()),
        )
        .unwrap();
        let second = "---\nproject: atlas\nstatus: done\n---\n\nReplacement 🦀\nwith two lines";
        crate::commands::note_persistence::persist_note_session_with_outcome(
            &state,
            "Timeline".to_string(),
            second.to_string(),
            Some(path),
        )
        .unwrap();
        let after_publication = crate::time::current_time_millis().unwrap();

        let restarted = AppState::new(
            SemanticState::new_disabled("disabled"),
            EventBus::disabled(),
        )
        .unwrap();
        let history = restarted
            .note_timeline()
            .history_mode(HistoryModeGrant::authorized(note_id.clone()));
        let revisions = history.revisions().unwrap();
        assert_eq!(revisions.len(), 2);
        assert_eq!(revisions[0].source(), MutationSource::NoteCreation);
        assert_eq!(revisions[1].source(), MutationSource::Editor);
        assert!(revisions
            .iter()
            .all(
                |revision| revision.committed_at_millis().is_some_and(|committed| {
                    (before_publication..=after_publication).contains(&committed)
                })
            ));
        let creation = history.lifecycle_events().unwrap();
        assert_eq!(creation.len(), 1);
        assert_eq!(creation[0].kind(), LifecycleEventKind::Created);
        assert_eq!(
            revisions[0].predecessor(),
            Some(&TimelineRecordIdentity::LifecycleEvent(
                creation[0].identity().clone()
            ))
        );

        let reconstructed_first = history.reconstruct(revisions[0].identity()).unwrap();
        assert_eq!(
            reconstructed_first.unmanaged_frontmatter(),
            Some("project: atlas\n")
        );
        assert_eq!(reconstructed_first.body(), "Hello, 🌍\n");
        let reconstructed_second = history.reconstruct(revisions[1].identity()).unwrap();
        assert_eq!(
            reconstructed_second.unmanaged_frontmatter(),
            Some("project: atlas\nstatus: done\n")
        );
        assert_eq!(
            reconstructed_second.body(),
            "Replacement 🦀\nwith two lines"
        );
        crate::state::set_notes_root_override(None).unwrap();
    }

    #[test]
    fn clearing_one_note_atomically_replaces_readable_history_with_a_truthful_baseline() {
        let _guard = crate::test_support::lock_test_env();
        let app_data = crate::test_support::TestDir::new("timeline-clear-note-app-data");
        crate::state::initialize_app_data_dir(app_data.path().to_path_buf()).unwrap();
        let notes = crate::test_support::TestDir::new("timeline-clear-note-notes");
        crate::state::set_notes_root_override(Some(notes.path().to_path_buf())).unwrap();
        crate::state::ensure_vault_scaffold(notes.path()).unwrap();
        let state = AppState::new(
            SemanticState::new_disabled("disabled"),
            EventBus::disabled(),
        )
        .unwrap();
        let created = crate::commands::note_persistence::persist_note_session_with_outcome(
            &state,
            "Clear me".to_string(),
            "First retained state".to_string(),
            None,
        )
        .unwrap()
        .session
        .unwrap();
        let note_id = NoteIdentity::new(created.note_id.unwrap());
        let path = PathBuf::from(created.path.unwrap());
        crate::commands::note_persistence::persist_note_session_with_outcome(
            &state,
            "Clear me".to_string(),
            "Current canonical state".to_string(),
            Some(path.to_string_lossy().into_owned()),
        )
        .unwrap();
        fs::write(
            &path,
            "Current canonical state without managed identity metadata",
        )
        .unwrap();
        let before_bytes = fs::read(&path).unwrap();
        let history = state
            .note_timeline()
            .history_mode(HistoryModeGrant::authorized(note_id.clone()));
        let removed_revision = history.revisions().unwrap()[0].identity().clone();
        let before_clear = crate::time::current_time_millis().unwrap();

        let receipt = state.note_timeline().clear_note_history(&note_id).unwrap();
        let after_clear = crate::time::current_time_millis().unwrap();

        assert_eq!(fs::read(&path).unwrap(), before_bytes);
        assert_eq!(receipt.scope(), &DeletionScope::Note(note_id.clone()));
        assert_eq!(receipt.kind(), HistoryDeletionKind::Clear);
        assert_eq!(receipt.baseline_note_ids(), &[note_id.clone()]);
        let restarted = AppState::new(
            SemanticState::new_disabled("disabled"),
            EventBus::disabled(),
        )
        .unwrap();
        let timeline = restarted.note_timeline();
        let history = timeline.history_mode(HistoryModeGrant::authorized(note_id.clone()));
        let revisions = history.revisions().unwrap();
        assert_eq!(revisions.len(), 1);
        assert_eq!(
            revisions[0].source(),
            MutationSource::BaselineInitialization
        );
        assert_eq!(revisions[0].predecessor(), None);
        assert_eq!(revisions[0].committed_at_millis(), None);
        assert_eq!(revisions[0].observed_at_millis(), None);
        assert!(revisions[0]
            .known_since_millis()
            .is_some_and(|known| (before_clear..=after_clear).contains(&known)));
        assert_eq!(
            history.reconstruct(revisions[0].identity()).unwrap().body(),
            "Current canonical state without managed identity metadata"
        );
        assert_eq!(
            history.reconstruct(&removed_revision).unwrap_err(),
            "Unknown Note Revision"
        );
        let markers = timeline.deletion_markers().unwrap();
        assert_eq!(markers.len(), 1);
        assert_eq!(markers[0].scope(), &DeletionScope::Note(note_id));
        assert_eq!(markers[0].kind(), HistoryDeletionKind::Clear);
        assert_eq!(markers[0].payload_version(), PayloadVersion::V1);
        assert_eq!(markers[0].operation_id().as_str().len(), 26);
        assert!((before_clear..=after_clear).contains(&markers[0].occurred_at_millis()));
        assert_eq!(markers[0].history_generation(), 1);
        assert!(!format!("{markers:?}").contains("First retained state"));
        assert!(!format!("{markers:?}").contains("Current canonical state without"));
        crate::state::set_notes_root_override(None).unwrap();
    }

    #[test]
    fn clearing_vault_history_rebaselines_each_active_note_but_retains_missing_timelines() {
        let _guard = crate::test_support::lock_test_env();
        let app_data = crate::test_support::TestDir::new("timeline-clear-vault-app-data");
        crate::state::initialize_app_data_dir(app_data.path().to_path_buf()).unwrap();
        let notes = crate::test_support::TestDir::new("timeline-clear-vault-notes");
        crate::state::set_notes_root_override(Some(notes.path().to_path_buf())).unwrap();
        crate::state::ensure_vault_scaffold(notes.path()).unwrap();
        let state = AppState::new(
            SemanticState::new_disabled("disabled"),
            EventBus::disabled(),
        )
        .unwrap();
        let mut created = Vec::new();
        for title in ["Alpha", "Beta", "Missing"] {
            let session = crate::commands::note_persistence::persist_note_session_with_outcome(
                &state,
                title.to_string(),
                format!("{title} original"),
                None,
            )
            .unwrap()
            .session
            .unwrap();
            created.push((
                NoteIdentity::new(session.note_id.unwrap()),
                PathBuf::from(session.path.unwrap()),
            ));
        }
        for (note_id, path) in &created[..2] {
            crate::commands::note_persistence::persist_note_session_with_outcome(
                &state,
                path.file_stem().unwrap().to_string_lossy().into_owned(),
                format!("{} current", note_id.as_str()),
                Some(path.to_string_lossy().into_owned()),
            )
            .unwrap();
        }
        fs::write(&created[1].1, "Beta current without managed metadata").unwrap();
        let active_bytes = created[..2]
            .iter()
            .map(|(_, path)| fs::read(path).unwrap())
            .collect::<Vec<_>>();
        fs::remove_file(&created[2].1).unwrap();

        let receipt = state
            .note_timeline()
            .clear_vault_history(notes.path())
            .unwrap();

        assert_eq!(
            receipt.scope(),
            &DeletionScope::Vault(
                crate::state::read_vault_manifest_for(notes.path())
                    .unwrap()
                    .unwrap()
                    .vault_id
            )
        );
        assert_eq!(receipt.kind(), HistoryDeletionKind::Clear);
        assert_eq!(receipt.baseline_note_ids().len(), 2);
        for (index, (note_id, path)) in created[..2].iter().enumerate() {
            assert_eq!(fs::read(path).unwrap(), active_bytes[index]);
            let revisions = state
                .note_timeline()
                .history_mode(HistoryModeGrant::authorized(note_id.clone()))
                .revisions()
                .unwrap();
            assert_eq!(revisions.len(), 1);
            assert_eq!(
                revisions[0].source(),
                MutationSource::BaselineInitialization
            );
            if index == 1 {
                assert_eq!(
                    state
                        .note_timeline()
                        .history_mode(HistoryModeGrant::authorized(note_id.clone()))
                        .reconstruct(revisions[0].identity())
                        .unwrap()
                        .body(),
                    "Beta current without managed metadata"
                );
            }
        }
        let missing_revisions = state
            .note_timeline()
            .history_mode(HistoryModeGrant::authorized(created[2].0.clone()))
            .revisions()
            .unwrap();
        assert_eq!(missing_revisions.len(), 1);
        assert_eq!(missing_revisions[0].source(), MutationSource::NoteCreation);
        crate::state::set_notes_root_override(None).unwrap();
    }

    #[test]
    fn purging_a_note_removes_its_complete_timeline_and_all_revision_dependents() {
        let _guard = crate::test_support::lock_test_env();
        let app_data = crate::test_support::TestDir::new("timeline-purge-app-data");
        crate::state::initialize_app_data_dir(app_data.path().to_path_buf()).unwrap();
        let notes = crate::test_support::TestDir::new("timeline-purge-notes");
        crate::state::set_notes_root_override(Some(notes.path().to_path_buf())).unwrap();
        crate::state::ensure_vault_scaffold(notes.path()).unwrap();
        let state = AppState::new(
            SemanticState::new_disabled("disabled"),
            EventBus::disabled(),
        )
        .unwrap();
        let created = crate::commands::note_persistence::persist_note_session_with_outcome(
            &state,
            "Purge me".to_string(),
            "Secret first state".to_string(),
            None,
        )
        .unwrap()
        .session
        .unwrap();
        let note_id = NoteIdentity::new(created.note_id.unwrap());
        let path = PathBuf::from(created.path.unwrap());
        crate::commands::note_persistence::persist_note_session_with_outcome(
            &state,
            "Purge me".to_string(),
            "Secret current state".to_string(),
            Some(path.to_string_lossy().into_owned()),
        )
        .unwrap();
        let history = state
            .note_timeline()
            .history_mode(HistoryModeGrant::authorized(note_id.clone()));
        let removed_revision = history.revisions().unwrap()[0].identity().clone();
        history_store::seed_revision_dependents_for_test(&removed_revision);
        assert_eq!(
            history_store::revision_dependent_count_for_test(&note_id),
            2
        );
        let removed_canonical = fs::read_to_string(&path).unwrap();
        assert_eq!(
            state.indexed_note_identity(&path).unwrap().as_deref(),
            Some(note_id.as_str())
        );

        state
            .note_timeline()
            .lifecycle(NoteLifecycleOperation::purged(
                note_id.clone(),
                path.clone(),
                700,
            ))
            .unwrap();

        let restarted = AppState::new(
            SemanticState::new_disabled("disabled"),
            EventBus::disabled(),
        )
        .unwrap();
        let timeline = restarted.note_timeline();
        let history = timeline.history_mode(HistoryModeGrant::authorized(note_id.clone()));
        assert!(history.revisions().unwrap().is_empty());
        assert!(history.lifecycle_events().unwrap().is_empty());
        assert_eq!(
            history.reconstruct(&removed_revision).unwrap_err(),
            "Unknown Note Revision"
        );
        assert_eq!(
            history_store::revision_dependent_count_for_test(&note_id),
            0
        );
        assert_eq!(history_store::current_path(&note_id).unwrap(), None);
        assert_eq!(state.indexed_note_identity(&path).unwrap(), None);
        let markers = timeline.deletion_markers().unwrap();
        assert_eq!(markers.len(), 1);
        assert_eq!(markers[0].scope(), &DeletionScope::Note(note_id.clone()));
        assert_eq!(markers[0].kind(), HistoryDeletionKind::Purge);
        assert_eq!(markers[0].occurred_at_millis(), 700);
        assert!(history_store::record_baseline_revision_if_absent(
            &note_id,
            &path,
            &removed_canonical,
            701,
        )
        .unwrap_err()
        .contains("Purged Note Identity"));
        assert!(history.revisions().unwrap().is_empty());

        restarted
            .note_timeline()
            .lifecycle(NoteLifecycleOperation::purged(note_id, path, 702))
            .unwrap();
        assert_eq!(timeline.deletion_markers().unwrap().len(), 2);
        crate::state::set_notes_root_override(None).unwrap();
    }

    #[test]
    fn purge_staging_failure_keeps_canonical_history_and_projections_intact() {
        let _guard = crate::test_support::lock_test_env();
        let app_data = crate::test_support::TestDir::new("timeline-purge-stage-failure-data");
        crate::state::initialize_app_data_dir(app_data.path().to_path_buf()).unwrap();
        let notes = crate::test_support::TestDir::new("timeline-purge-stage-failure-notes");
        crate::state::set_notes_root_override(Some(notes.path().to_path_buf())).unwrap();
        crate::state::ensure_vault_scaffold(notes.path()).unwrap();
        let state = AppState::new(
            SemanticState::new_disabled("disabled"),
            EventBus::disabled(),
        )
        .unwrap();
        let created = crate::commands::note_persistence::persist_note_session_with_outcome(
            &state,
            "Keep me".to_string(),
            "Still readable".to_string(),
            None,
        )
        .unwrap()
        .session
        .unwrap();
        let note_id = NoteIdentity::new(created.note_id.unwrap());
        let path = PathBuf::from(created.path.unwrap());
        inject_purge_staging_failure_once();

        let error = state
            .note_timeline()
            .lifecycle(NoteLifecycleOperation::purged(
                note_id.clone(),
                path.clone(),
                700,
            ))
            .unwrap_err();

        assert!(error.contains("injected purge staging failure"));
        assert!(path.is_file());
        assert_eq!(
            state.indexed_note_identity(&path).unwrap().as_deref(),
            Some(note_id.as_str())
        );
        let timeline = state.note_timeline();
        assert!(!timeline
            .history_mode(HistoryModeGrant::authorized(note_id))
            .revisions()
            .unwrap()
            .is_empty());
        assert!(timeline.deletion_markers().unwrap().is_empty());
        crate::state::set_notes_root_override(None).unwrap();
    }

    #[test]
    fn interrupted_projection_cleanup_remains_pending_and_retries_before_finalization() {
        let _guard = crate::test_support::lock_test_env();
        let app_data = crate::test_support::TestDir::new("timeline-purge-projection-retry-data");
        crate::state::initialize_app_data_dir(app_data.path().to_path_buf()).unwrap();
        let notes = crate::test_support::TestDir::new("timeline-purge-projection-retry-notes");
        crate::state::set_notes_root_override(Some(notes.path().to_path_buf())).unwrap();
        crate::state::ensure_vault_scaffold(notes.path()).unwrap();
        let state = AppState::new(
            SemanticState::new_disabled("disabled"),
            EventBus::disabled(),
        )
        .unwrap();
        let created = crate::commands::note_persistence::persist_note_session_with_outcome(
            &state,
            "Retry purge".to_string(),
            "Private body".to_string(),
            None,
        )
        .unwrap()
        .session
        .unwrap();
        let note_id = NoteIdentity::new(created.note_id.unwrap());
        let path = PathBuf::from(created.path.unwrap());
        let mut purge_error = None;
        let delivered = state
            .note_timeline()
            .current_content(AllowedScope::vault())
            .read(|| {
                inject_purge_projection_cleanup_failure_once();
                purge_error = Some(
                    state
                        .note_timeline()
                        .lifecycle(NoteLifecycleOperation::purged(
                            note_id.clone(),
                            path.clone(),
                            700,
                        ))
                        .unwrap_err(),
                );
                Ok(vec![TestCurrentContentItem {
                    note_id: note_id.as_str().to_string(),
                    note_path: path.to_string_lossy().into_owned(),
                }])
            })
            .unwrap();
        let error = purge_error.expect("purge failure is captured during the read");

        assert!(error.contains("injected purge projection cleanup interruption"));
        assert!(delivered.is_empty());
        assert!(!path.exists());
        assert_eq!(
            state.indexed_note_identity(&path).unwrap().as_deref(),
            Some(note_id.as_str())
        );
        let retrieved = crate::services::retrieval::retrieve_vault_notes(
            &state,
            "Private body",
            8,
            None,
            &HashSet::new(),
            crate::services::retrieval::VaultDateFilters::default(),
        )
        .unwrap();
        assert!(retrieved.is_empty());
        let timeline = state.note_timeline();
        let markers = timeline.deletion_markers().unwrap();
        assert_eq!(markers.len(), 1);
        assert_eq!(markers[0].scope(), &DeletionScope::Note(note_id.clone()));
        assert_eq!(state.indexed_note_identity(&path).unwrap(), None);
        assert!(timeline
            .history_mode(HistoryModeGrant::authorized(note_id))
            .revisions()
            .unwrap()
            .is_empty());
        crate::state::set_notes_root_override(None).unwrap();
    }

    #[test]
    fn interrupted_purge_recovers_before_history_can_be_read_again() {
        let _guard = crate::test_support::lock_test_env();
        let app_data = crate::test_support::TestDir::new("timeline-purge-interrupt-app-data");
        crate::state::initialize_app_data_dir(app_data.path().to_path_buf()).unwrap();
        let notes = crate::test_support::TestDir::new("timeline-purge-interrupt-notes");
        crate::state::set_notes_root_override(Some(notes.path().to_path_buf())).unwrap();
        crate::state::ensure_vault_scaffold(notes.path()).unwrap();
        let state = AppState::new(
            SemanticState::new_disabled("disabled"),
            EventBus::disabled(),
        )
        .unwrap();
        let created = crate::commands::note_persistence::persist_note_session_with_outcome(
            &state,
            "Interrupted purge".to_string(),
            "Private history".to_string(),
            None,
        )
        .unwrap()
        .session
        .unwrap();
        let note_id = NoteIdentity::new(created.note_id.unwrap());
        let path = PathBuf::from(created.path.unwrap());
        inject_history_deletion_failure_once();

        let error = state
            .note_timeline()
            .lifecycle(NoteLifecycleOperation::purged(
                note_id.clone(),
                path.clone(),
                701,
            ))
            .unwrap_err();

        assert!(error.contains("injected history deletion interruption"));
        assert!(!path.exists());
        let replacement =
            "---\ngneauxghts:\n  id: replacement-note\n  kind: note\n---\n\nReplacement";
        fs::write(&path, replacement).unwrap();
        drop(state);
        let restarted = AppState::new(
            SemanticState::new_disabled("disabled"),
            EventBus::disabled(),
        )
        .unwrap();
        let timeline = restarted.note_timeline();
        assert_eq!(fs::read_to_string(&path).unwrap(), replacement);
        let history = timeline.history_mode(HistoryModeGrant::authorized(note_id.clone()));
        assert!(history.revisions().unwrap().is_empty());
        assert!(history.lifecycle_events().unwrap().is_empty());
        let markers = timeline.deletion_markers().unwrap();
        assert_eq!(markers.len(), 1);
        assert_eq!(markers[0].scope(), &DeletionScope::Note(note_id));
        assert_eq!(markers[0].kind(), HistoryDeletionKind::Purge);
        crate::state::set_notes_root_override(None).unwrap();
    }

    #[test]
    fn interrupted_clear_rolls_back_completely_and_retry_after_restart_succeeds() {
        let _guard = crate::test_support::lock_test_env();
        let app_data = crate::test_support::TestDir::new("timeline-clear-interrupt-app-data");
        crate::state::initialize_app_data_dir(app_data.path().to_path_buf()).unwrap();
        let notes = crate::test_support::TestDir::new("timeline-clear-interrupt-notes");
        crate::state::set_notes_root_override(Some(notes.path().to_path_buf())).unwrap();
        crate::state::ensure_vault_scaffold(notes.path()).unwrap();
        let state = AppState::new(
            SemanticState::new_disabled("disabled"),
            EventBus::disabled(),
        )
        .unwrap();
        let created = crate::commands::note_persistence::persist_note_session_with_outcome(
            &state,
            "Interrupted".to_string(),
            "Before".to_string(),
            None,
        )
        .unwrap()
        .session
        .unwrap();
        let note_id = NoteIdentity::new(created.note_id.unwrap());
        let path = created.path.unwrap();
        crate::commands::note_persistence::persist_note_session_with_outcome(
            &state,
            "Interrupted".to_string(),
            "After".to_string(),
            Some(path),
        )
        .unwrap();
        inject_history_deletion_failure_once();

        let error = state
            .note_timeline()
            .clear_note_history(&note_id)
            .unwrap_err();

        assert!(error.contains("injected history deletion interruption"));
        let history = state
            .note_timeline()
            .history_mode(HistoryModeGrant::authorized(note_id.clone()));
        assert_eq!(history.revisions().unwrap().len(), 2);
        assert!(state.note_timeline().deletion_markers().unwrap().is_empty());
        drop(state);
        let restarted = AppState::new(
            SemanticState::new_disabled("disabled"),
            EventBus::disabled(),
        )
        .unwrap();
        restarted
            .note_timeline()
            .clear_note_history(&note_id)
            .unwrap();
        let history = restarted
            .note_timeline()
            .history_mode(HistoryModeGrant::authorized(note_id));
        assert_eq!(history.revisions().unwrap().len(), 1);
        assert_eq!(
            history.revisions().unwrap()[0].source(),
            MutationSource::BaselineInitialization
        );
        crate::state::set_notes_root_override(None).unwrap();
    }

    #[test]
    fn storage_usage_distinguishes_immediate_logical_deletion_from_bounded_reclamation() {
        let _guard = crate::test_support::lock_test_env();
        let app_data = crate::test_support::TestDir::new("timeline-storage-usage-app-data");
        crate::state::initialize_app_data_dir(app_data.path().to_path_buf()).unwrap();
        let notes = crate::test_support::TestDir::new("timeline-storage-usage-notes");
        crate::state::set_notes_root_override(Some(notes.path().to_path_buf())).unwrap();
        crate::state::ensure_vault_scaffold(notes.path()).unwrap();
        let state = AppState::new(
            SemanticState::new_disabled("disabled"),
            EventBus::disabled(),
        )
        .unwrap();
        let created = crate::commands::note_persistence::persist_note_session_with_outcome(
            &state,
            "Storage".to_string(),
            "Initial".to_string(),
            None,
        )
        .unwrap()
        .session
        .unwrap();
        let note_id = NoteIdentity::new(created.note_id.unwrap());
        let path = created.path.unwrap();
        for revision in 0..24 {
            let body = (0..512)
                .map(|line| format!("revision-{revision:02}-line-{line:04}-{}", "x".repeat(48)))
                .collect::<Vec<_>>()
                .join("\n");
            crate::commands::note_persistence::persist_note_session_with_outcome(
                &state,
                "Storage".to_string(),
                body,
                Some(path.clone()),
            )
            .unwrap();
        }
        let timeline = state.note_timeline();
        assert_eq!(history_store::auto_vacuum_mode_for_test(), 2);
        let retained = timeline.history_storage_usage().unwrap();

        timeline.clear_note_history(&note_id).unwrap();
        let logically_deleted = timeline.history_storage_usage().unwrap();

        assert!(logically_deleted.allocated_bytes() >= retained.allocated_bytes());
        assert!(logically_deleted.reclaimable_bytes() > retained.reclaimable_bytes());
        let first_compaction = timeline.compact_history_storage(32 * 1024).unwrap();
        assert_eq!(first_compaction.before(), &logically_deleted);
        assert!(first_compaction.reclaimed_bytes() <= 32 * 1024);
        assert!(first_compaction.after().allocated_bytes() <= logically_deleted.allocated_bytes());
        let mut usage = first_compaction.after().clone();
        for _ in 0..128 {
            if usage.reclaimable_bytes() == 0 {
                break;
            }
            let compaction = timeline.compact_history_storage(32 * 1024).unwrap();
            assert!(compaction.reclaimed_bytes() <= 32 * 1024);
            usage = compaction.after().clone();
        }
        assert_eq!(usage.reclaimable_bytes(), 0);
        assert!(usage.allocated_bytes() < logically_deleted.allocated_bytes());
        let history = timeline.history_mode(HistoryModeGrant::authorized(note_id));
        assert_eq!(history.revisions().unwrap().len(), 1);
        assert_eq!(timeline.deletion_markers().unwrap().len(), 1);
        crate::state::set_notes_root_override(None).unwrap();
    }

    #[test]
    fn existing_managed_note_gets_one_truthful_baseline_without_a_markdown_write() {
        let _guard = crate::test_support::lock_test_env();
        let app_data = crate::test_support::TestDir::new("timeline-baseline-app-data");
        crate::state::initialize_app_data_dir(app_data.path().to_path_buf()).unwrap();
        let notes = crate::test_support::TestDir::new("timeline-baseline-notes");
        crate::state::set_notes_root_override(Some(notes.path().to_path_buf())).unwrap();
        crate::state::ensure_vault_scaffold(notes.path()).unwrap();
        let path = notes.path().join("Existing.md");
        let markdown = "---\ngneauxghts:\n  id: existing-note\n  kind: note\n---\n\n# Existing\n\nKnown content";
        fs::write(&path, markdown).unwrap();
        let before_bytes = fs::read(&path).unwrap();
        let before_known = crate::time::current_time_millis().unwrap();
        let state = AppState::new(
            SemanticState::new_disabled("disabled"),
            EventBus::disabled(),
        )
        .unwrap();

        let progress = state
            .note_timeline()
            .initialize_existing_notes(notes.path())
            .unwrap();
        let after_known = crate::time::current_time_millis().unwrap();

        assert_eq!(progress.phase(), BaselineInitializationPhase::Complete);
        assert_eq!(progress.discovered_notes(), 1);
        assert_eq!(progress.baseline_revisions(), 1);
        assert_eq!(fs::read(&path).unwrap(), before_bytes);
        let history = state
            .note_timeline()
            .history_mode(HistoryModeGrant::authorized(NoteIdentity::new(
                "existing-note",
            )));
        let revisions = history.revisions().unwrap();
        assert_eq!(revisions.len(), 1);
        assert_eq!(
            revisions[0].source(),
            MutationSource::BaselineInitialization
        );
        assert_eq!(revisions[0].committed_at_millis(), None);
        assert_eq!(revisions[0].observed_at_millis(), None);
        assert!(revisions[0]
            .known_since_millis()
            .is_some_and(|known| (before_known..=after_known).contains(&known)));
        assert_eq!(
            history.reconstruct(revisions[0].identity()).unwrap().body(),
            "# Existing\n\nKnown content"
        );
        crate::state::set_notes_root_override(None).unwrap();
    }

    #[test]
    fn first_mutation_synchronously_baselines_the_existing_canonical_state() {
        let _guard = crate::test_support::lock_test_env();
        let app_data = crate::test_support::TestDir::new("timeline-baseline-race-app-data");
        crate::state::initialize_app_data_dir(app_data.path().to_path_buf()).unwrap();
        let notes = crate::test_support::TestDir::new("timeline-baseline-race-notes");
        crate::state::set_notes_root_override(Some(notes.path().to_path_buf())).unwrap();
        crate::state::ensure_vault_scaffold(notes.path()).unwrap();
        let path = notes.path().join("Existing.md");
        let original =
            "---\ngneauxghts:\n  id: raced-note\n  kind: note\n---\n\n# Existing\n\nBefore edit";
        fs::write(&path, original).unwrap();
        let state = AppState::new(
            SemanticState::new_disabled("disabled"),
            EventBus::disabled(),
        )
        .unwrap();

        crate::commands::note_persistence::persist_note_session_with_outcome(
            &state,
            "Existing".to_string(),
            "# Existing\n\nAfter edit".to_string(),
            Some(path.to_string_lossy().into_owned()),
        )
        .unwrap();

        let history = state
            .note_timeline()
            .history_mode(HistoryModeGrant::authorized(NoteIdentity::new(
                "raced-note",
            )));
        let revisions = history.revisions().unwrap();
        assert_eq!(revisions.len(), 2);
        assert_eq!(
            revisions[0].source(),
            MutationSource::BaselineInitialization
        );
        assert_eq!(revisions[1].source(), MutationSource::Editor);
        assert_eq!(
            history.reconstruct(revisions[0].identity()).unwrap().body(),
            "# Existing\n\nBefore edit"
        );
        assert_eq!(
            history.reconstruct(revisions[1].identity()).unwrap().body(),
            "# Existing\n\nAfter edit"
        );
        crate::state::set_notes_root_override(None).unwrap();
    }

    #[test]
    fn first_watcher_observation_races_to_the_same_single_baseline() {
        let _guard = crate::test_support::lock_test_env();
        let app_data = crate::test_support::TestDir::new("timeline-baseline-watcher-app-data");
        crate::state::initialize_app_data_dir(app_data.path().to_path_buf()).unwrap();
        let notes = crate::test_support::TestDir::new("timeline-baseline-watcher-notes");
        crate::state::set_notes_root_override(Some(notes.path().to_path_buf())).unwrap();
        crate::state::ensure_vault_scaffold(notes.path()).unwrap();
        let path = notes.path().join("Observed.md");
        let markdown =
            "---\ngneauxghts:\n  id: observed-before-scan\n  kind: note\n---\n\nObserved content";
        fs::write(&path, markdown).unwrap();
        let state = AppState::new(
            SemanticState::new_disabled("disabled"),
            EventBus::disabled(),
        )
        .unwrap();
        let timeline = state.note_timeline();

        let start = Arc::new(Barrier::new(2));
        thread::scope(|scope| {
            let initialization_start = Arc::clone(&start);
            let state_ref = &state;
            let notes_path = notes.path();
            let initializer = scope.spawn(move || {
                initialization_start.wait();
                state_ref
                    .note_timeline()
                    .initialize_existing_notes(notes_path)
                    .unwrap()
            });
            let observation_start = Arc::clone(&start);
            let observed_path = path.clone();
            let observed_markdown = markdown.to_string();
            let state_ref = &state;
            let observer = scope.spawn(move || {
                observation_start.wait();
                state_ref
                    .note_timeline()
                    .observe(
                        VaultObservation::external_edit(observed_path, 500, Some(450))
                            .with_canonical_markdown(observed_markdown),
                    )
                    .unwrap()
            });
            initializer.join().unwrap();
            observer.join().unwrap();
        });

        let history = timeline.history_mode(HistoryModeGrant::authorized(NoteIdentity::new(
            "observed-before-scan",
        )));
        let revisions = history.revisions().unwrap();
        assert_eq!(revisions.len(), 1);
        assert_eq!(
            revisions[0].source(),
            MutationSource::BaselineInitialization
        );
        assert_eq!(revisions[0].known_since_millis(), Some(500));
        crate::state::set_notes_root_override(None).unwrap();
    }

    #[test]
    fn first_external_observation_after_initialization_is_an_external_edit() {
        let _guard = crate::test_support::lock_test_env();
        let app_data = crate::test_support::TestDir::new("timeline-post-baseline-watcher-app-data");
        crate::state::initialize_app_data_dir(app_data.path().to_path_buf()).unwrap();
        let notes = crate::test_support::TestDir::new("timeline-post-baseline-watcher-notes");
        crate::state::set_notes_root_override(Some(notes.path().to_path_buf())).unwrap();
        crate::state::ensure_vault_scaffold(notes.path()).unwrap();
        let state = AppState::new(
            SemanticState::new_disabled("disabled"),
            EventBus::disabled(),
        )
        .unwrap();
        let timeline = state.note_timeline();
        timeline.initialize_existing_notes(notes.path()).unwrap();

        let path = notes.path().join("Added later.md");
        let markdown =
            "---\ngneauxghts:\n  id: added-after-baseline\n  kind: note\n---\n\nAdded later";
        fs::write(&path, markdown).unwrap();
        timeline
            .observe(
                VaultObservation::external_edit(path, 600, Some(550))
                    .with_canonical_markdown(markdown.to_string()),
            )
            .unwrap();

        let history = timeline.history_mode(HistoryModeGrant::authorized(NoteIdentity::new(
            "added-after-baseline",
        )));
        let revisions = history.revisions().unwrap();
        assert_eq!(revisions.len(), 1);
        assert_eq!(revisions[0].source(), MutationSource::ExternalEdit);
        assert_eq!(
            revisions[0].time_evidence(),
            RevisionTimeEvidence::Observed {
                observed_at_millis: 600,
                modified_at_millis: Some(550),
            }
        );
        crate::state::set_notes_root_override(None).unwrap();
    }

    #[test]
    fn initialization_diagnostics_and_note_state_survive_restart_and_repeat() {
        let _guard = crate::test_support::lock_test_env();
        let app_data = crate::test_support::TestDir::new("timeline-baseline-status-app-data");
        crate::state::initialize_app_data_dir(app_data.path().to_path_buf()).unwrap();
        let notes = crate::test_support::TestDir::new("timeline-baseline-status-notes");
        crate::state::set_notes_root_override(Some(notes.path().to_path_buf())).unwrap();
        crate::state::ensure_vault_scaffold(notes.path()).unwrap();
        let path = notes.path().join("Existing.md");
        let markdown = "---\ngneauxghts:\n  id: status-note\n  kind: note\n---\n\nStatus content";
        fs::write(&path, markdown).unwrap();
        let state = AppState::new(
            SemanticState::new_disabled("disabled"),
            EventBus::disabled(),
        )
        .unwrap();
        let timeline = state.note_timeline();
        timeline.initialize_existing_notes(notes.path()).unwrap();
        let first_revision = timeline
            .history_mode(HistoryModeGrant::authorized(NoteIdentity::new(
                "status-note",
            )))
            .revisions()
            .unwrap()[0]
            .identity()
            .clone();
        drop(timeline);
        drop(state);

        let restarted = AppState::new(
            SemanticState::new_disabled("disabled"),
            EventBus::disabled(),
        )
        .unwrap();
        let timeline = restarted.note_timeline();
        let progress = timeline.baseline_initialization_progress().unwrap();
        assert_eq!(progress.phase(), BaselineInitializationPhase::Complete);
        assert_eq!(progress.discovered_notes(), 1);
        assert_eq!(progress.baseline_revisions(), 1);
        assert_eq!(progress.ready_notes(), 1);
        assert_eq!(progress.failed_notes(), 0);
        assert!(matches!(
            timeline
                .note_baseline_initialization_state(&NoteIdentity::new("status-note"))
                .unwrap(),
            NoteBaselineInitializationState::Initialized {
                known_since_millis: Some(_)
            }
        ));

        let repeated = timeline.initialize_existing_notes(notes.path()).unwrap();
        assert_eq!(repeated.baseline_revisions(), 1);
        let revisions = timeline
            .history_mode(HistoryModeGrant::authorized(NoteIdentity::new(
                "status-note",
            )))
            .revisions()
            .unwrap();
        assert_eq!(revisions.len(), 1);
        assert_eq!(revisions[0].identity(), &first_revision);
        crate::state::set_notes_root_override(None).unwrap();
    }

    #[test]
    fn initialization_preserves_damaged_identity_continuity_without_rewriting_it() {
        let _guard = crate::test_support::lock_test_env();
        let app_data = crate::test_support::TestDir::new("timeline-baseline-damaged-app-data");
        crate::state::initialize_app_data_dir(app_data.path().to_path_buf()).unwrap();
        let notes = crate::test_support::TestDir::new("timeline-baseline-damaged-notes");
        crate::state::set_notes_root_override(Some(notes.path().to_path_buf())).unwrap();
        crate::state::ensure_vault_scaffold(notes.path()).unwrap();
        let valid_path = notes.path().join("Valid.md");
        let valid = "---\ngneauxghts:\n  id: valid-baseline\n  kind: note\n---\n\nValid";
        fs::write(&valid_path, valid).unwrap();
        let damaged_path = notes.path().join("Damaged.md");
        let damaged = "---\ngneauxghts:\n  id: \n  kind: note\n---\n\nDamaged";
        fs::write(&damaged_path, damaged).unwrap();
        fs::write(
            notes.path().join("Legacy.md"),
            "Legacy without managed data",
        )
        .unwrap();
        fs::write(
            notes.path().join("Chat.md"),
            "---\ngneauxghts:\n  id: chat-projection\n  kind: chatTranscript\n---\n\nChat",
        )
        .unwrap();
        let damaged_before = fs::read(&damaged_path).unwrap();
        let state = AppState::new(
            SemanticState::new_disabled("disabled"),
            EventBus::disabled(),
        )
        .unwrap();

        let progress = state
            .note_timeline()
            .initialize_existing_notes(notes.path())
            .unwrap();

        assert_eq!(progress.phase(), BaselineInitializationPhase::Complete);
        assert_eq!(progress.discovered_notes(), 2);
        assert_eq!(progress.baseline_revisions(), 2);
        assert_eq!(progress.ready_notes(), 2);
        assert_eq!(progress.failed_notes(), 0);
        assert_eq!(progress.last_error(), None);
        assert_eq!(fs::read(&damaged_path).unwrap(), damaged_before);

        drop(state);
        let restarted = AppState::new(
            SemanticState::new_disabled("disabled"),
            EventBus::disabled(),
        )
        .unwrap();
        let saved = crate::commands::note_persistence::persist_note_session_with_outcome(
            &restarted,
            "Damaged".to_string(),
            "Edited after restart".to_string(),
            Some(damaged_path.to_string_lossy().into_owned()),
        )
        .unwrap()
        .session
        .unwrap();
        let repaired_note_id = saved.note_id.unwrap();
        let revisions = restarted
            .note_timeline()
            .history_mode(HistoryModeGrant::authorized(NoteIdentity::new(
                repaired_note_id,
            )))
            .revisions()
            .unwrap();
        assert_eq!(revisions.len(), 2);
        assert_eq!(
            revisions[0].source(),
            MutationSource::BaselineInitialization
        );
        assert_eq!(revisions[1].source(), MutationSource::Editor);
        crate::state::set_notes_root_override(None).unwrap();
    }

    #[test]
    fn initialization_failure_is_attributed_to_the_resolved_damaged_identity() {
        let _guard = crate::test_support::lock_test_env();
        let app_data = crate::test_support::TestDir::new("timeline-damaged-failure-app-data");
        crate::state::initialize_app_data_dir(app_data.path().to_path_buf()).unwrap();
        let notes = crate::test_support::TestDir::new("timeline-damaged-failure-notes");
        crate::state::set_notes_root_override(Some(notes.path().to_path_buf())).unwrap();
        crate::state::ensure_vault_scaffold(notes.path()).unwrap();
        let path = notes.path().join("Damaged.md");
        fs::write(
            &path,
            "---\ngneauxghts:\n  id: \n  kind: note\n---\n\nDamaged",
        )
        .unwrap();
        let state = AppState::new(
            SemanticState::new_disabled("disabled"),
            EventBus::disabled(),
        )
        .unwrap();
        inject_history_baseline_failure_once();

        let progress = state
            .note_timeline()
            .initialize_existing_notes(notes.path())
            .unwrap();

        assert_eq!(progress.phase(), BaselineInitializationPhase::Degraded);
        let failed_note_ids = history_store::baseline_failure_note_ids();
        assert_eq!(failed_note_ids.len(), 1);
        let resolved_note_id = &failed_note_ids[0];
        assert!(!resolved_note_id.trim().is_empty());
        assert!(matches!(
            state.note_timeline()
                .note_baseline_initialization_state(&NoteIdentity::new(resolved_note_id.clone()))
                .unwrap(),
            NoteBaselineInitializationState::Failed { error }
                if error.contains("injected Baseline Revision failure")
        ));
        crate::state::set_notes_root_override(None).unwrap();
    }

    #[test]
    fn interrupted_large_initialization_resumes_idempotently_after_restart() {
        let _guard = crate::test_support::lock_test_env();
        let app_data = crate::test_support::TestDir::new("timeline-baseline-resume-app-data");
        crate::state::initialize_app_data_dir(app_data.path().to_path_buf()).unwrap();
        let notes = crate::test_support::TestDir::new("timeline-baseline-resume-notes");
        crate::state::set_notes_root_override(Some(notes.path().to_path_buf())).unwrap();
        crate::state::ensure_vault_scaffold(notes.path()).unwrap();
        for index in 0..64 {
            fs::write(
                notes.path().join(format!("Note {index:02}.md")),
                format!(
                    "---\ngneauxghts:\n  id: baseline-{index:02}\n  kind: note\n---\n\nContent {index}"
                ),
            )
            .unwrap();
        }
        let first_state = AppState::new(
            SemanticState::new_disabled("disabled"),
            EventBus::disabled(),
        )
        .unwrap();
        inject_history_baseline_failure_once();
        let degraded = first_state
            .note_timeline()
            .initialize_existing_notes(notes.path())
            .unwrap();
        assert_eq!(degraded.phase(), BaselineInitializationPhase::Degraded);
        assert_eq!(degraded.failed_notes(), 1);
        assert!(degraded
            .last_error()
            .is_some_and(|error| error.contains("injected Baseline Revision failure")));
        assert_eq!(
            first_state
                .note_timeline()
                .baseline_initialization_progress()
                .unwrap()
                .phase(),
            BaselineInitializationPhase::Degraded
        );
        assert!(matches!(
            first_state.note_timeline()
                .note_baseline_initialization_state(&NoteIdentity::new("baseline-00"))
                .unwrap(),
            NoteBaselineInitializationState::Failed { error }
                if error.contains("injected Baseline Revision failure")
        ));
        drop(first_state);

        let restarted = AppState::new(
            SemanticState::new_disabled("disabled"),
            EventBus::disabled(),
        )
        .unwrap();
        let progress = restarted
            .note_timeline()
            .initialize_existing_notes(notes.path())
            .unwrap();
        assert_eq!(progress.phase(), BaselineInitializationPhase::Complete);
        assert_eq!(progress.discovered_notes(), 64);
        assert_eq!(progress.baseline_revisions(), 64);
        assert_eq!(progress.ready_notes(), 64);
        assert_eq!(progress.failed_notes(), 0);
        for index in 0..64 {
            let revisions = restarted
                .note_timeline()
                .history_mode(HistoryModeGrant::authorized(NoteIdentity::new(format!(
                    "baseline-{index:02}"
                ))))
                .revisions()
                .unwrap();
            assert_eq!(revisions.len(), 1);
            assert_eq!(
                revisions[0].source(),
                MutationSource::BaselineInitialization
            );
        }
        crate::state::set_notes_root_override(None).unwrap();
    }

    #[test]
    fn reopening_detects_manifest_and_history_store_generation_mismatch() {
        let _guard = crate::test_support::lock_test_env();
        let app_data = crate::test_support::TestDir::new("timeline-generation-app-data");
        crate::state::initialize_app_data_dir(app_data.path().to_path_buf()).unwrap();
        let notes = crate::test_support::TestDir::new("timeline-generation-notes");
        crate::state::set_notes_root_override(Some(notes.path().to_path_buf())).unwrap();
        crate::state::ensure_vault_scaffold(notes.path()).unwrap();
        let path = notes.path().join("Existing.md");
        fs::write(
            &path,
            "---\ngneauxghts:\n  id: generation-note\n  kind: note\n---\n\nContent",
        )
        .unwrap();
        let state = AppState::new(
            SemanticState::new_disabled("disabled"),
            EventBus::disabled(),
        )
        .unwrap();
        state
            .note_timeline()
            .initialize_existing_notes(notes.path())
            .unwrap();
        drop(state);

        let manifest_path = crate::state::vault_manifest_path_for(notes.path());
        let mut manifest: serde_json::Value =
            serde_json::from_slice(&fs::read(&manifest_path).unwrap()).unwrap();
        manifest["historyGeneration"] = serde_json::json!(2);
        fs::write(
            &manifest_path,
            serde_json::to_vec_pretty(&manifest).unwrap(),
        )
        .unwrap();
        let reopened = AppState::new(
            SemanticState::new_disabled("disabled"),
            EventBus::disabled(),
        )
        .unwrap();

        let error = reopened
            .note_timeline()
            .baseline_initialization_progress()
            .expect_err("mismatched selected generation must not open silently");
        assert!(error.contains("generation mismatch"));
        crate::state::set_notes_root_override(None).unwrap();
    }

    #[test]
    fn clean_close_reports_portability_and_stops_new_timeline_mutations() {
        let _guard = crate::test_support::lock_test_env();
        let app_data = crate::test_support::TestDir::new("timeline-clean-close-app-data");
        crate::state::initialize_app_data_dir(app_data.path().to_path_buf()).unwrap();
        let notes = crate::test_support::TestDir::new("timeline-clean-close-notes");
        crate::state::set_notes_root_override(Some(notes.path().to_path_buf())).unwrap();
        crate::state::ensure_vault_scaffold(notes.path()).unwrap();
        let path = notes.path().join("Portable.md");
        fs::write(
            &path,
            "---\ngneauxghts:\n  id: portable-note\n  kind: note\n---\n\nPortable content",
        )
        .unwrap();
        let state = AppState::new(
            SemanticState::new_disabled("disabled"),
            EventBus::disabled(),
        )
        .unwrap();
        let timeline = state.note_timeline();
        timeline.initialize_existing_notes(notes.path()).unwrap();
        let prepared = timeline
            .prepare_revision_publication(
                MutationSource::Editor,
                &path,
                Some(&path),
                Some(&NoteIdentity::new("portable-note")),
                "Prepared but never published",
            )
            .unwrap();
        assert_eq!(prepared_history_intent_count_for_test("prepared"), 1);

        thread::scope(|scope| {
            let (closed_tx, closed_rx) = mpsc::channel();
            let close_state = &state;
            let vault_root = notes.path();
            let close = scope.spawn(move || {
                let result = close_state.note_timeline().clean_close(vault_root);
                closed_tx.send(()).unwrap();
                result
            });
            assert!(closed_rx.recv_timeout(Duration::from_millis(50)).is_err());
            let (_, history_intent) = prepared.into_parts();
            history_intent.abandon().unwrap();
            closed_rx.recv_timeout(Duration::from_secs(1)).unwrap();
            close.join().unwrap().unwrap();
        });
        assert_eq!(
            history_store::prepared_intent_count_without_opening_store("prepared"),
            0
        );
        let error = timeline
            .prepare_revision_publication(
                MutationSource::Editor,
                &path,
                Some(&path),
                Some(&NoteIdentity::new("portable-note")),
                "Portable content changed",
            )
            .expect_err("a cleanly closed application state must admit no new mutations");
        assert!(error.contains("cleanly closed"));
        crate::state::set_notes_root_override(None).unwrap();
    }

    #[test]
    fn failed_clean_close_reports_failure_and_allows_a_retry() {
        let _guard = crate::test_support::lock_test_env();
        let app_data = crate::test_support::TestDir::new("timeline-failed-close-app-data");
        crate::state::initialize_app_data_dir(app_data.path().to_path_buf()).unwrap();
        let notes = crate::test_support::TestDir::new("timeline-failed-close-notes");
        crate::state::set_notes_root_override(Some(notes.path().to_path_buf())).unwrap();
        crate::state::ensure_vault_scaffold(notes.path()).unwrap();
        let path = notes.path().join("Retry.md");
        fs::write(
            &path,
            "---\ngneauxghts:\n  id: retry-close-note\n  kind: note\n---\n\nRetry content",
        )
        .unwrap();
        let state = AppState::new(
            SemanticState::new_disabled("disabled"),
            EventBus::disabled(),
        )
        .unwrap();
        let timeline = state.note_timeline();
        timeline.initialize_existing_notes(notes.path()).unwrap();
        inject_history_clean_close_failure_once();

        let error = timeline
            .clean_close(notes.path())
            .expect_err("a failed checkpoint must not report portability");
        assert!(error.contains("injected history connection close failure"));
        timeline
            .prepare_revision_publication(
                MutationSource::Editor,
                &path,
                Some(&path),
                Some(&NoteIdentity::new("retry-close-note")),
                "Retry content changed",
            )
            .expect("failed close must leave mutation admission available for retry");
        timeline.clean_close(notes.path()).unwrap();
        crate::state::set_notes_root_override(None).unwrap();
    }

    #[test]
    fn opening_a_live_main_file_only_copy_requires_explicit_recovery() {
        let _guard = crate::test_support::lock_test_env();
        let source_app_data =
            crate::test_support::TestDir::new("timeline-live-copy-source-app-data");
        crate::state::initialize_app_data_dir(source_app_data.path().to_path_buf()).unwrap();
        let source = crate::test_support::TestDir::new("timeline-live-copy-source");
        crate::state::set_notes_root_override(Some(source.path().to_path_buf())).unwrap();
        crate::state::ensure_vault_scaffold(source.path()).unwrap();
        let note_path = source.path().join("Live.md");
        fs::write(
            &note_path,
            "---\ngneauxghts:\n  id: live-copy-note\n  kind: note\n---\n\nLive content",
        )
        .unwrap();
        let source_state = AppState::new(
            SemanticState::new_disabled("disabled"),
            EventBus::disabled(),
        )
        .unwrap();
        source_state
            .note_timeline()
            .initialize_existing_notes(source.path())
            .unwrap();

        let copied = crate::test_support::TestDir::new("timeline-live-copy-destination");
        copy_file(&note_path, &copied.path().join("Live.md"));
        copy_file(
            &source.path().join(".gneauxghts/vault.json"),
            &copied.path().join(".gneauxghts/vault.json"),
        );
        copy_file(
            &history_store::history_database_path_for_test(source.path()),
            &history_store::history_database_path_for_test(copied.path()),
        );
        drop(source_state);

        let destination_app_data =
            crate::test_support::TestDir::new("timeline-live-copy-destination-app-data");
        crate::state::initialize_app_data_dir(destination_app_data.path().to_path_buf()).unwrap();
        crate::state::set_notes_root_override(Some(copied.path().to_path_buf())).unwrap();
        let copied_state = AppState::new(
            SemanticState::new_disabled("disabled"),
            EventBus::disabled(),
        )
        .unwrap();

        let error = copied_state
            .note_timeline()
            .baseline_initialization_progress()
            .expect_err("a live main-file-only copy must not be accepted as portable");
        assert!(error.contains("unsupported live copy"));
        crate::state::set_notes_root_override(None).unwrap();
    }

    #[test]
    fn a_cleanly_copied_vault_reconstructs_identical_revision_identity_and_hash() {
        let _guard = crate::test_support::lock_test_env();
        let source_app_data =
            crate::test_support::TestDir::new("timeline-portable-copy-source-app-data");
        crate::state::initialize_app_data_dir(source_app_data.path().to_path_buf()).unwrap();
        let source = crate::test_support::TestDir::new("timeline-portable-copy-source");
        crate::state::set_notes_root_override(Some(source.path().to_path_buf())).unwrap();
        crate::state::ensure_vault_scaffold(source.path()).unwrap();
        let source_note = source.path().join("Portable.md");
        fs::write(
            &source_note,
            "---\ngneauxghts:\n  id: portable-copy-note\n  kind: note\n---\n\nPortable content",
        )
        .unwrap();
        let source_state = AppState::new(
            SemanticState::new_disabled("disabled"),
            EventBus::disabled(),
        )
        .unwrap();
        let source_timeline = source_state.note_timeline();
        source_timeline
            .initialize_existing_notes(source.path())
            .unwrap();
        let source_access = source_timeline.history_mode(HistoryModeGrant::authorized(
            NoteIdentity::new("portable-copy-note"),
        ));
        let source_header = source_access.revisions().unwrap()[0].clone();
        let source_revision = source_access.reconstruct(source_header.identity()).unwrap();
        source_timeline.clean_close(source.path()).unwrap();

        let copied = crate::test_support::TestDir::new("timeline-portable-copy-destination");
        copy_file(&source_note, &copied.path().join("Portable.md"));
        copy_file(
            &source.path().join(".gneauxghts/vault.json"),
            &copied.path().join(".gneauxghts/vault.json"),
        );
        copy_file(
            &history_store::history_database_path_for_test(source.path()),
            &history_store::history_database_path_for_test(copied.path()),
        );
        drop(source_access);
        drop(source_timeline);
        drop(source_state);

        let destination_app_data =
            crate::test_support::TestDir::new("timeline-portable-copy-destination-app-data");
        crate::state::initialize_app_data_dir(destination_app_data.path().to_path_buf()).unwrap();
        crate::state::set_notes_root_override(Some(copied.path().to_path_buf())).unwrap();
        let copied_state = AppState::new(
            SemanticState::new_disabled("disabled"),
            EventBus::disabled(),
        )
        .unwrap();
        let copied_access =
            copied_state
                .note_timeline()
                .history_mode(HistoryModeGrant::authorized(NoteIdentity::new(
                    "portable-copy-note",
                )));

        let copied_header = copied_access.revisions().unwrap()[0].clone();
        let copied_revision = copied_access.reconstruct(copied_header.identity()).unwrap();
        assert_eq!(copied_header.identity(), source_header.identity());
        assert_eq!(copied_header.content_hash(), source_header.content_hash());
        assert_eq!(copied_revision, source_revision);
        crate::state::set_notes_root_override(None).unwrap();
    }

    #[test]
    fn reopening_rejects_an_older_clean_close_watermark_from_the_same_generation() {
        let _guard = crate::test_support::lock_test_env();
        let app_data = crate::test_support::TestDir::new("timeline-watermark-app-data");
        crate::state::initialize_app_data_dir(app_data.path().to_path_buf()).unwrap();
        let notes = crate::test_support::TestDir::new("timeline-watermark-notes");
        crate::state::set_notes_root_override(Some(notes.path().to_path_buf())).unwrap();
        crate::state::ensure_vault_scaffold(notes.path()).unwrap();
        fs::write(
            notes.path().join("Watermark.md"),
            "---\ngneauxghts:\n  id: watermark-note\n  kind: note\n---\n\nWatermark content",
        )
        .unwrap();
        let first_state = AppState::new(
            SemanticState::new_disabled("disabled"),
            EventBus::disabled(),
        )
        .unwrap();
        let first_timeline = first_state.note_timeline();
        first_timeline
            .initialize_existing_notes(notes.path())
            .unwrap();
        first_timeline.clean_close(notes.path()).unwrap();
        let database = history_store::history_database_path_for_test(notes.path());
        let older_clean_copy = notes.path().join(".gneauxghts/history-older.sqlite3");
        fs::copy(&database, &older_clean_copy).unwrap();
        drop(first_timeline);
        drop(first_state);

        let second_state = AppState::new(
            SemanticState::new_disabled("disabled"),
            EventBus::disabled(),
        )
        .unwrap();
        let second_timeline = second_state.note_timeline();
        second_timeline.baseline_initialization_progress().unwrap();
        second_timeline.clean_close(notes.path()).unwrap();
        drop(second_timeline);
        drop(second_state);
        fs::copy(&older_clean_copy, &database).unwrap();

        let rolled_back_state = AppState::new(
            SemanticState::new_disabled("disabled"),
            EventBus::disabled(),
        )
        .unwrap();
        let error = rolled_back_state
            .note_timeline()
            .baseline_initialization_progress()
            .expect_err("an older clean store from the same generation must require recovery");
        assert!(error.contains("clean-close watermark rollback"));
        crate::state::set_notes_root_override(None).unwrap();
    }

    #[test]
    fn app_restart_recovers_a_same_installation_store_from_wal_without_shm() {
        let _guard = crate::test_support::lock_test_env();
        let app_data = crate::test_support::TestDir::new("timeline-wal-recovery-app-data");
        crate::state::initialize_app_data_dir(app_data.path().to_path_buf()).unwrap();
        let source = crate::test_support::TestDir::new("timeline-wal-recovery-source");
        crate::state::set_notes_root_override(Some(source.path().to_path_buf())).unwrap();
        crate::state::ensure_vault_scaffold(source.path()).unwrap();
        let source_note = source.path().join("Wal.md");
        fs::write(
            &source_note,
            "---\ngneauxghts:\n  id: wal-recovery-note\n  kind: note\n---\n\nBefore recovery",
        )
        .unwrap();
        let source_state = AppState::new(
            SemanticState::new_disabled("disabled"),
            EventBus::disabled(),
        )
        .unwrap();
        source_state
            .note_timeline()
            .initialize_existing_notes(source.path())
            .unwrap();
        let keepalive = history_store::hold_history_store_open_for_test();
        crate::commands::note_persistence::persist_note_session_with_outcome(
            &source_state,
            "Wal".to_string(),
            "After recovery".to_string(),
            Some(source_note.to_string_lossy().into_owned()),
        )
        .unwrap();
        let source_access =
            source_state
                .note_timeline()
                .history_mode(HistoryModeGrant::authorized(NoteIdentity::new(
                    "wal-recovery-note",
                )));
        let expected_header = source_access.revisions().unwrap().last().unwrap().clone();
        let expected_revision = source_access
            .reconstruct(expected_header.identity())
            .unwrap();
        let source_database = history_store::history_database_path_for_test(source.path());
        let source_wal = history_store::history_wal_path_for_test(source.path());
        assert!(fs::metadata(&source_wal).unwrap().len() > 0);

        let restarted = crate::test_support::TestDir::new("timeline-wal-recovery-restarted");
        copy_file(&source_note, &restarted.path().join("Wal.md"));
        copy_file(
            &source.path().join(".gneauxghts/vault.json"),
            &restarted.path().join(".gneauxghts/vault.json"),
        );
        copy_file(
            &source_database,
            &history_store::history_database_path_for_test(restarted.path()),
        );
        copy_file(
            &source_wal,
            &history_store::history_wal_path_for_test(restarted.path()),
        );
        assert!(!history_store::history_shm_path_for_test(restarted.path()).exists());
        drop(source_access);
        drop(keepalive);
        drop(source_state);

        crate::state::set_notes_root_override(Some(restarted.path().to_path_buf())).unwrap();
        let restarted_state = AppState::new(
            SemanticState::new_disabled("disabled"),
            EventBus::disabled(),
        )
        .unwrap();
        let restarted_access =
            restarted_state
                .note_timeline()
                .history_mode(HistoryModeGrant::authorized(NoteIdentity::new(
                    "wal-recovery-note",
                )));
        let recovered_header = restarted_access
            .revisions()
            .unwrap()
            .last()
            .unwrap()
            .clone();
        let recovered_revision = restarted_access
            .reconstruct(recovered_header.identity())
            .unwrap();
        assert_eq!(recovered_header.identity(), expected_header.identity());
        assert_eq!(
            recovered_header.content_hash(),
            expected_header.content_hash()
        );
        assert_eq!(recovered_revision, expected_revision);
        crate::state::set_notes_root_override(None).unwrap();
    }

    #[test]
    fn reopening_rejects_a_missing_store_for_an_observed_generation() {
        let _guard = crate::test_support::lock_test_env();
        let app_data = crate::test_support::TestDir::new("timeline-missing-store-app-data");
        crate::state::initialize_app_data_dir(app_data.path().to_path_buf()).unwrap();
        let notes = crate::test_support::TestDir::new("timeline-missing-store-notes");
        crate::state::set_notes_root_override(Some(notes.path().to_path_buf())).unwrap();
        crate::state::ensure_vault_scaffold(notes.path()).unwrap();
        fs::write(
            notes.path().join("Existing.md"),
            "---\ngneauxghts:\n  id: missing-store-note\n  kind: note\n---\n\nContent",
        )
        .unwrap();
        let state = AppState::new(
            SemanticState::new_disabled("disabled"),
            EventBus::disabled(),
        )
        .unwrap();
        let timeline = state.note_timeline();
        timeline.initialize_existing_notes(notes.path()).unwrap();
        history_store::remove_history_store();

        let error = timeline
            .baseline_initialization_progress()
            .expect_err("missing selected history must require explicit recovery");
        assert!(error.contains("missing or uninitialized"));
        assert!(!history_store::history_store_exists());
        crate::state::set_notes_root_override(None).unwrap();
    }

    #[test]
    fn initialization_and_reset_reject_a_non_active_vault_root() {
        let _guard = crate::test_support::lock_test_env();
        let app_data = crate::test_support::TestDir::new("timeline-root-mismatch-app-data");
        crate::state::initialize_app_data_dir(app_data.path().to_path_buf()).unwrap();
        let active = crate::test_support::TestDir::new("timeline-root-mismatch-active");
        let other = crate::test_support::TestDir::new("timeline-root-mismatch-other");
        crate::state::set_notes_root_override(Some(active.path().to_path_buf())).unwrap();
        crate::state::ensure_vault_scaffold(active.path()).unwrap();
        ensure_vault_scaffold(other.path()).unwrap();
        fs::write(
            active.path().join("Active.md"),
            "---\ngneauxghts:\n  id: active-root-note\n  kind: note\n---\n\nActive",
        )
        .unwrap();
        fs::write(
            other.path().join("Other.md"),
            "---\ngneauxghts:\n  id: other-root-note\n  kind: note\n---\n\nOther",
        )
        .unwrap();
        let state = AppState::new(
            SemanticState::new_disabled("disabled"),
            EventBus::disabled(),
        )
        .unwrap();
        let timeline = state.note_timeline();
        timeline.initialize_existing_notes(active.path()).unwrap();

        assert!(timeline
            .initialize_existing_notes(other.path())
            .expect_err("initialization must use the active vault")
            .contains("vault root mismatch"));
        assert!(timeline
            .reset_history(other.path())
            .expect_err("reset must use the active vault")
            .contains("vault root mismatch"));
        assert_eq!(
            timeline
                .history_mode(HistoryModeGrant::authorized(NoteIdentity::new(
                    "active-root-note",
                )))
                .revisions()
                .unwrap()
                .len(),
            1
        );
        crate::state::set_notes_root_override(None).unwrap();
    }

    #[test]
    fn reopening_detects_rollback_of_both_manifest_and_history_store() {
        let _guard = crate::test_support::lock_test_env();
        let app_data = crate::test_support::TestDir::new("timeline-rollback-app-data");
        crate::state::initialize_app_data_dir(app_data.path().to_path_buf()).unwrap();
        let notes = crate::test_support::TestDir::new("timeline-rollback-notes");
        crate::state::set_notes_root_override(Some(notes.path().to_path_buf())).unwrap();
        crate::state::ensure_vault_scaffold(notes.path()).unwrap();
        fs::write(
            notes.path().join("Existing.md"),
            "---\ngneauxghts:\n  id: rollback-note\n  kind: note\n---\n\nContent",
        )
        .unwrap();
        let state = AppState::new(
            SemanticState::new_disabled("disabled"),
            EventBus::disabled(),
        )
        .unwrap();
        let timeline = state.note_timeline();
        timeline.initialize_existing_notes(notes.path()).unwrap();
        timeline.reset_history(notes.path()).unwrap();

        let manifest_path = crate::state::vault_manifest_path_for(notes.path());
        let mut manifest: serde_json::Value =
            serde_json::from_slice(&fs::read(&manifest_path).unwrap()).unwrap();
        manifest["historyGeneration"] = serde_json::json!(1);
        fs::write(
            &manifest_path,
            serde_json::to_vec_pretty(&manifest).unwrap(),
        )
        .unwrap();
        history_store::replace_history_generation(1);

        let error = timeline
            .baseline_initialization_progress()
            .expect_err("a synchronized rollback must not be accepted silently");
        assert!(error.contains("generation rollback"));
        crate::state::set_notes_root_override(None).unwrap();
    }

    #[test]
    fn development_reset_advances_generation_and_rebuilds_truthful_baselines() {
        let _guard = crate::test_support::lock_test_env();
        let app_data = crate::test_support::TestDir::new("timeline-reset-app-data");
        crate::state::initialize_app_data_dir(app_data.path().to_path_buf()).unwrap();
        let notes = crate::test_support::TestDir::new("timeline-reset-notes");
        crate::state::set_notes_root_override(Some(notes.path().to_path_buf())).unwrap();
        crate::state::ensure_vault_scaffold(notes.path()).unwrap();
        let path = notes.path().join("Existing.md");
        let markdown =
            "---\ngneauxghts:\n  id: reset-note\n  kind: note\n---\n\nRetained current content";
        fs::write(&path, markdown).unwrap();
        let original_bytes = fs::read(&path).unwrap();
        let state = AppState::new(
            SemanticState::new_disabled("disabled"),
            EventBus::disabled(),
        )
        .unwrap();
        let timeline = state.note_timeline();
        timeline.initialize_existing_notes(notes.path()).unwrap();
        let original_revision = timeline
            .history_mode(HistoryModeGrant::authorized(NoteIdentity::new(
                "reset-note",
            )))
            .revisions()
            .unwrap()[0]
            .identity()
            .clone();

        let reset = timeline.reset_history(notes.path()).unwrap();

        assert_eq!(reset.previous_generation(), 1);
        assert_eq!(reset.generation(), 2);
        assert!(!reset.operation_id().is_empty());
        assert!(reset.reset_at_millis() > 0);
        assert_eq!(
            reset.initialization().phase(),
            BaselineInitializationPhase::Complete
        );
        assert_eq!(fs::read(&path).unwrap(), original_bytes);
        let history = timeline.history_mode(HistoryModeGrant::authorized(NoteIdentity::new(
            "reset-note",
        )));
        let revisions = history.revisions().unwrap();
        assert_eq!(revisions.len(), 1);
        assert_ne!(revisions[0].identity(), &original_revision);
        assert_eq!(
            revisions[0].source(),
            MutationSource::BaselineInitialization
        );
        assert!(history.reconstruct(&original_revision).is_err());
        let manifest = crate::state::read_vault_manifest_for(notes.path())
            .unwrap()
            .unwrap();
        assert_eq!(manifest.history_generation, 2);
        let operation_id = reset.operation_id().to_string();
        drop(history);
        drop(timeline);
        drop(state);
        let restarted = AppState::new(
            SemanticState::new_disabled("disabled"),
            EventBus::disabled(),
        )
        .unwrap();
        let durable_reset = restarted
            .note_timeline()
            .latest_history_reset()
            .unwrap()
            .expect("reset diagnostic survives replacement and restart");
        assert_eq!(durable_reset.operation_id(), operation_id);
        assert_eq!(durable_reset.previous_generation(), 1);
        assert_eq!(durable_reset.generation(), 2);
        crate::state::set_notes_root_override(None).unwrap();
    }

    #[test]
    fn failed_reset_rebuild_keeps_the_replacement_timeline_unavailable_until_retry() {
        let _guard = crate::test_support::lock_test_env();
        let app_data = crate::test_support::TestDir::new("timeline-reset-rebuild-failure-data");
        crate::state::initialize_app_data_dir(app_data.path().to_path_buf()).unwrap();
        let notes = crate::test_support::TestDir::new("timeline-reset-rebuild-failure-notes");
        crate::state::set_notes_root_override(Some(notes.path().to_path_buf())).unwrap();
        crate::state::ensure_vault_scaffold(notes.path()).unwrap();
        fs::write(
            notes.path().join("Existing.md"),
            "---\ngneauxghts:\n  id: reset-rebuild-note\n  kind: note\n---\n\nCanonical content",
        )
        .unwrap();
        let state = AppState::new(
            SemanticState::new_disabled("disabled"),
            EventBus::disabled(),
        )
        .unwrap();
        let timeline = state.note_timeline();
        timeline.initialize_existing_notes(notes.path()).unwrap();
        inject_history_baseline_failure_once();

        let error = timeline
            .reset_history(notes.path())
            .expect_err("an incomplete replacement must not become available");

        assert!(error.contains("did not rebuild completely"));
        history_store::clear_reset_rebuild_marker_for_test();
        drop(timeline);
        drop(state);
        let restarted = AppState::new(
            SemanticState::new_disabled("disabled"),
            EventBus::disabled(),
        )
        .unwrap();
        let timeline = restarted.note_timeline();
        assert_eq!(
            timeline.history_health().unwrap().state(),
            HistoryHealthState::Corrupt
        );
        assert!(timeline
            .open_history_mode(NoteIdentity::new("reset-rebuild-note"))
            .revisions()
            .expect_err("partial replacement remains inaccessible")
            .contains("corrupt"));

        let retry = timeline
            .reset_corrupt_history(notes.path(), true)
            .expect("confirmed retry rebuilds the replacement");
        assert_eq!(
            retry.initialization().phase(),
            BaselineInitializationPhase::Complete
        );
        assert_eq!(
            timeline
                .open_history_mode(NoteIdentity::new("reset-rebuild-note"))
                .revisions()
                .unwrap()
                .len(),
            1
        );
        crate::state::set_notes_root_override(None).unwrap();
    }

    #[test]
    fn development_reset_refuses_to_discard_an_unreconstructable_missing_note() {
        let _guard = crate::test_support::lock_test_env();
        let app_data = crate::test_support::TestDir::new("timeline-reset-bad-missing-data");
        crate::state::initialize_app_data_dir(app_data.path().to_path_buf()).unwrap();
        let notes = crate::test_support::TestDir::new("timeline-reset-bad-missing-notes");
        crate::state::set_notes_root_override(Some(notes.path().to_path_buf())).unwrap();
        crate::state::ensure_vault_scaffold(notes.path()).unwrap();
        let state = AppState::new(
            SemanticState::new_disabled("disabled"),
            EventBus::disabled(),
        )
        .unwrap();
        let created = crate::commands::note_persistence::persist_note_session_with_outcome(
            &state,
            "Unreconstructable missing".to_string(),
            "Retained body".to_string(),
            None,
        )
        .unwrap()
        .session
        .unwrap();
        let note_id = NoteIdentity::new(created.note_id.unwrap());
        let path = PathBuf::from(created.path.unwrap());
        fs::remove_file(&path).unwrap();
        let timeline = state.note_timeline();
        timeline
            .observe(VaultObservation::missing(
                path,
                crate::time::current_time_millis().unwrap() + 1,
            ))
            .unwrap();
        corrupt_note_revision_payload_for_test(&note_id);

        let error = timeline
            .reset_corrupt_history(notes.path(), true)
            .expect_err("reset must not erase an unreconstructable Missing Note");

        assert!(error.contains("Reconstruct"));
        assert_eq!(
            crate::state::read_vault_manifest_for(notes.path())
                .unwrap()
                .unwrap()
                .history_generation,
            1
        );
        crate::state::set_notes_root_override(None).unwrap();
    }

    #[test]
    fn development_reset_preserves_a_reconstructable_missing_note_for_recovery() {
        let _guard = crate::test_support::lock_test_env();
        let app_data = crate::test_support::TestDir::new("timeline-reset-missing-data");
        crate::state::initialize_app_data_dir(app_data.path().to_path_buf()).unwrap();
        let notes = crate::test_support::TestDir::new("timeline-reset-missing-notes");
        crate::state::set_notes_root_override(Some(notes.path().to_path_buf())).unwrap();
        crate::state::ensure_vault_scaffold(notes.path()).unwrap();
        crate::state::set_forgotten_note_retention_days(30).unwrap();
        let state = AppState::new(
            SemanticState::new_disabled("disabled"),
            EventBus::disabled(),
        )
        .unwrap();
        let created = crate::commands::note_persistence::persist_note_session_with_outcome(
            &state,
            "Reset missing".to_string(),
            "Recoverable current body".to_string(),
            None,
        )
        .unwrap()
        .session
        .unwrap();
        let note_id = NoteIdentity::new(created.note_id.unwrap());
        let path = PathBuf::from(created.path.unwrap());
        fs::remove_file(&path).unwrap();
        let missing_at = crate::time::current_time_millis().unwrap() + 1;
        let timeline = state.note_timeline();
        timeline
            .observe(VaultObservation::missing(path.clone(), missing_at))
            .unwrap();
        let before = timeline.missing_notes().unwrap().remove(0);

        let reset = timeline.reset_history(notes.path()).unwrap();

        assert_eq!(reset.initialization().discovered_notes(), 1);
        drop(timeline);
        drop(state);
        let restarted = AppState::new(
            SemanticState::new_disabled("disabled"),
            EventBus::disabled(),
        )
        .unwrap();
        let timeline = restarted.note_timeline();
        let after = timeline.missing_notes().unwrap().remove(0);
        assert_eq!(after.note_id(), &note_id);
        assert_eq!(after.path(), path);
        assert_eq!(after.missing_at_millis(), before.missing_at_millis());
        assert_eq!(after.retention_days(), before.retention_days());
        assert_eq!(after.purge_at_millis(), before.purge_at_millis());
        let recovery = timeline.recover_missing_note(note_id.clone()).unwrap();
        assert_eq!(
            crate::note::parse_note(&fs::read_to_string(recovery.receipt().path()).unwrap()).body,
            "Recoverable current body"
        );
        let access = timeline.open_history_mode(note_id);
        assert_eq!(access.revisions().unwrap().len(), 1);
        assert_eq!(
            access.revisions().unwrap()[0].source(),
            MutationSource::BaselineInitialization
        );
        assert_eq!(
            access
                .lifecycle_events()
                .unwrap()
                .into_iter()
                .map(|event| event.kind())
                .collect::<Vec<_>>(),
            vec![LifecycleEventKind::Missing, LifecycleEventKind::Recovered]
        );
        crate::state::set_notes_root_override(None).unwrap();
    }

    #[test]
    fn history_health_reports_initialization_storage_and_per_note_usage() {
        let _guard = crate::test_support::lock_test_env();
        let app_data = crate::test_support::TestDir::new("timeline-health-app-data");
        crate::state::initialize_app_data_dir(app_data.path().to_path_buf()).unwrap();
        let notes = crate::test_support::TestDir::new("timeline-health-notes");
        crate::state::set_notes_root_override(Some(notes.path().to_path_buf())).unwrap();
        crate::state::ensure_vault_scaffold(notes.path()).unwrap();
        fs::write(
            notes.path().join("Healthy.md"),
            "---\ngneauxghts:\n  id: healthy-note\n  kind: note\n---\n\nReadable Markdown",
        )
        .unwrap();
        let state = AppState::new(
            SemanticState::new_disabled("disabled"),
            EventBus::disabled(),
        )
        .unwrap();
        let timeline = state.note_timeline();

        let initializing = timeline.history_health().unwrap();
        assert_eq!(initializing.state(), HistoryHealthState::Initializing);
        assert_eq!(
            initializing.initialization().phase(),
            BaselineInitializationPhase::NotStarted
        );

        timeline.initialize_existing_notes(notes.path()).unwrap();
        let healthy = timeline.history_health().unwrap();
        assert_eq!(healthy.state(), HistoryHealthState::Healthy);
        assert_eq!(healthy.integrity(), HistoryIntegrityState::Verified);
        assert!(healthy.storage().unwrap().allocated_bytes() > 0);
        assert!(!healthy.can_retry());
        assert!(!healthy.can_reset());
        let serialized = serde_json::to_value(&healthy).unwrap();
        assert_eq!(serialized["state"], "healthy");
        assert_eq!(serialized["integrity"], "verified");
        assert_eq!(serialized["initialization"]["phase"], "complete");
        assert_eq!(
            serialized["storage"]["allocatedBytes"].as_u64().unwrap(),
            healthy.storage().unwrap().allocated_bytes()
        );

        let note = timeline
            .note_history_health(&NoteIdentity::new("healthy-note"))
            .unwrap();
        assert_eq!(note.state(), NoteHistoryHealthState::Healthy);
        assert_eq!(note.revision_count(), 1);
        assert_eq!(note.lifecycle_event_count(), 0);
        assert!(note.revision_payload_bytes() > 0);
        crate::state::set_notes_root_override(None).unwrap();
    }

    #[test]
    fn unavailable_history_is_actionable_without_hiding_markdown() {
        let _guard = crate::test_support::lock_test_env();
        let app_data = crate::test_support::TestDir::new("timeline-unavailable-app-data");
        crate::state::initialize_app_data_dir(app_data.path().to_path_buf()).unwrap();
        let notes = crate::test_support::TestDir::new("timeline-unavailable-notes");
        crate::state::set_notes_root_override(Some(notes.path().to_path_buf())).unwrap();
        crate::state::ensure_vault_scaffold(notes.path()).unwrap();
        let path = notes.path().join("Readable.md");
        let markdown =
            "---\ngneauxghts:\n  id: readable-note\n  kind: note\n---\n\nReadable Markdown";
        fs::write(&path, markdown).unwrap();
        let state = AppState::new(
            SemanticState::new_disabled("disabled"),
            EventBus::disabled(),
        )
        .unwrap();
        let timeline = state.note_timeline();
        timeline.initialize_existing_notes(notes.path()).unwrap();
        history_store::remove_history_store();

        let report = timeline.history_health().unwrap();
        assert_eq!(report.state(), HistoryHealthState::Unavailable);
        assert_eq!(report.integrity(), HistoryIntegrityState::Unavailable);
        assert!(report.storage().is_none());
        assert!(report.can_retry());
        assert!(report.can_reset());
        assert_eq!(fs::read_to_string(&path).unwrap(), markdown);

        let error = crate::commands::note_persistence::persist_note_session_with_outcome(
            &state,
            "Readable".to_string(),
            "Dirty editor work".to_string(),
            Some(path.to_string_lossy().into_owned()),
        )
        .expect_err("history preparation must still fail closed");
        assert!(error.contains("history store"));
        assert_eq!(fs::read_to_string(&path).unwrap(), markdown);

        let reset = timeline
            .reset_corrupt_history(notes.path(), true)
            .expect("unavailable history can be replaced from canonical Markdown");
        assert_eq!(reset.previous_generation(), 1);
        assert_eq!(reset.generation(), 2);
        assert_eq!(
            reset.initialization().phase(),
            BaselineInitializationPhase::Complete
        );
        assert_eq!(fs::read_to_string(&path).unwrap(), markdown);
        assert_eq!(
            timeline
                .open_history_mode(NoteIdentity::new("readable-note"))
                .revisions()
                .unwrap()
                .len(),
            1
        );
        crate::state::set_notes_root_override(None).unwrap();
    }

    #[test]
    fn history_health_exposes_degraded_and_post_commit_warning_retry_paths() {
        let _guard = crate::test_support::lock_test_env();
        let app_data = crate::test_support::TestDir::new("timeline-health-retry-app-data");
        crate::state::initialize_app_data_dir(app_data.path().to_path_buf()).unwrap();
        let notes = crate::test_support::TestDir::new("timeline-health-retry-notes");
        crate::state::set_notes_root_override(Some(notes.path().to_path_buf())).unwrap();
        crate::state::ensure_vault_scaffold(notes.path()).unwrap();
        fs::write(
            notes.path().join("Existing.md"),
            "---\ngneauxghts:\n  id: retry-note\n  kind: note\n---\n\nExisting",
        )
        .unwrap();
        let state = AppState::new(
            SemanticState::new_disabled("disabled"),
            EventBus::disabled(),
        )
        .unwrap();
        let timeline = state.note_timeline();
        history_store::inject_fault_once(history_store::FaultPoint::Baseline);
        let progress = timeline.initialize_existing_notes(notes.path()).unwrap();
        assert_eq!(progress.phase(), BaselineInitializationPhase::Degraded);
        assert_eq!(
            timeline.history_health().unwrap().state(),
            HistoryHealthState::Degraded
        );
        assert_eq!(
            timeline
                .note_history_health(&NoteIdentity::new("retry-note"))
                .unwrap()
                .state(),
            NoteHistoryHealthState::Degraded
        );

        let retried = timeline.retry_history_recovery(notes.path()).unwrap();
        assert_eq!(retried.state(), HistoryHealthState::Healthy);
        assert_eq!(retried.initialization().failed_notes(), 0);

        inject_history_finalization_failure_once();
        let committed = crate::commands::note_persistence::persist_note_session_with_outcome(
            &state,
            "Existing".to_string(),
            "Published despite finalization warning".to_string(),
            Some(
                notes
                    .path()
                    .join("Existing.md")
                    .to_string_lossy()
                    .into_owned(),
            ),
        )
        .unwrap()
        .session
        .unwrap();
        assert!(committed.commit_warning.is_some());
        let warning = timeline.history_health().unwrap();
        assert_eq!(warning.state(), HistoryHealthState::Warning);
        assert!(warning.can_retry());

        let repaired = timeline.retry_history_recovery(notes.path()).unwrap();
        assert_eq!(repaired.state(), HistoryHealthState::Healthy);
        assert_eq!(
            timeline
                .history_mode(HistoryModeGrant::authorized(NoteIdentity::new(
                    "retry-note"
                )))
                .revisions()
                .unwrap()
                .len(),
            2
        );
        crate::state::set_notes_root_override(None).unwrap();
    }

    #[test]
    fn corrupt_note_history_can_be_confirmed_reset_and_diagnosed_after_restart() {
        let _guard = crate::test_support::lock_test_env();
        let app_data = crate::test_support::TestDir::new("timeline-corrupt-reset-app-data");
        crate::state::initialize_app_data_dir(app_data.path().to_path_buf()).unwrap();
        let notes = crate::test_support::TestDir::new("timeline-corrupt-reset-notes");
        crate::state::set_notes_root_override(Some(notes.path().to_path_buf())).unwrap();
        crate::state::ensure_vault_scaffold(notes.path()).unwrap();
        let path = notes.path().join("Current.md");
        let markdown =
            "---\ngneauxghts:\n  id: corrupt-note\n  kind: note\n---\n\nCurrent readable state";
        fs::write(&path, markdown).unwrap();
        let state = AppState::new(
            SemanticState::new_disabled("disabled"),
            EventBus::disabled(),
        )
        .unwrap();
        let timeline = state.note_timeline();
        timeline.initialize_existing_notes(notes.path()).unwrap();
        let original_revision = timeline
            .history_mode(HistoryModeGrant::authorized(NoteIdentity::new(
                "corrupt-note",
            )))
            .revisions()
            .unwrap()[0]
            .identity()
            .clone();
        history_store::seed_revision_dependents_for_test(&original_revision);
        assert_eq!(
            history_store::revision_dependent_count_for_test(&NoteIdentity::new("corrupt-note")),
            2
        );
        history_store::replace_revision_payload_version(&NoteIdentity::new("corrupt-note"), 99);

        let report = timeline.history_health().unwrap();
        assert_eq!(report.state(), HistoryHealthState::Corrupt);
        assert_eq!(report.integrity(), HistoryIntegrityState::Corrupt);
        assert!(report.can_reset());
        assert_eq!(
            timeline
                .note_history_health(&NoteIdentity::new("corrupt-note"))
                .unwrap()
                .state(),
            NoteHistoryHealthState::Corrupt
        );
        let blocked = crate::commands::note_persistence::persist_note_session_with_outcome(
            &state,
            "Current".to_string(),
            "Dirty editor work must not publish".to_string(),
            Some(path.to_string_lossy().into_owned()),
        )
        .expect_err("corrupt history must block canonical publication");
        assert!(blocked.contains("history is corrupt"));
        assert_eq!(fs::read_to_string(&path).unwrap(), markdown);
        history_store::replace_revision_payload_version(&NoteIdentity::new("corrupt-note"), 1);
        assert_eq!(
            timeline.history_health().unwrap().state(),
            HistoryHealthState::Corrupt,
            "only an explicit reset may clear a latched corrupt state"
        );
        assert_eq!(
            timeline
                .note_history_health(&NoteIdentity::new("corrupt-note"))
                .unwrap()
                .state(),
            NoteHistoryHealthState::Corrupt
        );
        assert!(timeline
            .reset_corrupt_history(notes.path(), false)
            .expect_err("reset requires explicit confirmation")
            .contains("confirmation"));

        let reset = timeline.reset_corrupt_history(notes.path(), true).unwrap();
        assert_eq!(fs::read_to_string(&path).unwrap(), markdown);
        assert_eq!(reset.previous_generation(), 1);
        assert_eq!(reset.generation(), 2);
        let recovered = timeline.history_health().unwrap();
        assert_eq!(recovered.state(), HistoryHealthState::Healthy);
        assert_eq!(recovered.integrity(), HistoryIntegrityState::Verified);
        assert!(recovered.last_reset().is_some());
        assert!(timeline
            .history_mode(HistoryModeGrant::authorized(NoteIdentity::new(
                "corrupt-note"
            )))
            .reconstruct(&original_revision)
            .is_err());
        assert_eq!(
            history_store::revision_dependent_count_for_test(&NoteIdentity::new("corrupt-note")),
            0
        );

        let operation_id = reset.operation_id().to_string();
        drop(timeline);
        drop(state);
        let restarted = AppState::new(
            SemanticState::new_disabled("disabled"),
            EventBus::disabled(),
        )
        .unwrap();
        let after_restart = restarted.note_timeline().history_health().unwrap();
        assert_eq!(
            after_restart.last_reset().unwrap().operation_id(),
            operation_id
        );
        crate::state::set_notes_root_override(None).unwrap();
    }

    #[test]
    fn malformed_history_store_can_be_confirmed_reset_from_canonical_markdown() {
        let _guard = crate::test_support::lock_test_env();
        let app_data = crate::test_support::TestDir::new("timeline-malformed-reset-app-data");
        crate::state::initialize_app_data_dir(app_data.path().to_path_buf()).unwrap();
        let notes = crate::test_support::TestDir::new("timeline-malformed-reset-notes");
        crate::state::set_notes_root_override(Some(notes.path().to_path_buf())).unwrap();
        crate::state::ensure_vault_scaffold(notes.path()).unwrap();
        let path = notes.path().join("Readable.md");
        let markdown =
            "---\ngneauxghts:\n  id: malformed-reset-note\n  kind: note\n---\n\nReadable truth";
        fs::write(&path, markdown).unwrap();
        let state = AppState::new(
            SemanticState::new_disabled("disabled"),
            EventBus::disabled(),
        )
        .unwrap();
        let timeline = state.note_timeline();
        timeline.initialize_existing_notes(notes.path()).unwrap();
        history_store::replace_history_store_with_malformed_file_for_test();
        assert_eq!(
            timeline.history_health().unwrap().state(),
            HistoryHealthState::Corrupt
        );

        let reset = timeline
            .reset_corrupt_history(notes.path(), true)
            .expect("replace malformed history from canonical Markdown");

        assert_eq!(reset.previous_generation(), 1);
        assert_eq!(reset.generation(), 2);
        assert_eq!(fs::read_to_string(&path).unwrap(), markdown);
        assert_eq!(
            timeline
                .open_history_mode(NoteIdentity::new("malformed-reset-note"))
                .revisions()
                .unwrap()
                .len(),
            1
        );
        crate::state::set_notes_root_override(None).unwrap();
    }

    #[test]
    fn history_preparation_failure_publishes_nothing() {
        let _guard = crate::test_support::lock_test_env();
        let app_data = crate::test_support::TestDir::new("timeline-prepare-fault-app-data");
        crate::state::initialize_app_data_dir(app_data.path().to_path_buf()).unwrap();
        let notes = crate::test_support::TestDir::new("timeline-prepare-fault-notes");
        crate::state::set_notes_root_override(Some(notes.path().to_path_buf())).unwrap();
        crate::state::ensure_vault_scaffold(notes.path()).unwrap();
        let state = AppState::new(
            SemanticState::new_disabled("disabled"),
            EventBus::disabled(),
        )
        .unwrap();
        history_store::inject_fault_once(history_store::FaultPoint::Prepare);

        let error = crate::commands::note_persistence::persist_note_session_with_outcome(
            &state,
            "Blocked".to_string(),
            "Dirty editor content".to_string(),
            None,
        )
        .expect_err("history preparation must fail closed");

        assert!(error.contains("injected history preparation failure"));
        assert!(!notes.path().join("Blocked.md").exists());
        crate::state::set_notes_root_override(None).unwrap();
    }

    #[test]
    fn repeated_publication_preparation_reuses_one_integrity_attestation() {
        let _guard = crate::test_support::lock_test_env();
        let app_data = crate::test_support::TestDir::new("timeline-integrity-cache-app-data");
        crate::state::initialize_app_data_dir(app_data.path().to_path_buf()).unwrap();
        let notes = crate::test_support::TestDir::new("timeline-integrity-cache-notes");
        crate::state::set_notes_root_override(Some(notes.path().to_path_buf())).unwrap();
        crate::state::ensure_vault_scaffold(notes.path()).unwrap();
        let state = AppState::new(
            SemanticState::new_disabled("disabled"),
            EventBus::disabled(),
        )
        .unwrap();
        let timeline = state.note_timeline();
        history_store::reset_integrity_snapshot_count();

        timeline
            .prepare_revision_publication(
                MutationSource::NoteCreation,
                &notes.path().join("First.md"),
                None,
                None,
                "first",
            )
            .unwrap();
        timeline
            .prepare_revision_publication(
                MutationSource::NoteCreation,
                &notes.path().join("Second.md"),
                None,
                None,
                "second",
            )
            .unwrap();

        assert_eq!(history_store::integrity_snapshot_count(), 1);
        crate::state::set_notes_root_override(None).unwrap();
    }

    #[test]
    fn a_second_preparation_cannot_abandon_an_in_flight_intent() {
        let _guard = crate::test_support::lock_test_env();
        let app_data = crate::test_support::TestDir::new("timeline-live-intent-app-data");
        crate::state::initialize_app_data_dir(app_data.path().to_path_buf()).unwrap();
        let notes = crate::test_support::TestDir::new("timeline-live-intent-notes");
        crate::state::set_notes_root_override(Some(notes.path().to_path_buf())).unwrap();
        crate::state::ensure_vault_scaffold(notes.path()).unwrap();
        let state = AppState::new(
            SemanticState::new_disabled("disabled"),
            EventBus::disabled(),
        )
        .unwrap();
        let timeline = state.note_timeline();
        let first_path = notes.path().join("First.md");
        let second_path = notes.path().join("Second.md");
        let first = timeline
            .prepare_revision_publication(
                MutationSource::NoteCreation,
                &first_path,
                None,
                None,
                "first",
            )
            .unwrap();

        let second = timeline
            .prepare_revision_publication(
                MutationSource::NoteCreation,
                &second_path,
                None,
                None,
                "second",
            )
            .unwrap();
        let (first, first_intent) = first.into_parts();
        let (second, second_intent) = second.into_parts();
        fs::write(&first_path, &first).unwrap();
        let first_result = timeline.mutate(NoteMutation::note_creation(
            first_intent,
            first_path.clone(),
            None,
            first,
        ));
        assert_eq!(first_result.warning(), None);

        fs::write(&second_path, &second).unwrap();
        let second_result = timeline.mutate(NoteMutation::note_creation(
            second_intent,
            second_path.clone(),
            None,
            second,
        ));
        assert_eq!(second_result.warning(), None);
        assert_eq!(
            timeline
                .history_mode(HistoryModeGrant::authorized(first_result.note_id().clone()))
                .revisions()
                .unwrap()
                .len(),
            1
        );
        crate::state::set_notes_root_override(None).unwrap();
    }

    #[test]
    fn finalization_uses_the_exact_prepared_intent_identity() {
        let _guard = crate::test_support::lock_test_env();
        let app_data = crate::test_support::TestDir::new("timeline-intent-id-app-data");
        crate::state::initialize_app_data_dir(app_data.path().to_path_buf()).unwrap();
        let notes = crate::test_support::TestDir::new("timeline-intent-id-notes");
        crate::state::set_notes_root_override(Some(notes.path().to_path_buf())).unwrap();
        crate::state::ensure_vault_scaffold(notes.path()).unwrap();
        let state = AppState::new(
            SemanticState::new_disabled("disabled"),
            EventBus::disabled(),
        )
        .unwrap();
        let created = crate::commands::note_persistence::persist_note_session_with_outcome(
            &state,
            "Intent".to_string(),
            "initial".to_string(),
            None,
        )
        .unwrap()
        .session
        .unwrap();
        let path = PathBuf::from(created.path.unwrap());
        let timeline = state.note_timeline();
        let first = timeline
            .prepare_revision_publication(
                MutationSource::Editor,
                &path,
                Some(&path),
                None,
                "first update",
            )
            .unwrap();
        let second = timeline
            .prepare_revision_publication(
                MutationSource::Editor,
                &path,
                Some(&path),
                None,
                "second update",
            )
            .unwrap();
        let (first_markdown, first_intent) = first.into_parts();
        let (second_markdown, second_intent) = second.into_parts();
        fs::write(&path, &second_markdown).unwrap();

        let stale = timeline.mutate(NoteMutation::editor(
            first_intent,
            path.clone(),
            Some(path.clone()),
            first_markdown,
        ));
        assert!(stale.warning().is_some());
        let committed = timeline.mutate(NoteMutation::editor(
            second_intent,
            path.clone(),
            Some(path),
            second_markdown,
        ));
        assert_eq!(committed.warning(), None);

        let history = timeline.history_mode(HistoryModeGrant::authorized(NoteIdentity::new(
            created.note_id.unwrap(),
        )));
        assert_eq!(history.revisions().unwrap().len(), 2);
        crate::state::set_notes_root_override(None).unwrap();
    }

    #[test]
    fn finalization_rejects_matching_authored_content_under_another_note_identity() {
        let _guard = crate::test_support::lock_test_env();
        let app_data = crate::test_support::TestDir::new("timeline-intent-note-id-app-data");
        crate::state::initialize_app_data_dir(app_data.path().to_path_buf()).unwrap();
        let notes = crate::test_support::TestDir::new("timeline-intent-note-id-notes");
        crate::state::set_notes_root_override(Some(notes.path().to_path_buf())).unwrap();
        crate::state::ensure_vault_scaffold(notes.path()).unwrap();
        let state = AppState::new(
            SemanticState::new_disabled("disabled"),
            EventBus::disabled(),
        )
        .unwrap();
        let timeline = state.note_timeline();
        let path = notes.path().join("Identity Mismatch.md");
        let prepared = timeline
            .prepare_revision_publication(
                MutationSource::NoteCreation,
                &path,
                None,
                None,
                "same authored content",
            )
            .unwrap();
        let intended_note_id = NoteIdentity::new(
            crate::note::parse_note(prepared.canonical_markdown())
                .frontmatter
                .managed
                .unwrap()
                .id,
        );
        let (canonical, history_intent) = prepared.into_parts();
        let wrong_identity =
            crate::note::repair_managed_note_identity(&canonical, "wrong-note-id").unwrap();
        fs::write(&path, &wrong_identity).unwrap();

        let result = timeline.mutate(NoteMutation::note_creation(
            history_intent,
            path,
            None,
            wrong_identity,
        ));

        assert!(result.warning().is_some());
        let history = timeline.history_mode(HistoryModeGrant::authorized(intended_note_id));
        assert!(history.revisions().unwrap().is_empty());
        assert_eq!(history_store::prepared_intent_count("abandoned"), 1);
        crate::state::set_notes_root_override(None).unwrap();
    }

    #[test]
    fn finalization_abandons_publication_without_a_managed_note_identity() {
        let _guard = crate::test_support::lock_test_env();
        let app_data = crate::test_support::TestDir::new("timeline-missing-id-app-data");
        crate::state::initialize_app_data_dir(app_data.path().to_path_buf()).unwrap();
        let notes = crate::test_support::TestDir::new("timeline-missing-id-notes");
        crate::state::set_notes_root_override(Some(notes.path().to_path_buf())).unwrap();
        crate::state::ensure_vault_scaffold(notes.path()).unwrap();
        let state = AppState::new(
            SemanticState::new_disabled("disabled"),
            EventBus::disabled(),
        )
        .unwrap();
        let timeline = state.note_timeline();
        let path = notes.path().join("Identity Missing.md");
        let prepared = timeline
            .prepare_revision_publication(
                MutationSource::NoteCreation,
                &path,
                None,
                None,
                "same authored content",
            )
            .unwrap();
        let (canonical, history_intent) = prepared.into_parts();
        let without_identity = "same authored content".to_string();
        fs::write(&path, &without_identity).unwrap();

        let result = timeline.mutate(NoteMutation::note_creation(
            history_intent,
            path,
            None,
            canonical,
        ));

        assert!(result.warning().is_some());
        assert_eq!(history_store::prepared_intent_count("prepared"), 0);
        assert_eq!(history_store::prepared_intent_count("abandoned"), 1);
        crate::state::set_notes_root_override(None).unwrap();
    }

    #[test]
    fn unreadable_authoritative_markdown_never_finalizes_from_fallback_memory() {
        let _guard = crate::test_support::lock_test_env();
        let app_data = crate::test_support::TestDir::new("timeline-read-fault-app-data");
        crate::state::initialize_app_data_dir(app_data.path().to_path_buf()).unwrap();
        let notes = crate::test_support::TestDir::new("timeline-read-fault-notes");
        crate::state::set_notes_root_override(Some(notes.path().to_path_buf())).unwrap();
        crate::state::ensure_vault_scaffold(notes.path()).unwrap();
        let state = AppState::new(
            SemanticState::new_disabled("disabled"),
            EventBus::disabled(),
        )
        .unwrap();
        let timeline = state.note_timeline();
        let path = notes.path().join("Vanished.md");
        let prepared = timeline
            .prepare_revision_publication(
                MutationSource::NoteCreation,
                &path,
                None,
                None,
                "published then removed",
            )
            .unwrap();
        let note_id = NoteIdentity::new(
            crate::note::parse_note(prepared.canonical_markdown())
                .frontmatter
                .managed
                .unwrap()
                .id,
        );
        let (canonical, history_intent) = prepared.into_parts();
        fs::write(&path, &canonical).unwrap();
        fs::remove_file(&path).unwrap();

        let result = timeline.mutate(NoteMutation::note_creation(
            history_intent,
            path,
            None,
            canonical,
        ));

        assert!(result.warning().is_some());
        assert!(timeline
            .history_mode(HistoryModeGrant::authorized(note_id))
            .revisions()
            .unwrap()
            .is_empty());
        crate::state::set_notes_root_override(None).unwrap();
    }

    #[test]
    fn transient_startup_recovery_failure_can_be_retried() {
        let _guard = crate::test_support::lock_test_env();
        let app_data = crate::test_support::TestDir::new("timeline-recovery-retry-app-data");
        crate::state::initialize_app_data_dir(app_data.path().to_path_buf()).unwrap();
        let notes = crate::test_support::TestDir::new("timeline-recovery-retry-notes");
        crate::state::set_notes_root_override(Some(notes.path().to_path_buf())).unwrap();
        crate::state::ensure_vault_scaffold(notes.path()).unwrap();
        let state = AppState::new(
            SemanticState::new_disabled("disabled"),
            EventBus::disabled(),
        )
        .unwrap();
        let history = state
            .note_timeline()
            .history_mode(HistoryModeGrant::authorized(NoteIdentity::new(
                "missing-note",
            )));
        inject_history_recovery_failure_once();

        assert!(history
            .revisions()
            .unwrap_err()
            .contains("injected history recovery failure"));
        assert!(history.revisions().unwrap().is_empty());
        crate::state::set_notes_root_override(None).unwrap();
    }

    #[test]
    fn canonical_read_failure_keeps_pending_recovery_retryable() {
        let _guard = crate::test_support::lock_test_env();
        let app_data = crate::test_support::TestDir::new("timeline-read-retry-app-data");
        crate::state::initialize_app_data_dir(app_data.path().to_path_buf()).unwrap();
        let notes = crate::test_support::TestDir::new("timeline-read-retry-notes");
        crate::state::set_notes_root_override(Some(notes.path().to_path_buf())).unwrap();
        crate::state::ensure_vault_scaffold(notes.path()).unwrap();
        let state = AppState::new(
            SemanticState::new_disabled("disabled"),
            EventBus::disabled(),
        )
        .unwrap();
        let path = notes.path().join("Unreadable.md");
        let prepared = state
            .note_timeline()
            .prepare_revision_publication(
                MutationSource::NoteCreation,
                &path,
                None,
                None,
                "published bytes",
            )
            .unwrap();
        let note_id = NoteIdentity::new(
            crate::note::parse_note(prepared.canonical_markdown())
                .frontmatter
                .managed
                .unwrap()
                .id,
        );
        let canonical = prepared.canonical_markdown().to_string();
        fs::create_dir(&path).unwrap();

        let restarted = AppState::new(
            SemanticState::new_disabled("disabled"),
            EventBus::disabled(),
        )
        .unwrap();
        let history = restarted
            .note_timeline()
            .history_mode(HistoryModeGrant::authorized(note_id));
        assert!(history
            .revisions()
            .unwrap_err()
            .contains("Read pending canonical publication"));
        assert_eq!(history_store::prepared_intent_count("prepared"), 1);

        fs::remove_dir(&path).unwrap();
        fs::write(&path, canonical).unwrap();
        assert_eq!(history.revisions().unwrap().len(), 1);
        crate::state::set_notes_root_override(None).unwrap();
    }

    #[test]
    fn rename_with_authored_change_does_not_emit_a_second_created_event() {
        let _guard = crate::test_support::lock_test_env();
        let app_data = crate::test_support::TestDir::new("timeline-rename-event-app-data");
        crate::state::initialize_app_data_dir(app_data.path().to_path_buf()).unwrap();
        let notes = crate::test_support::TestDir::new("timeline-rename-event-notes");
        crate::state::set_notes_root_override(Some(notes.path().to_path_buf())).unwrap();
        crate::state::ensure_vault_scaffold(notes.path()).unwrap();
        let state = AppState::new(
            SemanticState::new_disabled("disabled"),
            EventBus::disabled(),
        )
        .unwrap();
        let created = crate::commands::note_persistence::persist_note_session_with_outcome(
            &state,
            "Before".to_string(),
            "first body".to_string(),
            None,
        )
        .unwrap()
        .session
        .unwrap();
        let note_id = NoteIdentity::new(created.note_id.unwrap());

        crate::commands::note_persistence::persist_note_session_with_outcome(
            &state,
            "After".to_string(),
            "changed body".to_string(),
            created.path,
        )
        .unwrap();

        let history = state
            .note_timeline()
            .history_mode(HistoryModeGrant::authorized(note_id));
        assert_eq!(history.revisions().unwrap().len(), 2);
        let events = history.lifecycle_events().unwrap();
        assert_eq!(events.len(), 2);
        assert_eq!(
            events
                .iter()
                .filter(|event| event.kind() == LifecycleEventKind::Created)
                .count(),
            1
        );
        assert!(events
            .iter()
            .any(|event| event.kind() == LifecycleEventKind::Renamed));
        crate::state::set_notes_root_override(None).unwrap();
    }

    #[test]
    fn committed_markdown_survives_finalization_failure_and_recovers_once() {
        let _guard = crate::test_support::lock_test_env();
        let app_data = crate::test_support::TestDir::new("timeline-finalize-fault-app-data");
        crate::state::initialize_app_data_dir(app_data.path().to_path_buf()).unwrap();
        let notes = crate::test_support::TestDir::new("timeline-finalize-fault-notes");
        crate::state::set_notes_root_override(Some(notes.path().to_path_buf())).unwrap();
        crate::state::ensure_vault_scaffold(notes.path()).unwrap();
        let state = AppState::new(
            SemanticState::new_disabled("disabled"),
            EventBus::disabled(),
        )
        .unwrap();
        history_store::inject_fault_once(history_store::FaultPoint::Finalize);
        let before_publication = crate::time::current_time_millis().unwrap();

        let session = crate::commands::note_persistence::persist_note_session_with_outcome(
            &state,
            "Recoverable".to_string(),
            "Published content".to_string(),
            None,
        )
        .unwrap()
        .session
        .unwrap();
        let after_publication = crate::time::current_time_millis().unwrap();
        assert!(Path::new(session.path.as_deref().unwrap()).exists());
        assert!(session
            .commit_warning
            .as_ref()
            .unwrap()
            .issues()
            .iter()
            .any(|issue| issue.stage() == MutationWarningStage::HistoryFinalization));

        std::thread::sleep(std::time::Duration::from_millis(10));
        let canonical = fs::read_to_string(session.path.as_deref().unwrap()).unwrap();
        fs::write(session.path.as_deref().unwrap(), canonical).unwrap();

        let note_id = NoteIdentity::new(session.note_id.unwrap());
        let restarted = AppState::new(
            SemanticState::new_disabled("disabled"),
            EventBus::disabled(),
        )
        .unwrap();
        let history = restarted
            .note_timeline()
            .history_mode(HistoryModeGrant::authorized(note_id));
        let revisions = history.revisions().unwrap();
        assert_eq!(revisions.len(), 1);
        assert!(revisions[0].committed_at_millis().unwrap() >= before_publication);
        assert!(revisions[0].committed_at_millis().unwrap() <= after_publication);
        crate::state::set_notes_root_override(None).unwrap();
    }

    #[test]
    fn every_app_owned_mutation_source_is_retained_by_the_same_contract() {
        let _guard = crate::test_support::lock_test_env();
        let app_data = crate::test_support::TestDir::new("timeline-source-app-data");
        crate::state::initialize_app_data_dir(app_data.path().to_path_buf()).unwrap();
        let notes = crate::test_support::TestDir::new("timeline-source-notes");
        crate::state::set_notes_root_override(Some(notes.path().to_path_buf())).unwrap();
        crate::state::ensure_vault_scaffold(notes.path()).unwrap();
        let state = AppState::new(
            SemanticState::new_disabled("disabled"),
            EventBus::disabled(),
        )
        .unwrap();
        let timeline = state.note_timeline();
        let path = notes.path().join("Sources.md");
        let sources = [
            MutationSource::NoteCreation,
            MutationSource::Editor,
            MutationSource::TaskAction,
            MutationSource::AcceptedChatProposal,
            MutationSource::VersionRestore,
            MutationSource::RecoveryReconciliation,
        ];
        let mut note_id = None;
        for (index, source) in sources.into_iter().enumerate() {
            let prepared = timeline
                .prepare_revision_publication(
                    source,
                    &path,
                    (index > 0).then_some(path.as_path()),
                    None,
                    &format!("authored state {index}"),
                )
                .unwrap();
            let (canonical, history_intent) = prepared.into_parts();
            fs::write(&path, &canonical).unwrap();
            let result = timeline.mutate(NoteMutation::with_source(
                source,
                history_intent,
                path.clone(),
                (index > 0).then(|| path.clone()),
                canonical,
            ));
            note_id.get_or_insert_with(|| result.note_id().clone());
        }

        let history = timeline.history_mode(HistoryModeGrant::authorized(note_id.unwrap()));
        assert_eq!(
            history
                .revisions()
                .unwrap()
                .into_iter()
                .map(|revision| revision.source())
                .collect::<Vec<_>>(),
            sources
        );
        crate::state::set_notes_root_override(None).unwrap();
    }

    #[test]
    fn unknown_persisted_history_vocabulary_fails_closed() {
        assert_eq!(HistoryDeletionKind::from_storage_value("revision"), None);
        assert!(DeletionScope::from_storage_parts("revision", "id".to_string()).is_err());

        let _guard = crate::test_support::lock_test_env();
        let app_data = crate::test_support::TestDir::new("timeline-vocabulary-app-data");
        crate::state::initialize_app_data_dir(app_data.path().to_path_buf()).unwrap();
        let notes = crate::test_support::TestDir::new("timeline-vocabulary-notes");
        crate::state::set_notes_root_override(Some(notes.path().to_path_buf())).unwrap();
        crate::state::ensure_vault_scaffold(notes.path()).unwrap();
        let state = AppState::new(
            SemanticState::new_disabled("disabled"),
            EventBus::disabled(),
        )
        .unwrap();
        let created = crate::commands::note_persistence::persist_note_session_with_outcome(
            &state,
            "Vocabulary".to_string(),
            "body".to_string(),
            None,
        )
        .unwrap()
        .session
        .unwrap();
        let note_id = NoteIdentity::new(created.note_id.unwrap());
        history_store::replace_revision_source(&note_id, "futureSource");
        let history = state
            .note_timeline()
            .history_mode(HistoryModeGrant::authorized(note_id.clone()));
        assert!(history
            .revisions()
            .unwrap_err()
            .contains("Unknown stored Mutation Source `futureSource`"));

        history_store::replace_revision_source(&note_id, "noteCreation");
        history_store::replace_revision_payload_version(&note_id, 99);
        assert!(history
            .revisions()
            .unwrap_err()
            .contains("Unknown stored Payload Version `99`"));

        history_store::replace_revision_payload_version(&note_id, 1);
        history_store::replace_revision_predecessor(&note_id, Some("futureRecord"), Some("id"));
        assert!(history
            .revisions()
            .unwrap_err()
            .contains("Invalid stored Timeline predecessor"));

        history_store::replace_revision_predecessor(
            &note_id,
            Some("lifecycleEvent"),
            history
                .lifecycle_events()
                .unwrap()
                .first()
                .map(|event| event.identity().0.as_str()),
        );
        history_store::replace_lifecycle_kind(&note_id, "futureEvent");
        assert!(history
            .lifecycle_events()
            .unwrap_err()
            .contains("Unknown stored Lifecycle Event Kind `futureEvent`"));

        history_store::replace_lifecycle_kind(&note_id, "created");
        history_store::replace_lifecycle_payload_version(&note_id, 99);
        assert!(history
            .lifecycle_events()
            .unwrap_err()
            .contains("Unknown stored Payload Version `99`"));
        crate::state::set_notes_root_override(None).unwrap();
    }

    #[test]
    fn prepared_but_unpublished_intent_does_not_create_phantom_history() {
        let _guard = crate::test_support::lock_test_env();
        let app_data = crate::test_support::TestDir::new("timeline-unpublished-app-data");
        crate::state::initialize_app_data_dir(app_data.path().to_path_buf()).unwrap();
        let notes = crate::test_support::TestDir::new("timeline-unpublished-notes");
        crate::state::set_notes_root_override(Some(notes.path().to_path_buf())).unwrap();
        crate::state::ensure_vault_scaffold(notes.path()).unwrap();
        let state = AppState::new(
            SemanticState::new_disabled("disabled"),
            EventBus::disabled(),
        )
        .unwrap();
        let path = notes.path().join("Never Published.md");
        let prepared = state
            .note_timeline()
            .prepare_revision_publication(
                MutationSource::NoteCreation,
                &path,
                None,
                None,
                "not published",
            )
            .unwrap();
        let note_id = NoteIdentity::new(
            crate::note::parse_note(prepared.canonical_markdown())
                .frontmatter
                .managed
                .unwrap()
                .id,
        );

        let restarted = AppState::new(
            SemanticState::new_disabled("disabled"),
            EventBus::disabled(),
        )
        .unwrap();
        let history = restarted
            .note_timeline()
            .history_mode(HistoryModeGrant::authorized(note_id));
        assert!(history.revisions().unwrap().is_empty());
        assert!(history.lifecycle_events().unwrap().is_empty());
        assert!(!path.exists());
        crate::state::set_notes_root_override(None).unwrap();
    }

    #[test]
    fn concurrent_history_reads_after_restart_converge_one_prepared_publication() {
        let _guard = crate::test_support::lock_test_env();
        let app_data = crate::test_support::TestDir::new("timeline-runtime-race-app-data");
        crate::state::initialize_app_data_dir(app_data.path().to_path_buf()).unwrap();
        let notes = crate::test_support::TestDir::new("timeline-runtime-race-notes");
        crate::state::set_notes_root_override(Some(notes.path().to_path_buf())).unwrap();
        crate::state::ensure_vault_scaffold(notes.path()).unwrap();
        let state = AppState::new(
            SemanticState::new_disabled("disabled"),
            EventBus::disabled(),
        )
        .unwrap();
        let path = notes.path().join("Interrupted Publication.md");
        let prepared = state
            .note_timeline()
            .prepare_revision_publication(
                MutationSource::NoteCreation,
                &path,
                None,
                None,
                "Published before interruption",
            )
            .unwrap();
        let note_id = NoteIdentity::new(
            crate::note::parse_note(prepared.canonical_markdown())
                .frontmatter
                .managed
                .unwrap()
                .id,
        );
        fs::write(&path, prepared.canonical_markdown()).unwrap();
        drop(prepared);
        drop(state);
        assert_eq!(prepared_history_intent_count_for_test("prepared"), 1);

        let restarted = AppState::new(
            SemanticState::new_disabled("disabled"),
            EventBus::disabled(),
        )
        .unwrap();
        let start = Arc::new(Barrier::new(3));
        let revision_counts = thread::scope(|scope| {
            let first_start = Arc::clone(&start);
            let first_note_id = note_id.clone();
            let first_state = &restarted;
            let first = scope.spawn(move || {
                first_start.wait();
                first_state
                    .note_timeline()
                    .open_history_mode(first_note_id)
                    .revisions()
                    .map(|revisions| revisions.len())
            });
            let second_start = Arc::clone(&start);
            let second_note_id = note_id.clone();
            let second_state = &restarted;
            let second = scope.spawn(move || {
                second_start.wait();
                second_state
                    .note_timeline()
                    .open_history_mode(second_note_id)
                    .revisions()
                    .map(|revisions| revisions.len())
            });
            start.wait();
            vec![
                first.join().unwrap().unwrap(),
                second.join().unwrap().unwrap(),
            ]
        });

        assert_eq!(revision_counts, vec![1, 1]);
        assert_eq!(prepared_history_intent_count_for_test("prepared"), 0);
        crate::state::set_notes_root_override(None).unwrap();
    }

    #[test]
    fn publication_failure_creates_no_revision_and_restart_abandons_the_intent() {
        let _guard = crate::test_support::lock_test_env();
        let app_data = crate::test_support::TestDir::new("timeline-publish-fault-app-data");
        crate::state::initialize_app_data_dir(app_data.path().to_path_buf()).unwrap();
        let notes = crate::test_support::TestDir::new("timeline-publish-fault-notes");
        crate::state::set_notes_root_override(Some(notes.path().to_path_buf())).unwrap();
        crate::state::ensure_vault_scaffold(notes.path()).unwrap();
        let state = AppState::new(
            SemanticState::new_disabled("disabled"),
            EventBus::disabled(),
        )
        .unwrap();
        crate::state::inject_note_publication_failure_once();

        let error = crate::commands::note_persistence::persist_note_session_with_outcome(
            &state,
            "Unpublished".to_string(),
            "dirty draft".to_string(),
            None,
        )
        .expect_err("publication must fail after durable preparation");
        assert!(error.contains("injected note publication failure"));
        let path = notes.path().join("Unpublished.md");
        assert!(!path.exists());
        assert_eq!(history_store::prepared_intent_count("prepared"), 0);

        let restarted = AppState::new(
            SemanticState::new_disabled("disabled"),
            EventBus::disabled(),
        )
        .unwrap();
        let prepared = restarted
            .note_timeline()
            .prepare_revision_publication(MutationSource::NoteCreation, &path, None, None, "retry")
            .unwrap();
        let note_id = NoteIdentity::new(
            crate::note::parse_note(prepared.canonical_markdown())
                .frontmatter
                .managed
                .unwrap()
                .id,
        );
        let history = restarted
            .note_timeline()
            .history_mode(HistoryModeGrant::authorized(note_id));
        assert!(history.revisions().unwrap().is_empty());
        assert!(history.lifecycle_events().unwrap().is_empty());
        crate::state::set_notes_root_override(None).unwrap();
    }

    #[test]
    fn adaptive_checkpoints_are_transparent_across_a_long_revision_chain() {
        let _guard = crate::test_support::lock_test_env();
        let app_data = crate::test_support::TestDir::new("timeline-long-chain-app-data");
        crate::state::initialize_app_data_dir(app_data.path().to_path_buf()).unwrap();
        let notes = crate::test_support::TestDir::new("timeline-long-chain-notes");
        crate::state::set_notes_root_override(Some(notes.path().to_path_buf())).unwrap();
        crate::state::ensure_vault_scaffold(notes.path()).unwrap();
        let state = AppState::new(
            SemanticState::new_disabled("disabled"),
            EventBus::disabled(),
        )
        .unwrap();
        let timeline = state.note_timeline();
        let path = notes.path().join("Long Chain.md");
        let mut note_id = None;
        for revision in 0..140 {
            let source = if revision == 0 {
                MutationSource::NoteCreation
            } else {
                MutationSource::Editor
            };
            let body = format!(
                "# Long chain\n\nrevision {revision}: {}",
                "x".repeat(revision)
            );
            let prepared = timeline
                .prepare_revision_publication(
                    source,
                    &path,
                    (revision > 0).then_some(path.as_path()),
                    None,
                    &body,
                )
                .unwrap();
            let (canonical, history_intent) = prepared.into_parts();
            fs::write(&path, &canonical).unwrap();
            let result = timeline.mutate(NoteMutation::with_source(
                source,
                history_intent,
                path.clone(),
                (revision > 0).then(|| path.clone()),
                canonical,
            ));
            note_id.get_or_insert_with(|| result.note_id().clone());
        }

        let restarted = AppState::new(
            SemanticState::new_disabled("disabled"),
            EventBus::disabled(),
        )
        .unwrap();
        let history = restarted
            .note_timeline()
            .history_mode(HistoryModeGrant::authorized(note_id.unwrap()));
        let revisions = history.revisions().unwrap();
        assert_eq!(revisions.len(), 140);
        for index in [0usize, 127, 139] {
            assert_eq!(
                history
                    .reconstruct(revisions[index].identity())
                    .unwrap()
                    .body(),
                format!("# Long chain\n\nrevision {index}: {}", "x".repeat(index))
            );
        }
        crate::state::set_notes_root_override(None).unwrap();
    }

    #[test]
    fn app_commit_preserves_identity_when_authored_content_becomes_empty() {
        let _guard = crate::test_support::lock_test_env();
        let app_data = crate::test_support::TestDir::new("timeline-empty-identity-app-data");
        crate::state::initialize_app_data_dir(app_data.path().to_path_buf()).unwrap();
        let notes = crate::test_support::TestDir::new("timeline-empty-identity-notes");
        crate::state::set_notes_root_override(Some(notes.path().to_path_buf())).unwrap();
        let note_path = notes.path().join("Note.md");
        let original = "---\ngneauxghts:\n  id: stable-note-1\n  kind: note\n---\n\nBody";
        fs::write(&note_path, original).expect("write original note");
        let state = AppState::new(
            SemanticState::new_disabled("disabled"),
            EventBus::disabled(),
        )
        .expect("construct app state");
        let timeline = state.note_timeline();
        let history_intent = prepare_test_history(MutationSource::Editor, &note_path, original);
        timeline.mutate(NoteMutation::editor(
            history_intent,
            note_path.clone(),
            None,
            original.to_string(),
        ));

        let saved = crate::commands::note_persistence::persist_note_session_with_outcome(
            &state,
            "Note".to_string(),
            String::new(),
            Some(note_path.to_string_lossy().into_owned()),
        )
        .expect("publish empty authored content")
        .session
        .expect("saved session");

        assert_eq!(saved.note_id.as_deref(), Some("stable-note-1"));
        let canonical = fs::read_to_string(&note_path).expect("read repaired canonical note");
        assert_eq!(
            crate::note::parse_note(&canonical)
                .frontmatter
                .managed
                .expect("managed identity remains")
                .id,
            "stable-note-1"
        );
        assert_eq!(crate::note::strip_frontmatter(&canonical), "");
    }

    #[test]
    fn external_metadata_damage_preserves_known_identity_without_rewriting_until_commit() {
        let _guard = crate::test_support::lock_test_env();
        let app_data = crate::test_support::TestDir::new("timeline-damaged-identity-app-data");
        crate::state::initialize_app_data_dir(app_data.path().to_path_buf()).unwrap();
        let notes = crate::test_support::TestDir::new("timeline-damaged-identity-notes");
        crate::state::set_notes_root_override(Some(notes.path().to_path_buf())).unwrap();
        let note_path = notes.path().join("Damaged.md");
        let original = "---\ngneauxghts:\n  id: stable-note-2\n  kind: note\n---\n\nOriginal";
        fs::write(&note_path, original).expect("write original note");
        let state = AppState::new(
            SemanticState::new_disabled("disabled"),
            EventBus::disabled(),
        )
        .expect("construct app state");
        let timeline = state.note_timeline();
        let history_intent = prepare_test_history(MutationSource::Editor, &note_path, original);
        timeline.mutate(NoteMutation::editor(
            history_intent,
            note_path.clone(),
            None,
            original.to_string(),
        ));

        let damaged = "Externally changed without managed metadata";
        fs::write(&note_path, damaged).expect("damage managed metadata externally");
        timeline
            .observe(VaultObservation::external_edit(
                note_path.clone(),
                42,
                Some(41),
            ))
            .unwrap();
        state
            .upsert_note_indexes(
                note_path.clone(),
                crate::index::build_indexed_note(&note_path, damaged, 41),
            )
            .expect("apply observed catalog state");

        assert_eq!(fs::read_to_string(&note_path).unwrap(), damaged);
        assert_eq!(
            state.indexed_note_identity(&note_path).unwrap().as_deref(),
            Some("stable-note-2")
        );

        let saved = crate::commands::note_persistence::persist_note_session_with_outcome(
            &state,
            "Damaged".to_string(),
            damaged.to_string(),
            Some(note_path.to_string_lossy().into_owned()),
        )
        .expect("commit damaged note")
        .session
        .expect("saved session");
        assert_eq!(saved.note_id.as_deref(), Some("stable-note-2"));
        assert!(fs::read_to_string(&note_path)
            .unwrap()
            .contains("id: stable-note-2"));
    }

    #[test]
    fn copied_identity_cannot_replace_the_original_and_is_repaired_on_commit() {
        let _guard = crate::test_support::lock_test_env();
        let app_data = crate::test_support::TestDir::new("timeline-copy-identity-app-data");
        crate::state::initialize_app_data_dir(app_data.path().to_path_buf()).unwrap();
        let notes = crate::test_support::TestDir::new("timeline-copy-identity-notes");
        crate::state::set_notes_root_override(Some(notes.path().to_path_buf())).unwrap();
        let original_path = notes.path().join("Original.md");
        let copy_path = notes.path().join("Copy.md");
        let markdown =
            "---\ngneauxghts:\n  id: stable-original-note\n  kind: note\n---\n\nCopied body";
        fs::write(&original_path, markdown).expect("write original note");
        let state = AppState::new(
            SemanticState::new_disabled("disabled"),
            EventBus::disabled(),
        )
        .expect("construct app state");
        let timeline = state.note_timeline();
        let history_intent = prepare_test_history(MutationSource::Editor, &original_path, markdown);
        timeline.mutate(NoteMutation::editor(
            history_intent,
            original_path.clone(),
            None,
            markdown.to_string(),
        ));

        fs::write(&copy_path, markdown).expect("copy note byte for byte");
        timeline
            .observe(VaultObservation::external_edit(
                copy_path.clone(),
                42,
                Some(41),
            ))
            .unwrap();
        state
            .upsert_note_indexes(
                copy_path.clone(),
                crate::index::build_indexed_note(&copy_path, markdown, 41),
            )
            .expect("ingest copied note");

        let original_id = state
            .indexed_note_identity(&original_path)
            .unwrap()
            .expect("original identity");
        let copy_id = state
            .indexed_note_identity(&copy_path)
            .unwrap()
            .expect("copy identity");
        assert_eq!(original_id, "stable-original-note");
        assert_ne!(copy_id, original_id);
        assert_eq!(fs::read_to_string(&copy_path).unwrap(), markdown);

        // Re-observing in either order cannot transfer either association.
        state
            .upsert_note_indexes(
                original_path.clone(),
                crate::index::build_indexed_note(&original_path, markdown, 43),
            )
            .unwrap();
        state
            .upsert_note_indexes(
                copy_path.clone(),
                crate::index::build_indexed_note(&copy_path, markdown, 44),
            )
            .unwrap();
        assert_eq!(
            state
                .indexed_note_identity(&original_path)
                .unwrap()
                .as_deref(),
            Some(original_id.as_str())
        );
        assert_eq!(
            state.indexed_note_identity(&copy_path).unwrap().as_deref(),
            Some(copy_id.as_str())
        );

        let saved = crate::commands::note_persistence::persist_note_session_with_outcome(
            &state,
            "Copy".to_string(),
            "Copied body".to_string(),
            Some(copy_path.to_string_lossy().into_owned()),
        )
        .expect("commit copied note")
        .session
        .expect("saved session");
        assert_eq!(saved.note_id.as_deref(), Some(copy_id.as_str()));
        assert_eq!(
            crate::note::parse_note(&fs::read_to_string(&copy_path).unwrap())
                .frontmatter
                .managed
                .expect("copy identity repaired")
                .id,
            copy_id
        );

        let restarted = AppState::new(
            SemanticState::new_disabled("disabled"),
            EventBus::disabled(),
        )
        .expect("restart app state");
        restarted
            .prewarm_notes_index(notes.path())
            .expect("rebuild index after restart");
        assert_eq!(
            restarted
                .indexed_note_identity(&original_path)
                .unwrap()
                .as_deref(),
            Some(original_id.as_str())
        );
        assert_eq!(
            restarted
                .indexed_note_identity(&copy_path)
                .unwrap()
                .as_deref(),
            Some(copy_id.as_str())
        );
    }

    #[test]
    fn identity_follows_moves_disappearance_and_safe_reattachment_in_any_refresh_order() {
        let _guard = crate::test_support::lock_test_env();
        let app_data = crate::test_support::TestDir::new("timeline-path-identity-app-data");
        crate::state::initialize_app_data_dir(app_data.path().to_path_buf()).unwrap();
        let notes = crate::test_support::TestDir::new("timeline-path-identity-notes");
        crate::state::set_notes_root_override(Some(notes.path().to_path_buf())).unwrap();
        let original_path = notes.path().join("Original.md");
        let moved_path = notes.path().join("Folder").join("Moved.md");
        let renamed_path = notes.path().join("Folder").join("Renamed.md");
        let reattached_path = notes.path().join("Reattached.md");
        let markdown = "---\ngneauxghts:\n  id: stable-path-note\n  kind: note\n---\n\nPath body";
        fs::write(&original_path, markdown).expect("write original note");
        let state = AppState::new(
            SemanticState::new_disabled("disabled"),
            EventBus::disabled(),
        )
        .expect("construct app state");
        let timeline = state.note_timeline();
        let history_intent = prepare_test_history(MutationSource::Editor, &original_path, markdown);
        timeline.mutate(NoteMutation::editor(
            history_intent,
            original_path.clone(),
            None,
            markdown.to_string(),
        ));

        fs::create_dir_all(moved_path.parent().unwrap()).unwrap();
        fs::rename(&original_path, &moved_path).expect("move note");
        timeline
            .observe(VaultObservation::moved(
                original_path.clone(),
                moved_path.clone(),
                42,
            ))
            .unwrap();
        // Removal-first refresh preserves the reservation for the new path.
        state.remove_note_indexes(&original_path).unwrap();
        state
            .upsert_note_indexes(
                moved_path.clone(),
                crate::index::build_indexed_note(&moved_path, markdown, 42),
            )
            .unwrap();
        assert_eq!(
            state.indexed_note_identity(&moved_path).unwrap().as_deref(),
            Some("stable-path-note")
        );

        fs::rename(&moved_path, &renamed_path).expect("rename note");
        timeline
            .observe(VaultObservation::renamed(
                moved_path.clone(),
                renamed_path.clone(),
                43,
            ))
            .unwrap();
        // Upsert-first refresh also transfers the association safely.
        state
            .upsert_note_indexes(
                renamed_path.clone(),
                crate::index::build_indexed_note(&renamed_path, markdown, 43),
            )
            .unwrap();
        state.remove_note_indexes(&moved_path).unwrap();
        assert_eq!(
            state
                .indexed_note_identity(&renamed_path)
                .unwrap()
                .as_deref(),
            Some("stable-path-note")
        );

        fs::remove_file(&renamed_path).expect("temporarily remove note");
        timeline
            .observe(VaultObservation::missing(renamed_path.clone(), 44))
            .unwrap();

        let unrelated =
            "---\ngneauxghts:\n  id: unrelated-note\n  kind: note\n---\n\nUnrelated body";
        fs::write(&renamed_path, unrelated).expect("reuse disappeared path");
        timeline
            .observe(VaultObservation::external_edit(
                renamed_path.clone(),
                45,
                Some(45),
            ))
            .unwrap();
        state
            .upsert_note_indexes(
                renamed_path.clone(),
                crate::index::build_indexed_note(&renamed_path, unrelated, 45),
            )
            .unwrap();
        assert_eq!(
            state
                .indexed_note_identity(&renamed_path)
                .unwrap()
                .as_deref(),
            Some("unrelated-note")
        );

        fs::write(&reattached_path, markdown).expect("write stale copy elsewhere");
        let copy_receipt = timeline
            .observe(VaultObservation::external_edit(
                reattached_path.clone(),
                46,
                Some(46),
            ))
            .unwrap();
        assert_eq!(copy_receipt.kind(), VaultObservationKind::CanonicalState);
        state
            .upsert_note_indexes(
                reattached_path.clone(),
                crate::index::build_indexed_note(&reattached_path, markdown, 46),
            )
            .unwrap();
        let stale_copy_id = state
            .indexed_note_identity(&reattached_path)
            .unwrap()
            .expect("stale copy receives an identity");
        assert_ne!(stale_copy_id, "stable-path-note");

        fs::remove_file(&renamed_path).expect("remove unrelated path occupant");
        state.remove_note_indexes(&renamed_path).unwrap();
        fs::write(&renamed_path, markdown).expect("reattach at the missing path");
        let reattached = timeline
            .observe(VaultObservation::external_edit(
                renamed_path.clone(),
                47,
                Some(47),
            ))
            .unwrap();
        assert_eq!(
            reattached.kind(),
            VaultObservationKind::Lifecycle(LifecycleEventKind::Reattached)
        );
        state
            .upsert_note_indexes(
                renamed_path.clone(),
                crate::index::build_indexed_note(&renamed_path, markdown, 47),
            )
            .unwrap();
        assert_eq!(
            state
                .indexed_note_identity(&renamed_path)
                .unwrap()
                .as_deref(),
            Some("stable-path-note")
        );

        let saved_copy = crate::commands::note_persistence::persist_note_session_with_outcome(
            &state,
            "Reattached".to_string(),
            "Path body".to_string(),
            Some(reattached_path.to_string_lossy().into_owned()),
        )
        .expect("commit stale copy identity")
        .session
        .expect("saved copy session");
        assert_eq!(saved_copy.note_id.as_deref(), Some(stale_copy_id.as_str()));

        let restarted = AppState::new(
            SemanticState::new_disabled("disabled"),
            EventBus::disabled(),
        )
        .expect("restart app state");
        restarted
            .prewarm_notes_index(notes.path())
            .expect("rebuild index after restart");
        assert_eq!(
            restarted
                .indexed_note_identity(&renamed_path)
                .unwrap()
                .as_deref(),
            Some("stable-path-note")
        );
        assert_eq!(
            restarted
                .indexed_note_identity(&reattached_path)
                .unwrap()
                .as_deref(),
            Some(stale_copy_id.as_str())
        );
    }

    #[test]
    fn abandoned_move_reservation_cannot_assign_identity_to_a_later_unrelated_file() {
        let _guard = crate::test_support::lock_test_env();
        let app_data = crate::test_support::TestDir::new("timeline-stale-transfer-app-data");
        crate::state::initialize_app_data_dir(app_data.path().to_path_buf()).unwrap();
        let notes = crate::test_support::TestDir::new("timeline-stale-transfer-notes");
        let original_path = notes.path().join("Original.md");
        let target_path = notes.path().join("Target.md");
        let original = "---\ngneauxghts:\n  id: reserved-note\n  kind: note\n---\n\nReserved body";
        let unrelated =
            "---\ngneauxghts:\n  id: unrelated-target\n  kind: note\n---\n\nDifferent body";
        fs::write(&original_path, original).unwrap();
        let state = AppState::new(
            SemanticState::new_disabled("disabled"),
            EventBus::disabled(),
        )
        .unwrap();
        state
            .upsert_note_indexes(
                original_path.clone(),
                crate::index::build_indexed_note(&original_path, original, 41),
            )
            .unwrap();

        let _observation = state.note_timeline().observe(VaultObservation::moved(
            original_path.clone(),
            target_path.clone(),
            42,
        ));
        fs::write(&target_path, unrelated).unwrap();
        state
            .upsert_note_indexes(
                target_path.clone(),
                crate::index::build_indexed_note(&target_path, unrelated, 43),
            )
            .unwrap();

        assert_eq!(
            state
                .indexed_note_identity(&target_path)
                .unwrap()
                .as_deref(),
            Some("unrelated-target")
        );
        assert_eq!(
            state
                .indexed_note_identity(&original_path)
                .unwrap()
                .as_deref(),
            Some("reserved-note")
        );
    }

    #[test]
    fn history_roles_receive_distinct_scoped_capabilities() {
        let _guard = crate::test_support::lock_test_env();
        let app_data = crate::test_support::TestDir::new("timeline-capabilities-app-data");
        crate::state::initialize_app_data_dir(app_data.path().to_path_buf()).unwrap();
        let notes = crate::test_support::TestDir::new("timeline-capabilities-notes");
        crate::state::set_notes_root_override(Some(notes.path().to_path_buf())).unwrap();
        crate::state::ensure_vault_scaffold(notes.path()).unwrap();
        let state = AppState::new(
            SemanticState::new_disabled("disabled"),
            EventBus::disabled(),
        )
        .expect("construct app state");
        let timeline = state.note_timeline();
        let created = crate::commands::note_persistence::persist_note_session_with_outcome(
            &state,
            "Scoped note".to_string(),
            "Current body".to_string(),
            None,
        )
        .unwrap()
        .session
        .unwrap();
        let note_id = NoteIdentity::new(created.note_id.unwrap());
        let revision_id = RevisionIdentity::from_persisted("revision-1");

        let history = timeline.history_mode(HistoryModeGrant::authorized(note_id.clone()));
        let current = timeline.current_content(AllowedScope::only(note_id.clone()));
        let restore = timeline
            .agent_restore(ExplicitRestoreGrant::new(
                TurnIdentity::new("turn-1"),
                note_id.clone(),
                revision_id.clone(),
            ))
            .unwrap();

        assert_eq!(history.note_id(), &note_id);
        assert!(current.allows(&note_id));
        assert_eq!(restore.note_id(), &note_id);
        assert_eq!(restore.revision_id(), &revision_id);
        assert_eq!(restore.turn_id(), &TurnIdentity::new("turn-1"));
        crate::state::set_notes_root_override(None).unwrap();
    }

    #[test]
    fn external_observation_records_each_distinct_canonical_state_once() {
        let _guard = crate::test_support::lock_test_env();
        let app_data = crate::test_support::TestDir::new("timeline-external-app-data");
        crate::state::initialize_app_data_dir(app_data.path().to_path_buf()).unwrap();
        let notes = crate::test_support::TestDir::new("timeline-external-notes");
        crate::state::set_notes_root_override(Some(notes.path().to_path_buf())).unwrap();
        let state = AppState::new(
            SemanticState::new_disabled("disabled"),
            EventBus::disabled(),
        )
        .unwrap();
        let created = crate::commands::note_persistence::persist_note_session_with_outcome(
            &state,
            "External".to_string(),
            "Before".to_string(),
            None,
        )
        .unwrap()
        .session
        .unwrap();
        let path = PathBuf::from(created.path.unwrap());
        let note_id = NoteIdentity::new(created.note_id.unwrap());
        let canonical = fs::read_to_string(&path).unwrap();
        let externally_edited = canonical.replacen("Before", "After external", 1);
        fs::write(&path, &externally_edited).unwrap();

        let timeline = state.note_timeline();
        timeline
            .observe(VaultObservation::external_edit(
                path.clone(),
                200,
                Some(150),
            ))
            .unwrap();
        timeline
            .observe(VaultObservation::external_edit(path, 201, Some(150)))
            .unwrap();

        let history = timeline.history_mode(HistoryModeGrant::authorized(note_id));
        let revisions = history.revisions().unwrap();
        assert_eq!(revisions.len(), 2);
        assert_eq!(revisions[1].source(), MutationSource::ExternalEdit);
        assert_eq!(
            revisions[1].time_evidence(),
            RevisionTimeEvidence::Observed {
                observed_at_millis: 200,
                modified_at_millis: Some(150),
            }
        );
        assert_eq!(
            history.reconstruct(revisions[1].identity()).unwrap().body(),
            "After external"
        );
        crate::state::set_notes_root_override(None).unwrap();
    }

    #[test]
    fn path_only_rename_records_one_lifecycle_event_and_no_revision() {
        let _guard = crate::test_support::lock_test_env();
        let app_data = crate::test_support::TestDir::new("timeline-rename-app-data");
        crate::state::initialize_app_data_dir(app_data.path().to_path_buf()).unwrap();
        let notes = crate::test_support::TestDir::new("timeline-rename-notes");
        crate::state::set_notes_root_override(Some(notes.path().to_path_buf())).unwrap();
        let state = AppState::new(
            SemanticState::new_disabled("disabled"),
            EventBus::disabled(),
        )
        .unwrap();
        let created = crate::commands::note_persistence::persist_note_session_with_outcome(
            &state,
            "Before".to_string(),
            "Body".to_string(),
            None,
        )
        .unwrap()
        .session
        .unwrap();
        let previous_path = PathBuf::from(created.path.unwrap());
        let path = notes.path().join("After.md");
        let note_id = NoteIdentity::new(created.note_id.unwrap());
        fs::rename(&previous_path, &path).unwrap();
        let timeline = state.note_timeline();
        let observed_at = crate::time::current_time_millis().unwrap() + 1;

        timeline
            .observe(VaultObservation::renamed(
                &previous_path,
                &path,
                observed_at,
            ))
            .unwrap();
        timeline
            .observe(VaultObservation::renamed(
                &previous_path,
                &path,
                observed_at + 1,
            ))
            .unwrap();

        let history = timeline.history_mode(HistoryModeGrant::authorized(note_id));
        let revisions = history.revisions().unwrap();
        assert_eq!(revisions.len(), 1);
        let lifecycle_only_diff = history
            .diff(&revisions[0].identity().0, HistoryDiffComparison::Current)
            .unwrap();
        assert!(lifecycle_only_diff
            .body_lines()
            .iter()
            .all(|line| line.kind() == HistoryDiffLineKind::Context));
        assert!(lifecycle_only_diff
            .properties_lines()
            .iter()
            .all(|line| line.kind() == HistoryDiffLineKind::Context));
        assert!(lifecycle_only_diff
            .body_lines()
            .iter()
            .all(|line| { !line.text().contains("Before") && !line.text().contains("After.md") }));
        let events = history.lifecycle_events().unwrap();
        assert_eq!(events.len(), 2);
        assert_eq!(events[1].kind(), LifecycleEventKind::Renamed);
        assert_eq!(events[1].occurred_at_millis(), observed_at);
        assert_eq!(events[1].previous_path(), Some(previous_path.as_path()));
        assert_eq!(events[1].path(), Some(path.as_path()));
        crate::state::set_notes_root_override(None).unwrap();
    }

    #[test]
    fn app_title_only_rename_records_lifecycle_without_duplicate_revision() {
        let _guard = crate::test_support::lock_test_env();
        let app_data = crate::test_support::TestDir::new("timeline-app-rename-data");
        crate::state::initialize_app_data_dir(app_data.path().to_path_buf()).unwrap();
        let notes = crate::test_support::TestDir::new("timeline-app-rename-notes");
        crate::state::set_notes_root_override(Some(notes.path().to_path_buf())).unwrap();
        let state = AppState::new(
            SemanticState::new_disabled("disabled"),
            EventBus::disabled(),
        )
        .unwrap();
        let created = crate::commands::note_persistence::persist_note_session_with_outcome(
            &state,
            "Before".to_string(),
            "Unchanged body".to_string(),
            None,
        )
        .unwrap()
        .session
        .unwrap();
        let previous_path = PathBuf::from(created.path.unwrap());
        let note_id = NoteIdentity::new(created.note_id.unwrap());
        let renamed = crate::commands::note_persistence::persist_note_session_with_outcome(
            &state,
            "After".to_string(),
            "Unchanged body".to_string(),
            Some(previous_path.to_string_lossy().into_owned()),
        )
        .unwrap()
        .session
        .unwrap();
        let path = PathBuf::from(renamed.path.unwrap());

        let timeline = state.note_timeline();
        let history = timeline.history_mode(HistoryModeGrant::authorized(note_id));
        let revisions = history.revisions().unwrap();
        assert_eq!(revisions.len(), 1);
        let lifecycle_only_diff = history
            .diff(&revisions[0].identity().0, HistoryDiffComparison::Current)
            .unwrap();
        assert!(lifecycle_only_diff
            .body_lines()
            .iter()
            .all(|line| line.kind() == HistoryDiffLineKind::Context));
        assert!(lifecycle_only_diff
            .body_lines()
            .iter()
            .all(|line| { !line.text().contains("Before") && !line.text().contains("After") }));
        let events = history.lifecycle_events().unwrap();
        assert_eq!(events.len(), 2);
        let rename = events
            .iter()
            .find(|event| event.kind() == LifecycleEventKind::Renamed)
            .unwrap();
        assert_eq!(rename.previous_path(), Some(previous_path.as_path()));
        assert_eq!(rename.path(), Some(path.as_path()));
        crate::state::set_notes_root_override(None).unwrap();
    }

    #[test]
    fn reconciliation_infers_a_missed_move_from_the_durable_current_path() {
        let _guard = crate::test_support::lock_test_env();
        let app_data = crate::test_support::TestDir::new("timeline-missed-move-data");
        crate::state::initialize_app_data_dir(app_data.path().to_path_buf()).unwrap();
        let notes = crate::test_support::TestDir::new("timeline-missed-move-notes");
        crate::state::set_notes_root_override(Some(notes.path().to_path_buf())).unwrap();
        let state = AppState::new(
            SemanticState::new_disabled("disabled"),
            EventBus::disabled(),
        )
        .unwrap();
        let created = crate::commands::note_persistence::persist_note_session_with_outcome(
            &state,
            "Before".to_string(),
            "Unchanged body".to_string(),
            None,
        )
        .unwrap()
        .session
        .unwrap();
        let previous_path = PathBuf::from(created.path.unwrap());
        let note_id = NoteIdentity::new(created.note_id.unwrap());
        let path = notes.path().join("Nested").join("After.md");
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::rename(&previous_path, &path).unwrap();
        let markdown = fs::read_to_string(&path).unwrap();
        let restarted = AppState::new(
            SemanticState::new_disabled("disabled"),
            EventBus::disabled(),
        )
        .unwrap();
        let timeline = restarted.note_timeline();
        let observed_at = crate::time::current_time_millis().unwrap() + 1;

        timeline
            .observe(
                VaultObservation::reconciled_state(path.clone(), observed_at, None)
                    .with_canonical_markdown(markdown),
            )
            .unwrap();

        let history = timeline.history_mode(HistoryModeGrant::authorized(note_id));
        assert_eq!(history.revisions().unwrap().len(), 1);
        let events = history.lifecycle_events().unwrap();
        assert_eq!(events.len(), 2);
        assert_eq!(events[1].kind(), LifecycleEventKind::Moved);
        assert_eq!(events[1].previous_path(), Some(previous_path.as_path()));
        assert_eq!(events[1].path(), Some(path.as_path()));
        crate::state::set_notes_root_override(None).unwrap();
    }

    #[test]
    fn keeping_dirty_local_content_after_an_external_edit_retains_both_states() {
        let _guard = crate::test_support::lock_test_env();
        let app_data = crate::test_support::TestDir::new("timeline-conflict-app-data");
        crate::state::initialize_app_data_dir(app_data.path().to_path_buf()).unwrap();
        let notes = crate::test_support::TestDir::new("timeline-conflict-notes");
        crate::state::set_notes_root_override(Some(notes.path().to_path_buf())).unwrap();
        let state = AppState::new(
            SemanticState::new_disabled("disabled"),
            EventBus::disabled(),
        )
        .unwrap();
        let created = crate::commands::note_persistence::persist_note_session_with_outcome(
            &state,
            "Conflict".to_string(),
            "Original".to_string(),
            None,
        )
        .unwrap()
        .session
        .unwrap();
        let path = PathBuf::from(created.path.unwrap());
        let note_id = NoteIdentity::new(created.note_id.unwrap());
        let external = fs::read_to_string(&path)
            .unwrap()
            .replacen("Original", "External", 1);
        fs::write(&path, &external).unwrap();
        let timeline = state.note_timeline();
        timeline
            .observe(
                VaultObservation::external_edit(path.clone(), 400, None)
                    .with_canonical_markdown(external),
            )
            .unwrap();

        crate::commands::note_persistence::persist_note_session_with_outcome(
            &state,
            "Conflict".to_string(),
            "Dirty local kept".to_string(),
            Some(path.to_string_lossy().into_owned()),
        )
        .unwrap();

        let history = timeline.history_mode(HistoryModeGrant::authorized(note_id));
        let revisions = history.revisions().unwrap();
        assert_eq!(
            revisions
                .iter()
                .map(NoteRevisionHeader::source)
                .collect::<Vec<_>>(),
            vec![
                MutationSource::NoteCreation,
                MutationSource::ExternalEdit,
                MutationSource::Editor,
            ]
        );
        assert_eq!(
            history.reconstruct(revisions[1].identity()).unwrap().body(),
            "External"
        );
        assert_eq!(
            history.reconstruct(revisions[2].identity()).unwrap().body(),
            "Dirty local kept"
        );
        crate::state::set_notes_root_override(None).unwrap();
    }

    #[test]
    fn restart_reconciliation_catches_a_missed_external_state_once() {
        let _guard = crate::test_support::lock_test_env();
        let app_data = crate::test_support::TestDir::new("timeline-reconcile-app-data");
        crate::state::initialize_app_data_dir(app_data.path().to_path_buf()).unwrap();
        let notes = crate::test_support::TestDir::new("timeline-reconcile-notes");
        crate::state::set_notes_root_override(Some(notes.path().to_path_buf())).unwrap();
        let state = AppState::new(
            SemanticState::new_disabled("disabled"),
            EventBus::disabled(),
        )
        .unwrap();
        let created = crate::commands::note_persistence::persist_note_session_with_outcome(
            &state,
            "Reconcile".to_string(),
            "Before restart".to_string(),
            None,
        )
        .unwrap()
        .session
        .unwrap();
        let path = PathBuf::from(created.path.unwrap());
        let note_id = NoteIdentity::new(created.note_id.unwrap());
        let external = fs::read_to_string(&path).unwrap().replacen(
            "Before restart",
            "Missed while stopped",
            1,
        );
        fs::write(&path, &external).unwrap();
        let restarted = AppState::new(
            SemanticState::new_disabled("disabled"),
            EventBus::disabled(),
        )
        .unwrap();
        let timeline = restarted.note_timeline();
        for observed_at in [500, 501] {
            timeline
                .observe(
                    VaultObservation::reconciled_state(path.clone(), observed_at, None)
                        .with_canonical_markdown(external.clone()),
                )
                .unwrap();
        }

        let history = timeline.history_mode(HistoryModeGrant::authorized(note_id));
        let revisions = history.revisions().unwrap();
        assert_eq!(revisions.len(), 2);
        assert_eq!(revisions[1].source(), MutationSource::ExternalEdit);
        assert_eq!(
            history.reconstruct(revisions[1].identity()).unwrap().body(),
            "Missed while stopped"
        );
        crate::state::set_notes_root_override(None).unwrap();
    }

    #[test]
    fn observe_returns_a_typed_receipt_for_recorded_evidence() {
        let _guard = crate::test_support::lock_test_env();
        let app_data = crate::test_support::TestDir::new("timeline-observe-app-data");
        crate::state::initialize_app_data_dir(app_data.path().to_path_buf()).unwrap();
        let notes = crate::test_support::TestDir::new("timeline-observe-notes");
        crate::state::set_notes_root_override(Some(notes.path().to_path_buf())).unwrap();
        let state = AppState::new(
            SemanticState::new_disabled("disabled"),
            EventBus::disabled(),
        )
        .expect("construct app state");
        let path = notes.path().join("Observed.md");
        fs::write(&path, "Observed").unwrap();

        let receipt = state
            .note_timeline()
            .observe(VaultObservation::external_edit(path.clone(), 42, Some(41)))
            .unwrap();

        assert_eq!(receipt.path(), path);
        assert_eq!(receipt.source(), VaultObservationSource::Watcher);
        assert_eq!(receipt.kind(), VaultObservationKind::CanonicalState);
        assert_eq!(receipt.observed_at_millis(), 42);
        assert_eq!(receipt.modified_at_millis(), Some(41));

        let renamed_path = notes.path().join("Renamed.md");
        fs::rename(&path, &renamed_path).unwrap();
        let renamed = state
            .note_timeline()
            .observe(VaultObservation::renamed(&path, &renamed_path, 43))
            .unwrap();
        assert_eq!(
            renamed.kind(),
            VaultObservationKind::Lifecycle(LifecycleEventKind::Renamed)
        );
        assert_eq!(renamed.previous_path(), Some(path.as_path()));
        assert_eq!(renamed.path(), renamed_path);
        crate::state::set_notes_root_override(None).unwrap();
    }

    #[test]
    fn reattachment_requires_identity_and_same_path_continuity() {
        let _guard = crate::test_support::lock_test_env();
        let app_data = crate::test_support::TestDir::new("timeline-reattach-app-data");
        crate::state::initialize_app_data_dir(app_data.path().to_path_buf()).unwrap();
        let notes = crate::test_support::TestDir::new("timeline-reattach-notes");
        crate::state::set_notes_root_override(Some(notes.path().to_path_buf())).unwrap();
        let original_path = notes.path().join("Original.md");
        let stale_copy_path = notes.path().join("Stale Copy.md");
        let original_markdown =
            "---\ngneauxghts:\n  id: timeline-reattach-note-1\n  kind: note\n---\n\n# Original";
        fs::write(&original_path, original_markdown).expect("write original note");
        let state = AppState::new(
            SemanticState::new_disabled("disabled"),
            EventBus::disabled(),
        )
        .expect("construct app state");
        let timeline = state.note_timeline();
        let history_intent =
            prepare_test_history(MutationSource::Editor, &original_path, original_markdown);
        timeline.mutate(NoteMutation::editor(
            history_intent,
            original_path.clone(),
            None,
            original_markdown.to_string(),
        ));

        fs::remove_file(&original_path).expect("remove original note");
        let missing = timeline
            .observe(VaultObservation::missing(original_path.clone(), 40))
            .unwrap();
        assert_eq!(
            missing.kind(),
            VaultObservationKind::Lifecycle(LifecycleEventKind::Missing)
        );

        fs::write(&stale_copy_path, original_markdown).expect("write same identity elsewhere");
        let stale_copy = timeline
            .observe(VaultObservation::external_edit(
                stale_copy_path,
                41,
                Some(40),
            ))
            .unwrap();
        assert_eq!(stale_copy.kind(), VaultObservationKind::CanonicalState);

        fs::write(&original_path, original_markdown).expect("reattach original identity");
        let reattached = timeline
            .observe(VaultObservation::external_edit(
                original_path.clone(),
                42,
                Some(41),
            ))
            .unwrap();
        assert_eq!(
            reattached.kind(),
            VaultObservationKind::Lifecycle(LifecycleEventKind::Reattached)
        );
        assert_eq!(reattached.previous_path(), Some(original_path.as_path()));
        assert_eq!(reattached.path(), original_path);
    }

    #[test]
    fn missing_transition_captures_retention_and_survives_restart_without_a_revision() {
        let _guard = crate::test_support::lock_test_env();
        let app_data = crate::test_support::TestDir::new("timeline-missing-retention-app-data");
        crate::state::initialize_app_data_dir(app_data.path().to_path_buf()).unwrap();
        let notes = crate::test_support::TestDir::new("timeline-missing-retention-notes");
        crate::state::set_notes_root_override(Some(notes.path().to_path_buf())).unwrap();
        crate::state::ensure_vault_scaffold(notes.path()).unwrap();
        let state = AppState::new(
            SemanticState::new_disabled("disabled"),
            EventBus::disabled(),
        )
        .unwrap();

        for (index, retention_days) in [1_u32, 7, 30].into_iter().enumerate() {
            crate::state::set_forgotten_note_retention_days(retention_days).unwrap();
            let title = format!("Missing retention {retention_days}");
            let created = crate::commands::note_persistence::persist_note_session_with_outcome(
                &state,
                title.clone(),
                format!("Retained body {retention_days}"),
                None,
            )
            .unwrap()
            .session
            .unwrap();
            let note_id = NoteIdentity::new(created.note_id.unwrap());
            let path = PathBuf::from(created.path.unwrap());
            let missing_at = crate::time::current_time_millis().unwrap() + index as u64 + 1;
            fs::remove_file(&path).unwrap();

            state
                .note_timeline()
                .observe(VaultObservation::missing(path.clone(), missing_at))
                .unwrap();

            let missing = state.note_timeline().missing_notes().unwrap();
            let record = missing
                .iter()
                .find(|record| record.note_id() == &note_id)
                .unwrap();
            assert_eq!(record.path(), path);
            assert_eq!(record.title(), title);
            assert_eq!(record.missing_at_millis(), missing_at);
            assert_eq!(record.retention_days(), retention_days);
            assert_eq!(
                record.purge_at_millis(),
                missing_at + u64::from(retention_days) * 24 * 60 * 60 * 1_000
            );
            let access = state.note_timeline().open_history_mode(note_id.clone());
            assert_eq!(
                access.revisions().unwrap_err(),
                "Recover the missing note before accessing its Note Timeline"
            );
            assert!(!state
                .note_timeline()
                .current_content(AllowedScope::only(note_id.clone()))
                .allows(&note_id));
            assert_eq!(
                state
                    .note_timeline()
                    .agent_restore(ExplicitRestoreGrant::new(
                        TurnIdentity::new("missing-restore-turn"),
                        note_id.clone(),
                        RevisionIdentity::from_persisted("missing-revision"),
                    ))
                    .err()
                    .unwrap(),
                "Recover the missing note before accessing its Note Timeline"
            );
        }

        crate::state::set_forgotten_note_retention_days(30).unwrap();
        let restarted = AppState::new(
            SemanticState::new_disabled("disabled"),
            EventBus::disabled(),
        )
        .unwrap();
        let missing = restarted.note_timeline().missing_notes().unwrap();
        assert_eq!(
            missing
                .iter()
                .map(|record| (
                    record.retention_days(),
                    record.purge_at_millis() - record.missing_at_millis()
                ))
                .collect::<Vec<_>>(),
            vec![
                (30, 30 * 24 * 60 * 60 * 1_000),
                (7, 7 * 24 * 60 * 60 * 1_000),
                (1, 24 * 60 * 60 * 1_000),
            ]
        );
        for record in missing {
            let access = restarted
                .note_timeline()
                .open_history_mode(record.note_id().clone());
            assert_eq!(
                access.revisions().unwrap_err(),
                "Recover the missing note before accessing its Note Timeline"
            );
            assert_eq!(
                history_store::revisions(record.note_id()).unwrap().len(),
                1,
                "Missing is lifecycle evidence, not authored content"
            );
            assert_eq!(
                history_store::lifecycle_events(record.note_id())
                    .unwrap()
                    .last()
                    .unwrap()
                    .kind(),
                LifecycleEventKind::Missing
            );
        }
        crate::state::set_notes_root_override(None).unwrap();
    }

    #[test]
    fn schema_seven_retained_missing_observation_backfills_and_replays() {
        let _guard = crate::test_support::lock_test_env();
        let app_data = crate::test_support::TestDir::new("timeline-missing-migration-app-data");
        crate::state::initialize_app_data_dir(app_data.path().to_path_buf()).unwrap();
        let notes = crate::test_support::TestDir::new("timeline-missing-migration-notes");
        crate::state::set_notes_root_override(Some(notes.path().to_path_buf())).unwrap();
        crate::state::ensure_vault_scaffold(notes.path()).unwrap();
        let state = AppState::new(
            SemanticState::new_disabled("disabled"),
            EventBus::disabled(),
        )
        .unwrap();
        let created = crate::commands::note_persistence::persist_note_session_with_outcome(
            &state,
            "Migrated missing".to_string(),
            "Retained before upgrade".to_string(),
            None,
        )
        .unwrap()
        .session
        .unwrap();
        let note_id = NoteIdentity::new(created.note_id.unwrap());
        let path = PathBuf::from(created.path.unwrap());
        fs::remove_file(&path).unwrap();
        history_store::retain_observation(&VaultObservation::missing(path, 42)).unwrap();
        history_store::mark_store_as_schema_seven_for_test();
        crate::state::set_forgotten_note_retention_days(30).unwrap();

        state
            .note_timeline()
            .recover_retained_observations()
            .unwrap();

        let missing = history_store::missing_note(&note_id).unwrap().unwrap();
        assert_eq!(missing.retention_days(), 30);
        assert_eq!(missing.purge_at_millis(), 42 + 30 * RECOVERY_DAY_MILLIS);
        assert_eq!(history_store::retained_observation_count(), 0);
        crate::state::set_notes_root_override(None).unwrap();
    }

    #[test]
    fn agent_restore_replays_retained_missing_observations_before_authorizing_access() {
        let _guard = crate::test_support::lock_test_env();
        let app_data = crate::test_support::TestDir::new("timeline-agent-restore-missing-app-data");
        crate::state::initialize_app_data_dir(app_data.path().to_path_buf()).unwrap();
        let notes = crate::test_support::TestDir::new("timeline-agent-restore-missing-notes");
        crate::state::set_notes_root_override(Some(notes.path().to_path_buf())).unwrap();
        crate::state::ensure_vault_scaffold(notes.path()).unwrap();
        let state = AppState::new(
            SemanticState::new_disabled("disabled"),
            EventBus::disabled(),
        )
        .unwrap();
        let created = crate::commands::note_persistence::persist_note_session_with_outcome(
            &state,
            "Pending missing restore".to_string(),
            "Retained before authorization".to_string(),
            None,
        )
        .unwrap()
        .session
        .unwrap();
        let note_id = NoteIdentity::new(created.note_id.unwrap());
        let path = PathBuf::from(created.path.unwrap());
        fs::remove_file(&path).unwrap();
        let pending_missing = state
            .note_timeline()
            .capture_observed_markdown(VaultObservation::missing(path, 42))
            .unwrap();
        history_store::retain_observation(&pending_missing).unwrap();

        let error = state
            .note_timeline()
            .agent_restore(ExplicitRestoreGrant::new(
                TurnIdentity::new("pending-missing-turn"),
                note_id.clone(),
                RevisionIdentity::from_persisted("pending-missing-revision"),
            ))
            .err()
            .unwrap();

        assert_eq!(
            error,
            "Recover the missing note before accessing its Note Timeline"
        );
        assert_eq!(history_store::retained_observation_count(), 0);
        assert!(history_store::missing_note(&note_id).unwrap().is_some());
        crate::state::set_notes_root_override(None).unwrap();
    }

    #[test]
    fn missing_note_recovery_rebuilds_retained_content_without_overwriting_path_reuse() {
        let _guard = crate::test_support::lock_test_env();
        let app_data = crate::test_support::TestDir::new("timeline-missing-recovery-app-data");
        crate::state::initialize_app_data_dir(app_data.path().to_path_buf()).unwrap();
        let notes = crate::test_support::TestDir::new("timeline-missing-recovery-notes");
        crate::state::set_notes_root_override(Some(notes.path().to_path_buf())).unwrap();
        crate::state::ensure_vault_scaffold(notes.path()).unwrap();
        crate::state::set_forgotten_note_retention_days(7).unwrap();
        let state = AppState::new(
            SemanticState::new_disabled("disabled"),
            EventBus::disabled(),
        )
        .unwrap();
        let created = crate::commands::note_persistence::persist_note_session_with_outcome(
            &state,
            "Recoverable".to_string(),
            "Last retained body".to_string(),
            None,
        )
        .unwrap()
        .session
        .unwrap();
        let note_id = NoteIdentity::new(created.note_id.unwrap());
        let original_path = PathBuf::from(created.path.unwrap());
        fs::remove_file(&original_path).unwrap();
        let timeline = state.note_timeline();
        timeline
            .observe(VaultObservation::missing(
                original_path.clone(),
                crate::time::current_time_millis().unwrap() + 1,
            ))
            .unwrap();
        fs::write(&original_path, "Unrelated path reuse").unwrap();

        let recovery = timeline.recover_missing_note(note_id.clone()).unwrap();

        assert_eq!(
            fs::read_to_string(&original_path).unwrap(),
            "Unrelated path reuse"
        );
        assert_ne!(recovery.receipt().path(), original_path);
        assert_eq!(
            recovery.receipt().previous_path(),
            Some(original_path.as_path())
        );
        assert_eq!(recovery.receipt().kind(), LifecycleEventKind::Recovered);
        let recovered_markdown = fs::read_to_string(recovery.receipt().path()).unwrap();
        assert_eq!(
            crate::note::parse_note(&recovered_markdown)
                .frontmatter
                .managed
                .unwrap()
                .id,
            note_id.as_str()
        );
        assert_eq!(
            crate::note::parse_note(&recovered_markdown).body,
            "Last retained body"
        );
        assert!(timeline.missing_notes().unwrap().is_empty());
        let access = timeline.open_history_mode(note_id);
        assert_eq!(access.revisions().unwrap().len(), 1);
        assert_eq!(
            access.lifecycle_events().unwrap().last().unwrap().kind(),
            LifecycleEventKind::Recovered
        );
        crate::state::set_notes_root_override(None).unwrap();
    }

    #[test]
    fn missing_note_recovery_prefers_the_free_last_known_path() {
        let _guard = crate::test_support::lock_test_env();
        let app_data = crate::test_support::TestDir::new("timeline-missing-free-path-app-data");
        crate::state::initialize_app_data_dir(app_data.path().to_path_buf()).unwrap();
        let notes = crate::test_support::TestDir::new("timeline-missing-free-path-notes");
        crate::state::set_notes_root_override(Some(notes.path().to_path_buf())).unwrap();
        crate::state::ensure_vault_scaffold(notes.path()).unwrap();
        crate::state::set_forgotten_note_retention_days(7).unwrap();
        let state = AppState::new(
            SemanticState::new_disabled("disabled"),
            EventBus::disabled(),
        )
        .unwrap();
        let created = crate::commands::note_persistence::persist_note_session_with_outcome(
            &state,
            "Free recovery path".to_string(),
            "Recovered in place".to_string(),
            None,
        )
        .unwrap()
        .session
        .unwrap();
        let note_id = NoteIdentity::new(created.note_id.unwrap());
        let path = PathBuf::from(created.path.unwrap());
        fs::remove_file(&path).unwrap();
        let timeline = state.note_timeline();
        timeline
            .observe(VaultObservation::missing(
                path.clone(),
                crate::time::current_time_millis().unwrap() + 1,
            ))
            .unwrap();

        let recovered = timeline.recover_missing_note(note_id).unwrap();

        assert_eq!(recovered.receipt().path(), path);
        assert_eq!(
            crate::note::parse_note(&fs::read_to_string(path).unwrap()).body,
            "Recovered in place"
        );
        crate::state::set_notes_root_override(None).unwrap();
    }

    #[test]
    fn failed_missing_note_publication_remains_recoverable() {
        let _guard = crate::test_support::lock_test_env();
        let app_data = crate::test_support::TestDir::new("timeline-missing-retry-app-data");
        crate::state::initialize_app_data_dir(app_data.path().to_path_buf()).unwrap();
        let notes = crate::test_support::TestDir::new("timeline-missing-retry-notes");
        crate::state::set_notes_root_override(Some(notes.path().to_path_buf())).unwrap();
        crate::state::ensure_vault_scaffold(notes.path()).unwrap();
        crate::state::set_forgotten_note_retention_days(7).unwrap();
        let state = AppState::new(
            SemanticState::new_disabled("disabled"),
            EventBus::disabled(),
        )
        .unwrap();
        let created = crate::commands::note_persistence::persist_note_session_with_outcome(
            &state,
            "Retry recovery".to_string(),
            "Still retained".to_string(),
            None,
        )
        .unwrap()
        .session
        .unwrap();
        let note_id = NoteIdentity::new(created.note_id.unwrap());
        let path = PathBuf::from(created.path.unwrap());
        fs::remove_file(&path).unwrap();
        let timeline = state.note_timeline();
        timeline
            .observe(VaultObservation::missing(
                path.clone(),
                crate::time::current_time_millis().unwrap() + 1,
            ))
            .unwrap();
        crate::state::inject_note_publication_failure_once();

        assert!(timeline.recover_missing_note(note_id.clone()).is_err());
        assert!(!path.exists());
        assert!(history_store::missing_note(&note_id).unwrap().is_some());
        assert_eq!(
            history_store::lifecycle_events(&note_id)
                .unwrap()
                .last()
                .unwrap()
                .kind(),
            LifecycleEventKind::Missing
        );

        timeline.recover_missing_note(note_id.clone()).unwrap();
        assert!(path.exists());
        assert!(history_store::missing_note(&note_id).unwrap().is_none());
        crate::state::set_notes_root_override(None).unwrap();
    }

    #[test]
    fn restart_reattaches_only_the_same_identity_at_the_missing_path() {
        let _guard = crate::test_support::lock_test_env();
        let app_data = crate::test_support::TestDir::new("timeline-missing-reattach-app-data");
        crate::state::initialize_app_data_dir(app_data.path().to_path_buf()).unwrap();
        let notes = crate::test_support::TestDir::new("timeline-missing-reattach-notes");
        crate::state::set_notes_root_override(Some(notes.path().to_path_buf())).unwrap();
        crate::state::ensure_vault_scaffold(notes.path()).unwrap();
        crate::state::set_forgotten_note_retention_days(7).unwrap();
        let state = AppState::new(
            SemanticState::new_disabled("disabled"),
            EventBus::disabled(),
        )
        .unwrap();
        let created = crate::commands::note_persistence::persist_note_session_with_outcome(
            &state,
            "Reappearing".to_string(),
            "Original retained body".to_string(),
            None,
        )
        .unwrap()
        .session
        .unwrap();
        let note_id = NoteIdentity::new(created.note_id.unwrap());
        let path = PathBuf::from(created.path.unwrap());
        let original_markdown = fs::read_to_string(&path).unwrap();
        fs::remove_file(&path).unwrap();
        state
            .note_timeline()
            .observe(VaultObservation::missing(
                path.clone(),
                crate::time::current_time_millis().unwrap() + 1,
            ))
            .unwrap();

        let unrelated =
            "---\ngneauxghts:\n  id: unrelated-path-reuse\n  kind: note\n---\n\nUnrelated";
        fs::write(&path, unrelated).unwrap();
        let unrelated_receipt = state
            .note_timeline()
            .observe(
                VaultObservation::external_edit(path.clone(), 200, None)
                    .with_canonical_markdown(unrelated.to_string()),
            )
            .unwrap();
        assert_eq!(
            unrelated_receipt.kind(),
            VaultObservationKind::CanonicalState
        );
        assert_eq!(state.note_timeline().missing_notes().unwrap().len(), 1);
        assert_eq!(
            history_store::revisions(&NoteIdentity::new("unrelated-path-reuse"))
                .unwrap()
                .len(),
            1
        );

        fs::remove_file(&path).unwrap();
        let restarted = AppState::new(
            SemanticState::new_disabled("disabled"),
            EventBus::disabled(),
        )
        .unwrap();
        fs::write(&path, original_markdown).unwrap();
        let reattached = restarted
            .note_timeline()
            .observe(VaultObservation::reconciled_state(
                path.clone(),
                crate::time::current_time_millis().unwrap() + 2,
                None,
            ))
            .unwrap();

        assert_eq!(
            reattached.kind(),
            VaultObservationKind::Lifecycle(LifecycleEventKind::Reattached)
        );
        assert!(restarted
            .note_timeline()
            .missing_notes()
            .unwrap()
            .is_empty());
        let access = restarted.note_timeline().open_history_mode(note_id);
        assert_eq!(access.revisions().unwrap().len(), 1);
        assert_eq!(
            access.lifecycle_events().unwrap().last().unwrap().kind(),
            LifecycleEventKind::Reattached
        );
        crate::state::set_notes_root_override(None).unwrap();
    }

    #[test]
    fn expired_missing_note_purges_its_timeline_without_deleting_path_reuse() {
        let _guard = crate::test_support::lock_test_env();
        let app_data = crate::test_support::TestDir::new("timeline-missing-expiry-app-data");
        crate::state::initialize_app_data_dir(app_data.path().to_path_buf()).unwrap();
        let notes = crate::test_support::TestDir::new("timeline-missing-expiry-notes");
        crate::state::set_notes_root_override(Some(notes.path().to_path_buf())).unwrap();
        crate::state::ensure_vault_scaffold(notes.path()).unwrap();
        crate::state::set_forgotten_note_retention_days(1).unwrap();
        let state = AppState::new(
            SemanticState::new_disabled("disabled"),
            EventBus::disabled(),
        )
        .unwrap();
        let created = crate::commands::note_persistence::persist_note_session_with_outcome(
            &state,
            "Expire missing".to_string(),
            "Private retained body".to_string(),
            None,
        )
        .unwrap()
        .session
        .unwrap();
        let note_id = NoteIdentity::new(created.note_id.unwrap());
        let path = PathBuf::from(created.path.unwrap());
        fs::remove_file(&path).unwrap();
        let missing_at = crate::time::current_time_millis().unwrap() + 1;
        let timeline = state.note_timeline();
        timeline
            .observe(VaultObservation::missing(path.clone(), missing_at))
            .unwrap();
        fs::write(&path, "Unrelated content at the old path").unwrap();

        timeline
            .purge_expired_missing_notes(missing_at + RECOVERY_DAY_MILLIS)
            .unwrap();

        assert_eq!(
            fs::read_to_string(&path).unwrap(),
            "Unrelated content at the old path"
        );
        assert!(timeline.missing_notes().unwrap().is_empty());
        assert!(history_store::revisions(&note_id).unwrap().is_empty());
        assert!(history_store::lifecycle_events(&note_id)
            .unwrap()
            .is_empty());
        assert!(history_store::missing_note(&note_id).unwrap().is_none());
        crate::state::set_notes_root_override(None).unwrap();
    }

    #[test]
    fn recovery_after_the_captured_deadline_purges_instead_of_recreating_the_note() {
        let _guard = crate::test_support::lock_test_env();
        let app_data = crate::test_support::TestDir::new("timeline-expired-recovery-app-data");
        crate::state::initialize_app_data_dir(app_data.path().to_path_buf()).unwrap();
        let notes = crate::test_support::TestDir::new("timeline-expired-recovery-notes");
        crate::state::set_notes_root_override(Some(notes.path().to_path_buf())).unwrap();
        crate::state::ensure_vault_scaffold(notes.path()).unwrap();
        crate::state::set_forgotten_note_retention_days(1).unwrap();
        let state = AppState::new(
            SemanticState::new_disabled("disabled"),
            EventBus::disabled(),
        )
        .unwrap();
        let created = crate::commands::note_persistence::persist_note_session_with_outcome(
            &state,
            "Expired recovery".to_string(),
            "Must be purged".to_string(),
            None,
        )
        .unwrap()
        .session
        .unwrap();
        let note_id = NoteIdentity::new(created.note_id.unwrap());
        let path = PathBuf::from(created.path.unwrap());
        fs::remove_file(&path).unwrap();
        let timeline = state.note_timeline();
        timeline
            .observe(VaultObservation::missing(path.clone(), 1))
            .unwrap();

        let error = timeline.recover_missing_note(note_id.clone()).unwrap_err();

        assert!(error.contains("deadline expired"));
        assert!(!path.exists());
        assert!(history_store::missing_note(&note_id).unwrap().is_none());
        assert!(history_store::revisions(&note_id).unwrap().is_empty());
        assert!(history_store::lifecycle_events(&note_id)
            .unwrap()
            .is_empty());
        crate::state::set_notes_root_override(None).unwrap();
    }

    #[test]
    fn lifecycle_publication_returns_the_typed_identity_and_paths() {
        let _guard = crate::test_support::lock_test_env();
        let app_data = crate::test_support::TestDir::new("timeline-lifecycle-app-data");
        crate::state::initialize_app_data_dir(app_data.path().to_path_buf()).unwrap();
        let notes = crate::test_support::TestDir::new("timeline-lifecycle-notes");
        crate::state::set_notes_root_override(Some(notes.path().to_path_buf())).unwrap();
        crate::state::ensure_vault_scaffold(notes.path()).unwrap();
        let state = AppState::new(
            SemanticState::new_disabled("disabled"),
            EventBus::disabled(),
        )
        .expect("construct app state");
        let created = crate::commands::note_persistence::persist_note_session_with_outcome(
            &state,
            "Lifecycle receipt".to_string(),
            "Retained body".to_string(),
            None,
        )
        .unwrap()
        .session
        .unwrap();
        let note_id = NoteIdentity::new(created.note_id.unwrap());
        let active_path = PathBuf::from(created.path.unwrap());
        let forgotten_path =
            crate::state::forgotten_notes_root(notes.path()).join("Lifecycle receipt.md");
        fs::create_dir_all(forgotten_path.parent().unwrap()).unwrap();
        let current = fs::read_to_string(&active_path).unwrap();
        let forgotten_markdown = crate::note::prepare_note_markdown(
            &current,
            Some(&current),
            Some(Some("2026-09-03T12:00:00.000Z".to_string())),
        )
        .unwrap()
        .0;

        let publication = state
            .note_timeline()
            .publish_lifecycle(
                NoteLifecycleOperation::forgotten(
                    note_id.clone(),
                    active_path.clone(),
                    forgotten_path.clone(),
                    42,
                ),
                &forgotten_markdown,
                || {
                    fs::rename(&active_path, &forgotten_path).map_err(|error| {
                        LifecyclePublicationFailure::not_published(error.to_string())
                    })?;
                    fs::write(&forgotten_path, &forgotten_markdown).map_err(|error| {
                        LifecyclePublicationFailure::not_published(error.to_string())
                    })
                },
            )
            .unwrap();
        let receipt = publication.receipt();

        assert_eq!(receipt.kind(), LifecycleEventKind::Forgotten);
        assert_eq!(receipt.note_id(), &note_id);
        assert_eq!(receipt.path(), forgotten_path);
        assert_eq!(receipt.previous_path(), Some(active_path.as_path()));
        assert_eq!(receipt.occurred_at_millis(), 42);
        crate::state::set_notes_root_override(None).unwrap();
    }

    #[test]
    fn warning_serialization_retains_the_existing_ipc_shape() {
        let warning = NoteMutationWarning::single(
            MutationWarningStage::CatalogUpsert,
            "Saved with degraded synchronization".to_string(),
            "catalog unavailable".to_string(),
        );

        assert_eq!(
            serde_json::to_value(warning).unwrap(),
            serde_json::json!({
                "message": "Saved with degraded synchronization",
                "issues": [{
                    "stage": "catalogUpsert",
                    "message": "catalog unavailable"
                }]
            })
        );
    }

    #[test]
    fn domain_records_carry_versioned_payloads_and_explicit_predecessors() {
        let note_id = NoteIdentity::new("note-1");
        let first = NoteRevisionHeader::issue(
            note_id.clone(),
            None,
            PayloadVersion::V1,
            MutationSource::Editor,
        );
        let first_id = first.identity.clone();
        let renamed = LifecycleEventHeader::issue(
            note_id.clone(),
            Some(TimelineRecordIdentity::Revision(first_id.clone())),
            PayloadVersion::V1,
            LifecycleEventKind::Renamed,
        );
        let event_id = renamed.identity.clone();
        let second = NoteRevisionHeader::issue(
            note_id,
            Some(TimelineRecordIdentity::LifecycleEvent(event_id)),
            PayloadVersion::V1,
            MutationSource::Editor,
        );

        assert_eq!(first.identity.0.len(), 26);
        assert_eq!(renamed.identity.0.len(), 26);
        assert_eq!(second.identity.0.len(), 26);
        assert_ne!(first.identity.0, renamed.identity.0);
        assert_ne!(renamed.identity.0, second.identity.0);
        assert_eq!(first.predecessor(), None);
        assert_eq!(renamed.kind(), LifecycleEventKind::Renamed);
        assert_eq!(renamed.payload_version(), PayloadVersion::V1);
        assert_eq!(
            second.predecessor(),
            Some(&TimelineRecordIdentity::LifecycleEvent(
                renamed.identity.clone()
            ))
        );
    }

    #[test]
    fn mutation_result_preserves_required_warning_semantics_and_all_diagnostics() {
        let result = NoteMutationResult::from_publication(
            MutationSource::Editor,
            PublicationOutcome {
                note_id: "note-1".to_string(),
                path: PathBuf::from("/vault/Note.md"),
                canonical_markdown: "# Note".to_string(),
                issues: vec![
                    PublicationIssue {
                        stage: PublicationStage::CanonicalRead,
                        message: "read failed".to_string(),
                    },
                    PublicationIssue {
                        stage: PublicationStage::SemanticUpdate,
                        message: "semantic queue failed".to_string(),
                    },
                ],
            },
        );

        let warning = result.warning().expect("required warning");
        assert_eq!(warning.payload_version(), PayloadVersion::V1);
        assert_eq!(warning.issues().len(), 1);
        assert!(warning.message().contains("Canonical note file was saved"));
        assert_eq!(result.diagnostics().len(), 2);
    }

    #[test]
    fn history_mode_pages_records_with_a_stable_cursor_and_reconstructs_the_selected_revision() {
        let _guard = crate::test_support::lock_test_env();
        let app_data = crate::test_support::TestDir::new("timeline-history-mode-page-app-data");
        crate::state::initialize_app_data_dir(app_data.path().to_path_buf()).unwrap();
        let notes = crate::test_support::TestDir::new("timeline-history-mode-page-notes");
        crate::state::set_notes_root_override(Some(notes.path().to_path_buf())).unwrap();
        crate::state::ensure_vault_scaffold(notes.path()).unwrap();
        let state = AppState::new(
            SemanticState::new_disabled("disabled"),
            EventBus::disabled(),
        )
        .unwrap();
        let created = crate::commands::note_persistence::persist_note_session_with_outcome(
            &state,
            "Paged".to_string(),
            "first".to_string(),
            None,
        )
        .unwrap()
        .session
        .unwrap();
        let note_id = NoteIdentity::new(created.note_id.unwrap());
        let path = created.path.unwrap();
        for body in ["second", "third"] {
            crate::commands::note_persistence::persist_note_session_with_outcome(
                &state,
                "Paged".to_string(),
                body.to_string(),
                Some(path.clone()),
            )
            .unwrap();
        }

        let access = state.note_timeline().open_history_mode(note_id.clone());
        let first_page = access.page(None, 2).unwrap();
        assert_eq!(first_page.records().len(), 2);
        let serialized = serde_json::to_value(&first_page).unwrap();
        assert_eq!(serialized["records"][0]["kind"], "revision");
        assert!(serialized["records"][0]["recordId"].is_string());
        assert!(serialized["records"][0]["revisionId"].is_string());
        assert_eq!(serialized["records"][0]["timeKind"], "committed");
        assert!(serialized["records"][0]["editingSessionId"].is_string());
        assert_eq!(serialized["records"][0]["lineCount"], 1);
        assert_eq!(serialized["records"][0]["characterCount"], 5);
        assert!(serialized.get("nextCursor").is_some());
        let cursor = first_page
            .next_cursor()
            .expect("older page cursor")
            .to_string();
        let selected_id = first_page.records()[0]
            .revision_id()
            .expect("newest record is a revision")
            .to_string();
        assert_eq!(access.revision(&selected_id).unwrap().body(), "third");

        crate::commands::note_persistence::persist_note_session_with_outcome(
            &state,
            "Paged".to_string(),
            "fourth".to_string(),
            Some(path),
        )
        .unwrap();
        let second_page = access.page(Some(&cursor), 2).unwrap();
        let first_ids = first_page
            .records()
            .iter()
            .map(HistoryModeRecord::record_id)
            .collect::<HashSet<_>>();
        assert!(second_page
            .records()
            .iter()
            .all(|record| !first_ids.contains(record.record_id())));
        assert!(second_page
            .records()
            .iter()
            .all(|record| record.revision_id() != Some(selected_id.as_str())));
        crate::state::set_notes_root_override(None).unwrap();
    }

    #[test]
    fn version_restore_is_complete_hash_bound_append_only_and_reversible_after_restart() {
        let _guard = crate::test_support::lock_test_env();
        let app_data = crate::test_support::TestDir::new("timeline-version-restore-app-data");
        crate::state::initialize_app_data_dir(app_data.path().to_path_buf()).unwrap();
        let notes = crate::test_support::TestDir::new("timeline-version-restore-notes");
        crate::state::set_notes_root_override(Some(notes.path().to_path_buf())).unwrap();
        crate::state::ensure_vault_scaffold(notes.path()).unwrap();
        let state = AppState::new(
            SemanticState::new_disabled("disabled"),
            EventBus::disabled(),
        )
        .unwrap();
        let created = crate::commands::note_persistence::persist_note_session_with_outcome(
            &state,
            "Current title".to_string(),
            "---\nproject: original\n---\n\nEarlier body".to_string(),
            None,
        )
        .unwrap()
        .session
        .unwrap();
        let note_id = NoteIdentity::new(created.note_id.unwrap());
        let mut path = PathBuf::from(created.path.unwrap());
        let access = state.note_timeline().open_history_mode(note_id.clone());
        let earlier_revision_id = access.revisions().unwrap()[0].identity().clone();

        let renamed = crate::commands::note_persistence::persist_note_session_with_outcome(
            &state,
            "Renamed current title".to_string(),
            "---\nproject: current\n---\n\nCurrent body".to_string(),
            Some(path.to_string_lossy().into_owned()),
        )
        .unwrap();
        path = PathBuf::from(renamed.session.unwrap().path.unwrap());
        let before_restore = fs::read_to_string(&path).unwrap();
        let before_metadata = crate::note::parse_note(&before_restore)
            .frontmatter
            .managed
            .unwrap();
        let preview = access
            .restore_preview(earlier_revision_id.as_str())
            .unwrap();
        assert_eq!(preview.revision_id(), earlier_revision_id.as_str());
        assert_eq!(preview.unmanaged_frontmatter(), Some("project: original\n"));
        assert_eq!(preview.body(), "Earlier body");

        crate::commands::note_persistence::persist_note_session_with_outcome(
            &state,
            "Renamed current title".to_string(),
            "---\nproject: concurrent\n---\n\nConcurrent edit".to_string(),
            Some(path.to_string_lossy().into_owned()),
        )
        .unwrap();
        let stale_error = access
            .confirm_restore(
                earlier_revision_id.as_str(),
                preview.current_authored_content_hash(),
            )
            .expect_err("concurrent authored edit invalidates preview");
        assert!(stale_error.contains("Current authored content changed"));
        assert_eq!(
            crate::note::parse_note(&fs::read_to_string(&path).unwrap()).body,
            "Concurrent edit"
        );

        let pre_restore_revision_id = access
            .revisions()
            .unwrap()
            .last()
            .unwrap()
            .identity()
            .clone();
        let lifecycle_before_restore = access.lifecycle_events().unwrap();
        assert!(lifecycle_before_restore
            .iter()
            .any(|event| event.kind() == LifecycleEventKind::Renamed));
        let preview = access
            .restore_preview(earlier_revision_id.as_str())
            .unwrap();
        let restored = access
            .confirm_restore(
                earlier_revision_id.as_str(),
                preview.current_authored_content_hash(),
            )
            .unwrap();
        assert_eq!(restored.mutation().note_id(), &note_id);
        assert_eq!(restored.mutation().path(), path.as_path());
        let restored_markdown = fs::read_to_string(&path).unwrap();
        let restored_note = crate::note::parse_note(&restored_markdown);
        assert_eq!(
            restored_note.frontmatter.raw_other.as_deref(),
            Some("project: original")
        );
        assert_eq!(restored_note.body, "Earlier body");
        let restored_metadata = restored_note.frontmatter.managed.unwrap();
        assert_eq!(restored_metadata.id, before_metadata.id);
        assert_eq!(restored_metadata.created_at, before_metadata.created_at);
        assert_eq!(restored_metadata.trashed_at, before_metadata.trashed_at);
        assert_eq!(restored_metadata.kind, before_metadata.kind);
        assert_eq!(path.file_stem().unwrap(), "Renamed current title");

        let restarted = AppState::new(
            SemanticState::new_disabled("disabled"),
            EventBus::disabled(),
        )
        .unwrap();
        let restarted_access = restarted.note_timeline().open_history_mode(note_id.clone());
        let revisions = restarted_access.revisions().unwrap();
        assert_eq!(
            restarted_access.lifecycle_events().unwrap(),
            lifecycle_before_restore
        );
        assert_eq!(revisions.len(), 4);
        assert_eq!(
            revisions.last().unwrap().source(),
            MutationSource::VersionRestore
        );
        assert_eq!(restored.revision_id(), revisions.last().unwrap().identity());
        assert_eq!(
            reconstructed_revision_bodies_for_test(&restarted, note_id.as_str()).unwrap(),
            vec![
                "Earlier body",
                "Current body",
                "Concurrent edit",
                "Earlier body"
            ]
        );

        let reverse_preview = restarted_access
            .restore_preview(pre_restore_revision_id.as_str())
            .unwrap();
        restarted_access
            .confirm_restore(
                pre_restore_revision_id.as_str(),
                reverse_preview.current_authored_content_hash(),
            )
            .unwrap();
        let reversed = restarted_access.revisions().unwrap();
        assert_eq!(reversed.len(), 5);
        assert_eq!(
            reversed.last().unwrap().source(),
            MutationSource::VersionRestore
        );
        assert_eq!(
            crate::note::parse_note(&fs::read_to_string(&path).unwrap()).body,
            "Concurrent edit"
        );
        crate::state::set_notes_root_override(None).unwrap();
    }

    #[test]
    fn version_restore_can_replace_current_authored_content_with_empty_content() {
        let _guard = crate::test_support::lock_test_env();
        let app_data = crate::test_support::TestDir::new("timeline-empty-version-restore-app-data");
        crate::state::initialize_app_data_dir(app_data.path().to_path_buf()).unwrap();
        let notes = crate::test_support::TestDir::new("timeline-empty-version-restore-notes");
        crate::state::set_notes_root_override(Some(notes.path().to_path_buf())).unwrap();
        crate::state::ensure_vault_scaffold(notes.path()).unwrap();
        let state = AppState::new(
            SemanticState::new_disabled("disabled"),
            EventBus::disabled(),
        )
        .unwrap();
        let created = crate::commands::note_persistence::persist_note_session_with_outcome(
            &state,
            "Empty history".to_string(),
            String::new(),
            None,
        )
        .unwrap()
        .session
        .unwrap();
        let note_id = NoteIdentity::new(created.note_id.unwrap());
        let path = PathBuf::from(created.path.unwrap());
        let access = state.note_timeline().open_history_mode(note_id.clone());
        let empty_revision = access.revisions().unwrap()[0].identity().clone();
        crate::commands::note_persistence::persist_note_session_with_outcome(
            &state,
            "Empty history".to_string(),
            "Not empty now".to_string(),
            Some(path.to_string_lossy().into_owned()),
        )
        .unwrap();

        let preview = access.restore_preview(empty_revision.as_str()).unwrap();
        access
            .confirm_restore(
                empty_revision.as_str(),
                preview.current_authored_content_hash(),
            )
            .unwrap();

        let canonical = fs::read_to_string(&path).unwrap();
        let parsed = crate::note::parse_note(&canonical);
        assert_eq!(parsed.body, "");
        assert_eq!(parsed.frontmatter.raw_other, None);
        assert_eq!(parsed.frontmatter.managed.unwrap().id, note_id.as_str());
        crate::state::set_notes_root_override(None).unwrap();
    }

    #[test]
    fn version_restore_preserves_exact_historical_frontmatter_and_line_endings() {
        let _guard = crate::test_support::lock_test_env();
        let app_data = crate::test_support::TestDir::new("timeline-exact-version-restore-app-data");
        crate::state::initialize_app_data_dir(app_data.path().to_path_buf()).unwrap();
        let notes = crate::test_support::TestDir::new("timeline-exact-version-restore-notes");
        crate::state::set_notes_root_override(Some(notes.path().to_path_buf())).unwrap();
        crate::state::ensure_vault_scaffold(notes.path()).unwrap();
        let state = AppState::new(
            SemanticState::new_disabled("disabled"),
            EventBus::disabled(),
        )
        .unwrap();
        let created = crate::commands::note_persistence::persist_note_session_with_outcome(
            &state,
            "Exact history".to_string(),
            "Initial body".to_string(),
            None,
        )
        .unwrap()
        .session
        .unwrap();
        let note_id = NoteIdentity::new(created.note_id.unwrap());
        let path = PathBuf::from(created.path.unwrap());
        let exact_unmanaged = "project: atlas\r\n\r\nflag: true\r\n";
        let exact_body = "Historical first\r\nHistorical second\r\n";
        let exact = crate::note::replace_authored_content(
            &fs::read_to_string(&path).unwrap(),
            Some(exact_unmanaged),
            exact_body,
        )
        .unwrap();
        fs::write(&path, &exact).unwrap();
        state
            .note_timeline()
            .observe(VaultObservation::external_edit(path.clone(), 10, Some(9)))
            .unwrap();
        let access = state.note_timeline().open_history_mode(note_id.clone());
        let exact_revision = access
            .revisions()
            .unwrap()
            .last()
            .unwrap()
            .identity()
            .clone();

        crate::commands::note_persistence::persist_note_session_with_outcome(
            &state,
            "Exact history".to_string(),
            "Current body".to_string(),
            Some(path.to_string_lossy().into_owned()),
        )
        .unwrap();
        let preview = access.restore_preview(exact_revision.as_str()).unwrap();
        assert_eq!(preview.unmanaged_frontmatter(), Some(exact_unmanaged));
        assert_eq!(preview.body(), exact_body);
        let restored = access
            .confirm_restore(
                exact_revision.as_str(),
                preview.current_authored_content_hash(),
            )
            .unwrap();

        let restored_markdown = fs::read_to_string(&path).unwrap();
        assert_eq!(
            history_store::authored_content_hash(&restored_markdown),
            history_store::authored_parts_hash(Some(exact_unmanaged), exact_body)
        );
        let restored_revision = access.revision(restored.revision_id().as_str()).unwrap();
        assert_eq!(
            restored_revision.unmanaged_frontmatter(),
            Some(exact_unmanaged)
        );
        assert_eq!(restored_revision.body(), exact_body);
        crate::state::set_notes_root_override(None).unwrap();
    }

    #[test]
    fn lifecycle_recovery_preserves_a_newer_same_identity_external_edit() {
        let _guard = crate::test_support::lock_test_env();
        let app_data =
            crate::test_support::TestDir::new("timeline-lifecycle-external-edit-app-data");
        crate::state::initialize_app_data_dir(app_data.path().to_path_buf()).unwrap();
        let notes = crate::test_support::TestDir::new("timeline-lifecycle-external-edit-notes");
        crate::state::set_notes_root_override(Some(notes.path().to_path_buf())).unwrap();
        crate::state::ensure_vault_scaffold(notes.path()).unwrap();
        let state = AppState::new(
            SemanticState::new_disabled("disabled"),
            EventBus::disabled(),
        )
        .unwrap();
        let created = crate::commands::note_persistence::persist_note_session_with_outcome(
            &state,
            "Externally edited lifecycle".to_string(),
            "Published body".to_string(),
            None,
        )
        .unwrap()
        .session
        .unwrap();
        let note_id = NoteIdentity::new(created.note_id.unwrap());
        let active_path = PathBuf::from(created.path.unwrap());
        let forgotten_path =
            crate::state::forgotten_notes_root(notes.path()).join("Externally edited lifecycle.md");
        fs::create_dir_all(forgotten_path.parent().unwrap()).unwrap();
        let current = fs::read_to_string(&active_path).unwrap();
        let forgotten_markdown = crate::note::prepare_note_markdown(
            &current,
            Some(&current),
            Some(Some("2026-09-03T12:00:00.000Z".to_string())),
        )
        .unwrap()
        .0;
        inject_lifecycle_finalization_failure_once();

        let publication = state
            .note_timeline()
            .publish_lifecycle(
                NoteLifecycleOperation::forgotten(
                    note_id.clone(),
                    active_path.clone(),
                    forgotten_path.clone(),
                    42,
                ),
                &forgotten_markdown,
                || {
                    fs::rename(&active_path, &forgotten_path).map_err(|error| {
                        LifecyclePublicationFailure::not_published(error.to_string())
                    })?;
                    fs::write(&forgotten_path, &forgotten_markdown).map_err(|error| {
                        LifecyclePublicationFailure::not_published(error.to_string())
                    })
                },
            )
            .unwrap();
        assert!(publication.commit_warning().is_some());
        assert_eq!(retained_observation_count_for_test(), 1);

        let externally_edited = crate::note::replace_authored_content(
            &fs::read_to_string(&forgotten_path).unwrap(),
            None,
            "Edited after lifecycle publication",
        )
        .unwrap();
        fs::write(&forgotten_path, &externally_edited).unwrap();
        let before_recovery = crate::time::current_time_millis().unwrap();

        state
            .note_timeline()
            .recover_lifecycle_publications()
            .unwrap();

        assert_eq!(retained_observation_count_for_test(), 0);
        assert_eq!(
            crate::note::parse_note(&fs::read_to_string(&forgotten_path).unwrap()).body,
            "Edited after lifecycle publication"
        );
        let external_revision = history_store::revisions(&note_id)
            .unwrap()
            .into_iter()
            .find(|revision| revision.source() == MutationSource::ExternalEdit)
            .expect("preserved authored state is observed as an external revision");
        assert!(external_revision
            .observed_at_millis()
            .is_some_and(|observed_at| observed_at >= before_recovery));
        crate::state::set_notes_root_override(None).unwrap();
    }

    #[test]
    fn forgotten_note_history_requires_recovery_before_inspection_or_version_restore() {
        let _guard = crate::test_support::lock_test_env();
        let app_data =
            crate::test_support::TestDir::new("timeline-forgotten-version-restore-app-data");
        crate::state::initialize_app_data_dir(app_data.path().to_path_buf()).unwrap();
        let notes = crate::test_support::TestDir::new("timeline-forgotten-version-restore-notes");
        crate::state::set_notes_root_override(Some(notes.path().to_path_buf())).unwrap();
        crate::state::ensure_vault_scaffold(notes.path()).unwrap();
        let state = AppState::new(
            SemanticState::new_disabled("disabled"),
            EventBus::disabled(),
        )
        .unwrap();
        let created = crate::commands::note_persistence::persist_note_session_with_outcome(
            &state,
            "Forgotten history".to_string(),
            "Earlier body".to_string(),
            None,
        )
        .unwrap()
        .session
        .unwrap();
        let note_id = NoteIdentity::new(created.note_id.unwrap());
        let active_path = PathBuf::from(created.path.unwrap());
        let access = state.note_timeline().open_history_mode(note_id.clone());
        let earlier_revision = access.revisions().unwrap()[0].identity().clone();
        crate::commands::note_persistence::persist_note_session_with_outcome(
            &state,
            "Forgotten history".to_string(),
            "Current body".to_string(),
            Some(active_path.to_string_lossy().into_owned()),
        )
        .unwrap();

        let current = fs::read_to_string(&active_path).unwrap();
        let forgotten_at = "2026-09-03T12:00:00.000Z".to_string();
        let forgotten_markdown = crate::note::prepare_note_markdown(
            &current,
            Some(&current),
            Some(Some(forgotten_at.clone())),
        )
        .unwrap()
        .0;
        let forgotten_root = crate::state::forgotten_notes_root(notes.path());
        fs::create_dir_all(&forgotten_root).unwrap();
        let forgotten_path = forgotten_root.join("Forgotten history.md");
        let forgotten_at_millis = crate::time::current_time_millis().unwrap() + 100;
        let mut forgotten_publication = None;
        let delivered = state
            .note_timeline()
            .current_content(AllowedScope::vault())
            .read(|| {
                forgotten_publication = Some(
                    state
                        .note_timeline()
                        .publish_lifecycle(
                            NoteLifecycleOperation::forgotten(
                                note_id.clone(),
                                active_path.clone(),
                                forgotten_path.clone(),
                                forgotten_at_millis,
                            ),
                            &forgotten_markdown,
                            || {
                                fs::rename(&active_path, &forgotten_path).map_err(|error| {
                                    LifecyclePublicationFailure::not_published(error.to_string())
                                })?;
                                fs::write(&forgotten_path, &forgotten_markdown).map_err(|error| {
                                    LifecyclePublicationFailure::not_published(error.to_string())
                                })
                            },
                        )
                        .unwrap(),
                );
                Ok(vec![TestCurrentContentItem {
                    note_id: note_id.as_str().to_string(),
                    note_path: active_path.to_string_lossy().into_owned(),
                }])
            })
            .unwrap();
        let forgotten_publication = forgotten_publication
            .expect("forgotten publication is captured during the current-content read");
        assert_eq!(
            forgotten_publication.receipt().kind(),
            LifecycleEventKind::Forgotten
        );
        assert!(forgotten_publication.commit_warning().is_none());
        assert_eq!(retained_observation_count_for_test(), 0);
        assert!(delivered.is_empty());
        assert!(!active_path.exists());
        assert!(forgotten_path.exists());
        let still_forgotten =
            crate::note::parse_note(&fs::read_to_string(&forgotten_path).unwrap());
        assert_eq!(still_forgotten.body, "Current body");
        assert_eq!(
            still_forgotten.frontmatter.managed.unwrap().trashed_at,
            Some(forgotten_at)
        );
        drop(access);
        drop(state);
        let state = AppState::new(
            SemanticState::new_disabled("disabled"),
            EventBus::disabled(),
        )
        .unwrap();
        let access = state.note_timeline().open_history_mode(note_id.clone());
        assert!(access.page(None, 50).unwrap_err().contains("Recover"));
        assert_eq!(retained_observation_count_for_test(), 0);
        let current_content = state
            .note_timeline()
            .current_content(AllowedScope::only(note_id.clone()));
        assert!(state
            .note_timeline()
            .clear_note_history(&note_id)
            .unwrap_err()
            .contains("Recover the forgotten note"));
        for error in [
            access.revision(earlier_revision.as_str()).unwrap_err(),
            access
                .restore_preview(earlier_revision.as_str())
                .unwrap_err(),
        ] {
            assert!(error.contains("Recover the forgotten note"));
        }
        assert!(!current_content.allows(&note_id));
        drop(current_content);

        let recovered_markdown = crate::note::prepare_note_markdown(
            &fs::read_to_string(&forgotten_path).unwrap(),
            Some(&fs::read_to_string(&forgotten_path).unwrap()),
            Some(None),
        )
        .unwrap()
        .0;
        let recovered_publication = state
            .note_timeline()
            .publish_lifecycle(
                NoteLifecycleOperation::recovered(
                    note_id,
                    forgotten_path.clone(),
                    active_path.clone(),
                    forgotten_at_millis + 1,
                ),
                &recovered_markdown,
                || {
                    fs::rename(&forgotten_path, &active_path).map_err(|error| {
                        LifecyclePublicationFailure::not_published(error.to_string())
                    })?;
                    fs::write(&active_path, &recovered_markdown).map_err(|error| {
                        LifecyclePublicationFailure::not_published(error.to_string())
                    })
                },
            )
            .unwrap();
        assert_eq!(
            recovered_publication.receipt().kind(),
            LifecycleEventKind::Recovered
        );
        assert!(recovered_publication.commit_warning().is_none());

        let current_content = state
            .note_timeline()
            .current_content(AllowedScope::only(access.note_id().clone()));
        assert_eq!(access.revisions().unwrap().len(), 2);
        assert!(current_content.allows(access.note_id()));
        assert_eq!(
            access
                .lifecycle_events()
                .unwrap()
                .into_iter()
                .map(|event| event.kind())
                .collect::<Vec<_>>(),
            vec![
                LifecycleEventKind::Created,
                LifecycleEventKind::Forgotten,
                LifecycleEventKind::Recovered,
            ]
        );
        let preview = access.restore_preview(earlier_revision.as_str()).unwrap();
        access
            .confirm_restore(
                earlier_revision.as_str(),
                preview.current_authored_content_hash(),
            )
            .unwrap();
        assert_eq!(
            crate::note::parse_note(&fs::read_to_string(active_path).unwrap()).body,
            "Earlier body"
        );
        assert_eq!(access.revisions().unwrap().len(), 3);
        crate::state::set_notes_root_override(None).unwrap();
    }
}
