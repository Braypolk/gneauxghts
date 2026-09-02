// Canonical ordinary-note mutation, observation, lifecycle, and role-limited
// history boundary. Storage and post-publication coordination remain private
// implementation details so callers depend only on the closed domain contract.
#![allow(dead_code)]

mod history_store;
mod post_publication;

use self::post_publication::{PublicationIssue, PublicationOutcome, PublicationStage};
use crate::{index::AppState, path_utils::collect_markdown_files_recursively};
use serde::Serialize;
use std::{
    collections::HashSet,
    fs,
    path::{Path, PathBuf},
    sync::atomic::{AtomicU64, Ordering},
};

pub(crate) const BACKGROUND_HISTORY_COMPACTION_BUDGET_BYTES: u64 = 256 * 1024;
static CURRENT_CONTENT_GENERATION: AtomicU64 = AtomicU64::new(0);

/// Snapshot token for a current-content read. A purge advances the shared
/// generation before removing rebuildable projections, so callers can avoid
/// publishing prose assembled concurrently with that removal.
pub(crate) struct CurrentContentRead {
    generation: u64,
}

impl CurrentContentRead {
    pub(crate) fn is_current(&self) -> bool {
        CURRENT_CONTENT_GENERATION.load(Ordering::Acquire) == self.generation
    }
}

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

    fn from_persisted(value: impl Into<String>) -> Self {
        Self(value.into())
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

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
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

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
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

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum BaselineInitializationPhase {
    NotStarted,
    Initializing,
    Complete,
    Degraded,
}

#[derive(Clone, Debug, PartialEq, Eq)]
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

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct DevelopmentHistoryReset {
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

#[derive(Clone, Debug, PartialEq, Eq)]
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

impl DevelopmentHistoryReset {
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

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct HistoryIntentIdentity(String);

impl HistoryIntentIdentity {
    fn from_persisted(value: String) -> Self {
        Self(value)
    }

    fn as_str(&self) -> &str {
        &self.0
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
        Self(value.to_string())
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct PreparedRevisionPublication {
    canonical_markdown: String,
    history_intent: HistoryIntentIdentity,
}

impl PreparedRevisionPublication {
    pub(crate) fn canonical_markdown(&self) -> &str {
        &self.canonical_markdown
    }

    pub(crate) fn into_parts(self) -> (String, HistoryIntentIdentity) {
        (self.canonical_markdown, self.history_intent)
    }

    #[cfg(test)]
    pub(crate) fn for_test(markdown: &str, history_intent: &str) -> Self {
        Self {
            canonical_markdown: markdown.to_string(),
            history_intent: HistoryIntentIdentity::for_test(history_intent),
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

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct NoteMutation {
    source: MutationSource,
    history_intent: HistoryIntentIdentity,
    path: PathBuf,
    previous_path: Option<PathBuf>,
    fallback_markdown: String,
}

impl NoteMutation {
    pub(crate) fn editor(
        history_intent: HistoryIntentIdentity,
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
        history_intent: HistoryIntentIdentity,
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
        history_intent: HistoryIntentIdentity,
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
        history_intent: HistoryIntentIdentity,
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
        history_intent: HistoryIntentIdentity,
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
        history_intent: HistoryIntentIdentity,
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
        history_intent: HistoryIntentIdentity,
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
        history_intent: HistoryIntentIdentity,
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
    note_ids: HashSet<NoteIdentity>,
}

impl AllowedScope {
    pub(crate) fn only(note_id: NoteIdentity) -> Self {
        Self {
            note_ids: HashSet::from([note_id]),
        }
    }

    fn allows(&self, note_id: &NoteIdentity) -> bool {
        self.note_ids.contains(note_id)
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

impl HistoryModeAccess<'_> {
    pub(crate) fn note_id(&self) -> &NoteIdentity {
        &self.note_id
    }

    pub(crate) fn revisions(&self) -> Result<Vec<NoteRevisionHeader>, String> {
        NoteTimeline::new(self.state).recover_retained_observations()?;
        self.state.ensure_note_timeline_history_recovered()?;
        history_store::revisions(&self.note_id)
    }

    pub(crate) fn lifecycle_events(&self) -> Result<Vec<LifecycleEventHeader>, String> {
        NoteTimeline::new(self.state).recover_retained_observations()?;
        self.state.ensure_note_timeline_history_recovered()?;
        history_store::lifecycle_events(&self.note_id)
    }

    pub(crate) fn reconstruct(
        &self,
        revision_id: &RevisionIdentity,
    ) -> Result<ReconstructedNoteRevision, String> {
        NoteTimeline::new(self.state).recover_retained_observations()?;
        self.state.ensure_note_timeline_history_recovered()?;
        history_store::reconstruct(&self.note_id, revision_id)
    }
}

pub(crate) struct CurrentContentAccess<'a> {
    _state: &'a AppState,
    scope: AllowedScope,
}

impl CurrentContentAccess<'_> {
    pub(crate) fn allows(&self, note_id: &NoteIdentity) -> bool {
        self.scope.allows(note_id)
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
}

pub(crate) struct NoteTimeline<'a> {
    state: &'a AppState,
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
    pub(crate) fn new(state: &'a AppState) -> Self {
        Self { state }
    }

    fn with_settled_history_mutation<T>(
        &self,
        operation: impl FnOnce() -> Result<T, String>,
    ) -> Result<T, String> {
        let _replay = self.state.lock_note_timeline_observation_replay()?;
        self.recover_pending_deletions()?;
        self.replay_retained_observations(None)?;
        self.state.ensure_note_timeline_history_recovered()?;
        operation()
    }

    /// Settle durable purge work created after startup, then capture the
    /// generation that current-content query results must still match.
    pub(crate) fn begin_current_content_read(&self) -> Result<CurrentContentRead, String> {
        let _replay = self.state.lock_note_timeline_observation_replay()?;
        self.recover_pending_deletions()?;
        Ok(CurrentContentRead {
            generation: CURRENT_CONTENT_GENERATION.load(Ordering::Acquire),
        })
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

    fn remove_purged_note_projections(
        &self,
        note_id: &NoteIdentity,
        path: &Path,
    ) -> Result<(), String> {
        CURRENT_CONTENT_GENERATION.fetch_add(1, Ordering::AcqRel);
        crate::commands::search_commands::invalidate_result_caches()?;
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
        let vault_root = require_active_vault_root(vault_root)?;
        self.recover_retained_observations()?;
        self.state.ensure_note_timeline_history_recovered()?;
        let mut progress = BaselineInitializationProgress {
            phase: BaselineInitializationPhase::Initializing,
            discovered_notes: 0,
            baseline_revisions: 0,
            ready_notes: 0,
            failed_notes: 0,
            last_error: None,
        };
        history_store::store_baseline_initialization_progress(&progress)?;
        for path in collect_markdown_files_recursively(&vault_root)? {
            let markdown = match fs::read_to_string(&path) {
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
            let Some(metadata) = parsed.frontmatter.managed else {
                continue;
            };
            if metadata.kind.is_chat_projection() {
                continue;
            }
            progress.discovered_notes += 1;
            let embedded_note_id =
                (!metadata.id.trim().is_empty()).then(|| NoteIdentity::new(metadata.id.clone()));
            let mut resolved_note_id = None;
            let initialized = (|| {
                let persisted_path_identity = history_store::note_identity_for_current_path(&path)?;
                let note_id = match persisted_path_identity {
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
                history_store::record_baseline_revision_if_absent(
                    &note_id,
                    &path,
                    &markdown,
                    known_since_millis,
                )?;
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
        history_store::baseline_initialization_progress()
    }

    pub(crate) fn note_baseline_initialization_state(
        &self,
        note_id: &NoteIdentity,
    ) -> Result<NoteBaselineInitializationState, String> {
        history_store::note_baseline_initialization_state(note_id)
    }

    pub(crate) fn reset_development_history(
        &self,
        vault_root: &Path,
    ) -> Result<DevelopmentHistoryReset, String> {
        let vault_root = require_active_vault_root(vault_root)?;
        crate::state::with_note_file_mutation(|| {
            let (previous_generation, generation, operation_id, reset_at_millis) = {
                let _timeline = self.state.lock_note_timeline_observation_replay()?;
                history_store::reset_development_store(&vault_root)?
            };
            let initialization = self.initialize_existing_notes(&vault_root)?;
            Ok(DevelopmentHistoryReset {
                operation_id,
                previous_generation,
                generation,
                reset_at_millis,
                initialization,
            })
        })
    }

    pub(crate) fn latest_development_history_reset(
        &self,
    ) -> Result<Option<DevelopmentHistoryReset>, String> {
        let Some((operation_id, previous_generation, generation, reset_at_millis)) =
            history_store::latest_development_history_reset()?
        else {
            return Ok(None);
        };
        Ok(Some(DevelopmentHistoryReset {
            operation_id,
            previous_generation,
            generation,
            reset_at_millis,
            initialization: history_store::baseline_initialization_progress()?,
        }))
    }

    pub(crate) fn clear_note_history(
        &self,
        note_id: &NoteIdentity,
    ) -> Result<HistoryDeletionReceipt, String> {
        crate::state::with_note_file_mutation(|| {
            self.with_settled_history_mutation(|| {
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
        self.recover_retained_observations()?;
        self.state.ensure_note_timeline_history_recovered()?;
        history_store::deletion_markers()
    }

    pub(crate) fn history_storage_usage(&self) -> Result<HistoryStorageUsage, String> {
        self.recover_retained_observations()?;
        self.state.ensure_note_timeline_history_recovered()?;
        history_store::storage_usage()
    }

    pub(crate) fn compact_history_storage(
        &self,
        maximum_reclaim_bytes: u64,
    ) -> Result<HistoryCompactionReceipt, String> {
        crate::state::with_note_file_mutation(|| {
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
        self.recover_retained_observations()?;
        self.state.ensure_note_timeline_history_recovered()?;
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
        let _replay = self.state.lock_note_timeline_observation_replay()?;
        self.recover_pending_deletions()?;
        let observation = Self::capture_observed_markdown(observation)?;
        if observation.kind == VaultObservationKind::ReconciliationScan {
            self.replay_retained_observations(None)?;
            return self.apply_observation(observation);
        }

        let requested_sequence = history_store::retain_observation(&observation)?;
        self.replay_retained_observations(Some(requested_sequence))?
            .ok_or_else(|| {
                format!("Retained Note Timeline observation {requested_sequence} was not replayed")
            })
    }

    fn recover_retained_observations(&self) -> Result<(), String> {
        let _replay = self.state.lock_note_timeline_observation_replay()?;
        self.recover_pending_deletions()?;
        self.replay_retained_observations(None).map(|_| ())
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
        } = observation;
        match kind {
            VaultObservationKind::ReconciliationScan => {
                self.state.ensure_note_timeline_history_recovered()?;
            }
            VaultObservationKind::Lifecycle(LifecycleEventKind::Missing) => {
                let _ = self.state.detach_indexed_note_identity(&path);
            }
            VaultObservationKind::CanonicalState => {
                let markdown = canonical_markdown.map(Ok).unwrap_or_else(|| {
                    fs::read_to_string(&path).map_err(|error| {
                        format!("Read observed canonical note {}: {error}", path.display())
                    })
                })?;
                self.state.ensure_note_timeline_history_recovered()?;
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
                let missing_path = self
                    .state
                    .prepare_safe_note_identity_reattachment(&path, note_id.as_str())?;
                if let Some(missing_path) = missing_path {
                    kind = VaultObservationKind::Lifecycle(LifecycleEventKind::Reattached);
                    previous_path = Some(missing_path);
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
                    self.state.ensure_note_timeline_history_recovered()?;
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
            _ => {}
        }
        Ok(ObservationReceipt {
            source,
            kind,
            path,
            previous_path,
            observed_at_millis,
            modified_at_millis,
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
        if kind == LifecycleEventKind::Purged {
            crate::state::with_note_file_mutation(|| {
                self.with_settled_history_mutation(|| {
                    self.purge_note_under_mutation_boundary(&note_id, &path, occurred_at_millis)
                })
            })?;
        }
        Ok(LifecycleReceipt {
            kind,
            note_id,
            path,
            previous_path,
            occurred_at_millis,
        })
    }

    pub(crate) fn history_mode(&self, grant: HistoryModeGrant) -> HistoryModeAccess<'a> {
        HistoryModeAccess {
            state: self.state,
            note_id: grant.note_id,
        }
    }

    pub(crate) fn current_content(&self, scope: AllowedScope) -> CurrentContentAccess<'a> {
        CurrentContentAccess {
            _state: self.state,
            scope,
        }
    }

    pub(crate) fn agent_restore(&self, grant: ExplicitRestoreGrant) -> AgentRestoreAccess<'a> {
        AgentRestoreAccess {
            _state: self.state,
            grant,
        }
    }
}

pub(crate) fn recover_pending_history(state: &AppState) -> Result<(), String> {
    history_store::recover_pending()?;
    NoteTimeline::new(state).recover_pending_deletions()
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
    let timeline = NoteTimeline::new(state);
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
pub(crate) fn inject_history_deletion_failure_once() {
    history_store::inject_fault_once(history_store::FaultPoint::Deletion);
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
        sync::{Arc, Barrier},
        thread,
    };

    fn prepare_test_history(
        source: MutationSource,
        path: &Path,
        markdown: &str,
    ) -> HistoryIntentIdentity {
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

    #[test]
    fn editor_mutation_assigns_its_closed_source() {
        let mutation = NoteMutation::editor(
            HistoryIntentIdentity::for_test("editor-intent"),
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
                HistoryIntentIdentity::for_test("task-intent"),
                path.clone(),
                None,
                markdown.clone(),
            ),
            NoteMutation::accepted_chat_proposal(
                HistoryIntentIdentity::for_test("proposal-intent"),
                path.clone(),
                None,
                markdown.clone(),
            ),
            NoteMutation::version_restore(
                HistoryIntentIdentity::for_test("restore-intent"),
                path.clone(),
                None,
                markdown.clone(),
            ),
            NoteMutation::note_creation(
                HistoryIntentIdentity::for_test("creation-intent"),
                path.clone(),
                None,
                markdown.clone(),
            ),
            NoteMutation::baseline_initialization(
                HistoryIntentIdentity::for_test("baseline-intent"),
                path.clone(),
                None,
                markdown.clone(),
            ),
            NoteMutation::recovery_reconciliation(
                HistoryIntentIdentity::for_test("recovery-intent"),
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

        let error = NoteTimeline::new(&state)
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

        let outcome = NoteTimeline::new(&state).mutate(NoteMutation::editor(
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
        let history = NoteTimeline::new(&restarted)
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
        let history =
            NoteTimeline::new(&state).history_mode(HistoryModeGrant::authorized(note_id.clone()));
        let removed_revision = history.revisions().unwrap()[0].identity().clone();
        let before_clear = crate::time::current_time_millis().unwrap();

        let receipt = NoteTimeline::new(&state)
            .clear_note_history(&note_id)
            .unwrap();
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
        let timeline = NoteTimeline::new(&restarted);
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

        let receipt = NoteTimeline::new(&state)
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
            let revisions = NoteTimeline::new(&state)
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
                    NoteTimeline::new(&state)
                        .history_mode(HistoryModeGrant::authorized(note_id.clone()))
                        .reconstruct(revisions[0].identity())
                        .unwrap()
                        .body(),
                    "Beta current without managed metadata"
                );
            }
        }
        let missing_revisions = NoteTimeline::new(&state)
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
        let history =
            NoteTimeline::new(&state).history_mode(HistoryModeGrant::authorized(note_id.clone()));
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

        NoteTimeline::new(&state)
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
        let timeline = NoteTimeline::new(&restarted);
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

        NoteTimeline::new(&restarted)
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

        let error = NoteTimeline::new(&state)
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
        let timeline = NoteTimeline::new(&state);
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
        let in_flight_read = NoteTimeline::new(&state)
            .begin_current_content_read()
            .unwrap();
        inject_purge_projection_cleanup_failure_once();

        let error = NoteTimeline::new(&state)
            .lifecycle(NoteLifecycleOperation::purged(
                note_id.clone(),
                path.clone(),
                700,
            ))
            .unwrap_err();

        assert!(error.contains("injected purge projection cleanup interruption"));
        assert!(!in_flight_read.is_current());
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
        let timeline = NoteTimeline::new(&state);
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

        let error = NoteTimeline::new(&state)
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
        let timeline = NoteTimeline::new(&restarted);
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

        let error = NoteTimeline::new(&state)
            .clear_note_history(&note_id)
            .unwrap_err();

        assert!(error.contains("injected history deletion interruption"));
        let history =
            NoteTimeline::new(&state).history_mode(HistoryModeGrant::authorized(note_id.clone()));
        assert_eq!(history.revisions().unwrap().len(), 2);
        assert!(NoteTimeline::new(&state)
            .deletion_markers()
            .unwrap()
            .is_empty());
        drop(state);
        let restarted = AppState::new(
            SemanticState::new_disabled("disabled"),
            EventBus::disabled(),
        )
        .unwrap();
        NoteTimeline::new(&restarted)
            .clear_note_history(&note_id)
            .unwrap();
        let history =
            NoteTimeline::new(&restarted).history_mode(HistoryModeGrant::authorized(note_id));
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
        let timeline = NoteTimeline::new(&state);
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

        let progress = NoteTimeline::new(&state)
            .initialize_existing_notes(notes.path())
            .unwrap();
        let after_known = crate::time::current_time_millis().unwrap();

        assert_eq!(progress.phase(), BaselineInitializationPhase::Complete);
        assert_eq!(progress.discovered_notes(), 1);
        assert_eq!(progress.baseline_revisions(), 1);
        assert_eq!(fs::read(&path).unwrap(), before_bytes);
        let history = NoteTimeline::new(&state).history_mode(HistoryModeGrant::authorized(
            NoteIdentity::new("existing-note"),
        ));
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

        let history = NoteTimeline::new(&state).history_mode(HistoryModeGrant::authorized(
            NoteIdentity::new("raced-note"),
        ));
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
        let timeline = NoteTimeline::new(&state);

        let start = Arc::new(Barrier::new(2));
        thread::scope(|scope| {
            let initialization_start = Arc::clone(&start);
            let state_ref = &state;
            let notes_path = notes.path();
            let initializer = scope.spawn(move || {
                initialization_start.wait();
                NoteTimeline::new(state_ref)
                    .initialize_existing_notes(notes_path)
                    .unwrap()
            });
            let observation_start = Arc::clone(&start);
            let observed_path = path.clone();
            let observed_markdown = markdown.to_string();
            let state_ref = &state;
            let observer = scope.spawn(move || {
                observation_start.wait();
                NoteTimeline::new(state_ref)
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
        let timeline = NoteTimeline::new(&state);
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
        let timeline = NoteTimeline::new(&state);
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
        let timeline = NoteTimeline::new(&restarted);
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

        let progress = NoteTimeline::new(&state)
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
        let revisions = NoteTimeline::new(&restarted)
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

        let progress = NoteTimeline::new(&state)
            .initialize_existing_notes(notes.path())
            .unwrap();

        assert_eq!(progress.phase(), BaselineInitializationPhase::Degraded);
        let failed_note_ids = history_store::baseline_failure_note_ids();
        assert_eq!(failed_note_ids.len(), 1);
        let resolved_note_id = &failed_note_ids[0];
        assert!(!resolved_note_id.trim().is_empty());
        assert!(matches!(
            NoteTimeline::new(&state)
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
        let degraded = NoteTimeline::new(&first_state)
            .initialize_existing_notes(notes.path())
            .unwrap();
        assert_eq!(degraded.phase(), BaselineInitializationPhase::Degraded);
        assert_eq!(degraded.failed_notes(), 1);
        assert!(degraded
            .last_error()
            .is_some_and(|error| error.contains("injected Baseline Revision failure")));
        assert_eq!(
            NoteTimeline::new(&first_state)
                .baseline_initialization_progress()
                .unwrap()
                .phase(),
            BaselineInitializationPhase::Degraded
        );
        assert!(matches!(
            NoteTimeline::new(&first_state)
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
        let progress = NoteTimeline::new(&restarted)
            .initialize_existing_notes(notes.path())
            .unwrap();
        assert_eq!(progress.phase(), BaselineInitializationPhase::Complete);
        assert_eq!(progress.discovered_notes(), 64);
        assert_eq!(progress.baseline_revisions(), 64);
        assert_eq!(progress.ready_notes(), 64);
        assert_eq!(progress.failed_notes(), 0);
        for index in 0..64 {
            let revisions = NoteTimeline::new(&restarted)
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
        NoteTimeline::new(&state)
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

        let error = NoteTimeline::new(&reopened)
            .baseline_initialization_progress()
            .expect_err("mismatched selected generation must not open silently");
        assert!(error.contains("generation mismatch"));
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
        let timeline = NoteTimeline::new(&state);
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
        let timeline = NoteTimeline::new(&state);
        timeline.initialize_existing_notes(active.path()).unwrap();

        assert!(timeline
            .initialize_existing_notes(other.path())
            .expect_err("initialization must use the active vault")
            .contains("vault root mismatch"));
        assert!(timeline
            .reset_development_history(other.path())
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
        let timeline = NoteTimeline::new(&state);
        timeline.initialize_existing_notes(notes.path()).unwrap();
        timeline.reset_development_history(notes.path()).unwrap();

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
        let timeline = NoteTimeline::new(&state);
        timeline.initialize_existing_notes(notes.path()).unwrap();
        let original_revision = timeline
            .history_mode(HistoryModeGrant::authorized(NoteIdentity::new(
                "reset-note",
            )))
            .revisions()
            .unwrap()[0]
            .identity()
            .clone();

        let reset = timeline.reset_development_history(notes.path()).unwrap();

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
        let durable_reset = NoteTimeline::new(&restarted)
            .latest_development_history_reset()
            .unwrap()
            .expect("reset diagnostic survives replacement and restart");
        assert_eq!(durable_reset.operation_id(), operation_id);
        assert_eq!(durable_reset.previous_generation(), 1);
        assert_eq!(durable_reset.generation(), 2);
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
        let timeline = NoteTimeline::new(&state);
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
        let timeline = NoteTimeline::new(&state);
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
        let timeline = NoteTimeline::new(&state);
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
        let timeline = NoteTimeline::new(&state);
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
        let timeline = NoteTimeline::new(&state);
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
        let history = NoteTimeline::new(&state).history_mode(HistoryModeGrant::authorized(
            NoteIdentity::new("missing-note"),
        ));
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
        let prepared = NoteTimeline::new(&state)
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
        let history =
            NoteTimeline::new(&restarted).history_mode(HistoryModeGrant::authorized(note_id));
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

        let history = NoteTimeline::new(&state).history_mode(HistoryModeGrant::authorized(note_id));
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
        let history =
            NoteTimeline::new(&restarted).history_mode(HistoryModeGrant::authorized(note_id));
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
        let timeline = NoteTimeline::new(&state);
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
        let history =
            NoteTimeline::new(&state).history_mode(HistoryModeGrant::authorized(note_id.clone()));
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
        let prepared = NoteTimeline::new(&state)
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
        let history =
            NoteTimeline::new(&restarted).history_mode(HistoryModeGrant::authorized(note_id));
        assert!(history.revisions().unwrap().is_empty());
        assert!(history.lifecycle_events().unwrap().is_empty());
        assert!(!path.exists());
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
        let prepared = NoteTimeline::new(&restarted)
            .prepare_revision_publication(MutationSource::NoteCreation, &path, None, None, "retry")
            .unwrap();
        let note_id = NoteIdentity::new(
            crate::note::parse_note(prepared.canonical_markdown())
                .frontmatter
                .managed
                .unwrap()
                .id,
        );
        let history =
            NoteTimeline::new(&restarted).history_mode(HistoryModeGrant::authorized(note_id));
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
        let timeline = NoteTimeline::new(&state);
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
        let history = NoteTimeline::new(&restarted)
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
        let timeline = NoteTimeline::new(&state);
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
        let timeline = NoteTimeline::new(&state);
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
        let timeline = NoteTimeline::new(&state);
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
        let timeline = NoteTimeline::new(&state);
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

        let _observation = NoteTimeline::new(&state).observe(VaultObservation::moved(
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
        let state = AppState::new(
            SemanticState::new_disabled("disabled"),
            EventBus::disabled(),
        )
        .expect("construct app state");
        let timeline = NoteTimeline::new(&state);
        let note_id = NoteIdentity::new("note-1");
        let revision_id = RevisionIdentity::from_persisted("revision-1");

        let history = timeline.history_mode(HistoryModeGrant::authorized(note_id.clone()));
        let current = timeline.current_content(AllowedScope::only(note_id.clone()));
        let restore = timeline.agent_restore(ExplicitRestoreGrant::new(
            TurnIdentity::new("turn-1"),
            note_id.clone(),
            revision_id.clone(),
        ));

        assert_eq!(history.note_id(), &note_id);
        assert!(current.allows(&note_id));
        assert_eq!(restore.note_id(), &note_id);
        assert_eq!(restore.revision_id(), &revision_id);
        assert_eq!(restore.turn_id(), &TurnIdentity::new("turn-1"));
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

        let timeline = NoteTimeline::new(&state);
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
        let timeline = NoteTimeline::new(&state);
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
        assert_eq!(history.revisions().unwrap().len(), 1);
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

        let timeline = NoteTimeline::new(&state);
        let history = timeline.history_mode(HistoryModeGrant::authorized(note_id));
        assert_eq!(history.revisions().unwrap().len(), 1);
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
        let timeline = NoteTimeline::new(&restarted);
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
        let timeline = NoteTimeline::new(&state);
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
        let timeline = NoteTimeline::new(&restarted);
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

        let receipt = NoteTimeline::new(&state)
            .observe(VaultObservation::external_edit(path.clone(), 42, Some(41)))
            .unwrap();

        assert_eq!(receipt.path(), path);
        assert_eq!(receipt.source(), VaultObservationSource::Watcher);
        assert_eq!(receipt.kind(), VaultObservationKind::CanonicalState);
        assert_eq!(receipt.observed_at_millis(), 42);
        assert_eq!(receipt.modified_at_millis(), Some(41));

        let renamed_path = notes.path().join("Renamed.md");
        fs::rename(&path, &renamed_path).unwrap();
        let renamed = NoteTimeline::new(&state)
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
        let timeline = NoteTimeline::new(&state);
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
    fn lifecycle_returns_the_typed_identity_and_paths() {
        let _guard = crate::test_support::lock_test_env();
        let app_data = crate::test_support::TestDir::new("timeline-lifecycle-app-data");
        crate::state::initialize_app_data_dir(app_data.path().to_path_buf()).unwrap();
        let state = AppState::new(
            SemanticState::new_disabled("disabled"),
            EventBus::disabled(),
        )
        .expect("construct app state");
        let note_id = NoteIdentity::new("note-1");

        let receipt = NoteTimeline::new(&state)
            .lifecycle(NoteLifecycleOperation::forgotten(
                note_id.clone(),
                PathBuf::from("/vault/Note.md"),
                PathBuf::from("/vault/.forgotten/Note.md"),
                42,
            ))
            .unwrap();

        assert_eq!(receipt.kind(), LifecycleEventKind::Forgotten);
        assert_eq!(receipt.note_id(), &note_id);
        assert_eq!(receipt.path(), Path::new("/vault/.forgotten/Note.md"));
        assert_eq!(receipt.previous_path(), Some(Path::new("/vault/Note.md")));
        assert_eq!(receipt.occurred_at_millis(), 42);
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
}
