// This module is the expand side of an expand–migrate–contract change. Tickets
// 03 and 04 move production callers onto these entrypoints; keeping the
// complete closed contract together here prevents temporary caller-specific
// seams while later tickets deepen persistence and reads.
#![allow(dead_code)]

use crate::{
    index::AppState,
    services::note_mutation::{
        PostCommitIssue, PostCommitNoteMutationOutcome, PostCommitNoteMutationService,
        PostCommitStage,
    },
};
use serde::Serialize;
use std::{
    collections::HashSet,
    path::{Path, PathBuf},
};

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
    fn from_persisted(value: impl Into<String>) -> Self {
        Self(value.into())
    }
}

impl LifecycleEventIdentity {
    fn from_persisted(value: impl Into<String>) -> Self {
        Self(value.into())
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
    Revision,
}

impl From<PostCommitStage> for MutationWarningStage {
    fn from(stage: PostCommitStage) -> Self {
        match stage {
            PostCommitStage::CanonicalRead => Self::CanonicalRead,
            PostCommitStage::CatalogUpsert => Self::CatalogUpsert,
            PostCommitStage::TaskProjectionUpsert => Self::TaskProjectionUpsert,
            PostCommitStage::CatalogRemove => Self::CatalogRemove,
            PostCommitStage::TaskProjectionRemove => Self::TaskProjectionRemove,
            PostCommitStage::SemanticUpdate => Self::SemanticUpdate,
            PostCommitStage::SemanticMove => Self::SemanticMove,
            PostCommitStage::DirtyRecovery => Self::DirtyRecovery,
            PostCommitStage::Revision => Self::Revision,
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

impl From<PostCommitIssue> for NoteTimelineIssue {
    fn from(issue: PostCommitIssue) -> Self {
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
    fn from_post_commit(source: MutationSource, outcome: PostCommitNoteMutationOutcome) -> Self {
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
}

impl NoteRevisionHeader {
    pub(crate) fn new(
        identity: RevisionIdentity,
        note_identity: NoteIdentity,
        predecessor: Option<TimelineRecordIdentity>,
        payload_version: PayloadVersion,
        source: MutationSource,
    ) -> Self {
        Self {
            identity,
            note_identity,
            predecessor,
            payload_version,
            source,
        }
    }

    pub(crate) fn predecessor(&self) -> Option<&TimelineRecordIdentity> {
        self.predecessor.as_ref()
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct LifecycleEventHeader {
    identity: LifecycleEventIdentity,
    note_identity: NoteIdentity,
    predecessor: Option<TimelineRecordIdentity>,
    payload_version: PayloadVersion,
    kind: LifecycleEventKind,
}

impl LifecycleEventHeader {
    pub(crate) fn new(
        identity: LifecycleEventIdentity,
        note_identity: NoteIdentity,
        predecessor: Option<TimelineRecordIdentity>,
        payload_version: PayloadVersion,
        kind: LifecycleEventKind,
    ) -> Self {
        Self {
            identity,
            note_identity,
            predecessor,
            payload_version,
            kind,
        }
    }

    pub(crate) fn payload_version(&self) -> PayloadVersion {
        self.payload_version
    }

    pub(crate) fn kind(&self) -> LifecycleEventKind {
        self.kind
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct NoteMutation {
    source: MutationSource,
    path: PathBuf,
    previous_path: Option<PathBuf>,
    fallback_markdown: String,
}

impl NoteMutation {
    pub(crate) fn editor(
        path: PathBuf,
        previous_path: Option<PathBuf>,
        fallback_markdown: String,
    ) -> Self {
        Self::with_source(
            MutationSource::Editor,
            path,
            previous_path,
            fallback_markdown,
        )
    }

    pub(crate) fn task_action(
        path: PathBuf,
        previous_path: Option<PathBuf>,
        fallback_markdown: String,
    ) -> Self {
        Self::with_source(
            MutationSource::TaskAction,
            path,
            previous_path,
            fallback_markdown,
        )
    }

    pub(crate) fn accepted_chat_proposal(
        path: PathBuf,
        previous_path: Option<PathBuf>,
        fallback_markdown: String,
    ) -> Self {
        Self::with_source(
            MutationSource::AcceptedChatProposal,
            path,
            previous_path,
            fallback_markdown,
        )
    }

    pub(crate) fn version_restore(
        path: PathBuf,
        previous_path: Option<PathBuf>,
        fallback_markdown: String,
    ) -> Self {
        Self::with_source(
            MutationSource::VersionRestore,
            path,
            previous_path,
            fallback_markdown,
        )
    }

    pub(crate) fn note_creation(
        path: PathBuf,
        previous_path: Option<PathBuf>,
        fallback_markdown: String,
    ) -> Self {
        Self::with_source(
            MutationSource::NoteCreation,
            path,
            previous_path,
            fallback_markdown,
        )
    }

    pub(crate) fn baseline_initialization(
        path: PathBuf,
        previous_path: Option<PathBuf>,
        fallback_markdown: String,
    ) -> Self {
        Self::with_source(
            MutationSource::BaselineInitialization,
            path,
            previous_path,
            fallback_markdown,
        )
    }

    pub(crate) fn recovery_reconciliation(
        path: PathBuf,
        previous_path: Option<PathBuf>,
        fallback_markdown: String,
    ) -> Self {
        Self::with_source(
            MutationSource::RecoveryReconciliation,
            path,
            previous_path,
            fallback_markdown,
        )
    }

    fn with_source(
        source: MutationSource,
        path: PathBuf,
        previous_path: Option<PathBuf>,
        fallback_markdown: String,
    ) -> Self {
        Self {
            source,
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
        }
    }

    pub(crate) fn renamed(
        previous_path: impl Into<PathBuf>,
        path: impl Into<PathBuf>,
        observed_at_millis: u64,
    ) -> Self {
        Self::lifecycle(
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
            LifecycleEventKind::Moved,
            path.into(),
            Some(previous_path.into()),
            observed_at_millis,
        )
    }

    pub(crate) fn missing(path: impl Into<PathBuf>, observed_at_millis: u64) -> Self {
        Self::lifecycle(
            LifecycleEventKind::Missing,
            path.into(),
            None,
            observed_at_millis,
        )
    }

    pub(crate) fn reattached(path: impl Into<PathBuf>, observed_at_millis: u64) -> Self {
        Self::lifecycle(
            LifecycleEventKind::Reattached,
            path.into(),
            None,
            observed_at_millis,
        )
    }

    fn lifecycle(
        kind: LifecycleEventKind,
        path: PathBuf,
        previous_path: Option<PathBuf>,
        observed_at_millis: u64,
    ) -> Self {
        Self {
            source: VaultObservationSource::Watcher,
            kind: VaultObservationKind::Lifecycle(kind),
            path,
            previous_path,
            observed_at_millis,
            modified_at_millis: None,
        }
    }

    pub(crate) fn source(&self) -> VaultObservationSource {
        self.source
    }

    pub(crate) fn kind(&self) -> VaultObservationKind {
        self.kind
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
    _state: &'a AppState,
    note_id: NoteIdentity,
}

impl HistoryModeAccess<'_> {
    pub(crate) fn note_id(&self) -> &NoteIdentity {
        &self.note_id
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

impl<'a> NoteTimeline<'a> {
    pub(crate) fn new(state: &'a AppState) -> Self {
        Self { state }
    }

    pub(crate) fn mutate(&self, mutation: NoteMutation) -> NoteMutationResult {
        let NoteMutation {
            source,
            path,
            previous_path,
            fallback_markdown,
        } = mutation;
        NoteMutationResult::from_post_commit(
            source,
            PostCommitNoteMutationService::new(self.state).apply_canonical_file(
                path,
                previous_path,
                fallback_markdown,
            ),
        )
    }

    pub(crate) fn observe(&self, observation: VaultObservation) -> ObservationReceipt {
        let VaultObservation {
            source,
            kind,
            path,
            previous_path,
            observed_at_millis,
            modified_at_millis,
        } = observation;
        ObservationReceipt {
            source,
            kind,
            path,
            previous_path,
            observed_at_millis,
            modified_at_millis,
        }
    }

    pub(crate) fn lifecycle(&self, operation: NoteLifecycleOperation) -> LifecycleReceipt {
        let NoteLifecycleOperation {
            kind,
            note_id,
            path,
            previous_path,
            occurred_at_millis,
        } = operation;
        LifecycleReceipt {
            kind,
            note_id,
            path,
            previous_path,
            occurred_at_millis,
        }
    }

    pub(crate) fn history_mode(&self, grant: HistoryModeGrant) -> HistoryModeAccess<'a> {
        HistoryModeAccess {
            _state: self.state,
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{app::EventBus, index::AppState, semantic::SemanticState};
    use std::{fs, path::PathBuf};

    #[test]
    fn editor_mutation_assigns_its_closed_source() {
        let mutation = NoteMutation::editor(
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
            NoteMutation::task_action(path.clone(), None, markdown.clone()),
            NoteMutation::accepted_chat_proposal(path.clone(), None, markdown.clone()),
            NoteMutation::version_restore(path.clone(), None, markdown.clone()),
            NoteMutation::note_creation(path.clone(), None, markdown.clone()),
            NoteMutation::baseline_initialization(path.clone(), None, markdown.clone()),
            NoteMutation::recovery_reconciliation(path.clone(), None, markdown.clone()),
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
            VaultObservation::reattached("/vault/Folder/New.md", 46),
        ];
        assert_eq!(
            lifecycle.map(|observation| observation.kind()),
            [
                VaultObservationKind::Lifecycle(LifecycleEventKind::Renamed),
                VaultObservationKind::Lifecycle(LifecycleEventKind::Moved),
                VaultObservationKind::Lifecycle(LifecycleEventKind::Missing),
                VaultObservationKind::Lifecycle(LifecycleEventKind::Reattached),
            ]
        );
    }

    #[test]
    fn mutate_preserves_the_authoritative_post_commit_outcome() {
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

        let outcome = NoteTimeline::new(&state).mutate(NoteMutation::editor(
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
    fn observe_returns_a_typed_receipt_without_claiming_unseen_history() {
        let _guard = crate::test_support::lock_test_env();
        let app_data = crate::test_support::TestDir::new("timeline-observe-app-data");
        crate::state::initialize_app_data_dir(app_data.path().to_path_buf()).unwrap();
        let state = AppState::new(
            SemanticState::new_disabled("disabled"),
            EventBus::disabled(),
        )
        .expect("construct app state");
        let path = PathBuf::from("/vault/Observed.md");

        let receipt = NoteTimeline::new(&state).observe(VaultObservation::external_edit(
            path.clone(),
            42,
            Some(41),
        ));

        assert_eq!(receipt.path(), path);
        assert_eq!(receipt.source(), VaultObservationSource::Watcher);
        assert_eq!(receipt.kind(), VaultObservationKind::CanonicalState);
        assert_eq!(receipt.observed_at_millis(), 42);
        assert_eq!(receipt.modified_at_millis(), Some(41));

        let renamed = NoteTimeline::new(&state).observe(VaultObservation::renamed(
            "/vault/Observed.md",
            "/vault/Renamed.md",
            43,
        ));
        assert_eq!(
            renamed.kind(),
            VaultObservationKind::Lifecycle(LifecycleEventKind::Renamed)
        );
        assert_eq!(
            renamed.previous_path(),
            Some(Path::new("/vault/Observed.md"))
        );
        assert_eq!(renamed.path(), Path::new("/vault/Renamed.md"));
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

        let receipt = NoteTimeline::new(&state).lifecycle(NoteLifecycleOperation::forgotten(
            note_id.clone(),
            PathBuf::from("/vault/Note.md"),
            PathBuf::from("/vault/.forgotten/Note.md"),
            42,
        ));

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
        let first_id = RevisionIdentity::from_persisted("revision-1");
        let first = NoteRevisionHeader::new(
            first_id.clone(),
            note_id.clone(),
            None,
            PayloadVersion::V1,
            MutationSource::Editor,
        );
        let event_id = LifecycleEventIdentity::from_persisted("event-1");
        let renamed = LifecycleEventHeader::new(
            event_id.clone(),
            note_id.clone(),
            Some(TimelineRecordIdentity::Revision(first_id.clone())),
            PayloadVersion::V1,
            LifecycleEventKind::Renamed,
        );
        let second = NoteRevisionHeader::new(
            RevisionIdentity::from_persisted("revision-2"),
            note_id,
            Some(TimelineRecordIdentity::LifecycleEvent(event_id)),
            PayloadVersion::V1,
            MutationSource::Editor,
        );

        assert_eq!(first.predecessor(), None);
        assert_eq!(renamed.kind(), LifecycleEventKind::Renamed);
        assert_eq!(renamed.payload_version(), PayloadVersion::V1);
        assert_eq!(
            second.predecessor(),
            Some(&TimelineRecordIdentity::LifecycleEvent(
                LifecycleEventIdentity::from_persisted("event-1")
            ))
        );
    }

    #[test]
    fn mutation_result_preserves_required_warning_semantics_and_all_diagnostics() {
        let result = NoteMutationResult::from_post_commit(
            MutationSource::Editor,
            PostCommitNoteMutationOutcome {
                note_id: "note-1".to_string(),
                path: PathBuf::from("/vault/Note.md"),
                canonical_markdown: "# Note".to_string(),
                issues: vec![
                    PostCommitIssue {
                        stage: PostCommitStage::CanonicalRead,
                        message: "read failed".to_string(),
                    },
                    PostCommitIssue {
                        stage: PostCommitStage::SemanticUpdate,
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
