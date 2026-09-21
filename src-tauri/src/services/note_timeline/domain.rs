use super::*;

#[cfg(test)]
pub(super) static AFTER_SAVE_PREFLIGHT: std::sync::Mutex<Option<Box<dyn FnOnce() + Send>>> =
    std::sync::Mutex::new(None);

#[cfg(test)]
pub(super) static AFTER_SAVE_RENAME: std::sync::Mutex<Option<Box<dyn FnOnce() + Send>>> =
    std::sync::Mutex::new(None);

pub(crate) const BACKGROUND_HISTORY_COMPACTION_BUDGET_BYTES: u64 = 256 * 1024;
pub(super) const RECOVERY_DAY_MILLIS: u64 = 24 * 60 * 60 * 1_000;

pub(crate) fn ensure_vault_scaffold(
    vault_root: &Path,
) -> Result<crate::state::VaultManifest, HistoryError> {
    Ok(crate::state::ensure_vault_scaffold_for_history(
        vault_root,
        history_store::HISTORY_FORMAT,
        history_store::INITIAL_HISTORY_GENERATION,
    )?)
}

macro_rules! identity_type {
    ($name:ident) => {
        #[derive(Clone, Debug, PartialEq, Eq, Hash)]
        pub(crate) struct $name(pub(super) String);
    };
}

identity_type!(NoteIdentity);
identity_type!(RevisionIdentity);
identity_type!(LifecycleEventIdentity);
identity_type!(DeletionOperationIdentity);

impl NoteIdentity {
    pub(crate) fn new(value: impl Into<String>) -> Self {
        Self(value.into())
    }

    pub(crate) fn as_str(&self) -> &str {
        &self.0
    }
}

impl RevisionIdentity {
    pub(super) fn issue() -> Self {
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
    pub(super) fn issue() -> Self {
        Self(crate::note::generate_unique_id())
    }

    pub(super) fn from_persisted(value: impl Into<String>) -> Self {
        Self(value.into())
    }
}

impl DeletionOperationIdentity {
    pub(super) fn issue() -> Self {
        Self(crate::note::generate_unique_id())
    }

    pub(super) fn from_persisted(value: impl Into<String>) -> Self {
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

#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize, Serialize)]
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
    pub(super) fn as_storage_value(self) -> &'static str {
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

    pub(super) fn from_storage_value(value: &str) -> Option<Self> {
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

impl MutationWarningStage {
    pub(super) fn is_required_consistency(self) -> bool {
        matches!(
            self,
            Self::CanonicalRead
                | Self::CatalogUpsert
                | Self::TaskProjectionUpsert
                | Self::CatalogRemove
                | Self::TaskProjectionRemove
                | Self::HistoryFinalization
        )
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct NoteTimelineIssue {
    pub(super) stage: MutationWarningStage,
    #[serde(serialize_with = "serialize_issue_recovery_message")]
    pub(super) message: String,
}

pub(super) fn serialize_issue_recovery_message<S>(
    _: &String,
    serializer: S,
) -> Result<S::Ok, S::Error>
where
    S: serde::Serializer,
{
    serializer.serialize_str("A post-commit update is awaiting automatic recovery.")
}

#[cfg(test)]
impl NoteTimelineIssue {
    pub(crate) fn stage(&self) -> MutationWarningStage {
        self.stage
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct NoteMutationWarning {
    #[serde(skip)]
    pub(super) payload_version: PayloadVersion,
    #[serde(serialize_with = "serialize_warning_recovery_message")]
    pub(super) message: String,
    pub(super) issues: Vec<NoteTimelineIssue>,
}

pub(super) fn serialize_warning_recovery_message<S>(
    _: &String,
    serializer: S,
) -> Result<S::Ok, S::Error>
where
    S: serde::Serializer,
{
    serializer.serialize_str(
        "The change was saved, but a follow-up update is awaiting automatic recovery.",
    )
}

impl NoteMutationWarning {
    #[cfg(test)]
    pub(crate) fn payload_version(&self) -> PayloadVersion {
        self.payload_version
    }

    #[cfg(test)]
    pub(crate) fn message(&self) -> &str {
        &self.message
    }

    #[cfg(test)]
    pub(crate) fn issues(&self) -> &[NoteTimelineIssue] {
        &self.issues
    }

    pub(crate) fn single(
        stage: MutationWarningStage,
        message: String,
        issue_message: String,
    ) -> Self {
        eprintln!("Note mutation warning at {stage:?}: {issue_message}");
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

pub(super) fn merge_note_mutation_warning(
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

pub(super) fn merge_optional_note_mutation_warning(
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
    pub(super) payload_version: PayloadVersion,
    pub(super) source: MutationSource,
    pub(super) note_id: NoteIdentity,
    pub(super) path: PathBuf,
    pub(super) canonical_markdown: String,
    pub(super) diagnostics: Vec<NoteTimelineIssue>,
    pub(super) warning: Option<NoteMutationWarning>,
}

impl NoteMutationResult {
    pub(super) fn from_publication(source: MutationSource, outcome: PublicationOutcome) -> Self {
        let warning = outcome.required_consistency_warning();
        Self {
            payload_version: PayloadVersion::V1,
            source,
            note_id: NoteIdentity::new(outcome.note_id),
            path: outcome.path,
            canonical_markdown: outcome.canonical_markdown,
            diagnostics: outcome.issues,
            warning,
        }
    }

    #[cfg(test)]
    pub(crate) fn payload_version(&self) -> PayloadVersion {
        self.payload_version
    }

    #[cfg(test)]
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

    #[cfg(test)]
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
    pub(super) identity: RevisionIdentity,
    pub(super) note_identity: NoteIdentity,
    pub(super) predecessor: Option<TimelineRecordIdentity>,
    pub(super) payload_version: PayloadVersion,
    pub(super) source: MutationSource,
    pub(super) time_evidence: RevisionTimeEvidence,
    pub(super) content_hash: String,
    pub(super) restored_from: Option<RevisionIdentity>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize, Serialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub(crate) enum RevisionTimeEvidence {
    EditingWindow {
        version: u64,
        first_wall_millis: u64,
        last_wall_millis: u64,
        min_wall_millis: u64,
        max_wall_millis: u64,
        clock_discontinuity: bool,
    },
    #[serde(rename = "knownSince")]
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

impl RevisionTimeEvidence {
    pub(super) fn occurred_at_millis(self) -> u64 {
        match self {
            Self::EditingWindow {
                last_wall_millis, ..
            } => last_wall_millis,
            Self::Baseline { known_since_millis } => known_since_millis,
            Self::Committed {
                committed_at_millis,
            } => committed_at_millis,
            Self::Observed {
                observed_at_millis, ..
            } => observed_at_millis,
        }
    }

    pub(super) fn window(self) -> Option<Self> {
        matches!(self, Self::EditingWindow { .. }).then_some(self)
    }

    pub(crate) fn bounds(self) -> (u64, u64) {
        match self {
            Self::EditingWindow {
                min_wall_millis,
                max_wall_millis,
                ..
            } => (min_wall_millis, max_wall_millis),
            _ => (self.occurred_at_millis(), self.occurred_at_millis()),
        }
    }

    pub(crate) fn uncertain(self) -> bool {
        matches!(
            self,
            Self::EditingWindow {
                clock_discontinuity: true,
                ..
            }
        )
    }

    pub(crate) fn overlaps(self, start: u64, end: u64) -> bool {
        if start >= end {
            return false;
        }
        match self {
            Self::EditingWindow {
                first_wall_millis,
                last_wall_millis,
                clock_discontinuity,
                ..
            } => clock_discontinuity || (last_wall_millis >= start && first_wall_millis < end),
            _ => self.occurred_at_millis() >= start && self.occurred_at_millis() < end,
        }
    }
}

impl NoteRevisionHeader {
    #[cfg(test)]
    pub(super) fn issue(
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
            restored_from: None,
        }
    }

    #[cfg(test)]
    pub(crate) fn predecessor(&self) -> Option<&TimelineRecordIdentity> {
        self.predecessor.as_ref()
    }

    pub(crate) fn identity(&self) -> &RevisionIdentity {
        &self.identity
    }

    #[cfg(test)]
    pub(crate) fn source(&self) -> MutationSource {
        self.source
    }

    #[cfg(test)]
    pub(crate) fn content_hash(&self) -> &str {
        &self.content_hash
    }

    #[cfg(test)]
    pub(crate) fn time_evidence(&self) -> RevisionTimeEvidence {
        self.time_evidence
    }

    #[cfg(test)]
    pub(crate) fn committed_at_millis(&self) -> Option<u64> {
        match self.time_evidence {
            RevisionTimeEvidence::Committed {
                committed_at_millis,
            } => Some(committed_at_millis),
            RevisionTimeEvidence::Baseline { .. }
            | RevisionTimeEvidence::Observed { .. }
            | RevisionTimeEvidence::EditingWindow { .. } => None,
        }
    }

    #[cfg(test)]
    pub(crate) fn observed_at_millis(&self) -> Option<u64> {
        match self.time_evidence {
            RevisionTimeEvidence::Observed {
                observed_at_millis, ..
            } => Some(observed_at_millis),
            RevisionTimeEvidence::Baseline { .. }
            | RevisionTimeEvidence::Committed { .. }
            | RevisionTimeEvidence::EditingWindow { .. } => None,
        }
    }

    #[cfg(test)]
    pub(crate) fn known_since_millis(&self) -> Option<u64> {
        match self.time_evidence {
            RevisionTimeEvidence::Baseline { known_since_millis } => Some(known_since_millis),
            RevisionTimeEvidence::Committed { .. }
            | RevisionTimeEvidence::Observed { .. }
            | RevisionTimeEvidence::EditingWindow { .. } => None,
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
    pub(super) phase: BaselineInitializationPhase,
    pub(super) discovered_notes: u64,
    pub(super) baseline_revisions: u64,
    pub(super) ready_notes: u64,
    pub(super) failed_notes: u64,
    #[serde(
        skip_serializing_if = "Option::is_none",
        serialize_with = "serialize_initialization_error"
    )]
    pub(super) last_error: Option<String>,
}

pub(super) fn serialize_initialization_error<S>(
    error: &Option<String>,
    serializer: S,
) -> Result<S::Ok, S::Error>
where
    S: serde::Serializer,
{
    error
        .as_ref()
        .map(|_| "Some notes could not be initialized. Retry history recovery.")
        .serialize(serializer)
}

impl BaselineInitializationProgress {
    pub(crate) fn phase(&self) -> BaselineInitializationPhase {
        self.phase
    }

    #[cfg(test)]
    pub(crate) fn discovered_notes(&self) -> u64 {
        self.discovered_notes
    }

    #[cfg(test)]
    pub(crate) fn baseline_revisions(&self) -> u64 {
        self.baseline_revisions
    }

    #[cfg(test)]
    pub(crate) fn ready_notes(&self) -> u64 {
        self.ready_notes
    }

    #[cfg(test)]
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
    pub(super) operation_id: String,
    pub(super) previous_generation: u64,
    pub(super) generation: u64,
    pub(super) reset_at_millis: u64,
    pub(super) initialization: BaselineInitializationProgress,
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
    pub(super) fn as_storage_value(self) -> &'static str {
        match self {
            Self::Clear => "clear",
            Self::Purge => "purge",
        }
    }

    pub(super) fn from_storage_value(value: &str) -> Option<Self> {
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
    pub(super) fn storage_parts(&self) -> (&'static str, &str) {
        match self {
            Self::Note(note_id) => ("note", note_id.as_str()),
            Self::Vault(vault_id) => ("vault", vault_id),
        }
    }

    pub(super) fn from_storage_parts(kind: &str, identity: String) -> Result<Self, HistoryError> {
        match kind {
            "note" => Ok(Self::Note(NoteIdentity::new(identity))),
            "vault" => Ok(Self::Vault(identity)),
            _ => Err(HistoryError::Corrupt(format!(
                "Unknown deletion marker scope `{kind}`"
            ))),
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct DeletionMarker {
    pub(super) payload_version: PayloadVersion,
    pub(super) operation_id: DeletionOperationIdentity,
    pub(super) scope: DeletionScope,
    pub(super) kind: HistoryDeletionKind,
    pub(super) occurred_at_millis: u64,
    pub(super) history_generation: u64,
}

impl DeletionMarker {
    pub(super) fn issue(
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

    #[cfg(test)]
    pub(crate) fn payload_version(&self) -> PayloadVersion {
        self.payload_version
    }

    pub(crate) fn operation_id(&self) -> &DeletionOperationIdentity {
        &self.operation_id
    }

    #[cfg(test)]
    pub(crate) fn scope(&self) -> &DeletionScope {
        &self.scope
    }

    #[cfg(test)]
    pub(crate) fn kind(&self) -> HistoryDeletionKind {
        self.kind
    }

    #[cfg(test)]
    pub(crate) fn occurred_at_millis(&self) -> u64 {
        self.occurred_at_millis
    }

    #[cfg(test)]
    pub(crate) fn history_generation(&self) -> u64 {
        self.history_generation
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct HistoryDeletionReceipt {
    pub(super) marker: DeletionMarker,
    pub(super) baseline_note_ids: Vec<NoteIdentity>,
}

#[derive(Clone, Debug)]
pub(super) struct HistoryClearBaseline {
    pub(super) note_id: NoteIdentity,
    pub(super) path: PathBuf,
    pub(super) canonical_markdown: String,
}

#[derive(Clone, Debug)]
pub(super) enum ExistingBaselineCandidate {
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
pub(super) enum BaselineInitializationHistory {
    SettleExistingStore,
    RebuildReplacementStore,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum ResetHistorySource {
    RequireReadableStore,
    PreserveWhenReadable,
}

impl ExistingBaselineCandidate {
    pub(super) fn path(&self) -> &Path {
        match self {
            Self::Active { path } | Self::Forgotten { path, .. } => path,
            Self::Missing { record, .. } => record.path(),
        }
    }

    pub(super) fn canonical_markdown(&self) -> Option<&str> {
        match self {
            Self::Missing {
                canonical_markdown, ..
            } => Some(canonical_markdown),
            Self::Active { .. } | Self::Forgotten { .. } => None,
        }
    }

    pub(super) fn retained_note_id(&self) -> Option<NoteIdentity> {
        match self {
            Self::Active { .. } => None,
            Self::Forgotten { note_id, .. } => note_id.clone(),
            Self::Missing { record, .. } => Some(record.note_id().clone()),
        }
    }

    pub(super) fn is_inactive(&self) -> bool {
        !matches!(self, Self::Active { .. })
    }

    pub(super) fn record_inactive_lifecycle(
        &self,
        store: &history_store::Store,
        note_id: &NoteIdentity,
    ) -> Result<(), HistoryError> {
        match self {
            Self::Active { .. } => Ok(()),
            Self::Forgotten {
                path,
                original_path,
                forgotten_at_millis,
                ..
            } => history_store::record_observed_lifecycle_event(
                store,
                note_id,
                LifecycleEventKind::Forgotten,
                Some(original_path),
                path,
                *forgotten_at_millis,
            ),
            Self::Missing { record, .. } => {
                history_store::record_observed_missing_lifecycle_event(store, record)
            }
        }
    }
}

#[cfg(test)]
impl HistoryDeletionReceipt {
    pub(crate) fn baseline_note_ids(&self) -> &[NoteIdentity] {
        &self.baseline_note_ids
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct HistoryStorageUsage {
    pub(super) allocated_bytes: u64,
    pub(super) reclaimable_bytes: u64,
}

#[cfg(test)]
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
    pub(super) note_id: String,
    pub(super) state: NoteHistoryHealthState,
    pub(super) revision_count: u64,
    pub(super) lifecycle_event_count: u64,
    pub(super) revision_payload_bytes: u64,
}

#[cfg(test)]
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
    pub(super) state: HistoryHealthState,
    pub(super) integrity: HistoryIntegrityState,
    pub(super) initialization: BaselineInitializationProgress,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(super) storage: Option<HistoryStorageUsage>,
    pub(super) pending_repairs: u64,
    pub(super) can_retry: bool,
    pub(super) can_reset: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(super) last_reset: Option<HistoryResetReceipt>,
}

impl HistoryHealthReport {
    pub(crate) fn state(&self) -> HistoryHealthState {
        self.state
    }

    #[cfg(test)]
    pub(crate) fn integrity(&self) -> HistoryIntegrityState {
        self.integrity
    }

    #[cfg(test)]
    pub(crate) fn initialization(&self) -> &BaselineInitializationProgress {
        &self.initialization
    }

    #[cfg(test)]
    pub(crate) fn storage(&self) -> Option<&HistoryStorageUsage> {
        self.storage.as_ref()
    }

    #[cfg(test)]
    pub(crate) fn can_retry(&self) -> bool {
        self.can_retry
    }

    #[cfg(test)]
    pub(crate) fn can_reset(&self) -> bool {
        self.can_reset
    }

    #[cfg(test)]
    pub(crate) fn last_reset(&self) -> Option<&HistoryResetReceipt> {
        self.last_reset.as_ref()
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct HistoryCompactionReceipt {
    pub(super) before: HistoryStorageUsage,
    pub(super) after: HistoryStorageUsage,
}

#[cfg(test)]
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

#[cfg(test)]
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
    pub(super) identity: LifecycleEventIdentity,
    pub(super) note_identity: NoteIdentity,
    pub(super) predecessor: Option<TimelineRecordIdentity>,
    pub(super) payload_version: PayloadVersion,
    pub(super) kind: LifecycleEventKind,
    pub(super) occurred_at_millis: u64,
    pub(super) previous_path: Option<PathBuf>,
    pub(super) path: Option<PathBuf>,
}

impl LifecycleEventHeader {
    #[cfg(test)]
    pub(super) fn issue(
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

    #[cfg(test)]
    pub(crate) fn payload_version(&self) -> PayloadVersion {
        self.payload_version
    }

    #[cfg(test)]
    pub(crate) fn kind(&self) -> LifecycleEventKind {
        self.kind
    }

    #[cfg(test)]
    pub(crate) fn identity(&self) -> &LifecycleEventIdentity {
        &self.identity
    }

    #[cfg(test)]
    pub(crate) fn occurred_at_millis(&self) -> u64 {
        self.occurred_at_millis
    }

    #[cfg(test)]
    pub(crate) fn previous_path(&self) -> Option<&Path> {
        self.previous_path.as_deref()
    }

    #[cfg(test)]
    pub(crate) fn path(&self) -> Option<&Path> {
        self.path.as_deref()
    }
}

impl LifecycleEventKind {
    pub(super) fn as_storage_value(self) -> &'static str {
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

    pub(super) fn from_storage_value(value: &str) -> Option<Self> {
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

// Prepared mutations and lifecycle observations.

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct ReconstructedNoteRevision {
    pub(super) unmanaged_frontmatter: Option<String>,
    pub(super) body: String,
}

pub(crate) struct PreparedHistoryIntent {
    pub(super) value: String,
    pub(super) store: Option<history_store::Store>,
    pub(super) prepared_base: Option<history_store::PreparedRevisionBase>,
    pub(super) operation: Option<OperationGuard>,
    pub(super) current_content_mutation: Option<CurrentContentMutationGuard>,
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
    pub(super) fn from_persisted(value: String) -> Self {
        Self {
            value,
            store: None,
            operation: None,
            prepared_base: None,
            current_content_mutation: None,
        }
    }

    pub(super) fn as_str(&self) -> &str {
        &self.value
    }

    pub(super) fn with_runtime_leases(
        mut self,
        operation: OperationGuard,
        current_content_mutation: CurrentContentMutationGuard,
    ) -> Self {
        self.operation = Some(operation);
        self.current_content_mutation = Some(current_content_mutation);
        self
    }

    pub(crate) fn abandon(self) -> Result<(), HistoryError> {
        let store = self
            .store
            .as_ref()
            .ok_or("Prepared history intent has no store context")?;
        history_store::abandon_publication(store, &self)?;
        history_store::release_publication_receipt(store, &self)
    }

    pub(crate) fn abandon_after_publication_failure(self, publication_error: String) -> String {
        self.abandon_after_history_failure(publication_error.into())
            .to_string()
    }

    pub(super) fn abandon_after_history_failure(
        self,
        publication_error: HistoryError,
    ) -> HistoryError {
        match self.abandon() {
            Ok(()) => publication_error,
            Err(abandon_error) => {
                let context = format!("{publication_error}; additionally failed to abandon its prepared Note Revision");
                if matches!(abandon_error, HistoryError::Corrupt(_)) {
                    abandon_error.with_context(context)
                } else {
                    publication_error.with_context(format!(
                        "Failed to abandon prepared Note Revision: {abandon_error}"
                    ))
                }
            }
        }
    }

    #[cfg(test)]
    pub(crate) fn for_test(value: &str) -> Self {
        Self {
            value: value.to_string(),
            store: None,
            operation: None,
            prepared_base: None,
            current_content_mutation: None,
        }
    }
}

#[derive(Debug)]
pub(crate) struct PreparedRevisionPublication {
    pub(super) canonical_markdown: String,
    pub(super) history_intent: PreparedHistoryIntent,
}

impl PreparedRevisionPublication {
    pub(crate) fn canonical_markdown(&self) -> &str {
        &self.canonical_markdown
    }

    pub(crate) fn into_parts(self) -> (String, PreparedHistoryIntent) {
        (self.canonical_markdown, self.history_intent)
    }

    pub(super) fn with_runtime_leases(
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
    pub(super) source: MutationSource,
    pub(super) history_intent: PreparedHistoryIntent,
    pub(super) path: PathBuf,
    pub(super) previous_path: Option<PathBuf>,
    pub(super) fallback_markdown: String,
}

impl NoteMutation {
    #[cfg(test)]
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

    #[cfg(test)]
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

    #[cfg(test)]
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

    #[cfg(test)]
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

    pub(super) fn with_source(
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

    #[cfg(test)]
    pub(crate) fn source(&self) -> MutationSource {
        self.source
    }

    #[cfg(test)]
    pub(crate) fn path(&self) -> &Path {
        &self.path
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct VaultObservation {
    pub(super) source: VaultObservationSource,
    pub(super) kind: VaultObservationKind,
    pub(super) path: PathBuf,
    pub(super) previous_path: Option<PathBuf>,
    pub(super) observed_at_millis: u64,
    pub(super) modified_at_millis: Option<u64>,
    pub(super) canonical_markdown: Option<String>,
    pub(super) missing_retention_days: Option<u32>,
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

    pub(super) fn canonical_state(
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

    pub(super) fn lifecycle(
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

    #[cfg(test)]
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
    pub(super) kind: LifecycleEventKind,
    pub(super) note_id: NoteIdentity,
    pub(super) path: PathBuf,
    pub(super) previous_path: Option<PathBuf>,
    pub(super) occurred_at_millis: u64,
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

    pub(super) fn new(
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
    pub(super) kind: LifecycleEventKind,
    pub(super) note_id: NoteIdentity,
    pub(super) path: PathBuf,
    pub(super) previous_path: Option<PathBuf>,
    pub(super) occurred_at_millis: u64,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct MissingNoteRecord {
    pub(super) note_id: NoteIdentity,
    pub(super) path: PathBuf,
    pub(super) title: String,
    pub(super) missing_at_millis: u64,
    pub(super) retention_days: u32,
    pub(super) purge_at_millis: u64,
}

impl MissingNoteRecord {
    pub(super) fn captured(
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
    pub(super) receipt: LifecycleReceipt,
    pub(super) commit_warning: Option<NoteMutationWarning>,
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
    #[cfg(test)]
    pub(crate) fn kind(&self) -> LifecycleEventKind {
        self.kind
    }

    pub(crate) fn path(&self) -> &Path {
        &self.path
    }

    #[cfg(test)]
    pub(crate) fn previous_path(&self) -> Option<&Path> {
        self.previous_path.as_deref()
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct AllowedScope {
    pub(super) note_ids: Option<HashSet<NoteIdentity>>,
    pub(super) excluded_note_ids: HashSet<NoteIdentity>,
}

// Role-limited history projection and reconstruction.

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

    pub(super) fn allows(&self, note_id: &NoteIdentity) -> bool {
        !self.excluded_note_ids.contains(note_id)
            && self
                .note_ids
                .as_ref()
                .is_none_or(|note_ids| note_ids.contains(note_id))
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct HistoryModeGrant {
    pub(super) note_id: NoteIdentity,
}

impl HistoryModeGrant {
    pub(super) fn authorized(note_id: NoteIdentity) -> Self {
        Self { note_id }
    }
}

pub(crate) struct HistoryModeAccess<'a> {
    pub(super) state: &'a AppState,
    pub(super) note_id: NoteIdentity,
}

/// Readiness is an observation, never a transferable write permit.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum HistoryReadinessState {
    RecoveryPending,
    TargetVerificationPending,
    Ready,
    Unavailable,
    Corrupt,
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct HistoryReadiness {
    pub(crate) scope: String,
    pub(crate) revision: u64,
    pub(crate) note_id: Option<String>,
    pub(crate) state: HistoryReadinessState,
    pub(crate) verified_notes: usize,
    pub(crate) total_notes: Option<usize>,
    pub(crate) background_complete: bool,
    pub(crate) background_unavailable: bool,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) enum HistoryError {
    AlreadyCurrent(String),
    Unavailable(String),
    Corrupt(String),
    Stale(String),
    Ineligible(String),
    Missing(String),
}

impl std::fmt::Display for HistoryError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let cause = match self {
            Self::AlreadyCurrent(cause)
            | Self::Unavailable(cause)
            | Self::Corrupt(cause)
            | Self::Stale(cause)
            | Self::Ineligible(cause)
            | Self::Missing(cause) => cause,
        };
        formatter.write_str(cause)
    }
}

impl std::error::Error for HistoryError {}

impl HistoryError {
    pub(super) fn with_context(mut self, context: impl std::fmt::Display) -> Self {
        let cause = match &mut self {
            Self::AlreadyCurrent(cause)
            | Self::Unavailable(cause)
            | Self::Corrupt(cause)
            | Self::Stale(cause)
            | Self::Ineligible(cause)
            | Self::Missing(cause) => cause,
        };
        *cause = format!("{context}: {cause}");
        self
    }
}

impl From<std::io::Error> for HistoryError {
    fn from(error: std::io::Error) -> Self {
        Self::Unavailable(error.to_string())
    }
}

// Classification is supplied by the boundary that detected the failure. Translation
// must never open the store or run an integrity/health scan.
pub(super) fn history_failure(cause: impl Into<HistoryError>) -> HistoryError {
    cause.into()
}

impl From<String> for HistoryError {
    fn from(cause: String) -> Self {
        Self::Unavailable(cause)
    }
}

impl From<&str> for HistoryError {
    fn from(cause: &str) -> Self {
        Self::Unavailable(cause.to_owned())
    }
}

impl From<HistoryError> for String {
    fn from(error: HistoryError) -> Self {
        error.to_string()
    }
}
